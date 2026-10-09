// Mock intelligence + exam clock verification — imports the REAL exported
// pure functions from src/lib/mockInsights.ts and src/lib/examClock.ts and
// asserts the documented behavior. Run with bun (it loads TypeScript
// directly):
//   bun run scripts/verify-mock-insights.mjs
//
// Covers the Phase 3 decision rules:
//   • per-subject deltas (id match, name fallback, untested subjects → null)
//   • cross-exam insights (improvement counts, weakest/strongest, totals)
//   • pace statistics (median, over-budget share, slowest, signal gate)
//   • pace budget derivation (allotted ÷ count, sane rejects)
//
// DB-level guarantees (ownership, previous-exam selection, timeMs
// sanitization/clamping, idempotent completion) are enforced by Convex
// transactions + indexes in mockExam.ts and are covered by code review and
// the type checker — they cannot run without a deployment.

import {
  computeMockInsights,
  computeSubjectDeltas,
} from "../src/lib/mockInsights.ts";
import {
  computePaceStats,
  formatDurationMs,
  paceBudgetMs,
} from "../src/lib/examClock.ts";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} — ${detail ?? ""}`);
  }
}

const sec = (over = {}) => ({
  subjectId: undefined,
  subjectName: "Subject",
  score: 50,
  correctCount: 5,
  totalQuestions: 10,
  timeSpentSeconds: 600,
  ...over,
});

// ── 1. Subject deltas ────────────────────────────────────────────────────
console.log("── Subject deltas ──");
const cur = [
  sec({ subjectId: "s1", subjectName: "Mathematics", score: 70 }),
  sec({ subjectId: "s2", subjectName: "Biology", score: 55 }),
  sec({ subjectId: "s3", subjectName: "Physics", score: 80 }),
];
const prev = [
  sec({ subjectId: "s1", subjectName: "Mathematics", score: 60 }),
  sec({ subjectId: "s2", subjectName: "Biology", score: 65 }),
  sec({ subjectId: "s9", subjectName: "Geography", score: 40 }),
];
const deltas = computeSubjectDeltas(cur, prev);
check("matching id produces the real delta", deltas[0].delta === 10, JSON.stringify(deltas[0]));
check("declining subject gets a negative delta", deltas[1].delta === -10);
check(
  "subject the previous sitting never tested → delta null, never 0",
  deltas[2].delta === null && deltas[2].prevScore === null,
);
check("previous-only subject is not invented into current", deltas.length === 3);
const byName = computeSubjectDeltas(
  [sec({ subjectName: "  English " })],
  [sec({ subjectName: "english", score: 44 })],
);
check(
  "case/whitespace-insensitive name fallback when ids are absent",
  byName[0].delta === 6 && byName[0].prevScore === 44,
  JSON.stringify(byName[0]),
);

// ── 2. Cross-exam insights ───────────────────────────────────────────────
console.log("── Cross-exam insights ──");
const firstSitting = computeMockInsights(cur, null);
check(
  "first sitting: hasPrevious=false, no invented deltas",
  firstSitting.hasPrevious === false &&
    firstSitting.totalDelta === null &&
    firstSitting.previousScore === null,
);
check(
  "first sitting still reports weakest/strongest from real results",
  firstSitting.weakest?.subjectName === "Biology" &&
    firstSitting.strongest?.subjectName === "Physics",
);
const insights = computeMockInsights(cur, prev);
check(
  "totalScore derives from real correct/total (15/30 → 50), not the per-subject score field",
  insights.totalScore === 50,
  String(insights.totalScore),
);
check(
  "improvement/decline counts count actual deltas only",
  insights.improvedCount === 1 && insights.declinedCount === 1 && insights.flatCount === 0,
  JSON.stringify({ i: insights.improvedCount, d: insights.declinedCount }),
);
check(
  "weakest is the lowest real score (ties → first)",
  insights.weakest?.subjectName === "Biology" && insights.weakest?.score === 55,
);
const tie = computeMockInsights(
  [sec({ subjectName: "A", score: 50 }), sec({ subjectName: "B", score: 50 })],
  null,
);
check("score tie → deterministic first-subject weakest", tie.weakest?.subjectName === "A");
const empty = computeMockInsights([], null);
check("empty sitting → zero-safe totals, null extremes", empty.totalScore === 0 && empty.weakest === null);

// ── 3. Pace statistics ───────────────────────────────────────────────────
console.log("── Pace statistics ──");
const BUDGET = 60_000; // 60s per question
const pace = computePaceStats(
  [30_000, 90_000, undefined, 45_000, 120_000, 20_000, 75_000],
  BUDGET,
);
check("untimed entries are excluded, timed counted", pace.timedCount === 6);
check(
  "median of 6 timed = average of middle pair (45s,75s → 60s)",
  pace.medianMs === 60_000,
  String(pace.medianMs),
);
check(
  "over-budget share counts only questions beyond the budget (3 of 6)",
  pace.overBudgetCount === 3 && Math.abs(pace.overBudgetShare - 0.5) < 1e-9,
  `${pace.overBudgetCount}/${pace.overBudgetShare}`,
);
check(
  "slowest list is top-3 descending",
  pace.slowest.length === 3 &&
    pace.slowest[0].ms === 120_000 &&
    pace.slowest[1].ms === 90_000 &&
    pace.slowest[2].ms === 75_000,
  JSON.stringify(pace.slowest),
);
check("signal gate: 6 timed ≥ 3 → hasSignal", pace.hasSignal === true);
const thin = computePaceStats([5_000, undefined, undefined], BUDGET);
check(
  "thin data (1 timed) reports numbers but NO signal — UI must hide",
  thin.hasSignal === false && thin.timedCount === 1,
);
const untimed = computePaceStats([10_000, 20_000, 30_000], null);
check(
  "untimed practice: no budget → no over-budget claim, median still real",
  untimed.budgetMsPerQuestion === null &&
    untimed.overBudgetCount === 0 &&
    untimed.overBudgetShare === 0 &&
    untimed.medianMs === 20_000,
);
const none = computePaceStats([], BUDGET);
check("no timing data at all → nulls, never zeros pretending to be data", none.medianMs === null && none.meanMs === null && none.slowest.length === 0);
const even = computePaceStats([10_000, 30_000], null);
check("even-count median averages the middle pair", even.medianMs === 20_000, String(even.medianMs));

// ── 4. Pace budget derivation ────────────────────────────────────────────
console.log("── Pace budget ──");
check("3000s ÷ 50 questions → 60s", paceBudgetMs(3000, 50) === 60_000);
check("untimed sitting → null budget", paceBudgetMs(0, 50) === null);
check("zero questions → null (never ÷0)", paceBudgetMs(3000, 0) === null);
check("non-integer question count rejected", paceBudgetMs(3000, 50.5) === null);

// ── 5. Formatting ────────────────────────────────────────────────────────
console.log("── Formatting ──");
check("45.2s formats as 45s", formatDurationMs(45_200) === "45s");
check("65s formats as 1m 05s", formatDurationMs(65_000) === "1m 05s");
check("garbage input → em dash, never NaN", formatDurationMs(Number.NaN) === "—" && formatDurationMs(-5) === "—");

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
