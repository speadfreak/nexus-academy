// Matric OS — Hub: the four student modes with REAL eligibility.
//
// Every number on this screen is measured from the verified vault —
// eligible question counts, paper counts, verified-key counts. Modes with
// insufficient coverage are shown honestly as unavailable (with the
// reason), never silently shrinked or filled with unverified content.
// Learnyx practice configurations are labeled as such — no claim of
// official ESA format equivalence anywhere.

import { useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "framer-motion";
import { toast } from "sonner";
import type { Id } from "@/convex/_generated/dataModel";
import type { CatalogPayload, PastPaperOption } from "@/convex/matricEngine";
import type { MatricHistoryRow } from "@/convex/matricEngine";
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

export function MatricHub({
  catalog,
  history,
  pastPaperOptions,
  starting,
  onStart,
  onResume,
  onOpenResults,
}: {
  catalog: CatalogPayload;
  history: MatricHistoryRow[];
  pastPaperOptions: PastPaperOption[] | undefined;
  starting: boolean;
  onStart: (blueprintId: Id<"matricBlueprints">, pastPaperContentId?: Id<"contentItems">) => void;
  onResume: () => void;
  onOpenResults: (sessionId: Id<"matricSessions">) => void;
}) {
  const navigate = useNavigate();
  const [papersOpen, setPapersOpen] = useState(false);

  const totalEligible = catalog.subjectMocks.reduce((acc, s) => acc + s.eligibleCount, 0);
  const totalPapers = catalog.subjectMocks.reduce((acc, s) => acc + s.paperCount, 0);
  const offeredMocks = catalog.subjectMocks.filter((s) => s.offered);
  const premium = catalog.premium;

  const startOrGate = (
    blueprintId: Id<"matricBlueprints">,
    pastPaperContentId?: Id<"contentItems">,
  ) => {
    if (!premium) {
      toast.error("Mock exams are a premium feature.", {
        action: { label: "Upgrade", onClick: () => navigate("/upgrade") },
      });
      return;
    }
    onStart(blueprintId, pastPaperContentId);
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ── Resume banner ── */}
      {catalog.hasActiveSession && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/[0.07] px-5 py-4"
        >
          <div className="flex items-center gap-3">
            <CircleAlert className="size-5 shrink-0 text-amber-300" />
            <div>
              <p className="text-sm font-bold text-amber-100">
                Exam in progress — {catalog.activeSessionTitle}
              </p>
              <p className="text-xs text-amber-200/70">
                Your timer is still running server-side. Resume before it expires.
              </p>
            </div>
          </div>
          <Button size="sm" onClick={onResume} className="bg-amber-400 text-black hover:bg-amber-300">
            <Play className="size-4" /> Resume exam
          </Button>
        </motion.div>
      )}

      {/* ── HERO ── */}
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
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
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
              <strong className="text-foreground">{offeredMocks.length}</strong>
              <span className="text-muted-foreground">subjects ready</span>
            </span>
          </div>
        </div>
      </motion.div>

      {/* ── SUBJECT MOCKS ── */}
      <section>
        <ModeHeader
          icon={<GraduationCap className="size-4 text-amber-300" />}
          title="Subject Mock"
          description="One subject, focused practice, server-scored against real answer keys."
        />
        {catalog.subjectMocks.length === 0 ? (
          <EmptyCoverage
            note="No subject has verified exam questions yet."
            reason="empty-vault"
          />
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.subjectMocks.map((s) => (
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
          </div>
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
            {catalog.fullSimulations.map((sim) => (
              <div
                key={sim.blueprintId}
                className="rounded-2xl border border-border/70 bg-card/50 p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-foreground">{sim.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {sim.totalQuestions} questions · {minutes(sim.timeLimitSeconds)}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      sim.stream === "natural"
                        ? "border-teal-400/30 text-teal-200"
                        : "border-violet-400/30 text-violet-200"
                    }
                  >
                    {sim.stream === "natural" ? "Natural Science" : "Social Science"}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {sim.subjects.map((sp) => (
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
                <Button
                  size="sm"
                  className="mt-4 w-full"
                  disabled={!sim.offered || starting || !premium}
                  onClick={() => startOrGate(sim.blueprintId)}
                >
                  {!premium ? (
                    <>
                      <Lock className="size-4" /> Premium
                    </>
                  ) : sim.offered ? (
                    <>
                      <Play className="size-4" /> Start simulation
                    </>
                  ) : (
                    "Not enough verified coverage yet"
                  )}
                </Button>
              </div>
            ))}
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

      {/* ── HISTORY ── */}
      <section>
        <ModeHeader
          icon={<History className="size-4 text-muted-foreground" />}
          title="Recent sittings"
          description="Your Matric OS history — legacy AI mock attempts remain in their own results timeline."
        />
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No sittings yet. Start with a Subject Mock — it takes minutes.
          </p>
        ) : (
          <div className="mt-4 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
            {history.map((h) => (
              <button
                key={h.sessionId}
                type="button"
                onClick={() => h.status === "graded" && onOpenResults(h.sessionId)}
                className="flex w-full items-center justify-between gap-3 bg-card/40 px-4 py-3 text-left transition-colors hover:bg-card/70 disabled:cursor-default"
                disabled={h.status !== "graded"}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{h.title}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDate(h.startedAt)}
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
                    startOrGate(catalog.pastPaper!.blueprintId, p.contentId);
                  }}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/40 px-4 py-3 text-left transition-colors hover:border-teal-400/40 hover:bg-teal-400/[0.04]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[p.subjectName, p.examYear, `${p.eligibleCount} MCQs`, p.durationMinutes ? `${p.durationMinutes} min` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  {p.isPremium ? <Lock className="size-4 shrink-0 text-muted-foreground" /> : null}
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
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
}: {
  title: string;
  meta: string;
  stats: string;
  state: "ready" | "premium" | "insufficient";
  hint?: string;
  onStart: () => void;
  starting: boolean;
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
            <Play className="size-4" /> Start
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
        <Button size="sm" variant="outline" onClick={() => (window.location.href = "/mistakes")}>
          <BookOpenCheck className="size-3.5 text-amber-300" /> Review your mistakes
        </Button>
        <Button size="sm" variant="outline" onClick={() => (window.location.href = "/tutor")}>
          <GraduationCap className="size-3.5 text-teal-300" /> Study with the Tutor
        </Button>
      </div>
    </div>
  );
}
