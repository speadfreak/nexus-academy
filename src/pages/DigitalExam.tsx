// DigitalExam — /exam-prep/digital/:contentId?mode=practice|exam
//
// THE ZERO-CONVERSION STUDENT SURFACE.
//
// Papers are kept digital by the server-side ALWAYS-READY ENGINE
// (convex/examConversionEngine.ts): a 1-minute dispatch tick converts the
// whole library ahead of demand, every new upload auto-enqueues the moment
// it lands, and scanned papers OCR server-side via Gemini. Conversion no
// longer runs in students' browsers and there is NO student-visible queue.
//
// What a student experiences here:
//   • Ready paper (the norm) → the fully digital player mounts instantly.
//   • Not ready yet (a brand-new upload, mid-second) → one calm line —
//     "Ready in a moment — you'll jump in automatically" — while the
//     server engine digitizes at student priority. The reactive query
//     lands them in the player the second it's done. No stages, no slot
//     lines, no waiting walls, nothing to click.
//
// Honesty rules unchanged: questions are transcribed — never invented;
// answers the paper itself provides are attached, the rest are labelled
// AI-suggested in the player. No trust badges are shown to students; QC
// is silent (admin console + in-player reports).

import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Crown,
  FileWarning,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DigitalExamPlayer, type ExamMode } from "@/components/exam/DigitalExamPlayer";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { DigitalQuestion } from "@/components/exam/DigitalExamPlayer";

export default function DigitalExam() {
  const { contentId } = useParams<{ contentId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const modeParam = searchParams.get("mode") === "exam" ? "exam" : "practice";
  const [mode] = useState<ExamMode>(modeParam);

  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);
  const requestDigitization = useMutation(api.examPrepDigital.requestDigitization);

  // The paper row — reactive: flips to ready the moment the server engine
  // completes, which auto-lands the student in the player.
  const digital = useQuery(
    api.examPrepDigital.getDigitalPaper,
    contentId ? { contentId: contentId as never } : "skip",
  );
  const content = useQuery(
    api.content.getReaderContent,
    contentId ? { contentId: contentId as never } : "skip",
  );

  const [premiumWall, setPremiumWall] = useState(false);
  // Manual retry counter ("Try again" on a failed paper) — the engine
  // re-runs at student priority; scans fall through to the OCR chain.
  const [retryTick, setRetryTick] = useState(0);
  // Resolved PDF url for the session — powers the player's original-page
  // viewer.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // ── Resolve the PDF URL (premium papers go through the server gate) ──
  const resolveUrl = useCallback(async (): Promise<string | null> => {
    if (pdfUrl) return pdfUrl;
    if (!content?.item || !contentId) return null;
    if (content.item.isPremium) {
      try {
        const { url } = await getDownloadUrl({ contentId: contentId as never });
        setPdfUrl(url);
        return url;
      } catch {
        setPremiumWall(true);
        return null;
      }
    }
    setPdfUrl(content.item.fileUrl);
    return content.item.fileUrl;
  }, [content, contentId, getDownloadUrl, pdfUrl]);

  // Ready papers never ran a pipeline — still resolve the URL so the
  // player's original-page viewer works.
  const readyNeedsUrl = digital?.status === "ready" && !premiumWall;
  useEffect(() => {
    if (readyNeedsUrl && !pdfUrl) void resolveUrl();
  }, [readyNeedsUrl, pdfUrl, resolveUrl]);

  // ── STUDENT KICK: a paper that isn't ready yet asks the server engine
  // to digitize it NOW, at student priority. Never renders a pipeline,
  // never polls a queue — the reactive query does all the work.
  const autoKickRef = useRef(false);
  const kick = useCallback(async () => {
    if (!contentId) return;
    try {
      await requestDigitization({ contentId: contentId as never });
    } catch {
      // Premium wall / signed-out — the shells below already handle both.
    }
  }, [contentId, requestDigitization]);

  useEffect(() => {
    if (digital === null && content?.item && !autoKickRef.current && !premiumWall) {
      autoKickRef.current = true;
      void kick();
    }
  }, [digital, content, premiumWall, kick]);

  const retriedRef = useRef(-1);
  useEffect(() => {
    if (retryTick === 0 || retriedRef.current === retryTick) return;
    retriedRef.current = retryTick;
    void kick();
  }, [retryTick, kick]);

  const playerQuestions = useMemo<DigitalQuestion[] | null>(() => {
    if (!digital || digital.status !== "ready" || !digital.questions) return null;
    return digital.questions as DigitalQuestion[];
  }, [digital]);

  // ── Render states ──
  if (!contentId) {
    return <NotFoundShell message="No paper specified." />;
  }
  if (content === undefined || digital === undefined) {
    return <Shell><LoadingBlock label="Loading the paper…" /></Shell>;
  }
  if (content === null || !content.item) {
    return <NotFoundShell message="This paper doesn't exist (or was removed)." />;
  }

  const item = content.item;

  // Premium wall — the same gate the Reader enforces, shown honestly here.
  if (premiumWall) {
    return (
      <Shell>
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
      </Shell>
    );
  }

  // ── Ready → the player itself (the normal path — instant) ──
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
        pdfUrl={pdfUrl}
        pageCount={digital!.pageCount ?? item.pageCount ?? null}
      />
    );
  }

  // ── Failed → never a raw provider error. The engine self-heals and
  //    re-queues failed papers on its own, so this state is a brief
  //    waypoint, not a dead end. Students get one calm line + a nudge
  //    button; the honest diagnostics stay in the admin console only.
  if (digital?.status === "failed") {
    const isScanQueue = (digital.error ?? "").includes("NEEDS_OCR");
    return (
      <Shell>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"
        >
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/5 text-muted-foreground">
            <FileWarning className="size-6" />
          </span>
          <h2 className="mt-4 type-h2">
            {isScanQueue ? "Deep-reading this scan" : "Finishing this paper up"}
          </h2>
          <p className="mt-2 type-body text-muted-foreground">
            {isScanQueue
              ? "It's a scanned paper — the deeper reading pass is queued. It usually clears within minutes, and you'll jump in automatically."
              : "Our conversion engine hit a busy moment and is already re-preparing this paper. It usually takes just a few minutes — you'll jump in automatically the second it's ready."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => setRetryTick((t) => t + 1)}
              className="interactive-press gap-2"
            >
              <RefreshCw className="size-4" /> Try again now
            </Button>
            <Button variant="outline" asChild className="interactive-press gap-2">
              <Link to={`/read/${contentId}`}>
                <BookOpen className="size-4" /> Open the original PDF
              </Link>
            </Button>
            <Button variant="ghost" asChild className="interactive-press gap-2">
              <Link to="/exam-prep?tab=papers">
                <ArrowLeft className="size-4" /> Back to papers
              </Link>
            </Button>
          </div>
        </motion.div>
      </Shell>
    );
  }

  // ── Not ready (never converted or converting server-side right now) →
  //    ONE calm auto-jump line. This screen is a rare guest: the engine
  //    pre-converts the library ahead of demand, so almost every student
  //    lands straight in the player above.
  return (
    <Shell>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="mx-auto max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"
      >
        <Loader2 className="mx-auto size-7 animate-spin text-amber-300" />
        <h2 className="mt-4 type-h2">{item.title}</h2>
        <p className="mt-1 type-caption text-muted-foreground">
          {item.subjectName} · Grade {item.grade}
          {item.examYear !== undefined && item.examYear !== null ? ` · ${item.examYear}` : ""}
        </p>
        <p className="mt-3 type-body font-semibold text-foreground/90">
          Ready in a moment — you'll jump in automatically.
        </p>
        <p className="mt-1 type-caption text-muted-foreground">
          The digital version is being finalized on our servers. No need to do anything.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button variant="outline" asChild className="interactive-press gap-2">
            <Link to={`/read/${contentId}`}>
              <BookOpen className="size-4" /> Original PDF
            </Link>
          </Button>
          <Button variant="ghost" asChild className="interactive-press gap-2">
            <Link to="/exam-prep?tab=papers">
              <ArrowLeft className="size-4" /> Exam Prep
            </Link>
          </Button>
        </div>
      </motion.div>
    </Shell>
  );
}

// ─── Shared shells ───────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
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
    <Shell>
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
    </Shell>
  );
}
