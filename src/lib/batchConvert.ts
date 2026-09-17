// batchConvert — the shared client-side conversion runner.
//
// One function that converts a single past paper end-to-end from ANY
// browser: the DigitalExam page (student opens a paper), the admin
// batch worker (Exam Engine console → "Start worker here") and the
// app-wide crowd autopilot all call this. Same claim → extract → AI →
// complete pipeline, so every conversion produces exactly what a student
// conversion would.
//
// AI pacing: the real rate guard is the server-side global orchestrator
// (aiRateLimit.acquireAiPermit inside every AI action) — this module only
// adds a small breather between chunks of the same paper. Because pacing
// is enforced globally, MANY pipelines can now run in parallel at the
// same safe requests-per-minute.

import { api } from "@/convex/_generated/api";
import {
  chunkPages,
  extractPdfTextPages,
  loadPdfDoc,
  renderPdfPageImage,
  withPageMarkers,
} from "./pdfText";

const CHUNK_PACING_MS_STUDENT = 1_200;
const CHUNK_PACING_MS_BATCH = 2_000;
const PAGE_PACING_MS_VISION = 3_000;
const QUEUE_POLL_MS = 2_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ConversionProgress {
  stage: "queued" | "fetching" | "extracting" | "transcribing" | "transcribing-vision";
  page?: number;
  pageCount?: number;
  questions?: number;
}

interface MinimalConvexClient {
  mutation(fn: unknown, args: unknown): Promise<unknown>;
  action(fn: unknown, args: unknown): Promise<unknown>;
  query(fn: unknown, args: unknown): Promise<unknown>;
}

/**
 * Convert one paper. Resolves with the final digitalPapers status
 * ("ready" / "failed"), or "ready"/"processing" short-circuits.
 *
 * Crash-safe: ANY failure after the claim (premium wall on the PDF url,
 * network drop, pdf.js error, AI failure) is reported to
 * reportClientConversionFailure so the concurrency slot frees instantly —
 * a dead run must never sit "running" until the freshness window expires
 * and stall the whole crowd autopilot.
 */
export async function runPaperConversion(
  convex: MinimalConvexClient,
  contentId: string,
  opts?: { batch?: boolean; onProgress?: (p: ConversionProgress) => void },
): Promise<string> {
  const { batch = false, onProgress } = opts ?? {};

  try {
    return await runPipeline(convex, contentId, batch, onProgress);
  } catch (err) {
    try {
      await convex.mutation(api.examPrepDigital.reportClientConversionFailure, {
        contentId,
        error:
          (err as Error)?.message?.slice(0, 480) || "Client pipeline crashed.",
      });
    } catch {
      // Best effort — the autopilot tick still heals the row eventually.
    }
    throw err;
  }
}

async function runPipeline(
  convex: MinimalConvexClient,
  contentId: string,
  batch: boolean,
  onProgress?: (p: ConversionProgress) => void,
): Promise<string> {
  // ── Claim (with polite queue waiting) ──
  onProgress?.({ stage: "fetching" });
  let claim = (await convex.mutation(api.examPrepDigital.beginDigitization, {
    contentId,
    // Batch claims (admin worker + crowd autopilot) never bump the job to
    // student priority — pre-conversion work must never outrank a student
    // who is actively waiting on this exact paper.
    asBatch: batch,
  })) as { kind: string; digitalPaperId?: string; ahead?: number };

  while (claim.kind === "queued") {
    onProgress?.({ stage: "queued" });
    await sleep(QUEUE_POLL_MS);
    claim = (await convex.mutation(api.examPrepDigital.beginDigitization, {
      contentId,
    })) as typeof claim;
  }
  if (claim.kind === "ready" || claim.kind === "processing") return claim.kind;
  const digitalPaperId = claim.digitalPaperId;
  if (!digitalPaperId) throw new Error("Conversion claim failed.");

  // ── Resolve the PDF url (admin path skips the premium wall) ──
  const url = await resolvePaperUrl(convex, contentId);

  // ── Extract text ──
  onProgress?.({ stage: "extracting" });
  const extraction = await extractPdfTextPages(url, (page, pageCount) =>
    onProgress?.({ stage: "extracting", page, pageCount }),
  );

  if (!extraction.hasTextLayer) {
    // ── VISION PATH: scanned paper → read every page as an image ──
    onProgress?.({ stage: "transcribing-vision" });
    const doc = await loadPdfDoc(url);
    const pageCount = doc.numPages || extraction.pageCount;
    let questions = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      onProgress?.({ stage: "transcribing-vision", page: pageNumber, pageCount, questions });
      const imageBase64 = await renderPdfPageImage(doc, pageNumber);
      const res = (await convex.action(api.examPrepDigital.parsePaperPageImage, {
        contentId,
        digitalPaperId,
        pageNumber,
        pageCount,
        imageBase64,
      })) as { questionsFound: number };
      questions += res.questionsFound;
      if (pageNumber < pageCount) await sleep(PAGE_PACING_MS_VISION);
    }
  } else {
    // ── TEXT PATH: page-attributed chunks ──
    const chunks = chunkPages(extraction.pages);
    let questions = 0;
    for (const chunk of chunks) {
      onProgress?.({
        stage: "transcribing",
        page: chunk.index + 1,
        pageCount: chunks.length,
        questions,
      });
      const res = (await convex.action(api.examPrepDigital.parsePaperChunk, {
        contentId,
        digitalPaperId,
        chunkIndex: chunk.index,
        chunkCount: chunks.length,
        pageCount: extraction.pageCount,
        fallbackPage: chunk.startPage,
        text: withPageMarkers(extraction.pages.slice(chunk.startPage - 1, chunk.endPage)),
      })) as { questionsFound: number };
      questions += res.questionsFound;
      if (chunk.index < chunks.length - 1) {
        await sleep(batch ? CHUNK_PACING_MS_BATCH : CHUNK_PACING_MS_STUDENT);
      }
    }
  }

  const row = (await convex.query(api.examPrepDigital.getDigitalPaper, {
    contentId,
  })) as { status?: string } | null;
  return row?.status ?? "unknown";
}

/** Admin-aware PDF url resolution: admin query first (no premium wall). */
async function resolvePaperUrl(
  convex: MinimalConvexClient,
  contentId: string,
): Promise<string> {
  try {
    const admin = (await convex.query(api.examQuality.adminGetFileUrl, {
      contentId,
    })) as { url: string } | null;
    if (admin?.url) return admin.url;
  } catch {
    // Not an admin — fall through to the standard gate.
  }
  const { url } = (await convex.action(api.contentAdmin.getDownloadUrl, {
    contentId,
  })) as { url: string };
  return url;
}
