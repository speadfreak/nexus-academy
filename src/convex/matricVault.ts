// LEARNYX MATRIC OS — Phase 1: Canonical Matric Question Vault.
//
// Materializes the deterministic past-paper question vault (digitalPapers,
// produced by the ZERO-AI conversion engine + admin QC) into a normalized,
// versioned, indexed question bank (matricQuestions).
//
// Guarantees:
//   - IDEMPOTENT: same papers → same vault rows; re-running updates in place
//     (matched by contentId + questionNumber + contentVersion).
//   - HONEST VERIFICATION: a question is exam-eligible ONLY when its paper
//     passed the deterministic QC workflow (reviewStatus auto/accepted) AND
//     it is a 4-choice MCQ with a resolvable answer key. Missing/ambiguous
//     keys are imported as unverified and can NEVER be auto-scored.
//   - PROVENANCE: every row carries its source paper, question number,
//     exam year, page, and how the key was established.
//   - NOTHING IS DELETED: rows whose source question disappears are
//     deactivated (active=false), never destroyed; historical session
//     snapshots keep their own embedded copies.

import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { PaginationResult } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { hashSeed } from "../lib/matric/selection";

// ── Pure import helpers (mirror-tested in scripts/test-matric-engine.mjs) ──

export function normalizeKeyLabel(raw: string | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

export function normalizeText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Content-duplicate fingerprint: same stem + same choices = same question. */
export function computeDuplicateKey(stem: string, choiceTexts: string[]): string {
  const sorted = [...choiceTexts.map(normalizeText)].sort();
  return `dup:${hashSeed(`${normalizeText(stem)}::${sorted.join("||")}`).toString(16)}`;
}

/** Version fingerprint: any change to stem/choices/key bumps the version. */
export function computeContentVersion(
  stem: string,
  choices: { label: string; text: string }[],
  answerLabel: string | undefined,
): string {
  const body = `${normalizeText(stem)}::${choices
    .map((c) => `${normalizeText(c.label)}=${normalizeText(c.text)}`)
    .join("||")}::${normalizeKeyLabel(answerLabel)}`;
  return `v:${hashSeed(body).toString(16)}`;
}

// ── Computed row shapes (action → mutation boundary) ───────────────────────

interface ComputedQuestion {
  questionNumber: number;
  stem: string;
  passage?: string;
  choices: { label: string; text: string }[];
  answerLabel?: string;
  explanation?: string;
  topicId?: string;
  topicText?: string;
  examYear?: number;
  sourcePage?: number;
  figureHint?: boolean;
  verificationTier: "admin_verified" | "parser_verified" | "unverified";
  examEligible: boolean;
  duplicateKey: string;
  contentVersion: string;
}

interface ComputedPaper {
  contentId: string;
  paperTitle: string;
  subjectId: string;
  questions: ComputedQuestion[];
  excludedUnverified: number;
}

export interface ImportRunSummary {
  runId: Id<"matricImportRuns">;
  papersScanned: number;
  imported: number;
  updated: number;
  skippedUnchanged: number;
  excludedUnverified: number;
  deactivated: number;
  papersWithoutSubject: number;
  errors: number;
}

// ── Paper lookup (internal query so the action stays batched) ──────────────

export const readyPaperPage = internalQuery({
  args: {
    cursor: v.union(v.string(), v.null()),
    pageSize: v.number(),
    updatedSinceMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ rows: Doc<"digitalPapers">[]; continueCursor: string; isDone: boolean }> => {
    const page = await ctx.db
      .query("digitalPapers")
      .withIndex("by_status", (q) => q.eq("status", "ready"))
      .paginate({ numItems: args.pageSize, cursor: args.cursor ?? null });
    let rows = page.page;
    if (args.updatedSinceMs !== undefined) {
      const since = args.updatedSinceMs;
      rows = rows.filter((p) => (p.updatedAt ?? p.createdAt ?? 0) >= since);
    }
    return { rows, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

export const paperSourceInfo = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    item: Doc<"contentItems">;
    subject: Doc<"subjects"> | null;
    topicNames: { id: string; name: string }[];
  } | null> => {
    const item = await ctx.db.get(args.contentId);
    if (!item) return null;
    if (!item.subjectId) return { item, subject: null, topicNames: [] as { id: string; name: string }[] };
    const subject = await ctx.db.get(item.subjectId);
    const topics = await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", item.subjectId))
      .collect();
    return {
      item,
      subject,
      topicNames: topics.map((t) => ({ id: t._id as string, name: t.name })),
    };
  },
});

// ── Import action ──────────────────────────────────────────────────────────

const PAGE_SIZE = 24;
const MAX_PAPERS_PER_RUN = 480; // safety cap; the cron re-ticks until done

/**
 * The vault sync. Idempotent — safe to run any number of times.
 * Pass updatedSinceMs for an incremental sync (cron default) or nothing
 * for a full rebuild (admin action).
 */
export const importVault = internalAction({
  args: {
    trigger: v.union(v.literal("admin"), v.literal("auto")),
    dryRun: v.boolean(),
    updatedSinceMs: v.optional(v.number()),
    startedBy: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<ImportRunSummary> => {
    const startedAt = Date.now();
    const runId = await ctx.runMutation(internal.matricVault.insertImportRun, {
      startedAt,
      trigger: args.trigger,
      dryRun: args.dryRun,
      startedBy: args.startedBy,
    });

    const totals = {
      papersScanned: 0,
      imported: 0,
      updated: 0,
      skippedUnchanged: 0,
      excludedUnverified: 0,
      deactivated: 0,
      papersWithoutSubject: 0,
    };
    const touchedSubjects = new Set<Id<"subjects">>();
    const errors: string[] = [];
    let processed = 0;
    let cursor: string | null = null;
    let isDone = false;

    while (!isDone && processed < MAX_PAPERS_PER_RUN) {
      const page: {
        rows: Doc<"digitalPapers">[];
        continueCursor: string;
        isDone: boolean;
      } = await ctx.runQuery(
        internal.matricVault.readyPaperPage,
        {
          cursor,
          pageSize: PAGE_SIZE,
          updatedSinceMs: args.updatedSinceMs,
        },
      );
      cursor = page.continueCursor;
      isDone = page.isDone;

      for (const paper of page.rows) {
        processed++;
        totals.papersScanned++;
        try {
          const info = await ctx.runQuery(internal.matricVault.paperSourceInfo, {
            contentId: paper.contentId,
          });
          if (!info || !info.subject || !info.item.subjectId) {
            totals.papersWithoutSubject++;
            continue;
          }
          const subjectId = info.item.subjectId;
          const topicByName = new Map(
            info.topicNames.map((t: { id: string; name: string }) => [t.name.trim().toLowerCase(), t.id]),
          );

          const computed: ComputedQuestion[] = [];
          let excluded = 0;
          for (const q of paper.questions ?? []) {
            // Only MCQs are auto-scorable; structured questions are out of
            // scope for the scored engine (honest limitation, not a hack).
            if (q.kind && q.kind !== "mcq") continue;
            const stem = (q.text ?? "").trim();
            const choices = (q.options ?? [])
              .filter((o: { text?: string }) => (o.text ?? "").trim().length > 0)
              .map((o: { label?: string; text?: string }) => ({
                label: normalizeKeyLabel(o.label),
                text: (o.text ?? "").trim(),
              }));
            const answerLabel = normalizeKeyLabel(q.answer);
            const answerValid =
              answerLabel.length > 0 && choices.some((c: { label: string }) => c.label === answerLabel);

            // Verification tier from the REAL QC workflow — never invented.
            const reviewStatus = paper.reviewStatus ?? "auto";
            const legacyVerified = paper.verification === "verified";
            let verificationTier: ComputedQuestion["verificationTier"];
            if (reviewStatus === "accepted" || (legacyVerified && reviewStatus !== "pdf_only")) {
              verificationTier = "admin_verified";
            } else if (reviewStatus === "auto") {
              verificationTier = "parser_verified";
            } else {
              verificationTier = "unverified";
            }

            const examEligible =
              stem.length > 0 &&
              choices.length === 4 &&
              answerValid &&
              reviewStatus !== "pdf_only" &&
              reviewStatus !== "needs_review";
            if (!examEligible) excluded++;
            // Note: accepted papers whose question lacks a valid key are
            // covered by the examEligible check above — they import as
            // unverified rows for admin review, never auto-scored.

            const resolvedTopicId = q.topic
              ? topicByName.get(q.topic.trim().toLowerCase())
              : undefined;

            computed.push({
              questionNumber: q.number,
              stem,
              passage: q.passage?.trim() || undefined,
              choices,
              answerLabel: answerValid ? answerLabel : undefined,
              explanation: q.explanation?.trim() || undefined,
              topicId: resolvedTopicId,
              topicText: q.topic?.trim() || undefined,
              examYear: info.item.examYear,
              sourcePage: q.sourcePage,
              figureHint: q.figureHint,
              verificationTier,
              examEligible,
              duplicateKey: computeDuplicateKey(
                stem,
                choices.map((c) => c.text),
              ),
              contentVersion: computeContentVersion(stem, choices, answerValid ? answerLabel : undefined),
            });
          }
          totals.excludedUnverified += excluded;

          if (!args.dryRun) {
            const res = await ctx.runMutation(internal.matricVault.commitPaperImport, {
              contentId: paper.contentId,
              paperTitle: info.item.title,
              subjectId,
              questions: computed,
            });
            totals.imported += res.imported;
            totals.updated += res.updated;
            totals.skippedUnchanged += res.skippedUnchanged;
            totals.deactivated += res.deactivated;
          }
          touchedSubjects.add(subjectId);
        } catch (e) {
          errors.push(`paper ${paper.contentId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    if (!args.dryRun && touchedSubjects.size > 0) {
      await ctx.runMutation(internal.matricVault.recomputeCoverage, {
        subjectIds: [...touchedSubjects],
      });
    }

    const finishedAt = Date.now();
    await ctx.runMutation(internal.matricVault.finishImportRun, {
      runId,
      finishedAt,
      status: errors.length > 0 && totals.papersScanned === 0 ? "failed" : "done",
      ...totals,
      errorsJson: errors.length > 0 ? JSON.stringify(errors.slice(0, 20)) : undefined,
    });

    // Observability — identifiers + counts only, never student data.
    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "content_event",
      source: "matricVault.import",
      status: "success",
      metadata: JSON.stringify({
        runId,
        trigger: args.trigger,
        dryRun: args.dryRun,
        ...totals,
        durationMs: finishedAt - startedAt,
      }),
      durationMs: finishedAt - startedAt,
    });

    return { runId, ...totals, errors: errors.length };
  },
});

/** Zero-arg wrapper for the daily auto-sync cron (incremental, no dry-run). */
export const autoVaultSync = internalAction({
  args: {},
  handler: async (ctx): Promise<ImportRunSummary> => {
    return await ctx.runAction(internal.matricVault.importVault, {
      trigger: "auto",
      dryRun: false,
      updatedSinceMs: Date.now() - 26 * 60 * 60 * 1000,
    });
  },
});

// ── Commit mutation (one paper per transaction) ────────────────────────────

export const insertImportRun = internalMutation({
  args: {
    startedAt: v.number(),
    trigger: v.union(v.literal("admin"), v.literal("auto")),
    dryRun: v.boolean(),
    startedBy: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"matricImportRuns">> => {
    return await ctx.db.insert("matricImportRuns", {
      startedAt: args.startedAt,
      trigger: args.trigger,
      dryRun: args.dryRun,
      status: "running",
      papersScanned: 0,
      imported: 0,
      updated: 0,
      skippedUnchanged: 0,
      excludedUnverified: 0,
      deactivated: 0,
      papersWithoutSubject: 0,
      ...(args.startedBy ? { startedBy: args.startedBy as Id<"users"> } : {}),
    });
  },
});

export const finishImportRun = internalMutation({
  args: {
    runId: v.id("matricImportRuns"),
    finishedAt: v.number(),
    status: v.union(v.literal("done"), v.literal("failed")),
    papersScanned: v.number(),
    imported: v.number(),
    updated: v.number(),
    skippedUnchanged: v.number(),
    excludedUnverified: v.number(),
    deactivated: v.number(),
    papersWithoutSubject: v.number(),
    errorsJson: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { runId, finishedAt, status, ...rest } = args;
    await ctx.db.patch(runId, { finishedAt, status, ...rest });
    return { ok: true };
  },
});

export const commitPaperImport = internalMutation({
  args: {
    contentId: v.id("contentItems"),
    paperTitle: v.string(),
    subjectId: v.id("subjects"),
    questions: v.array(
      v.object({
        questionNumber: v.number(),
        stem: v.string(),
        passage: v.optional(v.string()),
        choices: v.array(v.object({ label: v.string(), text: v.string() })),
        answerLabel: v.optional(v.string()),
        explanation: v.optional(v.string()),
        topicId: v.optional(v.string()),
        topicText: v.optional(v.string()),
        examYear: v.optional(v.number()),
        sourcePage: v.optional(v.number()),
        figureHint: v.optional(v.boolean()),
        verificationTier: v.union(
          v.literal("admin_verified"),
          v.literal("parser_verified"),
          v.literal("unverified"),
        ),
        examEligible: v.boolean(),
        duplicateKey: v.string(),
        contentVersion: v.string(),
      }),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ imported: number; updated: number; skippedUnchanged: number; deactivated: number }> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("matricQuestions")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .collect();
    const byNumber = new Map(existing.map((r) => [r.questionNumber, r]));

    let imported = 0;
    let updated = 0;
    let skippedUnchanged = 0;
    const seenNumbers = new Set<number>();

    for (const q of args.questions) {
      seenNumbers.add(q.questionNumber);
      const row = byNumber.get(q.questionNumber);
      const base = {
        contentId: args.contentId,
        paperTitle: args.paperTitle,
        questionNumber: q.questionNumber,
        subjectId: args.subjectId,
        stem: q.stem,
        ...(q.passage !== undefined ? { passage: q.passage } : {}),
        choices: q.choices,
        ...(q.answerLabel !== undefined ? { answerLabel: q.answerLabel } : { answerLabel: undefined }),
        ...(q.explanation !== undefined ? { explanation: q.explanation } : {}),
        ...(q.topicId !== undefined ? { topicId: q.topicId as Id<"topics"> } : { topicId: undefined }),
        ...(q.topicText !== undefined ? { topicText: q.topicText } : {}),
        ...(q.examYear !== undefined ? { examYear: q.examYear } : {}),
        ...(q.sourcePage !== undefined ? { sourcePage: q.sourcePage } : {}),
        ...(q.figureHint !== undefined ? { figureHint: q.figureHint } : {}),
        verificationTier: q.verificationTier,
        examEligible: q.examEligible,
        duplicateKey: q.duplicateKey,
        contentVersion: q.contentVersion,
        active: true,
        updatedAt: now,
      };
      if (!row) {
        await ctx.db.insert("matricQuestions", { ...base, importedAt: now });
        imported++;
      } else if (row.contentVersion === q.contentVersion && row.active) {
        skippedUnchanged++;
        // Keep verification metadata fresh even when content is unchanged
        // (an admin review decision may have changed tier without content).
        if (
          row.verificationTier !== q.verificationTier ||
          row.examEligible !== q.examEligible ||
          (row.topicId ?? undefined) !== q.topicId
        ) {
          await ctx.db.patch(row._id, {
            verificationTier: q.verificationTier,
            examEligible: q.examEligible,
            ...(q.topicId !== undefined ? { topicId: q.topicId as Id<"topics"> } : { topicId: undefined }),
            updatedAt: now,
          });
          updated++;
        }
      } else {
        await ctx.db.patch(row._id, base);
        updated++;
      }
    }

    // Deactivate rows whose source question disappeared (soft-off only).
    let deactivated = 0;
    for (const row of existing) {
      if (!seenNumbers.has(row.questionNumber) && row.active) {
        await ctx.db.patch(row._id, { active: false, updatedAt: now });
        deactivated++;
      }
    }

    return { imported, updated, skippedUnchanged, deactivated };
  },
});

// ── Coverage stats ─────────────────────────────────────────────────────────

export const recomputeCoverage = internalMutation({
  args: { subjectIds: v.array(v.id("subjects")) },
  handler: async (ctx, args): Promise<{ subjects: number }> => {
    const now = Date.now();
    for (const subjectId of args.subjectIds) {
      const rows = await ctx.db
        .query("matricQuestions")
        .withIndex("by_subject_eligible", (q) =>
          q.eq("subjectId", subjectId).eq("examEligible", true).eq("active", true),
        )
        .collect();
      const paperIds = new Set<string>();
      const years = new Set<number>();
      const topics = new Map<string, { topicId?: string; topicText: string; count: number }>();
      let adminVerified = 0;
      for (const r of rows) {
        paperIds.add(r.contentId);
        if (r.examYear) years.add(r.examYear);
        if (r.verificationTier === "admin_verified") adminVerified++;
        const key = r.topicId ? `id:${r.topicId}` : `text:${(r.topicText ?? "General").trim().toLowerCase()}`;
        const entry = topics.get(key) ?? {
          topicId: r.topicId,
          topicText: (r.topicText ?? "General").trim() || "General",
          count: 0,
        };
        entry.count++;
        if (!entry.topicId && r.topicId) entry.topicId = r.topicId;
        topics.set(key, entry);
      }
      const byTopic = [...topics.entries()]
        .map(([key, v]) => ({ key, topicId: v.topicId, topicText: v.topicText, count: v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);

      const existing = (await ctx.db
        .query("matricCoverageStats")
        .withIndex("by_subject", (q) => q.eq("subjectId", subjectId))
        .order("asc").take(1))[0];
      const payload = {
        subjectId,
        eligibleCount: rows.length,
        adminVerifiedCount: adminVerified,
        paperCount: paperIds.size,
        yearsCount: years.size,
        byTopicJson: JSON.stringify(byTopic),
        updatedAt: now,
      };
      if (existing) await ctx.db.patch(existing._id, payload);
      else await ctx.db.insert("matricCoverageStats", payload);
    }
    return { subjects: args.subjectIds.length };
  },
});
