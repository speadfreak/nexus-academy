// Digital exam engine backend — turns every past-exam PDF into a fully
// digital, question-by-question paper. V3: THE DETERMINISTIC ERA.
//
// There is NO AI in this pipeline. Real past exam papers have a highly
// predictable structure (numbered questions, lettered options, answer
// keys), so conversion is pure pattern-matching:
//
//   1. requestDigitization (mutation, student kick) — claims the queue
//      row and schedules the server engine immediately.
//   2. engineConvert (action, server) — layout-aware text extraction
//      (two-column aware) + the deterministic parser (examParser.ts).
//      Text-layer papers complete in ONE action, typically seconds, with
//      a computed confidence score. Scanned papers (no text layer) are
//      stamped for the OCR route: a browser tab (the student's own, or
//      the admin console) runs Tesseract.js page by page — zero cloud
//      AI, zero quotas — and submits text through submitOcrPageText.
//   3. When every page's OCR text is in, finalizeOcrPaper runs the EXACT
//      SAME deterministic parser on it. One parser, two text sources.
//   4. Quality: every paper gets confidence (0-100) from real signals.
//      High → live instantly ("auto"). Low → "needs_review" (the admin
//      queue: accept / fix / original-PDF-only). Answer-key PDFs linked
//      via contentItems.answerKeyContentId are parsed for their number→
//      letter map and merged deterministically.
//
// HONESTY RULES (unchanged in spirit, sharper in the deterministic era):
//   - The parser transcribes structure — it never invents question text,
//     options, or answers. Answers come only from the paper's own key.
//   - Questions whose real content is a diagram are flagged (figureHint)
//     with a link to the original page — never silently incomplete.
//   - No trust badges are shown to students; QC lives in the admin
//     console plus the in-player "Report an issue" affordance.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isPremiumStatus } from "./subscriptions";

// How long a "processing" row stays fresh before a student kick may
// replace it. The deterministic engine finishes text papers in seconds —
// two minutes is generous. (Scan rows stay fresh as long as OCR page
// submissions keep arriving; the dispatch reaper handles abandonment.)
const PROCESSING_FRESH_MS = 2 * 60 * 1000;

// ─── Queue helpers ───────────────────────────────────────────────────────

/**
 * Find (or create) the queue row for a paper and reset it to a claimable
 * state. Returns the row id.
 */
async function ensureJobQueued(
  ctx: { db: any },
  contentId: Id<"contentItems">,
  userId: Id<"users">,
  demand: "student" | "batch",
): Promise<Id<"examConversionJobs">> {
  const existing = await ctx.db
    .query("examConversionJobs")
    .withIndex("by_content", (q: any) => q.eq("contentId", contentId))
    .unique();
  const now = Date.now();
  if (existing) {
    if (existing.status === "queued") {
      // A student waiting right now outranks any batch enqueue.
      if (demand === "student" && existing.priority !== "student") {
        await ctx.db.patch(existing._id, { priority: "student", updatedAt: now });
      }
      return existing._id;
    }
    if (existing.status === "running" && now - existing.updatedAt < PROCESSING_FRESH_MS) {
      return existing._id; // someone is actively converting — keep it
    }
    // done/failed/stale-running → back into the line for a fresh run.
    await ctx.db.patch(existing._id, {
      status: "queued",
      priority: demand,
      claimedBy: undefined,
      claimedAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    return existing._id;
  }
  return ctx.db.insert("examConversionJobs", {
    contentId,
    priority: demand,
    status: "queued",
    attempts: 0,
    enqueuedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
}

/** Keep the queue job row in step with the digitalPapers row. */
async function markJobByContent(
  ctx: { db: any },
  contentId: Id<"contentItems">,
  status: "done" | "failed",
  error?: string,
) {
  const job = await ctx.db
    .query("examConversionJobs")
    .withIndex("by_content", (q: any) => q.eq("contentId", contentId))
    .unique();
  if (!job) return;
  await ctx.db.patch(job._id, {
    status,
    lastError: error ? String(error).slice(0, 500) : undefined,
    updatedAt: Date.now(),
    doneAt: status === "done" ? Date.now() : job.doneAt,
  });
}

/** Live for students? Live = ready + not rejected (legacy) + not pdf_only. */
function isPlayable(row: Doc<"digitalPapers">): boolean {
  return (
    row.status === "ready" &&
    row.verification !== "rejected" &&
    row.reviewStatus !== "pdf_only"
  );
}

// ─── Student kick ────────────────────────────────────────────────────────

/**
 * STUDENT KICK. When a student opens a paper that isn't ready yet (a
 * brand-new upload, or a scan nobody has OCR'd), this claims the job at
 * STUDENT priority and schedules the server engine immediately — no cron
 * wait. The page shows a calm "Preparing…" state and the reactive query
 * lands the student in the player the moment conversion completes.
 */
export const requestDigitization = mutation({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args): Promise<{ kind: "ready" | "blocked" | "processing" | "claimed" }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const item = await ctx.db.get(args.contentId);
    if (!item) throw new ConvexError({ message: "Paper not found.", code: "not_found" });

    const existing = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();

    const now = Date.now();

    if (existing) {
      if (isPlayable(existing)) return { kind: "ready" };
      // Admin parked it: needs review or original-PDF-only.
      if (
        existing.status === "ready" &&
        (existing.reviewStatus === "needs_review" || existing.reviewStatus === "pdf_only")
      ) {
        return { kind: "blocked" };
      }
      if (existing.status === "processing") {
        if (existing.sourceMode === "scan") {
          // Keep scan rows (they may hold partial OCR progress); the
          // dispatch reaper reclaims abandoned scans.
          await ctx.db.patch(existing._id, { updatedAt: now });
          return { kind: "processing" };
        }
        if (now - existing.updatedAt < PROCESSING_FRESH_MS) {
          return { kind: "processing" }; // the engine is on it right now
        }
        // Stale text run — replace wholesale.
        await ctx.db.delete(existing._id);
      } else {
        // Failed — replace; the deterministic parser may succeed where a
        // previous attempt hit a transient storage error.
        await ctx.db.delete(existing._id);
      }
    }

    const jobId = await ensureJobQueued(ctx, args.contentId, userId, "student");
    await ctx.db.patch(jobId, {
      status: "running",
      claimedBy: "server-engine",
      claimedAt: now,
      updatedAt: now,
      attempts: ((await ctx.db.get(jobId))?.attempts ?? 0) + 1,
    });

    const digitalPaperId = await ctx.db.insert("digitalPapers", {
      contentId: args.contentId,
      status: "processing",
      questions: [],
      questionCount: 0,
      chunksParsed: 0,
      sourceMode: "text",
      startedBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    // The engine worker starts THIS second — student priority end to end.
    await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineConvert, {
      contentId: args.contentId,
      digitalPaperId,
    });

    return { kind: "claimed" };
  },
});

/**
 * Engine progress stamp — page count is known right after extraction.
 */
export const patchPaperProgress = internalMutation({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    pageCount: v.number(),
    chunkCount: v.number(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row || row.status !== "processing") return;
    await ctx.db.patch(args.digitalPaperId, {
      pageCount: args.pageCount,
      chunkCount: args.chunkCount,
      updatedAt: Date.now(),
    });
  },
});

/**
 * The engine determined this paper is a SCAN (no usable text layer).
 * Stamp the OCR route and hand ownership to whichever browser tab runs
 * Tesseract.js next (the student's own page mounts the runner; the admin
 * console can do the whole library). Zero cloud AI involved.
 */
export const markScanRoute = internalMutation({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db.get(args.digitalPaperId);
    if (row && row.status === "processing") {
      await ctx.db.patch(args.digitalPaperId, {
        sourceMode: "scan",
        pageCount: args.pageCount,
        chunkCount: args.pageCount,
        chunksParsed: 0,
        ocrPages: new Array(args.pageCount).fill(""),
        error: undefined,
        updatedAt: now,
      });
    }
    // Hand the claim to the client OCR runner (not the server engine).
    const job = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (job) {
      await ctx.db.patch(job._id, {
        claimedBy: "client-ocr",
        claimedAt: now,
        updatedAt: now,
        lastError: undefined,
      });
    }
  },
});

// ─── OCR page submission (client-side Tesseract.js → server parse) ──────

const MAX_OCR_CHARS_PER_PAGE = 30_000;
/** Upper bound on pages per internal batch call (payload stays well under limits). */
const MAX_OCR_BATCH_PAGES = 40;

/**
 * Batch variant of submitOcrPageText for INTERNAL runners (the ops
 * backlog grinder runs Tesseract.js in Node — same engine, same parser,
 * no auth needed behind the deploy-key wall). Identical semantics per
 * page: idempotent writes, freshness stamps, and the finalize action
 * scheduled the moment the last missing page lands.
 */
export const submitOcrPagesInternal = internalMutation({
  args: {
    contentId: v.id("contentItems"),
    pageCount: v.number(),
    pages: v.array(
      v.object({ pageNumber: v.number(), text: v.string() }),
    ),
  },
  handler: async (ctx, args): Promise<{ accepted: number; done: boolean }> => {
    if (args.pages.length === 0 || args.pages.length > MAX_OCR_BATCH_PAGES) {
      return { accepted: 0, done: false };
    }

    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row || row.status !== "processing" || row.sourceMode !== "scan") {
      return { accepted: 0, done: false }; // row moved on — stop quietly
    }

    const pageCount = row.pageCount ?? args.pageCount;
    const pages = (row.ocrPages && row.ocrPages.length === pageCount
      ? [...row.ocrPages]
      : new Array(pageCount).fill("")) as string[];

    let accepted = 0;
    for (const p of args.pages) {
      if (p.pageNumber < 1 || p.pageNumber > pageCount) continue;
      pages[p.pageNumber - 1] = p.text.slice(0, MAX_OCR_CHARS_PER_PAGE);
      accepted += 1;
    }
    if (accepted === 0) return { accepted: 0, done: false };

    const doneCount = pages.filter((t) => t.length > 0).length;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      ocrPages: pages,
      chunksParsed: doneCount,
      updatedAt: now,
    });

    // Keep the job claim fresh while pages stream in.
    const job = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (job && job.status === "running") {
      await ctx.db.patch(job._id, { claimedAt: now, updatedAt: now });
    }

    if (doneCount >= pageCount) {
      await ctx.scheduler.runAfter(0, internal.examConversionEngine.finalizeOcrPaper, {
        digitalPaperId: row._id,
        contentId: args.contentId,
      });
      return { accepted, done: true };
    }
    return { accepted, done: false };
  },
});

/**
 * INTERNAL SCAN BACKLOG LIST — everything the Node/ops OCR grinder and the
 * admin runner need per scan: the PDF url, page count, and exact per-page
 * presence for resume. Internal so the deploy-key CLI can read it without
 * end-user auth.
 */
export const scanBacklogInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db
      .query("digitalPapers")
      .withIndex("by_status", (q) => q.eq("status", "processing"))
      .collect();
    const scans = papers.filter((p) => p.sourceMode === "scan");
    scans.sort((a, b) => a.createdAt - b.createdAt);
    const out = [];
    for (const p of scans.slice(0, 300)) {
      const item = await ctx.db.get(p.contentId);
      if (!item) continue;
      out.push({
        contentId: p.contentId,
        digitalPaperId: p._id,
        title: item.title,
        fileUrl: item.fileUrl,
        pageCount: p.pageCount ?? 0,
        pagesPresent: (p.ocrPages ?? []).map((t) => t.length > 0),
      });
    }
    return out;
  },
});

/**
 * Submit ONE page's OCR text (from the browser Tesseract.js runner).
 * Idempotent per page; the row's updatedAt is the scan claim's freshness
 * signal. When the last missing page arrives, this schedules the
 * finalize action that runs the deterministic parser over the full text.
 */
export const submitOcrPageText = mutation({
  args: {
    contentId: v.id("contentItems"),
    pageNumber: v.number(), // 1-based
    pageCount: v.number(),
    text: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ done: boolean; accepted: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    if (args.pageNumber < 1 || args.pageNumber > args.pageCount) {
      return { done: false, accepted: false };
    }

    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row || row.status !== "processing" || row.sourceMode !== "scan") {
      // The row moved on (reconverted, rejected, OCR finished elsewhere).
      return { done: false, accepted: false };
    }

    const pageCount = row.pageCount ?? args.pageCount;
    const pages = (row.ocrPages && row.ocrPages.length === pageCount
      ? [...row.ocrPages]
      : new Array(pageCount).fill("")) as string[];
    pages[args.pageNumber - 1] = args.text.slice(0, MAX_OCR_CHARS_PER_PAGE);

    const doneCount = pages.filter((t) => t.length > 0).length;
    const now = Date.now();

    if (doneCount >= pageCount) {
      await ctx.db.patch(row._id, {
        ocrPages: pages,
        chunksParsed: doneCount,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, internal.examConversionEngine.finalizeOcrPaper, {
        digitalPaperId: row._id,
        contentId: args.contentId,
      });
      return { done: true, accepted: true };
    }

    await ctx.db.patch(row._id, {
      ocrPages: pages,
      chunksParsed: doneCount,
      updatedAt: now,
    });
    // Keep the job claim fresh while pages stream in.
    const job = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (job && job.status === "running") {
      await ctx.db.patch(job._id, { claimedAt: now, updatedAt: now });
    }
    return { done: false, accepted: true };
  },
});

// ─── Terminal states (called by the engine actions) ─────────────────────

/**
 * Complete a deterministically parsed paper: renumbered questions,
 * confidence + review status + compact parser meta, and the job closed.
 */
export const completeDeterministic = internalMutation({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
    questions: v.array(
      v.object({
        number: v.number(),
        kind: v.union(v.literal("mcq"), v.literal("structured")),
        text: v.string(),
        passage: v.optional(v.string()),
        options: v.array(v.object({ label: v.string(), text: v.string() })),
        answer: v.optional(v.string()),
        suggestedAnswer: v.optional(v.string()),
        explanation: v.optional(v.string()),
        topic: v.optional(v.string()),
        sourcePage: v.optional(v.number()),
        figureHint: v.optional(v.boolean()),
      }),
    ),
    pageCount: v.number(),
    sourceMode: v.union(v.literal("text"), v.literal("scan")),
    confidence: v.number(),
    reviewStatus: v.union(v.literal("auto"), v.literal("needs_review")),
    parserMeta: v.object({
      numberingStyle: v.string(),
      optionStyle: v.string(),
      answerKeySource: v.string(),
      answerKeyCount: v.number(),
      flaggedDiagrams: v.number(),
    }),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row || row.status !== "processing") return;
    const now = Date.now();
    await ctx.db.patch(args.digitalPaperId, {
      status: "ready",
      questions: args.questions,
      questionCount: args.questions.length,
      pageCount: args.pageCount,
      sourceMode: args.sourceMode,
      confidence: args.confidence,
      reviewStatus: args.reviewStatus,
      parserMeta: args.parserMeta,
      error: undefined,
      updatedAt: now,
    });
    await markJobByContent(ctx, args.contentId, "done");
  },
});

/**
 * Terminal failure of a deterministic conversion (transient fetch error,
 * zero questions parsed, or an answer-key document). `reviewStatus`
 * routes the student surface: "pdf_only" → original-PDF view; anything
 * else → the calm retry affordance. The JOB is marked failed (not done!):
 * marking it done would make the dispatch requeue it every tick (a done
 * job whose paper isn't live looks like a lost row), and a doomed paper
 * would ping-pong through the queue at the FIFO head forever, starving
 * everything behind it. As "failed" it gets bounded retries via the
 * normal backoff, then the daily self-heal.
 */
export const failDeterministic = internalMutation({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
    error: v.string(),
    reviewStatus: v.union(v.literal("needs_review"), v.literal("pdf_only")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (row && row.status === "processing") {
      await ctx.db.patch(args.digitalPaperId, {
        status: "failed",
        error: args.error.slice(0, 500),
        reviewStatus: args.reviewStatus,
        updatedAt: Date.now(),
      });
    }
    await markJobByContent(ctx, args.contentId, "failed", args.error);
  },
});

// ─── Reads ───────────────────────────────────────────────────────────────

/**
 * The digitized paper. Metadata is available to any signed-in user (the
 * hub chips use it); the questions themselves are premium-gated when the
 * source paper is premium — matching the Reader's download gating exactly.
 */
export const getDigitalPaper = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row) return null;

    const item: Doc<"contentItems"> | null = await ctx.db.get(args.contentId);
    const needsPremium = Boolean(item?.isPremium);
    let hasPremium = false;
    if (needsPremium) {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      hasPremium = isPremiumStatus(sub?.status);
    }

    return {
      _id: row._id,
      contentId: row.contentId,
      status: row.status,
      questionCount: row.questionCount,
      pageCount: row.pageCount ?? null,
      sourceMode: row.sourceMode ?? "text",
      // Deterministic quality signals.
      confidence: row.confidence ?? null,
      reviewStatus: row.reviewStatus ?? null,
      parserMeta: row.parserMeta ?? null,
      // OCR progress for scanned papers (0..pageCount).
      ocrDone: row.ocrPages ? row.ocrPages.filter((t) => t.length > 0).length : null,
      ocrTotal: row.ocrPages ? row.ocrPages.length : null,
      // Per-page presence so a runner can resume exactly where it left off.
      ocrPagesPresent: row.ocrPages
        ? row.ocrPages.map((t) => t.length > 0)
        : null,
      // Legacy verification field (admin verification semantics).
      verification: row.verification ?? (row.status === "ready" ? "ai_unverified" : null),
      adminEdited: row.adminEdited ?? false,
      error: row.error ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedByMe: row.startedBy === userId,
      // Questions only when the caller may see them.
      questions: needsPremium && !hasPremium ? null : row.questions,
      premiumLocked: needsPremium && !hasPremium,
    };
  },
});

/**
 * Statuses for the hub's paper cards. Pass the ids already loaded by
 * getExamPrepPapers — value-stable args keep this from re-subscribing.
 */
export const getDigitalPaperStatuses = query({
  args: { contentIds: v.array(v.id("contentItems")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const out: {
      contentId: string;
      status: string;
      questionCount: number;
      reviewStatus: string | null;
    }[] = [];
    for (const contentId of args.contentIds.slice(0, 1000)) {
      const row = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", contentId))
        .unique();
      if (row) {
        out.push({
          contentId,
          status: row.status,
          questionCount: row.questionCount,
          reviewStatus: row.reviewStatus ?? null,
        });
      }
    }
    return out;
  },
});

// ─── Student question reports ("Report an issue with this question") ────

export const submitQuestionReport = mutation({
  args: {
    contentId: v.id("contentItems"),
    questionNumber: v.number(),
    category: v.union(
      v.literal("wrong_answer"),
      v.literal("garbled_text"),
      v.literal("missing_options"),
      v.literal("missing_figure"),
      v.literal("not_in_paper"),
      v.literal("other"),
    ),
    details: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const details = args.details.trim().slice(0, 1000);
    if (details.length < 3) {
      throw new ConvexError({ message: "Tell us a little more so we can fix it.", code: "invalid" });
    }

    const existing = await ctx.db
      .query("examQuestionReports")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .filter((q) =>
        q.eq(q.field("questionNumber"), args.questionNumber)
        && q.eq(q.field("reportedBy"), userId)
        && q.eq(q.field("status"), "open"),
      )
      .first();

    const now = Date.now();
    if (existing) {
      // One live report per question per student — update it in place.
      await ctx.db.patch(existing._id, {
        category: args.category,
        details,
        updatedAt: now,
      });
      return { reportId: existing._id, updated: true as const };
    }
    const reportId = await ctx.db.insert("examQuestionReports", {
      contentId: args.contentId,
      questionNumber: args.questionNumber,
      category: args.category,
      details,
      reportedBy: userId,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    return { reportId, updated: false as const };
  },
});

/**
 * The signed-in student's own reports for one paper — the player marks
 * already-reported questions so the affordance stays honest.
 */
export const getMyQuestionReports = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return ctx.db
      .query("examQuestionReports")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .filter((q) => q.eq(q.field("reportedBy"), userId))
      .collect()
      .then((rows) =>
        rows.map((r) => ({
          questionNumber: r.questionNumber,
          status: r.status,
          category: r.category,
        })),
      );
  },
});

// ─── Attempt persistence ─────────────────────────────────────────────────

/**
 * Persist one digital attempt (Practice OR Exam) into examPrepAttempts —
 * the same table the legacy PDF Exam Mode writes, so My Results and the
 * readiness signal see one continuous history. Best-effort from the client:
 * a logging failure must never block the results screen.
 */
export const logDigitalAttempt = mutation({
  args: {
    contentId: v.id("contentItems"),
    mode: v.union(v.literal("exam"), v.literal("practice")),
    startedAt: v.number(),
    endedAt: v.number(),
    durationSeconds: v.number(),
    completed: v.boolean(),
    autoScorePct: v.optional(v.number()),
    questionsTotal: v.optional(v.number()),
    questionsCorrect: v.optional(v.number()),
    questionsAnswered: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const item = await ctx.db.get(args.contentId);
    if (!item) throw new ConvexError({ message: "Paper not found.", code: "not_found" });

    const durationSeconds = Math.max(0, Math.min(args.durationSeconds, 24 * 3600));
    const clampPct = (n?: number) =>
      n === undefined ? undefined : Math.max(0, Math.min(100, Math.round(n)));

    const attemptId = await ctx.db.insert("examPrepAttempts", {
      userId,
      contentId: args.contentId,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      durationSeconds,
      completed: args.completed,
      mode: args.mode,
      autoScorePct: clampPct(args.autoScorePct),
      questionsTotal: args.questionsTotal,
      questionsCorrect: args.questionsCorrect,
      questionsAnswered: args.questionsAnswered,
    });
    return { attemptId };
  },
});
