// National exam simulation — AI-generated full mock exams.
//
// A mock exam mirrors the real EHEEE/ESSLCE structure: 6 sections (English,
// Mathematics, Aptitude/SAT + 3 stream-specific subjects), each with ~50
// (40 for Aptitude) ORIGINAL AI-generated multiple-choice questions
// grounded in the curriculum topics already in the topics table. Every
// question is freshly written by the model — never extracted from a real
// past paper, to avoid any IP concern.
//
// Flow:
//   1. generateMockExam(stream) — premium-gated action. Creates a
//      mockExams row, then for each of the 6 sections, calls Gemini to
//      generate the question set with per-section retry (3 attempts + a
//      rate-limit backoff), parses + validates the JSON (reusing the
//      quizzes.ts validator shape), and inserts a mockExamSections row
//      in "in_progress" status. Returns the mockExamId.
//
//   2. Student takes the exam section by section in the UI. The frontend
//      calls submitSectionAnswers({ sectionId, answers, flagged,
//      timeSpentSeconds }) periodically to save progress (so an
//      interrupted session isn't fully lost).
//
//   3. When the student finishes a section (or the per-section timer
//      expires), the frontend calls completeSection({ sectionId,
//      answers, flagged, timeSpentSeconds }) — the server re-parses the
//      stored questions, scores them, and stores the score. The client
//      NEVER sends the score.
//
//   4. After all 6 sections are completed, completeMockExam({ mockExamId })
//      aggregates the section scores into a final 0–100 total, writes
//      sectionResults JSON, marks the mockExam "completed", awards XP,
//      and logs a synthetic study session so it counts toward streaks.
//
//   5. getMyMockExams() returns the student's history with scores, for
//      progress tracking across attempts.
//
// PROVIDER CHOICE: Mock exams use Gemini (not Groq) because a single
// section's ~7K-token generation request would consume nearly all of
// Groq's 8,000 TPM free-tier budget by itself, leaving no room for
// concurrent tutor / quizzes / flashcards / daily-challenge traffic.
// Gemini's free tier has a much higher TPM ceiling (~1M TPM, ~15 RPM,
// ~1,500 RPD), and its binding constraint is requests-per-day — which
// fits mock exam generation perfectly (infrequent but heavy). All other
// AI features stay on Groq.

// NOTE: This file intentionally does NOT have "use node" — it contains a
// mix of actions (generateMockExam, which calls Gemini via fetch — fetch is
// available in the Convex V8 isolate too) and queries/mutations (which
// Convex runs in its V8 isolate, not Node.js). The Gemini HTTP call uses
// global fetch which works in both runtimes, so no Node-only APIs are
// needed. Keeping this file out of "use node" lets us co-locate all the
// mock-exam logic in one module.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveSubscriptionAction } from "./subscriptions";
import { callGemini, GeminiRateLimitError, GeminiUnavailableError } from "./gemini";
import { callGroq } from "./groq";
import { callOpenRouter, callCerebras, ProviderUnavailableError } from "./mockExamProviders";
import { XP_VALUES } from "./constants";

// ---------------------------------------------------------------------------
// Question shape (mirrors quizzes.ts so the frontend QuizFlow component can
// be reused for rendering)
// ---------------------------------------------------------------------------

export interface MockExamQuestion {
  question: string;
  options: string[]; // length 4
  correctIndex: number; // 0..3
  explanation: string;
}

// ---------------------------------------------------------------------------
// Real EHEEE/ESSLCE format constants
// ---------------------------------------------------------------------------

// Per-subject question count. Aptitude has ~40 questions; every other
// subject has ~50. These are the real exam's structural facts.
const QUESTIONS_PER_SUBJECT: Record<string, number> = {
  "scholastic-aptitude-test": 40,
};
const DEFAULT_QUESTIONS_PER_SUBJECT = 50;

// TEMPORARY: small test counts for CLI verification. Set to false before
// merging — real generation uses the full 50/40 counts above.
const TEST_MODE = process.env.MOCK_EXAM_TEST_MODE === "1";
const TEST_QUESTIONS_PER_SUBJECT = 3;

// Per-section time limit (seconds). Real exam is ~5 hours for 6 subjects =
// ~50 min per subject. The student can take less but not more — when the
// timer expires, the section auto-completes (matching real exam conditions).
const SECTION_DURATION_SECONDS = 50 * 60;

// Per-section retry budget for AI generation. Larger outputs (50 questions)
// are more prone to JSON truncation, so we allow 3 attempts before giving
// up on a section. Other sections still generate successfully even if one
// fails — the exam isn't blocked by a single bad section.
const MAX_SECTION_ATTEMPTS = 3;

// Output token budget per section call. 50 MCQs with explanations ≈ 6–8K
// tokens. Gemini's free-tier TPM ceiling is ~1M, so 7K is well within a
// single request. The model will produce ~50 questions in 7000 tokens
// (just slightly shorter explanations where needed). If you raise this,
// watch the per-day RPD budget — each section call counts as 1 RPD, and
// a full 6-section exam counts as 6 RPD (~250 exams/day on the 1,500 RPD
// free tier).
const TOKENS_PER_SECTION = 7000;

// ---------------------------------------------------------------------------
// Section ordering — compulsory subjects first, then stream-specific.
// English → Mathematics → Aptitude → 3 stream subjects. This is the real
// exam's typical section order.
// ---------------------------------------------------------------------------

const COMPULSORY_SUBJECT_SLUGS = [
  "english",
  "mathematics",
  "scholastic-aptitude-test",
] as const;

const STREAM_SUBJECT_SLUGS: Record<"natural" | "social", string[]> = {
  natural: ["physics", "chemistry", "biology"],
  social: ["history", "geography", "economics"],
};

// Type for which AI provider served a mock exam section.
// Used in the generateSection return shape + the frontend's progress UI.
type MockExamProvider = "gemini" | "openrouter" | "cerebras" | "groq";

// ---------------------------------------------------------------------------
// AI generation helpers (reused pattern from quizzes.ts, generalized for
// larger question counts)
// ---------------------------------------------------------------------------

async function requestSectionQuestions(
  ctx: ActionCtx,
  subjectName: string,
  stream: string,
  topicNames: string[],
  count: number,
): Promise<{ text: string; provider: MockExamProvider }> {
  const systemPrompt =
    "You write multiple-choice exam questions for the Ethiopian national exams " +
    "(EHEEE/ESSLCE), grades 9-12. Questions must be precise, exam-realistic, and " +
    "match the official syllabus. All questions must be ORIGINAL — never reproduce " +
    "any specific real exam's actual questions. " +
    "CRITICAL: Respond ONLY with a valid JSON array. Do NOT include any reasoning, " +
    "explanation, thinking, or text before or after the JSON array. " +
    "Do NOT wrap the JSON in markdown code fences. " +
    "The very first character of your response must be '[' and the very last must be ']'.";

  // Embed the literal JSON shape so the model returns a parseable array.
  // Sequence easier→harder to mirror real exam pacing. Require grounding
  // in the listed topics so questions stay on-syllabus.
  const userMessage =
    `Write exactly ${count} multiple-choice questions for ${subjectName} (${stream} stream). ` +
    "Sequence them from easier to harder. Each question must have exactly 4 options " +
    "with exactly one correct answer, plus a short explanation of why it's correct. " +
    "Ground every question in the topics below; do not invent topics outside the list. " +
    "All questions must be original — do not copy from any real past paper.\n" +
    "Respond with a JSON array only, no markdown, in exactly this shape:\n" +
    '[{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "..."}]\n' +
    `Topics to cover: ${topicNames.join(", ")}`;

  const callOpts = {
    systemPrompt,
    userMessage,
    maxTokens: TOKENS_PER_SECTION,
    temperature: 0.4,
  };

  // ── Multi-provider cascade ──────────────────────────────────────────
  // Try each provider in order. If one fails with ProviderUnavailableError
  // (rate limit, invalid key, server error), try the next. This ensures
  // the student always gets a working exam even if one provider's free
  // tier is exhausted.
  //
  // Cascade order:
  //   1. Gemini (highest TPM, but region-blocked in some areas + 429 quota)
  //   2. OpenRouter (free Llama 3.3 70B, 50-200 req/day)
  //   3. Cerebras (free Llama 3.1 8B, 1M tokens/day)
  //   4. Groq (final fallback — shared with tutor/quizzes/flashcards)
  //
  // Each provider logs failures to systemEvents so the admin can see
  // which providers are being relied on.

  const providers: Array<{
    name: MockExamProvider;
    call: () => Promise<string>;
  }> = [
    {
      name: "gemini",
      call: async () => {
        const text = await callGemini(ctx, callOpts);
        return text;
      },
    },
    {
      name: "openrouter",
      call: async () => {
        const text = await callOpenRouter(ctx, callOpts);
        return text;
      },
    },
    {
      name: "cerebras",
      call: async () => {
        const text = await callCerebras(ctx, callOpts);
        return text;
      },
    },
    {
      name: "groq",
      call: async () => {
        const text = await callGroq(ctx, callOpts);
        return text;
      },
    },
  ];

  const errors: string[] = [];

  for (const provider of providers) {
    try {
      const text = await provider.call();
      return { text, provider: provider.name };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${errorMsg}`);

      // Log the fallback for admin visibility
      try {
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "error",
          source: `mockExam.provider_${provider.name}_failed`,
          status: "error",
          metadata: JSON.stringify({
            provider: provider.name,
            subject: subjectName,
            error: errorMsg,
          }),
          durationMs: 0,
        });
      } catch {
        // Non-fatal — systemEvents is best-effort logging.
      }

      // If this is Gemini's rate-limit error, it's expected — just move
      // to the next provider. Same for ProviderUnavailableError from
      // OpenRouter/Cerebras. For GeminiUnavailableError, also move on.
      if (
        err instanceof GeminiRateLimitError ||
        err instanceof GeminiUnavailableError ||
        err instanceof ProviderUnavailableError
      ) {
        continue;
      }

      // For other errors (JSON parse, network), also try the next provider
      // rather than failing the whole section. The retry loop in
      // generateSection will handle repeated failures.
      continue;
    }
  }

  // All providers failed — throw with a summary of all errors
  throw new Error(
    `All mock exam providers failed for ${subjectName}:\n${errors.join("\n")}`,
  );
}

function parseAndValidateQuestions(raw: string, expectedCount: number): MockExamQuestion[] {
  // Clean up the raw response:
  // 1. Strip markdown code fences (```json ... ```)
  // 2. Some models (especially Nemotron) prepend "reasoning" text before
  //    the JSON array (e.g., "We need to write 50 questions... [{...}]").
  //    Extract the JSON array by finding the first '[' and last ']'.
  let cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  // If the response doesn't start with '[', try to extract the JSON array
  // from within the text. This handles reasoning models that prepend
  // chain-of-thought text before the actual JSON.
  if (!cleaned.startsWith("[")) {
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      cleaned = cleaned.slice(firstBracket, lastBracket + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // If JSON.parse still fails, try a more aggressive extraction:
    // find the first '{' and try to parse from there as an array of objects
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace > 0) {
      cleaned = "[" + cleaned.slice(firstBrace);
      // Try to fix trailing text after the last '}'
      const lastBrace = cleaned.lastIndexOf("}");
      if (lastBrace > 0) {
        cleaned = cleaned.slice(0, lastBrace + 1) + "]";
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error(`Could not parse AI response as JSON. First 200 chars: ${raw.slice(0, 200)}`);
        }
      } else {
        throw new Error(`Could not parse AI response as JSON. First 200 chars: ${raw.slice(0, 200)}`);
      }
    } else {
      throw new Error(`Could not parse AI response as JSON. First 200 chars: ${raw.slice(0, 200)}`);
    }
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Question set is not a non-empty array.");
  }
  if (parsed.length > expectedCount + 4) {
    throw new Error(`AI returned ${parsed.length} questions (expected ${expectedCount}).`);
  }
  const questions: MockExamQuestion[] = [];
  for (const item of parsed) {
    const q = item as Partial<MockExamQuestion>;
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

// ---------------------------------------------------------------------------
// Internal queries/mutations — used by generateMockExam to build sections
// ---------------------------------------------------------------------------

export const getSubjectBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) =>
    (await ctx.db
      .query("subjects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique()) ?? null,
});

export const insertMockExam = internalMutation({
  args: {
    userId: v.id("users"),
    stream: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"mockExams">> =>
    await ctx.db.insert("mockExams", {
      userId: args.userId,
      stream: args.stream as Doc<"mockExams">["stream"],
      status: "in_progress",
      startedAt: args.startedAt,
    }),
});

export const insertMockExamSection = internalMutation({
  args: {
    mockExamId: v.id("mockExams"),
    subjectId: v.id("subjects"),
    sectionIndex: v.number(),
    questionsJson: v.string(),
    totalQuestions: v.number(),
    timeAllottedSeconds: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"mockExamSections">> => {
    // Upsert-like behavior: if a row already exists for this
    // (mockExamId, sectionIndex) — e.g. from a previous failed-generation
    // retry — overwrite it with the freshly-generated questions instead
    // of inserting a duplicate. This keeps retrying a single section safe
    // (no duplicate section rows that would skew the sectionResults JSON
    // and the final score aggregation).
    const existing = await ctx.db
      .query("mockExamSections")
      .withIndex("by_mockExam", (q) => q.eq("mockExamId", args.mockExamId))
      .filter((q) => q.eq(q.field("sectionIndex"), args.sectionIndex))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        subjectId: args.subjectId,
        questionsJson: args.questionsJson,
        totalQuestions: args.totalQuestions,
        answers: new Array(args.totalQuestions).fill(-1),
        flagged: new Array(args.totalQuestions).fill(false),
        timeSpentSeconds: 0,
        status: "in_progress",
        // Clear any stale completion metadata from a prior attempt.
        score: undefined,
        correctCount: undefined,
        completedAt: undefined,
      });
      return existing._id;
    }
    const { totalQuestions, ...rest } = args;
    return await ctx.db.insert("mockExamSections", {
      ...rest,
      answers: new Array(totalQuestions).fill(-1),
      flagged: new Array(totalQuestions).fill(false),
      timeSpentSeconds: 0,
      status: "in_progress",
    });
  },
});

// ---------------------------------------------------------------------------
// Mock exam generation — split into two actions for resilience + progress UX.
//
// Flow:
//   1. startMockExam(stream) — premium-gated. Resolves all 6 subjects,
//      creates the parent mockExams row, returns the mockExamId + the
//      plan of section indexes → subject IDs.
//   2. generateSection(mockExamId, sectionIndex) — generates ONE
//      section's questions via Gemini (with 3-attempt retry + automatic
//      backoff on rate-limit 429s), persists the section row. Returns
//      success/failure + a retryable flag so the frontend can let the
//      student retry JUST that failed section without restarting the
//      whole exam. The frontend calls this sequentially for each
//      section, showing real progress.
// ---------------------------------------------------------------------------

export const startMockExam = action({
  args: {
    stream: v.union(v.literal("natural"), v.literal("social")),
  },
  handler: async (ctx, args): Promise<{
    mockExamId: Id<"mockExams">;
    sections: { sectionIndex: number; subjectId: Id<"subjects">; subjectName: string; slug: string; questionCount: number }[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    // Hard premium gate — mock exams are a flagship premium feature.
    await requireActiveSubscriptionAction(ctx, userId, "premium_mock_exams");

    const startTime = Date.now();

    // Build the section list: compulsory subjects first, then the 3
    // stream-specific subjects.
    const sectionSlugs = [
      ...COMPULSORY_SUBJECT_SLUGS,
      ...STREAM_SUBJECT_SLUGS[args.stream],
    ];

    // Resolve all subjects up front. If any subject is missing from the
    // DB (shouldn't happen post-seed, but defensive), fail fast with a
    // helpful error — we can't generate a partial exam structure.
    const sections: { sectionIndex: number; subjectId: Id<"subjects">; subjectName: string; slug: string; questionCount: number }[] = [];
    for (let i = 0; i < sectionSlugs.length; i++) {
      const slug = sectionSlugs[i];
      const doc = await ctx.runQuery(internal.mockExam.getSubjectBySlug, { slug });
      if (!doc) {
        throw new ConvexError({
          message: `Subject "${slug}" is not in the database. Run the subjects seed first.`,
          code: "invalid",
        });
      }
      const questionCount = TEST_MODE
        ? TEST_QUESTIONS_PER_SUBJECT
        : (QUESTIONS_PER_SUBJECT[doc.slug] ?? DEFAULT_QUESTIONS_PER_SUBJECT);
      sections.push({
        sectionIndex: i,
        subjectId: doc._id,
        subjectName: doc.name,
        slug: doc.slug,
        questionCount,
      });
    }

    // Create the parent mockExams row first so we can attach sections to it.
    const mockExamId = await ctx.runMutation(internal.mockExam.insertMockExam, {
      userId,
      stream: args.stream,
      startedAt: startTime,
    });

    return { mockExamId, sections };
  },
});

export const generateSection = action({
  args: {
    mockExamId: v.id("mockExams"),
    sectionIndex: v.number(),
  },
  handler: async (ctx, args): Promise<{
    sectionIndex: number;
    subjectId: Id<"subjects">;
    subjectName: string;
    questionCount: number;
    success: boolean;
    reason?: string;
    retryable?: boolean; // true when the failure was a transient rate-limit
    providerUsed?: MockExamProvider; // which AI provider actually served the call
    generationMs: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    // Verify ownership of the parent mockExam.
    const exam = await ctx.runQuery(internal.mockExam.getMockExamForOwner, {
      mockExamId: args.mockExamId,
      userId,
    });
    if (!exam) {
      throw new ConvexError({ message: "Mock exam not found.", code: "not_found" });
    }

    // Compute the subject for this section index from the stream.
    const sectionSlugs = [
      ...COMPULSORY_SUBJECT_SLUGS,
      ...STREAM_SUBJECT_SLUGS[exam.stream as "natural" | "social"],
    ];
    const slug = sectionSlugs[args.sectionIndex];
    if (!slug) {
      throw new ConvexError({
        message: `Invalid section index ${args.sectionIndex}.`,
        code: "invalid",
      });
    }
    const subject = await ctx.runQuery(internal.mockExam.getSubjectBySlug, { slug });
    if (!subject) {
      throw new ConvexError({
        message: `Subject "${slug}" is not in the database.`,
        code: "invalid",
      });
    }

    const questionCount = TEST_MODE
      ? TEST_QUESTIONS_PER_SUBJECT
      : (QUESTIONS_PER_SUBJECT[subject.slug] ?? DEFAULT_QUESTIONS_PER_SUBJECT);
    const startTime = Date.now();

    // Fetch topics to ground the questions in the real curriculum.
    let topicNames: string[] = [];
    try {
      const topics: Doc<"topics">[] = await ctx.runQuery(
        internal.ai.listTopicsBySubject,
        { subjectId: subject._id },
      );
      topicNames = topics.map((t) => t.name);
    } catch {
      // ignore — generation will proceed without topic grounding
    }

    // Retry loop: 3 attempts per section.
    //
    // - On JSON parse / validation failures → retry immediately.
    // - On GeminiRateLimitError (HTTP 429) → back off using the
    //   retryAfterMs hint from Gemini's RetryInfo (default 30s, capped at
    //   45s to avoid blowing the action wall clock) and retry. This
    //   converts a hard 429 into a soft, eventually-recoverable failure.
    // - On other errors (network, malformed) → retry immediately, but
    //   remember the error so we can surface it if all 3 attempts fail.
    //
    // After 3 failed attempts, we return { success: false, retryable: true }
    // for rate-limit failures and { success: false, retryable: false } for
    // other failures. The frontend can let the student retry just this
    // section — no need to restart the whole 6-section exam.
    let questions: MockExamQuestion[] = [];
    let lastError = "Unknown parsing error.";
    let lastRetryable = false;
    let providerUsed: MockExamProvider | undefined = undefined;
    for (let attempt = 0; attempt < MAX_SECTION_ATTEMPTS && questions.length === 0; attempt++) {
      try {
        const result = await requestSectionQuestions(
          ctx,
          subject.name,
          exam.stream,
          topicNames.length > 0 ? topicNames : ["general " + subject.name + " syllabus, grades 9-12"],
          questionCount,
        );
        providerUsed = result.provider;
        questions = parseAndValidateQuestions(result.text, questionCount);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown parsing error.";
        if (error instanceof GeminiRateLimitError) {
          // Back off before the next attempt. Cap at 45s so a 3-attempt
          // section worst-case doesn't exceed ~135s of wall clock —
          // the Convex action timeout is 5 minutes, so this stays safe.
          const backoff = Math.min(error.retryAfterMs, 45_000);
          lastRetryable = true;
          if (attempt < MAX_SECTION_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, backoff));
          }
        } else {
          // Non-rate-limit error — likely a JSON parse issue. Retry
          // immediately, no backoff needed.
          lastRetryable = false;
        }
      }
    }

    if (questions.length === 0) {
      return {
        sectionIndex: args.sectionIndex,
        subjectId: subject._id,
        subjectName: subject.name,
        questionCount: 0,
        success: false,
        reason: lastError,
        retryable: lastRetryable,
        providerUsed,
        generationMs: Date.now() - startTime,
      };
    }

    // Persist the section row.
    await ctx.runMutation(internal.mockExam.insertMockExamSection, {
      mockExamId: args.mockExamId,
      subjectId: subject._id,
      sectionIndex: args.sectionIndex,
      questionsJson: JSON.stringify(questions),
      totalQuestions: questions.length,
      timeAllottedSeconds: SECTION_DURATION_SECONDS,
    });

    return {
      sectionIndex: args.sectionIndex,
      subjectId: subject._id,
      subjectName: subject.name,
      questionCount: questions.length,
      success: true,
      providerUsed,
      generationMs: Date.now() - startTime,
    };
  },
});

// ---------------------------------------------------------------------------
// getMockExamForOwner — internal query used by generateSection to verify
// ownership without re-fetching the exam in the action.
// ---------------------------------------------------------------------------

export const getMockExamForOwner = internalQuery({
  args: {
    mockExamId: v.id("mockExams"),
    userId: v.id("users"),
  },
  handler: async (ctx, { mockExamId, userId }) => {
    const exam = await ctx.db.get(mockExamId);
    if (!exam || exam.userId !== userId) return null;
    return { _id: exam._id, stream: exam.stream, status: exam.status };
  },
});

// ---------------------------------------------------------------------------
// getLatestMockExamSummary — used by the AI tutor (ai.ts buildSystemPrompt)
// to ground its advice in the student's most recent exam performance. Returns
// null if the student has never completed a mock exam, so the tutor skips the
// context block cleanly.
//
// Returns: { latestCompletedAt, latestScore, latestStream, weakestSubjectName,
//            weakestSubjectScore, totalAttempts } | null
// ---------------------------------------------------------------------------

export const getLatestMockExamSummary = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{
    latestCompletedAt: number;
    latestScore: number;
    latestStream: string;
    weakestSubjectName: string;
    weakestSubjectScore: number;
    totalAttempts: number;
  } | null> => {
    // Fetch the user's completed mock exams, most recent first.
    const exams = await ctx.db
      .query("mockExams")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", userId).eq("status", "completed"),
      )
      .collect();
    if (exams.length === 0) return null;
    // Sort by completedAt desc — by_user_status isn't ordered by date.
    exams.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
    const latest = exams[0];
    if (!latest || latest.totalScore === undefined) return null;

    // Parse the sectionResults JSON to find the weakest subject.
    let weakestSubjectName = "Unknown";
    let weakestSubjectScore = 100;
    try {
      const results = JSON.parse(latest.sectionResults ?? "[]") as {
        subjectName: string;
        score: number;
      }[];
      for (const r of results) {
        if (typeof r.score === "number" && r.score < weakestSubjectScore) {
          weakestSubjectScore = r.score;
          weakestSubjectName = r.subjectName;
        }
      }
    } catch {
      // ignore — keep defaults
    }

    return {
      latestCompletedAt: latest.completedAt ?? latest.startedAt,
      latestScore: latest.totalScore,
      latestStream: latest.stream,
      weakestSubjectName,
      weakestSubjectScore,
      totalAttempts: exams.length,
    };
  },
});

// ---------------------------------------------------------------------------
// Mark abandoned (called when all sections fail)
// ---------------------------------------------------------------------------

export const markMockExamAbandoned = internalMutation({
  args: { mockExamId: v.id("mockExams") },
  handler: async (ctx, { mockExamId }) => {
    await ctx.db.patch(mockExamId, { status: "abandoned" });
  },
});

// ---------------------------------------------------------------------------
// Get the active mock exam (sections + their question sets) for the UI
// ---------------------------------------------------------------------------

export const getMyMockExam = query({
  args: { mockExamId: v.id("mockExams") },
  handler: async (ctx, { mockExamId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const exam = await ctx.db.get(mockExamId);
    if (!exam || exam.userId !== userId) return null;
    const sectionRows = await ctx.db
      .query("mockExamSections")
      .withIndex("by_mockExam_sectionIndex", (q) => q.eq("mockExamId", mockExamId))
      .collect();
    // Decode questions for each section so the frontend can render them.
    // Don't include correctIndex/explanation until the section is completed
    // — the student shouldn't see answers while taking the exam.
    const sections = sectionRows
      .sort((a, b) => a.sectionIndex - b.sectionIndex)
      .map((s) => {
        let questions: MockExamQuestion[] = [];
        try {
          questions = JSON.parse(s.questionsJson) as MockExamQuestion[];
        } catch {
          questions = [];
        }
        const visibleQuestions = s.status === "completed"
          ? questions
          : questions.map((q) => ({
              question: q.question,
              options: q.options,
              // Hide answer until section is completed
              correctIndex: -1,
              explanation: "",
            }));
        return {
          _id: s._id,
          sectionIndex: s.sectionIndex,
          subjectId: s.subjectId,
          questions: visibleQuestions,
          answers: s.answers,
          flagged: s.flagged,
          timeAllottedSeconds: s.timeAllottedSeconds,
          timeSpentSeconds: s.timeSpentSeconds,
          status: s.status,
          score: s.score,
          correctCount: s.correctCount,
          totalQuestions: s.totalQuestions,
        };
      });
    return {
      _id: exam._id,
      stream: exam.stream,
      status: exam.status,
      startedAt: exam.startedAt,
      completedAt: exam.completedAt,
      totalScore: exam.totalScore,
      sections,
    };
  },
});

// ---------------------------------------------------------------------------
// submitSectionAnswers — save progress (called periodically by the UI)
// ---------------------------------------------------------------------------

export const submitSectionAnswers = mutation({
  args: {
    sectionId: v.id("mockExamSections"),
    answers: v.array(v.number()),
    flagged: v.array(v.boolean()),
    timeSpentSeconds: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const section = await ctx.db.get(args.sectionId);
    if (!section) {
      throw new ConvexError({ message: "Section not found.", code: "not_found" });
    }
    // Verify ownership via the parent mockExam
    const exam = await ctx.db.get(section.mockExamId);
    if (!exam || exam.userId !== userId) {
      throw new ConvexError({ message: "Section not found.", code: "not_found" });
    }
    if (section.status === "completed") {
      // Already completed — ignore subsequent saves. (Idempotent.)
      return { ok: true as const, alreadyCompleted: true as const };
    }
    if (exam.status !== "in_progress") {
      throw new ConvexError({ message: "Exam is no longer in progress.", code: "invalid" });
    }

    // Validate answer length matches the stored questions. Out-of-range
    // indices are normalized to -1 (unanswered). This is a save-only
    // mutation — no scoring here.
    let questionCount = 0;
    try {
      questionCount = (JSON.parse(section.questionsJson) as unknown[]).length;
    } catch {
      throw new ConvexError({ message: "Section data corrupted.", code: "internal" });
    }
    const normalizedAnswers = args.answers.slice(0, questionCount);
    while (normalizedAnswers.length < questionCount) normalizedAnswers.push(-1);
    const safeAnswers = normalizedAnswers.map((a) =>
      Number.isInteger(a) && a >= 0 && a <= 3 ? a : -1,
    );
    const safeFlagged = args.flagged.slice(0, questionCount);
    while (safeFlagged.length < questionCount) safeFlagged.push(false);

    await ctx.db.patch(args.sectionId, {
      answers: safeAnswers,
      flagged: safeFlagged,
      timeSpentSeconds: Math.max(0, Math.min(args.timeSpentSeconds, section.timeAllottedSeconds)),
    });
    return { ok: true as const, alreadyCompleted: false as const };
  },
});

// ---------------------------------------------------------------------------
// completeSection — server-side scoring (NEVER trust client scores)
// ---------------------------------------------------------------------------

export const completeSection = mutation({
  args: {
    sectionId: v.id("mockExamSections"),
    answers: v.array(v.number()),
    flagged: v.array(v.boolean()),
    timeSpentSeconds: v.number(),
  },
  handler: async (ctx, args): Promise<{
    sectionId: Id<"mockExamSections">;
    score: number; // 0..100
    correctCount: number;
    totalQuestions: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const section = await ctx.db.get(args.sectionId);
    if (!section) {
      throw new ConvexError({ message: "Section not found.", code: "not_found" });
    }
    const exam = await ctx.db.get(section.mockExamId);
    if (!exam || exam.userId !== userId) {
      throw new ConvexError({ message: "Section not found.", code: "not_found" });
    }
    if (section.status === "completed") {
      // Idempotent — return the previously computed score.
      return {
        sectionId: section._id,
        score: section.score ?? 0,
        correctCount: section.correctCount ?? 0,
        totalQuestions: section.totalQuestions ?? 0,
      };
    }
    if (exam.status !== "in_progress") {
      throw new ConvexError({ message: "Exam is no longer in progress.", code: "invalid" });
    }

    // Re-parse the stored questions server-side. The client's answers are
    // the only thing we accept from them — score is computed here, never
    // sent by the client.
    let questions: MockExamQuestion[] = [];
    try {
      questions = JSON.parse(section.questionsJson) as MockExamQuestion[];
    } catch {
      throw new ConvexError({ message: "Section data corrupted.", code: "internal" });
    }
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new ConvexError({ message: "Section data corrupted.", code: "internal" });
    }

    // Score: out-of-range or non-integer answer indices count as wrong
    // (selected = -1). Same pattern as quizzes.submitAttempt.
    let correctCount = 0;
    const storedAnswers: number[] = [];
    for (let i = 0; i < questions.length; i++) {
      const raw = args.answers[i];
      const answered = Number.isInteger(raw) && raw >= 0 && raw < questions[i].options.length;
      const selected = answered ? (raw as number) : -1;
      storedAnswers.push(selected);
      if (answered && selected === questions[i].correctIndex) {
        correctCount++;
      }
    }
    const safeFlagged = args.flagged.slice(0, questions.length);
    while (safeFlagged.length < questions.length) safeFlagged.push(false);
    const score = Math.round((correctCount / questions.length) * 100);
    const clampedTime = Math.max(0, Math.min(args.timeSpentSeconds, section.timeAllottedSeconds));

    await ctx.db.patch(args.sectionId, {
      answers: storedAnswers,
      flagged: safeFlagged,
      timeSpentSeconds: clampedTime,
      score,
      correctCount,
      totalQuestions: questions.length,
      status: "completed",
      completedAt: Date.now(),
    });

    return {
      sectionId: section._id,
      score,
      correctCount,
      totalQuestions: questions.length,
    };
  },
});

// ---------------------------------------------------------------------------
// completeMockExam — aggregate section scores, mark exam completed, award XP
// ---------------------------------------------------------------------------

export const completeMockExam = mutation({
  args: { mockExamId: v.id("mockExams") },
  handler: async (ctx, args): Promise<{
    mockExamId: Id<"mockExams">;
    totalScore: number;
    sectionResults: { subjectId: Id<"subjects">; subjectName: string; score: number; correctCount: number; totalQuestions: number; timeSpentSeconds: number }[];
    xpAwarded: number;
    levelUp: boolean;
    newLevel: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const exam = await ctx.db.get(args.mockExamId);
    if (!exam || exam.userId !== userId) {
      throw new ConvexError({ message: "Mock exam not found.", code: "not_found" });
    }
    if (exam.status === "completed") {
      // Idempotent — return previously computed results.
      let prevResults: typeof sectionResults = [];
      try {
        prevResults = JSON.parse(exam.sectionResults ?? "[]");
      } catch {
        prevResults = [];
      }
      return {
        mockExamId: exam._id,
        totalScore: exam.totalScore ?? 0,
        sectionResults: prevResults,
        xpAwarded: 0,
        levelUp: false,
        newLevel: 1,
      };
    }
    if (exam.status === "abandoned") {
      throw new ConvexError({ message: "Mock exam was abandoned.", code: "invalid" });
    }

    // Pull all sections. They should all be "completed" — if any are
    // still in_progress, the frontend shouldn't have called this. Be
    // defensive: auto-complete them with whatever answers are stored.
    const sectionRows = await ctx.db
      .query("mockExamSections")
      .withIndex("by_mockExam_sectionIndex", (q) => q.eq("mockExamId", args.mockExamId))
      .collect();
    sectionRows.sort((a, b) => a.sectionIndex - b.sectionIndex);

    const sectionResults: { subjectId: Id<"subjects">; subjectName: string; score: number; correctCount: number; totalQuestions: number; timeSpentSeconds: number }[] = [];
    let totalCorrect = 0;
    let totalQuestions = 0;
    let totalTimeSpent = 0;
    let firstSubjectId: Id<"subjects"> | null = null;

    for (const section of sectionRows) {
      // Resolve subject name for the breakdown.
      const subject = await ctx.db.get(section.subjectId);
      const subjectName = subject?.name ?? "Unknown";

      if (section.status !== "completed") {
        // Auto-complete with currently-stored answers (re-using the
        // completeSection scoring logic would require an action call; we
        // do the same math inline here since we're already in a mutation).
        let questions: MockExamQuestion[] = [];
        try {
          questions = JSON.parse(section.questionsJson) as MockExamQuestion[];
        } catch {
          questions = [];
        }
        let correctCount = 0;
        for (let i = 0; i < questions.length; i++) {
          const sel = section.answers[i];
          if (Number.isInteger(sel) && sel >= 0 && sel === questions[i].correctIndex) {
            correctCount++;
          }
        }
        const score = questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0;
        await ctx.db.patch(section._id, {
          score,
          correctCount,
          totalQuestions: questions.length,
          status: "completed",
          completedAt: Date.now(),
        });
        sectionResults.push({
          subjectId: section.subjectId,
          subjectName,
          score,
          correctCount,
          totalQuestions: questions.length,
          timeSpentSeconds: section.timeSpentSeconds,
        });
        totalCorrect += correctCount;
        totalQuestions += questions.length;
        totalTimeSpent += section.timeSpentSeconds;
      } else {
        sectionResults.push({
          subjectId: section.subjectId,
          subjectName,
          score: section.score ?? 0,
          correctCount: section.correctCount ?? 0,
          totalQuestions: section.totalQuestions ?? 0,
          timeSpentSeconds: section.timeSpentSeconds,
        });
        totalCorrect += section.correctCount ?? 0;
        totalQuestions += section.totalQuestions ?? 0;
        totalTimeSpent += section.timeSpentSeconds;
      }
      if (firstSubjectId === null) firstSubjectId = section.subjectId;
    }

    // Aggregate score 0–100 = (total correct / total questions) * 100.
    const totalScore = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
    const now = Date.now();
    await ctx.db.patch(args.mockExamId, {
      status: "completed",
      completedAt: now,
      totalScore,
      sectionResults: JSON.stringify(sectionResults),
    });

    // Award XP — base + per-correct bonus across all sections. Reuses the
    // same internal.xp.awardXp mutation as quizzes.
    const xpAmount =
      XP_VALUES.mock_exam_complete_base +
      XP_VALUES.mock_exam_per_correct * totalCorrect;
    const award = await ctx.runMutation(internal.xp.awardXp, {
      userId,
      amount: xpAmount,
      reason: "mock_exam_complete",
    });

    // Log a synthetic study session so this counts toward streaks and the
    // student's study history. Use the first section's subject as the
    // nominal subject (we can only pick one — the schema's studySessions
    // table is single-subject). Time = total time spent across sections.
    if (firstSubjectId && totalTimeSpent > 0) {
      const localDate = new Date(now).toISOString().slice(0, 10);
      try {
        await ctx.runMutation(internal.studySessions.logSessionFromAction, {
          userId,
          subjectId: firstSubjectId,
          durationSeconds: Math.min(totalTimeSpent, 12 * 60 * 60),
          startedAt: exam.startedAt,
          endedAt: now,
          localDate,
          xpReason: "mock_exam_complete",
          // 0 — XP is already awarded above; this call is for the session row + streak only.
          xpAmount: 0,
        });
      } catch {
        // Non-fatal: streak logging should never block exam completion.
      }
    }

    // Idempotent achievement sweep.
    await ctx.runMutation(internal.achievements.checkAndAward, { userId });

    return {
      mockExamId: exam._id,
      totalScore,
      sectionResults,
      xpAwarded: award.xpAwarded,
      levelUp: award.levelUp,
      newLevel: award.level,
    };
  },
});

// ---------------------------------------------------------------------------
// getMyMockExams — history for progress tracking
// ---------------------------------------------------------------------------

export const getMyMockExams = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const exams = await ctx.db
      .query("mockExams")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .collect();
    // Most recent first
    exams.sort((a, b) => b.startedAt - a.startedAt);
    return exams.map((e) => ({
      _id: e._id,
      stream: e.stream,
      status: e.status,
      startedAt: e.startedAt,
      completedAt: e.completedAt,
      totalScore: e.totalScore,
    }));
  },
});

// ---------------------------------------------------------------------------
// abandonMockExam — give up on an in-progress exam (frees the student to
// start a new one). Called when the student navigates away or explicitly
// abandons.
// ---------------------------------------------------------------------------

export const abandonMockExam = mutation({
  args: { mockExamId: v.id("mockExams") },
  handler: async (ctx, { mockExamId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const exam = await ctx.db.get(mockExamId);
    if (!exam || exam.userId !== userId) {
      throw new ConvexError({ message: "Mock exam not found.", code: "not_found" });
    }
    if (exam.status !== "in_progress") {
      return { ok: true as const, alreadyDone: true as const };
    }
    await ctx.db.patch(mockExamId, { status: "abandoned" });
    return { ok: true as const, alreadyDone: false as const };
  },
});
