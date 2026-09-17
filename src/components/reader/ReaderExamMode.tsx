// Exam Mode overlay for the Reader — a fullscreen, focused, timed past-exam
// PDF session. Pure UX wrapper: does NOT extract, alter, or restructure the
// underlying PDF content in any way. The student still reads the same PDF
// (via the same react-pdf pipeline), but with:
//
//   - The sidebar/nav chrome hidden
//   - A real countdown timer (configurable; default 50 min — sensible per-
//     subject duration given the 5h/6-subject EHEEE structure)
//   - No pausing (with a clear warning before starting)
//   - On submit/expiry: lock interaction, reveal it was a timed session,
//     optionally surface an answer-key PDF if one is linked
//   - Logs the session to studySessions + awards XP via the existing
//     logSession mutation (auth-derived, so it works from the client)
//
// The component receives the loaded PDF (Document + page state) as props
// rather than re-loading it, so we don't double-fetch the file.

import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Flag,
  Highlighter,
  LayoutGrid,
  ListChecks,
  Loader2,
  Play,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page as PdfPage } from "react-pdf";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { localDateKey } from "@/lib/dates";
import { XP_VALUES } from "@/convex/constants";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  HighlightsList,
  NavigatorSectionLabel,
  PagePalette,
  QuestionPalette,
  SlimProgress,
  TrackerModeToggle,
  emptyQuestionMap,
  entryOf,
  trackerStats,
  type QuestionMap,
  type SessionHighlights,
  type TrackerMode,
} from "@/components/reader/QuestionNavigator";

// "pdfjs" is configured by the parent Reader.tsx (worker URL etc.). We don't
// re-configure it here — we just reuse the Document/Page components.
// No PDFJS_OPTIONS are passed either — the Reader's setup uses pdf.js
// defaults, which is the safest path. (Earlier attempts to pass options
// caused regressions where rendering silently failed.)

export type AnswerKeyInfo = {
  _id: Id<"contentItems">;
  title: string;
  isPremium: boolean;
};

export type ExamModeProps = {
  // The loaded PDF data + page state from the parent Reader. We don't
  // duplicate the load — we reuse what the Reader already fetched.
  pdfData: ArrayBuffer | null;
  pdfUrl: string | null;
  numPages: number;
  // The content item's identity — used to log the study session.
  contentId: Id<"contentItems">;
  subjectId: Id<"subjects">;
  contentTitle: string;
  subjectName: string;
  // Optional answer-key content item, linked by the admin.
  answerKey: AnswerKeyInfo | null;
  // Configurable per-section duration in seconds. Default 50 min.
  durationSeconds?: number;
  onClose: () => void;
};

type ExamPhase = "warning" | "running" | "submitted";

// Question-count presets shown on the exam start screen. Ethiopian national
// papers vary (~65–110 per subject), so the student declares the count for
// their own tracker — we never invent question data for a scanned PDF.
const QUESTION_PRESETS = [25, 50, 75, 100];

export function ReaderExamMode(props: ExamModeProps) {
  const durationSeconds = props.durationSeconds ?? 50 * 60;
  const [phase, setPhase] = useState<ExamPhase>("warning");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [submitting, setSubmitting] = useState(false);

  // ── Session tracker (question palette + review flags + highlights) ──
  // Session-scoped by design: cross-session history lives in
  // examPrepAttempts, not here. Declaring the count is OPTIONAL — a student
  // can skip it and still get the page navigator + highlights.
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [countInput, setCountInput] = useState("");
  const [tracker, setTracker] = useState<QuestionMap>(emptyQuestionMap);
  const [trackerMode, setTrackerMode] = useState<TrackerMode>("answers");
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [highlights, setHighlights] = useState<SessionHighlights[]>([]);
  const [selectedInPdf, setSelectedInPdf] = useState<string | null>(null);

  const logSession = useMutation(api.studySessions.logSession);
  // Exam Prep Hub attempt log — records THAT a timed session happened on
  // this specific paper so My Results can aggregate it. Streak/XP credit
  // still flows through logSession above; this is purely per-paper history.
  const logExamPrepAttempt = useMutation(api.examPrep.logExamPrepAttempt);
  const rateExamPrepAttempt = useMutation(api.examPrep.rateExamPrepAttempt);
  const [loggedAttemptId, setLoggedAttemptId] = useState<Id<"examPrepAttempts"> | null>(null);
  const [selfScore, setSelfScore] = useState("");
  const [savingScore, setSavingScore] = useState(false);

  // Countdown ticker — fires every second while running.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "running" || startedAt === null) return;
    tickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsed);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        // Time's up — auto-submit.
        void handleSubmit(true);
      }
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, startedAt, durationSeconds]);

  const handleStart = () => {
    setStartedAt(Date.now());
    setRemainingSeconds(durationSeconds);
    setPhase("running");
  };

  const stats = trackerStats(tracker, questionCount ?? 0);

  // Progress semantics: question progress when a tracker exists (the real
  // exam metric), otherwise page position through the paper.
  const progressPct =
    questionCount !== null
      ? (stats.answered / questionCount) * 100
      : props.numPages > 0
        ? (pageNumber / props.numPages) * 100
        : 0;

  const toggleQuestion = (n: number) => {
    setActiveQuestion(n);
    setTracker((prev) => {
      const cur = entryOf(prev, n);
      const next =
        trackerMode === "flags"
          ? { ...cur, flagged: !cur.flagged }
          : { ...cur, answered: !cur.answered };
      return { ...prev, [n]: next };
    });
  };

  const addHighlight = (text: string) => {
    const entry: SessionHighlights = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text,
      page: pageNumber,
    };
    setHighlights((prev) => [...prev, entry]);
    setSelectedInPdf(null);
    window.getSelection()?.removeAllRanges();
    toast.success("Highlighted for this session.", {
      description: `Saved with page ${pageNumber} — find it in Navigate → Highlights.`,
    });
  };

  // Capture text selection inside the PDF while the exam is running —
  // the paper's text layer is enabled so students can highlight dense
  // word problems the way they would with a pencil on the real paper.
  useEffect(() => {
    if (phase !== "running") {
      setSelectedInPdf(null);
      return;
    }
    const capture = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setSelectedInPdf(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 5 || text.length > 2000) {
        setSelectedInPdf(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container =
        document.querySelector("[data-exam-pdf-view]") ??
        document.querySelector(".react-pdf__Page");
      if (container && container.contains(range.commonAncestorContainer)) {
        setSelectedInPdf(text);
      } else {
        setSelectedInPdf(null);
      }
    };
    document.addEventListener("selectionchange", capture);
    return () => document.removeEventListener("selectionchange", capture);
  }, [phase]);

  const handleSubmit = async (autoSubmitted: boolean = false) => {
    if (phase !== "running" || startedAt === null) return;
    if (tickRef.current) clearInterval(tickRef.current);
    setSubmitting(true);
    const endedAt = Date.now();
    const duration = Math.min(Math.floor((endedAt - startedAt) / 1000), durationSeconds);
    try {
      // Log as a focus session so it counts toward streaks + study history.
      // logSession awards XP itself ("focus_session" reason) — we accept
      // that reason here since the dedicated XP amount for exam-mode sessions
      // is the same shape. The session row + streak contribution is what
      // matters most.
      await logSession({
        subjectId: props.subjectId,
        durationSeconds: duration,
        startedAt,
        endedAt,
        localDate: localDateKey(new Date(startedAt)),
      });
      // Record the per-paper attempt for the Exam Prep Hub (best-effort —
      // a failure here must never block the student from self-grading).
      try {
        const result = await logExamPrepAttempt({
          contentId: props.contentId,
          startedAt,
          endedAt,
          durationSeconds: duration,
          completed: !autoSubmitted,
        });
        setLoggedAttemptId(result.attemptId);
      } catch {
        // Non-fatal — the hub simply won't show this session.
      }
      if (autoSubmitted) {
        toast.info("Time's up — exam session submitted.", {
          description: "Your focused study time has been logged. You can now self-grade.",
        });
      } else {
        toast.success("Exam session submitted.", {
          description: `${Math.floor(duration / 60)} min logged. You can now self-grade.`,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not log the session.");
      // Still proceed to the submitted phase — the timer expired, the
      // student has done the work. Logging failure shouldn't lock them out.
    } finally {
      setSubmitting(false);
      setPhase("submitted");
    }
  };

  // Self-grade: record the optional 0-100 score after checking the answer
  // key. One-shot — the backend rejects a second rating for the same attempt.
  const handleSaveScore = async () => {
    if (!loggedAttemptId || savingScore) return;
    const pct = Number(selfScore);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      toast.error("Enter a score between 0 and 100.");
      return;
    }
    setSavingScore(true);
    try {
      const result = await rateExamPrepAttempt({ attemptId: loggedAttemptId, selfScorePct: pct });
      if (result.alreadyRated) {
        toast.info("This attempt already has a score recorded.");
      } else {
        toast.success(`Score saved — ${Math.round(pct)}%. It now shows in your Exam Prep results.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the score.");
    } finally {
      setSavingScore(false);
    }
  };

  // Format remaining time as MM:SS or HH:MM:SS.
  const formattedRemaining = useMemo(() => {
    const h = Math.floor(remainingSeconds / 3600);
    const m = Math.floor((remainingSeconds % 3600) / 60);
    const s = remainingSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [remainingSeconds]);

  const isLowTime = remainingSeconds <= 60 && phase === "running";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#080c14]">
      {/* ─── Top bar: exam-conditions chrome (clinical, not warm) ─── */}
      <div
        className={cn(
          "shrink-0 border-b px-4 py-3 transition-colors",
          isLowTime
            ? "border-rose-500/40 bg-rose-500/[0.08]"
            : "border-white/10 bg-white/[0.02]",
        )}
      >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/5">
            <FileText className="size-4 text-foreground/80" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {props.contentTitle}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {props.subjectName} · exam conditions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {phase === "running" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 type-mono text-sm font-semibold tabular-nums",
                isLowTime ? "bg-rose-500/20 text-rose-300" : "bg-white/5 text-foreground",
              )}
            >
              <Timer className={cn("size-4", isLowTime && "animate-pulse")} />
              {formattedRemaining}
            </div>
          )}
          {phase === "running" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSubmit(false)}
              disabled={submitting}
              className="cursor-pointer gap-2 border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Submit
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={props.onClose}
              aria-label="Exit exam mode"
              className="size-9 rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>
      {/* Slim progress — how far through the paper this session is. */}
      <div className="px-4 pb-2">
        <SlimProgress value={progressPct} tone="amber" />
      </div>
      </div>

      {/* ─── Body ─── */}
      <div className="relative flex min-h-0 flex-1">
        {/* Warning phase */}
        {phase === "warning" && (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
              <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
                <AlertTriangle className="size-7" />
              </div>
              <h2 className="type-h2 text-foreground">Exam conditions</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                You're about to enter a timed, focused session that mirrors real
                exam conditions. The clock starts when you begin and{" "}
                <span className="font-semibold text-foreground">cannot be paused</span> —
                make sure you're ready.
              </p>
              <div className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-3 text-left text-xs">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" />
                    Duration
                  </div>
                  <p className="mt-1 type-mono text-sm font-semibold text-foreground">
                    {Math.floor(durationSeconds / 60)} min
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Timer className="size-3.5" />
                    Pausing
                  </div>
                  <p className="mt-1 type-mono text-sm font-semibold text-foreground">Disabled</p>
                </div>
              </div>
              {props.answerKey && (
                <div className="mx-auto mt-4 max-w-sm rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-left text-xs text-emerald-200/80">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                    <CheckCircle2 className="size-3.5" /> Answer key available
                  </div>
                  <p className="mt-1">
                    When you submit, you can self-grade against{" "}
                    <span className="font-semibold">{props.answerKey.title}</span>
                    {props.answerKey.isPremium && " (premium)"}.
                  </p>
                </div>
              )}

              {/* Question tracker setup (optional) — declares the count for
                  the in-session question palette + review flags. */}
              <div className="mx-auto mt-4 max-w-sm rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 text-left">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <ListChecks className="size-3.5 text-amber-300" />
                  Track your questions? <span className="font-normal text-muted-foreground">(optional)</span>
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  You get a question palette with review flags and a progress
                  bar. No feedback until you submit — real exam rules.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {QUESTION_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        setQuestionCount(p);
                        setCountInput("");
                      }}
                      aria-pressed={questionCount === p}
                      className={cn(
                        "cursor-pointer rounded-lg border px-2.5 py-1 type-mono text-xs font-semibold transition-colors",
                        questionCount === p
                          ? "border-amber-300/60 bg-amber-300/15 text-amber-200"
                          : "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/10",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                  <Input
                    value={countInput}
                    onChange={(e) => setCountInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                    placeholder="Other"
                    inputMode="numeric"
                    className="h-7 w-16 rounded-lg bg-white/5 text-center type-mono text-xs"
                  />
                  {countInput !== "" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setQuestionCount(Number(countInput))}
                      className="h-7 cursor-pointer rounded-lg px-2 text-xs"
                    >
                      Set
                    </Button>
                  )}
                  {questionCount !== null && (
                    <button
                      type="button"
                      onClick={() => setQuestionCount(null)}
                      className="cursor-pointer text-[11px] font-semibold text-muted-foreground/70 hover:text-muted-foreground"
                    >
                      Clear
                    </button>
                  )}
                </div>
                {questionCount !== null && (
                  <p className="mt-1.5 text-[11px] text-emerald-300/90">
                    Tracking {questionCount} questions.
                  </p>
                )}
              </div>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button
                  variant="ghost"
                  onClick={props.onClose}
                  className="cursor-pointer"
                >
                  Not yet
                </Button>
                <Button
                  onClick={handleStart}
                  className="cursor-pointer gap-2 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                >
                  <Play className="size-4" /> Begin exam
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Running / Submitted phase — PDF view */}
        {(phase === "running" || phase === "submitted") && (
          <>
            {/* Page toolbar */}
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-2 border-t border-white/[0.06] bg-[#080c14]/90 px-4 py-2 backdrop-blur">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1 || phase === "submitted"}
                  className="cursor-pointer"
                >
                  Prev
                </Button>
                <span className="type-mono text-xs text-muted-foreground">
                  {pageNumber} / {props.numPages || "?"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPageNumber((p) => Math.min(props.numPages, p + 1))}
                  disabled={pageNumber >= props.numPages || phase === "submitted"}
                  className="cursor-pointer"
                >
                  Next
                </Button>
                {/* Navigator — pages / question palette / session highlights */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNavigatorOpen((o) => !o)}
                  disabled={phase === "submitted"}
                  className="relative ml-1 cursor-pointer gap-1.5 rounded-lg border-amber-300/30 bg-amber-300/[0.07] text-amber-200 hover:bg-amber-300/20 hover:text-amber-100"
                >
                  <LayoutGrid className="size-3.5" /> Navigate
                  {stats.flagged > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-amber-400 type-mono text-[9px] font-bold text-black">
                      {stats.flagged}
                    </span>
                  )}
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
                  disabled={phase === "submitted"}
                  className="cursor-pointer"
                >
                  Zoom out
                </Button>
                <span className="type-mono text-xs text-muted-foreground">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
                  disabled={phase === "submitted"}
                  className="cursor-pointer"
                >
                  Zoom in
                </Button>
              </div>
            </div>

            {/* PDF */}
            <div
              data-lenis-prevent-wheel
              data-exam-pdf-view
              className={cn(
                "relative flex-1 overflow-auto bg-[#0b0f17] py-6 pb-20",
                phase === "submitted" && "pointer-events-none opacity-60",
              )}
            >
              <div className="mx-auto w-fit shadow-2xl">
                {props.pdfData ? (
                  <Document
                    file={{ data: props.pdfData }}
                    loading={
                      <div className="flex h-40 items-center justify-center">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    }
                    error={
                      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                        Could not render the PDF in exam mode.
                      </div>
                    }
                  >
                    <PdfPage
                      pageNumber={pageNumber}
                      scale={scale}
                      renderAnnotationLayer={false}
                      className="rounded-sm"
                    />
                  </Document>
                ) : props.pdfUrl ? (
                  <iframe
                    src={`${props.pdfUrl}#page=${pageNumber}&zoom=${Math.round(scale * 100)}`}
                    title="Exam PDF"
                    className="h-[80vh] w-[80vw] max-w-4xl rounded-md bg-white"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    PDF not loaded.
                  </div>
                )}
              </div>
            </div>

            {/* ─── Navigator sheet: pages · question palette · highlights ─── */}
            {navigatorOpen && phase === "running" && (
              <div className="absolute inset-y-0 right-0 z-20 flex w-[min(420px,100vw)] flex-col border-l border-white/10 bg-[#0b0f17]/97 backdrop-blur">
                <div className="flex shrink-0 items-center justify-between border-b border-white/[0.08] px-4 py-3">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    session navigator
                  </p>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setNavigatorOpen(false)}
                    aria-label="Close navigator"
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
                  <section className="flex flex-col gap-2">
                    <NavigatorSectionLabel icon={LayoutGrid}>Jump to page</NavigatorSectionLabel>
                    <PagePalette numPages={props.numPages} currentPage={pageNumber} onJump={setPageNumber} />
                  </section>

                  {questionCount !== null && (
                    <section className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <NavigatorSectionLabel icon={ListChecks}>
                          Questions · {stats.answered}/{questionCount}
                        </NavigatorSectionLabel>
                      </div>
                      <TrackerModeToggle mode={trackerMode} onModeChange={setTrackerMode} />
                      <QuestionPalette
                        questionCount={questionCount}
                        tracker={tracker}
                        mode={trackerMode}
                        activeQuestion={activeQuestion}
                        showChecks={false}
                        onToggle={toggleQuestion}
                      />
                      <p className="text-[10px] text-muted-foreground">
                        {trackerMode === "flags"
                          ? "Tap a number to flag it for review — the palette ring + Navigate badge count your flags."
                          : "Tap a number when you've answered it. Switch to “Review flags” to mark uncertain ones."}
                      </p>
                    </section>
                  )}

                  <section className="flex flex-col gap-2">
                    <NavigatorSectionLabel icon={Highlighter}>
                      Highlights · {highlights.length}
                    </NavigatorSectionLabel>
                    <HighlightsList highlights={highlights} onJump={setPageNumber} />
                  </section>
                </div>
              </div>
            )}

            {/* Floating highlight capture — selection in the paper while running */}
            {phase === "running" && selectedInPdf && !navigatorOpen && (
              <div className="absolute inset-x-0 bottom-16 z-30 flex justify-center px-4">
                <button
                  type="button"
                  onClick={() => addHighlight(selectedInPdf)}
                  className="flex max-w-full cursor-pointer items-center gap-2 rounded-full border border-amber-300/40 bg-[#0b0f17]/95 px-3.5 py-2 shadow-[0_10px_36px_-10px_rgba(251,191,36,0.5)] backdrop-blur transition-colors hover:bg-[#131a26]"
                >
                  <Highlighter className="size-3.5 shrink-0 text-amber-300" />
                  <span className="truncate text-xs text-foreground/90">
                    Highlight “{selectedInPdf.slice(0, 60)}
                    {selectedInPdf.length > 60 ? "…" : ""}”
                  </span>
                  <span className="type-mono shrink-0 text-[10px] font-bold text-amber-300">p.{pageNumber}</span>
                </button>
              </div>
            )}

            {/* Submitted overlay — reveals completion + answer key */}
            {phase === "submitted" && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#080c14]/85 backdrop-blur-sm">
                <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
                  <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
                    <CheckCircle2 className="size-7" />
                  </div>
                  <h2 className="type-h2 text-foreground">Session complete</h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    Your timed exam session has been logged as focused study
                    time. The PDF is now locked.
                  </p>
                  {props.answerKey ? (
                    <div className="mt-5">
                      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-left">
                        <p className="text-xs text-emerald-200/80">
                          <span className="font-semibold text-emerald-300">Self-grade now:</span>{" "}
                          open the answer key and compare your answers.
                        </p>
                        <a
                          href={`/read/${props.answerKey._id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-400/20"
                        >
                          <ExternalLink className="size-3.5" />
                          Open {props.answerKey.title}
                          {props.answerKey.isPremium && (
                            <Badge variant="outline" className="ml-1 text-[9px]">PREMIUM</Badge>
                          )}
                        </a>
                      </div>
                      {/* Self-score entry — one-shot, feeds the Exam Prep
                          Hub's My Results readiness picture. */}
                      {loggedAttemptId && (
                        <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left">
                          <p className="text-xs font-semibold text-foreground">
                            How did you score? <span className="font-normal text-muted-foreground">(optional)</span>
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <Input
                              value={selfScore}
                              onChange={(e) => setSelfScore(e.target.value.replace(/[^0-9]/g, ""))}
                              placeholder="0–100"
                              inputMode="numeric"
                              maxLength={3}
                              disabled={savingScore}
                              className="h-9 w-24 rounded-lg bg-white/5 text-center font-mono text-sm"
                            />
                            <Button
                              size="sm"
                              onClick={() => void handleSaveScore()}
                              disabled={savingScore || selfScore === ""}
                              className="cursor-pointer gap-1.5"
                            >
                              {savingScore ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                              Save score
                            </Button>
                          </div>
                          <p className="mt-1.5 text-[10px] text-muted-foreground">
                            Adds your result to the Exam Prep readiness picture — visible only to you.
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mx-auto mt-4 max-w-sm text-xs text-muted-foreground">
                      No answer key is linked to this past exam. Ask an admin to
                      upload the answer PDF and link it to this content item.
                    </p>
                  )}
                  <div className="mt-6">
                    <Button onClick={props.onClose} className="cursor-pointer gap-2">
                      <X className="size-4" /> Exit exam mode
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
