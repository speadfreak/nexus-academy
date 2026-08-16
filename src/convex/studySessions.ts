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
import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function toDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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

export const logSession = mutation({
  args: {
    subjectId: v.id("subjects"),
    durationSeconds: v.number(),
    startedAt: v.number(),
    endedAt: v.number(),
    localDate: v.string(), // client's local "YYYY-MM-DD"
  },
  handler: async (ctx, args) => {
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

    // --- Streak math -----------------------------------------------------
    const streak = await getOrCreateStreakRow(ctx, userId);
    const today = args.localDate;
    const hours = args.durationSeconds / 3600;

    if (streak.lastStudyDate === today) {
      // Already studied today: keep the streak, just add hours.
      await ctx.db.patch(streak._id, {
        totalHoursStudied: Math.round((streak.totalHoursStudied + hours) * 1000) / 1000,
      });
    } else {
      let current = 0;
      if (streak.lastStudyDate === shiftDateKey(today, -1)) {
        current = streak.currentStreak + 1;
      } else if (streak.lastStudyDate === "") {
        current = 1;
      } else {
        // Gap of a day or more: reset to a fresh streak of 1.
        current = 1;
      }
      await ctx.db.patch(streak._id, {
        currentStreak: current,
        longestStreak: Math.max(streak.longestStreak, current),
        lastStudyDate: today,
        totalHoursStudied: Math.round((streak.totalHoursStudied + hours) * 1000) / 1000,
      });
    }

    return { ok: true };
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
