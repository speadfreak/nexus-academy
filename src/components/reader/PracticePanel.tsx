// PracticeSessionPanel — the untimed twin of ReaderExamMode for past papers.
//
// Deep-linked from the Exam Prep hub's Practice button: /read/:id?practice=1.
// Lives inside the normal Reader (the student keeps the AI companion, videos,
// scratchpad and full PDF tooling — REUSE, not a parallel reader), and adds a
// paper-practice layer:
//
//   • Question tracker — the student declares how many questions the paper
//     has, then marks each one answered / flagged for review while working.
//   • Check answer — for the active question, opens the linked answer key
//     side-by-side and lets the student record right/wrong instantly. Exam
//     mode deliberately has none of this (strict conditions there).
//   • Elapsed time + "No time limit" — practice shows how long it's been,
//     never a countdown.
//   • Session highlights — text selected in the paper can be kept for this
//     session (state owned by Reader, passed down).
//   • Finish & log — records an examPrepAttempts row (completed: true) and,
//     when at least one question was checked, the derived self-score %.
//     Streak/XP still flow through studySessions.logSession as everywhere
//     else in the app.
//
// All state here is session-scoped; persistent history lives in the
// examPrepAttempts table via the same mutations ReaderExamMode uses.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  BadgeCheck,
  BookOpenCheck,
  ChevronDown,
  ChevronUp,
  CircleX,
  Clock,
  Flag,
  Highlighter,
  LayoutGrid,
  ListChecks,
  Loader2,
  TimerOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Document, Page as PdfPage } from "react-pdf";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import type { Id } from "@/convex/_generated/dataModel";
import type { AnswerKeyInfo } from "@/components/reader/ReaderExamMode";
import {
  HighlightsList,
  PagePalette,
  QuestionPalette,
  SlimProgress,
  TrackerModeToggle,
  emptyQuestionMap,
  entryOf,
  trackerStats,
  type QuestionEntry,
  type QuestionMap,
  type SessionHighlights,
  type TrackerMode,
} from "@/components/reader/QuestionNavigator";

const QUESTION_PRESETS = [25, 50, 75, 100];

export type PracticePanelHandle = {
  addHighlight: (text: string) => void;
};

export type PracticePanelProps = {
  contentId: Id<"contentItems">;
  contentTitle: string;
  subjectId: Id<"subjects">;
  answerKey: AnswerKeyInfo | null;
  numPages: number;
  currentPage: number;
  onPageJump: (page: number) => void;
  /** Hands a question to the Reader's existing AI companion chat. */
  onAskCompanion: (question: string) => void;
  /** Session highlights owned by the Reader (selection capture lives there). */
  highlights: SessionHighlights[];
  onAddHighlight: (text: string) => void;
  onExit: () => void;
};

type Phase = "setup" | "running" | "finished";

export function PracticeSessionPanel(props: PracticePanelProps) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [countInput, setCountInput] = useState("");
  const [questionCount, setQuestionCount] = useState<number | null>(null);
  const [tracker, setTracker] = useState<QuestionMap>(emptyQuestionMap);
  const [mode, setMode] = useState<TrackerMode>("answers");
  const [activeQuestion, setActiveQuestion] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [navigatorTab, setNavigatorTab] = useState<"questions" | "pages" | "highlights">("questions");
  const [collapsed, setCollapsed] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const logSession = useMutation(api.studySessions.logSession);
  const logExamPrepAttempt = useMutation(api.examPrep.logExamPrepAttempt);
  const rateExamPrepAttempt = useMutation(api.examPrep.rateExamPrepAttempt);

  // Elapsed ticker — practice is untimed; this is informational only.
  useEffect(() => {
    if (phase !== "running") return;
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [phase]);

  const elapsedSeconds =
    startedAt !== null ? Math.max(0, Math.floor((nowTick - startedAt) / 1000)) : 0;
  const formattedElapsed = useMemo(() => {
    const h = Math.floor(elapsedSeconds / 3600);
    const m = Math.floor((elapsedSeconds % 3600) / 60);
    const s = elapsedSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [elapsedSeconds]);

  const stats = trackerStats(tracker, questionCount ?? 0);
  const checked = stats.right + stats.wrong;
  const progressPct = questionCount ? (stats.answered / questionCount) * 100 : 0;

  const startSession = (count: number | null) => {
    setQuestionCount(count);
    setStartedAt(Date.now());
    setPhase("running");
    if (count) {
      toast.info("Practice session started — untimed.", {
        description: `Tracking ${count} questions. Mark answers and flags in the panel below.`,
      });
    }
  };

  const toggleQuestion = (n: number) => {
    setActiveQuestion(n);
    setTracker((prev) => {
      const cur = entryOf(prev, n);
      if (mode === "flags") {
        return { ...prev, [n]: { ...cur, flagged: !cur.flagged } };
      }
      return { ...prev, [n]: { ...cur, answered: !cur.answered } };
    });
  };

  const markCheck = (n: number, check: "right" | "wrong") => {
    setTracker((prev) => {
      const cur = entryOf(prev, n);
      const nextCheck = cur.check === check ? null : check;
      return { ...prev, [n]: { ...cur, check: nextCheck, answered: nextCheck !== null ? true : cur.answered } };
    });
  };

  const handleFinish = async () => {
    if (finishing || startedAt === null) return;
    setFinishing(true);
    const endedAt = Date.now();
    const duration = Math.max(60, Math.min(Math.floor((endedAt - startedAt) / 1000), 24 * 3600));
    try {
      // Streak + XP — same pipeline every other study surface uses.
      await logSession({
        subjectId: props.subjectId,
        durationSeconds: duration,
        startedAt,
        endedAt,
        localDate: localDateKey(new Date(startedAt)),
      });
      // Per-paper attempt history for the hub's My Results timeline.
      let gradedNote = "";
      try {
        const { attemptId } = await logExamPrepAttempt({
          contentId: props.contentId,
          startedAt,
          endedAt,
          durationSeconds: duration,
          completed: true,
        });
        if (checked > 0) {
          const pct = Math.round((stats.right / checked) * 100);
          await rateExamPrepAttempt({ attemptId, selfScorePct: pct });
          gradedNote = ` Score from your checked questions: ${pct}%.`;
        }
      } catch {
        // Non-fatal — the session time is still logged above.
      }
      toast.success("Practice session logged.", {
        description: `${Math.floor(duration / 60)} min on this paper.${gradedNote} Find it under My Results.`,
      });
      setPhase("finished");
      props.onExit();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not log the session.");
    } finally {
      setFinishing(false);
    }
  };

  // ─── Setup: declare the question count once ───────────────────────────
  if (phase === "setup") {
    return (
      <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:pb-5">
        <div className="w-full max-w-md rounded-2xl border border-amber-300/25 bg-[#0b0f17]/95 p-4 shadow-[0_18px_60px_-18px_rgba(251,191,36,0.35)] backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                practice session
              </p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">
                About how many questions does this paper have?
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Untimed. This builds your question tracker — you can skip it.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={props.onExit}
              aria-label="Close practice panel"
              className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {QUESTION_PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant="outline"
                onClick={() => startSession(p)}
                className="cursor-pointer rounded-xl border-amber-300/30 bg-amber-300/[0.07] font-mono text-amber-100 hover:bg-amber-300/20"
              >
                {p}
              </Button>
            ))}
            <div className="flex items-center gap-1.5">
              <Input
                value={countInput}
                onChange={(e) => setCountInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                placeholder="Other"
                inputMode="numeric"
                className="h-8 w-20 rounded-xl bg-white/5 text-center font-mono text-xs"
              />
              <Button
                size="sm"
                onClick={() => {
                  const n = Number(countInput);
                  if (!Number.isFinite(n) || n < 1 || n > 300) {
                    toast.error("Enter a question count between 1 and 300.");
                    return;
                  }
                  startSession(n);
                }}
                disabled={countInput === ""}
                className="cursor-pointer rounded-xl"
              >
                Start
              </Button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => startSession(null)}
            className="mt-3 cursor-pointer text-[11px] font-semibold text-muted-foreground/70 transition-colors hover:text-muted-foreground"
          >
            Skip the tracker — just log my reading time
          </button>
        </div>
      </div>
    );
  }

  // ─── Running: the session bar ──────────────────────────────────────────
  return (
    <>
      <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-3 sm:pb-5">
        <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-amber-300/25 bg-[#0b0f17]/95 shadow-[0_18px_60px_-18px_rgba(251,191,36,0.35)] backdrop-blur">
          {/* Header — title, untimed badge, elapsed, progress, collapse */}
          <div className="px-4 pt-3">
            <div className="flex items-center gap-2">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-300/10">
                <BookOpenCheck className="size-4 text-amber-300" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{props.contentTitle}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-1.5 py-0.5 font-semibold text-emerald-300">
                    <TimerOff className="size-3" /> No time limit
                  </span>
                  <span className="inline-flex items-center gap-1 type-mono tabular-nums">
                    <Clock className="size-3" /> {formattedElapsed}
                  </span>
                  {questionCount !== null && (
                    <span className="type-mono tabular-nums">
                      {stats.answered}/{questionCount} answered
                      {stats.flagged > 0 && ` · ${stats.flagged} flagged`}
                    </span>
                  )}
                  {checked > 0 && (
                    <span className="type-mono tabular-nums text-emerald-300">
                      {stats.right}/{checked} correct
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? "Expand practice panel" : "Collapse practice panel"}
                className="size-8 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
              >
                {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
              </Button>
            </div>
            {questionCount !== null && (
              <div className="mt-2">
                <SlimProgress value={progressPct} tone="emerald" />
              </div>
            )}
          </div>

          {/* Body */}
          {!collapsed && (
            <div className="mt-3 max-h-[46vh] overflow-y-auto border-t border-white/[0.06] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
                  {(
                    [
                      { value: "questions" as const, label: "Questions", icon: ListChecks },
                      { value: "pages" as const, label: "Pages", icon: LayoutGrid },
                      { value: "highlights" as const, label: "Highlights", icon: Highlighter },
                    ]
                  ).map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setNavigatorTab(t.value)}
                      aria-pressed={navigatorTab === t.value}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                        navigatorTab === t.value
                          ? "bg-amber-300/15 text-amber-200"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <t.icon className="size-3" />
                      {t.label}
                    </button>
                  ))}
                </div>
                {navigatorTab === "questions" && questionCount !== null && (
                  <TrackerModeToggle mode={mode} onModeChange={setMode} />
                )}
              </div>

              <div className="mt-3">
                {navigatorTab === "questions" && questionCount === null && (
                  <p className="text-xs text-muted-foreground">
                    No question tracker for this session — use Pages and Highlights below.
                  </p>
                )}
                {navigatorTab === "questions" && questionCount !== null && (
                  <QuestionPalette
                    questionCount={questionCount}
                    tracker={tracker}
                    mode={mode}
                    activeQuestion={activeQuestion}
                    showChecks
                    onToggle={toggleQuestion}
                  />
                )}
                {navigatorTab === "pages" && (
                  <PagePalette numPages={props.numPages} currentPage={props.currentPage} onJump={props.onPageJump} />
                )}
                {navigatorTab === "highlights" && (
                  <HighlightsList highlights={props.highlights} onJump={props.onPageJump} />
                )}
              </div>

              {/* Check answer — practice-only instant feedback */}
              {navigatorTab === "questions" && questionCount !== null && (
                <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-xs font-semibold text-foreground">
                    Check answer{" "}
                    {activeQuestion !== null && (
                      <span className="type-mono text-amber-300">· Q{activeQuestion}</span>
                    )}
                  </p>
                  {props.answerKey ? (
                    <>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Open <span className="font-semibold">{props.answerKey.title}</span> beside
                        the paper, compare, then mark the result for Q{activeQuestion ?? "—"}.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => setKeyOpen(true)}
                          disabled={activeQuestion === null}
                          className="cursor-pointer gap-1.5 rounded-lg"
                        >
                          <BookOpenCheck className="size-3.5" /> Open answer key
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (activeQuestion === null) return;
                            markCheck(activeQuestion, "right");
                          }}
                          disabled={activeQuestion === null}
                          className="cursor-pointer gap-1.5 rounded-lg border-emerald-400/40 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 hover:text-emerald-100"
                        >
                          <BadgeCheck className="size-3.5" /> Got it right
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (activeQuestion === null) return;
                            markCheck(activeQuestion, "wrong");
                          }}
                          disabled={activeQuestion === null}
                          className="cursor-pointer gap-1.5 rounded-lg border-rose-400/40 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20 hover:text-rose-100"
                        >
                          <CircleX className="size-3.5" /> Got it wrong
                        </Button>
                      </div>
                      {activeQuestion === null && (
                        <p className="mt-1.5 text-[10px] text-muted-foreground">
                          Tap a question number in the tracker first, then check it.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      No answer key is linked to this paper yet, so checks are
                      self-marked only — flag questions you're unsure about and
                      ask the AI tutor for concept help.
                    </p>
                  )}
                  {/* AI handoff — always available, key or not. Reuses the
                      Reader's own companion chat (no duplicate AI plumbing). */}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      props.onAskCompanion(
                        activeQuestion !== null
                          ? `I'm working on question ${activeQuestion} of this past paper. Explain the concept it tests and how to approach it.`
                          : "Explain how to approach this paper.",
                      )
                    }
                    className="mt-2 cursor-pointer gap-1.5 rounded-lg"
                  >
                    Ask the AI tutor
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-4 py-2.5">
            <p className="hidden text-[10px] text-muted-foreground sm:block">
              Session history is private to you and feeds the hub's My Results.
            </p>
            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={props.onExit}
                className="cursor-pointer text-muted-foreground"
              >
                Discard
              </Button>
              <Button
                size="sm"
                onClick={() => void handleFinish()}
                disabled={finishing}
                className="cursor-pointer gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              >
                {finishing ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
                Finish &amp; log
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Answer key side sheet — same access control as the Reader itself */}
      {keyOpen && props.answerKey && (
        <AnswerKeySheet
          answerKey={props.answerKey}
          onClose={() => setKeyOpen(false)}
        />
      )}
    </>
  );
}

// ─── Answer key sheet — reuses the Reader's exact access pipeline ────────

function AnswerKeySheet({
  answerKey,
  onClose,
}: {
  answerKey: AnswerKeyInfo;
  onClose: () => void;
}) {
  const [keyPage, setKeyPage] = useState(1);
  const [keyUrl, setKeyUrl] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keyPages, setKeyPages] = useState<number | null>(null);
  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);

  const keyContent = useQuery(
    api.content.getReaderContent,
    answerKey._id ? ({ contentId: answerKey._id } as never) : "skip",
  );
  const keyItem = keyContent?.item ?? null;

  useEffect(() => {
    if (!keyItem) return;
    let cancelled = false;
    const load = async () => {
      try {
        if (keyItem.isPremium) {
          const { url } = await getDownloadUrl({ contentId: keyItem._id });
          if (!cancelled) setKeyUrl(url);
        } else {
          setKeyUrl(keyItem.fileUrl);
        }
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : String(error);
          setKeyError(
            msg.includes("remium") || msg.includes("trial")
              ? "The answer key for this paper is premium. Upgrade to check answers against it."
              : msg,
          );
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [keyItem, getDownloadUrl]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-[min(520px,94vw)] flex-col border-l border-white/10 bg-[#0b0f17]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              answer key
            </p>
            <p className="truncate text-sm font-semibold text-foreground">{answerKey.title}</p>
          </div>
          <div className="flex items-center gap-1.5">
            {keyPages !== null && (
              <span className="type-mono text-xs tabular-nums text-muted-foreground">
                {keyPage}/{keyPages}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={() => setKeyPage((p) => Math.max(1, p - 1))} disabled={keyPage <= 1} className="cursor-pointer">
              Prev
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setKeyPage((p) => Math.min(keyPages ?? 1, p + 1))}
              disabled={keyPages === null || keyPage >= keyPages}
              className="cursor-pointer"
            >
              Next
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close answer key"
              className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#080c14] p-4">
          {keyError ? (
            <p className="rounded-xl border border-amber-300/25 bg-amber-300/[0.06] p-3 text-xs text-amber-200">
              {keyError}
            </p>
          ) : keyUrl ? (
            <div className="mx-auto w-fit">
              <Document
                file={{ url: keyUrl }}
                onLoadSuccess={({ numPages }: { numPages: number }) => setKeyPages(numPages)}
                loading={
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                }
                error={
                  <p className="p-4 text-xs text-muted-foreground">Could not render the answer key.</p>
                }
              >
                <PdfPage pageNumber={keyPage} renderTextLayer={false} renderAnnotationLayer={false} />
              </Document>
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="shrink-0 border-t border-white/10 px-4 py-2">
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Flag className="size-3 text-amber-300/80" />
            Compare with the paper, then tap “Got it right / wrong” in the practice panel.
          </p>
        </div>
      </div>
    </div>
  );
}
