// Matric OS — CBT Examination Player (Phase 4).
//
// Design contract:
//   - SERVER-AUTHORITATIVE TIMER: remaining time derives from the server
//     deadline + a clock offset captured from server payloads. A closed
//     browser, dead battery or manipulated system clock changes nothing —
//     the cron sweeper grades expired sessions from saved answers.
//   - AUTOSAVE: debounced saves on every answer change, a 15s safety
//     flush, a flush on tab-hide, and a local draft so unsynced answers
//     survive a crash. The save status is always honest ("Offline — saved
//     on this device, will sync").
//   - NO ANSWER LEAKAGE: this component only ever receives PlayerQuestion
//     (no answer labels, no explanations) — verified by the sanitizer.
//   - Keyboard-first CBT controls + mobile palette drawer.
//   - Professional math typesetting via the shared Learnyx Math Renderer.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ActiveSessionPayload } from "@/convex/matricEngine";
import { AiText, preloadMathRenderer } from "@/components/math";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Flag,
  LayoutGrid,
  Loader2,
  CloudUpload,
  CloudOff,
  Check,
} from "lucide-react";

// Focused-header mode badge — server mode string → human label.
const MODE_LABELS: Record<string, string> = {
  subject_mock: "Subject mock",
  full_simulation: "Full simulation",
  weakness_challenge: "Weakness challenge",
  past_paper: "Past paper",
};

function modeLabel(mode: string): string {
  const known = MODE_LABELS[mode];
  if (known) return known;
  const spaced = mode.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type SaveState = "idle" | "saving" | "saved" | "offline";

const LETTERS = ["A", "B", "C", "D", "E"];

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function MatricPlayer({
  payload,
  onSubmitted,
  onExit,
}: {
  payload: ActiveSessionPayload;
  onSubmitted: (sessionId: string) => void;
  onExit: () => void;
}) {
  const { sessionId, questions, sections, deadlineAt } = payload;

  const saveProgress = useMutation(api.matricEngine.saveProgress);
  const submitMatricExam = useMutation(api.matricEngine.submitMatricExam);

  // ── Exam state (restored from server, then local draft) ──
  const [answers, setAnswers] = useState<string[]>(() => [...payload.answers]);
  const [flags, setFlags] = useState<boolean[]>(() => [...payload.flags]);
  const [timeMs, setTimeMs] = useState<number[]>(() => [...payload.timeMs]);
  const [idx, setIdx] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.round((deadlineAt - payload.serverNow) / 1000)),
  );
  const [submitOpen, setSubmitOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [exiting, setExiting] = useState(false);

  // Clock offset: serverNow vs client now at payload creation — every
  // save response refreshes it, keeping the countdown truthful.
  const offsetRef = useRef(Date.now() - payload.serverNow);
  const dirtyRef = useRef(false);
  const stateRef = useRef({ answers, flags, timeMs });
  stateRef.current = { answers, flags, timeMs };
  const submittingRef = useRef(false);
  const dwellStartRef = useRef<number>(Date.now());
  const draftKey = `matric-os-draft-${sessionId}`;
  // History guard: true once the student has confirmed leaving (or the exam
  // was submitted) — popstate then stops intercepting navigation.
  const exitingRef = useRef(false);

  // ── Navigation-away guards ──
  // The active exam is NEVER silently discarded, reset or submitted when the
  // student navigates away. Three layers:
  //
  //   1. HISTORY GUARD — a sentinel history entry is pushed on mount, so a
  //      browser back / mobile swipe-back pops the sentinel (not the real
  //      previous route) and we can confirm intent first. Confirming exits
  //      to the hub; cancelling re-arms the sentinel. The URL never leaves
  //      /mock-exam, so nothing is lost and the session keeps running.
  //   2. EXIT CONFIRMATION — the Exit Exam action always asks first and
  //      explains exactly what persists (answers + server timer).
  //   3. BEFOREUNLOAD — closing the tab / hard reload mid-exam asks for
  //      confirmation (the server session and autosaved answers survive
  //      regardless; the prompt is intent-confirmation, not data loss).
  const disarmHistoryGuard = useCallback(() => {
    exitingRef.current = true;
    try {
      // The sentinel is the CURRENT (top) history entry while in the player;
      // rewriting its state disarms the popstate guard without disturbing
      // the back stack the student came from.
      if (window.history.state?.matricExamGuard) {
        window.history.replaceState({}, "");
      }
    } catch {
      // History API unavailable (rare embedding cases) — guard stays harmless.
    }
  }, []);

  useEffect(() => {
    try {
      if (!window.history.state?.matricExamGuard) {
        window.history.pushState({ matricExamGuard: true }, "");
      }
    } catch {
      return; // no History API — SPA back-guard simply not available
    }
    const onPop = () => {
      if (exitingRef.current) return;
      // The student pressed back / swiped back: confirm intent, re-arm.
      setExitOpen(true);
      try {
        if (!window.history.state?.matricExamGuard) {
          window.history.pushState({ matricExamGuard: true }, "");
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (submittingRef.current || exitingRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Preload the math renderer shortly after mount.
  useEffect(() => {
    const t = setTimeout(() => void preloadMathRenderer(), 1200);
    return () => clearTimeout(t);
  }, []);

  // ── Local draft: recover unsynced answers after a crash/reload ──
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        answers: string[];
        flags: boolean[];
        timeMs: number[];
        ts: number;
      };
      // Only restore if the draft is NEWER than the server snapshot AND
      // actually differs (i.e. answers that never made it to the server).
      const serverEmpty = payload.answers.every((a) => !a);
      if (draft.ts > payload.serverNow && (serverEmpty || draft.ts > payload.serverNow + 5000)) {
        if (JSON.stringify(draft.answers) !== JSON.stringify(payload.answers)) {
          setAnswers(draft.answers);
          setFlags(draft.flags);
          setTimeMs(draft.timeMs);
          toast.info("Restored unsynced answers from this device.");
          dirtyRef.current = true;
        }
      }
    } catch {
      // corrupted draft — ignore, server state is authoritative
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft on every state change (cheap, local only).
  useEffect(() => {
    try {
      localStorage.setItem(
        draftKey,
        JSON.stringify({ answers, flags, timeMs, ts: Date.now() }),
      );
    } catch {
      // storage full/private mode — server autosave still protects the student
    }
  }, [answers, flags, timeMs, draftKey]);

  // ── Dwell-time tracking (per-question, like the legacy engine) ──
  const flushDwell = useCallback(
    (questionIdx: number) => {
      const now = Date.now();
      const delta = now - dwellStartRef.current;
      dwellStartRef.current = now;
      setTimeMs((prev) => {
        if (!prev[questionIdx]) return prev;
        const next = [...prev];
        next[questionIdx] = (next[questionIdx] ?? 0) + delta;
        return next;
      });
    },
    [],
  );

  // ── Autosave ──
  const flushSave = useCallback(
    async (opts?: { silent?: boolean }): Promise<boolean> => {
      if (submittingRef.current) return false;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        const res = await saveProgress({
          sessionId,
          answers: stateRef.current.answers,
          flags: stateRef.current.flags,
          timeMs: stateRef.current.timeMs,
        });
        offsetRef.current = Date.now() - res.serverNow;
        setRemaining(
          Math.max(0, Math.round((deadlineAt - res.serverNow) / 1000)),
        );
        setSaveState("saved");
        setLastSavedAt(Date.now());
        return true;
      } catch (e) {
        dirtyRef.current = true;
        setSaveState("offline");
        if (!opts?.silent) {
          const msg = e instanceof Error ? e.message : String(e);
          // A session that no longer exists (invalidated) — stop retrying.
          if (msg.includes("not found")) {
            toast.error("This exam session is no longer available.");
            onExit();
          }
        }
        return false;
      }
    },
    [saveProgress, sessionId, deadlineAt, onExit],
  );

  // Mark dirty on any answer/flag change; debounced save.
  useEffect(() => {
    dirtyRef.current = true;
    const t = setTimeout(() => void flushSave({ silent: true }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, flags]);

  // Safety flush every 15s + on tab hide + on reconnect.
  useEffect(() => {
    const interval = setInterval(() => {
      if (dirtyRef.current) void flushSave({ silent: true });
    }, 15000);
    const onHide = () => {
      if (document.visibilityState === "hidden" && dirtyRef.current) {
        void flushSave({ silent: true });
      }
    };
    const onOnline = () => {
      if (dirtyRef.current) void flushSave({ silent: true });
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", onOnline);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("online", onOnline);
    };
  }, [flushSave]);

  // ── Confirmed exit: final save, disarm guard, back to the hub ──
  // Runs AFTER the autosave machinery above so the "Save & leave" flush
  // uses the real save pipeline (server autosave + clock-offset refresh).
  const handleExit = useCallback(async () => {
    setExiting(true);
    try {
      // Flush any unsaved answers first — "Save & leave" must be literal.
      await flushSave({ silent: true });
    } catch {
      // flushSave never throws in practice; the local draft + 15s safety
      // loop still protect the student either way.
    }
    disarmHistoryGuard();
    setExiting(false);
    setExitOpen(false);
    onExit();
  }, [flushSave, disarmHistoryGuard, onExit]);

  // ── Server-authoritative countdown + auto-submit at zero ──
  useEffect(() => {
    const tick = () => {
      const serverNow = Date.now() - offsetRef.current;
      const left = Math.max(0, Math.round((deadlineAt - serverNow) / 1000));
      setRemaining(left);
      if (left <= 0) {
        void doSubmit("auto_expiry");
      }
    };
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt]);

  // ── Submission ──
  const doSubmit = useCallback(
    async (source: "student" | "auto_expiry" = "student") => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setSubmitting(true);
      // Final dwell flush for the current question.
      const now = Date.now();
      const delta = now - dwellStartRef.current;
      const finalTimeMs = [...stateRef.current.timeMs];
      finalTimeMs[idx] = (finalTimeMs[idx] ?? 0) + delta;
      stateRef.current = { ...stateRef.current, timeMs: finalTimeMs };
      try {
        const res = await submitMatricExam({
          sessionId,
          answers: stateRef.current.answers,
          flags: stateRef.current.flags,
          timeMs: finalTimeMs,
          ...(source === "student" ? { source: "student" as const } : {}),
        });
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
        if (source === "auto_expiry") {
          toast.info("Time is up — your exam was submitted automatically.");
        }
        disarmHistoryGuard();
        onSubmitted(res.sessionId);
      } catch (e) {
        submittingRef.current = false;
        setSubmitting(false);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("already") || msg.includes("graded")) {
          // Idempotent path — grading already happened; show results.
          disarmHistoryGuard();
          onSubmitted(sessionId);
        } else {
          toast.error("Submission failed. Retrying is safe — your answers are saved.");
        }
      }
    },
    [submitMatricExam, sessionId, draftKey, onSubmitted, idx, disarmHistoryGuard],
  );

  // ── Navigation + answer selection ──
  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= questions.length) return;
      flushDwell(idx);
      setIdx(next);
      setPaletteOpen(false);
    },
    [questions.length, flushDwell, idx],
  );

  const choose = useCallback(
    (label: string | null) => {
      setAnswers((prev) => {
        const next = [...prev];
        next[idx] = label ?? "";
        return next;
      });
    },
    [idx],
  );

  const toggleFlag = useCallback(() => {
    setFlags((prev) => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }, [idx]);

  // Keyboard CBT controls.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const q = questions[idx];
      if (!q) return;
      if (e.key === "ArrowRight") goTo(idx + 1);
      else if (e.key === "ArrowLeft") goTo(idx - 1);
      else if (e.key.toLowerCase() === "f") toggleFlag();
      else {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= q.choices.length) choose(LETTERS[n - 1] ?? null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [idx, questions, goTo, toggleFlag, choose]);

  // ── Derived ──
  const answeredCount = answers.filter((a) => !!a).length;
  const flaggedCount = flags.filter(Boolean).length;
  const current = questions[idx];
  const currentSection = useMemo(() => {
    if (!current) return null;
    return sections.find((s) => idx >= s.startIndex && idx < s.endIndex) ?? null;
  }, [current, idx, sections]);
  const sectionOrdinal = currentSection
    ? sections.findIndex((s) => s.subjectId === currentSection.subjectId) + 1
    : 0;

  const timerTone =
    remaining <= 60
      ? "text-rose-300 animate-pulse"
      : remaining <= 300
        ? "text-amber-300"
        : "text-foreground";

  const saveLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "offline"
        ? "Offline — saved on this device, will sync"
        : saveState === "saved" && lastSavedAt
          ? `Saved ${new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          : "All changes saved";

  if (!current) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
        This session has no questions.
      </div>
    );
  }

  const saveIcon =
    saveState === "offline" ? (
      <CloudOff className="size-3.5 text-rose-300" />
    ) : saveState === "saving" ? (
      <Loader2 className="size-3.5 animate-spin" />
    ) : saveState === "saved" ? (
      <Check className="size-3.5 text-emerald-300" />
    ) : (
      <CloudUpload className="size-3.5" />
    );

  return (
    <div className="flex flex-col gap-4">
      {/* ── FOCUSED EXAMINATION HEADER — the exam owns the screen. No site
          navigation here by design: subject + mode · save status ·
          server-authoritative timer · progress · flag & palette access ·
          Exit Exam (always confirmed, never silent). ── */}
      <div
        className="sticky top-0 z-30 -mx-4 border-b border-border/60 bg-background/90 px-4 backdrop-blur-md sm:-mx-6 sm:px-6"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingBottom: "0.5rem",
        }}
      >
        <div className="mx-auto max-w-5xl">
          {/* Row 1 — exit · identity · save · timer */}
          <div className="flex items-center gap-2 sm:gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExitOpen(true)}
              disabled={submitting}
              className="focus-ring h-8 shrink-0 gap-1.5 rounded-lg border-border/70 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground sm:h-9 sm:px-3 sm:text-sm"
            >
              <ArrowLeft className="size-3.5" />
              <span className="hidden sm:inline">Exit exam</span>
              <span className="sm:hidden">Exit</span>
            </Button>
            <div className="min-w-0 flex-1">
              <p className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded-md border border-amber-400/25 bg-amber-400/[0.07] px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-amber-300">
                  {modeLabel(payload.mode)}
                </span>
                <span className="truncate text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  {payload.title}
                </span>
              </p>
              {currentSection && (
                <p className="mt-0.5 truncate text-sm font-semibold text-amber-200">
                  {currentSection.subjectName}
                  {sections.length > 1 ? (
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                      Section {sectionOrdinal} of {sections.length}
                    </span>
                  ) : null}
                </p>
              )}
            </div>
            <div
              className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
              aria-live="polite"
              role="status"
            >
              {saveIcon}
              <span className="hidden sm:inline">{saveLabel}</span>
              <span className="sr-only sm:hidden">{saveLabel}</span>
            </div>
            <div
              className={`shrink-0 font-mono text-lg font-bold tabular-nums sm:text-xl ${timerTone}`}
              role="timer"
              aria-label={`Time remaining ${fmtClock(remaining)}`}
            >
              {fmtClock(remaining)}
            </div>
          </div>
          {/* Row 2 — progress · flag · palette (mark-for-review access) */}
          <div className="mt-2 flex items-center gap-2">
            <Progress
              value={(answeredCount / questions.length) * 100}
              className="h-1 min-w-0 flex-1"
              aria-label={`${answeredCount} of ${questions.length} questions answered`}
            />
            <span
              className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {answeredCount}/{questions.length}
            </span>
            <button
              type="button"
              onClick={toggleFlag}
              aria-pressed={flags[idx]}
              aria-label={
                flags[idx]
                  ? "Remove flag from this question"
                  : "Flag this question for review"
              }
              className={`focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                flags[idx]
                  ? "border-rose-400/50 bg-rose-400/15 text-rose-200"
                  : "border-border/70 text-muted-foreground hover:border-rose-400/30 hover:text-rose-200"
              }`}
            >
              <Flag className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              aria-label="Open question palette"
              className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:border-amber-400/30 hover:text-foreground lg:hidden"
            >
              <LayoutGrid className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Save status — full label lives in the document flow for screen
          readers and desktop clarity; the header icon mirrors it live. */}
      <p className="sr-only" aria-live="polite">{saveLabel}</p>

      <div className="mx-auto flex w-full max-w-5xl gap-6">
        {/* ── QUESTION COLUMN ── */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              Question <span className="text-foreground">{idx + 1}</span> of {questions.length}
            </p>
            <button
              type="button"
              onClick={toggleFlag}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                flags[idx]
                  ? "border-rose-400/40 bg-rose-400/10 text-rose-200"
                  : "border-border text-muted-foreground hover:border-rose-400/30 hover:text-rose-200"
              }`}
              aria-pressed={flags[idx]}
            >
              <Flag className="size-3.5" />
              {flags[idx] ? "Flagged" : "Flag for review"}
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-border/70 bg-card/60 p-5 sm:p-6">
            {current.passage && (
              <div className="mb-4 rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-4 text-[15px] leading-relaxed">
                <AiText text={current.passage} />
              </div>
            )}
            <div className="text-[15px] font-medium leading-relaxed sm:text-base">
              <AiText text={current.stem} />
            </div>
            {current.figureHint && (
              <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200/90">
                This question refers to a diagram in the original paper.
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2.5" role="radiogroup" aria-label="Answer choices">
              {current.choices.map((c, i) => {
                const selected = answers[idx] === c.label;
                return (
                  <button
                    key={c.label}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choose(c.label)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all ${
                      selected
                        ? "border-amber-400/60 bg-amber-400/10 text-foreground shadow-[0_0_0_1px_rgba(251,191,36,0.25)]"
                        : "border-border/70 bg-background/40 text-foreground/90 hover:border-amber-400/30 hover:bg-amber-400/[0.03]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${
                        selected
                          ? "bg-amber-400 text-black"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.label}
                    </span>
                    <span className="min-w-0 flex-1 leading-relaxed">
                      <AiText text={c.text} as="span" />
                    </span>
                    <kbd className="hidden shrink-0 rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                      {i + 1}
                    </kbd>
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Keyboard: 1–{current.choices.length} select · ← → navigate · F flag</span>
              {answers[idx] && (
                <button
                  type="button"
                  onClick={() => choose(null)}
                  className="underline-offset-2 hover:underline"
                >
                  Clear answer
                </button>
              )}
            </div>
          </div>

          {/* ── NAV ── */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={() => goTo(idx - 1)} disabled={idx === 0}>
              <ChevronLeft className="size-4" /> Previous
            </Button>
            {idx === questions.length - 1 ? (
              <Button size="sm" onClick={() => setSubmitOpen(true)} className="bg-amber-400 text-black hover:bg-amber-300">
                Review &amp; Submit
              </Button>
            ) : (
              <Button size="sm" onClick={() => goTo(idx + 1)}>
                Next <ChevronRight className="size-4" />
              </Button>
            )}
          </div>

          <div className="mt-4 flex justify-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setSubmitOpen(true)}
            >
              Submit exam
            </Button>
          </div>
        </div>

        {/* ── DESKTOP PALETTE ── */}
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-28 rounded-2xl border border-border/70 bg-card/50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
              Palette
            </p>
            <div className="mt-2 flex gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm bg-amber-400" /> answered
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="size-2 rounded-sm border border-rose-400" /> flagged
              </span>
            </div>
            <div className="mt-3">
              <PaletteGrid
                questions={questions}
                answers={answers}
                flags={flags}
                idx={idx}
                onJump={(i) => goTo(i)}
              />
            </div>
            <Button
              size="sm"
              className="mt-4 w-full bg-amber-400 text-black hover:bg-amber-300"
              onClick={() => setSubmitOpen(true)}
            >
              Review &amp; Submit
            </Button>
          </div>
        </aside>
      </div>

      {/* ── QUESTION PALETTE (controlled — triggered from the focused header) ── */}
      <Sheet open={paletteOpen} onOpenChange={setPaletteOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-left">Question palette</SheetTitle>
          </SheetHeader>
          <PaletteGrid
            questions={questions}
            answers={answers}
            flags={flags}
            idx={idx}
            onJump={(i) => goTo(i)}
          />
        </SheetContent>
      </Sheet>

      {/* ── SUBMIT CONFIRMATION ── */}
      <AlertDialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your exam?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  You answered <strong>{answeredCount}</strong> of{" "}
                  <strong>{questions.length}</strong> questions
                  {flaggedCount > 0 ? (
                    <>
                      {" "}
                      and flagged <strong>{flaggedCount}</strong> for review
                    </>
                  ) : null}
                  .
                </p>
                {answeredCount < questions.length && (
                  <p className="text-amber-300">
                    {questions.length - answeredCount} unanswered questions will be
                    scored as incorrect.
                  </p>
                )}
                <p className="text-muted-foreground">
                  Submission is final. Your score is calculated instantly against
                  the verified answer keys.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Keep working</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(e) => {
                e.preventDefault();
                void doSubmit("student");
              }}
              className="bg-amber-400 text-black hover:bg-amber-300"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Submitting…
                </>
              ) : (
                "Submit final answers"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── EXIT CONFIRMATION — leaving is never silent. Answers and the
          server-side timer persist; nothing is submitted or discarded. ── */}
      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this exam?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Your answers are <strong>autosaved</strong> — everything you
                  have answered so far is safely stored on Learnyx servers.
                </p>
                <p>
                  The timer <strong>keeps running on the server</strong> while
                  you are away. Resume any time from the Matric OS hub; if time
                  runs out first, your saved answers are submitted and graded
                  automatically.
                </p>
                <p className="text-muted-foreground">
                  Leaving never submits your exam early, resets it, or discards
                  your progress.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={exiting}>Keep working</AlertDialogCancel>
            <AlertDialogAction
              disabled={exiting}
              onClick={(e) => {
                e.preventDefault();
                void handleExit();
              }}
            >
              {exiting ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save & leave"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PaletteGrid({
  questions,
  answers,
  flags,
  idx,
  onJump,
}: {
  questions: ActiveSessionPayload["questions"];
  answers: string[];
  flags: boolean[];
  idx: number;
  onJump: (i: number) => void;
}) {
  return (
    <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10 lg:grid-cols-6">
      {questions.map((q, i) => {
        const answered = !!answers[i];
        const flagged = flags[i];
        const isCurrent = i === idx;
        return (
          <button
            key={q.i}
            type="button"
            onClick={() => onJump(i)}
            aria-label={`Question ${i + 1}${answered ? ", answered" : ", unanswered"}${flagged ? ", flagged" : ""}`}
            className={`relative flex h-9 items-center justify-center rounded-md text-xs font-semibold transition-colors ${
              isCurrent
                ? "ring-2 ring-amber-300 ring-offset-1 ring-offset-background"
                : ""
            } ${
              answered
                ? "bg-amber-400/90 text-black hover:bg-amber-300"
                : "bg-muted/60 text-muted-foreground hover:bg-muted"
            }`}
          >
            {i + 1}
            {flagged && (
              <span
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full border border-background bg-rose-400"
                aria-hidden
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
