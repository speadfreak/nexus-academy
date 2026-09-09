// Audience page template — used for For Students, For Teachers, For
// Parents, For Schools. Each is a short, honest, audience-specific page
// explaining the platform's value from that perspective.
//
// No fabricated stats or testimonials — just a real explanation of how
// the platform serves each audience.

import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
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
  return (
    <AudiencePage
      eyebrow="For Schools"
      eyebrowIcon={undefined as never}
      eyebrowColor="violet"
      title={<>For <span className="text-gradient">Schools</span></>}
      subtitle="Complement your teaching, not replace it."
      body="Schools across Ethiopia use Learnyx as an after-hours study companion. The library covers the full national curriculum for grades 9–12. Study groups let teachers create private rooms for their classes. There's no school-level admin dashboard yet — but if you're a school administrator interested in piloting Learnyx with your students, contact us and we'll work with you directly."
      cta="Contact us"
      ctaHref="/contact"
      secondaryCta="See the tools"
      secondaryHref="/tools"
    />
  );
}
