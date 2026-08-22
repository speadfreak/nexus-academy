// YouTube search for the reader’s "Related videos" panel.
//
// Architecture:
//   1. CACHE FIRST — a videoCache row per contentId stores the merged
//      results as JSON. 30-day TTL. The first student to open a content
//      item triggers the API; everyone else hits the cache. This is the
//      single most important design decision — YouTube’s free tier allows
//      only ~100 searches/day (100 quota units each). Without caching,
//      real usage would exhaust the quota in hours.
//
//   2. DUAL SEARCH — priority channel(s) first, then general results.
//      The priority channel handle (e.g. @ethioeduc) is resolved to a real
//      channel ID via channels.list?forHandle=... on each call (1 quota
//      unit, negligible vs 100 per search).
//
//   3. GRACEFUL DEGRADATION — missing key shows a setup notice; quota
//      exhaustion (403) shows a “try again tomorrow” message; network
//      errors show a generic fallback. Never a raw error in the UI.
//
// Requires YOUTUBE_API_KEY (Google Cloud Console → enable “YouTube Data API
// v3” → create a restricted API key) pasted in Admin → Keys tab.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { logEventAction } from "./systemEvents";
import {
  PRIORITY_CHANNEL_HANDLES,
  VIDEO_CACHE_TTL_MS,
  VIDEO_MAX_PER_SLICE,
} from "./constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface YouTubeVideo {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  publishedAt: string;
  /** True if from a priority Ethiopian education channel. */
  isPriority?: boolean;
}

export interface YouTubeSearchResult {
  configured: boolean;
  quotaExhausted?: boolean;
  videos: YouTubeVideo[];
}

// ---------------------------------------------------------------------------
// Internal cache queries/mutations
// ---------------------------------------------------------------------------

export const getVideoCache = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) =>
    (await ctx.db
      .query("videoCache")
      .withIndex("by_content", (q) => q.eq("contentId", contentId))
      .first()) ?? null,
});

export const upsertVideoCache = internalMutation({
  args: {
    contentId: v.id("contentItems"),
    videosJson: v.string(),
    fetchedAt: v.number(),
  },
  handler: async (ctx, { contentId, videosJson, fetchedAt }) => {
    const existing = await ctx.db
      .query("videoCache")
      .withIndex("by_content", (q) => q.eq("contentId", contentId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { videosJson, fetchedAt });
    } else {
      await ctx.db.insert("videoCache", { contentId, videosJson, fetchedAt });
    }
  },
});

// ---------------------------------------------------------------------------
// YouTube API helpers
// ---------------------------------------------------------------------------

async function resolveYouTubeKey(ctx: any): Promise<string | null> {
  const { internal } = await import("./_generated/api");
  return (
    (await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: "YOUTUBE_API_KEY",
    })) ?? process.env.YOUTUBE_API_KEY ?? null
  );
}

interface RawYouTubeItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: { medium?: { url?: string }; high?: { url?: string }; default?: { url?: string } };
    publishedAt?: string;
  };
}

function normalizeItems(items: RawYouTubeItem[], isPriority: boolean): YouTubeVideo[] {
  return items
    .filter((item) => item.id?.videoId && item.snippet?.title)
    .map((item) => ({
      id: item.id!.videoId!,
      title: item.snippet!.title!
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '\"'),
      channel: item.snippet!.channelTitle ?? "YouTube",
      thumbnail:
        item.snippet!.thumbnails?.high?.url ??
        item.snippet!.thumbnails?.medium?.url ??
        item.snippet!.thumbnails?.default?.url ??
        "",
      publishedAt: item.snippet!.publishedAt ?? "",
      ...(isPriority ? { isPriority: true as const } : {}),
    }));
}

async function youtubeSearch(
  key: string,
  query: string,
  maxResults: number,
  channelId?: string,
): Promise<{ items: RawYouTubeItem[]; quotaExhausted: boolean }> {
  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: query,
    maxResults: String(maxResults),
    key,
  });
  if (channelId) params.set("channelId", channelId);

  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
  );

  if (response.status === 403) {
    return { items: [], quotaExhausted: true };
  }
  if (!response.ok) {
    throw new Error(`YouTube API error ${response.status}`);
  }

  const data = (await response.json()) as { items?: RawYouTubeItem[] };
  return { items: data.items ?? [], quotaExhausted: false };
}

/**
 * Resolve a @handle to a channel ID via channels.list?forHandle=...
 * This is the correct current API method (2024+). Costs only 1 quota unit.
 */
async function resolveHandleToChannelId(
  key: string,
  handle: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    part: "id",
    forHandle: handle.replace("@", ""),
    key,
  });
  const response = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?${params.toString()}`,
  );
  if (!response.ok) return null;
  const data = (await response.json()) as { items?: { id?: string }[] };
  return data.items?.[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Public API — cached, dual-search, quota-safe
// ---------------------------------------------------------------------------

export const searchYouTubeVideos = action({
  args: {
    contentId: v.id("contentItems"),
    query: v.string(),
  },
  handler: async (
    ctx,
    { contentId, query },
  ): Promise<YouTubeSearchResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    const ytKey = await resolveYouTubeKey(ctx);
    if (!ytKey) {
      return { configured: false, videos: [] };
    }

    const trimmed = query.trim();
    if (!trimmed) {
      return { configured: true, videos: [] };
    }

    // --- CHECK CACHE (30-day TTL) ---------------------------------------
    const cached = await ctx.runQuery(internal.media.getVideoCache, { contentId });
    if (cached && Date.now() - cached.fetchedAt < VIDEO_CACHE_TTL_MS) {
      try {
        const videos = JSON.parse(cached.videosJson) as YouTubeVideo[];
        return { configured: true, videos };
      } catch {
        // Corrupted cache — fall through to re-fetch
      }
    }

    // --- FETCH FROM YOUTUBE --------------------------------------------
    const startedAt = Date.now();
    let allVideos: YouTubeVideo[] = [];
    let quotaExhausted = false;

    try {
      // 1. Priority channel searches (1 quota unit each for channel resolve,
      //    100 units each for search — but only 1-2 handles so negligible)
      for (const handle of PRIORITY_CHANNEL_HANDLES) {
        if (quotaExhausted) break;
        const channelId = await resolveHandleToChannelId(ytKey, handle);
        if (!channelId) continue;

        const { items, quotaExhausted: qe } = await youtubeSearch(
          ytKey,
          trimmed,
          VIDEO_MAX_PER_SLICE,
          channelId,
        );
        if (qe) { quotaExhausted = true; break; }
        allVideos.push(...normalizeItems(items, true));
      }

      // 2. General topic search
      if (!quotaExhausted) {
        const { items, quotaExhausted: qe } = await youtubeSearch(
          ytKey,
          trimmed,
          VIDEO_MAX_PER_SLICE,
        );
        if (qe) {
          quotaExhausted = true;
        } else {
          const seenIds = new Set(allVideos.map((v) => v.id));
          const general = normalizeItems(items, false).filter(
            (v) => !seenIds.has(v.id),
          );
          allVideos.push(...general);
        }
      }

      // --- WRITE CACHE -------------------------------------------------
      if (allVideos.length > 0) {
        await ctx.runMutation(internal.media.upsertVideoCache, {
          contentId,
          videosJson: JSON.stringify(allVideos),
          fetchedAt: Date.now(),
        });
      }

      await logEventAction(ctx, {
        eventType: "api_call",
        source: "media.searchYouTube",
        status: "success",
        userId,
        metadata: {
          query: trimmed.slice(0, 80),
          results: allVideos.length,
          cached: false,
          quotaExhausted,
        },
        durationMs: Date.now() - startedAt,
      });

      return { configured: true, quotaExhausted, videos: allVideos };
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "media.searchYouTube",
        status: "error",
        userId,
        metadata: {
          query: trimmed.slice(0, 80),
          message: error instanceof Error ? error.message : "unknown",
        },
        durationMs: Date.now() - startedAt,
      });
      return { configured: true, videos: [] };
    }
  },
});
