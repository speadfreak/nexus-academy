// MATRIC OS — Assembler unit tests (Phase 11).
// Run: bun scripts/matric-assembler.test.ts
// Pure-logic verification of the deterministic assembly engine + the seed
// bank's structural integrity. No Convex, no network.

import {
  assembleExam,
  evaluateCoverage,
  reduceSections,
  hashSeed,
  mulberry32,
  normalizeTopic,
  seededShuffle,
  sortCandidates,
  type VaultCandidate,
} from "../src/lib/matricAssembler";
import { SEED_BANK } from "../src/convex/matricSeedBank";
import {
  MATRIC_BLUEPRINTS,
  fullSimulationSections,
  getBlueprintByMode,
  sectionTitle,
} from "../src/convex/matricBlueprints";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

function makeCandidate(i: number, subjectSlug: string, topic?: string, extra: Partial<VaultCandidate> = {}): VaultCandidate {
  return {
    questionId: `q${i}`,
    fingerprint: `${subjectSlug}:${String(i).padStart(4, "0")}`,
    subjectSlug,
    topicText: topic,
    accessPolicy: "free",
    sourceType: "seed_practice",
    verificationStatus: "verified",
    ...extra,
  };
}

// ── 1. RNG determinism ───────────────────────────────────────────────
console.log("\n[1] Seeded RNG");
{
  const rngA = mulberry32(hashSeed("user1:subject_mock:123:42"));
  const rngB = mulberry32(hashSeed("user1:subject_mock:123:42"));
  const rngC = mulberry32(hashSeed("user1:subject_mock:123:43"));
  const seqA = Array.from({ length: 10 }, () => rngA());
  const seqB = Array.from({ length: 10 }, () => rngB());
  const seqC = Array.from({ length: 10 }, () => rngC());
  check("same seed → identical sequence", JSON.stringify(seqA) === JSON.stringify(seqB));
  check("different seed → different sequence", JSON.stringify(seqA) !== JSON.stringify(seqC));
  check("values in [0,1)", seqA.every((v) => v >= 0 && v < 1));
  const shuffleA = seededShuffle([1, 2, 3, 4, 5], mulberry32(hashSeed("x")));
  const shuffleB = seededShuffle([1, 2, 3, 4, 5], mulberry32(hashSeed("x")));
  check("seeded shuffle deterministic", JSON.stringify(shuffleA) === JSON.stringify(shuffleB));
  check(
    "seeded shuffle preserves multiset",
    JSON.stringify([...shuffleA].sort()) === JSON.stringify([1, 2, 3, 4, 5]),
  );
  check(
    "sortCandidates orders by fingerprint",
    JSON.stringify(sortCandidates([makeCandidate(3, "x"), makeCandidate(1, "x"), makeCandidate(2, "x")]).map((c) => c.fingerprint)) ===
      JSON.stringify(["x:0001", "x:0002", "x:0003"]),
  );
  check("normalizeTopic strips case/punct", normalizeTopic("  Cell Biology: Part-1! ") === "cell biology part 1");
}

// ── 2. Core assembly ─────────────────────────────────────────────────
console.log("\n[2] Deterministic assembly");
{
  const pool = Array.from({ length: 60 }, (_, i) => makeCandidate(i, "mathematics", `Topic ${i % 5}`));
  const sections = [
    { subjectSlug: "mathematics", subjectId: "s1", subjectName: "Mathematics", count: 20, timeAllottedSeconds: 1200 },
  ];
  const opts = { seed: "seed-abc", sections, candidatesBySubject: { mathematics: pool } };
  const plan1 = assembleExam(opts);
  const plan2 = assembleExam(opts);
  check("same inputs → identical plan", JSON.stringify(plan1) === JSON.stringify(plan2));
  check("picks requested count", plan1.totalQuestions === 20 && plan1.totalShortfall === 0);
  const fps = plan1.sections[0]!.picked.map((p) => p.fingerprint);
  check("no duplicates within section", new Set(fps).size === fps.length);
  const topics = new Set(plan1.sections[0]!.picked.map((p) => normalizeTopic(p.topicText)));
  check("stratified across 5 topics", topics.size === 5, `got ${topics.size}`);
  check("seed echoed in plan", plan1.seed === "seed-abc");

  // Pool order must not matter (DB iteration independence).
  const shuffledPool = seededShuffle(pool, mulberry32(999));
  const plan3 = assembleExam({ ...opts, candidatesBySubject: { mathematics: shuffledPool } });
  check(
    "pool iteration order does not change outcome",
    JSON.stringify(plan1.sections[0]!.picked.map((p) => p.fingerprint)) ===
      JSON.stringify(plan3.sections[0]!.picked.map((p) => p.fingerprint)),
  );
}

// ── 3. Honesty: shortfalls never invented away ───────────────────────
console.log("\n[3] Shortfall honesty");
{
  const smallPool = Array.from({ length: 5 }, (_, i) => makeCandidate(i, "biology", "Cells"));
  const plan = assembleExam({
    seed: "s",
    sections: [{ subjectSlug: "biology", subjectId: "s2", subjectName: "Biology", count: 20, timeAllottedSeconds: 600 }],
    candidatesBySubject: { biology: smallPool },
  });
  check("shortfall reported, not padded", plan.totalQuestions === 5 && plan.totalShortfall === 15);
}

// ── 4. Reuse policy ──────────────────────────────────────────────────
console.log("\n[4] Recency exclusion");
{
  const pool = Array.from({ length: 40 }, (_, i) => makeCandidate(i, "english", "Grammar"));
  const exclude = new Set(pool.slice(0, 10).map((c) => c.fingerprint));
  const plan = assembleExam({
    seed: "s",
    sections: [{ subjectSlug: "english", subjectId: "s3", subjectName: "English", count: 20, timeAllottedSeconds: 600 }],
    candidatesBySubject: { english: pool },
    excludeFingerprints: exclude,
  });
  const fresh = plan.sections[0]!.picked.every((p) => !exclude.has(p.fingerprint));
  check("excluded fingerprints never picked when pool allows", fresh);

  // Forced reuse only when fresh pool can't fill the count.
  const excludeMost = new Set(pool.slice(0, 35).map((c) => c.fingerprint));
  const plan2 = assembleExam({
    seed: "s",
    sections: [{ subjectSlug: "english", subjectId: "s3", subjectName: "English", count: 10, timeAllottedSeconds: 600 }],
    candidatesBySubject: { english: pool },
    excludeFingerprints: excludeMost,
  });
  const fresh2 = plan2.sections[0]!.picked.filter((p) => !excludeMost.has(p.fingerprint)).length;
  check(
    "prefers fresh, recycles only the shortfall",
    plan2.totalQuestions === 10 && fresh2 === 5,
    `fresh=${fresh2}`,
  );
}

// ── 5. Access + verification filters (upstream contract) ────────────
console.log("\n[5] Unverified handling");
{
  const pool = [
    makeCandidate(1, "physics", "Optics"),
    makeCandidate(2, "physics", "Optics", { verificationStatus: "unverified" }),
    makeCandidate(3, "physics", "Optics", { verificationStatus: "unverified" }),
  ];
  const strict = assembleExam({
    seed: "s",
    sections: [{ subjectSlug: "physics", subjectId: "s4", subjectName: "Physics", count: 3, timeAllottedSeconds: 300 }],
    candidatesBySubject: { physics: pool },
  });
  check("unverified excluded by default", strict.totalQuestions === 1);
  const lenient = assembleExam({
    seed: "s",
    sections: [{ subjectSlug: "physics", subjectId: "s4", subjectName: "Physics", count: 3, timeAllottedSeconds: 300 }],
    candidatesBySubject: { physics: pool },
    allowUnverified: true,
  });
  check("allowUnverified includes them when explicitly enabled", lenient.totalQuestions === 3);
}

// ── 6. Coverage evaluation + graceful reduction ──────────────────────
console.log("\n[6] Coverage evaluation");
{
  const sections = [
    { subjectSlug: "english", subjectId: "a", subjectName: "English", count: 50, timeAllottedSeconds: 3000 },
    { subjectSlug: "mathematics", subjectId: "b", subjectName: "Mathematics", count: 50, timeAllottedSeconds: 3000 },
  ];
  const fullBank = { english: 60, mathematics: 55 };
  const evFull = evaluateCoverage(sections, fullBank, 10);
  check("full bank eligible", evFull.ok && evFull.perSection.every((s) => s.ok));

  const partialBank = { english: 25, mathematics: 12 };
  const evPartial = evaluateCoverage(sections, partialBank, 10);
  check("reducible bank viable", evPartial.ok && !evPartial.perSection.every((s) => s.ok));

  const emptyBank = { english: 3, mathematics: 0 };
  const evEmpty = evaluateCoverage(sections, emptyBank, 10);
  check("insufficient bank rejected", !evEmpty.ok);

  const reduced = reduceSections(sections, partialBank, 10);
  check(
    "reduceSections trims honestly + flags reduced",
    reduced !== null && reduced.reduced === true && reduced.sections[0]!.count === 25 && reduced.sections[1]!.count === 12,
  );
  const unreducible = reduceSections(sections, emptyBank, 10);
  check("unreducible → null (fail gracefully)", unreducible === null);
}

// ── 7. Weighted topics (Weakness Challenge) ──────────────────────────
console.log("\n[7] Weighted topic bias");
{
  const weakPool = [
    ...Array.from({ length: 10 }, (_, i) => makeCandidate(1000 + i, "chemistry", "Weak Topic")),
    ...Array.from({ length: 10 }, (_, i) => makeCandidate(2000 + i, "chemistry", "Neutral Topic")),
  ];
  const plan = assembleExam({
    seed: "w",
    sections: [
      {
        subjectSlug: "chemistry",
        subjectId: "s5",
        subjectName: "Chemistry",
        count: 6,
        timeAllottedSeconds: 300,
        topicWeights: { [normalizeTopic("Weak Topic")]: 1, [normalizeTopic("Neutral Topic")]: 0 },
      },
    ],
    candidatesBySubject: { chemistry: weakPool },
  });
  const picked = plan.sections[0]!.picked;
  const fromWeak = picked.filter((p) => normalizeTopic(p.topicText!) === "weak topic").length;
  check("weighted topics oversampled", fromWeak === 6, `weak picks: ${fromWeak}/6`);
}

// ── 8. Seed bank integrity ───────────────────────────────────────────
console.log("\n[8] Seed bank integrity");
{
  const fingerprints = new Set<string>();
  let bad = 0;
  for (const q of SEED_BANK) {
    if (!/^[A-D]$/.test(q.answer)) bad++;
    if (q.options.length !== 4) bad++;
    const idx = q.answer.charCodeAt(0) - 65;
    if (idx < 0 || idx >= q.options.length) bad++;
    if (!q.stem || !q.explanation || !q.topic) bad++;
    const fp = `seed:${q.id}`;
    if (fingerprints.has(fp)) bad++;
    fingerprints.add(fp);
  }
  check(`all ${SEED_BANK.length} seed questions structurally valid`, bad === 0, `${bad} invalid`);
  const bySubject = new Map<string, number>();
  for (const q of SEED_BANK) bySubject.set(q.subjectSlug, (bySubject.get(q.subjectSlug) ?? 0) + 1);
  console.log("    coverage:", [...bySubject.entries()].map(([s, n]) => `${s}=${n}`).join(", "));
  check("covers 9 ESSLCE subjects", bySubject.size === 9);
  check("english + mathematics have 10+ each", (bySubject.get("english") ?? 0) >= 10 && (bySubject.get("mathematics") ?? 0) >= 10);
}

// ── 9. Blueprints ────────────────────────────────────────────────────
console.log("\n[9] Blueprints");
{
  check("4 mode blueprints defined", MATRIC_BLUEPRINTS.length === 4);
  check(
    "all blueprints honest (official=false except past papers)",
    MATRIC_BLUEPRINTS.every((b) => (b.mode === "past_paper" ? true : b.official === false)),
  );
  check("weakness challenge is free", getBlueprintByMode("weakness_challenge").premiumOnly === false);
  const natural = fullSimulationSections("natural");
  const social = fullSimulationSections("social");
  check("natural stream sections", natural.map((s) => s.subjectSlug).join(",") === "english,mathematics,scholastic-aptitude-test,physics,chemistry,biology");
  check("social stream sections", social.map((s) => s.subjectSlug).join(",") === "english,mathematics,scholastic-aptitude-test,history,geography,economics");
  // Section plan mirrors the legacy engine's real counts: 50 per subject,
  // 40 for Aptitude (the old schema comment's "~340" double-counted).
  check("full sim totals 290 questions", natural.reduce((n, s) => n + s.count, 0) === 290);
  check("sectionTitle formats", sectionTitle("English", 1, 6) === "English · Section 2 of 6");
  const slugs = new Set(MATRIC_BLUEPRINTS.map((b) => b.id));
  check("blueprint ids unique", slugs.size === MATRIC_BLUEPRINTS.length);
}

console.log(`\n═══ RESULT: ${passed} passed, ${failed} failed ═══`);
if (failed > 0) process.exit(1);
