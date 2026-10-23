// MATRIC OS — Results Intelligence (Phase 7).
//
// The competitive advantage isn't the score — it's what happens after it:
//   overall + per-subject breakdown → topic-level diagnosis of exactly which
//   concepts cost the marks → verified explanations → Mistake Lab /
//   Practice Similar hand-off → next study mission. Honest by design: no
//   invented "predicted national exam score", only measured performance.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Link } from "react-router";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  Flame,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AiText } from "@/components/math";
import { cn } from "@/lib/utils";

interface ResultsViewProps {
  sessionId: Id<"matricSessions">;
  onBack: () => void;
}

function bandLabel(score: number): { label: string; className: string } {
  if (score >= 85) return { label: "Excellent", className: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 70) return { label: "Strong pass", className: "text-emerald-600 dark:text-emerald-400" };
  if (score >= 50) return { label: "Fair — keep pushing", className: "text-amber-600 dark:text-amber-400" };
  return { label: "Needs work — the plan is below", className: "text-destructive" };
}

export function ResultsView({ sessionId, onBack }: ResultsViewProps) {
  const data = useQuery(api.matricEngine.getSessionResults, { sessionId });
  const [openSections, setOpenSections] = useState<Set<number>>(new Set([0]));

  if (!data) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-3 text-muted-foreground">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-sm">Loading results…</span>
      </div>
    );
  }

  if (!data.graded) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <Trophy className="mx-auto size-10 text-muted-foreground" />
        <h2 className="mt-3 text-lg font-bold tracking-tight">Not graded yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This sitting is {data.status.toLowerCase()}. Results appear here the moment grading completes.
        </p>
        <Button className="mt-4 cursor-pointer" variant="outline" onClick={onBack}>
          Back to Matric OS
        </Button>
      </div>
    );
  }

  const { result, review, history, session } = data;
  const band = bandLabel(result.totalScore);
  const prev = history[history.length - 1];
  const delta = prev ? result.totalScore - prev.totalScore : null;

  // Weakest topics: lowest correct ratio with at least 2 questions.
  const weakTopics = result.topics
    .filter((t) => t.total >= 2 && t.correct / t.total < 0.6)
    .sort((a, b) => a.correct / a.total - b.correct / b.total)
    .slice(0, 5);
  const strongTopics = result.topics
    .filter((t) => t.total >= 2 && t.correct / t.total >= 0.8)
    .sort((a, b) => b.correct / b.total - a.correct / a.total)
    .slice(0, 4);

  const toggleSection = (idx: number) =>
    setOpenSections((prevSet) => {
      const next = new Set(prevSet);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pb-16 pt-4 sm:pt-6">
      {/* Score header */}
      <div className="rounded-2xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {session.mode === "full_simulation"
                ? "Full Matric Simulation"
                : session.mode === "subject_mock"
                  ? "Subject Mock"
                  : session.mode === "weakness_challenge"
                    ? "Weakness Challenge"
                    : "Past Paper Simulation"}
              {session.reducedPractice ? " · reduced practice" : ""}
            </p>
            <h1 className="mt-1 text-xl font-bold tracking-tight">{session.title}</h1>
          </div>
          <div className="text-right">
            <p className={cn("font-mono text-4xl font-black tabular-nums", band.className)}>
              {result.totalScore}%
            </p>
            <p className={cn("text-xs font-semibold", band.className)}>{band.label}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Correct" value={result.totalCorrect} tone="good" />
          <Stat label="Incorrect" value={result.totalIncorrect} tone="bad" />
          <Stat label="Unanswered" value={result.totalUnanswered} tone="muted" />
          <Stat
            label="Time"
            value={`${Math.floor(result.timeSpentSeconds / 60)}m`}
            tone="muted"
          />
        </div>
        {delta !== null && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {delta >= 0 ? (
              <TrendingUp className="size-3.5 text-emerald-500" />
            ) : (
              <TrendingDown className="size-3.5 text-destructive" />
            )}
            {delta >= 0 ? "+" : ""}
            {delta} points vs your last {session.mode.replace("_", " ")} ({prev?.totalScore}%)
          </p>
        )}
      </div>

      {/* Per-subject breakdown */}
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-bold tracking-tight">Section breakdown</h2>
        <div className="mt-3 space-y-3">
          {result.sections.map((s) => {
            const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
            return (
              <div key={s.sectionIndex}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{s.subjectName}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {s.correct}/{s.total} · {pct}% · {Math.round(s.timeSpentSeconds / 60)}m
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-destructive",
                    )}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Topic diagnosis + next mission */}
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <Target className="size-4 text-primary" />
          What cost you marks
        </h2>
        {weakTopics.length > 0 ? (
          <>
            <ul className="mt-3 space-y-2">
              {weakTopics.map((t) => (
                <li key={`${t.subjectSlug}-${t.topicText}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="text-muted-foreground">{t.subjectSlug.replace(/-/g, " ")} · </span>
                    {t.topicText}
                  </span>
                  <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                    {t.correct}/{t.total}
                  </Badge>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild size="sm" className="cursor-pointer">
                <Link to="/mistakes">
                  <Flame className="size-4" />
                  Open Mistake Lab
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline" className="cursor-pointer">
                <Link to="/exam-prep">Practice similar questions</Link>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Your mistakes from this exam are already in the Mistake Lab with Practice Similar ready —
              that loop (exam → diagnosis → targeted practice) is the whole point.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No systematic weak topics detected in this sitting — clean performance across topics. Take a
            longer mock to stress-test more of the syllabus.
          </p>
        )}
        {strongTopics.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-semibold text-muted-foreground">Locked in ✓</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {strongTopics.map((t) => t.topicText).join(" · ")}
            </p>
          </div>
        )}
      </section>

      {/* Question-by-question review */}
      <section className="rounded-2xl border bg-card p-5">
        <h2 className="text-sm font-bold tracking-tight">Question review</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Verified answers and explanations, straight from the vault snapshot of your sitting.
        </p>
        <div className="mt-3 space-y-2">
          {review.map((sec) => {
            const open = openSections.has(sec.sectionIndex);
            const secIncorrect = sec.items.filter((i) => !i.correct).length;
            return (
              <div key={sec.sectionIndex} className="overflow-hidden rounded-xl border">
                <button
                  onClick={() => toggleSection(sec.sectionIndex)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 bg-muted/40 px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold">
                    {sec.subjectName}
                    <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                      {sec.items.length - secIncorrect}/{sec.items.length}
                    </span>
                  </span>
                  <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                </button>
                {open && (
                  <div className="divide-y">
                    {sec.items.map((item) => (
                      <div key={item.number} className="px-4 py-3">
                        <div className="flex items-start gap-2">
                          {item.correct ? (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                          ) : item.unanswered ? (
                            <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-sm leading-relaxed">
                              <AiText text={item.stem} />
                            </div>
                            {item.passage && (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-muted-foreground">
                                  passage
                                </summary>
                                <div className="mt-1 rounded-lg border bg-muted/30 p-2 text-xs leading-relaxed">
                                  <AiText text={item.passage} />
                                </div>
                              </details>
                            )}
                            <div className="mt-2 space-y-1 text-xs">
                              <p className="text-emerald-700 dark:text-emerald-400">
                                <span className="font-semibold">Correct ({item.correctLabel}):</span>{" "}
                                {item.options.find((o) => o.label === item.correctLabel)?.text}
                              </p>
                              {!item.correct && (
                                <p className={item.unanswered ? "text-muted-foreground" : "text-destructive"}>
                                  <span className="font-semibold">
                                    {item.unanswered ? "Unanswered" : `Your answer (${item.studentLabel}):`}
                                  </span>{" "}
                                  {item.unanswered
                                    ? "— scored zero"
                                    : item.options.find((o) => o.label === item.studentLabel)?.text}
                                </p>
                              )}
                              {item.explanation && (
                                <p className="rounded-lg bg-muted/40 p-2 leading-relaxed">
                                  <AiText text={item.explanation} />
                                </p>
                              )}
                              {(item.sourceName || item.contentId) && (
                                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <BookOpen className="size-3" />
                                  {item.sourceName ?? "Past paper"}
                                  {item.examYear ? ` · ${item.examYear}` : ""}
                                  {item.sourcePage ? ` · p.${item.sourcePage}` : ""}
                                  {item.contentId && (
                                    <Link
                                      to={`/read/${item.contentId}`}
                                      className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                    >
                                      open source <ExternalLink className="size-3" />
                                    </Link>
                                  )}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* History strip */}
      {history.length > 0 && (
        <section className="rounded-2xl border bg-card p-5">
          <h2 className="text-sm font-bold tracking-tight">Progress</h2>
          <div className="mt-3 space-y-2">
            {[...history].reverse().map((h) => (
              <div key={h.sessionId} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 truncate text-muted-foreground">
                  {new Date(h.startedAt).toLocaleDateString()}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${Math.max(h.totalScore, 2)}%` }}
                  />
                </div>
                <span className="w-10 text-right font-mono tabular-nums">{h.totalScore}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex justify-center">
        <Button variant="outline" className="cursor-pointer" onClick={onBack}>
          Back to Matric OS
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone: "good" | "bad" | "muted" }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "font-mono text-lg font-bold tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-destructive",
        )}
      >
        {value}
      </p>
    </div>
  );
}
