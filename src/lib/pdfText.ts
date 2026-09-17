// pdfText — client-side PDF text extraction for the digital exam engine.
//
// Runs IN THE STUDENT'S BROWSER (pdf.js never runs server-side — it crashes
// the Convex node runtime). Reuses the pdfjs instance bundled inside
// react-pdf so the worker at /pdf.worker.min.mjs (synced by postinstall)
// matches exactly — the same worker the Reader already proved works on
// Render's static hosting.
//
// Text assembly is baseline-aware: pdf.js returns positioned items, not
// lines. Items on the same visual line (same baseline Y) are joined with
// x-gap-driven space insertion, then lines are ordered top-to-bottom.
// Naive item concatenation produced "1.What is the unit ofA. kg B. N" —
// baseline assembly produces real lines the AI can transcribe reliably.

import { pdfjs } from "react-pdf";

// Same-origin worker synced from node_modules by scripts/sync-pdfjs.mjs
// (postinstall). Identical setup to the Reader — proven on production.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export interface PdfTextResult {
  pages: string[]; // assembled text per page (1 page = 1 entry)
  totalChars: number;
  pageCount: number;
  hasTextLayer: boolean;
}

/** Minimum average chars/page before we call the PDF a pure image scan. */
const TEXT_LAYER_THRESHOLD_AVG = 40;

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

interface TextItemLike {
  str?: string;
  transform?: number[]; // pdf.js transform matrix — [a, b, c, d, e, f]; e=x, f=y (baseline)
  width?: number;
  hasEOL?: boolean;
}

/**
 * Assemble one page's text items into lines using baseline Y, with
 * x-gap space insertion. Returns the page text with newlines between lines.
 */
function assemblePageText(items: TextItemLike[]): string {
  const lines = new Map<number, { x: number; str: string; endX: number }[]>();

  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    if (!str) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    const x = t[4]!;
    const y = Math.round(t[5]! / 2) * 2; // 2pt buckets — same visual line
    const width = typeof item.width === "number" && item.width > 0 ? item.width : str.length * 4;
    const entry = { x, str, endX: x + width };
    const bucket = lines.get(y);
    if (bucket) bucket.push(entry);
    else lines.set(y, [entry]);
  }

  // Top-to-bottom = descending y in pdf.js coordinates.
  const ys = [...lines.keys()].sort((a, b) => b - a);

  const out: string[] = [];
  for (const y of ys) {
    const bucket = lines.get(y)!;
    bucket.sort((a, b) => a.x - b.x);
    let line = "";
    let prevEnd = -Infinity;
    for (const seg of bucket) {
      // Gap wider than ~1.5 average chars between segments = a space.
      const gap = seg.x - prevEnd;
      if (line.length > 0 && gap > 6) line += " ";
      line += seg.str;
      prevEnd = seg.endX;
    }
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (trimmed) out.push(trimmed);
  }
  return out.join("\n");
}

// ─── Chunking ────────────────────────────────────────────────────────────

export interface PdfChunk {
  index: number;
  text: string;
  /** Human-readable page range for the pipeline UI, e.g. "pages 3–5". */
  pageRange: string;
}

/**
 * Page-aligned chunking: whole pages accumulate into ~targetChar chunks.
 * Pages are never split mid-question; an oversized page gets its own chunk.
 * 5000 chars keeps each Groq request comfortably inside free-tier token
 * budgets (input + transcription output share the same TPM window).
 */
export function chunkPages(pages: string[], targetChars = 5000): PdfChunk[] {
  const chunks: PdfChunk[] = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let startPage = 1;

  const flush = (endPage: number) => {
    if (buffer.length === 0) return;
    chunks.push({
      index: chunks.length,
      text: buffer.join("\n\n"),
      pageRange:
        startPage === endPage ? `page ${startPage}` : `pages ${startPage}–${endPage}`,
    });
    buffer = [];
    bufferLen = 0;
  };

  for (let i = 0; i < pages.length; i++) {
    const pageText = pages[i]!;
    if (pageText.length > targetChars && buffer.length === 0) {
      // Single oversized page → own chunk (never split a page).
      chunks.push({
        index: chunks.length,
        text: pageText,
        pageRange: `page ${i + 1}`,
      });
      startPage = i + 2;
      continue;
    }
    if (bufferLen + pageText.length > targetChars && buffer.length > 0) {
      flush(i);
      startPage = i + 1;
    }
    buffer.push(pageText);
    bufferLen += pageText.length;
  }
  flush(pages.length);
  return chunks;
}

// ─── Sentence splitting (shared with read-aloud) ─────────────────────────

/**
 * Split text into sentences for the read-aloud queue and its highlighting.
 * Kept here so the player and the TTS hook segment IDENTICALLY.
 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;:])\s+|(?<=\d)\.\s+/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
