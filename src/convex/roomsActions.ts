// Study room ACTIONS — the only functions that talk to the video provider.
// This file runs in the Node.js runtime ("use node") because it signs JWTs
// with node crypto and calls the LiveKit REST API. Queries/mutations for
// rooms live in rooms.ts; this file only contains actions.
//
// VIDEO PROVIDER DECISION (documented, per phase spec): LiveKit Cloud.
//   - Managed WebRTC infrastructure (SFU, TURN, reconnection) — we do NOT
//     hand-roll peer connections or signaling.
//   - React SDK (@livekit/components-react) provides the participant grid,
//     screen share, mute/camera controls out of the box.
//   - Short-lived, server-minted JWT access tokens let us run every safety
//     check (group membership + block status) BEFORE a token exists, and the
//     REST API can delete a room to forcibly terminate video for everyone.
//   - Free tier at time of writing: Build plan $0/mo (no card), 5,000 WebRTC
//     minutes/mo + 40k free API requests, 50GB transfer.
//
// Required env vars (paste into the Keys / API keys tab — never hardcode):
//   LIVEKIT_URL        e.g. wss://your-project.livekit.cloud
//   LIVEKIT_API_KEY    from LiveKit Cloud project settings
//   LIVEKIT_API_SECRET from LiveKit Cloud project settings
// Sign up at https://livekit.io/cloud, create a project, then copy the three
// values from Project Settings > Keys. Without them every room call throws a
// clear "not configured" error and the UI explains what to add.
//
// PRIVACY: no recording anywhere in this build. Rooms are created with
// egress/recording disabled (LiveKit only records when an Egress job is
// started; we never start one). Ending a room deletes it via the provider
// API, which terminates all participant connections server-side — the video
// stream does not keep running for someone who just closed their tab.

"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { createHmac } from "crypto";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { assertGroupMember, assertNoBlockWithParticipants } from "./rooms";

const LIVEKIT_API_BASE = "https://api.livekit.io";
const TOKEN_TTL_SECONDS = 60 * 15; // 15 minutes — short-lived by design
const ROOM_EMPTY_TIMEOUT_SECONDS = 60 * 15; // auto-close after 15 min empty

function requireLiveKitConfig(): { url: string; apiKey: string; apiSecret: string } {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new ConvexError({
      message:
        "Video rooms are not configured yet — add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in the Keys tab (from your LiveKit Cloud project).",
      code: "not_configured",
    });
  }
  return { url, apiKey, apiSecret };
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mint a LiveKit access token: an HS256 JWT with the API key as `kid` and a
 * `video` grant limiting the holder to a single room. `roomAdmin` is only set
 * for the room creator / group owner so they can disconnect others (end room).
 */
function signLiveKitToken(
  apiKey: string,
  apiSecret: string,
  claims: { identity: string; name: string; room: string; roomAdmin: boolean },
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT", kid: apiKey };
  const payload = {
    ...claims,
    video: {
      room: claims.room,
      roomJoin: true,
      roomAdmin: claims.roomAdmin,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: false,
    },
    iss: apiKey,
    sub: apiKey,
    iat: now,
    nbf: now - 10,
    exp: now + TOKEN_TTL_SECONDS,
  };
  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", apiSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  return `${headerB64}.${payloadB64}.${signature}`;
}

async function liveKitCreateRoom(apiKey: string, name: string): Promise<void> {
  const response = await fetch(`${LIVEKIT_API_BASE}/rtc/rooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      name,
      emptyTimeout: ROOM_EMPTY_TIMEOUT_SECONDS,
      // No egress config — recording is never enabled in this build.
    }),
  });
  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`LiveKit create room failed (${response.status}): ${raw.slice(0, 200)}`);
  }
}

async function liveKitDeleteRoom(apiKey: string, name: string): Promise<void> {
  const response = await fetch(`${LIVEKIT_API_BASE}/rtc/rooms/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  // 404 means the room was already gone — that's fine.
  if (!response.ok && response.status !== 404) {
    const raw = await response.text().catch(() => "");
    throw new Error(`LiveKit delete room failed (${response.status}): ${raw.slice(0, 200)}`);
  }
}

/**
 * Create a room in a group the caller belongs to, provision it with the
 * video provider, and notify the other group members. Rooms are never
 * standalone — groupId is required.
 */
export const createRoom = action({
  args: {
    groupId: v.id("studyGroups"),
    name: v.string(),
  },
  handler: async (ctx, { groupId, name }): Promise<{ roomId: Id<"studyRooms">; name: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ConvexError({ message: "Room name is required.", code: "invalid" });
    }
    if (trimmed.length > 60) {
      throw new ConvexError({
        message: "Room name is too long (max 60 characters).",
        code: "invalid",
      });
    }
    const group = await ctx.runQuery(internal.studyGroups.getGroupById, { groupId });
    if (!group) {
      throw new ConvexError({ message: "Study group not found.", code: "not_found" });
    }
    await assertGroupMember(ctx, groupId, userId);

    const { apiKey } = requireLiveKitConfig();

    // LiveKit room names are unique per project — timestamp guarantees it.
    const providerRoomId = `nexus-${groupId}-${Date.now()}`;
    try {
      await liveKitCreateRoom(apiKey, providerRoomId);
    } catch (error) {
      throw new ConvexError({
        message: error instanceof Error ? error.message : "Could not create the video room.",
        code: "provider_error",
      });
    }

    const roomId = await ctx.runMutation(internal.rooms.insertRoom, {
      groupId,
      name: trimmed,
      createdBy: userId,
      videoProviderRoomId: providerRoomId,
    });

    // Tell the other members a room is live.
    const memberIds = await ctx.runQuery(internal.studyGroups.listGroupMemberIds, {
      groupId,
    });
    const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
    const creatorName = profile?.displayName ?? "A group member";
    for (const memberId of memberIds) {
      if (memberId === userId) continue;
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: memberId,
        type: "room",
        title: `Room started: ${trimmed}`,
        body: `${creatorName} started a study room in “${group.name}”.`,
        actionUrl: `/rooms/${roomId}`,
      });
    }

    return { roomId, name: trimmed };
  },
});

/**
 * Mint a short-lived provider access token. Every safety check runs BEFORE a
 * token exists: group membership, room active, and block status against every
 * current participant. Non-members can never get a token even with a roomId.
 */
export const getJoinToken = action({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<{ url: string; token: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const room = await ctx.runQuery(internal.rooms.getRoomByIdInternal, { roomId });
    if (!room) {
      throw new ConvexError({ message: "Room not found.", code: "not_found" });
    }
    if (room.status !== "active") {
      throw new ConvexError({
        message: "This room has ended.",
        code: "room_ended",
      });
    }
    await assertGroupMember(ctx, room.groupId, userId);
    await assertNoBlockWithParticipants(ctx, userId, roomId);

    const { url, apiKey, apiSecret } = requireLiveKitConfig();
    const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
    const user = await ctx.runQuery(internal.admin.getUserById, { userId });
    const groupRole = await ctx.runQuery(internal.studyGroups.getGroupRole, {
      groupId: room.groupId,
      userId,
    });
    const roomAdmin = room.createdBy === userId || groupRole === "owner";

    const token = signLiveKitToken(apiKey, apiSecret, {
      identity: userId,
      name: profile?.displayName ?? user?.name ?? "Student",
      room: room.videoProviderRoomId,
      roomAdmin,
    });
    return { url, token };
  },
});

/**
 * End a room for EVERYONE. Only the room creator or a group owner can do it.
 * Deletes the provider room (terminates all participant connections
 * server-side — not just the clicker's UI) and marks the room ended.
 */
export const endRoom = action({
  args: { roomId: v.id("studyRooms") },
  handler: async (ctx, { roomId }): Promise<{ ok: true }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const room = await ctx.runQuery(internal.rooms.getRoomByIdInternal, { roomId });
    if (!room) {
      throw new ConvexError({ message: "Room not found.", code: "not_found" });
    }
    const groupRole = await ctx.runQuery(internal.studyGroups.getGroupRole, {
      groupId: room.groupId,
      userId,
    });
    if (room.createdBy !== userId && groupRole !== "owner") {
      throw new ConvexError({
        message: "Only the room creator or a group owner can end the room for everyone.",
        code: "unauthorized",
      });
    }

    const { apiKey } = requireLiveKitConfig();
    try {
      await liveKitDeleteRoom(apiKey, room.videoProviderRoomId);
    } catch (error) {
      throw new ConvexError({
        message: error instanceof Error ? error.message : "Could not end the video room.",
        code: "provider_error",
      });
    }
    await ctx.runMutation(internal.rooms.markRoomEnded, { roomId });
    return { ok: true };
  },
});
