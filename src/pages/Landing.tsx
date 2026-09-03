import { AnimatePresence, motion, type Variants } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  Atom,
  AudioLines,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ChevronUp,
  ClipboardList,
  Clock,
  Dna,
  FileText,
  FlaskConical,
  GraduationCap,
  HelpCircle,
  Landmark,
  Languages,
  Lock,
  Map,
  NotebookPen,
  Plus,
  Presentation,
  Search,
  Sigma,
  Sparkles,
  Moon,
  Sun,
  Terminal,
  Timer,
  TrendingUp,
  Send,
  Users,
  Bell,
  MessageCircle,
} from "lucide-react";
import { useState, useEffect as useEff } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import logo from "@/assets/nexus-logo.svg";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09 } },
};

type StreamSubject = { name: string; slug: string; icon: typeof Languages; shared?: boolean };

// English, Mathematics and the SAT are sat by EVERY candidate — they're part
// of both tracks, so each stream card lists them with the "both streams" tag.
const SHARED_SUBJECTS: StreamSubject[] = [
  { name: "English", slug: "english", icon: Languages, shared: true },
  { name: "Mathematics", slug: "mathematics", icon: Sigma, shared: true },
  { name: "Scholastic Aptitude Test", slug: "scholastic-aptitude-test", icon: Brain, shared: true },
];

const STREAMS: {
  name: string;
  stream: string;
  slug: string;
  description: string;
  subjects: StreamSubject[];
}[] = [
  {
    name: "Natural Science",
    stream: "natural",
    slug: "stream/natural",
    description:
      "The science track for STEM-bound students — physics, chemistry and biology, exam-ready.",
    subjects: [
      { name: "Physics", slug: "physics", icon: Atom },
      { name: "Chemistry", slug: "chemistry", icon: FlaskConical },
      { name: "Biology", slug: "biology", icon: Dna },
      ...SHARED_SUBJECTS,
    ],
  },
  {
    name: "Social Science",
    stream: "social",
    slug: "stream/social",
    description:
      "The humanities track — history, geography and economics, aligned to the national syllabus.",
    subjects: [
      { name: "History", slug: "history", icon: Landmark },
      { name: "Geography", slug: "geography", icon: Map },
      { name: "Economics", slug: "economics", icon: TrendingUp },
      ...SHARED_SUBJECTS,
    ],
  },
];

const CONTENT_TYPES = [
  {
    name: "Textbooks",
    type: "textbook",
    icon: BookOpen,
    description:
      "Full grade-level textbooks, chapter by chapter, ready for offline study.",
  },
  {
    name: "Past Exams",
    type: "past_exam",
    icon: CalendarDays,
    description:
      "Authentic national examination papers from recent years, with answer-ready formats.",
  },
  {
    name: "Worksheets",
    type: "worksheet",
    icon: ClipboardList,
    description:
      "Topic-focused practice sets that drill the concepts exams actually test.",
  },
  {
    name: "Student Guides",
    type: "student_guide",
    icon: GraduationCap,
    description:
      "Walkthroughs, summaries and revision roadmaps built for exam season.",
  },
  {
    name: "Teacher Guides",
    type: "teacher_guide",
    icon: Presentation,
    description:
      "Curriculum-aligned teaching notes and marking guidance for educators.",
  },
];

const STATS = [
  { value: "09", label: "Core subjects" },
  { value: "4", label: "Grades covered" },
  { value: "05", label: "Resource types" },
  { value: "14", label: "Active trial days" },
];

const COMPANION = [
  {
    icon: Brain,
    title: "AI tutor that knows your syllabus",
    description:
      "AI-powered tutor grounded in the real curriculum. It remembers your stream, your hard subjects and every conversation.",
    tag: "tutor",
  },
  {
    icon: HelpCircle,
    title: "Quick-check quizzes",
    description:
      "AI writes exam-style questions from your subject's topics. Answer one at a time, get instant feedback, watch scores trend on your journey.",
    tag: "quizzes",
  },
  {
    icon: Map,
    title: "Weekly study plans",
    description:
      "The AI sequences the syllabus into 4–8 focused weeks, exam-critical topics first, and mirrors them onto your calendar.",
    tag: "plans",
  },
  {
    icon: Timer,
    title: "Focus timer + streaks",
    description:
      "Log every session. Streaks, hours and per-subject history build up on your dashboard — and reminders nudge you before the streak breaks.",
    tag: "focus",
  },
  {
    icon: NotebookPen,
    title: "Sticky notes with difficulty tags",
    description:
      "Pin formulas and exam tricks. Mark a subject hard and the tutor slows down and explains from the foundation up.",
    tag: "notes",
  },
  {
    icon: AudioLines,
    title: "Study-vibe sound",
    description:
      "Rain, deep focus or breeze — a persistent ambient player tuned for concentration. Never autoplays; always your call.",
    tag: "vibe",
  },
  {
    icon: GraduationCap,
    title: "Full mock exams under real conditions",
    description:
      "AI generates ~340 original questions across all 6 EHEEE subjects — 50 min per section, no pausing, auto-graded per subject with progress tracking across attempts.",
    tag: "mock-exam",
  },
];

const STEPS = [
  {
    icon: Terminal,
    step: "01",
    title: "Sign in and pick your stream",
    description:
      "Create an account in seconds — email, Google or guest. Choose natural, social or common and the AI organizes your dashboard around your exam subjects.",
  },
  {
    icon: Search,
    step: "02",
    title: "Study with the companion",
    description:
      "Search the library, open past papers, chat with the tutor, run quizzes, plan your weeks and pin notes — every action feeds your real progress.",
  },
  {
    icon: TrendingUp,
    step: "03",
    title: "Watch your journey",
    description:
      "Streaks, hours, quiz scores and topic completion, charted honestly. Premium unlocks past exams, plans and unlimited tutoring.",
  },
];

export default function Landing() {
  const { isAuthenticated, isLoading, user, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const libraryHref = isAuthenticated
    ? "/dashboard"
    : "/auth?returnTo=%2Fdashboard";

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen overflow-x-hidden">
      {/* ------- Nav ------- */}
      <header className="sticky top-4 z-50 px-4">
        <motion.nav
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="glass-panel mx-auto flex max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5"
        >
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo} alt="NexET 🇪🇹 logo" className="size-9 rounded-xl" />
            <span className="flex items-baseline gap-2">
              <span className="type-h3 font-extrabold">NexET 🇪🇹</span>
              <span className="hidden font-mono text-[10px] font-medium text-muted-foreground sm:inline">
                v1.0
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-6 type-mono font-medium text-muted-foreground md:flex">
            <a href="#companion" className="transition-colors hover:text-foreground">
              companion
            </a>
            <a href="#streams" className="transition-colors hover:text-foreground">
              streams
            </a>
            <a href="#library" className="transition-colors hover:text-foreground">
              library
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              how-it-works
            </a>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              className="group gap-2 rounded-lg border-primary/20 bg-background/70 px-2.5 shadow-sm backdrop-blur"
            >
              {theme === "light" ? (
                <Moon className="size-3.5 text-primary" />
              ) : (
                <Sun className="size-3.5 text-amber-500" />
              )}
              <span className="hidden type-caption font-bold uppercase tracking-wider sm:inline">
                {theme === "light" ? "Dark mode" : "Light mode"}
              </span>
            </Button>
            {isAuthenticated ? (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to="/dashboard">
                    <span className="max-w-32 truncate">
                      {user?.name || user?.email || "Dashboard"}
                    </span>
                  </Link>
                </Button>
                <Button variant="outline" size="sm" onClick={handleSignOut}>
                  Sign out
                </Button>
              </>
            ) : (
              <Button asChild size="sm" className="rounded-lg">
                <Link to="/auth?returnTo=%2Fdashboard">
                  Sign in <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </div>
        </motion.nav>
      </header>

      {/* Aurora backdrop — animated, respects reduced motion */}
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[52rem] overflow-hidden">
        <motion.div
          animate={
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? undefined
              : { x: [0, 60, 0], y: [0, 30, 0] }
          }
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -left-32 top-10 size-[30rem] rounded-full bg-primary/15 blur-3xl"
        />
        <motion.div
          animate={
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? undefined
              : { x: [0, -50, 0], y: [0, 40, 0] }
          }
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -right-24 top-24 size-[26rem] rounded-full bg-amber-400/10 blur-3xl"
        />
        <motion.div
          animate={
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? undefined
              : { x: [0, 40, 0], y: [0, -30, 0] }
          }
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          className="absolute left-1/2 top-56 size-[24rem] -translate-x-1/2 rounded-full bg-amber-400/[0.07] blur-3xl"
        />
      </div>

      {/* ------- Announcement banner ------- */}
      <AnnouncementBanner />

      {/* ------- Hero ------- */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:pt-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="flex flex-col items-start"
        >
          <motion.div variants={fadeUp}>
            <Badge variant="outline" className="glass-chip gap-2 rounded-full px-3 py-1 type-caption font-semibold text-primary">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              // EHEEE / ESSLCE exam prep · grades 9–12
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="type-display mt-5"
          >
            Every subject.
            <br />
            Every grade.{" "}
            <span className="text-gradient">One indexed library.</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="type-body-lg mt-5 max-w-xl text-muted-foreground"
          >
            NexET 🇪🇹 is the complete content library for the EHEEE
            (Ethiopian Higher Education Entrance Examination, also called ESSLCE) —
            textbooks, past papers, worksheets and study guides across all nine
            subjects. Sign in, search the catalog, and download exactly what your
            grade and stream require.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-xl">
              <Link to={libraryHref}>
                Explore the library <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl bg-white/5">
              <a href="#streams">Browse subjects</a>
            </Button>
          </motion.div>

          <motion.div
            variants={fadeUp}
            className="type-mono mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-muted-foreground"
          >
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-primary" /> 09 subjects indexed
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-primary" /> real national past papers
            </span>
            <span className="flex items-center gap-1.5">
              <Lock className="size-4 text-primary" /> free to browse, premium to download
            </span>
          </motion.div>
        </motion.div>

        {/* Terminal mock */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
          className="relative mx-auto hidden w-full max-w-md lg:block"
        >
          <div className="glass-panel overflow-hidden rounded-2xl">
            <div className="flex items-center gap-2 border-b border-white/8 px-4 py-3">
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="size-2.5 rounded-full bg-white/15" />
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                nexus — catalog
              </span>
            </div>
            <div className="space-y-2.5 p-5 font-mono text-[12.5px] leading-relaxed">
              <p>
                <span className="text-primary">$</span>{" "}
                <span className="text-foreground">nexus search</span>{" "}
                <span className="text-muted-foreground">
                  --stream natural --grade 12
                </span>
              </p>
              <div className="rounded-lg border border-white/8 bg-black/30 px-3 py-2.5 text-[11.5px] text-muted-foreground">
                <p className="text-foreground">
                  <span className="text-primary">✓</span> 2023 Grade 12 Physics — National
                  Examination <span className="text-muted-foreground">· past-exam · 2.1 MB</span>
                </p>
                <p className="mt-1 text-foreground">
                  <span className="text-primary">✓</span> Grade 12 Chemistry — Full Curriculum
                  Textbook <span className="text-muted-foreground">· textbook · 320 pages</span>
                </p>
                <p className="mt-1 text-foreground">
                  <span className="text-primary">✓</span> Mechanics & Forces — Practice Set{" "}
                  <span className="text-muted-foreground">· worksheet · premium</span>
                </p>
              </div>
              <p>
                <span className="text-primary">$</span>{" "}
                <span className="text-foreground">nexus download</span>{" "}
                <span className="text-muted-foreground">
                  "2023-grade-12-physics" --signed
                </span>
              </p>
              <p className="text-[11.5px] text-muted-foreground">
                <span className="text-emerald-400">⠿</span> signed url ready · valid for 15 min
              </p>
            </div>
          </div>

          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
            className="glass-chip absolute -right-3 -top-3 flex items-center gap-2 rounded-full px-3 py-1.5 type-caption font-semibold"
          >
            <BookOpen className="size-3.5 text-primary" /> 09 subjects
          </motion.div>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
            className="glass-chip absolute -bottom-4 -left-4 flex items-center gap-2 rounded-full px-3 py-1.5 type-caption font-semibold"
          >
            <CalendarDays className="size-3.5 text-primary" /> years of past papers
          </motion.div>
        </motion.div>
      </section>

      {/* ------- The companion ------- */}
      <section id="companion" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.p
            variants={fadeUp}
            className="type-mono uppercase tracking-[0.2em] text-primary"
          >
            // the companion
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="type-h1 mt-3"
          >
            More than a library.{" "}
            <span className="text-gradient">A study system.</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground">
            Everything the national exams demand — organized, explained and tracked
            by an AI that learns your stream and your pace.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {COMPANION.map((feature) => (
            <motion.div
              key={feature.tag}
              variants={fadeUp}
              className="glass-panel hover-lift group rounded-2xl p-6 transition-all duration-300 hover:border-primary/30"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_oklch(0.78_0.15_80_/_0.25)]">
                  <feature.icon className="size-5" />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground transition-colors group-hover:text-primary">
                  {feature.tag}
                </span>
              </div>
              <h3 className="type-h3 mt-4">{feature.title}</h3>
              <p className="type-body mt-1.5 text-muted-foreground">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------- Mock Exam flagship showcase ------- */}
      <MockExamShowcase libraryHref={libraryHref} isAuthenticated={isAuthenticated} />

      {/* ------- Founder note ------- */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="glass-panel relative mx-auto max-w-2xl overflow-hidden rounded-3xl px-8 py-10"
        >
          <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative">
            <p className="type-mono uppercase tracking-[0.2em] text-primary">
              // why I built this
            </p>
            <div className="mt-4 type-body-lg leading-relaxed text-foreground/90">
              <p>
                I&apos;m Joseph James, 18 years old, Ethiopian. I built NexET 🇪🇹
                because I watched myself and my classmates struggle to organize four
                years of curriculum into something that actually felt like exam
                preparation — not just a pile of PDFs and half-remembered notes.
              </p>
              <p className="mt-3">
                The EHEEE is one of the most consequential exams a young Ethiopian
                takes. It deserved better than what we had. So I built the tool I
                wish existed when I was studying for it.
              </p>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/15 type-mono font-bold text-primary">
                JJ
              </div>
              <div>
                <p className="type-body font-semibold">Joseph James</p>
                <p className="type-caption text-muted-foreground">founder · developer</p>
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ------- Stats ------- */}
      <section className="mx-auto max-w-6xl px-4">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="glass-panel grid grid-cols-2 gap-y-6 rounded-3xl px-6 py-8 sm:grid-cols-4"
        >
          {STATS.map((stat) => (
            <motion.div
              key={stat.label}
              variants={fadeUp}
              className="flex flex-col items-center text-center"
            >
              <span className="type-h2 text-gradient">
                {stat.value}
              </span>
              <span className="type-mono mt-1 uppercase text-muted-foreground">
                {stat.label}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------- Exam countdown ------- */}
      {(() => {
        const now = new Date();
        const naturalExam = new Date("2026-06-30T08:00:00+03:00");
        const socialExam = new Date("2026-07-13T08:00:00+03:00");
        const naturalDays = Math.max(0, Math.ceil((naturalExam.getTime() - now.getTime()) / 86400000));
        const socialDays = Math.max(0, Math.ceil((socialExam.getTime() - now.getTime()) / 86400000));
        return (
          <section className="mx-auto max-w-6xl px-4 py-8">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5 }}
              className="glass-panel mx-auto flex flex-col items-center gap-5 rounded-2xl px-6 py-6 sm:flex-row sm:justify-center sm:gap-10"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                  <Clock className="size-5" />
                </div>
                <div>
                  <p className="type-body font-semibold">Natural Science EHEEE</p>
                  <p className="type-mono text-muted-foreground">June 30 – July 10, 2026</p>
                </div>
                <div className="ml-2 flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 type-mono font-bold text-emerald-300">
                  {naturalDays} days
                </div>
              </div>
              <div className="hidden h-8 w-px bg-white/10 sm:block" />
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                  <Clock className="size-5" />
                </div>
                <div>
                  <p className="type-body font-semibold">Social Science EHEEE</p>
                  <p className="type-mono text-muted-foreground">July 13 – July 23, 2026</p>
                </div>
                <div className="ml-2 flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1 type-mono font-bold text-amber-300">
                  {socialDays} days
                </div>
              </div>
            </motion.div>
          </section>
        );
      })()}

      {/* ------- Streams ------- */}
      <section id="streams" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.p
            variants={fadeUp}
            className="type-mono uppercase tracking-[0.2em] text-primary"
          >
            // the two streams
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="type-h1 mt-3"
          >
            Two streams, one national exam
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground">
            English, Mathematics and the SAT are sat by every candidate — they&apos;re
            part of both tracks. Pick your stream and the library is already
            organized around your exam subjects.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-5 md:grid-cols-3"
        >
          {STREAMS.map((stream) => (
            <motion.div
              key={stream.stream}
              variants={fadeUp}
              className="glass-panel hover-lift group rounded-2xl p-6 transition-all duration-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_oklch(0.78_0.15_80_/_0.25)]">
                  <GraduationCap className="size-5" />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {stream.slug}
                </span>
              </div>
              <h3 className="type-h2 mt-4">{stream.name}</h3>
              <p className="type-body mt-1.5 text-muted-foreground">
                {stream.description}
              </p>
              <ul className="mt-4 space-y-2.5 border-t border-white/8 pt-4">
                {stream.subjects.map((subject) => (
                  <li
                    key={subject.name}
                    className="type-body flex items-center justify-between gap-2 font-medium"
                  >
                    <span className="flex items-center gap-2.5">
                      <subject.icon className="size-4 text-primary/70" />
                      {subject.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      {subject.shared ? (
                        <span className="text-primary/60">both streams</span>
                      ) : (
                        subject.slug
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------- Library types ------- */}
      <section id="library" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.p
            variants={fadeUp}
            className="type-mono uppercase tracking-[0.2em] text-primary"
          >
            // the library
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="type-h1 mt-3"
          >
            Five resource types, one search
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground">
            From full textbooks to real past papers — filter and search by grade,
            subject and type in seconds.
          </motion.p>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {CONTENT_TYPES.map((type, index) => (
            <motion.div
              key={type.type}
              variants={fadeUp}
              className={`glass-soft hover-lift group rounded-2xl p-5 transition-all duration-300 hover:bg-white/[0.05] ${
                index === 4 ? "sm:col-span-2 lg:col-span-1" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <type.icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="type-h3">{type.name}</h3>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    type/{type.type}
                  </p>
                </div>
              </div>
              <p className="type-body mt-3 text-muted-foreground">
                {type.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------- Try before you sign up ------- */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="glass-panel mx-auto flex flex-col items-center gap-4 rounded-2xl px-6 py-8 text-center sm:flex-row sm:text-left"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <FileText className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="type-h3 font-semibold">Preview a real past paper — no signup required</p>
            <p className="type-body mt-1 text-muted-foreground">
              See exactly what NexET 🇪🇹 looks like before you create an account.
              One real EHEEE past exam paper, fully readable, right now.
            </p>
          </div>
          <Button asChild size="lg" variant="outline" className="shrink-0 rounded-xl bg-white/5 interactive-press">
            <Link to="/read/demo" className="gap-2">
              <BookOpen className="size-4" /> Try a past paper
            </Link>
          </Button>
        </motion.div>
      </section>

      {/* ------- How it works ------- */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 pb-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.p
            variants={fadeUp}
            className="type-mono uppercase tracking-[0.2em] text-primary"
          >
            // how it works
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="type-h1 mt-3"
          >
            From sign-in to exam room in three steps
          </motion.h2>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-12 grid gap-5 md:grid-cols-3"
        >
          {STEPS.map((step) => (
            <motion.div
              key={step.step}
              variants={fadeUp}
              className="glass-panel relative rounded-2xl p-6"
            >
              <span className="type-h2 absolute right-5 top-4 text-gradient opacity-70">
                {step.step}
              </span>
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <step.icon className="size-5" />
              </div>
              <h3 className="type-h3 mt-4">{step.title}</h3>
              <p className="type-body mt-1.5 text-muted-foreground">
                {step.description}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ------- FAQ (cinematic) ------- */}
      <section className="relative mx-auto max-w-5xl px-4 pb-28">
        {/* Background layers */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[2.5rem]">
          {/* Grid */}
          <div
            className="absolute inset-0 opacity-[0.06]"
            style={{
              backgroundImage:
                "linear-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)",
              backgroundSize: "64px 64px",
              maskImage:
                "radial-gradient(ellipse at center, black 30%, transparent 75%)",
              WebkitMaskImage:
                "radial-gradient(ellipse at center, black 30%, transparent 75%)",
            }}
          />
          {/* Giant floating ? mark */}
          <motion.div
            aria-hidden
            initial={{ opacity: 0, scale: 0.85 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          >
            <motion.div
              animate={{ rotate: [0, 4, -4, 0], y: [0, -12, 0] }}
              transition={{
                duration: 14,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="select-none text-[18rem] font-black leading-none text-foreground/[0.035] sm:text-[22rem]"
            >
              ?
            </motion.div>
          </motion.div>
          {/* Orbs */}
          <div className="pointer-events-none absolute -left-20 top-10 size-80 rounded-full bg-primary/15 blur-[100px]" />
          <div className="pointer-events-none absolute -right-20 bottom-10 size-72 rounded-full bg-amber-400/10 blur-[100px]" />
        </div>

        {/* Header */}
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mx-auto max-w-2xl text-center"
        >
          <motion.div
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full glass-chip px-4 py-1.5"
          >
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
              className="inline-flex size-4 items-center justify-center text-primary"
            >
              <HelpCircle className="size-4" />
            </motion.span>
            <p className="type-mono uppercase tracking-[0.2em] text-primary">
              // questions
            </p>
          </motion.div>
          <motion.h2 variants={fadeUp} className="type-h1 mt-6">
            Frequently{" "}
            <span className="relative inline-block">
              <span className="text-gradient">asked</span>
              <motion.span
                aria-hidden
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
                className="absolute -bottom-1 left-0 h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-primary via-amber-400 to-primary"
              />
            </span>
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-4 max-w-md text-muted-foreground"
          >
            Everything you need to know before you commit to smarter study. Tap
            a question to unfold the answer.
          </motion.p>
        </motion.div>

        {/* Accordion list */}
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-80px" }}
          className="mt-14 space-y-3"
        >
          {[
            {
              q: "Is this really free?",
              a: "Yes. The library, todos, focus timer, streaks, 15 tutor messages a day and a weekly quiz are free. Premium (past exams, unlimited tutoring, AI study plans) starts after a 14-day trial of active study days — not calendar days.",
            },
            {
              q: "Does it work on a slow connection?",
              a: "The library loads content lists fast even on 2G. Once a PDF is open it renders offline. The tutor and quizzes need a connection, but the app is designed to stay usable on Ethiopian mobile networks.",
            },
            {
              q: "Is my TeleBirr / M-Pesa payment safe?",
              a: "Payments are processed through your carrier's own secure checkout. NexET 🇪🇹 never sees your PIN or card number — we only receive a confirmation token.",
            },
            {
              q: "What happens when my trial ends?",
              a: "Your free features stay forever: library browsing, todos, focus timer, streaks and limited tutoring. Premium content (past papers, plans, unlimited tutor) pauses until you upgrade.",
            },
          ].map((faq, i) => (
            <FaqItem
              key={i}
              index={i + 1}
              question={faq.q}
              answer={faq.a}
            />
          ))}
        </motion.div>

        {/* Footer CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.1 }}
          className="mt-10 flex flex-col items-center justify-center gap-4 text-center sm:flex-row sm:text-left"
        >
          <p className="type-body text-muted-foreground">Still have questions?</p>
          <Link to="/auth">
            <Button
              variant="outline"
              className="group glass-soft cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium transition-all hover:border-primary/40 hover:bg-primary/5"
            >
              <Sparkles className="mr-2 size-4 text-primary transition-transform group-hover:scale-110" />
              Ask the AI Tutor
              <ArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </Link>
        </motion.div>
      </section>

      {/* ------- Telegram Community ------- */}
      <TelegramCommunitySection />

      {/* ------- CTA ------- */}
      <section className="mx-auto max-w-6xl px-4 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="glass-panel relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12"
        >
          <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full bg-amber-400/10 blur-3xl" />
          <div className="relative">
            <p className="type-mono uppercase tracking-[0.2em] text-primary">
              // get started
            </p>
            <h2 className="type-h1 mx-auto mt-3 max-w-2xl">
              Ready to walk into the exam room{" "}
              <span className="text-gradient">prepared?</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Create your free account and get instant access to every textbook,
              past paper and study guide for your stream — organized by grade and
              subject. Free covers the library, todos, the focus timer, streaks,
              15 tutor messages a day and a weekly quiz. Premium adds unlimited
              tutoring, unlimited quizzes and AI study plans when you&apos;re ready.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="rounded-xl">
                <Link to={libraryHref}>
                  {isAuthenticated ? "Open the library" : "Start studying free"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="rounded-xl bg-white/5"
              >
                <a href="#library">
                  <FileText className="size-4" /> View the catalog
                </a>
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ------- Footer ------- */}
      <footer className="relative border-t border-white/8 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.03] to-primary/[0.06]" />
        <div className="pointer-events-none absolute -left-24 bottom-0 size-64 rounded-full bg-primary/8 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 bottom-10 size-48 rounded-full bg-amber-400/5 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-14">
          {/* Signature credit — the standout element */}
          <div className="flex flex-col items-center text-center">
            <img src={logo} alt="NexET 🇪🇹 logo" className="mb-4 size-12 rounded-2xl" />
            <p className="type-h2">
              NexET 🇪🇹
            </p>
            <div className="mt-4 flex flex-col items-center gap-1">
              <p className="type-body-lg italic text-foreground/80">
                "The exam room shouldn't be a surprise."
              </p>
              <div className="mt-3 flex items-center gap-3">
                <div className="h-px w-8 bg-gradient-to-r from-transparent to-primary/40" />
                <p className="type-mono uppercase tracking-[0.25em] text-primary">
                  Developed by Joseph James
                </p>
                <div className="h-px w-8 bg-gradient-to-l from-transparent to-primary/40" />
              </div>
              <p className="type-caption text-muted-foreground">
                18-year-old Ethiopian developer · Addis Ababa
              </p>
            </div>
          </div>

          {/* Divider */}
          <div className="mx-auto my-8 h-px max-w-md bg-gradient-to-r from-transparent via-white/10 to-transparent" />

          {/* Bottom row */}
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="type-caption text-muted-foreground">
              © {new Date().getFullYear()} NexET 🇪🇹 · EHEEE exam prep, grades 9–12
            </p>
            <div className="flex items-center gap-4">
              {/* Telegram links — quick access from the footer */}
              <a
                href="https://t.me/NexusAcademyET"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 type-caption text-[#229ED9] transition-opacity hover:opacity-80"
                title="NexET 🇪🇹 Telegram channel"
              >
                <Send className="size-3" /> Channel
              </a>
              <span className="text-muted-foreground/30">·</span>
              <a
                href="https://t.me/NexusETCommunity"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 type-caption text-[#229ED9] transition-opacity hover:opacity-80"
                title="NexET Community Telegram group"
              >
                <Users className="size-3" /> Community
              </a>
              <span className="text-muted-foreground/30">·</span>
              <span className="type-caption text-muted-foreground">TeleBirr</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="type-caption text-muted-foreground">M-Pesa</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1 type-caption text-primary/80">
                <Sparkles className="size-3" /> 3-day trial
              </span>
            </div>
          </div>
        </div>
      </footer>

      {/* ------- Back to top ------- */}
      <BackToTop />
    </div>
  );
}

// ─── Telegram community section ──────────────────────────────────────
// A cinematic "join our community" call-to-action linking to the Telegram
// channel + community discussion group. Uses Telegram's signature blue
// (#0088cc / #229ED9) as the accent — distinct from the app's amber theme
// but still feels like part of the same dark, glassy design language.
//
// Two cards: the official channel (announcements, study tips, exam
// updates) and the community group (discussion, Q&A, peer support).
// Each card has a custom Telegram paper-plane SVG, a name, a
// description, a "Join on Telegram" button, and a hover glow.
//
// Background: a deep blue gradient with animated floating paper-plane
// SVGs drifting upward — creates a "messages flying" feel that's
// unmistakably Telegram.

function TelegramPaperPlane({ className }: { className?: string }) {
  // Telegram's paper-plane logo as an inline SVG. Uses currentColor so
  // it inherits the parent's text color — lets us style it via Tailwind.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z" />
    </svg>
  );
}

function TelegramCommunitySection() {
  // Channel + community group links.
  const channelUrl = "https://t.me/NexusAcademyET";
  const communityUrl = "https://t.me/NexusETCommunity";
  const channelName = "⟡ NEXUS ACADEMY | ET 🇪🇹";
  const communityName = "⟡ NEXUS COMMUNITY 🇪🇹";

  // Floating paper-plane animation: a few SVG planes drifting upward
  // at different speeds. Pure CSS animation via Tailwind's animate-*
  // utilities + inline style delays.
  const floatingPlanes = [
    { left: "8%", delay: "0s", duration: "18s", size: "size-6", opacity: "opacity-[0.06]" },
    { left: "22%", delay: "3s", duration: "22s", size: "size-4", opacity: "opacity-[0.04]" },
    { left: "45%", delay: "1.5s", duration: "16s", size: "size-7", opacity: "opacity-[0.08]" },
    { left: "68%", delay: "5s", duration: "20s", size: "size-5", opacity: "opacity-[0.05]" },
    { left: "85%", delay: "2s", duration: "24s", size: "size-6", opacity: "opacity-[0.06]" },
    { left: "55%", delay: "7s", duration: "19s", size: "size-3", opacity: "opacity-[0.03]" },
  ];

  return (
    <section className="relative mx-auto max-w-6xl px-4 py-24">
      {/* Background: Telegram-blue gradient + floating paper planes */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[2.5rem]">
        {/* Deep blue gradient — distinct from the app's amber accent,
            signalling "this is the Telegram section" */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60rem 30rem at 50% 30%, oklch(0.45 0.12 230 / 0.12), transparent 70%)",
          }}
        />
        {/* Grid overlay matching the rest of the app */}
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          }}
        />
        {/* Floating paper planes drifting upward */}
        {floatingPlanes.map((plane, i) => (
          <div
            key={i}
            className={`absolute bottom-0 ${plane.size} ${plane.opacity}`}
            style={{
              left: plane.left,
              animation: `telegram-float ${plane.duration} linear infinite`,
              animationDelay: plane.delay,
            }}
          >
            <TelegramPaperPlane className="size-full text-[#229ED9]" />
          </div>
        ))}
      </div>

      {/* Keyframe animation for floating planes — defined inline so it
          doesn't need a separate CSS file. */}
      <style>{`
        @keyframes telegram-float {
          0% { transform: translateY(0) rotate(0deg); opacity: 0; }
          10% { opacity: var(--plane-opacity, 0.06); }
          90% { opacity: var(--plane-opacity, 0.06); }
          100% { transform: translateY(-80vh) rotate(-15deg); opacity: 0; }
        }
      `}</style>

      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-80px" }}
        className="relative"
      >
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <motion.div
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full glass-chip px-4 py-1.5"
          >
            {/* Telegram-blue pulsing dot */}
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#229ED9] opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[#229ED9]" />
            </span>
            <p className="type-mono uppercase tracking-[0.22em] text-[#229ED9] font-semibold">
              // join the movement
            </p>
          </motion.div>
          <motion.h2 variants={fadeUp} className="type-h1 mt-5">
            Study together.{" "}
            <span className="text-gradient">Rise together.</span>
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-4 max-w-xl text-muted-foreground"
          >
            NexET 🇪🇹 isn&apos;t just a library — it&apos;s a community of
            Ethiopian students preparing for the same exam, at the same time,
            with the same dream. Join our Telegram channel for study tips and
            exam updates, and hop into the community group to ask questions,
            share resources, and find study partners.
          </motion.p>
        </div>

        {/* Two-card layout: channel + community group */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2">
          {/* ── Channel card ───────────────────────────────────────── */}
          <motion.div
            variants={fadeUp}
            whileHover={{ y: -4 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <a
              href={channelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 transition-all duration-300 hover:border-[#229ED9]/30 hover:bg-[#229ED9]/[0.03]"
            >
              {/* Top glow line — Telegram-blue on hover */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#229ED9]/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              {/* Background glow blob */}
              <div className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-[#229ED9]/[0.04] blur-3xl transition-opacity duration-500 group-hover:bg-[#229ED9]/[0.08]" />

              {/* Icon + tag */}
              <div className="relative flex items-center justify-between">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-[#229ED9]/20 bg-[#229ED9]/10 text-[#229ED9] shadow-[0_0_30px_-8px_rgba(34,158,217,0.5)] transition-all duration-300 group-hover:shadow-[0_0_40px_-6px_rgba(34,158,217,0.6)]">
                  <TelegramPaperPlane className="size-7" />
                </div>
                <span className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  channel
                </span>
              </div>

              {/* Name + description */}
              <h3 className="mt-5 text-lg font-bold tracking-tight text-foreground">
                {channelName}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Official announcements, study tips, exam-date reminders, and
                new-resource alerts. Follow for the latest from NexET 🇪🇹 —
                straight to your Telegram.
              </p>

              {/* Feature bullets */}
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Bell className="size-3.5 text-[#229ED9]" />
                  Exam dates & deadline reminders
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5 text-[#229ED9]" />
                  New resource & feature alerts
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <FileText className="size-3.5 text-[#229ED9]" />
                  Weekly study tips & strategies
                </div>
              </div>

              {/* CTA button */}
              <div className="mt-6">
                <div className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 group-hover:bg-[#1A8CD4] group-hover:shadow-[0_8px_24px_-6px_rgba(34,158,217,0.5)]">
                  <TelegramPaperPlane className="size-4" />
                  Join channel
                </div>
              </div>

              {/* URL hint */}
              <p className="mt-3 type-mono text-[10px] text-muted-foreground/50">
                t.me/NexusAcademyET
              </p>
            </a>
          </motion.div>

          {/* ── Community group card ──────────────────────────────── */}
          <motion.div
            variants={fadeUp}
            whileHover={{ y: -4 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            <a
              href={communityUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative block h-full overflow-hidden rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 transition-all duration-300 hover:border-[#229ED9]/30 hover:bg-[#229ED9]/[0.03]"
            >
              {/* Top glow line */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#229ED9]/40 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              {/* Background glow blob */}
              <div className="pointer-events-none absolute -left-12 -top-12 size-40 rounded-full bg-[#229ED9]/[0.04] blur-3xl transition-opacity duration-500 group-hover:bg-[#229ED9]/[0.08]" />

              {/* Icon + tag */}
              <div className="relative flex items-center justify-between">
                <div className="flex size-14 items-center justify-center rounded-2xl border border-[#229ED9]/20 bg-[#229ED9]/10 text-[#229ED9] shadow-[0_0_30px_-8px_rgba(34,158,217,0.5)] transition-all duration-300 group-hover:shadow-[0_0_40px_-6px_rgba(34,158,217,0.6)]">
                  <Users className="size-7" />
                </div>
                <span className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  community
                </span>
              </div>

              {/* Name + description */}
              <h3 className="mt-5 text-lg font-bold tracking-tight text-foreground">
                {communityName}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                A discussion group for Ethiopian students. Ask questions, share
                study resources, find study partners, discuss difficult topics,
                and support each other through exam season.
              </p>

              {/* Feature bullets */}
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MessageCircle className="size-3.5 text-[#229ED9]" />
                  Ask questions & get help
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-3.5 text-[#229ED9]" />
                  Find study partners
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Send className="size-3.5 text-[#229ED9]" />
                  Share resources & tips
                </div>
              </div>

              {/* CTA button */}
              <div className="mt-6">
                <div className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-[#229ED9] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 group-hover:bg-[#1A8CD4] group-hover:shadow-[0_8px_24px_-6px_rgba(34,158,217,0.5)]">
                  <Users className="size-4" />
                  Join community
                </div>
              </div>

              {/* URL hint */}
              <p className="mt-3 type-mono text-[10px] text-muted-foreground/50">
                t.me/NexusETCommunity
              </p>
            </a>
          </motion.div>
        </div>

        {/* Bottom callout — "it's free, it's instant, it's your people" */}
        <motion.div
          variants={fadeUp}
          className="mx-auto mt-8 flex max-w-lg items-center justify-center gap-6 text-center"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="size-3.5 text-[#229ED9]" />
            Free forever
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="size-3.5 text-[#229ED9]" />
            No sign-up needed
          </div>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Check className="size-3.5 text-[#229ED9]" />
            Your people
          </div>
        </motion.div>
      </motion.div>
    </section>
  );
}

// ─── Announcement banner ───────────────────────────────────────────────
// Shows admin-controllable announcements (new features, events, referral
// program highlights) at the very top of the landing page, above the hero.
// Admins create these from the /admin Marketing tab. Cycles through ALL
// active announcements with a cinematic auto-rotate — each announcement
// gets its own color treatment based on type (info / feature / event / referral).
function AnnouncementBanner() {
  const announcements = useQuery(api.marketing.getActiveAnnouncements, {});
  const [index, setIndex] = useState(0);

  // Reset index if announcements shrink
  useEff(() => {
    if (announcements && index >= announcements.length) setIndex(0);
  }, [announcements, index]);

  // Auto-rotate every 6s when more than one announcement is active
  useEff(() => {
    if (!announcements || announcements.length <= 1) return;
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % announcements.length);
    }, 6000);
    return () => clearInterval(t);
  }, [announcements]);

  if (!announcements || announcements.length === 0) return null;

  const typeStyles: Record<string, string> = {
    info: "border-sky-400/30 bg-sky-400/[0.06] text-sky-300",
    feature: "border-amber-400/30 bg-amber-400/[0.06] text-amber-300",
    event: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300",
    referral: "border-primary/30 bg-primary/[0.06] text-primary",
  };
  const typeIcons: Record<string, string> = {
    info: "💡",
    feature: "✨",
    event: "🎉",
    referral: "🤝",
  };
  const typeLabels: Record<string, string> = {
    info: "Info",
    feature: "New feature",
    event: "Event",
    referral: "Affiliate",
  };

  const current = announcements[Math.min(index, announcements.length - 1)];
  const style = typeStyles[current.type] ?? typeStyles.info;

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4">
      <AnimatePresence mode="wait">
        <motion.div
          key={current._id}
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className={`flex items-center gap-3 rounded-2xl border p-3.5 text-sm ${style}`}
        >
          <span className="text-lg">{typeIcons[current.type] ?? "💡"}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-70">
                {typeLabels[current.type] ?? "Info"}
              </span>
              <span className="opacity-30">·</span>
              <p className="font-semibold text-foreground">{current.title}</p>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{current.body}</p>
          </div>
          {announcements.length > 1 && (
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
              {announcements.map((a, i) => (
                <button
                  key={a._id}
                  type="button"
                  aria-label={`Show announcement ${i + 1}`}
                  onClick={() => setIndex(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === index ? "w-5 bg-current opacity-80" : "w-1.5 bg-current opacity-30 hover:opacity-50"
                  }`}
                />
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function BackToTop() {
  const [visible, setVisible] = useState(false);
  useEff(() => {
    const onScroll = () => setVisible(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  if (!visible) return null;
  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-50 flex size-11 items-center justify-center rounded-xl bg-primary/90 text-primary-foreground shadow-lg backdrop-blur-sm transition-colors hover:bg-primary interactive-press"
    >
      <ChevronUp className="size-5" />
    </motion.button>
  );
}

// ─── Mock Exam flagship showcase ───────────────────────────────────────
// A dedicated cinematic section that puts the AI mock exam front-and-center
// as the platform's flagship premium feature. Distinct visual treatment
// from the regular companion grid — a "exam room" aesthetic that mirrors
// what the student will actually see when they take a mock exam: a calm,
// focused, slightly clinical tone (vs the warm library feel everywhere
// else). Includes a mock exam-room preview card so the visitor can SEE
// what the experience looks like before they sign up.
function MockExamShowcase({
  libraryHref,
  isAuthenticated,
}: {
  libraryHref: string;
  isAuthenticated: boolean;
}) {
  // The mock-exam-room preview — a static, animated representation of the
  // actual exam-taking UI. Lets visitors SEE the timer, the section
  // navigator, and the question card before they sign up. Builds desire
  // by showing the experience, not just describing it.
  const examHref = isAuthenticated ? "/mock-exam" : "/auth?returnTo=%2Fmock-exam";

  return (
    <section id="mock-exam" className="relative mx-auto max-w-6xl scroll-mt-24 px-4 py-24">
      {/* Background layers — calmer than the rest of the page to evoke
          exam-room focus. Subtle grid + a single amber orb (the timer
          glow) instead of the dual-orb pattern used elsewhere. */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[2.5rem]">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(rgb(255 255 255 / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.5) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(ellipse at center, black 40%, transparent 80%)",
          }}
        />
        <div className="pointer-events-none absolute left-1/2 top-1/3 size-96 -translate-x-1/2 rounded-full bg-amber-400/15 blur-[120px]" />
      </div>

      <motion.div
        variants={stagger}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-100px" }}
        className="relative"
      >
        {/* Eyebrow + heading */}
        <div className="mx-auto max-w-3xl text-center">
          <motion.div
            variants={fadeUp}
            className="inline-flex items-center gap-2 rounded-full glass-chip px-3 py-1"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-amber-400" />
            </span>
            <p className="type-mono uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // flagship · ai mock exam
            </p>
          </motion.div>
          <motion.h2 variants={fadeUp} className="type-h1 mt-5">
            Sit the real exam.{" "}
            <span className="text-gradient">Before you sit it.</span>
          </motion.h2>
          <motion.p
            variants={fadeUp}
            className="mx-auto mt-4 max-w-2xl text-muted-foreground"
          >
            Our AI writes <span className="font-semibold text-foreground">~340 original questions</span>{" "}
            across all 6 EHEEE subjects — English, Mathematics, Aptitude, and your three
            stream subjects. Real timing. Real conditions. Real scoring. Then it grades you
            per subject so you know exactly where you stand.
          </motion.p>
        </div>

        {/* Two-column: stats + exam-room preview */}
        <div className="mt-12 grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
          {/* Left: format stats */}
          <motion.div variants={fadeUp} className="flex flex-col gap-3">
            <ExamStatRow
              icon={<GraduationCap className="size-4 text-amber-300" />}
              label="Sections"
              value="6"
              hint="English · Math · Aptitude · 3 stream subjects"
            />
            <ExamStatRow
              icon={<FileText className="size-4 text-amber-300" />}
              label="Questions"
              value="~340"
              hint="50 per section · 40 for Aptitude"
            />
            <ExamStatRow
              icon={<Timer className="size-4 text-amber-300" />}
              label="Duration"
              value="~5h"
              hint="50 min per section · no pausing"
            />
            <ExamStatRow
              icon={<TrendingUp className="size-4 text-amber-300" />}
              label="Scoring"
              value="Per subject"
              hint="Server-side graded · progress tracked across attempts"
            />
          </motion.div>

          {/* Right: exam-room preview card — a snapshot of the real
              taking UI so visitors see what they'll get */}
          <motion.div
            variants={fadeUp}
            className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f17]/80 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)] backdrop-blur-xl"
          >
            {/* Top exam-conditions bar */}
            <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-white/5">
                  <GraduationCap className="size-4 text-foreground/80" />
                </div>
                <div>
                  <p className="truncate text-xs font-semibold text-foreground">
                    Section 1 of 6 · English
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    Mock exam · Natural stream
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-1.5 type-mono text-xs font-semibold tabular-nums text-foreground">
                <Timer className="size-3.5" />
                42:18
              </div>
            </div>

            {/* Body — fake question + options */}
            <div className="p-6">
              <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Question 14 of 50
              </p>
              <h3 className="mt-3 text-base font-semibold text-foreground">
                Choose the word that correctly completes the sentence:
                &ldquo;The scientist&apos;s _____ to the problem was praised
                by her peers.&rdquo;
              </h3>
              <div className="mt-5 flex flex-col gap-2">
                {[
                  { letter: "A", text: "analysis", selected: false },
                  { letter: "B", text: "analytical", selected: false },
                  { letter: "C", text: "analytically", selected: true },
                  { letter: "D", text: "analyst", selected: false },
                ].map((opt) => (
                  <div
                    key={opt.letter}
                    className={
                      "flex items-center gap-3 rounded-xl border p-3 text-sm transition-all " +
                      (opt.selected
                        ? "border-amber-400/40 bg-amber-400/[0.08] text-foreground"
                        : "border-white/10 bg-white/[0.02] text-foreground/80")
                    }
                  >
                    <span
                      className={
                        "flex size-7 shrink-0 items-center justify-center rounded-full type-mono text-xs font-semibold " +
                        (opt.selected
                          ? "bg-amber-400 text-amber-950"
                          : "bg-white/5 text-muted-foreground")
                      }
                    >
                      {opt.letter}
                    </span>
                    {opt.text}
                  </div>
                ))}
              </div>

              {/* Footer — question navigator preview */}
              <div className="mt-5 flex items-center justify-between border-t border-white/[0.06] pt-4">
                <div className="flex gap-1">
                  {/* 8 dots — answered/flagged/current states */}
                  {Array.from({ length: 8 }, (_, i) => {
                    const answered = i < 5;
                    const current = i === 5;
                    return (
                      <div
                        key={i}
                        className={
                          "size-2.5 rounded-md transition-all " +
                          (current
                            ? "bg-amber-400"
                            : answered
                              ? "bg-emerald-400/40"
                              : "bg-white/5")
                        }
                      />
                    );
                  })}
                  <span className="type-mono text-[9px] text-muted-foreground">
                    +42
                  </span>
                </div>
                <span className="type-mono text-[10px] text-muted-foreground">
                  14 / 50 answered
                </span>
              </div>
            </div>

            {/* Subtle glow line at the top */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
          </motion.div>
        </div>

        {/* Why it matters — three short value props */}
        <motion.div
          variants={fadeUp}
          className="mt-12 grid gap-4 sm:grid-cols-3"
        >
          <MockExamValueCard
            icon={<Sparkles className="size-4 text-amber-300" />}
            title="Original questions, every time"
            body="The model writes fresh questions grounded in the real syllabus — never copied from a past paper. Take it 100 times, never see the same exam twice."
          />
          <MockExamValueCard
            icon={<Timer className="size-4 text-amber-300" />}
            title="No pausing. No lingering."
            body="When a section's timer expires, it auto-submits and you advance to the next one. Mirrors real exam conditions so you build the pacing muscle."
          />
          <MockExamValueCard
            icon={<TrendingUp className="size-4 text-amber-300" />}
            title="Track readiness over time"
            body="Every attempt is stored with a per-subject breakdown. See your Physics score climb from 58% to 74% across attempts — genuine, measurable progress."
          />
        </motion.div>

        {/* CTA */}
        <motion.div
          variants={fadeUp}
          className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <Button asChild size="lg" className="cursor-pointer gap-2 rounded-xl bg-amber-500 text-amber-950 hover:bg-amber-400">
            <Link to={examHref}>
              <GraduationCap className="size-4" />
              {isAuthenticated ? "Take a mock exam" : "Try the mock exam"}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="cursor-pointer rounded-xl bg-white/5">
            <Link to={libraryHref}>
              <FileText className="size-4" />
              Browse the library
            </Link>
          </Button>
        </motion.div>

        {/* Premium hint */}
        <motion.p
          variants={fadeUp}
          className="mt-6 text-center text-[11px] text-muted-foreground"
        >
          <Lock className="mr-1 inline size-3 text-primary" />
          Mock exams are a premium feature — included in your free 14-day trial.
        </motion.p>
      </motion.div>
    </section>
  );
}

function ExamStatRow({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-amber-400/20 hover:bg-amber-400/[0.03]">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="type-mono text-base font-bold text-foreground">{value}</p>
      </div>
      <p className="hidden max-w-[40%] truncate text-[10px] text-muted-foreground sm:block">
        {hint}
      </p>
    </div>
  );
}

function MockExamValueCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="glass-soft group rounded-2xl border border-white/[0.06] p-5 transition-all hover:border-amber-400/20 hover:bg-amber-400/[0.04]">
      <div className="flex items-center gap-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10">
          {icon}
        </div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        {body}
      </p>
    </div>
  );
}


function FaqItem({
  index,
  question,
  answer,
}: {
  index: number;
  question: string;
  answer: string;
}) {
  const [open, setOpen] = useState(false);
  const padded = String(index).padStart(2, "0");
  return (
    <motion.div
      variants={fadeUp}
      whileHover={{ y: -2 }}
      className={`group relative overflow-hidden rounded-2xl border transition-colors duration-300 ${
        open
          ? "border-primary/40 bg-primary/[0.04]"
          : "border-border/60 bg-card/30 hover:border-primary/20 hover:bg-card/50"
      }`}
    >
      {/* Glow when open */}
      <motion.div
        aria-hidden
        animate={{
          opacity: open ? 1 : 0,
        }}
        transition={{ duration: 0.4 }}
        className="pointer-events-none absolute -left-px top-0 h-full w-[2px] bg-gradient-to-b from-primary via-amber-400 to-primary"
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-4 px-5 py-5 text-left sm:px-6"
      >
        {/* Number badge */}
        <span
          className={`type-mono shrink-0 text-sm font-semibold transition-colors duration-300 ${
            open ? "text-primary" : "text-muted-foreground/60 group-hover:text-muted-foreground"
          }`}
        >
          {padded}
        </span>
        {/* Question */}
        <span className="type-h3 flex-1 font-semibold">{question}</span>
        {/* Plus / Minus icon */}
        <motion.span
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className={`flex size-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-300 ${
            open
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border/60 text-muted-foreground group-hover:border-primary/30 group-hover:text-primary"
          }`}
        >
          <Plus className="size-4" />
        </motion.span>
      </button>
      {/* Answer */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-6 pl-[3.75rem] sm:px-6 sm:pl-[4.5rem]">
              <p className="type-body max-w-2xl text-muted-foreground">
                {answer}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
