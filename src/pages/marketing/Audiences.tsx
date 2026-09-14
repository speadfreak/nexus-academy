// Audience page template — used for For Students, For Teachers, For
// Parents, For Schools. Each is a short, honest, audience-specific page
// explaining the platform's value from that perspective.
//
// No fabricated stats or testimonials — just a real explanation of how
// the platform serves each audience.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { MarketingLayout } from "@/components/MarketingLayout";
import { Button } from "@/components/ui/button";

interface AudiencePageProps {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  eyebrowColor?: "amber" | "sky" | "emerald" | "rose" | "violet";
  title: React.ReactNode;
  subtitle: string;
  body: string;
  cta: string;
  ctaHref: string;
  secondaryCta?: string;
  secondaryHref?: string;
}

export function AudiencePage({
  eyebrow,
  eyebrowIcon,
  eyebrowColor = "amber",
  title,
  subtitle,
  body,
  cta,
  ctaHref,
  secondaryCta,
  secondaryHref,
}: AudiencePageProps) {
  return (
    <MarketingLayout
      eyebrow={eyebrow}
      eyebrowIcon={eyebrowIcon}
      eyebrowColor={eyebrowColor}
      title={title}
      subtitle={subtitle}
    >
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45 }}
        className="glass-panel rounded-2xl p-5 sm:p-7"
      >
        <p className="text-base leading-relaxed text-muted-foreground">
          {body}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link to={ctaHref}>{cta}</Link>
          </Button>
          {secondaryCta && secondaryHref && (
            <Button asChild variant="outline">
              <Link to={secondaryHref}>{secondaryCta}</Link>
            </Button>
          )}
        </div>
      </motion.section>
    </MarketingLayout>
  );
}

// ── The four audience pages ─────────────────────────────────────────

export function ForStudentsPage() {
  return (
    <AudiencePage
      eyebrow="For Students"
      eyebrowIcon={undefined as never}
      title={<>For <span className="text-gradient">Students</span></>}
      subtitle="Your unfair advantage for the EHEEE."
      body="Learnyx is built for the way you actually study — late nights, tight deadlines, and a syllabus that feels endless. The AI tutor is available 24/7, the mock exams score themselves, and the flashcard decks adapt to what you forget. Everything is free for the daily essentials; premium unlocks the deep-practice tools (mock exams, aptitude hub, unlimited AI) when you're ready to commit."
      cta="Start studying free"
      ctaHref="/auth?returnTo=%2Fdashboard"
      secondaryCta="Explore the library"
      secondaryHref="/library"
    />
  );
}

export function ForTeachersPage() {
  return (
    <AudiencePage
      eyebrow="For Teachers"
      eyebrowIcon={undefined as never}
      eyebrowColor="emerald"
      title={<>For <span className="text-gradient">Teachers</span></>}
      subtitle="A second teacher for every student, after school hours."
      body="You can't be available at midnight — but Learnyx can. The AI tutor answers student questions in seconds, with explanations you'd approve of. The library gives your students access to every textbook and past exam. The study groups let your class work together outside school hours. Use Learnyx as a complement to your teaching, not a replacement."
      cta="Explore the library"
      ctaHref="/library"
      secondaryCta="See the tools"
      secondaryHref="/tools"
    />
  );
}

export function ForParentsPage() {
  return (
    <AudiencePage
      eyebrow="For Parents"
      eyebrowIcon={undefined as never}
      eyebrowColor="rose"
      title={<>For <span className="text-gradient">Parents</span></>}
      subtitle="Honest tools, honest pricing."
      body="Learnyx is built so your child can study without being sold to. No ads on study pages, no in-app purchases, no dark patterns pushing them toward premium. The free tier is genuinely useful — your child can study the full library and get 15 AI tutor answers per day at no cost. Premium is manual payment via TeleBirr or M-Pesa — you only pay for the period you choose, with no auto-renewal."
      cta="See how it works"
      ctaHref="/about"
      secondaryCta="See pricing"
      secondaryHref="/pricing"
    />
  );
}

export function ForSchoolsPage() {
  return <SchoolsDeepPage />;
}

/**
 * SchoolsDeepPage — the expanded /for-schools page with honest, deep
 * marketing copy explaining the mechanism, the privacy model, the bulk
 * pricing concept, and a live seat-pricing calculator widget. Gated on
 * SCHOOL_FEATURE_ENABLED — the route itself redirects to / when the
 * feature is off (handled in main.tsx), so this component only renders
 * when the feature is live.
 */
function SchoolsDeepPage() {
  return (
    <MarketingLayout
      eyebrow="For Schools"
      eyebrowColor="violet"
      title={<>For <span className="text-gradient">Schools</span></>}
    >
      <div className="mx-auto max-w-4xl px-4 py-16 sm:py-24">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <span className="inline-block rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-violet-300">
            For Schools
          </span>
          <h1 className="mt-4 type-display text-gradient">
            Bring your entire class onto Learnyx in minutes
          </h1>
          <p className="mx-auto mt-4 max-w-2xl type-body-lg text-muted-foreground">
            Not one signup at a time. Set up your school, create classes, share a
            code — your students join instantly, pre-configured with the right
            grade and stream. Optional bulk premium means no individual payment
            friction for your students.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg" className="rounded-xl">
              <Link to="/contact?subject=School%20partnership%20inquiry">
                Get your school set up
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl bg-white/5">
              <Link to="/tools">See the tools</Link>
            </Button>
          </div>
        </motion.div>

        {/* How it works */}
        <div className="mt-20">
          <h2 className="text-center type-h2">How it works</h2>
          <div className="mt-10 grid gap-6 sm:grid-cols-3">
            {[
              {
                step: "1",
                title: "School gets set up",
                body: "We create your school on the platform and designate you as the director. You get a dedicated dashboard for managing classes.",
              },
              {
                step: "2",
                title: "Create classes + share codes",
                body: "Create a class for each grade/section. Each class gets a shareable 6-character code. Students enter the code during signup — they're pre-configured with the right grade and stream automatically.",
              },
              {
                step: "3",
                title: "Optional bulk premium",
                body: "Purchase premium seats in bulk at tiered discounts. Students on a school seat get full premium access — AI tutor, mock exams, the works — without any individual payment friction.",
              },
            ].map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="glass-panel rounded-2xl p-6"
              >
                <div className="flex size-10 items-center justify-center rounded-xl bg-violet-400/15 font-mono text-lg font-extrabold text-violet-300">
                  {s.step}
                </div>
                <h3 className="mt-4 type-h3">{s.title}</h3>
                <p className="mt-2 type-body text-muted-foreground">{s.body}</p>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Privacy commitment */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel mt-16 rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.03] p-8"
        >
          <h2 className="type-h2 text-emerald-200">Privacy, stated clearly</h2>
          <p className="mt-3 max-w-2xl type-body-lg text-foreground/90">
            Teachers see class-wide progress, never individual student data —
            unless a student chooses to share it.
          </p>
          <p className="mt-4 type-body text-muted-foreground">
            Directors see aggregate class metrics: how many students completed
            today's mission, average quiz accuracy, class-wide weakness radar.
            Individual quiz answers, flashcard weaknesses, notes, and study
            history stay private to each student. A student can opt in to share
            detailed individual progress with their school from Settings — it's
            always the student's choice, never the default.
          </p>
          <p className="mt-4 type-body text-muted-foreground">
            Because privacy matters, especially for students.
          </p>
        </motion.div>

        {/* Live pricing calculator */}
        <SeatPricingCalculator />

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-16 text-center"
        >
          <h2 className="type-h2">Ready to set up your school?</h2>
          <p className="mx-auto mt-3 max-w-xl type-body text-muted-foreground">
            Tell us about your school — we'll get you set up with a director
            dashboard, create your first classes, and walk you through the bulk
            premium process.
          </p>
          <Button asChild size="lg" className="mt-6 rounded-xl">
            <Link to="/contact?subject=School%20partnership%20inquiry">
              Get your school set up
            </Link>
          </Button>
        </motion.div>
      </div>
    </MarketingLayout>
  );
}

/**
 * SeatPricingCalculator — live widget on /for-schools that pulls real
 * tier pricing from configKeys and calculates the total instantly as
 * the decision-maker adjusts seat count + duration. Makes the value
 * concrete without needing to contact us first just to learn pricing.
 */
function SeatPricingCalculator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel mt-16 rounded-3xl p-8"
    >
      <h2 className="type-h2">Bulk seat pricing calculator</h2>
      <p className="mt-2 type-body text-muted-foreground">
        Real per-seat rates, set by us. More seats = lower per-seat cost. Pick
        your seat count and duration to see the total instantly.
      </p>
      <SeatPricingCalculatorInner />
    </motion.div>
  );
}

function SeatPricingCalculatorInner() {
  // Lazy-load the live pricing via a separate component so the page
  // doesn't block on the query.
  return <LivePricing />;
}

function LivePricing() {
  const pricing = useQuery(api.configKeys.getSchoolSeatPricing);
  const [seatCount, setSeatCount] = useState(30);
  const [duration, setDuration] = useState(3);

  const { tierRate, tierUsed, total } = useMemo(() => {
    if (!pricing) return { tierRate: 0, tierUsed: 1, total: 0 };
    const tier = seatCount >= 100 ? 4 : seatCount >= 50 ? 3 : seatCount >= 20 ? 2 : 1;
    const rate = tier === 4 ? pricing.tier4 : tier === 3 ? pricing.tier3 : tier === 2 ? pricing.tier2 : pricing.tier1;
    return { tierRate: rate, tierUsed: tier, total: rate * seatCount * duration };
  }, [pricing, seatCount, duration]);

  const tierLabel = ["", "1–19 seats", "20–49 seats", "50–99 seats", "100+ seats"][tierUsed];

  return (
    <div className="mt-6 flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Seats</label>
          <input
            type="range"
            min={1}
            max={200}
            value={seatCount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSeatCount(Number(e.target.value))}
            className="mt-2 w-full cursor-pointer accent-violet-400"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">1</span>
            <span className="font-mono text-sm font-bold text-foreground">{seatCount} seats</span>
            <span className="font-mono text-xs text-muted-foreground">200</span>
          </div>
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Duration (months)</label>
          <input
            type="range"
            min={1}
            max={12}
            value={duration}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDuration(Number(e.target.value))}
            className="mt-2 w-full cursor-pointer accent-violet-400"
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">1 mo</span>
            <span className="font-mono text-sm font-bold text-foreground">{duration} month{duration === 1 ? "" : "s"}</span>
            <span className="font-mono text-xs text-muted-foreground">12 mo</span>
          </div>
        </div>
      </div>

      {/* Tier indicator */}
      <div className="flex items-center gap-2">
        <span className="rounded-lg border border-violet-400/30 bg-violet-400/10 px-2.5 py-1 text-xs font-bold text-violet-300">
          Tier {tierUsed}: {tierLabel}
        </span>
        {pricing && (
          <span className="font-mono text-xs text-muted-foreground">
            {tierRate} ETB / seat / month
          </span>
        )}
      </div>

      {/* Total */}
      <div className="rounded-2xl border border-violet-400/20 bg-violet-400/[0.05] p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Estimated total
        </p>
        <p className="mt-1 font-mono text-3xl font-extrabold text-violet-200">
          {total.toLocaleString()} <span className="text-base text-muted-foreground">ETB</span>
        </p>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          {seatCount} seats × {duration} month{duration === 1 ? "" : "s"} × {tierRate} ETB/seat/mo
        </p>
      </div>
      <p className="font-mono text-[10px] text-muted-foreground/60">
        Final price is confirmed at purchase. Payment via TeleBirr. Contact us to get started.
      </p>
    </div>
  );
}
