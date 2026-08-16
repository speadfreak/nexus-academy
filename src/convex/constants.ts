// Shared domain constants for the Nexus Academy content library.
// This file is pure TS (no Convex imports) so it can be imported safely
// from both the backend (src/convex) and the frontend.

export const STREAMS = ["natural", "social", "common"] as const;
export type Stream = (typeof STREAMS)[number];

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
  common: "Common",
};

// Premium pricing — single source of truth shared by the backend (payments.ts)
// and the upgrade page.
export const PREMIUM_PRICE_ETB = 199;
export const SUBSCRIPTION_DAYS = 30;
