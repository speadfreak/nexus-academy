// Study groups — the opt-in social layer.
//
// Privacy rules (by design):
//   - Groups are ONLY reachable via a shared invite code from a friend. There
//     is no global leaderboard, no public profile discovery, nothing visible
//     to strangers.
//   - The weekly leaderboard is scoped to group members only and ranks a
//     single aggregate metric (XP earned this week). XP is chosen over hours
//     because it already aggregates every study action — quiz, focus, plan
//     weeks, daily challenges — into one honest number. Exactly what a member
//     got wrong on a quiz, or their weak topics, is never exposed.
//   - Groups are capped at GROUP_MAX_SIZE so they stay a real friend/class
//     group, not a public arena.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { GROUP_MAX_SIZE } from "./constants";

type DbCtx = MutationCtx | QueryCtx;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const CODE_LENGTH = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]!;
  }
  return code;
}

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createGroup = mutation({
  args: {
    name: v.string(),
    subjectFocus: v.optional(v.id("subjects")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const name = args.name.trim();
    if (!name) {
      throw new ConvexError({ message: "Group name is required.", code: "invalid" });
    }
    if (name.length > 60) {
      throw new ConvexError({ message: "Group name is too long (max 60 characters).", code: "invalid" });
    }
    if (args.subjectFocus) {
      const subject = await ctx.db.get(args.subjectFocus);
      if (!subject) {
        throw new ConvexError({ message: "Subject not found.", code: "invalid" });
      }
    }

    let inviteCode = generateInviteCode();
    for (let attempt = 0; attempt < 5; attempt++) {
      const existing = await ctx.db
        .query("studyGroups")
        .withIndex("by_inviteCode", (q) => q.eq("inviteCode", inviteCode))
        .unique();
      if (!existing) break;
      inviteCode = generateInviteCode();
    }

    const groupId = await ctx.db.insert("studyGroups", {
      name,
      createdBy: userId,
      inviteCode,
      subjectFocus: args.subjectFocus,
      createdAt: Date.now(),
    });
    await ctx.db.insert("studyGroupMembers", {
      groupId,
      userId,
      joinedAt: Date.now(),
      role: "owner",
    });

    const subject = args.subjectFocus ? await ctx.db.get(args.subjectFocus) : null;
    return {
      groupId,
      inviteCode,
      name,
      subjectFocusName: subject?.name ?? null,
      memberCount: 1,
    };
  },
});

export const joinGroup = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      throw new ConvexError({ message: "Enter an invite code.", code: "invalid" });
    }
    const group = await ctx.db
      .query("studyGroups")
      .withIndex("by_inviteCode", (q) => q.eq("inviteCode", code))
      .unique();
    if (!group) {
      throw new ConvexError({
        message: "That invite code doesn't match any group. Double-check it with your friend.",
        code: "not_found",
      });
    }

    const existing = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();
    if (existing) {
      throw new ConvexError({ message: "You're already in this group.", code: "invalid" });
    }

    const memberCount = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", group._id))
      .collect();
    if (memberCount.length >= GROUP_MAX_SIZE) {
      throw new ConvexError({
        message: `This group is full (max ${GROUP_MAX_SIZE} members).`,
        code: "invalid",
      });
    }

    await ctx.db.insert("studyGroupMembers", {
      groupId: group._id,
      userId,
      joinedAt: Date.now(),
      role: "member",
    });

    // Tell the creator someone joined — a real, useful notification.
    const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
    const displayName = profile?.displayName ?? "A student";
    await ctx.runMutation(internal.notifications.createNotification, {
      userId: group.createdBy,
      type: "group",
      title: "New group member",
      body: `${displayName} joined “${group.name}”.`,
      actionUrl: "/groups",
    });

    // group_first achievement (idempotent).
    await ctx.runMutation(internal.achievements.checkAndAward, { userId });

    const subject = group.subjectFocus ? await ctx.db.get(group.subjectFocus) : null;
    return {
      groupId: group._id,
      name: group.name,
      inviteCode: group.inviteCode,
      subjectFocusName: subject?.name ?? null,
      memberCount: memberCount.length + 1,
    };
  },
});

export const leaveGroup = mutation({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const membership = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();
    if (!membership) {
      throw new ConvexError({ message: "You're not in this group.", code: "not_found" });
    }

    const group = await ctx.db.get(groupId);
    await ctx.db.delete(membership._id);

    if (membership.role === "owner") {
      const others = await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .order("asc")
        .collect();
      if (others.length === 0) {
        if (group) await ctx.db.delete(group._id);
      } else {
        // Transfer ownership to the earliest-joined remaining member.
        await ctx.db.patch(others[0]!._id, { role: "owner" });
      }
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getMyGroups = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const memberships = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const result = [];
    for (const membership of memberships) {
      const group = await ctx.db.get(membership.groupId);
      if (!group) continue;
      const members = await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", group._id))
        .collect();
      const subject = group.subjectFocus ? await ctx.db.get(group.subjectFocus) : null;
      result.push({
        groupId: group._id,
        name: group.name,
        inviteCode: group.inviteCode,
        subjectFocusName: subject?.name ?? null,
        memberCount: members.length,
        role: membership.role,
        createdAt: group.createdAt,
      });
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * Weekly leaderboard for ONE group, visible ONLY to its members. Ranks by XP
 * earned in the last 7 days (aggregate, honest, covers all study actions) and
 * also returns each member's weekly hours + session count for the activity
 * feed. Never exposes quiz answers, weak topics, or anything beyond these
 * aggregates.
 */
type LeaderboardMember = {
  userId: Id<"users">;
  name: string;
  role: "owner" | "member";
  joinedAt: number;
  xpThisWeek: number;
  hoursThisWeek: number;
  sessionsThisWeek: number;
  isMe: boolean;
};

type GroupLeaderboardView = {
  groupId: Id<"studyGroups">;
  name: string;
  inviteCode: string;
  subjectFocusName: string | null;
  memberCount: number;
  myRole: "owner" | "member";
  members: LeaderboardMember[];
};

export const getGroupLeaderboard = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }): Promise<GroupLeaderboardView | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const group = await ctx.db.get(groupId);
    if (!group) return null;

    const myMembership = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .first();
    if (!myMembership) return null; // members only — never global

    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("asc")
      .collect();
    const subject = group.subjectFocus ? await ctx.db.get(group.subjectFocus) : null;
    const weekStart = Date.now() - WEEK_MS;

    const ranked: LeaderboardMember[] = [];
    for (const member of members) {
      const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
        userId: member.userId,
      });
      const user = await ctx.db.get(member.userId);

      const xpRows = await ctx.db
        .query("xpLedger")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", member.userId))
        .filter((q) => q.gte(q.field("createdAt"), weekStart))
        .take(500);
      const xpThisWeek = xpRows.reduce((sum, row) => sum + row.amount, 0);

      const sessions = await ctx.db
        .query("studySessions")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .filter((q) => q.gte(q.field("startedAt"), weekStart))
        .take(500);
      const hoursThisWeek = Math.round((sessions.reduce((sum, s) => sum + s.durationSeconds, 0) / 3600) * 10) / 10;

      ranked.push({
        userId: member.userId,
        name: profile?.displayName ?? user?.name ?? "Student",
        role: member.role,
        joinedAt: member.joinedAt,
        xpThisWeek,
        hoursThisWeek,
        sessionsThisWeek: sessions.length,
        isMe: member.userId === userId,
      });
    }
    ranked.sort((a, b) => b.xpThisWeek - a.xpThisWeek);

    return {
      groupId,
      name: group.name,
      inviteCode: group.inviteCode,
      subjectFocusName: subject?.name ?? null,
      memberCount: members.length,
      myRole: myMembership.role,
      members: ranked,
    };
  },
});
