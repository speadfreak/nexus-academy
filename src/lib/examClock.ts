// Personal exam clock — PURE functions, no Convex/React imports.
//
// Per-question timing captured client-side while a student works through
// questions (mock exam sections, digital papers, focused practice). These
// helpers turn the raw ms arrays into honest pace statistics.
//
// Honesty rules baked in:
//   • A pace number is only shown when at least MIN_TIMED_QUESTIONS questions
//     actually carry timing data — never from one or two samples.
//   • The "budget" is derived from the sitting's own structure
//     (timeAllotted / questionCount) and is explicitly a PRACTICE AID —
//     it is not a claim about the official exam's per-question allocation.
//   • Untimed practice (budget null) still reports median/slowest, and
//     never an over-budget figure (nothing was over any budget).

export const MIN_TIMED_QUESTIONS = 3;
export const SLOWEST_COUNT = 3;

export interface PaceStats {
  timedCount: number;
  medianMs: number | null;
  meanMs: number | null;
  budgetMsPerQuestion: number | null;
  overBudgetCount: number; // 0 when budgetMsPerQuestion is null
  overBudgetShare: number; // 0..1 of timed questions; 0 when no budget
  slowest: { index: number; ms: number }[]; // top SLOWEST_COUNT, descending
  hasSignal: boolean; // timedCount >= MIN_TIMED_QUESTIONS
}

/**
 * @param timeMs per-question time in ms; undefined entries are untimed and
 *        excluded from every statistic (they still occupy their index so
 *        callers can map back to question numbers).
 * @param budgetMsPerQuestion derived pace target for the sitting, or null
 *        for untimed practice.
 */
export function computePaceStats(
  timeMs: (number | undefined)[],
  budgetMsPerQuestion: number | null,
): PaceStats {
  const timed = timeMs
    .map((ms, index) => ({ index, ms }))
    .filter((x): x is { index: number; ms: number } => typeof x.ms === "number" && x.ms >= 0);

  const sorted = timed.map((x) => x.ms).slice().sort((a, b) => a - b);
  const medianMs =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[(sorted.length - 1) / 2]!
        : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
  const meanMs =
    timed.length === 0
      ? null
      : Math.round(timed.reduce((s, x) => s + x.ms, 0) / timed.length);

  const slowest = timed
    .slice()
    .sort((a, b) => b.ms - a.ms)
    .slice(0, SLOWEST_COUNT);

  let overBudgetCount = 0;
  if (budgetMsPerQuestion !== null && budgetMsPerQuestion > 0) {
    overBudgetCount = timed.filter((x) => x.ms > budgetMsPerQuestion).length;
  }

  return {
    timedCount: timed.length,
    medianMs,
    meanMs,
    budgetMsPerQuestion,
    overBudgetCount,
    overBudgetShare: timed.length > 0 ? overBudgetCount / timed.length : 0,
    slowest,
    hasSignal: timed.length >= MIN_TIMED_QUESTIONS,
  };
}

/** "12s" / "1m 05s" — compact, tabular-friendly. */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/**
 * The sitting's own pace budget: timeAllotted ÷ question count. Used only
 * when BOTH numbers are real and positive; otherwise null (untimed).
 */
export function paceBudgetMs(
  timeAllottedSeconds: number,
  questionCount: number,
): number | null {
  if (!Number.isFinite(timeAllottedSeconds) || timeAllottedSeconds <= 0) return null;
  if (!Number.isInteger(questionCount) || questionCount <= 0) return null;
  return Math.round((timeAllottedSeconds / questionCount) * 1000);
}
