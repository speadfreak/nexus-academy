// Shared domain constants for the Nexus Academy content library.
// This file is pure TS (no Convex imports) so it can be imported safely
// from both the backend (src/convex) and the frontend.

export const STREAMS = ["natural", "social", "common"] as const;
export type Stream = (typeof STREAMS)[number];

// The streams a STUDENT can actually be on. There are only two: Natural and
// Social Science. English, Mathematics and the SAT are sat by BOTH streams,
// so they are listed inside each stream — "common" is only an internal
// classification on the subjects table (shared by both tracks), never a
// choice offered at signup or in settings.
export const USER_STREAMS = ["natural", "social"] as const;
export type UserStream = (typeof USER_STREAMS)[number];

export const CONTENT_TYPES = [
  "textbook",
  "past_exam",
  "worksheet",
  "student_guide",
  "teacher_guide",
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const GRADES = [9, 10, 11, 12] as const;

// R2 key segment per content type (matches the {content-type} part of the
// human-browsable bucket layout, e.g. natural/11/physics/past-exam/....pdf)
export const CONTENT_TYPE_SLUGS: Record<ContentType, string> = {
  textbook: "textbook",
  past_exam: "past-exam",
  worksheet: "worksheet",
  student_guide: "student-guide",
  teacher_guide: "teacher-guide",
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  textbook: "Textbook",
  past_exam: "Past Exam",
  worksheet: "Worksheet",
  student_guide: "Student Guide",
  teacher_guide: "Teacher Guide",
};

export const STREAM_LABELS: Record<Stream, string> = {
  natural: "Natural Science",
  social: "Social Science",
  // Internal only — never offered as a user choice. Shown to legacy users
  // who picked "common" before the two-stream model.
  common: "Shared (all streams)",
};

// Premium pricing — single source of truth shared by the backend (payments.ts)
// and the upgrade page.
export const PREMIUM_PRICE_ETB = 199;
export const SUBSCRIPTION_DAYS = 30;

// Free-tier limits — single source of truth shared by the backend gates
// (ai.ts, quizzes.ts) and the frontend (tutor page, quiz flow, /upgrade
// comparison table) so marketing copy can never drift from what the code
// actually enforces.
export const FREE_TUTOR_DAILY_LIMIT = 15; // tutor messages per rolling 24h
export const FREE_QUIZ_WEEKLY_LIMIT = 1; // quizzes per subject per rolling 7 days
export const FREE_QUIZ_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Gamification
// ---------------------------------------------------------------------------

// XP awarded for real study actions. Written ONLY through internal.xp.awardXp
// from existing mutation success paths — a client can never grant XP.
export const XP_VALUES = {
  quiz_complete_base: 20,
  quiz_complete_per_correct: 5, // +5 per correct answer
  focus_session: 15,
  focus_session_min_minutes: 20, // sessions shorter than this earn nothing
  streak_day: 10,
  plan_week_complete: 30,
  daily_challenge: 10,
  mock_exam_complete_base: 50, // completed a full mock exam sitting
  mock_exam_per_correct: 2, // +2 per correct answer across all sections
  exam_mode_session: 20, // completed a timed past-exam PDF session in the Reader
} as const;

// Level curve: level n requires 50 * (n-1)^2 total XP.
//   level = floor(sqrt(totalXp / 50)) + 1
// Early levels come fast (1 -> 2 at 50 XP), later ones slow down (9 -> 10 at
// 4050 XP), so progress stays motivating without inflating.
export const LEVEL_XP_FACTOR = 50;

// Study groups are capped so they feel like a real class/friend group, not a
// public arena. Opt-in only — reachable solely via a shared invite code.
export const GROUP_MAX_SIZE = 20;

// Human labels for XP ledger reasons (shown in the "recent XP" feed).
export const XP_REASON_LABELS: Record<string, string> = {
  quiz_complete: "Quiz completed",
  streak_day: "Streak day",
  focus_session: "Focus session",
  plan_week_complete: "Plan week completed",
  daily_challenge: "Daily challenge",
  mock_exam_complete: "Mock exam completed",
  exam_mode_session: "Exam-mode session",
};

// The three stream-specific subjects per track (used by the
// "full coverage" achievement — shared subjects excluded by design).
export const STREAM_SPECIFIC_SUBJECT_SLUGS = {
  natural: ["physics", "chemistry", "biology"],
  social: ["history", "geography", "economics"],
} as const;

// ---------------------------------------------------------------------------
// YouTube integration
// ---------------------------------------------------------------------------

// Ethiopian education channel whose videos are surfaced first in results.
// The backend resolves this handle to a real channel ID on first use and
// caches it. Add more channels here to expand priority results.
export const PRIORITY_CHANNEL_HANDLES = ["ethioeduc"] as const;

// Cache TTL: 30 days. Video relevance for a textbook topic doesn't change
// daily, and this keeps us well within the 100-searches/day quota.
export const VIDEO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Max results per search slice (priority channel + general).
export const VIDEO_MAX_PER_SLICE = 4;
