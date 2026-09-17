// DigitalExam — /exam-prep/digital/:contentId?mode=practice|exam
//
// The auto-conversion system. When a student opens ANY past paper here,
// this page:
//   1. Resolves the PDF URL (premium papers pass the server-side
//      subscription gate through contentAdmin.getDownloadUrl).
//   2. Claims the conversion job on the backend (dedupe: ready papers
//      replay instantly; in-flight conversions show a live reactive wait).
//   3. Extracts the PDF text in the student's browser (pdf.js), streams
//      page-aligned chunks to the AI transcription action, and shows a
//      cinematic honest pipeline: pages read → questions transcribed.
//   4. Auto-lands on the fully digital player the moment the paper flips
//      ready. Every future visit is instant (cached conversion).
//
// Honesty everywhere: the pipeline explains that questions are transcribed
// — never invented — and that answers/explanations are AI-suggested.
// Pure image scans (no text layer) fall back to the original PDF view.

import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  FileText,
  FileWarning,
  Loader2,
  ScanLine,
  Sparkles,
  Volume2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";
import { DigitalExamPlayer, type ExamMode } from "@/components/exam/DigitalExamPlayer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { DigitalQuestion } from "@/components/exam/DigitalExamPlayer";
import { chunkPages, extractPdfTextPages } from "@/lib/pdfText";
import { cn } from "@/lib/utils";

type PipelineStage = "idle" | "fetching" | "extracting" | "transcribing" | "done";

export default function DigitalExam() {
  const { contentId } = useParams<{ contentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const modeParam = searchParams.get("mode") === "exam" ? "exam" : "practice";
  const [mode] = useState<ExamMode>(modeParam);

  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);
  const beginDigitization = useMutation(api.examPrepDigital.beginDigitization);
  const parsePaperChunk = useAction(api.examPrepDigital.parsePaperChunk);

  // The paper row — reactive: flips to ready even while we stream chunks.
  const digital = useQuery(
    api.examPrepDigital.getDigitalPaper,
    contentId ? { contentId: contentId as never } : "skip",
  );
  const content = useQuery(
    api.content.getReaderContent,
    contentId ? { contentId: contentId as never } : "skip",
  );

  const [stage, setStage] = useState<PipelineStage>("idle");
  const [pageProgress, setPageProgress] = useState({ page: 0, pageCount: 0 });
  const [chunkProgress, setChunkProgress] = useState({ chunk: 0, chunkCount: 0, questions: 0 });
  const [convertError, setConvertError] = useState<string | null>(null);
  const [scannedFallback, setScannedFallback] = useState(false);
  const [premiumWall, setPremiumWall] = useState(false);
  const runningRef = useRef(false);
  const claimedRef = useRef(false);

  // ── Resolve the PDF URL (premium papers go through the server gate) ──
  const resolveUrl = useCallback(async (): Promise<string | null> => {
    if (!content?.item || !contentId) return null;
    if (content.item.isPremium) {
      try {
        const { url } = await getDownloadUrl({ contentId: contentId as never });
        return url;
      } catch {
        setPremiumWall(true);
        return null;
      }
    }
    return content.item.fileUrl;
  }, [content, contentId, getDownloadUrl]);

  // ── The conversion pipeline ──
  const runConversion = useCallback(async () => {
    if (!contentId || !content?.item || runningRef.current) return;
    runningRef.current = true;
    setConvertError(null);
    setScannedFallback(false);

    try {
      setStage("fetching");
      const claim = await beginDigitization({ contentId: contentId as never });

      if (claim.kind === "ready" || claim.kind === "processing") {
        // Reactive query lands us on the player/waiting screen — nothing to do.
        setStage("done");
        return;
      }
      claimedRef.current = true;
      const digitalPaperId = claim.digitalPaperId;
      if (!digitalPaperId) throw new Error("Conversion claim failed.");

      setStage("fetching");
      const url = await resolveUrl();
      if (!url) return; // premium wall shown by resolveUrl

      setStage("extracting");
      const extraction = await extractPdfTextPages(url, (page, pageCount) =>
        setPageProgress({ page, pageCount }),
      );

      if (!extraction.hasTextLayer) {
        setScannedFallback(true);
        // Complete the empty job honestly — zero questions → backend records
        // a clear failure so every visitor sees the same guidance.
        await parsePaperChunk({
          contentId: contentId as never,
          digitalPaperId: digitalPaperId as never,
          chunkIndex: 0,
          chunkCount: 1,
          pageCount: extraction.pageCount,
          text: "",
        });
        setStage("done");
        return;
      }

      const chunks = chunkPages(extraction.pages);
      setStage("transcribing");
      let totalQuestions = 0;
      for (const chunk of chunks) {
        setChunkProgress((prev) => ({ ...prev, chunk: chunk.index, chunkCount: chunks.length }));
        const res = await parsePaperChunk({
          contentId: contentId as never,
          digitalPaperId: digitalPaperId as never,
          chunkIndex: chunk.index,
          chunkCount: chunks.length,
          pageCount: extraction.pageCount,
          text: chunk.text,
        });
        totalQuestions += res.questionsFound;
        setChunkProgress((prev) => ({ ...prev, questions: totalQuestions }));
        // Gentle pacing between chunks — AI providers meter tokens per
        // minute; the action itself backs off on 429s, this keeps us from
        // getting there in the first place.
        if (chunk.index < chunks.length - 1) {
          await new Promise((r) => setTimeout(r, 4_000));
        }
      }
      setStage("done");
      // No manual hand-off: the reactive getDigitalPaper query flips to
      // ready and renders the player automatically.
    } catch (err) {
      const message = (err as Error).message || "Something went wrong while converting this paper.";
      setConvertError(message);
      setStage("done");
    } finally {
      runningRef.current = false;
    }
  }, [beginDigitization, content, contentId, parsePaperChunk, resolveUrl]);

  // ── Auto-retry: when the row is failed and the error was a chunk-level
  //    Convex retry (sequence guard), the UI offers a Retry button instead.

  const playerQuestions = useMemo<DigitalQuestion[] | null>(() => {
    if (!digital || digital.status !== "ready" || !digital.questions) return null;
    return digital.questions as DigitalQuestion[];
  }, [digital]);

  // ── Render states ──
  if (!contentId) {
    return <NotFoundShell message="No paper specified." />;
  }
  if (content === undefined || digital === undefined) {
    return <PipelineShell><LoadingBlock label="Loading the paper…" /></PipelineShell>;
  }
  if (content === null || !content.item) {
    return <NotFoundShell message="This paper doesn't exist (or was removed)." />;
  }

  const item = content.item;

  // Premium wall — the same gate the Reader enforces, shown honestly here.
  if (premiumWall) {
    return (
      <PipelineShell>
        <div className="mx-auto max-w-xl rounded-3xl border border-premium/25 bg-premium/[0.05] p-8 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-premium/15 text-premium">
            <Crown className="size-6" />
          </span>
          <h2 className="mt-4 type-h2">This paper is premium</h2>
          <p className="mt-2 type-body text-muted-foreground">
            The digital version of <span className="font-semibold text-foreground">{item.title}</span> is
            part of Learnyx Premium — upgrade to unlock every past paper, fully digitized, with
            read-aloud and instant scoring.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => navigate("/upgrade")} className="interactive-press gap-2">
              <Crown className="size-4" /> See plans
            </Button>
            <Button variant="outline" onClick={() => navigate("/exam-prep?tab=papers")} className="interactive-press gap-2">
              <ArrowLeft className="size-4" /> Back to papers
            </Button>
          </div>
        </div>
      </PipelineShell>
    );
  }

  // ── Ready → the player itself ──
  if (playerQuestions && playerQuestions.length > 0) {
    return (
      <DigitalExamPlayer
        key={`${digital!._id}-${mode}`}
        contentId={contentId}
        subjectId={item.subjectId}
        paperTitle={item.title}
        subjectName={item.subjectName}
        grade={item.grade}
        examYear={item.examYear ?? null}
        durationMinutes={item.durationMinutes ?? 120}
        mode={mode}
        questions={playerQuestions}
      />
    );
  }

  // ── Failed → honest failure + retry ──
  if (digital?.status === "failed") {
    return (
      <PipelineShell>
        <div className="mx-auto max-w-xl rounded-3xl border border-rose-400/25 bg-rose-400/[0.04] p-8 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-rose-400/15 text-rose-300">
            {scannedFallback ? <ScanLine className="size-6" /> : <FileWarning className="size-6" />}
          </span>
          <h2 className="mt-4 type-h2">
            {scannedFallback ? "This paper is a scanned image" : "Conversion didn't make it"}
          </h2>
          <p className="mt-2 type-body text-muted-foreground">
            {scannedFallback
              ? "This PDF has no selectable text layer, so its questions can't be auto-converted. You can still open it in the original reader — or try again if a text version appears."
              : digital.error ?? convertError ?? "The transcription hit an unexpected error. Retrying usually fixes it."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => {
                setScannedFallback(false);
                setConvertError(null);
                void runConversion();
              }}
              className="interactive-press gap-2"
            >
              <Wand2 className="size-4" /> Try again
            </Button>
            <Button variant="outline" asChild className="interactive-press gap-2">
              <Link to={`/read/${contentId}`}>
                <BookOpen className="size-4" /> Open the original PDF
              </Link>
            </Button>
          </div>
        </div>
      </PipelineShell>
    );
  }

  // ── Processing → pipeline UI (own run) or live wait (someone else's) ──
  if (digital?.status === "processing") {
    const mine = digital.startedByMe && (stage === "fetching" || stage === "extracting" || stage === "transcribing" || (stage === "done" && !convertError));
    return (
      <PipelineShell>
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {mine ? (
            <PipelineCard
              item={item}
              stage={stage}
              pageProgress={pageProgress}
              chunkProgress={chunkProgress}
              error={convertError}
              totalChars={null}
            />
          ) : (
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
              <Loader2 className="mx-auto size-8 animate-spin text-amber-300" />
              <h2 className="mt-4 type-h2">Converting this paper right now</h2>
              <p className="mx-auto mt-2 max-w-md type-body text-muted-foreground">
                Another student just digitized it — you'll jump straight into the digital
                paper the moment it's ready. This screen updates by itself.
              </p>
              <Button variant="outline" asChild className="interactive-press mt-5 gap-2">
                <Link to="/exam-prep?tab=papers">
                  <ArrowLeft className="size-4" /> Back to papers
                </Link>
              </Button>
            </div>
          )}
        </div>
      </PipelineShell>
    );
  }

  // ── No conversion yet → the launch / start-conversion screen ──
  return (
    <PipelineShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <PipelineCard
          item={item}
          stage={stage}
          pageProgress={pageProgress}
          chunkProgress={chunkProgress}
          error={convertError}
          totalChars={null}
          onStart={() => void runConversion()}
          mode={mode}
        />
      </div>
    </PipelineShell>
  );
}

// ─── Pipeline card — the honest "what's happening" UI ────────────────────

function PipelineCard({
  item,
  stage,
  pageProgress,
  chunkProgress,
  error,
  onStart,
  mode,
}: {
  item: { title: string; subjectName: string; grade: number; examYear?: number; pageCount?: number; durationMinutes?: number };
  stage: PipelineStage;
  pageProgress: { page: number; pageCount: number };
  chunkProgress: { chunk: number; chunkCount: number; questions: number };
  error: string | null;
  totalChars: string | null;
  onStart?: () => void;
  mode?: ExamMode;
}) {
  const steps = [
    { key: "fetching", label: "Fetching the PDF", icon: FileText },
    { key: "extracting", label: "Reading the text layer", icon: ScanLine },
    { key: "transcribing", label: "Transcribing questions", icon: Sparkles },
    { key: "done", label: "Digital paper ready", icon: Check },
  ] as const;
  const activeStepIdx = steps.findIndex((s) => s.key === stage);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-8"
    >
      <div className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-amber-400/10 blur-3xl" />
      <p className="type-caption font-bold uppercase tracking-wider text-amber-300">
        <span className="inline-flex items-center gap-1.5">
          <Wand2 className="size-3.5" /> Digital conversion
        </span>
      </p>
      <h2 className="mt-2 type-h1">{item.title}</h2>
      <p className="mt-1 type-body text-muted-foreground">
        {item.subjectName} · Grade {item.grade}
        {item.examYear !== undefined ? ` · ${item.examYear}` : ""}
        {item.pageCount ? ` · ${item.pageCount} pages` : ""}
      </p>

      {/* Start CTA (before conversion begins) */}
      {stage === "idle" && onStart && (
        <div className="mt-5 rounded-2xl border border-amber-400/25 bg-amber-400/[0.05] p-4">
          <p className="type-body font-bold">
            {mode === "exam" ? "Exam mode" : "Practice mode"} · fully digital
          </p>
          <p className="mt-1 type-caption leading-relaxed text-muted-foreground">
            One first-time step: this page turns the PDF into a real digital paper —
            every question, option and answer — and remembers it for every student
            after you. Takes under a minute on most papers.
          </p>
          <Button onClick={onStart} size="lg" className="interactive-press mt-4 w-full gap-2 sm:w-auto">
            <Wand2 className="size-4" /> Convert & start
          </Button>
        </div>
      )}

      {/* Live steps */}
      <AnimatePresence>
        {stage !== "idle" && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-5 grid gap-2"
          >
            {steps.slice(0, 3).map((s, i) => {
              const Icon = s.icon;
              const isActive = i === activeStepIdx;
              const isDone = activeStepIdx > i || stage === "done";
              return (
                <motion.div
                  key={s.key}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3.5 transition",
                    isActive
                      ? "border-amber-400/40 bg-amber-400/[0.07]"
                      : isDone
                        ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                        : "border-white/10 bg-white/[0.02] opacity-60",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      isActive
                        ? "bg-amber-400/15 text-amber-300"
                        : isDone
                          ? "bg-emerald-400/15 text-emerald-300"
                          : "bg-white/5 text-muted-foreground",
                    )}
                  >
                    {isActive ? <Loader2 className="size-4 animate-spin" /> : isDone ? <Check className="size-4" /> : <Icon className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="type-body font-bold">{s.label}</p>
                    <p className="type-caption text-muted-foreground">
                      {s.key === "extracting" && isActive && pageProgress.pageCount > 0
                        ? `Page ${pageProgress.page} of ${pageProgress.pageCount}`
                        : s.key === "transcribing" && isActive && chunkProgress.chunkCount > 0
                          ? `Section ${chunkProgress.chunk + 1} of ${chunkProgress.chunkCount} · ${chunkProgress.questions} question${chunkProgress.questions === 1 ? "" : "s"} so far`
                          : s.key === "done" && isDone
                            ? "Opening your digital paper…"
                            : "…"}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error line (chunk-level) */}
      {error && (
        <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-rose-400/30 bg-rose-400/[0.07] p-3.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-300" />
          <p className="type-caption leading-relaxed text-rose-200">{error}</p>
        </div>
      )}

      {/* Honesty explainer */}
      <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <p className="inline-flex items-center gap-1.5 type-caption font-bold text-foreground/80">
          <Sparkles className="size-3.5 text-amber-300" /> How this works — honestly
        </p>
        <p className="mt-1.5 type-caption leading-relaxed text-muted-foreground">
          The questions are transcribed from your paper — nothing is invented and nothing is
          added. Where the PDF states an answer key, it's attached; where it doesn't, the
          suggested answer is AI-provided and every screen tells you so. Cross-check with the
          official key when it matters.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="border-white/15 text-muted-foreground">
            <Volume2 className="mr-1 size-3" /> Read-aloud
          </Badge>
          <Badge variant="outline" className="border-white/15 text-muted-foreground">
            <Check className="mr-1 size-3" /> Navigator & flags
          </Badge>
          <Badge variant="outline" className="border-white/15 text-muted-foreground">
            <Sparkles className="mr-1 size-3" /> Instant scoring
          </Badge>
        </div>
      </div>

      <p className="mt-4 text-center type-caption text-muted-foreground/50">
        <Link to="/exam-prep?tab=papers" className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="size-3" /> Back to Exam Prep
        </Link>
      </p>
    </motion.div>
  );
}

// ─── Shared shells ───────────────────────────────────────────────────────

function PipelineShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen bg-background">
      <div className="pointer-events-none fixed -top-32 left-1/2 z-0 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-amber-400/[0.05] blur-3xl" />
      <main className="relative z-10 px-3 py-6 sm:px-5 sm:py-10">{children}</main>
    </div>
  );
}

function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-32 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
      <span className="type-body">{label}</span>
    </div>
  );
}

function NotFoundShell({ message }: { message: string }) {
  return (
    <PipelineShell>
      <div className="mx-auto max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center">
        <FileWarning className="mx-auto size-8 text-muted-foreground/40" />
        <h2 className="mt-3 type-h2">Paper not found</h2>
        <p className="mt-1.5 type-caption text-muted-foreground">{message}</p>
        <Button variant="outline" asChild className="interactive-press mt-5 gap-2">
          <Link to="/exam-prep">
            <ArrowRight className="size-4" /> Go to Exam Prep
          </Link>
        </Button>
      </div>
    </PipelineShell>
  );
}
