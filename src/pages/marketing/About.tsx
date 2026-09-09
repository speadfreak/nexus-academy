// About page — founder story, mission, values.
//
// Written to feel personal and authentic (matching the user's brief),
// not corporate. The story of Joseph James building Learnyx while
// preparing for his own national exams. Honest about what the platform
// is — not a corporate product, but the tool he wished he'd had.

import { motion } from "framer-motion";
import { Heart, Lightbulb, Shield, Sparkles, User } from "lucide-react";
import { MarketingLayout } from "@/components/MarketingLayout";

const VALUES = [
  {
    icon: Shield,
    title: "Honesty",
    body: "No fabricated testimonials. No fake stats. No fake 'AI-generated' study tips that are just marketing. What we say, we can prove.",
  },
  {
    icon: Heart,
    title: "Accessibility",
    body: "The free tier is genuinely useful, not a demo. A student who can't pay should never lose access to all AI help — that's why we keep a 15-message/day free tier forever.",
  },
  {
    icon: Lightbulb,
    title: "Transparency",
    body: "Our Terms, Privacy Policy, and pricing are written in plain language. No dark patterns, no hidden trial timers, no auto-renewals you can't cancel.",
  },
];

export default function AboutPage() {
  return (
    <MarketingLayout
      eyebrow="About"
      eyebrowIcon={Sparkles}
      title={<>About <span className="text-gradient">Learnyx Academy ET</span></>}
      subtitle="Built in Ethiopia, for Ethiopia."
    >
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45 }}
        className="glass-panel rounded-2xl p-5 sm:p-7"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <User className="size-5" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
              The founder
            </p>
            <h2 className="type-h2">Joseph James</h2>
          </div>
        </div>
        <p className="mt-4 text-base font-semibold text-foreground">
          18 years old · Ethiopian developer · Addis Ababa
        </p>
        <p className="mt-3 text-base leading-relaxed text-foreground/80">
          Learnyx Academy ET started as a single question — why does preparing
          for the EHEEE feel so lonely?
        </p>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          I'm Joseph. I built Learnyx while preparing for my own national exams.
          The textbooks were heavy, the past papers were scattered, and the few
          apps that existed were either in English with no Ethiopian context or
          so full of ads that studying became impossible. I wanted a single
          tool that felt like a friend who already knew the syllabus — and
          that's what Learnyx is.
        </p>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every feature on this platform was built because I needed it during
          my own exam prep: the AI tutor that never gets tired of explaining
          photosynthesis at midnight, the mock exams that score themselves,
          the flashcards that remember what I forget. It's not a corporate
          product. It's the tool I wish I'd had.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, delay: 0.05 }}
        className="glass-panel rounded-2xl p-5 sm:p-7"
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
          Our mission
        </p>
        <h2 className="type-h2 mt-1">Every Ethiopian student deserves a fair shot.</h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          Every Ethiopian student — regardless of school, region, or family
          income — deserves a fair shot at the EHEEE. We make the best
          exam-prep tools free for as many students as possible, and keep the
          premium tier priced honestly so it stays within reach.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, delay: 0.1 }}
        className="glass-panel rounded-2xl p-5 sm:p-7"
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
          What we stand for
        </p>
        <h2 className="type-h2 mt-1">Three principles, no exceptions.</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {VALUES.map((value) => (
            <div key={value.title} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <value.icon className="size-5 text-primary" />
              <p className="mt-2 text-sm font-bold">{value.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {value.body}
              </p>
            </div>
          ))}
        </div>
      </motion.section>
    </MarketingLayout>
  );
}
