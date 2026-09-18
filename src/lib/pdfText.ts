// pdfText — client-side PDF helpers for the digital exam experience.
//
// Since conversion moved to the DETERMINISTIC server-side parser
// (examParser.ts — no AI, no browser pipeline), this module survives for
// three honest client jobs:
//   • the player's "View original page" viewer (pdf.js rendering),
//   • the original-page cross-check behind figure-flagged questions,
//   • the scan-OCR runner (Tesseract.js reads pages the server can't —
//     zero cloud AI; the page TEXT it produces feeds the same parser).
//
// All PURE helpers (sentence splitting) live in pdfTextShared.ts so the
// server and browser share ONE implementation that can never drift.

import { pdfjs } from "react-pdf";
import { splitSentences } from "./pdfTextShared";

export { splitSentences };

// Same-origin worker synced from node_modules by scripts/sync-pdfjs.mjs
// (postinstall). Identical setup to the Reader — proven on production.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// ─── Page-image rendering (original-page viewer + scan-OCR runner) ──────

/**
 * Render one PDF page to a JPEG data URL. `maxWidth` caps memory; 1700px
 * keeps exam body text legible for Tesseract.js OCR.
 */
export async function renderPdfPageImage(
  doc: PdfjsDocument,
  pageNumber: number,
  maxWidth = 1700,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, Math.max(1, maxWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't create a canvas to render the page.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Load a PDF document once, reuse it for many page renders. */
export async function loadPdfDoc(url: string): Promise<PdfjsDocument> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't fetch the paper (${res.status}). Check your connection and retry.`);
  }
  const data = await res.arrayBuffer();
  return pdfjs.getDocument({ data }).promise as unknown as PdfjsDocument;
}

/** Minimal structural type so callers don't need the raw pdfjs types. */
export interface PdfjsDocument {
  numPages: number;
  getPage(n: number): Promise<{
    getViewport(opts: { scale: number }): { width: number; height: number };
    render(opts: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): {
      promise: Promise<void>;
    };
  }>;
}
