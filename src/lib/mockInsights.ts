// Mock exam intelligence — PURE functions, no Convex/React imports.
//
// Shared by:
//   • convex/mockExam.ts  (getMockInsights query — the server is the only
//     place that can see the PREVIOUS exam's per-subject breakdown, so the
//     cross-exam comparison is computed there)
//   • scripts/verify-mock-insights.mjs (bun runs TypeScript directly)
//
// Honesty rules baked in:
//   • Deltas come only from real stored sectionResults. A subject the
//     previous sitting didn't test gets delta: null — never a 0 or a guess.
//   • Subject matching uses subjectId when both sides carry one, otherwise
//     normalized names — never fuzzy "close enough" matching.
//   • No prediction. Everything here describes what already happened.

export interface MockSectionResult {
  subjectId?: string;
  subjectName: string;
  score: number; // 0..100
  correctCount: number;
  totalQuestions: number;
  timeSpentSeconds: number;
}

export interface SubjectDelta {
  subjectName: string;
  score: number;
  prevScore: number | null; // null = not tested in the previous sitting
  delta: number | null; // score - prevScore, only when both exist
}

export interface MockInsights {
  hasPrevious: boolean;
  previousScore: number | null;
  totalScore: number;
  totalDelta: number | null;
  subjectDeltas: SubjectDelta[];
  improvedCount: number;
  declinedCount: number;
  flatCount: number;
  weakest: { subjectName: string; score: number } | null;
  strongest: { subjectName: string; score: number } | null;
}

const normalizeName = (s: string) => s.trim().toLowerCase();

/** Per-subject delta between two sittings. Order follows `current`. */
export function computeSubjectDeltas(
  current: MockSectionResult[],
  previous: MockSectionResult[],
): SubjectDelta[] {
  const prevById = new Map<string, MockSectionResult>();
  const prevByName = new Map<string, MockSectionResult>();
  for (const p of previous) {
    if (p.subjectId) prevById.set(p.subjectId, p);
    prevByName.set(normalizeName(p.subjectName), p);
  }
  return current.map((c) => {
    const prev = c.subjectId
      ? prevById.get(c.subjectId) ?? prevByName.get(normalizeName(c.subjectName))
      : prevByName.get(normalizeName(c.subjectName));
    if (!prev || typeof prev.score !== "number") {
      return { subjectName: c.subjectName, score: c.score, prevScore: null, delta: null };
    }
    return {
      subjectName: c.subjectName,
      score: c.score,
      prevScore: prev.score,
      delta: c.score - prev.score,
    };
  });
}

/**
 * Cross-exam insight for the results screen. `previous` is the section
 * breakdown of the student's most recent completed sitting BEFORE this one
 * (or null on a first sitting). All numbers describe recorded facts.
 */
export function computeMockInsights(
  current: MockSectionResult[],
  previous: MockSectionResult[] | null,
): MockInsights {
  const totalScore =
    current.length > 0
      ? Math.round(
          (current.reduce((s, r) => s + r.correctCount, 0) /
            Math.max(1, current.reduce((s, r) => s + r.totalQuestions, 0))) * 100,
        )
      : 0;

  const weakest = current.reduce<MockSectionResult | null>(
    (min, r) => (min === null || r.score < min.score ? r : min),
    null,
  );
  const strongest = current.reduce<MockSectionResult | null>(
    (max, r) => (max === null || r.score > max.score ? r : max),
    null,
  );

  if (!previous || previous.length === 0) {
    return {
      hasPrevious: false,
      previousScore: null,
      totalScore,
      totalDelta: null,
      subjectDeltas: computeSubjectDeltas(current, []),
      improvedCount: 0,
      declinedCount: 0,
      flatCount: 0,
      weakest: weakest ? { subjectName: weakest.subjectName, score: weakest.score } : null,
      strongest: strongest ? { subjectName: strongest.subjectName, score: strongest.score } : null,
    };
  }

  const prevTotalScore =
    previous.reduce((s, r) => s + r.correctCount, 0) /
    Math.max(1, previous.reduce((s, r) => s + r.totalQuestions, 0)) * 100;

  const subjectDeltas = computeSubjectDeltas(current, previous);
  const deltas = subjectDeltas
    .map((d) => d.delta)
    .filter((d): d is number => d !== null);
  const previousScore = Math.round(prevTotalScore);

  return {
    hasPrevious: true,
    previousScore,
    totalScore,
    totalDelta: totalScore - previousScore,
    subjectDeltas,
    improvedCount: deltas.filter((d) => d > 0).length,
    declinedCount: deltas.filter((d) => d < 0).length,
    flatCount: deltas.filter((d) => d === 0).length,
    weakest: weakest ? { subjectName: weakest.subjectName, score: weakest.score } : null,
    strongest: strongest ? { subjectName: strongest.subjectName, score: strongest.score } : null,
  };
}
