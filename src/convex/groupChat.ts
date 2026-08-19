import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Get chat messages for a group. Verifies caller is a member. */
export const getMessages = query({
  args: {
    groupId: v.id("studyGroups"),
    limit: v.optional(v.number()),
    before: v.optional(v.number()),
  },
  handler: async (ctx, { groupId, limit = 50, before }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const role: string | null = await ctx.runQuery(
      internal.studyGroups.getGroupRole,
      { groupId, userId },
    );
    if (!role) return [];

    const blockedIds: Id<"users">[] = await ctx.runQuery(
      internal.safety.getBlockedByUser,
      { userId },
    );
    const blockedSet = new Set(blockedIds);

    let q = ctx.db
      .query("groupChatMessages")
      .withIndex("by_group_createdAt", (q) => q.eq("groupId", groupId))
      .order("desc");

    if (before) {
      q = q.filter((q) => q.lt(q.field("createdAt"), before));
    }

    const messages = await q.take(limit);

    const enriched = await Promise.all(
      messages
        .filter((msg) => !blockedSet.has(msg.userId))
        .reverse()
        .map(async (msg) => {
          const user = await ctx.db.get(msg.userId);
          return {
            ...msg,
            userName: user?.name || user?.email || "Student",
            isMine: msg.userId === userId,
          };
        }),
    );

    return enriched;
  },
});

/** Count unread messages since a given timestamp. */
export const getUnreadCount = query({
  args: {
    groupId: v.id("studyGroups"),
    since: v.number(),
  },
  handler: async (ctx, { groupId, since }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;

    const role: string | null = await ctx.runQuery(
      internal.studyGroups.getGroupRole,
      { groupId, userId },
    );
    if (!role) return 0;

    const messages = await ctx.db
      .query("groupChatMessages")
      .withIndex("by_group_createdAt", (q) => q.eq("groupId", groupId))
      .filter((q) => q.gt(q.field("createdAt"), since))
      .filter((q) => q.neq(q.field("userId"), userId))
      .take(100);

    return messages.length;
  },
});

/** Create a short-lived Convex upload URL for a group attachment. */
export const generateUploadUrl = mutation({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const role: string | null = await ctx.runQuery(internal.studyGroups.getGroupRole, { groupId, userId });
    if (!role) throw new Error("Not a member of this group");
    return ctx.storage.generateUploadUrl();
  },
});

/** Resolve an attachment only for members of its group. */
export const getAttachmentUrl = query({
  args: { groupId: v.id("studyGroups"), storageId: v.string() },
  handler: async (ctx, { groupId, storageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const role: string | null = await ctx.runQuery(internal.studyGroups.getGroupRole, { groupId, userId });
    if (!role) return null;
    return ctx.storage.getUrl(storageId as Id<"_storage">);
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Send a text message to a group chat. */
export const sendMessage = mutation({
  args: {
    groupId: v.id("studyGroups"),
    content: v.string(),
  },
  handler: async (ctx, { groupId, content }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const role: string | null = await ctx.runQuery(
      internal.studyGroups.getGroupRole,
      { groupId, userId },
    );
    if (!role) throw new Error("Not a member of this group");

    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) {
      throw new Error("Message must be 1–2000 characters");
    }

    return await ctx.db.insert("groupChatMessages", {
      groupId,
      userId,
      content: trimmed,
      messageType: "text",
      createdAt: Date.now(),
    });
  },
});

/** Send a file/image attachment to a group chat. */
export const sendAttachment = mutation({
  args: {
    groupId: v.id("studyGroups"),
    attachmentStorageId: v.string(),
    attachmentType: v.union(v.literal("file"), v.literal("image")),
    attachmentName: v.string(),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const role: string | null = await ctx.runQuery(
      internal.studyGroups.getGroupRole,
      { groupId: args.groupId, userId },
    );
    if (!role) throw new Error("Not a member of this group");

    return await ctx.db.insert("groupChatMessages", {
      groupId: args.groupId,
      userId,
      content: args.content?.trim() || undefined,
      attachmentStorageId: args.attachmentStorageId,
      attachmentType: args.attachmentType,
      attachmentName: args.attachmentName,
      messageType: "file",
      createdAt: Date.now(),
    });
  },
});

/** Send a voice note to a group chat. */
export const sendVoiceNote = mutation({
  args: {
    groupId: v.id("studyGroups"),
    attachmentStorageId: v.string(),
    durationSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const role: string | null = await ctx.runQuery(
      internal.studyGroups.getGroupRole,
      { groupId: args.groupId, userId },
    );
    if (!role) throw new Error("Not a member of this group");

    return await ctx.db.insert("groupChatMessages", {
      groupId: args.groupId,
      userId,
      attachmentStorageId: args.attachmentStorageId,
      attachmentType: "file",
      attachmentName: `Voice note (${Math.round(args.durationSeconds)}s)`,
      messageType: "voice_note",
      voiceNoteDurationSeconds: args.durationSeconds,
      createdAt: Date.now(),
    });
  },
});
