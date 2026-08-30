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
// Subject name lookup helper — the backend returns subjectId per section,
// the frontend maps it to a display name via the subjects query.
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
  }[]>([]);
  const [genCurrent, setGenCurrent] = useState<string>("");
  const [genError, setGenError] = useState<string | null>(null);

  const subjectNames = useSubjectNames();

  // User profile — for auto-detecting the stream
  const profile = useQuery(api.profile.getProfile);
  const userStream: "natural" | "social" | undefined =
    profile?.stream === "natural" || profile?.stream === "social" ? profile.stream : undefined;

  // Active exam data — fetch once we have an activeExamId
  const exam = useQuery(
    api.mockExam.getMyMockExam,
    activeExamId ? ({ mockExamId: activeExamId } as never) : "skip",
  );

  // Previous attempts — for the start screen + results comparison
  const history = useQuery(api.mockExam.getMyMockExams, {});

  // Auto-transition to "taking" once all sections are generated.
  // The generation loop in handleBegin sets genProgress; when it finishes,
  // we check that the exam has at least one section ready and move on.
  // The exam query will refresh with the new sections automatically.
  useEffect(() => {
    if (phase === "generating" && activeExamId && exam && genProgress.length > 0) {
      // Check if all sections have been processed (success or failure)
      // and at least one succeeded. The exam.sections array updates
      // automatically when the mutation commits.
      const successfulSections = genProgress.filter((p) => p.success);
      if (successfulSections.length > 0 && exam.sections.length > 0) {
        // Give it a moment to settle, then move to taking.
        const t = setTimeout(() => setPhase("taking"), 800);
        return () => clearTimeout(t);
      }
    }
  }, [phase, activeExamId, exam, genProgress]);

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
    try {
      // Step 1 — start the mock exam (creates the parent row + returns
      // the section plan).
      const start = (await startMockExam({ stream })) as {
        mockExamId: Id<"mockExams">;
        sections: { sectionIndex: number; subjectId: Id<"subjects">; subjectName: string; questionCount: number }[];
      };
      setActiveExamId(start.mockExamId);

      // Step 2 — generate each section sequentially via the split
      // generateSection action. We wait between sections to respect
      // Groq's TPM limit (8000/min on the free tier); each section is
      // ~7000 tokens, so we need ~52s of recovery before the next call.
      // The frontend shows real progress as each section is generated.
      const SECTION_DELAY_MS = 60000; // 60s
      const progress: typeof genProgress = [];
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
          };
          progress.push({
            sectionIndex: section.sectionIndex,
            subjectName: section.subjectName,
            success: result.success,
            reason: result.reason,
          });
          setGenProgress([...progress]);
          if (!result.success) {
            toast.warning(`${section.subjectName} section failed: ${result.reason ?? "unknown"}`, {
              duration: 6000,
            });
          }
        } catch (err) {
          // Section failed entirely — record and continue. The exam is
          // still usable with the other sections.
          progress.push({
            sectionIndex: section.sectionIndex,
            subjectName: section.subjectName,
            success: false,
            reason: err instanceof Error ? err.message : "unknown",
          });
          setGenProgress([...progress]);
        }
        // Throttle between sections (skip after the last one).
        if (i < start.sections.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, SECTION_DELAY_MS));
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
          `${failed} section(s) failed to generate. You can take the remaining ${successful}.`,
          { duration: 6000 },
        );
      } else {
        toast.success(`Mock exam ready — all ${successful} sections generated.`);
      }
      // The useEffect above will transition to "taking" once the exam
      // query refreshes with the new sections.
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Generation failed.";
      const data = (error as { data?: { code?: string } })?.data;
      if (data?.code === "premium_mock_exams" || msg.toLowerCase().includes("premium")) {
        setGenError("premium");
      } else {
        setGenError(msg);
      }
      setPhase("start");
    }
  };

  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-5xl">
        {phase === "start" && (
          <StartScreen
            userStream={userStream}
            history={history ?? []}
            onBegin={handleBegin}
            onOpenHistory={(id) => {
              setActiveExamId(id);
              setPhase("results");
            }}
          />
        )}
        {phase === "generating" && (
          <GeneratingScreen progress={genProgress} current={genCurrent} />
        )}
        {phase === "taking" && exam && (
          <TakingScreen
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
        )}
        {phase === "start" && genError === "premium" && (
          <PremiumGateOverlay onClose={() => setGenError(null)} />
        )}
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Start screen
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
  const lastAttempt = completedAttempts[0]; // history is most-recent-first

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <p className="type-mono uppercase tracking-[0.22em] text-amber-300 font-semibold">
          // national exam simulation
        </p>
        <h1 className="type-h1 mt-2">
          Mock <span className="text-gradient">Exam</span>
        </h1>
        <p className="type-body-lg mt-2 max-w-2xl text-muted-foreground">
          A complete simulated EHEEE sitting — six sections, ~340 original AI-generated
          questions, ~5 hours. Every question is written fresh by our model from the real
          curriculum, never copied from a past paper. Built for serious readiness.
        </p>
      </div>

      {/* Real exam format card */}
      <div className="glass-panel grid grid-cols-2 gap-4 rounded-2xl p-5 sm:grid-cols-4 sm:p-6">
        <FormatStat label="Sections" value="6" hint="English · Math · Aptitude · 3 stream subjects" />
        <FormatStat label="Questions" value="~340" hint="50 per section (Aptitude: 40)" />
        <FormatStat label="Duration" value="~5h" hint="50 min per section, no pausing" />
        <FormatStat label="Format" value="CBT" hint="Computer-based, like the real exam" />
      </div>

      {/* Stream picker */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6">
        <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Step 1 · Pick your stream
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StreamOption
            active={stream === "natural"}
            onClick={() => setStream("natural")}
            title="Natural science"
            subjects="Physics · Chemistry · Biology"
            tone="emerald"
          />
          <StreamOption
            active={stream === "social"}
            onClick={() => setStream("social")}
            title="Social science"
            subjects="History · Geography · Economics"
            tone="amber"
          />
        </div>
        {userStream && (
          <p className="mt-3 text-xs text-muted-foreground">
            Auto-detected from your profile ({userStream === "natural" ? "Natural" : "Social"} stream) —
            change if you want to practice the other track.
          </p>
        )}
      </div>

      {/* Commitment step */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6">
        <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Step 2 · Commit
        </p>
        <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4">
          <AlertTriangle className="size-5 shrink-0 text-amber-300" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Once you begin, the timer cannot be paused.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              You&apos;ll have 50 minutes per section. When a section&apos;s timer expires, it
              auto-submits and you can&apos;t go back. Make sure you have ~5 hours of
              uninterrupted focus before starting.
            </p>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="size-4 rounded border-white/20 bg-white/5"
              />
              I understand — I&apos;m ready to begin the full mock exam.
            </label>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button
            onClick={() => onBegin(stream)}
            disabled={!confirmed}
            className="cursor-pointer gap-2 bg-amber-500 text-amber-950 hover:bg-amber-400 disabled:opacity-40"
            size="lg"
          >
            <Play className="size-4" /> Begin mock exam
          </Button>
        </div>
      </div>

      {/* Previous attempts */}
      {completedAttempts.length > 0 && (
        <div className="glass-panel rounded-2xl p-5 sm:p-6">
          <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Your previous attempts
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {completedAttempts.slice(0, 5).map((h) => (
              <button
                key={h._id}
                onClick={() => onOpenHistory(h._id)}
                className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Trophy className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {new Date(h.startedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      · {h.stream === "natural" ? "Natural" : "Social"} stream
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Click to view full breakdown
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="type-mono text-lg font-bold text-foreground">
                    {h.totalScore}%
                  </span>
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FormatStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className="type-h2 font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function StreamOption({
  active,
  onClick,
  title,
  subjects,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subjects: string;
  tone: "emerald" | "amber";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer flex-col gap-1.5 rounded-xl border p-4 text-left transition-all",
        active
          ? tone === "emerald"
            ? "border-emerald-400/40 bg-emerald-400/[0.08]"
            : "border-amber-400/40 bg-amber-400/[0.08]"
          : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {active && (
          <CheckCircle2
            className={cn(
              "size-4",
              tone === "emerald" ? "text-emerald-300" : "text-amber-300",
            )}
          />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{subjects}</p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Generating screen — shown while the AI builds the 6 sections sequentially.
// Shows real progress as each section completes (success or failure) and
// which subject is currently being generated. The student gets feedback
// that something is happening, not just a spinner.
// ---------------------------------------------------------------------------

function GeneratingScreen({
  progress,
  current,
}: {
  progress: { sectionIndex: number; subjectName: string; success: boolean; reason?: string }[];
  current: string;
}) {
  const total = 6;
  const done = progress.length;
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-12">
      <div className="relative flex size-20 items-center justify-center">
        <div className="absolute inset-0 rounded-full bg-amber-400/20 blur-2xl animate-pulse" />
        <Loader2 className="size-10 animate-spin text-amber-300" />
      </div>
      <div className="text-center">
        <p className="type-mono uppercase tracking-[0.22em] text-amber-300 font-semibold">
          // generating your mock exam
        </p>
        <h2 className="type-h1 mt-2">
          {current ? `Building ${current}…` : "Building 6 sections of original questions"}
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          The AI writes ~340 fresh multiple-choice questions grounded in the
          Ethiopian curriculum — one section at a time. Each section takes
          ~15s, plus a brief pause between sections to respect rate limits.
          This typically takes ~6 minutes total. Please keep this tab open.
        </p>
      </div>

      {/* Progress list */}
      <div className="w-full max-w-md">
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span className="type-mono">
            {done} / {total}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: total }, (_, i) => {
            const item = progress[i];
            if (!item) {
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground"
                >
                  <Loader2 className={cn("size-3.5", i === done ? "animate-spin text-amber-300" : "opacity-30")} />
                  <span>Section {i + 1} — {i === done ? (current || "pending…") : "pending"}</span>
                </div>
              );
            }
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
                  item.success
                    ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-200"
                    : "border-rose-400/20 bg-rose-400/[0.06] text-rose-200",
                )}
              >
                {item.success ? (
                  <CheckCircle2 className="size-3.5 text-emerald-300" />
                ) : (
                  <X className="size-3.5 text-rose-300" />
                )}
                <span>
                  {item.subjectName} — {item.success ? "ready" : "failed"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Taking screen — the exam itself, section by section
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
          // Time's up — auto-submit the section.
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
    if (now - lastSaveRef.current < 5000) return; // throttle
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
      // silent — auto-save failures are non-fatal
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
      // If this was the last section, complete the whole exam.
      if (isLastSection) {
        await completeMockExam({ mockExamId: exam._id });
        toast.success("Mock exam complete! Loading your results…");
      } else {
        // Advance to the next section.
        setSectionIndex((i) => i + 1);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit section.");
      // Stay on the current section so the student can retry.
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

  // Format remaining time
  const formattedRemaining = useMemo(() => {
    const m = Math.floor(remainingSeconds / 60);
    const s = remainingSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [remainingSeconds]);

  const isLowTime = remainingSeconds <= 60;
  const currentQuestion = questions[questionIndex];
  const answeredCount = answers.filter((a) => a >= 0).length;
  const flaggedCount = flagged.filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080c14]">
      {/* ── Top bar ── */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between border-b px-4 py-3 transition-colors",
          isLowTime ? "border-rose-500/40 bg-rose-500/[0.08]" : "border-white/10 bg-white/[0.02]",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/5">
            <GraduationCap className="size-4 text-foreground/80" />
          </div>
          <div>
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              Section {sectionIndex + 1} of {exam.sections.length} ·{" "}
              {subjectNames.get(currentSection.subjectId) ?? "Subject"}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Mock exam · {exam.stream === "natural" ? "Natural" : "Social"} stream
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 type-mono text-sm font-semibold tabular-nums",
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
            <X className="size-3.5" /> Abandon
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSubmitSection(false)}
            disabled={submittingSection}
            className="cursor-pointer gap-2 border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
          >
            {submittingSection ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="size-3.5" />
            )}
            {isLastSection ? "Finish exam" : "Submit section"}
          </Button>
        </div>
      </div>

      {/* ── Body: question navigator + question ── */}
      <div className="relative flex min-h-0 flex-1">
        {/* Question navigator sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-white/[0.06] bg-[#0b0f17] p-3 overflow-y-auto md:block">
          <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground px-1 mb-2">
            Questions
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {questions.map((_, i) => {
              const answered = answers[i] !== undefined && answers[i] >= 0;
              const isFlagged = flagged[i];
              const isCurrent = i === questionIndex;
              return (
                <button
                  key={i}
                  onClick={() => setQuestionIndex(i)}
                  className={cn(
                    "relative flex size-8 cursor-pointer items-center justify-center rounded-md text-[11px] font-medium transition-all",
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
          <div className="mt-4 flex flex-col gap-2 border-t border-white/[0.06] pt-3 text-[10px] text-muted-foreground">
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
        <main className="flex-1 overflow-y-auto bg-[#0b0f17] p-6" data-lenis-prevent-wheel>
          <div className="mx-auto max-w-2xl">
            {/* Question number + flag toggle */}
            <div className="flex items-center justify-between">
              <p className="type-mono text-xs text-muted-foreground">
                Question {questionIndex + 1} of {questions.length}
              </p>
              <button
                onClick={() =>
                  setFlagged((f) => f.map((v, i) => (i === questionIndex ? !v : v)))
                }
                className="group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-amber-300"
              >
                {flagged[questionIndex] ? (
                  <>
                    <Flag className="size-3.5 text-amber-400 fill-amber-400" />
                    <span className="text-amber-300">Flagged</span>
                  </>
                ) : (
                  <>
                    <FlagOff className="size-3.5" />
                    <span>Flag for review</span>
                  </>
                )}
              </button>
            </div>

            {/* Question text */}
            <h2 className="type-h2 mt-4 text-foreground">{currentQuestion?.question}</h2>

            {/* Options */}
            <div className="mt-6 flex flex-col gap-2.5">
              {currentQuestion?.options.map((opt, i) => {
                const selected = answers[questionIndex] === i;
                return (
                  <button
                    key={i}
                    onClick={() =>
                      setAnswers((a) => a.map((v, idx) => (idx === questionIndex ? i : v)))
                    }
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-all",
                      selected
                        ? "border-amber-400/40 bg-amber-400/[0.08] text-foreground"
                        : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04] text-foreground/90",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full type-mono text-xs font-semibold",
                        selected
                          ? "bg-amber-400 text-amber-950"
                          : "bg-white/5 text-muted-foreground",
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="text-sm">{opt}</span>
                  </button>
                );
              })}
            </div>

            {/* Footer: prev/next question */}
            <div className="mt-8 flex items-center justify-between border-t border-white/[0.06] pt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setQuestionIndex((i) => Math.max(0, i - 1))}
                disabled={questionIndex === 0}
                className="cursor-pointer"
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <span className="type-mono text-xs text-muted-foreground">
                {answeredCount} / {questions.length} answered
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setQuestionIndex((i) => Math.min(questions.length - 1, i + 1))
                }
                disabled={questionIndex === questions.length - 1}
                className="cursor-pointer"
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
// Results screen — per-subject breakdown + comparison to previous attempts
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
  // Parse section results from the exam
  const sectionResults = useMemo(() => {
    // For an in-progress exam (e.g. one we opened from history that's actually
    // still in_progress — edge case), use the live sections data.
    if (exam.status !== "completed" || !exam.totalScore === undefined) {
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
    }
    // For a completed exam, the breakdown is in sectionResults JSON (computed
    // by completeMockExam). But we also have the live sections — use those
    // since they have the same data and are already typed.
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

  // Comparison to previous attempts (excluding this one)
  const previousAttempts = history
    .filter((h) => h._id !== exam._id && h.status === "completed" && h.totalScore !== undefined)
    .sort((a, b) => b.startedAt - a.startedAt); // most recent first
  const lastAttempt = previousAttempts[0];
  const scoreDelta = lastAttempt ? totalScore - (lastAttempt.totalScore ?? 0) : null;

  // Score tier — drives the visual celebration level
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
          "glass-panel relative overflow-hidden rounded-3xl p-6 sm:p-8",
          tier === "excellent" && "border-emerald-400/30",
          tier === "strong" && "border-amber-400/30",
        )}
      >
        <div className="pointer-events-none absolute -left-20 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 size-72 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="relative">
          <p className="type-mono uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // mock exam complete
          </p>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="type-h1 text-foreground">
                {tier === "excellent" && "Outstanding work."}
                {tier === "strong" && "Solid performance."}
                {tier === "ok" && "Good start."}
                {tier === "needs_work" && "Keep going."}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
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
              <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Overall score
              </p>
              <p className="text-6xl font-bold text-gradient tabular-nums">
                {totalScore}%
              </p>
              {scoreDelta !== null && (
                <p
                  className={cn(
                    "mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                    scoreDelta > 0
                      ? "bg-emerald-400/15 text-emerald-300"
                      : scoreDelta < 0
                        ? "bg-rose-400/15 text-rose-300"
                        : "bg-white/5 text-muted-foreground",
                  )}
                >
                  {scoreDelta > 0 && <TrendingUp className="size-3" />}
                  {scoreDelta > 0 && `+${scoreDelta}% vs your last mock`}
                  {scoreDelta < 0 && `${scoreDelta}% vs your last mock`}
                  {scoreDelta === 0 && "Same as your last mock"}
                </p>
              )}
            </div>
          </div>

          {/* Quick stats */}
          <div className="mt-6 grid grid-cols-3 gap-3">
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
      <div className="glass-panel rounded-2xl p-5 sm:p-6">
        <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
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
        <div className="glass-panel rounded-2xl p-5 sm:p-6">
          <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Progress over time
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {previousAttempts.slice(0, 5).map((h) => (
              <div
                key={h._id}
                className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-white/5 text-muted-foreground">
                    <Trophy className="size-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      {new Date(h.startedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}{" "}
                      · {h.stream === "natural" ? "Natural" : "Social"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
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
          <ArrowLeft className="size-4" /> Back to library
        </Button>
        <Button onClick={onRetake} className="cursor-pointer gap-2 bg-amber-500 text-amber-950 hover:bg-amber-400">
          <Sparkles className="size-4" /> Take another mock exam
        </Button>
      </div>
    </div>
  );
}

function StatChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-white/5">{icon}</div>
      <div>
        <p className="type-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <p className="type-mono text-sm font-bold text-foreground">{value}</p>
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
    <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="text-[10px] text-muted-foreground">
          {correct} of {total} correct · {Math.floor(timeSpent / 60)} min
        </p>
      </div>
      {/* Score bar */}
      <div className="hidden flex-1 sm:block">
        <div className="relative h-2 overflow-hidden rounded-full bg-white/5">
          <div
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              tone === "emerald" && "bg-emerald-400",
              tone === "amber" && "bg-amber-400",
              tone === "primary" && "bg-primary",
              tone === "rose" && "bg-rose-400",
            )}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      <div className="text-right">
        <p
          className={cn(
            "type-mono text-lg font-bold tabular-nums",
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
// Premium gate overlay — shown if generateMockExam throws premium_mock_exams
// ---------------------------------------------------------------------------

function PremiumGateOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="mx-auto max-w-md rounded-2xl border border-amber-400/30 bg-[#0b0f17] p-6 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
          <Crown className="size-7" />
        </div>
        <h2 className="type-h2 text-foreground">Premium feature</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
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
