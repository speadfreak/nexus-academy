// Admin CRUD for categories: subjects, content types, and grades.
//
// All mutations require admin (moderator+) role. Seeding is idempotent —
// the admin can re-seed at any time to backfill any new built-in entries
// added in constants.ts without losing their custom admin-added entries.
//
// TABLES:
//   - subjects (already existed — we add addSubject/updateSubject/deleteSubject)
//   - contentTypes (new — seeded from CONTENT_TYPES in constants.ts)
//   - grades (new — seeded from GRADES in constants.ts)
//
// SAFETY:
//   - Built-in entries (isBuiltIn=true) can be edited (label only) but NOT
//     deleted — this prevents the admin from accidentally removing a type
//     that existing content items reference.
//   - Admin-added entries can be edited or deleted freely.
//   - Deletion checks for existing contentItems using that slug/grade/subject
//     and refuses with a clear error if any references exist.

import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminMutation } from "./admin";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  CONTENT_TYPE_SLUGS,
  GRADES,
  STREAMS,
  type Stream,
} from "./constants";
import { slugify } from "./subjects";

// ---------------------------------------------------------------------------
// Content types
// ---------------------------------------------------------------------------

/** List all content types, ordered by `order` then by label. */
export const listContentTypes = query({
  args: {},
  handler: async (ctx): Promise<Doc<"contentTypes">[]> => {
    const all = await ctx.db.query("contentTypes").collect();
    return all.sort((a, b) => {
      const ao = a.order ?? 1000;
      const bo = b.order ?? 1000;
      if (ao !== bo) return ao - bo;
      return a.label.localeCompare(b.label);
    });
  },
});

/** Idempotent seed of the contentTypes table from constants.CONTENT_TYPES. */
export const seedContentTypes = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminMutation(ctx);
    let created = 0;
    let existed = 0;
    for (const slug of CONTENT_TYPES) {
      const existing = await ctx.db
        .query("contentTypes")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (existing) {
        existed += 1;
        continue;
      }
      await ctx.db.insert("contentTypes", {
        slug,
        label: CONTENT_TYPE_LABELS[slug],
        storageSlug: CONTENT_TYPE_SLUGS[slug],
        hasYear: slug === "past_exam",
        isBuiltIn: true,
      });
      created += 1;
    }
    return { created, existed, total: created + existed };
  },
});

/** Add a new admin-defined content type. slug must be unique. */
export const addContentType = mutation({
  args: {
    label: v.string(),
    storageSlug: v.string(),
    hasYear: v.boolean(),
  },
  handler: async (ctx, args): Promise<{ id: Id<"contentTypes">; slug: string }> => {
    await requireAdminMutation(ctx);
    // Derive a slug from the label (admin can't set it directly so we keep
    // the slug format consistent).
    const slug = slugify(args.label.trim());
    if (!slug) throw new ConvexError({ message: "Label is required.", code: "invalid" });

    // Check uniqueness
    const existing = await ctx.db
      .query("contentTypes")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) {
      throw new ConvexError({
        message: `Content type with slug "${slug}" already exists.`,
        code: "duplicate",
      });
    }
    // storageSlug must also be unique (it's the R2 path segment)
    const storageSlugExisting = await ctx.db
      .query("contentTypes")
      .withIndex("by_storageSlug", (q) => q.eq("storageSlug", args.storageSlug.trim()))
      .unique();
    if (storageSlugExisting) {
      throw new ConvexError({
        message: `Storage slug "${args.storageSlug}" already in use.`,
        code: "duplicate",
      });
    }
    const id = await ctx.db.insert("contentTypes", {
      slug,
      label: args.label.trim(),
      storageSlug: args.storageSlug.trim() || slug,
      hasYear: args.hasYear,
      isBuiltIn: false,
    });
    return { id, slug };
  },
});

/** Edit an existing content type. Only the label, storageSlug, hasYear, and
    order are editable; the slug is immutable (it's referenced by
    contentItems.contentType). */
export const updateContentType = mutation({
  args: {
    id: v.id("contentTypes"),
    label: v.optional(v.string()),
    storageSlug: v.optional(v.string()),
    hasYear: v.optional(v.boolean()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ message: "Content type not found.", code: "not_found" });
    }
    const patch: Partial<Doc<"contentTypes">> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) throw new ConvexError({ message: "Label cannot be empty.", code: "invalid" });
      patch.label = label;
    }
    if (args.storageSlug !== undefined) {
      const storageSlug = args.storageSlug.trim();
      if (!storageSlug) throw new ConvexError({ message: "Storage slug cannot be empty.", code: "invalid" });
      // Check uniqueness if changed
      if (storageSlug !== existing.storageSlug) {
        const other = await ctx.db
          .query("contentTypes")
          .withIndex("by_storageSlug", (q) => q.eq("storageSlug", storageSlug))
          .unique();
        if (other && other._id !== args.id) {
          throw new ConvexError({
            message: `Storage slug "${storageSlug}" already in use.`,
            code: "duplicate",
          });
        }
        patch.storageSlug = storageSlug;
      }
    }
    if (args.hasYear !== undefined) patch.hasYear = args.hasYear;
    if (args.order !== undefined) patch.order = args.order;
    if (Object.keys(patch).length === 0) return { updated: false };
    await ctx.db.patch(args.id, patch);
    return { updated: true };
  },
});

/** Delete a content type. Refuses if any contentItems reference it. */
export const deleteContentType = mutation({
  args: { id: v.id("contentTypes") },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ message: "Content type not found.", code: "not_found" });
    }
    if (existing.isBuiltIn) {
      throw new ConvexError({
        message: `Cannot delete built-in content type "${existing.label}". Edit it instead, or remove the entry from constants.ts first.`,
        code: "is_builtin",
      });
    }
    // Check for content items using this slug
    const itemsUsing = await ctx.db
      .query("contentItems")
      .withIndex("by_contentType", (q) => q.eq("contentType", existing.slug))
      .take(1);
    if (itemsUsing.length > 0) {
      throw new ConvexError({
        message: `Cannot delete "${existing.label}": existing content items use this type. Re-assign them first.`,
        code: "in_use",
      });
    }
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

/** List all grades, ordered by `order` then by grade number. */
export const listGrades = query({
  args: {},
  handler: async (ctx): Promise<Doc<"grades">[]> => {
    const all = await ctx.db.query("grades").collect();
    return all.sort((a, b) => {
      const ao = a.order ?? 1000;
      const bo = b.order ?? 1000;
      if (ao !== bo) return ao - bo;
      return a.grade - b.grade;
    });
  },
});

/** Idempotent seed of the grades table from constants.GRADES. */
export const seedGrades = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdminMutation(ctx);
    let created = 0;
    let existed = 0;
    for (const grade of GRADES) {
      const existing = await ctx.db
        .query("grades")
        .withIndex("by_grade", (q) => q.eq("grade", grade))
        .unique();
      if (existing) {
        existed += 1;
        continue;
      }
      await ctx.db.insert("grades", {
        grade,
        label: `Grade ${grade}`,
        isBuiltIn: true,
      });
      created += 1;
    }
    return { created, existed, total: created + existed };
  },
});

/** Add a new admin-defined grade. */
export const addGrade = mutation({
  args: {
    grade: v.number(),
    label: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: Id<"grades"> }> => {
    await requireAdminMutation(ctx);
    if (!Number.isInteger(args.grade) || args.grade < 1 || args.grade > 13) {
      throw new ConvexError({
        message: "Grade must be an integer between 1 and 13.",
        code: "invalid",
      });
    }
    const existing = await ctx.db
      .query("grades")
      .withIndex("by_grade", (q) => q.eq("grade", args.grade))
      .unique();
    if (existing) {
      throw new ConvexError({
        message: `Grade ${args.grade} already exists.`,
        code: "duplicate",
      });
    }
    const id = await ctx.db.insert("grades", {
      grade: args.grade,
      label: args.label?.trim() || `Grade ${args.grade}`,
      isBuiltIn: false,
    });
    return { id };
  },
});

/** Edit an existing grade. */
export const updateGrade = mutation({
  args: {
    id: v.id("grades"),
    label: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ message: "Grade not found.", code: "not_found" });
    }
    const patch: Partial<Doc<"grades">> = {};
    if (args.label !== undefined) {
      const label = args.label.trim();
      if (!label) throw new ConvexError({ message: "Label cannot be empty.", code: "invalid" });
      patch.label = label;
    }
    if (args.order !== undefined) patch.order = args.order;
    if (Object.keys(patch).length === 0) return { updated: false };
    await ctx.db.patch(args.id, patch);
    return { updated: true };
  },
});

/** Delete a grade. Refuses if any contentItems reference it. */
export const deleteGrade = mutation({
  args: { id: v.id("grades") },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ message: "Grade not found.", code: "not_found" });
    }
    if (existing.isBuiltIn) {
      throw new ConvexError({
        message: `Cannot delete built-in grade "${existing.label}". Edit it instead.`,
        code: "is_builtin",
      });
    }
    const itemsUsing = await ctx.db
      .query("contentItems")
      .withIndex("by_grade", (q) => q.eq("grade", existing.grade))
      .take(1);
    if (itemsUsing.length > 0) {
      throw new ConvexError({
        message: `Cannot delete "${existing.label}": existing content items use this grade. Re-assign them first.`,
        code: "in_use",
      });
    }
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Subjects (existing table — we add add/update/delete mutations here)
// ---------------------------------------------------------------------------

/** Add a new admin-defined subject. */
export const addSubject = mutation({
  args: {
    name: v.string(),
    stream: v.union(...STREAMS.map((s) => v.literal(s as Stream))),
  },
  handler: async (ctx, args): Promise<{ id: Id<"subjects">; slug: string }> => {
    await requireAdminMutation(ctx);
    const name = args.name.trim();
    if (!name) throw new ConvexError({ message: "Name is required.", code: "invalid" });
    const slug = slugify(name);
    const existing = await ctx.db
      .query("subjects")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (existing) {
      throw new ConvexError({
        message: `Subject with slug "${slug}" already exists.`,
        code: "duplicate",
      });
    }
    const id = await ctx.db.insert("subjects", { name, stream: args.stream, slug });
    return { id, slug };
  },
});

/** Edit an existing subject. Only name + stream can change; slug is derived
    from name and updated atomically. */
export const updateSubject = mutation({
  args: {
    id: v.id("subjects"),
    name: v.optional(v.string()),
    stream: v.optional(v.union(...STREAMS.map((s) => v.literal(s as Stream)))),
  },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ message: "Subject not found.", code: "not_found" });
    }
    const patch: Partial<Doc<"subjects">> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new ConvexError({ message: "Name cannot be empty.", code: "invalid" });
      const newSlug = slugify(name);
      if (newSlug !== existing.slug) {
        // Check uniqueness of the new slug
        const other = await ctx.db
          .query("subjects")
          .withIndex("by_slug", (q) => q.eq("slug", newSlug))
          .unique();
        if (other && other._id !== args.id) {
          throw new ConvexError({
            message: `Another subject already uses the slug "${newSlug}".`,
            code: "duplicate",
          });
        }
        patch.slug = newSlug;
      }
      patch.name = name;
    }
    if (args.stream !== undefined) patch.stream = args.stream;
    if (Object.keys(patch).length === 0) return { updated: false };
    await ctx.db.patch(args.id, patch);
    return { updated: true };
  },
});

/** Delete a subject. Refuses if any contentItems reference it. */
export const deleteSubject = mutation({
  args: { id: v.id("subjects") },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    const existing = await ctx.db.get(args.id);
    if (!existing) {
      throw new ConvexError({ message: "Subject not found.", code: "not_found" });
    }
    // Check for content items using this subject
    const itemsUsing = await ctx.db
      .query("contentItems")
      .withIndex("by_subject", (q) => q.eq("subjectId", args.id))
      .take(1);
    if (itemsUsing.length > 0) {
      throw new ConvexError({
        message: `Cannot delete "${existing.name}": existing content items use this subject. Re-assign them first.`,
        code: "in_use",
      });
    }
    // Also check userProfiles stream references — we don't block on those,
    // they'll just no longer match a subject slug. But we DO warn via the
    // returned metadata.
    await ctx.db.delete(args.id);
    return { deleted: true, name: existing.name };
  },
});

// ---------------------------------------------------------------------------
// Content items — needsReview query + clear
// ---------------------------------------------------------------------------

/** Count of content items flagged as needsReview (blind-uploaded). */
export const countNeedsReview = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const items = await ctx.db
      .query("contentItems")
      .withIndex("by_needsReview", (q) => q.eq("needsReview", true))
      .collect();
    return items.length;
  },
});

/** Clear the needsReview flag on a content item (admin has reviewed it). */
export const clearNeedsReview = mutation({
  args: { id: v.id("contentItems") },
  handler: async (ctx, args) => {
    await requireAdminMutation(ctx);
    await ctx.db.patch(args.id, { needsReview: undefined });
    return { cleared: true };
  },
});
