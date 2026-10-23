// MATRIC OS — CBT Exam Player (Phase 4).
//
// A calm, fast, low-dependency computer-based-testing interface. Design
// rules from the rebuild spec:
//   - The server clock is the only source of truth. The local countdown is
//     display-only and re-syncs via the serverNow offset returned by the
//     query — a swapped device clock can never extend an exam.
//   - Autosave is a FIXED 15s heartbeat driven by refs (the old AI engine's
//     autosave never fired because every keystroke reset the interval).
//     The save status is honest: "Waiting to sync…" means NOT on the server.
//   - Answers live in refs + local state; refresh resumes from the server.
//   - Keyboard-first: arrows navigate, F flags, 1–9 pick an option.
//   - No scroll hijacking, no heavy animation, no nested cards — low-powered
//     phones and unstable networks are first-class citizens.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CloudOff,
  Flag,
  FlagOff,
  Grid3x3,
  Loader2,
  Send,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AiText } from "@/components/math";
import { cn } from "@/lib/utils";

interface CbtPlayerProps {
  sessionId: Id<"matricSessions">;
  /** Called once the whole exam is GRADED (server returns the result). */
  onFinished: () => void;
  onAbandoned: () => void;
}

type SaveState = "saved" | "saving" | "dirty" | "error";

const AUTOSAVE_INTERVAL_MS = 15_000;

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function CbtPlayer({ sessionId, onFinished, onAbandoned }: CbtPlayerProps) {
  const data = useQuery(api.matricEngine.getPlayerSession, { sessionId });
  const saveProgress = useMutation(api.matricEngine.saveProgress);
  const submitSection = useMutation(api.matricEngine.submitSection);
  const submitSession = useMutation(api.matricEngine.submitSession);
  const abandonSession = useMutation(api.matricEngine.abandonSession);

  const [sectionIdx, setSectionIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [, forceTick] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirmSection, setConfirmSection] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [busy, setBusy] = useState(false);

  // Mutable exam state — refs so timers/keyboard handlers never see stale data.
  const answersRef = useRef<Record<number, number[]>>({});
  const flagsRef = useRef<Record<number, boolean[]>>({});
  const timeSpentRef = useRef<Record<number, number>>({});
  const timeMsRef = useRef<Record<number, number[]>>({});
  const dirtyRef = useRef(false);
  const submittedRef = useRef(false);
  const serverOffsetRef = useRef(0);

  const bump = useCallback(() => {
    forceTick((n) => n + 1);
  }, []);

  // Hydrate local state from the server snapshot (resume path).
  useEffect(() => {
    if (!data) return;
    for (const sec of data.sections) {
      if (answersRef.current[sec.sectionIndex] === undefined) {
        answersRef.current[sec.sectionIndex] = [...sec.answers];
        flagsRef.current[sec.sectionIndex] = [...sec.flagged];
        timeSpentRef.current[sec.sectionIndex] = sec.timeSpentSeconds;
        timeMsRef.current[sec.sectionIndex] = sec.timeMs ? [...sec.timeMs] : sec.questions.map(() => 0);
      }
    }
    serverOffsetRef.current = data.serverNow - Date.now();
  }, [data]);

  const sec = data?.sections[sectionIdx];
  const answers = sec ? answersRef.current[sectionIdx] ?? [] : [];
  const flags = sec ? flagsRef.current[sectionIdx] ?? [] : [];
  const question = sec?.questions[qIdx];

  const remainingMs = data ? data.deadlineAt - (Date.now() + serverOffsetRef.current) : 0;
  const timeCritical = remainingMs < 5 * 60 * 1000;

  // ── Answer / flag actions ───────────────────────────────────────────
  const pickOption = useCallback(
    (optIdx: number) => {
      if (!sec) return;
      const arr = answersRef.current[sectionIdx] ?? new Array(sec.questions.length).fill(-1);
      arr[qIdx] = arr[qIdx] === optIdx ? -1 : optIdx; // tap again to clear
      answersRef.current[sectionIdx] = arr;
      dirtyRef.current = true;
      setSaveState("dirty");
      bump();
    },
    [sec, sectionIdx, qIdx, bump],
  );

  const toggleFlag = useCallback(() => {
    if (!sec) return;
    const arr = flagsRef.current[sectionIdx] ?? new Array(sec.questions.length).fill(false);
    arr[qIdx] = !arr[qIdx];
    flagsRef.current[sectionIdx] = arr;
    dirtyRef.current = true;
    setSaveState("dirty");
    bump();
  }, [sec, sectionIdx, qIdx, bump]);

  // ── Saving ──────────────────────────────────────────────────────────
  const flushSave = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!data || !dirtyRef.current || submittedRef.current) return;
      const target = data.sections[sectionIdx];
      if (!target) return;
      const localAnswers = answersRef.current[target.sectionIndex] ?? [];
      const localFlags = flagsRef.current[target.sectionIndex] ?? [];
      if (target.status === "submitted") {
        dirtyRef.current = false;
        setSaveState("saved");
        return;
      }
      setSaveState("saving");
      try {
        const res = await saveProgress({
          sessionId,
          sectionIndex: target.sectionIndex,
          answers: localAnswers,
          flagged: localFlags,
          timeSpentSeconds: timeSpentRef.current[target.sectionIndex] ?? 0,
          timeMs: timeMsRef.current[target.sectionIndex],
        });
        void res;
        void opts;
        dirtyRef.current = false;
        setSaveState("saved");
        setLastSavedAt(Date.now());
      } catch {
        // Keep dirty=true — the next heartbeat retries. Honest UI: error chip.
        setSaveState("error");
      }
    },
    [data, sectionIdx, saveProgress, sessionId],
  );

  // Fixed heartbeat — never resets on keystrokes (the legacy bug).
  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => {
      void flushSave({ silent: true });
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [data, flushSave]);

  // Flush when the tab hides or the connection returns.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flushSave({ silent: true });
    };
    const onOnline = () => void flushSave({ silent: true });
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
    };
  }, [flushSave]);

  // Flush on unmount.
  useEffect(() => {
    return () => {
      if (dirtyRef.current) void flushSave({ silent: true });
    };
  }, [flushSave]);

  // ── Time accounting + 1s display tick ───────────────────────────────
  const deadlineRef = useRef<number>(0);
  if (data) deadlineRef.current = data.deadlineAt;

  useEffect(() => {
    if (!data) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && !submittedRef.current) {
        timeSpentRef.current[sectionIdx] = (timeSpentRef.current[sectionIdx] ?? 0) + 1;
        const arr = timeMsRef.current[sectionIdx] ?? [];
        arr[qIdx] = (arr[qIdx] ?? 0) + 1000;
        timeMsRef.current[sectionIdx] = arr;
      }
      const remaining = deadlineRef.current - (Date.now() + serverOffsetRef.current);
      if (remaining <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        void (async () => {
          try {
            await submitSession({ sessionId, reason: "timeout" });
            toast("Time is up — your exam was submitted automatically. Saved answers were graded.");
          } catch {
            toast.error("Time is up, but final submission failed — open Results to retry.");
          }
          onFinished();
        })();
      }
      forceTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [data, sectionIdx, qIdx, sessionId, submitSession, onFinished]);

  // ── Keyboard controls ───────────────────────────────────────────────
  useEffect(() => {
    if (!sec) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowRight" || e.key === "n") {
        if (qIdx < sec.questions.length - 1) setQIdx((q) => q + 1);
      } else if (e.key === "ArrowLeft" || e.key === "p") {
        if (qIdx > 0) setQIdx((q) => q - 1);
      } else if (e.key === "f" || e.key === "F") {
        toggleFlag();
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        if (question && idx < question.options.length) pickOption(idx);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sec, qIdx, question, pickOption, toggleFlag]);

  // ── Navigation (flushes state on section change) ────────────────────
  const goToSection = useCallback(
    (idx: number) => {
      void flushSave({ silent: true });
      setSectionIdx(idx);
      setQIdx(0);
      setPaletteOpen(false);
    },
    [flushSave],
  );

  const stepQuestion = useCallback(
    (delta: number) => {
      if (!sec || !data) return;
      const next = qIdx + delta;
      if (next >= 0 && next < sec.questions.length) {
        setQIdx(next);
      } else if (delta > 0 && sectionIdx < data.sections.length - 1) {
        goToSection(sectionIdx + 1);
      } else if (delta < 0 && sectionIdx > 0) {
        const prevLen = data.sections[sectionIdx - 1]?.questions.length ?? 1;
        goToSection(sectionIdx - 1);
        setQIdx(prevLen - 1);
      }
    },
    [sec, data, qIdx, sectionIdx, goToSection],
  );

  // ── Submit flows ────────────────────────────────────────────────────
  const doSubmitSection = useCallback(async () => {
    if (!data || !sec || busy) return;
    setBusy(true);
    try {
      dirtyRef.current = false;
      const res = await submitSection({
        sessionId,
        sectionIndex: sectionIdx,
        answers: answersRef.current[sectionIdx] ?? [],
        flagged: flagsRef.current[sectionIdx] ?? [],
        timeSpentSeconds: timeSpentRef.current[sectionIdx] ?? 0,
        timeMs: timeMsRef.current[sectionIdx],
      });
      if (res.graded) {
        toast.success("Exam submitted — grading complete.");
        onFinished();
        return;
      }
      toast.success(`${sec.subjectName} section submitted.`);
      const next = data.sections.find((s) => s.status !== "submitted" && s.sectionIndex !== sectionIdx);
      if (next) {
        goToSection(next.sectionIndex);
      } else {
        onFinished();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit the section.");
    } finally {
      setBusy(false);
      setConfirmSection(false);
    }
  }, [data, sec, busy, submitSection, sessionId, sectionIdx, onFinished, goToSection]);

  const doSubmitSession = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      dirtyRef.current = false;
      submittedRef.current = true;
      await submitSession({ sessionId, reason: "student" });
      toast.success("Exam submitted — grading complete.");
      onFinished();
    } catch (e) {
      submittedRef.current = false;
      toast.error(e instanceof Error ? e.message : "Could not submit the exam.");
    } finally {
      setBusy(false);
      setConfirmFinish(false);
    }
  }, [busy, submitSession, sessionId, onFinished]);

  const doAbandon = useCallback(async () => {
    try {
      await abandonSession({ sessionId });
      onAbandoned();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not exit the exam.");
    }
  }, [abandonSession, sessionId, onAbandoned]);

  if (!data || !sec || !question) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">Loading exam…</span>
      </div>
    );
  }

  const totalAnswered = data.sections.reduce((n, s) => {
    const arr = answersRef.current[s.sectionIndex] ?? s.answers;
    return n + arr.filter((a) => a >= 0).length;
  }, 0);
  const sectionAnswered = answers.filter((a) => a >= 0).length;
  const unansweredInSection = sec.questions.length - sectionAnswered;
  const lastSavedLabel =
    saveState === "dirty"
      ? "Waiting to sync…"
      : saveState === "saving"
        ? "Saving…"
        : saveState === "error"
          ? "Reconnecting — not saved yet"
          : lastSavedAt
            ? `Saved ${formatClock(Date.now() - lastSavedAt)} ago`
            : "All changes saved";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-36 pt-4 sm:pt-6">
      {/* Header: title, timer, save status */}
      <div className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-bold tracking-tight">{data.title}</h1>
            {data.reducedPractice && (
              <Badge variant="outline" className="shrink-0 text-[10px]">
                Reduced practice
              </Badge>
            )}
          </div>
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-sm font-bold tabular-nums",
              timeCritical ? "border-destructive/40 bg-destructive/10 text-destructive" : "bg-muted/50",
            )}
          >
            <Timer className="size-4" />
            {formatClock(remainingMs)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              "inline-flex items-center gap-1",
              saveState === "error" && "text-destructive",
              saveState === "dirty" && "text-amber-600 dark:text-amber-400",
              saveState === "saved" && "text-emerald-600 dark:text-emerald-400",
            )}
          >
            {saveState === "saving" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : saveState === "error" ? (
              <CloudOff className="size-3" />
            ) : (
              <Check className="size-3" />
            )}
            {lastSavedLabel}
          </span>
          <span>·</span>
          <span>
            {totalAnswered}/{data.questionCount} answered
          </span>
        </div>
        {/* Section pills */}
        <div className="flex flex-wrap gap-1.5">
          {data.sections.map((s) => (
            <button
              key={s.sectionIndex}
              onClick={() => goToSection(s.sectionIndex)}
              className={cn(
                "cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
                s.sectionIndex === sectionIdx
                  ? "border-primary bg-primary text-primary-foreground"
                  : s.status === "submitted"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-muted/40 hover:bg-muted",
              )}
            >
              {s.subjectName}
              <span className="ml-1 opacity-70">
                {(answersRef.current[s.sectionIndex] ?? s.answers).filter((a) => a >= 0).length}/
                {s.questions.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Question card */}
      <div className="rounded-2xl border bg-card p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="font-mono">
              Q{question.number}
            </Badge>
            <span>
              {sec.subjectName} · {qIdx + 1} of {sec.questions.length}
            </span>
            {question.topicText && <span className="hidden sm:inline">· {question.topicText}</span>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFlag}
            className={cn(
              "cursor-pointer gap-1.5 text-xs",
              flags[qIdx] && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {flags[qIdx] ? <Flag className="size-3.5" /> : <FlagOff className="size-3.5" />}
            {flags[qIdx] ? "Flagged" : "Flag"}
          </Button>
        </div>

        {question.passage && (
          <div className="mb-4 rounded-xl border bg-muted/30 p-3 text-sm leading-relaxed">
            <AiText text={question.passage} />
          </div>
        )}

        <div className="mb-5 text-base font-medium leading-relaxed">
          <AiText text={question.stem} />
        </div>

        <div className="space-y-2" role="radiogroup" aria-label="Answer options">
          {question.options.map((opt, i) => {
            const selected = answers[qIdx] === i;
            return (
              <button
                key={opt.label}
                role="radio"
                aria-checked={selected}
                onClick={() => pickOption(i)}
                className={cn(
                  "flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left text-sm transition-colors",
                  selected
                    ? "border-primary bg-primary/10"
                    : "hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-bold",
                    selected ? "border-primary bg-primary text-primary-foreground" : "bg-muted/60",
                  )}
                >
                  {opt.label}
                </span>
                <span className="min-w-0 flex-1 leading-relaxed">
                  <AiText text={opt.text} as="span" />
                </span>
              </button>
            );
          })}
        </div>

        <p className="mt-4 hidden text-[11px] text-muted-foreground sm:block">
          Keyboard: ← → navigate · 1–4 select · F flag
        </p>
      </div>

      {/* Palette */}
      {paletteOpen && (
        <div className="mt-4 rounded-2xl border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold tracking-tight">{sec.subjectName} — question map</p>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full bg-primary" /> answered
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full border-2 border-amber-500" /> flagged
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2.5 rounded-full bg-muted" /> blank
              </span>
            </div>
          </div>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {sec.questions.map((q, i) => {
              const answered = (answersRef.current[sectionIdx] ?? [])[i] >= 0;
              const flagged = (flagsRef.current[sectionIdx] ?? [])[i];
              return (
                <button
                  key={q.number}
                  onClick={() => {
                    setQIdx(i);
                    setPaletteOpen(false);
                  }}
                  className={cn(
                    "flex size-9 cursor-pointer items-center justify-center rounded-lg border font-mono text-xs font-semibold transition-transform active:scale-95",
                    i === qIdx && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                    answered ? "border-primary/40 bg-primary/15" : "bg-muted/40",
                    flagged && "border-2 border-amber-500",
                  )}
                >
                  {q.number}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Sticky bottom bar (mobile-first) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => stepQuestion(-1)}
            disabled={qIdx === 0 && sectionIdx === 0}
          >
            <ChevronLeft className="size-4" />
            <span className="hidden sm:inline">Prev</span>
          </Button>
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setPaletteOpen((p) => !p)}>
            <Grid3x3 className="size-4" />
            <span className="hidden sm:inline">Map</span>
          </Button>
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setConfirmAbandon(true)}>
            Exit
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer text-destructive hover:text-destructive"
            onClick={() => setConfirmFinish(true)}
          >
            <Send className="size-4" />
            <span className="hidden sm:inline">Finish</span>
          </Button>
          <Button size="sm" className="cursor-pointer" onClick={() => setConfirmSection(true)}>
            Submit
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => stepQuestion(1)}
            disabled={qIdx === sec.questions.length - 1 && sectionIdx === data.sections.length - 1}
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      {/* Submit section confirm */}
      <Dialog open={confirmSection} onOpenChange={setConfirmSection}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="tracking-tight">Submit {sec.subjectName}?</DialogTitle>
            <DialogDescription>
              {unansweredInSection > 0
                ? `${unansweredInSection} question${unansweredInSection === 1 ? "" : "s"} in this section ${unansweredInSection === 1 ? "is" : "are"} still blank. Blank answers score zero.`
                : "Every question in this section is answered."}{" "}
              {sectionIdx < data.sections.length - 1
                ? "Submitting a section locks it — the next section opens automatically."
                : "This is the last section — submitting grades your whole exam."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setConfirmSection(false)}>
              Keep working
            </Button>
            <Button className="cursor-pointer" onClick={doSubmitSection} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Submit section
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finish whole exam confirm */}
      <Dialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="tracking-tight">Finish the whole exam?</DialogTitle>
            <DialogDescription>
              Every unfinished section will be graded from your saved answers right now. Unanswered questions score zero. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setConfirmFinish(false)}>
              Back to exam
            </Button>
            <Button className="cursor-pointer" onClick={doSubmitSession} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Finish &amp; grade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Abandon confirm */}
      <Dialog open={confirmAbandon} onOpenChange={setConfirmAbandon}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 tracking-tight">
              <AlertTriangle className="size-5 text-amber-500" />
              Exit without submitting?
            </DialogTitle>
            <DialogDescription>
              Your saved answers stay on the server but the sitting will be marked as abandoned and cannot be resumed for scoring. If you just need a break, keep the exam open — it saves automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer" onClick={() => setConfirmAbandon(false)}>
              Stay in exam
            </Button>
            <Button variant="destructive" className="cursor-pointer" onClick={doAbandon}>
              Abandon exam
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
