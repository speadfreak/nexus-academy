// Focus-session logging, streak math and study history.
//
// Streak rules (per the spec):
//   - studying again today          -> streak unchanged, hours added
//   - studying the day after a study day -> streak +1
//   - studying after a gap          -> streak resets to 1
//   - longest streak tracks the max ever reached
//
// The client passes its local "YYYY-MM-DD" date so the streak follows the
// student's own calendar day, not the server's timezone.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { XP_VALUES } from "./constants";

function shiftDateKey(key: string, deltaDays: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

/** Fetch (or lazily create) the streak row for a user. */
async function getOrCreateStreakRow(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  let row = await ctx.db
    .query("studyStreaks")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row) {
    const id = await ctx.db.insert("studyStreaks", {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastStudyDate: "",
      totalHoursStudied: 0,
    });
    row = await ctx.db.get(id);
  }
  return row!;
}

export interface LogSessionResult {
  ok: true;
  xpAwarded: number;
  levelUp: boolean;
  newLevel: number;
  newAchievements: { id: string; name: string; tier: "bronze" | "silver" | "gold" }[];
}

export const logSession = mutation({
  args: {
    subjectId: v.id("subjects"),
    durationSeconds: v.number(),
    startedAt: v.number(),
    endedAt: v.number(),
    localDate: v.string(), // client's local "YYYY-MM-DD"
  },
  handler: async (ctx, args): Promise<LogSessionResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    if (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0) {
      throw new ConvexError({ message: "Session duration must be positive.", code: "invalid" });
    }
    // Sanity cap (~12h) so a buggy client can't inflate hours.
    if (args.durationSeconds > 12 * 60 * 60) {
      throw new ConvexError({ message: "Session duration exceeds the 12h limit.", code: "invalid" });
    }
    if (args.endedAt < args.startedAt) {
      throw new ConvexError({ message: "Session ended before it started.", code: "invalid" });
    }
    const subject = await ctx.db.get(args.subjectId);
    if (!subject) {
      throw new ConvexError({ message: "Subject not found.", code: "invalid" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.localDate)) {
      throw new ConvexError({ message: "Invalid date format.", code: "invalid" });
    }

    await ctx.db.insert("studySessions", {
      userId,
      subjectId: args.subjectId,
      durationSeconds: args.durationSeconds,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
    });

    // Streak math lives in the shared internal mutation so the daily
    // challenge can contribute to the streak exactly like a study session.
    await ctx.runMutation(internal.studySessions.recordStudyDay, {
      userId,
      localDate: args.localDate,
      hours: args.durationSeconds / 3600,
    });

    // Real focus time earns XP (sessions under the threshold earn nothing —
    // the habit itself is its own reward, but XP tracks deep work).
    let xpAwarded = 0;
    let levelUp = false;
    let newLevel = 1;
    if (args.durationSeconds >= XP_VALUES.focus_session_min_minutes * 60) {
      const award = await ctx.runMutation(internal.xp.awardXp, {
        userId,
        amount: XP_VALUES.focus_session,
        reason: "focus_session",
      });
      xpAwarded = award.xpAwarded;
      levelUp = award.levelUp;
      newLevel = award.level;
    }

    // Idempotent achievement sweep (first session, streaks, subject hours,
    // full-coverage week). Never punishes a broken streak — it just resets.
    const newly = await ctx.runMutation(internal.achievements.checkAndAward, { userId });

    return {
      ok: true,
      xpAwarded,
      levelUp,
      newLevel,
      newAchievements: newly.map((a) => ({
        id: a.id,
        name: a.name,
        tier: a.tier,
      })),
    };
  },
});

/**
 * Shared streak math, callable from logSession and the daily challenge.
 * Records a study day (hours can be 0 — a completed daily challenge keeps
 * the habit alive the same way a focus session does), extends the streak on
 * consecutive days, resets to 1 after a gap (never penalizes beyond the
 * reset — no XP loss, no shaming copy), and awards the streak-day XP.
 */
export interface StudyDayResult {
  newDayRecorded: boolean;
  currentStreak: number;
  totalHoursStudied: number;
}

export const recordStudyDay = internalMutation({
  args: {
    userId: v.id("users"),
    localDate: v.string(), // "YYYY-MM-DD"
    hours: v.number(),
  },
  handler: async (ctx, { userId, localDate, hours }): Promise<StudyDayResult> => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      throw new ConvexError({ message: "Invalid date format.", code: "invalid" });
    }
    const streak = await getOrCreateStreakRow(ctx, userId);
    const h = Math.max(0, hours);
    let newDayRecorded = false;

    if (streak.lastStudyDate === localDate) {
      // Already recorded today: keep the streak, just add hours.
      await ctx.db.patch(streak._id, {
        totalHoursStudied: Math.round((streak.totalHoursStudied + h) * 1000) / 1000,
      });
    } else {
      let current = 0;
      if (streak.lastStudyDate === shiftDateKey(localDate, -1)) {
        current = streak.currentStreak + 1;
      } else if (streak.lastStudyDate === "") {
        current = 1;
      } else {
        // Gap of a day or more: reset to a fresh streak of 1. The counter
        // resets — nothing else. No XP penalty, no lost achievements.
        current = 1;
      }
      await ctx.db.patch(streak._id, {
        currentStreak: current,
        longestStreak: Math.max(streak.longestStreak, current),
        lastStudyDate: localDate,
        totalHoursStudied: Math.round((streak.totalHoursStudied + h) * 1000) / 1000,
      });
      newDayRecorded = true;
      // Habit day earned — awarded once per day via the lastStudyDate guard.
      await ctx.runMutation(internal.xp.awardXp, {
        userId,
        amount: XP_VALUES.streak_day,
        reason: "streak_day",
      });
    }

    const updated = await ctx.db.get(streak._id);
    return {
      newDayRecorded,
      currentStreak: updated?.currentStreak ?? streak.currentStreak,
      totalHoursStudied: updated?.totalHoursStudied ?? streak.totalHoursStudied,
    };
  },
});

export const getStreak = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        currentStreak: 0,
        longestStreak: 0,
        lastStudyDate: "",
        totalHoursStudied: 0,
      };
    }
    const row = await ctx.db
      .query("studyStreaks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return (
      row ?? {
        currentStreak: 0,
        longestStreak: 0,
        lastStudyDate: "",
        totalHoursStudied: 0,
      }
    );
  },
});

export const getRecentSessions = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit ?? 30);

    const results = [];
    for (const session of sessions) {
      const subject = await ctx.db.get(session.subjectId);
      results.push({
        _id: session._id,
        subjectId: session.subjectId,
        subjectName: subject?.name ?? "Unknown",
        durationSeconds: session.durationSeconds,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
      });
    }
    return results;
  },
});

/** Hours and session counts per subject, most-studied first. */
export const getHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(500);

    const perSubject = new Map<
      Id<"subjects">,
      { seconds: number; count: number }
    >();
    for (const session of sessions) {
      const entry = perSubject.get(session.subjectId) ?? { seconds: 0, count: 0 };
      entry.seconds += session.durationSeconds;
      entry.count += 1;
      perSubject.set(session.subjectId, entry);
    }

    const result = [];
    for (const [subjectId, entry] of perSubject) {
      const subject = await ctx.db.get(subjectId);
      result.push({
        subjectId,
        subjectName: subject?.name ?? "Unknown",
        subjectSlug: subject?.slug ?? "",
        subjectStream: subject?.stream ?? "common",
        seconds: entry.seconds,
        hours: Math.round((entry.seconds / 3600) * 10) / 10,
        count: entry.count,
      });
    }
    return result.sort((a, b) => b.seconds - a.seconds);
  },
});

/**
 * Activity for a rolling set of days, for the dashboard's 7-day strip.
 * The client passes explicit local-day windows so the bars line up with the
 * student's own calendar.
 */
export const getWeekActivity = query({
  args: {
    days: v.array(
      v.object({
        date: v.string(),
        startMs: v.number(),
        endMs: v.number(),
      }),
    ),
  },
  handler: async (ctx, { days }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const total = days.length;
    if (total === 0) return [];

    const minStart = Math.min(...days.map((d) => d.startMs));
    const maxEnd = Math.max(...days.map((d) => d.endMs));

    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) =>
        q.and(
          q.gte(q.field("startedAt"), minStart),
          q.lte(q.field("startedAt"), maxEnd),
        ),
      )
      .collect();

    return days.map((day) => {
      let seconds = 0;
      for (const session of sessions) {
        if (session.startedAt >= day.startMs && session.startedAt < day.endMs) {
          seconds += session.durationSeconds;
        }
      }
      return {
        date: day.date,
        seconds,
        hours: Math.round((seconds / 3600) * 100) / 100,
      };
    });
  },
});
