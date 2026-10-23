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
import type { Id } from "./_generated/dataModel";
import { isAdmin, requireAdminMutation, requireAdminAction } from "./admin";
import type { ImportRunSummary } from "./matricVault";

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
