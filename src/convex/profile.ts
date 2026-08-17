// Per-user profile and settings: display name, avatar, theme preference and
// the student's stream (natural / social / common) chosen at signup.
//
// `stream` lives here on purpose: the auth users table does not carry it, so
// userProfiles is the single source of truth for stream personalization
// (dashboard labels + AI tutor context).

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { streamValidator } from "./schema";

type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

async function getProfileRow(
  ctx: DbCtx,
  userId: Id<"users">,
): Promise<Doc<"userProfiles"> | null> {
  return (
    (await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique()) ?? null
  );
}

// ---------------------------------------------------------------------------
// Internal helpers (used by node actions via ctx.runQuery / ctx.runMutation)
// ---------------------------------------------------------------------------

export const getProfileByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => getProfileRow(ctx, userId),
});

export const ensureProfile = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await getProfileRow(ctx, userId);
    if (existing) return existing._id;
    return await ctx.db.insert("userProfiles", {
      userId,
      themePreference: "dark",
    });
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The current user's profile plus derived bits (resolved avatar URL, auth
 * email/name). Returns null when signed out. Lazy row creation happens on
 * first save (onboarding / settings), never inside a query.
 */
export const getProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const profile = await getProfileRow(ctx, userId);
    const user = await ctx.db.get(userId);

    let avatarUrl: string | null = null;
    if (profile?.avatarStorageId) {
      avatarUrl = (await ctx.storage.getUrl(profile.avatarStorageId)) ?? null;
    }

    return {
      _id: profile?._id ?? null,
      userId,
      displayName: profile?.displayName ?? user?.name ?? null,
      avatarStorageId: profile?.avatarStorageId ?? null,
      avatarUrl,
      themePreference: profile?.themePreference ?? "dark",
      stream: profile?.stream ?? null,
      email: user?.email ?? null,
      name: user?.name ?? null,
    };
  },
});

export const updateProfile = mutation({
  args: {
    displayName: v.optional(v.string()),
    themePreference: v.optional(v.union(v.literal("dark"), v.literal("light"))),
    stream: v.optional(streamValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ctx.runMutation(internal.profile.ensureProfile, { userId });
    const row = await getProfileRow(ctx, userId);
    if (!row) {
      throw new ConvexError({ message: "Profile could not be created.", code: "internal" });
    }

    const patch: Record<string, unknown> = {};
    if (args.displayName !== undefined) {
      const name = args.displayName.trim();
      if (name.length > 60) {
        throw new ConvexError({
          message: "Display name is too long (max 60 characters).",
          code: "invalid",
        });
      }
      patch.displayName = name || undefined;
    }
    if (args.themePreference !== undefined) patch.themePreference = args.themePreference;
    if (args.stream !== undefined) patch.stream = args.stream;
    await ctx.db.patch(row._id, patch);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Avatar upload (Convex file storage, same pattern as content uploads)
// ---------------------------------------------------------------------------

/** Client uploads the avatar bytes to Convex storage with this URL. */
export const generateAvatarUploadUrl = mutation({
  args: {},
  handler: async (ctx) => await ctx.storage.generateUploadUrl(),
});

export const setAvatar = mutation({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }) => {
    const userId = await requireUser(ctx);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      throw new ConvexError({
        message: "Upload not found — please try again.",
        code: "invalid",
      });
    }
    await ctx.runMutation(internal.profile.ensureProfile, { userId });
    const row = await getProfileRow(ctx, userId);
    if (!row) {
      throw new ConvexError({ message: "Profile could not be created.", code: "internal" });
    }
    const previous = row.avatarStorageId;
    await ctx.db.patch(row._id, { avatarStorageId: storageId });
    if (previous && previous !== storageId) {
      try {
        await ctx.storage.delete(previous);
      } catch {
        // old avatar cleanup is best-effort
      }
    }
    return { ok: true, avatarUrl: url };
  },
});
