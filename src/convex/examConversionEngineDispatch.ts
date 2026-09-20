// examConversionEngineDispatch — the queue brain of the DETERMINISTIC
// conversion engine.
//
// Lives OUTSIDE the "use node" runtime because Convex mutations and
// queries must be plain functions — only actions may run in Node. The
// conversion workers themselves (examConversionEngine.ts) are pure PDF +
// regex work with zero AI calls; this file is their scheduler:
//
//   dispatchTick (cron, every 1 min):
//     1. enqueues any past-exam without a job row (new uploads included),
//     2. requeues dead claims (crashed worker / abandoned OCR tab) and
//        bounded-retries transient failures,
//     3. CLAIMS the next papers (student priority first) and schedules
//        engineConvert immediately.
//
// There is no rate-limit machinery here anymore — no cooldowns, no pause-
// and-resume, no circuit breakers — because there are no AI calls to
// throttle. Text-layer papers complete in seconds; scanned papers wait
// for a browser tab (a student's, or the admin console) to OCR them with
// Tesseract.js, which has no quotas either.
//
// Idempotent on any schedule; safe against double-claims because every
// state transition is a serialized transaction on the examConversionJobs row.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

// ─── Tunables ────────────────────────────────────────────────────────────

/**
 * Papers the engine converts in parallel. Deterministic conversion is a
 * PDF download + regex — light work, no provider to protect. Generous
 * parallelism keeps the library grinding fast.
 */
export const ENGINE_PARALLEL_CONVERSIONS = 6;

/**
 * Bounded auto-retries for TRANSIENT failures (storage blips, malformed
 * PDFs mid-download). A deterministic parse that genuinely finds nothing
 * is marked done-with-error by the engine, so this budget is only spent
 * on real retries.
 */
const MAX_AUTO_ATTEMPTS = 3;

/** Backoff between auto-retries of a failed conversion. */
const FAILED_RETRY_BACKOFF_MS = 10 * 60 * 1000;

/**
 * A job that exhausted its fast retries gets a fresh campaign once per
 * day — providers don't exist anymore, but storage does have bad days,
 * and a past exam should never be permanently stuck when nobody's looking.
 */
const EXHAUSTED_SELF_HEAL_MS = 24 * 60 * 60 * 1000;

/** How often the dispatch tick forces a full sweep even when the cheap
 *  early-exit sees nothing to do (covers done-but-not-live requeues and
 *  past_exam rows missing job rows). */
const FULL_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Rows enqueued per tick — comfortably inside mutation budgets. */
const MAX_ENQUEUE_PER_TICK = 200;

/** How long a "processing" text-conversion claim stays fresh. The
 * deterministic engine finishes text papers in seconds; 3 minutes is
 * generous headroom for the largest PDFs. */
const TEXT_CLAIM_FRESH_MS = 3 * 60 * 1000;

// ─── Small internal reads (the node workers have no direct db access) ───

export const getItemRow = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.contentId);
    if (!item) return null;
    return {
      _id: item._id,
      fileUrl: item.fileUrl,
      title: item.title,
      answerKeyContentId: item.answerKeyContentId ?? null,
    };
  },
});

export const getPaperRow = internalQuery({
  args: { digitalPaperId: v.id("digitalPapers") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row) return null;
    return {
      _id: row._id,
      contentId: row.contentId,
      status: row.status,
      sourceMode: row.sourceMode,
      pageCount: row.pageCount,
      ocrPages: row.ocrPages,
      updatedAt: row.updatedAt,
    };
  },
});

// ─── The tick ────────────────────────────────────────────────────────────

export const dispatchTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stats = { enqueued: 0, requeued: 0, claimed: 0, skippedReady: 0, exhausted: 0, earlyExit: false };

    // ── 0. CHEAP EARLY-EXIT (steady state) ──────────────────────────
    // The deterministic parser has converted the entire library — most
    // minutes the queue is terminal (everything ready/failed/done). The
    // full pass below reads EVERY past_exam + EVERY job + EVERY digital
    // paper row (~350+ documents today) and burns that every minute even
    // when there is nothing to do. This phase spends ~4 indexed reads to
    // prove there is nothing to do:
    //   • queued job  → claiming work below
    //   • running job → stale-claim reaping below
    //   • actionable failed job (retry backoff elapsed / 24h self-heal due)
    // The remaining slow-moving cases (a done job whose paper was
    // rejected/pdf-only by an admin, a past_exam row inserted without a
    // job row) are covered by the HOURLY full sweep below — max one hour
    // of extra latency for edge cases instead of ~350 reads every minute.
    const anyQueued = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .first();
    if (!anyQueued) {
      const anyRunning = await ctx.db
        .query("examConversionJobs")
        .withIndex("by_status", (q) => q.eq("status", "running"))
        .first();
      if (!anyRunning) {
        const failedJobs = await ctx.db
          .query("examConversionJobs")
          .withIndex("by_status", (q) => q.eq("status", "failed"))
          .take(50);
        const anyActionable = failedJobs.some(
          (j) =>
            j.attempts < MAX_AUTO_ATTEMPTS
              ? now - j.updatedAt >= FAILED_RETRY_BACKOFF_MS
              : now - j.updatedAt >= EXHAUSTED_SELF_HEAL_MS,
        );
        if (!anyActionable) {
          const sweepRow = await ctx.db
            .query("engineState")
            .withIndex("by_key", (q) => q.eq("key", "dispatch_last_full_sweep_at"))
            .first();
          if (now - (sweepRow?.value ?? 0) < FULL_SWEEP_INTERVAL_MS) {
            stats.earlyExit = true;
            return stats;
          }
        }
      }
    }

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
      if (
        paper &&
        paper.status === "ready" &&
        paper.verification !== "rejected" &&
        paper.reviewStatus !== "pdf_only"
      ) {
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

    // ── 2. Requeue dead claims + bounded-retry failures ──
    for (const job of jobRows) {
      if (job.status === "running") {
        // SCAN WAITING FOR OCR IS A STEADY STATE, not a dead claim: the
        // row sits "processing/scan" until a browser tab reads it (the
        // student who opens the paper, or the admin console runner).
        // Reaping it would re-claim the same scan every cycle and starve
        // the text queue — the exact bug this rule prevents. Only a scan
        // whose row vanished entirely is broken; requeue that.
        if (job.claimedBy === "client-ocr") {
          const row = paperByContent.get(job.contentId);
          if (row && row.status === "processing") continue;
          await ctx.db.patch(job._id, {
            status: "queued",
            claimedBy: undefined,
            claimedAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          if (row) await ctx.db.delete(row._id);
          job.status = "queued";
          stats.requeued += 1;
          continue;
        }
        // server-engine claim — the deterministic action finishes text
        // papers in seconds, so a stale claim means the worker died.
        const fresh = (job.claimedAt ?? 0) >= now - TEXT_CLAIM_FRESH_MS;
        if (!fresh && job.attempts < MAX_AUTO_ATTEMPTS) {
          await ctx.db.patch(job._id, {
            status: "queued",
            claimedBy: undefined,
            claimedAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          const row = paperByContent.get(job.contentId);
          if (row && row.status === "processing") {
            await ctx.db.delete(row._id);
          }
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
          // Daily self-heal — see the constant's comment.
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
      if (job.status === "done") {
        const paper = paperByContent.get(job.contentId);
        const live =
          paper &&
          paper.status === "ready" &&
          paper.verification !== "rejected" &&
          paper.reviewStatus !== "pdf_only";
        // A done job whose paper is not live (row deleted by a reconvert,
        // rejected, pdf-only) goes back into the line.
        if (live) continue;
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

    // ── 3. Claim the next papers and schedule server workers ──
    const textCutoff = now - TEXT_CLAIM_FRESH_MS;
    const engineRunning = jobRows.filter(
      (j) =>
        j.status === "running" &&
        j.claimedBy === "server-engine" &&
        (j.claimedAt ?? 0) >= textCutoff,
    ).length;
    let slots = Math.max(0, ENGINE_PARALLEL_CONVERSIONS - engineRunning);
    if (slots === 0) {
      // A full pass ran (enqueue backstop + requeue scan), so this counts
      // as a sweep — mark it, otherwise the early-exit would consider the
      // sweep stale and redo the full pass every minute.
      const sweepRow = await ctx.db
        .query("engineState")
        .withIndex("by_key", (q) => q.eq("key", "dispatch_last_full_sweep_at"))
        .first();
      if (sweepRow) await ctx.db.patch(sweepRow._id, { value: now });
      else
        await ctx.db.insert("engineState", {
          key: "dispatch_last_full_sweep_at",
          value: now,
        });
      return stats;
    }

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

      const existing = paperByContent.get(job.contentId);
      if (existing) {
        const live =
          existing.status === "ready" &&
          existing.verification !== "rejected" &&
          existing.reviewStatus !== "pdf_only";
        if (live) {
          // Already done — just close out the job row.
          await ctx.db.patch(job._id, { status: "done", doneAt: now, updatedAt: now });
          continue;
        }
        if (existing.status === "processing" && existing.sourceMode === "scan") {
          // A scan waiting for a browser OCR tab — not the engine's job.
          continue;
        }
        if (existing.status === "processing") {
          // Stale text run — replace it.
          await ctx.db.delete(existing._id);
        } else {
          await ctx.db.delete(existing._id);
        }
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

      await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineConvert, {
        contentId: job.contentId,
        digitalPaperId,
      });

      slots -= 1;
      stats.claimed += 1;
    }

    // Full pass ran — remember the time so the cheap early-exit can sleep
    // until the next hourly sweep (or until real work appears).
    const sweepRow = await ctx.db
      .query("engineState")
      .withIndex("by_key", (q) => q.eq("key", "dispatch_last_full_sweep_at"))
      .first();
    if (sweepRow) {
      await ctx.db.patch(sweepRow._id, { value: now });
    } else {
      await ctx.db.insert("engineState", {
        key: "dispatch_last_full_sweep_at",
        value: now,
      });
    }

    return stats;
  },
});

/**
 * One-shot reset for the whole library: every digital row is deleted and
 * every job re-queued so the DETERMINISTIC engine re-converts everything
 * (seconds per paper, no AI budget to respect). Admin-triggered.
 */
export const reconvertEntireLibrary = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let papers = 0;
    let jobs = 0;
    for (const row of await ctx.db.query("digitalPapers").collect()) {
      await ctx.db.delete(row._id);
      papers += 1;
    }
    for (const job of await ctx.db.query("examConversionJobs").collect()) {
      await ctx.db.patch(job._id, {
        status: "queued",
        priority: "batch",
        attempts: 0,
        claimedBy: undefined,
        claimedAt: undefined,
        lastError: undefined,
        updatedAt: now,
      });
      jobs += 1;
    }
    return { papers, jobs };
  },
});

// ─── Census (ops diagnostics) ────────────────────────────────────────────

/**
 * ENGINE CENSUS — internal diagnostics for ops checks / the admin console.
 * Status counts, review-pipeline counts, scan backlog, and failure
 * forensics in one cheap aggregate.
 */
export const engineCensus = internalQuery({
  args: {},
  handler: async (ctx) => {
    const papers = await ctx.db.query("digitalPapers").collect();
    const byStatus: Record<string, number> = {};
    const byReview: Record<string, number> = {};
    let scansWaiting = 0;
    let scanPagesDone = 0;
    let scanPagesTotal = 0;
    const failedSamples: { title: string; error: string }[] = [];
    const titles = new Map<string, string>();
    for (const item of await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .take(2000)) {
      titles.set(item._id, item.title);
    }
    for (const p of papers) {
      byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
      if (p.status === "ready") {
        const rs = p.reviewStatus ?? "auto";
        byReview[rs] = (byReview[rs] ?? 0) + 1;
      }
      if (p.status === "processing" && p.sourceMode === "scan") {
        scansWaiting += 1;
        const pages = p.ocrPages ?? [];
        scanPagesTotal += p.pageCount ?? pages.length;
        scanPagesDone += pages.filter((t) => t.length > 0).length;
      }
      if (p.status === "failed" && failedSamples.length < 6) {
        failedSamples.push({
          title: titles.get(p.contentId) ?? p.contentId,
          error: (p.error ?? "").slice(0, 200),
        });
      }
    }

    const pastExams = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .collect();
    const converted = new Set(papers.map((p) => p.contentId));
    let notEnqueued = 0;
    for (const item of pastExams) if (!converted.has(item._id)) notEnqueued += 1;

    const jobs = await ctx.db.query("examConversionJobs").collect();
    const byJobStatus: Record<string, number> = {};
    for (const j of jobs) {
      const s = j.status ?? "unknown";
      byJobStatus[s] = (byJobStatus[s] ?? 0) + 1;
    }

    const failures: Record<string, number> = {};
    let lastAttemptAt = 0;
    for (const p of papers) {
      if (p.status !== "failed") continue;
      const raw = (p.error ?? "unknown").slice(0, 120);
      const head = raw.split(/[.:\n]/)[0]?.trim().slice(0, 80) || "unknown";
      const key =
        head
          .replace(/[^\x20-\x7E]/g, " ")
          .replace(/\d+/g, "N")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60) || "unknown";
      failures[key] = (failures[key] ?? 0) + 1;
    }
    for (const j of jobs) if ((j.updatedAt ?? 0) > lastAttemptAt) lastAttemptAt = j.updatedAt ?? 0;

    const readyConfidences = papers
      .filter((p) => p.status === "ready" && typeof p.confidence === "number")
      .map((p) => p.confidence as number);
    const avgConfidence =
      readyConfidences.length > 0
        ? Math.round(readyConfidences.reduce((s, c) => s + c, 0) / readyConfidences.length)
        : null;

    // Parser output aggregates across the whole live library.
    let totalQuestions = 0;
    let mcqQuestions = 0;
    let answeredQuestions = 0;
    let flaggedDiagrams = 0;
    let scanSourceReady = 0;
    for (const p of papers) {
      if (p.status !== "ready") continue;
      totalQuestions += p.questionCount ?? 0;
      mcqQuestions += (p.questions ?? []).filter((q) => q.kind === "mcq").length;
      answeredQuestions += (p.questions ?? []).filter((q) => q.answer).length;
      flaggedDiagrams += p.parserMeta?.flaggedDiagrams ?? 0;
      if (p.sourceMode === "scan") scanSourceReady += 1;
    }

    return {
      papers: {
        total: papers.length,
        ready: byStatus.ready ?? 0,
        processing: byStatus.processing ?? 0,
        failed: byStatus.failed ?? 0,
      },
      review: byReview,
      avgConfidence,
      library: {
        totalQuestions,
        mcqQuestions,
        answeredQuestions,
        flaggedDiagrams,
        scanSourceReady,
      },
      scans: { waiting: scansWaiting, pagesDone: scanPagesDone, pagesTotal: scanPagesTotal },
      pastExams: { total: pastExams.length, withoutDigitalRow: notEnqueued },
      jobs: byJobStatus,
      failureBuckets: failures,
      failedSamples,
      lastEngineActivityAt: lastAttemptAt,
      checkedAt: Date.now(),
    };
  },
});
