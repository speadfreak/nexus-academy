// Smart Reader PDF stage — the performance-critical heart of the reader.
//
// Split out of Reader.tsx so the AI panel / study dock / chat can never
// re-render the canvas tree (this component is React.memo'd — chat
// keystrokes don't touch the document).
//
// PERFORMANCE MODEL (the "big PDF" fix):
//   1. URL-first loading → pdf.js issues HTTP range requests and fetches
//      only the chunks it needs. A 171 MB textbook renders page 1 from a
//      few hundred KB instead of the full download.
//   2. `disableAutoFetch: true` stops pdf.js from eagerly buffering the
//      whole document in the background — pages are fetched on demand.
//   3. `rangeChunkSize: 262144` (256 KB) — 4× fewer round-trips than the
//      64 KB default, materially faster on high-latency mobile networks.
//   4. PROGRESS-AWARE WATCHDOG: the old reader fell back to the browser's
//      native viewer after a fixed 8s/15s timeout — which bounced huge
//      documents into the "NATIVE VIEWER" (full download in an iframe,
//      the exact slowness users complained about). Now the watchdog only
//      fires when NO bytes have flowed for the timeout window. A slow-
//      but-flowing stream keeps rendering with a live progress bar.
//   5. Single-page rendering with pre-rendered ±1 neighbours → instant
//      page flips, bounded memory.
//   6. Thumbnails render lazily via IntersectionObserver with a small
//      concurrency gate — a 184-page book never renders 184 canvases.
//   7. Search extracts page text incrementally (cached per session) and
//      yields to the UI thread, so searching never janks the reader.
//
// Safety net chain (unchanged philosophy): URL range mode → ArrayBuffer
// full download (with progress) → iframe (browser native viewer).

import { AnimatePresence, motion } from "framer-motion";
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Document, Page as PdfPage, pdfjs } from "react-pdf";
// MANDATORY react-pdf styles — without TextLayer.css the selection text
// layer renders as VISIBLE ghost text below the canvas and text selection
// (the "Ask Learnyx AI" popup) is completely broken.
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import type { PdfChunkManifest } from "@/convex/schema";
import { getCachedChunk, putCachedChunk } from "@/lib/pdfChunkCache";
import { SPLIT_THRESHOLD_BYTES } from "@/convex/constants";
import {
  ChevronLeft,
  ChevronRight,
  Crown,
  Layers,
  Loader2,
  Lock,
  Maximize2,
  RotateCcw,
  Scan,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

// react-pdf bundles its own pdfjs-dist. The worker is served same-origin
// (public/pdf.worker.min.mjs) and version-synced by scripts/sync-pdfjs.mjs
// (postinstall) — prevents the worker-version mismatch bug.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// Deliberately minimal: only pure pdf.js parameters, no cMapUrl /
// standardFontDataUrl asset options (those caused silent render failures
// when pointed at CDNs). These two are safe and are the core of the
// big-PDF speedup. Defined at module level so the `options` object
// identity never changes (a new object would remount the document).
const PDF_OPTIONS = {
  rangeChunkSize: 262144, // 256 KB range chunks
  disableAutoFetch: true, // fetch pages on demand — never buffer 170 MB
} as const;

export interface OutlineChapter {
  title: string;
  page: number;
}

// ═══════════════════════════════════════════════════════════════════════
// PDF ENGINE BOUNDARY — a crash in pdf.js / react-pdf must NEVER take the
// whole app down (the "Invariant failed" full-screen recovery overlay).
// Any render error inside the engine flips this document to the native
// viewer instead. Scoped so the outer app keeps running.
// ═══════════════════════════════════════════════════════════════════════
class PdfEngineBoundary extends Component<
  { onCrash: (error: Error) => void; resetKey: string; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("[PdfStage] PDF engine crashed — degrading this document's render path:", error);
    this.props.onCrash(error);
  }
  componentDidUpdate(prevProps: { resetKey: string }) {
    // RESET-on-change: the old boundary rendered `null` forever after any
    // crash — the blue blank page. When the document context genuinely
    // changes (new content, new chunk), recover automatically.
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

interface LoadProgress {
  loaded: number;
  total: number;
}

interface PdfStageProps {
  pdfUrl: string | null;
  /** Mirrors the ArrayBuffer up to Reader (exam mode needs it). The Reader
   * stores it in a REF — a state mirror here once re-created the `file`
   * object mid-flight and re-ran getDocument() on a buffer pdf.js had
   * already transferred (detached) into its worker, crashing with
   * "Cannot perform Construct on a detached ArrayBuffer" (blue blank page). */
  onPdfData: (data: ArrayBuffer) => void;
  pdfError: string | null;
  loadingPdf: boolean;
  pageNumber: number;
  numPages: number | null;
  scale: number;
  onPageChange: (page: number) => void;
  onNumPages: (n: number | null) => void;
  onScaleChange: (scale: number) => void;
  onDocProxy: (doc: unknown) => void;
  onOutline: (chapters: OutlineChapter[] | null) => void;
  /** Cosmetic watermark line shown over the canvas (pointer-events none). */
  watermark?: string | null;
  /** Content id — used to reset per-document caches. */
  contentId: string;
  /** Large-PDF chunk manifest — when present the stage fetches ONLY the
   * chunk containing the current page (IndexedDB-cached + pre-fetched). */
  chunkManifest?: PdfChunkManifest | null;
  /** Original file size — files at/above the split threshold get a
   * gentler fallback policy (never buffer a huge file into RAM). */
  fileSizeBytes?: number | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Background pre-fetch of the NEXT chunk (Priority 5). By the time the
 * student reaches the chunk boundary, the next pages are usually already
 * in IndexedDB — page-turns feel instant even in a 180MB textbook.
 * Cache-only priority: if it's already cached this is a no-op. Failures
 * are silently ignored (the real load path handles errors when needed).
 */
async function prefetchNextChunk(
  contentId: string,
  manifest: PdfChunkManifest,
  currentIndex: number,
): Promise<void> {
  const next = currentIndex + 1;
  if (next >= manifest.chunks.length) return;
  try {
    const cached = await getCachedChunk(contentId, next);
    if (cached) return;
    const res = await fetch(manifest.chunks[next].url);
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 4) await putCachedChunk(contentId, next, blob);
  } catch {
    // Silent — pre-fetch is best-effort.
  }
}

/** Rotating, reassuring loader lines — Step 3's calm progress UI. The old
 * byte counter ("169.9 MB of 171.8 MB") actively created dread even when
 * the real wait was short. */
const CALM_LOADING_MESSAGES = [
  "Preparing your textbook…",
  "Opening the pages…",
  "Almost there — thanks for waiting…",
  "Polishing the pages…",
];

export const PdfStage = memo(function PdfStage({
  pdfUrl,
  onPdfData,
  pdfError,
  loadingPdf,
  pageNumber,
  numPages,
  scale,
  onPageChange,
  onNumPages,
  onScaleChange,
  onDocProxy,
  onOutline,
  watermark,
  contentId,
  chunkManifest = null,
  fileSizeBytes = null,
}: PdfStageProps) {
  // ── Fallback chain state ────────────────────────────────────────────
  const [useIframeFallback, setUseIframeFallback] = useState(false);
  const [iframeZoom, setIframeZoom] = useState<string>("fit-width");
  const arrayBufferAttempted = useRef(false);
  const [localBufferLoading, setLocalBufferLoading] = useState(false);
  const [localBufferProgress, setLocalBufferProgress] = useState(0);
  // The ArrayBuffer fallback lives HERE (not mirrored from Reader):
  // pdf.js DETACHES every ArrayBuffer it receives — it is transferred into
  // the worker unconditionally (pdf.mjs GetDocRequest: `data ? [data.buffer]
  // : null`). Owning it locally guarantees each buffer is handed to pdf.js
  // exactly once, and that `file` identity only changes when a genuinely
  // NEW buffer arrives.
  const [bufferData, setBufferData] = useState<ArrayBuffer | null>(null);

  // ── Loading / render state ─────────────────────────────────────────
  const [docLoaded, setDocLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState<LoadProgress>({ loaded: 0, total: 0 });
  const lastActivityRef = useRef(0);
  const lastUiProgressRef = useRef(0);
  const [showTextLayers, setShowTextLayers] = useState(false);
  const textLayerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pageDirection, setPageDirection] = useState(1);
  const basePageWidthRef = useRef<number | null>(null);
  const autoFitDoneRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Stage-local doc proxy (mirrored up to Reader) ───────────────────
  const [docProxy, setDocProxy] = useState<any>(null);

  // ── CHUNKED MODE (large files) ─────────────────────────────────────
  // The stage fetches ONLY the chunk containing the current page. Chunks
  // are ~12MB, cached in IndexedDB, with the next chunk pre-fetched in
  // the background so page-turns across chunk boundaries stay smooth.
  const isChunked = Boolean(chunkManifest);
  const [chunkIndex, setChunkIndex] = useState(0); // which chunk buffer holds
  const [chunkBuffer, setChunkBuffer] = useState<ArrayBuffer | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState<string | null>(null);
  const chunkLoadRunRef = useRef(0); // stale-load guard
  // Bumped to force a clean engine remount (retry / crash recovery) — part
  // of the boundary resetKey so a crashed boundary actually recovers.
  const [engineNonce, setEngineNonce] = useState(0);

  /** Which manifest chunk contains this global page? */
  const chunkIndexForPage = useCallback(
    (page: number): number => {
      if (!chunkManifest) return -1;
      const idx = chunkManifest.chunks.findIndex(
        (c) => page >= c.startPage && page <= c.endPage,
      );
      return idx === -1 ? 0 : idx;
    },
    [chunkManifest],
  );

  const desiredChunkIndex = isChunked ? chunkIndexForPage(pageNumber) : -1;
  const activeChunk = isChunked && chunkManifest ? chunkManifest.chunks[chunkIndex] : null;
  /** Local (chunk-relative) page for the PdfPage element. */
  const localPage = activeChunk ? pageNumber - activeChunk.startPage + 1 : pageNumber;
  /** Page offset for thumbnails/search jump mapping. */
  const pageOffset = activeChunk ? activeChunk.startPage - 1 : 0;
  const chunkPageCount = activeChunk ? activeChunk.endPage - activeChunk.startPage + 1 : null;
  /** While a chunk-boundary crossing is loading, clamp to the last page of
   * the CURRENT chunk so the student never sees an out-of-range skeleton. */
  const renderPage = Math.min(localPage, chunkPageCount ?? localPage);

  // Chunk loader — cache-first, IndexedDB-backed, error-tolerant.
  // `chunkIndex` + `engineNonce` in deps: both are how a retry forces the
  // reload (the old retry button set chunkIndex(-1) but the effect never
  // re-ran — its deps didn't include it — so "Try again" did nothing).
  useEffect(() => {
    if (!isChunked || !chunkManifest || desiredChunkIndex < 0) return;
    if (chunkIndex === desiredChunkIndex && (chunkBuffer || chunkLoading)) return;
    const runId = ++chunkLoadRunRef.current;
    let cancelled = false;

    // The live docProxy belongs to the buffer we're about to replace, and
    // dies with the old Document. Drop it BEFORE the swap: the ±1 pre-render
    // pages call docProxy.getPage() synchronously — on a destroyed proxy that
    // throws "Cannot read properties of null (reading 'sendWithPromise')".
    // Steady-state re-runs early-return above, so this only fires on
    // genuine loads and retries.
    if (docProxy) {
      setDocProxy(null);
      onDocProxy(null);
      setDocLoaded(false);
    }

    void (async () => {
      setChunkLoading(true);
      setChunkError(null);
      const entry = chunkManifest.chunks[desiredChunkIndex];
      try {
        // 1. IndexedDB cache first — re-visits are instant.
        const cached = await getCachedChunk(contentId, desiredChunkIndex);
        if (cancelled || runId !== chunkLoadRunRef.current) return;
        if (cached) {
          // .slice(0) — MANDATORY: Blob.arrayBuffer() returns the SAME cached
          // backing buffer on every call, and pdf.js DETACHES whatever it
          // receives. Handing it the shared buffer would poison the cache
          // copy for the next mount (detached-ArrayBuffer crash).
          setChunkBuffer((await cached.arrayBuffer()).slice(0));
          setChunkIndex(desiredChunkIndex);
          setChunkLoading(false);
          void prefetchNextChunk(contentId, chunkManifest, desiredChunkIndex);
          return;
        }
        // 2. Network fetch.
        const res = await fetch(entry.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled || runId !== chunkLoadRunRef.current) return;
        if (blob.size < 4) throw new Error("Empty chunk");
        // 3. Store for future visits — never blocks the render path.
        void putCachedChunk(contentId, desiredChunkIndex, blob);
        setChunkBuffer(await blob.arrayBuffer());
        setChunkIndex(desiredChunkIndex);
        setChunkLoading(false);
        // 4. Background pre-fetch of the next chunk (Priority 5).
        void prefetchNextChunk(contentId, chunkManifest, desiredChunkIndex);
      } catch (err) {
        if (cancelled || runId !== chunkLoadRunRef.current) return;
        setChunkLoading(false);
        setChunkError(
          err instanceof Error
            ? `Couldn't load part ${desiredChunkIndex + 1} of this document. ${err.message}`
            : "Couldn't load part of this document.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChunked, desiredChunkIndex, chunkIndex, engineNonce, chunkManifest, contentId]);

  // Chunked mode reports the TRUE total page count immediately — no need
  // to wait for any document to parse.
  useEffect(() => {
    if (isChunked && chunkManifest) onNumPages(chunkManifest.totalPageCount);
  }, [isChunked, chunkManifest, onNumPages]);

  // Mirror the chunk buffer up to Reader (exam mode reads it from a ref —
  // NEVER from state: a state mirror re-renders this stage and could re-create
  // the `file` object on an already-transferred (detached) buffer).
  useEffect(() => {
    if (isChunked && chunkBuffer) onPdfData(chunkBuffer);
  }, [isChunked, chunkBuffer, onPdfData]);

  // ── Overlays ────────────────────────────────────────────────────────
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Any crash inside the pdf.js engine degrades the render path for THIS
  // document only — the app itself keeps running, and the error card sits
  // OUTSIDE the boundary so it stays visible. Chunked documents get a
  // retry card instead of the iframe (Chrome-Android has no built-in PDF
  // viewer, so an iframe there is a permanent blank page — the stuck-blank
  // "Native Viewer" bug reported on the 171.8MB textbook).
  //
  // BOUNDED AUTO-RECOVERY: the classic crash cause was pdf.js re-receiving
  // a buffer it had already transferred (detached). Reloading the current
  // chunk produces a provably fresh buffer, which heals the render path
  // without user action. If it crashes twice more, the retry card stays.
  const autoRetryRef = useRef(0);
  const handleEngineCrash = useCallback(() => {
    if (isChunked) {
      setChunkError("The document engine hit an unexpected error on this part.");
      if (autoRetryRef.current < 2) {
        autoRetryRef.current += 1;
        chunkLoadRunRef.current += 1;
        setChunkBuffer(null);
        setChunkIndex(-1);
        setEngineNonce((n) => n + 1);
      }
    } else {
      setUseIframeFallback(true);
    }
  }, [isChunked]);

  // Reset per-document state when the content changes.
  useEffect(() => {
    setUseIframeFallback(false);
    setIframeZoom("fit-width");
    arrayBufferAttempted.current = false;
    setDocLoaded(false);
    setLoadProgress({ loaded: 0, total: 0 });
    setDocProxy(null);
    setThumbsOpen(false);
    setSearchOpen(false);
    setChunkIndex(0);
    setChunkBuffer(null);
    setChunkLoading(false);
    setChunkError(null);
    setBufferData(null);
    autoRetryRef.current = 0;
    setEngineNonce(0);
    basePageWidthRef.current = null;
    autoFitDoneRef.current = false;
  }, [contentId]);

  // ── ArrayBuffer fallback (full download with progress) ──────────────
  const loadAsArrayBuffer = useCallback(
    async (url: string) => {
      setLocalBufferLoading(true);
      setLocalBufferProgress(0);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const contentLength = res.headers.get("content-length");
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No readable stream");
        const chunks: Uint8Array[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          setLocalBufferProgress(total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0);
        }
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        const combined = new Uint8Array(totalLen);
        let off = 0;
        for (const chunk of chunks) {
          combined.set(chunk, off);
          off += chunk.length;
        }
        if (combined[0] === 0x25 && combined[1] === 0x50 && combined[2] === 0x44 && combined[3] === 0x46) {
          setBufferData(combined.buffer as ArrayBuffer);
          onPdfData(combined.buffer as ArrayBuffer);
        } else {
          setUseIframeFallback(true);
        }
      } catch {
        setUseIframeFallback(true);
      } finally {
        setLocalBufferLoading(false);
      }
    },
    [onPdfData],
  );

  // ── Progress-aware watchdog ─────────────────────────────────────────
  // Falls back ONLY when no bytes have flowed for the window (or the
  // document never started loading). A slow-but-flowing stream keeps
  // rendering — huge files no longer bounce to the native viewer.
  //
  // Gating (the Native-Viewer blank-page fix):
  //   - CHUNKED files: no watchdog at all — the chunk fetch has its own
  //     error handling and retry. Never bounce a chunked document.
  //   - OVERSIZE non-chunked files (≥ split threshold, no manifest yet):
  //     never attempt the ArrayBuffer fallback (buffering 170MB into RAM
  //     on a phone is the exact disaster this whole pipeline fixes). If
  //     the stream genuinely stalls, degrade straight to the iframe.
  useEffect(() => {
    if (useIframeFallback || pdfError || docLoaded) return;
    if (!pdfUrl && !bufferData) return;
    if (localBufferLoading) return;
    if (isChunked) return; // chunked mode handles its own loading

    const isOversize = typeof fileSizeBytes === "number" && fileSizeBytes >= SPLIT_THRESHOLD_BYTES;
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
    const windowMs = isMobile ? 15000 : 9000;
    lastActivityRef.current = Date.now();

    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivityRef.current;
      if (idleFor < windowMs) return;
      if (
        !isOversize &&
        shouldTryArrayBuffer(pdfUrl, bufferData) &&
        pdfUrl &&
        !arrayBufferAttempted.current
      ) {
        arrayBufferAttempted.current = true;
        lastActivityRef.current = Date.now(); // keep watching during download
        void loadAsArrayBuffer(pdfUrl);
      } else {
        console.warn("[PdfStage] No progress for watchdog window — falling back to iframe.");
        setUseIframeFallback(true);
        clearInterval(interval);
      }
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, bufferData, useIframeFallback, pdfError, docLoaded, localBufferLoading, isChunked, fileSizeBytes]);

  function shouldTryArrayBuffer(url: string | null, data: ArrayBuffer | null): boolean {
    return Boolean(url) && !data;
  }

  // ── Deferred text layer: canvas first, text 120ms later ─────────────
  useEffect(() => {
    setShowTextLayers(false);
    clearTimeout(textLayerTimer.current);
    textLayerTimer.current = setTimeout(() => setShowTextLayers(true), 120);
    return () => clearTimeout(textLayerTimer.current);
  }, [pageNumber, scale]);

  // ── Stable file prop (never re-creates the document on re-render) ───
  // THE DETACHED-ARRAYBUFFER CONTRACT (this file's #1 invariant):
  //   pdf.js constructs a view over ANY ArrayBuffer it receives, then
  //   TRANSFERS it into its worker (GetDocRequest → `[data.buffer]`) — the
  //   main-thread copy dies on first use. react-pdf re-runs getDocument()
  //   whenever the `file` OBJECT identity changes. Therefore `file` may
  //   only be rebuilt from a PROVABLY fresh buffer (new chunkBuffer / new
  //   bufferData) — never re-wrapped from one pdf.js already consumed.
  //   `chunkIndex` is deliberately NOT a dep: the -1→0 retry transition
  //   would re-wrap a consumed buffer → "Cannot perform Construct on a
  //   detached ArrayBuffer" → permanent blank stage.
  const file = useMemo(() => {
    if (isChunked) {
      if (chunkBuffer) return { data: chunkBuffer };
      return null;
    }
    if (bufferData) return { data: bufferData };
    if (pdfUrl) return { url: pdfUrl };
    return null;
  }, [isChunked, chunkBuffer, bufferData, pdfUrl]);

  // ── Page navigation with direction for the flip animation ───────────
  const goToPage = useCallback(
    (next: number) => {
      const clamped = Math.max(1, Math.min(numPages ?? next, next));
      if (clamped === pageNumber) return;
      setPageDirection(clamped > pageNumber ? 1 : -1);
      onPageChange(clamped);
    },
    [numPages, onPageChange, pageNumber],
  );

  // ── Keyboard shortcuts (skips typing targets) ───────────────────────
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") goToPage(pageNumber - 1);
      else if (event.key === "ArrowRight") goToPage(pageNumber + 1);
      else if (event.key === "+" || event.key === "=")
        onScaleChange(Math.min(3, Math.round((scale + 0.15) * 100) / 100));
      else if (event.key === "-")
        onScaleChange(Math.max(0.25, Math.round((scale - 0.15) * 100) / 100));
      else if (event.key === "s" || event.key === "S") {
        setSearchOpen((v) => !v);
        setThumbsOpen(false);
      } else if (event.key === "t" || event.key === "T") {
        setThumbsOpen((v) => !v);
        setSearchOpen(false);
      } else if (event.key === "Escape") {
        setSearchOpen(false);
        setThumbsOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goToPage, pageNumber, scale, onScaleChange]);

  // ── Fit-width scale ─────────────────────────────────────────────────
  const fitToWidth = useCallback(() => {
    const base = basePageWidthRef.current;
    const container = stageRef.current;
    if (!base || !container) return;
    const available = container.clientWidth - 48; // stage padding
    const fit = Math.max(0.25, Math.min(3, Math.round((available / base) * 100) / 100));
    onScaleChange(fit);
  }, [onScaleChange]);

  // ── Outline → chapters (for the study context header) ──────────────
  useEffect(() => {
    if (!docProxy) return;
    let cancelled = false;
    (async () => {
      try {
        const outline = await docProxy.getOutline();
        if (!outline || outline.length === 0) {
          if (!cancelled) onOutline(null);
          return;
        }
        const chapters: OutlineChapter[] = [];
        for (const entry of outline.slice(0, 40)) {
          if (!entry?.title) continue;
          try {
            let dest = entry.dest;
            if (typeof dest === "string") dest = await docProxy.getDestination(dest);
            if (!Array.isArray(dest) || dest.length === 0) continue;
            const pageIndex = await docProxy.getPageIndex(dest[0]);
            chapters.push({ title: entry.title.trim(), page: pageIndex + 1 });
          } catch {
            continue;
          }
        }
        if (!cancelled) onOutline(chapters.length > 0 ? chapters : null);
      } catch {
        if (!cancelled) onOutline(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docProxy, onOutline]);

  const busyBuffer = loadingPdf || localBufferLoading || (isChunked && chunkLoading);
  const showProgressSplash =
    busyBuffer || (!docLoaded && !useIframeFallback && !pdfError && !chunkError && Boolean(file));

  // ════════════════════════════════════════════════════════════════════
  return (
    <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden" id="pdf-scroll-area">
      {/* Ambient canvas dressing */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(56,189,248,0.04),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_100%,rgba(168,85,247,0.03),transparent_50%)]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "radial-gradient(circle, white 0.5px, transparent 0.5px)", backgroundSize: "24px 24px" }}
      />

      {/* ═══ IFRAME MODE — last-resort native viewer ═══ */}
      {useIframeFallback && pdfUrl && !pdfError ? (
        <div className="flex h-full flex-col">
          <div className="relative z-10 flex shrink-0 items-center justify-center gap-1.5 border-b border-foreground/[0.04] bg-background/70 dark:bg-black/30 px-3 py-2 backdrop-blur-xl">
            <span className="type-caption mr-2 text-[10px] uppercase tracking-widest text-muted-foreground/50">Native viewer</span>
            {(
              [
                { id: "fit-width", label: "Fit Width", icon: Scan },
                { id: "fit-page", label: "Fit Page", icon: Maximize2 },
                { id: "100", label: "100%", icon: null },
                { id: "150", label: "150%", icon: null },
                { id: "200", label: "200%", icon: null },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setIframeZoom(preset.id)}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-all duration-150 active:scale-95",
                  iframeZoom === preset.id
                    ? "border-primary/25 bg-primary/15 text-primary"
                    : "border-transparent text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground",
                )}
              >
                {preset.icon && <preset.icon className="size-3" />}
                {preset.label}
              </button>
            ))}
          </div>
          <iframe
            key={`${pdfUrl}#${iframeZoom}`}
            src={`${pdfUrl}#${iframeZoom === "fit-width" ? "view=FitW&toolbar=0&navpanes=0" : iframeZoom === "fit-page" ? "view=FitH&toolbar=0&navpanes=0" : `zoom=${iframeZoom}&toolbar=0&navpanes=0`}`}
            title="PDF document"
            className="w-full flex-1 border-0 bg-foreground/5"
            style={{ minHeight: 0 }}
          />
        </div>
      ) : (
        /* ═══ SMART READER MODE ═══
           Loaders + error cards live OUTSIDE the engine boundary: when the
           engine crashes, the boundary renders null — and the student must
           STILL see the retry card. The old layout put them INSIDE, so a
           crash hid every message and left the permanent blue blank page. */
        <>
          {/* Thumbnails rail (lazy) — chunked mode shows the CURRENT chunk
              with true global page numbers (pageOffset) */}
          <AnimatePresence>
            {thumbsOpen && docProxy && numPages && (
              <ThumbnailsRail
                doc={docProxy}
                numPages={chunkPageCount ?? numPages}
                pageOffset={pageOffset}
                pageNumber={pageNumber}
                onJump={goToPage}
                onClose={() => setThumbsOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* In-document search — chunked mode scans the current chunk; the
              next chunk is usually pre-fetched by the time the student
              reaches it, and search re-runs per chunk. */}
          <AnimatePresence>
            {searchOpen && docProxy && numPages && (
              <SearchOverlay
                doc={docProxy}
                numPages={chunkPageCount ?? numPages}
                pageOffset={pageOffset}
                onJump={goToPage}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Scrollable stage — centered page with soft shadow */}
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" data-lenis-prevent-wheel>
            <div className="mx-auto flex min-h-full w-fit flex-col items-center px-4 py-6 sm:px-10">
              {/* Loading splash — CALM (Step 3). No byte counters: a raw
                  MB counter against a 170MB total creates dread even when
                  the wait is short. First 3s are silent; past that we show
                  a rotating reassurance + elapsed seconds. */}
              {showProgressSplash && <CalmLoader chunked={isChunked} />}

              {/* Error state — cinematic + real error */}
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
                  <div className="max-w-md text-center">
                    <h2
                      className={cn(
                        "type-h2 bg-clip-text text-transparent",
                        pdfError === "premium_required" ? "from-amber-300 to-amber-400/70" : "from-rose-300 to-rose-400/70",
                      )}
                    >
                      {pdfError === "premium_required" ? "Premium Content" : "Could not open this document"}
                    </h2>
                    <p className="type-body mt-2 leading-relaxed text-muted-foreground/70">
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                        onClick={() => window.location.reload()}
                      >
                        <RotateCcw className="size-3.5" /> Refresh
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Chunk-load error — calm retry card. Chunked documents NEVER
                  fall back to the iframe: on Chrome-Android that's a
                  permanent blank page, and buffering a huge file into RAM
                  is the disaster this mode exists to prevent. */}
              {chunkError && !pdfError && (
                <div className="mx-auto mt-20 flex flex-col items-center gap-6">
                  <div className="relative">
                    <div className="absolute -inset-8 rounded-full bg-amber-500/10 blur-2xl" />
                    <div className="relative flex size-20 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] backdrop-blur-xl">
                      <Lock className="size-8 text-amber-400/80" />
                    </div>
                  </div>
                  <div className="max-w-md text-center">
                    <h2 className="type-h2 bg-gradient-to-r from-amber-200 to-amber-400/70 bg-clip-text text-transparent">
                      Having trouble turning the pages
                    </h2>
                    <p className="type-body mt-2 leading-relaxed text-muted-foreground/70">{chunkError}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                    onClick={() => {
                      // Force a clean re-load of the current chunk with a
                      // provably FRESH buffer + an engine remount.
                      chunkLoadRunRef.current += 1;
                      setChunkBuffer(null);
                      setChunkIndex(-1);
                      setChunkError(null);
                      setEngineNonce((n) => n + 1);
                    }}
                  >
                    <RotateCcw className="size-3.5" /> Try again
                  </Button>
                </div>
              )}

              {/* Document + page — the engine boundary wraps ONLY this
                  subtree, with a resetKey: any crash degrades to null and
                  the boundary RECOVERS when the chunk/content changes or
                  the student taps retry. NO key on the page wrapper — the
                  Document mounts ONCE per chunk and stays mounted across
                  page flips (remounting it re-ran getDocument() on a buffer
                  pdf.js had already transferred/detached into its worker →
                  "Cannot perform Construct on a detached ArrayBuffer" → the
                  permanent blank stage). Only the page-animator inside is
                  keyed by pageNumber. */}
              {file && !pdfError && !chunkError && (
                <PdfEngineBoundary
                  onCrash={handleEngineCrash}
                  resetKey={`${contentId}:${isChunked ? `chunk-${chunkIndex}` : "doc"}:${engineNonce}`}
                >
                  <div className="relative">
                    <Document
                      key={isChunked ? `chunk-${chunkIndex}` : "doc"}
                      file={file}
                      options={PDF_OPTIONS}
                      onLoadProgress={(progress) => {
                        try {
                          if (!progress) return;
                          // Any byte flow proves the stream is alive — feed the watchdog.
                          lastActivityRef.current = Date.now();
                          const now = Date.now();
                          if (now - lastUiProgressRef.current < 250) return; // throttle re-renders
                          lastUiProgressRef.current = now;
                          setLoadProgress({
                            loaded: typeof progress.loaded === "number" ? progress.loaded : 0,
                            total: typeof progress.total === "number" ? progress.total : 0,
                          });
                        } catch {
                          // Non-fatal: progress callback errors must never break the render.
                        }
                      }}
                      onLoadSuccess={(pdf) => {
                        lastActivityRef.current = Date.now();
                        // Chunked mode: the loaded "document" is one chunk —
                        // report the TRUE total page count from the manifest.
                        onNumPages(isChunked && chunkManifest ? chunkManifest.totalPageCount : pdf.numPages);
                        setDocProxy(pdf);
                        onDocProxy(pdf);
                        setDocLoaded(true);
                        setLoadProgress({ loaded: 0, total: 0 });
                      }}
                      onLoadError={(error) => {
                        console.error("[PdfStage] PDF load failed:", error);
                        const msg = error?.message || String(error);
                        if (isChunked) {
                          setChunkError(`The document engine couldn't open this part. ${msg}`);
                        } else if (msg.includes("worker") || msg.includes("Worker")) {
                          setUseIframeFallback(true);
                        } else if (
                          pdfUrl &&
                          !bufferData &&
                          !arrayBufferAttempted.current &&
                          !(typeof fileSizeBytes === "number" && fileSizeBytes >= SPLIT_THRESHOLD_BYTES)
                        ) {
                          // Small files only — never buffer an oversized file into RAM.
                          arrayBufferAttempted.current = true;
                          void loadAsArrayBuffer(pdfUrl);
                        } else {
                          setUseIframeFallback(true);
                        }
                      }}
                      loading={null}
                      className="flex flex-col items-center"
                    >
                      <motion.div
                        key={pageNumber}
                        initial={{ opacity: 0, x: pageDirection * 24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        className="relative"
                      >
                        <div className="group relative overflow-hidden rounded-lg shadow-[0_25px_80px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06)] transition-shadow duration-300 hover:shadow-[0_30px_100px_-20px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.1)]">
                          <PdfPage
                            pageNumber={renderPage}
                            scale={scale}
                            renderTextLayer={showTextLayers}
                            renderAnnotationLayer={showTextLayers}
                            onLoadSuccess={(page) => {
                              try {
                                const viewport = page.getViewport({ scale: 1 });
                                basePageWidthRef.current = viewport.width;
                                // Phones: auto-fit the FIRST page to the viewport
                                // width — a 100% textbook page (often 700-1100px
                                // wide) otherwise overflows a 390px screen. Floor
                                // is 0.25 because large-format PDFs need <0.5.
                                if (!autoFitDoneRef.current) {
                                  autoFitDoneRef.current = true;
                                  const container = stageRef.current;
                                  if (container && window.matchMedia("(max-width: 640px)").matches) {
                                    const available = container.clientWidth - 20;
                                    const fit = Math.max(0.25, Math.min(1, Math.round((available / viewport.width) * 100) / 100));
                                    if (fit < scale) onScaleChange(fit);
                                  }
                                }
                              } catch {
                                // Non-fatal — fit-to-width just stays unavailable.
                              }
                            }}
                            loading={
                              <div className="relative aspect-[1/1.414] w-[min(64vw,28rem)] max-w-full overflow-hidden rounded-md border border-foreground/[0.06] bg-foreground/[0.02] shadow-[0_25px_80px_-20px_rgba(0,0,0,0.9)]">
                                <div className="absolute inset-0 flex flex-col gap-3 p-6">
                                  <div className="h-3 w-1/2 animate-pulse rounded bg-foreground/[0.06]" />
                                  <div className="mt-2 h-2 w-full animate-pulse rounded bg-foreground/[0.04]" style={{ animationDelay: "60ms" }} />
                                  <div className="h-2 w-5/6 animate-pulse rounded bg-foreground/[0.04]" style={{ animationDelay: "120ms" }} />
                                  <div className="h-2 w-full animate-pulse rounded bg-foreground/[0.04]" style={{ animationDelay: "180ms" }} />
                                  <div className="h-2 w-3/4 animate-pulse rounded bg-foreground/[0.04]" style={{ animationDelay: "240ms" }} />
                                </div>
                                <div className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer-slide_1.6s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-foreground/[0.04] to-transparent" />
                              </div>
                            }
                          />
                        </div>

                        {/* Page number chip under the page */}
                        {numPages && (
                          <p className="type-mono mt-3 text-center text-[10px] tabular-nums text-muted-foreground/30">
                            PAGE {pageNumber} · {numPages}
                          </p>
                        )}
                      </motion.div>
                    </Document>
                  </div>

                  {/* Hidden ±1 pre-render for instant page flips. NOTE: these
                      render OUTSIDE <Document>, so the explicit `pdf` prop is
                      MANDATORY — without it react-pdf's Page invariant throws
                      "Invariant failed" and killed the whole app (the crash the
                      production app hit on every document open).
                      Chunked mode: neighbour pages are clamped to the CURRENT
                      chunk — crossing a boundary is the chunk loader's job. */}
                  {numPages && docProxy && docLoaded && (
                    <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">
                      {localPage > 1 && (
                        <PdfPage pdf={docProxy} pageNumber={localPage - 1} scale={scale} renderTextLayer={false} renderAnnotationLayer={false} />
                      )}
                      {localPage < (chunkPageCount ?? localPage + 1) && (
                        <PdfPage pdf={docProxy} pageNumber={localPage + 1} scale={scale} renderTextLayer={false} renderAnnotationLayer={false} />
                      )}
                    </div>
                  )}
                </PdfEngineBoundary>
              )}
            </div>
          </div>

          {/* ═══ FLOATING READER CONTROLS — above the iOS safe area ═══ */}
          {docProxy && !pdfError && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(0.9rem,env(safe-area-inset-bottom))] z-30 flex justify-center px-3">
              <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl border border-foreground/10 bg-background/85 dark:bg-black/75 px-1.5 py-1 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
                <button
                  type="button"
                  onClick={() => onScaleChange(Math.max(0.25, Math.round((scale - 0.15) * 100) / 100))}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground active:scale-90 sm:size-8"
                  aria-label="Zoom out"
                >
                  <ZoomOut className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={fitToWidth}
                  title="Fit width"
                  className="type-mono w-11 text-center text-xs tabular-nums text-muted-foreground/80 transition-colors hover:text-primary"
                >
                  {Math.round(scale * 100)}%
                </button>
                <button
                  type="button"
                  onClick={() => onScaleChange(Math.min(3, Math.round((scale + 0.15) * 100) / 100))}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground active:scale-90 sm:size-8"
                  aria-label="Zoom in"
                >
                  <ZoomIn className="size-3.5" />
                </button>

                <div className="mx-0.5 h-5 w-px bg-foreground/10" />

                <button
                  type="button"
                  onClick={() => goToPage(pageNumber - 1)}
                  disabled={pageNumber <= 1}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground disabled:opacity-20 active:scale-90 sm:size-8"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <label htmlFor="stage-page-number" className="sr-only">Page number</label>
                <PageInput
                  pageNumber={pageNumber}
                  numPages={numPages}
                  onSubmit={goToPage}
                />
                <button
                  type="button"
                  onClick={() => goToPage(pageNumber + 1)}
                  disabled={numPages !== null && pageNumber >= numPages}
                  className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-foreground/10 hover:text-foreground disabled:opacity-20 active:scale-90 sm:size-8"
                  aria-label="Next page"
                >
                  <ChevronRight className="size-4" />
                </button>

                <div className="mx-0.5 h-5 w-px bg-foreground/10" />

                <button
                  type="button"
                  onClick={() => { setSearchOpen((v) => !v); setThumbsOpen(false); }}
                  className={cn(
                    "flex size-9 cursor-pointer items-center justify-center rounded-lg transition-all hover:bg-foreground/10 hover:text-foreground active:scale-90 sm:size-8",
                    searchOpen ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-label="Search in document"
                  title="Search in document (s)"
                >
                  <Search className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => { setThumbsOpen((v) => !v); setSearchOpen(false); }}
                  className={cn(
                    "flex size-9 cursor-pointer items-center justify-center rounded-lg transition-all hover:bg-foreground/10 hover:text-foreground active:scale-90 sm:size-8",
                    thumbsOpen ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-label="Page thumbnails"
                  title="Page thumbnails (t)"
                >
                  <Layers className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Watermark overlay — cosmetic deterrent, covers BOTH render modes */}
      {watermark && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center" aria-hidden="true" style={{ userSelect: "none" }}>
          <div
            className="type-mono rotate-[-28deg] whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-black/[0.08]"
            style={{ userSelect: "none" }}
          >
            {watermark}
          </div>
        </div>
      )}
    </div>
  );
});

/** Page "12 / 184" indicator — click to type a page number. */
function PageInput({
  pageNumber,
  numPages,
  onSubmit,
}: {
  pageNumber: number;
  numPages: number | null;
  onSubmit: (page: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(String(pageNumber));
          setEditing(true);
        }}
        className="type-mono h-8 min-w-[64px] cursor-text rounded-lg px-1 text-center text-xs tabular-nums text-foreground/90 transition-colors hover:text-primary"
        title="Jump to page"
      >
        {pageNumber} / {numPages ?? "—"}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      type="number"
      min={1}
      max={numPages ?? undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const parsed = Number.parseInt(draft, 10);
        if (Number.isFinite(parsed)) onSubmit(parsed);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          const parsed = Number.parseInt(draft, 10);
          if (Number.isFinite(parsed)) onSubmit(parsed);
          setEditing(false);
          e.currentTarget.blur();
        }
        if (e.key === "Escape") setEditing(false);
      }}
      className="type-mono h-8 w-14 rounded-lg border-foreground/[0.08] bg-transparent px-1 text-center text-xs tabular-nums shadow-none focus-visible:ring-0"
    />
  );
}

// ═══════════════════════════════════════════════════════════════════
// CalmLoader — the Step 3 progress experience.
// "169.9 MB of 171.8 MB" was technically honest and emotionally terrible.
// This replaces byte counts with: a quiet first 3 seconds, then rotating
// reassurance + elapsed time + an indeterminate shimmer. Done well, a
// short wait feels intentional instead of broken.
// ═══════════════════════════════════════════════════════════════════

function CalmLoader({ chunked }: { chunked: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const slow = elapsed >= 3;
  const message = CALM_LOADING_MESSAGES[Math.floor(elapsed / 2.5) % CALM_LOADING_MESSAGES.length];

  return (
    <div className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-6">
      <div className="relative">
        <div className="absolute -inset-8 animate-pulse rounded-full bg-primary/5 blur-2xl" />
        <div className="absolute -inset-4 animate-spin rounded-full border border-primary/10" style={{ animationDuration: "4s" }} />
        <div className="relative flex size-16 items-center justify-center rounded-2xl border border-foreground/10 bg-foreground/[0.03] backdrop-blur-xl">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </div>
      <div className="w-64 text-center">
        <p className="type-mono text-sm uppercase tracking-widest text-muted-foreground/80">
          {chunked ? "Opening your textbook" : "Preparing your document"}
        </p>
        {slow ? (
          <p className="type-mono mt-2 h-4 text-[10px] text-muted-foreground/40 transition-opacity">
            {message} · {elapsed}s
          </p>
        ) : (
          <p className="type-mono mt-2 h-4 text-[10px] text-muted-foreground/20">just a moment</p>
        )}
        <div className="mx-auto mt-3 h-0.5 w-32 overflow-hidden rounded-full bg-foreground/[0.06]">
          <div className="h-full w-1/3 animate-[shimmer-slide_1.5s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Thumbnails rail — lazy-rendered page previews.
// IntersectionObserver decides what *may* render; a 3-slot concurrency
// gate decides what renders *now*. Rendered thumbs stay mounted (memory
// at 80px width is trivial) so re-visiting is instant.
// CHUNKED MODE: `numPages` is the CURRENT CHUNK's page count and
// `pageOffset` shifts numbering so labels show true global pages.
// ═══════════════════════════════════════════════════════════════════════

function ThumbnailsRail({
  doc,
  numPages,
  pageOffset,
  pageNumber,
  onJump,
  onClose,
}: {
  doc: any;
  numPages: number;
  pageOffset: number;
  pageNumber: number;
  onJump: (page: number) => void;
  onClose: () => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const cellsRef = useRef<Map<number, HTMLElement>>(new Map());
  const [visible, setVisible] = useState<Set<number>>(() => new Set());
  const [rendered, setRendered] = useState<Set<number>>(() => new Set());
  const renderingRef = useRef<Set<number>>(new Set());
  const [activeRenders, setActiveRenders] = useState<number[]>([]);

  // Observe cells while open.
  useEffect(() => {
    const root = railRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          let changed = false;
          const next = new Set(prev);
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const page = Number((entry.target as HTMLElement).dataset.page);
            if (!next.has(page)) {
              next.add(page);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      { root, rootMargin: "400px 0px" },
    );
    cellsRef.current.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [numPages]);

  // Concurrency-gated render scheduler (max 3 simultaneous thumbs).
  useEffect(() => {
    const pending = [...visible]
      .filter((p) => !rendered.has(p) && !renderingRef.current.has(p))
      .sort((a, b) => Math.abs(a - pageNumber) - Math.abs(b - pageNumber));
    let slots = Math.max(0, 3 - renderingRef.current.size);
    const next: number[] = [];
    for (const p of pending) {
      if (slots <= 0) break;
      renderingRef.current.add(p);
      next.push(p);
      slots -= 1;
    }
    if (next.length > 0) setActiveRenders((r) => [...r, ...next]);
  }, [visible, rendered, pageNumber]);

  const markRendered = useCallback((page: number) => {
    renderingRef.current.delete(page);
    setActiveRenders((r) => r.filter((x) => x !== page));
    setRendered((prev) => new Set(prev).add(page));
  }, []);

  // Auto-scroll to the current page thumb.
  useEffect(() => {
    const el = cellsRef.current.get(pageNumber);
    el?.scrollIntoView({ block: "nearest" });
  }, [pageNumber]);

  const pages = useMemo(
    () => Array.from({ length: numPages }, (_, i) => i + 1 + pageOffset),
    [numPages, pageOffset],
  );

  return (
    <motion.aside
      initial={{ x: "-100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="absolute bottom-20 left-3 top-3 z-30 flex w-[104px] flex-col rounded-2xl border border-foreground/10 bg-background/85 dark:bg-black/70 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
      aria-label="Page thumbnails"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-foreground/[0.06] px-3 py-2">
        <p className="type-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">Pages</p>
        <button
          type="button"
          onClick={onClose}
          className="flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground"
          aria-label="Close thumbnails"
        >
          <X className="size-3" />
        </button>
      </div>
      <div ref={railRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 scrollbar-none" data-lenis-prevent-wheel>
        {pages.map((page) => {
          const isActive = page === pageNumber;
          const shouldRender = activeRenders.includes(page) || rendered.has(page);
          return (
            <button
              key={page}
              type="button"
              data-page={page}
              ref={(el) => {
                if (el) cellsRef.current.set(page, el);
                else cellsRef.current.delete(page);
              }}
              onClick={() => onJump(page)}
              className={cn(
                "group relative block w-full cursor-pointer overflow-hidden rounded-lg border transition-all duration-200",
                isActive
                  ? "border-primary/60 ring-1 ring-primary/40"
                  : "border-foreground/[0.06] hover:border-foreground/25",
              )}
              title={`Page ${page}`}
            >
              {shouldRender ? (
                <PdfPage
                  pdf={doc}
                  pageNumber={page - pageOffset}
                  width={80}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  onLoadSuccess={() => markRendered(page)}
                  loading={<div className="aspect-[1/1.414] w-full bg-foreground/[0.03]" />}
                />
              ) : (
                <div className="flex aspect-[1/1.414] w-full items-center justify-center bg-foreground/[0.02]">
                  <span className="type-mono text-[9px] tabular-nums text-muted-foreground/30">{page}</span>
                </div>
              )}
              <span
                className={cn(
                  "type-mono absolute inset-x-0 bottom-0 py-0.5 text-center text-[8px] tabular-nums backdrop-blur-sm",
                  isActive ? "bg-primary/25 text-primary" : "bg-background/80 dark:bg-black/40 text-muted-foreground/60",
                )}
              >
                {page}
              </span>
            </button>
          );
        })}
      </div>
    </motion.aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Search overlay — full-document text search.
// Text extraction runs incrementally in the pdf.js worker, is cached per
// session, and yields to the UI thread so scrolling stays smooth even on
// a 184-page book. Zero AI calls — pure client-side.
// ═══════════════════════════════════════════════════════════════════════

interface SearchHit {
  page: number;
  snippet: string;
}

function SearchOverlay({
  doc,
  numPages,
  pageOffset,
  onJump,
  onClose,
}: {
  doc: any;
  numPages: number;
  pageOffset: number;
  onJump: (page: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [scanned, setScanned] = useState(0);
  const [scanning, setScanning] = useState(false);
  const textsRef = useRef<Map<number, string>>(new Map());
  const runIdRef = useRef(0);

  // Reset cache when the document changes.
  useEffect(() => {
    textsRef.current = new Map();
    setHits([]);
    setScanned(0);
  }, [doc]);

  // Debounce the query.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Incremental scan.
  useEffect(() => {
    if (!doc || debounced.length < 2) {
      runIdRef.current += 1;
      setHits([]);
      setScanned(0);
      setScanning(false);
      return;
    }
    const runId = ++runIdRef.current;
    const q = debounced.toLowerCase();
    setScanning(true);
    setHits([]);
    setScanned(0);

    void (async () => {
      const found: SearchHit[] = [];
      for (let p = 1; p <= numPages; p++) {
        if (runId !== runIdRef.current) return;
        const cached: string | undefined = textsRef.current.get(p);
        let text: string;
        if (cached !== undefined) {
          text = cached;
        } else {
          try {
            const page = await doc.getPage(p);
            const content = await page.getTextContent();
            const extracted: string = content.items
              .map((it: { str?: string }) => it.str || "")
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            text = extracted;
          } catch {
            text = "";
          }
          textsRef.current.set(p, text);
          await new Promise((r) => setTimeout(r, 0)); // yield — keep the UI at 60fps
          if (runId !== runIdRef.current) return;
        }
        const idx = text.toLowerCase().indexOf(q);
        if (idx !== -1) {
          const start = Math.max(0, idx - 46);
          const end = Math.min(text.length, idx + q.length + 64);
          found.push({
            page: p + pageOffset,
            snippet: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
          });
          if (found.length >= 60) break;
        }
        if (p % 4 === 0 || p === numPages) {
          setHits([...found]);
          setScanned(p);
          await new Promise((r) => setTimeout(r, 0));
          if (runId !== runIdRef.current) return;
        }
      }
      if (runId !== runIdRef.current) return;
      setHits([...found]);
      setScanning(false);
    })();

    return () => {
      runIdRef.current += 1;
    };
  }, [debounced, doc, numPages]);

  return (
    <motion.aside
      initial={{ x: "-100%", opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: "-100%", opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 38 }}
      className="absolute bottom-20 left-3 top-3 z-30 flex w-[300px] max-w-[80vw] flex-col rounded-2xl border border-foreground/10 bg-background/85 dark:bg-black/70 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8)] backdrop-blur-2xl sm:w-[320px]"
      aria-label="Search in document"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-foreground/[0.06] px-3 py-2.5">
        <Search className="size-3.5 shrink-0 text-primary/80" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search in this document…"
          className="h-7 flex-1 rounded-lg border-0 bg-transparent px-1 text-[13px] shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
        />
        <button
          type="button"
          onClick={onClose}
          className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-foreground/10 hover:text-foreground"
          aria-label="Close search"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-none" data-lenis-prevent-wheel>
        {debounced.length < 2 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Search className="size-6 text-muted-foreground/20" />
            <p className="type-caption text-muted-foreground/40">
              Type at least 2 characters. Search runs inside the PDF — nothing is uploaded.
            </p>
          </div>
        ) : scanning || (scanned > 0 && scanned < numPages) ? (
          <p className="type-mono px-3 py-2 text-[10px] tabular-nums text-muted-foreground/40">
            Scanned {scanned}/{numPages} pages · {hits.length} match{hits.length === 1 ? "" : "es"}…
          </p>
        ) : (
          hits.length > 0 && (
            <p className="type-mono px-3 py-2 text-[10px] tabular-nums text-muted-foreground/40">
              {hits.length} match{hits.length === 1 ? "" : "es"} across {numPages} pages
            </p>
          )
        )}

        {!scanning && hits.length === 0 && debounced.length >= 2 && scanned >= numPages && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="type-caption text-muted-foreground/40">No matches found.</p>
            <p className="type-caption text-[10px] text-muted-foreground/25">
              Scanned PDFs without a text layer can't be searched.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          {hits.map((hit, i) => (
            <button
              key={`${hit.page}-${i}`}
              type="button"
              onClick={() => onJump(hit.page)}
              className="group block w-full cursor-pointer rounded-xl border border-foreground/[0.05] bg-foreground/[0.015] px-3 py-2 text-left transition-all hover:border-primary/25 hover:bg-foreground/[0.04]"
            >
              <span className="type-mono mb-1 inline-block rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-primary">
                Page {hit.page}
              </span>
              <p className="line-clamp-2 text-[11.5px] leading-[1.6] text-foreground/70 group-hover:text-foreground/90">
                <Mark text={hit.snippet} query={debounced} />
              </p>
            </button>
          ))}
        </div>
      </div>
    </motion.aside>
  );
}

/** Highlights the first (case-insensitive) occurrence of query in text. */
function Mark({ text, query }: { text: string; query: string }) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-primary/25 px-0.5 text-primary-foreground">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}
