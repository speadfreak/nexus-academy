// BrowserLanguagePrompt — Phase 7 addition.
//
// On the first visit to the Landing page (when MULTI_LANGUAGE_ENABLED is
// true), auto-detects the browser language. If the user's browser is set
// to one of the supported non-English languages (am/om/ti), shows a
// dismissible soft suggestion: "Prefer Amharic? Switch here."
//
// DISMISSABLE:
//   - The suggestion can be dismissed with an X button.
//   - Dismissal is persisted in localStorage (per-browser) so we don't
//     nag returning visitors.
//   - Re-shows if the user clears localStorage, or if we bump the
//     DISMISS_KEY_VERSION (e.g. when adding a new language).
//
// NON-FORCING:
//   - Never auto-switches. Just suggests. Clicking the suggestion
//     switches the language. Ignoring it keeps the current language.

import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import type { Lang } from "@/hooks/useLanguage";

const DISMISS_KEY = "learnyx.lang-prompt-dismissed";
// Bump this when we want the prompt to re-show for everyone (e.g. a new
// language was added). Old dismiss-key values are invalidated.
const DISMISS_KEY_VERSION = "1";

interface BrowserLanguagePromptProps {
  /** Where to render — "top-of-page" (landing banner) or "inline". */
  variant?: "banner" | "inline";
}

export function BrowserLanguagePrompt({ variant = "banner" }: BrowserLanguagePromptProps) {
  const { enabled, language, setLanguage, supported } = useLanguage();
  const { i18n } = useTranslation();
  const [detected, setDetected] = useState<Lang | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Detect the browser language once on mount. Only consider the 3
  // non-English supported languages — if the browser is English (or any
  // other unsupported language), we don't show a prompt.
  useEffect(() => {
    if (!enabled) return;
    // Check dismissal state — uses a versioned key so old dismissals
    // don't suppress future prompts after we add a new language.
    try {
      const storedVersion = window.localStorage.getItem(DISMISS_KEY);
      if (storedVersion === DISMISS_KEY_VERSION) {
        setDismissed(true);
        return;
      }
    } catch {
      // ignore
    }
    // Get the browser language — navigator.language gives e.g. "am-ET"
    // or "am". We want the language code only (before the dash).
    const nav = navigator.language || (navigator as unknown as { languages?: string[] }).languages?.[0] || "";
    const code = nav.split("-")[0]?.toLowerCase();
    if (code === "am" || code === "om" || code === "ti") {
      setDetected(code as Lang);
    }
  }, [enabled]);

  // Don't show if multi-language is off, the prompt was dismissed, we
  // didn't detect a supported non-English browser language, OR the user
  // already switched to that language (no point suggesting it again).
  if (!enabled || dismissed || !detected || language === detected) return null;

  const detectedLang = supported.find((l) => l.code === detected);
  if (!detectedLang) return null;

  const handleSwitch = () => {
    void setLanguage(detected);
  };
  const handleDismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, DISMISS_KEY_VERSION);
    } catch {
      // ignore
    }
  };

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 text-xs">
        <span className="text-amber-300">
          Prefer {detectedLang.nativeLabel}?
        </span>
        <button
          type="button"
          onClick={handleSwitch}
          className="cursor-pointer font-semibold text-amber-200 underline underline-offset-2 hover:text-amber-100"
        >
          Switch here
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="ml-auto cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
    );
  }

  // Banner variant — top of the landing page, full-width dismissible
  return (
    <div className="relative z-40 mx-auto max-w-6xl px-4 pt-2">
      <div className="glass-panel flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-2.5 text-sm">
        <span className="text-base">{detectedLang.flag}</span>
        <span className="flex-1 text-amber-200">
          Prefer {detectedLang.nativeLabel} ({detectedLang.label})?{" "}
          <button
            type="button"
            onClick={handleSwitch}
            className="cursor-pointer font-semibold underline underline-offset-2 hover:text-amber-100"
          >
            Switch here
          </button>
        </span>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss suggestion"
          className="cursor-pointer text-amber-300/70 hover:text-amber-200"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
