// In-app reader — /read/:contentId
//
// Cinematic PDF reader with AI companion, YouTube videos, scratchpad.
// PDF worker: react-pdf v10 bundles pdfjs-dist@5.x internally. We MUST import
// pdfjs from react-pdf (not the top-level package) and point the worker at
// a CDN URL — the relative 'pdf.worker.mjs' path react-pdf sets by default
// breaks on Render's static hosting.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { evaluate } from "mathjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Document, Page as PdfPage, pdfjs } from "react-pdf";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  Bot,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  MessageSquare,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Send,
  Sparkles,
  X,
  Youtube,
  ZoomIn,
  ZoomOut,
  BookOpen,
  Crown,
  RotateCcw,
  FileText,
  Maximize2,
  Play,
  Scan,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CONTENT_TYPE_LABELS,
  type ContentType,
} from "@/convex/constants";
import type { ContentItemWithSubject } from "@/convex/content";
import { cn } from "@/lib/utils";
import { ReaderExamMode, type AnswerKeyInfo } from "@/components/reader/ReaderExamMode";

// ─── PDF.js worker setup ───────────────────────────────────────────────
// react-pdf bundles its own pdfjs-dist (currently 5.4.296, pinned in
// node_modules/react-pdf/node_modules/pdfjs-dist). The worker is served
// same-origin (public/pdf.worker.min.mjs) so we avoid CDN/CORS issues.
//
// We deliberately set ONLY the workerSrc here — no other pdf.js options.
// The previous attempt to add cMapUrl + standardFontDataUrl + streaming
// options caused regressions where pdf.js silently failed to render and
// the loading skeleton stayed forever. We're back to the simplest path
// that was working before the perf commits. We can re-add options one
// at a time after we confirm rendering works.
//
// The worker file in public/ is auto-synced to the installed pdfjs-dist
// version by scripts/sync-pdfjs.mjs (runs on every `bun install` via the
// postinstall hook). This prevents the version-mismatch bug that previously
// broke all PDF rendering.
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';


// ─── Helpers ────────────────────────────────────────────────────────────
type PanelTab = "companion" | "videos" | "scratchpad";
type IframeZoomMode = "fit-width" | "fit-page" | "100" | "125" | "150" | "200";

function subjectHue(subjectSlug: string): string {
  const hues: Record<string, string> = {
    physics: "from-sky-400/20 to-sky-400/5 border-sky-400/30 text-sky-300",
    chemistry: "from-emerald-400/20 to-emerald-400/5 border-emerald-400/30 text-emerald-300",
    biology: "from-lime-400/20 to-lime-400/5 border-lime-400/30 text-lime-300",
    mathematics: "from-violet-400/20 to-violet-400/5 border-violet-400/30 text-violet-300",
    english: "from-rose-400/20 to-rose-400/5 border-rose-400/30 text-rose-300",
    history: "from-amber-400/20 to-amber-400/5 border-amber-400/30 text-amber-300",
    geography: "from-teal-400/20 to-teal-400/5 border-teal-400/30 text-teal-300",
    economics: "from-indigo-400/20 to-indigo-400/5 border-indigo-400/30 text-indigo-300",
  };
  return hues[subjectSlug] ?? "from-primary/20 to-primary/5 border-primary/30 text-primary";
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function Reader() {
  const { contentId } = useParams<{ contentId: string }>();
  const navigate = useNavigate();
  const reader = useQuery(api.content.getReaderContent, {
    contentId: contentId as never,
  });
  const related = useQuery(api.content.getRelatedContent, {
    contentId: contentId as never,
  });
  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);
  const [pdfDocProxy, setPdfDocProxy] = useState<any>(null);
  // Pre-render cache: stores rendered page canvases as blob URLs for instant back-nav
  const pageCache = useRef<Map<number, string>>(new Map());
  const toggleBookmark = useMutation(api.bookmarks.toggleBookmark);
  const askReaderQuestion = useAction(api.readerAI.askReaderQuestion);
  const searchYouTubeVideos = useAction(api.media.searchYouTubeVideos);
  const scratchpad = useQuery(api.scratchpads.getScratchpad, {
    contentId: contentId as never,
  });
  const saveScratchpad = useMutation(api.scratchpads.saveScratchpad);

  const item: ContentItemWithSubject | null = reader?.item ?? null;

  // --- PDF viewing state -------------------------------------------------
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [useUrlFallback, setUseUrlFallback] = useState(false);
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1.0);
  // Deferred text-layer: render canvas first for instant visual, then text after delay
  const [showTextLayers, setShowTextLayers] = useState(false);
  const textLayerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [iframeZoom, setIframeZoom] = useState<IframeZoomMode>("fit-width");
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [pageAnimating, setPageAnimating] = useState(false);
  // Track whether we've already attempted the ArrayBuffer fallback
  // to prevent infinite loops between URL → ArrayBuffer → iframe.
  const arrayBufferAttempted = useRef(false);
  const readerItemId = reader?.item?._id;

  // ── Render timeout safety net ─────────────────────────────────────────
  // If pdf.js hasn't fired onLoadSuccess within 8 seconds of mounting,
  // automatically fall back to the iframe viewer. The iframe uses the
  // browser's native PDF viewer (no JS worker, no cmaps) and always
  // works — it's our last-resort fallback that should never leave the
  // user staring at a "Rendering page…" skeleton forever.
  //
  // The timeout resets every time the document URL changes. If
  // onLoadSuccess fires first, the cleanup function clears the timer.
  const renderTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // Only start the timer when we have a URL/data to render AND we're
    // not already in iframe mode AND we're not in the loading-pdf
    // (premium URL fetch) phase.
    if (!pdfUrl && !pdfData) return;
    if (useIframeFallback) return;
    if (loadingPdf) return;
    if (pdfError) return;

    // Clear any existing timer (e.g. from a previous document).
    if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);

    renderTimeoutRef.current = setTimeout(() => {
      console.warn(
        "[Reader] PDF.js render timed out after 8s — falling back to iframe.",
      );
      setUseIframeFallback(true);
    }, 8000);

    return () => {
      if (renderTimeoutRef.current) clearTimeout(renderTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, pdfData, useIframeFallback, loadingPdf, pdfError, numPages]);

  // ── PDF loading: URL-first for range requests, ArrayBuffer fallback ──────
  // PERFORMANCE CRITICAL: We pass the URL to react-pdf FIRST so that
  // PDF.js can use HTTP range requests (206 Partial Content) to fetch
  // only the pages it needs. This means a 50 MB PDF shows page 1 in
  // ~500ms instead of downloading all 50 MB first.
  //
  // Fallback chain: URL mode (range requests) → ArrayBuffer (full download
  // with progress bar) → iframe (native browser PDF viewer).
  //
  // The previous code fetched the entire PDF as an ArrayBuffer BEFORE
  // passing it to react-pdf, which defeated range requests entirely.

  /** ArrayBuffer fallback: downloads the full PDF with progress tracking. */
  const loadAsArrayBuffer = useCallback(async (url: string) => {
    setLoadingPdf(true);
    setLoadProgress(0);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const contentLength = res.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No readable stream');
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
          const pct = Math.min(99, Math.round((received / total) * 100));
          setLoadProgress(pct);
        }
      }
      // Combine chunks into a single ArrayBuffer
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let off = 0;
      for (const chunk of chunks) {
        combined.set(chunk, off);
        off += chunk.length;
      }
      // Validate PDF magic bytes
      if (combined[0] === 0x25 && combined[1] === 0x50 && combined[2] === 0x44 && combined[3] === 0x46) {
        setPdfData(combined.buffer as ArrayBuffer);
        setUseUrlFallback(false);
      } else {
        console.warn('[Reader] ArrayBuffer data is not a valid PDF, falling back to iframe');
        setUseIframeFallback(true);
      }
    } catch (err) {
      console.warn('[Reader] ArrayBuffer download failed, falling back to iframe:', err);
      setUseIframeFallback(true);
    } finally {
      setLoadProgress(100);
      setLoadingPdf(false);
    }
  }, []);

  // Deferred text-layer effect: hide text layers during page transition for faster
  // canvas-only first paint, then reveal after 120ms.
  useEffect(() => {
    setShowTextLayers(false);
    clearTimeout(textLayerTimer.current);
    textLayerTimer.current = setTimeout(() => setShowTextLayers(true), 120);
    return () => clearTimeout(textLayerTimer.current);
  }, [pageNumber, scale]);

  // Clean up page cache on document change
  useEffect(() => {
    pageCache.current.forEach((url) => URL.revokeObjectURL(url));
    pageCache.current.clear();
    setPdfDocProxy(null);
  }, [readerItemId]);

  useEffect(() => {
    if (!readerItemId || !item) {
      setPdfUrl(null);
      setPdfData(null);
      return;
    }
    let cancelled = false;
    setPdfError(null);
    setPdfUrl(null);
    setPdfData(null);
    setUseUrlFallback(false);
    setUseIframeFallback(false);
    setNumPages(null);
    setPageNumber(1);
    setPageInput('1');
    setLoadProgress(0);
    arrayBufferAttempted.current = false;

    if (item.isPremium) {
      // Premium content: server-side subscription check required
      setLoadingPdf(true);
      const load = async () => {
        try {
          const { url } = await getDownloadUrl({ contentId: readerItemId });
          if (cancelled) return;
          setPdfUrl(url);
          setUseUrlFallback(true);
        } catch (error) {
          if (!cancelled) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error('[Reader] PDF load failed:', msg);
            if (msg.includes('Premium') || msg.includes('premium') || msg.includes('trial')) {
              setPdfError('premium_required');
            } else {
              setPdfError(msg);
            }
          }
        } finally {
          if (!cancelled) setLoadingPdf(false);
        }
      };
      void load();
    } else {
      // Non-premium: use fileUrl directly — NO Convex action round-trip.
      // Saves 200-500ms on every document open.
      setPdfUrl(item.fileUrl);
      setUseUrlFallback(true);
      setLoadingPdf(false);
    }
    return () => { cancelled = true; };
  }, [readerItemId, item, getDownloadUrl]);

  // --- Panel -------------------------------------------------------------
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("companion");

  // --- Exam Mode (Feature 1) --------------------------------------------
  // Only relevant when item.contentType === "past_exam". When active, hides
  // the sidebar/nav and shows a fullscreen focused timed view over the
  // same PDF. See src/components/reader/ReaderExamMode.tsx for the overlay.
  const [examMode, setExamMode] = useState(false);
  const answerKey: AnswerKeyInfo | null = reader?.answerKey ?? null;

  // --- AI companion ------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Highlight-to-ask: when the student selects text in the PDF, we show
  // a floating "Ask about this" button. Clicking it sends the highlighted
  // text as context to the AI companion.
  const [highlightedText, setHighlightedText] = useState<string | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  // Listen for text selection on the entire document — the PDF text layer
  // enables native browser selection. When the user selects text, we
  // capture it and show the floating button.
  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setHighlightedText(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 5 || text.length > 2000) {
        setHighlightedText(null);
        return;
      }
      // Check if the selection is inside the PDF viewer area
      const range = sel.getRangeAt(0);
      const container = document.querySelector("[data-page='read']") ?? document.querySelector(".react-pdf__Page");
      if (container && container.contains(range.commonAncestorContainer)) {
        setHighlightedText(text);
      } else {
        // Also check if it's in the PDF Document container
        const pdfContainer = document.querySelector(".react-pdf__Document");
        if (pdfContainer && pdfContainer.contains(range.commonAncestorContainer)) {
          setHighlightedText(text);
        } else {
          setHighlightedText(null);
        }
      }
    };
    document.addEventListener("selectionchange", handleSelection);
    return () => document.removeEventListener("selectionchange", handleSelection);
  }, []);

  const handleAsk = async () => {
    if (!contentId || !question.trim() || asking) return;
    const text = question.trim();
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setQuestion("");
    setAsking(true);
    try {
      const result = await askReaderQuestion({ contentId: contentId as never, question: text });
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "The reading companion could not answer right now.";
      setMessages((prev) => [...prev, { role: "assistant", content: message }]);
    } finally {
      setAsking(false);
    }
  };

  // --- YouTube -----------------------------------------------------------
  type VideoItem = { id: string; title: string; channel: string; thumbnail: string; isPriority?: boolean };
  const [videos, setVideos] = useState<VideoItem[] | null>(null);
  const [youtubeConfigured, setYoutubeConfigured] = useState<boolean | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [searchingVideos, setSearchingVideos] = useState(false);

  const fetchVideos = useCallback(() => {
    if (!item || searchingVideos) return;
    const query = [item.subjectName, item.grade ? `grade ${item.grade}` : ""]
      .filter(Boolean)
      .join(" ");
    if (!query) return;
    let cancelled = false;
    setSearchingVideos(true);
    setQuotaExhausted(false);
    void searchYouTubeVideos({ contentId: item._id as never, query })
      .then((result) => {
        if (cancelled) return;
        setYoutubeConfigured(result.configured);
        setVideos(result.videos as VideoItem[]);
        if (result.quotaExhausted) setQuotaExhausted(true);
      })
      .catch(() => {
        if (!cancelled) setYoutubeConfigured(false);
      })
      .finally(() => {
        if (!cancelled) setSearchingVideos(false);
      });
    return () => { cancelled = true; };
  }, [item, searchingVideos, searchYouTubeVideos]);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  // --- Scratchpad --------------------------------------------------------
  const [scratchText, setScratchText] = useState("");
  const [scratchSaved, setScratchSaved] = useState(true);
  const [savingScratch, setSavingScratch] = useState(false);
  const [scratchInput, setScratchInput] = useState("");
  const [scratchResult, setScratchResult] = useState<string | null>(null);

  useEffect(() => {
    if (scratchpad) {
      setScratchText(scratchpad.content);
      setScratchSaved(true);
    }
  }, [scratchpad]);

  const handleSaveScratch = async () => {
    if (!contentId || savingScratch) return;
    setSavingScratch(true);
    try {
      await saveScratchpad({ contentId: contentId as never, content: scratchText });
      toast.success("Scratchpad saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the scratchpad.");
    } finally {
      setSavingScratch(false);
      setScratchSaved(true);
    }
  };

  const goToPage = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || !numPages) {
      setPageInput(String(pageNumber));
      return;
    }
    const next = Math.min(numPages, Math.max(1, parsed));
    setPageNumber(next);
    setPageInput(String(next));
  };

  const handlePageChange = useCallback((direction: "prev" | "next") => {
    setPageAnimating(true);
    setTimeout(() => setPageAnimating(false), 200);
    if (direction === "prev") {
      setPageNumber((p) => Math.max(1, p - 1));
    } else {
      setPageNumber((p) => (numPages ? Math.min(numPages, p + 1) : p + 1));
    }
  }, [numPages]);

  const handleEvaluate = () => {
    try {
      const result = evaluate(scratchInput);
      const display =
        typeof result === "number"
          ? result.toLocaleString(undefined, { maximumFractionDigits: 10 })
          : String(result);
      setScratchResult(display);
      setScratchText((prev) =>
        `${prev.trim() ? prev.trim() + "\n" : ""}${scratchInput}  =  ${display}`,
      );
      setScratchSaved(false);
    } catch {
      setScratchResult("⚠ invalid expression");
    }
  };

  const relatedItems = useMemo(() => related ?? [], [related]);

  // ─── Loading state ────────────────────────────────────────────────────
  if (reader === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080c14]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-4 animate-spin rounded-full border-2 border-transparent border-t-primary/60" style={{ animationDuration: '2s' }} />
            <div className="absolute -inset-8 animate-spin rounded-full border border-transparent border-t-primary/20" style={{ animationDuration: '3s', animationDirection: 'reverse' }} />
            <BookOpen className="size-8 text-primary" />
          </div>
          <p className="type-mono text-sm tracking-widest text-muted-foreground uppercase">Loading reader…</p>
        </div>
      </div>
    );
  }

  // ─── Not found ────────────────────────────────────────────────────────
  if (!item) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#080c14] px-6 text-center">
        <div className="relative">
          <div className="absolute -inset-6 rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 blur-xl" />
          <div className="relative flex size-20 items-center justify-center rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
            <Lock className="size-8 text-rose-400" />
          </div>
        </div>
        <div>
          <h1 className="type-h1 bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
            Document not available
          </h1>
          <p className="type-body mt-2 text-muted-foreground">
            It may have been removed, or you need to sign in to read it.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl border-white/10 bg-white/5">
          <Link to="/dashboard">
            <ArrowLeft className="size-4" /> Back to the library
          </Link>
        </Button>
      </div>
    );
  }

  // ─── Main reader ──────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col bg-[#080c14] overflow-hidden">
      {/* ═══ TOP CHROME BAR ═══ */}
      <header className="relative flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-black/40 px-3 backdrop-blur-2xl sm:px-5 z-30">
        {/* Subtle top glow line */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

        <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200">
          <Link to="/dashboard" aria-label="Back to the library">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>

        <div className="min-w-0 flex-1">
          <p className="type-h3 truncate text-foreground">{item.title}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="type-caption text-muted-foreground">{item.subjectName}</span>
            <span className="size-1 rounded-full bg-white/20" />
            <span className="type-caption text-muted-foreground">Grade {item.grade}</span>
            {item.examYear && (<>
              <span className="size-1 rounded-full bg-white/20" />
              <span className="type-caption text-muted-foreground">{item.examYear}</span>
            </>)}
            <span className="size-1 rounded-full bg-white/20" />
            <span className={cn("type-mono rounded-md border bg-gradient-to-b px-1.5 py-0.5 uppercase text-[10px]", subjectHue(item.subjectSlug ?? ""))}>
              {CONTENT_TYPE_LABELS[item.contentType as ContentType]}
            </span>
            {item.sourceName && (
              <>
                <span className="size-1 rounded-full bg-white/20" />
                {item.sourceUrl ? (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-[240px] truncate type-caption font-semibold text-emerald-200 hover:text-emerald-100"
                  >
                    Source: {item.sourceName}
                  </a>
                ) : (
                  <span className="max-w-[240px] truncate type-caption font-semibold text-emerald-200">
                    Source: {item.sourceName}
                  </span>
                )}
              </>
            )}
            {item.fileSizeBytes && (<>
              <span className="size-1 rounded-full bg-white/20" />
              <span className="type-caption text-muted-foreground/60">{formatBytes(item.fileSizeBytes)}</span>
            </>)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
            onClick={() => void toggleBookmark({ contentId: item._id })}
            aria-label={reader?.bookmarked ? "Remove bookmark" : "Bookmark this document"}
          >
            {reader?.bookmarked ? (
              <BookmarkCheck className="size-4 text-primary" />
            ) : (
              <Bookmark className="size-4" />
            )}
          </Button>
          {pdfUrl && (
            <Button asChild variant="ghost" size="icon" className="size-9 rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" aria-label="Download PDF">
                <Download className="size-4" />
              </a>
            </Button>
          )}
          {item.subjectId && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200"
              onClick={() => navigate(`/flashcards?subject=${item.subjectId}&content=${item._id}`)}
              aria-label="Make flashcards"
            >
              <FileText className="size-4" />
            </Button>
          )}
          {item.contentType === "past_exam" && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setExamMode(true)}
              aria-label="Enter exam mode"
              title="Exam mode — timed, no pausing"
              className="size-9 rounded-xl text-amber-300 hover:bg-amber-400/10 hover:text-amber-200 transition-all duration-200"
            >
              <Maximize2 className="size-4" />
            </Button>
          )}
          <div className="mx-1 h-5 w-px bg-white/10" />
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-9 rounded-xl transition-all duration-200",
              panelOpen
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
          >
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ═══ PDF VIEWER ═══ */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Ambient background */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(56,189,248,0.03),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_100%,rgba(168,85,247,0.02),transparent_50%)]" />
          {/* Subtle dot grid */}
          <div className="pointer-events-none absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, white 0.5px, transparent 0.5px)', backgroundSize: '24px 24px' }} />

          {/* ─── Page toolbar (react-pdf mode only) ─── */}
          {!useIframeFallback && (
          <div className="relative flex h-12 shrink-0 items-center justify-center gap-1 border-b border-white/[0.04] bg-black/30 backdrop-blur-xl px-3 z-10">
            {/* Zoom presets */}
            <div className="hidden sm:flex items-center gap-1 mr-2">
              {([0.8, 1, 1.4, 2] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setScale(preset)}
                  className={cn(
                    "h-7 rounded-lg px-2 text-[11px] font-medium transition-all duration-150 active:scale-95",
                    Math.abs(scale - preset) < 0.01
                      ? "bg-primary/15 text-primary border border-primary/25"
                      : "text-muted-foreground/70 hover:bg-white/[0.06] hover:text-foreground border border-transparent"
                  )}
                >
                  {Math.round(preset * 100)}%
                </button>
              ))}
            </div>
            <div className="mx-2 h-5 w-px bg-white/[0.08]" />
            <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-1.5 py-1">
              <button
                type="button"
                onClick={() => setScale((s) => Math.max(0.5, Math.round((s - 0.15) * 100) / 100))}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-white/10 hover:text-foreground active:scale-90"
                aria-label="Zoom out"
              >
                <ZoomOut className="size-3.5" />
              </button>
              <span className="w-11 text-center type-mono text-xs tabular-nums text-muted-foreground/80">
                {Math.round(scale * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setScale((s) => Math.min(3, Math.round((s + 0.15) * 100) / 100))}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-white/10 hover:text-foreground active:scale-90"
                aria-label="Zoom in"
              >
                <ZoomIn className="size-3.5" />
              </button>
            </div>

            <div className="mx-3 h-5 w-px bg-white/[0.08]" />

            <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-1.5 py-1">
              <button
                type="button"
                onClick={() => handlePageChange("prev")}
                disabled={pageNumber <= 1}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-white/10 hover:text-foreground disabled:cursor-default disabled:opacity-20 active:scale-90"
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </button>
              <label htmlFor="reader-page-number" className="sr-only">Page number</label>
              <Input
                id="reader-page-number"
                type="number"
                min={1}
                max={numPages ?? undefined}
                value={pageInput}
                onChange={(event) => setPageInput(event.target.value)}
                onBlur={() => goToPage(pageInput)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    goToPage(pageInput);
                    event.currentTarget.blur();
                  }
                }}
                disabled={!numPages}
                className="h-8 w-11 rounded-lg border-white/[0.08] bg-transparent px-1 text-center type-mono text-xs tabular-nums text-foreground/90 focus:border-primary/40 focus:ring-0"
              />
              <span className="type-mono text-xs tabular-nums text-muted-foreground/60">/ {numPages ?? "—"}</span>
              <button
                type="button"
                onClick={() => handlePageChange("next")}
                disabled={numPages !== null && pageNumber >= numPages}
                className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all duration-150 hover:bg-white/10 hover:text-foreground disabled:cursor-default disabled:opacity-20 active:scale-90"
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {numPages && numPages > 1 && (
              <>
                <div className="mx-3 h-5 w-px bg-white/[0.08]" />
                {/* Mini page progress bar */}
                <div className="hidden sm:flex items-center gap-2">
                  <div className="h-1 w-24 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-300 ease-out"
                      style={{ width: `${(pageNumber / numPages) * 100}%` }}
                    />
                  </div>
                  <span className="type-mono text-[10px] tabular-nums text-muted-foreground/50">
                    {Math.round((pageNumber / numPages) * 100)}%
                  </span>
                </div>
              </>
            )}
          </div>
          )}

          {/* ─── PDF body ─── */}
          <div className="relative flex-1 overflow-hidden" id="pdf-scroll-area">
            {/* ══ IFRAME MODE — full-width, outside max-w-fit ══ */}
            {useIframeFallback && pdfUrl && !pdfError ? (
              <div className="flex h-full flex-col">
                {/* Iframe zoom toolbar */}
                <div className="relative flex shrink-0 items-center justify-center gap-1.5 border-b border-white/[0.04] bg-black/30 backdrop-blur-xl px-3 py-2 z-10">
                  <span className="type-caption text-[10px] tracking-widest text-muted-foreground/50 uppercase mr-2">Native viewer</span>
                  {(
                    [
                      { id: "fit-width" as const, label: "Fit Width", icon: Scan },
                      { id: "fit-page" as const, label: "Fit Page", icon: Maximize2 },
                      { id: "100" as const, label: "100%", icon: null },
                      { id: "125" as const, label: "125%", icon: null },
                      { id: "150" as const, label: "150%", icon: null },
                      { id: "200" as const, label: "200%", icon: null },
                    ] as const
                  ).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setIframeZoom(preset.id)}
                      className={cn(
                        "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-medium transition-all duration-150 active:scale-95",
                        iframeZoom === preset.id
                          ? "bg-primary/15 text-primary border border-primary/25"
                          : "text-muted-foreground/70 hover:bg-white/[0.06] hover:text-foreground border border-transparent"
                      )}
                    >
                      {preset.icon && <preset.icon className="size-3" />}
                      {preset.label}
                    </button>
                  ))}
                </div>
                {/* Iframe — takes FULL available height and width */}
                <iframe
                  key={`${pdfUrl}#${iframeZoom}`}
                  src={`${pdfUrl}#${iframeZoom === "fit-width" ? "view=FitW&toolbar=1&navpanes=0" : iframeZoom === "fit-page" ? "view=FitH&toolbar=1&navpanes=0" : `zoom=${iframeZoom}&toolbar=1&navpanes=0`}`}
                  title={item?.title || "PDF document"}
                  className="flex-1 w-full border-0 bg-white/5"
                  style={{ minHeight: 0 }}
                />
              </div>
            ) : (
            /* ══ REACT-PDF MODE — inside max-w-fit for centered pages ══ */
            <div className="relative mx-auto flex h-full min-h-full max-w-fit flex-col items-center gap-4 p-4 sm:p-8 overflow-y-auto" data-lenis-prevent-wheel>
              {/* Loading state */}
              {loadingPdf && !pdfUrl && (
                <div className="flex h-full w-full flex-col items-center justify-center gap-6">
                  <div className="relative">
                    {/* Cinematic loading orb */}
                    <div className="absolute -inset-8 rounded-full bg-primary/5 blur-2xl animate-pulse" />
                    <div className="absolute -inset-4 rounded-full border border-primary/10 animate-spin" style={{ animationDuration: '4s' }} />
                    <div className="relative flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl">
                      <Loader2 className="size-6 animate-spin text-primary" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="type-mono text-sm tracking-widest text-muted-foreground/80 uppercase">
                      Opening document
                    </p>
                    <div className="mt-3 mx-auto h-0.5 w-32 overflow-hidden rounded-full bg-white/[0.06]">
                      <div className="h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-primary to-transparent animate-[shimmer-slide_1.5s_ease-in-out_infinite]" />
                    </div>
                  </div>
                </div>
              )}

              {/* ArrayBuffer download progress bar (shown during fallback download) */}
              {loadingPdf && pdfUrl && loadProgress > 0 && (
                <div className="flex h-full w-full flex-col items-center justify-center gap-6">
                  <div className="relative">
                    <div className="absolute -inset-8 rounded-full bg-primary/5 blur-2xl animate-pulse" />
                    <div className="relative flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl">
                      <Loader2 className="size-6 animate-spin text-primary" />
                    </div>
                  </div>
                  <div className="w-64 text-center">
                    <p className="type-mono text-sm tracking-widest text-muted-foreground/80 uppercase">
                      Downloading… {loadProgress}%
                    </p>
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-300 ease-out"
                        style={{ width: `${loadProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 type-mono text-[10px] text-muted-foreground/40">
                      {loadProgress < 100 ? 'Loading via direct download (range requests unavailable)' : 'Preparing renderer…'}
                    </p>
                  </div>
                </div>
              )}

              {/* Error state — cinematic + real error + fallback */ }
              {pdfError && (
                <div className="mx-auto mt-20 flex flex-col items-center gap-6">
                  <div className="relative">
                    <div className="absolute -inset-8 rounded-full bg-rose-500/10 blur-2xl" />
                    <div className="relative flex size-20 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-400/[0.03] backdrop-blur-xl">
                      {pdfError === "premium_required" ? (
                        <Crown className="size-8 text-amber-400/80" />
                      ) : (
                        <Lock className="size-8 text-rose-400/80" />
                      )}
                    </div>
                  </div>
                  <div className="text-center max-w-md">
                    <h2 className={cn(
                      "type-h2 bg-clip-text text-transparent",
                      pdfError === "premium_required"
                        ? "from-amber-300 to-amber-400/70"
                        : "from-rose-300 to-rose-400/70"
                    )}>
                      {pdfError === "premium_required"
                        ? "Premium Content"
                        : "Could not open this document"}
                    </h2>
                    <p className="type-body mt-2 text-muted-foreground/70 leading-relaxed">
                      {pdfError === "premium_required"
                        ? "This content requires a premium subscription. Upgrade to access all textbooks, past papers, and study materials."
                        : pdfError}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {pdfError === "premium_required" ? (
                      <Button asChild size="sm" className="rounded-xl bg-premium text-background hover:bg-premium/90">
                        <Link to="/upgrade">
                          <Crown className="size-3.5" /> Upgrade to Premium
                        </Link>
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10"
                          onClick={() => window.location.reload()}
                        >
                          <RotateCcw className="size-3.5" /> Refresh
                        </Button>
                        {pdfUrl && (
                          <Button asChild size="sm" className="rounded-xl">
                            <a href={pdfUrl} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="size-3.5" /> Open in new tab
                            </a>
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* PDF document — URL mode (range requests) primary, ArrayBuffer fallback */}
              {/* Hide Document during ArrayBuffer download so progress bar shows */}
              {!loadingPdf && (pdfData || (pdfUrl && useUrlFallback)) && !pdfError && (
                <div className={cn("transition-all duration-200", pageAnimating && "opacity-0 scale-[0.99]")}>
                  <Document
                    file={pdfData ? { data: pdfData } : { url: pdfUrl! }}
                    // PDF.js options — keep this minimal. The previous
                    // perf-tuning (cMapUrl, standardFontDataUrl, disableAutoFetch)
                    // caused regressions where pdf.js silently failed to
                    // render and the loading skeleton stayed forever.
                    //
                    // We deliberately OMIT options entirely now — pdf.js
                    // runs on its pure defaults. This is the path that was
                    // working before the perf commits. We can re-add options
                    // one at a time after we confirm rendering works.
                    onLoadProgress={(progress) => {
                      try {
                        if (progress && typeof progress.loaded === "number" && typeof progress.total === "number" && progress.total > 0) {
                          const pct = Math.min(99, Math.round((progress.loaded / progress.total) * 100));
                          setLoadProgress(pct);
                        }
                      } catch {
                        // Non-fatal: progress callback errors must never break the render.
                      }
                    }}
                    onLoadSuccess={(pdf) => {
                      setNumPages(pdf.numPages);
                      setPageNumber(1);
                      setPageInput("1");
                      setPdfDocProxy(pdf);
                      setLoadProgress(100);
                    }}
                    onLoadError={(error) => {
                      console.error("[Reader] PDF load failed:", error);
                      const msg = error?.message || String(error);
                      if (msg.includes("worker") || msg.includes("Worker")) {
                        // Worker failed — try iframe fallback instead of
                        // showing an error, since iframe always works.
                        console.warn("[Reader] Worker issue — falling back to iframe.");
                        setUseIframeFallback(true);
                      } else if (useUrlFallback && !pdfData && !arrayBufferAttempted.current) {
                        console.warn("[Reader] URL mode failed, trying ArrayBuffer fallback");
                        arrayBufferAttempted.current = true;
                        void loadAsArrayBuffer(pdfUrl!);
                      } else if (pdfData) {
                        console.warn("[Reader] ArrayBuffer render failed, falling back to iframe");
                        setUseIframeFallback(true);
                      } else {
                        // Last resort: try the iframe. It uses the browser's
                        // native PDF viewer and always works (just slower).
                        console.warn("[Reader] All pdf.js paths failed — falling back to iframe.");
                        setUseIframeFallback(true);
                      }
                    }}
                    loading={
                      // Real page-shaped skeleton (not a generic spinner).
                      // Matches the eventual page render's size + position so
                      // the layout doesn't shift when the page appears.
                      // Uses a fixed width (not w-full) so it can't grow huge
                      // and visually push the eventual page render off-screen.
                      <div className="flex flex-col items-center justify-center gap-4 py-16">
                        <div className="relative aspect-[1/1.414] w-64 max-w-full overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.02] shadow-[0_25px_80px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.04)]">
                          {/* Animated skeleton lines mimicking page content */}
                          <div className="absolute inset-0 flex flex-col gap-3 p-6">
                            <div className="h-3 w-1/2 animate-pulse rounded bg-white/[0.06]" />
                            <div className="mt-2 h-2 w-full animate-pulse rounded bg-white/[0.04]" style={{ animationDelay: "60ms" }} />
                            <div className="h-2 w-5/6 animate-pulse rounded bg-white/[0.04]" style={{ animationDelay: "120ms" }} />
                            <div className="h-2 w-full animate-pulse rounded bg-white/[0.04]" style={{ animationDelay: "180ms" }} />
                            <div className="h-2 w-3/4 animate-pulse rounded bg-white/[0.04]" style={{ animationDelay: "240ms" }} />
                            <div className="mt-2 h-2 w-full animate-pulse rounded bg-white/[0.04]" style={{ animationDelay: "300ms" }} />
                            <div className="h-2 w-4/5 animate-pulse rounded bg-white/[0.04]" style={{ animationDelay: "360ms" }} />
                          </div>
                          {/* Top shimmer sweep */}
                          <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer-slide_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
                        </div>
                        <p className="type-mono text-xs tracking-widest text-muted-foreground/60 uppercase">
                          {loadProgress > 0 && loadProgress < 100
                            ? `Loading… ${loadProgress}%`
                            : "Rendering page…"}
                        </p>
                      </div>
                    }
                    className="flex flex-col items-center gap-4"
                  >
                    <div className="group relative overflow-hidden rounded-lg shadow-[0_25px_80px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-300 hover:shadow-[0_30px_100px_-20px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.1)]">
                      <PdfPage
                        pageNumber={pageNumber}
                        scale={scale}
                        renderTextLayer={showTextLayers}
                        renderAnnotationLayer={showTextLayers}
                        loading={
                          // Page-shaped skeleton — matches the eventual page
                          // size so layout doesn't shift on first render.
                          <div className="relative aspect-[1/1.414] w-48 overflow-hidden rounded-md border border-white/[0.04] bg-white/[0.02]">
                            <div className="absolute inset-0 flex flex-col gap-2 p-4">
                              <div className="h-2 w-1/2 animate-pulse rounded bg-white/[0.06]" />
                              <div className="mt-1 h-1.5 w-full animate-pulse rounded bg-white/[0.04]" />
                              <div className="h-1.5 w-5/6 animate-pulse rounded bg-white/[0.04]" />
                              <div className="h-1.5 w-full animate-pulse rounded bg-white/[0.04]" />
                              <div className="h-1.5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
                              <div className="mt-1 h-1.5 w-full animate-pulse rounded bg-white/[0.04]" />
                              <div className="h-1.5 w-4/5 animate-pulse rounded bg-white/[0.04]" />
                            </div>
                            <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer-slide_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
                          </div>
                        }
                      />
                      {/* Pre-render next page in hidden container for instant forward navigation */}
                      {numPages && pageNumber < numPages && (
                        <div className="invisible absolute h-0 w-0 overflow-hidden pointer-events-none" aria-hidden="true">
                          <PdfPage
                            pageNumber={pageNumber + 1}
                            scale={scale}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                          />
                        </div>
                      )}
                    </div>
                  </Document>
                </div>
              )}

            </div>
            )}
          </div>
        </main>

        {/* Highlight-to-ask floating button — appears when the student
            selects text in the PDF. Clicking it opens the companion
            panel, prefills the question with "Explain: [highlighted
            text]", and sends it with the highlightedText context. */}
        {highlightedText && !examMode && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            type="button"
            onClick={() => {
              if (!panelOpen) setPanelOpen(true);
              if (panelTab !== "companion") setPanelTab("companion");
              const shortHighlight = highlightedText.length > 100
                ? highlightedText.slice(0, 100) + "…"
                : highlightedText;
              setQuestion(`Explain this passage:\n"${shortHighlight}"`);
              setHighlightedText(null);
              window.getSelection()?.removeAllRanges();
            }}
            className="fixed bottom-24 right-8 z-[60] flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-4 py-2.5 text-sm font-medium text-primary shadow-lg backdrop-blur-md transition-all hover:bg-primary/25 interactive-press"
            title="Ask the AI companion about the selected text"
          >
            <Sparkles className="size-4" />
            Ask about this
          </motion.button>
        )}

        {/* ═══ SIDE PANEL ═══ */}
        {panelOpen && (
          <>
            {/* Mobile backdrop */}
            <button
              type="button"
              aria-label="Close reader panel"
              className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm sm:hidden"
              onClick={() => setPanelOpen(false)}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="reader-panel-title"
              className="relative z-20 flex w-full flex-col border-l border-white/[0.06] bg-[#0a0e17]/95 backdrop-blur-2xl shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.5)] sm:static sm:z-auto sm:w-[380px] sm:shadow-none"
            >
              {/* Panel glow line */}
              <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-primary/20 to-transparent sm:hidden" />

              {/* Tab bar */}
              <div className="relative flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 py-2">
                <span id="reader-panel-title" className="sr-only">Reader tools</span>
                {(
                  [
                    { id: "companion" as const, label: "AI", icon: Bot, desc: "Companion" },
                    { id: "videos" as const, label: "Videos", icon: Youtube, desc: "Videos" },
                    { id: "scratchpad" as const, label: "Calc", icon: Calculator, desc: "Scratchpad" },
                  ]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setPanelTab(tab.id)}
                    role="tab"
                    aria-selected={panelTab === tab.id}
                    aria-controls={`reader-panel-${tab.id}`}
                    title={tab.desc}
                    className={cn(
                      "interactive-press relative flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 type-caption font-semibold transition-all duration-200",
                      panelTab === tab.id
                        ? "text-primary"
                        : "text-muted-foreground/60 hover:text-muted-foreground hover:bg-white/[0.03]",
                    )}
                  >
                    {panelTab === tab.id && (
                      <div className="absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full bg-primary/60" />
                    )}
                    <tab.icon className="size-3.5" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground/60 hover:bg-white/5 hover:text-foreground sm:hidden transition-all"
                  onClick={() => setPanelOpen(false)}
                  aria-label="Close reader tools"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Tab content */}
              <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" data-lenis-prevent-wheel>
                {/* ── AI Companion ── */}
                {panelTab === "companion" && (
                  <div id="reader-panel-companion" className="flex h-full flex-col">
                    <div className="flex-1 space-y-3 overflow-y-auto p-3" data-lenis-prevent-wheel>
                      {/* Info card */}
                      <div className="relative overflow-hidden rounded-xl border border-primary/15 bg-gradient-to-br from-primary/[0.07] to-transparent p-3.5">
                        <div className="absolute -top-6 -right-6 size-20 rounded-full bg-primary/5 blur-2xl" />
                        <p className="type-h3 flex items-center gap-2 text-foreground relative">
                          <Sparkles className="size-3.5 text-primary" /> AI Reading Companion
                        </p>
                        <p className="type-caption mt-2 leading-relaxed text-muted-foreground/80 relative">
                          Ask anything about <span className="text-foreground/80 font-medium">{item.title}</span>. The companion
                          knows this item&apos;s subject, grade and linked topics.
                        </p>
                      </div>

                      {/* Messages */}
                      {messages.map((message, index) => (
                        <div
                          key={index}
                          className={cn(
                            "rounded-xl px-3.5 py-2.5 text-[13px] leading-6 transition-all duration-200",
                            message.role === "user"
                              ? "ml-6 bg-primary/[0.08] border border-primary/10 text-foreground"
                              : "mr-1 border border-white/[0.06] bg-white/[0.02] text-foreground/85",
                          )}
                        >
                          <p className={cn("whitespace-pre-wrap", message.role === "assistant" && "text-[12.5px] leading-[1.7]")}>
                            {message.content}
                          </p>
                        </div>
                      ))}

                      {asking && (
                        <div className="type-mono mr-1 flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-muted-foreground/60">
                          <div className="flex gap-1">
                            <div className="size-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="size-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="size-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                          <span className="ml-1">thinking…</span>
                        </div>
                      )}
                      <div ref={chatEndRef} />
                    </div>

                    {/* Chat input */}
                    <div className="relative shrink-0 border-t border-white/[0.06] p-3">
                      <div className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1.5 transition-all duration-200 focus-within:border-primary/30 focus-within:bg-white/[0.05]">
                        <label htmlFor="reader-question" className="sr-only">Ask the reading companion</label>
                        <Input
                          id="reader-question"
                          value={question}
                          onChange={(e) => setQuestion(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void handleAsk(); }}
                          placeholder="Ask about what you're reading…"
                          className="h-8 flex-1 rounded-lg border-0 bg-transparent px-2 text-[13px] shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
                        />
                        <Button
                          size="icon"
                          className="size-8 shrink-0 cursor-pointer rounded-lg bg-primary/20 text-primary hover:bg-primary/30 transition-all duration-200"
                          onClick={() => void handleAsk()}
                          disabled={asking || !question.trim()}
                          aria-label="Send"
                        >
                          <Send className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Videos ── */}
                {panelTab === "videos" && (
                  <div id="reader-panel-videos" className="space-y-3 p-3">
                    <div className="relative overflow-hidden rounded-xl border border-rose-500/15 bg-gradient-to-br from-rose-500/[0.05] to-transparent p-3.5">
                      <div className="absolute -top-4 -right-4 size-16 rounded-full bg-rose-500/5 blur-xl" />
                      <p className="type-h3 flex items-center gap-2 text-foreground relative">
                        <Youtube className="size-3.5 text-rose-400" /> Topic Videos
                      </p>
                      <p className="type-caption mt-2 leading-relaxed text-muted-foreground/80 relative">
                        Videos matched to <span className="text-foreground/80 font-medium">{item.subjectName} · Grade {item.grade}</span>. Opens in a new tab.
                      </p>
                    </div>

                    {searchingVideos && videos === null ? (
                      <div className="flex flex-col items-center gap-3 py-12">
                        <div className="relative">
                          <div className="absolute inset-0 animate-ping rounded-full bg-rose-400/20" />
                          <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-400/10 ring-1 ring-rose-400/20">
                            <Loader2 className="size-5 animate-spin text-rose-400" />
                          </div>
                        </div>
                        <p className="type-mono text-[11px] text-muted-foreground/50">Finding relevant videos…</p>
                      </div>
                    ) : youtubeConfigured === false ? (
                      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-white/[0.06] bg-white/[0.01] px-5 py-10">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/20">
                          <Youtube className="size-5 text-amber-400" />
                        </div>
                        <div className="text-center">
                          <p className="type-caption font-medium text-foreground/70">YouTube API key needed</p>
                          <p className="mt-1.5 type-caption text-[11px] leading-relaxed text-muted-foreground/50 max-w-[200px]">
                            Ask your admin to add <code className="rounded bg-white/[0.06] px-1 py-0.5 text-[10px] text-amber-300/80">YOUTUBE_API_KEY</code> in the Keys tab
                          </p>
                        </div>
                      </div>
                    ) : quotaExhausted ? (
                      <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-amber-400/10 bg-amber-400/[0.02] px-5 py-10">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-400/10 ring-1 ring-amber-400/20">
                          <RefreshCw className="size-5 text-amber-400" />
                        </div>
                        <div className="text-center">
                          <p className="type-caption font-medium text-foreground/70">Daily video limit reached</p>
                          <p className="mt-1.5 type-caption text-[11px] leading-relaxed text-muted-foreground/50 max-w-[200px]">
                            YouTube's free quota resets tomorrow. Videos will appear again then.
                          </p>
                        </div>
                      </div>
                    ) : videos && videos.length === 0 ? (
                      <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/[0.04] px-5 py-10">
                        <Youtube className="size-8 text-muted-foreground/20" />
                        <p className="type-caption text-muted-foreground/40">No videos found for this topic yet.</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {/* Priority channel section */}
                        {videos && videos.some((v) => v.isPriority) && (
                          <div>
                            <p className="mb-2 flex items-center gap-1.5 type-mono text-[9px] uppercase tracking-[0.15em] text-rose-400/60">
                              <Badge className="h-4 gap-1 rounded-md bg-rose-400/10 px-1.5 py-0 text-[9px] font-mono text-rose-400/80 border-0">✦ curated</Badge>
                              Ethiopian education
                            </p>
                            <div className="space-y-2">
                              {videos?.filter((v) => v.isPriority).map((video) => (
                                <a
                                  key={`p-${video.id}`}
                                  href={`https://www.youtube.com/watch?v=${video.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group relative flex cursor-pointer gap-3 rounded-2xl border border-rose-400/10 bg-rose-400/[0.03] p-2.5 transition-all duration-300 hover:border-rose-400/25 hover:bg-rose-400/[0.06] hover:shadow-lg hover:shadow-rose-400/5"
                                >
                                  {video.thumbnail ? (
                                    <div className="relative h-[68px] w-[110px] shrink-0 overflow-hidden rounded-xl ring-1 ring-white/[0.08]">
                                      <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/30">
                                        <Play className="size-5 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100" fill="white" />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex h-[68px] w-[110px] shrink-0 items-center justify-center rounded-xl bg-rose-400/10 ring-1 ring-white/[0.08]">
                                      <Youtube className="size-5 text-rose-400/50" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1 py-0.5">
                                    <p className="line-clamp-2 type-caption font-semibold leading-[1.5] text-foreground/80 group-hover:text-foreground transition-colors">
                                      {video.title}
                                    </p>
                                    <p className="mt-2 flex items-center gap-1.5 type-caption text-[10px] text-muted-foreground/40">
                                      <ExternalLink className="size-2.5" /> {video.channel}
                                    </p>
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* General section */}
                        {videos && videos.some((v) => !v.isPriority) && (
                          <div>
                            {videos.some((v) => v.isPriority) && (
                              <div className="my-3 flex items-center gap-2">
                                <div className="h-px flex-1 bg-white/[0.06]" />
                                <p className="type-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground/30">more results</p>
                                <div className="h-px flex-1 bg-white/[0.06]" />
                              </div>
                            )}
                            <div className="space-y-2">
                              {videos?.filter((v) => !v.isPriority).map((video) => (
                                <a
                                  key={`g-${video.id}`}
                                  href={`https://www.youtube.com/watch?v=${video.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="group relative flex cursor-pointer gap-3 rounded-2xl border border-white/[0.05] bg-white/[0.015] p-2.5 transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.04] hover:shadow-lg hover:shadow-black/10"
                                >
                                  {video.thumbnail ? (
                                    <div className="relative h-[60px] w-[100px] shrink-0 overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
                                      <img src={video.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                                      <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/30">
                                        <Play className="size-5 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100" fill="white" />
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex h-[60px] w-[100px] shrink-0 items-center justify-center rounded-xl bg-white/[0.03] ring-1 ring-white/[0.06]">
                                      <Youtube className="size-5 text-muted-foreground/20" />
                                    </div>
                                  )}
                                  <div className="min-w-0 flex-1 py-0.5">
                                    <p className="line-clamp-2 type-caption font-semibold leading-[1.5] text-foreground/70 group-hover:text-foreground transition-colors">
                                      {video.title}
                                    </p>
                                    <p className="mt-2 flex items-center gap-1.5 type-caption text-[10px] text-muted-foreground/35">
                                      <ExternalLink className="size-2.5" /> {video.channel}
                                    </p>
                                  </div>
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full cursor-pointer rounded-xl text-muted-foreground/50 hover:text-foreground"
                          onClick={() => { setVideos(null); setSearchingVideos(false); }}
                        >
                          <RefreshCw className="size-3.5" /> Refresh videos
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Scratchpad ── */}
                {panelTab === "scratchpad" && (
                  <div id="reader-panel-scratchpad" className="flex h-full flex-col">
                    <div className="flex items-center justify-between px-3 pt-3 pb-1">
                      <div className="flex items-center gap-2">
                        <div className="size-1.5 rounded-full bg-emerald-400/60" />
                        <p className="type-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/60">
                          Workings · auto-saved
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 cursor-pointer rounded-lg px-2 type-caption text-muted-foreground/50 hover:text-foreground"
                        onClick={() => { setScratchText(""); setScratchResult(null); setScratchSaved(false); }}
                      >
                        Clear
                      </Button>
                    </div>

                    <div className="flex gap-2 px-3 pt-2">
                      <label htmlFor="scratch-expression" className="sr-only">Expression to evaluate</label>
                      <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 transition-all duration-200 focus-within:border-emerald-400/30">
                        <Input
                          id="scratch-expression"
                          value={scratchInput}
                          onChange={(e) => setScratchInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleEvaluate(); }}
                          placeholder="e.g. sqrt(144) or (2*3.14*6371)/(24)"
                          className="h-7 flex-1 rounded-lg border-0 bg-transparent px-0 type-mono text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/30"
                        />
                        <Button
                          size="sm"
                          className="h-7 shrink-0 cursor-pointer rounded-lg bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20 border-0 px-2"
                          onClick={handleEvaluate}
                        >
                          <Calculator className="size-3" /> =
                        </Button>
                      </div>
                    </div>

                    {scratchResult && (
                      <div className="mx-3 mt-2">
                        <p
                          className={cn(
                            "rounded-lg border px-3 py-2 type-mono text-xs transition-all duration-200",
                            scratchResult.startsWith("⚠")
                              ? "border-rose-400/20 bg-rose-400/[0.05] text-rose-300"
                              : "border-emerald-400/20 bg-emerald-400/[0.05] text-emerald-300",
                          )}
                        >
                          {scratchResult}
                        </p>
                      </div>
                    )}

                    <textarea
                      aria-label="Scratchpad notes"
                      value={scratchText}
                      onChange={(e) => { setScratchText(e.target.value); setScratchSaved(false); }}
                      placeholder="Write workings, formulas, summaries…"
                      className="mx-3 mt-2.5 min-h-0 flex-1 resize-none rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 font-mono text-[12px] leading-[1.7] text-foreground/85 outline-none placeholder:text-muted-foreground/30 transition-all duration-200 focus:border-primary/30"
                    />

                    <div className="flex items-center justify-between gap-2 p-3">
                      <p className={cn("type-caption transition-colors", scratchSaved ? "text-emerald-400/50" : "text-amber-400/60")}>
                        {scratchSaved ? "● saved" : "○ unsaved changes"}
                      </p>
                      <Button
                        size="sm"
                        className="h-8 cursor-pointer rounded-xl"
                        onClick={() => void handleSaveScratch()}
                        disabled={scratchSaved || savingScratch}
                      >
                        {savingScratch ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : scratchSaved ? (
                          <BookmarkCheck className="size-3.5" />
                        ) : null}
                        {savingScratch ? "Saving…" : scratchSaved ? "Saved" : "Save notes"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ═══ RELATED RESOURCES STRIP ═══ */}
      {relatedItems.length > 0 && (
        <footer className="relative shrink-0 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl z-20">
          {/* Top glow line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          <div className="px-4 py-3 sm:px-5">
            <p className="type-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/40 mb-2.5">
              related resources · shared topics
            </p>
            <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
              {relatedItems.map((relatedItem: { _id: string; title: string; contentType: string; subjectSlug: string }) => (
                <Link
                  key={relatedItem._id}
                  to={`/read/${relatedItem._id}`}
                  className="group flex shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 transition-all duration-200 hover:border-primary/20 hover:bg-white/[0.04]"
                >
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary/[0.08]">
                    <MessageSquare className="size-3.5 text-primary/70 group-hover:text-primary transition-colors" />
                  </div>
                  <span className="type-caption max-w-48 truncate font-semibold text-foreground/70 group-hover:text-foreground/90 transition-colors">
                    {relatedItem.title}
                  </span>
                  <span
                    className={cn(
                      "type-mono rounded-md border bg-gradient-to-b px-1.5 py-0.5 uppercase text-[9px]",
                      subjectHue(relatedItem.subjectSlug),
                    )}
                  >
                    {relatedItem.subjectSlug}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </footer>
      )}

      {/* ══════ Exam Mode overlay (Feature 1) ══════ */}
      {examMode && item && (
        <ReaderExamMode
          pdfData={pdfData}
          pdfUrl={pdfUrl}
          numPages={numPages ?? 0}
          contentId={item._id}
          subjectId={item.subjectId}
          contentTitle={item.title}
          subjectName={item.subjectName}
          answerKey={answerKey}
          onClose={() => setExamMode(false)}
        />
      )}
    </div>
  );
}
