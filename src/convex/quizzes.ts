// Quiz / examination engine.
//
// generateQuiz asks Grok to write a personalized quiz grounded in the
// subject's real syllabus topics (same grounding pattern as ai.ts and
// studyPlans.ts), validates the JSON (retry once), and stores the questions
// on a quizzes row owned by the generating user.
//
// submitAttempt scores SERVER-SIDE from the stored questions — a client can
// never submit its own score. The correct answers are returned for immediate
// per-question feedback during the attempt.

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
import type { Doc, Id } from "./_generated/dataModel";
import { getPremiumAccess } from "./subscriptions";
import {
  FREE_QUIZ_WEEKLY_LIMIT,
  FREE_QUIZ_WINDOW_DAYS,
  XP_VALUES,
} from "./constants";

const API_URL = "https://api.x.ai/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "grok-4.6";

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export async function requestQuestions(
  ctx: ActionCtx,
  subjectName: string,
  stream: string,
  topicNames: string[],
  count: number,
): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    throw new ConvexError({
      message: "Quiz generation is not configured yet — add XAI_API_KEY in the Keys tab.",
      code: "ai_not_configured",
    });
  }
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You write multiple-choice exam questions for the Ethiopian national exams " +
            "(ESLCE), grades 9-12. Questions must be precise, exam-realistic, and match " +
            "the official syllabus. Respond ONLY with valid JSON and nothing else.",
        },
        {
          role: "user",
          content:
            `Write exactly ${count} multiple-choice questions for ${subjectName} (${stream} stream). ` +
            "Sequence them from easier to harder. Each question must have exactly 4 options " +
            "with exactly one correct answer, plus a short explanation of why it's correct. " +
            "Ground every question in the topics below; do not invent topics outside the list.\n" +
            "Respond with a JSON array only, no markdown, in exactly this shape:\n" +
            '[{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "..."}]\n' +
            `Topics to cover: ${topicNames.join(", ")}`,
        },
      ],
      max_tokens: 4096,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Grok API error ${response.status}: ${raw.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("Grok returned an empty quiz response.");
  return content;
}

export function parseAndValidate(raw: string, expectedCount: number): QuizQuestion[] {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Quiz is not a non-empty array.");
  }
  if (parsed.length > expectedCount + 4) {
    throw new Error(`Quiz returned ${parsed.length} questions (expected ${expectedCount}).`);
  }
  const questions: QuizQuestion[] = [];
  for (const item of parsed) {
    const q = item as Partial<QuizQuestion>;
    if (
      typeof q.question !== "string" ||
      !q.question.trim() ||
      !Array.isArray(q.options) ||
      q.options.length !== 4 ||
      q.options.some((o) => typeof o !== "string" || !o.trim()) ||
      typeof q.correctIndex !== "number" ||
      !Number.isInteger(q.correctIndex) ||
      q.correctIndex < 0 ||
      q.correctIndex > 3 ||
      typeof q.explanation !== "string" ||
      !q.explanation.trim()
    ) {
      throw new Error("One or more questions are malformed.");
    }
    questions.push({
      question: q.question.trim(),
      options: q.options.map((o) => o.trim()),
      correctIndex: q.correctIndex,
      explanation: q.explanation.trim(),
    });
  }
  return questions.slice(0, expectedCount);
}

export const generateQuiz = action({
  args: {
    subjectId: v.id("subjects"),
    topicId: v.optional(v.id("topics")),
    questionCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ quizId: Id<"quizzes">; questions: QuizQuestion[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    // Free tier gets a fair allowance: one quiz per subject per week, so
    // students see real value before deciding to upgrade. Premium (trial or
    // paid) is unlimited. The weekly window matches the entitlement query.
    const premium = await getPremiumAccess(ctx, userId);
    if (!premium) {
      const weekStart = Date.now() - FREE_QUIZ_WINDOW_DAYS * 24 * 60 * 60 * 1000;
      const used = await ctx.runQuery(internal.quizzes.countQuizzesForSubjectSince, {
        userId,
        subjectId: args.subjectId,
        since: weekStart,
      });
      if (used >= FREE_QUIZ_WEEKLY_LIMIT) {
        throw new ConvexError({
          message:
            `Free accounts get ${FREE_QUIZ_WEEKLY_LIMIT} quiz per subject per week — you've used yours for this subject. ` +
            "Try again next week, or upgrade for unlimited quizzes and your full score history.",
          code: "weekly_quiz_limit",
        });
      }
    }

    const subject = await ctx.runQuery(internal.ai.getSubjectById, {
      subjectId: args.subjectId,
    });
    if (!subject) {
      throw new ConvexError({ message: "Subject not found.", code: "invalid" });
    }

    // ActionCtx.runQuery is deliberately untyped (any) — annotate the rows so
    // downstream callbacks stay type-safe.
    const topics: Doc<"topics">[] = await ctx.runQuery(
      internal.ai.listTopicsBySubject,
      { subjectId: args.subjectId },
    );
    if (args.topicId) {
      const topic = topics.find((t) => t._id === args.topicId);
      if (!topic) {
        throw new ConvexError({ message: "Topic not found.", code: "invalid" });
      }
      topics.splice(0, topics.length, topic);
    }
    if (topics.length === 0) {
      throw new ConvexError({
        message: `No syllabus topics exist yet for ${subject.name}. Add topics to the library before generating a quiz.`,
        code: "no_topics",
      });
    }

    const count = Math.min(20, Math.max(5, Math.round(args.questionCount ?? 10)));
    const topicNames = topics.map((t) => t.name);

    // Generate with one retry on malformed output.
    let questions: QuizQuestion[] = [];
    let lastError = "Unknown parsing error.";
    for (let attempt = 0; attempt < 2 && questions.length === 0; attempt++) {
      try {
        const raw = await requestQuestions(ctx, subject.name, subject.stream, topicNames, count);
        questions = parseAndValidate(raw, count);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown parsing error.";
      }
    }
    if (questions.length === 0) {
      throw new ConvexError({
        message: `The AI returned an unreadable quiz (${lastError}). Please try again.`,
        code: "ai_error",
      });
    }

    const quizId = await ctx.runMutation(internal.quizzes.insertQuiz, {
      subjectId: args.subjectId,
      topicId: args.topicId,
      generatedForUserId: userId,
      questionsJson: JSON.stringify(questions),
    });
    return { quizId, questions };
  },
});

/**
 * How many quizzes this user has generated for a subject within the last
 * FREE_QUIZ_WINDOW_DAYS — used to enforce the free-tier weekly allowance
 * (one per subject per week) before a single token is spent.
 */
export const countQuizzesForSubjectSince = internalQuery({
  args: {
    userId: v.id("users"),
    subjectId: v.id("subjects"),
    since: v.number(),
  },
  handler: async (ctx, { userId, subjectId, since }) => {
    const quizzes = await ctx.db
      .query("quizzes")
      .withIndex("by_user", (q) => q.eq("generatedForUserId", userId))
      .take(200);
    let count = 0;
    for (const quiz of quizzes) {
      if (quiz.subjectId === subjectId && quiz.createdAt >= since) {
        count += 1;
      }
    }
    return count;
  },
});

export const insertQuiz = internalMutation({
  args: {
    subjectId: v.id("subjects"),
    topicId: v.optional(v.id("topics")),
    generatedForUserId: v.id("users"),
    questionsJson: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("quizzes", {
      ...args,
      createdAt: Date.now(),
    }),
});

// ---------------------------------------------------------------------------
// Attempts — server-side scoring only
// ---------------------------------------------------------------------------

export interface SubmitAttemptResult {
  score: number;
  total: number;
  results: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
    selected: number;
    correct: boolean;
  }[];
  quizId: Id<"quizzes">;
  xpAwarded: number;
  levelUp: boolean;
  newLevel: number;
  newAchievements: { id: string; name: string; tier: "bronze" | "silver" | "gold" }[];
}

export const submitAttempt = mutation({
  args: {
    quizId: v.id("quizzes"),
    answers: v.array(v.number()),
  },
  handler: async (ctx, { quizId, answers }): Promise<SubmitAttemptResult> => {
    const userId = await requireUser(ctx);
    const quiz = await ctx.db.get(quizId);
    if (!quiz || quiz.generatedForUserId !== userId) {
      throw new ConvexError({ message: "Quiz not found.", code: "not_found" });
    }

    let questions: QuizQuestion[];
    try {
      questions = JSON.parse(quiz.questionsJson) as QuizQuestion[];
    } catch {
      throw new ConvexError({ message: "Quiz data is corrupted.", code: "internal" });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new ConvexError({ message: "Quiz data is corrupted.", code: "internal" });
    }

    // Score from the stored questions — never from anything the client sent
    // beyond the raw answer indices (validated + clamped here).
    const results = questions.map((question, index) => {
      const raw = answers[index];
      const answered =
        Number.isInteger(raw) && raw >= 0 && raw < question.options.length;
      const selected = answered ? raw : -1;
      const correct = answered && selected === question.correctIndex;
      return {
        question: question.question,
        options: question.options,
        correctIndex: question.correctIndex,
        explanation: question.explanation,
        selected,
        correct,
      };
    });

    const score = results.filter((r) => r.correct).length;
    const storedAnswers = results.map((r) => r.selected);

    await ctx.db.insert("quizAttempts", {
      quizId,
      userId,
      answers: storedAnswers,
      score,
      totalQuestions: questions.length,
      completedAt: Date.now(),
    });

    // XP is earned through the real action of completing a quiz: base + per
    // correct answer. Awarded server-side, never grantable by a client call.
    const xpAmount =
      XP_VALUES.quiz_complete_base + XP_VALUES.quiz_complete_per_correct * score;
    const award = await ctx.runMutation(internal.xp.awardXp, {
      userId,
      amount: xpAmount,
      reason: "quiz_complete",
    });
    // Idempotent sweep — first quiz + perfect-paper achievements.
    const newly = await ctx.runMutation(internal.achievements.checkAndAward, { userId });

    return {
      score,
      total: questions.length,
      results,
      quizId,
      xpAwarded: xpAmount,
      levelUp: award.levelUp,
      newLevel: award.level,
      newAchievements: newly.map((a) => ({
        id: a.id,
        name: a.name,
        tier: a.tier,
      })),
    };
  },
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Full questions for an owned quiz (used if the client reloads mid-quiz). */
export const getQuiz = query({
  args: { quizId: v.id("quizzes") },
  handler: async (ctx, { quizId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const quiz = await ctx.db.get(quizId);
    if (!quiz || quiz.generatedForUserId !== userId) return null;
    let questions: QuizQuestion[] = [];
    try {
      questions = JSON.parse(quiz.questionsJson) as QuizQuestion[];
    } catch {
      questions = [];
    }
    const subject = await ctx.db.get(quiz.subjectId);
    return {
      _id: quiz._id,
      subjectId: quiz.subjectId,
      subjectName: subject?.name ?? "Unknown",
      topicId: quiz.topicId ?? null,
      questions,
    };
  },
});

/** The user's past attempts with subject context, newest first. */
export const getQuizHistory = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const attempts = await ctx.db
      .query("quizAttempts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60);

    const result = [];
    const subjectCache = new Map<Id<"subjects">, Doc<"subjects">>();
    for (const attempt of attempts) {
      const quiz = await ctx.db.get(attempt.quizId);
      let subjectName = "Unknown";
      if (quiz) {
        let subject = subjectCache.get(quiz.subjectId);
        if (!subject) {
          subject = (await ctx.db.get(quiz.subjectId)) ?? undefined;
          if (subject) subjectCache.set(quiz.subjectId, subject);
        }
        subjectName = subject?.name ?? "Unknown";
      }
      result.push({
        _id: attempt._id,
        quizId: attempt.quizId,
        subjectName,
        score: attempt.score,
        totalQuestions: attempt.totalQuestions,
        completedAt: attempt.completedAt,
      });
    }
    return result;
  },
});
