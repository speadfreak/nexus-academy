// In-app notifications.
//
// No push infrastructure exists (and none is fabricated) — these are visible
// when the student opens the app, never an external ping trying to pull them
// back in. Created from real flows: achievement earned, level up, group
// member joined, study-plan week becoming due (cron).

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

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
