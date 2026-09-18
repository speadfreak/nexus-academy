// scanOcr — client-side OCR for scanned past papers, powered by
// Tesseract.js (WASM, in THIS browser tab).
//
// WHY CLIENT-SIDE: server-side PDF rasterization needs native canvas
// (unavailable in Convex actions, and Tesseract's Node worker script
// can't resolve inside the bundler). The browser has everything needed:
// pdf.js renders each page to a canvas, Tesseract.js reads it — no cloud
// AI, no API keys, no rate limits, no cost. The page TEXT it produces is
// submitted to the server, where the SAME deterministic parser used for
// text-layer papers structures it into questions.
//
// Used by two surfaces:
//   • DigitalExam — a student opening a scanned paper OCRs it in their
//     own tab behind a calm "Preparing…" screen with honest progress.
//   • ExamEngineAdmin — "OCR scans in this tab" pre-reads the whole
//     scan backlog so students never wait at all.
//
// tesseract.js is dynamic-imported so the main bundle stays light, and
// worker/core/language assets load from their published CDNs — the same
// mechanism tesseract.js itself uses by default.

import { api } from "@/convex/_generated/api";
import { loadPdfDoc, renderPdfPageImage } from "./pdfText";

const TESS_VERSION = "7.0.0";
const CORE_VERSION = "7.0.0";

interface MinimalConvexClient {
  mutation(fn: unknown, args: unknown): Promise<unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OcrRunOptions {
  contentId: string;
  url: string;
  pageCount: number;
  /** Pages that already have text (skip them — resume support). */
  present: boolean[];
  onProgress?: (done: number, total: number, page: number) => void;
  shouldStop?: () => boolean;
}

/**
 * OCR every missing page of one paper in this tab. Returns the number of
 * pages this run submitted. Throws on hard failures (network/render) —
 * callers decide whether to retry.
 */
export async function ocrMissingPages(
  convex: MinimalConvexClient,
  opts: OcrRunOptions,
): Promise<number> {
  const { contentId, url, pageCount, present } = opts;
  const missing: number[] = [];
  for (let p = 1; p <= pageCount; p++) if (!present[p - 1]) missing.push(p);
  if (missing.length === 0) return 0;

  const tesseract = await import("tesseract.js");
  const worker = await tesseract.createWorker("eng", 1, {
    workerPath: `https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist/worker.min.js`,
    corePath: `https://cdn.jsdelivr.net/npm/tesseract.js-core@${CORE_VERSION}`,
    langPath: "https://tessdata.projectnaptha.com/4.0.0",
    logger: () => {}, // silent — this is infrastructure, not a feature
  });

  let submitted = 0;
  try {
    const doc = await loadPdfDoc(url);
    for (const page of missing) {
      if (opts.shouldStop?.()) break;
      const dataUrl = await renderPdfPageImage(doc, page, 1700);
      const { data } = await worker.recognize(dataUrl);
      const text = (data.text ?? "").trim();
      const res = (await convex.mutation(api.examPrepDigital.submitOcrPageText, {
        contentId,
        pageNumber: page,
        pageCount,
        text,
      })) as { done?: boolean; accepted?: boolean };
      submitted += 1;
      opts.onProgress?.(
        Math.min(pageCount, (opts.present.filter(Boolean).length ?? 0) + submitted),
        pageCount,
        page,
      );
      if (res?.accepted === false) break; // the row moved on — stop quietly
      if (page !== missing[missing.length - 1]) await sleep(150);
    }
  } finally {
    await worker.terminate().catch(() => {});
  }
  return submitted;
}
