"use node";
// examConversionEngine — the ALWAYS-READY library conversion WORKERS.
//
// THE ARCHITECTURE SHIFT: conversion used to run inside whichever browser
// tab happened to open a paper (pdf.js + streamed AI calls), with a visible
// queue when the free AI tier filled up. Students saw "Converting this
// paper right now" and "Waiting for a free conversion slot" — unacceptable.
//
// This module moves EVERY conversion step server-side, so a student's
// browser never extracts, transcribes, or queues anything ever again:
//
//   • engineExtract — downloads the PDF from R2 and extracts baseline-
//     assembled text with unpdf (server-side pdf.js — text extraction
//     needs no canvas). Text-layer papers are chunked with the exact same
//     shared rules the browser used (pdfTextShared.ts) and the
//     transcription chain starts. Scanned papers route to the OCR chain.
//
//   • engineTranscribeChunk — transcribes ONE chunk through the global
//     Groq rate lanes (same prompt, same sanitizer, same failover as
//     always), appends via the sequence guard, then schedules the next
//     chunk. One AI call per action = no timeout risk, ever. The final
//     chunk flips the paper ready.
//
//   • engineOcrChunk — SCANNED PAPERS (no text layer): slices the PDF into
//     page ranges with pdf-lib and sends each slice to Gemini as an inline
//     PDF (native OCR, still zero browsers). If Gemini is not configured
//     or refuses, the job falls back to the crowd worker's page-image
//     path (any signed-in tab) — nothing is ever a dead end.
//
// The queue/claiming brain lives in examConversionEngineDispatch.ts
// (mutations must stay out of the Node runtime); it runs every minute and
// is what students never have to know about.
//
// EVERY paper converted here is cached in digitalPapers forever — students
// open pre-built digital papers instantly, in exam OR practice mode.

import { getDocumentProxy } from "unpdf";
import { PDFDocument } from "pdf-lib";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { GenericActionCtx } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  callGroqWithRetry,
  extractJsonArray,
  sanitizeQuestion,
  SYSTEM_PROMPT,
  TEXT_MODEL_CHAIN,
  type RawQuestion,
  type SanitizedQuestion,
} from "./examPrepDigital";
import {
  resolveGeminiKey,
  callGemini,
  GeminiRateLimitError,
  GeminiUnavailableError,
} from "./gemini";
import {
  assemblePageText,
  chunkPages,
  withPageMarkers,
  TEXT_LAYER_THRESHOLD_AVG,
} from "../lib/pdfTextShared";

// ─── Tunables ────────────────────────────────────────────────────────────

/** Pages per Gemini OCR slice (inline PDF size + output token headroom). */
const SCAN_PAGES_PER_CHUNK = 5;

/** Skip server-side OCR beyond Gemini's inline-document size comfort zone
 *  (~20MB request); those fall back to the crowd worker's page-image path. */
const MAX_SCAN_PDF_BYTES = 18 * 1024 * 1024;

/** A single chunk of text larger than this is almost certainly a broken
 *  extraction — fail honestly instead of burning the AI budget. */
const MAX_CHUNK_CHARS = 60_000;

// ─── engineExtract — server-side PDF download + text extraction ─────────

/**
 * Download the paper from R2 and extract baseline-assembled text per page
 * with unpdf (pdf.js compiled for Node — text extraction needs no canvas).
 *
 * TEXT-LAYER PAPERS: chunked with the shared rules and the transcription
 * chain starts (one action per chunk).
 *
 * SCANNED PAPERS: handed to the Gemini inline-PDF OCR chain; when Gemini
 * is unavailable the job falls back to the crowd worker's page-image path
 * so a scan is never a dead end.
 */
export const engineExtract = internalAction({
  args: {
    contentId: v.id("contentItems"),
    digitalPaperId: v.id("digitalPapers"),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    try {
      const item = await ctx.runQuery(internal.examConversionEngineDispatch.getItemRow, {
        contentId: args.contentId,
      });
      if (!item) throw new Error("Paper row vanished before extraction.");

      const row = await ctx.runQuery(internal.examConversionEngineDispatch.getPaperRow, {
        digitalPaperId: args.digitalPaperId,
      });
      if (!row || row.status !== "processing") return; // someone took over — bail quietly

      const res = await fetch(item.fileUrl);
      if (!res.ok) {
        throw new Error(`Couldn't fetch the paper from storage (${res.status}).`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());

      const pdf = await getDocumentProxy(bytes);
      const pageCount: number = pdf.numPages;
      const pages: string[] = [];
      let totalChars = 0;
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = assemblePageText(content.items as never);
        pages.push(pageText);
        totalChars += pageText.length;
      }

      const avg = pageCount > 0 ? totalChars / pageCount : 0;
      const hasTextLayer = avg >= TEXT_LAYER_THRESHOLD_AVG;

      if (!hasTextLayer) {
        // ── SCANNED PAPER → server-side Gemini OCR chain (or crowd fallback)
        await startOcrPath(ctx, {
          contentId: args.contentId,
          digitalPaperId: args.digitalPaperId,
          bytes,
          pageCount,
        });
        return;
      }

      // ── TEXT-LAYER PAPER → chunk with the SHARED rules, start the chain
      const chunks = chunkPages(pages);
      if (chunks.length === 0 || chunks.length > 200) {
        throw new Error(
          `Extraction produced ${chunks.length} chunks — outside the convertible range.`,
        );
      }

      await ctx.runMutation(internal.examPrepDigital.patchPaperProgress, {
        digitalPaperId: args.digitalPaperId,
        pageCount,
        chunkCount: chunks.length,
      });

      await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineTranscribeChunk, {
        digitalPaperId: args.digitalPaperId,
        contentId: args.contentId,
        chunkIndex: 0,
        chunkCount: chunks.length,
        pageCount,
      });
      console.log(
        `[exam-engine] extract ok contentId=${args.contentId} pages=${pageCount} chunks=${chunks.length} chars=${totalChars} ms=${Date.now() - started}`,
      );
    } catch (err) {
      await failPaper(ctx, {
        digitalPaperId: args.digitalPaperId,
        contentId: args.contentId,
        error: `Extraction failed: ${(err as Error).message}`,
      });
    }
  },
});

// ─── engineTranscribeChunk — one AI call per action, sequential chain ────

/**
 * Transcribe ONE page-aligned chunk through the global Groq lanes (same
 * SYSTEM_PROMPT, same sanitizer, same model failover as the historic
 * client pipeline — identical output quality) and append via the strict
 * sequence guard. The final chunk completes the paper.
 *
 * Chunks are recomputed from the PDF on demand — chunkPages() is a pure,
 * deterministic function of the file bytes, so every action in the chain
 * derives identical chunks with zero shared state.
 */
export const engineTranscribeChunk = internalAction({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
    chunkIndex: v.number(),
    chunkCount: v.number(),
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const row = await ctx.runQuery(internal.examConversionEngineDispatch.getPaperRow, {
        digitalPaperId: args.digitalPaperId,
      });
      if (!row || row.status !== "processing") return; // superseded — stop the chain

      const item = await ctx.runQuery(internal.examConversionEngineDispatch.getItemRow, {
        contentId: args.contentId,
      });
      if (!item) throw new Error("Paper row vanished mid-conversion.");

      // ONE download + extraction serves both the chunk lookup and the
      // page-slice text sent to the AI.
      const pages = await extractPageTexts(ctx, item.fileUrl);
      const chunks = chunkPages(pages);
      const chunk = chunks[args.chunkIndex];
      if (!chunk) {
        throw new Error(
          `Chunk ${args.chunkIndex} missing (paper yields ${chunks.length} chunks) — the source file changed mid-run.`,
        );
      }

      let questions: SanitizedQuestion[] = [];
      if (chunk.text.trim().length === 0) {
        // Empty chunk — still counts as parsed so the sequence guard advances.
      } else {
        if (chunk.text.length > MAX_CHUNK_CHARS) {
          throw new Error(`Chunk ${args.chunkIndex + 1} extraction is abnormally large.`);
        }
        questions = await transcribeChunk(ctx, {
          chunkText: withPageMarkers(pages.slice(chunk.startPage - 1, chunk.endPage)),
          chunkIndex: args.chunkIndex,
          chunkCount: args.chunkCount,
        });
      }

      await ctx.runMutation(internal.examPrepDigital.appendParsedChunk, {
        digitalPaperId: args.digitalPaperId as never,
        chunkIndex: args.chunkIndex,
        chunkCount: args.chunkCount,
        pageCount: args.pageCount,
        fallbackPage: chunk.startPage,
        questions: questions as never,
      });

      if (args.chunkIndex >= args.chunkCount - 1 || args.chunkIndex >= chunks.length - 1) {
        await ctx.runMutation(internal.examPrepDigital.completeDigitization, {
          digitalPaperId: args.digitalPaperId as never,
        });
        console.log(`[exam-engine] ready contentId=${args.contentId}`);
        return;
      }

      await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineTranscribeChunk, {
        digitalPaperId: args.digitalPaperId,
        contentId: args.contentId,
        chunkIndex: args.chunkIndex + 1,
        chunkCount: args.chunkCount,
        pageCount: args.pageCount,
      });
    } catch (err) {
      await failPaper(ctx, {
        digitalPaperId: args.digitalPaperId,
        contentId: args.contentId,
        error: `AI transcription failed on chunk ${args.chunkIndex + 1}: ${(err as Error).message}`,
      });
    }
  },
});

// ─── engineOcrChunk — scanned papers via Gemini inline PDF (zero browser) ─

/**
 * OCR ONE page-slice of a scanned paper with Gemini's native document
 * understanding. The slice is cut server-side with pdf-lib and sent as an
 * inline PDF part — no browser, no canvas, no page images.
 */
export const engineOcrChunk = internalAction({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
    chunkIndex: v.number(),
    chunkCount: v.number(),
    pageCount: v.number(),
  },
  handler: async (ctx, args) => {
    const startPage = args.chunkIndex * SCAN_PAGES_PER_CHUNK + 1;
    const endPage = Math.min(args.pageCount, startPage + SCAN_PAGES_PER_CHUNK - 1);
    try {
      const row = await ctx.runQuery(internal.examConversionEngineDispatch.getPaperRow, {
        digitalPaperId: args.digitalPaperId,
      });
      if (!row || row.status !== "processing") return;

      const item = await ctx.runQuery(internal.examConversionEngineDispatch.getItemRow, {
        contentId: args.contentId,
      });
      if (!item) throw new Error("Paper row vanished mid-conversion.");

      const res = await fetch(item.fileUrl);
      if (!res.ok) throw new Error(`Couldn't fetch the paper from storage (${res.status}).`);
      const bytes = new Uint8Array(await res.arrayBuffer());

      // ── Slice pages [startPage..endPage] with pdf-lib (pure JS, proven
      //    in this repo's branding engine).
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const out = await PDFDocument.create();
      const indices: number[] = [];
      for (let p = startPage; p <= endPage; p++) indices.push(p - 1);
      const copied = await out.copyPages(src, indices);
      for (const p of copied) out.addPage(p);
      const sliceBytes = await out.save();
      const sliceBase64 = Buffer.from(sliceBytes).toString("base64");

      const userMessage =
        `SCANNED PAGES ${startPage}–${endPage} OF ${args.pageCount} of an Ethiopian national exam past paper. ` +
        `This document's first page is page ${startPage} of the original paper — for every question, ` +
        `sourcePage = ${startPage} + (position in this document) - 1.`;

      const raw = await callGemini(ctx, {
        systemPrompt: OCR_SYSTEM_PROMPT,
        userMessage,
        pdfBase64: sliceBase64,
        maxTokens: 16384,
        temperature: 0.1,
      });

      const parsed = extractJsonArray(raw);
      const questions: SanitizedQuestion[] = [];
      if (parsed) {
        for (const item2 of parsed) {
          if (item2 && typeof item2 === "object") {
            const q = sanitizeQuestion(item2 as RawQuestion);
            if (q) questions.push(q);
          }
        }
      }

      await ctx.runMutation(internal.examPrepDigital.appendParsedChunk, {
        digitalPaperId: args.digitalPaperId as never,
        chunkIndex: args.chunkIndex,
        chunkCount: args.chunkCount,
        pageCount: args.pageCount,
        fallbackPage: startPage,
        questions: questions as never,
      });

      if (args.chunkIndex >= args.chunkCount - 1) {
        await ctx.runMutation(internal.examPrepDigital.completeDigitization, {
          digitalPaperId: args.digitalPaperId as never,
        });
        console.log(`[exam-engine] OCR ready contentId=${args.contentId}`);
        return;
      }

      await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineOcrChunk, {
        digitalPaperId: args.digitalPaperId,
        contentId: args.contentId,
        chunkIndex: args.chunkIndex + 1,
        chunkCount: args.chunkCount,
        pageCount: args.pageCount,
      });
    } catch (err) {
      const message = (err as Error).message ?? "";
      // Gemini unavailable (region/404) → fall back to the crowd worker's
      // page-image path instead of burning retries on a hopeless provider.
      if (err instanceof GeminiUnavailableError) {
        await ctx.runMutation(internal.examConversionEngineDispatch.failPaperInternal, {
          digitalPaperId: args.digitalPaperId,
          contentId: args.contentId,
          error: `NEEDS_OCR — Gemini unavailable: ${message.slice(0, 200)}`,
          requeueForCrowd: true,
        });
        return;
      }
      if (err instanceof GeminiRateLimitError) {
        await failPaper(ctx, {
          digitalPaperId: args.digitalPaperId,
          contentId: args.contentId,
          error: `OCR rate-limited on pages ${startPage}–${endPage}: ${message.slice(0, 300)}`,
        });
        return;
      }
      await failPaper(ctx, {
        digitalPaperId: args.digitalPaperId,
        contentId: args.contentId,
        error: `Page OCR failed on pages ${startPage}–${endPage}: ${message.slice(0, 300)}`,
      });
    }
  },
});

// ─── Helpers ─────────────────────────────────────────────────────────────

const OCR_SYSTEM_PROMPT = `You are an exam-paper OCR transcription engine for Learnyx Academy ET. You receive scanned pages of an Ethiopian national exam past paper as an inline PDF document.

TASK: transcribe the questions that are legible. Two kinds exist:

1. kind "mcq" — questions with lettered options (A/B/C/D, a) (a), ሀ/ሁ/ለ… mapped to A-D in printed order). Every mcq must have between 2 and 8 options with non-empty text.
2. kind "structured" — numbered questions WITHOUT options: definitions, "show that", "calculate/workout", short-answer, essay prompts. Output options: [] for these.

STRICT RULES:
1. TRANSCRIBE, NEVER INVENT. Only output questions you can actually read. Copy wording verbatim. If part of a question is cut off or too illegible to read, SKIP that question entirely — do not guess.
2. Ignore instructions, cover pages, codes, and anything that is not a question.
3. Figures/diagrams/graphs: transcribe the question text around them — never describe a figure inside the question text.
4. If the pages contain an ANSWER KEY, attach the matching letter to each mcq's "answer"; for structured questions put the provided solution in "suggestedAnswer". Omit when there is no key — do NOT guess.
5. "sourcePage": the ORIGINAL page number in the full paper, as explained in the user message.
6. Output ONLY a JSON array — no prose, no markdown fences.

JSON shape:
[{"number": 1, "kind": "mcq", "text": "...", "passage": "optional", "options": [{"label":"A","text":"..."},...], "answer": "B", "sourcePage": 3}]

structured questions use the same shape with "kind":"structured", "options":[] and optionally "suggestedAnswer".

If the pages contain no complete legible questions, output []`;

/** Download + extract baseline-assembled text for every page. */
async function extractPageTexts(
  ctx: GenericActionCtx<any>,
  fileUrl: string,
): Promise<string[]> {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Couldn't fetch the paper from storage (${res.status}).`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(bytes);
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(assemblePageText(content.items as never));
  }
  return pages;
}

/** The Groq transcription step — identical prompt/chain to the client path. */
async function transcribeChunk(
  ctx: GenericActionCtx<any>,
  opts: {
    chunkText: string;
    chunkIndex: number;
    chunkCount: number;
  },
): Promise<SanitizedQuestion[]> {
  const userMessage = `PAPER CHUNK ${opts.chunkIndex + 1} OF ${opts.chunkCount} (pages of an Ethiopian national exam past paper):\n\n${opts.chunkText.slice(0, 14000)}`;

  const raw = await callGroqWithRetry(
    ctx,
    {
      systemPrompt: SYSTEM_PROMPT,
      userMessage,
      maxTokens: 12288,
      temperature: 0.1,
    },
    TEXT_MODEL_CHAIN,
    2,
  );

  let parsed = extractJsonArray(raw);
  if (parsed === null) {
    // One honest retry — models occasionally wrap the array in prose.
    const retry = await callGroqWithRetry(
      ctx,
      {
        systemPrompt: SYSTEM_PROMPT,
        userMessage: `${userMessage}\n\nYour previous reply was not a parseable JSON array. Return ONLY the JSON array.`,
        maxTokens: 12288,
        temperature: 0,
      },
      TEXT_MODEL_CHAIN,
      2,
    ).catch(() => null);
    parsed = retry ? extractJsonArray(retry) : null;
  }
  if (parsed === null) {
    throw new Error(`The AI response for chunk ${opts.chunkIndex + 1} was not valid JSON.`);
  }

  const questions: SanitizedQuestion[] = [];
  for (const item of parsed) {
    if (item && typeof item === "object") {
      const q = sanitizeQuestion(item as RawQuestion);
      if (q) questions.push(q);
    }
  }
  return questions;
}

/** Fail a paper + its job row (transient error — bounded auto-retry). */
async function failPaper(
  ctx: GenericActionCtx<any>,
  args: { digitalPaperId: Id<"digitalPapers">; contentId: Id<"contentItems">; error: string },
) {
  await ctx.runMutation(internal.examConversionEngineDispatch.failPaperInternal, {
    digitalPaperId: args.digitalPaperId,
    contentId: args.contentId,
    error: args.error,
  });
}

/** Decide the OCR route for a scanned paper and start it. */
async function startOcrPath(
  ctx: GenericActionCtx<any>,
  args: {
    contentId: Id<"contentItems">;
    digitalPaperId: Id<"digitalPapers">;
    bytes: Uint8Array;
    pageCount: number;
  },
) {
  const chunkCount = Math.ceil(args.pageCount / SCAN_PAGES_PER_CHUNK);

  // Gemini configured? (unavailable key → crowd fallback, never crash)
  let geminiAvailable = false;
  try {
    const key = await resolveGeminiKey(ctx);
    geminiAvailable = Boolean(key) && args.bytes.byteLength <= MAX_SCAN_PDF_BYTES;
  } catch {
    geminiAvailable = false;
  }

  if (!geminiAvailable) {
    await ctx.runMutation(internal.examConversionEngineDispatch.failPaperInternal, {
      digitalPaperId: args.digitalPaperId,
      contentId: args.contentId,
      error:
        args.bytes.byteLength > MAX_SCAN_PDF_BYTES
          ? "NEEDS_OCR — scan is too large for server-side OCR; queued for page-image OCR."
          : "NEEDS_OCR — no OCR provider configured; queued for page-image OCR.",
      requeueForCrowd: true,
    });
    return;
  }

  await ctx.runMutation(internal.examPrepDigital.patchPaperProgress, {
    digitalPaperId: args.digitalPaperId,
    pageCount: args.pageCount,
    chunkCount,
  });
  await ctx.scheduler.runAfter(0, internal.examConversionEngine.engineOcrChunk, {
    digitalPaperId: args.digitalPaperId,
    contentId: args.contentId,
    chunkIndex: 0,
    chunkCount,
    pageCount: args.pageCount,
  });
  console.log(
    `[exam-engine] scan OCR chain started contentId=${args.contentId} pages=${args.pageCount} slices=${chunkCount}`,
  );
}
