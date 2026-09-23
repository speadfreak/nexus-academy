// In-app reader — /read/:contentId
//
// LEARNYX SMART READER — "a textbook that teaches with you".
//
// Architecture (split for speed):
//   • PdfStage (memoized) — the PDF canvas, streaming loader, floating
//     controls, thumbnails, search. Chat keystrokes never re-render it.
//   • AiCompanion — cyan AI Reading Companion with page-aware quick actions.
//   • StudyDock — slide-up Notes / Highlights / Flashcards / AI.
//   • This file — top bar, study context header, selection popup, study
//     mode, fullscreen, exam/practice overlays, premium + guest flows.
//
// Perf contract with big PDFs (the 171 MB Biology textbook): pdf.js streams
// the document via range requests, fetches pages on demand, and the
// watchdog only falls back to the native viewer when NO bytes flow — see
// PdfStage.tsx header for the full model.

import { api } from "@/convex/_generated/api";
import { useAppBootstrap } from "@/components/AppBootstrap";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { extractPdfText, extractPageTextFromProxy } from "@/lib/pdf";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  Brain,
  Calculator,
  ExternalLink,
  GalleryVerticalEnd,
  Highlighter,
  Languages,
  Lightbulb,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  Minimize2,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  Play,
  RefreshCw,
  Sparkles,
  Timer,
  X,
  Youtube,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  CONTENT_TYPE_LABELS,
  type ContentType,
} from "@/convex/constants";
import type { ContentItemWithSubject } from "@/convex/content";
import type { PdfChunkManifest } from "@/convex/schema";
import { cn } from "@/lib/utils";
import { ReaderExamMode, type AnswerKeyInfo } from "@/components/reader/ReaderExamMode";
import { PracticeSessionPanel } from "@/components/reader/PracticePanel";
import type { SessionHighlights } from "@/components/reader/QuestionNavigator";
import { GuestLockOverlay } from "@/components/GuestLockOverlay";
import { PdfStage, type OutlineChapter } from "@/components/reader/PdfStage";
import { AiCompanion, type ChatMessage, type CompanionQuickAction } from "@/components/reader/AiCompanion";
import { StudyDock } from "@/components/reader/StudyDock";
import {
  loadHighlights,
  loadReadingProgress,
  saveHighlights,
  saveReadingProgress,
  type ReaderHighlight,
} from "@/lib/readerStorage";

// ─── Helpers ────────────────────────────────────────────────────────────
type PanelTab = "companion" | "videos" | "scratchpad";
type DockTab = "notes" | "highlights" | "flashcards";
type SelectionAction = "explain" | "simplify" | "translate" | "quiz" | "flashcard" | "highlight";

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

function formatLeftMinutes(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
  return `≈${minutes}m left`;
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** ≤2000 chars total — the readerAI action's hard cap. */
function clipPrompt(prompt: string, max = 2000): string {
  return prompt.length <= max ? prompt : prompt.slice(0, max - 1) + "…";
}

export default function Reader() {
  const { contentId } = useParams<{ contentId: string }>();
  const reader = useQuery(api.content.getReaderContent, {
    contentId: contentId as never,
  });
  const related = useQuery(api.content.getRelatedContent, {
    contentId: contentId as never,
  });
  const { profile } = useAppBootstrap(); // shared subscription (AppBootstrap)
  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);
  const toggleBookmark = useMutation(api.bookmarks.toggleBookmark);
  const askReaderQuestion = useAction(api.readerAI.askReaderQuestion);
  const searchYouTubeVideos = useAction(api.media.searchYouTubeVideos);
  const generateFlashcards = useAction(api.flashcards.generateFromContent as never);
  const scratchpad = useQuery(api.scratchpads.getScratchpad, {
    contentId: contentId as never,
  });
  const saveScratchpad = useMutation(api.scratchpads.saveScratchpad);

  const item: ContentItemWithSubject | null = reader?.item ?? null;
  const readerItemId = reader?.item?._id;

  // --- PDF pipeline state (owned here, rendered by the memoized stage) ---
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [docProxy, setDocProxy] = useState<any>(null);
  const [outlineChapters, setOutlineChapters] = useState<OutlineChapter[] | null>(null);

  // --- Panel / dock -------------------------------------------------------
  // Default CLOSED on mobile (PDF visible immediately), OPEN on desktop.
  const [panelOpen, setPanelOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 640px)").matches;
  });
  const [panelTab, setPanelTab] = useState<PanelTab>("companion");
  const [dockOpen, setDockOpen] = useState<DockTab | null>(null);

  // --- Study mode + fullscreen --------------------------------------------
  const [studyMode, setStudyMode] = useState(false);
  const [studySeconds, setStudySeconds] = useState(0);
  const pagesVisitedRef = useRef<Set<number>>(new Set());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Study-mode side effects on ENTER (both the button and the "m" key land
  // here): fresh timer, fresh pages-visited set, hide panels/dock.
  const prevStudyModeRef = useRef(false);
  useEffect(() => {
    if (studyMode && !prevStudyModeRef.current) {
      pagesVisitedRef.current = new Set([pageNumber]);
      setStudySeconds(0);
      setPanelOpen(false);
      setDockOpen(null);
    }
    prevStudyModeRef.current = studyMode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyMode]);

  // Global shortcuts: f = fullscreen, m = study mode toggle.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.key === "f" || event.key === "F") {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
        else rootRef.current?.requestFullscreen?.().catch(() => undefined);
      } else if (event.key === "m" || event.key === "M") {
        setStudyMode((on) => !on);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      rootRef.current?.requestFullscreen?.().catch(() =>
        toast.error("Fullscreen isn't available right now."),
      );
    }
  }, []);

  const enterStudyMode = useCallback(() => {
    setStudyMode(true);
  }, []);

  const exitStudyMode = useCallback(() => {
    setStudyMode(false);
    const minutes = Math.max(1, Math.round(studySeconds / 60));
    const pages = pagesVisitedRef.current.size;
    toast.success(`Study session · ${minutes} min · ${pages} page${pages === 1 ? "" : "s"}`, {
      description: "Keep the streak going — one page at a time.",
    });
  }, [studySeconds]);

  useEffect(() => {
    if (!studyMode) return;
    const iv = setInterval(() => setStudySeconds((s) => s + 1), 1000);
    return () => clearInterval(iv);
  }, [studyMode]);

  // --- Exam Mode (Feature 1) ----------------------------------------------
  const [examMode, setExamMode] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const answerKey: AnswerKeyInfo | null = reader?.answerKey ?? null;

  const examParamConsumedRef = useRef(false);
  useEffect(() => {
    if (examParamConsumedRef.current) return;
    if (!reader?.item) return;
    if (profile === undefined) return; // wait — the guest check needs the loaded profile
    if (searchParams.get("exam") !== "1") return;
    examParamConsumedRef.current = true;
    // Guest policy: guests can browse but not open resources (the
    // GuestLockOverlay is the response) — never auto-launch exam mode.
    if (reader.item.contentType === "past_exam" && !profile?.isAnonymous) {
      setExamMode(true);
      searchParams.delete("exam");
      setSearchParams(searchParams, { replace: true });
    }
  }, [reader?.item, searchParams, setSearchParams, profile]);

  // --- Practice session (Exam Prep hub deep-link) --------------------------
  const [practiceActive, setPracticeActive] = useState(false);
  const [practiceHighlights, setPracticeHighlights] = useState<SessionHighlights[]>([]);
  const practiceParamConsumedRef = useRef(false);
  useEffect(() => {
    if (practiceParamConsumedRef.current) return;
    if (!reader?.item) return;
    if (profile === undefined) return;
    if (searchParams.get("practice") !== "1") return;
    practiceParamConsumedRef.current = true;
    if (reader.item.contentType === "past_exam" && !profile?.isAnonymous) {
      setPracticeActive(true);
      searchParams.delete("practice");
      setSearchParams(searchParams, { replace: true });
    }
  }, [reader?.item, searchParams, setSearchParams, profile]);

  const addPracticeHighlight = (text: string) => {
    setPracticeHighlights((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, page: pageNumber },
    ]);
    setHighlightedText(null);
    window.getSelection()?.removeAllRanges();
    toast.success("Highlighted for this practice session.", {
      description: `Page ${pageNumber} — see Highlights in the practice panel.`,
    });
  };

  // --- AI companion ---------------------------------------------------------
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [pendingQuickAction, setPendingQuickAction] = useState<CompanionQuickAction | null>(null);

  // Highlight-to-ask: text selection inside the PDF text layer shows a
  // floating "Ask Learnyx AI" popup with real actions.
  const [highlightedText, setHighlightedText] = useState<string | null>(null);
  const [selectionPoint, setSelectionPoint] = useState<{ x: number; y: number } | null>(null);

  // --- Flashcard generation (top bar + dock + selection popup) --------------
  const [generatingFlashcards, setGeneratingFlashcards] = useState(false);
  const [flashcardResult, setFlashcardResult] = useState<{ deckId: string; cardCount: number } | null>(null);

  // ── Chunk-aware text extraction ─────────────────────────────────────
  // In chunked mode docProxy wraps ONLY the current chunk (local pages),
  // while callers think in GLOBAL page numbers. This maps the requested
  // range into the loaded chunk and clamps it — and it never triggers a
  // download of the full original file.
  const extractTextForGlobalRange = useCallback(
    async (fromGlobal: number, toGlobal: number, maxChars: number): Promise<string> => {
      if (!docProxy) return "";
      const manifest = (item as { pdfChunks?: PdfChunkManifest } | null | undefined)?.pdfChunks;
      if (manifest) {
        const chunk = manifest.chunks.find(
          (c) => pageNumber >= c.startPage && pageNumber <= c.endPage,
        );
        if (chunk) {
          const localFrom = Math.max(1, fromGlobal - chunk.startPage + 1);
          const localTo = Math.min(
            (docProxy as { numPages: number }).numPages ?? chunk.endPage - chunk.startPage + 1,
            toGlobal - chunk.startPage + 1,
          );
          if (localTo < localFrom) return "";
          return extractPageTextFromProxy(docProxy, localFrom, localTo, maxChars);
        }
      }
      return extractPageTextFromProxy(docProxy, fromGlobal, toGlobal, maxChars);
    },
    [docProxy, item, pageNumber],
  );

  const handleGenerateFlashcards = useCallback(
    async (startPage?: number, endPage?: number, selectionText?: string) => {
      if (!item || !item.subjectId || generatingFlashcards) return;
      setGeneratingFlashcards(true);
      setFlashcardResult(null);
      try {
        // Text strategies: (1) selection text, (2) loaded pdf.js proxy via
        // range requests, (3) fetch + standalone extraction for image-
        // heavy/odd files. Same 3-tier thinking as before, now shared.
        let pageText = "";
        const from = startPage ?? Math.max(1, pageNumber - 3);
        const to = endPage ?? pageNumber + 3;
        const manifest = (item as { pdfChunks?: PdfChunkManifest } | null | undefined)?.pdfChunks;
        if (selectionText) {
          pageText = selectionText;
        } else if (docProxy) {
          pageText = await extractTextForGlobalRange(from, to, 6000);
        }
        if (!pageText.trim() && !selectionText && (pdfUrl || item.fileUrl) && !manifest) {
          // NOTE: full-file fetch fallback is SKIPPED for chunked documents —
          // downloading the 171.8MB original to read a few pages of text is
          // exactly the disaster the chunking pipeline exists to prevent.
          toast.info("Extracting text from PDF…");
          try {
            const response = await fetch(pdfUrl || item.fileUrl);
            if (response.ok) {
              const blob = await response.blob();
              const file = new File([blob], item.title || "document.pdf", { type: "application/pdf" });
              pageText = await extractPdfText(file, 8, 6000);
            }
          } catch {
            // fall through to the image-based toast below
          }
        }
        if (!pageText.trim() || pageText.trim().length < 20) {
          toast.info(
            "This PDF appears to be image-based (scanned). Text extraction needs a text-based PDF. We're working on OCR support for scanned documents.",
          );
          return;
        }
        const result = (await generateFlashcards({
          contentId: item._id as never,
          subjectId: item.subjectId as never,
          pageText: pageText as never,
          pageRange: (selectionText
            ? `page ${pageNumber} (selection)`
            : `pages ${Math.min(from, to)}–${Math.max(from, to)}`) as never,
        })) as { deckId: string; cardCount: number };
        setFlashcardResult(result);
        setDockOpen("flashcards");
        toast.success(`Created ${result.cardCount} flashcards from this content!`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Generation failed.";
        if (msg.includes("premium")) {
          toast.error("Flashcard generation is a premium feature. Start your free trial to try it!");
        } else {
          toast.error(msg);
        }
      } finally {
        setGeneratingFlashcards(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, docProxy, pageNumber, pdfUrl, generatingFlashcards, generateFlashcards, extractTextForGlobalRange],
  );

  const handleAsk = useCallback(
    async (override?: string) => {
      const text = (override ?? question).trim();
      if (!contentId || !text || asking) return;
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setQuestion("");
      setAsking(true);
      try {
        const result = await askReaderQuestion({ contentId: contentId as never, question: text });
        setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The reading companion could not answer right now.";
        setMessages((prev) => [...prev, { role: "assistant", content: message }]);
      } finally {
        setAsking(false);
      }
    },
    [contentId, question, asking, askReaderQuestion],
  );

  const openCompanion = useCallback(() => {
    setDockOpen(null);
    if (!panelOpen) setPanelOpen(true);
    if (panelTab !== "companion") setPanelTab("companion");
  }, [panelOpen, panelTab]);

  // Selection listener — capture text + position for the action popup.
  useEffect(() => {
    const handleSelection = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setHighlightedText(null);
        setSelectionPoint(null);
        return;
      }
      const text = sel.toString().trim();
      if (text.length < 5 || text.length > 2000) {
        setHighlightedText(null);
        setSelectionPoint(null);
        return;
      }
      const container =
        document.querySelector("#pdf-scroll-area") ??
        document.querySelector("[data-page='read']") ??
        document.querySelector(".react-pdf__Page");
      const range = sel.getRangeAt(0);
      const pdfContainer = document.querySelector(".react-pdf__Document");
      if (
        (container && container.contains(range.commonAncestorContainer)) ||
        (pdfContainer && pdfContainer.contains(range.commonAncestorContainer))
      ) {
        setHighlightedText(text);
        const rect = range.getBoundingClientRect();
        setSelectionPoint({ x: rect.left + rect.width / 2, y: rect.top });
      } else {
        setHighlightedText(null);
        setSelectionPoint(null);
      }
    };
    document.addEventListener("selectionchange", handleSelection);
    return () => document.removeEventListener("selectionchange", handleSelection);
  }, []);

  const dismissSelection = useCallback(() => {
    setHighlightedText(null);
    setSelectionPoint(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // --- Page-aware AI quick actions ------------------------------------------
  const handleQuickAction = useCallback(
    async (action: CompanionQuickAction) => {
      if (!item) return;
      if (action === "make_flashcards") {
        await handleGenerateFlashcards();
        return;
      }
      setPendingQuickAction(action);
      try {
        const grade = item.grade;
        const pageText = docProxy
          ? await extractTextForGlobalRange(
              action === "summarize" ? Math.max(1, pageNumber - 1) : pageNumber,
              action === "summarize" ? pageNumber + 1 : pageNumber,
              1250,
            )
          : "";
        const quote = pageText.trim();
        if (docProxy && (!quote || quote.length < 20)) {
          toast.info("This page looks image-based (scanned), so I can't read its text yet.", {
            description: "Try asking a general question instead.",
          });
          return;
        }
        let prompt: string;
        switch (action) {
          case "explain_page":
            prompt = `Explain page ${pageNumber} of my "${item.title}" in simple terms${grade ? ` for a Grade ${grade} student` : ""}. Walk through the key ideas step by step:\n"""${quote}"""`;
            break;
          case "summarize":
            prompt = `Summarize the key points from pages ${Math.max(1, pageNumber - 1)}–${pageNumber + 1} of "${item.title}" as tight revision bullets:\n"""${quote}"""`;
            break;
          case "quiz_me":
            prompt = `Quiz me on page ${pageNumber} of "${item.title}". Give me 3 exam-style questions, then the answers at the end:\n"""${quote}"""`;
            break;
          case "make_notes":
            prompt = `Turn page ${pageNumber} of "${item.title}" into concise revision notes with memorizable bullets:\n"""${quote}"""`;
            break;
          default:
            return;
        }
        if (!panelOpen) setPanelOpen(true);
        if (panelTab !== "companion") setPanelTab("companion");
        await handleAsk(clipPrompt(prompt));
      } finally {
        setPendingQuickAction(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item, docProxy, pageNumber, panelOpen, panelTab, handleAsk, handleGenerateFlashcards, generatingFlashcards],
  );

  // --- Selection action popup handlers --------------------------------------
  const runSelectionAction = useCallback(
    (action: SelectionAction) => {
      const text = highlightedText;
      if (!text || !item) return;
      const short = text.length > 1400 ? text.slice(0, 1400) + "…" : text;
      if (action === "highlight") {
        if (practiceActive && item.contentType === "past_exam") {
          addPracticeHighlight(text);
        } else {
          const newHighlight: ReaderHighlight = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            text: text.length > 300 ? text.slice(0, 300) + "…" : text,
            page: pageNumber,
            createdAt: Date.now(),
          };
          setReaderHighlights((prev) => {
            const next = [newHighlight, ...prev];
            if (readerItemId) saveHighlights(readerItemId, next);
            return next;
          });
          setDockOpen("highlights");
          toast.success(`Highlighted — page ${pageNumber}.`, {
            description: "Saved on this device. Find it in the Study Dock.",
          });
        }
        dismissSelection();
        return;
      }
      if (action === "flashcard") {
        void handleGenerateFlashcards(pageNumber, pageNumber, text);
        dismissSelection();
        return;
      }
      let prompt: string;
      switch (action) {
        case "explain":
          prompt = `Explain this passage from page ${pageNumber} of "${item.title}" in simple terms:\n"""${short}"""`;
          break;
        case "simplify":
          prompt = `Simplify this passage so a ${item.grade ? `Grade ${item.grade}` : "high-school"} student can understand it instantly. Use short sentences:\n"""${short}"""`;
          break;
        case "translate":
          prompt = `Translate this passage to Amharic. Keep scientific and technical terms in English in parentheses:\n"""${short}"""`;
          break;
        case "quiz":
          prompt = `Create 3 short exam-style questions from this passage (put the answers at the end):\n"""${short}"""`;
          break;
        default:
          return;
      }
      openCompanion();
      void handleAsk(clipPrompt(prompt));
      dismissSelection();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [highlightedText, item, pageNumber, practiceActive, readerItemId, handleAsk, openCompanion, dismissSelection, handleGenerateFlashcards],
  );

  // --- Session highlights (localStorage — zero backend) ---------------------
  const [readerHighlights, setReaderHighlights] = useState<ReaderHighlight[]>([]);
  useEffect(() => {
    setReaderHighlights(readerItemId ? loadHighlights(readerItemId) : []);
    setDockOpen(null);
  }, [readerItemId]);

  const removeHighlight = (id: string) => {
    setReaderHighlights((prev) => {
      const next = prev.filter((h) => h.id !== id);
      if (readerItemId) saveHighlights(readerItemId, next);
      return next;
    });
  };

  const clearHighlights = () => {
    setReaderHighlights([]);
    if (readerItemId) saveHighlights(readerItemId, []);
    toast.success("All highlights cleared.");
  };

  // --- Reading progress (localStorage resume) -------------------------------
  const progressRestoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (numPages === null || !readerItemId) return;
    if (progressRestoredRef.current === readerItemId) return;
    progressRestoredRef.current = readerItemId;
    const saved = loadReadingProgress(readerItemId);
    if (saved && saved > 1 && saved <= numPages) {
      setPageNumber(saved);
      toast("Picking up where you left off", {
        description: `Continuing from page ${saved}.`,
      });
    }
  }, [numPages, readerItemId]);

  useEffect(() => {
    if (!readerItemId || numPages === null) return;
    const t = setTimeout(() => saveReadingProgress(readerItemId, pageNumber), 800);
    return () => clearTimeout(t);
  }, [readerItemId, pageNumber, numPages]);

  // --- YouTube ---------------------------------------------------------------
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
    return () => {
      cancelled = true;
    };
  }, [item, searchingVideos, searchYouTubeVideos]);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  // --- Scratchpad (shared: right-panel Calc tab + Study Dock notes) ----------
  const [scratchText, setScratchText] = useState("");
  const [scratchSaved, setScratchSaved] = useState(true);
  const [savingScratch, setSavingScratch] = useState(false);
  const [scratchInput, setScratchInput] = useState("");
  const [scratchResult, setScratchResult] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);

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

  // mathjs is ~600 KB of the Reader chunk — loaded ON DEMAND the first
  // time a student actually evaluates an expression, never at route open.
  const handleEvaluate = async () => {
    if (!scratchInput.trim()) return;
    setEvaluating(true);
    try {
      const { evaluate } = await import("mathjs");
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
    } finally {
      setEvaluating(false);
    }
  };

  const relatedItems = useMemo(() => related ?? [], [related]);

  // --- Study context header derived data --------------------------------------
  const currentChapter = useMemo(() => {
    if (!outlineChapters || outlineChapters.length === 0) return null;
    let found: OutlineChapter | null = null;
    for (const chapter of outlineChapters) {
      if (chapter.page <= pageNumber) found = chapter;
      else break;
    }
    return found;
  }, [outlineChapters, pageNumber]);

  const readingLeft = useMemo(() => {
    if (numPages === null) return null;
    return formatLeftMinutes(Math.max(1, Math.round((numPages - pageNumber + 1) * 0.75)));
  }, [numPages, pageNumber]);

  const watermark = useMemo(() => {
    if (!profile) return null;
    const who =
      profile?.name && profile?.email
        ? `${profile.name} · ${profile.email}`
        : profile?.email ?? profile?.name ?? "";
    if (!who) return null;
    return `${who} · ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
  }, [profile]);

  // Stable callbacks for the memoized stage (identity never changes).
  const handleStagePageChange = useCallback((page: number) => setPageNumber(page), []);
  const handleStageNumPages = useCallback((n: number | null) => setNumPages(n), []);
  const handleStageDocProxy = useCallback((doc: unknown) => setDocProxy(doc), []);
  const handleStageOutline = useCallback((chapters: OutlineChapter[] | null) => setOutlineChapters(chapters), []);
  const handleStagePdfData = useCallback((data: ArrayBuffer) => setPdfData(data), []);


  // Reset document-local UI state when the content changes.
  useEffect(() => {
    setPdfUrl(null);
    setPdfData(null);
    setPdfError(null);
    setNumPages(null);
    setPageNumber(1);
    setDocProxy(null);
    setOutlineChapters(null);
    setFlashcardResult(null);
    setMessages([]);
    setQuestion("");
    setStudyMode(false);
    setExamMode(false);
  }, [readerItemId]);

  useEffect(() => {
    if (!readerItemId || !item) {
      setPdfUrl(null);
      setPdfData(null);
      return;
    }
    let cancelled = false;
    setPdfError(null);
    if (item.isPremium) {
      // Premium content: server-side subscription check required
      setLoadingPdf(true);
      const load = async () => {
        try {
          const { url } = await getDownloadUrl({ contentId: readerItemId });
          if (cancelled) return;
          setPdfUrl(url);
        } catch (error) {
          if (!cancelled) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error("[Reader] PDF load failed:", msg);
            if (msg.includes("Premium") || msg.includes("premium") || msg.includes("trial")) {
              setPdfError("premium_required");
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
      setLoadingPdf(false);
    }
    return () => {
      cancelled = true;
    };
  }, [readerItemId, item, getDownloadUrl]);

  // ─── Loading state ────────────────────────────────────────────────────
  if (reader === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#080c14]">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="absolute -inset-4 animate-spin rounded-full border-2 border-transparent border-t-primary/60" style={{ animationDuration: "2s" }} />
            <div className="absolute -inset-8 animate-spin rounded-full border border-transparent border-t-primary/20" style={{ animationDuration: "3s", animationDirection: "reverse" }} />
            <BookOpen className="size-8 text-primary" />
          </div>
          <p className="type-mono text-sm uppercase tracking-widest text-muted-foreground">Loading reader…</p>
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

  const docReady = Boolean(docProxy) && numPages !== null;

  // ─── Main reader ──────────────────────────────────────────────────────
  return (
    <div ref={rootRef} className="flex h-screen flex-col overflow-hidden bg-[#080c14]">
      {/* ═══ TOP CHROME BAR (hidden in study mode) ═══ */}
      {!studyMode && (
        <header className="relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-black/40 px-3 backdrop-blur-2xl sm:px-5">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

          <Button
            asChild
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-xl text-muted-foreground transition-all duration-200 hover:bg-white/5 hover:text-foreground"
          >
            <Link to="/dashboard" aria-label="Back to the library">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>

          <div className="min-w-0 flex-1">
            <p className="type-h3 truncate text-foreground">{item.title}</p>
            <div className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap sm:gap-2">
              <span className="type-caption hidden truncate text-muted-foreground sm:inline">{item.subjectName}</span>
              <span className="hidden size-1 shrink-0 rounded-full bg-white/20 sm:block" />
              <span className="type-caption hidden text-muted-foreground sm:inline">Grade {item.grade}</span>
              {item.examYear && (
                <>
                  <span className="hidden size-1 shrink-0 rounded-full bg-white/20 sm:block" />
                  <span className="type-caption hidden text-muted-foreground sm:inline">{item.examYear}</span>
                </>
              )}
              <span
                className={cn(
                  "type-mono shrink-0 rounded-md border bg-gradient-to-b px-1.5 py-0.5 text-[10px] uppercase",
                  subjectHue(item.subjectSlug ?? ""),
                )}
              >
                {CONTENT_TYPE_LABELS[item.contentType as ContentType] ?? item.contentType}
              </span>
              {item.fileSizeBytes && (
                <>
                  <span className="hidden size-1 shrink-0 rounded-full bg-white/20 sm:block" />
                  <span className="type-caption hidden text-muted-foreground/60 sm:inline">{formatBytes(item.fileSizeBytes)}</span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-xl text-muted-foreground transition-all duration-200 hover:bg-white/5 hover:text-foreground"
              onClick={() => void toggleBookmark({ contentId: item._id })}
              aria-label={reader?.bookmarked ? "Remove bookmark" : "Bookmark this document"}
            >
              {reader?.bookmarked ? <BookmarkCheck className="size-4 text-primary" /> : <Bookmark className="size-4" />}
            </Button>

            {/* STUDY MODE — the distraction-free study session */}
            <Button
              size="sm"
              onClick={enterStudyMode}
              className="gap-1.5 rounded-xl border border-amber-300/25 bg-gradient-to-b from-amber-300/15 to-amber-400/[0.06] text-amber-200 shadow-[0_0_20px_-6px_rgba(251,191,36,0.35)] transition-all hover:from-amber-300/25 hover:to-amber-400/10"
              aria-label="Enter Study Mode"
              title="Study Mode — focused session with timer and quick actions"
            >
              <Brain className="size-4" />
              <span className="hidden text-xs font-semibold sm:inline">Study Mode</span>
            </Button>

            {item.subjectId && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 rounded-xl text-amber-300 hover:bg-amber-400/10 hover:text-amber-200"
                onClick={() => void handleGenerateFlashcards()}
                disabled={generatingFlashcards}
                aria-label="Generate flashcards from this page"
                title="Generate flashcards from the text you're reading right now"
              >
                {generatingFlashcards ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                <span className="hidden text-xs font-semibold sm:inline">
                  {generatingFlashcards ? "Generating…" : "Make Flashcards"}
                </span>
              </Button>
            )}
            {item.contentType === "past_exam" && !profile?.isAnonymous && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setExamMode(true)}
                aria-label="Enter exam mode"
                title="Exam mode — timed, no pausing"
                className="size-9 rounded-xl text-amber-300 transition-all duration-200 hover:bg-amber-400/10 hover:text-amber-200"
              >
                <Maximize2 className="size-4" />
              </Button>
            )}
            <div className="mx-1 h-5 w-px bg-white/10" />
            <Button
              variant="ghost"
              size="icon"
              className="hidden size-9 rounded-xl text-muted-foreground transition-all duration-200 hover:bg-white/5 hover:text-foreground sm:flex"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              title={isFullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-9 rounded-xl transition-all duration-200",
                panelOpen ? "bg-primary/10 text-primary hover:bg-primary/15" : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
              onClick={() => setPanelOpen((open) => !open)}
              aria-label={panelOpen ? "Hide side panel" : "Show side panel"}
              style={profile?.isAnonymous ? { display: "none" } : undefined}
            >
              {panelOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </Button>
          </div>
        </header>
      )}

      {/* ═══ STUDY CONTEXT HEADER — the learning-journey strip ═══ */}
      {!studyMode && docReady && (
        <div className="relative z-20 flex h-9 shrink-0 items-center gap-2.5 border-b border-white/[0.04] bg-black/30 px-3 backdrop-blur-xl sm:px-5">
          {currentChapter ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="type-mono shrink-0 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-primary">
                Chapter
              </span>
              <span className="type-caption truncate font-semibold text-foreground/80">{currentChapter.title}</span>
            </span>
          ) : (
            <span className="type-caption truncate font-semibold text-foreground/70">
              {item.subjectName} · Grade {item.grade}
            </span>
          )}
          <span className="size-1 shrink-0 rounded-full bg-white/20" />
          <span className="type-mono shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            Page {pageNumber} of {numPages}
          </span>
          {readingLeft && (
            <>
              <span className="hidden size-1 shrink-0 rounded-full bg-white/20 sm:block" />
              <span className="type-mono hidden shrink-0 text-[10px] text-muted-foreground/50 sm:block">{readingLeft}</span>
            </>
          )}
          {numPages && numPages > 1 && (
            <div className="ml-auto hidden w-36 items-center gap-2 sm:flex">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary transition-all duration-300 ease-out"
                  style={{ width: `${(pageNumber / numPages) * 100}%` }}
                />
              </div>
              <span className="type-mono text-[9px] tabular-nums text-muted-foreground/40">
                {Math.round((pageNumber / numPages) * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* ═══ PDF VIEWER ═══ */}
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          {profile?.isAnonymous ? (
            <GuestLockOverlay resourceTitle={item?.title} />
          ) : (
            <PdfStage
              contentId={readerItemId ?? "none"}
              pdfUrl={pdfUrl}
              pdfData={pdfData}
              onPdfData={handleStagePdfData}
              pdfError={pdfError}
              loadingPdf={loadingPdf}
              pageNumber={pageNumber}
              numPages={numPages}
              scale={scale}
              onPageChange={handleStagePageChange}
              onNumPages={handleStageNumPages}
              onScaleChange={setScale}
              onDocProxy={handleStageDocProxy}
              onOutline={handleStageOutline}
              watermark={watermark}
              chunkManifest={item.pdfChunks ?? null}
              fileSizeBytes={item.fileSizeBytes ?? null}
            />
          )}

          {/* ═══ STUDY MODE HUD ═══ */}
          {studyMode && (
            <>
              <motion.div
                initial={{ y: -30, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-3 pt-3"
              >
                <div className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-amber-300/20 bg-black/70 py-1.5 pl-4 pr-1.5 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
                  <Brain className="size-4 shrink-0 text-amber-300" />
                  <span className="type-caption max-w-[180px] truncate font-semibold text-foreground/85 sm:max-w-xs">{item.title}</span>
                  <span className="type-mono flex items-center gap-1 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[11px] tabular-nums text-amber-200">
                    <Timer className="size-3" /> {formatClock(studySeconds)}
                  </span>
                  <span className="type-mono hidden text-[10px] tabular-nums text-muted-foreground/50 sm:block">
                    {pagesVisitedRef.current.size} pages
                  </span>
                  <button
                    type="button"
                    onClick={exitStudyMode}
                    className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-amber-200/80 transition-all hover:bg-amber-300/15 hover:text-amber-100"
                    aria-label="Exit Study Mode"
                    title="Exit Study Mode"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              </motion.div>
              {/* Quick study actions */}
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.08 }}
                className="pointer-events-none absolute inset-x-0 top-16 z-30 flex justify-center px-3"
              >
                <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-1.5">
                  {(
                    [
                      { id: "explain_page" as const, label: "Explain page", icon: Lightbulb },
                      { id: "summarize" as const, label: "Summarize", icon: NotebookPen },
                      { id: "quiz_me" as const, label: "Quiz me", icon: Sparkles },
                    ]
                  ).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => void handleQuickAction(action.id)}
                      disabled={asking}
                      className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-cyan-400/20 bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-cyan-200 backdrop-blur-2xl transition-all hover:bg-cyan-400/10 disabled:opacity-40 active:scale-95"
                    >
                      <action.icon className="size-3" /> {action.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            </>
          )}

          {/* ═══ SELECTION ACTION POPUP — "Ask Learnyx AI" ═══ */}
          <AnimatePresence>
            {highlightedText && selectionPoint && !examMode && (
              <motion.div
                key="selection-popup"
                initial={{ opacity: 0, y: 6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.16 }}
                className="fixed z-[70] w-[300px] max-w-[92vw] overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#0a0e17]/95 shadow-[0_20px_60px_-12px_rgba(0,0,0,0.9),0_0_30px_-10px_rgba(34,211,238,0.3)] backdrop-blur-2xl"
                style={{
                  left: Math.max(8, Math.min(selectionPoint.x - 150, (typeof window !== "undefined" ? window.innerWidth : 400) - 308)),
                  top: Math.max(8, selectionPoint.y - 96),
                }}
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/50 to-transparent" />
                <p className="type-mono flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-[0.18em] text-cyan-300/80">
                  <Sparkles className="size-3" /> Ask Learnyx AI
                </p>
                <p className="line-clamp-2 px-3 pb-2 text-[11px] leading-snug text-muted-foreground/50">“{highlightedText.slice(0, 120)}{highlightedText.length > 120 ? "…" : ""}”</p>
                <div className="grid grid-cols-3 gap-1 px-2 pb-2">
                  {(
                    [
                      { id: "explain" as const, label: "Explain", icon: Lightbulb },
                      { id: "simplify" as const, label: "Simplify", icon: BookOpen },
                      { id: "translate" as const, label: "Translate", icon: Languages },
                      { id: "quiz" as const, label: "Quiz me", icon: NotebookPen },
                      { id: "flashcard" as const, label: "Flashcard", icon: GalleryVerticalEnd },
                      { id: "highlight" as const, label: "Highlight", icon: Highlighter },
                    ]
                  ).map((action) => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => runSelectionAction(action.id)}
                      disabled={generatingFlashcards && action.id === "flashcard"}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[10px] font-semibold transition-all active:scale-95 disabled:opacity-40",
                        action.id === "highlight"
                          ? "border-amber-300/25 bg-amber-300/[0.06] text-amber-200 hover:bg-amber-300/[0.14]"
                          : action.id === "flashcard"
                            ? "border-primary/25 bg-primary/[0.07] text-primary hover:bg-primary/[0.14]"
                            : "border-white/[0.07] bg-white/[0.03] text-foreground/75 hover:border-cyan-400/30 hover:bg-cyan-400/[0.08] hover:text-cyan-200",
                      )}
                    >
                      {generatingFlashcards && action.id === "flashcard" ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <action.icon className="size-3.5" />
                      )}
                      {action.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={dismissSelection}
                  className="absolute right-1.5 top-1.5 flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/40 hover:bg-white/10 hover:text-foreground"
                  aria-label="Dismiss"
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ═══ STUDY DOCK ═══ */}
          {!profile?.isAnonymous && (
            <StudyDock
              docReady={docReady}
              pageNumber={pageNumber}
              numPages={numPages}
              open={dockOpen}
              onOpenChange={setDockOpen}
              scratchText={scratchText}
              onScratchTextChange={(v) => {
                setScratchText(v);
                setScratchSaved(false);
              }}
              scratchSaved={scratchSaved}
              savingScratch={savingScratch}
              onSaveScratch={() => void handleSaveScratch()}
              highlights={readerHighlights}
              onCaptureSelection={() => {
                if (highlightedText) runSelectionAction("highlight");
                else toast.info("Select some text in the textbook first, then tap “From selection”.");
              }}
              onRemoveHighlight={removeHighlight}
              onClearHighlights={clearHighlights}
              onJumpToPage={(page) => {
                setPageNumber(Math.max(1, Math.min(numPages ?? page, page)));
                setDockOpen(null);
              }}
              onGenerateFlashcards={(start, end) => void handleGenerateFlashcards(start, end)}
              generatingFlashcards={generatingFlashcards}
              flashcardResult={flashcardResult}
              onFlashcardResultDismiss={() => setFlashcardResult(null)}
              onOpenAI={openCompanion}
              raised={practiceActive && item.contentType === "past_exam"}
            />
          )}

        </main>

        {/* ═══ SIDE PANEL — a sibling of <main> in the flex ROW.
             It was previously nested INSIDE <main>'s column flex, so on
             desktop it stacked BELOW the PDF (left-aligned) and squeezed
             the page canvas into a black sliver — the "deformed reader".
             Here `sm:static` places it as the right column of the row. */}
        <AnimatePresence>
          {panelOpen && !profile?.isAnonymous && (
            <>
                {/* Mobile backdrop */}
                <motion.button
                  type="button"
                  aria-label="Close reader panel"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm sm:hidden"
                  onClick={() => setPanelOpen(false)}
                />
                <motion.aside
                  key="reader-panel"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ type: "spring", stiffness: 350, damping: 35 }}
                  role="complementary"
                  aria-labelledby="reader-panel-title"
                  className="absolute bottom-0 right-0 top-0 z-50 flex w-[88%] max-w-[400px] flex-col border-l border-white/[0.08] bg-[#0a0e17]/95 shadow-[-24px_0_80px_-24px_rgba(0,0,0,0.85)] backdrop-blur-2xl sm:static sm:z-auto sm:w-[380px] sm:max-w-none sm:shadow-none xl:w-[410px]"
                >
                  <div className="absolute inset-y-0 left-0 w-px bg-gradient-to-b from-transparent via-primary/20 to-transparent sm:hidden" />

                  {/* Tab bar */}
                  <div className="relative flex shrink-0 items-center gap-1 border-b border-white/[0.06] px-2 py-2">
                    <span id="reader-panel-title" className="sr-only">Reader tools</span>
                    {(
                      [
                        { id: "companion" as const, label: "AI", desc: "Companion" },
                        { id: "videos" as const, label: "Videos", desc: "Videos" },
                        { id: "scratchpad" as const, label: "Calc", desc: "Scratchpad" },
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
                          "interactive-press relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2 type-caption font-semibold transition-all duration-200",
                          panelTab === tab.id
                            ? tab.id === "companion"
                              ? "text-cyan-300"
                              : "text-primary"
                            : "text-muted-foreground/60 hover:bg-white/[0.03] hover:text-muted-foreground",
                        )}
                      >
                        {panelTab === tab.id && (
                          <div className={cn("absolute inset-x-2 -bottom-[9px] h-0.5 rounded-full", tab.id === "companion" ? "bg-cyan-300/60" : "bg-primary/60")} />
                        )}
                        {tab.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-xl text-muted-foreground/60 transition-all hover:bg-white/5 hover:text-foreground sm:hidden"
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
                      <div id="reader-panel-companion" className="h-full">
                        <AiCompanion
                          itemTitle={item.title}
                          subjectName={item.subjectName}
                          grade={item.grade}
                          pageNumber={pageNumber}
                          docReady={docReady}
                          messages={messages}
                          asking={asking}
                          question={question}
                          onQuestionChange={setQuestion}
                          onAsk={(override) => void handleAsk(override)}
                          onQuickAction={(action) => void handleQuickAction(action)}
                          pendingAction={pendingQuickAction}
                          generatingFlashcards={generatingFlashcards}
                        />
                      </div>
                    )}

                    {/* ── Videos ── */}
                    {panelTab === "videos" && (
                      <div id="reader-panel-videos" className="space-y-3 p-3">
                        <div className="relative overflow-hidden rounded-xl border border-rose-500/15 bg-gradient-to-br from-rose-500/[0.05] to-transparent p-3.5">
                          <div className="absolute -right-4 -top-4 size-16 rounded-full bg-rose-500/5 blur-xl" />
                          <p className="type-h3 relative flex items-center gap-2 text-foreground">
                            <Youtube className="size-3.5 text-rose-400" /> Topic Videos
                          </p>
                          <p className="type-caption relative mt-2 leading-relaxed text-muted-foreground/80">
                            Videos matched to <span className="font-medium text-foreground/80">{item.subjectName} · Grade {item.grade}</span>. Opens in a new tab.
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
                              <p className="mt-1.5 type-caption max-w-[200px] text-[11px] leading-relaxed text-muted-foreground/50">
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
                              <p className="mt-1.5 type-caption max-w-[200px] text-[11px] leading-relaxed text-muted-foreground/50">
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
                            {videos && videos.some((v) => v.isPriority) && (
                              <div>
                                <p className="mb-2 flex items-center gap-1.5 type-mono text-[9px] uppercase tracking-[0.15em] text-rose-400/60">
                                  <Badge className="h-4 gap-1 rounded-md border-0 bg-rose-400/10 px-1.5 py-0 text-[9px] font-mono text-rose-400/80">✦ curated</Badge>
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
                                        <p className="line-clamp-2 type-caption font-semibold leading-[1.5] text-foreground/80 transition-colors group-hover:text-foreground">
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
                                        <p className="line-clamp-2 type-caption font-semibold leading-[1.5] text-foreground/70 transition-colors group-hover:text-foreground">
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
                              onClick={() => {
                                setVideos(null);
                                setSearchingVideos(false);
                              }}
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
                        <div className="flex items-center justify-between px-3 pb-1 pt-3">
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
                          <label htmlFor="scratch-expression" className="sr-only">Expression to evaluate</label>
                          <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 transition-all duration-200 focus-within:border-emerald-400/30">
                            <Input
                              id="scratch-expression"
                              value={scratchInput}
                              onChange={(e) => setScratchInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  void handleEvaluate();
                                }
                              }}
                              placeholder="e.g. sqrt(144) or (2*3.14*6371)/(24)"
                              className="h-7 flex-1 rounded-lg border-0 bg-transparent px-0 type-mono text-xs shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/30"
                            />
                            <Button
                              size="sm"
                              className="h-7 shrink-0 cursor-pointer rounded-lg border-0 bg-emerald-400/10 px-2 text-emerald-400 hover:bg-emerald-400/20"
                              onClick={() => void handleEvaluate()}
                              disabled={evaluating}
                            >
                              {evaluating ? <Loader2 className="size-3 animate-spin" /> : <Calculator className="size-3" />} =
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
                          onChange={(e) => {
                            setScratchText(e.target.value);
                            setScratchSaved(false);
                          }}
                          placeholder="Write workings, formulas, summaries…"
                          className="mx-3 mt-2.5 min-h-0 flex-1 resize-none rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 font-mono text-[12px] leading-[1.7] text-foreground/85 outline-none transition-all duration-200 placeholder:text-muted-foreground/30 focus:border-primary/30"
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
                </motion.aside>
              </>
            )}
        </AnimatePresence>
      </div>

      {/* ═══ RELATED RESOURCES STRIP ═══ */}
      {!studyMode && relatedItems.length > 0 && (
        <footer className="relative z-20 shrink-0 border-t border-white/[0.06] bg-black/40 backdrop-blur-xl">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
          <div className="px-4 py-3 sm:px-5">
            <p className="type-mono mb-2.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/40">
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
                    <MessageSquare className="size-3.5 text-primary/70 transition-colors group-hover:text-primary" />
                  </div>
                  <span className="type-caption max-w-48 truncate font-semibold text-foreground/70 transition-colors group-hover:text-foreground/90">
                    {relatedItem.title}
                  </span>
                  <span className={cn("type-mono rounded-md border bg-gradient-to-b px-1.5 py-0.5 text-[9px] uppercase", subjectHue(relatedItem.subjectSlug))}>
                    {relatedItem.subjectSlug}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </footer>
      )}

      {/* ══════ Practice session layer (Exam Prep hub deep-link) ══════ */}
      {practiceActive && !examMode && item?.contentType === "past_exam" && (
        <PracticeSessionPanel
          contentId={item._id}
          contentTitle={item.title}
          subjectId={item.subjectId}
          answerKey={answerKey}
          numPages={numPages ?? 0}
          currentPage={pageNumber}
          onPageJump={setPageNumber}
          onAskCompanion={(q) => {
            if (!panelOpen) setPanelOpen(true);
            if (panelTab !== "companion") setPanelTab("companion");
            setQuestion(q);
          }}
          highlights={practiceHighlights}
          onAddHighlight={addPracticeHighlight}
          onExit={() => setPracticeActive(false)}
        />
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
          durationSeconds={item.durationMinutes ? item.durationMinutes * 60 : undefined}
          onClose={() => setExamMode(false)}
        />
      )}
    </div>
  );
}
