// DigitalExamPlayerParts — support components for the digital exam player:
//   • TrustBadge        — honest AI-unverified / admin-verified surface
//   • ReportIssueDialog — student crowdsourced QC ("Report an issue")
//   • OriginalPageDialog — the actual PDF page behind a question (pdf.js)
//   • ShortcutsDialog   — keyboard navigation reference
//
// All copy original. Learnyx dark/gold cinematic system.

import { useMutation } from "convex/react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Command,
  FileImage,
  Loader2,
  MessageSquareWarning,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import { loadPdfDoc, renderPdfPageImage, type PdfjsDocument } from "@/lib/pdfText";
import { cn } from "@/lib/utils";

// ─── Trust badge ──────────────────────────────────────────────────────────

export function TrustBadge({
  verification,
  adminEdited,
  sourceMode,
  compact,
}: {
  verification: string | null;
  adminEdited?: boolean;
  sourceMode?: string | null;
  compact?: boolean;
}) {
  const verified = verification === "verified";
  if (verified) {
    return (
      <Badge className="gap-1 border-emerald-400/40 bg-emerald-400/15 text-emerald-200" title="An admin reviewed every question in this paper.">
        <BadgeCheck className="size-3" /> Verified
      </Badge>
    );
  }
  return (
    <Badge
      className={cn(
        "gap-1 border-amber-400/40 bg-amber-400/15 text-amber-200",
      )}
      title="Transcribed by AI and not yet human-verified. Cross-check anything critical with the official paper, and report anything that looks wrong."
    >
      <ShieldAlert className="size-3" />
      {compact ? "AI · unverified" : "AI-digitized · unverified"}
      {adminEdited && <span className="font-bold text-emerald-300">· corrected</span>}
      {sourceMode === "vision" && !compact && (
        <span className="text-amber-200/70">· page-image OCR</span>
      )}
    </Badge>
  );
}

// ─── Report an issue with this question ───────────────────────────────────

const REPORT_CATEGORIES = [
  { value: "wrong_answer", label: "The suggested answer looks wrong" },
  { value: "garbled_text", label: "The text is garbled or hard to read" },
  { value: "missing_options", label: "Options are missing or wrong" },
  { value: "missing_figure", label: "This question needs a figure/diagram" },
  { value: "not_in_paper", label: "This question isn't in the real paper" },
  { value: "other", label: "Something else" },
] as const;

export interface ReportState {
  questionNumber: number;
  status: string;
}

export function ReportIssueButton({
  contentId,
  questionNumber,
  reported,
  onReported,
}: {
  contentId: string;
  questionNumber: number;
  reported?: ReportState;
  onReported: (r: ReportState) => void;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("wrong_answer");
  const [details, setDetails] = useState("");
  const [sending, setSending] = useState(false);
  const submitReport = useMutation(api.examPrepDigital.submitQuestionReport);

  const submit = useCallback(async () => {
    setSending(true);
    try {
      await submitReport({
        contentId: contentId as never,
        questionNumber,
        category: category as never,
        details,
      });
      onReported({ questionNumber, status: "open" });
      toast.success("Report sent — thank you.", {
        description: "Our team checks every report and corrects the paper.",
      });
      setOpen(false);
      setDetails("");
    } catch (err) {
      toast.error((err as Error).message || "Couldn't send the report. Try again.");
    } finally {
      setSending(false);
    }
  }, [category, contentId, details, onReported, questionNumber, submitReport]);

  if (reported?.status === "open") {
    return (
      <Button
        size="sm"
        variant="ghost"
        disabled
        title="You reported this question — it's in the review queue."
        className="h-8 gap-1.5 rounded-xl px-2 text-[11px] font-bold text-sky-300"
      >
        <MessageSquareWarning className="size-3.5" /> Reported
      </Button>
    );
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        title="Report an issue with this question"
        className="h-8 gap-1.5 rounded-xl px-2 text-[11px] font-bold text-muted-foreground hover:text-sky-300"
      >
        <MessageSquareWarning className="size-3.5" /> Report
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-3xl border-white/10 bg-background">
          <DialogHeader>
            <DialogTitle className="type-h3">Report question {questionNumber}</DialogTitle>
            <DialogDescription className="type-caption">
              Spotted something wrong? Tell us what you see — students are the best
              quality check this paper has.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              {REPORT_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setCategory(c.value)}
                  className={cn(
                    "rounded-2xl border px-3 py-2 text-left text-sm transition",
                    category === c.value
                      ? "border-sky-400/60 bg-sky-400/10 text-sky-200"
                      : "border-white/10 bg-white/[0.03] text-foreground/80 hover:border-white/25",
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What's wrong? (e.g. 'option B should be 42 kg', 'the diagram is missing')"
              rows={3}
              maxLength={1000}
              className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-sky-400/50"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} className="flex-1">
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={sending || details.trim().length < 3}
              className="flex-1 gap-1.5"
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Send report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Original page viewer (the REAL page behind the question) ────────────

export function OriginalPageButton({
  pdfUrl,
  page,
  pageCount,
  figure,
}: {
  pdfUrl: string | null;
  page: number | null;
  pageCount: number | null;
  figure?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pageNum, setPageNum] = useState(page ?? 1);
  const docRef = useRef<PdfjsDocument | null>(null);
  const cacheRef = useRef(new Map<number, string>());
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (page) setPageNum(page);
  }, [page]);

  useEffect(() => {
    if (!open || !pdfUrl) return;
    let alive = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!docRef.current) docRef.current = await loadPdfDoc(pdfUrl);
        const doc = docRef.current;
        const clamped = Math.max(1, Math.min(pageNum, doc.numPages));
        let url = cacheRef.current.get(clamped);
        if (!url) {
          url = await renderPdfPageImage(doc, clamped);
          cacheRef.current.set(clamped, url);
        }
        if (alive) setDataUrl(url);
      } catch (err) {
        if (alive) setError((err as Error).message || "Couldn't render this page.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => {
      alive = false;
    };
  }, [open, pageNum, pdfUrl]);

  if (!pdfUrl || !page) return null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        title="See this question on the original page"
        className={cn(
          "h-8 gap-1.5 rounded-xl px-2 text-[11px] font-bold",
          figure ? "text-rose-300 hover:text-rose-200" : "text-muted-foreground hover:text-amber-300",
        )}
      >
        <FileImage className="size-3.5" />
        {figure ? "Figure · original page" : `Page ${page}`}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl rounded-3xl border-white/10 bg-background">
          <DialogHeader>
            <DialogTitle className="type-h3 flex items-center gap-2">
              <FileImage className="size-4 text-amber-300" /> Original page {pageNum}
              {pageCount ? ` of ${pageCount}` : ""}
            </DialogTitle>
            <DialogDescription className="type-caption">
              The actual page from your paper — use it to verify figures, tables and
              anything the AI transcription might have missed.
            </DialogDescription>
          </DialogHeader>
          <div className="relative max-h-[60vh] overflow-auto rounded-2xl border border-white/10 bg-white/5 p-2">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" /> Rendering the page…
              </div>
            )}
            {error && (
              <p className="py-10 text-center type-caption text-rose-300">{error}</p>
            )}
            {dataUrl && !loading && (
              <motion.img
                key={pageNum}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                src={dataUrl}
                alt={`Original page ${pageNum}`}
                className="mx-auto w-full rounded-xl"
              />
            )}
          </div>
          <DialogFooter className="items-center gap-2 sm:justify-between">
            <Button
              size="sm"
              variant="outline"
              disabled={pageNum <= 1 || loading}
              onClick={() => setPageNum((n) => Math.max(1, n - 1))}
              className="gap-1"
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: Math.min(pageCount ?? 1, 12) }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPageNum(n)}
                  className={cn(
                    "size-7 rounded-lg text-[11px] font-bold transition",
                    n === pageNum
                      ? "bg-amber-400 text-black"
                      : "bg-white/5 text-muted-foreground hover:bg-white/10",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!pageCount || pageNum >= pageCount || loading}
              onClick={() => setPageNum((n) => n + 1)}
              className="gap-1"
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Keyboard shortcuts reference ─────────────────────────────────────────

const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: "1 – 8", label: "Pick option A – H" },
  { keys: "← →", label: "Previous / next question" },
  { keys: "Enter", label: "Check answer (Practice mode)" },
  { keys: "F", label: "Flag / unflag this question" },
  { keys: "N", label: "Open the question navigator" },
  { keys: "R", label: "Read this question aloud" },
  { keys: "+ / −", label: "Bigger / smaller text" },
  { keys: "?", label: "Show this shortcut list" },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  trigger?: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger && <span onClick={() => onOpenChange(true)}>{trigger}</span>}
      <DialogContent className="max-w-sm rounded-3xl border-white/10 bg-background">
        <DialogHeader>
          <DialogTitle className="type-h3 flex items-center gap-2">
            <Command className="size-4 text-amber-300" /> Keyboard shortcuts
          </DialogTitle>
          <DialogDescription className="type-caption">
            The whole paper works without a mouse — built for screen-reader and
            keyboard-only users.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
              <span className="rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-200">
                {s.keys}
              </span>
              <span className="text-right type-caption text-foreground/80">{s.label}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
