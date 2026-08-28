// Trial + subscription logic.
//
// The trial counts ACTIVE days — calendar days on which the student actually
// used the app — not days since signup. A subscription row is created on
// first real usage (not account creation). Premium access is allowed during
// "trial" and "active"; everything else is gated via requireActiveSubscription.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  FREE_QUIZ_WEEKLY_LIMIT,
  FREE_QUIZ_WINDOW_DAYS,
  FREE_TUTOR_DAILY_LIMIT,
} from "./constants";

export const TRIAL_ACTIVE_DAYS = 14;

/**
 * Machine-readable reason for a premium gate. The frontend maps each reason
 * to a specific, contextual upgrade prompt — never a generic paywall.
 */
export type GateReason =
  | "trial_expired"
  | "daily_limit_reached"
  | "weekly_quiz_limit"
  | "premium_content"
  | "premium_plans"
  | "premium_quizzes"
  | "premium_analytics"
  | "premium_mock_exams";

export function isPremiumStatus(status: string | undefined): boolean {
  return status === "trial" || status === "active";
}

export type SubscriptionStatus =
  | "trial"
  | "active"
  | "expired"
  | "canceled";

export type SubscriptionStatusView = {
  status: SubscriptionStatus | "none";
  planTier: string;
  trialActiveDays: number;
  trialDaysRemaining: number;
  trialStartedAt: number | null;
  trialEndsAt: number | null;
  currentPeriodEnd: number | null;
  premiumAccess: boolean;
  needsUpgrade: boolean;
};

// ---------------------------------------------------------------------------
// Internal helpers (used by the touch path and by actions)
// ---------------------------------------------------------------------------

export const getSubscriptionByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    (await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique()) ?? null,
});

export const ensureSubscription = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("subscriptions", {
      userId,
      status: "trial",
      trialStartedAt: Date.now(),
      trialActiveDays: 0,
      planTier: "premium",
    });
  },
});

/**
 * Count one active day. Guarded by lastActiveDate so the same calendar day is
 * never counted twice. localDate is the client's "YYYY-MM-DD" (same convention
 * as study streaks) so the trial follows the student's own calendar.
 */
export const recordActiveDay = internalMutation({
  args: { userId: v.id("users"), localDate: v.string() },
  handler: async (ctx, { userId, localDate }) => {
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!sub) return { ok: true };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return { ok: true };
    if (sub.lastActiveDate === localDate) return { ok: true }; // already counted

    if (sub.status === "trial") {
      const nextDays = sub.trialActiveDays + 1;
      if (nextDays >= TRIAL_ACTIVE_DAYS) {
        // Trial complete on this 14th active day.
        await ctx.db.patch(sub._id, {
          trialActiveDays: TRIAL_ACTIVE_DAYS,
          lastActiveDate: localDate,
          status: "expired",
          trialEndsAt: Date.now(),
        });
      } else {
        await ctx.db.patch(sub._id, {
          trialActiveDays: nextDays,
          lastActiveDate: localDate,
        });
      }
    } else {
      // Non-trial: just track the active day for future accounting.
      await ctx.db.patch(sub._id, { lastActiveDate: localDate });
    }
    return { ok: true };
  },
});

/** Activate a paid subscription (called by the payment confirmation path). */
export const activateSubscription = internalMutation({
  args: { userId: v.id("users"), periodEnd: v.number() },
  handler: async (ctx, { userId, periodEnd }) => {
    await ctx.runMutation(internal.subscriptions.ensureSubscription, { userId });
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!sub) return { ok: false };
    await ctx.db.patch(sub._id, {
      status: "active",
      currentPeriodEnd: periodEnd,
      planTier: "premium",
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Public touch — called once per app load by the authenticated dashboard.
// Creates the subscription on first-ever activity and counts the active day.
// ---------------------------------------------------------------------------

export const touch = mutation({
  args: { localDate: v.string() },
  handler: async (ctx, { localDate }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    await ctx.runMutation(internal.subscriptions.ensureSubscription, { userId });
    await ctx.runMutation(internal.subscriptions.recordActiveDay, { userId, localDate });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Single source of truth for premium gating on the client.
// ---------------------------------------------------------------------------

export const getSubscriptionStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: TRIAL_ACTIVE_DAYS,
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        premiumAccess: false,
        needsUpgrade: false,
      };
    }
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    if (!sub) {
      return {
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: TRIAL_ACTIVE_DAYS,
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        premiumAccess: false,
        needsUpgrade: false,
      };
    }

    const premiumAccess = sub.status === "trial" || sub.status === "active";
    return {
      status: sub.status as SubscriptionStatus,
      planTier: sub.planTier,
      trialActiveDays: sub.trialActiveDays,
      trialDaysRemaining: Math.max(0, TRIAL_ACTIVE_DAYS - sub.trialActiveDays),
      trialStartedAt: sub.trialStartedAt ?? null,
      trialEndsAt: sub.trialEndsAt ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      premiumAccess,
      needsUpgrade: !premiumAccess,
    };
  },
});

// ---------------------------------------------------------------------------
// Entitlements — the client-facing source of truth for what this user can
// do right now, plus real free-tier usage counts. Drives the tutor cap UI,
// the quiz flow, and the /upgrade comparison table so copy never drifts
// from what the gates actually enforce.
// ---------------------------------------------------------------------------

export const getEntitlements = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        premiumAccess: false,
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: TRIAL_ACTIVE_DAYS,
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        needsUpgrade: false,
        tutorDailyLimit: FREE_TUTOR_DAILY_LIMIT,
        tutorUsedToday: 0,
        tutorRemainingToday: FREE_TUTOR_DAILY_LIMIT,
        quizWeeklyLimit: FREE_QUIZ_WEEKLY_LIMIT,
        quizUsedThisWeek: [],
        quizUsedThisWeekTotal: 0,
      };
    }

    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const premiumAccess = sub !== null && isPremiumStatus(sub.status);

    // --- Real free-tier usage counts -------------------------------------
    // Tutor messages in the last 24h (rolling window — same window the gate
    // in ai.ts uses, so the UI count always matches the enforced cap).
    const since = Date.now() - 24 * 60 * 60 * 1000;
    let tutorUsedToday = 0;
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .take(50);
    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .take(200);
      for (const message of messages) {
        if (message.role === "user" && message.createdAt >= since) {
          tutorUsedToday += 1;
        }
      }
    }

    // Quizzes generated per subject in the last 7 days (same window as the
    // gate in quizzes.ts).
    const weekStart = Date.now() - FREE_QUIZ_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const quizzes = await ctx.db
      .query("quizzes")
      .withIndex("by_user", (q) => q.eq("generatedForUserId", userId))
      .take(200);
    const perSubject = new Map<Id<"subjects">, number>();
    for (const quiz of quizzes) {
      if (quiz.createdAt < weekStart) continue;
      perSubject.set(quiz.subjectId, (perSubject.get(quiz.subjectId) ?? 0) + 1);
    }
    const quizUsedThisWeek = [...perSubject.entries()].map(([subjectId, used]) => ({
      subjectId,
      used,
    }));

    return {
      premiumAccess,
      status: sub?.status ?? ("none" as const),
      planTier: sub?.planTier ?? "premium",
      trialActiveDays: sub?.trialActiveDays ?? 0,
      trialDaysRemaining: Math.max(0, TRIAL_ACTIVE_DAYS - (sub?.trialActiveDays ?? 0)),
      trialStartedAt: sub?.trialStartedAt ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      needsUpgrade: !premiumAccess,
      tutorDailyLimit: FREE_TUTOR_DAILY_LIMIT,
      tutorUsedToday,
      tutorRemainingToday: Math.max(0, FREE_TUTOR_DAILY_LIMIT - tutorUsedToday),
      quizWeeklyLimit: FREE_QUIZ_WEEKLY_LIMIT,
      quizUsedThisWeek,
      quizUsedThisWeekTotal: quizUsedThisWeek.reduce((sum, entry) => sum + entry.used, 0),
    };
  },
});

// ---------------------------------------------------------------------------
// Server-side gate — throws for anyone without trial/active access.
// ---------------------------------------------------------------------------

export async function requireActiveSubscriptionDb(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  reason: GateReason = "trial_expired",
): Promise<Doc<"subscriptions">> {
  const sub = await ctx.db
    .query("subscriptions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!sub || !isPremiumStatus(sub.status)) {
    throw new ConvexError({
      message: "Premium access required. Your free trial has ended — upgrade to continue.",
      code: reason,
    });
  }
  return sub;
}

export async function requireActiveSubscriptionAction(
  ctx: ActionCtx,
  userId: Id<"users">,
  reason: GateReason = "trial_expired",
): Promise<Doc<"subscriptions">> {
  const sub = await ctx.runQuery(internal.subscriptions.getSubscriptionByUser, {
    userId,
  });
  if (!sub || !isPremiumStatus(sub.status)) {
    throw new ConvexError({
      message: "Premium access required. Your free trial has ended — upgrade to continue.",
      code: reason,
    });
  }
  return sub;
}

/** Action-side wrapper so callers can use one import regardless of ctx type. */
export const requireActiveSubscription = requireActiveSubscriptionAction;

/**
 * Whether the user currently has premium access (trial or paid). Actions use
 * this instead of the throwing helper when they want a free-tier allowance
 * (e.g. one quiz per week) rather than a hard gate.
 */
export async function getPremiumAccess(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const sub = await ctx.runQuery(internal.subscriptions.getSubscriptionByUser, {
    userId,
  });
  return sub !== null && isPremiumStatus(sub.status);
}

/** Public action used by client polling (mirrors the query for convenience). */
export const getSubscriptionStatusAction = action({
  args: {},
  handler: async (ctx): Promise<SubscriptionStatusView> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: TRIAL_ACTIVE_DAYS,
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        premiumAccess: false,
        needsUpgrade: false,
      };
    }
    const sub = await ctx.runQuery(internal.subscriptions.getSubscriptionByUser, {
      userId,
    });
    if (!sub) {
      return {
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: TRIAL_ACTIVE_DAYS,
        trialStartedAt: null,
        trialEndsAt: null,
        currentPeriodEnd: null,
        premiumAccess: false,
        needsUpgrade: false,
      };
    }
    return {
      status: sub.status,
      planTier: sub.planTier,
      trialActiveDays: sub.trialActiveDays,
      trialDaysRemaining: Math.max(0, TRIAL_ACTIVE_DAYS - sub.trialActiveDays),
      trialStartedAt: sub.trialStartedAt ?? null,
      trialEndsAt: sub.trialEndsAt ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      premiumAccess: sub.status === "trial" || sub.status === "active",
      needsUpgrade: !(sub.status === "trial" || sub.status === "active"),
    };
  },
});
