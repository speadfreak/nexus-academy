// Study rooms — video + screen share + chat + shared workspace, scoped to a
// study group. A room ALWAYS belongs to a group (invite-code-only, members
// only): there is no public room discovery and no way to get a join token
// without being a member of the room's group.
//
// The three node-runtime actions (createRoom, getJoinToken, endRoom) live in
// roomsActions.ts (they talk to the video provider + mint access tokens).
// This file holds everything else: internal helpers, presence, chat, shared
// workspace and reads — every one of them verifies group membership and
// block status server-side.
//
// PRIVACY: no recording anywhere in this build. Rooms are created with
// egress/recording disabled (LiveKit only records when an Egress job is
// started; we never start one). Ending a room deletes it via the provider
// API, which terminates all participant connections server-side.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";

export type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

/** Group-membership gate shared by every room read/write path. */
export async function assertGroupMember(
  ctx: ActionCtx | MutationCtx | QueryCtx,
  groupId: Id<"studyGroups">,
  userId: Id<"users">,
): Promise<void> {
  const member = await ctx.runQuery(internal.studyGroups.isGroupMember, {
    groupId,
    userId,
  });
  if (!member) {
    throw new ConvexError({
      message: "You must be a member of this study group to use its rooms.",
      code: "not_group_member",
    });
  }
}

/**
 * Block check shared by join + messaging paths: if a block exists (either
 * direction) between the caller and ANY current participant, they may not
 * join or speak in this room. Deliberately doesn't reveal who blocked whom.
 */
export async function assertNoBlockWithParticipants(
  ctx: ActionCtx | MutationCtx,
  callerId: Id<"users">,
  roomId: Id<"studyRooms">,
): Promise<void> {
  const participants = await ctx.runQuery(internal.rooms.listActiveParticipantIds, {
    roomId,
  });
  for (const participantId of participants) {
    if (participantId === callerId) continue;
    const blocked = await ctx.runQuery(internal.safety.hasBlockBetween, {
      userAId: callerId,
      userBId: participantId,
    });
    if (blocked) {
      throw new ConvexError({
        message: "You can't join right now — someone in this room has you blocked, or you've blocked them.",
        code: "blocked",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Internal DB helpers (actions can't touch ctx.db directly)
// ---------------------------------------------------------------------------

export const getRoomByIdInternal = internalQuery({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<Doc<"studyRooms"> | null> =>
    (await ctx.db.get(roomId)) ?? null,
});

export const listActiveParticipantIds = internalQuery({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<Id<"users">[]> => {
    const rows = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .take(100);
    return rows.filter((row) => row.leftAt === null).map((row) => row.userId);
  },
});

export const listRoomMessages = internalQuery({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<Doc<"roomMessages">[]> =>
    await ctx.db
      .query("roomMessages")
      .withIndex("by_room_createdAt", (q) => q.eq("roomId", roomId))
      .order("asc")
      .take(200),
});

export const markRoomEnded = internalMutation({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<void> => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    await ctx.db.patch(room._id, { status: "ended", endedAt: Date.now() });
    const participants = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .take(100);
    for (const participant of participants) {
      if (participant.leftAt === null) {
        await ctx.db.patch(participant._id, { leftAt: Date.now() });
      }
    }
  },
});

export const insertRoom = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    name: v.string(),
    createdBy: v.id("users"),
    videoProviderRoomId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"studyRooms">> =>
    await ctx.db.insert("studyRooms", {
      ...args,
      status: "active",
      createdAt: Date.now(),
    }),
});

// ---------------------------------------------------------------------------
// Presence + chat + shared workspace
// ---------------------------------------------------------------------------

/** Record that the caller is in the room (idempotent — one active row). */
export const joinRoomPresence = mutation({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<{ ok: true }> => {
    const userId = await requireUser(ctx);
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new ConvexError({ message: "Room not found.", code: "not_found" });
    }
    if (room.status !== "active") {
      throw new ConvexError({ message: "This room has ended.", code: "room_ended" });
    }
    await assertGroupMember(ctx, room.groupId, userId);
    await assertNoBlockWithParticipants(ctx, userId, roomId);

    const existing = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId))
      .first();
    if (!existing || existing.leftAt !== null) {
      await ctx.db.insert("roomParticipants", {
        roomId,
        userId,
        joinedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

/** Mark the caller as left (presence row gets a leftAt — room stays live). */
export const leaveRoom = mutation({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<{ ok: true }> => {
    const userId = await requireUser(ctx);
    const existing = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room_user", (q) => q.eq("roomId", roomId).eq("userId", userId))
      .first();
    if (existing && existing.leftAt === null) {
      await ctx.db.patch(existing._id, { leftAt: Date.now() });
    }
    return { ok: true };
  },
});

/** Send a room chat message. Blocked users can't speak into a room where the
 *  person they blocked (or who blocked them) is present — enforced server-side. */
export const sendRoomMessage = mutation({
  args: {
    roomId: v.id("studyRooms"),
    content: v.string(),
  },
  handler: async (ctx, { roomId, content }): Promise<{ ok: true }> => {
    const userId = await requireUser(ctx);
    const text = content.trim();
    if (!text) {
      throw new ConvexError({ message: "Message cannot be empty.", code: "invalid" });
    }
    if (text.length > 2000) {
      throw new ConvexError({
        message: "Message is too long (max 2,000 characters).",
        code: "invalid",
      });
    }
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new ConvexError({ message: "Room not found.", code: "not_found" });
    }
    if (room.status !== "active") {
      throw new ConvexError({ message: "This room has ended.", code: "room_ended" });
    }
    await assertGroupMember(ctx, room.groupId, userId);
    await assertNoBlockWithParticipants(ctx, userId, roomId);

    await ctx.db.insert("roomMessages", {
      roomId,
      userId,
      content: text,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export interface RoomMessageView {
  _id: Id<"roomMessages">;
  userId: Id<"users">;
  name: string;
  content: string;
  createdAt: number;
  isMine: boolean;
}

/** Room messages, verified server-side to be group members only, with any
 *  messages from blocked/hidden users filtered OUT per viewer. */
export const getRoomMessages = query({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<RoomMessageView[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const room = await ctx.db.get(roomId);
    if (!room) return [];
    await assertGroupMember(ctx, room.groupId, userId);

    const hidden: Id<"users">[] = await ctx.runQuery(internal.safety.getHiddenUserIds, {
      userId,
    });
    const hiddenSet = new Set(hidden);

    const messages = await ctx.db
      .query("roomMessages")
      .withIndex("by_room_createdAt", (q) => q.eq("roomId", roomId))
      .order("asc")
      .take(200);

    const nameCache = new Map<Id<"users">, string>();
    const result: RoomMessageView[] = [];
    for (const message of messages) {
      if (hiddenSet.has(message.userId)) continue; // server-side filter
      let name = nameCache.get(message.userId);
      if (name === undefined) {
        const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
          userId: message.userId,
        });
        const user = await ctx.db.get(message.userId);
        name = profile?.displayName ?? user?.name ?? "Student";
        nameCache.set(message.userId, name);
      }
      result.push({
        _id: message._id,
        userId: message.userId,
        name,
        content: message.content,
        createdAt: message.createdAt,
        isMine: message.userId === userId,
      });
    }
    return result;
  },
});

/** Link a library content item or one of YOUR notes into the room. */
export const shareItem = mutation({
  args: {
    roomId: v.id("studyRooms"),
    itemType: v.union(v.literal("content"), v.literal("note")),
    itemId: v.string(),
  },
  handler: async (ctx, { roomId, itemType, itemId }): Promise<{ ok: true }> => {
    const userId = await requireUser(ctx);
    const room = await ctx.db.get(roomId);
    if (!room) {
      throw new ConvexError({ message: "Room not found.", code: "not_found" });
    }
    await assertGroupMember(ctx, room.groupId, userId);

    if (itemType === "content") {
      const content = await ctx.db.get(itemId as Id<"contentItems">);
      if (!content) {
        throw new ConvexError({ message: "Content item not found.", code: "not_found" });
      }
    } else {
      const note = await ctx.db.get(itemId as Id<"notes">);
      if (!note) {
        throw new ConvexError({ message: "Note not found.", code: "not_found" });
      }
      if (note.userId !== userId) {
        throw new ConvexError({
          message: "You can only share your own notes.",
          code: "unauthorized",
        });
      }
    }

    const existing = await ctx.db
      .query("roomSharedItems")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .filter((q) =>
        q.and(
          q.eq(q.field("itemType"), itemType),
          q.eq(q.field("itemId"), itemId),
        ),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("roomSharedItems", {
        roomId,
        itemType,
        itemId,
        sharedBy: userId,
        sharedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

export interface SharedItemView {
  _id: Id<"roomSharedItems">;
  itemType: "content" | "note";
  itemId: string;
  sharedAt: number;
  title: string;
  contentType?: string;
  fileUrl?: string;
  subjectName?: string | null;
  grade?: number;
  content?: string;
  color?: string;
}

/** Shared workspace items with resolved details (content title/url or the
 *  note's text + subject), members only. */
export const getRoomSharedItems = query({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<SharedItemView[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const room = await ctx.db.get(roomId);
    if (!room) return [];
    await assertGroupMember(ctx, room.groupId, userId);

    const rows = await ctx.db
      .query("roomSharedItems")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("asc")
      .take(100);

    const result: SharedItemView[] = [];
    for (const row of rows) {
      if (row.itemType === "content") {
        const content = await ctx.db.get(row.itemId as Id<"contentItems">);
        if (!content) continue;
        const subject = await ctx.db.get(content.subjectId);
        result.push({
          _id: row._id,
          itemType: "content",
          itemId: row.itemId,
          sharedAt: row.sharedAt,
          title: content.title,
          contentType: content.contentType,
          fileUrl: content.fileUrl,
          subjectName: subject?.name ?? null,
          grade: content.grade,
        });
      } else {
        const note = await ctx.db.get(row.itemId as Id<"notes">);
        if (!note) continue;
        const subject = await ctx.db.get(note.subjectId);
        result.push({
          _id: row._id,
          itemType: "note",
          itemId: row.itemId,
          sharedAt: row.sharedAt,
          title: `Note${subject ? ` · ${subject.name}` : ""}`,
          content: note.content,
          color: note.color,
        });
      }
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ActiveRoomView {
  roomId: Id<"studyRooms">;
  name: string;
  createdAt: number;
  createdByName: string;
  participantCount: number;
  isCreator: boolean;
  iAmIn: boolean;
}

/** Active rooms in a group the caller belongs to (rooms live on the group —
 *  there is no global room directory). */
export const listActiveRoomsForGroup = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }): Promise<ActiveRoomView[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    await assertGroupMember(ctx, groupId, userId);

    const rooms = await ctx.db
      .query("studyRooms")
      .withIndex("by_group_status", (q) =>
        q.eq("groupId", groupId).eq("status", "active"),
      )
      .order("desc")
      .take(20);

    const result: ActiveRoomView[] = [];
    for (const room of rooms) {
      const participants = await ctx.db
        .query("roomParticipants")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .take(100);
      const active = participants.filter((p) => p.leftAt === null);
      const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
        userId: room.createdBy,
      });
      result.push({
        roomId: room._id,
        name: room.name,
        createdAt: room.createdAt,
        createdByName: profile?.displayName ?? "A group member",
        participantCount: active.length,
        isCreator: room.createdBy === userId,
        iAmIn: active.some((p) => p.userId === userId),
      });
    }
    return result;
  },
});

export interface RoomView {
  roomId: Id<"studyRooms">;
  name: string;
  status: "active" | "ended";
  createdAt: number;
  endedAt: number | null;
  groupId: Id<"studyGroups">;
  groupName: string;
  createdBy: Id<"users">;
  createdByName: string;
  myRole: "owner" | "member" | null;
  isCreator: boolean;
  canEndRoom: boolean;
  iAmIn: boolean;
  participants: { userId: Id<"users">; name: string; isMe: boolean; isCreator: boolean }[];
}

/** Full room view for /rooms/:roomId — room, group, live participants with
 *  names, caller's role + presence, all gated on group membership. */
export const getRoomById = query({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<RoomView | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const room = await ctx.db.get(roomId);
    if (!room) return null;
    await assertGroupMember(ctx, room.groupId, userId);

    const group = await ctx.db.get(room.groupId);
    const createdBy = await ctx.db.get(room.createdBy);
    const createdByProfile = await ctx.runQuery(internal.profile.getProfileByUser, {
      userId: room.createdBy,
    });
    const groupRole = await ctx.runQuery(internal.studyGroups.getGroupRole, {
      groupId: room.groupId,
      userId,
    });

    const participantRows = await ctx.db
      .query("roomParticipants")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .take(100);
    const activeRows = participantRows.filter((p) => p.leftAt === null);

    const hidden: Id<"users">[] = await ctx.runQuery(internal.safety.getHiddenUserIds, {
      userId,
    });
    const hiddenSet = new Set(hidden);

    const participants: RoomView["participants"] = [];
    for (const row of activeRows) {
      if (hiddenSet.has(row.userId)) continue; // blocked users are invisible here too
      const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
        userId: row.userId,
      });
      const user = await ctx.db.get(row.userId);
      participants.push({
        userId: row.userId,
        name: profile?.displayName ?? user?.name ?? "Student",
        isMe: row.userId === userId,
        isCreator: row.userId === room.createdBy,
      });
    }

    return {
      roomId: room._id,
      name: room.name,
      status: room.status,
      createdAt: room.createdAt,
      endedAt: room.endedAt ?? null,
      groupId: room.groupId,
      groupName: group?.name ?? "Study group",
      createdBy: room.createdBy,
      createdByName: createdByProfile?.displayName ?? createdBy?.name ?? "A group member",
      myRole: groupRole,
      isCreator: room.createdBy === userId,
      canEndRoom: room.createdBy === userId || groupRole === "owner",
      iAmIn: activeRows.some((p) => p.userId === userId),
      participants,
    };
  },
});
