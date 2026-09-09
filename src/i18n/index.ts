// Learnyx Academy ET — Multi-language i18n setup (react-i18next).
//
// SUPPORTED LANGUAGES:
//   en  — English (default + fallback)
//   am  — አማርኛ (Amharic)
//   om  — Afaan Oromoo
//   ti  — ትግርኛ (Tigrigna)
//
// ARCHITECTURE:
//   All translation JSON files are statically imported and bundled.
//   This guarantees language switching works instantly at runtime —
//   no lazy-loading, no dynamic imports that Vite can't resolve, no
//   silent fallback to English. The total size of all 4 languages ×
//   all namespaces is ~80KB — negligible vs the 400KB+ index bundle.
//
// GATING:
//   When MULTI_LANGUAGE_ENABLED configKey is "true", the language
//   switcher UI appears. When unset/false, the frontend forces English.
//   See src/hooks/useLanguage.ts for the gate hook.

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

// ── English (bundled synchronously — always available) ─────────────
import enCommon from "./en/common.json";
import enLanding from "./en/landing.json";
import enDashboard from "./en/dashboard.json";
import enAccount from "./en/account.json";
import enFooter from "./en/footer.json";
import enPages from "./en/pages.json";
import enTutor from "./en/tutor.json";
import enTodos from "./en/todos.json";
import enFocus from "./en/focus.json";
import enPlans from "./en/plans.json";
import enJourney from "./en/journey.json";
import enCalendar from "./en/calendar.json";
import enNotes from "./en/notes.json";
import enFlashcards from "./en/flashcards.json";
import enAchievements from "./en/achievements.json";
import enGroups from "./en/groups.json";
import enSettings from "./en/settings.json";
import enAptitude from "./en/aptitude.json";
import enMockExam from "./en/mockExam.json";

// ── Amharic (አማርኛ) — statically imported, always bundled ──────────
import amCommon from "./am/common.json";
import amLanding from "./am/landing.json";
import amDashboard from "./am/dashboard.json";
import amAccount from "./am/account.json";
import amFooter from "./am/footer.json";
import amPages from "./am/pages.json";
import amTutor from "./am/tutor.json";

// ── Afaan Oromoo — statically imported, always bundled ──────────────
import omCommon from "./om/common.json";
import omLanding from "./om/landing.json";
import omDashboard from "./om/dashboard.json";
import omAccount from "./om/account.json";
import omFooter from "./om/footer.json";
import omPages from "./om/pages.json";

// ── Tigrigna (ትግርኛ) — statically imported, always bundled ───────────
import tiCommon from "./ti/common.json";
import tiLanding from "./ti/landing.json";
import tiDashboard from "./ti/dashboard.json";
import tiAccount from "./ti/account.json";
import tiFooter from "./ti/footer.json";
import tiPages from "./ti/pages.json";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English", flag: "🇬🇧" },
  { code: "am", label: "Amharic", nativeLabel: "አማርኛ", flag: "🇪🇹" },
  { code: "om", label: "Afaan Oromoo", nativeLabel: "Afaan Oromoo", flag: "🇪🇹" },
  { code: "ti", label: "Tigrigna", nativeLabel: "ትግርኛ", flag: "🇪🇹" },
] as const;

export const DEFAULT_LANGUAGE = "en";
export const LANG_STORAGE_KEY = "learnyx.lang";

// Public — used by the language switcher UI + the useLanguage hook.
export function isSupportedLanguage(code: string | undefined | null): code is "en" | "am" | "om" | "ti" {
  if (!code) return false;
  return (SUPPORTED_LANGUAGES as readonly { code: string }[]).some((l) => l.code === code);
}

// ── All namespace resources for all 4 languages ────────────────────
// Namespaces missing for am/om/ti fall back to English automatically
// via i18next's fallbackLng + fallbackNS mechanism. This means: if a
// user switches to Amharic and opens the Flashcards page (which doesn't
// have an am/flashcards.json yet), the English flashcards strings
// render — graceful degradation, not broken UI.

// Build the full resource map — each language has all namespaces.
// For namespaces without a translation file in am/om/ti, we simply
// omit them from that language's resource map. i18next's fallbackLng
// will fill in the English strings for those missing namespaces.
const ALL_NS_KEYS = [
  "common", "landing", "dashboard", "account", "footer", "pages",
  "tutor", "todos", "focus", "plans", "journey", "calendar",
  "notes", "flashcards", "achievements", "groups", "settings",
  "aptitude", "mockExam",
] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    saveMissing: false,
    interpolation: { escapeValue: false },
    // All resources are statically bundled — no lazy loading. This
    // guarantees language switching works instantly at runtime.
    resources: {
      en: {
        common: enCommon,
        landing: enLanding,
        dashboard: enDashboard,
        account: enAccount,
        footer: enFooter,
        pages: enPages,
        tutor: enTutor,
        todos: enTodos,
        focus: enFocus,
        plans: enPlans,
        journey: enJourney,
        calendar: enCalendar,
        notes: enNotes,
        flashcards: enFlashcards,
        achievements: enAchievements,
        groups: enGroups,
        settings: enSettings,
        aptitude: enAptitude,
        mockExam: enMockExam,
      },
      am: {
        common: amCommon,
        landing: amLanding,
        dashboard: amDashboard,
        account: amAccount,
        footer: amFooter,
        pages: amPages,
        tutor: amTutor,
        // Namespaces without am/ translations fall back to English
        // automatically via fallbackLng.
      },
      om: {
        common: omCommon,
        landing: omLanding,
        dashboard: omDashboard,
        account: omAccount,
        footer: omFooter,
        pages: omPages,
      },
      ti: {
        common: tiCommon,
        landing: tiLanding,
        dashboard: tiDashboard,
        account: tiAccount,
        footer: tiFooter,
        pages: tiPages,
      },
    },
    // Load all namespaces so fallback works correctly.
    ns: ALL_NS_KEYS,
    defaultNS: "common",
    // When a key is missing in the current language's namespace,
    // fall back to the same namespace in English, then to "common".
    fallbackNS: "common",
    returnEmptyString: false,
    // Detection: localStorage first (so returning visitors keep their
    // choice), then browser navigator, then HTML tag.
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export default i18n;
