// ═══════════════════════════════════════════════════════════════════════
// MISTAKE LAB — the spaced-revision queue for every wrong answer (2.0)
// ═══════════════════════════════════════════════════════════════════════
// Every missed question in digital past papers, AI quizzes, mock exams and
// the daily challenge lands here with its verbatim snapshot: what was
// asked, the VERIFIED correct answer (never AI-overridden), the student's
// answer, and provenance (official paper + source page vs AI practice).
//
// The review ladder is simple and explainable:
//   miss → due now → "still unsure" rechecks in 6h →
//   got it ×1 → 1 day → got it ×2 → 3 days → mistake retired (doubling
//   continues from 3 if it's ever reopened, capped at 21 days).
// Every "got it" also feeds positive evidence back into topic mastery, so
// revision closes the loop instead of being a dead end.
// ═══════════════════════════════════════════════════════════════════════

import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  Clock,
  FileText,
  FlaskConical,
  Inbox,
  RotateCcw,
  Sparkles,
  Trophy,
  X,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { cn } from "@/lib/utils";

type MistakeRow = FunctionReturnType<typeof api.learning.listMistakes>[number];

type Tab = "due" | "open" | "mastered";

const TABS: { id: Tab; label: string }[] = [
  { id: "due", label: "Due now" },
  { id: "open", label: "All open" },
  { id: "mastered", label: "Mastered" },
];

function relTime(ms: number): string {
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const unit =
    mins < 60 ? `${mins}m` : hours < 48 ? `${hours}h` : `${days}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} overdue`;
}

const SOURCE_LABEL: Record<string, string> = {
  digital_paper: "Past paper",
  quiz: "Practice quiz",
  mock_exam: "Mock exam",
  daily_challenge: "Daily challenge",
};

function ProvenanceBadge({ row }: { row: MistakeRow }) {
  if (row.origin === "official") {
    return (
      <span className="type-caption inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
        <FileText className="size-3" /> Official paper
      </span>
    );
  }
  return (
    <span className="type-caption inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      <Sparkles className="size-3" /> AI practice
    </span>
  );
}

function MistakeCard({
  row,
  index,
}: {
  row: MistakeRow;
  index: number;
}) {
  const navigate = useNavigate();
  const reviewMistake = useMutation(api.learning.reviewMistake);
  const dismissMistake = useMutation(api.learning.dismissMistake);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const handleReview = async (result: "got_it" | "still_unsure") => {
    setBusy(result);
    try {
      const res = await reviewMistake({ mistakeId: row._id, result });
      if (res.status === "mastered") {
        setDone("mastered");
        toast.success("Mastered — this mistake is retired. Nice work.");
      } else {
        setDone(result);
        toast.success(
          result === "got_it"
            ? `Scheduled again ${relTime(res.nextReviewAt)}.`
            : "Noted — it'll come back later today.",
        );
      }
    } catch {
      toast.error("Could not record your review. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleDismiss = async () => {
    setBusy("dismiss");
    try {
      await dismissMistake({ mistakeId: row._id });
      setDone("dismissed");
      toast.info("Dismissed — it won't appear in your queue again.");
    } catch {
      toast.error("Could not dismiss this mistake.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={done ? { opacity: 0.45, scale: 0.985 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.2), ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "glass-panel relative overflow-hidden rounded-2xl p-4 sm:p-5",
        row.due && !done && "border-primary/30",
        done === "mastered" && "border-emerald-400/25",
      )}
    >
      {/* Header — provenance + subject + due state */}
      <div className="flex flex-wrap items-center gap-2">
        <ProvenanceBadge row={row} />
        <span className="type-caption rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {SOURCE_LABEL[row.source] ?? row.source}
        </span>
        <span className="type-caption rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {row.subjectName}
        </span>
        {row.topicText && (
          <span className="type-caption rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            {row.topicText}
          </span>
        )}
        <span
          className={cn(
            "type-caption ml-auto inline-flex items-center gap-1 text-[10px] font-semibold",
            row.due && !done ? "text-amber-300" : "text-muted-foreground/60",
          )}
        >
          <Clock className="size-3" />
          {row.status === "mastered"
            ? "retired"
            : row.due
              ? `due ${row.reviewCount > 0 ? "again" : "now"}`
              : relTime(row.nextReviewAt)}
        </span>
      </div>

      {/* Question */}
      <p className="type-body mt-3 font-semibold leading-6 text-foreground/95">
        {row.questionText}
      </p>

      {/* Answers */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {row.studentAnswer && (
          <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3">
            <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-rose-300/80">
              Your answer
            </p>
            <p className="type-caption mt-1 text-foreground/85">{row.studentAnswer}</p>
          </div>
        )}
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
          <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
            Correct answer
          </p>
          <p className="type-caption mt-1 text-foreground/85">{row.correctAnswer}</p>
        </div>
      </div>

      {/* Explanation */}
      {row.explanation && (
        <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
          <p className="type-caption text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            Why
          </p>
          <p className="type-caption mt-1 leading-5 text-muted-foreground">{row.explanation}</p>
        </div>
      )}

      {/* Footer — actions + provenance links */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {row.status !== "mastered" && !done && (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleReview("got_it")}
              className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-400/15 px-3 py-2 text-xs font-bold text-emerald-300 transition hover:bg-emerald-400/25 disabled:opacity-50"
            >
              {busy === "got_it" ? <RotateCcw className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
              Got it
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleReview("still_unsure")}
              className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
            >
              {busy === "still_unsure" ? <RotateCcw className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
              Still unsure
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleDismiss()}
              title="Dismiss — remove from the queue"
              aria-label="Dismiss this mistake"
              className="interactive-press ml-auto inline-flex cursor-pointer items-center justify-center rounded-xl p-2 text-muted-foreground/60 transition hover:bg-rose-400/10 hover:text-rose-300 disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
        {row.status === "mastered" && (
          <span className="type-caption inline-flex items-center gap-1.5 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
            <Trophy className="size-3.5" /> Retired after {row.reviewCount} review{row.reviewCount === 1 ? "" : "s"}
          </span>
        )}
        {done === "mastered" && (
          <span className="type-caption inline-flex items-center gap-1.5 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-300">
            <Trophy className="size-3.5" /> Mastered just now
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {row.contentId && (
            <button
              type="button"
              onClick={() => navigate(`/read/${row.contentId}`)}
              className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              <BookOpen className="size-3.5" />
              Open paper{row.sourcePage ? ` · p.${row.sourcePage}` : ""}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(`/mistakes/practice/${row._id}`)}
            className="interactive-press inline-flex cursor-pointer items-center gap-1 rounded-xl px-3 py-2 text-xs font-semibold text-amber-300/80 transition hover:text-amber-300"
          >
            Practice similar <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </motion.article>
  );
}

export default function Mistakes() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("due");

  const stats = useQuery(api.learning.getMistakeStats);
  const rows = useQuery(api.learning.listMistakes, {
    status: tab === "mastered" ? "mastered" : "open",
    dueOnly: tab === "due",
    limit: 100,
  });

  const loading = rows === undefined;
  const list = rows ?? [];

  return (
    <DashboardShell>
      <div className="relative mx-auto w-full max-w-[1100px]">
        <div
          className="pointer-events-none absolute -top-16 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[100px]"
          aria-hidden="true"
        />

        {/* Header */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="type-mono flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
                <FlaskConical className="size-3.5" /> // mistake lab
              </p>
              <h1 className="type-h1 mt-1">Review what tripped you</h1>
              <p className="type-body mt-1 max-w-xl text-muted-foreground">
                Every miss from past papers, quizzes and mocks, queued for
                spaced revision. Two clean passes retire a mistake for good.
              </p>
            </div>
            {stats && (
              <div className="flex gap-2">
                <div className="glass-panel rounded-xl px-3.5 py-2.5 text-center">
                  <p className="type-h3 text-amber-300">{stats.dueNow}</p>
                  <p className="type-caption text-muted-foreground/70">due now</p>
                </div>
                <div className="glass-panel rounded-xl px-3.5 py-2.5 text-center">
                  <p className="type-h3">{stats.open}</p>
                  <p className="type-caption text-muted-foreground/70">open</p>
                </div>
                <div className="glass-panel rounded-xl px-3.5 py-2.5 text-center">
                  <p className="type-h3 text-emerald-300">{stats.mastered}</p>
                  <p className="type-caption text-muted-foreground/70">mastered</p>
                </div>
              </div>
            )}
          </div>
        </motion.div>

        {/* Tabs */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05 }}
          className="mt-5 flex gap-1 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-1 sm:w-fit"
          role="tablist"
          aria-label="Mistake queue filters"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative flex-1 cursor-pointer rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider transition-colors sm:flex-none",
                  active ? "text-amber-200" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="mistakes-tab-bg"
                    className="absolute inset-0 rounded-xl bg-primary/15"
                    transition={{ type: "spring", stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </button>
            );
          })}
        </motion.div>

        {/* Queue */}
        <div className="mt-4 flex flex-col gap-3">
          {loading ? (
            <div className="flex flex-col gap-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="glass-panel h-40 animate-pulse rounded-2xl"
                  style={{ animationDelay: `${i * 90}ms` }}
                />
              ))}
            </div>
          ) : list.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="glass-panel flex flex-col items-center justify-center gap-3 rounded-2xl px-6 py-14 text-center"
            >
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-emerald-400/20 blur-2xl" />
                <div className="relative flex size-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06]">
                  {tab === "mastered" ? (
                    <Trophy className="size-7 text-emerald-300" />
                  ) : (
                    <CheckCheck className="size-7 text-emerald-300" />
                  )}
                </div>
              </div>
              <div>
                <p className="type-h3">
                  {tab === "due"
                    ? "Nothing due right now"
                    : tab === "open"
                      ? "No open mistakes"
                      : "No retired mistakes yet"}
                </p>
                <p className="type-caption mx-auto mt-1 max-w-md text-muted-foreground">
                  {tab === "mastered"
                    ? "Retire a mistake by getting it right on two spaced reviews — it'll show up here."
                    : "Mistakes appear here the moment you miss a question in a past paper, quiz, mock exam or the daily challenge. Keep practicing — the lab does the remembering for you."}
                </p>
              </div>
              {tab !== "mastered" && (
                <button
                  type="button"
                  onClick={() => navigate("/exam-prep?tab=practice")}
                  className="interactive-press inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary/15 px-4 py-2.5 text-sm font-bold text-primary transition hover:bg-primary/25"
                >
                  <Inbox className="size-4" /> Go practice
                  <ChevronRight className="size-4" />
                </button>
              )}
            </motion.div>
          ) : (
            <AnimatePresence initial={false}>
              {list.map((row, i) => (
                <MistakeCard key={row._id} row={row} index={i} />
              ))}
            </AnimatePresence>
          )}
        </div>

        {/* Honesty footer */}
        <p className="type-caption mt-6 px-1 text-center text-muted-foreground/50">
          Provenance is always shown: answers from official past papers come
          from the paper's own key — AI never rewrites them.
        </p>
      </div>
    </DashboardShell>
  );
}
