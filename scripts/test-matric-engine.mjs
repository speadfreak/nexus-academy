// Learnyx Matric OS — pure-logic regression tests (selection + scoring).
// Run: bun scripts/test-matric-engine.mjs
// These tests run the REAL src/lib/matric modules with real fixtures.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// Strip TS types via bun's transpiler — we import the actual source files.
const { transformSync } = require("esbuild");
function loadTs(path) {
  const src = readFileSync(join(here, "..", path), "utf8");
  const js = transformSync(src, { loader: "ts", format: "cjs" }).code;
  const module = { exports: {} };
  const fn = new Function("exports", "require", "module", js);
  fn(module.exports, require, module);
  return module.exports;
}

const sel = loadTs("src/lib/matric/selection.ts");
const scoring = loadTs("src/lib/matric/scoring.ts");
const types = null; // types-only module

let pass = 0;
let fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name);
  }
}
function eq(name, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  check(`${name} (got ${JSON.stringify(a)?.slice(0, 80)}, want ${JSON.stringify(b)?.slice(0, 80)})`, ok);
}

// ── Fixture builder ───────────────────────────────────────────────────────
let idCounter = 0;
function makeQ(overrides = {}) {
  idCounter++;
  return {
    vaultId: `v${idCounter}`,
    contentId: "paper1",
    questionNumber: idCounter,
    subjectId: "math",
    stem: `Question ${idCounter}: solve x² + ${idCounter}x = 0`,
    choices: [
      { label: "A", text: `Option A ${idCounter}` },
      { label: "B", text: `Option B ${idCounter}` },
      { label: "C", text: `Option C ${idCounter}` },
      { label: "D", text: `Option D ${idCounter}` },
    ],
    answerLabel: "B",
    explanation: "Because algebra.",
    topicText: idCounter % 2 === 0 ? "Quadratic Equations" : "Sequences",
    examYear: 2015 + (idCounter % 8),
    paperTitle: "ESSLCE Mathematics 2015",
    verificationTier: "parser_verified",
    examEligible: true,
    duplicateKey: `dk-${idCounter}`,
    ...overrides,
  };
}

// ── hashSeed / mulberry32 determinism ─────────────────────────────────────
check("hashSeed deterministic", sel.hashSeed("abc") === sel.hashSeed("abc"));
check("hashSeed differs on input", sel.hashSeed("abc") !== sel.hashSeed("abd"));
const r1 = sel.mulberry32("seed-X");
const r2 = sel.mulberry32("seed-X");
check("mulberry32 same seed same sequence", r1() === r2() && r1() === r2());

// ── seededShuffle ─────────────────────────────────────────────────────────
const base = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const s1 = sel.seededShuffle(base, sel.mulberry32("s1"));
const s2 = sel.seededShuffle(base, sel.mulberry32("s1"));
const s3 = sel.seededShuffle(base, sel.mulberry32("s2"));
eq("shuffle deterministic", s1, s2);
check("shuffle base intact", JSON.stringify(base) === JSON.stringify([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
check("shuffle is a permutation", [...s1].sort((a, b) => a - b).join(",") === "1,2,3,4,5,6,7,8,9,10");
check("different seeds usually differ", JSON.stringify(s1) !== JSON.stringify(s3));

// ── selectQuestions: eligibility guards ───────────────────────────────────
{
  const pool = [
    makeQ(),
    makeQ({ examEligible: false, answerLabel: "A" }),
    makeQ({ answerLabel: undefined }),
    makeQ({ answerLabel: "E" }), // label not among choices
    makeQ({ choices: [{ label: "A", text: "only" }], answerLabel: "A" }),
    makeQ(),
  ];
  const res = sel.selectQuestions({ pool, count: 10, seed: "s" });
  eq("eligibility: only valid questions selected", res.selected.length, 2);
  eq("poolSize reflects eligible pool", res.poolSize, 2);
}

// ── selectQuestions: no duplicates ────────────────────────────────────────
{
  const q = makeQ();
  const pool = [q, { ...q }, { ...q, vaultId: "v-dup-id" }, makeQ(), makeQ(), makeQ()];
  const res = sel.selectQuestions({ pool, count: 10, seed: "s" });
  const ids = res.selected.map((x) => x.vaultId);
  eq("dup vaultId collapsed", new Set(ids).size, ids.length);
  eq("dup content collapsed to 1", res.poolSize, 4);
}

// ── selectQuestions: determinism ──────────────────────────────────────────
{
  const pool = Array.from({ length: 60 }, () => makeQ());
  const a = sel.selectQuestions({ pool, count: 20, seed: "exam-seed-7" });
  const b = sel.selectQuestions({ pool, count: 20, seed: "exam-seed-7" });
  eq("same seed → identical selection", a.selected.map((q) => q.vaultId), b.selected.map((q) => q.vaultId));
  const c = sel.selectQuestions({ pool, count: 20, seed: "exam-seed-8" });
  check("different seed → different selection", JSON.stringify(a.selected.map((q) => q.vaultId)) !== JSON.stringify(c.selected.map((q) => q.vaultId)));
  // Session reload simulation: same seed again much later
  const d = sel.selectQuestions({ pool, count: 20, seed: "exam-seed-7" });
  eq("reload reproducibility", d.selected.map((q) => q.vaultId), a.selected.map((q) => q.vaultId));
}

// ── selectQuestions: topic balance ────────────────────────────────────────
{
  const pool = [
    ...Array.from({ length: 50 }, (_, i) => makeQ({ topicText: "Algebra", topicId: "t-alg", vaultId: `alg-${i}` })),
    ...Array.from({ length: 6 }, (_, i) => makeQ({ topicText: "Vectors", topicId: "t-vec", vaultId: `vec-${i}` })),
    ...Array.from({ length: 6 }, (_, i) => makeQ({ topicText: "Probability", topicId: "t-prob", vaultId: `prob-${i}` })),
  ];
  const res = sel.selectQuestions({ pool, count: 20, seed: "bal" });
  const counts = Object.values(res.byTopic);
  const maxCount = Math.max(...counts);
  check(
    `round-robin prevents topic domination (max ${maxCount} of 20; alg pool=50)`,
    maxCount <= 10,
  );
  check("all three topics represented", Object.keys(res.byTopic).length === 3);
  check("no duplicate vaultIds in selection", new Set(res.selected.map((q) => q.vaultId)).size === res.selected.length);
}

// ── selectQuestions: maxPerTopic cap + top-up ─────────────────────────────
{
  const pool = Array.from({ length: 30 }, (_, i) => makeQ({ topicText: "Only Topic", topicId: "t-only", vaultId: `ot-${i}` }));
  const res = sel.selectQuestions({ pool, count: 10, seed: "cap", maxPerTopic: 3 });
  eq("cap respected then topped up to count", res.selected.length, 10);
}

// ── selectQuestions: freshness ────────────────────────────────────────────
{
  const pool = Array.from({ length: 40 }, () => makeQ());
  const recent = pool.slice(0, 10).map((q) => q.vaultId);
  const res = sel.selectQuestions({ pool, count: 20, seed: "fresh", recentVaultIds: recent });
  check("fresh questions excluded when pool allows", res.selected.every((q) => !recent.includes(q.vaultId)));
  eq("freshPoolSize", res.freshPoolSize, 30);
  check("freshnessRelaxed false", res.freshnessRelaxed === false);
  // Now coverage too small → relaxed fallback, still count satisfied
  const res2 = sel.selectQuestions({ pool: pool.slice(0, 25), count: 20, seed: "fresh", recentVaultIds: recent });
  eq("relaxed fallback still satisfies count", res2.selected.length, 20);
  check("freshnessRelaxed flagged", res2.freshnessRelaxed === true);
}

// ── selectQuestions: insufficient coverage returns what exists ────────────
{
  const pool = Array.from({ length: 5 }, () => makeQ());
  const res = sel.selectQuestions({ pool, count: 20, seed: "short" });
  eq("never invents questions", res.selected.length, 5);
}

// ── scoreSession ──────────────────────────────────────────────────────────
{
  const qs = [
    { ...makeQ({ vaultId: "q1", questionNumber: 1, topicId: "t1", topicText: "Algebra" }), answerLabel: "A", answerText: "Option A" },
    { ...makeQ({ vaultId: "q2", questionNumber: 2, topicId: "t1", topicText: "Algebra" }), answerLabel: "B", answerText: "Option B 2" },
    { ...makeQ({ vaultId: "q3", questionNumber: 3, topicId: "t2", topicText: "Vectors" }), answerLabel: "C", answerText: "Option C" },
    { ...makeQ({ vaultId: "q4", questionNumber: 4, topicId: undefined, topicText: undefined }), answerLabel: "D", answerText: "Option D" },
  ].map((q) => ({ ...q, subjectName: "Mathematics" }));
  const sections = [{ subjectId: "math", subjectName: "Mathematics", startIndex: 0, endIndex: 4, questionCount: 4 }];
  // Student: q1 correct (A), q2 wrong (A), q3 unanswered (""), q4 tampered label "Z" → unanswered
  const res = scoring.scoreSession({
    questions: qs,
    sections,
    answers: ["A", "A", "", "Z"],
  });
  eq("correctCount", res.correctCount, 1);
  eq("incorrectCount", res.incorrectCount, 1);
  eq("unansweredCount (incl. tampered label)", res.unansweredCount, 2);
  eq("scorePct", res.scorePct, 25);
  eq("subject breakdown", res.subjectBreakdown, [{ subjectId: "math", subjectName: "Mathematics", correct: 1, total: 4, scorePct: 25 }]);
  eq("perQuestion count", res.perQuestion.length, 4);
  check("q4 tampered label treated unanswered", res.perQuestion[3].answered === false);
  const topics = Object.fromEntries(res.topicBreakdown.map((t) => [t.topicText, t]));
  eq("topic Algebra 1/2", [topics["Algebra"].correct, topics["Algebra"].total], [1, 2]);
  eq("topic Vectors 0/1", [topics["Vectors"].correct, topics["Vectors"].total], [0, 1]);
  eq("topic General 0/1", [topics["General"].correct, topics["General"].total], [0, 1]);
}

// ── scoreSession: empty exam edge ─────────────────────────────────────────
{
  const res = scoring.scoreSession({ questions: [], sections: [], answers: [] });
  eq("empty exam pct 0", res.scorePct, 0);
}

// ── scoreSession: per-question data integrity ─────────────────────────────
{
  const q = { ...makeQ({ vaultId: "s1", contentId: "paper9", questionNumber: 7, examYear: 2016, sourcePage: 3 }), answerLabel: "C", answerText: "Option C", subjectName: "English" };
  const res = scoring.scoreSession({
    questions: [q],
    sections: [{ subjectId: "eng", subjectName: "English", startIndex: 0, endIndex: 1, questionCount: 1 }],
    answers: ["C"],
  });
  const row = res.perQuestion[0];
  check("provenance preserved", row.contentId === "paper9" && row.questionNumber === 7 && row.examYear === 2016 && row.sourcePage === 3);
  check("student answer text resolved", row.studentAnswerText === q.choices[2].text);
  check("explanation carried", row.explanation === "Because algebra.");
}

console.log(`\nMATRIC ENGINE TESTS: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log("FAILURES:");
  failures.forEach((f) => console.log("  ✗ " + f));
  process.exit(1);
}
