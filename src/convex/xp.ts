// XP + levels.
//
// XP is written ONLY through internal.xp.awardXp, called from existing
// mutation success paths (quiz completed, focus session, streak day, plan
// week, daily challenge). There is no client-callable way to grant XP — a
// student can only earn it by studying.
//
// Level curve (documented): level n requires 50 * (n-1)^2 total XP, i.e.
//   currentLevel = floor(sqrt(totalXp / 50)) + 1
// Early levels come quickly (level 2 at 50 XP), later ones slow down
// (level 10 at 4050 XP) so progress stays motivating without inflating.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { LEVEL_XP_FACTOR } from "./constants";

/** Total XP required to REACH level n (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  return LEVEL_XP_FACTOR * Math.pow(Math.max(1, level) - 1, 2);
}

/** Level for a given total XP. */
export function levelFromXp(totalXp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, totalXp) / LEVEL_XP_FACTOR)) + 1;
}

// ---------------------------------------------------------------------------
// Internal plumbing
// ---------------------------------------------------------------------------

export const getLevelByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    (await ctx.db
      .query("userLevels")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique()) ?? null,
});

export const getRecentXpByUser = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit = 10 }) =>
    await ctx.db
      .query("xpLedger")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit),
});

/**
 * Award XP for a real study action. Appends to the ledger, updates the
 * denormalized level row, and — when the level ticks over — creates a
 * level-up notification. Returns the delta so callers can surface a
 * celebratory toast (never an interrupting interstitial).
 */
export const awardXp = internalMutation({
  args: {
    userId: v.id("users"),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, { userId, amount, reason }) => {
    const rounded = Math.round(amount);
    if (!Number.isFinite(rounded) || rounded <= 0) {
      return { xpAwarded: 0, totalXp: 0, level: 1, levelUp: false };
    }

    const row = await ctx.db
      .query("userLevels")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const before = row?.totalXp ?? 0;
    const totalXp = before + rounded;
    const level = levelFromXp(totalXp);

    if (row) {
      await ctx.db.patch(row._id, { totalXp, currentLevel: level });
    } else {
      await ctx.db.insert("userLevels", { userId, totalXp, currentLevel: level });
    }
    await ctx.db.insert("xpLedger", {
      userId,
      amount: rounded,
      reason,
      createdAt: Date.now(),
    });

    const levelUp = level > levelFromXp(before);
    if (levelUp) {
      await ctx.runMutation(internal.notifications.createNotification, {
        userId,
        type: "level_up",
        title: `Level up — you're now level ${level}`,
        body: `${totalXp} total XP. The next level needs ${xpForLevel(level + 1)} XP.`,
        actionUrl: "/dashboard",
      });
    }
    return { xpAwarded: rounded, totalXp, level, levelUp };
  },
});

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

/** The student's level state + the last few XP events for a satisfying feed. */
export const getMyLevel = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        totalXp: 0,
        currentLevel: 1,
        xpForNext: xpForLevel(2),
        xpToNext: xpForLevel(2),
        progressToNext: 0,
        recentXp: [],
      };
    }
    const row = await ctx.db
      .query("userLevels")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const totalXp = row?.totalXp ?? 0;
    const currentLevel = row?.currentLevel ?? 1;
    const xpForNext = xpForLevel(currentLevel + 1);
    const xpForCurrent = xpForLevel(currentLevel);
    const recent = await ctx.db
      .query("xpLedger")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(10);

    return {
      totalXp,
      currentLevel,
      xpForNext,
      xpToNext: Math.max(0, xpForNext - totalXp),
      progressToNext:
        xpForNext > xpForCurrent
          ? Math.min(1, Math.max(0, (totalXp - xpForCurrent) / (xpForNext - xpForCurrent)))
          : 1,
      recentXp: recent.map((entry) => ({
        amount: entry.amount,
        reason: entry.reason,
        createdAt: entry.createdAt,
      })),
    };
  },
});

