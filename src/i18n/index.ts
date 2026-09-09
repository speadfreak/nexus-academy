// Learnyx Academy ET — Multi-language i18n setup (react-i18next).
//
// SUPPORTED LANGUAGES:
//   en  — English (default + fallback)
//   am  — አማርኛ (Amharic)
//   om  — Afaan Oromoo
//   ti  — ትግርኛ (Tigrigna)
//
// NAMESPACES (lazy-loaded per language to keep the initial bundle small):
//   common     — shared buttons, labels, errors used across pages
//   landing    — Landing page hero, features, footer (Phase 3)
//   dashboard  — DashboardShell nav + Dashboard/Library (Phase 4)
//   account    — Account sheet (Phase 2)
//   tutor, todos, focus, plans, journey, calendar, notes, flashcards,
//   achievements, groups, settings, aptitude, mockExam — Phase 5
//   footer, pages — Phase 6 (expanded footer + new marketing pages)
//
// GATING:
//   When MULTI_LANGUAGE_ENABLED configKey is "true", the language switcher
//   UI appears on the landing page + dashboard account sheet. When unset
//   or "false", the frontend forces English (i18n.language = "en") and
//   hides all language UI. See src/hooks/useLanguage.ts for the gate hook.
//
// PERSISTENCE:
//   - Signed-in users: preferredLanguage stored on userProfiles (cross-
//     device sync via the Convex profile mutation)
//   - Guests/landing visitors: localStorage key "learnyx.lang"
//
// BROWSER DETECTION:
//   On first visit, i18next-browser-languagedetector picks up the browser
//   language. If MULTI_LANGUAGE_ENABLED and the detected language is one
//   of am/om/ti, we soft-suggest switching (Phase 7 — see LandingPage).
//
// TRANSLATION QUALITY NOTE (Phase 7):
//   Amharic translations are full coverage. Afaan Oromo + Tigrigna are
//   admin-flagged as "needs native-speaker review before wide promotion"
//   — see the small note in the language switcher UI (admin-only).

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

// Static imports for the English namespace — English is the fallback so it
// must always be loaded synchronously (no lazy-load = no missing-key flash
// on first paint). All other languages are lazy-loaded below.
import enCommon from "./en/common.json";
import enLanding from "./en/landing.json";
import enDashboard from "./en/dashboard.json";
import enAccount from "./en/account.json";
import enFooter from "./en/footer.json";
import enPages from "./en/pages.json";

// Lazy-loaders for non-English locales. Each returns a Promise that resolves
// to the namespace JSON. i18next calls these on demand when the user
// switches language — keeps the initial bundle small.
const lazyLoad = (lang: "am" | "om" | "ti", ns: string) => async () => {
  // Vite supports dynamic imports of JSON with explicit path strings.
  // The `/* @vite-ignore */` keeps the bundler from warning about unknown
  // keys at build time (the language toggle is dynamic).
  const mod = await import(
    /* @vite-ignore */ `./${lang}/${ns}.json`
  );
  return mod.default ?? mod;
};

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

// Initialize i18n. English namespaces are bundled; the other three
// languages are lazy-loaded on first switch (and cached by i18n).
void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Start in English. The useLanguage hook will switch to the user's
    // preferredLanguage (signed-in) or the detected browser language
    // (guest, when MULTI_LANGUAGE_ENABLED is true) after mount.
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    // Don't fail on missing keys — log a warning instead so we can find
    // un-translated strings during development.
    saveMissing: false,
    // Don't escape — React already escapes. Lets us use HTML entities in
    // translation strings if needed.
    interpolation: {
      escapeValue: false,
    },
    // English is bundled (synchronous). The other three are lazy-loaded
    // via `resources` callbacks that resolve to JSON imports.
    resources: {
      en: {
        common: enCommon,
        landing: enLanding,
        dashboard: enDashboard,
        account: enAccount,
        footer: enFooter,
        pages: enPages,
      },
      am: {
        common: lazyLoad("am", "common"),
        landing: lazyLoad("am", "landing"),
        dashboard: lazyLoad("am", "dashboard"),
        account: lazyLoad("am", "account"),
        footer: lazyLoad("am", "footer"),
        pages: lazyLoad("am", "pages"),
      },
      om: {
        common: lazyLoad("om", "common"),
        landing: lazyLoad("om", "landing"),
        dashboard: lazyLoad("om", "dashboard"),
        account: lazyLoad("om", "account"),
        footer: lazyLoad("om", "footer"),
        pages: lazyLoad("om", "pages"),
      },
      ti: {
        common: lazyLoad("ti", "common"),
        landing: lazyLoad("ti", "landing"),
        dashboard: lazyLoad("ti", "dashboard"),
        account: lazyLoad("ti", "account"),
        footer: lazyLoad("ti", "footer"),
        pages: lazyLoad("ti", "pages"),
      },
    },
    // Always load these namespaces so common buttons/labels work even
    // before a page-specific namespace is requested.
    ns: ["common", "landing", "dashboard", "account", "footer", "pages"],
    defaultNS: "common",
    // Detect language from localStorage first, then browser. We override
    // this on mount via the useLanguage hook (which reads the user's
    // preferredLanguage from their profile when signed in).
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      lookupLocalStorage: LANG_STORAGE_KEY,
      caches: ["localStorage"],
    },
    // If a key is missing in the current language, fall back to English
    // (not the raw key) — so an untranslated page in Amharic still shows
    // English text instead of "missing.translation.key".
    fallbackNS: "common",
    returnEmptyString: false,
  });

export default i18n;
