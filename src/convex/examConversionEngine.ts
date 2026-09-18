"use node";
// examConversionEngine — the DETERMINISTIC conversion engine. Zero AI.
//
// THE THIRD ARCHITECTURE: conversion started in students' browsers (visible
// queues, AI rate walls), moved server-side (invisible but still rate-
// limited), and is now a pure PATTERN-MATCHING problem — because real past
// exam papers have a highly predictable structure (numbered questions,
// lettered options, answer keys). This module runs that parser:
//
//   • engineConvert — downloads the PDF, extracts layout-aware reading
//     order (examLayout.ts: two-column aware), and either:
//       - TEXT PATH: parses questions deterministically (examParser.ts),
//         merges the linked answer-key PDF's key when the item has one,
//         and completes the paper — in ONE action, typically seconds.
//       - SCAN PATH (no usable text layer): stamps the row as a scan and
//         waits for page text produced by Tesseract.js OCR running in a
//         browser tab (no cloud AI, no quotas) — finalizeOcrPaper then
//         feeds that text through the EXACT SAME deterministic parser.
//
//   • finalizeOcrPaper — parses a completed scan's OCR page texts and
//     completes the paper with the same confidence/review semantics.
//
// NOTHING here calls Groq or Gemini. The rate-lane orchestrator, the
// pause-and-resume cooldown logic, the crowd-worker browser system, and
// the vision transcription chains were all DELETED — determinism replaced
// them. (The general Groq/Gemini clients remain for Tutor / Quizzes /
// Flashcards / Mock Exam, which are unrelated features.)

import { getDocumentProxy } from "unpdf";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { GenericActionCtx } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  assemblePageTextLayout,
} from "../lib/examLayout";
import {
  extractAnswerKey,
  mergeAnswerKey,
  parseExam,
  type ParsedQuestion,
  type ParserMeta,
} from "../lib/examParser";
import { TEXT_LAYER_THRESHOLD_AVG } from "../lib/pdfTextShared";

/** Papers larger than this fail honestly instead of ballooning memory. */
const MAX_PDF_BYTES = 60 * 1024 * 1024;
/** Answer-key PDFs get the same guard. */
const MAX_KEY_PDF_BYTES = 40 * 1024 * 1024;

// ─── Small reads (actions have no direct db access) ─────────────────────

async function getItem(ctx: GenericActionCtx<any>, contentId: string) {
  return ctx.runQuery(internal.examConversionEngineDispatch.getItemRow, {
    contentId: contentId as never,
  });
}

async function getPaper(ctx: GenericActionCtx<any>, digitalPaperId: string) {
  return ctx.runQuery(internal.examConversionEngineDispatch.getPaperRow, {
    digitalPaperId: digitalPaperId as never,
  });
}

/** Download + extract layout-ordered text for every page. */
async function extractLayoutPages(
  fileUrl: string,
): Promise<{ pages: string[]; pageCount: number; avgChars: number }> {
  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Couldn't fetch the paper from storage (${res.status}).`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const pdf = await getDocumentProxy(bytes);
  const pageCount = pdf.numPages;
  const pages: string[] = [];
  let totalChars = 0;
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = assemblePageTextLayout(content.items as never);
    pages.push(text);
    totalChars += text.length;
  }
  return { pages, pageCount, avgChars: pageCount > 0 ? totalChars / pageCount : 0 };
}

/**
 * Convert one claimed paper. Deterministic end to end: no provider, no
 * queue visible to anyone, no token budget — the only inputs are the PDF
 * bytes and the parser.
 */
export const engineConvert = internalAction({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    try {
      const item = await getItem(ctx, args.contentId);
      if (!item) throw new Error("Paper row vanished before conversion.");
      const row = await getPaper(ctx, args.digitalPaperId);
      if (!row || row.status !== "processing") return; // superseded — bail quietly

      const res = await fetch(item.fileUrl);
      if (!res.ok) {
        throw new Error(`Couldn't fetch the paper from storage (${res.status}).`);
      }
      const byteLength = Number(res.headers.get("content-length") ?? 0);
      if (byteLength > MAX_PDF_BYTES) {
        throw new Error(
          `The PDF is ${Math.round(byteLength / 1e6)}MB — beyond the convertible range.`,
        );
      }

      const extracted = await extractLayoutPages(item.fileUrl);

      await ctx.runMutation(internal.examPrepDigital.patchPaperProgress, {
        digitalPaperId: args.digitalPaperId as never,
        pageCount: extracted.pageCount,
        chunkCount: extracted.pageCount,
      });

      // ── SCANNED PAPER → client-side Tesseract.js OCR route ──
      if (extracted.avgChars < TEXT_LAYER_THRESHOLD_AVG) {
        await ctx.runMutation(internal.examPrepDigital.markScanRoute, {
          digitalPaperId: args.digitalPaperId as never,
          contentId: args.contentId as never,
          pageCount: extracted.pageCount,
        });
        console.log(
          `[exam-engine] scan route contentId=${args.contentId} pages=${extracted.pageCount} avg=${Math.round(extracted.avgChars)} chars`,
        );
        return { route: "scan" as const, pageCount: extracted.pageCount };
      }

      // ── TEXT-LAYER PAPER → parse right now ──
      const parsed = parseExam(extracted.pages);
      const outcome = await finishParsed(ctx, {
        contentId: args.contentId,
        digitalPaperId: args.digitalPaperId,
        parsed,
        pageCount: extracted.pageCount,
        sourceMode: "text",
        answerKeyContentId: item.answerKeyContentId ?? null,
        startedAt: started,
      });
      console.log(
        `[exam-engine] ${outcome} contentId=${args.contentId} pages=${extracted.pageCount} ms=${Date.now() - started}`,
      );
      return { route: "text" as const, outcome };
    } catch (err) {
      await ctx.runMutation(internal.examPrepDigital.failDeterministic, {
        digitalPaperId: args.digitalPaperId as never,
        contentId: args.contentId as never,
        error: `Conversion failed: ${(err as Error).message.slice(0, 300)}`,
        reviewStatus: "needs_review",
      });
      console.log(
        `[exam-engine] failed contentId=${args.contentId} ms=${Date.now() - started}: ${(err as Error).message}`,
      );
    }
  },
});

/**
 * A browser tab finished OCR-ing every page of a scanned paper. Run the
 * SAME deterministic parser over the OCR text and complete the paper.
 */
export const finalizeOcrPaper = internalAction({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    contentId: v.id("contentItems"),
  },
  handler: async (ctx, args) => {
    const started = Date.now();
    try {
      const item = await getItem(ctx, args.contentId);
      if (!item) throw new Error("Paper row vanished before OCR finalize.");
      const row = await getPaper(ctx, args.digitalPaperId);
      if (!row || row.status !== "processing") return;

      const ocrPages: string[] = row.ocrPages ?? [];
      const parsed = parseExam(ocrPages);
      const outcome = await finishParsed(ctx, {
        contentId: args.contentId,
        digitalPaperId: args.digitalPaperId,
        parsed,
        pageCount: row.pageCount ?? ocrPages.length,
        sourceMode: "scan",
        answerKeyContentId: item.answerKeyContentId ?? null,
        startedAt: started,
      });
      console.log(
        `[exam-engine] OCR ${outcome} contentId=${args.contentId} pages=${ocrPages.length} ms=${Date.now() - started}`,
      );
    } catch (err) {
      await ctx.runMutation(internal.examPrepDigital.failDeterministic, {
        digitalPaperId: args.digitalPaperId as never,
        contentId: args.contentId as never,
        error: `OCR parse failed: ${(err as Error).message.slice(0, 300)}`,
        reviewStatus: "needs_review",
      });
    }
  },
});

// ─── Shared completion path ─────────────────────────────────────────────

async function fetchLinkedAnswerKey(
  ctx: GenericActionCtx<any>,
  answerKeyContentId: string,
): Promise<Map<number, string>> {
  const keyItem = await getItem(ctx, answerKeyContentId);
  if (!keyItem) return new Map();
  try {
    const res = await fetch(keyItem.fileUrl);
    if (!res.ok) return new Map();
    const size = Number(res.headers.get("content-length") ?? 0);
    if (size > MAX_KEY_PDF_BYTES) return new Map();
    const extracted = await extractLayoutPages(keyItem.fileUrl);
    const key = extractAnswerKey(extracted.pages);
    return key?.map ?? new Map();
  } catch {
    return new Map(); // a broken key PDF never fails the questions paper
  }
}

async function finishParsed(
  ctx: GenericActionCtx<any>,
  args: {
    contentId: string;
    digitalPaperId: string;
    parsed:
      | { kind: "questions"; questions: ParsedQuestion[]; meta: ParserMeta; confidence: number; reviewStatus: "auto" | "needs_review" }
      | { kind: "answer_key_document"; keyCount: number; meta: { answerKeySource: string } };
    pageCount: number;
    sourceMode: "text" | "scan";
    answerKeyContentId: string | null;
    startedAt: number;
  },
): Promise<string> {
  // ── An answer-key document: nothing to play — park it honestly. ──
  if (args.parsed.kind === "answer_key_document") {
    await ctx.runMutation(internal.examPrepDigital.failDeterministic, {
      digitalPaperId: args.digitalPaperId as never,
      contentId: args.contentId as never,
      error: `ANSWER_KEY_DOCUMENT — this PDF is an answer key (${args.parsed.keyCount} answers, no questions). Link it to its questions paper via the answer-key field, or let students read the original PDF.`,
      reviewStatus: "pdf_only",
    });
    return "answer_key_document";
  }

  const parsed = args.parsed;

  // ── Zero questions: a deterministic dead end. Park for review. ──
  if (parsed.questions.length === 0) {
    await ctx.runMutation(internal.examPrepDigital.failDeterministic, {
      digitalPaperId: args.digitalPaperId as never,
      contentId: args.contentId as never,
      error:
        "The parser couldn't match any question structure in this paper. An admin can review the original PDF or re-run after fixing the source file.",
      reviewStatus: "needs_review",
    });
    return "no_questions";
  }

  // ── Merge the linked answer-key PDF's key (deterministic, by number) ──
  let meta: ParserMeta = parsed.meta;
  if (args.answerKeyContentId) {
    const key = await fetchLinkedAnswerKey(ctx, args.answerKeyContentId);
    if (key.size > 0) {
      const merged = mergeAnswerKey(parsed.questions, key);
      meta = {
        ...meta,
        answerKeySource: "linked_pdf",
        answerKeyCount: meta.answerKeyCount + merged,
      };
    }
  }

  // Renumber 1..N in paper order (answers were mapped by printed number
  // BEFORE renumbering, inside the parser).
  const questions = parsed.questions.map((q, i) => ({ ...q, number: i + 1 }));

  await ctx.runMutation(internal.examPrepDigital.completeDeterministic, {
    digitalPaperId: args.digitalPaperId as never,
    contentId: args.contentId as never,
    questions: questions as never,
    pageCount: args.pageCount,
    sourceMode: args.sourceMode,
    confidence: parsed.confidence,
    reviewStatus: parsed.reviewStatus,
    parserMeta: {
      numberingStyle: meta.numberingStyle,
      optionStyle: meta.optionStyle,
      answerKeySource: meta.answerKeySource,
      answerKeyCount: meta.answerKeyCount,
      flaggedDiagrams: meta.flaggedDiagrams,
    },
  });
  return `ready ${questions.length}Q conf=${parsed.confidence}`;
}

/** Unused guard against accidental AI imports creeping back in. */
export const PARSER_IS_DETERMINISTIC = true;
type IdUnused = Id<"contentItems">; // eslint-disable-line @typescript-eslint/no-unused-vars
