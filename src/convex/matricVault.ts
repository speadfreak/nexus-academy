// MATRIC OS — Canonical Question Vault (Phases 1 & 8).
//
// Owns everything about the question bank itself:
//   - syncVaultBatch: idempotent import from digitalPapers (real past papers
//     parsed deterministically by examParser + admin verification state).
//   - seedStarterBank: idempotent import of the curated Learnyx practice
//     bank (matricSeedBank.ts) so the engine works before papers are synced.
//   - recomputeStats / getVaultStats: one small aggregated stats doc powers
//     mode-eligibility checks and the UI coverage meters.
//   - Admin operations (overview, OS flag, invalidate, regrade) with audit
//     logging, all behind requireAdmin*.
//
// IMPORT RULES (Phase 1):
//   - Only gradable MCQs WITH a parseable answer key enter the vault.
//   - verificationStatus is INHERITED from the source's real verification
//     state (admin-accepted paper) — never assumed.
//   - Provenance (contentId + questionNumber, sourceName, page, year) is
//     preserved on every row.
//   - Re-syncing a paper REPLACES its vault rows (delete + reinsert), so
//     admin answer-key fixes propagate; sessions are unaffected because
//     they embed immutable snapshots.

import { v, ConvexError } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAdminMutation, isAdmin, type UserDoc } from "./admin";
import { SEED_BANK } from "./matricSeedBank";
import { STREAMS } from "./constants";

const VAULT_VERSION = 2; // pipeline version — bump when import rules change
const SYNC_BATCH_PAPERS = 5; // papers per admin sync batch (paper docs are big)
const OS_FLAG_KEY = "MATRIC_OS_ENABLED";
const SYNC_CURSOR_KEY = "matric_sync_cursor";

// Subject stream for seed-bank subjects that may not exist yet.
const SEED_SUBJECT_STREAMS: Record<string, "natural" | "social" | "common"> = {
  english: "common",
  mathematics: "common",
  "scholastic-aptitude-test": "common",
  physics: "natural",
  chemistry: "natural",
  biology: "natural",
  history: "social",
  geography: "social",
  economics: "social",
};

const SEED_SUBJECT_NAMES: Record<string, string> = {
  english: "English",
  mathematics: "Mathematics",
  "scholastic-aptitude-test": "Scholastic Aptitude Test",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
  history: "History",
  geography: "Geography",
  economics: "Economics",
};

// ── Admin gate for queries (read-only, no bootstrap writes) ──────────

async function requireAdminReadQuery(ctx: GenericQueryCtx<any>): Promise<UserDoc> {
  const userId = await getAuthUserId(ctx);
  const user = userId ? ((await ctx.db.get(userId)) as UserDoc | null) : null;
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  return user;
}

// ── OS feature flag ───────────────────────────────────────────────────

/** Matric OS route flag. Defaults ON — the whole point of the rebuild.
 *  Admins can flip it off to fall back to the legacy AI engine. */
export const getOsEnabled = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", OS_FLAG_KEY))
      .unique();
    if (!row) return true;
    return row.value !== "false";
  },
});

export const setOsEnabled = mutation({
  args: { enabled: v.boolean() },
  handler: async (ctx, { enabled }) => {
    const { user } = await requireAdminMutation(ctx);
    const existing = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", OS_FLAG_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: enabled ? "true" : "false",
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    } else {
      await ctx.db.insert("configKeys", {
        key: OS_FLAG_KEY,
        value: enabled ? "true" : "false",
        updatedAt: Date.now(),
        updatedBy: user._id,
      });
    }
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.os_flag_changed",
      targetType: "system",
      targetId: OS_FLAG_KEY,
      details: JSON.stringify({ enabled }),
      createdAt: Date.now(),
    });
  },
});

// ── Stats reads ───────────────────────────────────────────────────────

/** Aggregated coverage, safe for any signed-in user (no question content). */
export const getVaultStats = query({
  args: {},
  handler: async (ctx) => {
    const stats = await ctx.db
      .query("matricStats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();
    if (!stats) {
      return { bankVersion: 0, perSubject: {}, papers: {}, totalVerified: 0, updatedAt: 0 };
    }
    return {
      bankVersion: stats.bankVersion,
      perSubject: stats.perSubject,
      papers: stats.papers,
      totalVerified: stats.totalVerified,
      updatedAt: stats.updatedAt,
    };
  },
});

// ── Seed starter bank ─────────────────────────────────────────────────

/** Idempotent import of the curated practice bank. Admin-triggered (also
 *  callable from the Matric admin panel); safe to run repeatedly. */
export const seedStarterBank = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireAdminMutation(ctx);

    // Resolve (or lazily create) subjects for the seed slugs.
    const subjectIds = new Map<string, Id<"subjects">>();
    for (const slug of Object.keys(SEED_SUBJECT_STREAMS)) {
      let subject: Doc<"subjects"> | null = await ctx.db
        .query("subjects")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!subject) {
        const stream = SEED_SUBJECT_STREAMS[slug];
        if (!stream || !STREAMS.includes(stream)) continue;
        const id = await ctx.db.insert("subjects", {
          name: SEED_SUBJECT_NAMES[slug] ?? slug,
          stream,
          slug,
        });
        subject = await ctx.db.get(id);
      }
      if (subject) subjectIds.set(slug, subject._id);
    }

    let imported = 0;
    let updated = 0;
    for (const q of SEED_BANK) {
      const subjectId = subjectIds.get(q.subjectSlug);
      if (!subjectId) continue; // unknown subject slug — skip honestly
      const fingerprint = `seed:${q.id}`;
      const options = q.options.map((text, i) => ({
        label: String.fromCharCode(65 + i),
        text,
      }));
      const existing = await ctx.db
        .query("matricQuestions")
        .withIndex("by_fingerprint", (f) => f.eq("fingerprint", fingerprint))
        .unique();
      const row = {
        fingerprint,
        sourceType: "seed_practice" as const,
        questionNumber: 0,
        sourceName: "Learnyx Verified Starter Bank",
        subjectId,
        stream: SEED_SUBJECT_STREAMS[q.subjectSlug] as "natural" | "social" | "common",
        topicText: q.topic,
        stem: q.stem,
        passage: q.passage,
        options,
        answer: q.answer,
        explanation: q.explanation,
        verificationStatus: "verified" as const, // human-verified at authoring time
        accessPolicy: "free" as const,
        activeStatus: true,
        contentVersion: 1,
        vaultVersion: VAULT_VERSION,
      };
      if (existing) {
        await ctx.db.replace(existing._id, row);
        updated++;
      } else {
        await ctx.db.insert("matricQuestions", row);
        imported++;
      }
    }
    await bumpBankVersionAndRecompute(ctx);
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.seed_bank_imported",
      targetType: "vault",
      details: JSON.stringify({ imported, updated }),
      createdAt: Date.now(),
    });
    return { imported, updated };
  },
});

// ── Past-paper sync (batched, idempotent) ─────────────────────────────

/** Sync ONE past paper into the vault. Shared by the admin batch mutation
 *  and the daily cron tick. Returns the registry entry (or null when the
 *  paper isn't usable). Idempotent: replaces the paper's rows. */
async function syncPaperInternal(
  ctx: MutationCtx,
  item: Doc<"contentItems">,
): Promise<{ gradableCount: number; registry: Record<string, Doc<"matricStats">["papers"][string]> }> {
  const paper = await ctx.db
    .query("digitalPapers")
    .withIndex("by_content", (q) => q.eq("contentId", item._id))
    .unique();
  const empty = { gradableCount: 0, registry: {} as Record<string, Doc<"matricStats">["papers"][string]> };
  if (!paper || paper.status !== "ready") return empty;
  if (!item.subjectId) return empty;

  const subject: Doc<"subjects"> | null = await ctx.db.get(item.subjectId);
  if (!subject) return empty;

  // Replace-by-content: delete existing rows then reinsert the current
  // question set. Sessions never re-read the vault (snapshots), so this is
  // safe and keeps admin answer-key fixes propagating.
  for await (const old of ctx.db
    .query("matricQuestions")
    .withIndex("by_content", (q) => q.eq("contentId", item._id))) {
    await ctx.db.delete(old._id);
  }

  const verifiedPaper =
    paper.reviewStatus === "accepted" ||
    (paper.verification === ("verified" as const) && paper.reviewStatus !== "pdf_only");
  const paperExcluded =
    (paper.verification as string) === "rejected" || paper.reviewStatus === "pdf_only";

  let gradable = 0;
  if (!paperExcluded) {
    for (const q of paper.questions) {
      const kind = q.kind ?? "mcq";
      if (kind !== "mcq") continue; // structured items are not auto-gradable
      if (!q.answer || !/^[A-H]$/.test(q.answer)) continue; // keyless — excluded
      const hasLabel = q.options.some((o) => o.label === q.answer);
      if (!hasLabel) continue; // ambiguous key — excluded (Phase 1 rule)
      await ctx.db.insert("matricQuestions", {
        fingerprint: `paper:${item._id}:${q.number}`,
        sourceType: "past_paper",
        contentId: item._id,
        questionNumber: q.number,
        sourceName: item.title,
        sourcePage: q.sourcePage,
        examYear: item.examYear,
        subjectId: item.subjectId,
        stream: subject.stream,
        topicText: q.topic,
        stem: q.text,
        passage: q.passage,
        options: q.options.map((o) => ({ label: o.label, text: o.text })),
        answer: q.answer,
        explanation: q.explanation,
        verificationStatus: verifiedPaper ? "verified" : "unverified",
        accessPolicy: item.isPremium ? "premium" : "free",
        activeStatus: true,
        contentVersion: paper.updatedAt ?? paper.createdAt ?? Date.now(),
        vaultVersion: VAULT_VERSION,
      });
      gradable++;
    }
  }

  const registryEntry = {
    contentId: item._id,
    title: item.title,
    subjectId: item.subjectId,
    subjectSlug: subject.slug,
    examYear: item.examYear,
    gradableCount: gradable,
    premium: !!item.isPremium,
    durationMinutes: item.durationMinutes,
    verificationStatus: verifiedPaper ? ("verified" as const) : ("unverified" as const),
  };
  return { gradableCount: gradable, registry: { [item._id]: registryEntry } };
}

/** Admin-triggered sync of up to SYNC_BATCH_PAPERS papers. Walks a cursor
 *  over contentItems(contentType="past_exam") so repeated calls cover the
 *  whole library; the admin UI loops until `done`. */
export const syncVaultBatch = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireAdminMutation(ctx);

    const items: Doc<"contentItems">[] = [];
    for await (const item of ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))) {
      items.push(item);
    }

    const cursorRow = await ctx.db
      .query("engineState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_CURSOR_KEY))
      .unique();
    let cursor = cursorRow?.value ?? 0;
    if (cursor > items.length) cursor = 0; // library shrank — restart

    const batch = items.slice(cursor, cursor + SYNC_BATCH_PAPERS);
    let registry: Record<string, Doc<"matricStats">["papers"][string]> = {};
    for (const item of batch) {
      const out = await syncPaperInternal(ctx, item);
      registry = { ...registry, ...out.registry };
    }

    const newCursor = cursor + batch.length;
    if (cursorRow) {
      await ctx.db.patch(cursorRow._id, { value: newCursor });
    } else {
      await ctx.db.insert("engineState", { key: SYNC_CURSOR_KEY, value: newCursor });
    }

    // Merge registry + recompute per-subject stats + bump bank version.
    if (Object.keys(registry).length > 0) await mergePapersRegistry(ctx, registry);
    const bankVersion = await bumpBankVersionAndRecompute(ctx);

    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.vault_sync_batch",
      targetType: "vault",
      details: JSON.stringify({ processed: batch.length, cursor: newCursor, total: items.length }),
      createdAt: Date.now(),
    });

    return {
      processed: batch.length,
      cursor: newCursor,
      total: items.length,
      done: newCursor >= items.length,
      bankVersion,
    };
  },
});

/** Daily cron: quietly sync one paper per tick so newly converted papers
 *  enter the vault without admin action. No-op when nothing is pending. */
export const cronSyncTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find the next past-exam item whose paper was converted after our last
    // sync (tracked via cursor). Walk one item per tick.
    const items: Doc<"contentItems">[] = [];
    for await (const item of ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))) {
      items.push(item);
    }
    if (items.length === 0) return { synced: 0 };

    const cursorRow = await ctx.db
      .query("engineState")
      .withIndex("by_key", (q) => q.eq("key", SYNC_CURSOR_KEY))
      .unique();
    let cursor = cursorRow?.value ?? 0;
    if (cursor >= items.length) cursor = 0; // wrap around — keeps registry fresh

    const item = items[cursor]!;
    const out = await syncPaperInternal(ctx, item);
    const newCursor = cursor + 1;
    if (cursorRow) await ctx.db.patch(cursorRow._id, { value: newCursor });
    else await ctx.db.insert("engineState", { key: SYNC_CURSOR_KEY, value: newCursor });
    if (Object.keys(out.registry).length > 0) await mergePapersRegistry(ctx, out.registry);
    await bumpBankVersionAndRecompute(ctx);
    return { synced: 1, cursor: newCursor, total: items.length };
  },
});

// ── Internal helpers ──────────────────────────────────────────────────

async function listSubjectMap(
  ctx: MutationCtx,
): Promise<Map<Id<"subjects">, Doc<"subjects">>> {
  const map = new Map<Id<"subjects">, Doc<"subjects">>();
  for await (const s of ctx.db.query("subjects")) {
    map.set(s._id, s);
  }
  return map;
}

async function mergePapersRegistry(
  ctx: MutationCtx,
  registry: Record<string, Doc<"matricStats">["papers"][string]>,
) {
  const stats = await ctx.db
    .query("matricStats")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  if (!stats) return; // recompute creates the doc with existing papers merged
  const papers = { ...stats.papers, ...registry };
  await ctx.db.patch(stats._id, { papers });
}

interface SubjectCounter {
  subjectId: Id<"subjects">;
  stream: "natural" | "social" | "common";
  verified: number;
  verifiedFree: number;
  verifiedPremium: number;
  unverified: number;
  seedCount: number;
  paperCount: number;
  minYear?: number;
  maxYear?: number;
}

/** Full per-subject stats recompute from the vault + bankVersion bump. */
async function bumpBankVersionAndRecompute(ctx: MutationCtx): Promise<number> {
  const subjects = await listSubjectMap(ctx);
  const perSubject: Record<string, SubjectCounter> = {};
  const slugIndex = new Map<Id<"subjects">, string>();
  for (const s of subjects.values()) slugIndex.set(s._id, s.slug);

  const counters = new Map<string, SubjectCounter>();

  for await (const q of ctx.db.query("matricQuestions")) {
    const slug = slugIndex.get(q.subjectId);
    if (!slug) continue;
    let c = counters.get(slug);
    if (!c) {
      const subject = subjects.get(q.subjectId)!;
      c = {
        subjectId: q.subjectId,
        stream: subject.stream,
        verified: 0,
        verifiedFree: 0,
        verifiedPremium: 0,
        unverified: 0,
        seedCount: 0,
        paperCount: 0,
        minYear: undefined,
        maxYear: undefined,
      };
      counters.set(slug, c);
    }
    if (!q.activeStatus) continue; // retired rows stay out of coverage
    if (q.verificationStatus === "verified") {
      c.verified++;
      if (q.accessPolicy === "premium") c.verifiedPremium++;
      else c.verifiedFree++;
    } else {
      c.unverified++;
    }
    if (q.sourceType === "seed_practice") c.seedCount++;
    else c.paperCount++;
    if (typeof q.examYear === "number") {
      c.minYear = c.minYear === undefined ? q.examYear : Math.min(c.minYear, q.examYear);
      c.maxYear = c.maxYear === undefined ? q.examYear : Math.max(c.maxYear, q.examYear);
    }
  }

  let totalVerified = 0;
  for (const [slug, c] of counters.entries()) {
    perSubject[slug] = c;
    totalVerified += c.verified;
  }

  const existing = await ctx.db
    .query("matricStats")
    .withIndex("by_key", (q) => q.eq("key", "global"))
    .unique();
  const bankVersion = (existing?.bankVersion ?? 0) + 1;
  const row = {
    key: "global" as const,
    bankVersion,
    perSubject,
    papers: (existing?.papers ?? {}) as Record<string, Doc<"matricStats">["papers"][string]>,
    totalVerified,
    updatedAt: Date.now(),
  };
  if (existing) await ctx.db.replace(existing._id, row);
  else await ctx.db.insert("matricStats", row);
  return bankVersion;
}

// ── Admin operations (Phase 8) ────────────────────────────────────────

export const getAdminOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminReadQuery(ctx);
    const stats = await ctx.db
      .query("matricStats")
      .withIndex("by_key", (q) => q.eq("key", "global"))
      .unique();

    // Recent sessions for diagnostics (bounded).
    const recentSessions = await ctx.db.query("matricSessions").order("desc").take(30);
    const sessions = recentSessions.map((s) => ({
      _id: s._id,
      userId: s.userId,
      mode: s.mode,
      status: s.status,
      title: s.title,
      questionCount: s.questionCount,
      startedAt: s.startedAt,
      deadlineAt: s.deadlineAt,
      submittedAt: s.submittedAt,
      gradedAt: s.gradedAt,
      totalScore: s.result?.totalScore,
      invalidationReason: s.invalidationReason,
      reducedPractice: s.reducedPractice,
    }));

    // Vault totals.
    let vaultRows = 0;
    for await (const _q of ctx.db.query("matricQuestions")) {
      void _q;
      vaultRows++;
    }

    // Counts by status for the reliability dashboard.
    const statusCounts: Record<string, number> = {};
    for await (const s of ctx.db.query("matricSessions")) {
      statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
    }

    const flagRow = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", OS_FLAG_KEY))
      .unique();

    return {
      bankVersion: stats?.bankVersion ?? 0,
      totalVerified: stats?.totalVerified ?? 0,
      vaultRows,
      perSubject: stats?.perSubject ?? {},
      papersCount: stats ? Object.keys(stats.papers).length : 0,
      sessions,
      statusCounts,
      osEnabled: flagRow ? flagRow.value !== "false" : true,
      updatedAt: stats?.updatedAt ?? 0,
    };
  },
});

export const adminInvalidateSession = mutation({
  args: { sessionId: v.id("matricSessions"), reason: v.string() },
  handler: async (ctx, { sessionId, reason }) => {
    const { user } = await requireAdminMutation(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session) throw new ConvexError("Session not found.");
    if (session.status === "GRADED" || session.status === "INVALIDATED") {
      throw new ConvexError("Session already terminal — nothing to invalidate.");
    }
    await ctx.db.patch(sessionId, { status: "INVALIDATED", invalidationReason: reason });
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.session_invalidated",
      targetType: "matricSession",
      targetId: sessionId,
      details: JSON.stringify({ reason, previousStatus: session.status }),
      createdAt: Date.now(),
    });
  },
});

/** Regrade from the immutable snapshots. Answer keys live in the section
 *  docs, so a regrade never re-reads the (mutable) vault — history stays
 *  reproducible. Writes an audit trail; bumps resultVersion. */
export const adminRegradeSession = mutation({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, { sessionId }) => {
    const { user } = await requireAdminMutation(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session) throw new ConvexError("Session not found.");
    if (session.status !== "GRADED" && session.status !== "SUBMITTED") {
      throw new ConvexError("Only submitted sessions can be regraded.");
    }
    const { result } = await gradeSessionInternal(ctx, sessionId);
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.session_regraded",
      targetType: "matricSession",
      targetId: sessionId,
      details: JSON.stringify({
        previousScore: session.result?.totalScore ?? null,
        newScore: result.totalScore,
      }),
      createdAt: Date.now(),
    });
    return result;
  },
});

/** Shared grading used by the engine and by admin regrade. Uses the
 *  MutationCtx db handle; safe to call from any mutation. */
export async function gradeSessionInternal(
  ctx: MutationCtx,
  sessionId: Id<"matricSessions">,
): Promise<{ result: NonNullable<Doc<"matricSessions">["result"]> }> {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new ConvexError("Session not found.");
  const sections: Doc<"matricSections">[] = [];
  for await (const s of ctx.db
    .query("matricSections")
    .withIndex("by_session_index", (q) => q.eq("sessionId", sessionId))) {
    sections.push(s);
  }
  sections.sort((a, b) => a.sectionIndex - b.sectionIndex);

  const sectionResults: NonNullable<Doc<"matricSessions">["result"]>["sections"] = [];
  const topicAgg = new Map<string, { subjectSlug: string; topicText: string; correct: number; total: number }>();
  let totalCorrect = 0;
  let totalIncorrect = 0;
  let totalUnanswered = 0;
  let totalQuestions = 0;
  let timeSpentSeconds = 0;

  for (const sec of sections) {
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    for (let i = 0; i < sec.questions.length; i++) {
      const q = sec.questions[i]!;
      const a = sec.answers[i] ?? -1;
      const correctLabel = q.answer;
      const studentLabel = a >= 0 ? q.options[a]?.label : undefined;
      const topicKey = (q.topicText ?? "").trim().toLowerCase();
      if (topicKey && q.topicText) {
        const key = `${sec.subjectSlug}::${topicKey}`;
        const entry =
          topicAgg.get(key) ?? { subjectSlug: sec.subjectSlug, topicText: q.topicText, correct: 0, total: 0 };
        entry.total++;
        if (studentLabel && studentLabel === correctLabel) entry.correct++;
        topicAgg.set(key, entry);
      }
      if (a < 0) unanswered++;
      else if (studentLabel === correctLabel) correct++;
      else incorrect++;
    }
    totalCorrect += correct;
    totalIncorrect += incorrect;
    totalUnanswered += unanswered;
    totalQuestions += sec.questions.length;
    timeSpentSeconds += sec.timeSpentSeconds;
    sectionResults.push({
      sectionIndex: sec.sectionIndex,
      subjectSlug: sec.subjectSlug,
      subjectName: sec.subjectName,
      score: sec.questions.length > 0 ? Math.round((correct / sec.questions.length) * 100) : 0,
      correct,
      incorrect,
      unanswered,
      total: sec.questions.length,
      timeSpentSeconds: sec.timeSpentSeconds,
    });
  }

  const result = {
    totalScore: totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0,
    totalCorrect,
    totalIncorrect,
    totalUnanswered,
    totalQuestions,
    timeSpentSeconds,
    generatedAt: Date.now(),
    sections: sectionResults,
    topics: [...topicAgg.values()].sort((a, b) => b.total - a.total),
  };

  const previousVersion = session.resultVersion ?? 0;
  await ctx.db.patch(sessionId, {
    status: "GRADED",
    gradedAt: Date.now(),
    submittedAt: session.submittedAt ?? Date.now(),
    result,
    resultVersion: previousVersion + 1,
  });
  return { result };
}

export const internalRecomputeStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await bumpBankVersionAndRecompute(ctx);
  },
});
