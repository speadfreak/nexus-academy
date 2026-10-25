// Learnyx Matric OS — canonical stream eligibility rules.
//
// PURE FUNCTIONS ONLY (no Convex imports) so the exact rules the backend
// enforces in startMatricExam can be unit-tested with plain fixtures
// (scripts/test-matric-engine.mjs) and shared by admin diagnostics.
//
// MODEL (audit-verified):
//   - userProfiles.stream is the SINGLE source of truth for a student's
//     academic stream: "natural" | "social" | "common" (legacy pre-two-stream
//     rows) | undefined (not selected yet).
//   - A student's effective stream for eligibility is therefore
//     "natural" | "social" | null (unselected). "common"/undefined → null:
//     we NEVER silently default a student to Natural Science (spec §2).
//   - Subjects carry a stream too: "natural" | "social", or "common" for
//     subjects every stream sits (English, Mathematics, SAT).
//   - Full-simulation blueprints carry the stream they were assembled for.
//     Subject-mock / weakness / past-paper blueprints don't (their subject
//     rows carry it instead).
//
// EXPLORATION (spec §5): a student may sit the OTHER stream's exams via an
// explicit, per-attempt consent flag (exploreOtherStream). It never mutates
// the academic profile, and the sitting is recorded with
// exploredOtherStream=true so results stay correctly labeled forever.

export type StudentStream = "natural" | "social" | null;

/** Normalized stream label for identity chips. Never invents a default. */
export function studentStreamLabel(stream: string | null | undefined): string | null {
  if (stream === "natural") return "Natural Science";
  if (stream === "social") return "Social Science";
  return null; // unselected / legacy "common" → null (graceful prompt, not a default)
}

/**
 * The stream a blueprint SUBJECT belongs to for eligibility purposes.
 * "common" (English / Mathematics / SAT) is sat by BOTH streams.
 */
export type SubjectEligibilityStream = "natural" | "social" | "common";

export interface StreamEligibilityInput {
  /** Student's effective stream — null when not selected (or legacy "common"). */
  studentStream: StudentStream;
  /** Blueprint-level stream (full simulations). Undefined for other modes. */
  blueprintStream?: "natural" | "social" | undefined;
  /** The subject's stream ("common" = sat by every stream). */
  subjectStream?: SubjectEligibilityStream | undefined;
  /** Explicit per-attempt consent to sit the other stream's exam. */
  exploreOtherStream: boolean;
}

export type StreamEligibilityCode =
  | "eligible"
  | "eligible_explored" // allowed ONLY because of the explicit explore consent
  | "stream_mismatch" // other stream, no consent
  | "stream_unselected"; // student hasn't picked a stream → prompt, don't block

export interface StreamEligibilityResult {
  code: StreamEligibilityCode;
  /** May the sitting start at all? */
  allowed: boolean;
  /** Human-readable explanation used in errors and admin diagnostics. */
  reason: string;
  /**
   * True when this sitting belongs to the student's OTHER stream — the
   * session stores it so results remain correctly labeled after any
   * profile change.
   */
  exploredOtherStream: boolean;
}

/**
 * THE one eligibility rule (spec §6 — backend enforcement, single source):
 *
 *   1. Subject is "common" (English / Math / SAT) → always eligible.
 *   2. Student stream matches the exam's stream → eligible.
 *   3. Student stream unselected → eligible but flagged: the hub shows a
 *      graceful onboarding prompt; we never block a legacy student from
 *      working, and we never silently default them either.
 *   4. Otherwise (other stream): eligible ONLY with explicit explore consent
 *      → labeled "eligible_explored". Without consent → "stream_mismatch".
 */
export function evaluateStreamEligibility(input: StreamEligibilityInput): StreamEligibilityResult {
  const { studentStream, blueprintStream, subjectStream, exploreOtherStream } = input;

  // The exam's effective stream: full simulations declare it on the
  // blueprint; subject-scoped modes inherit it from their subject.
  const examStream: "natural" | "social" | "common" =
    blueprintStream ?? subjectStream ?? "common";

  // Shared subjects — every stream sits them, explore flag irrelevant.
  if (examStream === "common") {
    return {
      code: "eligible",
      allowed: true,
      reason: "Shared subject — sat by every stream.",
      exploredOtherStream: false,
    };
  }

  // Unselected student: never blocked, never defaulted. The UI prompts for a
  // stream; the sitting itself is not cross-stream exploration (there is no
  // selected stream to differ from). Nullish-tolerant: callers may pass
  // undefined when the profile row has no stream at all.
  if (studentStream == null) {
    return {
      code: "stream_unselected",
      allowed: true,
      reason:
        "Your academic stream isn't set yet — pick Natural or Social Science in Settings to get stream-tailored recommendations. You can still sit this exam.",
      exploredOtherStream: false,
    };
  }

  if (studentStream === examStream) {
    return {
      code: "eligible",
      allowed: true,
      reason: "Matches your selected stream.",
      exploredOtherStream: false,
    };
  }

  // Other stream — explicit consent required, and the sitting is labeled.
  if (exploreOtherStream) {
    return {
      code: "eligible_explored",
      allowed: true,
      reason: `Exploratory sitting — this is a ${examStream === "natural" ? "Natural Science" : "Social Science"} exam and your saved stream is ${studentStream === "natural" ? "Natural Science" : "Social Science"}. Your profile was not changed.`,
      exploredOtherStream: true,
    };
  }

  return {
    code: "stream_mismatch",
    allowed: false,
    reason: `This exam is part of the ${
      examStream === "natural" ? "Natural Science" : "Social Science"
    } pathway. Your saved stream is ${
      studentStream === "natural" ? "Natural Science" : "Social Science"
    }. Switch stream in Settings, or use "Explore the other stream" to sit it as a clearly labeled practice sitting.`,
    exploredOtherStream: false,
  };
}

/** Deterministic stream chip palette used consistently across the hub. */
export const STREAM_ACCENT: Record<"natural" | "social", string> = {
  natural: "teal",
  social: "violet",
};
