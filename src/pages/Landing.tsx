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
  Library,
  Map,
  Presentation,
  Search,
  Sigma,
  Sparkles,
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
    color: "from-sky-400 to-cyan-400",
    description: "Every student takes these — the foundation of the national exams.",
    subjects: [
      { name: "English", icon: Languages },
      { name: "Mathematics", icon: Sigma },
      { name: "Scholastic Aptitude Test", icon: Brain },
    ],
  },
  {
    name: "Natural Science",
    stream: "natural",
    color: "from-indigo-500 to-blue-400",
    description: "For students in the natural science track aiming at STEM careers.",
    subjects: [
      { name: "Physics", icon: Atom },
      { name: "Chemistry", icon: FlaskConical },
      { name: "Biology", icon: Dna },
    ],
  },
  {
    name: "Social Science",
    stream: "social",
    color: "from-violet-500 to-sky-400",
    description: "For students in the social science track — history, society and beyond.",
    subjects: [
      { name: "History", icon: Landmark },
      { name: "Geography", icon: Map },
      { name: "Economics", icon: TrendingUp },
    ],
  },
];

const CONTENT_TYPES = [
  {
    name: "Textbooks",
    type: "textbook",
    icon: BookOpen,
    description: "Complete grade-level textbooks, chapter by chapter, ready to study offline.",
  },
  {
    name: "Past Exams",
    type: "past_exam",
    icon: CalendarDays,
    description: "Real national examination papers from recent years, with answer-ready formats.",
  },
  {
    name: "Worksheets",
    type: "worksheet",
    icon: ClipboardList,
    description: "Topic-focused practice sets to drill the concepts that appear most on exams.",
  },
  {
    name: "Student Guides",
    type: "student_guide",
    icon: GraduationCap,
    description: "Walkthroughs, summaries and revision roadmaps built for exam season.",
  },
  {
    name: "Teacher Guides",
    type: "teacher_guide",
    icon: Presentation,
    description: "Curriculum-aligned teaching notes and marking guidance for educators.",
  },
];

const STEPS = [
  {
    icon: Search,
    step: "01",
    title: "Pick your stream",
    description: "Common, natural or social science — every subject you're examined on lives here.",
  },
  {
    icon: Library,
    step: "02",
    title: "Filter by grade & subject",
    description: "Narrow the library to your exact grade (9–12), subject and resource type.",
  },
  {
    icon: Download,
    step: "03",
    title: "Study with real papers",
    description: "Download textbooks, past exams and guides, then walk into the exam room ready.",
  },
];

const STATS = [
  { value: "9", label: "Core subjects" },
  { value: "4", label: "Grades covered" },
  { value: "5", label: "Resource types" },
  { value: "100%", label: "Exam-focused" },
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
            <span className="text-base font-extrabold tracking-tight">
              Nexus <span className="text-gradient">Academy</span>
            </span>
          </Link>

          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#streams" className="transition-colors hover:text-foreground">
              Streams
            </a>
            <a href="#library" className="transition-colors hover:text-foreground">
              Library
            </a>
            <a href="#how" className="transition-colors hover:text-foreground">
              How it works
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
              <Button asChild size="sm">
                <Link to="/auth?returnTo=%2Fdashboard">
                  Sign in <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </div>
        </motion.nav>
      </header>

      {/* ------- Hero ------- */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <motion.div
          variants={stagger}
          initial="hidden"
          animate="show"
          className="flex flex-col items-start"
        >
          <motion.div variants={fadeUp}>
            <Badge className="glass-chip gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="size-3.5" />
              Ethiopian National Exam Prep · Grades 9–12
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="mt-5 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
          >
            Every subject.
            <br />
            Every grade.{" "}
            <span className="text-gradient">One library.</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg"
          >
            Nexus Academy is the content library for the national matric exams —
            textbooks, past exam papers, worksheets and study guides for all nine
            subjects across the common, natural and social science streams.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="rounded-xl">
              <Link to={libraryHref}>
                Explore the library <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="rounded-xl bg-white/70">
              <a href="#streams">Browse subjects</a>
            </Button>
          </motion.div>

          <motion.div variants={fadeUp} className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-primary" /> Textbooks & guides
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-primary" /> Past national exams
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="size-4 text-primary" /> Free forever, premium extras
            </span>
          </motion.div>
        </motion.div>

        {/* Hero card stack */}
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, ease: "easeOut", delay: 0.15 }}
          className="relative mx-auto hidden h-[26rem] w-full max-w-md lg:block"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
            className="glass-panel absolute left-2 top-6 w-72 -rotate-6 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between">
              <Badge className="bg-primary/10 text-primary">Past Exam</Badge>
              <span className="text-xs font-semibold text-muted-foreground">2023 · EC 2015</span>
            </div>
            <p className="mt-3 text-sm font-bold leading-snug">
              2023 Grade 12 National Physics Examination
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Atom className="size-3.5 text-indigo-500" /> Physics · Natural · Grade 12
            </div>
          </motion.div>

          <motion.div
            animate={{ y: [0, 10, 0] }}
            transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 0.6 }}
            className="glass-panel absolute right-0 top-24 w-72 rotate-3 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between">
              <Badge className="bg-sky-500/10 text-sky-600">Textbook</Badge>
              <span className="text-xs font-semibold text-muted-foreground">Grade 11</span>
            </div>
            <p className="mt-3 text-sm font-bold leading-snug">
              Grade 11 Chemistry — Full Curriculum Textbook
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <FlaskConical className="size-3.5 text-sky-500" /> Chemistry · Natural
            </div>
          </motion.div>

          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 1.1 }}
            className="glass-panel absolute bottom-4 left-16 w-80 -rotate-1 rounded-2xl p-4"
          >
            <div className="flex items-center justify-between">
              <Badge className="bg-violet-500/10 text-violet-600">Worksheet</Badge>
              <span className="flex items-center gap-1 text-xs font-semibold text-amber-600">
                <Sparkles className="size-3.5" /> Premium
              </span>
            </div>
            <p className="mt-3 text-sm font-bold leading-snug">
              Mechanics & Forces — Practice Worksheet Set
            </p>
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <ClipboardList className="size-3.5 text-violet-500" /> Physics · Grade 11
              </span>
              <span className="flex items-center gap-1">
                <Download className="size-3.5" /> 2.4 MB
              </span>
            </div>
          </motion.div>

          <div className="glass-chip absolute -left-3 top-2 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-foreground">
            <FileText className="size-3.5 text-indigo-500" /> 9 subjects
          </div>
          <div className="glass-chip absolute bottom-16 -right-2 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-foreground">
            <CalendarDays className="size-3.5 text-sky-500" /> Years of past papers
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
            <motion.div key={stat.label} variants={fadeUp} className="flex flex-col items-center text-center">
              <span className="text-gradient text-3xl font-extrabold tracking-tight">{stat.value}</span>
              <span className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
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
          <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            The three streams
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
          >
            Everything the national exams cover
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground">
            Whatever track you're on, your examination subjects are organised and ready in the library.
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
              <div
                className={`flex size-11 items-center justify-center rounded-xl bg-gradient-to-br ${stream.color} text-white shadow-sm`}
              >
                <GraduationCap className="size-5" />
              </div>
              <h3 className="mt-4 text-lg font-bold tracking-tight">{stream.name}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{stream.description}</p>
              <ul className="mt-4 space-y-2.5">
                {stream.subjects.map((subject) => (
                  <li key={subject.name} className="flex items-center gap-2.5 text-sm font-medium">
                    <subject.icon className="size-4 text-primary/70" />
                    {subject.name}
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
          <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            The library
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
          >
            Five resource types, one search
          </motion.h2>
          <motion.p variants={fadeUp} className="mt-4 text-muted-foreground">
            From full textbooks to real past papers — filter by grade, subject and type in seconds.
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
              className={`glass-soft group rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:bg-white/75 ${
                index === 4 ? "sm:col-span-2 lg:col-span-1" : ""
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <type.icon className="size-5" />
                </div>
                <h3 className="font-bold tracking-tight">{type.name}</h3>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{type.description}</p>
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
          <motion.p variants={fadeUp} className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
            How it works
          </motion.p>
          <motion.h2
            variants={fadeUp}
            className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl"
          >
            From login to exam room in three steps
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
            <motion.div key={step.step} variants={fadeUp} className="glass-panel relative rounded-2xl p-6">
              <span className="text-gradient absolute right-5 top-4 text-3xl font-extrabold opacity-60">
                {step.step}
              </span>
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <step.icon className="size-5" />
              </div>
              <h3 className="mt-4 font-bold tracking-tight">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{step.description}</p>
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
          <div className="pointer-events-none absolute -left-20 -top-24 size-64 rounded-full bg-sky-300/30 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -right-16 size-64 rounded-full bg-indigo-300/30 blur-3xl" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold tracking-tight sm:text-4xl">
              Ready to ace your <span className="text-gradient">national exams?</span>
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
              Join Nexus Academy and get every textbook, past paper and study guide
              for your stream — organised by grade and subject.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="rounded-xl">
                <Link to={libraryHref}>
                  {isAuthenticated ? "Open the library" : "Get started free"}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ------- Footer ------- */}
      <footer className="border-t border-white/60 bg-white/30 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Nexus Academy logo" className="size-8 rounded-lg" />
            <span className="text-sm font-extrabold tracking-tight">
              Nexus <span className="text-gradient">Academy</span>
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Nexus Academy · Ethiopian national exam prep for grades 9–12
          </p>
        </div>
      </footer>
    </div>
  );
}
