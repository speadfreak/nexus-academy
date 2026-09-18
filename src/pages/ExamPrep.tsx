// Exam Prep Hub — /exam-prep
//
// One consolidated command center for national-exam preparation:
//   • Overview — real counts, the student's exam countdown (calendar),
//     a "Recommended next" surface (weakest recent subject), quick links
//   • Papers — browse uploaded MoE past papers + curated practice sets,
//     each launching the FULLY DIGITAL Practice / Exam experience
//     (/exam-prep/digital/:id?mode=practice|exam — the engine auto-converts
//     the PDF into a digital question-by-question paper on first open)
//   • Practice — a front door into the EXISTING practice systems
//     (quiz generation, Aptitude Hub, Flashcard Exam Attack)
//   • My Results — one unified readiness picture merging Exam Mode
//     attempts, AI Mock Exam attempts and recent quiz scores
//
// REUSE: this page launches the digital exam engine for both paper modes.
// It does NOT reimplement any exam, quiz or flashcard logic.
//
// NO-DOWNLOAD POLICY: there is deliberately no download/save affordance
// anywhere in this hub — only in-app sharing of a resource link.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Brain,
  CalendarDays,
  ClipboardCheck,
  Crown,
  FileText,
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  Medal,
  Search,
  Share2,
  Sparkles,
  Swords,
  Target,
  Timer,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { QuizFlow } from "@/components/QuizFlow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

// ─── Types (mirror of the examPrep query returns) ───────────────────────

interface PrepPaper {
  _id: string;
  title: string;
  examPrepSubtype: "national_past_paper" | "practice_set" | null;
  examYear: number | null;
  durationMinutes: number | null;
  pageCount: number | null;
  grade: number;
  isPremium: boolean;
  hasAnswerKey: boolean;
  subjectName: string;
  subjectSlug: string;
  subjectStream: string;
}

interface PrepResultRow {
  kind: "paper_exam" | "mock_exam" | "quiz";
  refId: string;
  title: string;
  subjectName: string | null;
  date: number;
  scorePct: number | null;
  timeSeconds: number | null;
  status: "completed" | "expired" | "in_progress" | "self_graded";
}

interface SubjectRow {
  _id: string;
  name: string;
  slug: string;
  stream: string;
}

type HubTab = "overview" | "papers" | "practice" | "results";

/** Digital conversion status for one paper (from getDigitalPaperStatuses). */
interface DigitalStatus {
  status: "processing" | "ready" | "failed";
  questionCount: number;
  reviewStatus: string | null;
}

// ─── Small helpers ──────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtDate(epoch: number): string {
  return new Date(epoch).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function scoreTone(pct: number | null): string {
  if (pct === null) return "border-white/10 bg-white/5 text-muted-foreground";
  if (pct >= 75) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  if (pct >= 50) return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return "border-rose-400/30 bg-rose-400/10 text-rose-300";
}

/** Subtle per-subject accent (matches the platform's dark/gold system). */
function subjectAccent(slug: string): string {
  const map: Record<string, string> = {
    physics: "bg-sky-400/10 text-sky-300",
    chemistry: "bg-emerald-400/10 text-emerald-300",
    biology: "bg-lime-400/10 text-lime-300",
    mathematics: "bg-violet-400/10 text-violet-300",
    english: "bg-rose-400/10 text-rose-300",
    history: "bg-amber-400/10 text-amber-300",
    geography: "bg-teal-400/10 text-teal-300",
    economics: "bg-indigo-400/10 text-indigo-300",
    "scholastic-aptitude-test": "bg-fuchsia-400/10 text-fuchsia-300",
  };
  return map[slug] ?? "bg-amber-400/10 text-amber-300";
}

function SubtypeBadge({ subtype }: { subtype: PrepPaper["examPrepSubtype"] }) {
  if (subtype === "national_past_paper") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 type-caption font-bold text-amber-300">
        <Medal className="size-3" /> Official paper
      </span>
    );
  }
  if (subtype === "practice_set") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-violet-400/30 bg-violet-400/10 px-1.5 py-0.5 type-caption font-bold text-violet-300">
        <Target className="size-3" /> Practice set
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 type-caption text-muted-foreground">
      Unclassified
    </span>
  );
}

// ─── Overview tab ───────────────────────────────────────────────────────

function OverviewTab({
  papers,
  results,
  nextExam,
  recommended,
  onGoToTab,
}: {
  papers: PrepPaper[];
  results: PrepResultRow[];
  nextExam: { title: string; startAt: number } | null;
  recommended: { paper: PrepPaper; avgPct: number; attempts: number } | null;
  onGoToTab: (tab: HubTab) => void;
}) {
  const navigate = useNavigate();
  const nationalCount = papers.filter((p) => p.examPrepSubtype === "national_past_paper").length;
  const practiceCount = papers.filter((p) => p.examPrepSubtype === "practice_set").length;
  const years = new Set(papers.map((p) => p.examYear).filter((y): y is number => y !== null));
  const mockCompleted = results.filter((r) => r.kind === "mock_exam" && r.status === "completed");

  const daysLeft = nextExam ? Math.max(0, Math.ceil((nextExam.startAt - Date.now()) / DAY_MS)) : null;

  // Scored results across all three sources — the readiness signal.
  const scored = results.filter((r) => r.scorePct !== null);
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((sum, r) => sum + (r.scorePct ?? 0), 0) / scored.length)
    : null;

  const stats = [
    { label: "Official papers", value: nationalCount, icon: Medal, accent: "bg-amber-400/10 text-amber-300" },
    { label: "Practice sets", value: practiceCount, icon: Target, accent: "bg-violet-400/10 text-violet-300" },
    { label: "Years covered", value: years.size, icon: CalendarDays, accent: "bg-sky-400/10 text-sky-300" },
    { label: "Mock exams taken", value: mockCompleted.length, icon: GraduationCap, accent: "bg-emerald-400/10 text-emerald-300" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Exam countdown + readiness */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className={cn(
            "relative overflow-hidden rounded-3xl border p-5 sm:p-6",
            daysLeft !== null && daysLeft <= 30
              ? "border-amber-400/30 bg-amber-400/[0.06]"
              : "border-white/10 bg-white/[0.03]",
          )}
        >
          <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-amber-400/10 blur-3xl" />
          <p className="type-caption font-semibold text-amber-300/80">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-3.5" /> Exam countdown
            </span>
          </p>
          {nextExam && daysLeft !== null ? (
            <>
              <p className="type-display mt-2 text-gradient">
                {daysLeft === 0 ? "Today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
              </p>
              <p className="type-body mt-1 font-semibold">{nextExam.title}</p>
              <p className="type-caption mt-0.5 text-muted-foreground">
                {fmtDate(nextExam.startAt)} · set in your Calendar
              </p>
              {daysLeft !== null && daysLeft <= 30 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-300"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.max(4, 100 - (daysLeft / 30) * 100)}%` }}
                    transition={{ duration: 0.9, delay: 0.3 }}
                  />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="type-h2 mt-2">No exam date set</p>
              <p className="type-body mt-1 max-w-md text-muted-foreground">
                Add an exam event in your Calendar and your countdown will
                appear here — the whole hub rallies around that date.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/calendar")}
                className="interactive-press mt-4 gap-1.5"
              >
                <CalendarDays className="size-3.5" /> Set your exam date
              </Button>
            </>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
          className="relative overflow-hidden rounded-3xl border border-primary/20 bg-primary/[0.05] p-5 sm:p-6"
        >
          <p className="type-caption font-semibold text-primary/80">
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp className="size-3.5" /> Readiness signal
            </span>
          </p>
          {avgScore !== null ? (
            <>
              <p className="type-display mt-2 text-gradient">{avgScore}%</p>
              <p className="type-caption mt-1 text-muted-foreground">
                Average across your last {scored.length} scored result{scored.length === 1 ? "" : "s"} —
                papers, mocks and quizzes combined.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGoToTab("results")}
                className="interactive-press mt-4 gap-1.5"
              >
                <ListChecks className="size-3.5" /> See all results
              </Button>
            </>
          ) : (
            <>
              <p className="type-h2 mt-2">Nothing scored yet</p>
              <p className="type-body mt-1 text-muted-foreground">
                Run an Exam Mode session, a mock exam or a quiz — your
                readiness signal builds itself from real results.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onGoToTab("papers")}
                className="interactive-press mt-4 gap-1.5"
              >
                <FileText className="size-3.5" /> Attempt a paper
              </Button>
            </>
          )}
        </motion.div>
      </div>

      {/* Stat tiles — real counts from the library */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 + i * 0.06 }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex size-9 items-center justify-center rounded-xl", s.accent)}>
                  <Icon className="size-4.5" />
                </span>
                <span className="type-h1 text-foreground/90">{s.value}</span>
              </div>
              <p className="mt-3 type-caption font-semibold text-muted-foreground">{s.label}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Recommended next — weakest recent subject (Journey quiz data) */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
      >
        <div className="pointer-events-none absolute -left-14 -bottom-14 size-44 rounded-full bg-violet-400/10 blur-3xl" />
        <p className="type-caption font-semibold text-violet-300/80">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="size-3.5" /> Recommended next
          </span>
        </p>
        {recommended ? (
          <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="type-h3">
                Focus on <span className="text-gradient">{recommended.paper.subjectName}</span>
              </p>
              <p className="type-body mt-1 max-w-xl text-muted-foreground">
                Your recent quizzes there average{" "}
                <span className="font-bold text-rose-300">{recommended.avgPct}%</span> — the
                lowest of your exam subjects ({recommended.attempts} recent attempts). Start
                with the paper below, in relaxed Practice mode or full Exam conditions.
              </p>
              <p className="mt-2 truncate type-caption font-semibold text-foreground/80">
                <FileText className="mr-1 inline size-3.5 text-violet-300" />
                {recommended.paper.title}
                {recommended.paper.examYear ? ` · ${recommended.paper.examYear}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                onClick={() => navigate(`/exam-prep/digital/${recommended.paper._id}?mode=practice`)}
                className="interactive-press gap-2"
              >
                <BookOpen className="size-4" /> Practice
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/exam-prep/digital/${recommended.paper._id}?mode=exam`)}
                className="interactive-press gap-2"
              >
                <Timer className="size-4" /> Exam mode
              </Button>
              <Button
                variant="ghost"
                onClick={() => onGoToTab("papers")}
                className="interactive-press gap-1 text-muted-foreground"
              >
                All papers <ArrowRight className="size-3.5" />
              </Button>
            </div>
          </div>
        ) : (
          <p className="type-body mt-2 max-w-xl text-muted-foreground">
            Take a few topic quizzes in the Practice tab and your weakest
            subject will show up here — with the exact paper to train on.
          </p>
        )}
      </motion.div>

      {/* Quick links into the other tabs */}
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            tab: "papers" as HubTab,
            label: "Browse papers",
            detail: `${papers.length} past paper${papers.length === 1 ? "" : "s"} and practice sets`,
            icon: FileText,
          },
          {
            tab: "practice" as HubTab,
            label: "Train by subject",
            detail: "Quizzes, Aptitude Hub and Exam Attack drills",
            icon: Swords,
          },
          {
            tab: "results" as HubTab,
            label: "My results",
            detail: "Papers, mocks and quizzes in one timeline",
            icon: ListChecks,
          },
        ].map((link, i) => {
          const Icon = link.icon;
          return (
            <motion.button
              key={link.tab}
              type="button"
              onClick={() => onGoToTab(link.tab)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.26 + i * 0.06 }}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left transition hover:-translate-y-1 hover:border-primary/30 hover:bg-white/[0.06]"
            >
              <div className="flex items-center justify-between">
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                  <Icon className="size-4.5" />
                </span>
                <ArrowRight className="size-4 text-muted-foreground/50 transition group-hover:translate-x-1 group-hover:text-amber-300" />
              </div>
              <p className="mt-3 type-h3">{link.label}</p>
              <p className="mt-1 type-caption text-muted-foreground">{link.detail}</p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Papers tab ─────────────────────────────────────────────────────────

type TypeFilter = "all" | "national_past_paper" | "practice_set" | "unclassified";

function sharePaper(paper: PrepPaper) {
  const url = `${window.location.origin}/read/${paper._id}`;
  const shareData = {
    title: paper.title,
    text: `${paper.title} — practice it on Learnyx Academy ET`,
    url,
  };
  void (async () => {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(shareData);
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("Resource link copied — share it with your class.");
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        toast.error("Couldn't share this paper.");
      }
    }
  })();
}

function PaperCard({
  paper,
  index,
  digital,
}: {
  paper: PrepPaper;
  index: number;
  digital?: DigitalStatus;
}) {
  const navigate = useNavigate();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(0.3, index * 0.04) }}
      className="group flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-primary/30 hover:bg-white/[0.06]"
    >
      <div className="flex items-start justify-between gap-2">
        <SubtypeBadge subtype={paper.examPrepSubtype} />
        {paper.isPremium && (
          <span className="inline-flex items-center gap-1 rounded-md border border-premium/30 bg-premium/10 px-1.5 py-0.5 type-caption font-bold text-premium">
            <Crown className="size-3" /> Premium
          </span>
        )}
      </div>

      <p className="mt-2.5 line-clamp-2 type-body font-bold leading-snug">{paper.title}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-md px-2 py-0.5 type-caption font-semibold", subjectAccent(paper.subjectSlug))}>
          {paper.subjectName}
        </span>
        <span className="rounded-md bg-white/5 px-2 py-0.5 type-caption text-muted-foreground">
          Grade {paper.grade}
        </span>
        {paper.examYear !== null && (
          <span className="rounded-md bg-white/5 px-2 py-0.5 type-caption text-muted-foreground">
            {paper.examYear}
          </span>
        )}
      </div>

      {/* Digital availability chip — real state from the engine. Deliberately
          NO trust/AI badges here: students see a clean card, and QC happens
          silently in the background (admin review + in-player reports). */}
      {digital?.status === "ready" &&
      digital.reviewStatus !== "needs_review" &&
      digital.reviewStatus !== "pdf_only" ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 type-caption font-bold text-amber-300">
            <Sparkles className="size-3" /> Digital · {digital.questionCount} Qs
          </span>
        </div>
      ) : digital?.status === "processing" ? (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/30 bg-sky-400/10 px-1.5 py-0.5 type-caption font-bold text-sky-300">
            <Loader2 className="size-3 animate-spin" /> Converting…
          </span>
        </div>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-muted-foreground/70">
        <span className="inline-flex items-center gap-1">
          <FileText className="size-3" />
          {paper.pageCount !== null ? `${paper.pageCount} pages` : "PDF"}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer className="size-3" />
          ~{paper.durationMinutes ?? 120} min
        </span>
        {paper.hasAnswerKey && (
          <span className="inline-flex items-center gap-1 text-emerald-300/80">
            <ClipboardCheck className="size-3" /> Answer key
          </span>
        )}
      </div>

      {/* Practice / Exam mode / Share — both launch the fully digital
          engine; NO download affordance by design: the no-download policy
          applies everywhere in this hub. */}
      <div className="mt-4 flex items-center gap-2 border-t border-white/5 pt-3">
        <Button
          size="sm"
          onClick={() => navigate(`/exam-prep/digital/${paper._id}?mode=practice`)}
          className="interactive-press flex-1 gap-1.5"
          title="Fully digital Practice — untimed, with instant check-answer feedback"
        >
          <BookOpen className="size-3.5" /> Practice
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => navigate(`/exam-prep/digital/${paper._id}?mode=exam`)}
          className="interactive-press flex-1 gap-1.5 border-emerald-400/30 bg-emerald-400/[0.08] text-emerald-200 hover:bg-emerald-400/20 hover:text-emerald-100"
          title="Fully digital Exam — real countdown, no pausing, auto-submit"
        >
          <Timer className="size-3.5" /> Exam mode
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => sharePaper(paper)}
          aria-label={`Share ${paper.title}`}
          className="size-8 shrink-0 rounded-xl p-0 text-muted-foreground hover:text-foreground"
        >
          <Share2 className="size-4" />
        </Button>
      </div>
    </motion.div>
  );
}

function PapersTab({
  papers,
  subjects,
  digitalStatuses,
}: {
  papers: PrepPaper[];
  subjects: SubjectRow[];
  digitalStatuses: Map<string, DigitalStatus>;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [compareOpen, setCompareOpen] = useState(false);

  // Real facet counts from the actual library rows.
  const typeCounts = useMemo(
    () => ({
      all: papers.length,
      national_past_paper: papers.filter((p) => p.examPrepSubtype === "national_past_paper").length,
      practice_set: papers.filter((p) => p.examPrepSubtype === "practice_set").length,
      unclassified: papers.filter((p) => p.examPrepSubtype === null).length,
    }),
    [papers],
  );

  const subjectFacets = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    for (const p of papers) {
      const entry = map.get(p.subjectSlug) ?? { name: p.subjectName, count: 0 };
      entry.count += 1;
      map.set(p.subjectSlug, entry);
    }
    return [...map.entries()]
      .map(([slug, v]) => ({ slug, name: v.name, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }, [papers]);

  const yearFacets = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of papers) {
      if (p.examYear === null) continue;
      map.set(p.examYear, (map.get(p.examYear) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([year, count]) => ({ year, count }));
  }, [papers]);

  const filtered = useMemo(() => {
    return papers.filter((p) => {
      if (typeFilter === "national_past_paper" && p.examPrepSubtype !== "national_past_paper") return false;
      if (typeFilter === "practice_set" && p.examPrepSubtype !== "practice_set") return false;
      if (typeFilter === "unclassified" && p.examPrepSubtype !== null) return false;
      if (subjectFilter !== "all" && p.subjectSlug !== subjectFilter) return false;
      if (yearFilter !== "all" && String(p.examYear ?? "") !== yearFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!p.title.toLowerCase().includes(q) && !p.subjectName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [papers, typeFilter, subjectFilter, yearFilter, search]);

  const typeOptions: { value: TypeFilter; label: string }[] = [
    { value: "all", label: `All papers (${typeCounts.all})` },
    { value: "national_past_paper", label: `Official papers (${typeCounts.national_past_paper})` },
    { value: "practice_set", label: `Practice sets (${typeCounts.practice_set})` },
    { value: "unclassified", label: `Unclassified (${typeCounts.unclassified})` },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Filters — every option carries its real count */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
        <div className="grid gap-2.5 md:grid-cols-4">
          <SelectField label="Type">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
              className="hub-filter-select h-9 w-full rounded-xl border border-white/10 bg-white/5 px-2.5 text-sm text-foreground outline-none"
            >
              {typeOptions.map((o) => (
                <option key={o.value} value={o.value} className="bg-background">{o.label}</option>
              ))}
            </select>
          </SelectField>
          <SelectField label="Subject">
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="hub-filter-select h-9 w-full rounded-xl border border-white/10 bg-white/5 px-2.5 text-sm text-foreground outline-none"
            >
              <option value="all" className="bg-background">All subjects</option>
              {subjectFacets.map((s) => (
                <option key={s.slug} value={s.slug} className="bg-background">
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </SelectField>
          <SelectField label="Year">
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="hub-filter-select h-9 w-full rounded-xl border border-white/10 bg-white/5 px-2.5 text-sm text-foreground outline-none"
            >
              <option value="all" className="bg-background">All years</option>
              {yearFacets.map((y) => (
                <option key={y.year} value={String(y.year)} className="bg-background">
                  {y.year} ({y.count})
                </option>
              ))}
            </select>
          </SelectField>
          <SelectField label="Search">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Title or subject…"
                className="h-9 rounded-xl bg-white/5 pl-8"
              />
            </div>
          </SelectField>
        </div>
        <p className="mt-2.5 type-caption text-muted-foreground/60">
          Showing {filtered.length} of {papers.length} papers — counts update from the live library.
        </p>
      </div>

      {/* Year-over-year compare (browsing convenience) */}
      <YearOverYearCompare
        papers={papers}
        subjects={subjectFacets}
        open={compareOpen}
        onOpenChange={setCompareOpen}
      />

      {/* Paper grid */}
      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-10 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground/40" />
          <p className="mt-3 type-h3">No papers match these filters</p>
          <p className="mt-1 type-caption text-muted-foreground">
            Try widening the type, subject or year filter.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, 60).map((paper, i) => (
            <PaperCard key={paper._id} paper={paper} index={i} digital={digitalStatuses.get(paper._id)} />
          ))}
        </div>
      )}
      {filtered.length > 60 && (
        <p className="type-caption text-muted-foreground/60">
          Showing the first 60 — refine your filters to see more.
        </p>
      )}
    </div>
  );
}

function SelectField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="type-caption font-semibold text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ─── Year-over-year compare ─────────────────────────────────────────────

function YearOverYearCompare({
  papers,
  subjects,
  open,
  onOpenChange,
}: {
  papers: PrepPaper[];
  subjects: { slug: string; name: string; count: number }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [subjectSlug, setSubjectSlug] = useState<string>("");

  const activeSlug = subjectSlug || subjects[0]?.slug || "";
  const subjectPapers = papers
    .filter((p) => p.subjectSlug === activeSlug)
    .sort((a, b) => (b.examYear ?? 0) - (a.examYear ?? 0));

  // Latest two distinct years with papers for this subject.
  const latestYear = subjectPapers[0]?.examYear ?? null;
  const latestYearPapers = latestYear !== null ? subjectPapers.filter((p) => p.examYear === latestYear) : [];
  const prevYear = subjectPapers.find((p) => p.examYear !== latestYear)?.examYear ?? null;
  const prevYearPapers = prevYear !== null ? subjectPapers.filter((p) => p.examYear === prevYear) : [];

  const hasBoth = latestYear !== null && prevYear !== null;

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03]">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div>
          <p className="type-h3">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4 text-amber-300" /> Year-over-year compare
            </span>
          </p>
          <p className="mt-0.5 type-caption text-muted-foreground">
            Put this year's paper next to last year's — spot the pattern shifts before exam day.
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 border-white/15 text-muted-foreground">
          {open ? "Hide" : "Compare"}
        </Badge>
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="border-t border-white/5 p-4"
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="type-caption font-semibold text-muted-foreground">Subject:</label>
            <select
              value={activeSlug}
              onChange={(e) => setSubjectSlug(e.target.value)}
              className="hub-filter-select h-9 rounded-xl border border-white/10 bg-white/5 px-2.5 text-sm text-foreground outline-none"
            >
              {subjects.map((s) => (
                <option key={s.slug} value={s.slug} className="bg-background">
                  {s.name} ({s.count})
                </option>
              ))}
            </select>
          </div>

          {!hasBoth ? (
            <p className="mt-4 flex items-center gap-2 type-caption text-muted-foreground">
              <AlertTriangle className="size-3.5 text-amber-300" />
              {latestYear === null
                ? "No papers for this subject yet."
                : `Only ${latestYear} is available for this subject so far — more years will unlock the comparison.`}
            </p>
          ) : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                { label: "Most recent", year: latestYear, list: latestYearPapers, tone: "border-amber-400/25 bg-amber-400/[0.04]" },
                { label: "Previous year", year: prevYear, list: prevYearPapers, tone: "border-white/10 bg-white/[0.02]" },
              ].map((col) => (
                <div key={col.label} className={cn("rounded-2xl border p-4", col.tone)}>
                  <p className="type-caption font-bold text-amber-300/90">
                    {col.label} · {col.year}
                  </p>
                  <div className="mt-2 flex flex-col gap-2">
                    {col.list.slice(0, 4).map((p) => (
                      <button
                        key={p._id}
                        type="button"
                        onClick={() => navigate(`/exam-prep/digital/${p._id}?mode=practice`)}
                        className="group flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition hover:border-primary/40"
                      >
                        <span className="min-w-0">
                          <span className="block truncate type-caption font-semibold">{p.title}</span>
                          <span className="block type-caption text-muted-foreground/60">
                            ~{p.durationMinutes ?? 120} min{p.pageCount !== null ? ` · ${p.pageCount}p` : ""}
                          </span>
                        </span>
                        <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-amber-300" />
                      </button>
                    ))}
                    {col.list.length === 0 && (
                      <p className="type-caption text-muted-foreground/60">No papers for this year.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

// ─── Practice tab — front door into the EXISTING practice systems ───────

function PracticeTab({
  subjects,
  profileStream,
}: {
  subjects: SubjectRow[];
  profileStream: string | null;
}) {
  const [quizSubjectId, setQuizSubjectId] = useState<string | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);

  // Exam-relevant subjects: common (every student) + the student's own
  // stream. Grade 12 is who this tab serves first — copy reflects that.
  const common = subjects.filter((s) => s.stream === "common");
  const streamKey = profileStream === "social" ? "social" : "natural";
  const streamSpecific = subjects.filter((s) => s.stream === streamKey);

  const startQuiz = (subjectId: string) => {
    setQuizSubjectId(subjectId);
    setQuizOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Big three launchers — existing systems, one tap away */}
      <div className="grid gap-3 md:grid-cols-3">
        <LauncherCard
          to="/mock-exam"
          icon={GraduationCap}
          kicker="AI Mock Exam"
          title="Full exam simulation"
          detail="~340 original questions across 6 sections, timed like the real sitting."
          tone="border-emerald-400/25 bg-emerald-400/[0.05]"
          accent="bg-emerald-400/10 text-emerald-300"
        />
        <LauncherCard
          to="/aptitude-hub"
          icon={Brain}
          kicker="Aptitude Hub"
          title="Sharpen the SAT section"
          detail="Targeted aptitude drills — the section most students leave to chance."
          tone="border-violet-400/25 bg-violet-400/[0.05]"
          accent="bg-violet-400/10 text-violet-300"
        />
        <LauncherCard
          to="/flashcards"
          icon={Swords}
          kicker="Flashcards"
          title="Exam Attack mode"
          detail="Open the Exam Attack tab — timed, no hints, your hardest cards only."
          tone="border-amber-400/25 bg-amber-400/[0.05]"
          accent="bg-amber-400/10 text-amber-300"
        />
      </div>

      {/* Quiz launchers per exam subject */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <p className="type-h3">
          <span className="inline-flex items-center gap-2">
            <Target className="size-4 text-amber-300" /> Quick quiz by subject
          </span>
        </p>
        <p className="mt-1 type-caption text-muted-foreground">
          Generates a fresh quiz from the curriculum for that subject — the fastest
          way to surface weak topics before you hit the papers.
        </p>

        <p className="mt-4 type-caption font-bold uppercase tracking-wider text-muted-foreground/70">
          Core subjects · every stream
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {common.map((s) => (
            <SubjectQuizButton key={s._id} subject={s} onClick={() => startQuiz(s._id)} />
          ))}
        </div>

        <p className="mt-4 type-caption font-bold uppercase tracking-wider text-muted-foreground/70">
          {streamKey === "social" ? "Social stream" : "Natural stream"} · your stream
        </p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {streamSpecific.map((s) => (
            <SubjectQuizButton key={s._id} subject={s} onClick={() => startQuiz(s._id)} />
          ))}
        </div>
      </div>

      {/* Reuses the platform's QuizFlow exactly — no new generation logic */}
      <QuizFlow
        open={quizOpen}
        onOpenChange={setQuizOpen}
        initialSubjectId={quizSubjectId ?? undefined}
        title="Exam practice quiz"
      />
    </div>
  );
}

function SubjectQuizButton({ subject, onClick }: { subject: SubjectRow; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition hover:border-primary/40 hover:bg-white/[0.07]"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", subjectAccent(subject.slug))}>
          <BookOpen className="size-3.5" />
        </span>
        <span className="truncate text-sm font-semibold">{subject.name}</span>
      </span>
      <span className="type-caption font-bold text-amber-300/70 transition group-hover:text-amber-300">
        Quiz →
      </span>
    </button>
  );
}

function LauncherCard({
  to,
  icon: Icon,
  kicker,
  title,
  detail,
  tone,
  accent,
}: {
  to: string;
  icon: typeof Brain;
  kicker: string;
  title: string;
  detail: string;
  tone: string;
  accent: string;
}) {
  const navigate = useNavigate();
  return (
    <motion.button
      type="button"
      onClick={() => navigate(to)}
      whileHover={{ y: -3 }}
      className={cn("rounded-2xl border p-5 text-left transition", tone)}
    >
      <span className={cn("flex size-10 items-center justify-center rounded-xl", accent)}>
        <Icon className="size-5" />
      </span>
      <p className="mt-3 type-caption font-bold uppercase tracking-wider text-muted-foreground/70">{kicker}</p>
      <p className="mt-0.5 type-h3">{title}</p>
      <p className="mt-1 type-caption text-muted-foreground">{detail}</p>
      <span className="mt-3 inline-flex items-center gap-1 type-caption font-bold text-amber-300/80">
        Open <ArrowRight className="size-3" />
      </span>
    </motion.button>
  );
}

// ─── My Results tab — one readiness picture, three real sources ─────────

function ResultsTab({ results }: { results: PrepResultRow[] }) {
  const paperRows = results.filter((r) => r.kind === "paper_exam");
  const mockRows = results.filter((r) => r.kind === "mock_exam");
  const quizRows = results.filter((r) => r.kind === "quiz");

  const gradedPapers = paperRows.filter((r) => r.scorePct !== null);
  const completedMocks = mockRows.filter((r) => r.status === "completed" && r.scorePct !== null);
  const quizAvg = quizRows.length > 0
    ? Math.round(
        quizRows.reduce((sum, r) => sum + (r.scorePct ?? 0), 0) / Math.max(1, quizRows.filter((r) => r.scorePct !== null).length),
      )
    : null;

  const summary = [
    {
      label: "Paper exams",
      headline: gradedPapers.length > 0 ? `${Math.round(gradedPapers.reduce((s, r) => s + (r.scorePct ?? 0), 0) / gradedPapers.length)}%` : "—",
      detail: `${paperRows.length} attempt${paperRows.length === 1 ? "" : "s"} · ${gradedPapers.length} self-graded`,
      icon: FileText,
      accent: "bg-amber-400/10 text-amber-300",
    },
    {
      label: "AI mock exams",
      headline: completedMocks.length > 0 ? `${Math.round(completedMocks.reduce((s, r) => s + (r.scorePct ?? 0), 0) / completedMocks.length)}%` : "—",
      detail: `${completedMocks.length} completed · ${mockRows.filter((r) => r.status === "in_progress").length} in progress`,
      icon: GraduationCap,
      accent: "bg-emerald-400/10 text-emerald-300",
    },
    {
      label: "Recent quizzes",
      headline: quizAvg !== null ? `${quizAvg}%` : "—",
      detail: `${quizRows.length} attempt${quizRows.length === 1 ? "" : "s"} in exam subjects`,
      icon: ListChecks,
      accent: "bg-sky-400/10 text-sky-300",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Summary strip — shared visual language across all three sources */}
      <div className="grid gap-3 md:grid-cols-3">
        {summary.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.07 }}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
            >
              <div className="flex items-center justify-between">
                <span className={cn("flex size-9 items-center justify-center rounded-xl", s.accent)}>
                  <Icon className="size-4.5" />
                </span>
                <span className="type-h1 text-foreground/90">{s.headline}</span>
              </div>
              <p className="mt-3 type-caption font-bold text-foreground/80">{s.label}</p>
              <p className="mt-0.5 type-caption text-muted-foreground">{s.detail}</p>
            </motion.div>
          );
        })}
      </div>

      {/* Unified timeline — one list, kind icons, tone-coded scores */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <p className="type-h3">Activity timeline</p>
        <p className="mt-0.5 type-caption text-muted-foreground">
          Papers, mocks and quizzes in one sequence — most recent first.
        </p>

        {results.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-white/10 p-8 text-center">
            <ListChecks className="mx-auto size-8 text-muted-foreground/40" />
            <p className="mt-3 type-h3">No results yet</p>
            <p className="mt-1 type-caption text-muted-foreground">
              Your Exam Mode sessions, mock exams and quizzes will appear here as one readiness story.
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-1.5">
            {results.slice(0, 40).map((row) => (
              <div
                key={`${row.kind}-${row.refId}`}
                className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg",
                    row.kind === "paper_exam"
                      ? "bg-amber-400/10 text-amber-300"
                      : row.kind === "mock_exam"
                        ? "bg-emerald-400/10 text-emerald-300"
                        : "bg-sky-400/10 text-sky-300",
                  )}
                  title={row.kind === "paper_exam" ? "Paper exam" : row.kind === "mock_exam" ? "AI mock exam" : "Quiz"}
                >
                  {row.kind === "paper_exam" ? (
                    <FileText className="size-4" />
                  ) : row.kind === "mock_exam" ? (
                    <GraduationCap className="size-4" />
                  ) : (
                    <ListChecks className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.title}</p>
                  <p className="truncate type-caption text-muted-foreground">
                    {[row.subjectName, fmtDate(row.date), fmtDuration(row.timeSeconds), statusLabel(row)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {row.status === "in_progress" ? (
                  <span className="shrink-0 rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 type-caption font-bold text-sky-300">
                    In progress
                  </span>
                ) : row.scorePct !== null ? (
                  <span className={cn("shrink-0 rounded-md border px-2 py-0.5 type-caption font-bold tabular-nums", scoreTone(row.scorePct))}>
                    {row.scorePct}%
                  </span>
                ) : row.kind === "paper_exam" ? (
                  <span className="shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 type-caption text-muted-foreground">
                    Not graded
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function statusLabel(row: PrepResultRow): string | null {
  if (row.kind === "paper_exam") {
    if (row.status === "expired") return "time expired";
    return null;
  }
  if (row.kind === "quiz") return "quiz";
  return null;
}

// ─── Main page ──────────────────────────────────────────────────────────

export default function ExamPrep() {
  // Library autopilot note: the crowd conversion worker is mounted at the
  // app ROOT (AutopilotEngine) — every open Learnyx tab pre-converts queued
  // papers, this hub included. That is why paper cards keep flipping to
  // "Digital · N Qs" on their own.

  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (["overview", "papers", "practice", "results"] as const).includes(
    searchParams.get("tab") as HubTab,
  )
    ? (searchParams.get("tab") as HubTab)
    : "overview";
  const [tab, setTab] = useState<HubTab>(initialTab);

  const papers = useQuery(api.examPrep.getExamPrepPapers);
  const results = useQuery(api.examPrep.getMyExamPrepResults);
  const subjects = useQuery(api.subjects.getAll);
  const journey = useQuery(api.journey.getJourney);
  const profile = useQuery(api.profile.getProfile);
  // Digital conversion states for the paper cards (Digital · N Qs / Converting…).
  // The id array is memoized so the query args stay value-stable across renders
  // (same hard requirement as the calendar query below).
  const paperIds = useMemo(() => (papers ?? []).map((p) => p._id), [papers]);
  const digitalStatusRows = useQuery(
    api.examPrepDigital.getDigitalPaperStatuses,
    paperIds.length > 0 ? { contentIds: paperIds } : { contentIds: [] },
  );
  const digitalStatuses = useMemo(() => {
    const map = new Map<string, DigitalStatus>();
    for (const row of digitalStatusRows ?? []) {
      map.set(row.contentId, {
        status: row.status as DigitalStatus["status"],
        questionCount: row.questionCount,
        reviewStatus: row.reviewStatus ?? null,
      });
    }
    return map;
  }, [digitalStatusRows]);
  // Upcoming calendar events — the next type="exam" event drives the countdown.
  //
  // ⚠️ Args stability is a hard Convex useQuery requirement: the args object
  // must NOT change identity/value on every render, or the query re-subscribes
  // every render → re-render → re-subscribe… → React #185 "Maximum update
  // depth exceeded" (this exact bug took down the whole hub whenever it
  // remounted — e.g. on back-navigation from the Reader — and desynced the
  // URL from the view during forward navigation).
  //
  // FIX: capture the timestamp ONCE per mount, floored to the minute so
  // quick remounts (hub ↔ reader round-trips) hit the same query cache
  // entry instead of re-fetching. Flooring rounds DOWN, which only widens
  // the "upcoming" window by <60s — semantically safe for a countdown.
  const [upcomingFrom] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  const upcomingEvents = useQuery(api.calendar.listEvents, { startAt: upcomingFrom });

  const loading = papers === undefined || results === undefined;

  const nextExam = useMemo(() => {
    const examEvents = (upcomingEvents ?? []).filter((e) => e.type === "exam");
    return examEvents.length > 0
      ? { title: examEvents[0]!.title, startAt: examEvents[0]!.startAt }
      : null;
  }, [upcomingEvents]);

  // Recommended next: weakest recent subject by quiz average (from the
  // Journey data the platform already computes), mapped to that subject's
  // most recent official paper (falling back to any paper for it).
  const recommended = useMemo(() => {
    if (!journey || journey.quizTrend.length === 0 || !papers || papers.length === 0) return null;
    const bySubject = new Map<string, { sum: number; count: number }>();
    for (const t of journey.quizTrend) {
      if (!t.subjectId) continue;
      const entry = bySubject.get(t.subjectId) ?? { sum: 0, count: 0 };
      entry.sum += t.pct;
      entry.count += 1;
      bySubject.set(t.subjectId, entry);
    }
    let weakest: { subjectId: string; avgPct: number; count: number } | null = null;
    for (const [subjectId, { sum, count }] of bySubject) {
      if (count < 2) continue; // need a trend, not a fluke
      const avgPct = Math.round(sum / count);
      if (!weakest || avgPct < weakest.avgPct) weakest = { subjectId, avgPct, count };
    }
    if (!weakest) return null;
    const forSubject = papers.filter((p) => p.subjectSlug && subjects?.some((s) => s._id === weakest?.subjectId && s.slug === p.subjectSlug));
    if (forSubject.length === 0) return null;
    const paper =
      forSubject.find((p) => p.examPrepSubtype === "national_past_paper") ?? forSubject[0]!;
    return { paper, avgPct: weakest.avgPct, attempts: weakest.count };
  }, [journey, papers, subjects]);

  const handleGoToTab = (next: HubTab) => {
    setTab(next);
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    setSearchParams(params, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <DashboardShell>
      <div className="flex w-full flex-col gap-4 sm:gap-6">
        {/* ─── Page header ─── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            {"// exam prep hub"}
          </p>
          <h1 className="type-display mt-1 text-gradient">Exam command center</h1>
          <p className="type-body mt-1.5 max-w-2xl text-muted-foreground">
            Every real past paper, the full AI mock exam engine and your entire
            results history — one place, pointed at exam day.
          </p>
        </motion.div>

        {/* ─── Tabs ─── */}
        <Tabs value={tab} onValueChange={(v) => handleGoToTab(v as HubTab)} className="w-full">
          <TabsList className="grid w-full max-w-2xl grid-cols-4 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            {(
              [
                { value: "overview", label: "Overview", icon: Sparkles },
                { value: "papers", label: "Papers", icon: FileText },
                { value: "practice", label: "Practice", icon: Swords },
                { value: "results", label: "My Results", icon: ListChecks },
              ] as const
            ).map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="gap-1.5 rounded-xl px-2 text-xs font-semibold text-muted-foreground transition data-[state=active]:bg-amber-400/15 data-[state=active]:text-amber-200 sm:text-sm"
              >
                <t.icon className="size-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.label.split(" ")[0]}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
              <span className="type-body">Loading your exam prep…</span>
            </div>
          ) : (
            <>
              <TabsContent value="overview" className="mt-4 outline-none">
                <OverviewTab
                  papers={papers ?? []}
                  results={results ?? []}
                  nextExam={nextExam}
                  recommended={recommended}
                  onGoToTab={handleGoToTab}
                />
              </TabsContent>
              <TabsContent value="papers" className="mt-4 outline-none">
                <PapersTab papers={papers ?? []} subjects={(subjects ?? []) as SubjectRow[]} digitalStatuses={digitalStatuses} />
              </TabsContent>
              <TabsContent value="practice" className="mt-4 outline-none">
                <PracticeTab
                  subjects={(subjects ?? []) as SubjectRow[]}
                  profileStream={profile?.stream ?? null}
                />
              </TabsContent>
              <TabsContent value="results" className="mt-4 outline-none">
                <ResultsTab results={results ?? []} />
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </DashboardShell>
  );
}


