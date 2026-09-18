// DigitalExam — /exam-prep/digital/:contentId?mode=practice|exam
//
// THE DETERMINISTIC STUDENT SURFACE.
//
// Papers are parsed by the server-side DETERMINISTIC ENGINE
// (convex/examConversionEngine.ts): layout-aware text extraction plus a
// pure pattern-matching parser — NO AI, NO rate limits, NO token budgets.
// Text-layer papers parse in seconds; scanned papers are read by
// Tesseract.js in a browser tab (this one, or an admin's) and parsed by
// the same parser. Conversion results are cached forever, so the normal
// path here is INSTANT.
//
// What a student experiences:
//   • Ready paper (the norm) → the fully digital player mounts instantly.
//   • Scanned paper being read → "Reading page X of Y…" with a live OCR
//     runner in this tab, then an automatic jump into the player.
//   • Text paper mid-parse (seconds) → a brief "Preparing…" spinner.
//   • Paper parked by the review pipeline (low confidence / answer-key
//     document) → an honest pointer to the original PDF.
//
// Honesty rules: the parser transcribes structure — it never invents
// questions, options, or answers; answers come only from the paper's own
// answer key. Diagram-heavy questions are flagged with a link to the
// original page. No trust badges are shown to students.

import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Crown,
  FileWarning,
  Loader2,
  ScanLine,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { DigitalExamPlayer, type ExamMode } from "@/components/exam/DigitalExamPlayer";
import { ScanOcrRunner } from "@/components/exam/ScanOcrRunner";
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

  // The paper row — reactive: flips to ready the moment conversion
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
  // Resolved PDF url for the session — powers the player's original-page
  // viewer and the scan-OCR runner.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);

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

  // Papers that need the URL: ready players, and scans mid-OCR.
  const needsUrl =
    (digital?.status === "ready" || (digital?.status === "processing" && digital.sourceMode === "scan")) &&
    !premiumWall;
  useEffect(() => {
    if (needsUrl && !pdfUrl) void resolveUrl();
  }, [needsUrl, pdfUrl, resolveUrl]);

  // ── STUDENT KICK: a paper that isn't ready yet asks the server engine
  // to convert it NOW, at student priority. Never renders a pipeline —
  // the reactive query does all the work.
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

  // Row not created yet (the kick above is on its way) → brief spinner.
  if (!digital) {
    return (
      <Shell>
        <PreparingShell item={item} contentId={contentId} />
      </Shell>
    );
  }

  // ── Ready → the player itself (the normal path — instant) ──
  const playable =
    digital.status === "ready" &&
    digital.reviewStatus !== "needs_review" &&
    digital.reviewStatus !== "pdf_only";
  if (playable && playerQuestions && playerQuestions.length > 0) {
    return (
      <DigitalExamPlayer
        key={`${digital._id}-${mode}`}
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
        pageCount={digital.pageCount ?? item.pageCount ?? null}
      />
    );
  }

  // ── Parked by the review pipeline (low confidence / answer-key doc) ──
  if (
    (digital.status === "ready" || digital.status === "failed") &&
    (digital.reviewStatus === "needs_review" || digital.reviewStatus === "pdf_only")
  ) {
    const isKeyDoc = (digital.error ?? "").includes("ANSWER_KEY_DOCUMENT");
    return (
      <Shell>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-xl rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"
        >
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-white/5 text-muted-foreground">
            <BookOpen className="size-6" />
          </span>
          <h2 className="mt-4 type-h2">
            {isKeyDoc ? "This is the answer-key document" : "Read this one from the original PDF"}
          </h2>
          <p className="mt-2 type-body text-muted-foreground">
            {isKeyDoc
              ? "This PDF holds the answer key — pair it with the questions paper in Exam Prep. The original document opens below."
              : "We haven't verified a digital version of this paper yet, so here's the original — exactly as it was printed."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
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

  // ── Scanned paper mid-OCR → honest live progress + this tab helps ──
  if (digital.status === "processing" && digital.sourceMode === "scan") {
    const done = digital.ocrDone ?? 0;
    const total = digital.ocrTotal ?? digital.pageCount ?? item.pageCount ?? 0;
    return (
      <Shell>
        {pdfUrl && digital.ocrPagesPresent && total > 0 && (
          <ScanOcrRunner
            contentId={contentId}
            pdfUrl={pdfUrl}
            pageCount={total}
            ocrPagesPresent={digital.ocrPagesPresent}
            onError={(m) => setOcrError(m)}
          />
        )}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center"
        >
          <ScanLine className="mx-auto size-7 animate-pulse text-amber-300" />
          <h2 className="mt-4 type-h2">{item.title}</h2>
          <p className="mt-1 type-caption text-muted-foreground">
            {item.subjectName} · Grade {item.grade}
            {item.examYear !== undefined && item.examYear !== null ? ` · ${item.examYear}` : ""}
          </p>
          <p className="mt-3 type-body font-semibold text-foreground/90">
            Reading page {Math.min(done + 1, total)} of {total}…
          </p>
          <p className="mt-1 type-caption text-muted-foreground">
            This one is a scan — it's being read right now, and you'll jump in automatically. Every
            page is saved, so this only ever happens once.
          </p>
          {total > 0 && (
            <div className="mx-auto mt-4 h-1.5 w-56 overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-all"
                style={{ width: `${Math.round((done / total) * 100)}%` }}
              />
            </div>
          )}
          {ocrError && (
            <p className="mt-3 type-caption text-rose-300/80">
              {ocrError} — the reading continues server-side; no need to do anything.
            </p>
          )}
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

  // ── Failed (transient) → calm waypoint, the queue self-heals ──
  if (digital.status === "failed") {
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
          <h2 className="mt-4 type-h2">Finishing this paper up</h2>
          <p className="mt-2 type-body text-muted-foreground">
            Our conversion engine hit a hiccup and is already re-preparing this paper. It usually
            takes just a few minutes — you'll jump in automatically the second it's ready.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => void kick()}
              className="interactive-press gap-2"
            >
              <Loader2 className="size-4" /> Try again now
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

  // ── Not ready (text paper mid-parse — seconds) → brief spinner ──
  return (
    <Shell>
      <PreparingShell item={item} contentId={contentId} />
    </Shell>
  );
}

// ─── Shared shells ───────────────────────────────────────────────────────

function PreparingShell({
  item,
  contentId,
}: {
  item: { title: string; subjectName: string; grade: number; examYear?: number | null };
  contentId: string;
}) {
  return (
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
        Preparing — you'll jump in automatically.
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
  );
}

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
