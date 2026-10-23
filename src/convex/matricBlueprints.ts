// MATRIC OS — Blueprint System (Phase 2).
//
// A blueprint is a versioned exam specification: which subjects, how many
// questions, how long, what the minimum bank coverage is, and how question
// reuse is handled. Blueprints are CODE, not database rows — they ship with
// the app, so eligibility logic can never drift from the UI.
//
// HONESTY RULES:
//   - `official: false` on every blueprint. Learnyx does NOT claim official
//     ESSLCE format equivalence until a blueprint is verified against real
//     ministry specifications. Structure mirrors widely-known section
//     conventions (English / Maths / SAT + stream subjects) but we label
//     everything "Learnyx-designed simulation".
//   - Blueprints never invent counts for subjects with no verified bank —
//     the engine fails gracefully with actionable coverage info instead.

import { STREAM_SPECIFIC_SUBJECT_SLUGS } from "./constants";

export type MatricMode =
  | "full_simulation"
  | "subject_mock"
  | "weakness_challenge"
  | "past_paper";

export interface BlueprintSection {
  subjectSlug: string;
  count: number;
  minutes: number;
}

export interface MatricBlueprint {
  id: string;
  version: number;
  mode: MatricMode;
  label: string;
  description: string;
  /** Always false today — see honesty rules above. */
  official: boolean;
  /** Scored exams require verified answer keys (Phase 1 rule). */
  requireVerified: boolean;
  /** Premium-gated modes. Weakness Challenge is intentionally free. */
  premiumOnly: boolean;
  /** Reuse policy: exclude fingerprints seen in the student's last N days
   *  of sessions (0 disables). Recycled only when the bank would otherwise
   *  run dry — a started exam beats a blocked one. */
  excludeRecentDays: number;
  /** A section/subject is only startable with at least this many verified
   *  questions. Below it the mode reports "insufficient coverage". */
  minQuestionsPerSection: number;
  /** Full-simulation section plan (compulsory + stream resolved at runtime). */
  sections?: BlueprintSection[];
  /** Per-sitting question count for single-subject modes. */
  questionCount?: number;
  /** Default duration in minutes for single-subject modes. */
  minutes?: number;
}

/** Compulsory ESSLCE-style sections shared by both streams. Counts follow
 *  the section conventions the old AI engine used (~50 per subject, 40 for
 *  SAT) so graduates of the old experience find the same shape here. */
export const COMPULSORY_SECTIONS: BlueprintSection[] = [
  { subjectSlug: "english", count: 50, minutes: 50 },
  { subjectSlug: "mathematics", count: 50, minutes: 50 },
  { subjectSlug: "scholastic-aptitude-test", count: 40, minutes: 40 },
];

export const MATRIC_BLUEPRINTS: MatricBlueprint[] = [
  {
    id: "esslce-full-simulation",
    version: 1,
    mode: "full_simulation",
    label: "Full Matric Simulation",
    description:
      "A complete sitting across English, Mathematics, Aptitude and your stream's three subjects — the closest Learnyx-built analog of exam day. Requires a well-stocked verified bank for every section; otherwise you'll be offered a clearly-labeled reduced practice instead.",
    official: false,
    requireVerified: true,
    premiumOnly: true,
    excludeRecentDays: 7,
    minQuestionsPerSection: 10,
    sections: COMPULSORY_SECTIONS,
  },
  {
    id: "subject-mock-standard",
    version: 1,
    mode: "subject_mock",
    label: "Subject Mock",
    description:
      "A timed, scored drill on one subject drawn from verified questions — the fastest way to find out what the real exam will ask you.",
    official: false,
    requireVerified: true,
    premiumOnly: true,
    excludeRecentDays: 7,
    minQuestionsPerSection: 10,
    questionCount: 40,
    minutes: 40,
  },
  {
    id: "weakness-challenge-standard",
    version: 1,
    mode: "weakness_challenge",
    label: "Weakness Challenge",
    description:
      "A short, focused strike on the topics your results say you're weakest at. Free by design — fixing weak spots should never wait on a paywall.",
    official: false,
    requireVerified: true,
    premiumOnly: false,
    excludeRecentDays: 3,
    minQuestionsPerSection: 5,
    questionCount: 20,
    minutes: 25,
  },
  {
    id: "past-paper-simulation",
    version: 1,
    mode: "past_paper",
    label: "Past Paper Simulation",
    description:
      "Sit a real digitized past paper end-to-end with its own verified answer key, timed like the actual sitting.",
    official: true, // real paper content, real key — but format equivalence still not claimed in UI copy
    requireVerified: true,
    premiumOnly: true,
    excludeRecentDays: 0, // a specific paper is the point — reuse is fine
    minQuestionsPerSection: 10,
  },
];

export function getBlueprint(id: string): MatricBlueprint | undefined {
  return MATRIC_BLUEPRINTS.find((b) => b.id === id);
}

export function getBlueprintByMode(mode: MatricMode): MatricBlueprint {
  const bp = MATRIC_BLUEPRINTS.find((b) => b.mode === mode);
  if (!bp) throw new Error(`No blueprint for mode ${mode}`);
  return bp;
}

/** Resolve the full section plan for a full-simulation blueprint and stream.
 *  Stream subjects follow the platform's canonical mapping (constants.ts) —
 *  natural: physics/chemistry/biology, social: history/geography/economics. */
export function fullSimulationSections(stream: "natural" | "social"): BlueprintSection[] {
  const streamSlugs = STREAM_SPECIFIC_SUBJECT_SLUGS[stream];
  const streamSections: BlueprintSection[] = streamSlugs.map((slug) => ({
    subjectSlug: slug,
    count: 50,
    minutes: 50,
  }));
  return [...COMPULSORY_SECTIONS, ...streamSections];
}

/** Human-readable section title, e.g. "English — Section 2 of 6". */
export function sectionTitle(subjectName: string, index: number, total: number): string {
  return `${subjectName} · Section ${index + 1} of ${total}`;
}
