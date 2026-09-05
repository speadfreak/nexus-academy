// In-app notifications.
//
// No push infrastructure exists (and none is fabricated) — these are visible
// when the student opens the app, never an external ping trying to pull them
// back in. Created from real flows: achievement earned, level up, group
// member joined, study-plan week becoming due (cron).

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Internal creation (called from success paths only — never from the client)
// ---------------------------------------------------------------------------

export const createNotification = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.string(),
    title: v.string(),
    body: v.string(),
    actionUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("notifications", {
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      actionUrl: args.actionUrl,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Public reads + mutations (ownership-checked)
// ---------------------------------------------------------------------------

export const getMyNotifications = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(30);
    return rows.map((row) => ({
      _id: row._id,
      type: row.type,
      title: row.title,
      body: row.body,
      readAt: row.readAt ?? null,
      createdAt: row.createdAt,
      actionUrl: row.actionUrl ?? null,
    }));
  },
});

/**
 * Extended read for the futuristic notifications panel — returns up to 60
 * notifications with the same fields as `getMyNotifications`. Includes
 * grouping hints the frontend uses to bucket by date (Today / Yesterday /
 * This week / Earlier) and counts for the unread badge + filter tabs.
 */
export const getMyNotificationsExtended = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        notifications: [],
        unreadCount: 0,
        totalCount: 0,
        byType: {} as Record<string, number>,
      };
    }
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60);
    const byType: Record<string, number> = {};
    let unreadCount = 0;
    for (const row of rows) {
      byType[row.type] = (byType[row.type] ?? 0) + 1;
      if (row.readAt === null || row.readAt === undefined) unreadCount += 1;
    }
    return {
      notifications: rows.map((row) => ({
        _id: row._id,
        type: row.type,
        title: row.title,
        body: row.body,
        readAt: row.readAt ?? null,
        createdAt: row.createdAt,
        actionUrl: row.actionUrl ?? null,
      })),
      unreadCount,
      totalCount: rows.length,
      byType,
    };
  },
});

export const markRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const row = await ctx.db.get(notificationId);
    if (!row || row.userId !== userId) {
      throw new ConvexError({ message: "Notification not found.", code: "not_found" });
    }
    if (!row.readAt) {
      await ctx.db.patch(row._id, { readAt: Date.now() });
    }
    return { ok: true };
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .take(100);
    const now = Date.now();
    for (const row of rows) {
      if (!row.readAt) await ctx.db.patch(row._id, { readAt: now });
    }
    return { ok: true };
  },
});

/**
 * Permanently delete one of your own notifications. Used by the futuristic
 * notification panel's "Dismiss" action — students can clear clutter they
 * don't want to see anymore.
 */
export const deleteNotification = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const row = await ctx.db.get(notificationId);
    if (!row || row.userId !== userId) {
      throw new ConvexError({ message: "Notification not found.", code: "not_found" });
    }
    await ctx.db.delete(row._id);
    return { ok: true };
  },
});

/**
 * Bulk delete all read notifications older than `olderThanMs` milliseconds.
 * Default: 30 days. Used by the "Clear all read" button in the
 * notification panel so students can declutter without touching unread
 * notifications.
 */
export const clearReadNotifications = mutation({
  args: { olderThanMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const cutoff = Date.now() - (args.olderThanMs ?? 30 * 24 * 60 * 60 * 1000);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .take(200);
    let deleted = 0;
    for (const row of rows) {
      if (row.readAt && row.createdAt < cutoff) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { ok: true, deleted };
  },
});
