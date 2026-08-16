import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { isAdmin } from "./admin";
import { contentTypeValidator } from "./schema";

export type ContentItem = Doc<"contentItems">;
export type ContentItemWithSubject = ContentItem & {
  subjectName: string;
  subjectSlug: string;
  subjectStream: string;
};

// ---------------------------------------------------------------------------
// Upload plumbing
// ---------------------------------------------------------------------------

/** Client uploads the file bytes to Convex temp storage with this URL. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/** Internal (action-only) insert of a fully validated content item row. */
export const insertContentItem = internalMutation({
  args: {
    title: v.string(),
    contentType: contentTypeValidator,
    grade: v.number(),
    subjectId: v.id("subjects"),
    examYear: v.optional(v.number()),
    fileUrl: v.string(),
    fileSizeBytes: v.optional(v.number()),
    uploadedBy: v.optional(v.id("users")),
    isPremium: v.boolean(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("contentItems", {
      title: args.title,
      contentType: args.contentType,
      grade: args.grade,
      subjectId: args.subjectId,
      examYear: args.examYear,
      fileUrl: args.fileUrl,
      fileSizeBytes: args.fileSizeBytes,
      uploadedBy: args.uploadedBy,
      isPremium: args.isPremium,
      createdAt: Date.now(),
    });
    return id;
  },
});

/** Internal (action-only) removal of a content item + its topic links. */
export const deleteContentRow = internalMutation({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => {
    const links = await ctx.db
      .query("contentTopics")
      .withIndex("by_content", (q) => q.eq("contentId", contentId))
      .collect();
    for (const link of links) {
      await ctx.db.delete(link._id);
    }
    await ctx.db.delete(contentId);
  },
});

// ---------------------------------------------------------------------------
// Internal read helpers (used by node actions via ctx.runQuery)
// ---------------------------------------------------------------------------

export const getSubjectById = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) =>
    (await ctx.db.get(subjectId)) ?? null,
});

export const getContentItemById = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) =>
    (await ctx.db.get(contentId)) ?? null,
});

// ---------------------------------------------------------------------------
// Shared join helper
// ---------------------------------------------------------------------------

async function withSubjects(
  ctx: QueryCtx,
  items: ContentItem[],
): Promise<ContentItemWithSubject[]> {
  const cache = new Map<string, Doc<"subjects">>();
  const result: ContentItemWithSubject[] = [];
  for (const item of items) {
    let subject = cache.get(item.subjectId);
    if (!subject) {
      subject = (await ctx.db.get(item.subjectId)) ?? undefined;
      if (subject) cache.set(item.subjectId, subject);
    }
    result.push({
      ...item,
      subjectName: subject?.name ?? "Unknown",
      subjectSlug: subject?.slug ?? "",
      subjectStream: subject?.stream ?? "common",
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public read API (student dashboard / library browser)
// ---------------------------------------------------------------------------

/**
 * Lightweight metadata for a content item — used by the tutor page to show
 * the "Discussing: …" chip when a chat is grounded in a library document.
 */
export const getContentItemMeta = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => {
    const item = await ctx.db.get(contentId);
    if (!item) return null;
    const subject = item.subjectId ? await ctx.db.get(item.subjectId) : null;
    return {
      _id: item._id,
      title: item.title,
      contentType: item.contentType,
      examYear: item.examYear ?? null,
      grade: item.grade,
      subjectName: subject?.name ?? "Unknown",
    };
  },
});

/**
 * Public library query. Supports any combination of grade, subject slug,
 * content type, and exam year. Returns items newest-first with the subject
 * name/slug/stream joined in. This is the generic read side the student
 * library browser consumes.
 */
export const getContent = query({
  args: {
    grade: v.optional(v.number()),
    subjectSlug: v.optional(v.string()),
    contentType: v.optional(contentTypeValidator),
    examYear: v.optional(v.number()),
    searchQuery: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ContentItemWithSubject[]> => {
    const { grade, subjectSlug, contentType, examYear, searchQuery } = args;

    let subject: Doc<"subjects"> | null = null;
    if (subjectSlug) {
      subject =
        (await ctx.db
          .query("subjects")
          .withIndex("by_slug", (q) => q.eq("slug", subjectSlug))
          .unique()) ?? null;
    }

    const hasFilters =
      grade !== undefined ||
      subject !== null ||
      contentType !== undefined ||
      examYear !== undefined;

    let items: ContentItem[];
    if (hasFilters) {
      items = await ctx.db
        .query("contentItems")
        .filter((q) => {
          const conds = [];
          if (grade !== undefined) conds.push(q.eq(q.field("grade"), grade));
          if (subject !== null) conds.push(q.eq(q.field("subjectId"), subject._id));
          if (contentType !== undefined) conds.push(q.eq(q.field("contentType"), contentType));
          if (examYear !== undefined) conds.push(q.eq(q.field("examYear"), examYear));
          return conds.length === 1 ? conds[0]! : q.and(...conds);
        })
        .order("desc")
        .take(200);
    } else {
      items = await ctx.db.query("contentItems").order("desc").take(200);
    }

    const joined = await withSubjects(ctx, items);

    // Free-text search over title and subject name (case-insensitive).
    // Applied after the structural filters; catalog scale is small enough that
    // this stays fast without a dedicated search index.
    const query = searchQuery?.trim().toLowerCase();
    if (query) {
      return joined.filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.subjectName.toLowerCase().includes(query),
      );
    }

    return joined;
  },
});

// ---------------------------------------------------------------------------
// Admin read API
// ---------------------------------------------------------------------------

/**
 * Admin-only list of uploaded content with filters. Enforces the admin gate
 * server-side; returns an empty list when the caller isn't an admin.
 */
export const getAdminContent = query({
  args: {
    grade: v.optional(v.number()),
    subjectId: v.optional(v.id("subjects")),
    contentType: v.optional(contentTypeValidator),
  },
  handler: async (ctx, args): Promise<ContentItemWithSubject[]> => {
    const userId = await getAuthUserId(ctx);
    const user = userId ? await ctx.db.get(userId) : null;
    if (!(await isAdmin(ctx, user))) {
      return [];
    }

    const { grade, subjectId, contentType } = args;
    const hasFilters =
      grade !== undefined || subjectId !== undefined || contentType !== undefined;

    let items: ContentItem[];
    if (hasFilters) {
      items = await ctx.db
        .query("contentItems")
        .filter((q) => {
          const conds = [];
          if (grade !== undefined) conds.push(q.eq(q.field("grade"), grade));
          if (subjectId !== undefined) conds.push(q.eq(q.field("subjectId"), subjectId));
          if (contentType !== undefined) conds.push(q.eq(q.field("contentType"), contentType));
          return conds.length === 1 ? conds[0]! : q.and(...conds);
        })
        .order("desc")
        .take(50);
    } else {
      items = await ctx.db.query("contentItems").order("desc").take(50);
    }

    return withSubjects(ctx, items);
  },
});
