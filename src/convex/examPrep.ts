// Exam Prep Hub backend — consolidates past papers, exam-mode attempts and
// the AI Mock Exam engine into one query surface.
//
// REUSE, NOT DUPLICATION:
//   - Papers come straight from contentItems (contentType = "past_exam") —
//     the same rows the Library shows, plus the examPrepSubtype /
//     durationMinutes classification added for the hub.
//   - Mock attempts come straight from the mockExams table — the AI Mock
//     Exam engine's own data, untouched.
//   - Quiz scores come straight from quizAttempts.
//   - Attempt logging below only RECORDS that an Exam Mode session happened
//     on a specific paper (ReaderExamMode keeps logging streak/XP through
//     studySessions.logSession exactly as before).

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// ─── Papers browse (Papers tab + Overview facets) ───────────────────────

/**
 * All past-exam papers (uploaded MoE past papers + admin-curated practice
 * sets) with subject metadata joined. The hub computes type/subject/year
 * facet counts client-side from this single list — real counts, instant
 * filter switching, zero placeholder numbers.
 */
export const getExamPrepPapers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .collect();

    // Newest year first, then alphabetical within a year.
    items.sort((a, b) => {
      const ya = a.examYear ?? 0;
      const yb = b.examYear ?? 0;
      if (yb !== ya) return yb - ya;
      return a.title.localeCompare(b.title);
    });

    const result = [];
    for (const item of items.slice(0, 1000)) {
      const subject = item.subjectId
        ? ((await ctx.db.get(item.subjectId)) as Doc<"subjects"> | null)
        : null;
      result.push({
        _id: item._id,
        title: item.title,
        examPrepSubtype: item.examPrepSubtype ?? null,
        examYear: item.examYear ?? null,
        durationMinutes: item.durationMinutes ?? null,
        pageCount: item.pageCount ?? null,
        grade: item.grade,
        isPremium: item.isPremium,
        hasAnswerKey: Boolean(item.answerKeyContentId),
        subjectName: subject?.name ?? "Unknown",
        subjectSlug: subject?.slug ?? "",
        subjectStream: subject?.stream ?? "common",
      });
    }
    return result;
  },
});

// ─── Attempt logging (written by ReaderExamMode) ─────────────────────────

/**
 * Log one Exam Mode session on an uploaded paper. Called by ReaderExamMode
 * on submit / time-expiry, alongside the existing studySessions.logSession
 * call (which keeps handling streak + XP — unchanged).
 */
export const logExamPrepAttempt = mutation({
  args: {
    contentId: v.id("contentItems"),
    startedAt: v.number(),
    endedAt: v.number(),
    durationSeconds: v.number(),
    completed: v.boolean(), // true = student submitted; false = time expired
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const item = await ctx.db.get(args.contentId);
    if (!item) throw new ConvexError({ message: "Paper not found.", code: "not_found" });

    // Sanity-clamp: negative or multi-day durations are client bugs.
    const durationSeconds = Math.max(0, Math.min(args.durationSeconds, 24 * 3600));

    const attemptId = await ctx.db.insert("examPrepAttempts", {
      userId,
      contentId: args.contentId,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      durationSeconds,
      completed: args.completed,
    });
    return { attemptId };
  },
});

/**
 * Self-graded score (0-100) entered after checking the answer key.
 * Owner-only, and only while no score has been recorded yet (one honest
 * self-grade per attempt — re-grading would defeat the point).
 */
export const rateExamPrepAttempt = mutation({
  args: {
    attemptId: v.id("examPrepAttempts"),
    selfScorePct: v.number(),
  },
  handler: async (ctx, { attemptId, selfScorePct }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const attempt = await ctx.db.get(attemptId);
    if (!attempt || attempt.userId !== userId) {
      throw new ConvexError({ message: "Attempt not found.", code: "not_found" });
    }
    if (attempt.selfScorePct !== undefined) {
      return { ok: true as const, alreadyRated: true as const };
    }
    await ctx.db.patch(attemptId, {
      selfScorePct: Math.max(0, Math.min(100, Math.round(selfScorePct))),
    });
    return { ok: true as const, alreadyRated: false as const };
  },
});

// ─── Unified results (My Results tab) ────────────────────────────────────

export type ExamPrepResultRow = {
  kind: "paper_exam" | "mock_exam" | "quiz";
  refId: string;
  title: string;
  subjectName: string | null;
  date: number;
  scorePct: number | null;
  timeSeconds: number | null;
  status: "completed" | "expired" | "in_progress" | "self_graded";
};

/**
 * One coherent readiness picture, merging all three real data sources:
 *   1. Exam Mode sessions on uploaded papers (examPrepAttempts + item join)
 *   2. AI Mock Exam attempts (mockExams — completed + in-progress)
 *   3. Recent quiz attempts (quizAttempts → quizzes → subject)
 * Most recent first, one shared row shape so the UI reads as a single
 * timeline rather than three disconnected lists.
 */
export const getMyExamPrepResults = query({
  args: {},
  handler: async (ctx): Promise<ExamPrepResultRow[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows: ExamPrepResultRow[] = [];

    // ── 1. Paper exam-mode sessions ──
    const attempts = await ctx.db
      .query("examPrepAttempts")
      .withIndex("by_user_endedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(120);

    for (const attempt of attempts) {
      const item = await ctx.db.get(attempt.contentId);
      if (!item) continue;
      const subject = item.subjectId
        ? ((await ctx.db.get(item.subjectId)) as Doc<"subjects"> | null)
        : null;
      rows.push({
        kind: "paper_exam",
        refId: attempt._id,
        title: item.title,
        subjectName: subject?.name ?? null,
        date: attempt.endedAt,
        // Digital attempts carry an automatic score; legacy PDF-mode rows
        // carry the student's self-graded one. Prefer whichever exists.
        scorePct: attempt.autoScorePct ?? attempt.selfScorePct ?? null,
        timeSeconds: attempt.durationSeconds,
        status: (attempt.autoScorePct !== undefined || attempt.selfScorePct !== undefined)
          ? "completed"
          : attempt.completed
            ? "completed"
            : "expired",
      });
    }

    // ── 2. AI Mock Exam attempts ──
    const mockExams = await ctx.db
      .query("mockExams")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(40);

    for (const exam of mockExams) {
      if (exam.status === "abandoned") continue;
      rows.push({
        kind: "mock_exam",
        refId: exam._id,
        title: `AI Mock Exam · ${exam.stream === "social" ? "Social" : "Natural"} stream`,
        subjectName: null,
        date: exam.completedAt ?? exam.startedAt,
        scorePct: exam.totalScore ?? null,
        timeSeconds: null,
        status: exam.status === "completed" ? "completed" : "in_progress",
      });
    }

    // ── 3. Recent quiz attempts (exam-relevant subjects) ──
    const quizAttempts = await ctx.db
      .query("quizAttempts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(40);

    for (const attempt of quizAttempts) {
      const quiz = await ctx.db.get(attempt.quizId);
      if (!quiz) continue;
      const subject = await ctx.db.get(quiz.subjectId);
      rows.push({
        kind: "quiz",
        refId: attempt._id,
        title: "Topic quiz",
        subjectName: subject?.name ?? null,
        date: attempt.completedAt,
        scorePct: attempt.totalQuestions > 0
          ? Math.round((attempt.score / attempt.totalQuestions) * 100)
          : null,
        timeSeconds: null,
        status: "completed",
      });
    }

    rows.sort((a, b) => b.date - a.date);
    return rows;
  },
});
