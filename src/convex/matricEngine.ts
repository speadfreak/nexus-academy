// LEARNYX MATRIC OS — Phases 3/5/6/7: deterministic assembly, session
// lifecycle, secure scoring, learning-loop ingestion.
//
// CORE PRINCIPLE (spec): NO external AI request is required to create,
// start, display, save, resume, submit, score or display an exam. Every
// step below touches only Convex + the local question vault.
//
// Architecture mirrors the affiliate pattern (Task 2): heavy logic lives in
// INTERNAL functions with explicit arguments (headlessly testable on a local
// backend); public wrappers add auth, ownership and premium gates.
//
// Security invariants:
//   - questionsJson (WITH answer keys) never leaves the server before grading
//   - the client's answers are the only client input to scoring
//   - grading is idempotent (status transition + transaction boundary)
//   - the session snapshot preserves the exact answer-key version scored
//   - ingestion is idempotent per learning.ts dedupe keys and retried by the
//     cron sweeper until done — exactly-once effects, at-least-once attempts

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveSubscriptionDb } from "./subscriptions";
import { XP_VALUES } from "./constants";
import { streamValidator } from "./schema";
import { selectQuestions } from "../lib/matric/selection";
import {
  evaluateStreamEligibility,
  studentStreamLabel,
  type StudentStream,
  type SubjectEligibilityStream,
} from "../lib/matric/eligibility";
import type { VaultQuestionLike } from "../lib/matric/types";
import { scoreSession, type SnapshotQuestion } from "../lib/matric/scoring";
import type {
  PlayerQuestion,
  ScoredQuestion,
  SessionSection,
  TopicBreakdownRow,
  SubjectBreakdownRow,
} from "../lib/matric/types";

const MAX_POOL_SCAN = 3000;
const SWEEP_BATCH = 40;
const SUBMIT_GRACE_SECONDS = 90; // in-flight saves may finish after deadline
const WEAKNESS_TOPIC_COUNT = 15;
const PAST_PAPER_MAX_QUESTIONS = 80;
const SCORER_VERSION = "matric-engine-v1";
const SECONDS_PER_QUESTION_CAP = 90; // past-paper fallback pacing

type MatricSessionDoc = Doc<"matricSessions">;

// ── Internal data access ───────────────────────────────────────────────────

export interface AssembleResult {
  sessionId: Id<"matricSessions">;
  questions: PlayerQuestion[];
  sections: SessionSection[];
  deadlineAt: number;
  serverNow: number;
  timeLimitSeconds: number;
  title: string;
  mode: string;
}

export interface ActiveSessionPayload {
  sessionId: Id<"matricSessions">;
  title: string;
  mode: string;
  blueprintKey: string;
  questionCount: number;
  timeLimitSeconds: number;
  startedAt: number;
  deadlineAt: number;
  serverNow: number;
  remainingSeconds: number;
  sections: SessionSection[];
  questions: PlayerQuestion[];
  answers: string[];
  flags: boolean[];
  timeMs: number[];
}

export interface PastPaperOption {
  contentId: Id<"contentItems">;
  title: string;
  subjectName: string | null;
  /** Paper's subject stream — "common" for English/Math/SAT papers. */
  stream: SubjectEligibilityStream | null;
  examYear: number | null;
  durationMinutes: number | null;
  isPremium: boolean;
  eligibleCount: number;
}

export interface CatalogPayload {
  subjectMocks: CatalogSubjectMock[];
  fullSimulations: CatalogFullSimulation[];
  weakness: { blueprintId: Id<"matricBlueprints">; title: string; description: string } | null;
  pastPaper: { blueprintId: Id<"matricBlueprints"> } | null;
  premium: boolean;
  hasActiveSession: boolean;
  activeSessionId: Id<"matricSessions"> | null;
  activeSessionTitle: string | null;
  // ── MATRIC OS 2.1: canonical academic identity (userProfiles) ──
  // null = stream not selected (or legacy "common") — the hub shows a
  // graceful prompt instead of silently defaulting to Natural Science.
  studentStream: StudentStream;
  studentStreamLabel: string | null;
  gradeLevel: 9 | 10 | 11 | 12 | null;
}

export const vaultPoolForSubject = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, args): Promise<VaultRowOmit[]> => {
    return await ctx.db
      .query("matricQuestions")
      .withIndex("by_subject_eligible", (q) =>
        q.eq("subjectId", args.subjectId).eq("examEligible", true).eq("active", true),
      )
      .take(MAX_POOL_SCAN);
  },
});

export const vaultPoolForPaper = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args): Promise<VaultRowOmit[]> => {
    const rows = await ctx.db
      .query("matricQuestions")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .collect();
    return rows.filter((r) => r.examEligible && r.active);
  },
});

export const paperInfoForPastPaper = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    item: Doc<"contentItems">;
    paper: Doc<"digitalPapers"> | null;
    subject: Doc<"subjects"> | null;
  } | null> => {
    const item = await ctx.db.get(args.contentId);
    if (!item) return null;
    const paper = (await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .order("asc").take(1))[0];
    const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
    return { item, paper, subject };
  },
});

/** Recent session vaultIds for the freshness policy. */
export const recentVaultIds = internalQuery({
  args: { userId: v.id("users"), blueprintKey: v.string(), count: v.number() },
  handler: async (ctx, args): Promise<string[]> => {
    const sessions = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_blueprint", (q) =>
        q.eq("userId", args.userId).eq("blueprintKey", args.blueprintKey),
      )
      .order("desc")
      .take(args.count);
    const ids: string[] = [];
    for (const s of sessions) {
      try {
        for (const id of JSON.parse(s.vaultIdsJson) as string[]) ids.push(id);
      } catch {
        // corrupt history row — ignore for freshness purposes
      }
    }
    return ids;
  },
});

/** Weakest-topic evidence from topicMastery (Exam Twin source of truth). */
interface WeaknessTopic {
  topicId: string | null;
  topicName: string;
  rate: number;
}
interface WeaknessEvidence {
  kind: "mastery" | "mistakes" | "none";
  subjectId: string | null;
  topics: WeaknessTopic[];
}
export const weaknessEvidence = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<WeaknessEvidence> => {
    const rows = await ctx.db
      .query("topicMastery")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const evidence = rows
      .filter((r) => r.attempts >= 2)
      .map((r) => {
        const recent = r.recentResults.slice(-10);
        const correct = recent.reduce((s, x) => s + x, 0);
        const rate = recent.length > 0 ? correct / recent.length : r.correct / Math.max(1, r.attempts);
        return {
          topicId: r.topicId as string,
          subjectId: r.subjectId as string,
          rate,
          attempts: r.attempts,
        };
      })
      .sort((a, b) => a.rate - b.rate)
      .slice(0, 3);

    if (evidence.length > 0) {
      const topicDocs = await Promise.all(
        evidence.map((e) => ctx.db.get(e.topicId as Id<"topics">)),
      );
      return {
        kind: "mastery",
        subjectId: evidence[0]?.subjectId ?? null,
        topics: evidence.map((e, i): WeaknessTopic => ({
          topicId: e.topicId,
          topicName: topicDocs[i]?.name ?? "",
          rate: e.rate,
        })),
      };
    }

    // No mastery evidence yet → fall back to the mistake ledger.
    const mistakes = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", args.userId).eq("status", "open"))
      .take(60);
    if (mistakes.length === 0) {
      return { kind: "none", subjectId: null, topics: [] };
    }
    const byTopic = new Map<string, { subjectId: string; name: string; count: number }>();
    for (const m of mistakes) {
      const key = m.topicId ?? m.topicText ?? "__general";
      const entry = byTopic.get(key) ?? {
        subjectId: m.subjectId as string,
        name: m.topicText ?? "General",
        count: 0,
      };
      entry.count++;
      byTopic.set(key, entry);
    }
    const weakest = [...byTopic.values()].sort((a, b) => b.count - a.count)[0];
    if (!weakest) {
      return { kind: "none", subjectId: null, topics: [] };
    }
    const subjectTopics = await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", weakest.subjectId as Id<"subjects">))
      .collect();
    const match = subjectTopics.find(
      (t) => t.name.trim().toLowerCase() === weakest.name.trim().toLowerCase(),
    );
    return {
      kind: "mistakes",
      subjectId: weakest.subjectId,
      topics: [{ topicId: match?._id ?? null, topicName: weakest.name, rate: 0 }],
    };
  },
});

export const subjectNameById = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, args): Promise<string> => {
    const s = await ctx.db.get(args.subjectId);
    return s?.name ?? "";
  },
});

// ── Assembly (Phase 3) ─────────────────────────────────────────────────────

type VaultRow = {
  _id: Id<"matricQuestions">;
  vaultId: string; // = _id as string — satisfies the pure selector contract
  contentId: Id<"contentItems">;
  paperTitle: string;
  questionNumber: number;
  subjectId: Id<"subjects">;
  stem: string;
  passage?: string;
  choices: { label: string; text: string }[];
  answerLabel?: string;
  explanation?: string;
  topicId?: Id<"topics">;
  topicText?: string;
  examYear?: number;
  sourcePage?: number;
  figureHint?: boolean;
  verificationTier: "admin_verified" | "parser_verified" | "unverified";
  examEligible: boolean;
};

/** Map a Convex vault row onto the pure selector's question shape. */
function engineQ(row: VaultRowOmit): VaultRow {
  return { ...row, vaultId: row._id as string };
}
type VaultRowOmit = Omit<VaultRow, "vaultId">;

function toSnapshotQuestion(
  q: VaultQuestionLike & { _id?: Id<"matricQuestions"> },
  subjectName: string,
  index: number,
): SnapshotQuestion {
  const answerChoice = q.choices.find((c) => c.label === q.answerLabel);
  return {
    i: index,
    vaultId: q.vaultId ?? (q._id as string),
    contentId: q.contentId,
    paperTitle: q.paperTitle,
    questionNumber: q.questionNumber,
    subjectId: q.subjectId,
    subjectName,
    stem: q.stem,
    passage: q.passage,
    choices: q.choices,
    topicId: q.topicId,
    topicText: q.topicText,
    examYear: q.examYear,
    sourcePage: q.sourcePage,
    figureHint: q.figureHint,
    answerLabel: q.answerLabel ?? "",
    answerText: answerChoice?.text ?? "",
    explanation: q.explanation,
    verificationTier: q.verificationTier,
  };
}

/** Strip EVERYTHING the client must not see before grading. */
function sanitizeForPlayer(q: SnapshotQuestion): PlayerQuestion {
  return {
    i: q.i,
    vaultId: q.vaultId,
    contentId: q.contentId,
    paperTitle: q.paperTitle,
    questionNumber: q.questionNumber,
    subjectId: q.subjectId,
    subjectName: q.subjectName,
    stem: q.stem,
    passage: q.passage,
    choices: q.choices,
    topicId: q.topicId,
    topicText: q.topicText,
    examYear: q.examYear,
    sourcePage: q.sourcePage,
    figureHint: q.figureHint,
  };
}

export const assembleSessionInternal = internalMutation({
  args: {
    userId: v.id("users"),
    blueprintId: v.id("matricBlueprints"),
    pastPaperContentId: v.optional(v.id("contentItems")),
    userPremium: v.boolean(),
    // Set by startMatricExam after the stream eligibility check — records an
    // explicit cross-stream exploration so results stay correctly labeled.
    exploredOtherStream: v.optional(v.boolean()),
    // The eligibility-validated stream snapshot for THIS sitting (blueprint
    // stream, else the subject's stream, else "common"). Immutable history.
    effectiveStream: v.optional(streamValidator),
  },
  handler: async (ctx, args): Promise<AssembleResult> => {
    const now = Date.now();
    const blueprint = await ctx.db.get(args.blueprintId);
    if (!blueprint) {
      throw new ConvexError({ message: "Exam configuration not found.", code: "not_found" });
    }
    if (blueprint.status !== "active") {
      throw new ConvexError({
        message: "This exam mode is currently unavailable. Check back soon.",
        code: "blueprint_disabled",
      });
    }

    const seed = `matric:${blueprint.key}:${args.userId}:${now}`;
    const sections: SessionSection[] = [];
    const snapshot: SnapshotQuestion[] = [];
    const poolStats: {
      subjectId?: string;
      poolSize: number;
      selected: number;
      freshPoolSize: number;
      freshnessRelaxed: boolean;
    }[] = [];

    // Freshness inputs (same for every subject of this session).
    let recentVaultIds: string[] = [];
    if (blueprint.preferFreshCount > 0) {
      recentVaultIds = await ctx.runQuery(internal.matricEngine.recentVaultIds, {
        userId: args.userId,
        blueprintKey: blueprint.key,
        count: blueprint.preferFreshCount,
      });
    }

    if (blueprint.mode === "past_paper") {
      // ── Past Paper Simulation: one paper's verified MCQs, its duration ──
      if (!args.pastPaperContentId) {
        throw new ConvexError({ message: "Choose a past paper first.", code: "invalid" });
      }
      const info = await ctx.runQuery(internal.matricEngine.paperInfoForPastPaper, {
        contentId: args.pastPaperContentId,
      });
      if (!info || !info.paper || info.paper.status !== "ready") {
        throw new ConvexError({
          message: "That paper isn't digitized yet. Pick one from the library.",
          code: "not_found",
        });
      }
      const pool = await ctx.runQuery(internal.matricEngine.vaultPoolForPaper, {
        contentId: args.pastPaperContentId,
      });
      if (pool.length < blueprint.minCoverage) {
        throw new ConvexError({
          message: `This paper has only ${pool.length} verified multiple-choice questions — not enough for a scored simulation yet. You can still read it as a digital paper.`,
          code: "insufficient_coverage",
        });
      }
      const count = Math.min(pool.length, PAST_PAPER_MAX_QUESTIONS);
      const subjectName = info.subject?.name ?? info.item.title ?? "Past Paper";
      const subjectId = (info.item.subjectId ?? pool[0]?.subjectId) as Id<"subjects">;
      const sel = selectQuestions({
        pool: pool.slice(0, MAX_POOL_SCAN).map(engineQ),
        count,
        seed: `${seed}:past-paper`,
        maxPerTopic: 0,
      });
      const startIndex = snapshot.length;
      for (const q of sel.selected) snapshot.push(toSnapshotQuestion(q, subjectName, snapshot.length));
      sections.push({
        subjectId,
        subjectName,
        startIndex,
        endIndex: snapshot.length,
        questionCount: snapshot.length - startIndex,
      });
      poolStats.push({
        subjectId,
        poolSize: sel.poolSize,
        selected: sel.selected.length,
        freshPoolSize: sel.freshPoolSize,
        freshnessRelaxed: sel.freshnessRelaxed,
      });

      const durationMinutes = info.item.durationMinutes;
      const timeLimitSeconds =
        durationMinutes && durationMinutes > 0
          ? Math.min(durationMinutes * 60, count * SECONDS_PER_QUESTION_CAP)
          : count * SECONDS_PER_QUESTION_CAP;
      return await persistSession(ctx, {
        userId: args.userId,
        blueprint: { ...blueprint, stream: blueprint.stream as "natural" | "social" | undefined },
        seed,
        snapshot,
        sections,
        poolStats,
        timeLimitSeconds,
        startedAt: now,
        pastPaperContentId: args.pastPaperContentId,
        exploredOtherStream: args.exploredOtherStream,
        effectiveStream: args.effectiveStream,
      });
    }

    if (blueprint.mode === "weakness_challenge") {
      // ── Weakness Challenge: real evidence → weakest topics → vault ──
      const evidence = await ctx.runQuery(internal.matricEngine.weaknessEvidence, {
        userId: args.userId,
      });
      if (evidence.kind === "none" || !evidence.subjectId) {
        throw new ConvexError({
          message:
            "No weakness evidence yet. Take a subject mock or practice a few quizzes first — your challenge will be built from what the data actually shows.",
          code: "no_evidence",
        });
      }
      const subjectId = evidence.subjectId as Id<"subjects">;
      const subjectName = await ctx.runQuery(internal.matricEngine.subjectNameById, { subjectId });
      const pool = await ctx.runQuery(internal.matricEngine.vaultPoolForSubject, { subjectId });
      const weakTopicIds = new Set(
        evidence.topics.map((t) => t.topicId).filter((x): x is string => !!x),
      );
      const weakTopicNames = new Set(
        evidence.topics.map((t) => t.topicName.trim().toLowerCase()).filter((x) => x.length > 0),
      );
      let working = pool.filter(
        (q) =>
          (q.topicId && weakTopicIds.has(q.topicId)) ||
          (q.topicText && weakTopicNames.has(q.topicText.trim().toLowerCase())),
      );
      let widened = false;
      if (working.length < blueprint.minCoverage) {
        // Honest fallback: the weakest topics don't have enough vault
        // coverage yet → use the subject's full verified pool instead of
        // inventing filler.
        working = pool;
        widened = true;
      }
      if (working.length < blueprint.minCoverage) {
        throw new ConvexError({
          message: `Not enough verified questions for ${subjectName} yet. Import more papers or try another mode.`,
          code: "insufficient_coverage",
        });
      }
      const count = Math.min(WEAKNESS_TOPIC_COUNT, working.length);
      const sel = selectQuestions({
        pool: working.map(engineQ),
        count,
        seed: `${seed}:weakness`,
        maxPerTopic: blueprint.maxPerTopic || 0,
        recentVaultIds,
      });
      const startIndex = 0;
      for (const q of sel.selected) snapshot.push(toSnapshotQuestion(q, subjectName, snapshot.length));
      sections.push({
        subjectId,
        subjectName,
        startIndex,
        endIndex: snapshot.length,
        questionCount: snapshot.length,
      });
      poolStats.push({
        subjectId,
        poolSize: sel.poolSize,
        selected: sel.selected.length,
        freshPoolSize: sel.freshPoolSize,
        freshnessRelaxed: sel.freshnessRelaxed,
      });
      return await persistSession(ctx, {
        userId: args.userId,
        blueprint: { ...blueprint, stream: blueprint.stream as "natural" | "social" | undefined },
        seed,
        snapshot,
        sections,
        poolStats,
        timeLimitSeconds: blueprint.timeLimitSeconds,
        startedAt: now,
        widenedToSubject: widened,
        evidenceKind: evidence.kind,
        exploredOtherStream: args.exploredOtherStream,
        effectiveStream: args.effectiveStream,
      });
    }

    // ── Subject Mock & Full Simulation: blueprint plans → per-subject draws ──
    for (const plan of blueprint.subjects) {
      const pool = await ctx.runQuery(internal.matricEngine.vaultPoolForSubject, {
        subjectId: plan.subjectId,
      });
      if (pool.length < Math.max(plan.questionCount, blueprint.minCoverage)) {
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "content_event",
          source: "matricEngine.assembly_insufficient_coverage",
          status: "error",
          userId: args.userId,
          metadata: JSON.stringify({
            blueprintKey: blueprint.key,
            subjectId: plan.subjectId,
            poolSize: pool.length,
            needed: plan.questionCount,
          }),
        });
        throw new ConvexError({
          message: `${plan.subjectName} doesn't have enough verified questions yet (${pool.length} available, ${plan.questionCount} needed). More papers are being digitized — check back soon.`,
          code: "insufficient_coverage",
        });
      }
      const sel = selectQuestions({
        pool: pool.map(engineQ),
        count: plan.questionCount,
        seed: `${seed}:${plan.subjectId}`,
        maxPerTopic: blueprint.maxPerTopic || 0,
        recentVaultIds,
      });
      const startIndex = snapshot.length;
      for (const q of sel.selected) snapshot.push(toSnapshotQuestion(q, plan.subjectName, snapshot.length));
      sections.push({
        subjectId: plan.subjectId,
        subjectName: plan.subjectName,
        startIndex,
        endIndex: snapshot.length,
        questionCount: snapshot.length - startIndex,
      });
      poolStats.push({
        subjectId: plan.subjectId,
        poolSize: sel.poolSize,
        selected: sel.selected.length,
        freshPoolSize: sel.freshPoolSize,
        freshnessRelaxed: sel.freshnessRelaxed,
      });
    }

    return await persistSession(ctx, {
      userId: args.userId,
      blueprint: { ...blueprint, stream: blueprint.stream as "natural" | "social" | undefined },
      seed,
      snapshot,
      sections,
      poolStats,
      timeLimitSeconds: blueprint.timeLimitSeconds,
      startedAt: now,
      exploredOtherStream: args.exploredOtherStream,
      effectiveStream: args.effectiveStream,
    });
  },
});

async function persistSession(
  ctx: MutationCtx,
  opts: {
    userId: Id<"users">;
    blueprint: {
      _id: Id<"matricBlueprints">;
      key: string;
      version: number;
      mode: "full_simulation" | "subject_mock" | "weakness_challenge" | "past_paper";
      title: string;
      stream?: "natural" | "social";
      timeLimitSeconds: number;
    };
    seed: string;
    snapshot: SnapshotQuestion[];
    sections: SessionSection[];
    poolStats: { subjectId?: string; poolSize: number; selected: number; freshPoolSize: number; freshnessRelaxed: boolean }[];
    timeLimitSeconds: number;
    startedAt: number;
    pastPaperContentId?: Id<"contentItems">;
    widenedToSubject?: boolean;
    evidenceKind?: string;
    exploredOtherStream?: boolean;
    effectiveStream?: "natural" | "social" | "common";
  },
): Promise<{
  sessionId: Id<"matricSessions">;
  questions: PlayerQuestion[];
  sections: SessionSection[];
  deadlineAt: number;
  serverNow: number;
  timeLimitSeconds: number;
  title: string;
  mode: string;
}> {
  const now = Date.now();
  const deadlineAt = opts.startedAt + opts.timeLimitSeconds * 1000;
  const sessionId = await ctx.db.insert("matricSessions", {
    userId: opts.userId,
    blueprintId: opts.blueprint._id,
    blueprintKey: opts.blueprint.key,
    blueprintVersion: opts.blueprint.version,
    mode: opts.blueprint.mode,
    // History keeps its ORIGINAL stream context even after the student later
    // changes their saved stream: the eligibility-validated sitting stream is
    // snapshotted here (blueprint stream, else the subject's stream) and the
    // explore consent is recorded separately.
    ...(opts.effectiveStream ? { stream: opts.effectiveStream } : opts.blueprint.stream ? { stream: opts.blueprint.stream } : {}),
    ...(opts.exploredOtherStream ? { exploredOtherStream: true } : {}),
    title: opts.blueprint.title,
    status: "active" as const,
    sectionsJson: JSON.stringify(opts.sections),
    questionsJson: JSON.stringify(opts.snapshot),
    vaultIdsJson: JSON.stringify(opts.snapshot.map((q) => q.vaultId)),
    answers: opts.snapshot.map(() => ""),
    flags: opts.snapshot.map(() => false),
    timeMs: opts.snapshot.map(() => 0),
    questionCount: opts.snapshot.length,
    timeLimitSeconds: opts.timeLimitSeconds,
    startedAt: opts.startedAt,
    deadlineAt,
    seed: opts.seed,
    poolStatsJson: JSON.stringify({
      ...opts,
      blueprint: undefined,
      snapshot: undefined,
      sections: undefined,
      pastPaperContentId: opts.pastPaperContentId,
      widenedToSubject: opts.widenedToSubject,
      evidenceKind: opts.evidenceKind,
    }),
    ingestState: "pending" as const,
    createdAt: now,
    updatedAt: now,
  });

  await ctx.runMutation(internal.systemEvents.logEvent, {
    eventType: "content_event",
    source: "matricEngine.session_created",
    status: "success",
    userId: opts.userId,
    metadata: JSON.stringify({
      sessionId,
      blueprintKey: opts.blueprint.key,
      mode: opts.blueprint.mode,
      questionCount: opts.snapshot.length,
      subjects: opts.sections.map((s) => s.subjectName),
      pastPaperContentId: opts.pastPaperContentId,
      exploredOtherStream: opts.exploredOtherStream ?? false,
    }),
  });

  return {
    sessionId,
    questions: opts.snapshot.map(sanitizeForPlayer),
    sections: opts.sections,
    deadlineAt,
    serverNow: now,
    timeLimitSeconds: opts.timeLimitSeconds,
    title: opts.blueprint.title,
    mode: opts.blueprint.mode,
  };
}

// ── Public wrappers (auth + ownership + premium) ───────────────────────────

/**
 * Start a new exam session. This is a MUTATION — zero AI, zero external
 * calls: eligibility → vault selection → immutable snapshot in one
 * transaction. Students start instantly, always.
 */
export const startMatricExam = mutation({
  args: {
    blueprintId: v.id("matricBlueprints"),
    pastPaperContentId: v.optional(v.id("contentItems")),
    // Explicit, per-attempt consent to sit the OTHER stream's pathway. Never
    // mutates the academic profile; the session is recorded with
    // exploredOtherStream=true so every results surface stays honest.
    exploreOtherStream: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<AssembleResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    // Mock exams are a premium feature (same gate reason as the legacy
    // engine — PremiumGateOverlay + /upgrade handle the code client-side).
    await requireActiveSubscriptionDb(ctx, userId, "premium_mock_exams");

    // One active session at a time — resume instead of stacking sittings.
    const active = (await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .order("asc").take(1))[0];
    if (active) {
      throw new ConvexError({
        message: "You already have an exam in progress. Resume it or submit it first.",
        code: "session_in_progress",
      });
    }

    const blueprint = await ctx.db.get(args.blueprintId);
    if (!blueprint) {
      throw new ConvexError({ message: "Exam configuration not found.", code: "not_found" });
    }

    // ── MATRIC OS 2.1: backend stream eligibility (spec §6) ────────────────
    // The canonical academic identity lives on userProfiles (single source
    // of truth). Eligibility is enforced HERE on the server — the hub's
    // grouping is presentation only, never the gate.
    const profile = (await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc").take(1))[0];
    const studentStream: StudentStream =
      profile?.stream === "natural" || profile?.stream === "social"
        ? profile.stream
        : null; // undefined / legacy "common" → unselected (never defaulted)

    // Resolve the exam's stream: full simulations declare it on the
    // blueprint; subject-scoped modes inherit it from their subject.
    let subjectStream: SubjectEligibilityStream | undefined;
    if (blueprint.mode === "subject_mock") {
      const plan = blueprint.subjects[0];
      if (plan) {
        const subject = await ctx.db.get(plan.subjectId);
        subjectStream =
          subject?.stream === "natural" || subject?.stream === "social"
            ? subject.stream
            : "common";
      }
    } else if (blueprint.mode === "past_paper") {
      if (args.pastPaperContentId) {
        const item = await ctx.db.get(args.pastPaperContentId);
        const subject = item?.subjectId ? await ctx.db.get(item.subjectId) : null;
        subjectStream =
          subject?.stream === "natural" || subject?.stream === "social"
            ? subject.stream
            : "common";
      }
    }

    const eligibility = evaluateStreamEligibility({
      studentStream,
      blueprintStream: blueprint.stream as "natural" | "social" | undefined,
      subjectStream,
      exploreOtherStream: args.exploreOtherStream ?? false,
    });
    if (!eligibility.allowed) {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "content_event",
        source: "matricEngine.stream_eligibility_denied",
        status: "error",
        userId,
        metadata: JSON.stringify({
          blueprintKey: blueprint.key,
          studentStream,
          blueprintStream: blueprint.stream ?? null,
          subjectStream: subjectStream ?? null,
        }),
      });
      throw new ConvexError({
        message: eligibility.reason,
        code: "stream_mismatch",
      });
    }

    // The sitting's immutable stream snapshot: blueprint stream, else the
    // subject's stream, else "common" (shared subjects).
    const effectiveStream: "natural" | "social" | "common" =
      (blueprint.stream as "natural" | "social" | undefined) ?? subjectStream ?? "common";

    const result = await ctx.runMutation(internal.matricEngine.assembleSessionInternal, {
      userId,
      blueprintId: args.blueprintId,
      ...(args.pastPaperContentId !== undefined
        ? { pastPaperContentId: args.pastPaperContentId }
        : {}),
      userPremium: true, // gate above already enforced premium
      exploredOtherStream: eligibility.exploredOtherStream,
      effectiveStream,
    });
    return result;
  },
});

function parseSnapshot(session: MatricSessionDoc): SnapshotQuestion[] {
  try {
    const parsed = JSON.parse(session.questionsJson) as SnapshotQuestion[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/** One active-session payload (used for both hub resume and the player). */
function activeSessionPayload(session: MatricSessionDoc): ActiveSessionPayload {
  const snapshot = parseSnapshot(session);
  let sections: SessionSection[] = [];
  try {
    sections = JSON.parse(session.sectionsJson) as SessionSection[];
  } catch {
    sections = [];
  }
  const serverNow = Date.now();
  return {
    sessionId: session._id,
    title: session.title,
    mode: session.mode,
    blueprintKey: session.blueprintKey,
    questionCount: session.questionCount,
    timeLimitSeconds: session.timeLimitSeconds,
    startedAt: session.startedAt,
    deadlineAt: session.deadlineAt,
    serverNow,
    remainingSeconds: Math.max(0, Math.round((session.deadlineAt - serverNow) / 1000)),
    sections,
    questions: snapshot.map(sanitizeForPlayer),
    answers: session.answers,
    flags: session.flags,
    timeMs: session.timeMs,
  };
}

/** The student's active session, if any — powers resume after any reload. */
export const getMyActiveSession = query({
  args: {},
  handler: async (ctx): Promise<ActiveSessionPayload | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = (await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .order("asc").take(1))[0];
    if (!session) return null;
    return activeSessionPayload(session);
  },
});

export const getSessionForPlayer = query({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, args): Promise<ActiveSessionPayload | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return null;
    if (session.status !== "active") return null;
    return activeSessionPayload(session);
  },
});

// ── Autosave (Phase 5) ─────────────────────────────────────────────────────

/** Sanitize client answers/flags/time arrays — length-capped, label-validated. */
function sanitizeClientState(
  session: MatricSessionDoc,
  answers: readonly string[],
  flags: readonly boolean[],
  timeMs: readonly number[],
) {
  const n = session.questionCount;
  const safeAnswers: string[] = [];
  for (let i = 0; i < n; i++) {
    const raw = (answers[i] ?? "").trim().toUpperCase().slice(0, 4);
    safeAnswers.push(/^[A-E]$/.test(raw) ? raw : "");
  }
  const safeFlags: boolean[] = [];
  for (let i = 0; i < n; i++) safeFlags.push(flags[i] === true);
  const budgetMs = session.timeLimitSeconds * 1000;
  const safeTimeMs: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = timeMs[i];
    safeTimeMs.push(Number.isFinite(raw) ? Math.max(0, Math.min(Math.round(raw), budgetMs)) : 0);
  }
  return { safeAnswers, safeFlags, safeTimeMs };
}

export const saveProgressInternal = internalMutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("matricSessions"),
    answers: v.array(v.string()),
    flags: v.array(v.boolean()),
    timeMs: v.array(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ saved: boolean; reason?: string; serverNow: number; remainingSeconds: number }> => {
    const session = (await ctx.db.get(args.sessionId)) as MatricSessionDoc | null;
    if (!session || session.userId !== args.userId) {
      throw new ConvexError({ message: "Session not found.", code: "not_found" });
    }
    const serverNow = Date.now();
    if (session.status !== "active") {
      // Idempotent — a late autosave after submit is not an error.
      return { saved: false, reason: "not_active", serverNow, remainingSeconds: 0 };
    }
    const { safeAnswers, safeFlags, safeTimeMs } = sanitizeClientState(
      session,
      args.answers,
      args.flags,
      args.timeMs,
    );
    await ctx.db.patch(session._id, {
      answers: safeAnswers,
      flags: safeFlags,
      timeMs: safeTimeMs,
      updatedAt: serverNow,
    });
    return {
      saved: true,
      serverNow,
      remainingSeconds: Math.max(0, Math.round((session.deadlineAt - serverNow) / 1000)),
    };
  },
});

export const saveProgress = mutation({
  args: {
    sessionId: v.id("matricSessions"),
    answers: v.array(v.string()),
    flags: v.array(v.boolean()),
    timeMs: v.array(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ saved: boolean; reason?: string; serverNow: number; remainingSeconds: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    return await ctx.runMutation(internal.matricEngine.saveProgressInternal, {
      userId,
      sessionId: args.sessionId,
      answers: args.answers,
      flags: args.flags,
      timeMs: args.timeMs,
    });
  },
});

// ── Submission + secure scoring (Phase 6) ──────────────────────────────────

export const submitMatricExam = mutation({
  args: {
    sessionId: v.id("matricSessions"),
    answers: v.array(v.string()),
    flags: v.array(v.boolean()),
    timeMs: v.array(v.number()),
    source: v.optional(v.union(v.literal("student"), v.literal("admin"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ graded: boolean; sessionId: Id<"matricSessions">; scorePct?: number; alreadyGraded: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const session = (await ctx.db.get(args.sessionId)) as MatricSessionDoc | null;
    if (!session || session.userId !== userId) {
      throw new ConvexError({ message: "Session not found.", code: "not_found" });
    }

    // Idempotent: double-submit (double-click, retry storm, offline queue
    // flush) lands on the same graded result. Never a duplicate record.
    if (session.status === "graded") {
      return { graded: true as const, sessionId: session._id, alreadyGraded: true as const };
    }
    if (session.status !== "active" && session.status !== "submitted") {
      throw new ConvexError({
        message: "This session can no longer be submitted.",
        code: "invalid_state",
      });
    }

    const serverNow = Date.now();
    const { safeAnswers, safeFlags, safeTimeMs } = sanitizeClientState(
      session,
      args.answers,
      args.flags,
      args.timeMs,
    );
    const timeSpentSeconds = Math.max(
      0,
      Math.min(Math.round((serverNow - session.startedAt) / 1000), session.timeLimitSeconds + SUBMIT_GRACE_SECONDS),
    );

    if (session.status === "active") {
      await ctx.db.patch(session._id, {
        status: "submitted" as const,
        answers: safeAnswers,
        flags: safeFlags,
        timeMs: safeTimeMs,
        submittedAt: serverNow,
        submissionSource: args.source ?? "student",
        timeSpentSeconds,
        updatedAt: serverNow,
      });
    }

    await ctx.runMutation(internal.matricEngine.gradeSessionInternal, {
      sessionId: session._id,
    });
    // Ingestion runs as its OWN transaction — a learning-loop hiccup can
    // never roll back grading, and the sweeper retries until done.
    await ctx.runMutation(internal.matricEngine.ingestMatricSessionInternal, {
      sessionId: session._id,
    });

    const graded = (await ctx.db.get(session._id)) as MatricSessionDoc | null;
    return {
      graded: true as const,
      sessionId: session._id,
      scorePct: graded?.scorePct ?? 0,
      alreadyGraded: false as const,
    };
  },
});

/**
 * THE SCORER. Runs entirely server-side against the immutable snapshot.
 * Idempotent by state transition (submitted/… → graded) inside one
 * transaction — XP, streak credit and achievements share that transaction,
 * so a retry can never double-award.
 */
export const gradeSessionInternal = internalMutation({
  args: {
    sessionId: v.id("matricSessions"),
    source: v.optional(v.union(v.literal("student"), v.literal("auto_expiry"), v.literal("admin"))),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ alreadyGraded: boolean; scorePct: number; invalidated?: boolean }> => {
    const session = (await ctx.db.get(args.sessionId)) as MatricSessionDoc | null;
    if (!session) {
      throw new ConvexError({ message: "Session not found.", code: "not_found" });
    }
    if (session.status === "graded") {
      return { alreadyGraded: true as const, scorePct: session.scorePct ?? 0 };
    }
    if (session.status === "invalidated") {
      return { alreadyGraded: false as const, scorePct: 0, invalidated: true as const };
    }

    const snapshot = parseSnapshot(session);
    if (snapshot.length === 0) {
      throw new ConvexError({ message: "Session snapshot corrupted.", code: "internal" });
    }
    let sections: SessionSection[] = [];
    try {
      sections = JSON.parse(session.sectionsJson) as SessionSection[];
    } catch {
      sections = [];
    }

    const scored = scoreSession({
      questions: snapshot,
      sections,
      answers: session.answers,
    });

    const now = Date.now();
    const timeSpentSeconds =
      session.timeSpentSeconds ??
      Math.max(0, Math.min(Math.round((now - session.startedAt) / 1000), session.timeLimitSeconds));

    const keyTiers = {
      admin_verified: snapshot.filter((q) => q.verificationTier === "admin_verified").length,
      parser_verified: snapshot.filter((q) => q.verificationTier === "parser_verified").length,
      unverified: snapshot.filter((q) => q.verificationTier === "unverified").length,
    };

    await ctx.db.patch(session._id, {
      status: "graded" as const,
      gradedAt: now,
      scorePct: scored.scorePct,
      correctCount: scored.correctCount,
      incorrectCount: scored.incorrectCount,
      unansweredCount: scored.unansweredCount,
      timeSpentSeconds,
      resultsJson: JSON.stringify(scored.perQuestion),
      breakdownJson: JSON.stringify({
        subjectBreakdown: scored.subjectBreakdown,
        topicBreakdown: scored.topicBreakdown,
      }),
      gradingAuditJson: JSON.stringify({
        scorerVersion: SCORER_VERSION,
        scoredAt: now,
        blueprintVersion: session.blueprintVersion,
        answerKeyTiers: keyTiers,
        seed: session.seed,
      }),
      ingestState: "pending" as const,
      updatedAt: now,
    });

    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "content_event",
      source: "matricEngine.session_graded",
      status: "success",
      userId: session.userId,
      metadata: JSON.stringify({
        sessionId: session._id,
        blueprintKey: session.blueprintKey,
        scorePct: scored.scorePct,
        correct: scored.correctCount,
        total: scored.totalQuestions,
        submissionSource: args.source ?? session.submissionSource ?? "student",
      }),
    });

    // XP + streak credit + achievements — same transaction as the grade
    // patch, so idempotency covers all of them.
    const xpAmount =
      XP_VALUES.mock_exam_complete_base + XP_VALUES.mock_exam_per_correct * scored.correctCount;
    try {
      await ctx.runMutation(internal.xp.awardXp, {
        userId: session.userId,
        amount: xpAmount,
        reason: "mock_exam_complete",
      });
    } catch {
      // XP must never block a graded result.
    }
    const firstSubjectId = sections[0]?.subjectId as Id<"subjects"> | undefined;
    if (firstSubjectId && timeSpentSeconds > 0) {
      try {
        await ctx.runMutation(internal.studySessions.logSessionFromAction, {
          userId: session.userId,
          subjectId: firstSubjectId,
          durationSeconds: Math.min(timeSpentSeconds, 12 * 60 * 60),
          startedAt: session.startedAt,
          endedAt: now,
          localDate: new Date(now).toISOString().slice(0, 10),
          xpReason: "mock_exam_complete",
          xpAmount: 0,
        });
      } catch {
        // Streak logging is non-fatal.
      }
    }
    try {
      await ctx.runMutation(internal.achievements.checkAndAward, { userId: session.userId });
    } catch {
      // Achievements are non-fatal.
    }

    return { alreadyGraded: false as const, scorePct: scored.scorePct };
  },
});

// ── Learning-loop ingestion (Phase 7) — exactly-once effects ───────────────

/**
 * Feed the graded session into Mistake Lab + Exam Twin. Unlike the legacy
 * engine, vault questions carry REAL topicIds → mock misses now move
 * topicMastery, so Exam Twin, Practice Similar and Next Action all see the
 * evidence. Idempotent via learning.ts dedupe keys; state-tracked here so
 * the cron sweeper retries failures.
 */
export const ingestMatricSessionInternal = internalMutation({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, args): Promise<{ ok: boolean; skipped?: boolean }> => {
    const session = (await ctx.db.get(args.sessionId)) as MatricSessionDoc | null;
    if (!session) return { ok: false as const };
    if (session.ingestState === "done" || session.status !== "graded") {
      return { ok: true as const, skipped: true as const };
    }
    let sections: SessionSection[] = [];
    let results: ScoredQuestion[] = [];
    try {
      sections = JSON.parse(session.sectionsJson) as SessionSection[];
      results = JSON.parse(session.resultsJson ?? "[]") as ScoredQuestion[];
    } catch {
      results = [];
    }

    try {
      for (const section of sections) {
        const rows = results.slice(section.startIndex, section.endIndex);
        if (rows.length === 0) continue;
        await ctx.runMutation(internal.learning.ingestQuestionOutcomes, {
          subjectId: section.subjectId as Id<"subjects">,
          source: "mock_exam",
          sourceRefId: session._id,
          // Sweeper/graded-offline contexts have no browser identity —
          // pass the session owner explicitly so ingestion can never
          // silently no-op (selftest-caused regression guard).
          userIdOverride: session.userId,
          outcomes: rows.map((r) => ({
            questionKey: `q${r.index}`,
            questionText: r.stem,
            options: r.choices.map((c) => c.text),
            correctAnswer: r.correctAnswerText,
            studentAnswer: r.studentAnswerText,
            explanation: r.explanation,
            correct: r.correct,
            topicId: r.topicId as Id<"topics"> | undefined,
            topicText: r.topicText,
            contentId: r.contentId as Id<"contentItems"> | undefined,
            sourcePage: r.sourcePage,
            origin: "official" as const,
          })),
        });
      }
      await ctx.db.patch(session._id, {
        ingestState: "done" as const,
        ingestError: undefined,
        updatedAt: Date.now(),
      });
      return { ok: true as const };
    } catch (e) {
      const attempts = (session.ingestAttempts ?? 0) + 1;
      await ctx.db.patch(session._id, {
        ingestState: "failed" as const,
        ingestError: e instanceof Error ? e.message : String(e),
        ingestAttempts: attempts,
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "error",
        source: "matricEngine.ingest_failed",
        status: "error",
        userId: session.userId,
        metadata: JSON.stringify({
          sessionId: session._id,
          attempts,
          error: e instanceof Error ? e.message : String(e),
        }),
      });
      return { ok: false as const };
    }
  },
});

// ── Cron sweeper (Phase 5/10) — expiry + ingestion retries ─────────────────

/**
 * Runs every minute. Two jobs, both idempotent, both bounded:
 *   1. Expired active sessions (deadline + grace passed) → auto-submitted
 *      with whatever answers were saved, then graded. The timer is
 *      server-authoritative; a closed browser changes nothing.
 *   2. Graded sessions with pending/failed ingestion → retried (max 8).
 */
export const sweepMatricSessions = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expired: number; retried: number }> => {
    const now = Date.now();
    let expired = 0;
    let retried = 0;

    const actives = await ctx.db
      .query("matricSessions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(SWEEP_BATCH);
    for (const s of actives) {
      const session = s as MatricSessionDoc;
      if (session.deadlineAt + SUBMIT_GRACE_SECONDS * 1000 > now) continue;
      await ctx.db.patch(session._id, {
        status: "submitted" as const,
        submittedAt: now,
        submissionSource: "auto_expiry",
        timeSpentSeconds: session.timeLimitSeconds,
        updatedAt: now,
      });
      await ctx.runMutation(internal.matricEngine.gradeSessionInternal, {
        sessionId: session._id,
        source: "auto_expiry",
      });
      await ctx.runMutation(internal.matricEngine.ingestMatricSessionInternal, {
        sessionId: session._id,
      });
      expired++;
      if (expired >= 20) break;
    }

    const pending = await ctx.db
      .query("matricSessions")
      .withIndex("by_ingest_state", (q) => q.eq("ingestState", "pending"))
      .take(10);
    for (const s of pending) {
      if ((s as MatricSessionDoc).status !== "graded") continue;
      await ctx.runMutation(internal.matricEngine.ingestMatricSessionInternal, {
        sessionId: s._id,
      });
      retried++;
    }
    const failed = await ctx.db
      .query("matricSessions")
      .withIndex("by_ingest_state", (q) => q.eq("ingestState", "failed"))
      .take(10);
    for (const s of failed) {
      const session = s as MatricSessionDoc;
      if (session.status !== "graded") continue;
      if ((session.ingestAttempts ?? 0) >= 8) continue;
      await ctx.runMutation(internal.matricEngine.ingestMatricSessionInternal, {
        sessionId: session._id,
      });
      retried++;
    }

    if (expired > 0 || retried > 0) {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "content_event",
        source: "matricEngine.sweep",
        status: "success",
        metadata: JSON.stringify({ expired, retried }),
      });
    }
    return { expired, retried };
  },
});

// ── Catalog + history + results (Phases 7/9) ───────────────────────────────

export interface CatalogSubjectMock {
  blueprintId: Id<"matricBlueprints">;
  key: string;
  subjectName: string;
  slug: string;
  /** Subject stream — "common" subjects are sat by every stream. */
  stream: SubjectEligibilityStream;
  questionCount: number;
  timeLimitSeconds: number;
  eligibleCount: number;
  adminVerifiedCount: number;
  paperCount: number;
  offered: boolean; // coverage >= minCoverage
}

export interface CatalogFullSimulation {
  blueprintId: Id<"matricBlueprints">;
  key: string;
  stream: "natural" | "social";
  title: string;
  totalQuestions: number;
  timeLimitSeconds: number;
  subjects: { subjectName: string; questionCount: number; eligibleCount: number }[];
  offered: boolean;
}

/**
 * The student-facing catalog: which modes exist, which are actually
 * available (REAL coverage numbers), what's premium-locked for THIS
 * student, and whether a sitting is waiting to be resumed. Every number
 * here is measured from the vault — nothing is invented.
 */
export const getMatricCatalog = query({
  args: {},
  handler: async (ctx): Promise<CatalogPayload | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const blueprints = await ctx.db
      .query("matricBlueprints")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const stats = await ctx.db.query("matricCoverageStats").collect();
    const statBySubject = new Map(stats.map((s) => [s.subjectId, s]));
    const eligibleOf = (subjectId: Id<"subjects">) => statBySubject.get(subjectId)?.eligibleCount ?? 0;

    // ── MATRIC OS 2.1: canonical academic identity ──
    const profile = (await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc").take(1))[0];
    const studentStream: StudentStream =
      profile?.stream === "natural" || profile?.stream === "social" ? profile.stream : null;
    const gradeLevel = profile?.gradeLevel ?? null;

    // Subject streams for honest tagging (bounded batch — subjects are few).
    const subjectIds = new Set<string>();
    for (const b of blueprints) {
      for (const p of b.subjects) subjectIds.add(p.subjectId);
    }
    const subjectDocs = await Promise.all([...subjectIds].map((id) => ctx.db.get(id as Id<"subjects">)));
    const streamOf = new Map<string, SubjectEligibilityStream>(
      subjectDocs
        .filter(Boolean)
        .map((s) => [s!._id, (s!.stream as SubjectEligibilityStream) ?? "common"]),
    );

    const subjectMocks: CatalogSubjectMock[] = [];
    const fullSimulations: CatalogFullSimulation[] = [];
    let weakness: { blueprintId: Id<"matricBlueprints">; title: string; description: string } | null = null;
    let pastPaper: { blueprintId: Id<"matricBlueprints"> } | null = null;

    for (const b of blueprints) {
      if (b.mode === "subject_mock") {
        const plan = b.subjects[0];
        if (!plan) continue;
        subjectMocks.push({
          blueprintId: b._id,
          key: b.key,
          subjectName: plan.subjectName,
          slug: plan.subjectSlug,
          stream: streamOf.get(plan.subjectId) ?? "common",
          questionCount: plan.questionCount,
          timeLimitSeconds: b.timeLimitSeconds,
          eligibleCount: eligibleOf(plan.subjectId),
          adminVerifiedCount: statBySubject.get(plan.subjectId)?.adminVerifiedCount ?? 0,
          paperCount: statBySubject.get(plan.subjectId)?.paperCount ?? 0,
          offered: eligibleOf(plan.subjectId) >= Math.max(plan.questionCount, b.minCoverage),
        });
      } else if (b.mode === "full_simulation" && b.stream) {
        const subjects = b.subjects.map((p) => ({
          subjectName: p.subjectName,
          questionCount: p.questionCount,
          eligibleCount: eligibleOf(p.subjectId),
        }));
        const offered =
          subjects.length >= 2 &&
          subjects.every((s) => s.eligibleCount >= Math.max(s.questionCount, b.minCoverage));
        fullSimulations.push({
          blueprintId: b._id,
          key: b.key,
          stream: b.stream as "natural" | "social",
          title: b.title,
          totalQuestions: b.subjects.reduce((acc, p) => acc + p.questionCount, 0),
          timeLimitSeconds: b.timeLimitSeconds,
          subjects,
          offered,
        });
      } else if (b.mode === "weakness_challenge") {
        weakness = { blueprintId: b._id, title: b.title, description: b.description };
      } else if (b.mode === "past_paper") {
        pastPaper = { blueprintId: b._id };
      }
    }

    // Stream-aware ordering: the student's stream first, then shared
    // subjects, then the other stream (exploration section). Presentation
    // only — eligibility is enforced server-side at start time.
    const streamRank = (s: SubjectEligibilityStream): number => {
      if (studentStream && s === studentStream) return 0;
      if (s === "common") return 1;
      return 2;
    };
    subjectMocks.sort(
      (a, b) =>
        streamRank(a.stream) - streamRank(b.stream) ||
        Number(b.offered) - Number(a.offered) ||
        a.subjectName.localeCompare(b.subjectName),
    );

    // Premium status for THIS student (trial or active).
    const sub = (await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc").take(1))[0];
    const premium = sub?.status === "trial" || sub?.status === "active";

    const activeSession = (await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .order("asc").take(1))[0];

    return {
      subjectMocks,
      fullSimulations,
      weakness,
      pastPaper,
      premium,
      hasActiveSession: !!activeSession,
      activeSessionId: activeSession?._id ?? null,
      activeSessionTitle: activeSession?.title ?? null,
      studentStream,
      studentStreamLabel: studentStreamLabel(studentStream),
      gradeLevel,
    };
  },
});

/** Past-paper options for the Past Paper Simulation launcher (bounded). */
export const getPastPaperOptions = query({
  args: {},
  handler: async (ctx): Promise<PastPaperOption[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const papers = await ctx.db
      .query("digitalPapers")
      .withIndex("by_status", (q) => q.eq("status", "ready"))
      .order("desc")
      .take(50);
    const options: PastPaperOption[] = [];
    for (const paper of papers) {
      const item = await ctx.db.get(paper.contentId);
      if (!item) continue;
      const vaultRows = await ctx.db
        .query("matricQuestions")
        .withIndex("by_content", (q) => q.eq("contentId", paper.contentId))
        .collect();
      const eligibleCount = vaultRows.filter((r) => r.examEligible && r.active).length;
      if (eligibleCount < 5) continue;
      const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
      options.push({
        contentId: paper.contentId,
        title: item.title,
        subjectName: subject?.name ?? null,
        stream:
          subject?.stream === "natural" || subject?.stream === "social"
            ? subject.stream
            : subject
              ? "common"
              : null,
        examYear: item.examYear ?? null,
        durationMinutes: item.durationMinutes ?? null,
        isPremium: item.isPremium,
        eligibleCount,
      });
      if (options.length >= 24) break;
    }
    options.sort((a, b) => (b.examYear ?? 0) - (a.examYear ?? 0));
    return options;
  },
});

export interface MatricHistoryRow {
  sessionId: Id<"matricSessions">;
  title: string;
  mode: string;
  status: string;
  scorePct: number | null;
  questionCount: number;
  startedAt: number;
  timeSpentSeconds: number | null;
  submissionSource: string | null;
  // ── MATRIC OS 2.1: smart history (stream/subject filters) ──
  /** Sitting's immutable stream snapshot — survives profile changes. */
  stream: string | null;
  /** True when this was an explicit other-stream exploration sitting. */
  exploredOtherStream: boolean;
  /** First section's subject (primary subject for mocks/past papers). */
  primarySubjectName: string | null;
}

/** Recent sittings for the hub (old mockExams history is preserved separately). */
export const getMyMatricHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const sessions = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(args.limit ?? 12, 30));
    return sessions.map((s): MatricHistoryRow => {
      let primarySubjectName: string | null = null;
      try {
        const sections = JSON.parse(s.sectionsJson) as SessionSection[];
        primarySubjectName = sections[0]?.subjectName ?? null;
      } catch {
        primarySubjectName = null;
      }
      return {
        sessionId: s._id,
        title: s.title,
        mode: s.mode,
        status: s.status,
        scorePct: s.scorePct ?? null,
        questionCount: s.questionCount,
        startedAt: s.startedAt,
        timeSpentSeconds: s.timeSpentSeconds ?? null,
        submissionSource: s.submissionSource ?? null,
        stream: s.stream ?? null,
        exploredOtherStream: s.exploredOtherStream ?? false,
        primarySubjectName,
      };
    });
  },
});

// ── MATRIC OS 2.1 — Unified Grade 12 Examination Journey ───────────────────

export interface MatricJourneyPayload {
  kind: "resume" | "start" | "unavailable";
  /** Resume: the active session. Start: the recommended blueprint. */
  sessionId: Id<"matricSessions"> | null;
  blueprintId: Id<"matricBlueprints"> | null;
  title: string;
  subjectName: string | null;
  mode: string | null;
  questionCount: number | null;
  timeLimitSeconds: number | null;
  stream: "natural" | "social" | null;
  streamLabel: string | null;
  /** Deterministic, honest reason — shown verbatim under the card. */
  reason: string;
  /** Review → Practice → Improve strip evidence (real counts only). */
  review: { dueMistakes: number | null; weakestSubjectName: string | null; weakestScorePct: number | null };
}

/**
 * "Your next exam" — deterministic recommendation assembled from REAL data:
 * the active session, the verified vault coverage, the student's saved
 * stream and their own graded results. No AI, no invented readiness scores,
 * no national predictions. Rotation: the weakest subject is recommended
 * unless it was just practiced, so revision spreads across the stream.
 */
export const getMatricJourney = query({
  args: {},
  handler: async (ctx): Promise<MatricJourneyPayload | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // 1. An in-progress sitting always wins.
    const active = (await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "active"))
      .order("asc").take(1))[0];
    if (active) {
      return {
        kind: "resume",
        sessionId: active._id,
        blueprintId: active.blueprintId,
        title: active.title,
        subjectName: null,
        mode: active.mode,
        questionCount: active.questionCount,
        timeLimitSeconds: active.timeLimitSeconds,
        stream: (active.stream as "natural" | "social" | undefined) ?? null,
        streamLabel: studentStreamLabel(active.stream ?? null),
        reason: "Your timer is still running server-side — resume before it expires.",
        review: { dueMistakes: null, weakestSubjectName: null, weakestScorePct: null },
      };
    }

    // 2. Canonical identity.
    const profile = (await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("asc").take(1))[0];
    const studentStream: StudentStream =
      profile?.stream === "natural" || profile?.stream === "social" ? profile.stream : null;

    // 3. Coverage + blueprints (same honest sources as the catalog).
    const blueprints = await ctx.db
      .query("matricBlueprints")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const stats = await ctx.db.query("matricCoverageStats").collect();
    const statBySubject = new Map(stats.map((s) => [s.subjectId, s]));
    const eligibleOf = (id: Id<"subjects">) => statBySubject.get(id)?.eligibleCount ?? 0;

    const mockCandidates = blueprints
      .filter((b) => b.mode === "subject_mock" && b.subjects[0])
      .map((b) => {
        const plan = b.subjects[0];
        return {
          blueprintId: b._id,
          title: b.title,
          subjectName: plan!.subjectName,
          questionCount: plan!.questionCount,
          timeLimitSeconds: b.timeLimitSeconds,
          eligibleCount: eligibleOf(plan!.subjectId),
          offered: eligibleOf(plan!.subjectId) >= Math.max(plan!.questionCount, b.minCoverage),
        };
      })
      .filter((c) => c.offered);
    // Deterministic order: name (ties broken stably).
    mockCandidates.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    // 4. The student's own graded evidence — recent sittings only, real
    // per-subject scores from the immutable results snapshot.
    const recent = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(14);
    const graded = recent.filter((s) => s.status === "graded" && s.scorePct !== null);
    const perSubject = new Map<string, { name: string; scores: number[] }>();
    for (const s of graded) {
      try {
        const breakdown = JSON.parse(s.breakdownJson ?? "{}") as { subjectBreakdown?: SubjectBreakdownRow[] };
        for (const row of breakdown.subjectBreakdown ?? []) {
          const entry = perSubject.get(row.subjectName) ?? { name: row.subjectName, scores: [] };
          entry.scores.push(row.scorePct);
          perSubject.set(row.subjectName, entry);
        }
      } catch {
        // corrupted breakdown is skipped — never invent a score
      }
    }
    const subjectAverages = [...perSubject.values()]
      .map((e) => ({
        name: e.name,
        avg: e.scores.reduce((a, b) => a + b, 0) / e.scores.length,
        attempts: e.scores.length,
      }))
      .sort((a, b) => a.avg - b.avg || a.name.localeCompare(b.name));
    const weakest = subjectAverages[0] ?? null;

    // Due-mistake count for the Review strip (bounded read).
    const openMistakes = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open"))
      .take(200);
    const nowMs = Date.now();
    const dueMistakes = openMistakes.filter((m) => m.nextReviewAt <= nowMs).length;

    const review = {
      dueMistakes,
      weakestSubjectName: weakest?.name ?? null,
      weakestScorePct: weakest ? Math.round(weakest.avg) : null,
    };

    const streamLabel = studentStreamLabel(studentStream);
    const streamNote =
      studentStream === null
        ? " Set your stream in Settings to get stream-tailored recommendations."
        : "";

    // 5. Recommendation.
    if (mockCandidates.length === 0) {
      const sim = blueprints.find(
        (b) =>
          b.mode === "full_simulation" &&
          b.status === "active" &&
          (studentStream === null || b.stream === studentStream),
      );
      if (sim && sim.subjects.length >= 2) {
        return {
          kind: "start",
          sessionId: null,
          blueprintId: sim._id,
          title: sim.title,
          subjectName: null,
          mode: "full_simulation",
          questionCount: sim.subjects.reduce((a, p) => a + p.questionCount, 0),
          timeLimitSeconds: sim.timeLimitSeconds,
          stream: (sim.stream as "natural" | "social" | undefined) ?? null,
          streamLabel: streamLabel,
          reason: `No single-subject mock is covered enough yet, but the full simulation has enough verified questions across ${sim.subjects.length} subjects.${streamNote}`,
          review,
        };
      }
      return {
        kind: "unavailable",
        sessionId: null,
        blueprintId: null,
        title: "No exam is covered enough yet",
        subjectName: null,
        mode: null,
        questionCount: null,
        timeLimitSeconds: null,
        stream: studentStream,
        streamLabel,
        reason: `Subjects unlock automatically as real past papers are digitized and verified — we never pad exams with unverified content.${streamNote}`,
        review,
      };
    }

    // With evidence → weakest subject first (real observed scores), with
    // rotation: skip the subject practiced most recently when others exist.
    const lastPrimary = (() => {
      try {
        const sections = JSON.parse(graded[0]?.sectionsJson ?? "[]") as SessionSection[];
        return sections[0]?.subjectName ?? null;
      } catch {
        return null;
      }
    })();

    let pick =
      weakest != null
        ? mockCandidates.find((c) => c.subjectName === weakest.name) ?? null
        : null;
    if (pick && pick.subjectName === lastPrimary) {
      const alternative =
        mockCandidates.find((c) => c.subjectName !== lastPrimary) ?? null;
      if (alternative) pick = alternative;
    }

    // No relevant evidence → strongest-coverage candidate; stream-specific
    // subjects are preferred over shared ones for stream-selected students.
    if (!pick) {
      const streamSpecific = mockCandidates.filter(
        (c) => studentStream !== null && c.subjectName !== "English" && c.subjectName !== "Mathematics" && c.subjectName !== "Scholastic Aptitude Test",
      );
      const pool = studentStream !== null && streamSpecific.length > 0 ? streamSpecific : mockCandidates;
      pick = [...pool].sort(
        (a, b) => b.eligibleCount - a.eligibleCount || a.subjectName.localeCompare(b.subjectName),
      )[0];
    }

    if (!pick) {
      return {
        kind: "unavailable",
        sessionId: null,
        blueprintId: null,
        title: "No exam is covered enough yet",
        subjectName: null,
        mode: null,
        questionCount: null,
        timeLimitSeconds: null,
        stream: studentStream,
        streamLabel,
        reason: `Subjects unlock automatically as real past papers are digitized and verified.${streamNote}`,
        review,
      };
    }

    const reason =
      weakest && pick.subjectName === weakest.name
        ? `Your lowest recent average is ${Math.round(weakest.avg)}% in ${weakest.name} — this mock targets exactly that, based on your graded sittings.`
        : studentStream !== null
          ? `Based on your selected stream (${streamLabel}) and available verified questions.`
          : "Based on available verified questions.";

    return {
      kind: "start",
      sessionId: null,
      blueprintId: pick.blueprintId,
      title: pick.title,
      subjectName: pick.subjectName,
      mode: "subject_mock",
      questionCount: pick.questionCount,
      timeLimitSeconds: pick.timeLimitSeconds,
      stream: studentStream,
      streamLabel,
      reason,
      review,
    };
  },
});

export interface MatricResultsPayload {
  sessionId: Id<"matricSessions">;
  title: string;
  mode: string;
  blueprintKey: string;
  status: string;
  submissionSource: string | null;
  // ── MATRIC OS 2.1: stream context for honest labeling ──
  /** Sitting's immutable stream snapshot. */
  stream: string | null;
  /** True for explicit other-stream explorations — always labeled. */
  exploredOtherStream: boolean;
  scorePct: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  totalQuestions: number;
  timeSpentSeconds: number | null;
  timeLimitSeconds: number;
  gradedAt: number | null;
  perQuestion: ScoredQuestion[];
  subjectBreakdown: SubjectBreakdownRow[];
  topicBreakdown: TopicBreakdownRow[];
  timeStats: { avgSeconds: number | null; slowestSeconds: number | null; fastestSeconds: number | null } | null;
  comparison: {
    previousSessions: { sessionId: Id<"matricSessions">; scorePct: number; startedAt: number; title: string }[];
    deltaVsPrevious: number | null;
  };
  nextActions: { dueMistakes: number; weakestTopics: { topicText: string; scorePct: number }[] };
  xpAwarded: number;
}

/**
 * Full results intelligence. Distinguishes MEASURED performance from
 * estimates — no predicted national scores, ever.
 */
export const getMatricResults = query({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, args): Promise<MatricResultsPayload | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = (await ctx.db.get(args.sessionId)) as MatricSessionDoc | null;
    if (!session || session.userId !== userId) return null;
    if (session.status !== "graded" && session.status !== "submitted" && session.status !== "expired") {
      return null;
    }
    if (session.status !== "graded") return null; // grading is a moment later — player waits for it

    let perQuestion: ScoredQuestion[] = [];
    let subjectBreakdown: SubjectBreakdownRow[] = [];
    let topicBreakdown: TopicBreakdownRow[] = [];
    try {
      perQuestion = JSON.parse(session.resultsJson ?? "[]") as ScoredQuestion[];
      const parsed = JSON.parse(session.breakdownJson ?? "{}") as {
        subjectBreakdown?: SubjectBreakdownRow[];
        topicBreakdown?: TopicBreakdownRow[];
      };
      subjectBreakdown = parsed.subjectBreakdown ?? [];
      topicBreakdown = parsed.topicBreakdown ?? [];
    } catch {
      perQuestion = [];
    }

    // Time statistics from sanitized per-question dwell times.
    const answeredTimes = session.timeMs.filter((t, i) => t > 0 && (session.answers[i] ?? "") !== "");
    const timeStats =
      answeredTimes.length > 0
        ? {
            avgSeconds: Math.round(answeredTimes.reduce((s, t) => s + t, 0) / answeredTimes.length / 1000),
            slowestSeconds: Math.round(Math.max(...answeredTimes) / 1000),
            fastestSeconds: Math.round(Math.min(...answeredTimes) / 1000),
          }
        : null;

    // Historical comparison — same blueprint, real previous sittings only.
    const history = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_blueprint", (q) =>
        q.eq("userId", userId).eq("blueprintKey", session.blueprintKey),
      )
      .order("desc")
      .take(8);
    const previousSessions = history
      .filter((h) => h.status === "graded" && h._id !== session._id && h.scorePct !== undefined)
      .slice(0, 5)
      .map((h) => ({ sessionId: h._id, scorePct: h.scorePct as number, startedAt: h.startedAt, title: h.title }));
    const deltaVsPrevious =
      previousSessions.length > 0
        ? (session.scorePct ?? 0) - previousSessions[0]!.scorePct
        : null;

    // Next-action inputs (bounded, real data only).
    const dueMistakeRows = await ctx.db
      .query("mistakes")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "open"))
      .take(50);
    const now = Date.now();
    const dueMistakes = dueMistakeRows.filter((m) => m.nextReviewAt <= now).length;
    const weakestTopics = [...topicBreakdown]
      .filter((t) => t.total >= 2)
      .sort((a, b) => a.scorePct - b.scorePct)
      .slice(0, 3)
      .map((t) => ({ topicText: t.topicText, scorePct: t.scorePct }));

    return {
      sessionId: session._id,
      title: session.title,
      mode: session.mode,
      blueprintKey: session.blueprintKey,
      status: session.status,
      submissionSource: session.submissionSource ?? null,
      stream: session.stream ?? null,
      exploredOtherStream: session.exploredOtherStream ?? false,
      scorePct: session.scorePct ?? 0,
      correctCount: session.correctCount ?? 0,
      incorrectCount: session.incorrectCount ?? 0,
      unansweredCount: session.unansweredCount ?? 0,
      totalQuestions: session.questionCount,
      timeSpentSeconds: session.timeSpentSeconds ?? null,
      timeLimitSeconds: session.timeLimitSeconds,
      gradedAt: session.gradedAt ?? null,
      perQuestion,
      subjectBreakdown,
      topicBreakdown,
      timeStats,
      comparison: { previousSessions, deltaVsPrevious },
      nextActions: { dueMistakes, weakestTopics },
      xpAwarded: XP_VALUES.mock_exam_complete_base + XP_VALUES.mock_exam_per_correct * (session.correctCount ?? 0),
    };
  },
});
