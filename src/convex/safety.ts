// Student safety — reporting + blocking. Built as core functionality, not a
// future enhancement, because this platform serves students as young as 14.
//
// Rules enforced server-side (never just hidden in the UI):
//   - A blocked user cannot join any room the blocker is in (rooms.ts checks
//     this when minting join tokens).
//   - A blocked user's room messages are not deliverable to the blocker: the
//     send path rejects when a block exists with any current participant, and
//     the read path filters blocked users out per-viewer.
//   - Blocked users are hidden from each other in shared group contexts
//     (group leaderboards, member lists).
// Reports land in a visible, actionable admin Reports queue with enough
// context to act — reporter, reported, reason, room/group — without exposing
// unrelated private data.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdmin } from "./admin";

export const reportReasonValidator = v.union(
  v.literal("harassment"),
  v.literal("inappropriate_content"),
  v.literal("spam"),
  v.literal("other"),
);

export const REPORT_REASON_LABELS: Record<string, string> = {
  harassment: "Harassment or bullying",
  inappropriate_content: "Inappropriate content",
  spam: "Spam or disruptive behavior",
  other: "Something else",
};

type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Internal block lookups (used by rooms.ts, studyGroups.ts, messages)
// ---------------------------------------------------------------------------

/** All users that `userId` has blocked. */
export const getBlockedByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Id<"users">[]> => {
    const rows = await ctx.db
      .query("userBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", userId))
      .take(200);
    return rows.map((row) => row.blockedUserId);
  },
});

/** All users that have blocked `userId`. */
export const getBlockingUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Id<"users">[]> => {
    const rows = await ctx.db
      .query("userBlocks")
      .withIndex("by_blocked", (q) => q.eq("blockedUserId", userId))
      .take(200);
    return rows.map((row) => row.blockerId);
  },
});

/** True when a block exists between the two users in EITHER direction. */
export const hasBlockBetween = internalQuery({
  args: { userAId: v.id("users"), userBId: v.id("users") },
  handler: async (ctx, { userAId, userBId }): Promise<boolean> => {
    const aBlocksB = await ctx.db
      .query("userBlocks")
      .withIndex("by_pair", (q) =>
        q.eq("blockerId", userAId).eq("blockedUserId", userBId),
      )
      .first();
    if (aBlocksB) return true;
    const bBlocksA = await ctx.db
      .query("userBlocks")
      .withIndex("by_pair", (q) =>
        q.eq("blockerId", userBId).eq("blockedUserId", userAId),
      )
      .first();
    return bBlocksA !== null;
  },
});

/**
 * All user ids that are mutually hidden from `viewerId` in shared contexts:
 * users the viewer blocked PLUS users who blocked the viewer.
 */
export const getHiddenUserIds = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Id<"users">[]> => {
    const blocked = await ctx.runQuery(internal.safety.getBlockedByUser, { userId });
    const blocking = await ctx.runQuery(internal.safety.getBlockingUser, { userId });
    return [...new Set([...blocked, ...blocking])];
  },
});

// ---------------------------------------------------------------------------
// Blocking — mutations
// ---------------------------------------------------------------------------

export const blockUser = mutation({
  args: { blockedUserId: v.id("users") },
  handler: async (ctx, { blockedUserId }): Promise<{ ok: true }> => {
    const blockerId = await requireUser(ctx);
    if (blockerId === blockedUserId) {
      throw new ConvexError({ message: "You can't block yourself.", code: "invalid" });
    }
    const target = await ctx.db.get(blockedUserId);
    if (!target) {
      throw new ConvexError({ message: "User not found.", code: "not_found" });
    }
    const existing = await ctx.db
      .query("userBlocks")
      .withIndex("by_pair", (q) =>
        q.eq("blockerId", blockerId).eq("blockedUserId", blockedUserId),
      )
      .first();
    if (!existing) {
      await ctx.db.insert("userBlocks", {
        blockerId,
        blockedUserId,
        createdAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

export const unblockUser = mutation({
  args: { blockedUserId: v.id("users") },
  handler: async (ctx, { blockedUserId }): Promise<{ ok: true }> => {
    const blockerId = await requireUser(ctx);
    const existing = await ctx.db
      .query("userBlocks")
      .withIndex("by_pair", (q) =>
        q.eq("blockerId", blockerId).eq("blockedUserId", blockedUserId),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return { ok: true };
  },
});

/** Users I've blocked, with display names — for the settings/safety UI. */
export const getMyBlocks = query({
  args: {},
  handler: async (ctx): Promise<{ blockedUserId: Id<"users">; name: string; createdAt: number }[]> => {
    const blockerId = await getAuthUserId(ctx);
    if (!blockerId) return [];
    const rows = await ctx.db
      .query("userBlocks")
      .withIndex("by_blocker", (q) => q.eq("blockerId", blockerId))
      .take(200);
    const result: { blockedUserId: Id<"users">; name: string; createdAt: number }[] = [];
    for (const row of rows) {
      const user = await ctx.db.get(row.blockedUserId);
      const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
        userId: row.blockedUserId,
      });
      result.push({
        blockedUserId: row.blockedUserId,
        name: profile?.displayName ?? user?.name ?? "Student",
        createdAt: row.createdAt,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export const reportUser = mutation({
  args: {
    reportedUserId: v.id("users"),
    roomId: v.optional(v.id("studyRooms")),
    reason: reportReasonValidator,
    details: v.optional(v.string()),
  },
  handler: async (ctx, { reportedUserId, roomId, reason, details }): Promise<{ ok: true }> => {
    const reporterId = await requireUser(ctx);
    if (reporterId === reportedUserId) {
      throw new ConvexError({ message: "You can't report yourself.", code: "invalid" });
    }
    const target = await ctx.db.get(reportedUserId);
    if (!target) {
      throw new ConvexError({ message: "User not found.", code: "not_found" });
    }
    const trimmed = (details ?? "").trim();
    if (trimmed.length > 1000) {
      throw new ConvexError({
        message: "Details are too long (max 1,000 characters).",
        code: "invalid",
      });
    }

    await ctx.db.insert("userReports", {
      reporterId,
      reportedUserId,
      roomId,
      reason,
      details: trimmed || undefined,
      status: "open",
      createdAt: Date.now(),
    });

    // Route to moderators: a notification for every admin account.
    const adminIds = await ctx.runQuery(internal.admin.listAdminUserIds, {});
    for (const adminId of adminIds) {
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: adminId,
        type: "safety_report",
        title: "New safety report",
        body: `A student reported someone (${REPORT_REASON_LABELS[reason]}) — review in the admin Reports tab.`,
        actionUrl: "/admin?tab=reports",
      });
    }

    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Admin reports queue
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: DbCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  const user = await ctx.db.get(userId);
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  return user;
}

interface ReportView {
  _id: Id<"userReports">;
  reason: "harassment" | "inappropriate_content" | "spam" | "other";
  details: string | null;
  status: "open" | "reviewed" | "resolved";
  createdAt: number;
  reporter: { userId: Id<"users">; name: string; email: string | null };
  reported: { userId: Id<"users">; name: string; email: string | null };
  reportedGroupMemberships: { groupId: Id<"studyGroups">; name: string }[];
  room: { roomId: Id<"studyRooms">; name: string; status: "active" | "ended" } | null;
  group: { groupId: Id<"studyGroups">; name: string } | null;
}

export const listReports = query({
  args: {},
  handler: async (ctx): Promise<ReportView[]> => {
    await requireAdmin(ctx);
    const reports = await ctx.db
      .query("userReports")
      .order("desc")
      .take(100);

    const userCache = new Map<Id<"users">, Doc<"users"> | null>();
    const profileCache = new Map<Id<"users">, Doc<"userProfiles"> | null>();

    const result: ReportView[] = [];
    for (const report of reports) {
      const loadUser = async (
        userId: Id<"users">,
      ): Promise<{ user: Doc<"users"> | null; profile: Doc<"userProfiles"> | null }> => {
        let user = userCache.get(userId);
        if (user === undefined) {
          user = (await ctx.db.get(userId)) ?? null;
          userCache.set(userId, user);
        }
        let profile = profileCache.get(userId);
        if (profile === undefined) {
          profile = (await ctx.runQuery(internal.profile.getProfileByUser, { userId })) ?? null;
          profileCache.set(userId, profile);
        }
        return { user, profile };
      };
      const reporter = await loadUser(report.reporterId);
      const reported = await loadUser(report.reportedUserId);

      // Room + its group for context (never message contents).
      let room: Doc<"studyRooms"> | null = null;
      let group: Doc<"studyGroups"> | null = null;
      if (report.roomId) {
        room = (await ctx.db.get(report.roomId)) ?? null;
        if (room) {
          group = (await ctx.db.get(room.groupId)) ?? null;
        }
      }

      // Groups the REPORTED user belongs to — context for a moderator
      // deciding severity (e.g. can they contact the right group owner).
      const reportedMemberships = await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_user", (q) => q.eq("userId", report.reportedUserId))
        .take(50);
      const reportedGroups: { groupId: Id<"studyGroups">; name: string }[] = [];
      for (const membership of reportedMemberships) {
        const g = await ctx.db.get(membership.groupId);
        if (g) reportedGroups.push({ groupId: g._id, name: g.name });
      }

      result.push({
        _id: report._id,
        reason: report.reason,
        details: report.details ?? null,
        status: report.status,
        createdAt: report.createdAt,
        reporter: {
          userId: report.reporterId,
          name: reporter.profile?.displayName ?? reporter.user?.name ?? "Student",
          email: reporter.user?.email ?? null,
        },
        reported: {
          userId: report.reportedUserId,
          name: reported.profile?.displayName ?? reported.user?.name ?? "Student",
          email: reported.user?.email ?? null,
        },
        reportedGroupMemberships: reportedGroups,
        room: room
          ? { roomId: room._id, name: room.name, status: room.status }
          : null,
        group: group ? { groupId: group._id, name: group.name } : null,
      });
    }
    return result;
  },
});

export const updateReportStatus = mutation({
  args: {
    reportId: v.id("userReports"),
    status: v.union(v.literal("open"), v.literal("reviewed"), v.literal("resolved")),
  },
  handler: async (ctx, { reportId, status }): Promise<{ ok: true }> => {
    await requireAdmin(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) {
      throw new ConvexError({ message: "Report not found.", code: "not_found" });
    }
    await ctx.db.patch(report._id, { status });
    return { ok: true };
  },
});
