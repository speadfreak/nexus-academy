// Per-user task list for the study companion.
// Every function derives the user from the session — a client can never read
// or write another user's todos.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
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
    contentId: v.optional(v.id("contentItems")),
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
    if (args.contentId) {
      const content = await ctx.db.get(args.contentId);
      if (!content) {
        throw new ConvexError({ message: "Content item not found.", code: "invalid" });
      }
    }
    return await ctx.db.insert("todos", {
      userId,
      text,
      subjectId: args.subjectId,
      isDone: false,
      priority: args.priority ?? "medium",
      dueDate: args.dueDate,
      contentId: args.contentId,
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
    contentId: v.optional(v.id("contentItems")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const todo = await ctx.db.get(args.todoId);
    if (!todo || todo.userId !== userId) {
      throw new ConvexError({ message: "Todo not found.", code: "not_found" });
    }
    const patch: Partial<{
      text: string;
      priority: "low" | "medium" | "high";
      dueDate?: number;
      contentId?: Id<"contentItems">;
    }> = {};
    if (args.text !== undefined) {
      const text = args.text.trim();
      if (!text) throw new ConvexError({ message: "Todo text cannot be empty.", code: "invalid" });
      patch.text = text;
    }
    if (args.priority !== undefined) patch.priority = args.priority;
    if (args.dueDate !== undefined) patch.dueDate = args.dueDate;
    if (args.contentId !== undefined) patch.contentId = args.contentId;
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

/**
 * Cron (hourly): notify students whose todos are due now or within the next
 * 24 hours. One notification per todo per day — the todo id is embedded as
 * a marker so the dedupe is exact. Only fires for real upcoming todos, and
 * never for done ones.
 */
export const notifyDueTodos = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const todos = await ctx.db
      .query("todos")
      .filter((q) => q.eq(q.field("isDone"), false))
      .take(2000);
    let notified = 0;
    for (const todo of todos) {
      if (!todo.dueDate) continue;
      // Due in the past (beyond a grace minute) or more than a day out.
      if (todo.dueDate < now - 60 * 1000) continue;
      if (todo.dueDate > now + 24 * 60 * 60 * 1000) continue;

      const marker = `#todo:${todo._id}`;
      const recent = await ctx.db
        .query("notifications")
        .withIndex("by_user_createdAt", (q) =>
          q.eq("userId", todo.userId).gte("createdAt", dayAgo),
        )
        .take(100);
      if (recent.some((row) => row.body.includes(marker))) continue;

      const due = new Date(todo.dueDate);
      const timeLabel = `${String(due.getHours()).padStart(2, "0")}:${String(
        due.getMinutes(),
      ).padStart(2, "0")}`;
      const when =
        todo.dueDate <= now + 30 * 60 * 1000 ? "due now" : `due at ${timeLabel}`;
      await ctx.db.insert("notifications", {
        userId: todo.userId,
        type: "todo_due",
        title: "Todo due",
        body: `${todo.text} — ${when}. ${marker}`,
        actionUrl: "/todos",
        createdAt: now,
      });
      notified += 1;
    }
    return { ok: true, notified };
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
