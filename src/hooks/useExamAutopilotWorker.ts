// useExamAutopilotWorker — the idle-capacity conversion engine.
//
// Mounted ONCE on the Exam Prep hub. While any student simply has Learnyx
// open, this hook quietly converts queued past-exam papers in the
// background — so the library is digital BEFORE anyone opens a paper.
//
// Safety rails (the free AI tier stays alive no matter how many tabs):
//   • IDLE ONLY — the backend peek returns null the moment ANY conversion
//     is running platform-wide (student-demanded included). Crowd workers
//     never take a slot a waiting student could use.
//   • BATCH PRIORITY — converted papers keep batch priority in the queue;
//     a student who opens an unconverted paper always outranks autopilot.
//   • ONE AT A TIME per tab, with a cooldown between papers.
//   • VISIBLE TAB ONLY — a backgrounded phone browser does nothing.
//   • Fully silent — no UI, no toasts; it's infrastructure, not a feature.
//
// Every paper converted here is cached in the database forever — the same
// conversion every other surface (player, admin console) would produce,
// because it IS the same pipeline (runPaperConversion).

import { useConvex, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";

const COOLDOWN_MS = 15_000;

export function useExamAutopilotWorker(): void {
  const convex = useConvex();
  const crowdJob = useQuery(api.examPrepDigital.peekCrowdJob, {});
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  // Bumped on visibilitychange so a tab that comes back to the foreground
  // re-evaluates immediately instead of waiting for the next query update.
  const [visibilityTick, setVisibilityTick] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const onVis = () => setVisibilityTick((t) => t + 1);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const runJob = useCallback(
    async (contentId: string) => {
      busyRef.current = true;
      try {
        const { runPaperConversion } = await import("@/lib/batchConvert");
        await runPaperConversion(convex as never, contentId, { batch: true });
      } catch {
        // Silent by design — the queue row's lastError carries the detail
        // for the admin console, and the autopilot tick auto-retries.
      } finally {
        if (mountedRef.current) {
          window.setTimeout(() => {
            busyRef.current = false;
            setVisibilityTick((t) => t + 1); // re-arm the loop
          }, COOLDOWN_MS);
        }
      }
    },
    [convex],
  );

  useEffect(() => {
    if (!crowdJob || busyRef.current) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void runJob(crowdJob.contentId);
    // visibilityTick re-arms after cooldown / foregrounding.
  }, [crowdJob, runJob, visibilityTick]);
}
