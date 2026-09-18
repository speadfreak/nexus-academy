// Exam Engine admin console backend — quality control for deterministically
// parsed past papers.
//
// HOW QUALITY WORKS NOW: the deterministic parser computes a real
// confidence score (0-100) for every paper from measurable signals —
// sequential numbering continuity, option-set consistency, how much of
// the document's text was captured inside parsed blocks, stem quality.
// High confidence → live instantly, no admin step. Low confidence → the
// review queue below, where an admin glances at the paper and either
// ACCEPTS it, fixes specific questions, or routes students to the
// original PDF. Confidence is computed in milliseconds — no provider,
// no verification backlog.
//
// This file also owns the conversion queue controls ("digitize the whole
// library", reconvert everything through the deterministic engine) and
// the scan-OCR handoff list (scanned papers wait for a browser tab to
// read them with Tesseract.js — zero cloud AI).

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { GenericQueryCtx } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { requireAdminMutation, isAdmin, type UserDoc } from "./admin";
import { PROCESSING_MS_HINT } from "./examPrepDigitalConstants";

/**
 * Read-only admin gate for QUERIES (requireAdminMutation needs a
 * MutationCtx for bootstrap promotion — queries must never write).
 * Same role rule as admin.isAdmin, without any persistence.
 */
async function requireAdminRead(ctx: GenericQueryCtx<any>): Promise<UserDoc> {
  const userId = await getAuthUserId(ctx);
  const user = userId
    ? ((await ctx.db.get(userId)) as UserDoc | null)
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

    const ready = papers.filter((p) => p.status === "ready" && p.verification !== "rejected" && p.reviewStatus !== "pdf_only");
    const freshCutoff = Date.now() - PROCESSING_MS_HINT;
    const running = jobs.filter(
      (j) => j.status === "running" && (j.claimedAt ?? 0) >= freshCutoff,
    ).length;

    const reviewOf = (p: Doc<"digitalPapers">) => p.reviewStatus ?? "auto";
    const confidences = ready
      .map((p) => p.confidence)
      .filter((c): c is number => typeof c === "number");

    return {
      papersTotal: papers.length,
      readyCount: ready.length,
      processingCount: papers.filter((p) => p.status === "processing").length,
      failedCount: papers.filter((p) => p.status === "failed").length,
      // Deterministic review pipeline:
      autoCount: ready.filter((p) => reviewOf(p) === "auto").length,
      acceptedCount: ready.filter((p) => reviewOf(p) === "accepted").length,
      needsReviewCount: papers.filter((p) => p.reviewStatus === "needs_review").length,
      pdfOnlyCount: papers.filter((p) => p.reviewStatus === "pdf_only").length,
      avgConfidence:
        confidences.length > 0
          ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length)
          : null,
      // Scans waiting for a browser tab to OCR them.
      scansWaiting: papers.filter(
        (p) => p.status === "processing" && p.sourceMode === "scan",
      ).length,
      questionTotal: ready.reduce((sum, p) => sum + p.questionCount, 0),
      openReports: reports.filter((r) => r.status === "open").length,
      resolvedReports: reports.filter((r) => r.status === "resolved").length,
      queue: {
        queued: jobs.filter((j) => j.status === "queued").length,
        running,
        done: jobs.filter((j) => j.status === "done").length,
        failed: jobs.filter((j) => j.status === "failed").length,
      },
    };
  },
});

// ─── Papers table (review / accept / reconvert) ──────────────────────────

export const adminListDigitalPapers = query({
  args: {
    filter: v.optional(
      v.union(
        v.literal("all"),
        v.literal("ready"),
        v.literal("needs_review"),
        v.literal("auto"),
        v.literal("pdf_only"),
        v.literal("failed"),
        v.literal("scans"),
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

    const freshCutoff = Date.now() - PROCESSING_MS_HINT;
    const rows: {
      _id: string;
      contentId: string;
      title: string;
      subjectName: string;
      grade: number;
      examYear: number | null;
      isPremium: boolean;
      status: string | null;
      questionCount: number | null;
      confidence: number | null;
      reviewStatus: string | null;
      sourceMode: string | null;
      error: string | null;
      updatedAt: number | null;
      openReports: number;
      queued: boolean;
    }[] = [];

    for (const item of items) {
      const paper = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", item._id))
        .unique();

      const status = paper?.status ?? null;
      const reviewStatus = paper?.reviewStatus ?? null;
      const sourceMode = paper?.sourceMode ?? null;

      if (filter === "ready" && status !== "ready") continue;
      if (filter === "needs_review" && reviewStatus !== "needs_review") continue;
      if (filter === "auto" && !(status === "ready" && (reviewStatus === "auto" || reviewStatus === "accepted"))) continue;
      if (filter === "pdf_only" && reviewStatus !== "pdf_only") continue;
      if (filter === "failed" && status !== "failed") continue;
      if (filter === "scans" && !(status === "processing" && sourceMode === "scan")) continue;
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
        confidence: paper?.confidence ?? null,
        reviewStatus,
        sourceMode,
        error: paper?.error ?? null,
        updatedAt: paper?.updatedAt ?? null,
        openReports: openByContent.get(item._id) ?? 0,
        queued:
          job?.status === "queued" ||
          (job?.status === "running" && (job.claimedAt ?? 0) >= freshCutoff),
      });
      if (rows.length >= limit) break;
    }

    rows.sort((a, b) => {
      // Review-queue papers first, then papers with open reports, then
      // most recently touched.
      const aReview = a.reviewStatus === "needs_review" ? 0 : 1;
      const bReview = b.reviewStatus === "needs_review" ? 0 : 1;
      if (aReview !== bReview) return aReview - bReview;
      if (a.openReports !== b.openReports) return b.openReports - a.openReports;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });

    return rows;
  },
});

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
      confidence: row.confidence ?? null,
      reviewStatus: row.reviewStatus ?? null,
      parserMeta: row.parserMeta ?? null,
      sourceMode: row.sourceMode ?? "text",
      questionCount: row.questionCount,
      error: row.error ?? null,
      updatedAt: row.updatedAt,
      questions: row.questions,
    };
  },
});

/**
 * Admin review decision on a parsed paper — the confidence-era replacement
 * for AI verification:
 *   accept    → "accepted": the paper goes live for students;
 *   pdf_only  → "pdf_only": students are routed to the original PDF.
 */
export const adminReviewDecide = mutation({
  args: {
    contentId: v.id("contentItems"),
    decision: v.union(v.literal("accept"), v.literal("pdf_only")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row || row.status !== "ready") {
      throw new ConvexError("Only a parsed (ready) paper can be reviewed.");
    }
    await ctx.db.patch(row._id, {
      reviewStatus: args.decision === "accept" ? "accepted" : "pdf_only",
      // Keep the legacy field in sync so every read-path agrees.
      verification: args.decision === "accept" ? "verified" : "rejected",
      verifiedBy: user._id,
      verifiedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Inline correction of ONE question from the review console. Every field
 * is optional — only provided fields change. Sets adminEdited.
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

// ─── Library status ───────────────────────────────────────────────────────

/**
 * Coverage of the conversion engine: how much of the past-exam library is
 * digital, what's in flight, what waits for OCR, and what needs review.
 */
export const libraryAutopilotStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);

    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .take(1000);

    const papers = await ctx.db.query("digitalPapers").collect();
    const readyByContent = new Map<string, Doc<"digitalPapers">>();
    for (const p of papers) {
      if (
        p.status === "ready" &&
        p.verification !== "rejected" &&
        p.reviewStatus !== "pdf_only"
      ) {
        readyByContent.set(p.contentId, p);
      }
    }

    const freshCutoff = Date.now() - PROCESSING_MS_HINT;
    const jobs = await ctx.db.query("examConversionJobs").collect();

    let queued = 0;
    let running = 0;
    let failed = 0;
    for (const j of jobs) {
      if (j.status === "queued") queued += 1;
      else if (j.status === "running") {
        if ((j.claimedAt ?? 0) >= freshCutoff) running += 1;
        else queued += 1; // stale claim — the dispatch tick will requeue it
      } else if (j.status === "failed") failed += 1;
    }

    const ready = items.filter((i) => readyByContent.has(i._id)).length;
    const libraryTotal = items.length;
    const scansWaiting = papers.filter(
      (p) => p.status === "processing" && p.sourceMode === "scan",
    ).length;

    return {
      libraryTotal,
      ready,
      coveragePct: libraryTotal > 0 ? Math.round((ready / libraryTotal) * 100) : 100,
      queued,
      running,
      failed,
      scansWaiting,
      needsReview: papers.filter((p) => p.reviewStatus === "needs_review").length,
      // Questions parsed across the whole ready library — the engine's
      // "work done" number.
      questionTotal: [...readyByContent.values()].reduce((s, p) => s + p.questionCount, 0),
      lastTickNote:
        "The deterministic engine ticks every minute: text papers parse in seconds, scans wait for a browser tab (Tesseract.js, zero cloud AI).",
    };
  },
});

// ─── Queue controls ───────────────────────────────────────────────────────

/**
 * "Digitize the whole library": enqueue every past-exam paper that has no
 * live digital version yet. Safe to click twice.
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
      const live =
        paper &&
        paper.status === "ready" &&
        paper.verification !== "rejected" &&
        paper.reviewStatus !== "pdf_only";
      if (live) {
        skippedReady += 1;
        continue;
      }
      const job = jobByContent.get(item._id);
      if (job && (job.status === "queued" || job.status === "running")) {
        skippedQueued += 1;
        continue;
      }
      if (job) {
        // done/failed → fresh run.
        await ctx.db.patch(job._id, {
          status: "queued",
          priority: "batch",
          attempts: 0,
          claimedBy: undefined,
          claimedAt: undefined,
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
 * Re-convert EVERYTHING through the deterministic engine: all digital
 * rows deleted, every job re-queued. This is how the library migrates to
 * a new parser version (or shakes off legacy AI-era rows) in one click.
 */
export const adminReconvertAll = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminMutation(ctx);
    await ctx.scheduler.runAfter(
      0,
      internal.examConversionEngineDispatch.reconvertEntireLibrary,
      {},
    );
    return { ok: true as const };
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

// ─── Scan OCR handoff ─────────────────────────────────────────────────────

/**
 * Scanned papers waiting for OCR (status processing + sourceMode scan),
 * with per-paper progress. The admin console's "OCR scans in this tab"
 * runner consumes this list; a student opening the paper also triggers
 * their own tab automatically. Zero cloud AI — Tesseract.js in the tab.
 */
export const adminListScansNeedingOcr = query({
  args: {},
  handler: async (ctx) => {
    await requireAdminRead(ctx);
    const papers = await ctx.db
      .query("digitalPapers")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .collect();
    const scans = papers.filter((p) => p.sourceMode === "scan");
    scans.sort((a, b) => a.createdAt - b.createdAt);
    const out = [];
    for (const p of scans.slice(0, 200)) {
      const item = await ctx.db.get(p.contentId);
      out.push({
        contentId: p.contentId,
        title: item?.title ?? "(deleted)",
        pageCount: p.pageCount ?? 0,
        pagesDone: (p.ocrPages ?? []).filter((t) => t.length > 0).length,
        updatedAt: p.updatedAt,
      });
    }
    return out;
  },
});

// ─── Single-paper actions ─────────────────────────────────────────────────

/**
 * Re-enqueue ONE paper for conversion (admin "Convert"/"Reconvert" button).
 * Batch priority — students still outrank it.
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
        attempts: 0,
        claimedBy: undefined,
        claimedAt: undefined,
        lastError: undefined,
        enqueuedBy: user._id,
        updatedAt: now,
      });
      // Remove the old digital row entirely (INCLUDING scan-waiting rows —
      // the admin's reconvert is an explicit override) so the engine starts
      // clean.
      const paper = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
        .unique();
      if (paper) await ctx.db.delete(paper._id);
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
