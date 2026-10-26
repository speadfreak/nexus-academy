// Daily challenge — one AI-generated question per subject per day, the SAME
// question for every student (deterministic by Addis date + subject, cached in
// dailyChallenges so it's generated once per day, not once per user).
//
// Free tier gets this OUTSIDE the quiz weekly cap — it's a light daily
// touch-point, not a premium feature. One attempt per subject per day: answer,
// instant feedback, done. XP is only earned for a correct answer; completing
// the challenge (right or wrong) keeps the streak alive exactly like a focus
// session — engagement is rewarded, mastery is what earns points.
//
// Timezone: the challenge day is Africa/Addis_Ababa (UTC+3, same fixed zone
// the streak reminders use), so every student in Ethiopia sees the same
// question reset at the same midnight.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { STREAM_SPECIFIC_SUBJECT_SLUGS, XP_VALUES } from "./constants";
import { addisDateKey } from "./reminders";
import { parseAndValidate, requestQuestions, type QuizQuestion } from "./quizzes";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The subjects a student sees in their daily challenge: their stream's three
 * subjects plus the shared subjects (English, Mathematics, SAT — stored with
 * stream "common"). Legacy profiles without a stream get everything.
 */
function computeWantedSubjects(
  subjects: Doc<"subjects">[],
  stream: string | null | undefined,
): Doc<"subjects">[] {
  if (stream === "natural" || stream === "social") {
    const slugs = new Set<string>(STREAM_SPECIFIC_SUBJECT_SLUGS[stream]);
    return subjects.filter((s) => slugs.has(s.slug) || s.stream === "common");
  }
  return subjects;
}

/** One row of the dashboard's daily-challenge view. */
export interface ChallengeView {
  subjectId: Id<"subjects">;
  subjectName: string;
  stream: string;
  question: string | null;
  options: string[];
  answered: boolean;
  answeredCorrectly: boolean | null;
  // Explanation is only surfaced AFTER answering — the question itself
  // never leaks the correct answer.
  explanation: string | null;
}

export interface SubmitChallengeResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  xpAwarded: number;
  levelUp: boolean;
  newLevel: number;
  streakExtended: boolean;
  currentStreak: number;
  newAchievements: { id: string; name: string; tier: "bronze" | "silver" | "gold" }[];
}

// ---------------------------------------------------------------------------
// Internal plumbing
// ---------------------------------------------------------------------------

export const listAllSubjects = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db.query("subjects").collect(),
});

export const getChallengeForDateSubject = internalQuery({
  args: {
    challengeDate: v.string(),
    subjectId: v.id("subjects"),
  },
  handler: async (ctx, { challengeDate, subjectId }) =>
    ((await ctx.db
      .query("dailyChallenges")
      .withIndex("by_date_subject", (q) =>
        q.eq("challengeDate", challengeDate).eq("subjectId", subjectId),
      )
      .order("asc").take(1))[0]) ?? null,
});

/**
 * ATOMIC CHALLENGE ENSURE — the correctness backstop for concurrent
 * generation. ensureDailyChallenges (an ACTION) used to check-then-insert
 * across the action→mutation boundary: two dashboard loads racing on a cold
 * cache both saw "missing" and BOTH inserted, producing duplicate
 * (challengeDate, subjectId) rows. With every reader on .unique(), that
 * duplicate then hard-crashed getTodaysChallenges for EVERY student — a
 * full-day dashboard outage until the rows were removed by hand.
 *
 * Convex mutations are serializable, so check-and-insert inside ONE
 * mutation is a true conditional insert: exactly one of N concurrent
 * callers creates the row; the rest get the winner back. The action's
 * pre-check still skips the (paid) AI generation when a row exists.
 */
export const ensureChallenge = internalMutation({
  args: {
    challengeDate: v.string(),
    subjectId: v.id("subjects"),
    questionJson: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ created: boolean; challengeId: Id<"dailyChallenges"> | null }> => {
    const existing = (await ctx.db
      .query("dailyChallenges")
      .withIndex("by_date_subject", (q) =>
        q.eq("challengeDate", args.challengeDate).eq("subjectId", args.subjectId),
      )
      .order("asc").take(1))[0];
    if (existing) return { created: false, challengeId: existing._id };
    const id = await ctx.db.insert("dailyChallenges", {
      ...args,
      createdAt: Date.now(),
    });
    return { created: true, challengeId: id };
  },
});

/**
 * DEDUPE SWEEP — collapse any duplicate (challengeDate, subjectId) rows to
 * the earliest-created winner, deleting the rest. Attempts reference
 * (userId, challengeDate, subjectId) — NOT the challenge row id — so student
 * history stays valid under any winner. collect() returns rows in
 * _creationTime order, so the FIRST row seen per key is the canonical
 * keeper. Idempotent; returns exactly what it removed for auditability.
 * Run again (ops) until it reports removed: 0.
 */
export const dedupeDailyChallenges = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("dailyChallenges").collect();
    const seen = new Set<string>();
    let removed = 0;
    const removedKeys: string[] = [];
    for (const row of rows) {
      const key = `${row.challengeDate}|${row.subjectId}`;
      if (!seen.has(key)) {
        seen.add(key);
        continue;
      }
      await ctx.db.delete(row._id);
      removed += 1;
      removedKeys.push(key);
    }
    return { total: rows.length, unique: seen.size, removed, removedKeys };
  },
});

/** The dashboard view for one user on one date (shared by action + query). */
export const getChallengesViewInternal = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(),
  },
  handler: async (ctx, { userId, date }): Promise<ChallengeView[]> => {
    const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
    const subjects = await ctx.db.query("subjects").collect();
    const wanted = computeWantedSubjects(subjects, profile?.stream);

    const attempts = await ctx.db
      .query("dailyChallengeAttempts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    const attemptsForDate = attempts.filter((a) => a.challengeDate === date);

    const result = [];
    for (const subject of wanted) {
      const challenge = (await ctx.db
        .query("dailyChallenges")
        .withIndex("by_date_subject", (q) =>
          q.eq("challengeDate", date).eq("subjectId", subject._id),
        )
        .order("asc").take(1))[0];
      let question: QuizQuestion | null = null;
      if (challenge) {
        try {
          question = JSON.parse(challenge.questionJson) as QuizQuestion;
        } catch {
          question = null;
        }
      }
      const attempt = attemptsForDate.find((a) => a.subjectId === subject._id);
      result.push({
        subjectId: subject._id,
        subjectName: subject.name,
        stream: subject.stream,
        question: question?.question ?? null,
        options: question?.options ?? [],
        answered: attempt !== undefined,
        answeredCorrectly: attempt ? attempt.answeredCorrectly : null,
        // Explanation is only surfaced AFTER answering — the question itself
        // never leaks the correct answer.
        explanation: attempt && question ? question.explanation : null,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Generation (action) + reads
// ---------------------------------------------------------------------------

/**
 * Generates today's missing challenges for the user's stream subjects (cached
 * in dailyChallenges — one call per subject per day globally), then returns
 * the full view. The dashboard fires this on load; it's idempotent, so the
 * second user of the day pays nothing.
 */
export const ensureDailyChallenges = action({
  args: {},
  handler: async (ctx): Promise<{ date: string; challenges: ChallengeView[]; generated: number }> => {
    const userId = await getAuthUserId(ctx);
    const date = addisDateKey();
    if (!userId) return { date, challenges: [], generated: 0 };

    const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
    const subjects = await ctx.runQuery(internal.dailyChallenge.listAllSubjects, {});
    const wanted = computeWantedSubjects(subjects, profile?.stream);

    let generated = 0;
    for (const subject of wanted) {
      const existing = await ctx.runQuery(internal.dailyChallenge.getChallengeForDateSubject, {
        challengeDate: date,
        subjectId: subject._id,
      });
      if (existing) continue;

      // ActionCtx.runQuery is deliberately untyped (any) — annotate the rows.
      const topics: Doc<"topics">[] = await ctx.runQuery(internal.ai.listTopicsBySubject, {
        subjectId: subject._id,
      });
      const topicNames = topics.map((t) => t.name);

      let question: QuizQuestion | null = null;
      for (let attempt = 0; attempt < 2 && question === null; attempt++) {
        try {
          const raw = await requestQuestions(
            ctx,
            subject.name,
            subject.stream,
            topicNames.length > 0 ? topicNames : [subject.name],
            1,
          );
          const parsed = parseAndValidate(raw, 1);
          question = parsed[0] ?? null;
        } catch {
          // retry once, then skip this subject — never store garbage
        }
      }
      if (!question) continue;

      const res = await ctx.runMutation(internal.dailyChallenge.ensureChallenge, {
        challengeDate: date,
        subjectId: subject._id,
        questionJson: JSON.stringify(question),
      });
      if (res.created) generated += 1;
    }

    const challenges: ChallengeView[] = await ctx.runQuery(
      internal.dailyChallenge.getChallengesViewInternal,
      { userId, date },
    );
    return { date, challenges, generated };
  },
});

/** Reactive view — challenges appear as the action caches them. */
export const getTodaysChallenges = query({
  args: {},
  handler: async (ctx): Promise<ChallengeView[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.runQuery(internal.dailyChallenge.getChallengesViewInternal, {
      userId,
      date: addisDateKey(),
    });
  },
});

// ---------------------------------------------------------------------------
// Answering — server-side scoring, one attempt per subject per day
// ---------------------------------------------------------------------------

export const submitDailyChallenge = mutation({
  args: {
    subjectId: v.id("subjects"),
    answer: v.number(),
  },
  handler: async (ctx, { subjectId, answer }): Promise<SubmitChallengeResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
      throw new ConvexError({ message: "Pick one of the four options.", code: "invalid" });
    }

    const date = addisDateKey();
    const challenge = (await ctx.db
      .query("dailyChallenges")
      .withIndex("by_date_subject", (q) =>
        q.eq("challengeDate", date).eq("subjectId", subjectId),
      )
      .order("asc").take(1))[0];
    if (!challenge) {
      throw new ConvexError({
        message: "Today's challenge isn't ready yet — give it a moment and try again.",
        code: "not_found",
      });
    }

    // One attempt per user per subject per day — no brute-forcing for XP.
    const attempts = await ctx.db
      .query("dailyChallengeAttempts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);
    const prior = attempts.find(
      (a) => a.challengeDate === date && a.subjectId === subjectId,
    );
    if (prior) {
      throw new ConvexError({
        message: "You've already answered today's challenge for this subject — come back tomorrow for a fresh one.",
        code: "already_answered",
      });
    }

    let question: QuizQuestion;
    try {
      question = JSON.parse(challenge.questionJson) as QuizQuestion;
    } catch {
      throw new ConvexError({ message: "Challenge data is corrupted.", code: "internal" });
    }

    // Score server-side from the stored question — never from the client.
    const correct = answer === question.correctIndex;
    await ctx.db.insert("dailyChallengeAttempts", {
      userId,
      challengeDate: date,
      subjectId,
      answeredCorrectly: correct,
      completedAt: Date.now(),
    });

    // XP only for a correct answer; wrong answers still get feedback + the
    // streak contribution (habit is the point of the challenge).
    let xpAwarded = 0;
    let levelUp = false;
    let newLevel = 1;
    if (correct) {
      const award = await ctx.runMutation(internal.xp.awardXp, {
        userId,
        amount: XP_VALUES.daily_challenge,
        reason: "daily_challenge",
      });
      xpAwarded = award.xpAwarded;
      levelUp = award.levelUp;
      newLevel = award.level;
    }

    // Contributing to the streak exactly like a study session (hours = 0).
    const streak = await ctx.runMutation(internal.studySessions.recordStudyDay, {
      userId,
      localDate: date,
      hours: 0,
    });

    // Learning loop: a missed challenge lands in the shared mistake ledger
    // (with its explanation) so tomorrow's review queue includes it. The
    // challenge question is AI-written and not topic-tagged, so it feeds
    // the ledger only — honest provenance, no fabricated topic evidence.
    if (!correct) {
      await ctx.runMutation(internal.learning.ingestQuestionOutcomes, {
        subjectId,
        source: "daily_challenge",
        sourceRefId: date,
        outcomes: [
          {
            questionKey: date,
            questionText: question.question,
            options: question.options,
            correctAnswer:
              question.options[question.correctIndex] ??
              `Option ${String.fromCharCode(65 + question.correctIndex)}`,
            studentAnswer: question.options[answer],
            explanation: question.explanation,
            origin: "ai_generated" as const,
            correct: false,
          },
        ],
      });
    }

    // Idempotent sweep — daily_challenge_first achievement.
    const newly = await ctx.runMutation(internal.achievements.checkAndAward, { userId });

    return {
      correct,
      correctIndex: question.correctIndex,
      explanation: question.explanation,
      xpAwarded,
      levelUp,
      newLevel,
      streakExtended: streak.newDayRecorded,
      currentStreak: streak.currentStreak,
      newAchievements: newly.map((a) => ({
        id: a.id,
        name: a.name,
        tier: a.tier,
      })),
    };
  },
});
