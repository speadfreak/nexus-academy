// Reader scratchpads — one free-form text area per (user, content item).
// Persisted so returning to the same book keeps the student's working notes
// (math workings, formulas, summaries). Ownership-checked on every access.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const MAX_LENGTH = 20000;

export const getScratchpad = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db
      .query("scratchpads")
      .withIndex("by_user_content", (q) =>
        q.eq("userId", userId).eq("contentId", contentId),
      )
      .first();
    return row ? { content: row.content, updatedAt: row.updatedAt } : null;
  },
});

export const saveScratchpad = mutation({
  args: { contentId: v.id("contentItems"), content: v.string() },
  handler: async (ctx, { contentId, content }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    if (content.length > MAX_LENGTH) {
      throw new ConvexError({
        message: `Scratchpad is too long (max ${MAX_LENGTH} characters).`,
        code: "invalid",
      });
    }
    const existing = await ctx.db
      .query("scratchpads")
      .withIndex("by_user_content", (q) =>
        q.eq("userId", userId).eq("contentId", contentId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { content, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("scratchpads", {
        userId,
        contentId,
        content,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});
