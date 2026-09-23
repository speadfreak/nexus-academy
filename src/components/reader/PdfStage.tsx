// Smart Reader PDF stage — the performance-critical heart of the reader.
//
// Split out of Reader.tsx so the AI panel / study dock / chat can never
// re-render the canvas tree (this component is React.memo'd — chat
// keystrokes don't touch the document).
//
// PERFORMANCE MODEL — FULL LOADING (the user's explicit, final decision):
//   "Change the system to full loading — not part-by-part."
//   Every document is loaded COMPLETELY, exactly once, then owned forever:
//
//   1. DEVICE CACHE FIRST — the whole file lives in IndexedDB after the
//      first load. Re-opening any textbook is instant: 0 network bytes,
//      0 waiting, works offline.
//   2. PARALLEL SEGMENTED DOWNLOAD — a cold download fetches the ENTIRE
//      file as up to 16 concurrent HTTP range segments (see fullLoader.ts)
//      and streams them into one preallocated buffer. A 171.8MB textbook
//      arrives in a fraction of the sequential-stream time.
//   3. ONE pdf.js PARSE — the complete document is handed to pdf.js exactly
//      once (fresh buffer, detached-ArrayBuffer contract below). Every page
//      flip, thumbnail, search and jump afterwards is pure memory work.
//   4. CALM FULL-LOAD UI — one honest percentage on a slim bar. No byte
//      counters, no per-part messages.
//
//   5. Single-page rendering with pre-rendered ±1 neighbours → instant
//      page flips, bounded memory.
//   6. Thumbnails render lazily via IntersectionObserver with a small
//      concurrency gate — a 184-page book never renders 184 canvases.
//   7. Search extracts page text incrementally (cached per session) and
//      yields to the UI thread, so searching never janks the reader.
//
// THE DETACHED-ARRAYBUFFER CONTRACT (this file's #1 invariant):
//   pdf.js CONSTRUCTS a view over any ArrayBuffer it receives, then
//   TRANSFERS it into its worker (GetDocRequest → `[data.buffer]`) — the
//   main-thread copy dies on first use. Therefore `fullBuffer` is handed
//   to pdf.js EXACTLY ONCE per load run, and every reload/retry derives a
//   PROVABLY fresh buffer (Blob.arrayBuffer() returns a new copy per call
//   by spec). The Blob (never the ArrayBuffer) is mirrored up to Reader,
//   so exam mode can always mint its own fresh buffer.

import { AnimatePresence, motion } from "framer-motion";
import { Component, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Document, Page as PdfPage, pdfjs } from "react-pdf";
// MANDATORY react-pdf styles — without TextLayer.css the selection text
// layer renders as VISIBLE ghost text below the canvas and text selection
// (the "Ask Learnyx AI" popup) is completely broken.
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { downloadEntirePdf } from "@/lib/fullLoader";
import { getCachedFile, putCachedFile } from "@/lib/pdfFullCache";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Crown,
  Layers,
  Lock,
  RotateCcw,
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

// Deliberately minimal: only pure pdf.js parameters. Defined at module level
// so the `options` object identity never changes (a new object would remount
// the document). Range/stream options are irrelevant here — the full-loading
// engine hands pdf.js a COMPLETE in-memory document, which is why every
// page flip, thumbnail and search is instant with zero further fetching.
const PDF_OPTIONS = {};

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

interface PdfStageProps {
  pdfUrl: string | null;
  /** Mirrors the COMPLETE file up to Reader as a BLOB (exam mode mints its
   * own fresh ArrayBuffer from it — see the detached-ArrayBuffer contract
   * in the header). The Reader stores it in a REF — never state. */
  onPdfData: (data: Blob) => void;
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
  /** True file size (content metadata) — lets the full-loader plan its
   * parallel segments without a HEAD probe, and validates cache entries. */
  fileSizeBytes?: number | null;
}

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
  fileSizeBytes = null,
}: PdfStageProps) {
  // ── FULL LOADING state (the entire document, one way or the other) ──
  // fullBuffer: the COMPLETE document as one ArrayBuffer. It is produced
  // fresh per load run (cache decode or segmented download) and handed to
  // pdf.js EXACTLY ONCE — pdf.js transfers it into the worker (detaching
  // it), so it is never reused, re-wrapped or mirrored as a buffer.
  const [fullBuffer, setFullBuffer] = useState<ArrayBuffer | null>(null);
  const [loadPhase, setLoadPhase] = useState<"idle" | "checking" | "downloading" | "opening" | "ready" | "error">("idle");
  const [loadPercent, setLoadPercent] = useState(0);
  const [loadFromCache, setLoadFromCache] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The complete file as an immutable Blob — mirrored up to Reader (exam
  // mode) and written to the device cache. Blobs are safe to keep forever;
  // ArrayBuffers are not (pdf.js detaches what it receives).
  const fullBlobRef = useRef<Blob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadRunRef = useRef(0);
  const lastProgressAtRef = useRef(0);
  // Bumped to force a clean engine remount (retry / crash recovery) — part
  // of the boundary resetKey so a crashed boundary actually recovers.
  const [engineNonce, setEngineNonce] = useState(0);

  // ── Loading / render state ─────────────────────────────────────────
  const [docLoaded, setDocLoaded] = useState(false);
  const [showTextLayers, setShowTextLayers] = useState(false);
  const textLayerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pageDirection, setPageDirection] = useState(1);
  const basePageWidthRef = useRef<number | null>(null);
  const autoFitDoneRef = useRef(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Stage-local doc proxy (mirrored up to Reader) ───────────────────
  const [docProxy, setDocProxy] = useState<any>(null);

  /** While the engine is opening the document, clamp the rendered page so
   * the student never sees an out-of-range skeleton. */
  const renderPage = pageNumber;

  // ═══════════════════════════════════════════════════════════════════
  // THE FULL-LOADING ENGINE — cache-first, parallel-download, one parse.
  //   1. Device cache (IndexedDB) → instant open, zero network.
  //   2. Otherwise downloadEntirePdf(): the COMPLETE file via parallel
  //      HTTP range segments (see fullLoader.ts) with smooth % progress.
  //   3. The verified bytes become a Blob (cache + exam-mode mirror) and
  //      a FRESH ArrayBuffer for pdf.js — handed over exactly once.
  // `engineNonce` in deps is how a retry forces a genuine reload: the
  // effect re-runs and re-derives a provably fresh buffer.
  // ═══════════════════════════════════════════════════════════════════
  useEffect(() => {
    if (!pdfUrl) {
      setLoadPhase("idle");
      return;
    }
    const runId = ++loadRunRef.current;
    const controller = new AbortController();
    abortRef.current = controller;
    let cancelled = false;

    // The live docProxy belongs to the buffer we're about to replace, and
    // dies with the old Document. Drop it BEFORE the swap: the ±1 pre-render
    // pages call docProxy.getPage() synchronously — on a destroyed proxy that
    // throws "Cannot read properties of null (reading 'sendWithPromise')".
    if (docProxy) {
      setDocProxy(null);
      onDocProxy(null);
      setDocLoaded(false);
    }

    void (async () => {
      setLoadError(null);
      setLoadFromCache(false);
      setLoadPercent(0);
      try {
        // 1. Device cache first — re-opening any textbook is INSTANT.
        setLoadPhase("checking");
        const cached = await getCachedFile(contentId, fileSizeBytes);
        if (cancelled || runId !== loadRunRef.current) return;
        if (cached) {
          setLoadFromCache(true);
          fullBlobRef.current = cached;
          onPdfData(cached);
          // Blob.arrayBuffer() returns a NEW ArrayBuffer per call (spec:
          // it copies the blob's byte sequence) — exactly what the
          // detached-ArrayBuffer contract requires. The byteLength
          // sanity check guards against any engine quirk.
          const ab = await cached.arrayBuffer();
          const fresh = ab.byteLength > 0 ? ab : ab.slice(0);
          if (cancelled || runId !== loadRunRef.current) return;
          setLoadPhase("opening");
          setFullBuffer(fresh);
          return;
        }
        // 2. Full parallel download of the COMPLETE file.
        setLoadPhase("downloading");
        lastProgressAtRef.current = Date.now();
        const result = await downloadEntirePdf(pdfUrl, {
          expectedSize: fileSizeBytes,
          signal: controller.signal,
          onProgress: (p) => {
            lastProgressAtRef.current = Date.now();
            if (!p.probing && p.totalBytes > 0) {
              setLoadPercent(Math.min(99, p.percent));
            }
          },
        });
        if (cancelled || runId !== loadRunRef.current) return;
        // 3. Cache + mirror the immutable Blob (safe to keep forever),
        //    then hand pdf.js the complete buffer. The Blob constructor
        //    snapshots the bytes, so the later pdf.js transfer/detach of
        //    result.buffer cannot affect the cached copy.
        const blob = new Blob([result.buffer], { type: "application/pdf" });
        fullBlobRef.current = blob;
        onPdfData(blob);
        void putCachedFile(contentId, blob); // never blocks the render path
        setLoadPercent(100);
        setLoadPhase("opening");
        setFullBuffer(result.buffer);
      } catch (err) {
        if (cancelled || runId !== loadRunRef.current || controller.signal.aborted) return;
        console.error("[PdfStage] Full load failed:", err);
        setLoadPhase("error");
        setLoadError(
          err instanceof Error
            ? `Couldn't finish loading this document. ${err.message}`
            : "Couldn't finish loading this document.",
        );
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, contentId, engineNonce]);

  // STALL WATCHDOG — if the download stops moving for a long window
  // (dropped connection, dead radio), surface the retry card instead of
  // an eternal spinner. Progress timestamps feed it on every tick.
  useEffect(() => {
    if (loadPhase !== "downloading") return;
    const STALL_MS = 20000;
    const interval = setInterval(() => {
      if (Date.now() - lastProgressAtRef.current > STALL_MS) {
        abortRef.current?.abort();
        setLoadPhase("error");
        setLoadError("The download stopped moving (network stall). Check your connection and try again.");
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [loadPhase]);

  // ── Overlays ────────────────────────────────────────────────────────
  const [thumbsOpen, setThumbsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Any crash inside the pdf.js engine degrades the render path for THIS
  // document only — the app itself keeps running, and the error card sits
  // OUTSIDE the boundary so it stays visible.
  //
  // BOUNDED AUTO-RECOVERY: the classic crash cause was pdf.js re-receiving
  // a buffer it had already transferred (detached). A reload run derives a
  // provably fresh buffer (cache decode or re-download), which heals the
  // render path without user action. If it crashes twice more, the retry
  // card stays.
  const autoRetryRef = useRef(0);
  const handleEngineCrash = useCallback(() => {
    setLoadPhase("error");
    setLoadError("The document engine hit an unexpected error.");
    if (autoRetryRef.current < 2) {
      autoRetryRef.current += 1;
      setFullBuffer(null);
      setEngineNonce((n) => n + 1);
    }
  }, []);

  // Reset per-document state when the content changes.
  useEffect(() => {
    setDocLoaded(false);
    setDocProxy(null);
    setThumbsOpen(false);
    setSearchOpen(false);
    setFullBuffer(null);
    fullBlobRef.current = null;
    setLoadPhase("idle");
    setLoadPercent(0);
    setLoadFromCache(false);
    setLoadError(null);
    autoRetryRef.current = 0;
    setEngineNonce(0);
    basePageWidthRef.current = null;
    autoFitDoneRef.current = false;
  }, [contentId]);

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
  //   only be rebuilt from a PROVABLY fresh buffer (a new fullBuffer from
  //   the load engine — cache decode or fresh download) — never re-wrapped
  //   from one pdf.js already consumed.
  const file = useMemo(() => {
    if (fullBuffer) return { data: fullBuffer };
    return null;
  }, [fullBuffer]);

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

  const busyBuffer =
    loadingPdf ||
    loadPhase === "checking" ||
    loadPhase === "downloading" ||
    (loadPhase === "opening" && !docLoaded);
  const showProgressSplash =
    busyBuffer || (Boolean(file) && !docLoaded && !pdfError && !loadError && loadPhase !== "error");

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

      {/* ═══ SMART READER MODE — full loading ═══
          Loaders + error cards live OUTSIDE the engine boundary: when the
          engine crashes, the boundary renders null — and the student must
          STILL see the retry card. The old layout put them INSIDE, so a
          crash hid every message and left the permanent blue blank page. */}
      <>
          {/* Thumbnails rail (lazy) — the FULL document, true page numbers */}
          <AnimatePresence>
            {thumbsOpen && docProxy && numPages && (
              <ThumbnailsRail
                doc={docProxy}
                numPages={numPages}
                pageOffset={0}
                pageNumber={pageNumber}
                onJump={goToPage}
                onClose={() => setThumbsOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* In-document search — the FULL document is loaded, so search
              scans every page with zero network access. */}
          <AnimatePresence>
            {searchOpen && docProxy && numPages && (
              <SearchOverlay
                doc={docProxy}
                numPages={numPages}
                pageOffset={0}
                onJump={goToPage}
                onClose={() => setSearchOpen(false)}
              />
            )}
          </AnimatePresence>

          {/* Scrollable stage — centered page with soft shadow */}
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto" data-lenis-prevent-wheel>
            <div className="mx-auto flex min-h-full w-fit flex-col items-center px-4 py-6 sm:px-10">
              {/* Loading splash — the FULL-LOAD experience. One honest
                  percentage on a slim bar while the entire document
                  arrives (or is decoded from the device cache). No byte
                  counters, no part numbers, no guilt. */}
              {showProgressSplash && (
                <FullLoadLoader
                  phase={loadPhase === "checking" || loadPhase === "idle" ? "checking" : loadPhase === "downloading" ? "downloading" : "opening"}
                  percent={loadPercent}
                  fromCache={loadFromCache}
                />
              )}

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

              {/* Load error — calm retry card. A failed or stalled load
                  NEVER bounces anywhere else: the retry re-runs the full
                  loading engine with a provably fresh buffer. */}
              {loadError && !pdfError && (
                <div className="mx-auto mt-20 flex flex-col items-center gap-6">
                  <div className="relative">
                    <div className="absolute -inset-8 rounded-full bg-amber-500/10 blur-2xl" />
                    <div className="relative flex size-20 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] backdrop-blur-xl">
                      <Lock className="size-8 text-amber-400/80" />
                    </div>
                  </div>
                  <div className="max-w-md text-center">
                    <h2 className="type-h2 bg-gradient-to-r from-amber-200 to-amber-400/70 bg-clip-text text-transparent">
                      Having trouble opening this document
                    </h2>
                    <p className="type-body mt-2 leading-relaxed text-muted-foreground/70">{loadError}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-xl border-foreground/10 bg-foreground/5 hover:bg-foreground/10"
                    onClick={() => {
                      // Force a clean re-run of the full loading engine
                      // with a provably FRESH buffer + an engine remount.
                      loadRunRef.current += 1;
                      setFullBuffer(null);
                      setLoadError(null);
                      setLoadPhase("checking");
                      setEngineNonce((n) => n + 1);
                    }}
                  >
                    <RotateCcw className="size-3.5" /> Try again
                  </Button>
                </div>
              )}

              {/* Document + page — the engine boundary wraps ONLY this
                  subtree, with a resetKey: any crash degrades to null and
                  the boundary RECOVERS when the content changes or the
                  student taps retry. NO key on the page wrapper — the
                  Document mounts ONCE and stays mounted across page flips
                  (remounting it re-ran getDocument() on a buffer pdf.js had
                  already transferred/detached into its worker → "Cannot
                  perform Construct on a detached ArrayBuffer" → the
                  permanent blank stage). Only the page-animator inside is
                  keyed by pageNumber. */}
              {file && !pdfError && !loadError && (
                <PdfEngineBoundary
                  onCrash={handleEngineCrash}
                  resetKey={`${contentId}:doc:${engineNonce}`}
                >
                  <div className="relative">
                    <Document
                      key="doc"
                      file={file}
                      options={PDF_OPTIONS}
                      onLoadSuccess={(pdf) => {
                        onNumPages(pdf.numPages);
                        setDocProxy(pdf);
                        onDocProxy(pdf);
                        setDocLoaded(true);
                        setLoadPhase("ready"); // full document parsed — drop the loader
                      }}
                      onLoadError={(error) => {
                        console.error("[PdfStage] PDF load failed:", error);
                        const msg = error?.message || String(error);
                        setLoadPhase("error");
                        setLoadError(`The document engine couldn't open the file. ${msg}`);
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
                      The FULL document is always loaded, so neighbours are
                      plain page numbers — no chunk clamping, ever. */}
                  {numPages && docProxy && docLoaded && (
                    <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">
                      {pageNumber > 1 && (
                        <PdfPage pdf={docProxy} pageNumber={pageNumber - 1} scale={scale} renderTextLayer={false} renderAnnotationLayer={false} />
                      )}
                      {pageNumber < numPages && (
                        <PdfPage pdf={docProxy} pageNumber={pageNumber + 1} scale={scale} renderTextLayer={false} renderAnnotationLayer={false} />
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
// ═══════════════════════════════════════════════════════════════════════
// FullLoadLoader — the full-loading experience.
// The ENTIRE document is arriving (or being decoded from the device
// cache), so the UI says exactly that with ONE honest percentage on a
// slim bar. No byte counters ("169.9 MB of 171.8 MB" created dread), no
// per-part messages, no elapsed-seconds guilt — calm, premium, truthful
// progress. Theme-aware via foreground/background tokens (light + dark).
// ═══════════════════════════════════════════════════════════════════════

function FullLoadLoader({
  phase,
  percent,
  fromCache,
}: {
  phase: "checking" | "downloading" | "opening";
  percent: number;
  fromCache: boolean;
}) {
  const [mountedAt] = useState(() => Date.now());
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  // Never flash a loader for an instant cache hit — only appear if the
  // phase has actually lasted a beat.
  const elapsed = Date.now() - mountedAt;
  if (elapsed < 350) return null;

  const headline =
    phase === "checking"
      ? "Preparing your document"
      : phase === "downloading"
        ? "Loading your complete textbook"
        : "Opening every page";
  const subline =
    phase === "downloading"
      ? "The full document is on its way — nothing more to load after this"
      : phase === "checking"
        ? "One moment…"
        : fromCache
          ? "Loaded from your device — all pages instant"
          : "Assembling the complete document";
  const indeterminate = phase !== "downloading";

  return (
    <div className="flex h-full min-h-[60vh] w-full flex-col items-center justify-center gap-7 px-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-7"
      >
        {/* Emblem */}
        <div className="relative">
          <div className="absolute -inset-8 animate-pulse rounded-full bg-primary/[0.08] blur-2xl" />
          <div
            className="absolute -inset-3 animate-spin rounded-full border border-primary/15 border-t-primary/50"
            style={{ animationDuration: "2.8s" }}
          />
          <div className="relative flex size-16 items-center justify-center rounded-2xl border border-foreground/10 bg-foreground/[0.03] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <BookOpen className="size-6 text-primary" />
          </div>
        </div>

        {/* Percent + bar */}
        <div className="flex w-[min(78vw,20rem)] flex-col items-center gap-3">
          {!indeterminate ? (
            <p className="type-h1 tabular-nums leading-none text-foreground">
              {Math.max(1, Math.min(99, percent))}
              <span className="type-mono ml-1 align-top text-xs text-muted-foreground/50">%</span>
            </p>
          ) : (
            <p className="type-mono text-sm uppercase tracking-[0.25em] text-muted-foreground/80">{headline}</p>
          )}
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-foreground/[0.07]">
            {indeterminate ? (
              <div className="absolute inset-y-0 left-0 w-1/3 animate-[shimmer-slide_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
            ) : (
              <motion.div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/70 to-primary"
                animate={{ width: `${Math.max(2, Math.min(99, percent))}%` }}
                transition={{ duration: 0.25, ease: "easeOut" }}
              />
            )}
          </div>
          <p className="type-mono min-h-4 text-center text-[10px] text-muted-foreground/45">
            {headline} · {subline}
          </p>
        </div>
      </motion.div>
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
