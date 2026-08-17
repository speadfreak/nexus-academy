// Admin content pipeline. Runs in the Convex Node.js runtime ("use node")
// because it talks to Cloudflare R2 (AWS SDK) and reads process.env.
"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminAction } from "./admin";
import { requireActiveSubscriptionAction } from "./subscriptions";
import { contentTypeValidator } from "./schema";
import { CONTENT_TYPE_SLUGS, type ContentType } from "./constants";
import {
  deleteFile,
  getR2Config,
  getSignedDownloadUrl,
  keyFromUrl,
  uploadFile,
} from "./r2";

type ActionErrorData = { message: string; code: string };

type UploadedContent = {
  id: Id<"contentItems">;
  title: string;
  contentType: ContentType;
  grade: number;
  subjectId: Id<"subjects">;
  examYear: number | null;
  fileUrl: string;
  fileSizeBytes: number;
  isPremium: boolean;
  createdAt: number;
  subjectName: string;
  subjectSlug: string;
  subjectStream: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFilename(name: string): string {
  const base = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return base || "file";
}

/**
 * Human-browsable R2 key layout:
 *   {stream}/{grade}/{subject-slug}/{content-type}/{filename}
 * e.g. natural/11/physics/past-exam/2023-physics-national-exam.pdf
 */
function buildKey(
  stream: string,
  grade: number,
  subjectSlug: string,
  contentType: ContentType,
  filename: string,
): string {
  return `${stream}/${grade}/${subjectSlug}/${CONTENT_TYPE_SLUGS[contentType]}/${sanitizeFilename(filename)}`;
}

function contentTypeForFilename(filename: string): string {
  if (/\.pdf$/i.test(filename)) return "application/pdf";
  return "application/octet-stream";
}

function asConvexError(error: unknown, fallback: string): ConvexError<ActionErrorData> {
  if (error instanceof ConvexError) return error;
  const message = error instanceof Error ? error.message : fallback;
  return new ConvexError({ message, code: "upload_failed" });
}

// ---------------------------------------------------------------------------
// Admin upload: validate -> R2 -> DB row
// ---------------------------------------------------------------------------

export const adminUploadContent = action({
  args: {
    title: v.string(),
    contentType: contentTypeValidator,
    grade: v.number(),
    subjectId: v.id("subjects"),
    examYear: v.optional(v.number()),
    isPremium: v.boolean(),
    storageId: v.string(), // Id of the blob in Convex temp storage
    filename: v.string(),
  },
  handler: async (ctx, args): Promise<UploadedContent> => {
    const adminUser = await requireAdminAction(ctx);

    // --- Validation -----------------------------------------------------
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError({ message: "Title is required.", code: "invalid" });
    }
    if (!Number.isInteger(args.grade) || args.grade < 9 || args.grade > 12) {
      throw new ConvexError({
        message: "Grade must be one of 9, 10, 11, 12.",
        code: "invalid",
      });
    }
    if (args.examYear !== undefined && args.contentType !== "past_exam") {
      throw new ConvexError({
        message: "exam_year is only allowed when content_type is past_exam.",
        code: "invalid",
      });
    }

    const subject: Doc<"subjects"> | null = await ctx.runQuery(
      internal.content.getSubjectById,
      { subjectId: args.subjectId },
    );
    if (!subject) {
      throw new ConvexError({ message: "Subject not found.", code: "invalid" });
    }

    // --- Read file bytes from Convex temp storage -----------------------
    const storageId = args.storageId as Id<"_storage">;
    const stored = await ctx.storage.get(storageId);
    if (!stored) {
      throw new ConvexError({
        message: "Upload failed: file not found in temporary storage.",
        code: "storage",
      });
    }
    const arrayBuffer =
      typeof Blob !== "undefined" && stored instanceof Blob
        ? await stored.arrayBuffer()
        : (stored as unknown as ArrayBuffer);
    const bytes = new Uint8Array(arrayBuffer);

    // --- Upload to R2, then persist the DB row --------------------------
    try {
      const r2 = getR2Config();
      if (!r2.configured) {
        throw new ConvexError({
          message: `R2 storage is not configured yet. Add these keys in the project's Keys/API keys tab: ${r2.missing.join(", ")}`,
          code: "storage_not_configured",
        });
      }

      const key = buildKey(
        subject.stream,
        args.grade,
        subject.slug,
        args.contentType,
        args.filename,
      );
      const fileUrl = await uploadFile(
        key,
        bytes,
        contentTypeForFilename(args.filename),
      );
      // Temp blob is no longer needed now that the file lives in R2.
      await ctx.storage.delete(storageId);

      const createdId: Id<"contentItems"> = await ctx.runMutation(
        internal.content.insertContentItem,
        {
          title,
          contentType: args.contentType,
          grade: args.grade,
          subjectId: args.subjectId,
          examYear: args.examYear,
          fileUrl,
          fileSizeBytes: bytes.byteLength,
          uploadedBy: adminUser._id,
          isPremium: args.isPremium,
        },
      );

      return {
        id: createdId,
        title,
        contentType: args.contentType,
        grade: args.grade,
        subjectId: args.subjectId,
        examYear: args.examYear ?? null,
        fileUrl,
        fileSizeBytes: bytes.byteLength,
        isPremium: args.isPremium,
        createdAt: Date.now(),
        subjectName: subject.name,
        subjectSlug: subject.slug,
        subjectStream: subject.stream,
      };
    } catch (error) {
      // Never leave an orphan blob in temp storage.
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // ignore cleanup failure
      }
      throw asConvexError(error, "Upload failed. Check the R2 configuration.");
    }
  },
});

// ---------------------------------------------------------------------------
// Admin delete: R2 object + DB row
// ---------------------------------------------------------------------------

export const deleteContentItem = action({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => {
    await requireAdminAction(ctx);

    const item: Doc<"contentItems"> | null = await ctx.runQuery(
      internal.content.getContentItemById,
      { contentId },
    );
    if (!item) {
      throw new ConvexError({ message: "Content item not found.", code: "not_found" });
    }

    let r2Error: string | null = null;
    try {
      const key = keyFromUrl(item.fileUrl);
      if (key) await deleteFile(key);
    } catch (error) {
      r2Error =
        error instanceof Error
          ? `R2 deletion failed (${error.message}). The database row was still removed.`
          : "R2 deletion failed. The database row was still removed.";
    }

    await ctx.runMutation(internal.content.deleteContentRow, { contentId });
    return { ok: true, r2Error };
  },
});

// ---------------------------------------------------------------------------
// Download URL: direct for free content, signed (time-limited) for premium
// ---------------------------------------------------------------------------

export const getDownloadUrl = action({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required to download.", code: "unauthorized" });
    }

    const item: Doc<"contentItems"> | null = await ctx.runQuery(
      internal.content.getContentItemById,
      { contentId },
    );
    if (!item) {
      throw new ConvexError({ message: "Content item not found.", code: "not_found" });
    }

    if (!item.isPremium) {
      return { url: item.fileUrl };
    }

    // Premium downloads require trial or active subscription access. The
    // reason tells the client to show the contextual "premium_content"
    // prompt instead of a generic paywall.
    await requireActiveSubscriptionAction(ctx, userId, "premium_content");

    try {
      const key = keyFromUrl(item.fileUrl);
      if (!key) {
        throw new Error("Could not resolve the R2 object key for this item.");
      }
      const url = await getSignedDownloadUrl(key);
      return { url };
    } catch (error) {
      throw asConvexError(
        error,
        "R2 storage is not configured. Add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and R2_PUBLIC_URL in the Keys tab.",
      );
    }
  },
});

// ---------------------------------------------------------------------------
// R2 configuration status (shown on the admin page)
// ---------------------------------------------------------------------------

export const getR2Status = action({
  args: {},
  handler: async () => {
    return getR2Config();
  },
});
