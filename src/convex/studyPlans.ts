// AI-generated weekly study plans.
//
// generatePlan asks Grok (xAI) to sequence a subject's syllabus topics into a
// week-by-week plan, validates the returned JSON (retrying once), maps topic
// names back to real topic ids, and stores the plan as JSON on a studyPlans
// row. Only one active plan per subject/user.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireActiveSubscriptionAction } from "./subscriptions";
import { XP_VALUES } from "./constants";
import { addisDateKey } from "./reminders";

const DAY_MS = 24 * 60 * 60 * 1000;

const AI_MODEL = process.env.AI_MODEL || "grok-4.6";
const API_URL = "https://api.x.ai/v1/chat/completions";

interface PlanWeek {
  week: number;
  topics: string[]; // topic names as returned by the model
  focusHours: number;
}

/** Ask Grok for the raw plan JSON. Throws a clear error if not configured. */
async function requestPlanJson(
  ctx: ActionCtx,
  subjectName: string,
  stream: string,
  topicNames: string[],
  targetExamDate?: number,
): Promise<string> {
  if (!process.env.XAI_API_KEY) {
    throw new ConvexError({
      message: "AI tutor is not configured yet — add XAI_API_KEY in the Keys tab.",
      code: "ai_not_configured",
    });
  }

  const targetLine = targetExamDate
    ? `\nThe student's target exam date is ${new Date(targetExamDate).toISOString().slice(0, 10)}; fit the plan before then.`
    : "";

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a study-plan generator for the Ethiopian national exams (ESLCE), grades 9-12. " +
            "You respond ONLY with valid JSON and nothing else.",
        },
        {
          role: "user",
          content:
            `Build a week-by-week study plan for ${subjectName} (${stream} stream).` +
            targetLine +
            "\nSequence the topics below, weighting exam-critical topics first. " +
            "Use between 4 and 8 weeks, 1 to 3 topics per week, 1 to 4 focus hours per week.\n" +
            "Respond with a JSON array only, no markdown, in exactly this shape:\n" +
            '[{"week": 1, "topics": ["Topic name", "Topic name"], "focusHours": 3}]\n' +
            `Topics to schedule: ${topicNames.join(", ")}`,
        },
      ],
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Grok API error ${response.status}: ${raw.slice(0, 300)}`);
  }
  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("Grok returned an empty plan response.");
  return content;
}

/** Parse and validate the model's JSON, with one retry for malformed output. */
async function parsePlanWithRetry(
  ctx: ActionCtx,
  subjectName: string,
  stream: string,
  topicNames: string[],
  targetExamDate?: number,
): Promise<PlanWeek[]> {
  let lastError = "Unknown parsing error.";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await requestPlanJson(ctx, subjectName, stream, topicNames, targetExamDate);
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed: unknown = JSON.parse(cleaned);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error("Plan is not a non-empty array.");
      }
      const weeks: PlanWeek[] = parsed.map((item, index) => {
        const week = (item as PlanWeek).week;
        const topics = (item as PlanWeek).topics;
        const focusHours = (item as PlanWeek).focusHours;
        if (typeof week !== "number" || !Array.isArray(topics) || typeof focusHours !== "number") {
          throw new Error(`Week ${index + 1} is malformed.`);
        }
        return {
          week: Math.round(week),
          topics: topics.map((t) => String(t).trim()).filter(Boolean),
          focusHours: Math.min(24, Math.max(1, Math.round(focusHours))),
        };
      });
      return weeks;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown parsing error.";
      if (attempt === 0) {
        // Single retry with a stricter instruction.
        try {
          const raw = await requestPlanJson(ctx, subjectName, stream, topicNames, targetExamDate);
          const parsed: unknown = JSON.parse(
            raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim(),
          );
          if (Array.isArray(parsed)) return parsed as PlanWeek[];
        } catch {
          // fall through to throw
        }
      }
    }
  }
  throw new ConvexError({
    message: `The AI returned an unreadable plan (${lastError}). Please try again.`,
    code: "ai_error",
  });
}

export const generatePlan = action({
  args: {
    subjectId: v.id("subjects"),
    targetExamDate: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ planId: Id<"studyPlans"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    // Plans are a premium feature (available during the trial).
    await requireActiveSubscriptionAction(ctx, userId, "premium_plans");

    const subject = await ctx.runQuery(internal.ai.getSubjectById, {
      subjectId: args.subjectId,
    });
    if (!subject) {
      throw new ConvexError({ message: "Subject not found.", code: "invalid" });
    }

    const topics: Doc<"topics">[] = await ctx.runQuery(internal.ai.listTopicsBySubject, {
      subjectId: args.subjectId,
    });
    if (topics.length === 0) {
      throw new ConvexError({
        message: `No syllabus topics exist yet for ${subject.name}. Add topics to the library before generating a plan.`,
        code: "no_topics",
      });
    }

    const topicNames = topics.map((topic) => topic.name);
    const weeks = await parsePlanWithRetry(
      ctx,
      subject.name,
      subject.stream,
      topicNames,
      args.targetExamDate,
    );

    // Map topic names back to real ids; drop anything the model invented.
    const nameToId = new Map(topics.map((topic) => [topic.name.toLowerCase(), topic._id]));
    const weeksWithIds = weeks.map((week) => ({
      week: week.week,
      topics: week.topics
        .map((name) => nameToId.get(name.toLowerCase()))
        .filter((id): id is Id<"topics"> => id !== undefined),
      focusHours: week.focusHours,
    }));

    // Deactivate any previous active plan for this subject, then store the new
    // one — atomically in a single internal mutation (actions can't touch db).
    const planId = await ctx.runMutation(internal.studyPlans.storePlan, {
      userId,
      subjectId: args.subjectId,
      targetExamDate: args.targetExamDate,
      planJson: JSON.stringify(weeksWithIds),
    });
    return { planId };
  },
});

/** Internal (action-only) atomic store: deactivates old plans, inserts new. */
export const storePlan = internalMutation({
  args: {
    userId: v.id("users"),
    subjectId: v.id("subjects"),
    targetExamDate: v.optional(v.number()),
    planJson: v.string(),
  },
  handler: async (ctx, args) => {
    const previous = await ctx.db
      .query("studyPlans")
      .withIndex("by_user_subject", (q) =>
        q.eq("userId", args.userId).eq("subjectId", args.subjectId),
      )
      .collect();
    for (const plan of previous) {
      if (plan.isActive) await ctx.db.patch(plan._id, { isActive: false });
    }
    const planId = await ctx.db.insert("studyPlans", {
      userId: args.userId,
      subjectId: args.subjectId,
      generatedAt: Date.now(),
      targetExamDate: args.targetExamDate,
      planJson: args.planJson,
      isActive: true,
      completedWeeks: [],
    });

    // Mirror the plan's weeks onto the calendar as study blocks.
    await ctx.runMutation(internal.calendar.createPlanEvents, {
      userId: args.userId,
      subjectId: args.subjectId,
      planId,
      planJson: args.planJson,
      targetExamDate: args.targetExamDate,
    });

    return planId;
  },
});

export const getActivePlan = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const plan = await ctx.db
      .query("studyPlans")
      .withIndex("by_user_subject", (q) =>
        q.eq("userId", userId).eq("subjectId", subjectId),
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
    if (!plan) return null;

    let weeks: { week: number; topicIds: Id<"topics">[]; focusHours: number }[] = [];
    try {
      weeks = JSON.parse(plan.planJson) as typeof weeks;
    } catch {
      weeks = [];
    }

    // Join real topic names for display.
    const topicCache = new Map<Id<"topics">, Doc<"topics">>();
    const subject = await ctx.db.get(subjectId);
    const weeksWithNames = [];
    for (const week of weeks) {
      const topics = [];
      for (const topicId of week.topicIds) {
        let topic = topicCache.get(topicId);
        if (!topic) {
          topic = (await ctx.db.get(topicId)) ?? undefined;
          if (topic) topicCache.set(topicId, topic);
        }
        topics.push({ id: topicId, name: topic?.name ?? "Unknown topic" });
      }
      weeksWithNames.push({ week: week.week, focusHours: week.focusHours, topics });
    }

    return {
      _id: plan._id,
      subjectId: plan.subjectId,
      subjectName: subject?.name ?? "Unknown",
      generatedAt: plan.generatedAt,
      targetExamDate: plan.targetExamDate ?? null,
      isActive: plan.isActive,
      completedWeeks: plan.completedWeeks,
      totalWeeks: weeksWithNames.length,
      weeks: weeksWithNames,
    };
  },
});

export const markWeekComplete = mutation({
  args: {
    planId: v.id("studyPlans"),
    week: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const plan = await ctx.db.get(args.planId);
    if (!plan || plan.userId !== userId) {
      throw new ConvexError({ message: "Plan not found.", code: "not_found" });
    }
    const completed = plan.completedWeeks ?? [];
    const wasCompleted = completed.includes(args.week);
    const next = wasCompleted
      ? completed.filter((w) => w !== args.week)
      : [...completed, args.week];
    await ctx.db.patch(plan._id, { completedWeeks: next });

    // XP only when a week actually completes (un-completing earns nothing).
    if (!wasCompleted) {
      await ctx.runMutation(internal.xp.awardXp, {
        userId,
        amount: XP_VALUES.plan_week_complete,
        reason: "plan_week_complete",
      });
      // Idempotent sweep — plan_complete unlocks when every week is done.
      await ctx.runMutation(internal.achievements.checkAndAward, { userId });
    }
    return { ok: true, completedWeeks: next };
  },
});

// ---------------------------------------------------------------------------
// Plan-week-due notifications (cron)
// ---------------------------------------------------------------------------

export const listActivePlans = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("studyPlans")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect(),
});

/**
 * Daily cron: for each active plan, a week's study block "comes due" on the
 * week's start date (generatedAt + (week-1) * 7 days, Addis calendar day). If
 * that day is today and the week isn't completed yet, drop an in-app
 * notification — a gentle nudge visible when the student opens the app, never
 * an external ping. Runs once daily, so no double-notify guard is needed.
 */
export const notifyDuePlanWeeks = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; notified: number }> => {
    const plans = await ctx.runQuery(internal.studyPlans.listActivePlans, {});
    if (plans.length === 0) return { checked: 0, notified: 0 };

    const today = addisDateKey();
    let notified = 0;
    for (const plan of plans) {
      let weeks: { week: number; topicIds: Id<"topics">[]; focusHours: number }[] = [];
      try {
        weeks = JSON.parse(plan.planJson) as typeof weeks;
      } catch {
        continue;
      }
      const completed = new Set(plan.completedWeeks ?? []);
      for (const week of weeks) {
        if (completed.has(week.week)) continue;
        const weekStartMs = plan.generatedAt + (week.week - 1) * 7 * DAY_MS;
        if (addisDateKey(weekStartMs) !== today) continue;

        const subject = await ctx.runQuery(internal.ai.getSubjectById, {
          subjectId: plan.subjectId,
        });
        await ctx.runMutation(internal.notifications.createNotification, {
          userId: plan.userId,
          type: "plan_week_due",
          title: `Week ${week.week} of your ${subject?.name ?? ""} plan is here`,
          body: `${week.focusHours} focus hours scheduled — mark it complete when you finish.`,
          actionUrl: "/plans",
        });
        notified += 1;
      }
    }
    return { checked: plans.length, notified };
  },
});
