// Bookmarks — the student's reading list.
// Every function derives the user from the session; a client can never read
// or write another user's bookmarks.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const toggleBookmark = mutation({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const content = await ctx.db.get(contentId);
    if (!content) {
      throw new ConvexError({ message: "Content item not found.", code: "not_found" });
    }
    const existing = await ctx.db
      .query("bookmarks")
      .withIndex("by_user_content", (q) =>
        q.eq("userId", userId).eq("contentId", contentId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { bookmarked: false };
    }
    await ctx.db.insert("bookmarks", { userId, contentId, createdAt: Date.now() });
    return { bookmarked: true };
  },
});

/** Ids of the current user's bookmarked content (for grid highlighting). */
export const getMyBookmarkIds = query({
  args: {},
  handler: async (ctx): Promise<string[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => row.contentId);
  },
});

/** Full bookmarked items with subject joined — for the reading-list section. */
export const getMyBookmarks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("bookmarks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    const result: (Doc<"contentItems"> & {
      subjectName: string;
      subjectSlug: string;
      bookmarkedAt: number;
    })[] = [];
    for (const row of rows) {
      const item = await ctx.db.get(row.contentId);
      if (!item) continue;
      const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
      result.push({
        ...item,
        subjectName: subject?.name ?? "Unknown",
        subjectSlug: subject?.slug ?? "",
        bookmarkedAt: row.createdAt,
      });
    }
    return result;
  },
});
