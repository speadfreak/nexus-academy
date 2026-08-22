import { motion, type Variants } from "framer-motion";
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
  Presentation,
  Search,
  Sigma,
  Sparkles,
  Moon,
  Sun,
  Terminal,
  Timer,
  TrendingUp,
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
      "AI-powered tutor grounded in the real curriculum. It remembers your stream, your hard subjects and every conversation.
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
            <img src={logo} alt="Nexus Academy logo" className="size-9 rounded-xl" />
            <span className="flex items-baseline gap-2">
              <span className="type-h3 font-extrabold">Nexus Academy</span>
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
          className="absolute -right-24 top-24 size-[26rem] rounded-full bg-sky-400/10 blur-3xl"
        />
        <motion.div
          animate={
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
              ? undefined
              : { x: [0, 40, 0], y: [0, -30, 0] }
          }
          transition={{ duration: 26, repeat: Infinity, ease: "easeInOut" }}
          className="absolute left-1/2 top-56 size-[24rem] -translate-x-1/2 rounded-full bg-violet-400/10 blur-3xl"
        />
      </div>

      {/* ------- Hero ------- */}
      <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:pt-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="flex flex-col items-start"
        >
          <motion.div variants={fadeUp}>
            <Badge className="glass-chip gap-2 rounded-full px-3 py-1 type-caption font-semibold text-primary">
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
            Nexus Academy is the complete content library for the EHEEE
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
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_oklch(0.74_0.15_232_/_0.25)]">
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
                I&apos;m Joseph James, 18 years old, Ethiopian. I built Nexus Academy
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
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_oklch(0.74_0.15_232_/_0.25)]">
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
              See exactly what Nexus Academy looks like before you create an account.
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

      {/* ------- FAQ ------- */}
      <section className="mx-auto max-w-3xl px-4 pb-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mx-auto text-center"
        >
          <motion.p variants={fadeUp} className="type-mono uppercase tracking-[0.2em] text-primary">
            // questions
          </motion.p>
          <motion.h2 variants={fadeUp} className="type-h1 mt-3">
            Frequently asked
          </motion.h2>
        </motion.div>

        <motion.div
          variants={stagger}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: "-60px" }}
          className="mt-10 space-y-3"
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
              a: "Payments are processed through your carrier's own secure checkout. Nexus Academy never sees your PIN or card number — we only receive a confirmation token.",
            },
            {
              q: "What happens when my trial ends?",
              a: "Your free features stay forever: library browsing, todos, focus timer, streaks and limited tutoring. Premium content (past papers, plans, unlimited tutor) pauses until you upgrade.",
            },
          ].map((faq, i) => (
            <motion.div key={i} variants={fadeUp} className="glass-soft rounded-2xl px-6 py-5">
              <p className="type-h3 font-semibold">{faq.q}</p>
              <p className="type-body mt-2 text-muted-foreground">{faq.a}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

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
          <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full bg-sky-400/10 blur-3xl" />
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
        <div className="pointer-events-none absolute -right-24 bottom-10 size-48 rounded-full bg-sky-400/5 blur-3xl" />
        <div className="relative mx-auto max-w-6xl px-4 py-14">
          {/* Signature credit — the standout element */}
          <div className="flex flex-col items-center text-center">
            <img src={logo} alt="Nexus Academy logo" className="mb-4 size-12 rounded-2xl" />
            <p className="type-h2">
              Nexus Academy
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
              © {new Date().getFullYear()} Nexus Academy · EHEEE exam prep, grades 9–12
            </p>
            <div className="flex items-center gap-4">
              <span className="type-caption text-muted-foreground">TeleBirr</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="type-caption text-muted-foreground">M-Pesa</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="flex items-center gap-1 type-caption text-primary/80">
                <Sparkles className="size-3" /> 14-day trial
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
