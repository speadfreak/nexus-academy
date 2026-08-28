// Exam Mode overlay for the Reader — a fullscreen, focused, timed past-exam
// PDF session. Pure UX wrapper: does NOT extract, alter, or restructure the
// underlying PDF content in any way. The student still reads the same PDF
// (via the same react-pdf pipeline), but with:
//
//   - The sidebar/nav chrome hidden
//   - A real countdown timer (configurable; default 50 min — sensible per-
//     subject duration given the 5h/6-subject EHEEE structure)
//   - No pausing (with a clear warning before starting)
//   - On submit/expiry: lock interaction, reveal it was a timed session,
//     optionally surface an answer-key PDF if one is linked
//   - Logs the session to studySessions + awards XP via the existing
//     logSession mutation (auth-derived, so it works from the client)
//
// The component receives the loaded PDF (Document + page state) as props
// rather than re-loading it, so we don't double-fetch the file.

import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page as PdfPage } from "react-pdf";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { localDateKey } from "@/lib/dates";
import { XP_VALUES } from "@/convex/constants";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

// "pdfjs" is configured by the parent Reader.tsx (worker URL etc.). We don't
// re-configure it here — we just reuse the Document/Page components.
// No PDFJS_OPTIONS are passed either — the Reader's setup uses pdf.js
// defaults, which is the safest path. (Earlier attempts to pass options
// caused regressions where rendering silently failed.)

export type AnswerKeyInfo = {
  _id: Id<"contentItems">;
  title: string;
  isPremium: boolean;
};

export type ExamModeProps = {
  // The loaded PDF data + page state from the parent Reader. We don't
  // duplicate the load — we reuse what the Reader already fetched.
  pdfData: ArrayBuffer | null;
  pdfUrl: string | null;
  numPages: number;
  // The content item's identity — used to log the study session.
  contentId: Id<"contentItems">;
  subjectId: Id<"subjects">;
  contentTitle: string;
  subjectName: string;
  // Optional answer-key content item, linked by the admin.
  answerKey: AnswerKeyInfo | null;
  // Configurable per-section duration in seconds. Default 50 min.
  durationSeconds?: number;
  onClose: () => void;
};

type ExamPhase = "warning" | "running" | "submitted";

export function ReaderExamMode(props: ExamModeProps) {
  const durationSeconds = props.durationSeconds ?? 50 * 60;
  const [phase, setPhase] = useState<ExamPhase>("warning");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [submitting, setSubmitting] = useState(false);

  const logSession = useMutation(api.studySessions.logSession);

  // Countdown ticker — fires every second while running.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "running" || startedAt === null) return;
    tickRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsed);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        // Time's up — auto-submit.
        void handleSubmit(true);
      }
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, startedAt, durationSeconds]);

  const handleStart = () => {
    setStartedAt(Date.now());
    setRemainingSeconds(durationSeconds);
    setPhase("running");
  };

  const handleSubmit = async (autoSubmitted: boolean = false) => {
    if (phase !== "running" || startedAt === null) return;
    if (tickRef.current) clearInterval(tickRef.current);
    setSubmitting(true);
    const endedAt = Date.now();
    const duration = Math.min(Math.floor((endedAt - startedAt) / 1000), durationSeconds);
    try {
      // Log as a focus session so it counts toward streaks + study history.
      // logSession awards XP itself ("focus_session" reason) — we accept
      // that reason here since the dedicated XP amount for exam-mode sessions
      // is the same shape. The session row + streak contribution is what
      // matters most.
      await logSession({
        subjectId: props.subjectId,
        durationSeconds: duration,
        startedAt,
        endedAt,
        localDate: localDateKey(new Date(startedAt)),
      });
      if (autoSubmitted) {
        toast.info("Time's up — exam session submitted.", {
          description: "Your focused study time has been logged. You can now self-grade.",
        });
      } else {
        toast.success("Exam session submitted.", {
          description: `${Math.floor(duration / 60)} min logged. You can now self-grade.`,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not log the session.");
      // Still proceed to the submitted phase — the timer expired, the
      // student has done the work. Logging failure shouldn't lock them out.
    } finally {
      setSubmitting(false);
      setPhase("submitted");
    }
  };

  // Format remaining time as MM:SS or HH:MM:SS.
  const formattedRemaining = useMemo(() => {
    const h = Math.floor(remainingSeconds / 3600);
    const m = Math.floor((remainingSeconds % 3600) / 60);
    const s = remainingSeconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, [remainingSeconds]);

  const isLowTime = remainingSeconds <= 60 && phase === "running";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#080c14]">
      {/* ─── Top bar: exam-conditions chrome (clinical, not warm) ─── */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between border-b px-4 py-3 transition-colors",
          isLowTime
            ? "border-rose-500/40 bg-rose-500/[0.08]"
            : "border-white/10 bg-white/[0.02]",
        )}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-white/5">
            <FileText className="size-4 text-foreground/80" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
              {props.contentTitle}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {props.subjectName} · exam conditions
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {phase === "running" && (
            <div
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 type-mono text-sm font-semibold tabular-nums",
                isLowTime ? "bg-rose-500/20 text-rose-300" : "bg-white/5 text-foreground",
              )}
            >
              <Timer className={cn("size-4", isLowTime && "animate-pulse")} />
              {formattedRemaining}
            </div>
          )}
          {phase === "running" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleSubmit(false)}
              disabled={submitting}
              className="cursor-pointer gap-2 border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
              Submit
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={props.onClose}
              aria-label="Exit exam mode"
              className="size-9 rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ─── Body ─── */}
      <div className="relative flex min-h-0 flex-1">
        {/* Warning phase */}
        {phase === "warning" && (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
              <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
                <AlertTriangle className="size-7" />
              </div>
              <h2 className="type-h2 text-foreground">Exam conditions</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
                You're about to enter a timed, focused session that mirrors real
                exam conditions. The clock starts when you begin and{" "}
                <span className="font-semibold text-foreground">cannot be paused</span> —
                make sure you're ready.
              </p>
              <div className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-3 text-left text-xs">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Clock className="size-3.5" />
                    Duration
                  </div>
                  <p className="mt-1 type-mono text-sm font-semibold text-foreground">
                    {Math.floor(durationSeconds / 60)} min
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Timer className="size-3.5" />
                    Pausing
                  </div>
                  <p className="mt-1 type-mono text-sm font-semibold text-foreground">Disabled</p>
                </div>
              </div>
              {props.answerKey && (
                <div className="mx-auto mt-4 max-w-sm rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-left text-xs text-emerald-200/80">
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                    <CheckCircle2 className="size-3.5" /> Answer key available
                  </div>
                  <p className="mt-1">
                    When you submit, you can self-grade against{" "}
                    <span className="font-semibold">{props.answerKey.title}</span>
                    {props.answerKey.isPremium && " (premium)"}.
                  </p>
                </div>
              )}
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button
                  variant="ghost"
                  onClick={props.onClose}
                  className="cursor-pointer"
                >
                  Not yet
                </Button>
                <Button
                  onClick={handleStart}
                  className="cursor-pointer gap-2 bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                >
                  <Play className="size-4" /> Begin exam
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Running / Submitted phase — PDF view */}
        {(phase === "running" || phase === "submitted") && (
          <>
            {/* Page toolbar */}
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-2 border-t border-white/[0.06] bg-[#080c14]/90 px-4 py-2 backdrop-blur">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
                  disabled={pageNumber <= 1 || phase === "submitted"}
                  className="cursor-pointer"
                >
                  Prev
                </Button>
                <span className="type-mono text-xs text-muted-foreground">
                  {pageNumber} / {props.numPages || "?"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPageNumber((p) => Math.min(props.numPages, p + 1))}
                  disabled={pageNumber >= props.numPages || phase === "submitted"}
                  className="cursor-pointer"
                >
                  Next
                </Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScale((s) => Math.max(0.5, s - 0.1))}
                  disabled={phase === "submitted"}
                  className="cursor-pointer"
                >
                  Zoom out
                </Button>
                <span className="type-mono text-xs text-muted-foreground">
                  {Math.round(scale * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScale((s) => Math.min(2.5, s + 0.1))}
                  disabled={phase === "submitted"}
                  className="cursor-pointer"
                >
                  Zoom in
                </Button>
              </div>
            </div>

            {/* PDF */}
            <div
              className={cn(
                "relative flex-1 overflow-auto bg-[#0b0f17] py-6 pb-20",
                phase === "submitted" && "pointer-events-none opacity-60",
              )}
            >
              <div className="mx-auto w-fit shadow-2xl">
                {props.pdfData ? (
                  <Document
                    file={{ data: props.pdfData }}
                    loading={
                      <div className="flex h-40 items-center justify-center">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    }
                    error={
                      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                        Could not render the PDF in exam mode.
                      </div>
                    }
                  >
                    <PdfPage
                      pageNumber={pageNumber}
                      scale={scale}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      className="rounded-sm"
                    />
                  </Document>
                ) : props.pdfUrl ? (
                  <iframe
                    src={`${props.pdfUrl}#page=${pageNumber}&zoom=${Math.round(scale * 100)}`}
                    title="Exam PDF"
                    className="h-[80vh] w-[80vw] max-w-4xl rounded-md bg-white"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
                    PDF not loaded.
                  </div>
                )}
              </div>
            </div>

            {/* Submitted overlay — reveals completion + answer key */}
            {phase === "submitted" && (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#080c14]/85 backdrop-blur-sm">
                <div className="mx-auto max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
                  <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
                    <CheckCircle2 className="size-7" />
                  </div>
                  <h2 className="type-h2 text-foreground">Session complete</h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                    Your timed exam session has been logged as focused study
                    time. The PDF is now locked.
                  </p>
                  {props.answerKey ? (
                    <div className="mt-5">
                      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3 text-left">
                        <p className="text-xs text-emerald-200/80">
                          <span className="font-semibold text-emerald-300">Self-grade now:</span>{" "}
                          open the answer key and compare your answers.
                        </p>
                        <a
                          href={`/read/${props.answerKey._id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition-colors hover:bg-emerald-400/20"
                        >
                          <ExternalLink className="size-3.5" />
                          Open {props.answerKey.title}
                          {props.answerKey.isPremium && (
                            <Badge variant="outline" className="ml-1 text-[9px]">PREMIUM</Badge>
                          )}
                        </a>
                      </div>
                    </div>
                  ) : (
                    <p className="mx-auto mt-4 max-w-sm text-xs text-muted-foreground">
                      No answer key is linked to this past exam. Ask an admin to
                      upload the answer PDF and link it to this content item.
                    </p>
                  )}
                  <div className="mt-6">
                    <Button onClick={props.onClose} className="cursor-pointer gap-2">
                      <X className="size-4" /> Exit exam mode
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
