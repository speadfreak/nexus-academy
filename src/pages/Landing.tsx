import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Atom,
  BookOpen,
  Brain,
  CalendarDays,
  Check,
  ClipboardList,
  Dna,
  Download,
  FileText,
  FlaskConical,
  GraduationCap,
  Landmark,
  Languages,
  Lock,
  Map,
  Presentation,
  Search,
  Sigma,
  Sparkles,
  Terminal,
  TrendingUp,
} from "lucide-react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/hooks/use-auth";
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

const STREAMS = [
  {
    name: "Common Subjects",
    stream: "common",
    slug: "stream/common",
    description:
      "The three subjects every candidate sits — the shared foundation of the national examinations.",
    subjects: [
      { name: "English", slug: "english", icon: Languages },
      { name: "Mathematics", slug: "mathematics", icon: Sigma },
      { name: "Scholastic Aptitude Test", slug: "scholastic-aptitude-test", icon: Brain },
    ],
  },
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

const STEPS = [
  {
    icon: Terminal,
    step: "01",
    title: "Sign in and open the catalog",
    description:
      "Create an account in seconds. Every textbook, past paper and guide is indexed and searchable.",
  },
  {
    icon: Search,
    step: "02",
    title: "Search by grade, subject and type",
    description:
      "Query the library the way you think — free text, stream, grade, subject and resource type.",
  },
  {
    icon: Download,
    step: "03",
    title: "Download and study",
    description:
      "Open resources instantly. Premium papers are served through time-limited signed links.",
  },
];

const STATS = [
  { value: "09", label: "Core subjects" },
  { value: "4", label: "Grades covered" },
  { value: "05", label: "Resource types" },
  { value: "100%", label: "Exam-aligned" },
];

export default function Landing() {
  const { isAuthenticated, isLoading, user, signOut } = useAuth();
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
              <span className="text-base font-extrabold tracking-tight">Nexus Academy</span>
              <span className="hidden font-mono text-[10px] font-medium text-muted-foreground sm:inline">
                v1.0
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-6 font-mono text-xs font-medium text-muted-foreground md:flex">
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
            {isLoading ? null : isAuthenticated ? (
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

      {/* ------- Hero ------- */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 lg:grid-cols-[1.02fr_0.98fr] lg:pt-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="flex flex-col items-start"
        >
          <motion.div variants={fadeUp}>
            <Badge className="glass-chip gap-2 rounded-full px-3 py-1 font-mono text-[11px] font-semibold text-primary">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
              </span>
              // ethiopian national exam prep · grades 9–12
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Every subject.
            <br />
            Every grade.{" "}
            <span className="text-gradient">One indexed library.</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg"
          >
            Nexus Academy is the complete content library for the Ethiopian national
            matric exams — textbooks, past papers, worksheets and study guides across
            all nine subjects. Sign in, search the catalog, and download exactly what
            your grade and stream require.
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
            className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-xs text-muted-foreground"
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
                <span className="text-emerald-400">⠿</span> signed url ready · expires in 15:00
              </p>
            </div>
          </div>

          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
            className="glass-chip absolute -right-3 -top-3 flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] font-semibold"
          >
            <BookOpen className="size-3.5 text-primary" /> 09 subjects
          </motion.div>
          <motion.div
            animate={{ y: [0, 8, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 0.7 }}
            className="glass-chip absolute -bottom-4 -left-4 flex items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] font-semibold"
          >
            <CalendarDays className="size-3.5 text-primary" /> years of past papers
          </motion.div>
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
              <span className="font-mono text-3xl font-bold tracking-tight text-gradient">
                {stat.value}
              </span>
              <span className="mt-1 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {stat.label}
              </span>
            </motion.div>
          ))}
        </motion.div>
      </section>

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
            className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary"
          >
            // the three streams
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
          >
            Everything the national exams cover
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground">
            Whatever track you&apos;re on, your examination subjects are organized and
            ready in the library.
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
              className="glass-panel group rounded-2xl p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <div className="flex items-center justify-between">
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[inset_0_0_0_1px_oklch(0.74_0.15_232_/_0.25)]">
                  <GraduationCap className="size-5" />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {stream.slug}
                </span>
              </div>
              <h3 className="mt-4 text-lg font-bold tracking-tight">{stream.name}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {stream.description}
              </p>
              <ul className="mt-4 space-y-2.5 border-t border-white/8 pt-4">
                {stream.subjects.map((subject) => (
                  <li
                    key={subject.name}
                    className="flex items-center justify-between gap-2 text-sm font-medium"
                  >
                    <span className="flex items-center gap-2.5">
                      <subject.icon className="size-4 text-primary/70" />
                      {subject.name}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground/70">
                      {subject.slug}
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
            className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary"
          >
            // the library
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
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
              className={`glass-soft group rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:bg-white/[0.05] ${
                index === 4 ? "sm:col-span-2 lg:col-span-1" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <type.icon className="size-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold tracking-tight">{type.name}</h3>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    type/{type.type}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {type.description}
              </p>
            </motion.div>
          ))}
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
            className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary"
          >
            // how it works
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
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
              <span className="absolute right-5 top-4 font-mono text-3xl font-bold text-gradient opacity-70">
                {step.step}
              </span>
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <step.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-bold tracking-tight">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                {step.description}
              </p>
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
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-primary">
              // get started
            </p>
            <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
              Ready to walk into the exam room{" "}
              <span className="text-gradient">prepared?</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Create your free account and get instant access to every textbook,
              past paper and study guide for your stream — organized by grade and
              subject, with premium downloads for full exam-season access.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="rounded-xl">
                <Link to={libraryHref}>
                  {isAuthenticated ? "Open the library" : "Create free account"}
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
      <footer className="border-t border-white/8 bg-white/[0.02] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Nexus Academy logo" className="size-8 rounded-lg" />
            <span className="text-sm font-extrabold tracking-tight">Nexus Academy</span>
          </div>
          <p className="font-mono text-[11px] text-muted-foreground">
            © {new Date().getFullYear()} Nexus Academy · Ethiopian national exam prep,
            grades 9–12
          </p>
          <div className="flex items-center gap-4 font-mono text-[11px] text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" />
            <span>premium · signed downloads</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
