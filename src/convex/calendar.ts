// Calendar events: study blocks (auto-created from study plans), exam dates,
// reminders and custom events. All user-scoped with ownership checks.

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

export const eventTypeValidator = v.union(
  v.literal("study_block"),
  v.literal("exam"),
  v.literal("reminder"),
  v.literal("custom"),
);

type DbCtx = MutationCtx | QueryCtx;

async function requireUser(ctx: DbCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

function assertSaneTime(ms: number, label: string) {
  if (!Number.isFinite(ms) || Math.abs(ms - Date.now()) > 10 * 365 * 24 * 3600 * 1000) {
    throw new ConvexError({ message: `${label} is outside a sane range.`, code: "invalid" });
  }
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

export const listEvents = query({
  args: {
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
  },
  handler: async (ctx, { startAt, endAt }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("calendarEvents")
      .withIndex("by_user_startAt", (q) => q.eq("userId", userId))
      .order("asc")
      .collect();

    const filtered =
      startAt !== undefined || endAt !== undefined
        ? rows.filter((row) => {
            if (startAt !== undefined && row.startAt < startAt) return false;
            if (endAt !== undefined && row.startAt >= endAt) return false;
            return true;
          })
        : rows;

    const subjectCache = new Map<Id<"subjects">, Doc<"subjects">>();
    const result = [];
    for (const row of filtered) {
      let subjectName: string | null = null;
      if (row.subjectId) {
        let subject = subjectCache.get(row.subjectId);
        if (!subject) {
          subject = (await ctx.db.get(row.subjectId)) ?? undefined;
          if (subject) subjectCache.set(row.subjectId, subject);
        }
        subjectName = subject?.name ?? null;
      }
      result.push({ ...row, subjectName });
    }
    return result;
  },
});

export const createEvent = mutation({
  args: {
    title: v.string(),
    subjectId: v.optional(v.id("subjects")),
    startAt: v.number(),
    endAt: v.optional(v.number()),
    type: eventTypeValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const title = args.title.trim();
    if (!title) {
      throw new ConvexError({ message: "Event title is required.", code: "invalid" });
    }
    if (title.length > 120) {
      throw new ConvexError({ message: "Event title is too long (max 120 characters).", code: "invalid" });
    }
    assertSaneTime(args.startAt, "Start time");
    if (args.endAt !== undefined) {
      assertSaneTime(args.endAt, "End time");
      if (args.endAt <= args.startAt) {
        throw new ConvexError({ message: "Event must end after it starts.", code: "invalid" });
      }
    }
    if (args.subjectId) {
      const subject = await ctx.db.get(args.subjectId);
      if (!subject) {
        throw new ConvexError({ message: "Subject not found.", code: "invalid" });
      }
    }
    return await ctx.db.insert("calendarEvents", {
      userId,
      title,
      subjectId: args.subjectId,
      startAt: args.startAt,
      endAt: args.endAt,
      type: args.type,
      sourceStudyPlanId: undefined,
    });
  },
});

export const updateEvent = mutation({
  args: {
    eventId: v.id("calendarEvents"),
    title: v.optional(v.string()),
    subjectId: v.optional(v.id("subjects")),
    startAt: v.optional(v.number()),
    endAt: v.optional(v.number()),
    type: v.optional(eventTypeValidator),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(args.eventId);
    if (!event || event.userId !== userId) {
      throw new ConvexError({ message: "Event not found.", code: "not_found" });
    }
    const patch: Record<string, unknown> = {};
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) {
        throw new ConvexError({ message: "Event title is required.", code: "invalid" });
      }
      patch.title = title;
    }
    if (args.startAt !== undefined) {
      assertSaneTime(args.startAt, "Start time");
      patch.startAt = args.startAt;
    }
    if (args.endAt !== undefined) patch.endAt = args.endAt;
    if (args.subjectId !== undefined) patch.subjectId = args.subjectId;
    if (args.type !== undefined) patch.type = args.type;
    await ctx.db.patch(event._id, patch);
    return { ok: true };
  },
});

export const deleteEvent = mutation({
  args: { eventId: v.id("calendarEvents") },
  handler: async (ctx, { eventId }) => {
    const userId = await requireUser(ctx);
    const event = await ctx.db.get(eventId);
    if (!event || event.userId !== userId) {
      throw new ConvexError({ message: "Event not found.", code: "not_found" });
    }
    await ctx.db.delete(eventId);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Auto-created study blocks from AI study plans
// ---------------------------------------------------------------------------

/**
 * Turns a stored plan's weeks into calendar study blocks linked back via
 * sourceStudyPlanId. Regenerating a plan replaces that plan's events.
 * With a target exam date, week N anchors ~3 days before the exam; without
 * one, week 1 starts today.
 */
export const createPlanEvents = internalMutation({
  args: {
    userId: v.id("users"),
    subjectId: v.id("subjects"),
    planId: v.id("studyPlans"),
    planJson: v.string(),
    targetExamDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Remove any previous events tied to this plan (regeneration hygiene).
    const previous = await ctx.db
      .query("calendarEvents")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("sourceStudyPlanId"), args.planId))
      .collect();
    for (const event of previous) {
      await ctx.db.delete(event._id);
    }

    let weeks: { week: number; topics: unknown[]; focusHours: number }[];
    try {
      weeks = JSON.parse(args.planJson) as typeof weeks;
    } catch {
      return { ok: true, created: 0 };
    }
    if (!Array.isArray(weeks) || weeks.length === 0) {
      return { ok: true, created: 0 };
    }

    const DAY_MS = 24 * 60 * 60 * 1000;
    const WEEK_MS = 7 * DAY_MS;
    const totalWeeks = weeks.length;
    const subject = await ctx.db.get(args.subjectId);
    let created = 0;

    for (const week of weeks) {
      if (typeof week.week !== "number") continue;
      let startAt: number;
      if (args.targetExamDate) {
        // Anchor the last week to end ~3 days before the exam, then step back.
        const anchor = args.targetExamDate - 3 * DAY_MS;
        startAt = anchor - (totalWeeks - week.week) * WEEK_MS;
      } else {
        startAt = Date.now() + (week.week - 1) * WEEK_MS;
      }
      await ctx.db.insert("calendarEvents", {
        userId: args.userId,
        title: `Week ${week.week} — ${subject?.name ?? "Study"}`,
        subjectId: args.subjectId,
        startAt,
        endAt: startAt + WEEK_MS,
        type: "study_block",
        sourceStudyPlanId: args.planId,
      });
      created += 1;
    }
    return { ok: true, created };
  },
});
