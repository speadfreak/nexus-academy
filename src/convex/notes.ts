// Student sticky notes with difficulty marking.
//
// The difficulty tag (easy / medium / hard) is the STUDENT's own judgment of
// how hard a subject feels. It's displayed on the Notes page and fed into the
// AI tutor's system prompt (see ai.ts) so the tutor adjusts pacing for
// subjects marked "hard".

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

export const difficultyValidator = v.union(
  v.literal("easy"),
  v.literal("medium"),
  v.literal("hard"),
);

export const colorValidator = v.union(
  v.literal("default"),
  v.literal("blue"),
  v.literal("green"),
  v.literal("amber"),
  v.literal("rose"),
  v.literal("violet"),
);

type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

async function assertSubjectExists(ctx: DbCtx, subjectId: Id<"subjects">) {
  const subject = await ctx.db.get(subjectId);
  if (!subject) {
    throw new ConvexError({ message: "Subject not found.", code: "invalid" });
  }
}

// ---------------------------------------------------------------------------
// Public CRUD (all ownership-scoped)
// ---------------------------------------------------------------------------

export const list = query({
  args: { subjectId: v.optional(v.id("subjects")) },
  handler: async (ctx, { subjectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = subjectId
      ? await ctx.db
          .query("notes")
          .withIndex("by_user_subject", (q) =>
            q.eq("userId", userId).eq("subjectId", subjectId),
          )
          .collect()
      : await ctx.db
          .query("notes")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();

    const sorted = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
    const subjectCache = new Map<Id<"subjects">, Doc<"subjects">>();
    const result = [];
    for (const note of sorted) {
      let subject = subjectCache.get(note.subjectId);
      if (!subject) {
        subject = (await ctx.db.get(note.subjectId)) ?? undefined;
        if (subject) subjectCache.set(note.subjectId, subject);
      }
      result.push({
        ...note,
        subjectName: subject?.name ?? "Unknown",
        subjectSlug: subject?.slug ?? "",
      });
    }
    return result;
  },
});

export const create = mutation({
  args: {
    subjectId: v.id("subjects"),
    content: v.string(),
    difficulty: v.optional(difficultyValidator),
    topicId: v.optional(v.id("topics")),
    color: v.optional(colorValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const content = args.content.trim();
    if (!content) {
      throw new ConvexError({ message: "Note content cannot be empty.", code: "invalid" });
    }
    if (content.length > 2000) {
      throw new ConvexError({
        message: "Note is too long (max 2,000 characters).",
        code: "invalid",
      });
    }
    await assertSubjectExists(ctx, args.subjectId);
    if (args.topicId) {
      const topic = await ctx.db.get(args.topicId);
      if (!topic) {
        throw new ConvexError({ message: "Topic not found.", code: "invalid" });
      }
    }
    const now = Date.now();
    return await ctx.db.insert("notes", {
      userId,
      subjectId: args.subjectId,
      content,
      difficulty: args.difficulty,
      topicId: args.topicId,
      color: args.color ?? "default",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    noteId: v.id("notes"),
    content: v.optional(v.string()),
    difficulty: v.optional(difficultyValidator),
    color: v.optional(colorValidator),
    topicId: v.optional(v.id("topics")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const note = await ctx.db.get(args.noteId);
    if (!note || note.userId !== userId) {
      throw new ConvexError({ message: "Note not found.", code: "not_found" });
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.content !== undefined) {
      const content = args.content.trim();
      if (!content) {
        throw new ConvexError({ message: "Note content cannot be empty.", code: "invalid" });
      }
      if (content.length > 2000) {
        throw new ConvexError({
          message: "Note is too long (max 2,000 characters).",
          code: "invalid",
        });
      }
      patch.content = content;
    }
    if (args.difficulty !== undefined) patch.difficulty = args.difficulty;
    if (args.color !== undefined) patch.color = args.color;
    if (args.topicId !== undefined) patch.topicId = args.topicId;
    await ctx.db.patch(note._id, patch);
    return { ok: true };
  },
});

export const remove = mutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, { noteId }) => {
    const userId = await requireUser(ctx);
    const note = await ctx.db.get(noteId);
    if (!note || note.userId !== userId) {
      throw new ConvexError({ message: "Note not found.", code: "not_found" });
    }
    await ctx.db.delete(noteId);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Internal read for the AI tutor (actions call this via ctx.runQuery)
// ---------------------------------------------------------------------------

/**
 * The difficulty values the student has attached to a subject. Used by
 * ai.ts to adjust tutor pacing ("this student marked Physics hard").
 */
export const getDifficultyBySubject = internalQuery({
  args: { userId: v.id("users"), subjectId: v.id("subjects") },
  handler: async (ctx, { userId, subjectId }) => {
    const rows = await ctx.db
      .query("notes")
      .withIndex("by_user_subject", (q) =>
        q.eq("userId", userId).eq("subjectId", subjectId),
      )
      .collect();
    const difficulties = rows
      .map((row) => row.difficulty)
      .filter((d): d is "easy" | "medium" | "hard" => d !== undefined);
    return {
      difficulties: [...new Set(difficulties)],
      hasNotes: rows.length > 0,
    };
  },
});
