// Admin Branding Panel — shows branding progress + provides the
// "Rebrand existing library" button + handles per-file branding with
// resumable progress. Rendered inside AdminContentSection as a 4th tab
// or as a section at the top of the content tab.
//
// ARCHITECTURE:
//   - Polls `getBrandingStats` every 5s while a rebranding job is in
//     progress; otherwise polls every 30s.
//   - "Rebrand existing library" button starts a sequential loop:
//     1. Call listUnbranded → get the first unbranded item id.
//     2. Call rebrandOneContent(returnNext: true) → returns next id.
//     3. Repeat until next is null OR the admin clicks "Stop".
//   - Live progress display: "Rebranding 47/197 — Grade 12 Chemistry
//     Past Exam 2015" with a progress bar.
//   - The loop is RESUMABLE — if the browser is closed, refresh, or
//     the action times out, re-clicking "Rebrand existing library" picks
//     up from wherever it left off (only items where brandingApplied is
//     not true are processed).
//   - Per-file branding failures are logged but don't stop the loop —
//     the row is marked brandingApplied=false so it's retried next time.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface BrandingJob {
  isRunning: boolean;
  processed: number;
  total: number;
  currentItemTitle: string | null;
  failed: number;
  stopped: boolean; // admin clicked stop
}

const INITIAL_JOB: BrandingJob = {
  isRunning: false,
  processed: 0,
  total: 0,
  currentItemTitle: null,
  failed: 0,
  stopped: false,
};

export function BrandingPanel() {
  const rebrandOne = useAction(api.contentAdmin.rebrandOneContent);
  const listUnbrandedAction = useAction(api.contentAdmin.listUnbranded);
  const getBrandingStats = useAction(api.contentAdmin.getBrandingStats);
  const [stats, setStats] = useState<{ branded: number; total: number; pending: number; version: number } | undefined>(undefined);

  const [job, setJob] = useState<BrandingJob>(INITIAL_JOB);
  // Ref to allow the running loop to detect a "stop" request without
  // re-rendering on every iteration.
  const stopRequestedRef = useRef(false);
  // Track the current "started at" processed count so we know how many
  // items we've actually processed in this run (vs. items that were
  // already branded before we started).
  const startedProcessedRef = useRef(0);

  // Poll branding stats — fast while the job is running, slower when idle.
  // This is the only source of truth for the "X of Y resources branded"
  // display. Even when no job is running we still poll (every 15s) so the
  // admin sees accurate counts if content is uploaded elsewhere.
  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const s = await getBrandingStats({});
        if (!cancelled) setStats(s);
      } catch {
        // Ignore — stats are non-critical for the UI.
      }
    };
    void fetchStats();
    const interval = setInterval(fetchStats, job.isRunning ? 2000 : 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [job.isRunning, getBrandingStats]);

  const startJob = useCallback(async () => {
    if (job.isRunning) return;
    stopRequestedRef.current = false;
    setJob({
      isRunning: true,
      processed: 0,
      total: stats?.total ?? 0,
      currentItemTitle: null,
      failed: 0,
      stopped: false,
    });
    startedProcessedRef.current = 0;

    toast.info("Starting rebranding job — processing one file at a time…");

    try {
      // Get the initial queue size from listUnbranded
      const queue: Array<{ _id: string; title: string; contentType: string; grade: number }> = await listUnbrandedAction({ limit: 200 });
      const totalToProcess = queue.length;
      if (totalToProcess === 0) {
        toast.success("All resources are already branded — nothing to do.");
        setJob((j) => ({ ...j, isRunning: false, currentItemTitle: null }));
        return;
      }

      setJob((j) => ({ ...j, total: totalToProcess }));
      toast.info(`Found ${totalToProcess} unbranded resource${totalToProcess === 1 ? "" : "s"}. Starting rebranding loop…`);

      // Start from the first item in the queue.
      let currentId: string | null = queue[0]?._id ?? null;
      let processed = 0;
      let failed = 0;

      while (currentId && !stopRequestedRef.current) {
        // Look up the title for the progress display
        const currentItem = queue.find((q) => q._id === currentId);
        setJob((j) => ({
          ...j,
          processed,
          currentItemTitle: currentItem?.title ?? "Unknown",
          failed,
        }));

        try {
          const result = await rebrandOne({
            contentId: currentId as Id<"contentItems">,
            returnNext: true,
          });
          processed++;
          if (!result.branded && result.error) {
            failed++;
            toast.error(`Failed: ${currentItem?.title ?? currentId} — ${result.error}`);
          }
          if (!result.next) {
            // No more pending items — we're done.
            currentId = null;
            break;
          }
          // Re-fetch the queue periodically so newly created items
          // (if the admin uploads while rebranding) get picked up.
          // The "next" returned is from the current snapshot, so we
          // can just trust it for the next iteration. But the title
          // display needs the fresh queue — fetch it every 5 items.
          if (processed % 5 === 0) {
            const fresh: Array<{ _id: string; title: string; contentType: string; grade: number }> = await listUnbrandedAction({ limit: 200 });
            // Find the title for the next item
            const nextItem = fresh.find((q) => q._id === result.next!._id);
            if (nextItem) {
              setJob((j) => ({ ...j, currentItemTitle: nextItem.title }));
            }
          }
          currentId = result.next._id;
        } catch (err) {
          failed++;
          toast.error(`Branding threw for ${currentId}: ${err instanceof Error ? err.message : "unknown"}`);
          // Skip this file — try to get the next one via listUnbranded
          const fresh: Array<{ _id: string; title: string; contentType: string; grade: number }> = await listUnbrandedAction({ limit: 200 });
          const skipIdx = fresh.findIndex((q) => q._id === currentId);
          if (skipIdx >= 0 && skipIdx + 1 < fresh.length) {
            currentId = fresh[skipIdx + 1]._id;
          } else {
            currentId = null;
          }
          processed++;
        }
      }

      setJob((j) => ({
        ...j,
        isRunning: false,
        processed,
        failed,
        currentItemTitle: null,
        stopped: stopRequestedRef.current,
      }));

      if (stopRequestedRef.current) {
        toast.info(`Rebranding paused after ${processed} file${processed === 1 ? "" : "s"} (${failed} failed). Click "Rebrand existing library" to resume from where you left off.`);
      } else {
        toast.success(`Rebranding complete! Processed ${processed} file${processed === 1 ? "" : "s"} (${failed} failed).`);
      }
    } catch (err) {
      setJob((j) => ({
        ...j,
        isRunning: false,
        currentItemTitle: null,
      }));
      toast.error(`Rebranding job crashed: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }, [job.isRunning, stats, rebrandOne, listUnbrandedAction]);

  const stopJob = useCallback(() => {
    stopRequestedRef.current = true;
    setJob((j) => ({ ...j, stopped: true }));
    toast.info("Stopping after the current file finishes…");
  }, []);

  // Stats display — branded / total + pending + version
  const brandedCount = stats?.branded ?? 0;
  const totalCount = stats?.total ?? 0;
  const pendingCount = stats?.pending ?? 0;
  const version = stats?.version ?? 1;
  const pct = totalCount > 0 ? Math.round((brandedCount / totalCount) * 100) : 0;

  // Progress bar for the running job (shows processed / total)
  const jobPct = job.total > 0 ? Math.round((job.processed / job.total) * 100) : 0;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-amber-300" />
          <h4 className="text-sm font-bold uppercase tracking-wider">
            PDF Branding
          </h4>
          <Badge variant="outline" className="bg-white/5">
            v{version}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {job.isRunning ? (
            <Button
              onClick={stopJob}
              size="sm"
              variant="outline"
              className="gap-2 border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
            >
              <Pause className="size-3.5" />
              Stop after current
            </Button>
          ) : pendingCount > 0 ? (
            <Button
              onClick={startJob}
              size="sm"
              className="gap-2 bg-amber-500 text-white hover:bg-amber-600"
            >
              <Play className="size-3.5" />
              {job.stopped ? "Resume rebranding" : "Rebrand existing library"}
            </Button>
          ) : (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
              <CheckCircle2 className="size-2.5 mr-1" />
              All branded
            </Badge>
          )}
        </div>
      </div>

      {/* Stats row — branded / total / pending */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
            Branded
          </p>
          <p className="mt-0.5 text-lg font-bold text-emerald-300">
            {brandedCount}
          </p>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total
          </p>
          <p className="mt-0.5 text-lg font-bold">
            {totalCount}
          </p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
            Pending
          </p>
          <p className="mt-0.5 text-lg font-bold text-amber-300">
            {pendingCount}
          </p>
        </div>
      </div>

      {/* Overall progress bar — branded / total library */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Library branding rollout</span>
          <span>{pct}%</span>
        </div>
        <Progress value={pct} className="h-2" />
      </div>

      {/* Live rebranding job progress — only shown while running */}
      {job.isRunning && (
        <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-amber-300" />
              <span className="text-xs font-semibold text-amber-300">
                Rebranding in progress
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {job.processed} / {job.total} ({jobPct}%)
              {job.failed > 0 && <span className="ml-2 text-rose-300">{job.failed} failed</span>}
            </span>
          </div>
          <Progress value={jobPct} className="h-2" />
          {job.currentItemTitle && (
            <p className="mt-2 truncate text-[11px] text-muted-foreground">
              <FileText className="mr-1 inline size-3" />
              {job.currentItemTitle}
            </p>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            Resumable — safe to close this page. Click "Rebrand existing
            library" again later to continue from where you left off.
          </p>
        </div>
      )}

      {/* Stopped status — shown after the admin pauses */}
      {!job.isRunning && job.stopped && (
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-3 text-xs text-amber-300">
          <Pause className="mr-1 inline size-3" />
          Paused after {job.processed} file{job.processed === 1 ? "" : "s"}.
          Resumable — {pendingCount} file{pendingCount === 1 ? "" : "s"} still pending.
        </div>
      )}

      {/* Help footer */}
      <details className="mt-3 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">
          How does branding work?
        </summary>
        <div className="mt-2 space-y-1 pl-3">
          <p>
            • Every new upload gets a Learnyx cover page (page 1) and a small
            corner watermark on every existing page — <strong>additive only</strong>, the
            original content is never modified or removed.
          </p>
          <p>
            • The "Rebrand existing library" button processes resources one
            at a time. It's resumable — close the page, come back later, click again,
            it picks up from where it left off.
          </p>
          <p>
            • Each file's branding version is tracked (currently v{version}). When
            the cover design changes, we can re-run branding only on resources with
            an older version rather than reprocessing everything.
          </p>
          <p>
            • The original unbranded file is preserved in R2 and accessible via
            the admin-only "Download original" button (audit logged).
          </p>
        </div>
      </details>
    </div>
  );
}

// Avoid unused warnings
void Eye;
void X;
void AlertTriangle;
void RotateCw;
void CheckCircle2;
