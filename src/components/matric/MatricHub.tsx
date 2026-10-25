// Matric OS — Hub: the four student modes with REAL eligibility, now fully
// stream-aware (MATRIC OS 2.1).
//
// Every number on this screen is measured from the verified vault —
// eligible question counts, paper counts, verified-key counts. Modes with
// insufficient coverage are shown honestly as unavailable (with the
// reason), never silently shrinked or filled with unverified content.
// Learnyx practice configurations are labeled as such — no claim of
// official ESA format equivalence anywhere.
//
// Stream rules (spec §5/§6):
//   - The student's saved stream (userProfiles — canonical) drives ordering
//     and grouping. It NEVER gates anything here: eligibility is enforced
//     server-side in startMatricExam; this UI is presentation only.
//   - An unselected stream shows a graceful prompt + Settings shortcut —
//     no silent default to Natural Science.
//   - The other stream is reachable via an explicit, clearly-labeled
//     exploration toggle that does NOT modify the academic profile and
//     marks such sittings as exploratory forever.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import type { CatalogPayload, PastPaperOption } from "@/convex/matricEngine";
import type { MatricHistoryRow, MatricJourneyPayload } from "@/convex/matricEngine";
import type { SubjectEligibilityStream } from "@/lib/matric/eligibility";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GraduationCap,
  Zap,
  Target,
  FileText,
  Lock,
  Clock,
  ListChecks,
  ShieldCheck,
  Play,
  History,
  Database,
  ChevronRight,
  RotateCcw,
  CircleAlert,
  BookOpenCheck,
  Compass,
  Settings2,
  Route,
  BarChart3,
  Eye,
} from "lucide-react";

function minutes(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(seconds / 60)} min`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STREAM_CHIP: Record<Exclude<SubjectEligibilityStream, "common">, string> = {
  natural: "border-teal-400/30 bg-teal-400/[0.06] text-teal-700 dark:text-teal-200",
  social: "border-violet-400/30 bg-violet-400/[0.06] text-violet-700 dark:text-violet-200",
};

function streamChipClass(stream: string | null | undefined): string {
  if (stream === "natural") return STREAM_CHIP.natural;
  if (stream === "social") return STREAM_CHIP.social;
  return "border-border/60 text-muted-foreground";
}

function streamLabelOf(stream: string | null | undefined): string {
  if (stream === "natural") return "Natural Science";
  if (stream === "social") return "Social Science";
  return "Shared";
}

const MODE_LABELS: Record<string, string> = {
  full_simulation: "Full simulation",
  subject_mock: "Subject mock",
  weakness_challenge: "Weakness challenge",
  past_paper: "Past paper",
};

export function MatricHub({
  catalog,
  history,
  pastPaperOptions,
  journey,
  starting,
  onStart,
  onResume,
  onOpenResults,
}: {
  catalog: CatalogPayload;
  history: MatricHistoryRow[];
  pastPaperOptions: PastPaperOption[] | undefined;
  journey?: MatricJourneyPayload;
  starting: boolean;
  onStart: (
    blueprintId: Id<"matricBlueprints">,
    pastPaperContentId?: Id<"contentItems">,
    exploreOtherStream?: boolean,
  ) => void;
  onResume: () => void;
  onOpenResults: (sessionId: Id<"matricSessions">) => void;
}) {
  const navigate = useNavigate();
  const [papersOpen, setPapersOpen] = useState(false);
  // Exploration toggle — explicitly temporary. Per-visit UI state only; it
  // never writes the academic profile, and starting an other-stream exam
  // with it on records that sitting as exploratory server-side.
  const [exploring, setExploring] = useState(false);
  // Smart history filters.
  const [historyStreamFilter, setHistoryStreamFilter] = useState<"all" | "mine" | "other">("all");
  const [historyModeFilter, setHistoryModeFilter] = useState<string>("all");

  const studentStream = catalog.studentStream;
  const studentStreamLabel = catalog.studentStreamLabel;
  const otherStream: "natural" | "social" | null =
    studentStream === "natural" ? "social" : studentStream === "social" ? "natural" : null;

  const totalEligible = catalog.subjectMocks.reduce((acc, s) => acc + s.eligibleCount, 0);
  const totalPapers = catalog.subjectMocks.reduce((acc, s) => acc + s.paperCount, 0);
  const premium = catalog.premium;

  // ── Stream grouping (presentation only — the backend is the gate) ──
  const myMocks = studentStream
    ? catalog.subjectMocks.filter((s) => s.stream === studentStream)
    : [];
  const sharedMocks = catalog.subjectMocks.filter((s) => s.stream === "common");
  const otherMocks = otherStream
    ? catalog.subjectMocks.filter((s) => s.stream === otherStream)
    : [];
  const mySim = catalog.fullSimulations.find((s) => s.stream === studentStream) ?? null;
  const otherSim = otherStream
    ? catalog.fullSimulations.find((s) => s.stream === otherStream) ?? null
    : null;

  const offeredMine = [...myMocks, ...sharedMocks].filter((s) => s.offered);
  const offeredOther = otherMocks.filter((s) => s.offered);

  const startOrGate = (
    blueprintId: Id<"matricBlueprints">,
    pastPaperContentId?: Id<"contentItems">,
    exploreOtherStream?: boolean,
  ) => {
    if (!premium) {
      toast.error("Mock exams are a premium feature.", {
        action: { label: "Upgrade", onClick: () => navigate("/upgrade") },
      });
      return;
    }
    onStart(blueprintId, pastPaperContentId, exploreOtherStream);
  };

  // ── Smart history filtering (all labels come from the sitting itself) ──
  const filteredHistory = useMemo(() => {
    let rows = history;
    if (historyStreamFilter === "mine" && studentStream) {
      rows = rows.filter(
        (h) => h.stream === studentStream || (h.stream === null && !h.exploredOtherStream),
      );
    } else if (historyStreamFilter === "other") {
      // Cross-stream = the other stream's exams. Shared subjects ("common")
      // are sat by every stream, so they are never "cross-stream".
      rows = rows.filter(
        (h) =>
          h.exploredOtherStream ||
          (studentStream !== null &&
            h.stream !== null &&
            h.stream !== "common" &&
            h.stream !== studentStream),
      );
    }
    if (historyModeFilter !== "all") {
      rows = rows.filter((h) => h.mode === historyModeFilter);
    }
    return rows;
  }, [history, historyStreamFilter, historyModeFilter, studentStream]);

  const historyModeOptions = useMemo(() => {
    const present = new Set(history.map((h) => h.mode));
    return [...present];
  }, [history]);

  return (
    <div className="flex flex-col gap-8">
      {/* ── Resume banner ── */}
      {catalog.hasActiveSession && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/50 bg-amber-400/[0.10] px-5 py-4 dark:border-amber-400/40 dark:bg-amber-400/[0.07]"
        >
          <div className="flex items-center gap-3">
            <CircleAlert className="size-5 shrink-0 text-amber-600 dark:text-amber-300" />
            <div>
              <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
                Exam in progress — {catalog.activeSessionTitle}
              </p>
              <p className="text-xs text-amber-800/90 dark:text-amber-200/70">
                Your timer is still running server-side. Resume before it expires.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onResume} className="bg-amber-400 text-black hover:bg-amber-300">
            <Play className="size-4" /> Resume exam
          </Button>
        </motion.div>
      )}

      {/* ── HERO + ACADEMIC IDENTITY ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-amber-400/15 bg-gradient-to-br from-amber-400/[0.04] via-white/[0.01] to-transparent p-8 sm:p-10"
      >
        <div className="pointer-events-none absolute -top-24 -right-12 size-64 rounded-full bg-amber-400/8 blur-[80px]" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1">
            <ShieldCheck className="size-3.5 text-emerald-300" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
              No AI · Instant start · Verified keys
            </span>
          </div>

          {/* Academic identity — the canonical saved stream, verbatim. */}
          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/[0.09] px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/[0.07] dark:text-amber-200">
              <GraduationCap className="size-3.5" />
              {catalog.gradeLevel ? `Grade ${catalog.gradeLevel}` : "Grade not set"}
            </span>
            <span className="text-primary/30" aria-hidden>
              ·
            </span>
            {studentStreamLabel ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] ${streamChipClass(studentStream)}`}
              >
                {studentStream === "natural" ? (
                  <Zap className="size-3.5" />
                ) : (
                  <Compass className="size-3.5" />
                )}
                {studentStreamLabel}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => navigate("/settings")}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-400/[0.10] px-2.5 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700 transition-colors hover:bg-amber-400/[0.16] dark:border-amber-400/40 dark:bg-amber-400/[0.06] dark:text-amber-200 dark:hover:bg-amber-400/[0.12]"
                title="Choose your stream in Settings"
              >
                <Settings2 className="size-3.5" /> Stream not set — choose
              </button>
            )}
          </div>

          <h1 className="mt-4 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            Matric <span className="text-gradient">OS</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Real ESSLCE past-paper questions from the Learnyx vault — assembled
            instantly, timed by the server, scored against verified answer
            keys. Your mistakes flow straight into Mistake Lab and your Exam
            Twin. Works even when every AI provider is down, because no AI is
            involved.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 px-3 py-2">
              <Database className="size-4 text-amber-300" />
              <strong className="text-foreground">{totalEligible}</strong>
              <span className="text-muted-foreground">verified exam questions</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 px-3 py-2">
              <FileText className="size-4 text-teal-300" />
              <strong className="text-foreground">{totalPapers}</strong>
              <span className="text-muted-foreground">digitized papers</span>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 px-3 py-2">
              <ListChecks className="size-4 text-violet-300" />
              <strong className="text-foreground">{offeredMine.length}</strong>
              <span className="text-muted-foreground">
                {studentStream ? "subjects ready in your pathway" : "subjects ready"}
              </span>
            </span>
            <button
              type="button"
              onClick={() => navigate("/settings")}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 px-3 py-2 text-muted-foreground transition-colors hover:border-amber-400/40 hover:text-foreground"
            >
              <Settings2 className="size-4 text-muted-foreground" />
              <span>{studentStreamLabel ? "Update stream" : "Set your stream"}</span>
              <ChevronRight className="size-3.5" />
            </button>
          </div>

          {/* Graceful unselected-stream prompt — never silently defaulted. */}
          {!studentStreamLabel && (
            <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] p-4 dark:border-amber-400/25 dark:bg-amber-400/[0.05]">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-100">
                Which pathway are you on?
              </p>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                Natural Science and Social Science students see different
                examination pathways. Set your stream once in Settings and
                every surface — this hub, your recommendations, your progress —
                organizes around it. Your existing history is never touched.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 border-amber-500/50 text-amber-800 hover:bg-amber-400/10 dark:border-amber-400/40 dark:text-amber-100"
                onClick={() => navigate("/settings")}
              >
                <Settings2 className="size-4" /> Choose your stream in Settings
              </Button>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── YOUR MATRIC JOURNEY — next exam + Review → Practice → Improve ── */}
      {journey && (
        <section aria-label="Your Matric journey">
          <ModeHeader
            icon={<Route className="size-4 text-amber-300" />}
            title="Your Matric Journey"
            description="One pathway: sit the exam → review what it exposes → practice → improve."
          />
          <div className="mt-4 overflow-hidden rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-400/[0.06] via-card/40 to-transparent">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-amber-600 dark:text-amber-200/80">
                  Your next exam
                </p>
                {journey.kind === "resume" ? (
                  <>
                    <p className="mt-1.5 truncate text-lg font-bold text-foreground">{journey.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{journey.reason}</p>
                  </>
                ) : journey.kind === "start" && journey.blueprintId ? (
                  <>
                    <p className="mt-1.5 text-lg font-bold text-foreground">
                      {journey.subjectName ? (
                        <>
                          {journey.subjectName}{" "}
                          <span className="text-gradient">
                            · {MODE_LABELS[journey.mode ?? "subject_mock"] ?? "Subject Mock"}
                          </span>
                        </>
                      ) : (
                        <span className="text-gradient">{journey.title}</span>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      {journey.streamLabel && (
                        <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${streamChipClass(journey.stream)}`}>
                          {journey.streamLabel}
                        </span>
                      )}
                      {journey.questionCount != null && <span>{journey.questionCount} questions</span>}
                      {journey.timeLimitSeconds != null && <span>· {minutes(journey.timeLimitSeconds)}</span>}
                    </p>
                    <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      {journey.reason}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1.5 text-lg font-bold text-foreground">{journey.title}</p>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      {journey.reason}
                    </p>
                  </>
                )}
              </div>
              <div className="shrink-0">
                {journey.kind === "resume" ? (
                  <Button onClick={onResume} className="bg-amber-400 text-black hover:bg-amber-300">
                    <Play className="size-4" /> Resume exam
                  </Button>
                ) : journey.kind === "start" && journey.blueprintId ? (
                  <Button
                    onClick={() => startOrGate(journey.blueprintId!, undefined, false)}
                    disabled={starting || !premium}
                    className="bg-amber-400 text-black hover:bg-amber-300"
                  >
                    {!premium ? (
                      <>
                        <Lock className="size-4" /> Premium
                      </>
                    ) : starting ? (
                      "Assembling…"
                    ) : (
                      <>
                        <Play className="size-4" /> Start exam
                      </>
                    )}
                  </Button>
                ) : (
                  <Button variant="outline" disabled>
                    <RotateCcw className="size-4" /> Awaiting verification
                  </Button>
                )}
              </div>
            </div>
            {/* Review → Practice → Improve — real evidence counts only. */}
            <div className="grid grid-cols-1 gap-px border-t border-border/60 bg-border/40 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => navigate("/mistakes")}
                className="group flex items-center gap-3 bg-card/60 px-5 py-3.5 text-left transition-colors hover:bg-card/90"
              >
                <BookOpenCheck className="size-4 shrink-0 text-rose-300" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">Review mistakes</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {journey.review.dueMistakes != null && journey.review.dueMistakes > 0
                      ? `${journey.review.dueMistakes} due in your Mistake Lab`
                      : "Nothing due — mistakes flow in after each sitting"}
                  </p>
                </div>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/mock-exam")}
                className="group flex items-center gap-3 bg-card/60 px-5 py-3.5 text-left transition-colors hover:bg-card/90"
              >
                <Target className="size-4 shrink-0 text-amber-300" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">Practice weaknesses</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {journey.review.weakestSubjectName
                      ? `${journey.review.weakestSubjectName} — ${journey.review.weakestScorePct}% recent average`
                      : "Weakness Challenge builds from real evidence"}
                  </p>
                </div>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="group flex items-center gap-3 bg-card/60 px-5 py-3.5 text-left transition-colors hover:bg-card/90"
              >
                <BarChart3 className="size-4 shrink-0 text-teal-300" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground">Track progress</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Measured accuracy per subject and topic — never predictions
                  </p>
                </div>
                <ChevronRight className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── SUBJECT MOCKS ── */}
      <section>
        <ModeHeader
          icon={<GraduationCap className="size-4 text-amber-300" />}
          title="Subject Mock"
          description="One subject, focused practice, server-scored against real answer keys."
        />

        {/* Your stream first — clearly identified. */}
        {catalog.subjectMocks.length === 0 ? (
          <EmptyCoverage note="No subject has verified exam questions yet." reason="empty-vault" />
        ) : (
          <>
            {studentStream && (
              <p className="mt-4 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                <span className={`rounded border px-1.5 py-0.5 ${streamChipClass(studentStream)}`}>
                  {studentStreamLabel}
                </span>
                your pathway
              </p>
            )}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {myMocks.map((s) => (
                <ModeCard
                  key={s.blueprintId}
                  title={s.subjectName}
                  meta={`${s.questionCount} questions · ${minutes(s.timeLimitSeconds)}`}
                  stats={`${s.eligibleCount} verified questions · ${s.paperCount} papers`}
                  state={!s.offered ? "insufficient" : !premium ? "premium" : "ready"}
                  hint={
                    !s.offered
                      ? `Needs ${Math.max(s.questionCount, 10)} verified questions — ${Math.max(0, Math.max(s.questionCount, 10) - s.eligibleCount)} more to go. Check back as more papers are verified.`
                      : !premium
                        ? "Mock exams are a premium feature."
                        : undefined
                  }
                  onStart={() => startOrGate(s.blueprintId)}
                  starting={starting}
                />
              ))}
              {myMocks.length === 0 && (
                <p className="col-span-full rounded-xl border border-dashed border-border/60 p-4 text-xs text-muted-foreground">
                  No stream-specific subjects are covered yet for your pathway — the
                  shared subjects below are sat by every stream.
                </p>
              )}
            </div>

            {/* Shared subjects — sat by both streams. */}
            {sharedMocks.length > 0 && (
              <>
                <p className="mt-6 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  <BookOpenCheck className="size-3.5" /> sat by every stream
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {sharedMocks.map((s) => (
                    <ModeCard
                      key={s.blueprintId}
                      title={s.subjectName}
                      meta={`${s.questionCount} questions · ${minutes(s.timeLimitSeconds)}`}
                      stats={`${s.eligibleCount} verified questions · ${s.paperCount} papers`}
                      state={!s.offered ? "insufficient" : !premium ? "premium" : "ready"}
                      hint={
                        !s.offered
                          ? `Needs ${Math.max(s.questionCount, 10)} verified questions — ${Math.max(0, Math.max(s.questionCount, 10) - s.eligibleCount)} more to go.`
                          : !premium
                            ? "Mock exams are a premium feature."
                            : undefined
                      }
                      onStart={() => startOrGate(s.blueprintId)}
                      starting={starting}
                    />
                  ))}
                </div>
              </>
            )}

            {/* The other stream — explicit, temporary exploration. */}
            {otherStream && otherMocks.length > 0 && (
              <div className="mt-6 rounded-2xl border border-violet-400/20 bg-violet-400/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Compass className="size-4 text-violet-300" />
                      Exploring{" "}
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${streamChipClass(otherStream)}`}>
                        {otherStream === "natural" ? "Natural Science" : "Social Science"}
                      </span>
                    </p>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      Curious about the other pathway? Sitting these exams is a
                      clearly-labeled practice exploration —{" "}
                      <strong className="text-foreground">your saved stream is never changed</strong>{" "}
                      and the sitting stays marked as exploration in your history and results.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={exploring ? "default" : "outline"}
                    onClick={() => {
                      const next = !exploring;
                      setExploring(next);
                      if (next) {
                        toast.info("Exploration on for this visit — your saved stream is untouched.", {
                          duration: 4000,
                        });
                      }
                    }}
                    aria-pressed={exploring}
                    className={
                      exploring
                        ? "bg-violet-400 text-black hover:bg-violet-300"
                        : "border-violet-500/50 text-violet-700 hover:bg-violet-400/10 dark:border-violet-400/40 dark:text-violet-200"
                    }
                  >
                    <Eye className="size-4" />
                    {exploring ? "Exploring — hide" : "Explore the other stream"}
                  </Button>
                </div>
                {exploring && (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {otherMocks.map((s) => (
                      <ModeCard
                        key={s.blueprintId}
                        title={s.subjectName}
                        meta={`${s.questionCount} questions · ${minutes(s.timeLimitSeconds)}`}
                        stats={`${s.eligibleCount} verified questions · ${s.paperCount} papers`}
                        state={!s.offered ? "insufficient" : !premium ? "premium" : "ready"}
                        hint={
                          !s.offered
                            ? `Needs ${Math.max(s.questionCount, 10)} verified questions — ${Math.max(0, Math.max(s.questionCount, 10) - s.eligibleCount)} more to go.`
                            : !premium
                              ? "Mock exams are a premium feature."
                              : "Labeled as an exploratory sitting in your history."
                        }
                        onStart={() => startOrGate(s.blueprintId, undefined, true)}
                        starting={starting}
                        explore
                      />
                    ))}
                    {offeredOther.length === 0 && (
                      <p className="col-span-full rounded-xl border border-dashed border-violet-400/30 p-4 text-xs text-muted-foreground">
                        No {otherStream === "natural" ? "Natural Science" : "Social Science"} subject is
                        covered enough to sit yet — same honest rule as your own stream.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* ── FULL SIMULATIONS ── */}
      {catalog.fullSimulations.length > 0 && (
        <section>
          <ModeHeader
            icon={<Zap className="size-4 text-amber-300" />}
            title="Full Matric Simulation"
            description="Multi-subject sitting across every covered subject of your stream."
          />
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[mySim, otherSim].filter(Boolean).map((sim) => {
              const isOther = sim!.stream === otherStream;
              return (
                <div
                  key={sim!.blueprintId}
                  className={`rounded-2xl border p-5 ${
                    isOther ? "border-border/50 bg-card/30" : "border-border/70 bg-card/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-foreground">{sim!.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {sim!.totalQuestions} questions · {minutes(sim!.timeLimitSeconds)}
                      </p>
                    </div>
                    <Badge variant="outline" className={streamChipClass(sim!.stream)}>
                      {isOther ? "Other stream" : streamLabelOf(sim!.stream)}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {sim!.subjects.map((sp) => (
                      <span
                        key={sp.subjectName}
                        className={`rounded-lg border px-2 py-1 text-[11px] ${
                          sp.eligibleCount >= sp.questionCount
                            ? "border-border/60 text-muted-foreground"
                            : "border-rose-400/30 text-rose-300"
                        }`}
                      >
                        {sp.subjectName} ×{sp.questionCount}
                      </span>
                    ))}
                  </div>
                  {isOther && (
                    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                      Exploration only — clearly labeled in your history, your saved
                      stream is never changed.
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="mt-4 w-full"
                    disabled={!sim!.offered || starting || !premium}
                    onClick={() => startOrGate(sim!.blueprintId, undefined, isOther)}
                  >
                    {!premium ? (
                      <>
                        <Lock className="size-4" /> Premium
                      </>
                    ) : sim!.offered ? (
                      <>
                        <Play className="size-4" /> {isOther ? "Explore simulation" : "Start simulation"}
                      </>
                    ) : (
                      "Not enough verified coverage yet"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── WEAKNESS CHALLENGE ── */}
      {catalog.weakness && (
        <section>
          <ModeHeader
            icon={<Target className="size-4 text-rose-300" />}
            title="Weakness Challenge"
            description="Built from YOUR weakest topics — real evidence, not vibes."
          />
          <div className="mt-4 rounded-2xl border border-rose-400/20 bg-gradient-to-br from-rose-400/[0.05] to-transparent p-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {catalog.weakness.description}
            </p>
            <Button
              size="sm"
              className="mt-4"
              disabled={starting}
              onClick={() => startOrGate(catalog.weakness!.blueprintId)}
            >
              {!premium ? (
                <>
                  <Lock className="size-4" /> Premium
                </>
              ) : (
                <>
                  <Play className="size-4" /> Start challenge
                </>
              )}
            </Button>
          </div>
        </section>
      )}

      {/* ── PAST PAPER SIMULATION ── */}
      {catalog.pastPaper && (
        <section>
          <ModeHeader
            icon={<FileText className="size-4 text-teal-300" />}
            title="Past Paper Simulation"
            description="A timed run of one real digitized paper's MCQ section, scored against its own key."
          />
          <div className="mt-4 rounded-2xl border border-teal-400/20 bg-gradient-to-br from-teal-400/[0.05] to-transparent p-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Pick any digitized ESSLCE paper with verified answer keys. The
              engine assembles its multiple-choice questions into a timed,
              server-scored sitting — the same pipeline as every other Matric
              OS mode.
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => setPapersOpen(true)}>
              <FileText className="size-4" /> Choose a paper
            </Button>
          </div>
        </section>
      )}

      {/* ── HISTORY — smart filters (stream/mode), sitting-native labels ── */}
      <section id="matric-recent-sittings" className="scroll-mt-20">
        <ModeHeader
          icon={<History className="size-4 text-muted-foreground" />}
          title="Recent sittings"
          description="Every sitting keeps its original stream context — even after you change streams."
        />
        {(history.length > 0 || historyStreamFilter !== "all" || historyModeFilter !== "all") && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <FilterChip
              active={historyStreamFilter === "all"}
              onClick={() => setHistoryStreamFilter("all")}
              label="All streams"
            />
            {studentStream && (
              <FilterChip
                active={historyStreamFilter === "mine"}
                onClick={() => setHistoryStreamFilter("mine")}
                label={`${studentStreamLabel} pathway`}
              />
            )}
            <FilterChip
              active={historyStreamFilter === "other"}
              onClick={() => setHistoryStreamFilter("other")}
              label="Cross-stream"
            />
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" aria-hidden />
            <FilterChip
              active={historyModeFilter === "all"}
              onClick={() => setHistoryModeFilter("all")}
              label="All modes"
            />
            {historyModeOptions.map((m) => (
              <FilterChip
                key={m}
                active={historyModeFilter === m}
                onClick={() => setHistoryModeFilter(m)}
                label={MODE_LABELS[m] ?? m}
              />
            ))}
          </div>
        )}
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No sittings yet. Start with a Subject Mock — it takes minutes.
          </p>
        ) : filteredHistory.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No sittings match these filters.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
            {filteredHistory.map((h) => (
              <button
                key={h.sessionId}
                type="button"
                onClick={() => h.status === "graded" && onOpenResults(h.sessionId)}
                className="flex w-full items-center justify-between gap-3 bg-card/40 px-4 py-3 text-left transition-colors hover:bg-card/70 disabled:cursor-default"
                disabled={h.status !== "graded"}
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 truncate text-sm font-medium text-foreground">
                    {h.title}
                    {h.exploredOtherStream && (
                      <span className="shrink-0 rounded border border-violet-400/40 px-1 py-px font-mono text-[9px] font-bold uppercase tracking-wider text-violet-300">
                        explored
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(h.startedAt)}
                    {h.primarySubjectName ? ` · ${h.primarySubjectName}` : ""}
                    {h.stream ? ` · ${streamLabelOf(h.stream)}` : ""}
                    {h.submissionSource === "auto_expiry" ? " · auto-submitted (time expired)" : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {h.status === "graded" ? (
                    <Badge
                      variant="outline"
                      className={
                        h.scorePct !== null && h.scorePct >= 70
                          ? "border-emerald-400/40 text-emerald-200"
                          : h.scorePct !== null && h.scorePct >= 50
                            ? "border-amber-400/40 text-amber-200"
                            : "border-rose-400/40 text-rose-200"
                      }
                    >
                      {h.scorePct}%
                    </Badge>
                  ) : h.status === "active" ? (
                    <Badge variant="outline" className="border-amber-400/40 text-amber-200">
                      in progress
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-border text-muted-foreground">
                      {h.status}
                    </Badge>
                  )}
                  {h.status === "graded" && <ChevronRight className="size-4 text-muted-foreground" />}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* ── HONESTY FOOTER ── */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Matric OS exam formats are Learnyx practice configurations assembled
        from verified ESSLCE past-paper questions — they are not official ESA
        papers and make no claim of format equivalence. Scores reflect the
        questions you actually answered.
      </p>

      {/* ── PAST PAPER PICKER ── */}
      <Dialog open={papersOpen} onOpenChange={setPapersOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Choose a past paper</DialogTitle>
            <DialogDescription>
              Papers with at least 5 verified multiple-choice questions are
              eligible for a scored simulation.
            </DialogDescription>
          </DialogHeader>
          {!pastPaperOptions ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading papers…</p>
          ) : pastPaperOptions.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No eligible papers yet — the digitization queue is still working through the library.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {pastPaperOptions.map((p) => (
                <button
                  key={p.contentId}
                  type="button"
                  onClick={() => {
                    setPapersOpen(false);
                    const isOther =
                      p.stream != null &&
                      p.stream !== "common" &&
                      studentStream !== null &&
                      p.stream !== studentStream;
                    startOrGate(catalog.pastPaper!.blueprintId, p.contentId, isOther);
                  }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-left transition-colors hover:border-teal-400/40 hover:bg-teal-400/[0.04]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[
                        p.subjectName,
                        p.examYear,
                        `${p.eligibleCount} MCQs`,
                        p.durationMinutes ? `${p.durationMinutes} min` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.stream && p.stream !== "common" && (
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${streamChipClass(p.stream)}`}>
                        {p.stream === "natural" ? "natural" : "social"}
                      </span>
                    )}
                    {p.isPremium ? <Lock className="size-4 text-muted-foreground" /> : null}
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "border-amber-500/50 bg-amber-400/[0.12] text-amber-800 dark:border-amber-400/50 dark:bg-amber-400/[0.10] dark:text-amber-200"
          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function ModeHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
        {icon}
        {title}
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function ModeCard({
  title,
  meta,
  stats,
  state,
  hint,
  onStart,
  starting,
  explore = false,
}: {
  title: string;
  meta: string;
  stats: string;
  state: "ready" | "premium" | "insufficient";
  hint?: string;
  onStart: () => void;
  starting: boolean;
  explore?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border/70 bg-card/50 p-4">
      <div className="flex-1">
        <p className="font-bold text-foreground">{title}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="size-3" /> {meta}
        </p>
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
          <Database className="size-3" /> {stats}
        </p>
        {hint && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">{hint}</p>}
      </div>
      <Button
        size="sm"
        className="mt-3 w-full"
        disabled={state === "insufficient" || starting}
        onClick={onStart}
        variant={state === "ready" ? "default" : "outline"}
      >
        {state === "ready" ? (
          <>
            <Play className="size-4" /> {explore ? "Explore" : "Start"}
          </>
        ) : state === "premium" ? (
          <>
            <Lock className="size-4" /> Premium
          </>
        ) : (
          <>
            <RotateCcw className="size-4" /> More papers needed
          </>
        )}
      </Button>
    </div>
  );
}

function EmptyCoverage({ note, reason }: { note: string; reason?: "empty-vault" | "none-offered" }) {
  // Client-side navigation only — window.location.href here previously
  // triggered a full-page reload, dropping the SPA state and scroll.
  const navigate = useNavigate();
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border/70 p-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-foreground">{note}</p>
        <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
          {reason === "empty-vault"
            ? "The verified question vault is empty right now — our team is digitizing and verifying real past papers. Mock exams unlock automatically for a subject as soon as it has enough verified questions."
            : "Every subject below needs a minimum pool of verified questions before we can assemble a fair, honestly-scored exam. We won't pad exams with unverified content — coverage is being added continuously."}
        </p>
      </div>
      <div className="mx-auto mt-4 flex max-w-md flex-wrap items-center justify-center gap-2">
        <Button size="sm" variant="outline" onClick={() => navigate("/mistakes")} className="focus-ring">
          <BookOpenCheck className="size-3.5 text-amber-300" /> Review your mistakes
        </Button>
        <Button size="sm" variant="outline" onClick={() => navigate("/tutor")} className="focus-ring">
          <GraduationCap className="size-3.5 text-teal-300" /> Study with the Tutor
        </Button>
      </div>
    </div>
  );
}
