// LanguageSwitcher — a dropdown that lets the user pick between the 4
// supported languages (English / አማርኛ / Afaan Oromoo / ትግርኛ).
//
// GATING:
//   - When MULTI_LANGUAGE_ENABLED is false, this component renders NOTHING.
//   - When true, it renders a globe-icon button that opens a dropdown with
//     the 4 language options.
//
// PLACEMENTS:
//   - Landing page nav (next to the theme toggle)
//   - Dashboard account sheet (between "Appearance" and "Log out")
//
// ADMIN-ONLY NOTE (Phase 7):
//   For Afaan Oromoo + Tigrigna, an admin-only "needs review" note is
//   shown inline so the platform owner doesn't forget that these two
//   translations need native-speaker review before wide promotion.
//   Students never see this note — only admins.

import { Check, ChevronDown, Globe2, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/useLanguage";
import type { Lang } from "@/hooks/useLanguage";

interface LanguageSwitcherProps {
  /** Visual variant — "nav" for the landing page (compact icon-button),
      "sheet" for the account sheet (full-width, with subtitles). */
  variant?: "nav" | "sheet";
  /** Optional className to merge into the trigger button. */
  className?: string;
}

export function LanguageSwitcher({
  variant = "nav",
  className,
}: LanguageSwitcherProps) {
  const { enabled, language, setLanguage, supported } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Admin-only check — for the "needs review" note on om/ti (Phase 7).
  // The note is ONLY shown to admins, never to students.
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Gating — when multi-language is disabled, render nothing.
  if (!enabled) return null;

  const currentLang = supported.find((l) => l.code === language) ?? supported[0]!;

  const handleSelect = (code: string) => {
    void setLanguage(code as Lang);
    setOpen(false);
  };

  // ── Nav variant (landing page) ──────────────────────────────────────
  if (variant === "nav") {
    return (
      <div ref={containerRef} className="relative">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
          aria-label="Change language"
          aria-haspopup="menu"
          aria-expanded={open}
          title="Change language"
          className={cn(
            "group gap-2 rounded-lg border-primary/20 bg-background/70 px-2.5 shadow-sm backdrop-blur",
            className,
          )}
        >
          <Globe2 className="size-3.5 text-primary" />
          <span className="hidden type-caption font-bold uppercase tracking-wider sm:inline">
            {currentLang.nativeLabel}
          </span>
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
        {open && (
          <div
            role="menu"
            className="glass-panel absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/10 p-1.5 shadow-2xl"
          >
            <p className="px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Choose your language
            </p>
            {supported.map((lang) => (
              <button
                key={lang.code}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(lang.code)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  language === lang.code
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-white/5",
                )}
              >
                <span className="text-base">{lang.flag}</span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">
                    {lang.nativeLabel}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {lang.label}
                  </span>
                </span>
                {language === lang.code && (
                  <Check className="size-4 text-primary" />
                )}
                {/* Phase 7 — admin-only "needs review" note for om + ti.
                    Only renders for admins, never for students. */}
                {isAdmin?.isAdmin && (lang.code === "om" || lang.code === "ti") && (
                  <ShieldAlert
                    className="size-3 text-amber-400"
                    aria-label="Translation preview — pending native-speaker review"
                  />
                )}
              </button>
            ))}
            {isAdmin?.isAdmin && (
              <p className="mt-1 border-t border-white/10 px-2.5 py-1.5 text-[10px] text-amber-300/70">
                <ShieldAlert className="mr-1 inline size-2.5" />
                Afaan Oromoo + Tigrigna are preview translations — pending
                native-speaker review before wide promotion.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Sheet variant (account sheet) ──────────────────────────────────
  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Globe2 className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Language</p>
          <p className="text-xs text-muted-foreground">
            {currentLang.nativeLabel} · {currentLang.label}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="mt-2 rounded-xl border border-white/10 bg-black/40 p-1.5"
        >
          {supported.map((lang) => (
            <button
              key={lang.code}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(lang.code)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                language === lang.code
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-white/5",
              )}
            >
              <span className="text-base">{lang.flag}</span>
              <span className="flex-1">
                <span className="block text-sm font-semibold">
                  {lang.nativeLabel}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {lang.label}
                </span>
              </span>
              {language === lang.code && (
                <Check className="size-4 text-primary" />
              )}
              {isAdmin?.isAdmin && (lang.code === "om" || lang.code === "ti") && (
                <ShieldAlert
                  className="size-3 text-amber-400"
                  aria-label="Translation preview — pending native-speaker review"
                />
              )}
            </button>
          ))}
          {isAdmin?.isAdmin && (
            <p className="mt-1 border-t border-white/10 px-2.5 py-1.5 text-[10px] text-amber-300/70">
              <ShieldAlert className="mr-1 inline size-2.5" />
              Afaan Oromoo + Tigrigna need native-speaker review.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
