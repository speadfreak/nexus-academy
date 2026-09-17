// pdfTextShared — PURE PDF text helpers shared by the client (pdfText.ts)
// and the server-side conversion engine (convex/examConversionEngine.ts).
//
// ZERO runtime imports: no pdfjs, no DOM, no Node built-ins. This file must
// stay importable from BOTH the browser bundle and a Convex "use node"
// action. That is what lets the SAME text-assembly + chunking rules run on
// the server (the always-ready engine) and, if ever needed, in a browser —
// one implementation that can never drift.

// ─── Baseline-aware text assembly ────────────────────────────────────────

export interface TextItemLike {
  str?: string;
  transform?: number[]; // pdf.js transform matrix — [a, b, c, d, e, f]; e=x, f=y (baseline)
  width?: number;
  hasEOL?: boolean;
}

/**
 * Assemble one page's text items into lines using baseline Y, with
 * x-gap space insertion. Returns the page text with newlines between lines.
 *
 * WHY THIS EXISTS: pdf.js returns positioned items, not lines. Naive item
 * concatenation produced "1.What is the unit ofA. kg B. N" — baseline
 * assembly produces real lines the AI can transcribe reliably. Running the
 * same algorithm server-side keeps the always-ready engine's output
 * identical to what the browser pipeline produced historically.
 */
export function assemblePageText(items: TextItemLike[]): string {
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

/**
 * Minimum average chars/page before we treat the PDF as having a usable
 * text layer. CALIBRATED AGAINST REAL PAPERS: a genuine exam page carries
 * 1000+ chars; scanned papers with a thin/garbled embedded OCR strip run
 * 40–150 chars/page and MUST take the page-OCR path instead — transcribing
 * that dribble of text produces "no questions found" failures. 250 sits
 * safely below real papers and well above image-only scans.
 */
export const TEXT_LAYER_THRESHOLD_AVG = 250;

// ─── Chunking ────────────────────────────────────────────────────────────

export interface PdfChunk {
  index: number;
  text: string;
  /** Human-readable page range for pipeline UI, e.g. "pages 3–5". */
  pageRange: string;
  /** 1-based inclusive page bounds — powers sourcePage fallbacks. */
  startPage: number;
  endPage: number;
}

/**
 * Page-aligned chunking: whole pages accumulate into ~targetChar chunks.
 * Pages are never split mid-question; an oversized page gets its own chunk.
 * 3000 chars keeps each Groq request comfortably inside the free tier's
 * 8k tokens-per-minute budget (input + transcription output share it —
 * probed live: gpt-oss-120b is metered at 8,000 TPM on this account).
 */
export function chunkPages(pages: string[], targetChars = 3000): PdfChunk[] {
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
      startPage,
      endPage,
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
        startPage: i + 1,
        endPage: i + 1,
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

// ─── Page markers (page attribution for AI transcription) ────────────────

/**
 * Join per-page texts with explicit "=== PAGE N ===" markers so the AI can
 * attribute each question to its page (the sourcePage field). The markers
 * are a defined part of the transcription prompt contract.
 */
export function withPageMarkers(pages: string[]): string {
  return pages
    .map((text, i) => `=== PAGE ${i + 1} ===\n${text}`)
    .join("\n\n");
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
