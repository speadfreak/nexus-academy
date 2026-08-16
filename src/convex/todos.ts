// Per-user task list for the study companion.
// Every function derives the user from the session — a client can never read
// or write another user's todos.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("todos")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    // Sort: not-done first, then priority (high first), then due date (soonest
    // first), then newest created. Done items sink to the bottom by due date.
    const sorted = [...rows].sort((a, b) => {
      if (a.isDone !== b.isDone) return a.isDone ? 1 : -1;
      if (!a.isDone) {
        const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (p !== 0) return p;
      }
      const aDue = a.dueDate ?? Infinity;
      const bDue = b.dueDate ?? Infinity;
      if (aDue !== bDue) return aDue - bDue;
      return b.createdAt - a.createdAt;
    });

    const subjectCache = new Map<Id<"subjects">, Doc<"subjects">>();
    const result = [];
    for (const todo of sorted) {
      let subjectName: string | null = null;
      if (todo.subjectId) {
        let subject = subjectCache.get(todo.subjectId);
        if (!subject) {
          subject = (await ctx.db.get(todo.subjectId)) ?? undefined;
          if (subject) subjectCache.set(todo.subjectId, subject);
        }
        subjectName = subject?.name ?? null;
      }
      result.push({ ...todo, subjectName });
    }
    return result;
  },
});

export const create = mutation({
  args: {
    text: v.string(),
    subjectId: v.optional(v.id("subjects")),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const text = args.text.trim();
    if (!text) {
      throw new ConvexError({ message: "Todo text cannot be empty.", code: "invalid" });
    }
    if (text.length > 300) {
      throw new ConvexError({ message: "Todo text is too long (max 300 characters).", code: "invalid" });
    }
    if (args.subjectId) {
      const subject = await ctx.db.get(args.subjectId);
      if (!subject) {
        throw new ConvexError({ message: "Subject not found.", code: "invalid" });
      }
    }
    return await ctx.db.insert("todos", {
      userId,
      text,
      subjectId: args.subjectId,
      isDone: false,
      priority: args.priority ?? "medium",
      dueDate: args.dueDate,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    todoId: v.id("todos"),
    text: v.optional(v.string()),
    priority: v.optional(v.union(v.literal("low"), v.literal("medium"), v.literal("high"))),
    dueDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const todo = await ctx.db.get(args.todoId);
    if (!todo || todo.userId !== userId) {
      throw new ConvexError({ message: "Todo not found.", code: "not_found" });
    }
    const patch: Partial<{ text: string; priority: "low" | "medium" | "high"; dueDate?: number }> = {};
    if (args.text !== undefined) {
      const text = args.text.trim();
      if (!text) throw new ConvexError({ message: "Todo text cannot be empty.", code: "invalid" });
      patch.text = text;
    }
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
    await ctx.db.patch(todo._id, patch);
    return { ok: true };
  },
});

export const toggleDone = mutation({
  args: { todoId: v.id("todos") },
  handler: async (ctx, { todoId }) => {
    const userId = await requireUser(ctx);
    const todo = await ctx.db.get(todoId);
    if (!todo || todo.userId !== userId) {
      throw new ConvexError({ message: "Todo not found.", code: "not_found" });
    }
    await ctx.db.patch(todoId, { isDone: !todo.isDone });
    return { ok: true, isDone: !todo.isDone };
  },
});

export const remove = mutation({
  args: { todoId: v.id("todos") },
  handler: async (ctx, { todoId }) => {
    const userId = await requireUser(ctx);
    const todo = await ctx.db.get(todoId);
    if (!todo || todo.userId !== userId) {
      throw new ConvexError({ message: "Todo not found.", code: "not_found" });
    }
    await ctx.db.delete(todoId);
    return { ok: true };
  },
});
