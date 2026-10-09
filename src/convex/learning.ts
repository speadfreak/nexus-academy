// THE LEARNING LOOP ENGINE (2.0) — evidence, mistakes, revision, next action.
//
// One shared pipeline every scored activity feeds. Design contract:
//
//   ATTEMPT ──▶ ingestQuestionOutcomes ──▶ topicMastery (evidence)
//                                       └▶ mistakes    (ledger + SRS)
//   DASHBOARD ─▶ getNextAction (honest, evidence-derived recommendation)
//   MISTAKE LAB ▶ listMistakes / reviewMistake (spaced revision)
//   EXAM TWIN ──▶ getTopicMasteryForUser (assessed vs low-evidence topics)
//   PRACTICE ───▶ findSimilarPractice / startMistakePractice /
//                 submitMistakePractice / completeMistakePractice
//                 (real past-paper questions on the SAME canonical topic,
//                 server-scored against the paper's own key, one review
//                 event per session through the SAME ladder)
//
// HONESTY RULES (non-negotiable, same spirit as the digital exam engine):
//   - Mastery is computed ONLY from questions the student actually answered.
//     No evidence → no score, no fake percentages, no fabricated predictions.
//   - The correct answer recorded on a mistake is the one the verified key
//     / server scorer produced at attempt time. The AI never overwrites it.
//   - Confidence labels are derived from evidence counts and say so.
//   - Readiness signals are described as signals, never as exam predictions.
//
// ADDITIVE BY DESIGN: every existing attempt table (quizAttempts,
// examPrepAttempts, mockExamSections, dailyChallengeAttempts) keeps its
// exact shape — this module only READS outcome data handed to it and writes
// to the two new tables (topicMastery, mistakes).

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isPremiumStatus } from "./subscriptions";

// ── Tuning constants (documented + testable) ─────────────────────────────

// Evidence window: the last N outcomes per topic drive the mastery score.
const EVIDENCE_WINDOW = 20;
// Exponential recency decay — newest outcome weighs 1, each older one ×0.85.
// Mirrors aptitude's userSkillMastery so curriculum + aptitude signals share
// one visual language across the app.
const DECAY = 0.85;

// Spaced revision schedule for mistakes (days). Simple, explainable ladder:
// miss → due now → "still unsure" rechecks in 6h → got it ×1 → 1d →
// got it ×2 → 3d (mistake retired — two clean passes) → if ever reopened:
// 3 → 6 → 12 → 21d (doubling, capped). The gate below retires a mistake on
// the second consecutive "got it" because the interval reaches 3 days there.
const FIRST_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 21;
const SAME_DAY_HOURS = 6; // "still unsure" rechecks land later today
const MASTERY_MIN_CORRECT_REVIEWS = 2;
const MASTERY_MIN_INTERVAL_DAYS = 3;

const clampText = (s: string | undefined, max: number): string | undefined => {
  if (s === undefined) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// Practice-from-mistake tuning (documented + testable):
// a session is SHORT by design — repair one misconception, then move on.
const MAX_PRACTICE_QUESTIONS = 5;
// Papers scanned per selection (curated library scale; bounded for latency).
const MAX_PAPERS_SCANNED = 200;
// Bounded number of by_dedupe ledger lookups per selection (ranked walk).
const MAX_LEDGER_CHECKS = 120;

/** Weighted mastery score (0–100) from the rolling evidence window. */
export function computeEvidenceScore(results: number[]): number {
  if (results.length === 0) return 0;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < results.length; i++) {
    const w = Math.pow(DECAY, results.length - 1 - i);
    weighted += results[i] * w;
    total += w;
  }
  return total > 0 ? Math.round((weighted / total) * 100) : 0;
}

/** Honest confidence tier from raw evidence count. */
export function confidenceFor(attempts: number): "unassessed" | "low" | "fair" | "solid" {
  if (attempts <= 0) return "unassessed";
  if (attempts < 3) return "low";
  if (attempts < 6) return "fair";
  return "solid";
}

// ── Practice-from-mistake: pure, testable helpers ────────────────────────
// The rules below are the single source of truth for BOTH the direct review
// path (reviewMistake) and the practice path (one review event per finished
// session) — scheduling can never drift between surfaces.

/** Canonical topic-name normalization: trim, collapse whitespace, lowercase. */
export function normalizeTopicName(s: string | undefined | null): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * THE spaced-revision ladder — one scheduling rule everywhere.
 *
 *   miss → due now → "still unsure" rechecks in 6h → got it ×1 → 1d →
 *   got it ×2 → 3d (mistake retired — two clean passes) → if ever reopened:
 *   3 → 6 → 12 → 21d (doubling, capped).
 */
export function nextMistakeReviewState(
  m: { intervalDays: number; correctReviewCount: number; status: Doc<"mistakes">["status"] },
  result: "got_it" | "still_unsure",
  now: number,
): {
  intervalDays: number;
  correctReviewCount: number;
  status: Doc<"mistakes">["status"];
  nextReviewAt: number;
} {
  let intervalDays = m.intervalDays;
  let correctReviewCount = m.correctReviewCount;
  let status = m.status;

  if (result === "got_it") {
    intervalDays =
      intervalDays < FIRST_INTERVAL_DAYS
        ? FIRST_INTERVAL_DAYS
        : intervalDays < MASTERY_MIN_INTERVAL_DAYS
          ? MASTERY_MIN_INTERVAL_DAYS
          : Math.min(intervalDays * 2, MAX_INTERVAL_DAYS);
    correctReviewCount += 1;
    if (
      correctReviewCount >= MASTERY_MIN_CORRECT_REVIEWS &&
      intervalDays >= MASTERY_MIN_INTERVAL_DAYS
    ) {
      status = "mastered";
    }
  } else {
    intervalDays = 0;
    correctReviewCount = 0;
    status = "open";
  }

  const nextReviewAt =
    result === "still_unsure"
      ? now + SAME_DAY_HOURS * 3600 * 1000
      : now + Math.round(intervalDays * 24 * 3600 * 1000);

  return { intervalDays, correctReviewCount, status, nextReviewAt };
}

/**
 * One review event per FINISHED practice session, from the session's
 * submissions in order. Every selected question answered correctly →
 * "got_it"; anything else → "still_unsure" (a mixed session must never
 * walk the ladder — that would inflate progress). Each question allows
 * exactly one submission, so "first try" is inherent, and
 * attemptsToFirstCorrect records the 1-based index of the first correct
 * submission (undefined when none were correct — the honest "attempts
 * needed" record).
 */
export function computePracticeReview(submissions: boolean[]): {
  result: "got_it" | "still_unsure";
  firstTryCorrect: number;
  attemptsToFirstCorrect: number | undefined;
} {
  const firstTryCorrect = submissions.filter(Boolean).length;
  const firstCorrectIdx = submissions.findIndex(Boolean);
  return {
    result:
      submissions.length > 0 && firstTryCorrect === submissions.length
        ? "got_it"
        : "still_unsure",
    firstTryCorrect,
    attemptsToFirstCorrect: firstCorrectIdx === -1 ? undefined : firstCorrectIdx + 1,
  };
}

/** Ranking input — plain shape so the comparator is testable in isolation. */
export interface RankableCandidate {
  /** Admin-verified transcription, or edited by a teacher. */
  verifiedPaper: boolean;
  /** A real official sitting (national_past_paper), not an admin practice set. */
  official: boolean;
  /** Newer sittings first; papers without a year rank last. */
  examYear: number | null;
  /** The paper the mistake came from — deprioritized for variety. */
  fromOriginalPaper: boolean;
}

/**
 * Deterministic candidate ordering: teacher-verified first, official
 * sittings next, newer papers, then papers other than the one the mistake
 * came from. Ties keep their scan order (Array#sort is stable).
 */
export function comparePracticeCandidates(
  a: RankableCandidate,
  b: RankableCandidate,
): number {
  if (a.verifiedPaper !== b.verifiedPaper) return a.verifiedPaper ? -1 : 1;
  if (a.official !== b.official) return a.official ? -1 : 1;
  const ya = a.examYear ?? -1;
  const yb = b.examYear ?? -1;
  if (ya !== yb) return yb - ya;
  if (a.fromOriginalPaper !== b.fromOriginalPaper) return a.fromOriginalPaper ? 1 : -1;
  return 0;
}

/**
 * Greedy one-per-paper pick (variety), then backfill by rank order. Pure.
 */
export function pickWithPaperDiversity<T extends { contentId: string }>(
  ranked: T[],
  limit: number,
): T[] {
  const picked: T[] = [];
  const pickedSet = new Set<T>();
  const seenPapers = new Set<string>();
  for (const c of ranked) {
    if (picked.length >= limit) break;
    if (seenPapers.has(c.contentId)) continue;
    picked.push(c);
    pickedSet.add(c);
    seenPapers.add(c.contentId);
  }
  for (const c of ranked) {
    if (picked.length >= limit) break;
    if (pickedSet.has(c)) continue;
    picked.push(c);
    pickedSet.add(c);
  }
  return picked;
}

// ── Ingestion contract ───────────────────────────────────────────────────

const outcomeShape = v.object({
  questionKey: v.string(), // stable identity within the source (number or index)
  questionText: v.string(),
  options: v.optional(v.array(v.string())),
  correctAnswer: v.string(), // verified at score time by the caller
  studentAnswer: v.optional(v.string()),
  explanation: v.optional(v.string()),
  topicId: v.optional(v.id("topics")),
  topicText: v.optional(v.string()), // free-text topic printed on papers
  contentId: v.optional(v.id("contentItems")),
  sourcePage: v.optional(v.number()),
  origin: v.union(v.literal("official"), v.literal("ai_generated")),
  correct: v.boolean(),
});

const ingestArgs = v.object({
  subjectId: v.id("subjects"),
  source: v.union(
    v.literal("digital_paper"),
    v.literal("quiz"),
    v.literal("mock_exam"),
    v.literal("daily_challenge"),
  ),
  sourceRefId: v.string(),
  outcomes: v.array(outcomeShape),
});

type Outcome = {
  questionKey: string;
  questionText: string;
  options?: string[];
  correctAnswer: string;
  studentAnswer?: string;
  explanation?: string;
  topicId?: Id<"topics">;
  topicText?: string;
  contentId?: Id<"contentItems">;
  sourcePage?: number;
  origin: "official" | "ai_generated";
  correct: boolean;
};

/**
 * THE SINGLE INGESTION POINT. Called (internally) by quizzes.submitAttempt,
 * mockExam.completeSection, examPrepDigital.logDigitalAttempt and
 * dailyChallenge.submitDailyChallenge. Idempotent per (userId, dedupeKey):
 * re-submitting the same attempt never duplicates ledger rows.
 */
export const ingestQuestionOutcomes = internalMutation({
  args: ingestArgs,
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { masteryRows: 0, mistakesRecorded: 0 };
    if (args.outcomes.length === 0) return { masteryRows: 0, mistakesRecorded: 0 };

    // Resolve free-text paper topics onto real curriculum topics once per
    // ingest (case-insensitive exact match within the subject). When a match
    // exists the outcome feeds topicMastery; when it doesn't, the mistake
    // still records with its printed topicText — never a fabricated link.
    const subjectTopics = await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", args.subjectId))
      .collect();
    const topicByName = new Map(
      subjectTopics.map((t) => [t.name.trim().toLowerCase(), t._id]),
    );

    const now = Date.now();
    let mistakesRecorded = 0;

    // Group outcomes by resolved topicId so each topic gets ONE upsert.
    const byTopic = new Map<Id<"topics">, number[]>(); // topicId → appended results

    for (const o of args.outcomes as Outcome[]) {
      const topicId =
        o.topicId ?? (o.topicText ? topicByName.get(o.topicText.trim().toLowerCase()) : undefined);

      if (topicId) {
        const list = byTopic.get(topicId) ?? [];
        list.push(o.correct ? 1 : 0);
        byTopic.set(topicId, list);
      }

      if (!o.correct) {
        const dedupeKey = `${args.source}:${args.sourceRefId}:${o.questionKey}`;
        const existing = await ctx.db
          .query("mistakes")
          .withIndex("by_dedupe", (q) => q.eq("userId", userId).eq("dedupeKey", dedupeKey))
          .unique();
        if (existing) {
          // Same question missed again (e.g. retaking the paper): reopen a
          // mastered row and pull the review forward. Never duplicate.
          if (existing.status !== "open") {
            await ctx.db.patch(existing._id, {
              status: "open",
              nextReviewAt: now,
              intervalDays: 0,
              studentAnswer: clampText(o.studentAnswer, 400) ?? existing.studentAnswer,
            });
          } else {
            await ctx.db.patch(existing._id, {
              studentAnswer: clampText(o.studentAnswer, 400) ?? existing.studentAnswer,
            });
          }
          continue;
        }
        await ctx.db.insert("mistakes", {
          userId,
          source: args.source,
          sourceRefId: args.sourceRefId,
          dedupeKey,
          subjectId: args.subjectId,
          topicId,
          topicText: clampText(o.topicText, 120),
          questionText: clampText(o.questionText, 1200) ?? "(question text unavailable)",
          options: o.options?.slice(0, 6).map((x) => clampText(x, 300) ?? x),
          correctAnswer: clampText(o.correctAnswer, 300) ?? "",
          studentAnswer: clampText(o.studentAnswer, 400),
          explanation: clampText(o.explanation, 1200),
          contentId: o.contentId,
          sourcePage: o.sourcePage,
          origin: o.origin,
          status: "open",
          reviewCount: 0,
          correctReviewCount: 0,
          intervalDays: 0,
          nextReviewAt: now, // due immediately — strike while the iron is hot
          createdAt: now,
        });
        mistakesRecorded += 1;
      }
    }

    // Upsert mastery rows (one per topic touched).
    for (const [topicId, results] of byTopic) {
      const row = await ctx.db
        .query("topicMastery")
        .withIndex("by_user_topic", (q) => q.eq("userId", userId).eq("topicId", topicId))
        .unique();
      if (row) {
        const merged = [...row.recentResults, ...results].slice(-EVIDENCE_WINDOW);
        await ctx.db.patch(row._id, {
          recentResults: merged,
          attempts: row.attempts + results.length,
          correct: row.correct + results.reduce((s, r) => s + r, 0),
          lastAttemptAt: now,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("topicMastery", {
          userId,
          topicId,
          subjectId: args.subjectId,
          recentResults: results.slice(-EVIDENCE_WINDOW),
          attempts: results.length,
          correct: results.reduce((s, r) => s + r, 0),
          lastAttemptAt: now,
          updatedAt: now,
        });
      }
    }

    return { masteryRows: byTopic.size, mistakesRecorded };
  },
});

// ── Spaced revision (Mistake Lab) ────────────────────────────────────────

/**
 * Review a mistake. result "got_it" walks the documented interval ladder;
 * "still_unsure" resets to a same-day recheck. Two clean consecutive
 * "got it" reviews ≥3 days apart retire the mistake (status → mastered).
 * A correct review also feeds positive evidence into topicMastery — the
 * loop closes on revision, not just on attempts.
 */
export const reviewMistake = mutation({
  args: {
    mistakeId: v.id("mistakes"),
    result: v.union(v.literal("got_it"), v.literal("still_unsure")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const m = await ctx.db.get(args.mistakeId);
    if (!m || m.userId !== userId) {
      throw new ConvexError({ message: "Mistake not found.", code: "not_found" });
    }
    if (m.status === "dismissed") {
      throw new ConvexError({ message: "This mistake was dismissed.", code: "invalid" });
    }

    const now = Date.now();
    const next = nextMistakeReviewState(m, args.result, now);

    await ctx.db.patch(args.mistakeId, {
      intervalDays: next.intervalDays,
      correctReviewCount: next.correctReviewCount,
      status: next.status,
      reviewCount: m.reviewCount + 1,
      lastReviewedAt: now,
      nextReviewAt: next.nextReviewAt,
    });

    // Revision success is evidence too (only when a topic is known).
    if (args.result === "got_it" && m.topicId) {
      await ctx.runMutation(internal.learning.ingestQuestionOutcomes, {
        subjectId: m.subjectId,
        // Correct-answer outcomes never create ledger rows, so the source
        // tag here only flavors the dedupeKey namespace — it cannot pollute
        // attempt provenance anywhere else.
        source: "quiz",
        sourceRefId: `mistake-review:${m._id}`,
        outcomes: [
          {
            questionKey: `review:${m._id}:${now}`,
            questionText: m.questionText,
            correctAnswer: m.correctAnswer,
            origin: m.origin,
            topicId: m.topicId,
            correct: true,
          },
        ],
      });
    }

    return { status: next.status, nextReviewAt: next.nextReviewAt, intervalDays: next.intervalDays };
  },
});

export const dismissMistake = mutation({
  args: { mistakeId: v.id("mistakes") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const m = await ctx.db.get(args.mistakeId);
    if (!m || m.userId !== userId) {
      throw new ConvexError({ message: "Mistake not found.", code: "not_found" });
    }
    await ctx.db.patch(args.mistakeId, { status: "dismissed" });
    return { ok: true };
  },
});

/** The review queue. status "open" + dueOnly → only what's due now. */
export const listMistakes = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("mastered"), v.literal("dismissed"))),
    subjectId: v.optional(v.id("subjects")),
    dueOnly: v.optional(v.boolean()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const status = args.status ?? "open";
    let rows = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
      .collect();
    if (args.subjectId) rows = rows.filter((r) => r.subjectId === args.subjectId);
    if (args.dueOnly) rows = rows.filter((r) => r.nextReviewAt <= Date.now());
    rows.sort((a, b) => a.nextReviewAt - b.nextReviewAt);
    const limit = Math.min(args.limit ?? 100, 200);
    const sliced = rows.slice(0, limit);

    // Join subject names + paper titles for provenance display.
    const subjectIds = [...new Set(sliced.map((r) => r.subjectId))];
    const subjects = await Promise.all(subjectIds.map((id) => ctx.db.get(id)));
    const subjectName = new Map(
      subjects.filter(Boolean).map((s) => [s!._id as string, s!.name]),
    );

    return sliced.map((r) => ({
      _id: r._id,
      source: r.source,
      origin: r.origin,
      subjectId: r.subjectId,
      subjectName: subjectName.get(r.subjectId) ?? "Unknown subject",
      topicId: r.topicId ?? null,
      topicText: r.topicText ?? null,
      questionText: r.questionText,
      options: r.options ?? null,
      correctAnswer: r.correctAnswer,
      studentAnswer: r.studentAnswer ?? null,
      explanation: r.explanation ?? null,
      contentId: r.contentId ?? null,
      sourcePage: r.sourcePage ?? null,
      status: r.status,
      reviewCount: r.reviewCount,
      intervalDays: r.intervalDays,
      nextReviewAt: r.nextReviewAt,
      due: r.nextReviewAt <= Date.now(),
      createdAt: r.createdAt,
    }));
  },
});

/** Counts for the Mistake Lab header + the dashboard next-action engine. */
export const getMistakeStats = query({
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { open: 0, dueNow: 0, mastered: 0 };
    const now = Date.now();
    const open = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open"))
      .collect();
    const mastered = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "mastered"))
      .collect();
    return {
      open: open.length,
      dueNow: open.filter((m) => m.nextReviewAt <= now).length,
      mastered: mastered.length,
    };
  },
});

// ── Exam Twin: topic evidence ────────────────────────────────────────────

/**
 * Per-topic mastery for the readiness view. Returns ONLY topics with real
 * evidence, weakest first, plus the subject's total curriculum topic count
 * so the UI can honestly show "assessed X of Y topics" instead of inventing
 * scores for topics the student has never touched.
 */
export const getTopicMasteryForUser = query({
  args: {
    subjectId: v.optional(v.id("subjects")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { topics: [], assessedCount: 0, curriculumTopicCount: 0 };

    let rows = await ctx.db
      .query("topicMastery")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (args.subjectId) rows = rows.filter((r) => r.subjectId === args.subjectId);

    const topicIds = [...new Set(rows.map((r) => r.topicId))];
    const topics = await Promise.all(topicIds.map((id) => ctx.db.get(id)));
    const topicName = new Map(
      topics.filter(Boolean).map((t) => [t!._id as string, t!.name]),
    );

    const enriched = rows
      .filter((r) => topicName.has(r.topicId))
      .map((r) => ({
        topicId: r.topicId,
        topicName: topicName.get(r.topicId) ?? "Unknown topic",
        subjectId: r.subjectId,
        attempts: r.attempts,
        correct: r.correct,
        evidenceScore: computeEvidenceScore(r.recentResults),
        confidence: confidenceFor(r.attempts),
        lastAttemptAt: r.lastAttemptAt,
      }))
      .sort((a, b) => a.evidenceScore - b.evidenceScore);

    // Subject names for display (one batch).
    const subjectIds = [...new Set(enriched.map((t) => t.subjectId))];
    const subjects = await Promise.all(subjectIds.map((id) => ctx.db.get(id)));
    const subjectName = new Map(
      subjects.filter(Boolean).map((s) => [s!._id as string, s!.name]),
    );
    const withSubjectName = enriched.map((t) => ({
      ...t,
      subjectName: subjectName.get(t.subjectId) ?? "Unknown subject",
    }));

    // Curriculum coverage: how many topics exist for the requested scope?
    let curriculumTopicCount = 0;
    const scopeSubjectId = args.subjectId;
    if (scopeSubjectId) {
      const all = await ctx.db
        .query("topics")
        .withIndex("by_subject", (q) => q.eq("subjectId", scopeSubjectId))
        .collect();
      curriculumTopicCount = all.length;
    } else {
      const all = await ctx.db.query("topics").collect();
      curriculumTopicCount = all.length;
    }

    const limit = Math.min(args.limit ?? 50, 100);
    return {
      topics: withSubjectName.slice(0, limit),
      assessedCount: enriched.length,
      curriculumTopicCount,
    };
  },
});

// ── Dashboard: the next recommended action ───────────────────────────────

export type NextAction = {
  type:
    | "review_mistakes"
    | "practice_topic"
    | "daily_challenge"
    | "diagnostic";
  title: string;
  reason: string; // the transparent "why" — always shown to the student
  href: string;
  cta: string;
  etaMinutes: number;
  subjectId: string | null;
};

/**
 * ONE honest recommendation for the dashboard, derived only from evidence:
 *   1. Mistakes due for review (highest-value minute per minute).
 *   2. Weakest topic with enough evidence to trust (score < 70, ≥2 attempts).
 *   3. Today's daily challenge (habit keeper) — decided client-side is fine,
 *      so we only surface it when mistakes/topics have nothing to say AND we
 *      can't tell whether it's done (avoids an extra cross-table read).
 *   4. No evidence at all → first diagnostic quiz (real onboarding path).
 * Never presents a readiness percentage; explains itself in `reason`.
 */
export const getNextAction = query({
  handler: async (ctx): Promise<NextAction | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const now = Date.now();

    // 1) Due mistake reviews — the strongest signal of immediate value.
    const open = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open"))
      .collect();
    const due = open.filter((m) => m.nextReviewAt <= now);
    if (due.length > 0) {
      const first = due[0]!;
      const minutes = Math.min(15, Math.max(3, Math.ceil(due.length * 1.5)));
      return {
        type: "review_mistakes",
        title:
          due.length === 1
            ? "Review the mistake you made"
            : `Review ${due.length} mistakes waiting for you`,
        reason:
          due.length === 1
            ? "It's due for revision now — reviewing it while it's fresh is how it sticks."
            : "They're due for revision now — spaced review beats re-reading notes.",
        href: "/mistakes",
        cta: "Open Mistake Lab",
        etaMinutes: minutes,
        subjectId: first.subjectId,
      };
    }

    // 2) Weakest topic with trustworthy evidence.
    const masteryRows = await ctx.db
      .query("topicMastery")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const candidates = masteryRows
      .filter((r) => r.attempts >= 2 && computeEvidenceScore(r.recentResults) < 70)
      .sort((a, b) => computeEvidenceScore(a.recentResults) - computeEvidenceScore(b.recentResults));
    if (candidates.length > 0) {
      const weakest = candidates[0];
      const topic = await ctx.db.get(weakest.topicId);
      const subject = await ctx.db.get(weakest.subjectId);
      const score = computeEvidenceScore(weakest.recentResults);
      if (topic && subject) {
        return {
          type: "practice_topic",
          title: `Strengthen ${topic.name}`,
          reason: `Your last ${weakest.attempts} scored questions on this ${subject.name} topic average ${score}%. Targeted practice moves it fastest.`,
          href: "/exam-prep?tab=practice",
          cta: "Practice this topic",
          etaMinutes: 12,
          subjectId: weakest.subjectId,
        };
      }
    }

    // 3) No trustworthy gaps → keep the habit with the daily challenge.
    if (masteryRows.length > 0 || open.length > 0) {
      return {
        type: "daily_challenge",
        title: "Take today's daily challenge",
        reason:
          "Your reviewed topics are in good shape — a two-minute challenge keeps the streak alive.",
        href: "/dashboard#daily-challenge",
        cta: "Start the challenge",
        etaMinutes: 2,
        subjectId: null,
      };
    }

    // 4) No evidence anywhere → real onboarding path, no fabricated stats.
    return {
      type: "diagnostic",
      title: "Take your first diagnostic quiz",
      reason:
        "Learnyx builds your whole study loop from what you answer — a 5-question quiz gives it something honest to work with.",
      href: "/exam-prep?tab=practice",
      cta: "Start a quiz",
      etaMinutes: 5,
      subjectId: null,
    };
  },
});

// ── Practice from a mistake ("Practice similar") ─────────────────────────
//
// A short focused session of REAL past-paper questions on the SAME topic as
// one mistake. This is not a quiz engine and it never generates questions:
//
//   SELECTION RULES (each one maps to an honesty constraint):
//   1. Match the mistake's CANONICAL topic — the same resolved topic name
//      within the subject. When the mistake only carries the paper's printed
//      topic text, an exact normalized match against other printed topics is
//      allowed and is labeled as such. Nothing else matches: the curriculum
//      has no parent/related-topic data, so "closely related" cannot be
//      claimed and is never invented here.
//   2. Only auto-gradable MCQs with a stored answer are selected. Structured
//      questions and key-less questions are excluded — feedback must come
//      from the actual answer key.
//   3. The original question is excluded (same paper + same number, plus a
//      normalized-text safety net for reprints), and so is any question
//      already in the student's mistake ledger — those are owned by review.
//   4. Ranking: teacher-verified transcription first, official sittings
//      before admin practice sets, newer papers, one-per-paper variety.
//   5. Provenance travels end to end: paper title, year, page, question
//      number, verification status — and the student always sees WHY each
//      question was picked.
//   6. Papers behind Premium are skipped for students without Premium and
//      reported honestly as hidden, never silently mixed in.
//   7. If nothing matches, the reason says so plainly — no fabricated bank
//      entries, no claimed equivalence.

export type PracticeCandidate = {
  contentId: Id<"contentItems">;
  questionNumber: number;
  paperTitle: string;
  examYear: number | null;
  /** A real official sitting (national_past_paper). */
  official: boolean;
  /** Teacher-verified transcription / teacher-edited. */
  verifiedPaper: boolean;
  sourcePage: number | null;
  topic: string | null;
  questionText: string;
  passage: string | null;
  options: { label: string; text: string }[];
  answerLabel: string; // never shipped to the client pre-submit
  explanation: string | null;
  why: string;
};

export type SimilarSelection = {
  status: "ok" | "no_topic" | "no_match" | "mistake_dismissed";
  reason: string;
  matchedBy: "canonical_topic" | "topic_text" | null;
  topicLabel: string | null;
  topicId: Id<"topics"> | null;
  mistake: {
    _id: Id<"mistakes">;
    subjectId: Id<"subjects">;
    questionText: string;
    studentAnswer: string | null;
    correctAnswer: string;
    explanation: string | null;
    topicText: string | null;
    contentId: Id<"contentItems"> | null;
    sourcePage: number | null;
    status: Doc<"mistakes">["status"];
    nextReviewAt: number;
  } | null;
  candidates: PracticeCandidate[];
  scannedPapers: number;
  premiumHiddenPapers: number;
};

/**
 * The shared selection engine. Runs as an internalQuery so both the public
 * preview (findSimilarPractice) and the session start (startMistakePractice)
 * execute the exact same rules — one implementation, no drift.
 */
export const selectSimilarForMistake = internalQuery({
  args: {
    mistakeId: v.id("mistakes"),
    userId: v.id("users"),
  },
  handler: async (ctx, args): Promise<SimilarSelection> => {
    const mistake = await ctx.db.get(args.mistakeId);
    if (!mistake || mistake.userId !== args.userId) {
      throw new ConvexError({ message: "Mistake not found.", code: "not_found" });
    }

    const mistakeSummary: SimilarSelection["mistake"] = {
      _id: mistake._id,
      subjectId: mistake.subjectId,
      questionText: mistake.questionText,
      studentAnswer: mistake.studentAnswer ?? null,
      correctAnswer: mistake.correctAnswer,
      explanation: mistake.explanation ?? null,
      topicText: mistake.topicText ?? null,
      contentId: mistake.contentId ?? null,
      sourcePage: mistake.sourcePage ?? null,
      status: mistake.status,
      nextReviewAt: mistake.nextReviewAt,
    };

    if (mistake.status === "dismissed") {
      return {
        status: "mistake_dismissed",
        reason: "This mistake was dismissed — it no longer takes practice or review.",
        matchedBy: null,
        topicLabel: null,
        topicId: null,
        mistake: mistakeSummary,
        candidates: [],
        scannedPapers: 0,
        premiumHiddenPapers: 0,
      };
    }

    // ── Topic resolution ──────────────────────────────────────────────
    // Same canonical topic (by normalized name within the subject) or —
    // only when no canonical topic exists — an exact normalized match on
    // the printed topic text. Both are real, observable data.
    const subjectTopics = await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", mistake.subjectId))
      .collect();
    const topicById = new Map(subjectTopics.map((t) => [t._id as string, t.name]));

    let matchedBy: SimilarSelection["matchedBy"] = null;
    let targetName: string | null = null;
    let topicLabel: string | null = null;
    let canonicalTopicId: Id<"topics"> | null = mistake.topicId ?? null;

    if (canonicalTopicId) {
      const name = topicById.get(canonicalTopicId);
      if (name) {
        matchedBy = "canonical_topic";
        targetName = normalizeTopicName(name);
        topicLabel = name;
      }
    }
    if (!matchedBy && mistake.topicText) {
      // Try to lift the printed text onto the curriculum first; topics may
      // have been seeded since the attempt was ingested.
      const printed = normalizeTopicName(mistake.topicText);
      const hit = subjectTopics.find((t) => normalizeTopicName(t.name) === printed);
      if (hit) {
        matchedBy = "canonical_topic";
        canonicalTopicId = hit._id;
        targetName = normalizeTopicName(hit.name);
        topicLabel = hit.name;
      } else {
        matchedBy = "topic_text";
        targetName = printed;
        topicLabel = mistake.topicText;
      }
    }

    if (!matchedBy || !targetName || !topicLabel) {
      return {
        status: "no_topic",
        reason:
          "This mistake doesn't carry a topic we can match on, so honest targeted practice isn't possible yet. Review it here or practice the subject generally.",
        matchedBy: null,
        topicLabel: null,
        topicId: null,
        mistake: mistakeSummary,
        candidates: [],
        scannedPapers: 0,
        premiumHiddenPapers: 0,
      };
    }

    // ── Paper scan ────────────────────────────────────────────────────
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const hasPremium = isPremiumStatus(sub?.status);

    const subjectItems = await ctx.db
      .query("contentItems")
      .withIndex("by_subject", (q) => q.eq("subjectId", mistake.subjectId))
      .collect();
    const papers = subjectItems
      .filter((p) => p.contentType === "past_exam")
      .slice(0, MAX_PAPERS_SCANNED);

    const originalNumberMatch =
      mistake.source === "digital_paper" && mistake.contentId
        ? /:q(\d+)$/.exec(mistake.dedupeKey)
        : null;
    const originalNumber = originalNumberMatch ? Number(originalNumberMatch[1]) : null;
    const originalTextKey = normalizeTopicName(mistake.questionText).slice(0, 160);

    let scannedPapers = 0;
    let premiumHiddenPapers = 0;
    const pool: (PracticeCandidate & RankableCandidate)[] = [];

    for (const paper of papers) {
      if (paper.isPremium && !hasPremium) {
        premiumHiddenPapers += 1;
        continue;
      }
      const dp = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", paper._id))
        .unique();
      if (!dp || dp.status !== "ready") continue;
      if (dp.reviewStatus === "needs_review" || dp.reviewStatus === "pdf_only") continue;
      if (dp.verification === "rejected") continue;
      scannedPapers += 1;

      const verifiedPaper = dp.verification === "verified" || dp.adminEdited === true;
      const verificationNote = verifiedPaper
        ? "Answer key teacher-verified."
        : "Answers parsed from the paper's own key.";
      const matchNote =
        matchedBy === "canonical_topic"
          ? `Same topic as your mistake — ${topicLabel} (matched on the paper's printed topic).`
          : `Printed topic matches your mistake — “${topicLabel}”.`;

      for (const q of dp.questions) {
        // Auto-gradable MCQs with a stored key only — feedback must come
        // from the actual answer key, never from a guess.
        if (q.kind === "structured" || q.options.length === 0) continue;
        if (!q.answer) continue;
        // Topic gate: exact normalized equality with the resolved target.
        const qName = normalizeTopicName(q.topic);
        if (!qName || qName !== targetName) continue;
        // Exclude the original question (and identical reprints).
        if (paper._id === mistake.contentId && originalNumber !== null && q.number === originalNumber) {
          continue;
        }
        if (normalizeTopicName(q.text).slice(0, 160) === originalTextKey) continue;

        pool.push({
          contentId: paper._id,
          questionNumber: q.number,
          paperTitle: paper.title,
          examYear: paper.examYear ?? null,
          official: paper.examPrepSubtype === "national_past_paper",
          verifiedPaper,
          sourcePage: q.sourcePage ?? null,
          topic: q.topic ?? null,
          questionText: q.text,
          passage: q.passage ?? null,
          options: q.options,
          answerLabel: q.answer,
          explanation: q.explanation ?? null,
          why: `${matchNote} ${verificationNote}`,
          // ranking inputs (RankableCandidate)
          fromOriginalPaper: paper._id === mistake.contentId,
        });
      }
    }

    if (pool.length === 0) {
      const hiddenNote =
        premiumHiddenPapers > 0
          ? ` ${premiumHiddenPapers} digitized paper${premiumHiddenPapers === 1 ? "" : "s"} on this subject are behind Premium.`
          : "";
      return {
        status: "no_match",
        reason: `We scanned ${scannedPapers} digitized paper${scannedPapers === 1 ? "" : "s"} for this subject and none currently has a verified multiple-choice question on “${topicLabel}”.${hiddenNote} Review this mistake here instead — or check back as more papers are digitized.`,
        matchedBy,
        topicLabel,
        topicId: matchedBy === "canonical_topic" ? canonicalTopicId : null,
        mistake: mistakeSummary,
        candidates: [],
        scannedPapers,
        premiumHiddenPapers,
      };
    }

    // ── Rank, then walk with bounded ledger checks ────────────────────
    pool.sort(comparePracticeCandidates);

    const clean: (PracticeCandidate & RankableCandidate)[] = [];
    let ledgerChecks = 0;
    for (const c of pool) {
      if (clean.length >= MAX_PRACTICE_QUESTIONS * 4) break; // plenty for the diversity pick
      if (ledgerChecks >= MAX_LEDGER_CHECKS) break;
      ledgerChecks += 1;
      const dedupeKey = `digital_paper:${c.contentId}:q${c.questionNumber}`;
      const known = await ctx.db
        .query("mistakes")
        .withIndex("by_dedupe", (q) =>
          q.eq("userId", args.userId).eq("dedupeKey", dedupeKey),
        )
        .unique();
      if (known) continue; // already in the student's ledger — review owns it
      clean.push(c);
    }

    const selected = pickWithPaperDiversity(clean, MAX_PRACTICE_QUESTIONS);

    return {
      status: "ok",
      reason: `Found ${selected.length} question${selected.length === 1 ? "" : "s"} on “${topicLabel}” from ${new Set(selected.map((c) => c.contentId)).size} digitized paper${new Set(selected.map((c) => c.contentId)).size === 1 ? "" : "s"}.`,
      matchedBy,
      topicLabel,
      topicId: matchedBy === "canonical_topic" ? canonicalTopicId : null,
      mistake: mistakeSummary,
      candidates: selected,
      scannedPapers,
      premiumHiddenPapers,
    };
  },
});

/** Public preview: what could this mistake be practiced with, and why? */
export const findSimilarPractice = query({
  args: { mistakeId: v.id("mistakes") },
  handler: async (ctx, args): Promise<SimilarSelection | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.runQuery(internal.learning.selectSimilarForMistake, {
      mistakeId: args.mistakeId,
      userId,
    });
  },
});

/**
 * Start (or resume) a practice session for one mistake. An in-progress
 * session is always resumed — never forked into a duplicate. Starting
 * stores the selection snapshot so the session stays stable even if papers
 * are re-converted mid-practice.
 */
export const startMistakePractice = mutation({
  args: { mistakeId: v.id("mistakes") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    started: boolean;
    resumed: boolean;
    sessionId: Id<"mistakePracticeSessions"> | null;
    status: SimilarSelection["status"];
    reason: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const existing = await ctx.db
      .query("mistakePracticeSessions")
      .withIndex("by_user_mistake", (q) =>
        q.eq("userId", userId).eq("mistakeId", args.mistakeId),
      )
      .collect();
    const open = existing
      .filter((s) => s.completedAt === undefined)
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    if (open) {
      return { started: true, resumed: true, sessionId: open._id, status: "ok" as const, reason: "Resumed your practice in progress." };
    }

    const selection = await ctx.runQuery(internal.learning.selectSimilarForMistake, {
      mistakeId: args.mistakeId,
      userId,
    });
    if (selection.status !== "ok" || selection.candidates.length === 0) {
      return {
        started: false,
        resumed: false,
        sessionId: null,
        status: selection.status,
        reason: selection.reason,
      };
    }

    const sessionId = await ctx.db.insert("mistakePracticeSessions", {
      userId,
      mistakeId: args.mistakeId,
      topicId: selection.topicId ?? undefined,
      questions: selection.candidates.map((c) => ({
        contentId: c.contentId,
        questionNumber: c.questionNumber,
        why: c.why,
      })),
      reviewApplied: false,
      createdAt: Date.now(),
    });
    return { started: true, resumed: false, sessionId, status: "ok" as const, reason: selection.reason };
  },
});

/**
 * The session's questions, sanitized: NO answer labels and NO explanations —
 * those arrive only with the submit verdict, so the client never holds the
 * key before answering. Questions whose paper was re-converted away or
 * became premium mid-session are honestly dropped and counted.
 */
export const getPracticeQuestions = query({
  args: { sessionId: v.id("mistakePracticeSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return null;
    const mistake = await ctx.db.get(session.mistakeId);
    if (!mistake || mistake.userId !== userId) return null;

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const hasPremium = isPremiumStatus(sub?.status);

    const attempts = await ctx.db
      .query("mistakePracticeAttempts")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();

    const questions: {
      contentId: Id<"contentItems">;
      questionNumber: number;
      why: string;
      text: string;
      passage: string | null;
      options: { label: string; text: string }[];
      topic: string | null;
      sourcePage: number | null;
      paperTitle: string;
      examYear: number | null;
      official: boolean;
      verifiedPaper: boolean;
    }[] = [];
    let unavailable = 0;

    for (const ref of session.questions) {
      const paper = await ctx.db.get(ref.contentId);
      if (!paper) {
        unavailable += 1;
        continue;
      }
      if (paper.isPremium && !hasPremium) {
        unavailable += 1;
        continue;
      }
      const dp = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", ref.contentId))
        .unique();
      const q = dp?.status === "ready" ? dp.questions.find((x) => x.number === ref.questionNumber) : undefined;
      if (!q || q.kind === "structured" || !q.answer) {
        unavailable += 1;
        continue;
      }
      questions.push({
        contentId: ref.contentId,
        questionNumber: ref.questionNumber,
        why: ref.why,
        text: q.text,
        passage: q.passage ?? null,
        options: q.options,
        topic: q.topic ?? null,
        sourcePage: q.sourcePage ?? null,
        paperTitle: paper.title,
        examYear: paper.examYear ?? null,
        official: paper.examPrepSubtype === "national_past_paper",
        verifiedPaper: dp?.verification === "verified" || dp?.adminEdited === true,
      });
    }

    const topicRow = session.topicId ? await ctx.db.get(session.topicId) : null;

    return {
      sessionId: session._id,
      mistakeId: mistake._id,
      closed: session.completedAt !== undefined,
      topicLabel: topicRow?.name ?? mistake.topicText ?? null,
      mistake: {
        questionText: mistake.questionText,
        studentAnswer: mistake.studentAnswer ?? null,
        correctAnswer: mistake.correctAnswer,
        explanation: mistake.explanation ?? null,
        topicText: mistake.topicText ?? null,
        status: mistake.status,
        nextReviewAt: mistake.nextReviewAt,
        intervalDays: mistake.intervalDays,
        contentId: mistake.contentId ?? null,
        sourcePage: mistake.sourcePage ?? null,
      },
      result: session.result ?? null,
      firstTryCorrect: session.firstTryCorrect ?? null,
      submissionsCount: session.submissionsCount ?? null,
      attemptsToFirstCorrect: session.attemptsToFirstCorrect ?? null,
      attempts: attempts.map((a) => ({
        contentId: a.contentId,
        questionNumber: a.questionNumber,
        correct: a.correct,
      })),
      questions,
      unavailable,
    };
  },
});

/**
 * Apply the practice session's ONE review event to the original mistake —
 * exactly once, through the same ladder as reviewMistake. Idempotent: a
 * second call (or a race) is a no-op. No synthetic evidence is ingested
 * here — the submissions themselves already went through the single
 * ingestion point, so ingesting again would double-count mastery.
 */
async function applyPracticeReview(
  ctx: MutationCtx,
  sessionId: Id<"mistakePracticeSessions">,
  userId: Id<"users">,
): Promise<{ result: "got_it" | "still_unsure"; nextReviewAt: number } | null> {
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId || session.reviewApplied) return null;

  const mistake = await ctx.db.get(session.mistakeId);
  const attempts = await ctx.db
    .query("mistakePracticeAttempts")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const ordered = attempts.slice().sort((a, b) => a.submittedAt - b.submittedAt);
  const now = Date.now();

  if (!mistake || mistake.userId !== userId || mistake.status === "dismissed" || ordered.length === 0) {
    // Nothing honest to update — close the session without a review event.
    await ctx.db.patch(sessionId, { reviewApplied: true, completedAt: now });
    return null;
  }

  const review = computePracticeReview(ordered.map((a) => a.correct));
  const next = nextMistakeReviewState(mistake, review.result, now);

  await ctx.db.patch(mistake._id, {
    intervalDays: next.intervalDays,
    correctReviewCount: next.correctReviewCount,
    status: next.status,
    reviewCount: mistake.reviewCount + 1,
    lastReviewedAt: now,
    nextReviewAt: next.nextReviewAt,
  });
  await ctx.db.patch(sessionId, {
    result: review.result,
    firstTryCorrect: review.firstTryCorrect,
    submissionsCount: ordered.length,
    attemptsToFirstCorrect: review.attemptsToFirstCorrect,
    reviewApplied: true,
    completedAt: now,
  });
  return { result: review.result, nextReviewAt: next.nextReviewAt };
}

/**
 * Submit ONE answer inside a practice session. Scored server-side against
 * the paper's stored answer (the client never sends a verdict). Idempotent
 * per (session, question): a duplicate submit returns the stored verdict
 * and never re-ingests evidence. When the last question is answered, the
 * session's single review event is applied inline.
 */
export const submitMistakePractice = mutation({
  args: {
    sessionId: v.id("mistakePracticeSessions"),
    contentId: v.id("contentItems"),
    questionNumber: v.number(),
    choice: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new ConvexError({ message: "Practice session not found.", code: "not_found" });
    }
    const mistake = await ctx.db.get(session.mistakeId);
    if (!mistake || mistake.userId !== userId) {
      throw new ConvexError({ message: "Mistake not found.", code: "not_found" });
    }
    if (session.completedAt !== undefined || session.reviewApplied) {
      throw new ConvexError({ message: "This practice session is already closed.", code: "invalid" });
    }
    const inSession = session.questions.some(
      (q) => q.contentId === args.contentId && q.questionNumber === args.questionNumber,
    );
    if (!inSession) {
      throw new ConvexError({ message: "That question is not part of this session.", code: "invalid" });
    }

    // Idempotency: one submission per (session, question). A retry returns
    // the stored verdict — no re-scoring, no duplicate evidence.
    const sessionAttempts = await ctx.db
      .query("mistakePracticeAttempts")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const prior = sessionAttempts.find(
      (a) => a.contentId === args.contentId && a.questionNumber === args.questionNumber,
    );

    const paper = await ctx.db.get(args.contentId);
    if (!paper) {
      throw new ConvexError({ message: "The source paper is no longer available.", code: "not_found" });
    }
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (paper.isPremium && !isPremiumStatus(sub?.status)) {
      throw new ConvexError({ message: "This paper is part of Learnyx Premium.", code: "premium_required" });
    }
    const dp = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    const q = dp?.status === "ready" ? dp.questions.find((x) => x.number === args.questionNumber) : undefined;
    if (!q || q.kind === "structured" || !q.answer) {
      throw new ConvexError({
        message: "That question no longer has a checkable answer — it was removed from the session.",
        code: "invalid",
      });
    }

    const normalizedChoice = args.choice.trim().toUpperCase();
    if (!q.options.some((o) => o.label === normalizedChoice)) {
      throw new ConvexError({ message: "Pick one of the listed options.", code: "invalid" });
    }
    const correct = normalizedChoice === q.answer.trim().toUpperCase();

    if (prior) {
      return {
        duplicate: true,
        correct: prior.correct,
        correctAnswer: q.answer,
        explanation: q.explanation ?? null,
        sourcePage: q.sourcePage ?? null,
        review: null,
        sessionComplete: session.completedAt !== undefined,
      };
    }

    await ctx.db.insert("mistakePracticeAttempts", {
      userId,
      sessionId: session._id,
      mistakeId: mistake._id,
      contentId: args.contentId,
      questionNumber: args.questionNumber,
      choice: normalizedChoice,
      correct,
      submittedAt: Date.now(),
    });

    // Evidence through THE SINGLE INGESTION POINT. Deliberately NOT wrapped
    // in try/catch: Convex transactions are all-or-nothing, so a failed
    // ingest rolls the attempt row back too — the attempt record and the
    // evidence can never drift apart.
    await ctx.runMutation(internal.learning.ingestQuestionOutcomes, {
      subjectId: mistake.subjectId,
      // The question really is from this paper, and the dedupeKey this
      // produces (`digital_paper:{contentId}:q{N}`) is the same namespace a
      // real paper attempt uses — missing the same question in a real paper
      // later reopens this mistake instead of duplicating it.
      source: "digital_paper",
      sourceRefId: args.contentId,
      outcomes: [
        {
          questionKey: `q${args.questionNumber}`,
          questionText: q.text,
          options: q.options.slice(0, 6).map((o) => `${o.label}. ${o.text}`),
          correctAnswer: q.answer,
          studentAnswer: normalizedChoice,
          explanation: q.explanation,
          topicId: session.topicId ?? undefined,
          topicText: q.topic,
          contentId: args.contentId,
          sourcePage: q.sourcePage,
          origin: "official" as const,
          correct,
        },
      ],
    });

    // Last question answered → apply the session's single review event now.
    let review: { result: "got_it" | "still_unsure"; nextReviewAt: number } | null = null;
    let sessionComplete = false;
    if (sessionAttempts.length + 1 >= session.questions.length) {
      const applied = await applyPracticeReview(ctx, session._id, userId);
      if (applied) review = applied;
      sessionComplete = true;
    }

    return {
      duplicate: false,
      correct,
      correctAnswer: q.answer,
      explanation: q.explanation ?? null,
      sourcePage: q.sourcePage ?? null,
      review,
      sessionComplete,
    };
  },
});

/**
 * Finish a session explicitly (e.g. exiting after some questions). Applies
 * the ONE review event over whatever was submitted — a partial session with
 * all-correct submissions still counts as "got it"; anything else is
 * "still unsure". A session with zero submissions closes without touching
 * the mistake: exiting never fabricates a review.
 */
export const completeMistakePractice = mutation({
  args: { sessionId: v.id("mistakePracticeSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new ConvexError({ message: "Practice session not found.", code: "not_found" });
    }
    if (session.reviewApplied) {
      const mistake = await ctx.db.get(session.mistakeId);
      return {
        applied: session.result !== undefined,
        alreadyApplied: true,
        result: session.result ?? null,
        nextReviewAt: mistake?.nextReviewAt ?? null,
      };
    }
    const applied = await applyPracticeReview(ctx, args.sessionId, userId);
    return {
      applied: applied !== null,
      alreadyApplied: false,
      result: applied?.result ?? null,
      nextReviewAt: applied?.nextReviewAt ?? null,
    };
  },
});
