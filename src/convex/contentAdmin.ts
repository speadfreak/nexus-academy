// Admin content pipeline. Runs in the Convex Node.js runtime ("use node")
"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminAction } from "./admin";
import { requireActiveSubscriptionAction } from "./subscriptions";
import { contentTypeValidator } from "./schema";
import { CONTENT_TYPE_SLUGS, type ContentType } from "./constants";
import { logEventAction } from "./systemEvents";
import {
  deleteFile,
  ensureBucketCors,
  getR2Config,
  type R2Config,
  getPresignedUploadUrl,
  getSignedDownloadUrl,
  keyFromUrl,
  publicUrlForKey,
  uploadFile,
  type R2ConfigOverrides,
} from "./r2";

type ActionErrorData = { message: string; code: string };

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

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return base || "file";
}

function buildKey(stream: string, grade: number, subjectSlug: string, contentType: ContentType, filename: string): string {
  return `${stream}/${grade}/${subjectSlug}/${CONTENT_TYPE_SLUGS[contentType]}/${sanitizeFilename(filename)}`;
}

function contentTypeForFilename(filename: string): string {
  if (/\.pdf$/i.test(filename)) return "application/pdf";
  return "application/octet-stream";
}

function asConvexError(error: unknown, fallback: string): ConvexError<ActionErrorData> {
  if (error instanceof ConvexError) return error;
  return new ConvexError({ message: error instanceof Error ? error.message : fallback, code: "upload_failed" });
}

// ---------------------------------------------------------------------------
// Direct-to-R2 presigned upload URL
// ---------------------------------------------------------------------------

export const getPresignedR2UploadUrl = action({
  args: {
    filename: v.string(), contentType: v.string(), grade: v.number(),
    subjectId: v.id("subjects"), contentSlug: v.string(),
  },
  handler: async (ctx, args): Promise<{ uploadUrl: string; key: string; fileUrl: string }> => {
    await requireAdminAction(ctx);
    const subject: Doc<"subjects"> | null = await ctx.runQuery(internal.content.getSubjectById, { subjectId: args.subjectId });
    if (!subject) throw new ConvexError({ message: "Subject not found.", code: "invalid" });
    const overrides = await getR2Overrides(ctx);
    const config = getR2Config(overrides);
    if (!config.configured) throw new ConvexError({ message: `R2 not configured: ${config.missing.join(", ")}`, code: "storage_not_configured" });
    const key = buildKey(subject.stream, args.grade, subject.slug, args.contentSlug as ContentType, args.filename);
    return getPresignedUploadUrl(key, args.contentType, overrides);
  },
});

// ---------------------------------------------------------------------------
// Finalize upload: insert DB row after browser→R2 direct upload
// ---------------------------------------------------------------------------

export const finalizeUpload = action({
  args: {
    title: v.string(), contentType: contentTypeValidator, grade: v.number(), subjectId: v.id("subjects"),
    examYear: v.optional(v.number()), isPremium: v.boolean(), fileUrl: v.string(),
    sourceName: v.optional(v.string()), sourceUrl: v.optional(v.string()),
    fileSizeBytes: v.number(), filename: v.string(), topicCandidates: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { user: adminUser } = await requireAdminAction(ctx);
    const subject: Doc<"subjects"> | null = await ctx.runQuery(internal.content.getSubjectById, { subjectId: args.subjectId });
    if (!subject) throw new ConvexError({ message: "Subject not found.", code: "invalid" });

    const createdId = await ctx.runMutation(internal.content.insertContentItem, {
      title: args.title.trim(), contentType: args.contentType, grade: args.grade, subjectId: args.subjectId,
      examYear: args.examYear, fileUrl: args.fileUrl, fileSizeBytes: args.fileSizeBytes,
      uploadedBy: adminUser._id, isPremium: args.isPremium,
      sourceName: args.sourceName?.trim() || undefined,
      sourceUrl: args.sourceUrl?.trim() || undefined,
    });

    if (args.topicCandidates && args.topicCandidates.length > 0) {
      await ctx.runMutation(internal.content.linkContentTopics, {
        contentId: createdId, subjectId: args.subjectId, grade: args.grade, topicNames: args.topicCandidates,
      });
    }

    await logEventAction(ctx, {
      eventType: "content_event", source: "contentAdmin.upload", status: "success", userId: adminUser._id,
      metadata: { contentId: createdId, contentType: args.contentType, grade: args.grade, fileSizeBytes: args.fileSizeBytes, topics: args.topicCandidates?.length ?? 0 },
      durationMs: 0,
    });

    await ctx.runAction(internal.telegramActions.postNewContent, {
      title: args.title.trim(), contentType: args.contentType, grade: args.grade, subjectName: subject.name, contentId: createdId,
    }).catch(() => {});

    return { success: true as const };
  },
});

// ---------------------------------------------------------------------------
// Original upload: browser→Convex temp→R2 (kept as fallback)
// ---------------------------------------------------------------------------

export const generateUploadUrl = action({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

export const adminUploadContent = action({
  args: {
    title: v.string(), contentType: contentTypeValidator, grade: v.number(), subjectId: v.id("subjects"),
    examYear: v.optional(v.number()), isPremium: v.boolean(), storageId: v.string(), filename: v.string(),
    topicCandidates: v.optional(v.array(v.string())),
    sourceName: v.optional(v.string()), sourceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user: adminUser } = await requireAdminAction(ctx);
    const subject: Doc<"subjects"> | null = await ctx.runQuery(internal.content.getSubjectById, { subjectId: args.subjectId });
    if (!subject) throw new ConvexError({ message: "Subject not found.", code: "invalid" });

    const storageId = args.storageId as Id<"_storage">;
    const stored = await ctx.storage.get(storageId);
    if (!stored) throw new ConvexError({ message: "File not found in temp storage.", code: "storage" });
    const arrayBuffer = typeof Blob !== "undefined" && stored instanceof Blob ? await stored.arrayBuffer() : (stored as unknown as ArrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    try {
      const overrides = await getR2Overrides(ctx);
      const config = getR2Config(overrides);
      if (!config.configured) throw new ConvexError({ message: `R2 not configured: ${config.missing.join(", ")}`, code: "storage_not_configured" });

      const key = buildKey(subject.stream, args.grade, subject.slug, args.contentType, args.filename);
      const fileUrl = await uploadFile(key, bytes, contentTypeForFilename(args.filename), overrides);
      await ctx.storage.delete(storageId);

      const createdId = await ctx.runMutation(internal.content.insertContentItem, {
        title: args.title.trim(), contentType: args.contentType, grade: args.grade, subjectId: args.subjectId,
        examYear: args.examYear, fileUrl, fileSizeBytes: bytes.byteLength, uploadedBy: adminUser._id, isPremium: args.isPremium,
        sourceName: args.sourceName?.trim() || undefined,
        sourceUrl: args.sourceUrl?.trim() || undefined,
      });

      if (args.topicCandidates && args.topicCandidates.length > 0) {
        await ctx.runMutation(internal.content.linkContentTopics, {
          contentId: createdId, subjectId: args.subjectId, grade: args.grade, topicNames: args.topicCandidates,
        });
      }

      await logEventAction(ctx, {
        eventType: "content_event", source: "contentAdmin.upload", status: "success", userId: adminUser._id,
        metadata: { contentId: createdId, contentType: args.contentType, grade: args.grade, fileSizeBytes: bytes.byteLength, topics: args.topicCandidates?.length ?? 0 },
        durationMs: 0,
      });

      await ctx.runAction(internal.telegramActions.postNewContent, {
        title: args.title.trim(), contentType: args.contentType, grade: args.grade, subjectName: subject.name, contentId: createdId,
      }).catch(() => {});

      return { success: true as const };
    } catch (error) { throw asConvexError(error, "Upload failed"); }
  },
});

// ---------------------------------------------------------------------------
// Update content item metadata (no file change)
// ---------------------------------------------------------------------------

export const updateContentItem = action({
  args: {
    contentId: v.id("contentItems"),
    title: v.optional(v.string()),
    grade: v.optional(v.number()),
    subjectId: v.optional(v.id("subjects")),
    contentType: v.optional(contentTypeValidator),
    examYear: v.optional(v.number()),
    isPremium: v.optional(v.boolean()),
    sourceName: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
  },
 handler: async (ctx, args) => {
    const { user: adminUser } = await requireAdminAction(ctx);

    // Verify item exists via a query
    const item = await ctx.runQuery(internal.content.getContentItemById, { contentId: args.contentId });
    if (!item) throw new ConvexError({ message: "Content item not found.", code: "not_found" });

    const { contentId, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.title = updates.title.trim();
    if (updates.grade !== undefined) patch.grade = updates.grade;
    if (updates.subjectId !== undefined) patch.subjectId = updates.subjectId;
    if (updates.contentType !== undefined) patch.contentType = updates.contentType;
    if (updates.isPremium !== undefined) patch.isPremium = updates.isPremium;
    if (updates.sourceName !== undefined) patch.sourceName = updates.sourceName?.trim() || undefined;
    if (updates.sourceUrl !== undefined) patch.sourceUrl = updates.sourceUrl?.trim() || undefined;
    if (updates.examYear !== undefined) patch.examYear = updates.examYear;

    if (Object.keys(patch).length > 0) {
      await ctx.runMutation(internal.content.updateContentItem, { contentId: args.contentId, patch });
    }

    await logEventAction(ctx, {
      eventType: "content_event", source: "contentAdmin.update", status: "success",
      userId: adminUser._id,
      metadata: { contentId, updatedFields: Object.keys(patch) }, durationMs: 0,
    });

    return { success: true as const };
  },
});

// ---------------------------------------------------------------------------
// Delete content item + R2 file
// ---------------------------------------------------------------------------

export const deleteContentItem = action({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const { user: adminUser } = await requireAdminAction(ctx);
    const item: Doc<"contentItems"> | null = await ctx.runQuery(internal.content.getContentItemById, { contentId: args.contentId });
    if (!item) throw new ConvexError({ message: "Content item not found.", code: "not_found" });

    let r2Error: string | null = null;
    if (item.fileUrl) {
      try {
        const overrides = await getR2Overrides(ctx);
        const key = keyFromUrl(item.fileUrl, overrides);
        if (key) await deleteFile(key, overrides);
      } catch (err) { r2Error = err instanceof Error ? err.message : "R2 delete failed"; }
    }

    await ctx.runMutation(internal.content.deleteContentRow, { contentId: args.contentId });

    // Audit log
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId: adminUser._id,
      action: "content.deleted",
      targetType: "content",
      targetId: args.contentId,
      details: JSON.stringify({ title: item.title, contentType: item.contentType }),
    }).catch(() => {});

    return { success: true, r2Error };
  },
});

// ---------------------------------------------------------------------------
// Signed download URL (premium content gating)
// ---------------------------------------------------------------------------

export const getDownloadUrl = action({
  args: { contentId: v.id("contentItems") },
  returns: v.object({ url: v.string() }),
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const item: Doc<"contentItems"> | null = await ctx.runQuery(internal.content.getContentItemById, { contentId: args.contentId });
    if (!item) throw new ConvexError({ message: "Not found.", code: "not_found" });

    if (item.isPremium) {
      await requireActiveSubscriptionAction(ctx, userId);
    }

    // Return the public R2 URL directly — signed URLs cause CORS issues
    // with browser PDF readers (react-pdf / pdf.js).
    return { url: item.fileUrl };
  },
});

// ---------------------------------------------------------------------------
// R2 configuration status
// ---------------------------------------------------------------------------

export const getR2Status = action({
  args: {},
  handler: async (ctx): Promise<R2Config> => {
    const overrides = await getR2Overrides(ctx);
    return getR2Config(overrides);
  },
});

// ---------------------------------------------------------------------------
// Ensure R2 CORS (enables PDF.js range requests for fast streaming)
// ---------------------------------------------------------------------------

export const ensureR2Cors = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    await requireAdminAction(ctx);
    const overrides = await getR2Overrides(ctx);
    await ensureBucketCors(overrides);
    return { ok: true };
  },
});
