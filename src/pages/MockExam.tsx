// National exam simulation — /mock-exam
//
// Two connected flagship features (this is Feature 2):
//   1. (Feature 1 lives in the Reader — Exam Mode for past-exam PDFs.)
//   2. THIS PAGE: an AI-generated full mock exam — 6 sections, ~340 questions,
//      ~5 hours, mirroring the real EHEEE/ESSLCE structure. All questions
//      are ORIGINAL — written fresh by the model, never extracted from a
//      real past paper.
//
// Flow:
//   - Start screen: pick stream (auto-detect from profile), see the real
//     format explained, a serious "Begin Mock Exam" commitment step.
//   - Generating: progress UI as the AI builds all 6 sections sequentially.
//     (Generation is sequential, not parallel — see mockExam.ts comment.)
//   - Taking: section-by-section. Real countdown timer per section. Question
//     navigator with jump + flag-for-review. Auto-advance to next section
//     when time expires (matching real exam conditions — no lingering).
//   - Results: per-subject breakdown, overall score, comparison to previous
//     attempts (progress tracking). Returns to the app's warm celebratory
//     tone, especially for a strong score.
//
// Premium gating: generateMockExam is hard-gated to active subscriptions
// (trial or active). The frontend shows an upgrade prompt if the gate
// throws `premium_mock_exams`.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  FileText,
  Flag,
  FlagOff,
  GraduationCap,
  Loader2,
  Play,
  Sparkles,
  Timer,
  TrendingUp,
  Trophy,
  X,
  Zap,
  Brain,
  Target,
  ListChecks,
  Hourglass,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import { Link } from "react-router";

// ---------------------------------------------------------------------------
// Types (mirror the backend's return shapes)
// ---------------------------------------------------------------------------

type SectionStatus = "in_progress" | "completed";
type VisibleQuestion = {
  question: string;
  options: string[]; // length 4
  // correctIndex/explanation hidden until section is completed
  correctIndex: number;
  explanation: string;
};

type ExamSection = {
  _id: Id<"mockExamSections">;
  sectionIndex: number;
  subjectId: Id<"subjects">;
  questions: VisibleQuestion[];
  answers: number[];
  flagged: boolean[];
  timeAllottedSeconds: number;
  timeSpentSeconds: number;
  status: SectionStatus;
  score?: number;
  correctCount?: number;
  totalQuestions?: number;
};

type FullExam = {
  _id: Id<"mockExams">;
  stream: string;
  status: "in_progress" | "completed" | "abandoned";
  startedAt: number;
  completedAt?: number;
  totalScore?: number;
  sections: ExamSection[];
};

type MockExamHistoryItem = {
  _id: Id<"mockExams">;
  stream: string;
  status: "in_progress" | "completed" | "abandoned";
  startedAt: number;
  completedAt?: number;
  totalScore?: number;
};

// ---------------------------------------------------------------------------
// Phase type
// ---------------------------------------------------------------------------

type Phase = "start" | "generating" | "taking" | "results";

// ---------------------------------------------------------------------------
// Subject name lookup helper
// ---------------------------------------------------------------------------

function useSubjectNames() {
  const subjects = useQuery(api.subjects.getAll);
  return useMemo(() => {
    const map = new Map<Id<"subjects">, string>();
    if (subjects) {
      for (const s of subjects) map.set(s._id as Id<"subjects">, s.name);
    }
    return map;
  }, [subjects]);
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function MockExamPage() {
  const navigate = useNavigate();
  const startMockExam = useAction(api.mockExam.startMockExam);
  const generateSection = useAction(api.mockExam.generateSection);
  const [phase, setPhase] = useState<Phase>("start");
  const [activeExamId, setActiveExamId] = useState<Id<"mockExams"> | null>(null);
  const [genProgress, setGenProgress] = useState<{
    sectionIndex: number;
    subjectName: string;
    success: boolean;
    reason?: string;
    retryable?: boolean;
    providerUsed?: "gemini" | "openrouter" | "cerebras" | "groq";
    generationMs?: number;
  }[]>([]);
  const [genCurrent, setGenCurrent] = useState<string>("");
  const [genError, setGenError] = useState<string | null>(null);
  const [activeSectionPlan, setActiveSectionPlan] = useState<{
    sectionIndex: number;
    subjectId: Id<"subjects">;
    subjectName: string;
    questionCount: number;
  }[] | null>(null);
  const [retrying, setRetrying] = useState(false);

  const subjectNames = useSubjectNames();

  // User profile — for auto-detecting the stream
  const profile = useQuery(api.profile.getProfile);
  const userStream: "natural" | "social" | undefined =
    profile?.stream === "natural" || profile?.stream === "social" ? profile.stream : undefined;

  // Active exam data
  const exam = useQuery(
    api.mockExam.getMyMockExam,
    activeExamId ? ({ mockExamId: activeExamId } as never) : "skip",
  );

  // Previous attempts
  const history = useQuery(api.mockExam.getMyMockExams, {});

  // Auto-transition to "taking" once ALL sections have generated
  useEffect(() => {
    if (phase === "generating" && activeExamId && exam && genProgress.length > 0) {
      const totalExpected = activeSectionPlan?.length ?? 6;
      const allDone = genProgress.length >= totalExpected;
      const failedSections = genProgress.filter((p) => !p.success);
      const successfulSections = genProgress.length - failedSections.length;
      if (allDone && failedSections.length === 0 && successfulSections > 0 && exam.sections.length > 0) {
        const t = setTimeout(() => setPhase("taking"), 800);
        return () => clearTimeout(t);
      }
    }
  }, [phase, activeExamId, exam, genProgress, activeSectionPlan]);

  // Auto-transition to "results" once the exam status becomes "completed".
  useEffect(() => {
    if (phase === "taking" && exam && exam.status === "completed") {
      setPhase("results");
    }
  }, [phase, exam]);

  const handleBegin = async (stream: "natural" | "social") => {
    setPhase("generating");
    setGenError(null);
    setGenProgress([]);
    setGenCurrent("");
    setRetrying(false);
    try {
      const start = (await startMockExam({ stream })) as {
        mockExamId: Id<"mockExams">;
        sections: { sectionIndex: number; subjectId: Id<"subjects">; subjectName: string; questionCount: number }[];
      };
      setActiveExamId(start.mockExamId);
      setActiveSectionPlan(start.sections);

      const GEMINI_DELAY_MS = 1500;
      const GROQ_DELAY_MS = 60000;
      const progress: typeof genProgress = [];
      let lastProvider: "gemini" | "openrouter" | "cerebras" | "groq" | undefined = undefined;
      for (let i = 0; i < start.sections.length; i++) {
        const section = start.sections[i];
        setGenCurrent(section.subjectName);
        try {
          const result = (await generateSection({
            mockExamId: start.mockExamId,
            sectionIndex: section.sectionIndex,
          })) as {
            success: boolean;
            reason?: string;
            retryable?: boolean;
            providerUsed?: "gemini" | "openrouter" | "cerebras" | "groq";
            generationMs?: number;
          };
          lastProvider = result.providerUsed ?? "gemini";
          progress.push({
            sectionIndex: section.sectionIndex,
            subjectName: section.subjectName,
            success: result.success,
            reason: result.reason,
            retryable: result.retryable,
            providerUsed: result.providerUsed,
            generationMs: result.generationMs,
          });
          setGenProgress([...progress]);
          if (!result.success) {
            toast.warning(`${section.subjectName} section failed: ${result.reason ?? "unknown"}`, {
              duration: 6000,
            });
          }
        } catch (err) {
          progress.push({
            sectionIndex: section.sectionIndex,
            subjectName: section.subjectName,
            success: false,
            reason: err instanceof Error ? err.message : "unknown",
          });
          setGenProgress([...progress]);
        }
        if (i < start.sections.length - 1) {
          const delay = lastProvider === "groq" ? GROQ_DELAY_MS : GEMINI_DELAY_MS;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      const successful = progress.filter((p) => p.success).length;
      const failed = progress.length - successful;
      if (successful === 0) {
        toast.error("All sections failed to generate. Try again in a moment.");
        setPhase("start");
        setActiveExamId(null);
        return;
      }
      if (failed > 0) {
        toast.warning(
          `${failed} section(s) failed to generate. You can take the remaining ${successful}, or retry the failed section(s) below.`,
          { duration: 6000 },
        );
      } else {
        toast.success(`Mock exam ready — all ${successful} sections generated.`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Generation failed.";
      const data = (error as { data?: { code?: string } })?.data;
      if (data?.code === "premium_mock_exams" || msg.toLowerCase().includes("premium")) {
        setGenError("premium");
      } else if (data?.code === "ai_not_configured" || msg.toLowerCase().includes("gemini")) {
        setGenError("gemini_not_configured");
      } else {
        setGenError(msg);
      }
      setPhase("start");
    }
  };

  const handleRetrySection = async (sectionIndex: number) => {
    if (!activeExamId || !activeSectionPlan) return;
    const section = activeSectionPlan.find((s) => s.sectionIndex === sectionIndex);
    if (!section) return;
    setRetrying(true);
    setGenCurrent(section.subjectName);
    try {
      const result = (await generateSection({
        mockExamId: activeExamId,
        sectionIndex,
      })) as {
        success: boolean;
        reason?: string;
        retryable?: boolean;
        providerUsed?: "gemini" | "openrouter" | "cerebras" | "groq";
        generationMs?: number;
      };
      setGenProgress((prev) =>
        prev.map((p) =>
          p.sectionIndex === sectionIndex
            ? {
                sectionIndex,
                subjectName: section.subjectName,
                success: result.success,
                reason: result.reason,
                retryable: result.retryable,
                providerUsed: result.providerUsed,
                generationMs: result.generationMs,
              }
            : p,
        ),
      );
      if (result.success) {
        toast.success(`${section.subjectName} section is now ready.`);
      } else {
        toast.error(`${section.subjectName} section failed again: ${result.reason ?? "unknown"}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not retry this section.",
      );
    } finally {
      setRetrying(false);
      setGenCurrent("");
    }
  };

  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-6xl px-1 py-4 sm:px-4">
        <AnimatePresence mode="wait">
          {phase === "start" && (
            <motion.div
              key="start"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <StartScreen
                userStream={userStream}
                history={history ?? []}
                onBegin={handleBegin}
                onOpenHistory={(id) => {
                  setActiveExamId(id);
                  setPhase("results");
                }}
              />
            </motion.div>
          )}
          {phase === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <GeneratingScreen
                progress={genProgress}
                current={genCurrent}
                onRetry={handleRetrySection}
                retrying={retrying}
                onProceed={() => setPhase("taking")}
                canProceed={
                  !!activeExamId &&
                  genProgress.filter((p) => p.success).length > 0
                }
              />
            </motion.div>
          )}
          {phase === "taking" && exam && (
            <TakingScreen
              key="taking"
              exam={exam as FullExam}
              subjectNames={subjectNames}
              onAbandon={() => {
                setActiveExamId(null);
                setGenProgress([]);
                setPhase("start");
                navigate("/mock-exam");
              }}
            />
          )}
          {phase === "results" && exam && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              <ResultsScreen
                exam={exam as FullExam}
                subjectNames={subjectNames}
                history={history ?? []}
                onRetake={() => {
                  setActiveExamId(null);
                  setGenProgress([]);
                  setPhase("start");
                }}
                onExit={() => navigate("/dashboard")}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {phase === "start" && genError === "premium" && (
          <PremiumGateOverlay onClose={() => setGenError(null)} />
        )}
        {phase === "start" && genError === "gemini_not_configured" && (
          <div className="mt-6 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-6 text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // gemini key not configured
            </p>
            <h3 className="mt-2 text-lg font-extrabold tracking-tight">
              Mock exams need a Gemini API key
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Mock exam generation uses Google's Gemini API because of its
              higher token-per-minute ceiling. Ask the admin to add a Gemini API
              key in the Keys tab — get one free at{" "}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-amber-300 underline underline-offset-2"
              >
                aistudio.google.com/apikey
              </a>
              .
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => setGenError(null)}
            >
              Got it
            </Button>
          </div>
        )}
        {phase === "start" && genError && genError !== "premium" && genError !== "gemini_not_configured" && (
          <div className="mt-6 rounded-2xl border border-rose-400/30 bg-rose-400/[0.06] p-6 text-center">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-rose-300">
              // generation failed
            </p>
            <p className="mt-2 text-sm text-foreground">{genError}</p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => setGenError(null)}
            >
              Try again
            </Button>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Start screen — completely rebuilt for clarity and visual impact.
// ---------------------------------------------------------------------------

function StartScreen({
  userStream,
  history,
  onBegin,
  onOpenHistory,
}: {
  userStream: "natural" | "social" | undefined;
  history: MockExamHistoryItem[];
  onBegin: (stream: "natural" | "social") => void;
  onOpenHistory: (id: Id<"mockExams">) => void;
}) {
  const [stream, setStream] = useState<"natural" | "social">(userStream ?? "natural");
  const [confirmed, setConfirmed] = useState(false);

  const completedAttempts = history.filter((h) => h.status === "completed" && h.totalScore !== undefined);
  const lastAttempt = completedAttempts[0];
  const bestAttempt = completedAttempts.length > 0
    ? completedAttempts.reduce((best, h) => (h.totalScore! > best.totalScore! ? h : best))
    : null;

  return (
    <div className="flex flex-col gap-8">
      {/* HERO HEADER — big, bold, inspiring */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-400/[0.04] via-white/[0.01] to-transparent p-8 sm:p-12"
      >
        <div className="pointer-events-none absolute -top-24 -right-12 size-64 rounded-full bg-amber-400/8 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-20 -left-12 size-64 rounded-full bg-sky-400/5 blur-[80px]" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/5 px-3 py-1">
            <Sparkles className="size-3.5 text-amber-300" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              National Exam Simulation
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            Mock <span className="text-gradient">Exam</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            A complete simulated EHEEE sitting — six sections, around 340
            original AI-generated questions, roughly five hours of focused
            time. Every question is written fresh by our model from the real
            Ethiopian curriculum, never copied from a past paper. Built for
            serious readiness.
          </p>
          {lastAttempt && (
            <div className="mt-6 flex flex-wrap gap-3">
              <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2">
                <Trophy className="size-4 text-emerald-300" />
                <div>
                  <p className="text-[10px] uppercase tracking-[0.15em] text-emerald-300/80">Last attempt</p>
                  <p className="text-sm font-bold text-emerald-100">{lastAttempt.totalScore}% overall</p>
                </div>
              </div>
              {bestAttempt && bestAttempt._id !== lastAttempt._id && (
                <div className="inline-flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2">
                  <Award className="size-4 text-amber-300" />
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.15em] text-amber-300/80">Personal best</p>
                    <p className="text-sm font-bold text-amber-100">{bestAttempt.totalScore}% overall</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* REAL EXAM FORMAT — clear visual stats grid */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-2 gap-4 sm:grid-cols-4"
      >
        <FormatStat
          icon={<ListChecks className="size-5 text-amber-300" />}
          label="Sections"
          value="6"
          hint="English · Math · Aptitude · 3 stream subjects"
        />
        <FormatStat
          icon={<Brain className="size-5 text-sky-300" />}
          label="Questions"
          value="~340"
          hint="50 per section (Aptitude: 40)"
        />
        <FormatStat
          icon={<Hourglass className="size-5 text-emerald-300" />}
          label="Duration"
          value="~5h"
          hint="50 min per section, no pausing"
        />
        <FormatStat
          icon={<Target className="size-5 text-violet-300" />}
          label="Format"
          value="CBT"
          hint="Computer-based, like the real exam"
        />
      </motion.div>

      {/* STREAM PICKER — large, beautiful, visual */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8"
      >
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 1 · Pick your stream
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StreamOption
            active={stream === "natural"}
            onClick={() => setStream("natural")}
            title="Natural Science"
            subjects="Physics · Chemistry · Biology"
            tone="emerald"
            icon={<Brain className="size-5" />}
          />
          <StreamOption
            active={stream === "social"}
            onClick={() => setStream("social")}
            title="Social Science"
            subjects="History · Geography · Economics"
            tone="amber"
            icon={<GraduationCap className="size-5" />}
          />
        </div>
        {userStream && (
          <p className="mt-4 text-xs text-muted-foreground">
            Auto-detected from your profile ({userStream === "natural" ? "Natural" : "Social"} stream) —
            change if you want to practice the other track.
          </p>
        )}
      </motion.div>

      {/* COMMITMENT STEP — serious but clear */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.03] p-6 sm:p-8"
      >
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Step 2 · Commit
        </p>
        <div className="mt-4 flex items-start gap-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          <AlertTriangle className="size-6 shrink-0 text-amber-300" />
          <div className="flex-1">
            <p className="text-base font-semibold text-foreground">
              Once you begin, the timer cannot be paused.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              You&apos;ll have 50 minutes per section. When a section&apos;s
              timer expires, it auto-submits and you can&apos;t go back. Make
              sure you have roughly 5 hours of uninterrupted focus before
              starting.
            </p>
            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="size-4 cursor-pointer rounded border-white/20 bg-white/5 accent-amber-400"
              />
              I understand — I&apos;m ready to begin the full mock exam.
            </label>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <Button
            onClick={() => onBegin(stream)}
            disabled={!confirmed}
            className="cursor-pointer gap-2 bg-amber-500 text-amber-950 hover:bg-amber-400 disabled:opacity-40"
            size="lg"
          >
            <Play className="size-4" /> Begin mock exam
          </Button>
        </div>
      </motion.div>

      {/* PREVIOUS ATTEMPTS — chronological history */}
      {completedAttempts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8"
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Your previous attempts
            </p>
            <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
              {completedAttempts.length} total
            </Badge>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {completedAttempts.slice(0, 5).map((h) => (
              <button
                key={h._id}
                onClick={() => onOpenHistory(h._id)}
                className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-colors hover:border-amber-400/30 hover:bg-amber-400/[0.04]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                    <Trophy className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {new Date(h.startedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      · {h.stream === "natural" ? "Natural" : "Social"} stream
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Click to view full breakdown
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xl font-bold text-gradient">
                    {h.totalScore}%
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-amber-300" />
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function FormatStat({
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
    <div className="flex flex-col gap-2 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-amber-400/20 hover:bg-amber-400/[0.03]">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        {icon}
      </div>
      <p className="text-3xl font-extrabold tracking-tight text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function StreamOption({
  active,
  onClick,
  title,
  subjects,
  tone,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subjects: string;
  tone: "emerald" | "amber";
  icon: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer flex-col gap-3 rounded-2xl border p-5 text-left transition-all",
        active
          ? tone === "emerald"
            ? "border-emerald-400/40 bg-emerald-400/[0.08] shadow-[inset_0_0_0_1px_rgb(52,211,153/0.2)]"
            : "border-amber-400/40 bg-amber-400/[0.08] shadow-[inset_0_0_0_1px_rgb(251,191,36/0.2)]"
          : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            active
              ? tone === "emerald"
                ? "bg-emerald-400/15 text-emerald-300"
                : "bg-amber-400/15 text-amber-300"
              : "bg-white/5 text-muted-foreground",
          )}
        >
          {icon}
        </div>
        {active && (
          <CheckCircle2
            className={cn(
              "size-5",
              tone === "emerald" ? "text-emerald-300" : "text-amber-300",
            )}
          />
        )}
      </div>
      <div>
        <p className="text-base font-bold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{subjects}</p>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Generating screen
// ---------------------------------------------------------------------------

function GeneratingScreen({
  progress,
  current,
  onRetry,
  retrying,
  onProceed,
  canProceed,
}: {
  progress: { sectionIndex: number; subjectName: string; success: boolean; reason?: string; retryable?: boolean; providerUsed?: "gemini" | "openrouter" | "cerebras" | "groq"; generationMs?: number }[];
  current: string;
  onRetry: (sectionIndex: number) => void;
  retrying: boolean;
  onProceed: () => void;
  canProceed: boolean;
}) {
  const total = 6;
  const done = progress.length;
  const failedCount = progress.filter((p) => !p.success).length;
  const allDone = done >= total;
  const groqFallbackActive = progress.some((p) => p.providerUsed === "groq");
  const remainingSections = Math.max(0, total - done);
  const estimatedRemainingMs = groqFallbackActive
    ? remainingSections * 65_000
    : remainingSections * 15_000;

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16">
      <div className="relative flex size-24 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-amber-400/20 blur-3xl animate-pulse" />
        {allDone ? (
          <CheckCircle2 className="size-12 text-emerald-300" />
        ) : (
          <Loader2 className="size-12 animate-spin text-amber-300" />
        )}
      </div>
      <div className="text-center">
        <p className="font-mono text-xs font-bold uppercase tracking-[0.22em] text-amber-300">
          {allDone ? "// your mock exam is ready" : "// generating your mock exam"}
        </p>
        <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-foreground">
          {allDone
            ? failedCount > 0
              ? `${failedCount} section${failedCount > 1 ? "s" : ""} need${failedCount === 1 ? "s" : ""} a retry`
              : "All sections ready"
            : current
              ? `Building ${current}…`
              : "Building 6 sections of original questions"}
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
          {allDone ? (
            "All requested sections have been processed. Review any failures above, or proceed to take the exam."
          ) : groqFallbackActive ? (
            <>
              Gemini isn&apos;t available from your region, so the AI is using
              the Groq fallback path — each section needs a ~60s cooldown between
              calls to respect Groq&apos;s free-tier rate limit. Estimated time
              remaining: <span className="font-mono font-bold text-amber-300">~{Math.ceil(estimatedRemainingMs / 60_000)} min</span>.
              Please keep this tab open.
            </>
          ) : (
            <>
              The AI writes ~340 fresh multiple-choice questions grounded in
              the Ethiopian curriculum — one section at a time. Each section
              takes ~10–20s. Estimated time remaining:{" "}
              <span className="font-mono font-bold text-amber-300">
                ~{Math.max(1, Math.round(estimatedRemainingMs / 1000))}s
              </span>
              . Please keep this tab open.
            </>
          )}
        </p>
      </div>

      {/* Progress list */}
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>Progress</span>
          <span className="font-mono font-semibold">
            {done} / {total}
          </span>
        </div>
        {/* Overall progress bar */}
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-white/5">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400"
            initial={{ width: 0 }}
            animate={{ width: `${(done / total) * 100}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: total }, (_, i) => {
            const item = progress[i];
            if (!item) {
              return (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-muted-foreground"
                >
                  <Loader2 className={cn("size-4", i === done ? "animate-spin text-amber-300" : "opacity-30")} />
                  <span>Section {i + 1} — {i === done ? (current || "pending…") : "pending"}</span>
                </div>
              );
            }
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm",
                  item.success
                    ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200"
                    : "border-rose-400/20 bg-rose-400/[0.06] text-rose-200",
                )}
              >
                {item.success ? (
                  <CheckCircle2 className="size-4 text-emerald-300" />
                ) : retrying && current === item.subjectName ? (
                  <Loader2 className="size-4 animate-spin text-rose-300" />
                ) : (
                  <X className="size-4 text-rose-300" />
                )}
                <span className="flex-1 font-medium">
                  {item.subjectName} — {item.success ? "ready" : "failed"}
                </span>
                {item.success && item.providerUsed && (
                  <span
                    className={cn(
                      "rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
                      item.providerUsed === "gemini"
                        ? "bg-sky-400/15 text-sky-300"
                        : item.providerUsed === "openrouter"
                          ? "bg-emerald-400/15 text-emerald-300"
                          : item.providerUsed === "cerebras"
                            ? "bg-amber-400/15 text-amber-300"
                            : "bg-violet-400/15 text-violet-300",
                    )}
                  >
                    {item.providerUsed === "gemini"
                      ? "Gemini"
                      : item.providerUsed === "openrouter"
                        ? "OpenRouter"
                        : item.providerUsed === "cerebras"
                          ? "Cerebras"
                          : "Groq"}
                  </span>
                )}
                {!item.success && (
                  <button
                    type="button"
                    onClick={() => onRetry(item.sectionIndex)}
                    disabled={retrying}
                    className={cn(
                      "cursor-pointer rounded-md border border-rose-400/30 bg-rose-400/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-rose-200 transition-colors hover:bg-rose-400/20",
                      retrying && "opacity-50",
                    )}
                  >
                    {retrying && current === item.subjectName ? "Retrying…" : "Retry"}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {allDone && failedCount > 0 && (
          <div className="mt-5 space-y-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Some sections couldn&apos;t be generated (often a transient
              rate-limit from the AI provider). You can retry individual
              sections above, or proceed with the {done - failedCount} ready
              section{done - failedCount === 1 ? "" : "s"} — the failed
              sections will be skipped in the final score.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                className="h-10 cursor-pointer gap-2"
                disabled={!canProceed}
                onClick={onProceed}
              >
                <CheckCircle2 className="size-4" />
                Proceed with {done - failedCount} section{done - failedCount === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taking screen — the exam itself, section by section.
// We use the app's theme colors (no more pitch-black void). The sidebar
// is wider and the question content uses a comfortable max-width for
// readability on any screen.
// ---------------------------------------------------------------------------

function TakingScreen({
  exam,
  subjectNames,
  onAbandon,
}: {
  exam: FullExam;
  subjectNames: Map<Id<"subjects">, string>;
  onAbandon: () => void;
}) {
  const [sectionIndex, setSectionIndex] = useState(0);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [flagged, setFlagged] = useState<boolean[]>([]);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [sectionStartedAt, setSectionStartedAt] = useState<number | null>(null);
  const [submittingSection, setSubmittingSection] = useState(false);

  const submitSectionAnswers = useMutation(api.mockExam.submitSectionAnswers);
  const completeSection = useMutation(api.mockExam.completeSection);
  const completeMockExam = useMutation(api.mockExam.completeMockExam);

  const currentSection = exam.sections[sectionIndex];
  const questions = currentSection?.questions ?? [];
  const isLastSection = sectionIndex === exam.sections.length - 1;

  // Initialize per-section state when the section changes.
  useEffect(() => {
    if (!currentSection) return;
    setQuestionIndex(0);
    setAnswers([...currentSection.answers]);
    setFlagged([...currentSection.flagged]);
    setRemainingSeconds(currentSection.timeAllottedSeconds - currentSection.timeSpentSeconds);
    setSectionStartedAt(Date.now());
  }, [sectionIndex, currentSection?._id]);

  // Countdown ticker
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!currentSection || currentSection.status === "completed") return;
    tickRef.current = setInterval(() => {
      setRemainingSeconds((r) => {
        if (r <= 1) {
          void handleSubmitSection(true);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionIndex, currentSection?._id]);

  // Auto-save every 30 seconds
  const lastSaveRef = useRef<number>(0);
  useEffect(() => {
    if (!currentSection) return;
    const saveInterval = setInterval(() => {
      void autoSave();
    }, 30 * 1000);
    return () => clearInterval(saveInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSection?._id, answers, flagged]);

  const autoSave = async () => {
    if (!currentSection || submittingSection) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 5000) return;
    lastSaveRef.current = now;
    const elapsed = currentSection.timeSpentSeconds + Math.floor((now - (sectionStartedAt ?? now)) / 1000);
    try {
      await submitSectionAnswers({
        sectionId: currentSection._id,
        answers,
        flagged,
        timeSpentSeconds: elapsed,
      });
    } catch {
      // silent
    }
  };

  const handleSubmitSection = async (autoSubmitted: boolean = false) => {
    if (!currentSection || submittingSection) return;
    if (tickRef.current) clearInterval(tickRef.current);
    setSubmittingSection(true);
    const elapsed =
      currentSection.timeSpentSeconds +
      Math.floor((Date.now() - (sectionStartedAt ?? Date.now())) / 1000);
    try {
      await completeSection({
        sectionId: currentSection._id,
        answers,
        flagged,
        timeSpentSeconds: Math.min(elapsed, currentSection.timeAllottedSeconds),
      });
      if (autoSubmitted) {
        toast.info(`Time's up — ${subjectNames.get(currentSection.subjectId) ?? "Section"} submitted.`);
      }
      if (isLastSection) {
        await completeMockExam({ mockExamId: exam._id });
        toast.success("Mock exam complete! Loading your results…");
      } else {
        setSectionIndex((i) => i + 1);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit section.");
    } finally {
      setSubmittingSection(false);
    }
  };

  if (!currentSection) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-16">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/[0.04]">
          <AlertTriangle className="size-7 text-rose-300" />
        </div>
        <div className="max-w-md text-center">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-rose-300">
            // no questions loaded
          </p>
          <h3 className="mt-3 text-xl font-extrabold tracking-tight">
            This section has no questions
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            The AI generated this section but the question data couldn&apos;t
            be parsed. This usually happens when the AI model returned
            malformed JSON. Try regenerating the exam, or skip this section.
          </p>
        </div>
        <div className="flex gap-2">
          {!isLastSection && (
            <Button
              variant="outline"
              onClick={() => setSectionIndex((i) => i + 1)}
              className="cursor-pointer gap-2"
            >
              Skip to next section
              <ChevronRight className="size-4" />
            </Button>
          )}
          <Button
            onClick={() => void onAbandon()}
            variant="ghost"
            className="cursor-pointer text-muted-foreground"
          >
            Exit exam
          </Button>
        </div>
      </div>
    );
  }

  const formattedRemaining = useMemo(() => {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [remainingSeconds]);

  const isLowTime = remainingSeconds <= 60;
  const currentQuestion = questions[questionIndex];
  const answeredCount = answers.filter((a) => a >= 0).length;
  const flaggedCount = flagged.filter(Boolean).length;
  const progressPct = Math.round((answeredCount / questions.length) * 100);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Top bar ── */}
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 transition-colors",
          isLowTime
            ? "border-rose-500/40 bg-rose-500/[0.08]"
            : "border-white/[0.06] bg-white/[0.02]",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <GraduationCap className="size-5" />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight text-foreground">
              Section {sectionIndex + 1} of {exam.sections.length} ·{" "}
              {subjectNames.get(currentSection.subjectId) ?? "Subject"}
            </p>
            <p className="text-xs text-muted-foreground">
              Mock exam · {exam.stream === "natural" ? "Natural" : "Social"} stream
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-xl px-4 py-2 font-mono text-base font-bold tabular-nums",
              isLowTime ? "bg-rose-500/20 text-rose-300" : "bg-white/5 text-foreground",
            )}
          >
            <Timer className={cn("size-4", isLowTime && "animate-pulse")} />
            {formattedRemaining}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (confirm("Abandon this mock exam? Your progress on this section will be lost.")) {
                void onAbandon();
              }
            }}
            className="cursor-pointer text-muted-foreground hover:text-rose-300"
          >
            <X className="size-4" /> Abandon
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSubmitSection(false)}
            disabled={submittingSection}
            className="cursor-pointer gap-2 border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
          >
            {submittingSection ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {isLastSection ? "Finish exam" : "Submit section"}
          </Button>
        </div>
      </div>

      {/* ── Body: question navigator + question ── */}
      <div className="relative flex min-h-[60vh] flex-1 gap-4">
        {/* Question navigator sidebar */}
        <aside className="hidden w-72 shrink-0 flex-col gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 md:flex">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Questions
            </p>
            <span className="font-mono text-[11px] text-muted-foreground">
              {answeredCount}/{questions.length}
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-emerald-400"
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <div className="grid grid-cols-6 gap-1.5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 24rem)" }}>
            {questions.map((_, i) => {
              const answered = answers[i] !== undefined && answers[i] >= 0;
              const isFlagged = flagged[i];
              const isCurrent = i === questionIndex;
              return (
                <button
                  key={i}
                  onClick={() => setQuestionIndex(i)}
                  className={cn(
                    "relative flex size-9 cursor-pointer items-center justify-center rounded-lg text-xs font-bold transition-all",
                    isCurrent
                      ? "bg-amber-400 text-amber-950"
                      : answered
                        ? "bg-emerald-400/20 text-emerald-300 hover:bg-emerald-400/30"
                        : "bg-white/5 text-muted-foreground hover:bg-white/10",
                  )}
                >
                  {i + 1}
                  {isFlagged && (
                    <Flag className="absolute -top-0.5 -right-0.5 size-2.5 text-amber-400 fill-amber-400" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-col gap-2 border-t border-white/[0.06] pt-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-emerald-400/20" /> Answered ({answeredCount})
            </div>
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-amber-400 fill-amber-400" /> Flagged ({flaggedCount})
            </div>
            <div className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm bg-white/5" /> Unanswered ({questions.length - answeredCount})
            </div>
          </div>
        </aside>

        {/* Question content */}
        <main className="flex-1 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8">
          <div className="mx-auto max-w-3xl">
            {/* Question number + flag toggle */}
            <div className="flex items-center justify-between">
              <p className="font-mono text-sm text-muted-foreground">
                Question {questionIndex + 1} of {questions.length}
              </p>
              <button
                onClick={() =>
                  setFlagged((f) => f.map((v, i) => (i === questionIndex ? !v : v)))
                }
                className="group flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-amber-400/30 hover:text-amber-300"
              >
                {flagged[questionIndex] ? (
                  <>
                    <Flag className="size-4 text-amber-400 fill-amber-400" />
                    <span className="font-semibold text-amber-300">Flagged</span>
                  </>
                ) : (
                  <>
                    <FlagOff className="size-4" />
                    <span>Flag for review</span>
                  </>
                )}
              </button>
            </div>

            {/* Question text */}
            <h2 className="mt-6 text-xl font-bold leading-relaxed text-foreground sm:text-2xl">
              {currentQuestion?.question}
            </h2>

            {/* Options */}
            <div className="mt-8 flex flex-col gap-3">
              {currentQuestion?.options.map((opt, i) => {
                const selected = answers[questionIndex] === i;
                return (
                  <button
                    key={i}
                    onClick={() =>
                      setAnswers((a) => a.map((v, idx) => (idx === questionIndex ? i : v)))
                    }
                    className={cn(
                      "flex cursor-pointer items-start gap-4 rounded-2xl border p-5 text-left transition-all",
                      selected
                        ? "border-amber-400/40 bg-amber-400/[0.08] shadow-[inset_0_0_0_1px_rgb(251,191,36/0.2)]"
                        : "border-white/10 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-bold",
                        selected
                          ? "bg-amber-400 text-amber-950"
                          : "bg-white/5 text-muted-foreground",
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="pt-1.5 text-base text-foreground">{opt}</span>
                  </button>
                );
              })}
            </div>

            {/* Footer: prev/next question */}
            <div className="mt-8 flex items-center justify-between border-t border-white/[0.06] pt-6">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                disabled={questionIndex === 0}
                className="cursor-pointer gap-1.5"
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <span className="font-mono text-xs text-muted-foreground">
                {answeredCount} / {questions.length} answered
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setQuestionIndex((i) => Math.min(questions.length - 1, i + 1))
                }
                disabled={questionIndex === questions.length - 1}
                className="cursor-pointer gap-1.5"
              >
                Next <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results screen
// ---------------------------------------------------------------------------

function ResultsScreen({
  exam,
  subjectNames,
  history,
  onRetake,
  onExit,
}: {
  exam: FullExam;
  subjectNames: Map<Id<"subjects">, string>;
  history: MockExamHistoryItem[];
  onRetake: () => void;
  onExit: () => void;
}) {
  const sectionResults = useMemo(() => {
    return exam.sections
      .filter((s) => s.status === "completed")
      .map((s) => ({
        subjectId: s.subjectId,
        subjectName: subjectNames.get(s.subjectId) ?? "Unknown",
        score: s.score ?? 0,
        correctCount: s.correctCount ?? 0,
        totalQuestions: s.totalQuestions ?? 0,
        timeSpentSeconds: s.timeSpentSeconds,
      }));
  }, [exam, subjectNames]);

  const totalScore = exam.totalScore ?? 0;
  const totalCorrect = sectionResults.reduce((sum, s) => sum + s.correctCount, 0);
  const totalQuestions = sectionResults.reduce((sum, s) => sum + s.totalQuestions, 0);
  const totalTimeSpent = sectionResults.reduce((sum, s) => sum + s.timeSpentSeconds, 0);

  const previousAttempts = history
    .filter((h) => h._id !== exam._id && h.status === "completed" && h.totalScore !== undefined)
    .sort((a, b) => b.startedAt - a.startedAt);
  const lastAttempt = previousAttempts[0];
  const scoreDelta = lastAttempt ? totalScore - (lastAttempt.totalScore ?? 0) : null;

  const tier =
    totalScore >= 85
      ? "excellent"
      : totalScore >= 70
        ? "strong"
        : totalScore >= 50
          ? "ok"
          : "needs_work";

  return (
    <div className="flex flex-col gap-6">
      {/* Hero header — celebratory tone */}
      <div
        className={cn(
          "relative overflow-hidden rounded-3xl border p-6 sm:p-8",
          tier === "excellent" && "border-emerald-400/30 bg-emerald-400/[0.04]",
          tier === "strong" && "border-amber-400/30 bg-amber-400/[0.04]",
          tier === "ok" && "border-sky-400/20 bg-sky-400/[0.03]",
          tier === "needs_work" && "border-rose-400/20 bg-rose-400/[0.03]",
        )}
      >
        <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // mock exam complete
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                {tier === "excellent" && "Outstanding work."}
                {tier === "strong" && "Solid performance."}
                {tier === "ok" && "Good start."}
                {tier === "needs_work" && "Keep going."}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {new Date(exam.startedAt).toLocaleDateString(undefined, {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                · {exam.stream === "natural" ? "Natural" : "Social"} stream ·{" "}
                {Math.floor(totalTimeSpent / 60)} min total
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Overall score
              </p>
              <p className="text-6xl font-extrabold text-gradient tabular-nums sm:text-7xl">
                {totalScore}%
              </p>
              {scoreDelta !== null && (
                <p
                  className={cn(
                    "mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold",
                    scoreDelta > 0
                      ? "bg-emerald-400/15 text-emerald-300"
                      : scoreDelta < 0
                        ? "bg-rose-400/15 text-rose-300"
                        : "bg-white/5 text-muted-foreground",
                  )}
                >
                  {scoreDelta > 0 && <TrendingUp className="size-3.5" />}
                  {scoreDelta > 0 && `+${scoreDelta}% vs your last mock`}
                  {scoreDelta < 0 && `${scoreDelta}% vs your last mock`}
                  {scoreDelta === 0 && "Same as your last mock"}
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 grid grid-cols-3 gap-3">
            <StatChip
              icon={<CheckCircle2 className="size-4 text-emerald-300" />}
              label="Correct"
              value={`${totalCorrect}/${totalQuestions}`}
            />
            <StatChip
              icon={<Clock className="size-4 text-amber-300" />}
              label="Time spent"
              value={`${Math.floor(totalTimeSpent / 60)} min`}
            />
            <StatChip
              icon={<TrendingUp className="size-4 text-primary" />}
              label="Sections done"
              value={`${sectionResults.length}/${exam.sections.length}`}
            />
          </div>
        </div>
      </div>

      {/* Per-subject breakdown */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          Per-subject breakdown
        </p>
        <div className="mt-4 flex flex-col gap-3">
          {sectionResults.map((s) => (
            <SubjectRow
              key={s.subjectId}
              name={s.subjectName}
              score={s.score}
              correct={s.correctCount}
              total={s.totalQuestions}
              timeSpent={s.timeSpentSeconds}
            />
          ))}
        </div>
      </div>

      {/* Previous attempts table */}
      {previousAttempts.length > 0 && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Progress over time
          </p>
          <div className="mt-4 flex flex-col gap-2.5">
            {previousAttempts.slice(0, 5).map((h) => (
              <div
                key={h._id}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                    <Trophy className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {new Date(h.startedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      · {h.stream === "natural" ? "Natural" : "Social"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {h.totalScore}% overall
                    </p>
                  </div>
                </div>
                <Link
                  to="/mock-exam"
                  onClick={() => window.scrollTo({ top: 0 })}
                  className="text-xs text-primary hover:underline"
                >
                  View
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onExit} className="cursor-pointer gap-2">
          <ArrowLeft className="size-4" /> Back to dashboard
        </Button>
        <Button
          onClick={onRetake}
          className="cursor-pointer gap-2 bg-amber-500 text-amber-950 hover:bg-amber-400"
        >
          <Sparkles className="size-4" /> Take another mock exam
        </Button>
      </div>
    </div>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex size-10 items-center justify-center rounded-xl bg-white/5">{icon}</div>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="font-mono text-lg font-bold text-foreground">{value}</p>
      </div>
    </div>
  );
}

function SubjectRow({
  name,
  score,
  correct,
  total,
  timeSpent,
}: {
  name: string;
  score: number;
  correct: number;
  total: number;
  timeSpent: number;
}) {
  const tone =
    score >= 85 ? "emerald" : score >= 70 ? "amber" : score >= 50 ? "primary" : "rose";
  return (
    <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-foreground">{name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {correct} of {total} correct · {Math.floor(timeSpent / 60)} min
        </p>
      </div>
      {/* Score bar */}
      <div className="hidden flex-1 sm:block">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-white/5">
          <motion.div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              tone === "emerald" && "bg-emerald-400",
              tone === "amber" && "bg-amber-400",
              tone === "primary" && "bg-primary",
              tone === "rose" && "bg-rose-400",
            )}
            initial={{ width: 0 }}
            animate={{ width: `${score}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          />
        </div>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "font-mono text-2xl font-bold tabular-nums",
            tone === "emerald" && "text-emerald-300",
            tone === "amber" && "text-amber-300",
            tone === "primary" && "text-primary",
            tone === "rose" && "text-rose-300",
          )}
        >
          {score}%
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Premium gate overlay
// ---------------------------------------------------------------------------

function PremiumGateOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="mx-auto max-w-md rounded-2xl border border-amber-400/30 bg-[#0b0f17] p-8 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
          <Crown className="size-8" />
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight">Premium feature</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          AI mock exams are a premium feature — they generate ~340 original
          questions per sitting, which takes real AI compute. Upgrade to unlock
          unlimited mock exams plus your full score history.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Button variant="ghost" onClick={onClose} className="cursor-pointer">
            Maybe later
          </Button>
          <Button asChild className="cursor-pointer gap-2 bg-amber-500 text-amber-950 hover:bg-amber-400">
            <Link to="/upgrade">
              <Crown className="size-4" /> Upgrade now
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// Suppress unused-import warnings for icons used only in conditional JSX.
void Award;
void FileText;
void Zap;
void ShieldCheck;
