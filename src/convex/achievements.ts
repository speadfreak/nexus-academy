// Achievements.
//
// Static definitions live here (code is the source of truth) and are seeded
// into the achievements table idempotently. checkAndAward is called from real
// study-action success paths; it never awards the same achievement twice and
// never invents data — every requirement checks actual rows.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { STREAM_SPECIFIC_SUBJECT_SLUGS } from "./constants";

export type AchievementTier = "bronze" | "silver" | "gold";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide-react icon name (mapped client-side)
  tier: AchievementTier;
}

/** A freshly earned achievement, returned by checkAndAward to the action
 *  that triggered it so the UI can celebrate without a full-screen moment. */
export interface NewAchievement {
  id: string;
  name: string;
  tier: AchievementTier;
}

// Real, meaningful achievements — tied to actual study behavior. Deliberately
// small in number so each one means something.
export const ACHIEVEMENT_DEFINITIONS: AchievementDef[] = [
  {
    id: "first_session",
    name: "First Step",
    description: "Log your first focus session.",
    icon: "Footprints",
    tier: "bronze",
  },
  {
    id: "quiz_first",
    name: "First Check",
    description: "Complete your first quiz.",
    icon: "HelpCircle",
    tier: "bronze",
  },
  {
    id: "daily_challenge_first",
    name: "Daily Driver",
    description: "Complete your first daily challenge.",
    icon: "CalendarCheck",
    tier: "bronze",
  },
  {
    id: "group_first",
    name: "Study Squad",
    description: "Join your first study group.",
    icon: "Users",
    tier: "bronze",
  },
  {
    id: "first_streak_7",
    name: "Week on Fire",
    description: "Keep a 7-day study streak.",
    icon: "Flame",
    tier: "silver",
  },
  {
    id: "quiz_perfect",
    name: "Perfect Paper",
    description: "Score 100% on a quiz.",
    icon: "Target",
    tier: "silver",
  },
  {
    id: "all_stream_subjects_week",
    name: "Full Coverage",
    description: "Study all three of your stream's subjects in one week.",
    icon: "Layers",
    tier: "silver",
  },
  {
    id: "hours_10_subject",
    name: "Deep Dive",
    description: "Study 10 hours in a single subject.",
    icon: "Timer",
    tier: "silver",
  },
  {
    id: "plan_complete",
    name: "Plan Executed",
    description: "Complete a full AI study plan.",
    icon: "Map",
    tier: "gold",
  },
  {
    id: "first_streak_30",
    name: "Unstoppable Month",
    description: "Keep a 30-day study streak.",
    icon: "Zap",
    tier: "gold",
  },
];

const DEF_BY_ID = new Map(ACHIEVEMENT_DEFINITIONS.map((def) => [def.id, def]));

// ---------------------------------------------------------------------------
// Seeding (idempotent)
// ---------------------------------------------------------------------------

export const seedAchievements = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("achievements").collect();
    const have = new Set(existing.map((row) => row.id));
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      if (have.has(def.id)) continue;
      await ctx.db.insert("achievements", def);
    }
    return { ok: true, seeded: ACHIEVEMENT_DEFINITIONS.length };
  },
});

// ---------------------------------------------------------------------------
// Requirement checks — each one reads real data, never client claims.
// ---------------------------------------------------------------------------

async function checkRequirement(
  ctx: MutationCtx,
  userId: Id<"users">,
  defId: string,
): Promise<boolean> {
  switch (defId) {
    case "first_session": {
      const session = await ctx.db
        .query("studySessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      return session !== null;
    }
    case "quiz_first": {
      const attempt = await ctx.db
        .query("quizAttempts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      return attempt !== null;
    }
    case "daily_challenge_first": {
      const attempt = await ctx.db
        .query("dailyChallengeAttempts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      return attempt !== null;
    }
    case "group_first": {
      const membership = await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      return membership !== null;
    }
    case "first_streak_7":
    case "first_streak_30": {
      const streak = await ctx.db
        .query("studyStreaks")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (!streak) return false;
      return streak.currentStreak >= (defId === "first_streak_7" ? 7 : 30);
    }
    case "quiz_perfect": {
      const attempts = await ctx.db
        .query("quizAttempts")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(200);
      return attempts.some((a) => a.score === a.totalQuestions && a.totalQuestions > 0);
    }
    case "hours_10_subject": {
      const sessions = await ctx.db
        .query("studySessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(500);
      const perSubject = new Map<Id<"subjects">, number>();
      for (const session of sessions) {
        perSubject.set(
          session.subjectId,
          (perSubject.get(session.subjectId) ?? 0) + session.durationSeconds,
        );
      }
      for (const seconds of perSubject.values()) {
        if (seconds >= 10 * 3600) return true;
      }
      return false;
    }
    case "all_stream_subjects_week": {
      const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
      if (!profile?.stream) return false;
      const slugs =
        profile.stream === "natural"
          ? STREAM_SPECIFIC_SUBJECT_SLUGS.natural
          : STREAM_SPECIFIC_SUBJECT_SLUGS.social;
      const subjects = await ctx.db.query("subjects").collect();
      const slugToId = new Map(subjects.map((s) => [s.slug, s._id]));
      const wanted = slugs
        .map((slug) => slugToId.get(slug))
        .filter((id): id is Id<"subjects"> => id !== undefined);
      if (wanted.length !== slugs.length) return false;

      const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const sessions = await ctx.db
        .query("studySessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.gte(q.field("startedAt"), weekStart))
        .take(500);
      const studied = new Set(sessions.map((s) => s.subjectId));
      return wanted.every((id) => studied.has(id));
    }
    case "plan_complete": {
      const plans = await ctx.db
        .query("studyPlans")
        .filter((q) => q.eq(q.field("userId"), userId))
        .take(100);
      for (const plan of plans) {
        try {
          const weeks = JSON.parse(plan.planJson) as unknown[];
          if (!Array.isArray(weeks) || weeks.length === 0) continue;
          const completed = (plan.completedWeeks ?? []).length;
          if (completed >= weeks.length) return true;
        } catch {
          // malformed plan — ignore
        }
      }
      return false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// checkAndAward — idempotent, called from real action success paths
// ---------------------------------------------------------------------------

export const checkAndAward = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<NewAchievement[]> => {
    await ctx.runMutation(internal.achievements.seedAchievements, {});
    const earnedRows = await ctx.db
      .query("userAchievements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const earned = new Set(earnedRows.map((row) => row.achievementId));

    const newly: NewAchievement[] = [];
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      if (earned.has(def.id)) continue; // never twice
      const met = await checkRequirement(ctx, userId, def.id);
      if (!met) continue;
      await ctx.db.insert("userAchievements", {
        userId,
        achievementId: def.id,
        earnedAt: Date.now(),
      });
      await ctx.runMutation(internal.notifications.createNotification, {
        userId,
        type: "achievement",
        title: `Achievement unlocked: ${def.name}`,
        body: def.description,
        actionUrl: "/achievements",
      });
      newly.push({ id: def.id, name: def.name, tier: def.tier });
    }
    return newly;
  },
});

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------

/**
 * All achievements with the student's earned state. Locked ones are shown
 * WITH their requirement text (never hidden mystery boxes) so students know
 * exactly what to aim for.
 */
export const getMyAchievements = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    // Reads from the code definitions (source of truth) + the user's earned
    // rows — the achievements table is seeded idempotently by checkAndAward.
    if (!userId) {
      return ACHIEVEMENT_DEFINITIONS.map((def) => ({ ...def, earnedAt: null }));
    }
    const earnedRows = await ctx.db
      .query("userAchievements")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const earnedAt = new Map(earnedRows.map((row) => [row.achievementId, row.earnedAt]));
    return ACHIEVEMENT_DEFINITIONS.map((def) => ({
      ...def,
      earnedAt: earnedAt.get(def.id) ?? null,
    }));
  },
});
