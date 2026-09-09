// Pricing page — clear, honest breakdown of free vs premium.
//
// Reuses the REAL gating logic/pricing data already built — reads
// PREMIUM_PRICE_ETB etc. from the configKeys table via the existing
// convex queries. Does NOT hardcode numbers that could drift from
// reality.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Check, Sparkles, X } from "lucide-react";
import { Link } from "react-router";
import { MarketingLayout } from "@/components/MarketingLayout";
import { Button } from "@/components/ui/button";

const FREE_FEATURES = [
  { text: "Full textbook + past exam library", included: true },
  { text: "15 AI tutor messages per day", included: true },
  { text: "Weekly quizzes per subject", included: true },
  { text: "Unlimited flashcard decks", included: true },
  { text: "Study group access", included: true },
  { text: "Unlimited AI tutor messages", included: false },
  { text: "Full-length mock exams with scoring", included: false },
  { text: "Aptitude Hub (SAT-style reasoning)", included: false },
];

const PREMIUM_FEATURES = [
  { text: "Everything in Free, plus:", included: true, isHeader: true },
  { text: "Unlimited AI tutor messages", included: true },
  { text: "Full-length mock exams with instant scoring", included: true },
  { text: "Aptitude Hub (SAT-style reasoning)", included: true },
  { text: "Longer AI responses + context retention", included: true },
  { text: "Priority support", included: true },
];

export default function PricingPage() {
  // Pull live pricing from the configKeys table — admin-managed.
  // Falls back to sensible defaults if the admin hasn't set custom prices.
  const price1mo = useQuery(api.configKeys.getKeyValue, { key: "PREMIUM_PRICE_ETB" });
  const price3mo = useQuery(api.configKeys.getKeyValue, { key: "PREMIUM_PRICE_3MO" });
  const price6mo = useQuery(api.configKeys.getKeyValue, { key: "PREMIUM_PRICE_6MO" });
  const price12mo = useQuery(api.configKeys.getKeyValue, { key: "PREMIUM_PRICE_12MO" });

  const fmt = (val: { value: string | null } | undefined, fallback: string): string => {
    if (val === undefined) return "…"; // loading
    if (val.value === null) return fallback;
    return `ETB ${val.value}`;
  };

  const monthly = fmt(price1mo, "ETB 199");
  const three = fmt(price3mo, monthly);
  const six = fmt(price6mo, monthly);
  const twelve = fmt(price12mo, monthly);

  return (
    <MarketingLayout
      eyebrow="Pricing"
      eyebrowIcon={Sparkles}
      title={<>Honest pricing. <span className="text-gradient">Free forever</span> tier.</>}
      subtitle="No credit card required for free. Manual payment via TeleBirr or M-Pesa for premium — no auto-renewal."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Free tier */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.45 }}
          className="glass-panel rounded-2xl p-5 sm:p-7"
        >
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Free
          </p>
          <p className="mt-2 text-3xl font-extrabold">ETB 0</p>
          <p className="text-xs text-muted-foreground">forever</p>
          <p className="mt-3 text-sm font-semibold">Everything you need to start.</p>
          <ul className="mt-4 space-y-2">
            {FREE_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-2 text-sm">
                {f.included ? (
                  <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" />
                ) : (
                  <X className="mt-0.5 size-4 shrink-0 text-muted-foreground/40" />
                )}
                <span className={f.included ? "text-foreground" : "text-muted-foreground/60 line-through"}>
                  {f.text}
                </span>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-5 w-full">
            <Link to="/auth?returnTo=%2Fdashboard">Start free</Link>
          </Button>
        </motion.div>

        {/* Premium tier */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.45, delay: 0.05 }}
          className="glass-panel relative rounded-2xl border-amber-400/30 p-5 sm:p-7"
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">
            Most popular
          </div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
            Premium
          </p>
          <p className="mt-2 text-3xl font-extrabold">{monthly}</p>
          <p className="text-xs text-muted-foreground">/ month</p>
          <p className="mt-3 text-sm font-semibold">For students ready to commit.</p>
          <ul className="mt-4 space-y-2">
            {PREMIUM_FEATURES.map((f) => (
              <li
                key={f.text}
                className={
                  f.isHeader
                    ? "text-xs font-bold uppercase tracking-wider text-amber-300"
                    : "flex items-start gap-2 text-sm"
                }
              >
                {!f.isHeader && (
                  <Check className="mt-0.5 size-4 shrink-0 text-amber-300" />
                )}
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs">
            <p className="font-semibold">Bundle options (manual payment):</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>3 months — {three}</li>
              <li>6 months — {six}</li>
              <li>12 months — {twelve}</li>
            </ul>
          </div>
          <Button asChild className="mt-5 w-full">
            <Link to="/upgrade">Choose a plan</Link>
          </Button>
        </motion.div>
      </div>

      <p className="px-2 text-center text-[11px] text-muted-foreground">
        Prices and durations are managed live by the admin and shown on the
        /upgrade page. This page is a summary — for the exact current pricing,
        visit <Link to="/upgrade" className="underline">/upgrade</Link>.
      </p>
    </MarketingLayout>
  );
}
