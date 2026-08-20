// YouTube search for the reader's "Related videos" panel.
//
// Requires YOUTUBE_API_KEY (Google Cloud Console -> enable YouTube Data API
// v3 -> create an API key) pasted in the Keys tab. When the key is missing
// the action returns configured:false and the UI shows a clear notice — the
// feature degrades gracefully, never silently.
//
// Videos are opened in a new tab (never embedded/autoplayed) — students stay
// in control of their attention.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { logEventAction } from "./systemEvents";

export interface YouTubeVideo {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  publishedAt: string;
}

export const searchYouTubeVideos = action({
  args: {
    query: v.string(),
    maxResults: v.optional(v.number()),
  },
  handler: async (ctx, { query, maxResults }): Promise<{ configured: boolean; videos: YouTubeVideo[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const trimmed = query.trim();
    if (!trimmed) {
      const hasKey = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "YOUTUBE_API_KEY" });
      return { configured: Boolean(hasKey || process.env.YOUTUBE_API_KEY), videos: [] };
    }

    const key = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "YOUTUBE_API_KEY" })
      ?? process.env.YOUTUBE_API_KEY;
    if (!key) {
      return { configured: false, videos: [] };
    }

    const startedAt = Date.now();
    try {
      const params = new URLSearchParams({
        part: "snippet",
        type: "video",
        q: trimmed,
        maxResults: String(Math.min(Math.max(maxResults ?? 5, 1), 8)),
        key,
      });
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`YouTube API error ${response.status}`);
      }
      const data = (await response.json()) as {
        items?: {
          id?: { videoId?: string };
          snippet?: {
            title?: string;
            channelTitle?: string;
            thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
            publishedAt?: string;
          };
        }[];
      };

      const videos: YouTubeVideo[] = (data.items ?? [])
        .filter((item) => item.id?.videoId && item.snippet?.title)
        .map((item) => ({
          id: item.id!.videoId!,
          title: item.snippet!.title!.replace(/&#39;/g, "'").replace(/&amp;/g, "&"),
          channel: item.snippet!.channelTitle ?? "YouTube",
          thumbnail: item.snippet!.thumbnails?.medium?.url ?? item.snippet!.thumbnails?.default?.url ?? "",
          publishedAt: item.snippet!.publishedAt ?? "",
        }));

      await logEventAction(ctx, {
        eventType: "api_call",
        source: "media.searchYouTube",
        status: "success",
        userId,
        metadata: { query: trimmed.slice(0, 80), results: videos.length },
        durationMs: Date.now() - startedAt,
      });
      return { configured: true, videos };
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "media.searchYouTube",
        status: "error",
        userId,
        metadata: { query: trimmed.slice(0, 80), message: error instanceof Error ? error.message : "unknown" },
        durationMs: Date.now() - startedAt,
      });
      return { configured: true, videos: [] };
    }
  },
});
