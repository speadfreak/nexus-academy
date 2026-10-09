// ═══════════════════════════════════════════════════════════════════════
// MISTAKE PRACTICE — "Practice similar" (2.0)
// ═══════════════════════════════════════════════════════════════════════
// A short, focused session that repairs ONE misconception: real
// past-paper questions on the SAME topic as a mistake from the Mistake
// Lab. This is NOT a quiz engine — every question is pulled from the
// verified digital paper bank, scored server-side against the paper's
// own answer key, and the original mistake's spaced revision moves
// exactly once per session through the same ladder as direct review.
//
// Honesty rules surfaced here:
//   • Each question shows WHY it was selected (real data, no vibes).
//   • Provenance is always visible: paper, year, question number, page,
//     official sitting vs practice set, teacher-verified or key-parsed.
//   • Answers arrive only with the submit verdict — the client never
//     holds the key before answering.
//   • No suitable question exists → it says so plainly, with real
//     alternatives. Nothing is fabricated to fill the gap.
// ═══════════════════════════════════════════════════════════════════════

import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Eye,
  FlaskConical,
  Lightbulb,
  ListChecks,
  Loader2,
  Sparkles,
  Target,
  Trophy,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { cn } from "@/lib/utils";

function FileTextIcon() {
  return <BookOpen className="size-3" />;
}

type Selection = FunctionReturnType<typeof api.learning.findSimilarPractice>;
type SessionData = NonNullable<FunctionReturnType<typeof api.learning.getPracticeQuestions>>;

function relTime(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const unit = mins < 60 ? `${mins}m` : hours < 48 ? `${hours}h` : `${days}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} overdue`;
}

function OfficialChip() {
  return (
    <span className="type-caption inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
      <FileTextIcon /> Official past paper
    </span>
  );
}

function PracticeSetChip() {
  return (
    <span className="type-caption inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      <FileTextIcon /> Practice paper
    </span>
  );
}

function VerifiedChip() {
  return (
    <span className="type-caption inline-flex items-center gap-1 rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
      <Check className="size-3" /> Teacher-verified
    </span>
  );
}

// ── Context card: the mistake being repaired ─────────────────────────────

function MistakeContext({
  mistake,
  topicLabel,
}: {
  mistake: NonNullable<Selection>["mistake"];
  topicLabel: string | null;
}) {
  if (!mistake) return null;
  return (
    <section
      aria-label="The mistake this practice repairs"
      className="glass-panel relative overflow-hidden rounded-2xl p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-mono inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          <Target className="size-3.5" /> repairing this mistake
        </span>
        {topicLabel && (
          <span className="type-caption rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {topicLabel}
          </span>
        )}
        <span
          className={cn(
            "type-caption ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/70",
          )}
        >
          review {relTime(mistake.nextReviewAt)}
        </span>
      </div>

      <p className="type-body mt-3 font-semibold leading-6 text-foreground/95">{mistake.questionText}</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {mistake.studentAnswer && (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3">
            <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-rose-300/80">
              Your answer then
            </p>
            <p className="type-caption mt-1 text-foreground/85">{mistake.studentAnswer}</p>
          </div>
        )}
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
          <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
            Correct answer
          </p>
          <p className="type-caption mt-1 text-foreground/85">{mistake.correctAnswer}</p>
        </div>
      </div>

      {mistake.explanation && (
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
          <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Why
          </p>
          <p className="type-caption mt-1 leading-5 text-muted-foreground">{mistake.explanation}</p>
        </div>
      )}
    </section>
  );
}

// ── Preview: what's available and why ────────────────────────────────────

function PreviewPanel({
  selection,
  onStart,
  starting,
}: {
  selection: NonNullable<Selection>;
  onStart: () => void;
  starting: boolean;
}) {
  const navigate = useNavigate();

  if (selection.status !== "ok" || selection.candidates.length === 0) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-panel flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-12 text-center"
      >
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-white/10 blur-2xl" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
            <FlaskConical className="size-7 text-muted-foreground" />
          </div>
        </div>
        <div>
          <p className="type-h3">
            {selection.status === "mistake_dismissed"
              ? "This mistake was dismissed"
              : selection.status === "no_topic"
                ? "No topic to match on"
                : "No verified practice questions yet"}
          </p>
          <p className="type-caption mx-auto mt-1 max-w-lg text-muted-foreground">
            {selection.reason}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {selection.mistake?.contentId && (
            <button
              type="button"
              onClick={() => navigate(`/read/${selection.mistake!.contentId}`)}
              className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              <BookOpen className="size-4" /> Open the source paper
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate("/exam-prep?tab=practice")}
            className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary/15 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
          >
            Practice the subject <ArrowRight className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/mistakes")}
            className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Back to Mistake Lab
          </button>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-4 sm:p-5"
      aria-label="Practice selection"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-mono inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          <ListChecks className="size-3.5" /> {selection.candidates.length} question
          {selection.candidates.length === 1 ? "" : "s"} ready
        </span>
        <span className="type-caption rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {selection.matchedBy === "topic_text"
            ? "matched on the printed topic"
            : "same curriculum topic"}
        </span>
      </div>
      <p className="type-caption mt-2 leading-5 text-muted-foreground">{selection.reason}</p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {selection.candidates.map((c) => (
          <li
            key={`${c.contentId}:${c.questionNumber}`}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
          >
            <span className="type-caption font-semibold text-foreground/85">
              Q{c.questionNumber}
              {c.examYear ? ` · ${c.examYear}` : ""}
            </span>
            <span className="type-caption min-w-0 truncate text-muted-foreground">
              {c.paperTitle}
              {c.sourcePage ? ` · p.${c.sourcePage}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              {c.official ? <OfficialChip /> : <PracticeSetChip />}
              {c.verifiedPaper && <VerifiedChip />}
            </span>
          </li>
        ))}
      </ul>

      <button
        type="button"
        onClick={onStart}
        disabled={starting}
        className="interactive-press mt-4 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary/15 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/25 disabled:opacity-60 sm:w-auto"
      >
        {starting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        Start practice
      </button>
    </motion.section>
  );
}

// ── The player ───────────────────────────────────────────────────────────

type SubmitResult = {
  duplicate: boolean;
  correct: boolean;
  correctAnswer: string;
  explanation: string | null;
  sourcePage: number | null;
  review: { result: "got_it" | "still_unsure"; nextReviewAt: number } | null;
  sessionComplete: boolean;
};

function OptionButton({
  option,
  selected,
  disabled,
  correctLabel,
  revealed,
  onSelect,
}: {
  option: { label: string; text: string };
  selected: boolean;
  disabled: boolean;
  correctLabel: string | null;
  revealed: boolean;
  onSelect: () => void;
}) {
  const isCorrect = revealed && correctLabel === option.label;
  const isWrongPick = revealed && selected && !isCorrect;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "interactive-press flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition",
        "border-white/[0.07] bg-white/[0.03] hover:border-primary/30 hover:bg-white/[0.05]",
        selected && !revealed && "border-primary/50 bg-primary/[0.08]",
        isCorrect && "border-emerald-400/40 bg-emerald-400/[0.08]",
        isWrongPick && "border-rose-400/40 bg-rose-400/[0.08]",
        disabled && "cursor-default",
      )}
    >
      <span
        className={cn(
          "type-caption mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] font-bold",
          selected && !revealed && "border-primary/40 bg-primary/15 text-primary",
          isCorrect && "border-emerald-400/40 bg-emerald-400/15 text-emerald-300",
          isWrongPick && "border-rose-400/40 bg-rose-400/15 text-rose-300",
        )}
      >
        {option.label}
      </span>
      <span className="type-body min-w-0 flex-1 leading-6 text-foreground/90">{option.text}</span>
      {isCorrect && <Check className="mt-1 size-4 shrink-0 text-emerald-300" />}
      {isWrongPick && <XCircle className="mt-1 size-4 shrink-0 text-rose-300" />}
    </button>
  );
}

function Player({
  session,
  onExit,
  onFinished,
}: {
  session: SessionData;
  onExit: () => void;
  onFinished: () => void;
}) {
  const submit = useMutation(api.learning.submitMistakePractice);
  const navigate = useNavigate();

  const answeredMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const a of session.attempts) {
      map.set(`${a.contentId}:${a.questionNumber}`, a.correct);
    }
    return map;
  }, [session.attempts]);

  const firstUnanswered = useMemo(() => {
    const idx = session.questions.findIndex(
      (q) => !answeredMap.has(`${q.contentId}:${q.questionNumber}`),
    );
    return idx === -1 ? Math.max(0, session.questions.length - 1) : idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.questions]);

  const [idx, setIdx] = useState(firstUnanswered);
  const [choice, setChoice] = useState<string | null>(null);
  const [hintShown, setHintShown] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [busy, setBusy] = useState(false);

  const q = session.questions[idx];
  const isAnswered = q ? answeredMap.has(`${q.contentId}:${q.questionNumber}`) : false;

  // Reset per-question state when moving between questions.
  useEffect(() => {
    setChoice(null);
    setHintShown(false);
    setResult(null);
  }, [idx]);

  const handleSubmit = async () => {
    if (!q || !choice || result) return;
    setBusy(true);
    try {
      const res = await submit({
        sessionId: session.sessionId,
        contentId: q.contentId,
        questionNumber: q.questionNumber,
        choice,
      });
      setResult(res);
      if (res.sessionComplete) {
        toast.success(
          res.review?.result === "got_it"
            ? "Clean session — your mistake's review moved forward."
            : "Session saved — this mistake comes back soon to re-check.",
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not record your answer. Try again.";
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    const nextIdx = session.questions.findIndex(
      (x, i) => i > idx && !answeredMap.has(`${x.contentId}:${x.questionNumber}`),
    );
    if (nextIdx !== -1) {
      setIdx(nextIdx);
    } else {
      onFinished();
    }
  };

  if (!q) {
    // Every question became unavailable — close honestly, review untouched.
    return (
      <div className="glass-panel rounded-2xl p-6 text-center">
        <p className="type-h3">This session's questions are no longer available</p>
        <p className="type-caption mx-auto mt-1 max-w-md text-muted-foreground">
          The papers were re-prepared since the session started. Nothing was recorded, and your
          mistake's schedule is untouched.
        </p>
        <button
          type="button"
          onClick={() => navigate("/mistakes")}
          className="interactive-press mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary/15 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
        >
          <ArrowLeft className="size-4" /> Back to Mistake Lab
        </button>
      </div>
    );
  }

  const correctLabel = result ? result.correctAnswer.trim().toUpperCase() : null;
  const correctOption = correctLabel ? q.options.find((o) => o.label === correctLabel) : null;
  const pickedOption = q.options.find((o) => o.label === choice);
  const correctCount = [...answeredMap.values()].filter(Boolean).length;

  return (
    <section aria-label="Focused practice" className="flex flex-col gap-3">
      {/* Progress + exit */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5" aria-label={`Question ${idx + 1} of ${session.questions.length}`}>
          {session.questions.map((x, i) => {
            const done = answeredMap.get(`${x.contentId}:${x.questionNumber}`);
            return (
              <span
                key={`${x.contentId}:${x.questionNumber}`}
                aria-hidden="true"
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  i === idx
                    ? "bg-primary"
                    : done === true
                      ? "bg-emerald-400/70"
                      : done === false
                        ? "bg-rose-400/70"
                        : "bg-white/15",
                )}
              />
            );
          })}
        </div>
        <span className="type-caption text-muted-foreground">
          {idx + 1} / {session.questions.length} · {correctCount} correct so far
        </span>
        <button
          type="button"
          onClick={onExit}
          className="interactive-press ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Save & exit
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.article
          key={`${q.contentId}:${q.questionNumber}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel rounded-2xl p-4 sm:p-6"
        >
          {/* Provenance + why */}
          <div className="flex flex-wrap items-center gap-2">
            {q.official ? <OfficialChip /> : <PracticeSetChip />}
            {q.verifiedPaper && <VerifiedChip />}
            <span className="type-caption rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
              Q{q.questionNumber}
              {q.examYear ? ` · ${q.examYear}` : ""}
              {q.sourcePage ? ` · p.${q.sourcePage}` : ""}
            </span>
            <span className="type-caption min-w-0 truncate text-muted-foreground/80">
              {q.paperTitle}
            </span>
          </div>
          <p className="type-caption mt-2 flex items-start gap-1.5 leading-5 text-muted-foreground/75">
            <Sparkles className="mt-0.5 size-3 shrink-0 text-amber-300/70" />
            {q.why}
          </p>

          {q.passage && (
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
              <p className="type-caption whitespace-pre-line leading-6 text-muted-foreground">
                {q.passage}
              </p>
            </div>
          )}

          <p className="type-body mt-4 font-semibold leading-7 text-foreground/95">{q.text}</p>

          {/* Hint — the only reliable hint is the paper's printed topic. */}
          {!result && q.topic && (
            <div className="mt-3">
              {hintShown ? (
                <p className="type-caption inline-flex items-center gap-1.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2 text-amber-200">
                  <Lightbulb className="size-3.5" /> This question tests: {q.topic}
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => setHintShown(true)}
                  className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-amber-300/80 transition hover:text-amber-300"
                >
                  <Eye className="size-3.5" /> Reveal the printed topic (hint)
                </button>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2" role="group" aria-label="Answer options">
            {q.options.map((o) => (
              <OptionButton
                key={o.label}
                option={o}
                selected={choice === o.label}
                disabled={busy || isAnswered || Boolean(result)}
                correctLabel={correctLabel}
                revealed={Boolean(result) || isAnswered}
                onSelect={() => setChoice(o.label)}
              />
            ))}
          </div>

          {/* Pre-submit */}
          {!result && !isAnswered && (
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!choice || busy}
              className="interactive-press mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary/15 px-4 py-3 text-sm font-bold text-primary transition hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Check answer
            </button>
          )}

          {/* Resumed question already answered earlier */}
          {isAnswered && (
            <div
              className={cn(
                "mt-5 rounded-xl border p-4",
                answeredMap.get(`${q.contentId}:${q.questionNumber}`)
                  ? "border-emerald-400/25 bg-emerald-400/[0.06]"
                  : "border-rose-400/25 bg-rose-400/[0.06]",
              )}
            >
              <p className="type-caption font-bold">
                {answeredMap.get(`${q.contentId}:${q.questionNumber}`)
                  ? "Answered correctly earlier in this session."
                  : "Missed earlier in this session — the evidence is already recorded."}
              </p>
            </div>
          )}

          {/* Feedback */}
          {result && (
            <div aria-live="polite" className="mt-5 flex flex-col gap-3">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-xl border p-4",
                  result.correct
                    ? "border-emerald-400/25 bg-emerald-400/[0.07]"
                    : "border-rose-400/25 bg-rose-400/[0.07]",
                )}
              >
                {result.correct ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-300" />
                ) : (
                  <XCircle className="size-5 shrink-0 text-rose-300" />
                )}
                <div>
                  <p className={cn("type-body font-bold", result.correct ? "text-emerald-300" : "text-rose-300")}>
                    {result.correct ? "Correct — that's the repair holding." : "Not yet — the misconception is still there."}
                  </p>
                  {!result.correct && pickedOption && (
                    <p className="type-caption mt-0.5 text-muted-foreground">
                      You picked {pickedOption.label}.
                    </p>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3">
                <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
                  Answer key
                </p>
                <p className="type-caption mt-1 text-foreground/90">
                  {correctOption ? `${correctLabel}. ${correctOption.text}` : result.correctAnswer}
                </p>
              </div>

              {result.explanation && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                  <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                    Why
                  </p>
                  <p className="type-caption mt-1 leading-5 text-muted-foreground">{result.explanation}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/read/${q.contentId}`)}
                  className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                >
                  <BookOpen className="size-3.5" /> Open paper
                  {result.sourcePage ? ` · p.${result.sourcePage}` : ""}
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="interactive-press ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary/15 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
                >
                  {idx < session.questions.length - 1 ? "Next question" : "See summary"}
                  <ArrowRight className="size-4" />
                </button>
              </div>

              {result.review && (
                <p className="type-caption text-muted-foreground/70">
                  {result.review.result === "got_it"
                    ? `Review updated — this mistake returns ${relTime(result.review.nextReviewAt)}.`
                    : `Review updated — still unsure, so it comes back ${relTime(result.review.nextReviewAt)}.`}
                </p>
              )}
            </div>
          )}
        </motion.article>
      </AnimatePresence>
    </section>
  );
}

// ── Summary ──────────────────────────────────────────────────────────────

function Summary({ session, onPracticeAgain }: { session: SessionData; onPracticeAgain: () => void }) {
  const navigate = useNavigate();
  const total = session.questions.length;
  const correct = session.firstTryCorrect ?? [...session.attempts.map((a) => a.correct)].filter(Boolean).length;
  const submitted = session.submissionsCount ?? session.attempts.length;
  const result = session.result;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel flex flex-col items-center rounded-2xl px-6 py-10 text-center"
      aria-label="Practice summary"
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-emerald-400/20 blur-2xl" />
        <div className="relative flex size-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06]">
          {result === "got_it" ? (
            <Trophy className="size-7 text-emerald-300" />
          ) : (
            <FlaskConical className="size-7 text-amber-300" />
          )}
        </div>
      </div>

      <h2 className="type-h2 mt-4">
        {result === "got_it"
          ? "Clean run — the repair is holding"
          : result === "still_unsure"
            ? "Honest result — still worth another pass"
            : "Session closed"}
      </h2>

      <p className="type-body mt-2 max-w-md text-muted-foreground">
        {submitted === 0
          ? "You exited without answering, so nothing was recorded and the mistake's schedule is untouched."
          : `${correct} of ${submitted} answered correctly on the first try.`}
        {session.attemptsToFirstCorrect != null && session.attemptsToFirstCorrect > 1
          ? ` First correct answer came on attempt ${session.attemptsToFirstCorrect}.`
          : ""}
      </p>

      {result && (
        <p className="type-caption mt-2 text-muted-foreground/80">
          {result === "got_it"
            ? `Your mistake's review moved forward — next check ${relTime(session.mistake.nextReviewAt)}. One clean pass isn't mastery: it retires only after two spaced clean passes.`
            : `This mistake comes back ${relTime(session.mistake.nextReviewAt)} — spaced re-checks are how repairs stick.`}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/mistakes")}
          className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary/15 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
        >
          <ArrowLeft className="size-4" /> Back to Mistake Lab
        </button>
        {session.mistake.contentId && (
          <button
            type="button"
            onClick={() => navigate(`/read/${session.mistake.contentId}`)}
            className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary"
          >
            <BookOpen className="size-4" /> Open the original paper
          </button>
        )}
        <button
          type="button"
          onClick={onPracticeAgain}
          className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Practice again <ArrowRight className="size-4" />
        </button>
      </div>
    </motion.section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function MistakePractice() {
  const { mistakeId } = useParams<{ mistakeId: string }>();
  const navigate = useNavigate();

  const startPractice = useMutation(api.learning.startMistakePractice);
  const completePractice = useMutation(api.learning.completeMistakePractice);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [finished, setFinished] = useState(false);

  const selection = useQuery(
    api.learning.findSimilarPractice,
    mistakeId ? { mistakeId: mistakeId as never } : "skip",
  );
  const session = useQuery(
    api.learning.getPracticeQuestions,
    sessionId ? { sessionId: sessionId as never } : "skip",
  );

  // A resumed session that is already closed jumps straight to the summary.
  useEffect(() => {
    if (session && session.closed) setFinished(true);
  }, [session]);

  const handleStart = async () => {
    if (!mistakeId) return;
    setStarting(true);
    try {
      const res = await startPractice({ mistakeId: mistakeId as never });
      if (res.started && res.sessionId) {
        setFinished(false);
        setSessionId(res.sessionId);
        if (res.resumed) toast.info("Picked up where you left off.");
      } else {
        toast.error(res.reason || "No practice available right now.");
      }
    } catch {
      toast.error("Could not start the practice session. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const handleExit = () => {
    // Deliberately NOT completed here: an exited session stays resumable,
    // and zero-submission sessions never fabricate a review event.
    navigate("/mistakes");
  };

  // "See summary" — an explicit finish. Applies the session's ONE review
  // event over whatever was submitted (no-op if the last submit already
  // applied it). Exiting without this keeps the session resumable.
  const handleFinished = async () => {
    setFinished(true);
    if (!sessionId) return;
    try {
      await completePractice({ sessionId: sessionId as never });
    } catch {
      // The summary still renders from stored session data.
    }
  };

  const handlePracticeAgain = async () => {
    setSessionId(null);
    setFinished(false);
    await handleStart();
  };

  return (
    <DashboardShell>
      <div className="relative mx-auto w-full max-w-[860px]">
        <div
          className="pointer-events-none absolute -top-16 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[100px]"
          aria-hidden="true"
        />

        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            type="button"
            onClick={() => navigate("/mistakes")}
            className="type-mono inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-primary transition hover:text-amber-300"
          >
            <ArrowLeft className="size-3.5" />
            <FlaskConical className="size-3.5" /> // mistake lab · practice
          </button>
          <h1 className="type-h1 mt-1">Repair the misconception</h1>
          <p className="type-body mt-1 max-w-xl text-muted-foreground">
            A few real questions on the same topic as your mistake — answers from the papers'
            own keys, never invented.
          </p>
        </motion.div>

        <div className="mt-5 flex flex-col gap-3">
          {!sessionId && (
            <>
              {selection === undefined ? (
                <div className="glass-panel h-40 animate-pulse rounded-2xl" />
              ) : selection === null ? (
                <div className="glass-panel rounded-2xl p-6 text-center">
                  <p className="type-h3">Sign in to practice</p>
                </div>
              ) : (
                <>
                  <MistakeContext mistake={selection.mistake} topicLabel={selection.topicLabel} />
                  <PreviewPanel selection={selection} onStart={() => void handleStart()} starting={starting} />
                </>
              )}
            </>
          )}

          {sessionId && session === undefined && (
            <div className="glass-panel h-64 animate-pulse rounded-2xl" />
          )}

          {sessionId && session === null && (
            <div className="glass-panel rounded-2xl p-6 text-center">
              <p className="type-h3">Session not found</p>
              <p className="type-caption mt-1 text-muted-foreground">
                It may belong to another account.
              </p>
              <button
                type="button"
                onClick={() => navigate("/mistakes")}
                className="interactive-press mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary/15 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
              >
                <ArrowLeft className="size-4" /> Back to Mistake Lab
              </button>
            </div>
          )}

          {sessionId &&
            session &&
            (finished ? (
              <Summary session={session} onPracticeAgain={() => void handlePracticeAgain()} />
            ) : (
              <Player
                session={session}
                onExit={handleExit}
                onFinished={() => void handleFinished()}
              />
            ))}
        </div>

        <p className="type-caption mt-6 px-1 text-center text-muted-foreground/50">
          Every question comes from a real digitized paper. If none matches your mistake's topic,
          Learnyx says so — it never invents a substitute.
        </p>
      </div>
    </DashboardShell>
  );
}
