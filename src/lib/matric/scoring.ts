// Learnyx Matric OS — secure, pure scoring.
//
// Scoring happens ONLY on the backend from the immutable session snapshot.
// The client's answers are the only client input; correct answers, scoring,
// and breakdowns are computed here — never trusted from the client.
//
// The snapshot (questionsJson) preserves the EXACT answer-key version used at
// assembly time, so re-grading or auditing an old session never retroactively
// changes what the student was shown or scored against (Phase 6).

import type {
  PlayerQuestion,
  ScoreResult,
  ScoredQuestion,
  SessionSection,
  TopicBreakdownRow,
} from "./types";

/** Full server-side snapshot question = student-safe question + answer key. */
export interface SnapshotQuestion extends PlayerQuestion {
  answerLabel: string; // verified option label, e.g. "B"
  answerText: string; // resolved text of the correct choice
  explanation?: string;
  verificationTier: "admin_verified" | "parser_verified" | "unverified";
}

export interface ScoringInput {
  questions: readonly SnapshotQuestion[];
  sections: readonly SessionSection[];
  /** Student answer label per question, "" = unanswered. */
  answers: readonly string[];
}

/** Which label the student picked, or null for unanswered/invalid. */
function resolveStudent(
  q: SnapshotQuestion,
  raw: string | undefined,
): { label: string | null; text?: string } {
  if (!raw) return { label: null };
  const choice = q.choices.find((c) => c.label === raw);
  if (!choice) return { label: null }; // tampered/unknown label → treated as unanswered
  return { label: choice.label, text: choice.text };
}

/** Pure scorer. Never throws on data — invalid rows count as unanswered. */
export function scoreSession(input: ScoringInput): ScoreResult {
  const { questions, sections, answers } = input;

  const perQuestion: ScoredQuestion[] = [];
  let correctCount = 0;
  let answeredCount = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] as SnapshotQuestion;
    const student = resolveStudent(q, answers[i]);
    const answered = student.label !== null;
    const correct = answered && student.label === q.answerLabel;
    if (answered) answeredCount++;
    if (correct) correctCount++;

    perQuestion.push({
      index: i,
      vaultId: q.vaultId,
      contentId: q.contentId,
      paperTitle: q.paperTitle,
      questionNumber: q.questionNumber,
      answered,
      correct,
      studentAnswerLabel: student.label,
      studentAnswerText: student.text,
      correctAnswerLabel: q.answerLabel,
      correctAnswerText: q.answerText,
      stem: q.stem,
      passage: q.passage,
      choices: q.choices,
      explanation: q.explanation,
      topicId: q.topicId,
      topicText: q.topicText,
      sourcePage: q.sourcePage,
      examYear: q.examYear,
    });
  }

  const totalQuestions = questions.length;
  const scorePct =
    totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;

  // Per-subject breakdown from section boundaries.
  const subjectBreakdown = sections.map((s) => {
    const rows = perQuestion.slice(s.startIndex, s.endIndex);
    const correct = rows.reduce((acc, r) => acc + (r.correct ? 1 : 0), 0);
    const total = rows.length;
    return {
      subjectId: s.subjectId,
      subjectName: s.subjectName,
      correct,
      total,
      scorePct: total > 0 ? Math.round((correct / total) * 100) : 0,
    };
  });

  // Per-topic breakdown — only REAL topics (topicId or printed topic text);
  // untagged questions are honest "__general" rows shown as "General".
  const topicMap = new Map<string, TopicBreakdownRow>();
  for (const r of perQuestion) {
    const key = r.topicId
      ? `id:${r.topicId}`
      : r.topicText?.trim()
        ? `text:${r.topicText.trim().toLowerCase()}`
        : "__general";
    const label = r.topicText?.trim() || "General";
    const existing = topicMap.get(key);
    if (existing) {
      existing.total += 1;
      existing.correct += r.correct ? 1 : 0;
      existing.scorePct = Math.round((existing.correct / existing.total) * 100);
    } else {
      topicMap.set(key, {
        key,
        topicId: r.topicId,
        topicText: label,
        subjectId: r.topicId ? questions[r.index]?.subjectId ?? "" : questions[r.index]?.subjectId ?? "",
        correct: r.correct ? 1 : 0,
        total: 1,
        scorePct: r.correct ? 100 : 0,
      });
    }
  }

  return {
    perQuestion,
    totalQuestions,
    correctCount,
    incorrectCount: answeredCount - correctCount,
    unansweredCount: totalQuestions - answeredCount,
    scorePct,
    subjectBreakdown,
    topicBreakdown: [...topicMap.values()],
  };
}
