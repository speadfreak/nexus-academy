// THE LEARNING LOOP ENGINE (2.0) — evidence, mistakes, revision, next action.
//
// One shared pipeline every scored activity feeds. Design contract:
//
//   ATTEMPT ──▶ ingestQuestionOutcomes ──▶ topicMastery (evidence)
//                                       └▶ mistakes    (ledger + SRS)
//   DASHBOARD ─▶ getNextAction (honest, evidence-derived recommendation)
//   MISTAKE LAB ▶ listMistakes / reviewMistake (spaced revision)
//   EXAM TWIN ──▶ getTopicMasteryForUser (assessed vs low-evidence topics)
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
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

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
    let intervalDays = m.intervalDays;
    let correctReviewCount = m.correctReviewCount;
    let status: Doc<"mistakes">["status"] = m.status;

    if (args.result === "got_it") {
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
      args.result === "still_unsure"
        ? now + SAME_DAY_HOURS * 3600 * 1000
        : now + Math.round(intervalDays * 24 * 3600 * 1000);

    await ctx.db.patch(args.mistakeId, {
      intervalDays,
      correctReviewCount,
      status,
      reviewCount: m.reviewCount + 1,
      lastReviewedAt: now,
      nextReviewAt,
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

    return { status, nextReviewAt, intervalDays };
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
