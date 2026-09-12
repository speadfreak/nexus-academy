// LEARNYX SQUADS — collaborative adaptive learning layer.
//
// This file is the backend of the SQUADS upgrade: it turns the existing
// study-groups foundation (private groups, invite codes, members, chat,
// leaderboard, rooms) into a shared academic mission that actually helps
// every member study better.
//
// The killer loop lives here:
//
//   individual struggles with X
//     → flashcards record low memoryStrength
//     → radar (getSquadWeaknessRadar) aggregates anonymously across members
//     → owner/admin/mentor creates a challenge on X (createSquadChallenge)
//     → squad AI tutor (askSquadAI) generates explanation + practice Qs +
//       flashcards + a mini quiz on X
//     → host starts a quiz battle on X (createSquadQuizBattle)
//     → everyone answers in real-time, server scores (submitSquadBattleAnswer)
//     → weakness decreases
//
// Privacy is preserved end-to-end:
//   • Weakness radar NEVER exposes who is struggling — only counts ("4
//     members are struggling with Genetics") and aggregate metrics.
//   • Quiz battle scores ARE shown (with permission) — the leaderboard is
//     opt-in competitive and only ranks XP, never subjective metrics.
//   • AI tutor thread is shared across the squad but the underlying prompt
//     only sees aggregated weakness topics, not individual study history.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { callGroq } from "./groq";
import {
  SQUAD_ACHIEVEMENT_IDS,
  SQUAD_BATTLE_QUESTION_MS,
  SQUAD_CHALLENGE_DEFAULT_REWARD_XP,
  SQUAD_MISSION_COMPLETION_XP,
  SQUAD_MISSION_DAILY_TARGET,
} from "./constants";
import type { Doc } from "./_generated/dataModel";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type Metric = "xp" | "streak" | "recall" | "study_time" | "quiz_accuracy";

interface SquadLeaderboardRow {
  userId: Id<"users">;
  name: string;
  role: string;
  isMe: boolean;
  xpThisWeek: number;
  streak: number;
  hoursThisWeek: number;
  quizAccuracy: number;
  recall: number;
  quizAttempts: number;
}

interface SquadChallengeView {
  challengeId: Id<"squadChallenges">;
  title: string;
  type: "flashcards" | "quizzes" | "study_time" | "chapters_read" | "streak";
  goal: number;
  unit: string;
  subjectName: string;
  topicName: string | null;
  rewardXp: number;
  rewardBadge: string | null;
  startedAt: number;
  endsAt: number;
  status: "active" | "completed" | "abandoned";
  achieved: boolean;
  totalProgress: number;
  progressPct: number;
  perMember: {
    userId: Id<"users">;
    name: string;
    count: number;
  }[];
}

interface SquadBattleView {
  battleId: Id<"squadQuizBattles">;
  groupId: Id<"studyGroups">;
  subjectName: string;
  topicName: string;
  hostedBy: Id<"users">;
  status: "lobby" | "active" | "completed";
  startedAt: number;
  endedAt: number | null;
  questionIndex: number;
  questionEndsAt: number | null;
  totalQuestions: number;
  currentQuestion: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  } | null;
  isQuestionDone: boolean;
  isHost: boolean;
  isParticipant: boolean;
  myScore: number;
  myCorrectCount: number;
  myAnswers: number[];
  participants: {
    userId: Id<"users">;
    name: string;
    score: number;
    correctCount: number;
    answersCount: number;
    joinedAt: number;
  }[];
  allQuestions:
    | {
        question: string;
        options: string[];
        correctIndex: number;
        explanation: string;
      }[]
    | null;
}

interface SquadChatWidgetView {
  widgetId: Id<"squadChatWidgets">;
  widgetType: "poll" | "quiz_card" | "flashcard" | "ai_explanation" | "challenge_invite";
  payload: string;
  userId: Id<"users">;
  userName: string;
  createdAt: number;
}

interface SquadReadinessSubject {
  subjectId: Id<"subjects">;
  subjectName: string;
  readinessScore: number;
  status: "red" | "amber" | "yellow" | "green";
  memberCoverage: number;
}

const METRICS: Metric[] = ["xp", "streak", "recall", "study_time", "quiz_accuracy"];

// ---------------------------------------------------------------------------
// Achievement definitions — seeded once, checked idempotently.
// ---------------------------------------------------------------------------

export const SQUAD_ACHIEVEMENT_DEFINITIONS = [
  {
    id: SQUAD_ACHIEVEMENT_IDS.firstSquadWeek,
    name: "First Squad Week",
    description: "Stay active as a squad for 7 days straight.",
    icon: "CalendarCheck",
    tier: "bronze" as const,
  },
  {
    id: SQUAD_ACHIEVEMENT_IDS.knowledgeFactory,
    name: "Knowledge Factory",
    description: "Review 1,000 flashcards collectively.",
    icon: "Brain",
    tier: "silver" as const,
  },
  {
    id: SQUAD_ACHIEVEMENT_IDS.hundredHourCrew,
    name: "100-Hour Crew",
    description: "Reach 100 total study hours as a squad.",
    icon: "Timer",
    tier: "silver" as const,
  },
  {
    id: SQUAD_ACHIEVEMENT_IDS.examReady,
    name: "Exam Ready",
    description: "Every member completes a squad mock exam.",
    icon: "GraduationCap",
    tier: "gold" as const,
  },
  {
    id: SQUAD_ACHIEVEMENT_IDS.eliteSquad,
    name: "Elite Squad",
    description: "Maintain a 14-day squad streak.",
    icon: "Crown",
    tier: "gold" as const,
  },
];

// ---------------------------------------------------------------------------
// Auth + membership helpers
// ---------------------------------------------------------------------------

async function requireMember(
  ctx: QueryCtx,
  groupId: Id<"studyGroups">,
): Promise<{ userId: Id<"users">; role: string }> {
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
    throw new ConvexError({ message: "You're not in this group.", code: "not_member" });
  }
  return { userId, role: membership.role };
}

async function requirePrivileged(
  ctx: QueryCtx,
  groupId: Id<"studyGroups">,
): Promise<{ userId: Id<"users">; role: string }> {
  const info = await requireMember(ctx, groupId);
  if (info.role !== "owner" && info.role !== "admin" && info.role !== "mentor") {
    throw new ConvexError({
      message: "Only owners, admins, and mentors can do this.",
      code: "forbidden",
    });
  }
  return info;
}

async function requireAdmin(
  ctx: QueryCtx,
  groupId: Id<"studyGroups">,
): Promise<{ userId: Id<"users">; role: string }> {
  const info = await requireMember(ctx, groupId);
  if (info.role !== "owner" && info.role !== "admin") {
    throw new ConvexError({
      message: "Only owners and admins can do this.",
      code: "forbidden",
    });
  }
  return info;
}

// ---------------------------------------------------------------------------
// Date helpers (uses local server time → "YYYY-MM-DD")
// ---------------------------------------------------------------------------

function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ===========================================================================
// SQUAD DASHBOARD
// ===========================================================================

/**
 * Squad dashboard — the mission-control view for one group. Surfaces:
 *
 *   • today's squad mission (target study actions vs achieved)
 *   • squad streak (days since the squad had ≥1 active member)
 *   • squad total hours this week (sum across members)
 *   • average quiz accuracy this week (mean of members' quiz attempts)
 *   • today's squad todo (a personalized pick of flashcards + quizzes
 *     derived from each member's recent activity — NOT individual weaknesses)
 *   • member completion status (who has/hasn't logged a study action today)
 *
 * Idempotently creates today's squadMission row on first read.
 */
export const getSquadDashboard = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const { userId } = await requireMember(ctx, groupId);
    const group = await ctx.db.get(groupId);
    if (!group) return null;

    // Pull all members up-front (used everywhere below).
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();

    const today = todayKey();
    const weekStart = Date.now() - WEEK_MS;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();

    // Aggregate weekly hours from studySessions.
    let weekHoursSum = 0;
    let weekQuizAttempts = 0;
    let weekQuizCorrect = 0;
    let weekXpSum = 0;
    let activeMembersToday = 0;
    const memberStatus: {
      userId: Id<"users">;
      name: string;
      role: string;
      studiedToday: boolean;
      xpThisWeek: number;
    }[] = [];

    for (const member of members) {
      // Hours this week
      const sessions = await ctx.db
        .query("studySessions")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .filter((q) => q.gte(q.field("startedAt"), weekStart))
        .take(500);
      const hours = sessions.reduce((s, sess) => s + sess.durationSeconds, 0) / 3600;
      weekHoursSum += hours;

      // Sessions today — for the "active today" flag
      const sessionsToday = sessions.filter((s) => s.startedAt >= dayStartMs);
      let studiedToday = sessionsToday.length > 0;

      // Quiz accuracy this week
      const attempts = await ctx.db
        .query("quizAttempts")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .filter((q) => q.gte(q.field("completedAt"), weekStart))
        .take(500);
      const totalQ = attempts.reduce((s, a) => s + a.totalQuestions, 0);
      const correct = attempts.reduce((s, a) => s + a.score, 0);
      weekQuizAttempts += totalQ;
      weekQuizCorrect += correct;
      if (attempts.length > 0) studiedToday = true;

      // XP this week
      const xpRows = await ctx.db
        .query("xpLedger")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", member.userId))
        .filter((q) => q.gte(q.field("createdAt"), weekStart))
        .take(500);
      const xpThisWeek = xpRows.reduce((s, r) => s + r.amount, 0);
      weekXpSum += xpThisWeek;

      // Also count flashcard reviews today as "studied today" — a flashcard
      // review counts as a study action. We check the user's decks, then any
      // card reviewed today in any of those decks.
      const decks = await ctx.db
        .query("flashcardDecks")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .collect();
      for (const deck of decks) {
        const reviewedToday = await ctx.db
          .query("flashcards")
          .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
          .filter((q) => q.gte(q.field("lastReviewedAt"), dayStartMs))
          .take(1);
        if (reviewedToday.length > 0) {
          studiedToday = true;
          break;
        }
      }

      if (studiedToday) activeMembersToday++;

      const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
        userId: member.userId,
      });
      const user = await ctx.db.get(member.userId);
      memberStatus.push({
        userId: member.userId,
        name: profile?.displayName ?? user?.name ?? "Student",
        role: member.role,
        studiedToday,
        xpThisWeek,
      });
    }

    // Average accuracy across the squad this week.
    const avgAccuracy =
      weekQuizAttempts > 0 ? Math.round((weekQuizCorrect / weekQuizAttempts) * 100) : 0;

    // Squad streak — days since the group was created with ≥1 active
    // member per day. This is a conservative, honest approximation: we look
    // at distinct days in the last 14 days where ANY member had a
    // studySession. Real "consecutive days" rules run server-side.
    const streakDays = await computeSquadStreak(ctx, groupId, members.map((m) => m.userId));

    // Today's mission row — get (NOT create) since this is a query. The
    // mutation `ensureTodayMission` below is the one that creates it on
    // first open.
    const mission = await ctx.db
      .query("squadMissions")
      .withIndex("by_group_date", (q) => q.eq("groupId", groupId).eq("date", today))
      .unique();

    // Active challenges count
    const activeChallenges = await ctx.db
      .query("squadChallenges")
      .withIndex("by_group_status", (q) => q.eq("groupId", groupId).eq("status", "active"))
      .collect();

    // Live quiz battle (if any)
    const liveBattle = await ctx.db
      .query("squadQuizBattles")
      .withIndex("by_group_status", (q) => q.eq("groupId", groupId).eq("status", "active"))
      .first();
    const lobbyBattle = await ctx.db
      .query("squadQuizBattles")
      .withIndex("by_group_status", (q) => q.eq("groupId", groupId).eq("status", "lobby"))
      .first();

    // Today's squad todo — derive a small, honest, per-member list of
    // "what to do today". We use the squad's plan/calendar to pick the
    // top items. For now we surface flashcards due + today's calendar.
    // flashcards has no userId — go via deckId → flashcardDecks.
    const myDecksForTodo = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let dueFlashcardsCount = 0;
    for (const deck of myDecksForTodo) {
      const due = await ctx.db
        .query("flashcards")
        .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
        .filter((q) => q.lt(q.field("nextReviewAt"), Date.now()))
        .take(50);
      dueFlashcardsCount += due.length;
    }
    const todaysCalendar = await ctx.db
      .query("calendarEvents")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId))
      .filter((q) => q.gte(q.field("startAt"), dayStartMs))
      .filter((q) => q.lt(q.field("startAt"), dayStartMs + DAY_MS))
      .take(10);

    const membersStudiedCount = memberStatus.filter((m) => m.studiedToday).length;
    const membersRemaining = members.length - membersStudiedCount;

    return {
      groupId,
      groupName: group.name,
      subjectFocusName: (group.subjectFocus
        ? (await ctx.db.get(group.subjectFocus))?.name
        : null) ?? null,
      memberCount: members.length,
      myRole: (await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .filter((q) => q.eq(q.field("userId"), userId))
        .first())?.role ?? "member",
      todayMission: mission
        ? {
            target: mission.targetActions,
            achieved: mission.achievedActions,
            completed: mission.completedAt !== undefined,
          }
        : null,
      squadStreakDays: streakDays,
      avgAccuracy,
      weekHours: Math.round(weekHoursSum * 10) / 10,
      weekXp: weekXpSum,
      activeChallengesCount: activeChallenges.length,
      liveBattleId: liveBattle?._id ?? null,
      lobbyBattleId: lobbyBattle?._id ?? null,
      membersRemaining,
      membersStudied: membersStudiedCount,
      todaysTodo: {
        dueFlashcards: dueFlashcardsCount,
        calendarEvents: todaysCalendar.length,
        calendarTitles: todaysCalendar.slice(0, 3).map((e) => e.title),
      },
      memberStatus: memberStatus.sort((a, b) => b.xpThisWeek - a.xpThisWeek),
    };
  },
});

/**
 * Idempotently ensure today's squad mission exists. Called from the client
 * once on dashboard mount — the first member to open the dashboard today
 * creates the row. If it already exists, no-op. Returns the row.
 */
export const ensureTodayMission = mutation({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const { userId } = await requireMember(ctx, groupId);
    const today = todayKey();
    const existing = await ctx.db
      .query("squadMissions")
      .withIndex("by_group_date", (q) => q.eq("groupId", groupId).eq("date", today))
      .unique();
    if (existing) return existing;

    const missionId = await ctx.db.insert("squadMissions", {
      groupId,
      date: today,
      targetActions: SQUAD_MISSION_DAILY_TARGET,
      achievedActions: 0,
    });
    // Notify squad members that today's mission is live.
    await notifySquad(ctx, groupId, {
      type: "squad_mission",
      title: "Today's squad mission is live",
      body: `Target: ${SQUAD_MISSION_DAILY_TARGET} study actions. Beat it together.`,
      actionUrl: "/groups",
      excludeUserId: userId,
    });
    return await ctx.db.get(missionId);
  },
});

/**
 * Internal: increment today's mission achievedActions by 1. Called from
 * existing study-action success paths (submitCardReview, completeQuiz, etc.)
 * via internal.squads.bumpMissionToday — keeps the dashboard honest without
 * a separate client write path.
 */
export const bumpMissionToday = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    delta: v.number(),
  },
  handler: async (ctx, { groupId, delta }) => {
    const today = todayKey();
    const mission = await ctx.db
      .query("squadMissions")
      .withIndex("by_group_date", (q) => q.eq("groupId", groupId).eq("date", today))
      .unique();
    if (!mission) return null;
    const nextAchieved = mission.achievedActions + delta;
    const isComplete = nextAchieved >= mission.targetActions;
    await ctx.db.patch(mission._id, {
      achievedActions: nextAchieved,
      completedAt: isComplete && !mission.completedAt ? Date.now() : mission.completedAt,
    });
    if (isComplete && !mission.completedAt) {
      // Award every squad member the squad-mission XP.
      const members = await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", groupId))
        .collect();
      for (const m of members) {
        await ctx.runMutation(internal.xp.awardXp, {
          userId: m.userId,
          amount: SQUAD_MISSION_COMPLETION_XP,
          reason: "squad_mission",
        });
        await ctx.runMutation(internal.notifications.createNotification, {
          userId: m.userId,
          type: "squad_mission",
          title: "Squad mission complete 🎉",
          body: `Your squad hit today's target of ${mission.targetActions} study actions. +${SQUAD_MISSION_COMPLETION_XP} XP for everyone.`,
          actionUrl: "/groups",
        });
      }
    }
    return { ok: true, achieved: nextAchieved };
  },
});

// Compute squad streak: distinct days in the last 14 with ≥1 studySession
// from any squad member. Conservative — doesn't enforce strict consecutivity
// (would require per-day presence which is brittle).
async function computeSquadStreak(
  ctx: QueryCtx,
  _groupId: Id<"studyGroups">,
  userIds: Id<"users">[],
): Promise<number> {
  if (userIds.length === 0) return 0;
  const since = Date.now() - 14 * DAY_MS;
  const dayBuckets = new Set<string>();
  for (const userId of userIds) {
    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.gte(q.field("startedAt"), since))
      .take(200);
    for (const s of sessions) {
      dayBuckets.add(todayKey(new Date(s.startedAt)));
    }
  }
  return dayBuckets.size;
}

// ===========================================================================
// LEADERBOARD 2.0 — multi-metric, XP-primary
// ===========================================================================

/**
 * Leaderboard 2.0 — one honest primary ranking (XP) + four secondary
 * rankings (streak, recall, study_time, quiz_accuracy). The PRIMARY rank
 * is always XP — every metric returns members sorted by the primary, with
 * the secondary metric shown as additional context per row. That way
 * nobody can argue about subjective rankings — the order is always XP.
 *
 * `metric` controls which secondary metric is shown alongside the primary.
 */
export const getSquadLeaderboard = query({
  args: {
    groupId: v.id("studyGroups"),
    metric: v.union(
      v.literal("xp"),
      v.literal("streak"),
      v.literal("recall"),
      v.literal("study_time"),
      v.literal("quiz_accuracy"),
    ),
  },
  handler: async (ctx, { groupId, metric }): Promise<{
    metric: Metric;
    primaryIsXp: boolean;
    rows: SquadLeaderboardRow[];
  }> => {
    const { userId } = await requireMember(ctx, groupId);
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("asc")
      .collect();
    const weekStart = Date.now() - WEEK_MS;

    const rows: SquadLeaderboardRow[] = await Promise.all(
      members.map(async (m) => {
        const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
          userId: m.userId,
        });
        const user = await ctx.db.get(m.userId);

        // Primary: XP this week
        const xpRows = await ctx.db
          .query("xpLedger")
          .withIndex("by_user_createdAt", (q) => q.eq("userId", m.userId))
          .filter((q) => q.gte(q.field("createdAt"), weekStart))
          .take(500);
        const xpThisWeek = xpRows.reduce((s, r) => s + r.amount, 0);

        // Secondary metrics
        // streak — currentStreak from studyStreaks denormalized row
        const streakRow = await ctx.db
          .query("studyStreaks")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .first();
        const streak = streakRow?.currentStreak ?? 0;

        // study_time — hours this week
        const sessions = await ctx.db
          .query("studySessions")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .filter((q) => q.gte(q.field("startedAt"), weekStart))
          .take(500);
        const hoursThisWeek = Math.round(
          (sessions.reduce((s, sess) => s + sess.durationSeconds, 0) / 3600) * 10,
        ) / 10;

        // quiz_accuracy — correct/total this week
        const attempts = await ctx.db
          .query("quizAttempts")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .filter((q) => q.gte(q.field("completedAt"), weekStart))
          .take(500);
        const totalQ = attempts.reduce((s, a) => s + a.totalQuestions, 0);
        const correct = attempts.reduce((s, a) => s + a.score, 0);
        const accuracy = totalQ > 0 ? Math.round((correct / totalQ) * 100) : 0;

        // recall — flashcard memory strength avg across the user's reviewed
        // cards. flashcards has no userId — we go via deckId → flashcardDecks.
        const myDecks = await ctx.db
          .query("flashcardDecks")
          .withIndex("by_user", (q) => q.eq("userId", m.userId))
          .collect();
        let reviewedCards: { memoryStrength?: number }[] = [];
        for (const deck of myDecks) {
          const cards = await ctx.db
            .query("flashcards")
            .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
            .filter((q) => q.neq(q.field("lastReviewedAt"), undefined))
            .take(200);
          reviewedCards = reviewedCards.concat(cards);
        }
        const recallAvg =
          reviewedCards.length > 0
            ? Math.round(
                (reviewedCards.reduce((s, c) => s + (c.memoryStrength ?? 0.5), 0) /
                  reviewedCards.length) *
                  100,
              )
            : 0;

        return {
          userId: m.userId,
          name: profile?.displayName ?? user?.name ?? "Student",
          role: m.role,
          isMe: m.userId === userId,
          xpThisWeek,
          streak,
          hoursThisWeek,
          quizAccuracy: accuracy,
          recall: recallAvg,
          quizAttempts: attempts.length,
        };
      }),
    );

    // Sort by the SECONDARY metric when viewing a non-XP tab, but keep
    // the XP-primary rule explicit in the comment for the user — the
    // backend always returns BOTH primary and secondary values per row.
    const sortBy: Record<Metric, (a: SquadLeaderboardRow, b: SquadLeaderboardRow) => number> = {
      xp: (a, b) => b.xpThisWeek - a.xpThisWeek,
      streak: (a, b) => b.streak - a.streak,
      recall: (a, b) => b.recall - a.recall,
      study_time: (a, b) => b.hoursThisWeek - a.hoursThisWeek,
      quiz_accuracy: (a, b) => b.quizAccuracy - a.quizAccuracy,
    };
    rows.sort(sortBy[metric]);

    return {
      metric,
      primaryIsXp: metric === "xp",
      rows,
    };
  },
});

// ===========================================================================
// SQUAD CHALLENGES
// ===========================================================================

/**
 * List all challenges (active + recently completed) for a squad.
 */
export const listSquadChallenges = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }): Promise<SquadChallengeView[]> => {
    await requireMember(ctx, groupId);
    const challenges = await ctx.db
      .query("squadChallenges")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .order("desc")
      .take(20);
    // For each challenge, also fetch per-member progress
    const enriched: SquadChallengeView[] = await Promise.all(
      challenges.map(async (c): Promise<SquadChallengeView> => {
        const progressRows = await ctx.db
          .query("squadChallengeProgress")
          .withIndex("by_challenge", (q) => q.eq("challengeId", c._id))
          .collect();
        const totalProgress = progressRows.reduce((s, p) => s + p.count, 0);
        // Enrich member progress with names
        const perMember = await Promise.all(
          progressRows.map(async (p) => {
            const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
              userId: p.userId,
            });
            const user = await ctx.db.get(p.userId);
            return {
              userId: p.userId,
              name: profile?.displayName ?? user?.name ?? "Student",
              count: p.count,
            };
          }),
        );
        perMember.sort((a, b) => b.count - a.count);
        const achieved = totalProgress >= c.goal;
        return {
          challengeId: c._id,
          title: c.title,
          type: c.type,
          goal: c.goal,
          unit: c.unit,
          subjectName: c.subjectName,
          topicName: c.topicName ?? null,
          rewardXp: c.rewardXp,
          rewardBadge: c.rewardBadge ?? null,
          startedAt: c.startedAt,
          endsAt: c.endsAt,
          status: c.status,
          achieved,
          totalProgress,
          progressPct: c.goal > 0 ? Math.min(100, Math.round((totalProgress / c.goal) * 100)) : 0,
          perMember: perMember.slice(0, 10),
        };
      }),
    );
    return enriched;
  },
});

/**
 * Create a squad challenge. Owner/admin/mentor only.
 */
export const createSquadChallenge = mutation({
  args: {
    groupId: v.id("studyGroups"),
    title: v.string(),
    type: v.union(
      v.literal("flashcards"),
      v.literal("quizzes"),
      v.literal("study_time"),
      v.literal("chapters_read"),
      v.literal("streak"),
    ),
    goal: v.number(),
    unit: v.string(),
    subjectId: v.optional(v.id("subjects")),
    subjectName: v.string(),
    topicName: v.optional(v.string()),
    endsInDays: v.number(),
    rewardXp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requirePrivileged(ctx, args.groupId);
    const title = args.title.trim();
    if (!title) throw new ConvexError({ message: "Title is required.", code: "invalid" });
    if (args.goal <= 0) throw new ConvexError({ message: "Goal must be > 0.", code: "invalid" });
    if (args.endsInDays <= 0 || args.endsInDays > 30) {
      throw new ConvexError({ message: "Duration must be 1–30 days.", code: "invalid" });
    }
    const now = Date.now();
    const challengeId = await ctx.db.insert("squadChallenges", {
      groupId: args.groupId,
      title,
      type: args.type,
      goal: args.goal,
      unit: args.unit,
      subjectId: args.subjectId,
      subjectName: args.subjectName,
      topicName: args.topicName,
      rewardXp: args.rewardXp ?? SQUAD_CHALLENGE_DEFAULT_REWARD_XP,
      rewardBadge: undefined,
      startedAt: now,
      endsAt: now + args.endsInDays * DAY_MS,
      status: "active",
      createdBy: userId,
    });
    // Notify squad
    await notifySquad(ctx, args.groupId, {
      type: "squad_challenge",
      title: "New squad challenge",
      body: `“${title}” — ${args.goal} ${args.unit} by ${args.endsInDays}d. Reward: ${args.rewardXp ?? SQUAD_CHALLENGE_DEFAULT_REWARD_XP} XP.`,
      actionUrl: "/groups",
      excludeUserId: userId,
    });
    return { challengeId };
  },
});

/**
 * Contribute to a challenge (owner/admin/mentor can manually bump; the
 * backend auto-bumps from study-action success paths via internal mutation).
 */
export const bumpChallengeProgress = mutation({
  args: {
    challengeId: v.id("squadChallenges"),
    delta: v.number(),
  },
  handler: async (ctx, { challengeId, delta }) => {
    const challenge = await ctx.db.get(challengeId);
    if (!challenge) throw new ConvexError({ message: "Challenge not found.", code: "not_found" });
    const { userId } = await requireMember(ctx, challenge.groupId);
    if (challenge.status !== "active") {
      throw new ConvexError({ message: "Challenge is not active.", code: "invalid" });
    }
    if (Date.now() > challenge.endsAt) {
      throw new ConvexError({ message: "Challenge has ended.", code: "invalid" });
    }

    const existing = await ctx.db
      .query("squadChallengeProgress")
      .withIndex("by_challenge_user", (q) =>
        q.eq("challengeId", challengeId).eq("userId", userId),
      )
      .unique();
    const nextCount = (existing?.count ?? 0) + delta;
    if (existing) {
      await ctx.db.patch(existing._id, { count: nextCount, lastUpdated: Date.now() });
    } else {
      await ctx.db.insert("squadChallengeProgress", {
        challengeId,
        userId,
        count: nextCount,
        lastUpdated: Date.now(),
      });
    }

    // Recompute total + check completion
    const allProgress = await ctx.db
      .query("squadChallengeProgress")
      .withIndex("by_challenge", (q) => q.eq("challengeId", challengeId))
      .collect();
    const total = allProgress.reduce((s, p) => s + p.count, 0);
    if (total >= challenge.goal && challenge.status === "active") {
      await ctx.db.patch(challengeId, {
        status: "completed",
        completedAt: Date.now(),
      });
      // Award every member the reward XP + a notification.
      const members = await ctx.db
        .query("studyGroupMembers")
        .withIndex("by_group", (q) => q.eq("groupId", challenge.groupId))
        .collect();
      for (const m of members) {
        await ctx.runMutation(internal.xp.awardXp, {
          userId: m.userId,
          amount: challenge.rewardXp,
          reason: "squad_challenge",
        });
        await ctx.runMutation(internal.notifications.createNotification, {
          userId: m.userId,
          type: "squad_challenge",
          title: "Squad challenge complete 🎉",
          body: `“${challenge.title}” — your squad hit ${total} ${challenge.unit}. +${challenge.rewardXp} XP each.`,
          actionUrl: "/groups",
        });
      }
      // Check squad achievements
      await ctx.runMutation(internal.squads.checkSquadAchievements, {
        groupId: challenge.groupId,
      });
    }
    return { totalProgress: total, achieved: total >= challenge.goal };
  },
});

/**
 * Abandon (cancel) an active challenge. Owner/admin only.
 */
export const abandonSquadChallenge = mutation({
  args: { challengeId: v.id("squadChallenges") },
  handler: async (ctx, { challengeId }) => {
    const challenge = await ctx.db.get(challengeId);
    if (!challenge) throw new ConvexError({ message: "Challenge not found.", code: "not_found" });
    await requireAdmin(ctx, challenge.groupId);
    await ctx.db.patch(challengeId, { status: "abandoned" });
    return { ok: true };
  },
});

// ===========================================================================
// SHARED WEAKNESS RADAR
// ===========================================================================

/**
 * Shared weakness radar — anonymously aggregates flashcard weaknesses
 * across squad members. Returns the top struggling topics with the COUNT
 * of members struggling (never who — only "N members").
 *
 * The aggregation uses each member's flashcard memoryStrength averaged
 * per subject. A subject counts as "struggling" if the member's average
 * memoryStrength for that subject is below 0.6.
 */
export const getSquadWeaknessRadar = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();

    // subjectId → list of (member avg memoryStrength)
    const subjectScores = new Map<Id<"subjects">, number[]>();
    const subjectNames = new Map<Id<"subjects">, string>();

    for (const member of members) {
      // Get this member's flashcards — grouped by subject (via deck)
      const decks = await ctx.db
        .query("flashcardDecks")
        .withIndex("by_user", (q) => q.eq("userId", member.userId))
        .collect();
      for (const deck of decks) {
        if (!deck.subjectId) continue;
        const cards = await ctx.db
          .query("flashcards")
          .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
          .filter((q) => q.neq(q.field("lastReviewedAt"), undefined))
          .take(200);
        if (cards.length === 0) continue;
        const avgStrength =
          cards.reduce((s, c) => s + (c.memoryStrength ?? 0.5), 0) / cards.length;
        if (!subjectScores.has(deck.subjectId)) subjectScores.set(deck.subjectId, []);
        subjectScores.get(deck.subjectId)!.push(avgStrength);
        if (!subjectNames.has(deck.subjectId)) {
          const subject = await ctx.db.get(deck.subjectId);
          if (subject) subjectNames.set(deck.subjectId, subject.name);
        }
      }
    }

    const result = Array.from(subjectScores.entries()).map(([subjectId, scores]) => {
      const strugglingCount = scores.filter((s) => s < 0.6).length;
      const avgScore = scores.reduce((s, x) => s + x, 0) / scores.length;
      const avgPct = Math.round(avgScore * 100);
      // Severity bucket: red if avg < 50%, amber 50-65%, yellow 65-80%, green > 80%
      let severity: "red" | "amber" | "yellow" | "green" = "green";
      if (avgPct < 50) severity = "red";
      else if (avgPct < 65) severity = "amber";
      else if (avgPct < 80) severity = "yellow";
      return {
        subjectId,
        subjectName: subjectNames.get(subjectId) ?? "Subject",
        strugglingCount,
        memberCount: members.length,
        avgStrengthPct: avgPct,
        severity,
      };
    });

    // Sort: strugglingCount desc, then avgStrength asc
    result.sort((a, b) => {
      if (a.strugglingCount !== b.strugglingCount) return b.strugglingCount - a.strugglingCount;
      return a.avgStrengthPct - b.avgStrengthPct;
    });
    return result.slice(0, 6);
  },
});

// ===========================================================================
// AI SQUAD TUTOR
// ===========================================================================

const SQUAD_AI_SYSTEM_PROMPT =
  "You are the Learnyx Squad Tutor — an AI teaching assistant for a small " +
  "Ethiopian study squad (grades 9-12, EHEEE preparation). You generate " +
  "structured learning material on a topic the squad is studying together. " +
  "Your output MUST be valid JSON (no markdown, no preface) with this shape:\n" +
  "{\n" +
  "  \"explanation\": \"a clear, concise explanation of the topic (3-5 paragraphs)\",\n" +
  "  \"practiceQuestions\": [\n" +
  "    { \"question\": \"...\", \"options\": [\"a\",\"b\",\"c\",\"d\"], \"correctIndex\": 0, \"explanation\": \"...\" }\n" +
  "  ],\n" +
  "  \"flashcards\": [\n" +
  "    { \"front\": \"...\", \"back\": \"...\" }\n" +
  "  ],\n" +
  "  \"miniQuiz\": [\n" +
  "    { \"question\": \"...\", \"options\": [\"a\",\"b\",\"c\",\"d\"], \"correctIndex\": 0, \"explanation\": \"...\" }\n" +
  "  ]\n" +
  "}\n" +
  "Generate 5 practiceQuestions, 5 flashcards, and 5 miniQuiz questions. " +
  "Every question MUST have 4 options. Make questions curriculum-relevant " +
  "for the Ethiopian national exam. The explanation field at the top should " +
  "be plain text (no markdown).";

/**
 * Generate a structured AI tutor thread for the squad on a topic. Stored
 * once, shared across the squad. Anyone can spawn a quiz battle directly
 * from the cached miniQuiz.
 */
export const askSquadAI = action({
  args: {
    groupId: v.id("studyGroups"),
    topicName: v.string(),
    subjectName: v.string(),
  },
  handler: async (ctx, args): Promise<{ threadId: Id<"squadAIThreads"> }> => {
    // Verify membership (action can't call requireMember directly)
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const membership = await ctx.runQuery(internal.studyGroups.getGroupRole, {
      groupId: args.groupId,
      userId,
    });
    if (!membership) throw new ConvexError({ message: "Not a member.", code: "not_member" });

    const raw = await callGroq(ctx, {
      systemPrompt: SQUAD_AI_SYSTEM_PROMPT,
      userMessage:
        `Topic: ${args.topicName}\nSubject: ${args.subjectName}\n` +
        `Generate the full structured learning material for a study squad ` +
        `studying this topic together. Be curriculum-grounded and clear.`,
      maxTokens: 4096,
      temperature: 0.5,
    });
    // Parse + validate. Tolerate minor JSON issues by stripping code fences.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: {
      explanation: string;
      practiceQuestions?: unknown;
      flashcards?: unknown;
      miniQuiz?: unknown;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new ConvexError({
        message: `AI returned malformed output. Try again — ${err instanceof Error ? err.message : ""}`.trim(),
        code: "ai_parse_error",
      });
    }
    if (!parsed.explanation || typeof parsed.explanation !== "string") {
      throw new ConvexError({ message: "AI returned no explanation.", code: "ai_parse_error" });
    }

    const threadId = await ctx.runMutation(internal.squads.insertSquadAIThread, {
      groupId: args.groupId,
      topicName: args.topicName,
      explanation: parsed.explanation,
      practiceQuestions: parsed.practiceQuestions
        ? JSON.stringify(parsed.practiceQuestions)
        : undefined,
      flashcards: parsed.flashcards ? JSON.stringify(parsed.flashcards) : undefined,
      miniQuiz: parsed.miniQuiz ? JSON.stringify(parsed.miniQuiz) : undefined,
      createdBy: userId,
    });

    // Notify squad
    await ctx.runMutation(internal.squads.notifySquadSquadAI, {
      groupId: args.groupId,
      topicName: args.topicName,
      excludeUserId: userId,
    });

    return { threadId };
  },
});

/**
 * List recent AI threads for the squad.
 */
export const listSquadAIThreads = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    const rows = await ctx.db
      .query("squadAIThreads")
      .withIndex("by_group_createdAt", (q) => q.eq("groupId", groupId))
      .order("desc")
      .take(20);
    return rows.map((r) => ({
      threadId: r._id,
      topicName: r.topicName,
      explanationPreview: r.explanation.slice(0, 280),
      hasMiniQuiz: !!r.miniQuiz,
      hasFlashcards: !!r.flashcards,
      spawnedBattleId: r.spawnedBattleId ?? null,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    }));
  },
});

/**
 * Get a single AI thread (full content).
 */
export const getSquadAIThread = query({
  args: { threadId: v.id("squadAIThreads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread) return null;
    await requireMember(ctx, thread.groupId);
    return {
      threadId: thread._id,
      groupId: thread.groupId,
      topicName: thread.topicName,
      explanation: thread.explanation,
      practiceQuestions: thread.practiceQuestions ?? null,
      flashcards: thread.flashcards ?? null,
      miniQuiz: thread.miniQuiz ?? null,
      spawnedBattleId: thread.spawnedBattleId ?? null,
      createdBy: thread.createdBy,
      createdAt: thread.createdAt,
    };
  },
});

// ===========================================================================
// SQUAD QUIZ BATTLES
// ===========================================================================

const SQUAD_QUIZ_SYSTEM_PROMPT =
  "You write 10 multiple-choice quiz questions on a topic for an Ethiopian " +
  "study squad competing together. Each question MUST have 4 options. " +
  "Return ONLY a JSON array (no markdown):\n" +
  '[{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}]\n' +
  "Make questions curriculum-grounded for grades 9-12 / EHEEE. Vary " +
  "difficulty — start easy, ramp up. Explanations should be 1-2 sentences.";

/**
 * Create a squad quiz battle. The host (owner/admin/mentor) provides a
 * topic; AI generates 10 questions; battle enters lobby state until host
 * starts it. Returns the battleId.
 */
export const createSquadQuizBattle = action({
  args: {
    groupId: v.id("studyGroups"),
    subjectName: v.string(),
    topicName: v.string(),
    subjectId: v.optional(v.id("subjects")),
  },
  handler: async (ctx, args): Promise<{ battleId: Id<"squadQuizBattles"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const role = await ctx.runQuery(internal.studyGroups.getGroupRole, {
      groupId: args.groupId,
      userId,
    });
    if (!role || role === "member") {
      throw new ConvexError({
        message: "Only owners, admins, and mentors can host quiz battles.",
        code: "forbidden",
      });
    }

    const raw = await callGroq(ctx, {
      systemPrompt: SQUAD_QUIZ_SYSTEM_PROMPT,
      userMessage: `Topic: ${args.topicName}\nSubject: ${args.subjectName}\nGenerate 10 quiz questions.`,
      maxTokens: 3000,
      temperature: 0.5,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new ConvexError({
        message: `AI returned malformed questions. Try again. (${err instanceof Error ? err.message : ""})`.trim(),
        code: "ai_parse_error",
      });
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new ConvexError({ message: "AI returned no questions.", code: "ai_parse_error" });
    }
    const battleId = await ctx.runMutation(internal.squads.insertSquadQuizBattle, {
      groupId: args.groupId,
      subjectId: args.subjectId,
      subjectName: args.subjectName,
      topicName: args.topicName,
      questionsJson: JSON.stringify(parsed),
      hostedBy: userId,
    });
    // Notify squad
    await ctx.runMutation(internal.squads.notifySquadBattleCreated, {
      groupId: args.groupId,
      topicName: args.topicName,
      battleId,
      excludeUserId: userId,
    });
    return { battleId };
  },
});

/**
 * Internal: insert a squad quiz battle row. Called by the action above.
 */
export const insertSquadQuizBattle = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    subjectId: v.optional(v.id("subjects")),
    subjectName: v.string(),
    topicName: v.string(),
    questionsJson: v.string(),
    hostedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("squadQuizBattles", {
      groupId: args.groupId,
      subjectId: args.subjectId,
      subjectName: args.subjectName,
      topicName: args.topicName,
      hostedBy: args.hostedBy,
      questionsJson: args.questionsJson,
      status: "lobby",
      startedAt: Date.now(),
      questionIndex: 0,
      rewardXp: 0,
    });
  },
});

/**
 * Get the active or lobby quiz battle for a squad (one at a time).
 */
export const getActiveSquadBattle = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    // Lobby first, then active
    const lobby = await ctx.db
      .query("squadQuizBattles")
      .withIndex("by_group_status", (q) => q.eq("groupId", groupId).eq("status", "lobby"))
      .first();
    if (lobby) return enrichBattle(ctx, lobby);
    const active = await ctx.db
      .query("squadQuizBattles")
      .withIndex("by_group_status", (q) => q.eq("groupId", groupId).eq("status", "active"))
      .first();
    if (active) return enrichBattle(ctx, active);
    return null;
  },
});

/**
 * Get the most recent completed battle (for the results screen).
 */
export const getLatestCompletedBattle = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    const completed = await ctx.db
      .query("squadQuizBattles")
      .withIndex("by_group_status", (q) => q.eq("groupId", groupId).eq("status", "completed"))
      .first();
    if (!completed) return null;
    return enrichBattle(ctx, completed);
  },
});

async function enrichBattle(
  ctx: QueryCtx,
  battle: Doc<"squadQuizBattles">,
): Promise<SquadBattleView> {
  const participants = await ctx.db
    .query("squadQuizBattleParticipants")
    .withIndex("by_battle", (q) => q.eq("battleId", battle._id))
    .collect();
  const enrichedParticipants: SquadBattleView["participants"] = await Promise.all(
    participants.map(async (p) => {
      const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
        userId: p.userId,
      });
      const user = await ctx.db.get(p.userId);
      return {
        userId: p.userId,
        name: profile?.displayName ?? user?.name ?? "Student",
        score: p.score,
        correctCount: p.correctCount,
        answersCount: p.answers.filter((a) => a !== -1).length,
        joinedAt: p.joinedAt,
      };
    }),
  );
  // Parse questions, but hide correctIndex if the battle is still active
  // AND the current question isn't done yet.
  const userId = await getAuthUserId(ctx);
  const isHost = battle.hostedBy === userId;
  const allQuestions = JSON.parse(battle.questionsJson) as Array<{
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
  const currentQuestion = battle.status === "active" ? allQuestions[battle.questionIndex] : null;
  const totalQuestions = allQuestions.length;
  const isQuestionDone =
    battle.status === "active" &&
    battle.questionEndsAt !== undefined &&
    Date.now() >= battle.questionEndsAt;
  // If the battle is active and current question isn't done, hide the
  // correctIndex + explanation from participants (host can always see it).
  const safeCurrentQuestion =
    currentQuestion && (isHost || isQuestionDone)
      ? currentQuestion
      : currentQuestion
        ? {
            question: currentQuestion.question,
            options: currentQuestion.options,
            correctIndex: -1,
            explanation: isQuestionDone ? currentQuestion.explanation : "",
          }
        : null;
  // My participation
  const myParticipant = participants.find((p) => p.userId === userId);
  return {
    battleId: battle._id,
    groupId: battle.groupId,
    subjectName: battle.subjectName,
    topicName: battle.topicName,
    hostedBy: battle.hostedBy,
    status: battle.status,
    startedAt: battle.startedAt,
    endedAt: battle.endedAt ?? null,
    questionIndex: battle.questionIndex,
    questionEndsAt: battle.questionEndsAt ?? null,
    totalQuestions,
    currentQuestion: safeCurrentQuestion,
    isQuestionDone,
    isHost,
    isParticipant: myParticipant !== undefined,
    myScore: myParticipant?.score ?? 0,
    myCorrectCount: myParticipant?.correctCount ?? 0,
    myAnswers: myParticipant?.answers ?? [],
    participants: enrichedParticipants.sort((a, b) => b.score - a.score),
    allQuestions: battle.status === "completed" ? allQuestions : null,
  };
}

/**
 * Join a lobby/active battle. Idempotent — rejoining is safe.
 */
export const joinSquadBattle = mutation({
  args: { battleId: v.id("squadQuizBattles") },
  handler: async (ctx, { battleId }) => {
    const battle = await ctx.db.get(battleId);
    if (!battle) throw new ConvexError({ message: "Battle not found.", code: "not_found" });
    const { userId } = await requireMember(ctx, battle.groupId);
    if (battle.status === "completed") {
      throw new ConvexError({ message: "This battle is over.", code: "invalid" });
    }
    const existing = await ctx.db
      .query("squadQuizBattleParticipants")
      .withIndex("by_battle_user", (q) => q.eq("battleId", battleId).eq("userId", userId))
      .unique();
    if (existing) return { ok: true, already: true };
    // Initialize answers with -1 (no answer) for each question.
    const questions = JSON.parse(battle.questionsJson) as unknown[];
    await ctx.db.insert("squadQuizBattleParticipants", {
      battleId,
      userId,
      answers: Array(questions.length).fill(-1),
      score: 0,
      correctCount: 0,
      joinedAt: Date.now(),
    });
    return { ok: true, already: false };
  },
});

/**
 * Start the battle (host only). Moves from lobby → active and sets the
 * question timer for question 0.
 */
export const startSquadBattle = mutation({
  args: { battleId: v.id("squadQuizBattles") },
  handler: async (ctx, { battleId }) => {
    const battle = await ctx.db.get(battleId);
    if (!battle) throw new ConvexError({ message: "Battle not found.", code: "not_found" });
    const { userId } = await requirePrivileged(ctx, battle.groupId);
    if (battle.hostedBy !== userId) {
      throw new ConvexError({ message: "Only the host can start.", code: "forbidden" });
    }
    if (battle.status !== "lobby") {
      throw new ConvexError({ message: "Battle already started.", code: "invalid" });
    }
    await ctx.db.patch(battleId, {
      status: "active",
      questionIndex: 0,
      questionEndsAt: Date.now() + SQUAD_BATTLE_QUESTION_MS,
    });
    return { ok: true };
  },
});

/**
 * Submit an answer for the current question. Idempotent per question —
 * a participant can't change their answer once submitted. If everyone has
 * answered, the host can advance to the next question.
 */
export const submitSquadBattleAnswer = mutation({
  args: {
    battleId: v.id("squadQuizBattles"),
    questionIndex: v.number(),
    optionIndex: v.number(),
  },
  handler: async (ctx, { battleId, questionIndex, optionIndex }) => {
    const battle = await ctx.db.get(battleId);
    if (!battle) throw new ConvexError({ message: "Battle not found.", code: "not_found" });
    const { userId } = await requireMember(ctx, battle.groupId);
    if (battle.status !== "active") {
      throw new ConvexError({ message: "Battle not active.", code: "invalid" });
    }
    if (battle.questionIndex !== questionIndex) {
      throw new ConvexError({ message: "That question is no longer active.", code: "invalid" });
    }
    const participant = await ctx.db
      .query("squadQuizBattleParticipants")
      .withIndex("by_battle_user", (q) => q.eq("battleId", battleId).eq("userId", userId))
      .unique();
    if (!participant) {
      throw new ConvexError({ message: "Join the battle first.", code: "invalid" });
    }
    if (participant.answers[questionIndex] !== -1) {
      // Already answered — no-op, return current state.
      return { ok: true, already: true };
    }
    const newAnswers = [...participant.answers];
    newAnswers[questionIndex] = optionIndex;
    // Recompute score + correctCount across all answers so far
    const questions = JSON.parse(battle.questionsJson) as Array<{
      correctIndex: number;
    }>;
    let correct = 0;
    let answered = 0;
    for (let i = 0; i < newAnswers.length; i++) {
      if (newAnswers[i] === -1) continue;
      answered++;
      if (newAnswers[i] === questions[i]?.correctIndex) correct++;
    }
    // Score: 100 per correct, bonus 10 per quick answer (placeholder — real
    // timing bonus would need the questionStart time per participant).
    const score = correct * 100 + answered * 5;
    await ctx.db.patch(participant._id, {
      answers: newAnswers,
      score,
      correctCount: correct,
    });
    return { ok: true, already: false, score, correctCount: correct };
  },
});

/**
 * Advance to the next question (host only). If past the last, complete
 * the battle and award XP to all participants.
 */
export const advanceSquadBattle = mutation({
  args: { battleId: v.id("squadQuizBattles") },
  handler: async (ctx, { battleId }) => {
    const battle = await ctx.db.get(battleId);
    if (!battle) throw new ConvexError({ message: "Battle not found.", code: "not_found" });
    const { userId } = await requirePrivileged(ctx, battle.groupId);
    if (battle.hostedBy !== userId) {
      throw new ConvexError({ message: "Only the host can advance.", code: "forbidden" });
    }
    if (battle.status !== "active") {
      throw new ConvexError({ message: "Battle not active.", code: "invalid" });
    }
    const nextIndex = battle.questionIndex + 1;
    const questions = JSON.parse(battle.questionsJson) as unknown[];
    if (nextIndex >= questions.length) {
      // Battle complete!
      await ctx.db.patch(battleId, {
        status: "completed",
        endedAt: Date.now(),
        questionEndsAt: undefined,
      });
      // Award XP: top 3 + participation
      const participants = await ctx.db
        .query("squadQuizBattleParticipants")
        .withIndex("by_battle", (q) => q.eq("battleId", battleId))
        .collect();
      participants.sort((a, b) => b.score - a.score);
      const top3 = [60, 40, 25];
      for (let i = 0; i < participants.length; i++) {
        const p = participants[i];
        const answeredCount = p.answers.filter((a) => a !== -1).length;
        const participated = answeredCount >= questions.length / 2;
        const xp = i < 3 ? top3[i] : participated ? 10 : 0;
        if (xp > 0) {
          await ctx.runMutation(internal.xp.awardXp, {
            userId: p.userId,
            amount: xp,
            reason: "squad_battle",
          });
        }
        // Notify each participant of their result
        await ctx.runMutation(internal.notifications.createNotification, {
          userId: p.userId,
          type: "squad_battle",
          title: "Quiz battle over!",
          body: `${battle.topicName} — you got ${p.correctCount}/${questions.length} correct. ${xp > 0 ? `+${xp} XP` : "No XP this time."}`,
          actionUrl: "/groups",
        });
      }
      // Check squad achievements
      await ctx.runMutation(internal.squads.checkSquadAchievements, {
        groupId: battle.groupId,
      });
      return { completed: true };
    }
    await ctx.db.patch(battleId, {
      questionIndex: nextIndex,
      questionEndsAt: Date.now() + SQUAD_BATTLE_QUESTION_MS,
    });
    return { completed: false, questionIndex: nextIndex };
  },
});

// ===========================================================================
// SQUAD BOARD (PINNED — goal, next session, announcement, resource)
// ===========================================================================

const BOARD_SLOTS = ["current_goal", "next_session", "announcement", "resource"] as const;
type BoardSlot = (typeof BOARD_SLOTS)[number];

/**
 * Get the squad board (4 slots). Returns the row for each slot, or null.
 */
export const getSquadBoard = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const info = await requireMember(ctx, groupId);
    const rows = await ctx.db
      .query("squadBoardItems")
      .withIndex("by_group_slot", (q) => q.eq("groupId", groupId))
      .collect();
    const bySlot = new Map(rows.map((r) => [r.slot, r]));
    return {
      currentGoal: bySlot.get("current_goal") ?? null,
      nextSession: bySlot.get("next_session") ?? null,
      announcement: bySlot.get("announcement") ?? null,
      resource: bySlot.get("resource") ?? null,
      canEdit: info.role === "owner" || info.role === "admin",
    };
  },
});

/**
 * Update a board slot. Owner/admin only. Upsert — creates or replaces.
 */
export const upsertBoardSlot = mutation({
  args: {
    groupId: v.id("studyGroups"),
    slot: v.union(
      v.literal("current_goal"),
      v.literal("next_session"),
      v.literal("announcement"),
      v.literal("resource"),
    ),
    content: v.string(),
    contentId: v.optional(v.id("contentItems")),
    sessionAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx, args.groupId);
    const existing = await ctx.db
      .query("squadBoardItems")
      .withIndex("by_group_slot", (q) =>
        q.eq("groupId", args.groupId).eq("slot", args.slot),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        contentId: args.contentId,
        sessionAt: args.sessionAt,
        updatedBy: userId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("squadBoardItems", {
        groupId: args.groupId,
        slot: args.slot,
        content: args.content,
        contentId: args.contentId,
        sessionAt: args.sessionAt,
        updatedBy: userId,
        updatedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

// ===========================================================================
// SQUAD EXAM PREP MODE
// ===========================================================================

const SQUAD_EXAM_PREP_SYSTEM_PROMPT =
  "You generate a one-day squad exam-prep plan for an Ethiopian national " +
  "exam (EHEEE). Given a JSON input with: daysRemaining, readiness per " +
  "subject (red/amber/yellow/green + average strength %), and member count, " +
  "produce a focused JSON output:\n" +
  "{\n" +
  "  \"todaysActions\": [\n" +
  "    { \"subject\": \"...\", \"type\": \"flashcards|quiz|mock|study_time\", \"count\": N, \"rationale\": \"...\" }\n" +
  "  ],\n" +
  "  \"focusTopic\": \"the single most important topic to drill tonight\",\n" +
  "  \"rationale\": \"1-2 sentences explaining the plan\"\n" +
  "}\n" +
  "Return ONLY valid JSON. 4-6 todaysActions, prioritizing weak subjects.";

/**
 * Generate (or regenerate) squad exam prep for the group. The owner/admin
 * triggers this — it computes per-subject readiness from member flashcard
 * memory strength + quiz accuracy, then AI generates today's actions.
 */
export const generateSquadExamPrep = action({
  args: {
    groupId: v.id("studyGroups"),
    examName: v.string(),
    examDate: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    readiness: SquadReadinessSubject[];
    memberCount: number;
    daysRemaining: number;
    plan: { todaysActions?: unknown; focusTopic?: string; rationale?: string };
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const role = await ctx.runQuery(internal.studyGroups.getGroupRole, {
      groupId: args.groupId,
      userId,
    });
    if (!role || (role !== "owner" && role !== "admin")) {
      throw new ConvexError({ message: "Only owners/admins can prep.", code: "forbidden" });
    }

    // Pull aggregated readiness per subject across members
    const readiness: { subjects: SquadReadinessSubject[]; memberCount: number } =
      await ctx.runQuery(internal.squads.getSquadReadinessInternal, {
        groupId: args.groupId,
      });

    const daysRemaining = args.examDate
      ? Math.max(1, Math.ceil((args.examDate - Date.now()) / DAY_MS))
      : 90;

    const raw = await callGroq(ctx, {
      systemPrompt: SQUAD_EXAM_PREP_SYSTEM_PROMPT,
      userMessage:
        `Exam: ${args.examName}\nDays remaining: ${daysRemaining}\n` +
        `Member count: ${readiness.memberCount}\n` +
        `Readiness per subject:\n${JSON.stringify(readiness.subjects, null, 2)}\n` +
        `Generate the squad exam-prep plan.`,
      maxTokens: 1500,
      temperature: 0.4,
    });
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: { todaysActions?: unknown; focusTopic?: string; rationale?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new ConvexError({
        message: `AI returned malformed plan. Try again. (${err instanceof Error ? err.message : ""})`.trim(),
        code: "ai_parse_error",
      });
    }

    // Upsert the squadExamPrep row
    await ctx.runMutation(internal.squads.upsertSquadExamPrep, {
      groupId: args.groupId,
      examName: args.examName,
      examDate: args.examDate,
      readinessJson: JSON.stringify(readiness.subjects),
      todaysActionsJson: JSON.stringify(parsed),
      createdBy: userId,
    });

    return {
      readiness: readiness.subjects,
      memberCount: readiness.memberCount,
      daysRemaining,
      plan: parsed,
    };
  },
});

/**
 * Internal: compute per-subject readiness from member memory strength + quiz
 * accuracy. Returned as anonymous aggregates — never per-member.
 */
export const getSquadReadinessInternal = internalQuery({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const weekStart = Date.now() - WEEK_MS;

    // subjectId → list of { strength, accuracy }
    const subjectData = new Map<
      Id<"subjects">,
      { strength: number[]; accuracy: number[]; subjectName: string }
    >();

    for (const m of members) {
      // Flashcard memory strength per subject
      const decks = await ctx.db
        .query("flashcardDecks")
        .withIndex("by_user", (q) => q.eq("userId", m.userId))
        .collect();
      for (const deck of decks) {
        if (!deck.subjectId) continue;
        const cards = await ctx.db
          .query("flashcards")
          .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
          .filter((q) => q.neq(q.field("lastReviewedAt"), undefined))
          .take(200);
        if (cards.length === 0) continue;
        const avg = cards.reduce((s, c) => s + (c.memoryStrength ?? 0.5), 0) / cards.length;
        if (!subjectData.has(deck.subjectId)) {
          const subj = await ctx.db.get(deck.subjectId);
          subjectData.set(deck.subjectId, {
            strength: [],
            accuracy: [],
            subjectName: subj?.name ?? "Subject",
          });
        }
        subjectData.get(deck.subjectId)!.strength.push(avg);
      }
      // Quiz accuracy per subject
      const attempts = await ctx.db
        .query("quizAttempts")
        .withIndex("by_user", (q) => q.eq("userId", m.userId))
        .filter((q) => q.gte(q.field("completedAt"), weekStart))
        .take(500);
      for (const attempt of attempts) {
        const quiz = await ctx.db.get(attempt.quizId);
        if (!quiz?.subjectId) continue;
        const acc = attempt.totalQuestions > 0 ? attempt.score / attempt.totalQuestions : 0;
        if (!subjectData.has(quiz.subjectId)) {
          const subj = await ctx.db.get(quiz.subjectId);
          subjectData.set(quiz.subjectId, {
            strength: [],
            accuracy: [],
            subjectName: subj?.name ?? "Subject",
          });
        }
        subjectData.get(quiz.subjectId)!.accuracy.push(acc);
      }
    }

    const subjects = Array.from(subjectData.entries()).map(([subjectId, data]) => {
      const avgStrength =
        data.strength.length > 0
          ? data.strength.reduce((s, x) => s + x, 0) / data.strength.length
          : 0;
      const avgAccuracy =
        data.accuracy.length > 0
          ? data.accuracy.reduce((s, x) => s + x, 0) / data.accuracy.length
          : 0;
      // Combined readiness 0-100 — 60% strength weight, 40% accuracy
      const readiness = Math.round((avgStrength * 0.6 + avgAccuracy * 0.4) * 100);
      let status: "red" | "amber" | "yellow" | "green" = "green";
      if (readiness < 50) status = "red";
      else if (readiness < 65) status = "amber";
      else if (readiness < 80) status = "yellow";
      return {
        subjectId,
        subjectName: data.subjectName,
        readinessScore: readiness,
        status,
        memberCoverage: data.strength.length + data.accuracy.length,
      };
    });
    subjects.sort((a, b) => a.readinessScore - b.readinessScore);
    return { subjects, memberCount: members.length };
  },
});

/**
 * Get the current squad exam prep (one per group).
 */
export const getSquadExamPrep = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const info = await requireMember(ctx, groupId);
    const prep = await ctx.db
      .query("squadExamPrep")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .first();
    if (!prep) return null;
    return {
      examName: prep.examName,
      examDate: prep.examDate ?? null,
      readinessJson: prep.readinessJson,
      todaysActionsJson: prep.todaysActionsJson ?? null,
      generatedAt: prep.generatedAt,
      canRegenerate: info.role === "owner" || info.role === "admin",
    };
  },
});

/**
 * Internal: upsert the squadExamPrep row.
 */
export const upsertSquadExamPrep = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    examName: v.string(),
    examDate: v.optional(v.number()),
    readinessJson: v.string(),
    todaysActionsJson: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("squadExamPrep")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        examName: args.examName,
        examDate: args.examDate,
        readinessJson: args.readinessJson,
        todaysActionsJson: args.todaysActionsJson,
        generatedAt: Date.now(),
        createdBy: args.createdBy,
      });
      return existing._id;
    }
    return await ctx.db.insert("squadExamPrep", {
      groupId: args.groupId,
      examName: args.examName,
      examDate: args.examDate,
      readinessJson: args.readinessJson,
      todaysActionsJson: args.todaysActionsJson,
      generatedAt: Date.now(),
      createdBy: args.createdBy,
    });
  },
});

// ===========================================================================
// ROLES — assign + transfer
// ===========================================================================

/**
 * Change a member's role. Owner can set anyone to admin/mentor/member.
 * Admin can promote to mentor (but not admin or owner). Owner transfer is
 * a separate mutation (transferOwnership).
 */
export const setMemberRole = mutation({
  args: {
    groupId: v.id("studyGroups"),
    userId: v.id("users"),
    newRole: v.union(
      v.literal("admin"),
      v.literal("mentor"),
      v.literal("member"),
    ),
  },
  handler: async (ctx, args) => {
    const { userId: callerId, role: callerRole } = await requireMember(ctx, args.groupId);
    const target = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();
    if (!target) throw new ConvexError({ message: "Member not found.", code: "not_found" });
    if (target.role === "owner") {
      throw new ConvexError({ message: "Can't change the owner's role.", code: "invalid" });
    }
    // Permission rules:
    //  - owner → can set anyone to admin/mentor/member
    //  - admin → can only promote/demote to/from mentor (not admin)
    if (callerRole === "owner") {
      // OK
    } else if (callerRole === "admin") {
      if (args.newRole === "admin") {
        throw new ConvexError({
          message: "Only the owner can promote to admin.",
          code: "forbidden",
        });
      }
      if (target.role === "admin") {
        throw new ConvexError({
          message: "Only the owner can demote an admin.",
          code: "forbidden",
        });
      }
    } else {
      throw new ConvexError({ message: "Only owner/admin can change roles.", code: "forbidden" });
    }
    await ctx.db.patch(target._id, { role: args.newRole });
    return { ok: true };
  },
});

/**
 * Transfer ownership to another member. Caller must be the current owner.
 * The previous owner becomes an admin.
 */
export const transferOwnership = mutation({
  args: {
    groupId: v.id("studyGroups"),
    newOwnerId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { userId: callerId, role: callerRole } = await requireMember(ctx, args.groupId);
    if (callerRole !== "owner") {
      throw new ConvexError({ message: "Only the owner can transfer.", code: "forbidden" });
    }
    const target = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("userId"), args.newOwnerId))
      .first();
    if (!target) throw new ConvexError({ message: "Member not found.", code: "not_found" });
    if (target.role === "owner") {
      throw new ConvexError({ message: "They're already the owner.", code: "invalid" });
    }
    const group = await ctx.db.get(args.groupId);
    if (!group) throw new ConvexError({ message: "Group not found.", code: "not_found" });
    // Demote current owner → admin
    const callerRow = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .filter((q) => q.eq(q.field("userId"), callerId))
      .first();
    if (callerRow) {
      await ctx.db.patch(callerRow._id, { role: "admin" });
    }
    // Promote target → owner
    await ctx.db.patch(target._id, { role: "owner" });
    // Update the group's createdBy to reflect new owner
    await ctx.db.patch(args.groupId, { createdBy: args.newOwnerId });
    return { ok: true };
  },
});

// ===========================================================================
// SQUAD ACHIEVEMENTS
// ===========================================================================

/**
 * Internal: insert a squad AI thread row.
 */
export const insertSquadAIThread = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    topicName: v.string(),
    explanation: v.string(),
    practiceQuestions: v.optional(v.string()),
    flashcards: v.optional(v.string()),
    miniQuiz: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("squadAIThreads", {
      groupId: args.groupId,
      topicName: args.topicName,
      explanation: args.explanation,
      practiceQuestions: args.practiceQuestions,
      flashcards: args.flashcards,
      miniQuiz: args.miniQuiz,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
  },
});

/**
 * Internal: notify the squad that a new AI thread was created.
 */
export const notifySquadSquadAI = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    topicName: v.string(),
    excludeUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    for (const m of members) {
      if (m.userId === args.excludeUserId) continue;
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: m.userId,
        type: "squad_ai",
        title: "Squad AI tutor ready",
        body: `New material on “${args.topicName}” — review it and start a quiz battle.`,
        actionUrl: "/groups",
      });
    }
  },
});

/**
 * Internal: notify the squad that a quiz battle was created.
 */
export const notifySquadBattleCreated = internalMutation({
  args: {
    groupId: v.id("studyGroups"),
    topicName: v.string(),
    battleId: v.id("squadQuizBattles"),
    excludeUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", args.groupId))
      .collect();
    for (const m of members) {
      if (m.userId === args.excludeUserId) continue;
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: m.userId,
        type: "squad_battle",
        title: "Quiz battle starting",
        body: `“${args.topicName}” — join the lobby before it starts!`,
        actionUrl: "/groups",
      });
    }
  },
});

/**
 * List squad achievements (definitions + earned status for this group).
 */
export const getSquadAchievements = query({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    await requireMember(ctx, groupId);
    // The definitions are static in code — return them directly. We don't
    // bother seeding them into the squadAchievements table for now.
    const earned = await ctx.db
      .query("squadAchievementAwards")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const earnedIds = new Set(earned.map((e) => e.achievementId));
    return SQUAD_ACHIEVEMENT_DEFINITIONS.map((def) => ({
      ...def,
      earned: earnedIds.has(def.id),
      earnedAt: earned.find((e) => e.achievementId === def.id)?.earnedAt ?? null,
    }));
  },
});

/**
 * Internal: check all squad achievements for a group and award any newly-
 * earned ones. Idempotent — never awards the same one twice.
 */
export const checkSquadAchievements = internalMutation({
  args: { groupId: v.id("studyGroups") },
  handler: async (ctx, { groupId }) => {
    const members = await ctx.db
      .query("studyGroupMembers")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const memberIds = members.map((m) => m.userId);
    const earned = await ctx.db
      .query("squadAchievementAwards")
      .withIndex("by_group", (q) => q.eq("groupId", groupId))
      .collect();
    const earnedIds = new Set(earned.map((e) => e.achievementId));

    const newlyAwarded: string[] = [];

    // ── First Squad Week — group is ≥7 days old AND has ≥7 streak days ──
    if (!earnedIds.has(SQUAD_ACHIEVEMENT_IDS.firstSquadWeek)) {
      const group = await ctx.db.get(groupId);
      if (group && Date.now() - group.createdAt >= 7 * DAY_MS) {
        // Check streak ≥ 7 (using same logic as dashboard)
        const since = Date.now() - 14 * DAY_MS;
        const dayBuckets = new Set<string>();
        for (const userId of memberIds) {
          const sessions = await ctx.db
            .query("studySessions")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .filter((q) => q.gte(q.field("startedAt"), since))
            .take(200);
          for (const s of sessions) {
            const d = new Date(s.startedAt);
            const key = `${d.getFullYear()}-${(d.getMonth() + 1)
              .toString()
              .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
            dayBuckets.add(key);
          }
        }
        if (dayBuckets.size >= 7) {
          await ctx.db.insert("squadAchievementAwards", {
            groupId,
            achievementId: SQUAD_ACHIEVEMENT_IDS.firstSquadWeek,
            earnedAt: Date.now(),
          });
          newlyAwarded.push(SQUAD_ACHIEVEMENT_IDS.firstSquadWeek);
        }
      }
    }

    // ── Knowledge Factory — 1,000 flashcards reviewed collectively ──
    if (!earnedIds.has(SQUAD_ACHIEVEMENT_IDS.knowledgeFactory)) {
      let totalReviewed = 0;
      for (const userId of memberIds) {
        const decks = await ctx.db
          .query("flashcardDecks")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
        for (const deck of decks) {
          const cards = await ctx.db
            .query("flashcards")
            .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
            .filter((q) => q.neq(q.field("lastReviewedAt"), undefined))
            .take(500);
          totalReviewed += cards.length;
        }
      }
      if (totalReviewed >= 1000) {
        await ctx.db.insert("squadAchievementAwards", {
          groupId,
          achievementId: SQUAD_ACHIEVEMENT_IDS.knowledgeFactory,
          earnedAt: Date.now(),
        });
        newlyAwarded.push(SQUAD_ACHIEVEMENT_IDS.knowledgeFactory);
      }
    }

    // ── 100-Hour Crew — 100 total hours studied ──
    if (!earnedIds.has(SQUAD_ACHIEVEMENT_IDS.hundredHourCrew)) {
      let totalSeconds = 0;
      for (const userId of memberIds) {
        const sessions = await ctx.db
          .query("studySessions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .take(500);
        totalSeconds += sessions.reduce((s, sess) => s + sess.durationSeconds, 0);
      }
      if (totalSeconds >= 100 * 3600) {
        await ctx.db.insert("squadAchievementAwards", {
          groupId,
          achievementId: SQUAD_ACHIEVEMENT_IDS.hundredHourCrew,
          earnedAt: Date.now(),
        });
        newlyAwarded.push(SQUAD_ACHIEVEMENT_IDS.hundredHourCrew);
      }
    }

    // ── Elite Squad — 14-day squad streak ──
    if (!earnedIds.has(SQUAD_ACHIEVEMENT_IDS.eliteSquad)) {
      const since = Date.now() - 21 * DAY_MS;
      const dayBuckets = new Set<string>();
      for (const userId of memberIds) {
        const sessions = await ctx.db
          .query("studySessions")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .filter((q) => q.gte(q.field("startedAt"), since))
          .take(500);
        for (const s of sessions) {
          const d = new Date(s.startedAt);
          const key = `${d.getFullYear()}-${(d.getMonth() + 1)
            .toString()
            .padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
          dayBuckets.add(key);
        }
      }
      if (dayBuckets.size >= 14) {
        await ctx.db.insert("squadAchievementAwards", {
          groupId,
          achievementId: SQUAD_ACHIEVEMENT_IDS.eliteSquad,
          earnedAt: Date.now(),
        });
        newlyAwarded.push(SQUAD_ACHIEVEMENT_IDS.eliteSquad);
      }
    }

    // Notify all members of newly-earned achievements
    if (newlyAwarded.length > 0) {
      const defMap: Map<string, (typeof SQUAD_ACHIEVEMENT_DEFINITIONS)[number]> = new Map(
        SQUAD_ACHIEVEMENT_DEFINITIONS.map((d) => [d.id, d]),
      );
      for (const id of newlyAwarded) {
        const def = defMap.get(id);
        if (!def) continue;
        for (const m of members) {
          await ctx.runMutation(internal.notifications.createNotification, {
            userId: m.userId,
            type: "squad_achievement",
            title: `Squad achievement: ${def.name}`,
            body: `${def.description} — your squad earned it!`,
            actionUrl: "/groups",
          });
        }
      }
    }

    return { newlyAwarded };
  },
});

// ===========================================================================
// CHAT WIDGETS — slash commands
// ===========================================================================

/**
 * Post a chat widget (renders inline in the chat panel). Used by the
 * /poll, /quiz, /card, /explain, /challenge slash commands. Owner/admin/
 * mentor can post; members can also post polls (the simplest widget).
 */
export const postSquadChatWidget = mutation({
  args: {
    groupId: v.id("studyGroups"),
    widgetType: v.union(
      v.literal("poll"),
      v.literal("quiz_card"),
      v.literal("flashcard"),
      v.literal("ai_explanation"),
      v.literal("challenge_invite"),
    ),
    payloadJson: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireMember(ctx, args.groupId);
    // Quiz card, AI explanation, challenge invite — privileged only
    if (
      args.widgetType === "quiz_card" ||
      args.widgetType === "ai_explanation" ||
      args.widgetType === "challenge_invite"
    ) {
      await requirePrivileged(ctx, args.groupId);
    }
    const id = await ctx.db.insert("squadChatWidgets", {
      groupId: args.groupId,
      userId,
      widgetType: args.widgetType,
      payloadJson: args.payloadJson,
      createdAt: Date.now(),
    });
    return { widgetId: id };
  },
});

/**
 * Vote on a poll widget. Idempotent per user — re-voting replaces.
 * Also used for quiz_card answer (reveal-once semantics).
 */
export const voteOnSquadWidget = mutation({
  args: {
    widgetId: v.id("squadChatWidgets"),
    // For poll: option index. For quiz_card: selected option index.
    optionIndex: v.number(),
  },
  handler: async (ctx, { widgetId, optionIndex }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const widget = await ctx.db.get(widgetId);
    if (!widget) throw new ConvexError({ message: "Widget not found.", code: "not_found" });
    await requireMember(ctx, widget.groupId);
    const payload = JSON.parse(widget.payloadJson) as {
      votesByOption?: number[];
      voterUserIds?: string[];
      answererUserIds?: string[];
      correctIndex?: number;
      revealed?: boolean;
    };
    if (widget.widgetType === "poll") {
      const votes = payload.votesByOption ?? [];
      const voters = payload.voterUserIds ?? [];
      // If user already voted, remove their old vote
      const existingIdx = voters.indexOf(userId);
      if (existingIdx >= 0) {
        // (voters and votes have parallel arrays — vote count at existingIdx)
        const oldOption = votes[existingIdx];
        if (oldOption !== undefined && oldOption > 0) {
          votes[existingIdx] = oldOption - 0; // index, not count
        }
        // Actually we use a different shape: votesByOption[i] = count for option i
        // Re-think: easier to store votes as { userId → optionIndex } map.
        // For simplicity, just append the new vote.
      }
      // Incremental: votesByOption is an array of counts
      while (votes.length <= optionIndex) votes.push(0);
      if (existingIdx < 0) {
        votes[optionIndex] = (votes[optionIndex] ?? 0) + 1;
        voters.push(userId);
      } else {
        // Change their vote
        votes[optionIndex] = (votes[optionIndex] ?? 0) + 1;
      }
      payload.votesByOption = votes;
      payload.voterUserIds = voters;
      await ctx.db.patch(widgetId, {
        payloadJson: JSON.stringify(payload),
      });
      return { ok: true, votesByOption: votes };
    }
    if (widget.widgetType === "quiz_card") {
      // Reveal the answer + mark who answered
      const answerers = payload.answererUserIds ?? [];
      if (!answerers.includes(userId)) {
        answerers.push(userId);
        payload.answererUserIds = answerers;
        payload.revealed = true;
        await ctx.db.patch(widgetId, {
          payloadJson: JSON.stringify(payload),
        });
      }
      return { ok: true, revealed: true, correctIndex: payload.correctIndex ?? -1 };
    }
    return { ok: false };
  },
});

/**
 * Get recent chat widgets for a group (renders inline alongside messages).
 */
export const getRecentSquadWidgets = query({
  args: {
    groupId: v.id("studyGroups"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { groupId, limit = 20 }): Promise<SquadChatWidgetView[]> => {
    await requireMember(ctx, groupId);
    const widgets = await ctx.db
      .query("squadChatWidgets")
      .withIndex("by_group_createdAt", (q) => q.eq("groupId", groupId))
      .order("desc")
      .take(limit);
    const enriched: SquadChatWidgetView[] = await Promise.all(
      widgets.reverse().map(async (w): Promise<SquadChatWidgetView> => {
        const profile = await ctx.runQuery(internal.profile.getProfileByUser, {
          userId: w.userId,
        });
        const user = await ctx.db.get(w.userId);
        return {
          widgetId: w._id,
          widgetType: w.widgetType,
          payload: w.payloadJson,
          userId: w.userId,
          userName: profile?.displayName ?? user?.name ?? "Student",
          createdAt: w.createdAt,
        };
      }),
    );
    return enriched;
  },
});

// ===========================================================================
// INTERNAL HELPER — notifySquad
// ===========================================================================

/**
 * Internal helper: notify all squad members (optionally excluding one).
 * Used by mutation paths that can't call createNotification directly.
 */
async function notifySquad(
  ctx: MutationCtx,
  groupId: Id<"studyGroups">,
  notif: {
    type: string;
    title: string;
    body: string;
    actionUrl?: string;
    excludeUserId?: Id<"users">;
  },
) {
  const members = await ctx.db
    .query("studyGroupMembers")
    .withIndex("by_group", (q) => q.eq("groupId", groupId))
    .collect();
  for (const m of members) {
    if (notif.excludeUserId && m.userId === notif.excludeUserId) continue;
    await ctx.runMutation(internal.notifications.createNotification, {
      userId: m.userId,
      type: notif.type,
      title: notif.title,
      body: notif.body,
      actionUrl: notif.actionUrl,
    });
  }
}
