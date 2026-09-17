// examConversionEngineDispatch — the ALWAYS-READY engine's queue brain.
//
// Lives OUTSIDE the "use node" runtime because Convex mutations and
// queries must be plain functions — only actions may run in Node. This
// file is the scheduler/queue half of the engine (see examConversionEngine.ts
// for the conversion workers themselves):
//
//   • dispatchTick (cron, every 1 min) — the self-healing queue:
//       1. enqueues any past-exam without a job (new uploads included),
//       2. requeues dead claims (crashed worker) and cooled-down failures
//          (bounded retries — a genuinely impossible paper never burns the
//          free AI tier forever),
//       3. CLAIMS the next papers (student priority always first) and
//          schedules the server-side conversion workers immediately.
//
// Idempotent on any schedule; safe against double-claims because every
// state transition is a serialized transaction on the examConversionJobs row.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { PROCESSING_MS_HINT } from "./examPrepDigitalConstants";

// ─── Tunables ────────────────────────────────────────────────────────────

/** Papers the engine converts in parallel. The global AI rate lanes pace
 *  every individual call, so parallelism is safe — this mostly bounds
 *  PDF-download memory and keeps each paper's chunks interleaved so no
 *  single paper waits behind the whole library. */
export const ENGINE_PARALLEL_CONVERSIONS = 4;

/**
 * Bounded AUTO-retries before the long-cooldown self-heal kicks in. A
 * conversion that keeps failing gets throttled, never abandoned — see the
 * 24h self-heal below. The library is kept digital FOREVER; a paper that
 * failed under an older pipeline is always worth another attempt once the
 * engine improves (which is exactly what happened when conversion moved
 * server-side).
 */
const MAX_AUTO_ATTEMPTS = 5;

/** Backoff between auto-retries of a failed conversion. */
const FAILED_RETRY_BACKOFF_MS = 30 * 60 * 1000;

/**
 * The eternal self-heal: a job that exhausted its fast retries gets a
 * FRESH campaign once per day. Providers improve, keys get configured,
 * the engine itself improves — a past exam should never be permanently
 * stuck unconverted when nobody is looking.
 */
const EXHAUSTED_SELF_HEAL_MS = 24 * 60 * 60 * 1000;

/** Rows enqueued per tick — comfortably inside mutation budgets. */
const MAX_ENQUEUE_PER_TICK = 200;

// ─── Small internal reads (the node workers have no direct db access) ───

export const getItemRow = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args): Promise<Doc<"contentItems"> | null> =>
    ctx.db.get(args.contentId),
});

export const getPaperRow = internalQuery({
  args: { digitalPaperId: v.id("digitalPapers") },
  handler: async (ctx, args): Promise<Doc<"digitalPapers"> | null> =>
    ctx.db.get(args.digitalPaperId),
});

// ─── dispatchTick — the 1-minute self-healing queue + claim loop ─────────

/**
 * Idempotent. Safe on any schedule. Merges the enqueue backstop (past
 * exams without jobs), the dead-claim reaper (stale running → queued) and
 * the failed-retry requeue, then claims up to ENGINE_PARALLEL_CONVERSIONS
 * papers and schedules server workers for them immediately.
 */
export const dispatchTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stats = { enqueued: 0, requeued: 0, claimed: 0, skippedReady: 0, exhausted: 0 };

    // ── 1. Enqueue backstop: every past_exam must have a queue row ──
    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .take(2000);
    const jobRows = await ctx.db.query("examConversionJobs").collect();
    const jobByContent = new Map<string, (typeof jobRows)[number]>();
    for (const j of jobRows) jobByContent.set(j.contentId, j);
    const paperRows = await ctx.db.query("digitalPapers").collect();
    const paperByContent = new Map<string, (typeof paperRows)[number]>();
    for (const p of paperRows) paperByContent.set(p.contentId, p);

    for (const item of items) {
      if (stats.enqueued >= MAX_ENQUEUE_PER_TICK) break;
      const paper = paperByContent.get(item._id);
      if (paper && paper.status === "ready" && paper.verification !== "rejected") {
        stats.skippedReady += 1;
        continue;
      }
      if (!jobByContent.has(item._id)) {
        await ctx.db.insert("examConversionJobs", {
          contentId: item._id,
          priority: "batch",
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        stats.enqueued += 1;
      }
    }

    // ── 2. Requeue dead claims + cooled-down failures (bounded retries) ──
    for (const job of jobRows) {
      if (job.status === "running") {
        const fresh = (job.claimedAt ?? 0) >= now - PROCESSING_MS_HINT;
        if (!fresh && job.attempts < MAX_AUTO_ATTEMPTS) {
          await ctx.db.patch(job._id, {
            status: "queued",
            claimedBy: undefined,
            claimedAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          job.status = "queued";
          stats.requeued += 1;
        } else if (!fresh) {
          stats.exhausted += 1;
        }
        continue;
      }
      if (job.status === "failed") {
        const cooledDown = now - job.updatedAt >= FAILED_RETRY_BACKOFF_MS;
        if (job.attempts < MAX_AUTO_ATTEMPTS && cooledDown) {
          await ctx.db.patch(job._id, {
            status: "queued",
            priority: "batch",
            claimedBy: undefined,
            claimedAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          job.status = "queued";
          stats.requeued += 1;
        } else if (job.attempts >= MAX_AUTO_ATTEMPTS) {
          // Exhausted the fast retries — the daily self-heal gives the
          // paper a fresh campaign (attempts reset) so the library can
          // never go permanently stale.
          const selfHealDue = now - job.updatedAt >= EXHAUSTED_SELF_HEAL_MS;
          if (selfHealDue) {
            await ctx.db.patch(job._id, {
              status: "queued",
              priority: "batch",
              attempts: 0,
              claimedBy: undefined,
              claimedAt: undefined,
              lastError: undefined,
              updatedAt: now,
            });
            job.status = "queued";
            stats.requeued += 1;
          } else {
            stats.exhausted += 1;
          }
        }
        continue;
      }
      if (job.status === "done" && jobByContent.has(job.contentId)) {
        const paper = paperByContent.get(job.contentId);
        if (!paper || paper.status !== "ready") {
          // Done job whose digital row vanished (manual deletion) — rebuild.
          await ctx.db.patch(job._id, {
            status: "queued",
            priority: "batch",
            claimedBy: undefined,
            claimedAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          job.status = "queued";
          stats.requeued += 1;
        }
      }
    }

    // ── 3. Claim the next papers and schedule server workers ──
    const freshCutoff = now - PROCESSING_MS_HINT;
    const engineRunning = jobRows.filter(
      (j) =>
        j.status === "running" &&
        j.claimedBy === "server-engine" &&
        (j.claimedAt ?? 0) >= freshCutoff,
    ).length;
    let slots = Math.max(0, ENGINE_PARALLEL_CONVERSIONS - engineRunning);
    if (slots === 0) return stats;

    const queued = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    // Students first, then FIFO within each priority.
    queued.sort((a, b) => {
      const ra = (a.priority === "student" ? 0 : 1) * 1e15 + a.createdAt;
      const rb = (b.priority === "student" ? 0 : 1) * 1e15 + b.createdAt;
      return ra - rb;
    });

    for (const job of queued) {
      if (slots === 0) break;
      const item = await ctx.db.get(job.contentId);
      if (!item) continue;

      // Replace any stale/failed/rejected digital row (sequence guard
      // requires a clean row per run).
      const existing = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", job.contentId))
        .unique();
      if (existing) {
        if (existing.status === "ready" && existing.verification !== "rejected") {
          // Already done — just close out the job row.
          await ctx.db.patch(job._id, {
            status: "done",
            doneAt: now,
            updatedAt: now,
          });
          continue;
        }
        await ctx.db.delete(existing._id);
      }

      const claimedAt = Date.now();
      await ctx.db.patch(job._id, {
        status: "running",
        claimedBy: "server-engine",
        claimedAt,
        updatedAt: claimedAt,
        attempts: job.attempts + 1,
      });

      const digitalPaperId = await ctx.db.insert("digitalPapers", {
        contentId: job.contentId,
        status: "processing",
        questions: [],
        questionCount: 0,
        chunksParsed: 0,
        sourceMode: "text",
        createdAt: claimedAt,
        updatedAt: claimedAt,
      });

      await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineExtract, {
        contentId: job.contentId,
        digitalPaperId,
      });

      slots -= 1;
      stats.claimed += 1;
    }

    return stats;
  },
});

// ─── Failure handling (called by the node workers) ───────────────────────

export const failPaperInternal = internalMutation({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
    error: v.string(),
    requeueForCrowd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (row && row.status === "processing") {
      await ctx.db.patch(args.digitalPaperId, {
        status: "failed",
        error: args.error.slice(0, 500),
        updatedAt: Date.now(),
      });
    }
    const job = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!job) return;
    if (args.requeueForCrowd) {
      // Deterministic "needs another route" failure — back to the batch
      // line WITHOUT an attempt penalty (the crowd worker's vision path
      // picks NEEDS_OCR jobs first and will succeed where the text engine
      // cannot).
      await ctx.db.patch(job._id, {
        status: "queued",
        priority: "batch",
        claimedBy: undefined,
        claimedAt: undefined,
        lastError: args.error.slice(0, 500),
        updatedAt: Date.now(),
      });
      return;
    }
    await ctx.db.patch(job._id, {
      status: "failed",
      lastError: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});
