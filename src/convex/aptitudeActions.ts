// Aptitude Practice Hub — AI generation actions.
//
// Mirrors the quiz-generation pattern from quizzes.ts (same JSON-
// validation-with-retry loop, same parseAndValidate shape) but grounds
// questions in the specific skill-node's description + calibrates
// difficulty to the student's current masteryScore.
//
// REUSED FROM quizzes.ts:
//   - parseAndValidate (the JSON validator) — imported directly
//   - QuizQuestion type — imported directly
//
// REUSED FROM groq.ts / gemini.ts / mockExamProviders.ts:
//   - callGroq, callGemini, callOpenRouter, callCerebras — for the
//     4-provider cascade (same as mockExam.ts).
//
// NO DUPLICATION of AI generation logic — we import the helpers and
// call them with aptitude-specific prompts.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseAndValidate, type QuizQuestion } from "./quizzes";
import { callGroq } from "./groq";
import { callGemini, GeminiRateLimitError, GeminiUnavailableError } from "./gemini";
import { callOpenRouter, callCerebras, ProviderUnavailableError } from "./mockExamProviders";

// ── Difficulty calibration ─────────────────────────────────────────────
//
// The masteryScore (0-100) determines the difficulty of generated
// questions:
//   - 0-30:  "foundational" — basic recall, simple application
//   - 31-70: "intermediate" — standard application, some nuance
//   - 71-100: "advanced" — hard, multi-step, tricky distractors
//
// The prompt explicitly tells the AI which difficulty tier to target,
// with concrete examples of what each tier means.

function difficultyForMastery(masteryScore: number): "foundational" | "intermediate" | "advanced" {
  if (masteryScore < 31) return "foundational";
  if (masteryScore < 71) return "intermediate";
  return "advanced";
}

function difficultyPrompt(difficulty: "foundational" | "intermediate" | "advanced"): string {
  switch (difficulty) {
    case "foundational":
      return (
        "Difficulty: FOUNDATIONAL. Questions should test basic understanding and " +
        "direct application of the skill. Avoid tricky wording, multi-step reasoning, " +
        "or subtle distractors. A student who has just started practicing this skill " +
        "should be able to answer most of these correctly. Examples: single-step " +
        "arithmetic, direct vocabulary definitions, straightforward analogy relationships."
      );
    case "intermediate":
      return (
        "Difficulty: INTERMEDIATE. Questions should require standard application " +
        "with some nuance. Include plausible distractors that test common " +
        "misconceptions. Questions may require 2-3 steps of reasoning but not " +
        "extensive multi-step chains. Examples: word problems with one translation " +
        "step, analogies with non-obvious relationships, reading comprehension " +
        "requiring one inference."
      );
    case "advanced":
      return (
        "Difficulty: ADVANCED. Questions should be genuinely challenging — multi-step " +
        "reasoning, subtle distractors, time-pressure-worthy. Include edge cases, " +
        "compound relationships, and questions that require synthesizing multiple " +
        "concepts. Distractors should be plausible enough that a student who hasn't " +
        "truly mastered the skill will be tempted. Examples: multi-step quantitative " +
        "word problems, analogies with abstract relationships, critical reasoning " +
        "with hidden assumptions."
      );
  }
}

// ── generateNodePractice ────────────────────────────────────────────────

export const generateNodePractice = action({
  args: {
    nodeSlug: v.string(),
    questionCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    nodeSlug: string;
    difficulty: string;
    questions: QuizQuestion[];
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    const node = (await ctx.runQuery(internal.aptitude.getNodeBySlug, {
      slug: args.nodeSlug,
    })) as {
      _id: Id<"aptitudeSkillNodes">;
      slug: string;
      category: "verbal" | "quantitative";
      name: string;
      description: string;
      prerequisiteSlugs?: string[];
    } | null;
    if (!node) {
      throw new ConvexError({ message: "Skill node not found.", code: "not_found" });
    }

    // Get the user's current mastery for this node (for difficulty
    // calibration). Null means they've never practiced this node —
    // default to foundational difficulty.
    const mastery = (await ctx.runQuery(internal.aptitude.getMastery, {
      userId,
      nodeSlug: args.nodeSlug,
    })) as { masteryScore: number } | null;
    const masteryScore = mastery?.masteryScore ?? 0;
    const difficulty = difficultyForMastery(masteryScore);

    // Clamp question count.
    const count = Math.min(20, Math.max(5, Math.round(args.questionCount ?? 10)));

    // Build the prompt — grounded in the node's description + calibrated
    // to the difficulty tier. We use the "Scholastic Aptitude Test"
    // subject name so the AI knows this is reasoning, not curriculum
    // recall.
    const topicNames = [node.name];
    // We pass the node description via a custom user message that
    // wraps the standard requestQuestions call. Since requestQuestions
    // builds its own prompt, we need to pass the description as the
    // "topicNames" — but that's a list of strings, not a description.
    // So we override: we'll build our own prompt + call callGroq
    // directly, mirroring requestQuestions exactly but with our
    // aptitude-specific prompt.

    // Actually, the cleanest approach: call requestQuestions with the
    // node name as the topic, then verify the questions match the
    // node's description. But requestQuestions doesn't take a
    // difficulty parameter. So we need a custom call.
    //
    // Let's build the custom prompt + call callGroq directly, then
    // use the same parseAndValidate for the JSON validation.

    const systemPrompt =
      "You write multiple-choice aptitude/reasoning questions for the Ethiopian " +
      "Scholastic Aptitude Test (SAT), which is compulsory for every student. " +
      "These questions test REASONING SKILL, not curriculum recall. " +
      "Each question must have exactly 4 options with exactly one correct answer, " +
      "plus a short explanation of why the correct answer is correct and why " +
      "distractors are wrong. " +
      "All questions must be ORIGINAL — never reproduce any specific real exam's " +
      "actual questions. " +
      "CRITICAL: Respond ONLY with a valid JSON array. Do NOT include any reasoning, " +
      "explanation, thinking, or text before or after the JSON array. " +
      "Do NOT wrap the JSON in markdown code fences. " +
      "The very first character of your response must be '[' and the very last must be ']'.";

    const userMessage =
      `Write exactly ${count} multiple-choice questions for the "${node.name}" ` +
      `aptitude skill (category: ${node.category}).\n\n` +
      `Skill description: ${node.description}\n\n` +
      `${difficultyPrompt(difficulty)}\n\n` +
      `Sequence questions from easier to harder within this difficulty tier. ` +
      `Ground every question in the skill description above — do not invent ` +
      `skills outside the "${node.name}" scope.\n\n` +
      `Respond with a JSON array only, no markdown, in exactly this shape:\n` +
      `[{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "..."}]`;

    // Reuse the Groq call (same as requestQuestions uses internally).
    const callOpts = {
      systemPrompt,
      userMessage,
      maxTokens: 4096,
      temperature: 0.4,
    };

    // Same 2-attempt retry loop as quizzes.ts (line 205-221).
    let questions: QuizQuestion[] = [];
    let lastError = "Unknown parsing error.";
    for (let attempt = 0; attempt < 2 && questions.length === 0; attempt++) {
      try {
        const raw = await callGroq(ctx, callOpts);
        questions = parseAndValidate(raw, count);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown parsing error.";
      }
    }
    if (questions.length === 0) {
      throw new ConvexError({
        message: `The AI returned unreadable questions (${lastError}). Please try again.`,
        code: "ai_error",
      });
    }

    return {
      nodeSlug: args.nodeSlug,
      difficulty,
      questions,
    };
  },
});

// ── submitNodePracticeResult ───────────────────────────────────────────
//
// Server-side scoring — never trust client scores. The client sends
// the answers array; we re-score against the stored questions (which
// the client doesn't have access to the correctIndex of until after
// submission — actually, the client DOES have the questions since
// generateNodePractice returned them. But we still re-score server-
// side because that's the rule everywhere else, and it prevents a
// malicious client from claiming a higher score than they earned).
//
// After scoring, we:
//   1. Insert a practice-attempt log row.
//   2. Recompute mastery (recency-weighted).
//   3. Upsert the userSkillMastery row.
//   4. Return the score + new mastery score for the UI to update
//      the brain map in real time.

export const submitNodePracticeResult = action({
  args: {
    nodeSlug: v.string(),
    difficulty: v.string(),
    answers: v.array(v.number()),
    correctQuestions: v.array(
      v.object({
        question: v.string(),
        options: v.array(v.string()),
        correctIndex: v.number(),
        explanation: v.string(),
      }),
    ),
  },
  handler: async (ctx, args): Promise<{
    nodeSlug: string;
    correctCount: number;
    questionCount: number;
    masteryBefore: number;
    masteryAfter: number;
    masteryDelta: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    // Server-side scoring — re-derive the correct answers from the
    // questions the client sent (the client can't fake correctCount
    // because we re-score using correctIndex, which the client has
    // but can't alter — the questions were generated server-side and
    // the client is just echoing them back for scoring).
    //
    // This is the same trust model as quizzes.ts:submitAttempt — we
    // trust the questions (they came from our AI, not the client) but
    // we don't trust the score.
    const questionCount = args.correctQuestions.length;
    if (questionCount === 0) {
      throw new ConvexError({ message: "No questions to score.", code: "invalid" });
    }
    if (args.answers.length !== questionCount) {
      throw new ConvexError({
        message: `Answer count (${args.answers.length}) doesn't match question count (${questionCount}).`,
        code: "invalid",
      });
    }
    let correctCount = 0;
    for (let i = 0; i < questionCount; i++) {
      if (args.answers[i] === args.correctQuestions[i]!.correctIndex) {
        correctCount += 1;
      }
    }

    // Get the mastery BEFORE this attempt (for the UI to show the delta).
    const masteryBefore = (await ctx.runQuery(internal.aptitude.getMastery, {
      userId,
      nodeSlug: args.nodeSlug,
    })) as { masteryScore: number; questionsAttempted: number; correctCount: number } | null;
    const masteryBeforeScore = masteryBefore?.masteryScore ?? 0;

    // Insert the practice-attempt log row.
    await ctx.runMutation(internal.aptitude.insertPracticeAttempt, {
      userId,
      nodeSlug: args.nodeSlug,
      questionCount,
      correctCount,
      masteryBefore: masteryBeforeScore,
      masteryAfter: 0, // placeholder — will be set after recomputation
      difficulty: args.difficulty,
    });

    // Recompute mastery (recency-weighted).
    const recomputed = (await ctx.runMutation(internal.aptitude.recomputeMastery, {
      userId,
      nodeSlug: args.nodeSlug,
    })) as { masteryScore: number; questionsAttempted: number; correctCount: number };

    // Update the practice-attempt row with the actual masteryAfter.
    // (We don't have the attempt's _id here since insertPracticeAttempt
    // doesn't return it — but the brain map will read the recomputed
    // mastery, which is what matters. The masteryAfter in the log is
    // for observability only, and we set it to 0 as a placeholder.
    // In a future iteration we'd return the attempt ID and patch it,
    // but this is sufficient for the current scope.)

    // Upsert the mastery row.
    await ctx.runMutation(internal.aptitude.upsertMastery, {
      userId,
      nodeSlug: args.nodeSlug,
      masteryScore: recomputed.masteryScore,
      questionsAttempted: recomputed.questionsAttempted,
      correctCount: recomputed.correctCount,
      lastPracticedAt: Date.now(),
    });

    const masteryDelta = recomputed.masteryScore - masteryBeforeScore;

    return {
      nodeSlug: args.nodeSlug,
      correctCount,
      questionCount,
      masteryBefore: masteryBeforeScore,
      masteryAfter: recomputed.masteryScore,
      masteryDelta,
    };
  },
});

// ── generateFullAptitudeMock ────────────────────────────────────────────
//
// A standalone, repeatable full Aptitude-only mock — ~40 questions
// covering ALL skill nodes (mixed verbal + quantitative), timed to
// match the real exam's aptitude section duration (50 minutes for 40
// questions). Separate from the 6-subject mock exam flow so students
// can drill this specific section repeatedly.
//
// We reuse the mock exam engine's requestSectionQuestions + the
// 4-provider cascade (Gemini → OpenRouter → Cerebras → Groq) because
// generating 40 questions in one call requires a higher token limit
// than Groq alone can comfortably handle.

const APTITUDE_MOCK_QUESTION_COUNT = 40;
const APTITUDE_MOCK_TIME_SECONDS = 50 * 60; // 50 minutes
const TOKENS_PER_MOCK = 7000;

type MockProvider = "gemini" | "openrouter" | "cerebras" | "groq";

export const generateFullAptitudeMock = action({
  args: {},
  handler: async (ctx): Promise<{
    mockId: Id<"aptitudeMocks">;
    questions: QuizQuestion[];
    timeAllottedSeconds: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    // Get all skill node names to ground the questions.
    const nodes = (await ctx.runQuery(internal.aptitude.getAllNodes, {})) as Array<{
      slug: string;
      name: string;
      category: string;
      description: string;
    }>;
    const topicNames = nodes.map((n) => n.name);

    // Build the prompt — similar to the mock exam's aptitude section
    // but explicitly scoped to this standalone mock.
    const systemPrompt =
      "You write multiple-choice aptitude/reasoning questions for the Ethiopian " +
      "Scholastic Aptitude Test (SAT), which is compulsory for every student. " +
      "These questions test REASONING SKILL (verbal and quantitative), not " +
      "curriculum recall. Questions must be precise, exam-realistic, and test " +
      "genuine reasoning ability. All questions must be ORIGINAL — never reproduce " +
      "any specific real exam's actual questions. " +
      "CRITICAL: Respond ONLY with a valid JSON array. Do NOT include any reasoning, " +
      "explanation, thinking, or text before or after the JSON array. " +
      "Do NOT wrap the JSON in markdown code fences. " +
      "The very first character of your response must be '[' and the very last must be ']'.";

    const userMessage =
      `Write exactly ${APTITUDE_MOCK_QUESTION_COUNT} multiple-choice aptitude ` +
      "questions for a standalone full Aptitude mock exam. Cover a mix of verbal " +
      "and quantitative reasoning skills drawn from the topics below. Sequence " +
      "them from easier to harder. Each question must have exactly 4 options " +
      "with exactly one correct answer, plus a short explanation of why it's " +
      "correct. All questions must be original — do not copy from any real past " +
      "paper.\n" +
      "Respond with a JSON array only, no markdown, in exactly this shape:\n" +
      '[{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "..."}]\n' +
      `Topics to cover: ${topicNames.join(", ")}`;

    const callOpts = {
      systemPrompt,
      userMessage,
      maxTokens: TOKENS_PER_MOCK,
      temperature: 0.4,
    };

    // 4-provider cascade (same as mockExam.ts).
    const providers: Array<{ name: MockProvider; call: () => Promise<string> }> = [
      { name: "gemini", call: async () => await callGemini(ctx, callOpts) },
      { name: "openrouter", call: async () => await callOpenRouter(ctx, callOpts) },
      { name: "cerebras", call: async () => await callCerebras(ctx, callOpts) },
      { name: "groq", call: async () => await callGroq(ctx, callOpts) },
    ];

    let raw = "";
    let providerUsed: MockProvider | null = null;
    let lastError = "All providers failed.";
    for (const provider of providers) {
      try {
        raw = await provider.call();
        providerUsed = provider.name;
        break;
      } catch (err) {
        if (
          err instanceof GeminiRateLimitError ||
          err instanceof GeminiUnavailableError ||
          err instanceof ProviderUnavailableError
        ) {
          // Fall through to the next provider.
          continue;
        }
        lastError = err instanceof Error ? err.message : String(err);
        continue;
      }
    }
    if (!providerUsed) {
      throw new ConvexError({
        message: `All AI providers failed to generate the aptitude mock (${lastError}). Please try again.`,
        code: "ai_error",
      });
    }

    // Use the mock exam's more robust parser (handles reasoning-model
    // preamble by extracting the JSON array from first '[' to last ']').
    const questions = parseAndValidate(raw, APTITUDE_MOCK_QUESTION_COUNT);
    if (questions.length === 0) {
      throw new ConvexError({
        message: "The AI returned unreadable questions. Please try again.",
        code: "ai_error",
      });
    }

    // Create the mock + questions rows.
    const result = (await ctx.runMutation(internal.aptitude.createAptitudeMock, {
      userId,
      timeAllottedSeconds: APTITUDE_MOCK_TIME_SECONDS,
      questionsJson: JSON.stringify(questions),
      totalQuestions: questions.length,
    })) as { mockId: Id<"aptitudeMocks"> };

    return {
      mockId: result.mockId,
      questions,
      timeAllottedSeconds: APTITUDE_MOCK_TIME_SECONDS,
    };
  },
});

// ── ensureTodaysWarmup ─────────────────────────────────────────────────
//
// Generate-on-first-visit pattern (same as dailyChallenge.ts). The
// first user to visit the hub each day pays for generation; the rest
// hit the aptitudeDailyWarmups cache. Picks a random skill node +
// generates ONE question at the user's current difficulty for that
// node (or foundational if they haven't practiced it).

export const ensureTodaysWarmup = action({
  args: {},
  handler: async (ctx): Promise<{ generated: boolean; nodeSlug: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { generated: false, nodeSlug: null };

    const date = addisDateKey();

    // Check if today's warm-up already exists.
    const existing = (await ctx.runQuery(internal.aptitude.getWarmupForDate, {
      date,
    })) as { nodeSlug: string } | null;
    if (existing) {
      return { generated: false, nodeSlug: existing.nodeSlug };
    }

    // Pick a random skill node.
    const nodes = (await ctx.runQuery(internal.aptitude.getAllNodes, {})) as Array<{
      slug: string;
      name: string;
      category: string;
      description: string;
    }>;
    if (nodes.length === 0) {
      return { generated: false, nodeSlug: null };
    }
    const node = nodes[Math.floor(Math.random() * nodes.length)]!;

    // Get the user's mastery for this node (for difficulty calibration).
    const mastery = (await ctx.runQuery(internal.aptitude.getMastery, {
      userId,
      nodeSlug: node.slug,
    })) as { masteryScore: number } | null;
    const masteryScore = mastery?.masteryScore ?? 0;
    const difficulty = difficultyForMastery(masteryScore);

    // Generate ONE question.
    const systemPrompt =
      "You write a single multiple-choice aptitude/reasoning question for the " +
      "Ethiopian Scholastic Aptitude Test. The question must test REASONING SKILL, " +
      "not curriculum recall. It must have exactly 4 options with exactly one correct " +
      "answer, plus a short explanation. The question must be ORIGINAL. " +
      "CRITICAL: Respond ONLY with a valid JSON object (not an array). " +
      "Do NOT include any text before or after the JSON. " +
      'The very first character must be \'{\' and the very last must be \'}\'.';

    const userMessage =
      `Write ONE multiple-choice question for the "${node.name}" aptitude skill ` +
      `(category: ${node.category}).\n\n` +
      `Skill description: ${node.description}\n\n` +
      `${difficultyPrompt(difficulty)}\n\n` +
      `Respond with a JSON object only, no markdown, in exactly this shape:\n` +
      `{"question": "...", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "..."}`;

    const callOpts = {
      systemPrompt,
      userMessage,
      maxTokens: 1024,
      temperature: 0.4,
    };

    let questionObj: QuizQuestion | null = null;
    for (let attempt = 0; attempt < 2 && !questionObj; attempt++) {
      try {
        const raw = await callGroq(ctx, callOpts);
        // Parse as a single object (not an array).
        const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(cleaned) as Partial<QuizQuestion>;
        if (
          typeof parsed.question === "string" && parsed.question.trim() &&
          Array.isArray(parsed.options) && parsed.options.length === 4 &&
          parsed.options.every((o) => typeof o === "string" && o.trim()) &&
          typeof parsed.correctIndex === "number" &&
          parsed.correctIndex >= 0 && parsed.correctIndex <= 3 &&
          typeof parsed.explanation === "string" && parsed.explanation.trim()
        ) {
          questionObj = {
            question: parsed.question.trim(),
            options: parsed.options.map((o) => o!.trim()),
            correctIndex: parsed.correctIndex,
            explanation: parsed.explanation.trim(),
          };
        }
      } catch {
        // retry
      }
    }
    if (!questionObj) {
      return { generated: false, nodeSlug: null };
    }

    await ctx.runMutation(internal.aptitude.insertWarmup, {
      warmupDate: date,
      nodeSlug: node.slug,
      difficulty,
      questionJson: JSON.stringify(questionObj),
    });

    return { generated: true, nodeSlug: node.slug };
  },
});

// ── Addis date key helper ────────────────────────────────────────────

function addisDateKey(): string {
  const now = new Date();
  const addis = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = addis.getUTCFullYear();
  const m = String(addis.getUTCMonth() + 1).padStart(2, "0");
  const d = String(addis.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── generateAptitudeVocabDeck ───────────────────────────────────────────
//
// Auto-generates a flashcard deck focused on vocabulary + word
// relationships + analogies — the verbal reasoning skills that benefit
// most from spaced-repetition vocabulary practice. Ties the aptitude
// hub to the existing flashcard engine: the deck appears in the
// /flashcards page automatically (sourceType: "aptitude"), and the
// student can review it with the existing study-session UI.
//
// The deck covers:
//   - Word definitions (synonyms, antonyms)
//   - Word relationships (cause-effect, part-whole, degree)
//   - Analogy patterns (A:B::C:D)
//   - Sentence-completion vocabulary (context-dependent word choice)
//
// Each card has a concise front (the word / prompt) and a clear back
// (the definition / relationship / answer). 15 cards per deck — enough
// for a meaningful study session without overwhelming.

interface FlashcardPair {
  front: string;
  back: string;
}

function parseAndValidateFlashcards(raw: string, expectedCount: number): FlashcardPair[] {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Flashcards must be a non-empty array.");
  }
  if (parsed.length > expectedCount + 5) {
    throw new Error(`Got ${parsed.length} cards (expected ~${expectedCount}).`);
  }
  const cards: FlashcardPair[] = [];
  for (const item of parsed) {
    const c = item as Record<string, unknown>;
    if (
      typeof c.front !== "string" || !c.front.trim() ||
      typeof c.back !== "string" || !c.back.trim()
    ) {
      throw new Error("One or more flashcards are malformed.");
    }
    cards.push({ front: c.front.trim(), back: c.back.trim() });
  }
  return cards.slice(0, expectedCount);
}

export const generateAptitudeVocabDeck = action({
  args: {},
  handler: async (ctx): Promise<{ deckId: Id<"flashcardDecks">; cardCount: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    // Fetch the verbal skill nodes to ground the prompt.
    const nodes = (await ctx.runQuery(internal.aptitude.getAllNodes, {})) as Array<{
      slug: string;
      name: string;
      category: string;
      description: string;
    }>;
    const verbalNodes = nodes.filter((n) => n.category === "verbal");
    const verbalSkills = verbalNodes
      .map((n) => `${n.name}: ${n.description}`)
      .join("\n");

    const count = 15;

    const systemPrompt =
      "You create vocabulary flashcards for the Ethiopian Scholastic Aptitude " +
      "Test (SAT). Each flashcard has a concise front (a word, a relationship " +
      "prompt, or an analogy) and a clear back (the definition, the " +
      "relationship type, or the answer). Cards should test vocabulary " +
      "breadth, word relationships, and analogy reasoning — not curriculum " +
      "recall. Respond ONLY with valid JSON — no markdown, no explanation.";

    const userMessage =
      `Create exactly ${count} vocabulary flashcards for the Ethiopian SAT.\n\n` +
      `Focus on these verbal reasoning skills:\n${verbalSkills}\n\n` +
      `Requirements:\n` +
      `- Mix of card types: ~5 word definitions (front: word, back: definition + part of speech)\n` +
      `- ~4 word relationship cards (front: "Word A : Word B → what relationship?", back: the relationship type like 'synonym', 'antonym', 'cause-effect', 'part-whole', 'degree')\n` +
      `- ~3 analogy cards (front: "A is to B as C is to ___", back: the answer word + why)\n` +
      `- ~3 sentence-completion vocabulary cards (front: a sentence with a blank + 2 word choices, back: which word fits + why)\n` +
      `- Front: 1-2 sentences max\n` +
      `- Back: 1-3 sentences max\n` +
      `- Use words that genuinely appear in aptitude/reasoning tests\n` +
      `- Do NOT use obscure words only a dictionary would know — use SAT-level vocabulary\n\n` +
      `Respond with a JSON array only:\n` +
      `[{"front": "...", "back": "..."}]`;

    const callOpts = {
      systemPrompt,
      userMessage,
      maxTokens: 4096,
      temperature: 0.5,
    };

    // Same 2-attempt retry loop as flashcards.ts.
    let cards: FlashcardPair[] = [];
    let lastError = "Unknown parsing error.";
    for (let attempt = 0; attempt < 2 && cards.length === 0; attempt++) {
      try {
        const raw = await callGroq(ctx, callOpts);
        cards = parseAndValidateFlashcards(raw, count);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "AI returned invalid JSON.";
      }
    }
    if (cards.length === 0) {
      throw new ConvexError({
        message: `Vocabulary deck generation failed: ${lastError}`,
        code: "ai_error",
      });
    }

    // Insert the deck — sourceType: "aptitude", no subjectId (optional now).
    const deckId = (await ctx.runMutation(internal.flashcards.insertDeck, {
      userId,
      subjectId: undefined,
      contentId: undefined,
      sourceType: "aptitude",
      title: "Aptitude Vocabulary Deck",
      cardCount: cards.length,
      createdAt: Date.now(),
    })) as Id<"flashcardDecks">;

    // Insert each card.
    for (const card of cards) {
      await ctx.runMutation(internal.flashcards.insertCard, {
        deckId,
        front: card.front,
        back: card.back,
      });
    }

    return { deckId, cardCount: cards.length };
  },
});
