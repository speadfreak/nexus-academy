// MarketingLayout — shared layout for the Phase 6 marketing pages
// (About, FAQ, For Students/Teachers/Parents/Schools, Tools, Contact, Pricing).
//
// Provides the standard header (back link + title + subtitle) and a content
// container with the same glass-panel + dark/gold aesthetic as the Privacy
// and Terms pages. Keeps every marketing page visually consistent without
// duplicating 50 lines of boilerplate per page.
//
// USAGE:
//   <MarketingLayout
//     eyebrow="About"
//     eyebrowIcon={Sparkles}
//     title={<>About <span className="text-gradient">Learnyx</span></>}
//     subtitle="Built in Ethiopia, for Ethiopia."
//   >
//     {/* page content */}
//   </MarketingLayout>

import { motion } from "framer-motion";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";

interface MarketingLayoutProps {
  /** Small uppercase label above the title (e.g. "About", "FAQ"). */
  eyebrow: string;
  /** Icon for the eyebrow chip. */
  eyebrowIcon?: LucideIcon;
  /** The page's H1 — can include gradient spans for visual interest. */
  title: React.ReactNode;
  /** Subtitle paragraph below the title. */
  subtitle?: string;
  /** Page content — rendered inside the standard content container. */
  children: React.ReactNode;
  /** Optional eyebrow accent color — defaults to amber (the brand gold). */
  eyebrowColor?: "amber" | "sky" | "emerald" | "rose" | "violet";
}

const COLOR_MAP = {
  amber: { text: "text-amber-300", bg: "bg-amber-400/[0.06]", border: "border-amber-400/20" },
  sky: { text: "text-sky-300", bg: "bg-sky-400/[0.06]", border: "border-sky-400/20" },
  emerald: { text: "text-emerald-300", bg: "bg-emerald-400/[0.06]", border: "border-emerald-400/20" },
  rose: { text: "text-rose-300", bg: "bg-rose-400/[0.06]", border: "border-rose-400/20" },
  violet: { text: "text-violet-300", bg: "bg-violet-400/[0.06]", border: "border-violet-400/20" },
} as const;

export function MarketingLayout({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  subtitle,
  children,
  eyebrowColor = "amber",
}: MarketingLayoutProps) {
  const c = COLOR_MAP[eyebrowColor];
  return (
    <div className="relative min-h-screen">
      {/* Ambient backdrop */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 size-96 rounded-full bg-amber-400/[0.05] blur-[120px]" />
        <div className="absolute -bottom-20 -left-20 size-96 rounded-full bg-primary/[0.04] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        {/* Top row — back link + language switcher (auto-gated) */}
        <div className="flex items-center justify-between gap-4">
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" /> Back to home
          </Link>
          <LanguageSwitcher variant="nav" />
        </div>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8"
        >
          <div className={`inline-flex items-center gap-2 rounded-full border ${c.border} ${c.bg} px-3 py-1`}>
            {EyebrowIcon ? <EyebrowIcon className={`size-3.5 ${c.text}`} /> : null}
            <span className={`font-mono text-[11px] font-bold uppercase tracking-[0.18em] ${c.text}`}>
              {eyebrow}
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {subtitle}
            </p>
          )}
        </motion.div>

        {/* Content */}
        <div className="mt-10 flex flex-col gap-6">
          {children}
        </div>

        {/* Bottom CTA — standard across all marketing pages */}
        <div className="mt-12 flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center sm:p-8">
          <p className="text-lg font-bold">Ready to dive in?</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Start studying free — no credit card, no trial timer pressure.
          </p>
          <div className="mt-2 flex gap-2">
            <Button asChild>
              <Link to="/auth?returnTo=%2Fdashboard">Start studying free</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/library">Explore the library</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
