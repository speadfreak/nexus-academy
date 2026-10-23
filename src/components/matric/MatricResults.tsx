// Matric OS — Results Intelligence (Phase 7).
//
// THE LEARNYX LOOP: Mock Exam → Results → Mistake Lab → Practice Similar →
// Exam Twin → Next Study Mission. This screen shows MEASURED performance
// (real questions, real answer keys) and routes the student straight into
// the next action their evidence supports. No predicted national-exam
// scores — ever.

import { useMemo } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import type { MatricResultsPayload } from "@/convex/matricEngine";
import { AiText } from "@/components/math";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Trophy,
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Wrench,
  Clock3,
  ArrowRight,
  BookOpenCheck,
  Flame,
  FileText,
  CircleCheck,
  CircleX,
  CircleDashed,
} from "lucide-react";

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtSeconds(s: number | null | undefined): string {
  if (s === null || s === undefined) return "—";
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** SVG donut for the headline score. */
function ScoreDonut({ pct }: { pct: number }) {
  const r = 56;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * c;
  const stroke =
    pct >= 70 ? "#34d399" : pct >= 50 ? "#fbbf24" : "#fb7185";
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 128 128" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <motion.circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
          initial={{ strokeDasharray: `0 ${c}` }}
          animate={{ strokeDasharray: `${filled} ${c - filled}` }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-extrabold text-foreground">{pct}%</span>
        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">score</span>
      </div>
    </div>
  );
}

export function MatricResults({
  results,
  onBackToHub,
}: {
  results: MatricResultsPayload;
  onBackToHub: () => void;
}) {
  const navigate = useNavigate();

  const reviewRows = useMemo(() => results.perQuestion, [results.perQuestion]);
  const delta = results.comparison.deltaVsPrevious;

  return (
    <div className="flex flex-col gap-6">
      {/* ── SCORE HERO ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-400/[0.04] via-white/[0.01] to-transparent p-6 sm:p-8"
      >
        <div className="pointer-events-none absolute -top-20 -right-16 size-56 rounded-full bg-amber-400/8 blur-[70px]" />
        <div className="relative flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <ScoreDonut pct={results.scorePct} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/5 px-3 py-1">
              <Trophy className="size-3.5 text-amber-300" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
                {results.title}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-extrabold text-foreground sm:text-3xl">
              {results.correctCount} / {results.totalQuestions} correct
            </h1>
            <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-1 text-xs text-emerald-200">
                <CircleCheck className="size-3.5" /> {results.correctCount} correct
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-400/25 bg-rose-400/[0.06] px-2.5 py-1 text-xs text-rose-200">
                <CircleX className="size-3.5" /> {results.incorrectCount} incorrect
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-muted-foreground">
                <CircleDashed className="size-3.5" /> {results.unansweredCount} unanswered
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/40 px-2.5 py-1 text-xs text-muted-foreground">
                <Flame className="size-3.5 text-amber-300" /> +{results.xpAwarded} XP
              </span>
            </div>
            {results.submissionSource === "auto_expiry" && (
              <p className="mt-3 text-xs text-amber-300">
                Time expired — the server submitted your saved answers automatically.
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Scored {results.gradedAt ? fmtDate(results.gradedAt) : ""} against the papers' own
              verified answer keys · {fmtSeconds(results.timeSpentSeconds)} used of{" "}
              {fmtSeconds(results.timeLimitSeconds)}
            </p>
          </div>
        </div>

        {/* Comparison vs previous sittings — real history only */}
        {results.comparison.previousSessions.length > 0 && (
          <div className="relative mt-6 rounded-2xl border border-border/70 bg-card/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                {delta === null ? (
                  <Minus className="size-4 text-muted-foreground" />
                ) : delta >= 0 ? (
                  <TrendingUp className="size-4 text-emerald-300" />
                ) : (
                  <TrendingDown className="size-4 text-rose-300" />
                )}
                {delta === null
                  ? "First sitting on this mode"
                  : `${delta >= 0 ? "+" : ""}${delta}% vs your last sitting`}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {results.comparison.previousSessions.map((p) => (
                  <span
                    key={p.sessionId}
                    className="rounded-lg border border-border/60 px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    {fmtDate(p.startedAt)} · {p.scorePct}%
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* ── NEXT ACTIONS — the Learnyx loop ── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => navigate("/mistakes")}
          className="group rounded-2xl border border-rose-400/25 bg-gradient-to-br from-rose-400/[0.06] to-transparent p-4 text-left transition-colors hover:border-rose-400/50"
        >
          <div className="flex items-center justify-between">
            <Wrench className="size-5 text-rose-300" />
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 font-bold text-foreground">Mistake Lab</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {results.nextActions.dueMistakes > 0
              ? `${results.nextActions.dueMistakes} mistake${results.nextActions.dueMistakes === 1 ? "" : "s"} due for review — including new ones from this exam`
              : "Review every question you missed, spaced-repetition style"}
          </p>
        </button>
        <button
          type="button"
          onClick={() => navigate("/exam-prep?tab=practice")}
          className="group rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-400/[0.06] to-transparent p-4 text-left transition-colors hover:border-amber-400/50"
        >
          <div className="flex items-center justify-between">
            <Target className="size-5 text-amber-300" />
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 font-bold text-foreground">Practice Similar</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {results.nextActions.weakestTopics.length > 0
              ? `Drill ${results.nextActions.weakestTopics[0]!.topicText} — your weakest topic in this sitting`
              : "Practice real questions on the topics you missed"}
          </p>
        </button>
        <button
          type="button"
          onClick={() => navigate("/exam-prep?tab=overview")}
          className="group rounded-2xl border border-teal-400/25 bg-gradient-to-br from-teal-400/[0.06] to-transparent p-4 text-left transition-colors hover:border-teal-400/50"
        >
          <div className="flex items-center justify-between">
            <BookOpenCheck className="size-5 text-teal-300" />
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </div>
          <p className="mt-3 font-bold text-foreground">Exam Twin</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This sitting just updated your topic evidence — see what your twin says now
          </p>
        </button>
      </section>

      {/* ── SUBJECT BREAKDOWN ── */}
      {results.subjectBreakdown.length > 1 && (
        <section>
          <h2 className="text-lg font-bold">Subject breakdown</h2>
          <div className="mt-3 flex flex-col gap-2">
            {results.subjectBreakdown.map((s) => (
              <div key={s.subjectId} className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{s.subjectName}</span>
                  <span className="text-muted-foreground">
                    {s.correct}/{s.total} · {s.scorePct}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      s.scorePct >= 70 ? "bg-emerald-400" : s.scorePct >= 50 ? "bg-amber-400" : "bg-rose-400"
                    }`}
                    style={{ width: `${s.scorePct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── TOPIC BREAKDOWN ── */}
      {results.topicBreakdown.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Topics that cost you marks</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Measured from this sitting — the same evidence now lives in your Exam Twin.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {[...results.topicBreakdown]
              .sort((a, b) => a.scorePct - b.scorePct)
              .slice(0, 8)
              .map((t) => (
                <div key={t.key} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{t.topicText}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t.correct}/{t.total}
                  </span>
                  <Badge
                    variant="outline"
                    className={`shrink-0 ${
                      t.scorePct >= 70
                        ? "border-emerald-400/40 text-emerald-200"
                        : t.scorePct >= 50
                          ? "border-amber-400/40 text-amber-200"
                          : "border-rose-400/40 text-rose-200"
                    }`}
                  >
                    {t.scorePct}%
                  </Badge>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ── TIME STATS ── */}
      {results.timeStats && (
        <section className="rounded-2xl border border-border/60 bg-card/40 p-4">
          <h2 className="flex items-center gap-2 text-sm font-bold">
            <Clock3 className="size-4 text-muted-foreground" /> Pacing
          </h2>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>
              Avg per question: <strong className="text-foreground">{fmtSeconds(results.timeStats.avgSeconds)}</strong>
            </span>
            <span>
              Slowest: <strong className="text-foreground">{fmtSeconds(results.timeStats.slowestSeconds)}</strong>
            </span>
            <span>
              Fastest: <strong className="text-foreground">{fmtSeconds(results.timeStats.fastestSeconds)}</strong>
            </span>
          </div>
        </section>
      )}

      {/* ── QUESTION-BY-QUESTION REVIEW ── */}
      <section>
        <h2 className="text-lg font-bold">Question review</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Every question with its verified answer and the source paper's own explanation.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          {reviewRows.map((q) => {
            const tone = !q.answered
              ? "border-border/60"
              : q.correct
                ? "border-emerald-400/30"
                : "border-rose-400/30";
            return (
              <details key={q.index} className={`group rounded-xl border bg-card/40 ${tone}`}>
                <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
                  <span
                    className={`mt-0.5 shrink-0 ${
                      !q.answered ? "text-muted-foreground" : q.correct ? "text-emerald-300" : "text-rose-300"
                    }`}
                  >
                    {!q.answered ? (
                      <CircleDashed className="size-4" />
                    ) : q.correct ? (
                      <CircleCheck className="size-4" />
                    ) : (
                      <CircleX className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-open:whitespace-normal">
                      {q.stem
                        .replace(/\$\$[\s\S]*?\$\$/g, " [math] ")
                        .replace(/\\\[[\s\S]*?\\\]/g, " [math] ")
                        .replace(/\$[^$]*\$/g, " [math] ")
                        .replace(/\\\([\s\S]*?\\\)/g, " [math] ")
                        .replace(/[#*_`\\{}]/g, "")
                        .replace(/\s+/g, " ")
                        .trim()
                        .slice(0, 110)}
                      {q.stem.length > 110 ? "…" : ""}
                    </span>
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Q{q.index + 1} · {q.paperTitle}
                      {q.examYear ? ` · ${q.examYear}` : ""}
                      {q.topicText ? ` · ${q.topicText}` : ""}
                    </span>
                  </span>
                </summary>
                <div className="border-t border-border/50 px-4 py-4">
                  <div className="text-sm leading-relaxed">
                    <AiText text={q.stem} />
                  </div>
                  {q.passage && (
                    <div className="mt-2 rounded-lg border border-border/50 bg-background/40 p-3 text-xs leading-relaxed text-muted-foreground">
                      <AiText text={q.passage} />
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        q.correct
                          ? "border-emerald-400/30 bg-emerald-400/[0.05]"
                          : "border-rose-400/30 bg-rose-400/[0.05]"
                      }`}
                    >
                      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Your answer</p>
                      <p className="mt-0.5 font-medium">
                        {q.studentAnswerLabel
                          ? `${q.studentAnswerLabel}. ${q.studentAnswerText ?? ""}`
                          : "Not answered"}
                      </p>
                    </div>
                    <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/[0.05] px-3 py-2">
                      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Verified answer</p>
                      <p className="mt-0.5 font-medium">
                        {q.correctAnswerLabel}. {q.correctAnswerText}
                      </p>
                    </div>
                  </div>
                  {q.choices && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {q.choices.map((c) => (
                        <span
                          key={c.label}
                          className={`inline-flex max-w-full items-start gap-1 rounded-md border px-2 py-1 text-[11px] ${
                            c.label === q.correctAnswerLabel
                              ? "border-emerald-400/40 text-emerald-200"
                              : c.label === q.studentAnswerLabel
                                ? "border-rose-400/40 text-rose-200"
                                : "border-border/50 text-muted-foreground"
                          }`}
                        >
                          <span className="font-bold">{c.label}.</span>
                          <span className="min-w-0 [&_.lyx-md]:text-[11px]">
                            <AiText text={c.text} as="span" />
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                  {q.explanation && (
                    <div className="mt-3 rounded-lg border border-border/50 bg-background/40 p-3 text-xs leading-relaxed">
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
                        Explanation (from the source paper's answer key)
                      </p>
                      <AiText text={q.explanation} />
                    </div>
                  )}
                  <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      {q.paperTitle}
                      {q.sourcePage ? ` · page ${q.sourcePage}` : ""}
                      {q.questionNumber ? ` · Q${q.questionNumber}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => navigate(`/exam-prep/digital/${q.contentId}`)}
                      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                    >
                      <FileText className="size-3" /> Open source paper
                    </button>
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <div className="flex justify-center pb-4">
        <Button variant="outline" onClick={onBackToHub}>
          Back to Matric OS hub
        </Button>
      </div>
    </div>
  );
}
