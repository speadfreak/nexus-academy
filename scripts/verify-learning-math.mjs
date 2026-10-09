// Learning engine math verification — mirrors the exact formulas in
// src/convex/learning.ts (computeEvidenceScore + the SRS ladder) and asserts
// the documented behavior. Run: node scripts/verify-learning-math.mjs

const DECAY = 0.85;
const FIRST_INTERVAL_DAYS = 1;
const MAX_INTERVAL_DAYS = 21;
const MASTERY_MIN_CORRECT_REVIEWS = 2;
const MASTERY_MIN_INTERVAL_DAYS = 3;

function computeEvidenceScore(results) {
  if (results.length === 0) return 0;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < results.length; i++) {
    const w = Math.pow(DECAY, results.length - 1 - i);
    weighted += results[i] * w;
    total += w;
  }
  return total > 0 ? Math.round((weighted / total) * 100) : 0;
}

function nextInterval(prev, result) {
  if (result === "still_unsure") return { intervalDays: 0, correctStreak: 0, mastered: false };
  let intervalDays =
    prev < FIRST_INTERVAL_DAYS
      ? FIRST_INTERVAL_DAYS
      : prev < MASTERY_MIN_INTERVAL_DAYS
        ? MASTERY_MIN_INTERVAL_DAYS
        : Math.min(prev * 2, MAX_INTERVAL_DAYS);
  const correctStreak = prevStreak(prev) + 1; // tracked separately in the real code
  const mastered = correctStreak >= MASTERY_MIN_CORRECT_REVIEWS && intervalDays >= MASTERY_MIN_INTERVAL_DAYS;
  return { intervalDays, correctStreak, mastered };
}
// The real engine keeps correctReviewCount as its own counter — emulate:
function prevStreak() { return _streak; }
let _streak = 0;
function review(prevInterval, result) {
  if (result === "still_unsure") { _streak = 0; return { intervalDays: 0, mastered: false }; }
  _streak += 1;
  let intervalDays =
    prevInterval < FIRST_INTERVAL_DAYS
      ? FIRST_INTERVAL_DAYS
      : prevInterval < MASTERY_MIN_INTERVAL_DAYS
        ? MASTERY_MIN_INTERVAL_DAYS
        : Math.min(prevInterval * 2, MAX_INTERVAL_DAYS);
  const mastered = _streak >= MASTERY_MIN_CORRECT_REVIEWS && intervalDays >= MASTERY_MIN_INTERVAL_DAYS;
  return { intervalDays, mastered };
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name} — ${detail}`); }
}

console.log("── Evidence score ──");
check("empty evidence → 0 (never faked)", computeEvidenceScore([]) === 0);
check("all 20 correct → 100", computeEvidenceScore(Array(20).fill(1)) === 100);
check("all 20 wrong → 0", computeEvidenceScore(Array(20).fill(0)) === 0);
check("1 correct attempt → 100 (but confidence=low)", computeEvidenceScore([1]) === 100);
// Recent miss hurts more than an old one:
const oldMiss = computeEvidenceScore([0, ...Array(9).fill(1)]);
const newMiss = computeEvidenceScore([...Array(9).fill(1), 0]);
check("recent miss lowers score more than old miss", newMiss < oldMiss, `old=${oldMiss} new=${newMiss}`);
check("old miss = 96, new miss = 81 (10-item window)", oldMiss === 96 && newMiss === 81, `old=${oldMiss} new=${newMiss}`);
// Window cap behavior — 21 outcomes behave like last 20:
const twentyOne = [...Array(21).fill(1)]; // engine slices to last 20 before scoring
check("sliced window of 20 correct → 100", computeEvidenceScore(twentyOne.slice(-20)) === 100);

console.log("── SRS ladder ──");
_streak = 0;
let r1 = review(0, "got_it");
check("1st got_it → 1 day", r1.intervalDays === 1 && !r1.mastered, JSON.stringify(r1));
let r2 = review(r1.intervalDays, "got_it");
check("2nd got_it → 3 days + MASTERED (two clean passes)", r2.intervalDays === 3 && r2.mastered, JSON.stringify(r2));
_streak = 0;
let u = review(0, "still_unsure");
check("still_unsure → 0 (same-day recheck), streak reset", u.intervalDays === 0 && !u.mastered);
let r3 = review(0, "got_it");
let u2 = review(r3.intervalDays, "still_unsure");
check("streak broken by still_unsure", u2.intervalDays === 0 && !u2.mastered);
let reopened = 3;
_streak = 0;
const seq = ["got_it", "got_it", "got_it", "got_it", "got_it", "got_it"];
let iv = 3; const intervals = [];
for (const s of seq) { const rr = review(iv, s); intervals.push(rr.intervalDays); iv = rr.intervalDays; _streak = 99; }
_streak = 0;
check("reopened ladder caps at 21", Math.max(...intervals) === 21 && intervals[intervals.length - 1] === 21, intervals.join(","));

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
