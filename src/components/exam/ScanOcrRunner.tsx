// ScanOcrRunner — the headless engine behind scanned papers.
//
// When the deterministic server engine stamps a paper as a SCAN (no text
// layer), THIS component mounts on the student's page and does the work
// no server can: pdf.js renders each page, Tesseract.js (WASM, in this
// tab) reads it — no cloud AI, no quotas, no keys — and the page text
// flows to the server where the same deterministic parser structures it.
//
// Renders nothing. Reports progress through props-driven state (the
// reactive query shows the honest "Reading page X of Y…" line).

import { useConvex } from "convex/react";
import { useEffect, useRef } from "react";
import { ocrMissingPages } from "@/lib/scanOcr";

export function ScanOcrRunner({
  contentId,
  pdfUrl,
  pageCount,
  ocrPagesPresent,
  onError,
}: {
  contentId: string;
  pdfUrl: string;
  pageCount: number;
  ocrPagesPresent: boolean[];
  onError?: (message: string) => void;
}) {
  const convex = useConvex();
  const runningRef = useRef(false);
  // A stable snapshot ref: re-renders from the reactive query update it
  // without restarting an in-flight run.
  const presentRef = useRef(ocrPagesPresent);
  presentRef.current = ocrPagesPresent;

  useEffect(() => {
    if (runningRef.current) return;
    if (ocrPagesPresent.length === 0 || ocrPagesPresent.every(Boolean)) return;
    runningRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        await ocrMissingPages(convex, {
          contentId,
          url: pdfUrl,
          pageCount,
          present: presentRef.current,
          shouldStop: () => cancelled,
        });
      } catch (err) {
        if (!cancelled) onError?.((err as Error).message || "OCR couldn't run in this tab.");
      } finally {
        runningRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
    };
    // Re-arm when NEW pages become missing (row reset) — presence changes
    // from all-done → partial only happens on a fresh conversion.
  }, [contentId, convex, onError, ocrPagesPresent, pageCount, pdfUrl]);

  return null;
}
