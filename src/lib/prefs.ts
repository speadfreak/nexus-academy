// Client-side preference store for the Settings Control Center.
//
// Scope rules (honest by design):
//   • Tutor prefs reuse the EXACT localStorage keys the AI Tutor already
//     reads (`learnyx.tutor.concise`, `learnyx.tutor.voiceOut`) so changes
//     here take effect in the tutor immediately. New tutor dimensions
//     (explanation style, difficulty, language) are stored alongside and
//     labeled as "applies to your next tutor sessions".
//   • Reader prefs feed the Reader's initial state (default zoom, AI
//     companion panel) — wired in Reader.tsx on mount. Reading position
//     auto-save is always-on (readerStorage.ts), shown as a locked row.
//   • Accessibility prefs apply app-wide via classes/styles on <html> and
//     are re-applied on every boot (main.tsx calls applyA11yPrefs()).
//
// Everything here is per-device by intent — zero new backend tables.

// ─── AI Tutor ───────────────────────────────────────────────────────────

export type ExplainStyle = "concise" | "balanced" | "detailed";
export type TutorDifficulty = "beginner" | "exam" | "advanced";
export type TutorLanguage = "auto" | "english" | "amharic" | "tigrinya" | "afaan-oromoo";

export interface TutorPrefs {
  /** Maps 1:1 onto the tutor's existing concise mode key. */
  concise: boolean;
  voiceOut: boolean;
  explain: ExplainStyle;
  difficulty: TutorDifficulty;
  language: TutorLanguage;
  /** Answer-style checkboxes. */
  showReasoning: boolean;
  giveExamples: boolean;
  answerImmediately: boolean;
}

const TUTOR_KEY = "learnyx:settings:tutor";

export const DEFAULT_TUTOR_PREFS: TutorPrefs = {
  concise: false,
  voiceOut: false,
  explain: "balanced",
  difficulty: "exam",
  language: "auto",
  showReasoning: true,
  giveExamples: true,
  answerImmediately: false,
};

export function loadTutorPrefs(): TutorPrefs {
  const base = { ...DEFAULT_TUTOR_PREFS };
  try {
    // The tutor's own keys are the source of truth for these two so the
    // Settings toggles and the in-tutor toggles can never disagree.
    const concise = localStorage.getItem("learnyx.tutor.concise");
    if (concise !== null) base.concise = concise === "true";
    const voiceOut = localStorage.getItem("learnyx.tutor.voiceOut");
    if (voiceOut !== null) base.voiceOut = voiceOut === "true";
    const raw = localStorage.getItem(TUTOR_KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<TutorPrefs>) };
  } catch {
    // private mode / storage full — defaults are fine
  }
  return base;
}

export function saveTutorPrefs(prefs: TutorPrefs): void {
  try {
    // Mirror the two shared keys so the tutor picks them up instantly.
    localStorage.setItem("learnyx.tutor.concise", String(prefs.concise));
    localStorage.setItem("learnyx.tutor.voiceOut", String(prefs.voiceOut));
    localStorage.setItem(TUTOR_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// ─── Reader ─────────────────────────────────────────────────────────────

export type ReaderZoom = "fit" | "100" | "125";

export interface ReaderPrefs {
  defaultZoom: ReaderZoom;
  companionOpen: boolean;
}

const READER_KEY = "learnyx:settings:reader";

export const DEFAULT_READER_PREFS: ReaderPrefs = {
  defaultZoom: "fit",
  companionOpen: true,
};

export function loadReaderPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(READER_KEY);
    if (raw) return { ...DEFAULT_READER_PREFS, ...(JSON.parse(raw) as Partial<ReaderPrefs>) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_READER_PREFS };
}

export function saveReaderPrefs(prefs: ReaderPrefs): void {
  try {
    localStorage.setItem(READER_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

// ─── Accessibility ──────────────────────────────────────────────────────

export type TextScale = "compact" | "normal" | "large";

export interface A11yPrefs {
  textScale: TextScale;
  reduceMotion: boolean;
  highContrast: boolean;
}

const A11Y_KEY = "learnyx:settings:a11y";

export const DEFAULT_A11Y_PREFS: A11yPrefs = {
  textScale: "normal",
  reduceMotion: false,
  highContrast: false,
};

/** font-size on <html> — the whole app is rem-based, so this scales type everywhere. */
const TEXT_SCALE_CSS: Record<TextScale, string> = {
  compact: "93.75%",
  normal: "100%",
  large: "107.5%",
};

export function loadA11yPrefs(): A11yPrefs {
  try {
    const raw = localStorage.getItem(A11Y_KEY);
    if (raw) return { ...DEFAULT_A11Y_PREFS, ...(JSON.parse(raw) as Partial<A11yPrefs>) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_A11Y_PREFS };
}

/** Apply a11y prefs to the live document. Safe to call repeatedly. */
export function applyA11yPrefs(prefs: A11yPrefs): void {
  const root = document.documentElement;
  root.style.fontSize = TEXT_SCALE_CSS[prefs.textScale];
  root.classList.toggle("reduce-motion", prefs.reduceMotion);
  root.classList.toggle("high-contrast", prefs.highContrast);
}

export function saveA11yPrefs(prefs: A11yPrefs): void {
  try {
    localStorage.setItem(A11Y_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/** Boot-time hook — reapplies saved a11y prefs before first interactive paint. */
export function applySavedA11yPrefs(): void {
  applyA11yPrefs(loadA11yPrefs());
}

// ─── Quiet hours (in-app reminder muting) ───────────────────────────────

export interface QuietHours {
  enabled: boolean;
  /** Hour 0-23 the quiet window starts (e.g. 22). */
  start: number;
  /** Hour 0-23 the quiet window ends (e.g. 6 → 06:30 range uses whole hours). */
  end: number;
}

const QUIET_KEY = "learnyx:settings:quiet-hours";

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, start: 22, end: 6 };

export function loadQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem(QUIET_KEY);
    if (raw) return { ...DEFAULT_QUIET_HOURS, ...(JSON.parse(raw) as Partial<QuietHours>) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_QUIET_HOURS };
}

export function saveQuietHours(prefs: QuietHours): void {
  try {
    localStorage.setItem(QUIET_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

/** True when the current local time falls inside the quiet window. */
export function isQuietTimeNow(q: QuietHours): boolean {
  if (!q.enabled) return false;
  const hour = new Date().getHours();
  return q.start <= q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}
