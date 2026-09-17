// DigitalExamPlayer — the fully digital exam experience. V2.
//
// One player, two honest modes:
//   • Practice — untimed (elapsed clock + "No time limit"), per-question
//     "Check answer" with instant feedback + explanation (one honest check
//     per question), everything else identical.
//   • Exam — wall-clock countdown that CANNOT be paused, zero feedback
//     until submit, pre-submit review, auto-submit when the clock hits
//     zero. Unanswered questions count as wrong, like the real sitting.
//
// V2 additions:
//   • REPORT: students flag a broken question straight from the card —
//     reports land in the Exam Engine console. (Trust badges are
//     deliberately NOT shown to students — quality control is silent.)
//   • STRUCTURED questions (no options / workout / show-that): typed
//     answers, Practice reveals the paper's own suggested answer for
//     self-checking, Exam saves the written work. Never auto-scored —
//     the results screen says so honestly.
//   • ORIGINAL PAGE: every question carries its source page — a tap shows
//     the real PDF page (figures, tables, maps are never silently lost).
//   • ACCESSIBILITY: adjustable text size (persisted), full keyboard
//     operation (1-8 options, ←/→ nav, F flag, N navigator, R read-aloud,
//     +/- text size, ? help), timer uses role="timer".
//   • Read-aloud is STRICTLY OPT-IN: it never starts by itself — the
//     student taps the speaker (or presses R) when they want it. Speed
//     lives in the navigator; sentence highlighting included; navigator
//     with state colors; flag-for-review; session highlights; slim
//     progress bar; keyboard ←/→; real persistence to examPrepAttempts +
//     studySessions (best-effort — a logging failure never blocks the
//     results screen).
//
// All copy is original. Learnyx dark/gold cinematic system throughout.

import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  FlagOff,
  Highlighter,
  Info,
  Lightbulb,
  ListChecks,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  Square,
  Timer,
  Volume2,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useReadAloud } from "@/hooks/useReadAloud";
import { splitSentences } from "@/lib/pdfText";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  OriginalPageButton,
  ReportIssueButton,
  ShortcutsDialog,
  type ReportState,
} from "./DigitalExamPlayerParts";

// ─── Types ───────────────────────────────────────────────────────────────

export interface DigitalQuestion {
  number: number;
  kind?: "mcq" | "structured";
  text: string;
  passage?: string;
  options: { label: string; text: string }[];
  answer?: string;
  suggestedAnswer?: string;
  explanation?: string;
  topic?: string;
  sourcePage?: number;
  figureHint?: boolean;
}

export type ExamMode = "practice" | "exam";

interface Highlight {
  questionNumber: number;
  text: string;
}

interface DigitalExamPlayerProps {
  contentId: string;
  subjectId: string;
  paperTitle: string;
  subjectName: string;
  grade: number;
  examYear: number | null;
  durationMinutes: number;
  mode: ExamMode;
  questions: DigitalQuestion[];
  /** Session-resolved PDF url — powers the original-page viewer. */
  pdfUrl?: string | null;
  pageCount?: number | null;
}

// ─── Small helpers ───────────────────────────────────────────────────────

function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtElapsedLong(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const isStructured = (q: DigitalQuestion) =>
  q.kind === "structured" || q.options.length === 0;

// ─── Spoken-text sentence highlighting ───────────────────────────────────

/**
 * Renders text as sentence spans; the sentence currently being spoken is
 * highlighted gold. Uses the SAME splitSentences as the TTS queue, so the
 * highlight always tracks the audio exactly.
 */
function SentenceText({
  text,
  activeSentence,
  className,
  style,
}: {
  text: string;
  activeSentence: number | null;
  className?: string;
  style?: React.CSSProperties;
}) {
  const sentences = useMemo(() => splitSentences(text), [text]);
  return (
    <span className={className} style={style}>
      {sentences.map((s, i) => (
        <span
          key={`${i}-${s.slice(0, 8)}`}
          className={cn(
            "rounded-sm transition-colors duration-200",
            activeSentence === i && "box-decoration-clone bg-amber-400/25 text-amber-100",
          )}
        >
          {s}{" "}
        </span>
      ))}
    </span>
  );
}

// ─── Score ring (results screen) ─────────────────────────────────────────

function ScoreRing({ pct, tone }: { pct: number; tone: string }) {
  const R = 64;
  const C = 2 * Math.PI * R;
  return (
    <div className="relative size-40 shrink-0">
      <svg viewBox="0 0 160 160" className="size-full -rotate-90">
        <circle cx="80" cy="80" r={R} fill="none" strokeWidth="10" className="stroke-white/10" />
        <motion.circle
          cx="80"
          cy="80"
          r={R}
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={tone}
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C - (C * Math.max(0, Math.min(100, pct))) / 100 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="type-h1 text-gradient">{pct}%</span>
      </div>
    </div>
  );
}

// ─── Option button ───────────────────────────────────────────────────────

function OptionButton({
  label,
  text,
  selected,
  state, // "idle" | "correct" | "wrong" | "dim" (practice reveals)
  disabled,
  onSelect,
  style,
}: {
  label: string;
  text: string;
  selected: boolean;
  state: "idle" | "correct" | "wrong" | "dim";
  disabled: boolean;
  onSelect: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      style={style}
      className={cn(
        "interactive-press group flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition",
        state === "idle" &&
          (selected
            ? "border-amber-400/60 bg-amber-400/[0.10] shadow-[0_0_0_1px_rgba(251,191,36,0.35)]"
            : "border-white/10 bg-white/[0.03] hover:border-amber-400/30 hover:bg-white/[0.06]"),
        state === "correct" && "border-emerald-400/60 bg-emerald-400/[0.12]",
        state === "wrong" && "border-rose-400/60 bg-rose-400/[0.12]",
        state === "dim" && "border-white/5 bg-white/[0.02] opacity-50",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-xl text-sm font-black transition",
          state === "idle" &&
            (selected
              ? "bg-amber-400 text-black"
              : "bg-white/10 text-muted-foreground group-hover:bg-amber-400/20 group-hover:text-amber-200"),
          state === "correct" && "bg-emerald-400 text-black",
          state === "wrong" && "bg-rose-400 text-black",
          state === "dim" && "bg-white/5 text-muted-foreground",
        )}
      >
        {state === "correct" ? <Check className="size-4" /> : state === "wrong" ? <X className="size-4" /> : label}
      </span>
      <span className="min-w-0 pt-1 leading-relaxed text-foreground/90" style={{ fontSize: "0.9rem" }}>
        {text}
      </span>
    </button>
  );
}

// ─── Question palette (navigator) ────────────────────────────────────────

type QState = "unanswered" | "answered" | "flagged";

function paletteTileClass(state: QState, active: boolean): string {
  return cn(
    "relative flex size-9 items-center justify-center rounded-xl border text-xs font-bold tabular-nums transition",
    state === "unanswered" && "border-white/10 bg-white/[0.04] text-muted-foreground hover:border-white/25",
    state === "answered" && "border-emerald-400/40 bg-emerald-400/[0.12] text-emerald-200 hover:border-emerald-400/70",
    state === "flagged" && "border-amber-400/50 bg-amber-400/[0.12] text-amber-200 hover:border-amber-400/80",
    active && "ring-2 ring-amber-300/70 ring-offset-2 ring-offset-background",
  );
}

function NavigatorBody({
  questions,
  answers,
  structuredAnswers,
  flagged,
  currentIdx,
  highlights,
  onJump,
  onSpeakCurrent,
  readAloudSupported,
  rate,
  onRateChange,
  onRemoveHighlight,
  fontScale,
  onFontScale,
}: {
  questions: DigitalQuestion[];
  answers: Record<number, string | null>;
  structuredAnswers: Record<number, string>;
  flagged: Record<number, boolean>;
  currentIdx: number;
  highlights: Highlight[];
  onJump: (idx: number) => void;
  onSpeakCurrent: () => void;
  readAloudSupported: boolean;
  rate: number;
  onRateChange: (r: number) => void;
  onRemoveHighlight: (h: Highlight) => void;
  fontScale: number;
  onFontScale: (v: number) => void;
}) {
  const isAnswered = (n: number) =>
    Boolean(answers[n]) || (structuredAnswers[n]?.trim().length ?? 0) > 0;
  const answeredCount = questions.filter((q) => isAnswered(q.number)).length;
  const flaggedCount = questions.filter((q) => flagged[q.number]).length;

  const stateOf = (q: DigitalQuestion): QState => {
    if (flagged[q.number]) return "flagged";
    if (isAnswered(q.number)) return "answered";
    return "unanswered";
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Legend + counts */}
      <div className="flex flex-wrap items-center gap-2 type-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-emerald-400" /> {answeredCount} answered
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-amber-400" /> {flaggedCount} flagged
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-white/30" /> {questions.length - answeredCount} unanswered
        </span>
      </div>

      {/* Jump grid */}
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-8 xl:grid-cols-5">
        {questions.map((q, idx) => (
          <button
            key={q.number}
            type="button"
            onClick={() => onJump(idx)}
            className={paletteTileClass(stateOf(q), idx === currentIdx)}
            aria-label={`Question ${q.number} — ${stateOf(q)}`}
          >
            {q.number}
            {flagged[q.number] && (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-400" />
            )}
          </button>
        ))}
      </div>

      {/* Text size (accessibility) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="inline-flex items-center gap-1.5 type-caption font-bold text-foreground/80">
          <PenLine className="size-3.5 text-emerald-300" /> Text size
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onFontScale(Math.max(0.85, Math.round((fontScale - 0.1) * 100) / 100))}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 type-caption font-black text-muted-foreground hover:border-white/25"
            aria-label="Smaller text"
          >
            A−
          </button>
          <span className="min-w-10 text-center type-caption font-bold tabular-nums text-foreground/70">
            {Math.round(fontScale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => onFontScale(Math.min(1.6, Math.round((fontScale + 0.1) * 100) / 100))}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1 type-caption font-black text-muted-foreground hover:border-white/25"
            aria-label="Larger text"
          >
            A+
          </button>
        </div>
      </div>

      {/* Read-aloud controls — strictly on-demand: speech starts only when
          the student presses the button (or the speaker / R key on a
          question). Nothing here can ever start audio by itself. */}
      {readAloudSupported && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 type-caption font-bold text-foreground/80">
              <Volume2 className="size-3.5 text-amber-300" /> Read aloud
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={onSpeakCurrent}
              className="h-7 gap-1.5 rounded-lg border-white/15 px-2 type-caption font-bold"
            >
              <Volume2 className="size-3" /> Read this question
            </Button>
          </div>
          <p className="mt-1.5 type-caption text-muted-foreground/70">
            Off until you start it — tap the speaker on any question or press R.
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            {[0.75, 1, 1.25].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => onRateChange(r)}
                className={cn(
                  "rounded-lg border px-2 py-0.5 type-caption font-bold transition",
                  rate === r
                    ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/25",
                )}
              >
                {r}×
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Session highlights */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <p className="inline-flex items-center gap-1.5 type-caption font-bold text-foreground/80">
          <Highlighter className="size-3.5 text-sky-300" /> Highlights ({highlights.length})
        </p>
        {highlights.length === 0 ? (
          <p className="mt-1.5 type-caption text-muted-foreground/70">
            Select any text in a question, then tap the highlight button that appears.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {highlights.map((h, i) => (
              <div
                key={`${h.questionNumber}-${i}`}
                className="flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-2.5 py-1.5"
              >
                <button
                  type="button"
                  onClick={() => onJump(Math.max(0, questions.findIndex((qq) => qq.number === h.questionNumber)))}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="type-caption font-bold text-sky-300">Q{h.questionNumber}</span>
                  <span className="ml-2 line-clamp-1 type-caption text-foreground/70">“{h.text}”</span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveHighlight(h)}
                  aria-label="Remove highlight"
                  className="text-muted-foreground/50 transition hover:text-rose-300"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Read-aloud transport (floating mini-controls while speaking) ────────

function ReadAloudTransport({
  speaking,
  paused,
  onStop,
  onPause,
  onResume,
}: {
  speaking: boolean;
  paused: boolean;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  if (!speaking) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      className="pointer-events-auto fixed bottom-24 left-1/2 z-40 -translate-x-1/2 xl:bottom-6 xl:left-auto xl:right-6 xl:translate-x-0"
    >
      <div className="flex items-center gap-1.5 rounded-2xl border border-amber-400/30 bg-background/95 p-1.5 shadow-2xl backdrop-blur">
        <span className="flex items-center gap-1.5 pl-2 pr-1 type-caption font-bold text-amber-200">
          <Volume2 className="size-3.5" /> {paused ? "Paused" : "Reading"}
        </span>
        {paused ? (
          <Button size="sm" variant="ghost" onClick={onResume} className="size-8 rounded-xl p-0">
            <Play className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onPause} className="size-8 rounded-xl p-0">
            <Pause className="size-4" />
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onStop} className="size-8 rounded-xl p-0 text-rose-300 hover:text-rose-200">
          <Square className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Main player
// ═════════════════════════════════════════════════════════════════════════

export function DigitalExamPlayer({
  contentId,
  subjectId,
  paperTitle,
  subjectName,
  grade,
  examYear,
  durationMinutes,
  mode,
  questions,
  pdfUrl = null,
  pageCount = null,
}: DigitalExamPlayerProps) {
  const navigate = useNavigate();
  const readAloud = useReadAloud();
  const logDigitalAttempt = useMutation(api.examPrepDigital.logDigitalAttempt);
  const logSession = useMutation(api.studySessions.logSession);

  // ── Session state ──
  const [phase, setPhase] = useState<"rules" | "playing" | "finished">(mode === "exam" ? "rules" : "playing");
  const [startedAt, setStartedAt] = useState<number>(() => Date.now());
  const [now, setNow] = useState<number>(() => Date.now());
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string | null>>({});
  const [structuredAnswers, setStructuredAnswers] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Record<number, boolean>>({});
  const [checks, setChecks] = useState<Record<number, "correct" | "wrong">>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [revealedSuggested, setRevealedSuggested] = useState<Record<number, boolean>>({});
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [fontScale, setFontScale] = useState<number>(() => {
    const raw = Number(localStorage.getItem("learnyx.exam.fontScale"));
    return Number.isFinite(raw) && raw >= 0.85 && raw <= 1.6 ? raw : 1;
  });

  // ── Reports (crowdsourced QC) ──
  const myReports = useQuery(api.examPrepDigital.getMyQuestionReports, { contentId: contentId as never });
  const reportFor = useCallback(
    (n: number): ReportState | undefined => {
      const row = myReports?.find((r) => r.questionNumber === n);
      return row ? { questionNumber: row.questionNumber, status: row.status } : undefined;
    },
    [myReports],
  );
  const [localReports, setLocalReports] = useState<ReportState[]>([]);
  const reportStateFor = useCallback(
    (n: number) => localReports.find((r) => r.questionNumber === n) ?? reportFor(n),
    [localReports, reportFor],
  );
  const onReported = useCallback((r: ReportState) => {
    setLocalReports((prev) => [...prev.filter((x) => x.questionNumber !== r.questionNumber), r]);
  }, []);

  // ── Dialogs / sheet ──
  const [exitOpen, setExitOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [finished, setFinished] = useState<{ autoSubmitted: boolean } | null>(null);

  // ── Refs ──
  const persistedRef = useRef(false);
  const questionCardRef = useRef<HTMLDivElement>(null);

  const q = questions[currentIdx]!;
  const total = questions.length;
  const examLimitSeconds = durationMinutes * 60;

  useEffect(() => {
    localStorage.setItem("learnyx.exam.fontScale", String(fontScale));
  }, [fontScale]);

  // ── Clock ──
  useEffect(() => {
    if (phase !== "playing" || finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase, finished]);

  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const remainingSeconds = examLimitSeconds - elapsedSeconds;

  // ── Answer predicates ──
  const isAnswered = useCallback(
    (n: number) => Boolean(answers[n]) || (structuredAnswers[n]?.trim().length ?? 0) > 0,
    [answers, structuredAnswers],
  );

  // ── Score math (honest denominators — only auto-gradable MCQs score) ──
  const gradable = useMemo(() => questions.filter((x) => !isStructured(x) && x.answer), [questions]);
  const structuredCount = useMemo(() => questions.filter((x) => isStructured(x)).length, [questions]);
  const score = useMemo(() => {
    let correct = 0;
    let answeredGradable = 0;
    let answeredAll = 0;
    for (const x of questions) {
      const picked = answers[x.number];
      const written = (structuredAnswers[x.number]?.trim().length ?? 0) > 0;
      if (picked || written) answeredAll += 1;
      if (isStructured(x) || !x.answer) continue;
      if (picked) answeredGradable += 1;
      if (picked && picked === x.answer) correct += 1;
    }
    const unansweredGradable = gradable.length - answeredGradable;
    const examPct = gradable.length > 0 ? Math.round((correct / gradable.length) * 100) : 0;
    const practicePct = answeredGradable > 0 ? Math.round((correct / answeredGradable) * 100) : 0;
    return {
      correct,
      answeredAll,
      answeredGradable,
      unansweredGradable,
      ungradable: questions.length - gradable.length,
      examPct,
      practicePct,
    };
  }, [answers, gradable, questions, structuredAnswers]);

  const answeredCount = questions.filter((x) => isAnswered(x.number)).length;
  const flaggedCount = questions.filter((x) => flagged[x.number]).length;

  // ── Persistence (idempotent, best-effort) ──
  const persistAttempt = useCallback(
    (opts: { completed: boolean }) => {
      if (persistedRef.current) return;
      persistedRef.current = true;
      const endedAt = Date.now();
      const durationSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));

      // 1) Digital attempt record — examPrepAttempts (mode + auto score).
      logDigitalAttempt({
        contentId: contentId as never,
        mode,
        startedAt,
        endedAt,
        durationSeconds,
        completed: opts.completed,
        autoScorePct: mode === "exam" ? score.examPct : score.practicePct,
        questionsTotal: questions.length,
        questionsCorrect: score.correct,
        questionsAnswered: score.answeredAll,
      }).catch(() => {
        toast.error("Couldn't save this attempt to your results.", {
          description: "Your session still counted locally.",
        });
      });

      // 2) Streak/XP credit — the platform's single habit pipeline.
      logSession({
        subjectId: subjectId as never,
        durationSeconds,
        startedAt,
        endedAt,
        localDate: localDateStr(),
      }).catch(() => {
        // Non-fatal: streak credit fails silently — results unaffected.
      });
    },
    [contentId, logDigitalAttempt, logSession, mode, questions.length, score, startedAt, subjectId],
  );

  // ── Finish paths ──
  const finishExam = useCallback(
    (autoSubmitted: boolean) => {
      readAloud.stop();
      setFinished({ autoSubmitted });
      setPhase("finished");
      setReviewOpen(false);
      persistAttempt({ completed: !autoSubmitted });
      window.scrollTo({ top: 0 });
    },
    [persistAttempt, readAloud],
  );

  const finishPractice = useCallback(() => {
    readAloud.stop();
    setFinished({ autoSubmitted: false });
    setPhase("finished");
    persistAttempt({ completed: true });
    window.scrollTo({ top: 0 });
  }, [persistAttempt, readAloud]);

  // Auto-submit when the exam clock hits zero (the real sitting does).
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (mode !== "exam" || phase !== "playing" || finished) return;
    if (remainingSeconds <= 0 && !autoSubmittedRef.current) {
      autoSubmittedRef.current = true;
      finishExam(true);
    }
  }, [finished, finishExam, mode, phase, remainingSeconds]);

  // ── Answering ──
  const selectOption = useCallback(
    (label: string) => {
      if (finished) return;
      if (mode === "practice" && revealed[q.number]) return; // locked after check
      setAnswers((prev) => ({ ...prev, [q.number]: label }));
    },
    [finished, mode, q.number, revealed],
  );

  const checkAnswer = useCallback(() => {
    const picked = answers[q.number];
    if (!picked || !q.answer) return;
    setChecks((prev) => ({ ...prev, [q.number]: picked === q.answer ? "correct" : "wrong" }));
    setRevealed((prev) => ({ ...prev, [q.number]: true }));
  }, [answers, q]);

  const toggleFlag = useCallback(() => {
    setFlagged((prev) => ({ ...prev, [q.number]: !prev[q.number] }));
  }, [q.number]);

  const goTo = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= questions.length) return;
      setCurrentIdx(idx);
      setNavigatorOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [questions.length],
  );

  // ── Read aloud: per-question speech with block-aware highlighting ──
  const passageSentenceCount = useMemo(
    () => (q.passage ? splitSentences(q.passage).length : 0),
    [q.passage],
  );
  const questionSentenceCount = useMemo(() => splitSentences(q.text).length, [q.text]);

  const activePassageSentence = useMemo(() => {
    const i = readAloud.sentenceIndex;
    if (i === null || i >= passageSentenceCount) return null;
    return i;
  }, [passageSentenceCount, readAloud.sentenceIndex]);

  const activeQuestionSentence = useMemo(() => {
    const i = readAloud.sentenceIndex;
    if (i === null) return null;
    const rel = i - passageSentenceCount;
    if (rel < 0 || rel >= questionSentenceCount) return null;
    return rel;
  }, [passageSentenceCount, questionSentenceCount, readAloud.sentenceIndex]);

  const speakCurrent = useCallback(() => {
    if (!readAloud.supported) return;
    const parts: string[] = [];
    if (q.passage) parts.push(q.passage);
    parts.push(`Question ${q.number}. ${q.text}`);
    if (q.options.length > 0) {
      parts.push(q.options.map((o) => `${o.label}. ${o.text}`).join(" "));
    }
    readAloud.speak(parts.join(" "));
  }, [q, readAloud]);

  // ── Full keyboard operation (accessibility) ──
  useEffect(() => {
    if (phase !== "playing" || finished) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.tagName === "SELECT")
      ) {
        return; // never hijack typing
      }
      if (e.key === "ArrowRight") {
        goTo(currentIdx + 1);
      } else if (e.key === "ArrowLeft") {
        goTo(currentIdx - 1);
      } else if (/^[1-8]$/.test(e.key) && !isStructured(q)) {
        const opt = q.options[Number(e.key) - 1];
        if (opt) selectOption(opt.label);
      } else if (e.key === "Enter" && mode === "practice" && !isStructured(q) && q.answer) {
        checkAnswer();
      } else if (e.key === "f" || e.key === "F") {
        toggleFlag();
      } else if (e.key === "n" || e.key === "N") {
        setNavigatorOpen((v) => !v);
      } else if (e.key === "r" || e.key === "R") {
        speakCurrent();
      } else if (e.key === "+" || e.key === "=") {
        setFontScale((s) => Math.min(1.6, Math.round((s + 0.1) * 100) / 100));
      } else if (e.key === "-" || e.key === "_") {
        setFontScale((s) => Math.max(0.85, Math.round((s - 0.1) * 100) / 100));
      } else if (e.key === "?") {
        setShortcutsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [checkAnswer, currentIdx, finished, goTo, mode, phase, q, selectOption, speakCurrent, toggleFlag]);

  // Read-aloud is 100% on-demand: the ONLY triggers are the speaker button
  // and the R key — both explicit student actions. It never starts by
  // itself, not on mount, not on question change, not from a stored
  // setting.

  // ── Text-selection highlight capture ──
  const [pendingSelection, setPendingSelection] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (phase !== "playing" || finished) return;
    const onMouseUp = () => {
      // Small delay so touch selection settles before we read it.
      window.setTimeout(() => {
        const sel = window.getSelection();
        const text = sel?.toString().trim() ?? "";
        if (!sel || sel.isCollapsed || text.length < 3 || text.length > 300) {
          setPendingSelection(null);
          return;
        }
        const card = questionCardRef.current;
        if (!card || !card.contains(sel.anchorNode)) {
          setPendingSelection(null);
          return;
        }
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setPendingSelection({ text, x: rect.left + rect.width / 2, y: rect.top - 8 });
      }, 10);
    };
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("touchend", onMouseUp);
    return () => {
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("touchend", onMouseUp);
    };
  }, [finished, phase]);

  const commitHighlight = useCallback(() => {
    if (!pendingSelection) return;
    setHighlights((prev) =>
      prev.some((h) => h.text === pendingSelection.text)
        ? prev
        : [...prev, { questionNumber: q.number, text: pendingSelection.text }],
    );
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    toast.success("Highlight saved for this session.");
  }, [pendingSelection, q.number]);

  // ── Retake ──
  const retake = useCallback(() => {
    persistedRef.current = false;
    autoSubmittedRef.current = false;
    setAnswers({});
    setStructuredAnswers({});
    setFlagged({});
    setChecks({});
    setRevealed({});
    setRevealedSuggested({});
    setHighlights([]);
    setCurrentIdx(0);
    setFinished(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase(mode === "exam" ? "rules" : "playing");
    window.scrollTo({ top: 0 });
  }, [mode]);

  // ── Exit (abandon) ──
  const abandon = useCallback(() => {
    // Any real work → log an honest unfinished attempt (unscored).
    if (answeredCount > 0 || flaggedCount > 0) {
      persistAttempt({ completed: false });
    }
    readAloud.stop();
    navigate("/exam-prep?tab=papers");
  }, [answeredCount, flaggedCount, navigate, persistAttempt, readAloud]);

  const hasWork = answeredCount > 0 || flaggedCount > 0;

  // Font sizing for the reading surfaces.
  const questionTextStyle = { fontSize: `${1.25 * fontScale}rem` } as React.CSSProperties;
  const passageTextStyle = { fontSize: `${0.95 * fontScale}rem` } as React.CSSProperties;
  const optionTextStyle = { fontSize: `${0.9 * fontScale}rem` } as React.CSSProperties;

  return (
    <PlayerShell
      mode={mode}
      title={paperTitle}
      subjectName={subjectName}
      grade={grade}
      examYear={examYear}
      phase={phase}
      finished={finished}
      elapsedSeconds={elapsedSeconds}
      remainingSeconds={remainingSeconds}
      answeredCount={answeredCount}
      total={total}
      onShortcuts={() => setShortcutsOpen(true)}
      onBack={() => (hasWork && !finished ? setExitOpen(true) : abandon())}
      onReview={() => setReviewOpen(true)}
      onSubmit={() => (answeredCount === 0 ? finishExam(false) : setReviewOpen(true))}
      onOpenNavigator={() => setNavigatorOpen(true)}
      onPracticeFinish={finishPractice}
    >
      {/* ═══ Rules screen (Exam only) ═══ */}
      {phase === "rules" && mode === "exam" && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto w-full max-w-2xl"
        >
          <div className="relative overflow-hidden rounded-3xl border border-amber-400/25 bg-amber-400/[0.04] p-6 sm:p-8">
            <div className="pointer-events-none absolute -right-20 -top-20 size-56 rounded-full bg-amber-400/10 blur-3xl" />
            <p className="type-caption font-bold uppercase tracking-wider text-amber-300">
              <span className="inline-flex items-center gap-1.5"><Timer className="size-3.5" /> Exam conditions</span>
            </p>
            <h2 className="mt-2 type-h1">{paperTitle}</h2>
            <p className="mt-1 type-body text-muted-foreground">
              {subjectName} · Grade {grade}
              {examYear !== null ? ` · ${examYear}` : ""} · {total} questions · {durationMinutes} minutes
            </p>

            <div className="mt-5 grid gap-2.5">
              {[
                { icon: Timer, text: `The ${durationMinutes}-minute clock starts the moment you press Start — it cannot be paused.` },
                { icon: XCircle, text: "No check-answer feedback during the exam — exactly like the real sitting." },
                { icon: ListChecks, text: "Unanswered questions are marked wrong. Flag anything you want to revisit with the navigator." },
                { icon: Volume2, text: readAloud.supported ? "Read-aloud is available throughout — tap the speaker on any question." : "Read-aloud is not supported by this browser." },
                ...(structuredCount > 0
                  ? [{ icon: PenLine, text: `${structuredCount} written (free-response) question${structuredCount === 1 ? "" : "s"} in this paper — ${structuredCount === 1 ? "it is" : "these are"} saved but not auto-scored.` }]
                  : []),
                { icon: AlertTriangle, text: "When the clock hits zero, your exam submits itself automatically." },
              ].map((r, i) => {
                const Icon = r.icon;
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.07 }}
                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                      <Icon className="size-4" />
                    </span>
                    <p className="pt-1 type-caption leading-relaxed text-foreground/85">{r.text}</p>
                  </motion.div>
                );
              })}
            </div>

            <Button
              size="lg"
              onClick={() => {
                setStartedAt(Date.now());
                setNow(Date.now());
                setPhase("playing");
              }}
              className="interactive-press mt-6 w-full gap-2"
            >
              <Play className="size-4" /> Start the clock
            </Button>
            <p className="mt-2.5 text-center type-caption text-muted-foreground/60">
              Read the rules carefully — this screen is the only pause you get.
            </p>
          </div>
        </motion.div>
      )}

      {/* ═══ Playing ═══ */}
      {phase === "playing" && (
        <div className="mx-auto grid w-full max-w-6xl gap-5 xl:grid-cols-[1fr_300px]">
          {/* Question card */}
          <div ref={questionCardRef} className="min-w-0 scroll-mt-24">
            <AnimatePresence mode="wait">
              <motion.div
                key={q.number}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
                className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6"
              >
                {/* Question header row */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-amber-400/15 text-sm font-black tabular-nums text-amber-300">
                      {q.number}
                    </span>
                    <span className="type-caption text-muted-foreground">
                      of {total} · {isStructured(q) ? "written answer" : "multiple choice"}
                    </span>
                    {q.topic && (
                      <Badge variant="outline" className="border-white/10 text-muted-foreground">
                        {q.topic}
                      </Badge>
                    )}
                    {flagged[q.number] && (
                      <Badge className="gap-1 border-amber-400/40 bg-amber-400/15 text-amber-200">
                        <Flag className="size-3" /> Flagged
                      </Badge>
                    )}
                    {mode === "practice" && checks[q.number] && (
                      <Badge
                        className={cn(
                          "gap-1",
                          checks[q.number] === "correct"
                            ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-200"
                            : "border-rose-400/40 bg-rose-400/15 text-rose-200",
                        )}
                      >
                        {checks[q.number] === "correct" ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                        {checks[q.number] === "correct" ? "Correct" : "Not quite"}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-0.5">
                    {readAloud.supported && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={speakCurrent}
                        aria-label="Read this question aloud"
                        className="size-8 rounded-xl p-0 text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
                      >
                        <Volume2 className="size-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={toggleFlag}
                      aria-label={flagged[q.number] ? "Remove flag" : "Flag for review"}
                      className={cn(
                        "size-8 rounded-xl p-0",
                        flagged[q.number] ? "text-amber-300" : "text-muted-foreground hover:text-amber-300",
                      )}
                    >
                      {flagged[q.number] ? <FlagOff className="size-4" /> : <Flag className="size-4" />}
                    </Button>
                    <OriginalPageButton
                      pdfUrl={pdfUrl}
                      page={q.sourcePage ?? null}
                      pageCount={pageCount}
                      figure={q.figureHint}
                    />
                    <ReportIssueButton
                      contentId={contentId}
                      questionNumber={q.number}
                      reported={reportStateFor(q.number)}
                      onReported={onReported}
                    />
                  </div>
                </div>

                {/* Passage (shared stimulus) */}
                {q.passage && (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <p className="type-caption font-bold uppercase tracking-wider text-muted-foreground/60">Stimulus</p>
                    <p className="mt-1.5 leading-relaxed text-foreground/85" style={passageTextStyle}>
                      <SentenceText text={q.passage} activeSentence={activePassageSentence} />
                    </p>
                  </div>
                )}

                {/* Question text */}
                <p className="mt-4 font-bold leading-relaxed" style={questionTextStyle}>
                  <SentenceText text={q.text} activeSentence={activeQuestionSentence} />
                </p>

                {/* Options (MCQ) */}
                {q.options.length > 0 && (
                  <div className="mt-4 grid gap-2">
                    {q.options.map((opt) => {
                      const picked = answers[q.number] === opt.label;
                      let state: "idle" | "correct" | "wrong" | "dim" = "idle";
                      if (mode === "practice" && revealed[q.number]) {
                        if (opt.label === q.answer) state = "correct";
                        else if (picked) state = "wrong";
                        else state = "dim";
                      }
                      return (
                        <OptionButton
                          key={opt.label}
                          label={opt.label}
                          text={opt.text}
                          selected={picked}
                          state={state}
                          disabled={finished !== null || (mode === "practice" && revealed[q.number])}
                          onSelect={() => selectOption(opt.label)}
                          style={optionTextStyle}
                        />
                      );
                    })}
                  </div>
                )}

                {/* Written answer (structured) */}
                {isStructured(q) && (
                  <div className="mt-4">
                    <textarea
                      value={structuredAnswers[q.number] ?? ""}
                      onChange={(e) =>
                        setStructuredAnswers((prev) => ({ ...prev, [q.number]: e.target.value.slice(0, 4000) }))
                      }
                      disabled={finished !== null}
                      rows={4}
                      placeholder="Write your answer here…"
                      className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 leading-relaxed outline-none placeholder:text-muted-foreground/50 focus:border-amber-400/50"
                      style={optionTextStyle}
                      aria-label={`Your written answer for question ${q.number}`}
                    />
                    <p className="mt-1.5 flex items-center gap-1.5 type-caption text-muted-foreground/60">
                      <Info className="size-3 shrink-0" />
                      Written answers are saved with your attempt but never auto-scored —{mode === "practice" && q.suggestedAnswer
                        ? " reveal the paper's suggested answer below to check yourself."
                        : " compare with the official marking scheme."}
                    </p>
                    {mode === "practice" && (
                      <div className="mt-3">
                        {!revealedSuggested[q.number] ? (
                          <Button
                            variant="outline"
                            disabled={!q.suggestedAnswer}
                            onClick={() => setRevealedSuggested((prev) => ({ ...prev, [q.number]: true }))}
                            className="interactive-press gap-2"
                          >
                            <Lightbulb className="size-4" />
                            {q.suggestedAnswer ? "Reveal suggested answer" : "No suggested answer in the paper"}
                          </Button>
                        ) : (
                          <motion.div
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-3.5"
                          >
                            <p className="type-caption font-bold uppercase tracking-wider text-emerald-300">
                              Suggested answer {q.suggestedAnswer ? "" : "— not in the paper"}
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-foreground/85" style={passageTextStyle}>
                              {q.suggestedAnswer ?? "This paper didn't include a marking scheme for this question — cross-check with your teacher or the official key."}
                            </p>
                            {q.suggestedAnswer && (
                              <p className="mt-2 inline-flex items-center gap-1.5 type-caption text-muted-foreground/60">
                                <Info className="size-3 shrink-0" />
                                From the paper itself (or AI-extracted from its key) — grade yourself honestly.
                              </p>
                            )}
                          </motion.div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Practice: check answer (exam NEVER gets this) */}
                {mode === "practice" && q.options.length > 0 && !revealed[q.number] && (
                  <div className="mt-4 flex flex-wrap items-center gap-2.5">
                    <Button
                      onClick={checkAnswer}
                      disabled={!answers[q.number] || !q.answer}
                      className="interactive-press gap-2"
                    >
                      <BookOpenCheck className="size-4" /> Check answer
                    </Button>
                    {!q.answer && (
                      <p className="type-caption text-muted-foreground/60">
                        No answer for this question could be transcribed — compare with the official key later.
                      </p>
                    )}
                  </div>
                )}

                {/* Practice: feedback + explanation (post-check) */}
                {mode === "practice" && q.options.length > 0 && revealed[q.number] && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4"
                  >
                    <Alert
                      className={cn(
                        "border",
                        checks[q.number] === "correct"
                          ? "border-emerald-400/30 bg-emerald-400/[0.07]"
                          : "border-rose-400/30 bg-rose-400/[0.07]",
                      )}
                    >
                      <AlertDescription className="flex flex-col gap-2">
                        <span className={cn("type-body font-bold", checks[q.number] === "correct" ? "text-emerald-300" : "text-rose-300")}>
                          {checks[q.number] === "correct"
                            ? "Correct — solid."
                            : `Not quite. The suggested answer is ${q.answer}.`}
                        </span>
                        {q.explanation && (
                          <span className="flex items-start gap-2 type-caption leading-relaxed text-foreground/80">
                            <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
                            {q.explanation}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1.5 type-caption text-muted-foreground/60">
                          <Info className="size-3 shrink-0" />
                          Answers and explanations are transcribed or suggested by AI — cross-check with the official answer key.
                        </span>
                      </AlertDescription>
                    </Alert>
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* Prev / next + finish/submit */}
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button
                variant="outline"
                onClick={() => goTo(currentIdx - 1)}
                disabled={currentIdx === 0}
                className="interactive-press gap-1.5"
              >
                <ChevronLeft className="size-4" /> Previous
              </Button>
              <span className="type-caption tabular-nums text-muted-foreground/60">
                {currentIdx + 1} / {total}
              </span>
              {currentIdx < total - 1 ? (
                <Button onClick={() => goTo(currentIdx + 1)} className="interactive-press gap-1.5">
                  Next <ChevronRight className="size-4" />
                </Button>
              ) : mode === "practice" ? (
                <Button onClick={finishPractice} className="interactive-press gap-2">
                  <CheckCircle2 className="size-4" /> Finish
                </Button>
              ) : (
                <Button
                  onClick={() => (answeredCount === 0 ? finishExam(false) : setReviewOpen(true))}
                  className="interactive-press gap-2"
                >
                  <Check className="size-4" /> Submit exam
                </Button>
              )}
            </div>
          </div>

          {/* Desktop navigator sidebar */}
          <aside className="sticky top-20 hidden h-fit max-h-[calc(100vh-6rem)] overflow-y-auto rounded-3xl border border-white/10 bg-white/[0.03] p-4 xl:block">
            <p className="mb-3 type-caption font-bold uppercase tracking-wider text-muted-foreground/70">
              Question navigator
            </p>
            <NavigatorBody
              questions={questions}
              answers={answers}
              structuredAnswers={structuredAnswers}
              flagged={flagged}
              currentIdx={currentIdx}
              highlights={highlights}
              onJump={goTo}
              onSpeakCurrent={speakCurrent}
              readAloudSupported={readAloud.supported}
              rate={readAloud.rate}
              onRateChange={readAloud.setRate}
              onRemoveHighlight={(h) => setHighlights((prev) => prev.filter((x) => x !== h))}
              fontScale={fontScale}
              onFontScale={setFontScale}
            />
          </aside>
        </div>
      )}

      {/* ═══ Results ═══ */}
      {phase === "finished" && finished && (
        <ResultsScreen
          mode={mode}
          autoSubmitted={finished.autoSubmitted}
          score={score}
          total={total}
          elapsedSeconds={elapsedSeconds}
          flaggedCount={flaggedCount}
          questions={questions}
          answers={answers}
          structuredAnswers={structuredAnswers}
          checks={checks}
          paperTitle={paperTitle}
          subjectName={subjectName}
          onRetake={retake}
          onBackToHub={() => navigate("/exam-prep?tab=results")}
        />
      )}

      {/* ═══ Overlays ═══ */}
      {/* Mobile navigator sheet */}
      <Sheet open={navigatorOpen} onOpenChange={setNavigatorOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-3xl border-white/10 bg-background px-4 pb-8">
          <SheetHeader className="px-0 pt-2 text-left">
            <SheetTitle className="type-h3">Question navigator</SheetTitle>
          </SheetHeader>
          <NavigatorBody
            questions={questions}
            answers={answers}
            structuredAnswers={structuredAnswers}
            flagged={flagged}
            currentIdx={currentIdx}
            highlights={highlights}
            onJump={goTo}
            onSpeakCurrent={speakCurrent}
            readAloudSupported={readAloud.supported}
            rate={readAloud.rate}
            onRateChange={readAloud.setRate}
            onRemoveHighlight={(h) => setHighlights((prev) => prev.filter((x) => x !== h))}
            fontScale={fontScale}
            onFontScale={setFontScale}
          />
        </SheetContent>
      </Sheet>

      {/* Keyboard shortcuts */}
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Floating highlight capture */}
      <AnimatePresence>
        {pendingSelection && (
          <motion.button
            type="button"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{
              position: "fixed",
              left: Math.max(16, Math.min(window.innerWidth - 150, pendingSelection.x - 60)),
              top: Math.max(16, pendingSelection.y - 44),
            }}
            onClick={commitHighlight}
            className="z-50 inline-flex items-center gap-1.5 rounded-xl border border-sky-400/40 bg-background/95 px-3 py-1.5 type-caption font-bold text-sky-300 shadow-2xl backdrop-blur transition hover:bg-sky-400/10"
          >
            <Highlighter className="size-3.5" /> Highlight
          </motion.button>
        )}
      </AnimatePresence>

      {/* Read-aloud transport */}
      <AnimatePresence>
        {phase === "playing" && (
          <ReadAloudTransport
            speaking={readAloud.speaking}
            paused={readAloud.paused}
            onStop={readAloud.stop}
            onPause={readAloud.pause}
            onResume={readAloud.resume}
          />
        )}
      </AnimatePresence>

      {/* Exam pre-submit review */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-lg rounded-3xl border-white/10 bg-background">
          <DialogHeader>
            <DialogTitle className="type-h2">Before you submit</DialogTitle>
            <DialogDescription className="type-caption">
              {answeredCount} of {total} answered · {flaggedCount} flagged · {total - answeredCount} unanswered
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-56 grid-cols-8 gap-1.5 overflow-y-auto sm:grid-cols-10">
            {questions.map((x, idx) => (
              <button
                key={x.number}
                type="button"
                onClick={() => {
                  setCurrentIdx(idx);
                  setReviewOpen(false);
                }}
                className={paletteTileClass(flagged[x.number] ? "flagged" : isAnswered(x.number) ? "answered" : "unanswered", false)}
              >
                {x.number}
              </button>
            ))}
          </div>
          <p className="type-caption text-muted-foreground/60">
            Unanswered questions are marked wrong. Tap a tile to jump back.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setReviewOpen(false)} className="flex-1">
              Keep working
            </Button>
            <Button onClick={() => finishExam(false)} className="flex-1 gap-1.5">
              <Check className="size-4" /> Submit exam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Exit confirm (abandon) */}
      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent className="max-w-md rounded-3xl border-white/10 bg-background">
          <DialogHeader>
            <DialogTitle className="type-h2">Leave the paper?</DialogTitle>
            <DialogDescription className="type-caption">
              You have work on this paper. Leaving now records an unfinished, unscored attempt — your answers are not saved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExitOpen(false)} className="flex-1">
              Stay
            </Button>
            <Button variant="destructive" onClick={abandon} className="flex-1 gap-1.5">
              <ArrowLeft className="size-4" /> Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PlayerShell>
  );
}

// ═══ PlayerShell — chrome: header, timer, progress bar, mobile bar ═══════

function PlayerShell({
  mode,
  title,
  subjectName,
  grade,
  examYear,
  phase,
  finished,
  elapsedSeconds,
  remainingSeconds,
  answeredCount,
  total,
  onBack,
  onReview,
  onSubmit,
  onOpenNavigator,
  onPracticeFinish,
  onShortcuts,
  children,
}: {
  mode: ExamMode;
  title: string;
  subjectName: string;
  grade: number;
  examYear: number | null;
  phase: "rules" | "playing" | "finished";
  finished: { autoSubmitted: boolean } | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  answeredCount: number;
  total: number;
  onBack: () => void;
  onReview: () => void;
  onSubmit: () => void;
  onOpenNavigator: () => void;
  onPracticeFinish: () => void;
  onShortcuts: () => void;
  children: React.ReactNode;
}) {
  const isExam = mode === "exam";
  const lowTime = isExam && phase === "playing" && remainingSeconds <= 300;
  const criticalTime = isExam && phase === "playing" && remainingSeconds <= 60;
  const progressPct = total > 0 ? Math.round((answeredCount / total) * 100) : 0;

  return (
    <div className="relative min-h-screen bg-background">
      {/* Ambient cinematic glow */}
      <div className="pointer-events-none fixed -top-32 left-1/2 z-0 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-amber-400/[0.05] blur-3xl" />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-3 py-2.5 sm:px-5">
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            aria-label="Back to Exam Prep"
            className="size-8 shrink-0 rounded-xl p-0 text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">{title}</p>
            <div className="flex items-center gap-1.5">
              <p className="truncate type-caption text-muted-foreground/70">
                {isExam ? "Exam mode" : "Practice mode"} · {subjectName} · Grade {grade}
                {examYear !== null ? ` · ${examYear}` : ""}
              </p>
            </div>
          </div>

          {/* Timer chip — role=timer keeps screen readers informed without spam */}
          {phase === "playing" && (
            <div
              role="timer"
              aria-label={isExam ? `Time remaining ${fmtClock(remainingSeconds)}` : `Elapsed time ${fmtClock(elapsedSeconds)}`}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-xl border px-2.5 py-1 type-caption font-black tabular-nums",
                isExam
                  ? criticalTime
                    ? "animate-pulse border-rose-400/50 bg-rose-400/15 text-rose-200"
                    : lowTime
                      ? "border-amber-400/50 bg-amber-400/15 text-amber-200"
                      : "border-emerald-400/40 bg-emerald-400/[0.10] text-emerald-200"
                  : "border-white/10 bg-white/[0.04] text-muted-foreground",
              )}
            >
              {isExam ? <Timer className="size-3.5" /> : null}
              {isExam ? fmtClock(remainingSeconds) : fmtClock(elapsedSeconds)}
              {!isExam && <span className="font-semibold text-muted-foreground/50">elapsed</span>}
            </div>
          )}
          {phase === "playing" && !isExam && (
            <Badge variant="outline" className="hidden shrink-0 border-white/15 text-muted-foreground sm:inline-flex">
              No time limit
            </Badge>
          )}

          {/* Review / submit (exam, desktop) */}
          {isExam && phase === "playing" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={onReview}
                className="hidden shrink-0 rounded-xl gap-1.5 border-white/15 sm:inline-flex"
              >
                <ListChecks className="size-3.5" /> Review
              </Button>
              <Button size="sm" onClick={onSubmit} className="shrink-0 rounded-xl gap-1.5">
                Submit
              </Button>
            </>
          )}
          {!isExam && phase === "playing" && (
            <Button
              size="sm"
              variant="outline"
              onClick={onPracticeFinish}
              className="hidden shrink-0 rounded-xl gap-1.5 border-white/15 sm:inline-flex"
            >
              <CheckCircle2 className="size-3.5" /> Finish
            </Button>
          )}
          {phase === "playing" && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="hidden size-8 shrink-0 rounded-xl p-0 text-muted-foreground hover:text-amber-300 md:inline-flex"
            >
              <span className="font-mono text-[11px] font-black">?</span>
            </Button>
          )}
        </div>

        {/* Slim progress bar */}
        <div className="h-1 w-full bg-white/5">
          <motion.div
            className={cn(
              "h-full",
              isExam
                ? "bg-gradient-to-r from-emerald-400 to-emerald-300"
                : "bg-gradient-to-r from-amber-400 to-amber-300",
            )}
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
      </header>

      {/* Body */}
      <main className="relative z-10 px-3 pb-32 pt-4 sm:px-5 xl:pb-10">{children}</main>

      {/* Mobile bottom bar */}
      {phase === "playing" && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/5 bg-background/90 px-3 py-2.5 backdrop-blur-xl xl:hidden">
          <div className="mx-auto flex max-w-6xl items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onOpenNavigator}
              className="relative shrink-0 gap-1.5 rounded-xl border-white/15"
            >
              <ListChecks className="size-4" /> Navigator
              {answeredCount > 0 && (
                <span className="rounded-md bg-emerald-400/20 px-1.5 type-caption font-black text-emerald-300">
                  {answeredCount}/{total}
                </span>
              )}
            </Button>
            {isExam ? (
              <Button size="sm" onClick={onSubmit} className="ml-auto shrink-0 rounded-xl gap-1.5">
                <Check className="size-4" /> Submit exam
              </Button>
            ) : (
              <Button size="sm" onClick={onPracticeFinish} className="ml-auto shrink-0 rounded-xl gap-1.5">
                <CheckCircle2 className="size-4" /> Finish
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══ ResultsScreen ═══════════════════════════════════════════════════════

function ResultsScreen({
  mode,
  autoSubmitted,
  score,
  total,
  elapsedSeconds,
  flaggedCount,
  questions,
  answers,
  structuredAnswers,
  checks,
  paperTitle,
  subjectName,
  onRetake,
  onBackToHub,
}: {
  mode: ExamMode;
  autoSubmitted: boolean;
  score: {
    correct: number;
    answeredAll: number;
    answeredGradable: number;
    unansweredGradable: number;
    ungradable: number;
    examPct: number;
    practicePct: number;
  };
  total: number;
  elapsedSeconds: number;
  flaggedCount: number;
  questions: DigitalQuestion[];
  answers: Record<number, string | null>;
  structuredAnswers: Record<number, string>;
  checks: Record<number, "correct" | "wrong">;
  paperTitle: string;
  subjectName: string;
  onRetake: () => void;
  onBackToHub: () => void;
}) {
  const isExam = mode === "exam";
  const pct = isExam ? score.examPct : score.practicePct;
  const tone = pct >= 75 ? "stroke-emerald-400" : pct >= 50 ? "stroke-amber-400" : "stroke-rose-400";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto flex w-full max-w-3xl flex-col gap-4"
    >
      {/* Score card */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="type-caption font-bold uppercase tracking-wider text-amber-300">
            {isExam ? "Exam complete" : "Practice session complete"}
          </p>
        </div>
        {autoSubmitted && (
          <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-400/[0.07] p-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-300" />
            <p className="type-caption leading-relaxed text-rose-200">
              The clock ran out — your exam was submitted automatically.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
          <ScoreRing pct={pct} tone={tone} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="type-h2">{paperTitle}</h2>
            <p className="mt-1 type-caption text-muted-foreground">
              {subjectName} · {isExam ? "scored on every auto-gradable question" : "scored on questions you answered"}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile label="Correct" value={score.correct} accent="text-emerald-300" />
              <StatTile label="Incorrect" value={Math.max(0, score.answeredGradable - score.correct)} accent="text-rose-300" />
              <StatTile label="Unanswered" value={score.unansweredGradable} accent="text-muted-foreground" />
              <StatTile label="Flagged" value={flaggedCount} accent="text-amber-300" />
            </div>
            <p className="mt-3 type-caption text-muted-foreground/70">
              Time on this paper: {fmtElapsedLong(elapsedSeconds)} ·{" "}
              {isExam ? "honest wall-clock time" : "untimed session"}
            </p>
            {score.ungradable > 0 && (
              <p className="mt-1.5 type-caption text-muted-foreground/60">
                {score.ungradable} question{score.ungradable === 1 ? "" : "s"} — written answers or
                questions with no transcribed key — {score.ungradable === 1 ? "is" : "are"} excluded from the score.
              </p>
            )}
            <p className="mt-2 inline-flex items-center gap-1.5 type-caption text-emerald-300/80">
              <CheckCircle2 className="size-3.5" /> Saved to My Results in the Exam Prep Hub.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={onRetake} className="interactive-press gap-2">
            <RotateCcw className="size-4" /> Retake this paper
          </Button>
          <Button variant="outline" onClick={onBackToHub} className="interactive-press gap-2">
            <ArrowRight className="size-4" /> See all results
          </Button>
        </div>
      </div>

      {/* Per-question review */}
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
        <p className="type-h3">Review every question</p>
        <p className="mt-0.5 type-caption text-muted-foreground">
          Your answer vs the transcribed answer — with explanations where the paper provided them.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          {questions.map((x) => {
            const picked = answers[x.number];
            const written = structuredAnswers[x.number]?.trim();
            const hasAnswer = Boolean(x.answer);
            const correct = picked && picked === x.answer;
            return (
              <div
                key={x.number}
                className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/5 type-caption font-black tabular-nums text-muted-foreground">
                  {x.number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 type-caption font-semibold text-foreground/90">{x.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 type-caption">
                    {x.options.length > 0 ? (
                      <>
                        <span
                          className={cn(
                            "rounded-md border px-1.5 py-0.5 font-bold",
                            picked
                              ? "border-white/15 bg-white/5 text-foreground/80"
                              : "border-white/10 bg-transparent text-muted-foreground/60",
                          )}
                        >
                          {picked ? `You: ${picked}` : "Not answered"}
                        </span>
                        {hasAnswer && (
                          <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 font-bold text-emerald-300">
                            Answer: {x.answer}
                          </span>
                        )}
                        {!hasAnswer && (
                          <span className="rounded-md border border-white/10 px-1.5 py-0.5 text-muted-foreground/60">
                            No transcribed answer
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/25 bg-sky-400/[0.07] px-1.5 py-0.5 text-sky-300">
                        <PenLine className="size-3" />
                        {written ? "Written answer saved" : "No written answer"}
                      </span>
                    )}
                    {mode === "practice" && checks[x.number] && (
                      <span className={cn("font-bold", checks[x.number] === "correct" ? "text-emerald-300" : "text-rose-300")}>
                        {checks[x.number] === "correct" ? "checked ✓" : "checked ✗"}
                      </span>
                    )}
                  </div>
                  {written && (
                    <p className="mt-1.5 whitespace-pre-wrap rounded-xl border border-white/[0.06] bg-white/[0.03] p-2 type-caption leading-relaxed text-foreground/75">
                      {written}
                    </p>
                  )}
                  {x.explanation && (
                    <p className="mt-1.5 flex items-start gap-1.5 type-caption leading-relaxed text-muted-foreground">
                      <Lightbulb className="mt-0.5 size-3 shrink-0 text-amber-300/80" />
                      {x.explanation}
                    </p>
                  )}
                </div>
                {correct && <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-400" />}
                {!correct && picked && hasAnswer && <XCircle className="mt-1 size-4 shrink-0 text-rose-400" />}
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}

function StatTile({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5 text-center">
      <p className={cn("type-h3 tabular-nums", accent)}>{value}</p>
      <p className="type-caption text-muted-foreground/70">{label}</p>
    </div>
  );
}

export default DigitalExamPlayer;
