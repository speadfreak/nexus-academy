// LEARNYX MATRIC OS — page shell for the non-AI mock exam engine.
//
// View flow: hub → (instructions dialog) → player → results → hub.
// The active session survives any reload (server-persisted state +
// server-authoritative deadline); results are reachable via ?session=<id>
// so submission can deep-link straight into the debrief.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ActiveSessionPayload, CatalogPayload } from "@/convex/matricEngine";
import { MatricHub } from "@/components/matric/MatricHub";
import { MatricPlayer } from "@/components/matric/MatricPlayer";
import { MatricResults } from "@/components/matric/MatricResults";
import type { MatricResultsPayload } from "@/convex/matricEngine";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useNavigate, useSearchParams } from "react-router";
import { useTheme } from "@/components/theme-provider";
import { toast } from "sonner";
import { Loader2, ShieldCheck, Timer, ListChecks, Flag } from "lucide-react";

type View = "hub" | "player" | "results";

interface PendingStart {
  blueprintId: Id<"matricBlueprints">;
  pastPaperContentId?: Id<"contentItems">;
  title: string;
  subjectLines: string[];
  questionCount: number;
  timeLimitSeconds: number;
}

export default function MatricExam() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme } = useTheme();

  const catalog = useQuery(api.matricEngine.getMatricCatalog, {});
  const activeSession = useQuery(api.matricEngine.getMyActiveSession, {});
  const history = useQuery(api.matricEngine.getMyMatricHistory, { limit: 12 });
  const pastPaperOptions = useQuery(api.matricEngine.getPastPaperOptions, {});

  const startMutation = useMutation(api.matricEngine.startMatricExam);
  const resultsIdParam = searchParams.get("session");

  const [view, setView] = useState<View>("hub");
  const [playerPayload, setPlayerPayload] = useState<ActiveSessionPayload | null>(null);
  const [resultsSessionId, setResultsSessionId] = useState<Id<"matricSessions"> | null>(null);
  const [starting, setStarting] = useState(false);
  const [pending, setPending] = useState<PendingStart | null>(null);
  const [instructionsAccepted, setInstructionsAccepted] = useState(false);

  const results = useQuery(
    api.matricEngine.getMatricResults,
    resultsSessionId ? { sessionId: resultsSessionId } : "skip",
  );

  // Deep link ?session=<id> → results view directly.
  useEffect(() => {
    if (resultsIdParam) {
      setResultsSessionId(resultsIdParam as Id<"matricSessions">);
      setView("results");
    }
  }, [resultsIdParam]);

  const handleStart = useCallback(
    async (blueprintId: Id<"matricBlueprints">, pastPaperContentId?: Id<"contentItems">) => {
      setStarting(true);
      try {
        const result = await startMutation({
          blueprintId,
          ...(pastPaperContentId !== undefined ? { pastPaperContentId } : {}),
        });
        setPlayerPayload({
          sessionId: result.sessionId,
          title: result.title,
          mode: result.mode,
          blueprintKey: "",
          questionCount: result.questions.length,
          timeLimitSeconds: result.timeLimitSeconds,
          startedAt: result.serverNow,
          deadlineAt: result.deadlineAt,
          serverNow: result.serverNow,
          remainingSeconds: Math.max(
            0,
            Math.round((result.deadlineAt - result.serverNow) / 1000),
          ),
          sections: result.sections,
          questions: result.questions,
          answers: result.questions.map(() => ""),
          flags: result.questions.map(() => false),
          timeMs: result.questions.map(() => 0),
        });
        setView("player");
      } catch (e) {
        const data = (e as { data?: { message?: string; code?: string } }).data;
        const code = data?.code;
        if (code === "premium_mock_exams") {
          toast.error("Mock exams are a premium feature.", {
            action: { label: "Upgrade", onClick: () => navigate("/upgrade") },
          });
        } else if (code === "session_in_progress") {
          toast.error(data?.message ?? "Finish your current exam first.");
        } else if (code === "insufficient_coverage" || code === "no_evidence") {
          toast.error(data?.message ?? "Not enough verified questions yet.");
        } else {
          toast.error(data?.message ?? "Could not start the exam. Try again.");
        }
      } finally {
        setStarting(false);
      }
    },
    [startMutation, navigate],
  );

  const openPendingInstructions = useCallback(
    (blueprintId: Id<"matricBlueprints">, pastPaperContentId?: Id<"contentItems">) => {
      // Build the instructions summary from the catalog.
      let title = "Exam";
      let subjectLines: string[] = [];
      let questionCount = 0;
      let timeLimitSeconds = 0;
      if (catalog) {
        const mock = catalog.subjectMocks.find((m) => m.blueprintId === blueprintId);
        const sim = catalog.fullSimulations.find((s) => s.blueprintId === blueprintId);
        if (mock) {
          title = `${mock.subjectName} Subject Mock`;
          subjectLines = [`${mock.subjectName}: ${mock.questionCount} questions`];
          questionCount = mock.questionCount;
          timeLimitSeconds = mock.timeLimitSeconds;
        } else if (sim) {
          title = sim.title;
          subjectLines = sim.subjects.map(
            (sp) => `${sp.subjectName}: ${sp.questionCount} questions`,
          );
          questionCount = sim.totalQuestions;
          timeLimitSeconds = sim.timeLimitSeconds;
        } else if (catalog.weakness && catalog.weakness.blueprintId === blueprintId) {
          title = catalog.weakness.title;
          subjectLines = ["15 questions from your weakest topics (resolved at start)"];
          questionCount = 15;
          timeLimitSeconds = 25 * 60;
        } else if (catalog.pastPaper && catalog.pastPaper.blueprintId === blueprintId) {
          title = "Past Paper Simulation";
          const paper = pastPaperOptions?.find((p) => p.contentId === pastPaperContentId);
          subjectLines = [
            paper
              ? `${paper.title}: ${paper.eligibleCount} verified MCQs${paper.durationMinutes ? ` · ${paper.durationMinutes} min` : ""}`
              : "Selected paper's verified multiple-choice section",
          ];
          questionCount = paper?.eligibleCount ?? 0;
          timeLimitSeconds = (paper?.durationMinutes ?? 45) * 60;
        }
      }
      setPending({
        blueprintId,
        ...(pastPaperContentId !== undefined ? { pastPaperContentId } : {}),
        title,
        subjectLines,
        questionCount,
        timeLimitSeconds,
      });
      setInstructionsAccepted(false);
    },
    [catalog, pastPaperOptions],
  );

  const confirmInstructions = useCallback(() => {
    if (!pending) return;
    const p = pending;
    setPending(null);
    void handleStart(p.blueprintId, p.pastPaperContentId);
  }, [pending, handleStart]);

  const handleSubmitted = useCallback(
    (sessionId: string) => {
      setPlayerPayload(null);
      setResultsSessionId(sessionId as Id<"matricSessions">);
      setView("results");
      setSearchParams({ session: sessionId }, { replace: true });
      // The results query above picks the session up reactively.
    },
    [setSearchParams],
  );

  const backToHub = useCallback(() => {
    setView("hub");
    setResultsSessionId(null);
    setPlayerPayload(null);
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  const resume = useCallback(() => {
    if (activeSession) {
      setPlayerPayload(activeSession);
      setView("player");
    }
  }, [activeSession]);

  // Dark-cockpit consistency: Matric OS inherits the app theme; nothing to
  // force. (Kept minimal — the surface reads well in both themes.)

  const isDark = theme !== "light";

  // ── Views ──
  const content = useMemo(() => {
    if (view === "player" && playerPayload) {
      return (
        <MatricPlayer
          payload={playerPayload}
          onSubmitted={handleSubmitted}
          onExit={backToHub}
        />
      );
    }
    if (view === "results" && resultsSessionId) {
      if (results === undefined) {
        return <ResultsSkeleton />;
      }
      if (results === null) {
        return (
          <div className="rounded-2xl border border-border/60 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Results are not available for this session (it may still be
              grading, or it belongs to another account).
            </p>
            <Button variant="outline" className="mt-4" onClick={backToHub}>
              Back to hub
            </Button>
          </div>
        );
      }
      return <MatricResults results={results as MatricResultsPayload} onBackToHub={backToHub} />;
    }
    // HUB (default)
    if (catalog === undefined) {
      return <HubSkeleton />;
    }
    if (catalog === null) {
      return (
        <div className="rounded-2xl border border-border/60 p-8 text-center text-sm text-muted-foreground">
          Sign in to take mock exams.
        </div>
      );
    }
    return (
      <MatricHub
        catalog={catalog as CatalogPayload}
        history={history ?? []}
        pastPaperOptions={pastPaperOptions}
        starting={starting}
        onStart={openPendingInstructions}
        onResume={resume}
        onOpenResults={(sessionId) => {
          setResultsSessionId(sessionId);
          setView("results");
          setSearchParams({ session: sessionId }, { replace: true });
        }}
      />
    );
  }, [
    view,
    playerPayload,
    resultsSessionId,
    results,
    catalog,
    history,
    pastPaperOptions,
    starting,
    openPendingInstructions,
    resume,
    handleSubmitted,
    backToHub,
    setSearchParams,
  ]);

  return (
    <div
      className={`min-h-screen w-full ${isDark ? "bg-background" : "bg-background"} px-4 py-6 sm:px-6 sm:py-8`}
    >
      <div className="mx-auto max-w-5xl">{content}</div>

      {/* ── EXAM INSTRUCTIONS DIALOG (Phase 4) ── */}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.title ?? "Exam instructions"}</DialogTitle>
            <DialogDescription>
              Read the rules before you begin. The timer starts the moment you
              start.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <p className="flex items-center gap-2 font-semibold">
                <ListChecks className="size-4 text-amber-300" /> Format
              </p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                {pending?.subjectLines.map((line) => (
                  <li key={line}>• {line}</li>
                ))}
                <li>
                  • Time limit:{" "}
                  {pending
                    ? pending.timeLimitSeconds >= 3600
                      ? `${Math.floor(pending.timeLimitSeconds / 3600)}h ${Math.round((pending.timeLimitSeconds % 3600) / 60)}m`
                      : `${Math.round(pending.timeLimitSeconds / 60)} minutes`
                    : "—"}
                </li>
              </ul>
            </div>
            <div className="rounded-xl border border-border/60 bg-card/40 p-3">
              <p className="flex items-center gap-2 font-semibold">
                <Timer className="size-4 text-teal-300" /> Rules
              </p>
              <ul className="mt-1.5 space-y-1 text-muted-foreground">
                <li>• The timer runs on the server — refreshing or closing the tab doesn't stop it.</li>
                <li>• Answers autosave continuously; safe to reload anytime.</li>
                <li>• Flag questions (F key) and jump around freely from the palette.</li>
                <li>• When time expires, your saved answers are submitted automatically.</li>
                <li>• No negative marking. Unanswered questions score zero.</li>
              </ul>
            </div>
            <div className="rounded-xl border border-emerald-400/25 bg-emerald-400/[0.05] p-3">
              <p className="flex items-center gap-2 font-semibold text-emerald-200">
                <ShieldCheck className="size-4" /> Honest scoring
              </p>
              <p className="mt-1 text-muted-foreground">
                Questions come from real digitized ESSLCE papers. Scoring runs
                entirely on Learnyx servers against the papers' verified answer
                keys — your browser never sees an answer before you submit.
                This is a Learnyx practice configuration, not an official ESA paper.
              </p>
            </div>
            <label className="flex items-start gap-2.5 rounded-xl border border-border/60 p-3">
              <Checkbox
                checked={instructionsAccepted}
                onCheckedChange={(v) => setInstructionsAccepted(v === true)}
                className="mt-0.5"
              />
              <span className="text-xs text-muted-foreground">
                I understand the exam is timed, submission is final, and my
                mistakes feed my Mistake Lab and Exam Twin evidence.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Not yet
            </Button>
            <Button
              onClick={confirmInstructions}
              disabled={!instructionsAccepted || starting}
              className="bg-amber-400 text-black hover:bg-amber-300"
            >
              {starting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Assembling…
                </>
              ) : (
                "Start exam"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HubSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-56 rounded-3xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-52 rounded-3xl" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-2xl" />
    </div>
  );
}
