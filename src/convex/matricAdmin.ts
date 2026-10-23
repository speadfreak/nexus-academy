// LEARNYX MATRIC OS — Phase 8: Admin Matric Operations (Command OS section).
//
// Every function here is role-gated (moderator+ via the shared admin
// guards). Provides: vault overview, coverage, duplicate detection, import
// control + audit, session diagnostics, ingestion retries, invalidation.
// The existing per-paper QC workflow stays in examQuality.ts (Exam Engine
// tab) — this module is the vault/exam layer on top of it.

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import type { GenericQueryCtx } from "convex/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdmin, requireAdminMutation, requireAdminAction } from "./admin";
import type { ImportRunSummary } from "./matricVault";
import { computeDuplicateKey, computeContentVersion } from "./matricVault";
import { SEED_BANK, SEED_SUBJECT_STREAMS, SEED_SUBJECT_NAMES } from "./matricSeedBank";

/**
 * Read-only admin gate for QUERIES (mirrors examQuality.requireAdminRead):
 * requireAdminMutation needs a MutationCtx for bootstrap promotion —
 * queries must never write.
 */
async function requireAdminRead(ctx: GenericQueryCtx<any>): Promise<void> {
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
}

// ── Vault overview ─────────────────────────────────────────────────────────

export const adminVaultOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);
    // Bounded aggregate reads — the vault is indexed; stats read the
    // materialized coverage rows instead of scanning questions.
    const stats = await ctx.db.query("matricCoverageStats").collect();
    const subjects = await ctx.db.query("subjects").collect();
    const subjectById = new Map(subjects.map((s) => [s._id, s]));

    const perSubject = subjects
      .map((s) => {
        const stat = stats.find((x) => x.subjectId === s._id);
        return {
          subjectId: s._id,
          subjectName: s.name,
          stream: s.stream,
          eligibleCount: stat?.eligibleCount ?? 0,
          adminVerifiedCount: stat?.adminVerifiedCount ?? 0,
          paperCount: stat?.paperCount ?? 0,
          yearsCount: stat?.yearsCount ?? 0,
          statsUpdatedAt: stat?.updatedAt ?? null,
          topTopics: (() => {
            try {
              return JSON.parse(stat?.byTopicJson ?? "[]") as {
                topicText: string;
                count: number;
              }[];
            } catch {
              return [];
            }
          })(),
        };
      })
      .sort((a, b) => b.eligibleCount - a.eligibleCount);

    const totalEligible = perSubject.reduce((acc, s) => acc + s.eligibleCount, 0);
    const totalAdminVerified = perSubject.reduce((acc, s) => acc + s.adminVerifiedCount, 0);

    const runs = await ctx.db
      .query("matricImportRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .take(8);

    return {
      totalEligible,
      totalAdminVerified,
      subjectsCovered: perSubject.filter((s) => s.eligibleCount > 0).length,
      perSubject,
      recentRuns: runs.map((r) => ({
        _id: r._id,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt ?? null,
        trigger: r.trigger,
        dryRun: r.dryRun,
        status: r.status,
        papersScanned: r.papersScanned,
        imported: r.imported,
        updated: r.updated,
        skippedUnchanged: r.skippedUnchanged,
        excludedUnverified: r.excludedUnverified,
        deactivated: r.deactivated,
        papersWithoutSubject: r.papersWithoutSubject,
      })),
    };
  },
});

// ── Duplicate detection ────────────────────────────────────────────────────

export const adminDuplicateDetection = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);
    // Walk eligible vault rows grouped by content hash. Bounded scan of
    // recent rows — the vault grows with the library, so cap the audit.
    const rows = await ctx.db.query("matricQuestions").take(6000);
    const byDupe = new Map<string, { subjectId: Id<"subjects">; items: { vaultId: Id<"matricQuestions">; paperTitle: string; questionNumber: number; stem: string }[] }>();
    for (const r of rows) {
      if (!r.active || !r.duplicateKey) continue;
      const entry = byDupe.get(r.duplicateKey) ?? {
        subjectId: r.subjectId,
        items: [],
      };
      if (entry.items.length < 6) {
        entry.items.push({
          vaultId: r._id,
          paperTitle: r.paperTitle,
          questionNumber: r.questionNumber,
          stem: r.stem.slice(0, 120),
        });
      }
      byDupe.set(r.duplicateKey, entry);
    }
    const groups = [...byDupe.entries()]
      .filter(([, v]) => v.items.length > 1)
      .slice(0, 40)
      .map(([key, v]) => ({ duplicateKey: key, count: v.items.length, items: v.items }));
    return { scanned: rows.length, duplicateGroups: groups };
  },
});

// ── Session diagnostics ────────────────────────────────────────────────────

export const adminSessionDiagnostics = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);
    const sessions = await ctx.db
      .query("matricSessions")
      .withIndex("by_user_startedAt")
      .order("desc")
      .take(60);
    const counts = { active: 0, submitted: 0, graded: 0, expired: 0, invalidated: 0 };
    const ingestIssues: {
      sessionId: Id<"matricSessions">;
      ingestState: string;
      ingestError: string | null;
      attempts: number;
      status: string;
      title: string;
    }[] = [];
    const rows = sessions.map((s) => {
      if (s.status in counts) counts[s.status as keyof typeof counts]++;
      if (
        (s.ingestState === "failed" || s.ingestState === "pending") &&
        s.status === "graded" &&
        ingestIssues.length < 12
      ) {
        ingestIssues.push({
          sessionId: s._id,
          ingestState: s.ingestState,
          ingestError: s.ingestError ?? null,
          attempts: s.ingestAttempts ?? 0,
          status: s.status,
          title: s.title,
        });
      }
      let audit: Record<string, unknown> | null = null;
      try {
        audit = s.gradingAuditJson ? (JSON.parse(s.gradingAuditJson) as Record<string, unknown>) : null;
      } catch {
        audit = null;
      }
      return {
        sessionId: s._id,
        title: s.title,
        mode: s.mode,
        status: s.status,
        submissionSource: s.submissionSource ?? null,
        scorePct: s.scorePct ?? null,
        questionCount: s.questionCount,
        startedAt: s.startedAt,
        gradedAt: s.gradedAt ?? null,
        ingestState: s.ingestState,
        ingestAttempts: s.ingestAttempts ?? 0,
        ingestError: s.ingestError ?? null,
        audit,
      };
    });
    return { counts, rows, ingestIssues };
  },
});

// ── Admin mutations ────────────────────────────────────────────────────────

/** Retry the learning-loop ingestion for a graded session. */
export const adminRetryIngestion = mutation({
  args: { sessionId: v.id("matricSessions") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdminMutation(ctx);
    await ctx.runMutation(internal.matricEngine.ingestMatricSessionInternal, {
      sessionId: args.sessionId,
    });
    return { ok: true as const };
  },
});

/** Invalidate an active session (support case: wrong mode, device stolen…). */
export const adminInvalidateSession = mutation({
  args: { sessionId: v.id("matricSessions"), reason: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { user } = await requireAdminMutation(ctx);
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new ConvexError({ message: "Session not found.", code: "not_found" });
    if (session.status === "graded") {
      throw new ConvexError({
        message: "Graded results are immutable. Use the exam-quality correction workflow instead.",
        code: "invalid_state",
      });
    }
    await ctx.db.patch(args.sessionId, {
      status: "invalidated",
      invalidatedReason: args.reason.slice(0, 300),
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "content_event",
      source: "matricAdmin.session_invalidated",
      status: "success",
      userId: session.userId,
      metadata: JSON.stringify({ sessionId: args.sessionId, by: user._id, reason: args.reason.slice(0, 120) }),
    });
    return { ok: true as const };
  },
});

/** Trigger a vault import (full or incremental, optionally dry-run). */
export const adminRunVaultImport = action({
  args: {
    dryRun: v.optional(v.boolean()),
    incremental: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<ImportRunSummary> => {
    const { user } = await requireAdminAction(ctx);
    const sinceMs = args.incremental
      ? Date.now() - 26 * 60 * 60 * 1000 // yesterday + overlap
      : undefined;
    const result = await ctx.runAction(internal.matricVault.importVault, {
      trigger: "admin",
      dryRun: args.dryRun ?? false,
      ...(sinceMs !== undefined ? { updatedSinceMs: sinceMs } : {}),
      startedBy: user._id,
    });
    return result;
  },
});

// ── Starter bank seeding (curated practice questions) ──────────────────────
//
// The vault import materializes ONLY from real digitized papers. When no
// papers have been digitized yet, the engine would have an empty vault and
// every mode would honestly report "insufficient coverage" — correct, but
// useless to students. The curated starter bank (matricSeedBank.ts, 58
// human-authored + verified curriculum questions) solves the cold start
// WITHOUT pretending to be official ESSLCE content:
//   - bank rows carry paperTitle "Learnyx Verified Starter Bank — <Subject>"
//   - examYear stays undefined (never a real sitting year)
//   - verificationTier is "parser_verified" (deterministic key), NEVER
//     "admin_verified" (that tier is reserved for the paper QC workflow)
//
// IDEMPOTENT: subjects/contentItems/questions are upserted; safe to re-run.

const BANK_CONTENT_TYPE = "learnyx_practice_bank"; // invisible to the PDF library/Exam Prep (they list "past_exam")
const BANK_SOURCE_MARKER = "learnyx-matric-starter-bank";

export const adminSeedStarterBank = mutation({
  args: {},
  handler: async (ctx): Promise<SeedBankResult> => {
    const { user } = await requireAdminMutation(ctx);
    const now = Date.now();

    // 1. Resolve (or lazily create) the subject rows.
    const subjectsCreated: string[] = [];
    const subjectIds = new Map<string, Id<"subjects">>();
    for (const slug of Object.keys(SEED_SUBJECT_STREAMS) as (keyof typeof SEED_SUBJECT_STREAMS)[]) {
      let subject: Doc<"subjects"> | null = await ctx.db
        .query("subjects")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!subject) {
        const stream = SEED_SUBJECT_STREAMS[slug];
        const id = await ctx.db.insert("subjects", {
          name: SEED_SUBJECT_NAMES[slug as keyof typeof SEED_SUBJECT_NAMES] ?? slug,
          stream,
          slug,
        });
        subject = await ctx.db.get(id);
        subjectsCreated.push(SEED_SUBJECT_NAMES[slug as keyof typeof SEED_SUBJECT_NAMES] ?? slug);
      }
      if (subject) subjectIds.set(slug, subject._id);
    }

    // 2. Group questions per subject.
    const bySubject = new Map<string, typeof SEED_BANK>();
    for (const q of SEED_BANK) {
      const list = bySubject.get(q.subjectSlug) ?? [];
      list.push(q);
      bySubject.set(q.subjectSlug, list);
    }

    // 3. Find-or-create the per-subject bank contentItem, then upsert rows.
    let imported = 0;
    let updated = 0;
    let skippedUnchanged = 0;
    let deactivated = 0;
    const touchedSubjects: Id<"subjects">[] = [];
    const perSubject: SeedBankSubjectResult[] = [];

    for (const [slug, questions] of bySubject) {
      const subjectId = subjectIds.get(slug);
      if (!subjectId) continue; // unknown slug — skip honestly
      const subjectName = SEED_SUBJECT_NAMES[slug as keyof typeof SEED_SUBJECT_NAMES] ?? slug;

      // Find-or-create the bank "paper" (contentItem). One per subject,
      // matched by the sourceName marker within the bank content type.
      const existingItems = await ctx.db
        .query("contentItems")
        .withIndex("by_contentType", (q) => q.eq("contentType", BANK_CONTENT_TYPE))
        .collect();
      let item: Doc<"contentItems"> | undefined = existingItems.find(
        (i) => i.subjectId === subjectId && i.sourceName === BANK_SOURCE_MARKER,
      );
      let itemCreated = false;
      if (!item) {
        const itemId = await ctx.db.insert("contentItems", {
          title: `Learnyx Verified Starter Bank — ${subjectName}`,
          contentType: BANK_CONTENT_TYPE,
          grade: 12,
          subjectId,
          fileUrl: "",
          sourceName: BANK_SOURCE_MARKER,
          isPremium: false,
          examPrepSubtype: "practice_set",
          createdAt: now,
        });
        item = (await ctx.db.get(itemId)) ?? undefined;
        itemCreated = true;
      }
      if (!item) continue; // defensive — insert+get cannot normally fail

      // Upsert each question by (contentId, questionNumber).
      const existingRows = await ctx.db
        .query("matricQuestions")
        .withIndex("by_content", (q) => q.eq("contentId", item._id))
        .collect();
      const byNumber = new Map(existingRows.map((r) => [r.questionNumber, r]));

      const seenNumbers = new Set<number>();
      let sImported = 0;
      let sUpdated = 0;
      let sSkipped = 0;

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const questionNumber = i + 1;
        seenNumbers.add(questionNumber);
        const choices = q.options.map((text, idx) => ({
          label: String.fromCharCode(65 + idx),
          text,
        }));
        const contentVersion = computeContentVersion(q.stem, choices, q.answer);
        const duplicateKey = computeDuplicateKey(
          q.stem,
          choices.map((c) => c.text),
        );
        const base = {
          contentId: item._id,
          paperTitle: `Learnyx Verified Starter Bank — ${subjectName}`,
          questionNumber,
          subjectId,
          stem: q.stem,
          ...(q.passage !== undefined ? { passage: q.passage } : {}),
          choices,
          answerLabel: q.answer,
          explanation: q.explanation,
          topicText: q.topic,
          verificationTier: "parser_verified" as const,
          examEligible: true,
          duplicateKey,
          contentVersion,
          active: true,
          updatedAt: now,
        };
        const row = byNumber.get(questionNumber);
        if (!row) {
          await ctx.db.insert("matricQuestions", { ...base, importedAt: now });
          sImported++;
        } else if (row.contentVersion === contentVersion && row.active) {
          skippedUnchanged++;
          sSkipped++;
        } else {
          await ctx.db.patch(row._id, base);
          sUpdated++;
        }
      }

      // Soft-deactivate rows whose seed question disappeared.
      for (const row of existingRows) {
        if (!seenNumbers.has(row.questionNumber) && row.active) {
          await ctx.db.patch(row._id, { active: false, updatedAt: now });
          deactivated++;
        }
      }

      imported += sImported;
      updated += sUpdated;
      touchedSubjects.push(subjectId);
      perSubject.push({
        slug,
        subjectName,
        subjectCreated: subjectsCreated.includes(subjectName),
        paperCreated: itemCreated,
        imported: sImported,
        updated: sUpdated,
        skippedUnchanged: sSkipped,
      });
    }

    // 4. Refresh coverage stats for touched subjects.
    if (touchedSubjects.length > 0) {
      await ctx.runMutation(internal.matricVault.recomputeCoverage, {
        subjectIds: touchedSubjects,
      });
    }

    // 5. Audit.
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.seed_bank_imported",
      targetType: "vault",
      details: JSON.stringify({ imported, updated, skippedUnchanged, deactivated, subjectsCreated }),
      createdAt: now,
    });
    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "content_event",
      source: "matricAdmin.seedBank",
      status: "success",
      metadata: JSON.stringify({ imported, updated, skippedUnchanged, deactivated }),
    });

    return { imported, updated, skippedUnchanged, deactivated, subjectsCreated, perSubject };
  },
});

export interface SeedBankSubjectResult {
  slug: string;
  subjectName: string;
  subjectCreated: boolean;
  paperCreated: boolean;
  imported: number;
  updated: number;
  skippedUnchanged: number;
}

export interface SeedBankResult {
  imported: number;
  updated: number;
  skippedUnchanged: number;
  deactivated: number;
  subjectsCreated: string[];
  perSubject: SeedBankSubjectResult[];
}

/** Recalculate coverage stats for EVERY subject (admin repair op). */
export const adminRecalculateCoverage = mutation({
  args: {},
  handler: async (ctx): Promise<{ subjects: number }> => {
    const { user } = await requireAdminMutation(ctx);
    const subjects = await ctx.db.query("subjects").collect();
    await ctx.runMutation(internal.matricVault.recomputeCoverage, {
      subjectIds: subjects.map((s) => s._id),
    });
    await ctx.db.insert("adminAuditLog", {
      actorUserId: user._id,
      action: "matric.coverage_recalculated",
      targetType: "vault",
      details: JSON.stringify({ subjects: subjects.length }),
      createdAt: Date.now(),
    });
    return { subjects: subjects.length };
  },
});

// ── Validation report (Phase: reliable vault init) ────────────────────────
//
// Answers "why is coverage what it is": counts of ineligible rows by
// reason, duplicate groups, and the last import run's errors — so an admin
// never has to guess why a subject shows zero.

export const adminValidationReport = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);
    const rows = await ctx.db.query("matricQuestions").collect();
    const subjects = await ctx.db.query("subjects").collect();
    const subjectName = new Map(subjects.map((s) => [s._id, s.name]));

    let eligible = 0;
    let active = 0;
    const reasons = {
      noAnswerKey: 0,
      choicesNotFour: 0,
      emptyStem: 0,
      unverifiedTier: 0,
      deactivated: 0,
    };
    const ineligibleBySubject = new Map<string, number>();
    for (const r of rows) {
      if (!r.active) {
        reasons.deactivated++;
        continue;
      }
      active++;
      if (r.examEligible) {
        eligible++;
        continue;
      }
      const sName = subjectName.get(r.subjectId) ?? "?";
      ineligibleBySubject.set(sName, (ineligibleBySubject.get(sName) ?? 0) + 1);
      if (!r.answerLabel) reasons.noAnswerKey++;
      else if (r.choices.length !== 4) reasons.choicesNotFour++;
      else if (!r.stem.trim()) reasons.emptyStem++;
      else if (r.verificationTier === "unverified") reasons.unverifiedTier++;
    }

    const dupKeys = new Map<string, number>();
    for (const r of rows) {
      if (!r.active || !r.duplicateKey) continue;
      dupKeys.set(r.duplicateKey, (dupKeys.get(r.duplicateKey) ?? 0) + 1);
    }
    let duplicateRows = 0;
    for (const c of dupKeys.values()) if (c > 1) duplicateRows += c - 1;

    const lastRun = await ctx.db
      .query("matricImportRuns")
      .withIndex("by_startedAt")
      .order("desc")
      .take(1);
    let lastRunErrors: string[] = [];
    if (lastRun[0]?.errorsJson) {
      try {
        lastRunErrors = JSON.parse(lastRun[0].errorsJson) as string[];
      } catch {
        lastRunErrors = ["(unparseable error log)"];
      }
    }

    return {
      totalRows: rows.length,
      active,
      eligible,
      ineligibleReasons: reasons,
      ineligibleBySubject: [...ineligibleBySubject.entries()]
        .map(([subject, count]) => ({ subject, count }))
        .sort((a, b) => b.count - a.count),
      duplicateRows,
      lastRun: lastRun[0]
        ? {
            startedAt: lastRun[0].startedAt,
            status: lastRun[0].status,
            dryRun: lastRun[0].dryRun,
            trigger: lastRun[0].trigger,
            papersScanned: lastRun[0].papersScanned,
            errors: lastRunErrors,
          }
        : null,
    };
  },
});
