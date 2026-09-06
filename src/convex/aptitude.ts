// Aptitude Practice Hub — backend for the Deep SAT Practice Hub.
//
// This module lives in the default Convex runtime (no "use node") —
// queries, mutations, internal helpers. The AI-calling actions live
// in `aptitudeActions.ts` ("use node") because they call the Groq API
// via fetch.
//
// REUSED PATTERNS:
//   - Quiz generation: the JSON-validation-with-retry pattern from
//     quizzes.ts is mirrored in aptitudeActions.ts (same 2-attempt loop,
//     same parseAndValidate shape).
//   - Mock exam aptitude section: generateFullAptitudeMock reuses the
//     mock exam engine's requestSectionQuestions (same prompt structure,
//     same provider cascade) but for a standalone ~40-question mock.
//   - Daily challenge: the generate-on-first-visit pattern from
//     dailyChallenge.ts is mirrored for the aptitude daily warm-up.
//   - Flashcards: the vocab deck uses the existing flashcard engine's
//     insertDeck + insertCard internal mutations.
//
// NO DUPLICATION of AI generation logic that already exists — we import
// requestQuestions + parseAndValidate from quizzes.ts and call them
// directly.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ── Static skill-tree node definitions ─────────────────────────────────
// Seeded once via the seedSkillNodes mutation below. These are real,
// meaningful reasoning sub-skills for the SAT/Aptitude test.

export const APTITUDE_SKILL_NODES = [
  // ── Verbal ──
  {
    slug: "vocabulary-word-relationships",
    category: "verbal" as const,
    name: "Vocabulary & Word Relationships",
    description:
      "Understanding word meanings, synonyms, antonyms, and the relationships between words. Questions test vocabulary breadth and the ability to identify how words relate to each other (cause-effect, part-whole, degree, etc.).",
    prerequisiteSlugs: [],
  },
  {
    slug: "analogies",
    category: "verbal" as const,
    name: "Analogies",
    description:
      "Identifying relationships between pairs of words and applying that relationship to a new pair. Tests the ability to recognize patterns like 'doctor : hospital :: teacher : school' and identify analogous relationships.",
    prerequisiteSlugs: ["vocabulary-word-relationships"],
  },
  {
    slug: "sentence-completion",
    category: "verbal" as const,
    name: "Sentence Completion",
    description:
      "Choosing the word or phrase that best completes a sentence given its context. Tests vocabulary in context, grammar, and the ability to infer meaning from surrounding text.",
    prerequisiteSlugs: ["vocabulary-word-relationships"],
  },
  {
    slug: "reading-comprehension",
    category: "verbal" as const,
    name: "Reading Comprehension",
    description:
      "Reading a passage and answering questions about its main idea, supporting details, inferences, and author's tone. Tests the ability to understand and analyze written text.",
    prerequisiteSlugs: ["sentence-completion"],
  },
  {
    slug: "critical-reasoning",
    category: "verbal" as const,
    name: "Critical Reasoning",
    description:
      "Evaluating arguments, identifying assumptions, detecting logical flaws, and drawing valid conclusions from given premises. Tests higher-order reasoning about arguments themselves.",
    prerequisiteSlugs: ["reading-comprehension"],
  },

  // ── Quantitative ──
  {
    slug: "arithmetic-reasoning",
    category: "quantitative" as const,
    name: "Arithmetic Reasoning",
    description:
      "Word problems involving basic arithmetic operations (addition, subtraction, multiplication, division), percentages, ratios, averages, and number properties. Tests the ability to translate real-world situations into mathematical operations.",
    prerequisiteSlugs: [],
  },
  {
    slug: "algebraic-reasoning",
    category: "quantitative" as const,
    name: "Algebraic Reasoning",
    description:
      "Solving equations, working with variables, understanding functions, and manipulating algebraic expressions. Questions may involve linear equations, inequalities, and basic quadratic reasoning presented as word problems.",
    prerequisiteSlugs: ["arithmetic-reasoning"],
  },
  {
    slug: "geometry-spatial-reasoning",
    category: "quantitative" as const,
    name: "Geometry & Spatial Reasoning",
    description:
      "Reasoning about shapes, angles, areas, volumes, and spatial relationships. Tests the ability to visualize geometric figures and apply properties of triangles, circles, and other shapes to solve problems.",
    prerequisiteSlugs: ["arithmetic-reasoning"],
  },
  {
    slug: "data-interpretation",
    category: "quantitative" as const,
    name: "Data Interpretation",
    description:
      "Reading and analyzing data presented in tables, charts, graphs, and diagrams. Tests the ability to extract information, identify trends, compute derived values (percentages, growth rates), and draw conclusions from visual data.",
    prerequisiteSlugs: ["arithmetic-reasoning"],
  },
  {
    slug: "logical-pattern-reasoning",
    category: "quantitative" as const,
    name: "Logical & Pattern Reasoning",
    description:
      "Identifying patterns in number sequences, letter sequences, and figure series. Tests inductive reasoning — the ability to find the rule governing a sequence and extend it. Includes syllogisms and deductive logic puzzles.",
    prerequisiteSlugs: ["algebraic-reasoning"],
  },
];

// ── Seed mutation (idempotent — safe to call multiple times) ────────────

export const seedSkillNodes = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("aptitudeSkillNodes").collect();
    const existingSlugs = new Set(existing.map((n) => n.slug));
    let inserted = 0;
    for (const node of APTITUDE_SKILL_NODES) {
      if (existingSlugs.has(node.slug)) continue;
      await ctx.db.insert("aptitudeSkillNodes", {
        slug: node.slug,
        category: node.category,
        name: node.name,
        description: node.description,
        prerequisiteSlugs: node.prerequisiteSlugs,
      });
      inserted += 1;
    }
    return { inserted, total: APTITUDE_SKILL_NODES.length, alreadyPresent: existing.length };
  },
});

// ── Public reads ────────────────────────────────────────────────────────

/**
 * Returns all skill nodes + the current user's mastery for each.
 * Used to render the brain-map visualization. The frontend joins the
 * mastery data onto the nodes by slug.
 *
 * For users who have never practiced a node, masteryScore is 0 and
 * questionsAttempted is 0 — the brain map shows these as "unpracticed"
 * (dim/grey).
 */
export const getSkillMap = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        nodes: [],
        mastery: [],
        readiness: 0,
        weakestNodes: [],
        practicedNodeCount: 0,
      };
    }
    const [nodes, masteryRows] = await Promise.all([
      ctx.db.query("aptitudeSkillNodes").collect(),
      ctx.db
        .query("userSkillMastery")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const masteryBySlug = new Map(masteryRows.map((m) => [m.nodeSlug, m]));

    // Compute aggregate readiness — average mastery across ALL nodes
    // (unpracticed nodes count as 0, so readiness is honest — a student
    // who only practiced 2 of 10 nodes shows ~20% readiness, not 100%).
    const totalMastery = nodes.reduce((sum, n) => {
      const m = masteryBySlug.get(n.slug);
      return sum + (m?.masteryScore ?? 0);
    }, 0);
    const readiness = nodes.length > 0 ? Math.round(totalMastery / nodes.length) : 0;

    // Find the 1-2 weakest practiced nodes (lowest masteryScore among
    // nodes with questionsAttempted > 0). If no nodes are practiced,
    // recommend the two foundational nodes (no prerequisites).
    const practicedNodes = nodes
      .map((n) => {
        const m = masteryBySlug.get(n.slug);
        return {
          slug: n.slug,
          name: n.name,
          category: n.category,
          masteryScore: m?.masteryScore ?? 0,
          questionsAttempted: m?.questionsAttempted ?? 0,
        };
      })
      .filter((n) => n.questionsAttempted > 0);

    let weakestNodes: Array<{ slug: string; name: string; category: string; masteryScore: number; questionsAttempted: number }>;
    if (practicedNodes.length === 0) {
      // Recommend the two foundational nodes (no prerequisites).
      weakestNodes = nodes
        .filter((n) => !n.prerequisiteSlugs || n.prerequisiteSlugs.length === 0)
        .slice(0, 2)
        .map((n) => ({
          slug: n.slug,
          name: n.name,
          category: n.category,
          masteryScore: 0,
          questionsAttempted: 0,
        }));
    } else {
      weakestNodes = practicedNodes
        .sort((a, b) => a.masteryScore - b.masteryScore)
        .slice(0, 2);
    }

    return {
      nodes: nodes.map((n) => ({
        _id: n._id,
        slug: n.slug,
        category: n.category,
        name: n.name,
        description: n.description,
        prerequisiteSlugs: n.prerequisiteSlugs ?? [],
      })),
      mastery: masteryRows.map((m) => ({
        nodeSlug: m.nodeSlug,
        masteryScore: m.masteryScore,
        questionsAttempted: m.questionsAttempted,
        correctCount: m.correctCount,
        lastPracticedAt: m.lastPracticedAt ?? null,
      })),
      readiness,
      weakestNodes,
      practicedNodeCount: practicedNodes.length,
    };
  },
});

// ── Internal helpers used by aptitudeActions.ts ────────────────────────

/** Get a skill node by slug (for the practice-generation action). */
export const getNodeBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    return (
      (await ctx.db
        .query("aptitudeSkillNodes")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first()) ?? null
    );
  },
});

/** Get a user's mastery for a node (for difficulty calibration). */
export const getMastery = internalQuery({
  args: { userId: v.id("users"), nodeSlug: v.string() },
  handler: async (ctx, { userId, nodeSlug }) => {
    return (
      (await ctx.db
        .query("userSkillMastery")
        .withIndex("by_user_node", (q) =>
          q.eq("userId", userId).eq("nodeSlug", nodeSlug),
        )
        .unique()) ?? null
    );
  },
});

/** Get all skill nodes (for the standalone mock + daily warm-up
 *  generation — needs the full node list to ground the prompt). */
export const getAllNodes = internalQuery({
  args: {},
  handler: async (ctx) => {
    const nodes = await ctx.db.query("aptitudeSkillNodes").collect();
    return nodes.map((n) => ({
      slug: n.slug,
      name: n.name,
      category: n.category,
      description: n.description,
    }));
  },
});

/** Upsert a user's mastery row (create if first practice, update otherwise). */
export const upsertMastery = internalMutation({
  args: {
    userId: v.id("users"),
    nodeSlug: v.string(),
    masteryScore: v.number(),
    questionsAttempted: v.number(),
    correctCount: v.number(),
    lastPracticedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userSkillMastery")
      .withIndex("by_user_node", (q) =>
        q.eq("userId", args.userId).eq("nodeSlug", args.nodeSlug),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        masteryScore: args.masteryScore,
        questionsAttempted: args.questionsAttempted,
        correctCount: args.correctCount,
        lastPracticedAt: args.lastPracticedAt,
      });
      return { _id: existing._id, created: false };
    }
    const id = await ctx.db.insert("userSkillMastery", {
      userId: args.userId,
      nodeSlug: args.nodeSlug,
      masteryScore: args.masteryScore,
      questionsAttempted: args.questionsAttempted,
      correctCount: args.correctCount,
      lastPracticedAt: args.lastPracticedAt,
    });
    return { _id: id, created: true };
  },
});

/** Insert a practice-attempt log row (for recency-weighted recomputation
 *  + the "recently practiced" feed). */
export const insertPracticeAttempt = internalMutation({
  args: {
    userId: v.id("users"),
    nodeSlug: v.string(),
    questionCount: v.number(),
    correctCount: v.number(),
    masteryBefore: v.number(),
    masteryAfter: v.number(),
    difficulty: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aptitudePracticeAttempts", {
      userId: args.userId,
      nodeSlug: args.nodeSlug,
      questionCount: args.questionCount,
      correctCount: args.correctCount,
      masteryBefore: args.masteryBefore,
      masteryAfter: args.masteryAfter,
      difficulty: args.difficulty,
      completedAt: Date.now(),
    });
    return { ok: true };
  },
});

// ── Recency-weighted mastery recomputation ─────────────────────────────
//
// masteryScore is computed from recent practice accuracy with exponential
// decay weighting (recent attempts count more than old ones). The
// formula:
//   - Pull the last 20 attempts for this (user, node).
//   - For each attempt i (most recent first), weight = 0.85^i (so the
//     most recent attempt has weight 1, the 20th has weight 0.85^19 ≈ 0.05).
//   - weightedCorrect = sum(weight_i * correctCount_i)
//   - weightedTotal = sum(weight_i * questionCount_i)
//   - masteryScore = round((weightedCorrect / weightedTotal) * 100)
//
// This means a student who just aced a 10-question practice (10/10)
// after previously struggling will see their mastery jump significantly
// — the recent strong attempt dominates. A student who aced it long ago
// but hasn't practiced since will see their mastery slowly decay as
// older attempts dominate the weight (but only if they keep practicing
// other nodes; if they stop entirely, mastery is frozen at the last
// computed value).

export const recomputeMastery = internalMutation({
  args: { userId: v.id("users"), nodeSlug: v.string() },
  handler: async (ctx, { userId, nodeSlug }) => {
    const attempts = await ctx.db
      .query("aptitudePracticeAttempts")
      .withIndex("by_user_node", (q) => q.eq("userId", userId).eq("nodeSlug", nodeSlug))
      .order("desc")
      .take(20);

    if (attempts.length === 0) {
      // No attempts — mastery is 0 (the upsert will handle creating the row).
      return { masteryScore: 0, questionsAttempted: 0, correctCount: 0 };
    }

    // Exponential decay weighting — most recent attempt has weight 1,
    // each older attempt has weight 0.85^(index from most recent).
    let weightedCorrect = 0;
    let weightedTotal = 0;
    for (let i = 0; i < attempts.length; i++) {
      const weight = Math.pow(0.85, i);
      weightedCorrect += weight * attempts[i]!.correctCount;
      weightedTotal += weight * attempts[i]!.questionCount;
    }
    const masteryScore =
      weightedTotal > 0
        ? Math.round((weightedCorrect / weightedTotal) * 100)
        : 0;

    // Lifetime counters (not weighted — these are cumulative).
    const allAttempts = await ctx.db
      .query("aptitudePracticeAttempts")
      .withIndex("by_user_node", (q) => q.eq("userId", userId).eq("nodeSlug", nodeSlug))
      .collect();
    const questionsAttempted = allAttempts.reduce(
      (sum, a) => sum + a.questionCount,
      0,
    );
    const correctCount = allAttempts.reduce(
      (sum, a) => sum + a.correctCount,
      0,
    );

    return { masteryScore, questionsAttempted, correctCount };
  },
});

// ── Standalone Aptitude mock helpers ────────────────────────────────────

export const createAptitudeMock = internalMutation({
  args: {
    userId: v.id("users"),
    timeAllottedSeconds: v.number(),
    questionsJson: v.string(),
    totalQuestions: v.number(),
  },
  handler: async (ctx, args) => {
    const mockId = await ctx.db.insert("aptitudeMocks", {
      userId: args.userId,
      status: "in_progress",
      startedAt: Date.now(),
      timeAllottedSeconds: args.timeAllottedSeconds,
    });
    await ctx.db.insert("aptitudeMockQuestions", {
      mockId,
      questionsJson: args.questionsJson,
      answers: new Array(args.totalQuestions).fill(-1),
      flagged: new Array(args.totalQuestions).fill(false),
      status: "in_progress",
    });
    return { mockId };
  },
});

export const getAptitudeMock = query({
  args: { mockId: v.id("aptitudeMocks") },
  handler: async (ctx, { mockId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const mock = await ctx.db.get(mockId);
    if (!mock || mock.userId !== userId) return null;
    const questions = await ctx.db
      .query("aptitudeMockQuestions")
      .withIndex("by_mock", (q) => q.eq("mockId", mockId))
      .first();
    if (!questions) return null;
    return {
      _id: mock._id,
      status: mock.status,
      startedAt: mock.startedAt,
      completedAt: mock.completedAt ?? null,
      timeAllottedSeconds: mock.timeAllottedSeconds,
      totalScore: mock.totalScore ?? null,
      correctCount: mock.correctCount ?? null,
      totalQuestions: mock.totalQuestions ?? null,
      timeSpentSeconds: mock.timeSpentSeconds ?? null,
      questionsJson: questions.questionsJson,
      answers: questions.answers,
      flagged: questions.flagged,
    };
  },
});

export const getMyAptitudeMocks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const mocks = await ctx.db
      .query("aptitudeMocks")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
    return mocks.map((m) => ({
      _id: m._id,
      status: m.status,
      startedAt: m.startedAt,
      completedAt: m.completedAt ?? null,
      totalScore: m.totalScore ?? null,
      correctCount: m.correctCount ?? null,
      totalQuestions: m.totalQuestions ?? null,
    }));
  },
});

export const updateAptitudeMockAnswers = mutation({
  args: {
    mockId: v.id("aptitudeMocks"),
    answers: v.array(v.number()),
    flagged: v.array(v.boolean()),
  },
  handler: async (ctx, { mockId, answers, flagged }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const mock = await ctx.db.get(mockId);
    if (!mock || mock.userId !== userId) {
      throw new ConvexError({ message: "Mock not found.", code: "not_found" });
    }
    const questions = await ctx.db
      .query("aptitudeMockQuestions")
      .withIndex("by_mock", (q) => q.eq("mockId", mockId))
      .first();
    if (questions) {
      await ctx.db.patch(questions._id, { answers, flagged });
    }
    return { ok: true };
  },
});

export const completeAptitudeMock = mutation({
  args: {
    mockId: v.id("aptitudeMocks"),
    answers: v.array(v.number()),
    flagged: v.array(v.boolean()),
    timeSpentSeconds: v.number(),
  },
  handler: async (ctx, { mockId, answers, flagged, timeSpentSeconds }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const mock = await ctx.db.get(mockId);
    if (!mock || mock.userId !== userId) {
      throw new ConvexError({ message: "Mock not found.", code: "not_found" });
    }
    if (mock.status === "completed") {
      throw new ConvexError({ message: "Mock already completed.", code: "invalid" });
    }

    // Server-side scoring — never trust client scores.
    const questions = await ctx.db
      .query("aptitudeMockQuestions")
      .withIndex("by_mock", (q) => q.eq("mockId", mockId))
      .first();
    if (!questions) {
      throw new ConvexError({ message: "Questions not found.", code: "not_found" });
    }
    let parsedQuestions: Array<{ question: string; options: string[]; correctIndex: number; explanation: string }>;
    try {
      parsedQuestions = JSON.parse(questions.questionsJson);
    } catch {
      throw new ConvexError({ message: "Could not parse questions.", code: "internal" });
    }
    const totalQuestions = parsedQuestions.length;
    let correctCount = 0;
    for (let i = 0; i < totalQuestions; i++) {
      if (answers[i] === parsedQuestions[i]!.correctIndex) {
        correctCount += 1;
      }
    }
    const totalScore = Math.round((correctCount / totalQuestions) * 100);

    await ctx.db.patch(questions._id, {
      answers,
      flagged,
      status: "completed",
      completedAt: Date.now(),
    });
    await ctx.db.patch(mockId, {
      status: "completed",
      completedAt: Date.now(),
      totalScore,
      correctCount,
      totalQuestions,
      timeSpentSeconds: Math.min(timeSpentSeconds, mock.timeAllottedSeconds),
    });

    return {
      mockId,
      totalScore,
      correctCount,
      totalQuestions,
      timeSpentSeconds: Math.min(timeSpentSeconds, mock.timeAllottedSeconds),
    };
  },
});

// ── Daily warm-up helpers ───────────────────────────────────────────────

export const getTodaysWarmup = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    // The warm-up is generated on first visit by the
    // ensureTodaysWarmup action (in aptitudeActions.ts). Here we just
    // read whatever exists for today.
    const date = addisDateKey();
    const warmup = await ctx.db
      .query("aptitudeDailyWarmups")
      .withIndex("by_date", (q) => q.eq("warmupDate", date))
      .first();
    if (!warmup) return null;
    // Check if the user already answered today.
    const attempts = await ctx.db
      .query("aptitudeDailyWarmupAttempts")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("warmupDate", date))
      .take(10);
    const prior = attempts.find((a) => a.nodeSlug === warmup.nodeSlug);
    return {
      _id: warmup._id,
      nodeSlug: warmup.nodeSlug,
      difficulty: warmup.difficulty,
      questionJson: warmup.questionJson,
      alreadyAnswered: Boolean(prior),
      answeredCorrectly: prior?.answeredCorrectly ?? null,
    };
  },
});

export const submitWarmupAnswer = mutation({
  args: {
    nodeSlug: v.string(),
    answer: v.number(),
  },
  handler: async (ctx, { nodeSlug, answer }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const date = addisDateKey();
    const warmup = await ctx.db
      .query("aptitudeDailyWarmups")
      .withIndex("by_date_node", (q) =>
        q.eq("warmupDate", date).eq("nodeSlug", nodeSlug),
      )
      .first();
    if (!warmup) {
      throw new ConvexError({ message: "No warm-up found for today.", code: "not_found" });
    }
    // Check for prior attempt.
    const attempts = await ctx.db
      .query("aptitudeDailyWarmupAttempts")
      .withIndex("by_user_date", (q) => q.eq("userId", userId).eq("warmupDate", date))
      .take(10);
    const prior = attempts.find((a) => a.nodeSlug === nodeSlug);
    if (prior) {
      throw new ConvexError({
        message: "You've already answered today's aptitude warm-up — come back tomorrow.",
        code: "already_answered",
      });
    }
    // Server-side scoring.
    let parsed: { question: string; options: string[]; correctIndex: number; explanation: string };
    try {
      parsed = JSON.parse(warmup.questionJson);
    } catch {
      throw new ConvexError({ message: "Could not parse warm-up question.", code: "internal" });
    }
    const answeredCorrectly = answer === parsed.correctIndex;
    await ctx.db.insert("aptitudeDailyWarmupAttempts", {
      userId,
      warmupDate: date,
      nodeSlug,
      answeredCorrectly,
      completedAt: Date.now(),
    });
    return {
      answeredCorrectly,
      correctIndex: parsed.correctIndex,
      explanation: parsed.explanation,
    };
  },
});

// ── Internal helpers for the warm-up generation action ────────────────

export const getWarmupForDate = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    return (
      (await ctx.db
        .query("aptitudeDailyWarmups")
        .withIndex("by_date", (q) => q.eq("warmupDate", date))
        .first()) ?? null
    );
  },
});

export const insertWarmup = internalMutation({
  args: {
    warmupDate: v.string(),
    nodeSlug: v.string(),
    difficulty: v.string(),
    questionJson: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aptitudeDailyWarmups", {
      warmupDate: args.warmupDate,
      nodeSlug: args.nodeSlug,
      difficulty: args.difficulty,
      questionJson: args.questionJson,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

// ── Time-pressure trainer ──────────────────────────────────────────────
// No separate table — the trainer reuses generateNodePractice with a
// time-per-question limit passed from the frontend. The frontend
// enforces the timer; the backend just generates questions + scores
// them. This keeps the trainer lightweight (no new schema) while still
// being a distinct practice mode (progressively shrinking time).

// ── Helper: Addis date key ────────────────────────────────────────────
// Mirrors the reminders.ts addisDateKey helper. Inline here to avoid a
// cross-module import cycle.

function addisDateKey(): string {
  const now = new Date();
  // Africa/Addis_Ababa is UTC+3 with no DST.
  const addis = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const y = addis.getUTCFullYear();
  const m = String(addis.getUTCMonth() + 1).padStart(2, "0");
  const d = String(addis.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
