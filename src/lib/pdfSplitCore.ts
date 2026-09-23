// Large-PDF split core — pure pdf-lib logic, zero platform dependencies.
//
// WHY THIS EXISTS (real measured evidence, 2026-09-23):
//   The 171.8 MB "Grade 12 Biology STB" was NOT range-streaming end-to-end.
//   R2 itself supports ranges (206 + Content-Range verified with curl), but
//   the bucket CORS rules lacked Access-Control-Expose-Headers, so pdf.js
//   (cross-origin) could not read Accept-Ranges/Content-Length and silently
//   set disableRange=true → the ENTIRE file streamed before page 1 became
//   usable ("169.9 of 171.8 MB"). The PDF is also non-linearized (xref at the
//   very end), so progressive rendering never had a chance.
//
//   CORS is now fixed at the bucket level, but live range-request behavior
//   still depends on every layer (CDN quirks, presigned headers, browser
//   peculiarities). Chunking guarantees the fix: big files are split ONCE at
//   upload/processing time into small sequential PDFs; the reader fetches
//   only the chunk it needs (~10-15 MB), cached in IndexedDB, with the next
//   chunk pre-fetched in the background.
//
// This module is intentionally platform-free (no Convex, no DOM, no "use
// node") so the SAME logic runs in:
//   - Convex node actions (upload-time split, retroactive splitter)
//   - Local ops scripts (bun/node)
//   - The admin browser panel if ever needed

import { PDFDocument } from "pdf-lib";

import {
  MAX_PAGES_PER_CHUNK,
  MIN_PAGES_PER_CHUNK,
  SPLIT_THRESHOLD_BYTES,
  TARGET_CHUNK_BYTES,
} from "../convex/constants";

// Re-exported so consumers of the split core see one coherent surface.
export { SPLIT_THRESHOLD_BYTES, TARGET_CHUNK_BYTES, MIN_PAGES_PER_CHUNK, MAX_PAGES_PER_CHUNK };

export interface ChunkRange {
  startPage: number; // 1-based, inclusive
  endPage: number; // inclusive
}

/** Pick a page-per-chunk count from the average page density, clamped. */
export function computePagesPerChunk(totalPages: number, totalBytes: number): number {
  if (totalPages <= 0) return 1;
  const avgBytesPerPage = totalBytes / totalPages;
  const raw = Math.floor(TARGET_CHUNK_BYTES / Math.max(1, avgBytesPerPage));
  return Math.max(MIN_PAGES_PER_CHUNK, Math.min(MAX_PAGES_PER_CHUNK, raw || 1));
}

/** Sequential page ranges covering 1..totalPages. */
export function chunkRanges(totalPages: number, pagesPerChunk: number): ChunkRange[] {
  const ranges: ChunkRange[] = [];
  for (let start = 1; start <= totalPages; start += pagesPerChunk) {
    const end = Math.min(totalPages, start + pagesPerChunk - 1);
    ranges.push({ startPage: start, endPage: end });
  }
  return ranges;
}

/**
 * Deterministic, non-guessable R2 key for a chunk:
 *   <original dir>/chunks/<token>/part-<3-digit index>.pdf
 * The token is random per content item (stored in the manifest) so chunk
 * URLs can't be enumerated from the original file URL.
 */
export function chunkKeyFor(originalKey: string, index: number, token: string): string {
  const slash = originalKey.lastIndexOf("/");
  const dir = slash === -1 ? "" : originalKey.slice(0, slash);
  const joined = dir ? `${dir}/chunks/${token}` : `chunks/${token}`;
  return `${joined}/part-${String(index + 1).padStart(3, "0")}.pdf`;
}

/** Make a short URL-safe random token (12 hex chars). */
export function makeChunkToken(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < 12; i++) out += Math.floor(random() * 16).toString(16);
  return out;
}

export interface SplitInput {
  /** Optional override. When omitted (recommended), the page count is
   * computed from the REAL document during the split — far more accurate
   * than any caller-side estimate (the Agriculture STB's stored metadata
   * had no pageCount, which caused undersized 1.3MB chunks). */
  pagesPerChunk?: number;
  title: string;
  /** Metadata for part labels on each chunk, e.g. "Part 3 of 16". */
  totalChunks?: number;
}

export interface SplitOutputChunk {
  startPage: number;
  endPage: number;
  bytes: Uint8Array;
}

/**
 * Split a PDF into sequential chunk documents. Loads the source once and
 * copies page ranges into fresh documents — the same proven pdf-lib pattern
 * as the branding engine (brandPdf), which already handles 170MB+ files in
 * production. Chunk k covers pages [k*pagesPerChunk+1 .. min(total, ...)].
 */
export async function splitPdfIntoChunkBuffers(
  pdfBytes: Uint8Array | Buffer,
  input: SplitInput,
): Promise<SplitOutputChunk[]> {
  const srcDoc = await PDFDocument.load(pdfBytes as Uint8Array, {
    ignoreEncryption: true,
    throwOnInvalidObject: false,
    // Don't update metadata — we're not modifying content, just repacking.
    updateMetadata: false,
  });
  const totalPages = srcDoc.getPageCount();
  // Size from the REAL page count when the caller didn't pin a value.
  const pagesPerChunk = input.pagesPerChunk ?? computePagesPerChunk(totalPages, pdfBytes.byteLength);
  const ranges = chunkRanges(totalPages, pagesPerChunk);
  const totalChunks = ranges.length;
  const out: SplitOutputChunk[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const range = ranges[i];
    const pageIndices: number[] = [];
    for (let p = range.startPage; p <= range.endPage; p++) pageIndices.push(p - 1);

    const chunkDoc = await PDFDocument.create();
    chunkDoc.setProducer("Learnyx Academy ET — Chunking Engine");
    chunkDoc.setCreator("Learnyx Academy ET");
    const suffix = input.totalChunks ? ` · Part ${i + 1} of ${totalChunks}` : "";
    chunkDoc.setTitle(`${input.title}${suffix}`);

    // copyPages preserves the source pages byte-for-byte (shared resources
    // are copied lazily per chunk by pdf-lib — no re-encoding of images).
    const copied = await chunkDoc.copyPages(srcDoc, pageIndices);
    for (const page of copied) chunkDoc.addPage(page);

    const bytes = await chunkDoc.save({ useObjectStreams: false });
    out.push({ startPage: range.startPage, endPage: range.endPage, bytes });
  }

  return out;
}

/** True when a file of this size should be chunked. */
export function shouldSplit(sizeBytes: number | undefined | null): boolean {
  return typeof sizeBytes === "number" && sizeBytes >= SPLIT_THRESHOLD_BYTES;
}
