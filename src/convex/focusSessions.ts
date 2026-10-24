// LEARNYX FLOWSTATE — server-aware focus session engine.
//
// WHY THIS EXISTS: the old Focus timer lived entirely in the browser
// (setInterval + a ref flag). A refresh lost the session, a second tab
// duplicated it, and the server had no choice but to trust whatever
// duration the client claimed. FLOWSTATE moves the source of truth to the
// server:
//
//   - startedAt / endsAt use the SERVER clock. The client derives remaining
//     time from those stamps plus a measured clock offset — a reload, a
//     backgrounded tab or a second device reconstruct the identical timer.
//   - Pauses are recorded server-side (pausedAt + pausedTotalMs), so paused
//     time never counts as studied time.
//   - Completion is decided against the server clock with a small jitter
//     tolerance; an early finish is recorded honestly as "abandoned"
//     (partial minutes count toward hours and streaks, but never award
//     completion XP or count as a completed session).
//   - Exactly-once: finish is a one-shot status transition, and the
//     minutes row it writes into studySessions carries a dedupeKey
//     ("focus:<id>") so even a replayed write cannot double-count.
//   - One active session per user: starting a new session finalizes the
//     previous one first (cross-device conflict rule — nothing is lost,
//     nothing is double-counted).
//
// MISSION LINKS (Phase 6): a session may reference canonical existing ids
// (task, plan week, topic, mistake, matric session, content item). Linking
// NEVER awards mastery or auto-completes the linked object — it records
// provenance so analytics can show where time actually went.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { XP_VALUES } from "./constants";

/** Server-clock tolerance when deciding whether the planned time has elapsed. */
const FINISH_TOLERANCE_MS = 3_000;
/** Grace period before the sweeper auto-completes an abandoned-by-time session. */
const SWEEP_GRACE_MS = 60_000;
const MAX_PLANNED_SECONDS = 4 * 60 * 60; // 4h hard cap
const MIN_PLANNED_SECONDS = 60;

export interface FocusSessionSnapshot {
  focusSessionId: string;
  mode: Doc<"focusSessions">["mode"];
  plannedSeconds: number;
  breakSeconds?: number;
  startedAt: number;
  endsAt: number;
  status: Doc<"focusSessions">["status"];
  pausedAt?: number;
  pausedTotalMs: number;
  serverNow: number;
  subjectId?: string;
  topicId?: string;
  taskId?: string;
  planId?: string;
  planWeek?: number;
  mistakeId?: string;
  matricSessionId?: string;
  contentId?: string;
  missionLabel?: string;
  reflection?: string;
  distractions?: number;
}

function snapshot(doc: Doc<"focusSessions">, serverNow: number): FocusSessionSnapshot {
  return {
    focusSessionId: doc._id,
    mode: doc.mode,
    plannedSeconds: doc.plannedSeconds,
    breakSeconds: doc.breakSeconds,
    startedAt: doc.startedAt,
    endsAt: doc.endsAt,
    status: doc.status,
    pausedAt: doc.pausedAt,
    pausedTotalMs: doc.pausedTotalMs,
    serverNow,
    subjectId: doc.subjectId,
    topicId: doc.topicId,
    taskId: doc.taskId,
    planId: doc.planId,
    planWeek: doc.planWeek,
    mistakeId: doc.mistakeId,
    matricSessionId: doc.matricSessionId,
    contentId: doc.contentId,
    missionLabel: doc.missionLabel,
    reflection: doc.reflection,
    distractions: doc.distractions,
  };
}

/** Elapsed studied milliseconds at time `now`, excluding paused time. */
export function elapsedMsOf(doc: Pick<Doc<"focusSessions">, "startedAt" | "pausedAt" | "pausedTotalMs">, now: number): number {
  const reference = doc.pausedAt ?? now;
  return Math.max(0, reference - doc.startedAt - doc.pausedTotalMs);
}

/** Remaining milliseconds at time `now` (frozen while paused). */
export function remainingMsOf(doc: Pick<Doc<"focusSessions">, "plannedSeconds" | "startedAt" | "pausedAt" | "pausedTotalMs">, now: number): number {
  return Math.max(0, doc.plannedSeconds * 1000 - elapsedMsOf(doc, now));
}

async function requireUser(ctx: MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

async function getOwnedSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  focusSessionId: Id<"focusSessions">,
): Promise<Doc<"focusSessions">> {
  const session = await ctx.db.get(focusSessionId);
  if (!session || session.userId !== userId) {
    throw new ConvexError({ message: "Focus session not found.", code: "not_found" });
  }
  return session;
}

/** UTC "YYYY-MM-DD" fallback when the client hasn't supplied a local date. */
function utcDateKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface FinalizeResult {
  status: "completed" | "abandoned";
  completedSeconds: number;
  plannedSeconds: number;
  xpAwarded: number;
  levelUp: boolean;
  newLevel: number;
  alreadyDone: boolean;
  endReason?: string;
  newAchievements: { id: string; name: string; tier: string }[];
}

// ── Finalization (shared by finish, new-start conflict and the sweeper) ──

async function finalizeSession(
  ctx: MutationCtx,
  userId: Id<"users">,
  session: Doc<"focusSessions">,
  endReason: "timer" | "user" | "new_session" | "sweeper",
  localDate: string | undefined,
): Promise<FinalizeResult> {
  // One-shot guard: completion is a status transition, so a replayed call
  // (network retry, double-click, sweeper race) returns the prior result.
  if (session.status !== "active") {
    return {
      status: session.status === "completed" ? "completed" : "abandoned",
      completedSeconds: session.completedSeconds ?? 0,
      plannedSeconds: session.plannedSeconds,
      xpAwarded: 0,
      levelUp: false,
      newLevel: 1,
      alreadyDone: true,
      endReason: session.endReason,
      newAchievements: [],
    };
  }

  const now = Date.now();
  const elapsed = elapsedMsOf(session, now);
  const completedSeconds = Math.max(0, Math.min(session.plannedSeconds, Math.floor(elapsed / 1000)));
  // "Completed" means the server clock reached the planned end (small
  // tolerance for clock jitter). Anything else is an honest partial.
  const reachedEnd = now >= session.endsAt - FINISH_TOLERANCE_MS;
  const status: "completed" | "abandoned" = reachedEnd ? "completed" : "abandoned";

  // Minutes row — exactly-once via dedupeKey. XP is awarded separately below
  // (xpAmount 0 here) so there is exactly one XP decision per session.
  let studySessionId: Id<"studySessions"> | undefined;
  if (session.subjectId && completedSeconds > 0) {
    const written = await ctx.runMutation(internal.studySessions.logSessionFromAction, {
      userId,
      subjectId: session.subjectId,
      durationSeconds: completedSeconds,
      startedAt: session.startedAt,
      endedAt: now,
      localDate: localDate ?? utcDateKey(now),
      dedupeKey: `focus:${session._id}`,
      xpAmount: 0,
    });
    if (written.ok) {
      const row = await ctx.db
        .query("studySessions")
        .withIndex("by_user_dedupe", (q) => q.eq("userId", userId).eq("dedupeKey", `focus:${session._id}`))
        .first();
      studySessionId = row?._id;
    }
  }

  // Completion XP — exactly once (the status transition above guarantees
  // single execution), and only for genuinely completed sessions of
  // meaningful length. Abandoned sessions keep their minutes but earn no XP.
  let xpAwarded = 0;
  let levelUp = false;
  let newLevel = 1;
  if (status === "completed" && completedSeconds >= XP_VALUES.focus_session_min_minutes * 60) {
    const award = await ctx.runMutation(internal.xp.awardXp, {
      userId,
      amount: XP_VALUES.focus_session,
      reason: "focus_session",
    });
    xpAwarded = award.xpAwarded;
    levelUp = award.levelUp;
    newLevel = award.level;
  }

  await ctx.db.patch(session._id, {
    status,
    completedAt: now,
    completedSeconds,
    endReason,
    pausedAt: undefined,
    studySessionId,
  });

  // Idempotent achievement sweep (first session, hours milestones...).
  const newly = await ctx.runMutation(internal.achievements.checkAndAward, { userId });

  return {
    status,
    completedSeconds,
    plannedSeconds: session.plannedSeconds,
    xpAwarded,
    levelUp,
    newLevel,
    alreadyDone: false,
    endReason,
    newAchievements: newly.map((a) => ({ id: a.id, name: a.name, tier: a.tier })),
  };
}

// ── Start ────────────────────────────────────────────────────────────────

export const start = mutation({
  args: {
    mode: v.union(
      v.literal("sprint"),
      v.literal("pomodoro"),
      v.literal("deep_work"),
      v.literal("custom"),
    ),
    plannedSeconds: v.number(),
    breakSeconds: v.optional(v.number()),
    clientSessionId: v.string(),
    localDate: v.optional(v.string()),
    subjectId: v.optional(v.id("subjects")),
    topicId: v.optional(v.id("topics")),
    taskId: v.optional(v.id("todos")),
    planId: v.optional(v.id("studyPlans")),
    planWeek: v.optional(v.number()),
    mistakeId: v.optional(v.id("mistakes")),
    matricSessionId: v.optional(v.id("matricSessions")),
    contentId: v.optional(v.id("contentItems")),
    missionLabel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);

    if (
      !Number.isFinite(args.plannedSeconds) ||
      args.plannedSeconds < MIN_PLANNED_SECONDS ||
      args.plannedSeconds > MAX_PLANNED_SECONDS
    ) {
      throw new ConvexError({ message: "Session length must be between 1 minute and 4 hours.", code: "invalid" });
    }
    if (args.breakSeconds !== undefined && (args.breakSeconds < 0 || args.breakSeconds > 1800)) {
      throw new ConvexError({ message: "Break length must be between 0 and 30 minutes.", code: "invalid" });
    }
    if (!args.clientSessionId || args.clientSessionId.length > 64) {
      throw new ConvexError({ message: "Invalid session id.", code: "invalid" });
    }
    if (args.localDate && !/^\d{4}-\d{2}-\d{2}$/.test(args.localDate)) {
      throw new ConvexError({ message: "Invalid date format.", code: "invalid" });
    }

    // Idempotent start: the same clientSessionId returns the same session
    // (e.g. a start click retried after a flaky connection).
    const prior = await ctx.db
      .query("focusSessions")
      .withIndex("by_user_client", (q) => q.eq("userId", userId).eq("clientSessionId", args.clientSessionId))
      .first();
    if (prior && prior.status === "active") {
      return { session: snapshot(prior, Date.now()), replaced: null as FinalizeResult | null };
    }

    // Ownership validation for every mission link — never trust client ids.
    if (args.taskId) {
      const task = await ctx.db.get(args.taskId);
      if (!task || task.userId !== userId) {
        throw new ConvexError({ message: "Task not found.", code: "not_found" });
      }
    }
    if (args.planId) {
      const plan = await ctx.db.get(args.planId);
      if (!plan || plan.userId !== userId) {
        throw new ConvexError({ message: "Study plan not found.", code: "not_found" });
      }
    }
    if (args.mistakeId) {
      const mistake = await ctx.db.get(args.mistakeId);
      if (!mistake || mistake.userId !== userId) {
        throw new ConvexError({ message: "Mistake not found.", code: "not_found" });
      }
    }
    if (args.matricSessionId) {
      const matric = await ctx.db.get(args.matricSessionId);
      if (!matric || matric.userId !== userId) {
        throw new ConvexError({ message: "Exam session not found.", code: "not_found" });
      }
    }
    if (args.subjectId) {
      const subject = await ctx.db.get(args.subjectId);
      if (!subject) throw new ConvexError({ message: "Subject not found.", code: "not_found" });
    }
    if (args.topicId) {
      const topic = await ctx.db.get(args.topicId);
      if (!topic) throw new ConvexError({ message: "Topic not found.", code: "not_found" });
    }
    if (args.contentId) {
      const content = await ctx.db.get(args.contentId);
      if (!content) throw new ConvexError({ message: "Content not found.", code: "not_found" });
    }

    // Cross-device conflict rule: exactly one active session per user. The
    // previous active session is finalized HONESTLY (partial minutes kept,
    // no completion XP) before the new one begins — nothing is lost and
    // nothing is double-counted.
    let replaced: FinalizeResult | null = null;
    const stale = await ctx.db
      .query("focusSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .collect();
    for (const old of stale) {
      replaced = await finalizeSession(ctx, userId, old, "new_session", args.localDate);
    }

    const startedAt = Date.now();
    const id = await ctx.db.insert("focusSessions", {
      userId,
      mode: args.mode,
      plannedSeconds: Math.floor(args.plannedSeconds),
      breakSeconds: args.breakSeconds !== undefined ? Math.floor(args.breakSeconds) : undefined,
      startedAt,
      endsAt: startedAt + Math.floor(args.plannedSeconds) * 1000,
      status: "active",
      pausedTotalMs: 0,
      subjectId: args.subjectId,
      topicId: args.topicId,
      taskId: args.taskId,
      planId: args.planId,
      planWeek: args.planWeek,
      mistakeId: args.mistakeId,
      matricSessionId: args.matricSessionId,
      contentId: args.contentId,
      missionLabel: args.missionLabel?.slice(0, 160),
      clientSessionId: args.clientSessionId,
    });
    const doc = await ctx.db.get(id);
    return {
      session: doc ? snapshot(doc, Date.now()) : null,
      replaced,
    };
  },
});

// ── Pause / resume ───────────────────────────────────────────────────────

export const pause = mutation({
  args: { focusSessionId: v.id("focusSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await getOwnedSession(ctx, userId, args.focusSessionId);
    if (session.status !== "active" || session.pausedAt) {
      return { session: snapshot(session, Date.now()) };
    }
    await ctx.db.patch(session._id, { pausedAt: Date.now() });
    const doc = await ctx.db.get(session._id);
    return { session: doc ? snapshot(doc, Date.now()) : null };
  },
});

export const resume = mutation({
  args: { focusSessionId: v.id("focusSessions") },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await getOwnedSession(ctx, userId, args.focusSessionId);
    if (session.status !== "active" || !session.pausedAt) {
      return { session: snapshot(session, Date.now()) };
    }
    const pausedMs = Math.max(0, Date.now() - session.pausedAt);
    await ctx.db.patch(session._id, {
      pausedAt: undefined,
      pausedTotalMs: session.pausedTotalMs + pausedMs,
    });
    const doc = await ctx.db.get(session._id);
    return { session: doc ? snapshot(doc, Date.now()) : null };
  },
});

// ── Finish (timer rang) / abandon (student ended early) ──────────────────

export const finish = mutation({
  args: {
    focusSessionId: v.id("focusSessions"),
    localDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await getOwnedSession(ctx, userId, args.focusSessionId);
    return finalizeSession(ctx, userId, session, "timer", args.localDate);
  },
});

/** Explicit "end early" — same honest partial recording, "user" reason. */
export const abandon = mutation({
  args: {
    focusSessionId: v.id("focusSessions"),
    localDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await getOwnedSession(ctx, userId, args.focusSessionId);
    return finalizeSession(ctx, userId, session, "user", args.localDate);
  },
});

// ── Reflection (optional, one tap) ───────────────────────────────────────

export const addReflection = mutation({
  args: {
    focusSessionId: v.id("focusSessions"),
    reflection: v.union(v.literal("deep"), v.literal("solid"), v.literal("distracted")),
    distractions: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const session = await ctx.db.get(args.focusSessionId);
    if (!session || session.userId !== userId) {
      throw new ConvexError({ message: "Focus session not found.", code: "not_found" });
    }
    await ctx.db.patch(session._id, {
      reflection: args.reflection,
      distractions:
        args.distractions !== undefined
          ? Math.max(0, Math.min(99, Math.floor(args.distractions)))
          : undefined,
    });
    return { ok: true };
  },
});

// ── Reload recovery & clock sync ─────────────────────────────────────────

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = await ctx.db
      .query("focusSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .first();
    if (!session) return null;
    const now = Date.now();
    return {
      session: snapshot(session, now),
      remainingMs: remainingMsOf(session, now),
      elapsedMs: elapsedMsOf(session, now),
    };
  },
});

// ── Sweeper: auto-complete sessions whose time expired ───────────────────

export const expireStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("focusSessions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    let swept = 0;
    for (const session of stale) {
      // The planned end must have passed with grace. Paused sessions are
      // swept only once their EFFECTIVE end (end + paused time) has passed.
      const effectiveEnd = session.endsAt + session.pausedTotalMs;
      if (now < effectiveEnd + SWEEP_GRACE_MS) continue;
      await finalizeSession(ctx, session.userId, session, "sweeper", undefined);
      swept += 1;
    }
    return { swept };
  },
});

// ── Focus intelligence (Phase 8) — aggregates from REAL session data ────

export interface FocusOverview {
  dailySeconds: { date: string; seconds: number }[];
  subjectDist: { subjectId: string; subjectName: string; seconds: number; sessions: number }[];
  missions: {
    completed: number;
    abandoned: number;
    totalCompletedSeconds: number;
    avgCompletedSeconds: number;
    reflected: number;
    avgDistractions: number | null;
    byMode: Record<string, number>;
  };
  totals: {
    totalMinutes: number; // from the maintained hours aggregate
    scannedSessions: number;
  };
}

export const getOverview = query({
  args: {
    // Client-computed LOCAL day windows (same convention as
    // studySessions.getWeekActivity): heatmap day boundaries follow the
    // student's calendar, not the server's UTC clock.
    days: v.array(v.object({ date: v.string(), startMs: v.number(), endMs: v.number() })),
    subjectDays: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<FocusOverview> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        dailySeconds: args.days.map((d) => ({ date: d.date, seconds: 0 })),
        subjectDist: [],
        missions: {
          completed: 0,
          abandoned: 0,
          totalCompletedSeconds: 0,
          avgCompletedSeconds: 0,
          reflected: 0,
          avgDistractions: null,
          byMode: {},
        },
        totals: { totalMinutes: 0, scannedSessions: 0 },
      };
    }

    const now = Date.now();
    const windowStart = args.days.length ? Math.min(...args.days.map((d) => d.startMs)) : now - 84 * 86400000;
    const subjectWindowMs = (args.subjectDays ?? 30) * 86400000;

    // Single ordered scan of the canonical minutes table.
    const rows = await ctx.db
      .query("studySessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId).gte("startedAt", windowStart))
      .collect();

    const daySeconds = new Map<string, number>(args.days.map((d) => [d.date, 0]));
    const subjectAgg = new Map<string, { name: string; seconds: number; sessions: number }>();
    let scanned = 0;

    for (const row of rows) {
      scanned += 1;
      // Heatmap: bucket by the client-supplied local window containing it.
      for (const day of args.days) {
        if (row.startedAt >= day.startMs && row.startedAt < day.endMs) {
          daySeconds.set(day.date, (daySeconds.get(day.date) ?? 0) + row.durationSeconds);
          break;
        }
      }
      // Subject distribution window.
      if (row.startedAt >= now - subjectWindowMs) {
        const subject = await ctx.db.get(row.subjectId);
        const name = subject?.name ?? "Study";
        const entry = subjectAgg.get(row.subjectId) ?? { name, seconds: 0, sessions: 0 };
        entry.seconds += row.durationSeconds;
        entry.sessions += 1;
        subjectAgg.set(row.subjectId, entry);
      }
    }

    // Mission stats from FLOWSTATE sessions (last 90 days).
    const missionRows = await ctx.db
      .query("focusSessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId).gte("startedAt", now - 90 * 86400000))
      .collect();
    let completed = 0;
    let abandoned = 0;
    let totalCompletedSeconds = 0;
    let reflected = 0;
    let distractionSum = 0;
    let distractionCount = 0;
    const byMode: Record<string, number> = {};
    for (const m of missionRows) {
      if (m.status === "completed") {
        completed += 1;
        totalCompletedSeconds += m.completedSeconds ?? 0;
        byMode[m.mode] = (byMode[m.mode] ?? 0) + 1;
      } else if (m.status === "abandoned" || m.status === "expired") {
        abandoned += 1;
      }
      if (m.reflection) {
        reflected += 1;
        if (typeof m.distractions === "number") {
          distractionSum += m.distractions;
          distractionCount += 1;
        }
      }
    }

    const streakRow = await ctx.db
      .query("studyStreaks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const subjectDist = Array.from(subjectAgg.entries())
      .map(([subjectId, e]) => ({ subjectId, subjectName: e.name, seconds: e.seconds, sessions: e.sessions }))
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 8);

    return {
      dailySeconds: args.days.map((d) => ({ date: d.date, seconds: daySeconds.get(d.date) ?? 0 })),
      subjectDist,
      missions: {
        completed,
        abandoned,
        totalCompletedSeconds,
        avgCompletedSeconds: completed > 0 ? Math.round(totalCompletedSeconds / completed) : 0,
        reflected,
        avgDistractions: distractionCount > 0 ? Math.round((distractionSum / distractionCount) * 10) / 10 : null,
        byMode,
      },
      totals: {
        totalMinutes: Math.round((streakRow?.totalHoursStudied ?? 0) * 60),
        scannedSessions: scanned,
      },
    };
  },
});
