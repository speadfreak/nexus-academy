// Practice-from-mistake engine verification — imports the REAL exported
// pure functions from src/convex/learning.ts and asserts the documented
// behavior. Run with bun (it loads TypeScript directly):
//   bun run scripts/verify-practice-engine.mjs
//
// Covers the Phase 2 "Practice similar" decision rules:
//   • topic-name normalization (canonical + printed-text matching)
//   • candidate ranking (verified → official → newer → variety)
//   • one-per-paper diversity pick with backfill
//   • one review event per session (correct/incorrect/mixed/empty)
//   • the shared SRS ladder (same rule as direct Mistake Lab review)
//   • mastery evidence math (window + recency decay)
//
// DB-level guarantees (ownership, dedupeKey uniqueness, exactly-once
// reviewApplied, idempotent submissions) are enforced by Convex
// transactions + indexes in learning.ts and are covered by code review
// and the type checker — they cannot run without a deployment.

import {
  comparePracticeCandidates,
  computeEvidenceScore,
  computePracticeReview,
  confidenceFor,
  nextMistakeReviewState,
  normalizeTopicName,
  pickWithPaperDiversity,
} from "../src/convex/learning.ts";

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name} — ${detail ?? ""}`);
  }
}

// ── 1. Topic matching ────────────────────────────────────────────────────
console.log("── Topic matching ──");
check(
  "case + whitespace differences still match (canonical)",
  normalizeTopicName("  Circular   Motion ") === normalizeTopicName("circular motion"),
);
check("undefined/null topic never matches a real topic", normalizeTopicName(undefined) === "" && normalizeTopicName(null) === "");
check(
  "empty topic is falsy → question skipped, not 'unknown topic' matched",
  !normalizeTopicName("   "),
);
check(
  "partial topic text does NOT match (no invented equivalence)",
  normalizeTopicName("Circular Motion") !== normalizeTopicName("Circular Motion in 2D"),
);

// ── 2. Candidate ranking ─────────────────────────────────────────────────
console.log("── Candidate ranking ──");
const c = (over) => ({
  verifiedPaper: false,
  official: false,
  examYear: null,
  fromOriginalPaper: false,
  ...over,
});
const ranked = [
  c({ examYear: 2019 }),
  c({ verifiedPaper: true, examYear: 2015 }),
  c({ official: true, examYear: 2018 }),
  c({ examYear: 2020 }),
].sort(comparePracticeCandidates);
check("teacher-verified paper ranks first", ranked[0].verifiedPaper === true, JSON.stringify(ranked[0]));
check("official sitting outranks newer unverified", ranked[1].official === true, JSON.stringify(ranked[1]));
check(
  "newer exam year outranks older (same tier)",
  ranked[2].examYear === 2020 && ranked[3].examYear === 2019,
  JSON.stringify(ranked.slice(2)),
);
check(
  "original-mistake paper is deprioritized for variety",
  comparePracticeCandidates(c({ fromOriginalPaper: true }), c()) > 0 &&
    comparePracticeCandidates(c(), c({ fromOriginalPaper: true })) < 0,
);
check("yearless papers rank below any year", comparePracticeCandidates(c({ examYear: 2014 }), c({ examYear: null })) < 0);

// ── 3. Diversity pick ────────────────────────────────────────────────────
console.log("── Diversity pick ──");
const pool = [
  { contentId: "A", n: 1 },
  { contentId: "A", n: 2 },
  { contentId: "B", n: 1 },
  { contentId: "C", n: 1 },
  { contentId: "C", n: 2 },
  { contentId: "C", n: 3 },
];
const picked3 = pickWithPaperDiversity(pool, 3);
check(
  "one per paper first (A, B, C)",
  picked3.map((p) => p.contentId).join("") === "ABC",
  JSON.stringify(picked3),
);
const picked5 = pickWithPaperDiversity(pool, 5);
check(
  "backfill respects rank order after one-per-paper pass",
  picked5.map((p) => p.contentId).join("") === "ABCAC",
  JSON.stringify(picked5),
);
check("limit never exceeded", pickWithPaperDiversity(pool, 2).length === 2);

// ── 4. One review event per session ──────────────────────────────────────
console.log("── Practice session review ──");
const allCorrect = computePracticeReview([true, true, true]);
check("all correct → got_it", allCorrect.result === "got_it", JSON.stringify(allCorrect));
check("all correct → attemptsToFirstCorrect = 1", allCorrect.attemptsToFirstCorrect === 1);
const mixed = computePracticeReview([true, false, true]);
check(
  "mixed session → still_unsure (never inflates the ladder)",
  mixed.result === "still_unsure" && mixed.firstTryCorrect === 2,
  JSON.stringify(mixed),
);
check("first correct on attempt 2 recorded honestly", computePracticeReview([false, true]).attemptsToFirstCorrect === 2);
check("never correct → attemptsToFirstCorrect undefined", computePracticeReview([false, false]).attemptsToFirstCorrect === undefined);
check("single wrong attempt → still_unsure", computePracticeReview([false]).result === "still_unsure");
check("single correct attempt → got_it", computePracticeReview([true]).result === "got_it");
const empty = computePracticeReview([]);
check(
  "empty session flags still_unsure but engine applies no review (guard in applyPracticeReview)",
  empty.result === "still_unsure" && empty.firstTryCorrect === 0,
);

// ── 5. The shared SRS ladder (real function, not a mirror) ───────────────
console.log("── Shared SRS ladder ──");
const now = 1_700_000_000_000;
const m0 = { intervalDays: 0, correctReviewCount: 0, status: "open" };
const r1 = nextMistakeReviewState(m0, "got_it", now);
check("1st got_it → 1 day", r1.intervalDays === 1 && !isMastered(r1), JSON.stringify(r1));
const r2 = nextMistakeReviewState(r1, "got_it", now);
check(
  "2nd got_it → 3 days + MASTERED (two clean passes)",
  r2.intervalDays === 3 && r2.correctReviewCount === 2 && r2.status === "mastered",
  JSON.stringify(r2),
);
const u = nextMistakeReviewState(m0, "still_unsure", now);
check(
  "still_unsure → same-day recheck (+6h), streak reset",
  u.intervalDays === 0 && u.correctReviewCount === 0 && u.status === "open" && u.nextReviewAt === now + 6 * 3600 * 1000,
  JSON.stringify(u),
);
const reopened = nextMistakeReviewState({ intervalDays: 3, correctReviewCount: 2, status: "mastered" }, "still_unsure", now);
check("mastered mistake reopens on still_unsure", reopened.status === "open" && reopened.intervalDays === 0);
let state = { intervalDays: 3, correctReviewCount: 0, status: "open" };
let maxInterval = 0;
for (let i = 0; i < 8; i++) {
  state = nextMistakeReviewState(state, "got_it", now);
  maxInterval = Math.max(maxInterval, state.intervalDays);
}
check("reopened ladder caps at 21 days", maxInterval === 21, String(maxInterval));
check(
  "practice review uses the SAME rule: all-correct session = one got_it step",
  nextMistakeReviewState(m0, computePracticeReview([true]).result, now).intervalDays === 1,
);

// ── 6. Mastery evidence math ─────────────────────────────────────────────
console.log("── Mastery evidence ──");
check("no evidence → score 0 (never faked)", computeEvidenceScore([]) === 0);
check(
  "practice attempts append to the 20-window: 20 correct → 100",
  computeEvidenceScore(Array(20).fill(1)) === 100,
);
const oldMiss = computeEvidenceScore([0, ...Array(9).fill(1)]);
const newMiss = computeEvidenceScore([...Array(9).fill(1), 0]);
check(
  "a miss in the current practice session hurts more than an old one",
  newMiss < oldMiss && newMiss === 81 && oldMiss === 96,
  `old=${oldMiss} new=${newMiss}`,
);
check("confidence is honest from counts", confidenceFor(0) === "unassessed" && confidenceFor(2) === "low" && confidenceFor(5) === "fair" && confidenceFor(6) === "solid");

function isMastered(r) {
  return r.status === "mastered";
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
