// MATRIC OS — Deterministic Exam Engine (Phases 3, 5, 6, 7, 9).
//
// Replaces the AI-dependent mock exam pipeline. Core principle enforced
// here: NO external generative AI request is required to create, start,
// display, save, resume, submit, score, or display results for an exam.
//
// State machine (server-enforced):
//   CREATED → ACTIVE → SUBMITTED → GRADED
//       └→ INVALIDATED (student abandon / interrupted creation / admin)
//   ACTIVE → GRADED (expiry auto-submit via cron — answers preserved)
//
// Security model:
//   - Answer keys live ONLY in matricSections documents (server-side).
//   - getPlayerSession strips answers/explanations before any client read.
//   - Scoring happens exclusively server-side against the immutable
//     snapshot written at assembly time.
//   - All side effects (Mistake Lab + mastery ingestion, XP, study-time)
//     carry exactly-once guards so retries can never double-apply.
//   - Timing is server-authoritative: deadlineAt set at activation; the
//     client countdown is display-only.

import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import {
  assembleExam,
  normalizeTopic,
  type VaultCandidate,
  type SectionRequest,
} from "../lib/matricAssembler";
import {
  getBlueprintByMode,
  fullSimulationSections,
  sectionTitle,
  type MatricMode,
} from "./matricBlueprints";
import { gradeSessionInternal } from "./matricVault";
import { XP_VALUES } from "./constants";

const MAX_POOL_PER_SUBJECT = 1200; // bounded candidate fetch per subject
const EXPIRY_GRACE_MS = 2 * 60 * 1000; // auto-submit grace after deadline
const CREATED_TIMEOUT_MS = 10 * 60 * 1000; // interrupted assembly cleanup
const MAX_RECENT_SESSIONS_FOR_REUSE = 3;

type Stream = "natural" | "social";

// ── Shared helpers ────────────────────────────────────────────────────

async function requireUser(ctx: { auth: unknown; db: unknown }): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx as never);
  if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  const user = await (ctx as any).db.get(userId);
  if (!user) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  if (user.isAnonymous) {
    throw new ConvexError({
      message: "Mock exams need a real account.",
      code: "auth_required",
    });
  }
  return user;
}

async function getPremium(ctx: any, userId: Id<"users">): Promise<boolean> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  return !!sub && (sub.status === "trial" || sub.status === "active");
}

async function getStream(ctx: any, userId: Id<"users">): Promise<Stream> {
  const profile = await ctx.db
    .query("userProfiles")
    .withIndex("by_user", (q: any) => q.eq("userId", userId))
    .unique();
  return profile?.stream === "social" ? "social" : "natural";
}

function err(code: string, message: string, details?: any) {
  return new ConvexError({ message, code, details });
}

/** Pull the candidate pool for a subject (verified-first filtering happens
 *  in the assembler; access policy is filtered here). */
async function poolForSubject(
  ctx: any,
  subjectId: Id<"subjects">,
  premiumAllowed: boolean,
): Promise<VaultCandidate[]> {
  const rows = await ctx.db
    .query("matricQuestions")
    .withIndex("by_subject_active", (q: any) =>
      q.eq("subjectId", subjectId).eq("activeStatus", true),
    )
    .take(MAX_POOL_PER_SUBJECT);
  return rows
    .filter((r: Doc<"matricQuestions">) => premiumAllowed || r.accessPolicy === "free")
    .map((r: Doc<"matricQuestions">) => ({
      questionId: r._id,
      fingerprint: r.fingerprint,
      subjectSlug: "", // filled by caller when building the map
      topicText: r.topicText,
      examYear: r.examYear,
      accessPolicy: r.accessPolicy,
      sourceType: r.sourceType,
      verificationStatus: r.verificationStatus,
    }));
}

async function poolForPaper(
  ctx: any,
  contentId: Id<"contentItems">,
  premiumAllowed: boolean,
): Promise<{ candidates: VaultCandidate[]; subjectId: Id<"subjects"> | null }> {
  const rows: Doc<"matricQuestions">[] = await ctx.db
    .query("matricQuestions")
    .withIndex("by_content", (q: any) => q.eq("contentId", contentId))
    .collect();
  const usable = rows.filter(
    (r) =>
      (premiumAllowed || r.accessPolicy === "free") &&
      r.verificationStatus === "verified",
  );
  const candidates: VaultCandidate[] = usable.map((r) => ({
    questionId: r._id,
    fingerprint: r.fingerprint,
    subjectSlug: "",
    topicText: r.topicText,
    examYear: r.examYear,
    accessPolicy: r.accessPolicy,
    sourceType: r.sourceType,
    verificationStatus: r.verificationStatus,
  }));
  return { candidates, subjectId: rows[0]?.subjectId ?? null };
}

/** Fingerprints used in the student's most recent sessions (reuse policy). */
async function recentFingerprints(
  ctx: any,
  userId: Id<"users">,
  sinceMs: number,
): Promise<Set<string>> {
  const out = new Set<string>();
  const recent = await ctx.db
    .query("matricSessions")
    .withIndex("by_user_startedAt", (q: any) =>
      q.eq("userId", userId).gte("startedAt", sinceMs),
    )
    .order("desc")
    .take(MAX_RECENT_SESSIONS_FOR_REUSE);
  for (const s of recent) {
    for (const fp of s.questionFingerprints) out.add(fp);
  }
  return out;
}

/** Load full vault rows for picked candidates and build the section
 *  snapshot (server-side, includes the answer key). */
async function snapshotQuestions(
  ctx: any,
  picked: VaultCandidate[],
): Promise<Doc<"matricSections">["questions"]> {
  const out: Doc<"matricSections">["questions"] = [];
  let number = 0;
  for (const c of picked) {
    const row = await ctx.db.get(c.questionId as Id<"matricQuestions">);
    if (!row) continue; // vault row vanished mid-assembly — skip honestly
    number++;
    out.push({
      questionId: row._id,
      fingerprint: row.fingerprint,
      number,
      stem: row.stem,
      passage: row.passage,
      options: row.options,
      answer: row.answer,
      explanation: row.explanation,
      topicText: row.topicText,
      sourceType: row.sourceType,
      contentId: row.contentId,
      sourceName: row.sourceName,
      sourcePage: row.sourcePage,
      examYear: row.examYear,
      accessPolicy: row.accessPolicy,
    });
  }
  return out;
}

// ── Eligibility preview (Phase 9) ─────────────────────────────────────

/** Mode availability + coverage for the current student. One stats read +
 *  subjects + mastery — cheap enough to call on every page load. */
export const getModes = query({
  args: { stream: v.optional(v.union(v.literal("natural"), v.literal("social"))) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user || user.isAnonymous) return null;

    const [stats, subjects, premium, profile] = await Promise.all([
      ctx.db.query("matricStats").withIndex("by_key", (q) => q.eq("key", "global")).unique(),
      ctx.db.query("subjects").collect(),
      getPremium(ctx, userId),
      ctx.db
        .query("userProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    ]);
    const stream: Stream =
      args.stream ?? (profile?.stream === "social" ? "social" : "natural");

    const perSubject = (stats?.perSubject ?? {}) as Record<
      string,
      { subjectId: Id<"subjects">; verified: number; verifiedFree: number; verifiedPremium: number }
    >;
    const availableFor = (slug: string) => {
      const s = perSubject[slug];
      if (!s) return 0;
      return premium ? s.verified : s.verifiedFree;
    };

    const subjectList = subjects
      .filter((s) => s.stream === "common" || s.stream === stream)
      .map((s) => ({
        id: s._id,
        slug: s.slug,
        name: s.name,
        stream: s.stream,
        available: availableFor(s.slug),
      }))
      .sort((a, b) => b.available - a.available);

    // Full simulation coverage.
    const bpFull = getBlueprintByMode("full_simulation");
    const fullSections = fullSimulationSections(stream).map((sec) => {
      const available = availableFor(sec.subjectSlug);
      const subject = subjects.find((s) => s.slug === sec.subjectSlug);
      return {
        subjectSlug: sec.subjectSlug,
        subjectName: subject?.name ?? sec.subjectSlug,
        requested: sec.count,
        minutes: sec.minutes,
        available,
        ok: available >= sec.count,
      };
    });
    const allFull = fullSections.every((s) => s.ok);
    const allViable = fullSections.every((s) => s.available >= bpFull.minQuestionsPerSection);
    const fullKind: "full" | "reduced" | "insufficient" = allFull
      ? "full"
      : allViable
        ? "reduced"
        : "insufficient";

    // Weakness challenge: needs mastery evidence + bank coverage.
    const mastery = await ctx.db
      .query("topicMastery")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const weakRows = mastery.filter((m) => {
      const attempts = m.recentResults.length;
      if (attempts === 0) return false;
      const correct = m.recentResults.reduce((n, r) => n + (r === 1 ? 1 : 0), 0);
      return correct / attempts < 0.7;
    });
    const weakSubjects = new Set(weakRows.map((m) => m.subjectId));
    const weaknessViable =
      weakRows.length > 0 &&
      [...weakSubjects].some((sid) => {
        const subject = subjects.find((s) => s._id === sid);
        return subject ? availableFor(subject.slug) >= 5 : false;
      });

    // Past papers from the registry.
    const papers = Object.values((stats?.papers ?? {}) as Record<string, {
      contentId: Id<"contentItems">;
      title: string;
      subjectId: Id<"subjects">;
      subjectSlug: string;
      examYear?: number;
      gradableCount: number;
      premium: boolean;
      durationMinutes?: number;
      verificationStatus: "verified" | "unverified";
    }>)
      .filter((p) => p.gradableCount >= 10)
      .sort((a, b) => (b.examYear ?? 0) - (a.examYear ?? 0) || a.title.localeCompare(b.title))
      .slice(0, 40)
      .map((p) => ({ ...p, locked: p.premium && !premium }));

    return {
      stream,
      isPremium: premium,
      bankVersion: stats?.bankVersion ?? 0,
      totalVerified: stats?.totalVerified ?? 0,
      vaultUpdatedAt: stats?.updatedAt ?? 0,
      subjects: subjectList,
      modes: {
        full_simulation: {
          available: fullKind !== "insufficient",
          kind: fullKind,
          sections: fullSections,
        },
        subject_mock: { available: subjectList.some((s) => s.available >= 10) },
        weakness_challenge: {
          available: weaknessViable,
          weakTopicCount: weakRows.length,
        },
        past_paper: { available: papers.length > 0, papers },
      },
    };
  },
});

// ── Start a session (Phase 3 assembly, server-side) ───────────────────

export const startSession = mutation({
  args: {
    mode: v.union(
      v.literal("full_simulation"),
      v.literal("subject_mock"),
      v.literal("weakness_challenge"),
      v.literal("past_paper"),
    ),
    subjectId: v.optional(v.id("subjects")),
    contentId: v.optional(v.id("contentItems")),
    stream: v.optional(v.union(v.literal("natural"), v.literal("social"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const userId = user._id;
    const now = Date.now();

    // One active sitting at a time (client offers Resume).
    const active = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "ACTIVE"))
      .first();
    if (active) throw err("session_in_progress", "You already have an exam in progress.", active._id);

    const bp = getBlueprintByMode(args.mode as MatricMode);
    const premium = await getPremium(ctx, userId);
    if (bp.premiumOnly && !premium) {
      throw err("premium_mock_exams", "This exam mode needs an active subscription.");
    }
    const stream: Stream = args.stream ?? (await getStream(ctx, userId));

    // Vault stats (bankVersion snapshot for the session record).
    const stats = await ctx.db
      .query("matricStats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    const bankVersion = stats?.bankVersion ?? 0;

    // Subject catalog.
    const subjects = await ctx.db.query("subjects").collect();
    const subjectBySlug = new Map(subjects.map((s) => [s.slug, s]));

    const premiumAllowed = premium;
    const exclude =
      bp.excludeRecentDays > 0
        ? await recentFingerprints(ctx, userId, now - bp.excludeRecentDays * 24 * 60 * 60 * 1000)
        : new Set<string>();

    interface PlannedSection {
      request: SectionRequest;
    }
    const planned: PlannedSection[] = [];
    let reduced = false;
    let title = bp.label;
    let sessionSubjectId: Id<"subjects"> | undefined;
    let contentId: Id<"contentItems"> | undefined;

    if (args.mode === "full_simulation") {
      const specs = fullSimulationSections(stream);
      const candidatesBySubject: Record<string, VaultCandidate[]> = {};
      for (const spec of specs) {
        const subject = subjectBySlug.get(spec.subjectSlug);
        if (!subject) {
          throw err(
            "insufficient_coverage",
            `Subject “${spec.subjectSlug}” is not configured on this deployment.`,
            { subjectSlug: spec.subjectSlug, available: 0 },
          );
        }
        candidatesBySubject[spec.subjectSlug] = (
          await poolForSubject(ctx, subject._id, premiumAllowed)
        ).map((c) => ({ ...c, subjectSlug: spec.subjectSlug }));
      }
      const full = specs.every(
        (spec) => (candidatesBySubject[spec.subjectSlug]?.length ?? 0) >= spec.count,
      );
      const viable = specs.every(
        (spec) =>
          (candidatesBySubject[spec.subjectSlug]?.length ?? 0) >= bp.minQuestionsPerSection,
      );
      if (!viable) {
        throw err(
          "insufficient_coverage",
          "The verified question bank cannot fill every section of the full simulation yet. Try Subject Mocks on the subjects with coverage, or ask an admin to sync past papers.",
          specs.map((spec) => ({
            subjectSlug: spec.subjectSlug,
            available: candidatesBySubject[spec.subjectSlug]?.length ?? 0,
            requested: spec.count,
          })),
        );
      }
      const effSpecs = full
        ? specs
        : specs.map((spec) => ({
            ...spec,
            count: Math.min(spec.count, candidatesBySubject[spec.subjectSlug]?.length ?? 0),
          }));
      reduced = !full;
      if (reduced) title = `${bp.label} — Reduced practice (limited verified bank)`;
      for (const spec of effSpecs) {
        const subject = subjectBySlug.get(spec.subjectSlug)!;
        planned.push({
          request: {
            subjectSlug: spec.subjectSlug,
            subjectId: subject._id,
            subjectName: subject.name,
            count: spec.count,
            timeAllottedSeconds: spec.minutes * 60,
          },
        });
      }
    } else if (args.mode === "subject_mock") {
      if (!args.subjectId) throw err("invalid", "Pick a subject first.");
      const subject = await ctx.db.get(args.subjectId);
      if (!subject) throw err("invalid", "Subject not found.");
      const pool = await poolForSubject(ctx, subject._id, premiumAllowed);
      const available = pool.length;
      if (available < bp.minQuestionsPerSection!) {
        throw err(
          "insufficient_coverage",
          `Only ${available} verified ${subject.name} question${available === 1 ? "" : "s"} are in the bank right now (need ${bp.minQuestionsPerSection}). Sync more past papers or try another subject.`,
          { subjectSlug: subject.slug, available },
        );
      }
      const count = Math.min(bp.questionCount!, available);
      reduced = count < bp.questionCount!;
      if (reduced) title = `${subject.name} Mock — Reduced practice (${count} questions)`;
      else title = `${subject.name} Mock`;
      sessionSubjectId = subject._id;
      planned.push({
        request: {
          subjectSlug: subject.slug,
          subjectId: subject._id,
          subjectName: subject.name,
          count,
          timeAllottedSeconds: bp.minutes! * 60,
        },
      });
    } else if (args.mode === "weakness_challenge") {
      const mastery = await ctx.db
        .query("topicMastery")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const weak = mastery
        .map((m) => {
          const attempts = m.recentResults.length;
          const correct = m.recentResults.reduce((n, r) => n + (r === 1 ? 1 : 0), 0);
          const ratio = attempts > 0 ? correct / attempts : 1;
          return { row: m, ratio, attempts };
        })
        .filter((m) => m.attempts > 0 && m.ratio < 0.7)
        .sort((a, b) => a.ratio - b.ratio)
        .slice(0, 8);
      if (weak.length === 0) {
        throw err(
          "no_weakness_data",
          "No weak-topic evidence yet. Take a Subject Mock or practice past papers first — your results will fuel this mode.",
        );
      }
      // Resolve topic names and group by subject.
      const topicNameById = new Map<Id<"topics">, string>();
      for (const w of weak) {
        const topic = await ctx.db.get(w.row.topicId);
        if (topic) topicNameById.set(w.row.topicId, topic.name);
      }
      const bySubject = new Map<Id<"subjects">, Set<string>>();
      for (const w of weak) {
        const name = topicNameById.get(w.row.topicId);
        if (!name) continue;
        const set = bySubject.get(w.row.subjectId) ?? new Set<string>();
        set.add(name);
        bySubject.set(w.row.subjectId, set);
      }
      let remaining = bp.questionCount!;
      const entries = [...bySubject.entries()].slice(0, 3);
      for (const [sid, topicNames] of entries) {
        if (remaining <= 0) break;
        const subject = await ctx.db.get(sid);
        if (!subject) continue;
        const pool = await poolForSubject(ctx, sid, premiumAllowed);
        const topicSet = new Set([...topicNames].map((t) => normalizeTopic(t)));
        const topicPool = pool.filter((c) => topicSet.has(normalizeTopic(c.topicText)));
        const usePool = topicPool.length >= bp.minQuestionsPerSection ? topicPool : [];
        if (usePool.length === 0) continue;
        const count = Math.min(remaining, usePool.length);
        const weights: Record<string, number> = {};
        for (const t of topicNames) weights[normalizeTopic(t)] = 1;
        planned.push({
          request: {
            subjectSlug: subject.slug,
            subjectId: subject._id,
            subjectName: subject.name,
            count,
            timeAllottedSeconds: Math.max(5 * 60, Math.round((count * bp.minutes! * 60) / bp.questionCount!)),
            topicWeights: weights,
          },
        });
        remaining -= count;
      }
      if (planned.length === 0) {
        throw err(
          "insufficient_coverage",
          "Your weak topics don't have enough verified questions in the bank yet. Sync more past papers or try a Subject Mock.",
        );
      }
      reduced = planned.some((p) => p.request.count < Math.ceil(bp.questionCount! / planned.length));
      title = "Weakness Challenge";
      sessionSubjectId = planned[0]!.request.subjectId as Id<"subjects">;
    } else if (args.mode === "past_paper") {
      if (!args.contentId) throw err("invalid", "Pick a past paper first.");
      const item = await ctx.db.get(args.contentId);
      if (!item) throw err("invalid", "Past paper not found.");
      if (item.isPremium && !premiumAllowed) {
        throw err("premium_mock_exams", "This paper is part of the premium library.");
      }
      const { candidates, subjectId } = await poolForPaper(ctx, args.contentId, premiumAllowed);
      if (!subjectId || candidates.length < bp.minQuestionsPerSection!) {
        throw err(
          "insufficient_coverage",
          "This paper doesn't have enough verified, key-matched questions in the vault yet. An admin can sync or verify it from the Matric panel.",
          { contentId: args.contentId, available: candidates.length },
        );
      }
      const subject = await ctx.db.get(subjectId);
      const minutes = item.durationMinutes ?? Math.max(30, Math.round(candidates.length * 1));
      title = `${item.title} — Full Sitting`;
      sessionSubjectId = subjectId;
      contentId = args.contentId;
      planned.push({
        request: {
          subjectSlug: subject?.slug ?? "past-paper",
          subjectId,
          subjectName: subject?.name ?? item.title,
          count: candidates.length,
          timeAllottedSeconds: minutes * 60,
        },
      });
      // Past paper: candidates come from the paper itself, not by subject.
      const candidatesBySubject: Record<string, VaultCandidate[]> = {
        [planned[0]!.request.subjectSlug]: candidates,
      };
      return await assembleAndCreate(ctx, {
        userId,
        mode: args.mode,
        blueprintId: bp.id,
        blueprintVersion: bp.version,
        stream,
        title,
        seed: `${userId}:${args.mode}:${now}:${Math.floor(Math.random() * 1e9)}`,
        planned: planned.map((p) => p.request),
        candidatesBySubject,
        exclude,
        reduced,
        subjectId: sessionSubjectId,
        contentId,
        bankVersion,
        now,
      });
    }

    // Subject-keyed assembly for the other three modes.
    const candidatesBySubject: Record<string, VaultCandidate[]> = {};
    for (const p of planned) {
      if (candidatesBySubject[p.request.subjectSlug]) continue;
      candidatesBySubject[p.request.subjectSlug] = (
        await poolForSubject(ctx, p.request.subjectId as Id<"subjects">, premiumAllowed)
      ).map((c) => ({ ...c, subjectSlug: p.request.subjectSlug }));
    }

    return await assembleAndCreate(ctx, {
      userId,
      mode: args.mode,
      blueprintId: bp.id,
      blueprintVersion: bp.version,
      stream,
      title,
      seed: `${userId}:${args.mode}:${now}:${Math.floor(Math.random() * 1e9)}`,
      planned: planned.map((p) => p.request),
      candidatesBySubject,
      exclude,
      reduced,
      subjectId: sessionSubjectId,
      contentId,
      bankVersion,
      now,
    });
  },
});

/** Shared assembly + atomic creation (session CREATED → ACTIVE + snapshots). */
async function assembleAndCreate(
  ctx: any,
  input: {
    userId: Id<"users">;
    mode: MatricMode;
    blueprintId: string;
    blueprintVersion: number;
    stream: Stream;
    title: string;
    seed: string;
    planned: SectionRequest[];
    candidatesBySubject: Record<string, VaultCandidate[]>;
    exclude: ReadonlySet<string>;
    reduced: boolean;
    subjectId?: Id<"subjects">;
    contentId?: Id<"contentItems">;
    bankVersion: number;
    now: number;
  },
) {
  const bp = getBlueprintByMode(input.mode);
  const plan = assembleExam({
    seed: input.seed,
    sections: input.planned,
    candidatesBySubject: input.candidatesBySubject,
    excludeFingerprints: input.exclude,
  });

  if (plan.totalQuestions === 0) {
    throw err("insufficient_coverage", "No verified questions are available for this exam yet.");
  }
  // Defensive honesty check: every section must still clear the floor after
  // real assembly (stats races, vanished rows).
  for (const sec of plan.sections) {
    if (sec.picked.length < bp.minQuestionsPerSection) {
      throw err(
        "insufficient_coverage",
        `Not enough verified questions for ${sec.request.subjectName} (${sec.picked.length} available, need ${bp.minQuestionsPerSection}).`,
      );
    }
  }

  const totalSeconds = input.planned.reduce((n, s) => n + s.timeAllottedSeconds, 0);
  const sessionId = await ctx.db.insert("matricSessions", {
    userId: input.userId,
    mode: input.mode,
    blueprintId: input.blueprintId,
    blueprintVersion: input.blueprintVersion,
    stream: input.stream,
    subjectId: input.subjectId,
    contentId: input.contentId,
    title: input.title,
    status: "CREATED",
    seed: input.seed,
    bankVersion: input.bankVersion,
    questionCount: plan.totalQuestions,
    sectionCount: plan.sections.length,
    questionFingerprints: plan.sections.flatMap((s) => s.picked.map((p) => p.fingerprint)),
    startedAt: input.now,
    deadlineAt: input.now + totalSeconds * 1000, // provisional; finalized on activation
    lastActiveAt: input.now,
    reducedPractice: input.reduced || undefined,
  });

  for (const sec of plan.sections) {
    const questions = await snapshotQuestions(ctx, sec.picked);
    await ctx.db.insert("matricSections", {
      sessionId,
      sectionIndex: plan.sections.indexOf(sec),
      subjectId: sec.request.subjectId as Id<"subjects">,
      subjectSlug: sec.request.subjectSlug,
      subjectName: sec.request.subjectName,
      title: sectionTitle(sec.request.subjectName, plan.sections.indexOf(sec), plan.sections.length),
      timeAllottedSeconds: sec.request.timeAllottedSeconds,
      questions,
      answers: questions.map(() => -1),
      flagged: questions.map(() => false),
      timeSpentSeconds: 0,
      status: "in_progress",
    });
  }

  // CREATED → ACTIVE in the same transaction (atomic creation).
  await ctx.db.patch(sessionId, {
    status: "ACTIVE",
    activatedAt: input.now,
    deadlineAt: input.now + totalSeconds * 1000,
    lastActiveAt: input.now,
  });

  return {
    sessionId,
    title: input.title,
    questionCount: plan.totalQuestions,
    sectionCount: plan.sections.length,
    deadlineAt: input.now + totalSeconds * 1000,
    reducedPractice: input.reduced || false,
  };
}

// ── Player reads (sanitized) ──────────────────────────────────────────

/** Active session summary for the Resume banner / hub. */
export const getActiveSession = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const session = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "ACTIVE"))
      .first();
    if (!session) return null;
    return {
      sessionId: session._id,
      mode: session.mode,
      title: session.title,
      questionCount: session.questionCount,
      sectionCount: session.sectionCount,
      activatedAt: session.activatedAt,
      deadlineAt: session.deadlineAt,
      reducedPractice: session.reducedPractice ?? false,
      serverNow: Date.now(),
    };
  },
});

/** The full player payload. Answers and explanations are STRIPPED — the
 *  client can never see the key before the session is GRADED. */
export const getPlayerSession = query({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw err("unauthorized", "Sign in required.");
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) throw err("not_found", "Exam not found.");
    if (session.status !== "ACTIVE") {
      throw err("not_active", `This exam is ${session.status.toLowerCase()}.`);
    }
    const sections: {
      sectionIndex: number;
      subjectSlug: string;
      subjectName: string;
      title: string;
      timeAllottedSeconds: number;
      status: string;
      questions: Array<{
        questionId: Id<"matricQuestions">;
        number: number;
        stem: string;
        passage?: string;
        options: { label: string; text: string }[];
        topicText?: string;
        sourceType: "past_paper" | "seed_practice";
        sourceName?: string;
        examYear?: number;
      }>;
      answers: number[];
      flagged: boolean[];
      timeMs?: number[];
      timeSpentSeconds: number;
    }[] = [];

    for await (const sec of ctx.db
      .query("matricSections")
      .withIndex("by_session_index", (q) => q.eq("sessionId", sessionId))
      .order("asc")) {
      sections.push({
        sectionIndex: sec.sectionIndex,
        subjectSlug: sec.subjectSlug,
        subjectName: sec.subjectName,
        title: sec.title,
        timeAllottedSeconds: sec.timeAllottedSeconds,
        status: sec.status,
        questions: sec.questions.map((q) => ({
          questionId: q.questionId,
          number: q.number,
          stem: q.stem,
          passage: q.passage,
          options: q.options,
          topicText: q.topicText,
          sourceType: q.sourceType,
          sourceName: q.sourceName,
          examYear: q.examYear,
        })),
        answers: sec.answers,
        flagged: sec.flagged,
        timeMs: sec.timeMs,
        timeSpentSeconds: sec.timeSpentSeconds,
      });
    }

    return {
      sessionId: session._id,
      mode: session.mode,
      title: session.title,
      status: session.status,
      sectionCount: session.sectionCount,
      questionCount: session.questionCount,
      activatedAt: session.activatedAt,
      deadlineAt: session.deadlineAt,
      reducedPractice: session.reducedPractice ?? false,
      sections,
      serverNow: Date.now(),
    };
  },
});

// ── Answer saving (idempotent, absolute state) ────────────────────────

export const saveProgress = mutation({
  args: {
    sessionId: v.id("matricSessions"),
    sectionIndex: v.number(),
    answers: v.array(v.number()),
    flagged: v.array(v.boolean()),
    timeSpentSeconds: v.number(),
    timeMs: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw err("unauthorized", "Sign in required.");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw err("not_found", "Exam not found.");
    if (session.status !== "ACTIVE") return { saved: false, reason: "not_active" };
    const sec = await ctx.db
      .query("matricSections")
      .withIndex("by_session_index", (q) =>
        q.eq("sessionId", args.sessionId).eq("sectionIndex", args.sectionIndex),
      )
      .unique();
    if (!sec) throw err("not_found", "Section not found.");
    if (sec.status === "submitted") return { saved: false, reason: "already_submitted" };

    const n = sec.questions.length;
    const answers = args.answers.slice(0, n).map((a) => (Number.isInteger(a) && a >= -1 && a < 8 ? a : -1));
    while (answers.length < n) answers.push(-1);
    const flagged = args.flagged.slice(0, n).map(Boolean);
    while (flagged.length < n) flagged.push(false);
    const timeSpent = Math.max(0, Math.min(args.timeSpentSeconds, sec.timeAllottedSeconds * 3));
    const timeMs =
      args.timeMs && args.timeMs.length > 0
        ? args.timeMs.slice(0, n).map((t) => (Number.isFinite(t) && t > 0 ? Math.min(t, 30 * 60 * 1000) : 0))
        : undefined;

    await ctx.db.patch(sec._id, {
      answers,
      flagged,
      timeSpentSeconds: timeSpent,
      timeMs: timeMs ?? sec.timeMs,
      savedAt: Date.now(),
    });
    await ctx.db.patch(args.sessionId, { lastActiveAt: Date.now() });
    return { saved: true };
  },
});

// ── Scoring (Phase 6 — server-side only) ──────────────────────────────

function scoreSection(sec: Doc<"matricSections">) {
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;
  for (let i = 0; i < sec.questions.length; i++) {
    const a = sec.answers[i] ?? -1;
    if (a < 0) {
      unanswered++;
      continue;
    }
    const picked = sec.questions[i]!.options[a]?.label;
    if (picked && picked === sec.questions[i]!.answer) correct++;
    else incorrect++;
  }
  const total = sec.questions.length;
  return {
    correct,
    incorrect,
    unanswered,
    total,
    score: total > 0 ? Math.round((correct / total) * 100) : 0,
  };
}

/** Submit one section. Applies the final answer arrays, scores against the
 *  snapshot key, and (when the last section closes) grades the whole exam.
 *  Idempotent: submitting an already-submitted section is a no-op. */
export const submitSection = mutation({
  args: {
    sessionId: v.id("matricSessions"),
    sectionIndex: v.number(),
    answers: v.optional(v.array(v.number())),
    flagged: v.optional(v.array(v.boolean())),
    timeSpentSeconds: v.optional(v.number()),
    timeMs: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw err("unauthorized", "Sign in required.");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw err("not_found", "Exam not found.");
    if (session.status === "GRADED") return { graded: true, alreadyDone: true };
    if (session.status !== "ACTIVE" && session.status !== "SUBMITTED") {
      throw err("not_active", `This exam is ${session.status.toLowerCase()}.`);
    }
    const sec = await ctx.db
      .query("matricSections")
      .withIndex("by_session_index", (q) =>
        q.eq("sessionId", args.sessionId).eq("sectionIndex", args.sectionIndex),
      )
      .unique();
    if (!sec) throw err("not_found", "Section not found.");
    if (sec.status === "submitted") {
      // Already submitted earlier in this flow — session grading status was
      // checked above, so report not-graded and let the client move on.
      return { graded: false, alreadyDone: true };
    }

    const n = sec.questions.length;
    if (args.answers) {
      const answers = args.answers.slice(0, n).map((a) => (Number.isInteger(a) && a >= -1 && a < 8 ? a : -1));
      while (answers.length < n) answers.push(-1);
      sec.answers = answers;
    }
    if (args.flagged) {
      const flagged = args.flagged.slice(0, n).map(Boolean);
      while (flagged.length < n) flagged.push(false);
      sec.flagged = flagged;
    }
    if (args.timeMs) {
      sec.timeMs = args.timeMs.slice(0, n).map((t) => (Number.isFinite(t) && t > 0 ? Math.min(t, 30 * 60 * 1000) : 0));
    }
    const spent = Math.max(
      0,
      Math.min(args.timeSpentSeconds ?? sec.timeSpentSeconds, sec.timeAllottedSeconds * 3),
    );
    const result = scoreSection({ ...sec, timeSpentSeconds: spent });
    await ctx.db.patch(sec._id, {
      answers: sec.answers,
      flagged: sec.flagged,
      timeMs: sec.timeMs,
      timeSpentSeconds: spent,
      status: "submitted",
      submittedAt: Date.now(),
      score: result.score,
      correctCount: result.correct,
      incorrectCount: result.incorrect,
      unansweredCount: result.unanswered,
    });

    // Last section? → SUBMITTED → GRADED + side effects.
    const remaining = await ctx.db
      .query("matricSections")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const open = remaining.filter((s) => s.status !== "submitted");
    if (open.length === 0) {
      await ctx.db.patch(args.sessionId, { status: "SUBMITTED", submittedAt: Date.now(), lastActiveAt: Date.now() });
      const graded = await gradeSessionInternal(ctx, args.sessionId);
      await finalizeSideEffects(ctx, args.sessionId);
      return { graded: true, alreadyDone: false, result: graded.result };
    }
    await ctx.db.patch(args.sessionId, { lastActiveAt: Date.now() });
    return { graded: false, alreadyDone: false };
  },
});

/** Submit the WHOLE exam now (student "Finish Exam" or timeout): any
 *  in-progress sections are graded from their saved answer state. */
export const submitSession = mutation({
  args: {
    sessionId: v.id("matricSessions"),
    reason: v.optional(v.union(v.literal("student"), v.literal("timeout"))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw err("unauthorized", "Sign in required.");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw err("not_found", "Exam not found.");
    if (session.status === "GRADED") {
      return { graded: true, alreadyDone: true, result: session.result ?? undefined };
    }
    if (session.status !== "ACTIVE" && session.status !== "SUBMITTED") {
      throw err("not_active", `This exam is ${session.status.toLowerCase()}.`);
    }
    await autoSubmitSections(ctx, args.sessionId);
    await ctx.db.patch(args.sessionId, {
      status: "SUBMITTED",
      submittedAt: Date.now(),
      lastActiveAt: Date.now(),
    });
    const graded = await gradeSessionInternal(ctx, args.sessionId);
    await finalizeSideEffects(ctx, args.sessionId);
    return { graded: true, alreadyDone: false, result: graded.result };
  },
});

async function autoSubmitSections(ctx: any, sessionId: Id<"matricSessions">) {
  for await (const sec of ctx.db
    .query("matricSections")
    .withIndex("by_session", (q: any) => q.eq("sessionId", sessionId))) {
    if (sec.status === "submitted") continue;
    const result = scoreSection(sec);
    await ctx.db.patch(sec._id, {
      status: "submitted",
      submittedAt: Date.now(),
      score: result.score,
      correctCount: result.correct,
      incorrectCount: result.incorrect,
      unansweredCount: result.unanswered,
      timeMs: sec.timeMs,
    });
  }
}

/** Exactly-once side effects: Mistake Lab + mastery ingestion, XP, study
 *  time. Each guard is a timestamp written in the same mutation that runs
 *  the effect — retries and double-grading can never duplicate them. */
async function finalizeSideEffects(ctx: any, sessionId: Id<"matricSessions">) {
  const session = await ctx.db.get(sessionId);
  if (!session) return;
  const now = Date.now();

  if (!session.ingestedAt) {
    const sections: Doc<"matricSections">[] = [];
    for await (const sec of ctx.db
      .query("matricSections")
      .withIndex("by_session_index", (q: any) => q.eq("sessionId", sessionId))) {
      sections.push(sec);
    }
    sections.sort((a, b) => a.sectionIndex - b.sectionIndex);
    for (const sec of sections) {
      const outcomes = sec.questions.map((q, i) => {
        const a = sec.answers[i] ?? -1;
        const studentLabel = a >= 0 ? q.options[a]?.label : undefined;
        const correctLabel = q.answer;
        const correct = !!studentLabel && studentLabel === correctLabel;
        const correctText = q.options.find((o) => o.label === correctLabel)?.text ?? correctLabel;
        const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
        return {
          questionKey: `q${q.number}`,
          questionText: clamp(q.stem, 1200),
          options: q.options.map((o) => clamp(o.text, 300)).slice(0, 6),
          correctAnswer: clamp(correctText, 300),
          studentAnswer: studentLabel
            ? clamp(q.options.find((o) => o.label === studentLabel)?.text ?? studentLabel, 300)
            : undefined,
          explanation: q.explanation ? clamp(q.explanation, 800) : undefined,
          topicText: q.topicText ? clamp(q.topicText, 200) : undefined,
          contentId: q.contentId,
          sourcePage: q.sourcePage,
          origin: q.sourceType === "past_paper" ? ("official" as const) : ("practice" as const),
          correct,
        };
      });
      if (outcomes.length > 0) {
        await ctx.runMutation(internalLearningIngest, {
          subjectId: sec.subjectId,
          source: "mock_exam",
          sourceRefId: sessionId,
          outcomes,
        });
      }
    }
    await ctx.db.patch(sessionId, { ingestedAt: now });
  }

  if (!session.xpAwardedAt) {
    const correct = session.result?.totalCorrect ?? 0;
    await ctx.runMutation(internalAwardXp, {
      userId: session.userId,
      amount: XP_VALUES.mock_exam_complete_base + Math.min(correct, 60),
      reason: "mock_exam_complete",
    });
    await ctx.db.patch(sessionId, { xpAwardedAt: now });
  }

  if (!session.sessionLoggedAt) {
    const totalSeconds = session.result?.timeSpentSeconds ?? 0;
    if (totalSeconds >= 60 && session.activatedAt) {
      // One synthetic study session for the sitting (dominant subject),
      // matching the legacy mock exam behavior.
      const sections: Doc<"matricSections">[] = [];
      for await (const sec of ctx.db
        .query("matricSections")
        .withIndex("by_session_index", (q: any) => q.eq("sessionId", sessionId))) {
        sections.push(sec);
      }
      const dominant = sections.sort((a, b) => b.questions.length - a.questions.length)[0];
      const endedAt = session.submittedAt ?? now;
      await ctx.runMutation(internalLogSession, {
        subjectId: (dominant ?? sections[0])?.subjectId ?? session.subjectId!,
        durationSeconds: Math.min(totalSeconds, Math.max(1, Math.round((endedAt - session.activatedAt) / 1000))),
        startedAt: session.activatedAt,
        endedAt,
        localDate: new Date(endedAt).toISOString().slice(0, 10),
      });
    }
    await ctx.db.patch(sessionId, { sessionLoggedAt: now });
  }
}

// Internal function references for exactly-once side effects.
const internalLearningIngest = internal.learning.ingestQuestionOutcomes;
const internalAwardXp = internal.xp.awardXp;
const internalLogSession = internal.studySessions.logSessionInternal;

// ── Abandon & expiry ──────────────────────────────────────────────────

export const abandonSession = mutation({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw err("unauthorized", "Sign in required.");
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) throw err("not_found", "Exam not found.");
    if (session.status !== "ACTIVE" && session.status !== "CREATED") {
      throw err("not_active", `This exam is already ${session.status.toLowerCase()}.`);
    }
    await ctx.db.patch(sessionId, {
      status: "INVALIDATED",
      invalidationReason: "abandoned_by_student",
      lastActiveAt: Date.now(),
    });
    return { ok: true };
  },
});

/** Cron: expire overdue sessions. ACTIVE sessions past deadline+grace are
 *  auto-submitted from their SAVED answers (student work is never lost) and
 *  graded; interrupted CREATED rows are invalidated. Bounded per tick. */
export const expireStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let processed = 0;

    // 1) Expired ACTIVE sessions → auto-submit + grade.
    const expired = await ctx.db
      .query("matricSessions")
      .withIndex("by_status_deadline", (q) =>
        q.eq("status", "ACTIVE").lt("deadlineAt", now - EXPIRY_GRACE_MS),
      )
      .take(5);
    for (const session of expired) {
      await autoSubmitSections(ctx, session._id);
      await ctx.db.patch(session._id, {
        status: "SUBMITTED",
        submittedAt: now,
        expiryHandledAt: now,
      });
      await gradeSessionInternal(ctx, session._id);
      await finalizeSideEffects(ctx, session._id);
      processed++;
    }

    // 2) Interrupted CREATED sessions → invalidate.
    const staleCreated = await ctx.db
      .query("matricSessions")
      .withIndex("by_status_deadline", (q) => q.eq("status", "CREATED").lt("deadlineAt", now - CREATED_TIMEOUT_MS))
      .take(10);
    for (const session of staleCreated) {
      await ctx.db.patch(session._id, {
        status: "INVALIDATED",
        invalidationReason: "creation_interrupted",
        expiryHandledAt: now,
      });
      processed++;
    }
    return { processed };
  },
});

// ── Results (Phase 7) ─────────────────────────────────────────────────

/** Full graded results + question-by-question review + history. */
export const getSessionResults = query({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, { sessionId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw err("unauthorized", "Sign in required.");
    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== userId) throw err("not_found", "Exam not found.");
    if (session.status !== "GRADED" || !session.result) {
      return { graded: false as const, status: session.status };
    }

    const review: {
      sectionIndex: number;
      subjectName: string;
      subjectSlug: string;
      items: Array<{
        number: number;
        stem: string;
        passage?: string;
        options: { label: string; text: string }[];
        studentLabel?: string;
        correctLabel: string;
        correct: boolean;
        unanswered: boolean;
        explanation?: string;
        topicText?: string;
        sourceName?: string;
        sourcePage?: number;
        contentId?: Id<"contentItems">;
        examYear?: number;
        flagged: boolean;
        timeMs?: number;
      }>;
    }[] = [];

    for await (const sec of ctx.db
      .query("matricSections")
      .withIndex("by_session_index", (q) => q.eq("sessionId", sessionId))
      .order("asc")) {
      review.push({
        sectionIndex: sec.sectionIndex,
        subjectName: sec.subjectName,
        subjectSlug: sec.subjectSlug,
        items: sec.questions.map((q, i) => {
          const a = sec.answers[i] ?? -1;
          const studentLabel = a >= 0 ? q.options[a]?.label : undefined;
          return {
            number: q.number,
            stem: q.stem,
            passage: q.passage,
            options: q.options,
            studentLabel,
            correctLabel: q.answer,
            correct: !!studentLabel && studentLabel === q.answer,
            unanswered: a < 0,
            explanation: q.explanation,
            topicText: q.topicText,
            sourceName: q.sourceName,
            sourcePage: q.sourcePage,
            contentId: q.contentId,
            examYear: q.examYear,
            flagged: sec.flagged[i] ?? false,
            timeMs: sec.timeMs?.[i],
          };
        }),
      });
    }

    // Historical comparison: previous graded sessions of the same mode.
    const history: { sessionId: Id<"matricSessions">; title: string; totalScore: number; startedAt: number }[] = [];
    const past = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "GRADED"))
      .order("desc")
      .take(8);
    for (const s of past) {
      if (s._id === sessionId || !s.result) continue;
      if (s.mode !== session.mode) continue;
      history.push({ sessionId: s._id, title: s.title, totalScore: s.result.totalScore, startedAt: s.startedAt });
      if (history.length >= 5) break;
    }

    return {
      graded: true as const,
      status: session.status,
      session: {
        sessionId: session._id,
        mode: session.mode,
        title: session.title,
        blueprintId: session.blueprintId,
        blueprintVersion: session.blueprintVersion,
        bankVersion: session.bankVersion,
        reducedPractice: session.reducedPractice ?? false,
        startedAt: session.startedAt,
        submittedAt: session.submittedAt,
        gradedAt: session.gradedAt,
        resultVersion: session.resultVersion ?? 1,
      },
      result: session.result,
      review,
      history,
      serverNow: Date.now(),
    };
  },
});

/** Session history list for the hub. */
export const getHistory = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(limit ?? 12, 30));
    return rows.map((s) => ({
      sessionId: s._id,
      mode: s.mode,
      title: s.title,
      status: s.status,
      questionCount: s.questionCount,
      startedAt: s.startedAt,
      gradedAt: s.gradedAt,
      totalScore: s.result?.totalScore,
      reducedPractice: s.reducedPractice ?? false,
      invalidationReason: s.invalidationReason,
    }));
  },
});
