// In-app reader — /read/:contentId
//
// The real reading experience: PDF rendered in-browser with react-pdf (page
// navigation + zoom), a collapsible side panel with the AI reading companion
// (Gemini-preferred, Grok fallback), YouTube topic videos, and a persisted
// math/physics scratchpad (mathjs). A "related resources" strip surfaces the
// topic-correlation links created by the admin AI classification flow.
//
// Safety/UX notes:
// - Videos are never embedded or autoplayed — they open in a new tab.
// - The scratchpad is per (user, content item) and persists across visits.
// - Premium PDFs go through the same server-gated signed-URL action as the
//   library download button; free files use their public URL directly.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { evaluate } from "mathjs";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Document, Page as PdfPage } from "react-pdf";
import { toast } from "sonner";
import { pdfjs } from "@/lib/pdf";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CONTENT_TYPE_LABELS,
  type ContentType,
} from "@/convex/constants";
import type { ContentItemWithSubject } from "@/convex/content";
import { cn } from "@/lib/utils";

// react-pdf needs the worker URL; it's configured once in src/lib/pdf.ts.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

type PanelTab = "companion" | "videos" | "scratchpad";

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
  const reader = useQuery(api.content.getReaderContent, {
    contentId: contentId as never,
  });
  const related = useQuery(api.content.getRelatedContent, {
    contentId: contentId as never,
  });
  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);
  const toggleBookmark = useMutation(api.bookmarks.toggleBookmark);
  const askReaderQuestion = useAction(api.geminiReader.askReaderQuestion);
  const searchYouTubeVideos = useAction(api.media.searchYouTubeVideos);
  const scratchpad = useQuery(api.scratchpads.getScratchpad, {
    contentId: contentId as never,
  });
  const saveScratchpad = useMutation(api.scratchpads.saveScratchpad);

  const item: ContentItemWithSubject | null = reader?.item ?? null;

  // --- PDF viewing state -------------------------------------------------
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [scale, setScale] = useState(1);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const readerItemId = reader?.item?._id;

  useEffect(() => {
    if (!readerItemId) {
      setPdfUrl(null);
      return;
    }
    let cancelled = false;
    setPdfError(null);
    setPdfUrl(null);
    setNumPages(null);
    setPageNumber(1);
    setPageInput("1");
    setLoadingPdf(true);
    const load = async () => {
      try {
        const { url } = await getDownloadUrl({ contentId: readerItemId });
        if (!cancelled) setPdfUrl(url);
      } catch (error) {
        if (!cancelled) {
          setPdfError(
            error instanceof Error
              ? error.message
              : "Could not open this document. It may be premium content.",
          );
        }
      } finally {
        if (!cancelled) setLoadingPdf(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [readerItemId, getDownloadUrl]);

  // --- Panel -------------------------------------------------------------
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<PanelTab>("companion");

  // --- AI companion ------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

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
  const [videos, setVideos] = useState<
    { id: string; title: string; channel: string; thumbnail: string }[] | null
  >(null);
  const [youtubeConfigured, setYoutubeConfigured] = useState<boolean | null>(null);
  const [searchingVideos, setSearchingVideos] = useState(false);

  useEffect(() => {
    if (!item || videos !== null || searchingVideos) return;
    const query = [item.subjectName, item.grade ? `grade ${item.grade}` : ""]
      .filter(Boolean)
      .join(" ");
    if (!query) return;
    let cancelled = false;
    setSearchingVideos(true);
    void searchYouTubeVideos({ query, maxResults: 5 })
      .then((result) => {
        if (cancelled) return;
        setYoutubeConfigured(result.configured);
        setVideos(result.videos);
      })
      .catch(() => {
        if (!cancelled) setYoutubeConfigured(false);
      })
      .finally(() => {
        if (!cancelled) setSearchingVideos(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, videos, searchingVideos, searchYouTubeVideos]);

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

  if (reader === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Lock className="size-6" />
        </div>
        <div>
          <h1 className="type-h1">Document not available</h1>
          <p className="type-body mt-1 text-muted-foreground">
            It may have been removed, or you need to sign in to read it.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl">
          <Link to="/dashboard">
            <ArrowLeft className="size-4" /> Back to the library
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* ---- Chrome bar ---- */}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/8 bg-black/30 px-3 backdrop-blur sm:px-4">
        <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-lg text-muted-foreground">
          <Link to="/dashboard" aria-label="Back to the library">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold tracking-tight">{item.title}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {item.subjectName} · Grade {item.grade}
            {item.examYear ? ` · ${item.examYear}` : ""} ·{" "}
            {CONTENT_TYPE_LABELS[item.contentType as ContentType]}
            {item.fileSizeBytes ? ` · ${formatBytes(item.fileSizeBytes)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg text-muted-foreground"
            onClick={() => void toggleBookmark({ contentId: item._id })}
            aria-label={reader?.bookmarked ? "Remove bookmark" : "Bookmark this document"}
            title={reader?.bookmarked ? "Remove bookmark" : "Save to reading list"}
          >
            {reader?.bookmarked ? (
              <BookmarkCheck className="size-4 text-primary" />
            ) : (
              <Bookmark className="size-4" />
            )}
          </Button>
          {pdfUrl && (
            <Button asChild variant="ghost" size="icon" className="size-9 rounded-lg text-muted-foreground">
              <a href={pdfUrl} target="_blank" rel="noopener noreferrer" aria-label="Download PDF">
                <Download className="size-4" />
              </a>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-9 rounded-lg text-muted-foreground"
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
          >
            {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
          </Button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* ---- PDF viewer ---- */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[radial-gradient(circle_at_50%_-20%,rgba(255,255,255,0.05),transparent_60%)]">
          {/* Page toolbar */}
          <div className="flex h-11 shrink-0 items-center justify-center gap-1.5 border-b border-white/5 bg-black/20 px-3">
            <button
              type="button"
              onClick={() => setScale((s) => Math.max(0.6, Math.round((s - 0.15) * 100) / 100))}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Zoom out"
            >
              <ZoomOut className="size-3.5" />
            </button>
            <span className="w-12 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setScale((s) => Math.min(2.2, Math.round((s + 0.15) * 100) / 100))}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
              aria-label="Zoom in"
            >
              <ZoomIn className="size-3.5" />
            </button>
            <div className="mx-2 h-4 w-px bg-white/10" />
            <button
              type="button"
              onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
              disabled={pageNumber <= 1}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:cursor-default disabled:opacity-30"
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
            </button>
            <label htmlFor="reader-page-number" className="sr-only">
              Page number
            </label>
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
              aria-label="Current page number"
              className="h-7 w-12 rounded-md border-white/10 bg-white/5 px-1 text-center font-mono text-[11px] tabular-nums"
            />
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              / {numPages ?? "—"}
            </span>
            <button
              type="button"
              onClick={() => setPageNumber((p) => (numPages ? Math.min(numPages, p + 1) : p + 1))}
              disabled={numPages !== null && pageNumber >= numPages}
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:cursor-default disabled:opacity-30"
              aria-label="Next page"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          {/* PDF body */}
          <div className="flex-1 overflow-auto p-4 sm:p-6">
            {loadingPdf && !pdfUrl && (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <Loader2 className="size-6 animate-spin text-primary" />
                <p className="font-mono text-[11px] text-muted-foreground">opening document…</p>
              </div>
            )}
            {pdfError && (
              <div className="mx-auto mt-16 max-w-sm rounded-2xl border border-rose-400/25 bg-rose-400/5 px-6 py-8 text-center">
                <Lock className="mx-auto size-6 text-rose-300" />
                <h2 className="mt-3 text-sm font-bold tracking-tight">Could not open this document</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{pdfError}</p>
                <Button asChild size="sm" className="mt-4 rounded-xl">
                  <Link to="/upgrade">See upgrade options</Link>
                </Button>
              </div>
            )}
            {pdfUrl && !pdfError && (
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages: pages }) => {
                  setNumPages(pages);
                  setPageNumber(1);
                  setPageInput("1");
                }}
                onLoadError={(error) => {
                  console.error("[Reader] PDF load failed:", error);
                  setPdfError("The document could not be rendered in the browser.");
                }}
                className="mx-auto flex max-w-fit flex-col items-center gap-3"
              >
                <div className="overflow-hidden rounded-lg shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)] ring-1 ring-white/10">
                  <PdfPage
                    pageNumber={pageNumber}
                    scale={scale}
                    renderTextLayer
                    renderAnnotationLayer
                    loading={
                      <div className="flex size-40 items-center justify-center">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      </div>
                    }
                  />
                </div>
              </Document>
            )}
          </div>
        </main>

        {/* ---- Side panel ---- */}
        {panelOpen && (
          <>
            <button
              type="button"
              aria-label="Close reader panel"
              className="absolute inset-0 z-10 bg-black/45 sm:hidden"
              onClick={() => setPanelOpen(false)}
            />
            <aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="reader-panel-title"
              className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-white/8 bg-background shadow-2xl sm:static sm:z-auto sm:w-96 sm:bg-black/20 sm:shadow-none"
            >
            <div className="flex shrink-0 items-center gap-1 border-b border-white/8 px-2 py-2">
              <span id="reader-panel-title" className="sr-only">Reader tools</span>
              {(
                [
                  { id: "companion", label: "AI companion", icon: Bot },
                  { id: "videos", label: "Videos", icon: Youtube },
                  { id: "scratchpad", label: "Scratchpad", icon: Calculator },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPanelTab(tab.id)}
                  role="tab"
                  aria-selected={panelTab === tab.id}
                  aria-controls={`reader-panel-${tab.id}`}
                  className={cn(
                    "interactive-press flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 type-caption font-bold",
                    panelTab === tab.id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  )}
                >
                  <tab.icon className="size-3.5" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              ))}
              <button
                type="button"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-white/5 hover:text-foreground sm:hidden"
                onClick={() => setPanelOpen(false)}
                aria-label="Close reader tools"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
              {panelTab === "companion" && (
                <div id="reader-panel-companion" className="flex h-full flex-col">
                  <div className="flex-1 space-y-3 overflow-y-auto p-3">
                    <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                      <p className="flex items-center gap-1.5 font-bold text-foreground">
                        <Sparkles className="size-3 text-primary" /> Grounded in this document
                      </p>
                      <p className="mt-1">
                        Ask anything about {item.title}. The companion knows this item&apos;s
                        subject, grade and linked topics. Free students get a fair daily
                        message allowance; premium is unlimited.
                      </p>
                    </div>
                    {messages.map((message, index) => (
                      <div
                        key={index}
                        className={cn(
                          "rounded-xl px-3 py-2.5 text-[13px] leading-6",
                          message.role === "user"
                            ? "ml-8 bg-primary/10 text-foreground"
                            : "mr-2 border border-white/8 bg-white/[0.03] text-foreground/90",
                        )}
                      >
                        <p className={cn("whitespace-pre-wrap", message.role === "assistant" && "text-[12.5px]")}>
                          {message.content}
                        </p>
                      </div>
                    ))}
                    {asking && (
                      <div className="mr-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin text-primary" /> thinking…
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="flex shrink-0 items-center gap-2 border-t border-white/8 p-2.5">
                    <label htmlFor="reader-question" className="sr-only">
                      Ask the reading companion
                    </label>
                    <Input
                      id="reader-question"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleAsk();
                      }}
                      placeholder="Ask about what you're reading…"
                      className="h-9 rounded-xl bg-white/5 text-[13px]"
                    />
                    <Button
                      size="icon"
                      className="size-9 shrink-0 cursor-pointer rounded-xl"
                      onClick={() => void handleAsk()}
                      disabled={asking || !question.trim()}
                      aria-label="Ask the reading companion"
                    >
                      <Send className="size-4" />
                    </Button>
                  </div>
                </div>
              )}

              {panelTab === "videos" && (
                <div id="reader-panel-videos" className="space-y-3 p-3">
                  <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                    <p className="flex items-center gap-1.5 font-bold text-foreground">
                      <Youtube className="size-3 text-primary" /> Topic videos
                    </p>
                    <p className="mt-1">
                      Videos matched to {item.subjectName} · Grade {item.grade}. Opens in a new
                      tab — never embedded, so your attention stays yours.
                    </p>
                  </div>
                  {searchingVideos && videos === null ? (
                    <div className="flex items-center gap-2 py-6 text-[11px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin text-primary" /> searching…
                    </div>
                  ) : youtubeConfigured === false ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center">
                      <p className="text-xs text-muted-foreground">
                        Video search needs a <code className="rounded bg-white/10 px-1">YOUTUBE_API_KEY</code> in the Keys tab.
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                        Google Cloud Console → YouTube Data API v3
                      </p>
                    </div>
                  ) : videos && videos.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">
                      No videos found for this topic yet.
                    </p>
                  ) : (
                    videos?.map((video) => (
                      <a
                        key={video.id}
                        href={`https://www.youtube.com/watch?v=${video.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex cursor-pointer gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] p-2 transition-colors hover:border-primary/30"
                      >
                        {video.thumbnail ? (
                          <img
                            src={video.thumbnail}
                            alt={`${video.title} thumbnail`}
                            loading="lazy"
                            className="h-16 w-24 shrink-0 rounded-lg object-cover"
                          />
                        ) : (
                          <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Youtube className="size-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[12px] font-semibold leading-5 text-foreground/90 group-hover:text-primary">
                            {video.title}
                          </p>
                          <p className="mt-1 flex items-center gap-1 truncate font-mono text-[10px] text-muted-foreground">
                            <ExternalLink className="size-2.5" /> {video.channel}
                          </p>
                        </div>
                      </a>
                    ))
                  )}
                  {videos && videos.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full cursor-pointer rounded-xl text-muted-foreground"
                      onClick={() => {
                        setVideos(null);
                        setSearchingVideos(false);
                      }}
                    >
                      <RefreshCw className="size-3.5" /> Search again
                    </Button>
                  )}
                </div>
              )}

              {panelTab === "scratchpad" && (
                <div id="reader-panel-scratchpad" className="flex h-full flex-col">
                  <div className="flex items-center justify-between px-3 pt-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      workings · auto-saved per document
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 cursor-pointer rounded-lg px-2 text-[11px] text-muted-foreground"
                      onClick={() => {
                        setScratchText("");
                        setScratchResult(null);
                        setScratchSaved(false);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                  <div className="flex gap-2 px-3 pt-2">
                    <label htmlFor="scratch-expression" className="sr-only">
                      Expression to evaluate
                    </label>
                    <Input
                      id="scratch-expression"
                      value={scratchInput}
                      onChange={(e) => setScratchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEvaluate();
                      }}
                      placeholder="e.g. (2*3.14*6371)/(24)  or  sqrt(144)"
                      className="h-8 rounded-lg bg-white/5 font-mono text-[11px]"
                    />
                    <Button
                      size="sm"
                      className="h-8 shrink-0 cursor-pointer rounded-lg"
                      onClick={handleEvaluate}
                    >
                      <Calculator className="size-3.5" /> =
                    </Button>
                  </div>
                  {scratchResult && (
                    <p
                      className={cn(
                        "mx-3 mt-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-[11px]",
                        scratchResult.startsWith("⚠")
                          ? "border-rose-400/25 bg-rose-400/5 text-rose-300"
                          : "border-emerald-400/25 bg-emerald-400/5 text-emerald-300",
                      )}
                    >
                      {scratchResult}
                    </p>
                  )}
                  <textarea
                    aria-label="Scratchpad notes"
                    value={scratchText}
                    onChange={(e) => {
                      setScratchText(e.target.value);
                      setScratchSaved(false);
                    }}
                    placeholder="Write workings, formulas, summaries…"
                    className="mx-3 mt-2 min-h-0 flex-1 resize-none rounded-xl border border-white/8 bg-white/[0.03] p-3 font-mono text-[12px] leading-5 text-foreground/90 outline-none placeholder:text-muted-foreground/50 focus:border-primary/40"
                  />
                  <div className="flex items-center justify-between gap-2 p-2.5">
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {scratchSaved ? "saved" : "unsaved changes"}
                    </p>
                    <Button
                      size="sm"
                      className="h-8 cursor-pointer rounded-lg"
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

      {/* ---- Related resources strip ---- */}
      {relatedItems.length > 0 && (
        <footer className="shrink-0 border-t border-white/8 bg-black/25 px-4 py-3">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            related resources · shared topics
          </p>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {relatedItems.map((relatedItem: { _id: string; title: string; contentType: string; subjectSlug: string }) => (
              <Link
                key={relatedItem._id}
                to={`/read/${relatedItem._id}`}
                className="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 transition-colors hover:border-primary/30"
              >
                <MessageSquare className="size-3.5 shrink-0 text-primary" />
                <span className="max-w-48 truncate text-[11px] font-semibold text-foreground/90">
                  {relatedItem.title}
                </span>
                <span
                  className={cn(
                    "rounded-md border bg-gradient-to-b px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase",
                    subjectHue(relatedItem.subjectSlug),
                  )}
                >
                  {relatedItem.subjectSlug}
                </span>
              </Link>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
