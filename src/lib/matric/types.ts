// Learnyx Matric OS — shared types for the non-AI examination engine.
//
// These types are the contract between:
//   - the vault import (digitalPapers → matricQuestions)
//   - the deterministic assembler (convex/matricEngine.ts)
//   - the CBT player (components/matric/*)
//   - the secure scorer (pure functions in scoring.ts)
//
// Everything here is pure data — no Convex imports — so the selection and
// scoring logic can be unit-tested with plain fixtures (scripts/test-matric-engine.mjs).

// ── Vault question ────────────────────────────────────────────────────────

/** How the answer key was established. Never invent a tier. */
export type VerificationTier =
  | "admin_verified" // accepted by an admin in the Exam Engine QC console
  | "parser_verified" // deterministic parser read the paper's OWN answer key with high confidence
  | "unverified"; // needs_review / pdf_only / missing or ambiguous key

/** Mirror of the matricQuestions Convex row (subset the engine needs). */
export interface VaultQuestionLike {
  vaultId: string;
  contentId: string; // source paper (contentItems row)
  questionNumber: number; // question number inside the source paper
  subjectId: string;
  stem: string;
  passage?: string;
  choices: { label: string; text: string }[];
  answerLabel?: string; // verified option label, e.g. "B" (absent/empty = no key)
  explanation?: string;
  topicId?: string; // resolved curriculum topic (may be absent — never fabricated)
  topicText?: string; // topic as printed on the source paper
  examYear?: number;
  sourcePage?: number;
  figureHint?: boolean; // source paper flagged a diagram the text can't carry
  paperTitle: string;
  verificationTier: VerificationTier;
  examEligible: boolean; // only eligible rows may ever be selected for scored exams
  duplicateKey?: string; // content-hash of stem+choices for duplicate detection
}

// ── Student-safe payload ──────────────────────────────────────────────────

/**
 * The ONLY question shape that ever reaches the client while an exam is
 * active. No answer label, no explanation, no verification metadata.
 */
export interface PlayerQuestion {
  i: number; // global index within the session (0-based)
  vaultId: string;
  contentId: string;
  paperTitle: string;
  questionNumber: number; // question number inside its source paper
  subjectId: string;
  subjectName: string;
  stem: string;
  passage?: string;
  choices: { label: string; text: string }[];
  topicId?: string; // resolved curriculum topic (real evidence only)
  topicText?: string;
  examYear?: number;
  sourcePage?: number;
  figureHint?: boolean;
}

/** Per-subject boundaries inside the flat question list. */
export interface SessionSection {
  subjectId: string;
  subjectName: string;
  startIndex: number; // inclusive
  endIndex: number; // exclusive
  questionCount: number;
}

// ── Scoring ───────────────────────────────────────────────────────────────

export interface ScoredQuestion {
  index: number;
  vaultId: string;
  contentId: string;
  paperTitle: string;
  questionNumber: number;
  answered: boolean;
  correct: boolean;
  studentAnswerLabel: string | null;
  studentAnswerText?: string;
  correctAnswerLabel: string;
  correctAnswerText: string;
  stem: string;
  passage?: string;
  choices: { label: string; text: string }[];
  explanation?: string;
  topicId?: string;
  topicText?: string;
  sourcePage?: number;
  examYear?: number;
}

export interface SubjectBreakdownRow {
  subjectId: string;
  subjectName: string;
  correct: number;
  total: number;
  scorePct: number; // 0..100
}

export interface TopicBreakdownRow {
  key: string; // topicId if resolved else `text:${topicText}`
  topicId?: string;
  topicText: string;
  subjectId: string;
  correct: number;
  total: number;
  scorePct: number;
}

export interface ScoreResult {
  perQuestion: ScoredQuestion[];
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  scorePct: number; // 0..100, rounded
  subjectBreakdown: SubjectBreakdownRow[];
  topicBreakdown: TopicBreakdownRow[];
}

// ── Blueprint ─────────────────────────────────────────────────────────────

export type MatricMode =
  | "full_simulation"
  | "subject_mock"
  | "weakness_challenge"
  | "past_paper";

export type BlueprintSpecType = "learnyx_practice";

/**
 * A subject's plan inside a blueprint. Counts are Learnyx-designed practice
 * configurations — NEVER presented as official ESA formats.
 */
export interface BlueprintSubjectPlan {
  subjectId: string;
  subjectSlug: string;
  subjectName: string;
  questionCount: number;
}

export interface BlueprintLike {
  blueprintId: string;
  key: string; // e.g. "subject-mock:mathematics", "full-simulation:natural"
  version: number;
  mode: MatricMode;
  title: string;
  description: string;
  stream?: "natural" | "social";
  subjects: BlueprintSubjectPlan[]; // empty for weakness_challenge/past_paper (resolved at creation)
  timeLimitSeconds: number; // whole-exam budget for single-subject modes
  perSubjectTimeSeconds?: number; // full simulation: per-subject budget
  status: "active" | "disabled";
  minCoverage: number; // minimum eligible questions per subject for the mode to be offered
  maxPerTopic: number; // topic balance cap during assembly (0 = no cap)
  preferFreshCount: number; // exclude questions seen in the student's last N sessions when coverage allows (0 = reuse allowed)
}
