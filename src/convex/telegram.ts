// Telegram — channel management, broadcast history, and internal helpers.
// The HTTP-calling ACTIONS live in telegramActions.ts (node runtime) — this
// module holds everything that touches the database directly.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";

// ---------------------------------------------------------------------------
// Channel management (admin)
// ---------------------------------------------------------------------------

export const listTelegramChannels = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") return [];
    const channels = await ctx.db.query("telegramChannels").collect();
    const autoPosts = await ctx.db.query("telegramAutoPosts").collect();
    const autoByChannel = new Map(autoPosts.map((row) => [row.channelId, row.enabled]));
    return channels.map((channel) => ({
      _id: channel._id,
      name: channel.name,
      chatId: channel.chatId,
      addedAt: channel.addedAt,
      autoPost: autoByChannel.get(channel._id) ?? false,
    }));
  },
});

export const addTelegramChannel = mutation({
  args: { name: v.string(), chatId: v.string() },
  handler: async (ctx, { name, chatId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
    }
    const trimmedName = name.trim();
    const trimmedChatId = chatId.trim();
    if (!trimmedName || !trimmedChatId) {
      throw new ConvexError({ message: "Name and chat id are required.", code: "invalid" });
    }
    const existing = await ctx.db
      .query("telegramChannels")
      .withIndex("by_chatId", (q) => q.eq("chatId", trimmedChatId))
      .first();
    if (existing) {
      throw new ConvexError({
        message: "That chat id is already added as a channel.",
        code: "invalid",
      });
    }
    const channelId = await ctx.db.insert("telegramChannels", {
      name: trimmedName,
      chatId: trimmedChatId,
      addedAt: Date.now(),
    });
    // Auto-post starts OFF for every new channel — explicit toggle only.
    await ctx.db.insert("telegramAutoPosts", {
      channelId,
      enabled: false,
      updatedAt: Date.now(),
    });
    return { ok: true, channelId };
  },
});

export const removeTelegramChannel = mutation({
  args: { channelId: v.id("telegramChannels") },
  handler: async (ctx, { channelId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
    }
    const channel = await ctx.db.get(channelId);
    if (!channel) {
      throw new ConvexError({ message: "Channel not found.", code: "not_found" });
    }
    const autoPost = await ctx.db
      .query("telegramAutoPosts")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .first();
    if (autoPost) await ctx.db.delete(autoPost._id);
    await ctx.db.delete(channelId);
    return { ok: true };
  },
});

/** Explicit per-channel auto-post toggle (default OFF). */
export const setAutoPost = mutation({
  args: { channelId: v.id("telegramChannels"), enabled: v.boolean() },
  handler: async (ctx, { channelId, enabled }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
    }
    const existing = await ctx.db
      .query("telegramAutoPosts")
      .withIndex("by_channel", (q) => q.eq("channelId", channelId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { enabled, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("telegramAutoPosts", {
        channelId,
        enabled,
        updatedAt: Date.now(),
      });
    }
    return { ok: true, enabled };
  },
});

// ---------------------------------------------------------------------------
// Broadcast history + templates (admin reads)
// ---------------------------------------------------------------------------

export const getBroadcastLog = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") return [];
    const rows = await ctx.db
      .query("broadcastLog")
      .withIndex("by_sentAt", (q) => q.gte("sentAt", 0))
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      _id: row._id,
      message: row.message,
      channels: row.channels,
      sentAt: row.sentAt,
      status: row.status,
    }));
  },
});

/** Template strings for the admin broadcast composer (no secrets). */
export const getBroadcastTemplates = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") return [];
    return Object.entries(BROADCAST_TEMPLATES).map(([id, text]) => ({ id, text }));
  },
});

export const BROADCAST_TEMPLATES: Record<string, string> = {
  new_content: "📚 New in the library: {title} — {subject} Grade {grade} ({type}).",
  maintenance: "🛠️ Nexus Academy will be briefly unavailable for maintenance.",
  motivation: "🔥 Keep grinding, students. Every session counts toward exam day.",
  custom: "{custom}",
};

// ---------------------------------------------------------------------------
// Internal plumbing (actions call these via runQuery/runMutation)
// ---------------------------------------------------------------------------

export const getChannelById = internalQuery({
  args: { channelId: v.id("telegramChannels") },
  handler: async (ctx, { channelId }) => (await ctx.db.get(channelId)) ?? null,
});

export const insertBroadcastLog = internalMutation({
  args: {
    message: v.string(),
    channels: v.array(v.string()),
    sentBy: v.id("users"),
    status: v.union(v.literal("sent"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("broadcastLog", {
      message: args.message,
      channels: args.channels,
      sentBy: args.sentBy,
      status: args.status,
      sentAt: Date.now(),
    });
    return { ok: true };
  },
});

export const listEnabledAutoPostChannels = internalQuery({
  args: {},
  handler: async (ctx) => {
    const autoPosts = await ctx.db
      .query("telegramAutoPosts")
      .filter((q) => q.eq(q.field("enabled"), true))
      .collect();
    const channels = [];
    for (const row of autoPosts) {
      const channel = await ctx.db.get(row.channelId);
      if (channel) {
        channels.push({ _id: channel._id, chatId: channel.chatId, name: channel.name });
      }
    }
    return channels;
  },
});
