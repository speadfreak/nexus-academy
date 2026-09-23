// Large-PDF splitting pipeline (Convex side).
//
// STEP 2 of the large-textbook fix: pre-split oversized PDFs ONCE into
// sequential chunk PDFs in R2, recorded as a pdfChunks manifest on the
// contentItems row. The reader then fetches only the chunk containing the
// current page (plus a background pre-fetch) instead of streaming a 170MB
// file end-to-end. See src/lib/pdfSplitCore.ts for the pure logic and the
// measured evidence that motivated this.
//
// Entry points:
//   internalSplitLargePdf — the engine. Downloads the original from R2,
//     splits, uploads chunks, writes the manifest. Also callable via CLI
//     with a deploy key for retroactive processing of already-uploaded
//     files (idempotent: re-runs from scratch with a fresh token if a
//     previous attempt died mid-flight — additive-only, nothing destructive).
//   adminSplitLargePdf — admin-authenticated wrapper (Admin panel button).
//   adminListSplitBacklog — items above the threshold with no manifest yet.
"use node";

import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { pdfChunkManifest } from "./schema";
import { requireAdminAction } from "./admin";
import { logEventAction } from "./systemEvents";
import {
  deleteFile,
  downloadFile,
  getR2Config,
  keyFromUrl,
  uploadFile,
  type R2ConfigOverrides,
} from "./r2";
import {
  computePagesPerChunk,
  makeChunkToken,
  chunkKeyFor,
  splitPdfIntoChunkBuffers,
  SPLIT_THRESHOLD_BYTES,
  shouldSplit,
} from "../lib/pdfSplitCore";

async function getR2Overrides(ctx: any): Promise<R2ConfigOverrides> {
  const stored = await ctx.runQuery(internal.configKeys.getR2KeyValues);
  return {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID || stored.R2_ACCOUNT_ID || undefined,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID || stored.R2_ACCESS_KEY_ID || undefined,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY || stored.R2_SECRET_ACCESS_KEY || undefined,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME || stored.R2_BUCKET_NAME || undefined,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL || stored.R2_PUBLIC_URL || undefined,
  };
}

// ── Manifest management ────────────────────────────────────────────────
// NOTE: mutations must live in the DEFAULT runtime ("use node" files may
// only define actions), so they live in content.ts.

/** Admin action to clear a manifest (e.g. after a bad split). */
export const adminClearPdfChunks = action({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => {
    await requireAdminAction(ctx);
    await ctx.runMutation(internal.content.internalClearPdfChunks, { contentId });
    return { cleared: true as const };
  },
});

// ── The engine ─────────────────────────────────────────────────────────
//
// Idempotent from scratch: if a previous run died mid-flight, re-running
// re-downloads + re-splits (deterministic) and uploads chunks under a fresh
// random token folder. Old orphaned chunk objects are harmless garbage and
// can be cleaned up in R2 manually if ever needed. The original file is
// NEVER deleted unless deleteOriginal is explicitly true.

export const internalSplitLargePdf = internalAction({
  args: {
    contentId: v.id("contentItems"),
    deleteOriginal: v.optional(v.boolean()),
  },
  handler: async (ctx, { contentId, deleteOriginal }) => {
    const startedAt = Date.now();
    const overrides = await getR2Overrides(ctx);
    const config = getR2Config(overrides);
    if (!config.configured) {
      throw new ConvexError({
        message: `R2 not configured: ${config.missing.join(", ")}`,
        code: "storage_not_configured",
      });
    }

    const item: any = await ctx.runQuery(internal.content.getContentItemById, { contentId });
    if (!item) throw new ConvexError({ message: "Content item not found.", code: "not_found" });
    if (item.pdfChunks) {
      return { alreadySplit: true as const, chunkCount: item.pdfChunks.chunkCount };
    }

    const sourceKey = keyFromUrl(item.fileUrl, overrides);
    if (!sourceKey) {
      throw new ConvexError({
        message: `Cannot derive R2 key from fileUrl: ${item.fileUrl}`,
        code: "invalid",
      });
    }

    // 1. Download the original from R2.
    const originalBytes = await downloadFile(sourceKey, overrides);
    const originalSize = originalBytes.byteLength;
    if (!shouldSplit(originalSize)) {
      return {
        skipped: true as const,
        reason: `File is ${(originalSize / 1048576).toFixed(1)} MB — below the ${SPLIT_THRESHOLD_BYTES / 1048576} MB threshold.`,
      };
    }

    // 2. Split (deterministic). pagesPerChunk is computed INSIDE the split
    // core from the REAL page count — stored pageCount fields are often
    // missing on legacy rows and estimates produce badly-sized chunks.
    const chunks = await splitPdfIntoChunkBuffers(originalBytes, {
      title: item.title,
    });
    const pagesPerChunk = computePagesPerChunk(chunks[chunks.length - 1].endPage, originalSize);
    const token = makeChunkToken();
    const totalPageCount = chunks[chunks.length - 1].endPage;

    // 4. Upload chunks sequentially.
    const manifestChunks: {
      url: string;
      startPage: number;
      endPage: number;
      sizeBytes: number;
    }[] = [];
    let totalChunkBytes = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const key = chunkKeyFor(sourceKey, i, token);
      const url = await uploadFile(key, c.bytes, "application/pdf", overrides);
      totalChunkBytes += c.bytes.byteLength;
      manifestChunks.push({
        url,
        startPage: c.startPage,
        endPage: c.endPage,
        sizeBytes: c.bytes.byteLength,
      });
      // Release the chunk buffer reference as we go — keeps peak heap lower.
      chunks[i] = null as unknown as (typeof chunks)[number];
    }

    // 5. Write the manifest — the reader switches to chunked mode the
    // moment this field exists.
    const manifest = {
      token,
      chunkCount: manifestChunks.length,
      pagesPerChunk,
      totalPageCount,
      totalChunkBytes,
      chunks: manifestChunks,
      createdAt: Date.now(),
    };
    await ctx.runMutation(internal.content.internalSetPdfChunks, { contentId, manifest });

    // 6. Optionally remove the original (never by default — additive only).
    if (deleteOriginal === true) {
      await deleteFile(sourceKey, overrides).catch(() => {});
    }

    await logEventAction(ctx, {
      eventType: "content_event",
      source: "pdfSplitter.internalSplitLargePdf",
      status: "success",
      metadata: {
        contentId,
        originalSize,
        chunkCount: manifestChunks.length,
        pagesPerChunk,
        totalPageCount,
        totalChunkBytes,
      },
      durationMs: Date.now() - startedAt,
    });

    return {
      alreadySplit: false as const,
      chunkCount: manifestChunks.length,
      pagesPerChunk,
      totalPageCount,
      originalSize,
      totalChunkBytes,
      durationMs: Date.now() - startedAt,
    };
  },
});

// ── Admin wrappers (panel-facing) ──────────────────────────────────────

export type SplitLargePdfResult =
  | { alreadySplit: true; chunkCount: number }
  | { skipped: true; reason: string }
  | {
      alreadySplit: false;
      chunkCount: number;
      pagesPerChunk: number;
      totalPageCount: number;
      originalSize: number;
      totalChunkBytes: number;
      durationMs: number;
    };

export interface SplitBacklogItem {
  _id: string;
  title: string;
  contentType: string;
  grade: number;
  fileSizeBytes: number;
  pageCount: number | null;
  isPremium: boolean;
}

export const adminSplitLargePdf = action({
  args: {
    contentId: v.id("contentItems"),
  },
  handler: async (ctx, args): Promise<SplitLargePdfResult> => {
    await requireAdminAction(ctx);
    return ctx.runAction(internal.pdfSplitter.internalSplitLargePdf, args);
  },
});

/** Items at/above the threshold with no manifest — the retroactive backlog. */
export const adminListSplitBacklog = action({
  args: {},
  handler: async (ctx): Promise<SplitBacklogItem[]> => {
    await requireAdminAction(ctx);
    return ctx.runQuery(internal.content.listSplitBacklog, {});
  },
});
