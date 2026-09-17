// pdfText — client-side PDF text extraction for the digital exam engine.
//
// Runs IN THE BROWSER (react-pdf's pdfjs). The heavy lifting of conversion
// now happens SERVER-SIDE (examConversionEngine.ts via unpdf) — this module
// remains for the original-page viewer, the admin/crowd vision-OCR path,
// and any client fallback. All PURE helpers (baseline assembly, chunking,
// page markers, sentence splitting) live in pdfTextShared.ts so the server
// and browser share ONE implementation that can never drift.

import { pdfjs } from "react-pdf";
import {
  assemblePageText,
  chunkPages,
  splitSentences,
  withPageMarkers,
  TEXT_LAYER_THRESHOLD_AVG,
  // Re-exported so every existing importer keeps working unchanged.
  type PdfChunk,
  type TextItemLike,
} from "./pdfTextShared";

export { chunkPages, splitSentences, withPageMarkers };
export type { PdfChunk };
export { TEXT_LAYER_THRESHOLD_AVG };

// Same-origin worker synced from node_modules by scripts/sync-pdfjs.mjs
// (postinstall). Identical setup to the Reader — proven on production.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface PdfTextResult {
  pages: string[]; // assembled text per page (1 page = 1 entry)
  totalChars: number;
  pageCount: number;
  hasTextLayer: boolean;
}

/**
 * Fetch a PDF URL and extract baseline-assembled text for every page.
 * onProgress reports (pageNumber, pageCount) as pages complete.
 */
export async function extractPdfTextPages(
  url: string,
  onProgress?: (page: number, pageCount: number) => void,
): Promise<PdfTextResult> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Couldn't fetch the paper (${res.status}). Check your connection and retry.`);
  }
  const data = await res.arrayBuffer();

  const doc = await pdfjs.getDocument({ data }).promise;
  const pageCount = doc.numPages;
  const pages: string[] = [];
  let totalChars = 0;

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    // TextMarkedContent items carry no text — the runtime shape check in
    // assemblePageText already ignores anything without str/transform.
    const pageText = assemblePageText(content.items as unknown as TextItemLike[]);
    pages.push(pageText);
    totalChars += pageText.length;
    onProgress?.(pageNumber, pageCount);
  }

  const avg = pageCount > 0 ? totalChars / pageCount : 0;
  return {
    pages,
    totalChars,
    pageCount,
    hasTextLayer: avg >= TEXT_LAYER_THRESHOLD_AVG,
  };
}

// assemblePageText + TextItemLike now come from pdfTextShared (imported at
// the top) — one implementation shared with the server-side engine.

// ─── Page-image rendering (vision OCR + original-page viewer) ────────────

/**
 * Render one PDF page to a JPEG data URL — the vision path for scanned
 * papers (no text layer) and the player's "View original page" viewer.
 * `maxWidth` caps memory/Groq payload size; 1400px keeps exam body text
 * legible for OCR while staying well under provider image budgets.
 */
export async function renderPdfPageImage(
  doc: PdfjsDocument,
  pageNumber: number,
  maxWidth = 1400,
): Promise<string> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, Math.max(1, maxWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't create a canvas to render the page.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.78);
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
