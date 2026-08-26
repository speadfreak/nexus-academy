import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getTourStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { hasCompletedTour: true, tourSkippedAt: undefined as number | undefined }; // Don't show tour for unauthenticated
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    return {
      hasCompletedTour: profile?.hasCompletedTour ?? false,
      tourSkippedAt: profile?.tourSkippedAt,
    };
  },
});

export const updateTourStatus = mutation({
  args: {
    action: v.union(v.literal("completed"), v.literal("skipped"), v.literal("reset")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return;
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) {
      if (args.action === "reset") {
        await ctx.db.patch(existing._id, { hasCompletedTour: false, tourSkippedAt: undefined });
      } else if (args.action === "completed") {
        await ctx.db.patch(existing._id, { hasCompletedTour: true });
      } else {
        await ctx.db.patch(existing._id, { tourSkippedAt: Date.now() });
      }
    }
  },
});
