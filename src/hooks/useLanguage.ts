// useLanguage — the single hook that manages multi-language state.
//
// Wires together:
//   1. MULTI_LANGUAGE_ENABLED configKey (Convex query) — gates the whole UI
//   2. Signed-in user's preferredLanguage (userProfiles)
//   3. localStorage for guests (via i18next-browser-languagedetector)
//   4. The i18n instance (language switching)
//
// USAGE (in any component):
//   const { enabled, language, setLanguage, loading } = useLanguage();
//
// WHEN MULTI_LANGUAGE_ENABLED is false:
//   - enabled === false
//   - language is forced to "en" (i18n.language = "en")
//   - setLanguage is a no-op (defensive — UI shouldn't show the switcher)
//   - The LanguageSwitcher component renders nothing (gated by `enabled`)
//
// WHEN MULTI_LANGUAGE_ENABLED is true:
//   - enabled === true
//   - language is the user's preferredLanguage (signed-in) or
//     localStorage / browser-detected (guest)
//   - setLanguage updates i18n, persists to userProfiles if signed in,
//     falls back to localStorage for guests

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  LANG_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
} from "@/i18n";

type Lang = "en" | "am" | "om" | "ti";

// Export so the LanguageSwitcher can use the same type for setLanguage calls.
export type { Lang };

interface UseLanguageResult {
  /** True when MULTI_LANGUAGE_ENABLED is "true". Language UI should only
      render when this is true. */
  enabled: boolean;
  /** True while the configKey query + the profile query are still loading
      (undefined). UI shouldn't make assumptions about the state during
      this window — assume English defaults. */
  loading: boolean;
  /** The currently active language code (always one of the 4 supported,
      forced to "en" when `enabled` is false). */
  language: Lang;
  /** Set the language. Persists to userProfiles if signed in, localStorage
      otherwise. Updates i18n immediately. No-op when `enabled` is false. */
  setLanguage: (lang: Lang) => Promise<void>;
  /** The list of supported languages for the switcher UI. */
  supported: typeof SUPPORTED_LANGUAGES;
}

export function useLanguage(): UseLanguageResult {
  const { i18n } = useTranslation();
  // Public query — no admin gate, used by the landing page too.
  const enabledQuery = useQuery(api.configKeys.getMultiLanguageEnabled);
  const profile = useQuery(api.profile.getProfile);
  const updateProfile = useMutation(api.profile.updateProfile);

  const enabled = enabledQuery === true;
  const loading = enabledQuery === undefined || (enabled && profile === undefined);

  // The effective language: forced to "en" when disabled, otherwise the
  // user's preferredLanguage (signed-in) or i18n's current language (guest).
  const computeLanguage = (): Lang => {
    if (!enabled) return DEFAULT_LANGUAGE as Lang;
    // Signed-in user — use their persisted preferredLanguage
    if (profile?.preferredLanguage && isSupportedLanguage(profile.preferredLanguage)) {
      return profile.preferredLanguage;
    }
    // Guest / no preference yet — use i18n's current language (detected
    // from localStorage or browser, set by i18next-browser-languagedetector)
    const current = i18n.language?.split("-")[0] ?? DEFAULT_LANGUAGE;
    if (isSupportedLanguage(current)) return current;
    return DEFAULT_LANGUAGE as Lang;
  };

  const language = computeLanguage();

  // Keep i18n in sync — whenever the effective language changes (because
  // the gate flipped, the user signed in, or they switched), push it to
  // i18n so all `useTranslation` subscribers re-render with the new strings.
  useEffect(() => {
    if (i18n.language !== language) {
      void i18n.changeLanguage(language);
    }
    // Persist to localStorage for guests (and as a fallback for signed-in
    // users so the next page load doesn't flash English before the profile
    // query resolves).
    try {
      window.localStorage.setItem(LANG_STORAGE_KEY, language);
    } catch {
      // ignore (SSR or privacy mode)
    }
  }, [language, i18n]);

  // setLanguage — called by the switcher UI. Persists to the user's profile
  // if signed in, falls back to localStorage for guests.
  const setLanguage = useCallback(
    async (lang: Lang): Promise<void> => {
      if (!enabled) return; // no-op when disabled
      if (!isSupportedLanguage(lang)) return;
      // Update i18n immediately — UI updates without waiting for the
      // profile mutation to round-trip.
      await i18n.changeLanguage(lang);
      try {
        window.localStorage.setItem(LANG_STORAGE_KEY, lang);
      } catch {
        // ignore
      }
      // If signed in, persist to userProfiles so the choice syncs across
      // devices. If the mutation fails (network blip), the localStorage
      // value still keeps the choice for this device.
      if (profile) {
        try {
          await updateProfile({ preferredLanguage: lang });
        } catch {
          // Non-fatal — the user already has their language locally.
        }
      }
    },
    [enabled, i18n, profile, updateProfile],
  );

  return {
    enabled,
    loading,
    language,
    setLanguage,
    supported: SUPPORTED_LANGUAGES,
  };
}
