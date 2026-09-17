// Exam Engine admin console backend — quality control for AI-digitized
// past papers.
//
// WHY THIS EXISTS: every digital paper starts life as an AI transcription
// marked "ai_unverified". Before the platform treats it as authoritative
// study material, an admin reviews it here — question by question, with
// inline correction — and flips it to "verified" (or rejects it). Students
// crowdsource error-finding through per-question reports, which land in
// this console's inbox.
//
// This file also owns the BATCH DIGITIZATION queue: "digitize the whole
// library" pre-converts every past paper so real students never wait on a
// live AI conversion. Batch jobs run in any admin's browser (the PDF text
// extraction is client-side), dequeue strictly AFTER student-demanded
// jobs, and are fully resumable — the queue lives in the database, not in
// any tab.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAdminMutation, isAdmin, type UserDoc } from "./admin";
import {
  MAX_CONCURRENT_CONVERSIONS,
  PROCESSING_MS_HINT,
} from "./examPrepDigitalConstants";

/**
 * Read-only admin gate for QUERIES (requireAdminMutation needs a
 * MutationCtx for bootstrap promotion — queries must never write).
 * Same role rule as admin.isAdmin, without any persistence.
 */
async function requireAdminRead(ctx: GenericQueryCtx<any>): Promise<UserDoc> {
  const userId = await getAuthUserId(ctx);
  const user: UserDoc | null = userId
    ? await ctx.runQuery(internal.admin.getUserById, { userId })
    : null;
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  return user;
}

// ─── Overview stats (console header) ─────────────────────────────────────

export const adminExamOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);

    const papers = await ctx.db.query("digitalPapers").collect();
    const reports = await ctx.db.query("examQuestionReports").collect();
    const jobs = await ctx.db.query("examConversionJobs").collect();

    const ready = papers.filter((p) => p.status === "ready");
    const freshCutoff = Date.now() - PROCESSING_MS_HINT;
    const running = jobs.filter(
      (j) => j.status === "running" && (j.claimedAt ?? 0) >= freshCutoff,
    ).length;

    return {
      papersTotal: papers.length,
      readyCount: ready.length,
      processingCount: papers.filter((p) => p.status === "processing").length,
      failedCount: papers.filter((p) => p.status === "failed").length,
      verifiedCount: ready.filter((p) => p.verification === "verified").length,
      unverifiedCount: ready.filter(
        (p) => (p.verification ?? "ai_unverified") === "ai_unverified",
      ).length,
      rejectedCount: ready.filter((p) => p.verification === "rejected").length,
      questionTotal: ready.reduce((sum, p) => sum + p.questionCount, 0),
      openReports: reports.filter((r) => r.status === "open").length,
      resolvedReports: reports.filter((r) => r.status === "resolved").length,
      queue: {
        queued: jobs.filter((j) => j.status === "queued").length,
        running,
        done: jobs.filter((j) => j.status === "done").length,
        failed: jobs.filter((j) => j.status === "failed").length,
        maxConcurrent: MAX_CONCURRENT_CONVERSIONS,
      },
    };
  },
});

// ─── Papers table (review / verify / reconvert) ──────────────────────────

export const adminListDigitalPapers = query({
  args: {
    filter: v.optional(
      v.union(
        v.literal("all"),
        v.literal("ready"),
        v.literal("unverified"),
        v.literal("verified"),
        v.literal("failed"),
        v.literal("not_converted"),
      ),
    ),
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminRead(ctx);

    const filter = args.filter ?? "all";
    const search = (args.search ?? "").trim().toLowerCase();
    const limit = Math.min(args.limit ?? 150, 400);

    // All past-exam content items — the digitization surface.
    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .take(1000);

    const subjectNames = new Map<string, string>();
    for (const s of await ctx.db.query("subjects").collect()) {
      subjectNames.set(s._id, s.name);
    }

    const rows: {
      _id: string;
      contentId: string;
      title: string;
      subjectName: string;
      grade: number;
      examYear: number | null;
      isPremium: boolean;
      // digitalPapers fields (null when never converted):
      status: string | null;
      questionCount: number | null;
      verification: string | null;
      adminEdited: boolean;
      sourceMode: string | null;
      error: string | null;
      updatedAt: number | null;
      openReports: number;
      queued: boolean;
    }[] = [];

    const reportRows = await ctx.db.query("examQuestionReports").collect();
    const openByContent = new Map<string, number>();
    for (const r of reportRows) {
      if (r.status === "open") {
        openByContent.set(r.contentId, (openByContent.get(r.contentId) ?? 0) + 1);
      }
    }
    const jobRows = await ctx.db.query("examConversionJobs").collect();
    const jobByContent = new Map<string, Doc<"examConversionJobs">>();
    for (const j of jobRows) jobByContent.set(j.contentId, j);

    for (const item of items) {
      const paper = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", item._id))
        .unique();

      const status = paper?.status ?? null;
      const verification =
        status === "ready" ? paper?.verification ?? "ai_unverified" : null;

      if (filter === "ready" && status !== "ready") continue;
      if (filter === "unverified" && verification !== "ai_unverified") continue;
      if (filter === "verified" && verification !== "verified") continue;
      if (filter === "failed" && status !== "failed") continue;
      if (filter === "not_converted" && status !== null) continue;

      if (search && !item.title.toLowerCase().includes(search)) continue;

      const job = jobByContent.get(item._id);
      rows.push({
        _id: paper?._id ?? item._id,
        contentId: item._id,
        title: item.title,
        subjectName: subjectNames.get(item.subjectId) ?? "—",
        grade: item.grade,
        examYear: item.examYear ?? null,
        isPremium: item.isPremium,
        status,
        questionCount: paper?.questionCount ?? null,
        verification,
        adminEdited: paper?.adminEdited ?? false,
        sourceMode: paper?.sourceMode ?? null,
        error: paper?.error ?? null,
        updatedAt: paper?.updatedAt ?? null,
        openReports: openByContent.get(item._id) ?? 0,
        queued: job?.status === "queued" || (job?.status === "running" && (job.claimedAt ?? 0) >= freshCutoffSafe()),
      });
      if (rows.length >= limit) break;
    }

    rows.sort((a, b) => {
      // Papers with open reports first — that's the QC priority signal —
      // then unverified above verified, then most recently touched.
      if (a.openReports !== b.openReports) return b.openReports - a.openReports;
      const vRank = (v: string | null) => (v === "ai_unverified" ? 0 : v === "rejected" ? 1 : 2);
      if (a.status === "ready" && b.status === "ready" && a.verification !== b.verification) {
        return vRank(a.verification) - vRank(b.verification);
      }
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

    return rows;
  },
});

function freshCutoffSafe(): number {
  return Date.now() - PROCESSING_MS_HINT;
}

/** One full digital paper for the review dialog (admin-only, all fields). */
export const adminGetDigitalPaper = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    await requireAdminRead(ctx);
    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row) return null;
    return {
      _id: row._id,
      status: row.status,
      verification: row.verification ?? (row.status === "ready" ? "ai_unverified" : null),
      adminEdited: row.adminEdited ?? false,
      sourceMode: row.sourceMode ?? "text",
      questionCount: row.questionCount,
      error: row.error ?? null,
      updatedAt: row.updatedAt,
      questions: row.questions,
    };
  },
});

/** Verify / reject a paper — the trust flip every surface reflects. */
export const setPaperVerification = mutation({
  args: {
    contentId: v.id("contentItems"),
    decision: v.union(v.literal("verified"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row || row.status !== "ready") {
      throw new ConvexError("Only a ready (converted) paper can be verified.");
    }
    await ctx.db.patch(row._id, {
      verification: args.decision,
      verifiedBy: user._id,
      verifiedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Inline correction of ONE question from the review console. Every field
 * is optional — only provided fields change. Sets adminEdited so the
 * badge can say "corrected by a teacher".
 */
export const adminFixQuestion = mutation({
  args: {
    contentId: v.id("contentItems"),
    questionNumber: v.number(),
    text: v.optional(v.string()),
    passage: v.optional(v.string()),
    options: v.optional(v.array(v.object({ label: v.string(), text: v.string() }))),
    answer: v.optional(v.string()),
    suggestedAnswer: v.optional(v.string()),
    explanation: v.optional(v.string()),
    topic: v.optional(v.string()),
    sourcePage: v.optional(v.number()),
    figureHint: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row || row.status !== "ready") {
      throw new ConvexError("Only a ready paper can be edited.");
    }

    const questions = row.questions.map((q) => {
      if (q.number !== args.questionNumber) return q;
      const next = { ...q };
      if (args.text !== undefined) {
        const t = args.text.trim();
        if (t.length < 3) throw new ConvexError("Question text is too short.");
        next.text = t.slice(0, 2000);
      }
      if (args.passage !== undefined) {
        next.passage = args.passage.trim().length > 0 ? args.passage.trim().slice(0, 4000) : undefined;
      }
      if (args.options !== undefined) {
        const labels = "ABCDEFGH";
        const cleaned: { label: string; text: string }[] = [];
        const seen = new Set<string>();
        for (const opt of args.options) {
          const text = opt.text.trim();
          if (!text || text.length > 500) throw new ConvexError("Option text must be 1-500 characters.");
          const label = labels[cleaned.length]!;
          if (!label) throw new ConvexError("At most 8 options are supported.");
          if (seen.has(text)) continue;
          seen.add(text);
          cleaned.push({ label, text });
        }
        if (cleaned.length > 0 && cleaned.length < 2) {
          throw new ConvexError("An MCQ needs at least 2 options (or clear them all for structured).");
        }
        next.options = cleaned;
        next.kind = cleaned.length >= 2 ? "mcq" : "structured";
      }
      if (args.answer !== undefined) {
        const a = args.answer.trim().toUpperCase();
        next.answer = /^[A-H]$/.test(a) && next.options.some((o) => o.label === a) ? a : undefined;
      }
      if (args.suggestedAnswer !== undefined) {
        next.suggestedAnswer =
          args.suggestedAnswer.trim().length > 0 ? args.suggestedAnswer.trim().slice(0, 4000) : undefined;
      }
      if (args.explanation !== undefined) {
        next.explanation =
          args.explanation.trim().length > 0 ? args.explanation.trim().slice(0, 1200) : undefined;
      }
      if (args.topic !== undefined) {
        next.topic = args.topic.trim().length > 0 ? args.topic.trim().slice(0, 60) : undefined;
      }
      if (args.sourcePage !== undefined) {
        next.sourcePage = args.sourcePage >= 1 ? args.sourcePage : undefined;
      }
      if (args.figureHint !== undefined) next.figureHint = args.figureHint;
      return next;
    });

    await ctx.db.patch(row._id, {
      questions,
      adminEdited: true,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

// ─── Reports inbox ────────────────────────────────────────────────────────

export const adminListReports = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed"))),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminRead(ctx);
    const limit = Math.min(args.limit ?? 100, 300);
    const rows = args.status
      ? await ctx.db
          .query("examQuestionReports")
          .withIndex("by_status", (q) => q.eq("status", args.status!))
          .take(limit)
      : await ctx.db.query("examQuestionReports").take(limit);

    const out = [];
    for (const r of rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit)) {
      const item = await ctx.db.get(r.contentId);
      out.push({
        _id: r._id,
        contentId: r.contentId,
        paperTitle: item?.title ?? "(deleted paper)",
        questionNumber: r.questionNumber,
        category: r.category,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        resolutionNote: r.resolutionNote ?? null,
      });
    }
    return out;
  },
});

export const resolveQuestionReport = mutation({
  args: {
    reportId: v.id("examQuestionReports"),
    decision: v.union(v.literal("resolved"), v.literal("dismissed")),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new ConvexError("Report not found.");
    await ctx.db.patch(args.reportId, {
      status: args.decision,
      resolvedBy: user._id,
      resolvedAt: Date.now(),
      resolutionNote:
        args.note && args.note.trim().length > 0 ? args.note.trim().slice(0, 500) : undefined,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

// ─── Batch digitization queue ─────────────────────────────────────────────

/**
 * "Digitize the whole library": enqueue every past-exam paper that has no
 * ready digital version yet. Student-demanded jobs always dequeue first;
 * these batch rows simply fill the platform's idle conversion capacity.
 * Safe to click twice — papers already queued/done are skipped.
 */
export const enqueueBatchDigitization = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireAdminMutation(ctx);

    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .take(1000);

    const jobRows = await ctx.db.query("examConversionJobs").collect();
    const jobByContent = new Map<string, Doc<"examConversionJobs">>();
    for (const j of jobRows) jobByContent.set(j.contentId, j);
    const paperRows = await ctx.db.query("digitalPapers").collect();
    const paperByContent = new Map<string, Doc<"digitalPapers">>();
    for (const p of paperRows) paperByContent.set(p.contentId, p);

    const now = Date.now();
    let enqueued = 0;
    let skippedReady = 0;
    let skippedQueued = 0;

    for (const item of items) {
      const paper = paperByContent.get(item._id);
      if (paper && paper.status === "ready" && paper.verification !== "rejected") {
        skippedReady += 1;
        continue;
      }
      const job = jobByContent.get(item._id);
      if (job && (job.status === "queued" || job.status === "running" || job.status === "done")) {
        if (job.status === "done" && paper?.status === "ready") {
          skippedReady += 1;
          continue;
        }
        skippedQueued += 1;
        continue;
      }
      if (job && job.status === "failed") {
        // A fresh batch pass retries earlier failures.
        await ctx.db.patch(job._id, {
          status: "queued",
          priority: "batch",
          lastError: undefined,
          updatedAt: now,
        });
        enqueued += 1;
        continue;
      }
      await ctx.db.insert("examConversionJobs", {
        contentId: item._id,
        priority: "batch",
        status: "queued",
        attempts: 0,
        enqueuedBy: user._id,
        createdAt: now,
        updatedAt: now,
      });
      enqueued += 1;
    }

    return { enqueued, skippedReady, skippedQueued };
  },
});

/**
 * The batch worker's claim step (runs in an admin's browser tab). Returns
 * the next queued BATCH job — student-demanded jobs are never claimed
 * here (their own clients convert them) — while respecting the platform
 * concurrency cap. Null when the queue is empty or at capacity.
 */
export const claimNextBatchJob = mutation({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireAdminMutation(ctx);

    const freshCutoff = Date.now() - PROCESSING_MS_HINT;
    const runningRows = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    const running = runningRows.filter((j) => (j.claimedAt ?? 0) >= freshCutoff).length;
    if (running >= MAX_CONCURRENT_CONVERSIONS) return null;

    const queued = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    const next = queued
      .filter((j) => j.priority === "batch")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return null;

    // Clear any dead digitalPapers row before the worker starts.
    const existingPaper = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", next.contentId))
      .unique();
    if (
      existingPaper &&
      (existingPaper.status !== "processing" ||
        Date.now() - existingPaper.updatedAt > PROCESSING_MS_HINT)
    ) {
      await ctx.db.delete(existingPaper._id);
    }
    if (
      existingPaper &&
      existingPaper.status === "processing" &&
      Date.now() - existingPaper.updatedAt <= PROCESSING_MS_HINT
    ) {
      // Another pipeline is live on this paper — skip it for now.
      return null;
    }

    const now = Date.now();
    await ctx.db.patch(next._id, {
      status: "running",
      claimedBy: user._id,
      claimedAt: now,
      attempts: next.attempts + 1,
      updatedAt: now,
    });

    const item = await ctx.db.get(next.contentId);
    return {
      jobId: next._id,
      contentId: next.contentId,
      title: item?.title ?? "(unknown)",
    };
  },
});

/** Reset every failed queue job to queued (admin "Retry failed"). */
export const adminRetryFailedJobs = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminMutation(ctx);
    const failed = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .collect();
    const now = Date.now();
    for (const j of failed) {
      await ctx.db.patch(j._id, {
        status: "queued",
        lastError: undefined,
        updatedAt: now,
      });
    }
    return { requeued: failed.length };
  },
});

/** Remove all queued BATCH jobs (keeps student jobs + running ones). */
export const adminClearBatchQueue = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminMutation(ctx);
    const queued = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    let removed = 0;
    for (const j of queued) {
      if (j.priority === "batch") {
        await ctx.db.delete(j._id);
        removed += 1;
      }
    }
    return { removed };
  },
});

/** Live queue list for the console monitor (latest 80). */
export const adminListQueue = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);
    const jobs = await ctx.db.query("examConversionJobs").collect();
    jobs.sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    for (const j of jobs.slice(0, 80)) {
      const item = await ctx.db.get(j.contentId);
      out.push({
        _id: j._id,
        contentId: j.contentId,
        title: item?.title ?? "(deleted)",
        priority: j.priority,
        status: j.status,
        attempts: j.attempts,
        lastError: j.lastError ?? null,
        updatedAt: j.updatedAt,
      });
    }
    return out;
  },
});

// ─── Single-paper actions ─────────────────────────────────────────────────

/**
 * Re-enqueue ONE paper for conversion (admin "Convert"/"Reconvert" button).
 * Batch priority — students still outrank it — but it lands immediately
 * when a slot is free.
 */
export const enqueueSinglePaper = mutation({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const item = await ctx.db.get(args.contentId);
    if (!item) throw new ConvexError("Paper not found.");

    const existing = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    const now = Date.now();
    if (existing) {
      if (existing.status === "queued" || existing.status === "running") {
        return { queued: false as const, reason: "already_active" as const };
      }
      await ctx.db.patch(existing._id, {
        status: "queued",
        priority: "batch",
        lastError: undefined,
        enqueuedBy: user._id,
        updatedAt: now,
      });
      return { queued: true as const };
    }
    await ctx.db.insert("examConversionJobs", {
      contentId: args.contentId,
      priority: "batch",
      status: "queued",
      attempts: 0,
      enqueuedBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    return { queued: true as const };
  },
});

/**
 * The paper's raw PDF url for the review dialog's original-page viewer.
 * Admin-gated: skips the premium subscription wall (review IS the job).
 */
export const adminGetFileUrl = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    await requireAdminRead(ctx);
    const item = await ctx.db.get(args.contentId);
    if (!item) return null;
    return { url: item.fileUrl, title: item.title, pageCount: item.pageCount ?? null };
  },
});
