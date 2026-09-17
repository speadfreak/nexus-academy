// examAutopilot — the "library is ALWAYS digital" engine.
//
// DESIGN CONSTRAINT (learned the hard way): pdf.js cannot run inside a
// Convex action — it crashes the node runtime (see src/lib/pdfText.ts).
// Conversion extraction is therefore permanently client-side. The autopilot
// makes that fact irrelevant to students with three cooperating engines:
//
//   1. THIS TICK (cron, every 10 min) — the self-healing queue. Every
//      past-exam paper without a ready digital version gets a queued batch
//      job. Future uploads are covered the same way: the moment a paper is
//      inserted (content.insertContentItem) it lands in this queue, and the
//      tick backstops anything that ever slips through. Transient failures
//      auto-retry with a backoff (bounded — a paper that genuinely has no
//      questions never becomes an infinite AI spend; admins can still
//      retry manually).
//
//   2. CROWD WORKER (any signed-in tab) — peekCrowdJob + the hub's
//      background worker convert queued papers using IDLE capacity only:
//      if any student-demanded conversion is running platform-wide, every
//      crowd worker stands down instantly. Students never wait behind
//      pre-conversion work.
//
//   3. STUDENT AUTO-START — if a student somehow reaches an unconverted
//      paper (brand-new upload + nobody online yet), opening it starts the
//      conversion immediately at STUDENT priority — no button, no wait
//      screen behind a click.
//
// The net effect: papers are digital before students arrive, and the free
// AI tier is paced by a single global concurrency cap no matter how many
// tabs, students or admins are online.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { PROCESSING_MS_HINT } from "./examPrepDigitalConstants";

/**
 * Bounded auto-retries per paper. A conversion that failed 3 times needs a
 * human (the admin console's retry + review), not another blind attempt —
 * this keeps a genuinely impossible paper from burning the free AI tier
 * forever.
 */
const MAX_AUTO_ATTEMPTS = 3;

/** Backoff between auto-retries of a failed conversion. */
const FAILED_RETRY_BACKOFF_MS = 30 * 60 * 1000;

/**
 * Rows inserted per tick. The queue is fully drained across consecutive
 * ticks; the cap keeps any single mutation comfortably inside transaction
 * budgets even on the day the library grows by hundreds of papers.
 */
const MAX_ENQUEUE_PER_TICK = 200;

/**
 * The self-healing enqueue tick. Idempotent — safe to run on any schedule,
 * on any volume. Returns counters for the admin console / logs.
 */
export const autoEnqueueTick = internalMutation({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", "past_exam"))
      .take(1000);

    const jobRows = await ctx.db.query("examConversionJobs").collect();
    const jobByContent = new Map<string, (typeof jobRows)[number]>();
    for (const j of jobRows) jobByContent.set(j.contentId, j);
    const paperRows = await ctx.db.query("digitalPapers").collect();
    const paperByContent = new Map<string, (typeof paperRows)[number]>();
    for (const p of paperRows) paperByContent.set(p.contentId, p);

    const now = Date.now();
    let enqueued = 0;
    let requeued = 0;
    let skippedReady = 0;
    let waiting = 0;
    let exhausted = 0;

    for (const item of items) {
      if (enqueued + requeued >= MAX_ENQUEUE_PER_TICK) break;

      const paper = paperByContent.get(item._id);
      if (paper && paper.status === "ready" && paper.verification !== "rejected") {
        skippedReady += 1;
        continue;
      }

      const job = jobByContent.get(item._id);
      if (!job) {
        await ctx.db.insert("examConversionJobs", {
          contentId: item._id,
          priority: "batch",
          status: "queued",
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        enqueued += 1;
        continue;
      }

      if (job.status === "queued") {
        waiting += 1;
        continue;
      }

      if (job.status === "running") {
        const fresh = (job.claimedAt ?? 0) >= now - PROCESSING_MS_HINT;
        if (fresh) {
          waiting += 1; // actively converting somewhere — leave it alone
        } else if (job.attempts < MAX_AUTO_ATTEMPTS) {
          // Dead claim (tab closed mid-conversion) — back into the line.
          await ctx.db.patch(job._id, {
            status: "queued",
            claimedBy: undefined,
            claimedAt: undefined,
            lastError: undefined,
            updatedAt: now,
          });
          requeued += 1;
        } else {
          exhausted += 1;
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
          requeued += 1;
        } else if (job.attempts >= MAX_AUTO_ATTEMPTS) {
          exhausted += 1;
        }
        continue;
      }

      if (job.status === "done" && (!paper || paper.status !== "ready")) {
        // Done job whose digital row vanished (manual deletion) — rebuild.
        await ctx.db.patch(job._id, {
          status: "queued",
          priority: "batch",
          claimedBy: undefined,
          claimedAt: undefined,
          lastError: undefined,
          updatedAt: now,
        });
        requeued += 1;
      }
    }

    return { enqueued, requeued, skippedReady, waiting, exhausted };
  },
});
