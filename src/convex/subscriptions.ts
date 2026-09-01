// Trial + subscription logic.
//
// The trial counts ACTIVE days — calendar days on which the student actually
// used the app — not days since signup. A subscription row is created on
// first real usage (not account creation). Premium access is allowed during
// "trial" and "active"; everything else is gated via requireActiveSubscription.
//
// ADMIN-CONTROLLABLE TRIAL LENGTH: The number of free-trial active days
// is read from the FREE_TRIAL_DAYS config key (default: 14). Admins can
// change it from the Subscriptions tab in the admin site. Changing the
// value affects:
//   - The threshold against which new active days are compared (so a
//     student whose trial is currently in progress gets the new length
//     applied on their next active day).
//   - The trialDaysRemaining reported to the client for users who haven't
//     started their trial yet.
// It does NOT retroactively extend trials that have already expired —
// for that, admins should use the 'Bulk extend all trials' action in
// the Subscriptions tab (or extend individual users).

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
import { isAdmin, hasMinRole } from "./admin";
import { ROLES } from "./schema";

/**
 * Hardcoded fallback for the free-trial active-day count. The actual
 * value used at runtime is read from the FREE_TRIAL_DAYS config key
 * (admin-settable in the Keys tab / Subscriptions tab) — see
 * {@link getTrialDays}. This constant is the default if the config key
 * is not set.
 */
export const TRIAL_ACTIVE_DAYS = 14;

/**
 * Read the current free-trial length (in active days) from configKeys.
 * Falls back to {@link TRIAL_ACTIVE_DAYS} (14) if not configured.
 *
 * Works in queries, mutations, AND actions — all Convex ctx types
 * support ctx.runQuery.
 */
async function getTrialDays(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<number> {
  const val = await ctx.runQuery(internal.configKeys.resolveConfigValue, {
    key: "FREE_TRIAL_DAYS",
  });
  if (!val) return TRIAL_ACTIVE_DAYS;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : TRIAL_ACTIVE_DAYS;
}

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
    if (!/^^\d{4}-\d{2}-\d{2}$/.test(localDate)) return { ok: true };
    if (sub.lastActiveDate === localDate) return { ok: true }; // already counted

    if (sub.status === "trial") {
      // Read the trial length from config so admin changes take effect on
      // the student's next active day (no app restart needed).
      const trialDays = await getTrialDays(ctx);
      const nextDays = sub.trialActiveDays + 1;
      if (nextDays >= trialDays) {
        // Trial complete on this final active day.
        await ctx.db.patch(sub._id, {
          trialActiveDays: trialDays,
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
    // Read once so all branches share the same value for this call.
    const trialDays = await getTrialDays(ctx);
    if (!userId) {
      return {
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: trialDays,
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
        trialDaysRemaining: trialDays,
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
      trialDaysRemaining: Math.max(0, trialDays - sub.trialActiveDays),
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
    const trialDays = await getTrialDays(ctx);
    if (!userId) {
      return {
        premiumAccess: false,
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: trialDays,
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
      trialDaysRemaining: Math.max(0, trialDays - (sub?.trialActiveDays ?? 0)),
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
    const trialDays = await getTrialDays(ctx);
    if (!userId) {
      return {
        status: "none" as const,
        planTier: "premium",
        trialActiveDays: 0,
        trialDaysRemaining: trialDays,
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
        trialDaysRemaining: trialDays,
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
      trialDaysRemaining: Math.max(0, trialDays - sub.trialActiveDays),
      trialStartedAt: sub.trialStartedAt ?? null,
      trialEndsAt: sub.trialEndsAt ?? null,
      currentPeriodEnd: sub.currentPeriodEnd ?? null,
      premiumAccess: sub.status === "trial" || sub.status === "active",
      needsUpgrade: !(sub.status === "trial" || sub.status === "active"),
    };
  },
});

// ===========================================================================
// ADMIN: trial management
// ===========================================================================
//
// All mutations in this section require admin auth. They give the admin
// fine-grained control over the trial program:
//   - extendUserTrial: add N active days to a single user's trial. Useful
//     for support cases ("my trial expired, can you give me 3 more days?").
//   - resetUserTrial: wipe a user's trial counter and re-activate the
//     trial. Useful when a user signed up but never used the app and their
//     trial got eaten by a bug.
//   - bulkExtendActiveTrials: add N active days to EVERY user whose trial
//     is currently in progress. Useful for "everyone gets +3 free days"
//     promotional campaigns.
//   - bulkExtendExpiredTrials: re-activate expired trials with N extra
//     active days. Useful for "we messed up, here's a fresh trial for
//     everyone whose trial expired in the last 30 days" recovery scenarios.
//   - setUserTrialDays: set a specific user's trialActiveDays counter to
//     an exact value. Edge-case tool — useful when you need to undo a
//     botched bulk operation on a single user.
//
// The setTrialDays config key (FREE_TRIAL_DAYS) is a separate concern —
// admins change it via the existing configKeys.setKey mutation in the
// Subscriptions tab UI. Changing that value affects future active-day
// counting for ALL trials in progress; the mutations here affect
// specific users (or all users) without changing the global default.

/**
 * Admin auth check for the trial-management mutations. Same pattern as
 * manualPayments.ts — uses the bootstrap-aware isAdmin() helper.
 */
async function requireAdminUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  const user = await ctx.db.get(userId);
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  if (!hasMinRole(user, ROLES.ADMIN)) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  return user;
}

/**
 * Add `extraDays` active days to a single user's trial. If the user's
 * trial had already expired, this re-activates it (status: "trial",
 * trialEndsAt: undefined). If the trial is in progress, it just bumps
 * the trialActiveDays counter DOWN by extraDays (effectively giving
 * them extraDays more active days before the gate triggers).
 *
 * Does NOT affect users on a paid "active" subscription — their trial
 * days are irrelevant.
 */
export const extendUserTrial = mutation({
  args: { userId: v.id("users"), extraDays: v.number() },
  handler: async (ctx, { userId, extraDays }) => {
    await requireAdminUser(ctx);
    if (!Number.isFinite(extraDays) || extraDays <= 0 || extraDays > 365) {
      throw new ConvexError({
        message: "Extra days must be a positive number (max 365).",
        code: "invalid",
      });
    }
    // Ensure a subscription row exists.
    const subId: Id<"subscriptions"> = await ctx.runMutation(
      internal.subscriptions.ensureSubscription,
      { userId },
    );
    const sub = await ctx.db.get(subId);
    if (!sub) return { ok: false };

    // Paid subscriptions are not affected.
    if (sub.status === "active") {
      return { ok: false, reason: "User has an active paid subscription." };
    }

    // For expired or canceled trials: re-activate the trial with the
    // extra active days "pre-used" (so they get extraDays of fresh
    // active usage before the gate triggers again). For in-progress
    // trials: subtract from trialActiveDays (can go negative, which is
    // fine — it just means the user has more active days to burn).
    const newActiveDays = Math.max(0, sub.trialActiveDays - extraDays);
    await ctx.db.patch(sub._id, {
      status: "trial",
      trialActiveDays: newActiveDays,
      trialEndsAt: undefined,
      // Preserve trialStartedAt if it existed; otherwise stamp it now.
      trialStartedAt: sub.trialStartedAt ?? Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Reset a user's trial to a fresh state: trialActiveDays = 0, status =
 * "trial", trialStartedAt = now, trialEndsAt = undefined. Useful when a
 * user's trial was eaten by a bug or they never actually used the app.
 */
export const resetUserTrial = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireAdminUser(ctx);
    const subId: Id<"subscriptions"> = await ctx.runMutation(
      internal.subscriptions.ensureSubscription,
      { userId },
    );
    const sub = await ctx.db.get(subId);
    if (!sub) return { ok: false };
    if (sub.status === "active") {
      return { ok: false, reason: "User has an active paid subscription." };
    }
    await ctx.db.patch(sub._id, {
      status: "trial",
      trialActiveDays: 0,
      trialStartedAt: Date.now(),
      trialEndsAt: undefined,
    });
    return { ok: true };
  },
});

/**
 * Set a user's trialActiveDays counter to an exact value. Edge-case
 * tool — useful when you need to undo a botched bulk operation on a
 * single user, or to instantly expire a trial (set trialActiveDays to
 * a value >= FREE_TRIAL_DAYS, which will trigger expiration on the
 * user's next active day).
 */
export const setUserTrialDays = mutation({
  args: { userId: v.id("users"), days: v.number() },
  handler: async (ctx, { userId, days }) => {
    await requireAdminUser(ctx);
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      throw new ConvexError({
        message: "Days must be a number between 0 and 365.",
        code: "invalid",
      });
    }
    const subId: Id<"subscriptions"> = await ctx.runMutation(
      internal.subscriptions.ensureSubscription,
      { userId },
    );
    const sub = await ctx.db.get(subId);
    if (!sub) return { ok: false };
    if (sub.status === "active") {
      return { ok: false, reason: "User has an active paid subscription." };
    }
    await ctx.db.patch(sub._id, {
      trialActiveDays: Math.floor(days),
    });
    return { ok: true };
  },
});

/**
 * Add `extraDays` active days to EVERY user whose trial is currently
 * in progress (status: "trial"). Returns the count of users updated.
 * Useful for "everyone gets +3 free days" promotional campaigns.
 */
export const bulkExtendActiveTrials = mutation({
  args: { extraDays: v.number() },
  handler: async (ctx, { extraDays }) => {
    await requireAdminUser(ctx);
    if (!Number.isFinite(extraDays) || extraDays <= 0 || extraDays > 365) {
      throw new ConvexError({
        message: "Extra days must be a positive number (max 365).",
        code: "invalid",
      });
    }
    const trials = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "trial"))
      .collect();
    let updated = 0;
    for (const sub of trials) {
      // Subtract extraDays from trialActiveDays (can go negative — that's
      // fine, it just gives the user more active days before the gate).
      const newActiveDays = Math.max(0, sub.trialActiveDays - extraDays);
      await ctx.db.patch(sub._id, { trialActiveDays: newActiveDays });
      updated += 1;
    }
    return { ok: true, updated };
  },
});

/**
 * Re-activate EVERY expired trial with `extraDays` of fresh active
 * usage. Useful for "we messed up, here's a fresh trial for everyone
 * whose trial expired" recovery scenarios. Returns the count updated.
 *
 * Optional `sinceMs` filter — only re-activates trials that expired
 * after this timestamp. Useful to limit the scope to recent expiries
 * (e.g. "everyone whose trial expired in the last 30 days").
 */
export const bulkExtendExpiredTrials = mutation({
  args: { extraDays: v.number(), sinceMs: v.optional(v.number()) },
  handler: async (ctx, { extraDays, sinceMs }) => {
    await requireAdminUser(ctx);
    if (!Number.isFinite(extraDays) || extraDays <= 0 || extraDays > 365) {
      throw new ConvexError({
        message: "Extra days must be a positive number (max 365).",
        code: "invalid",
      });
    }
    const expired = await ctx.db
      .query("subscriptions")
      .withIndex("by_status", (q) => q.eq("status", "expired"))
      .collect();
    let updated = 0;
    for (const sub of expired) {
      // Optional time filter — only re-activate if the trial expired
      // after sinceMs.
      if (sinceMs !== undefined && (sub.trialEndsAt ?? 0) < sinceMs) continue;
      const newActiveDays = Math.max(0, sub.trialActiveDays - extraDays);
      await ctx.db.patch(sub._id, {
        status: "trial",
        trialActiveDays: newActiveDays,
        trialEndsAt: undefined,
        trialStartedAt: sub.trialStartedAt ?? Date.now(),
      });
      updated += 1;
    }
    return { ok: true, updated };
  },
});

/**
 * Admin dashboard query — returns a snapshot of the subscription state
 * across all users so the Subscriptions tab can render real numbers
 * (active trials, expired trials, paid subscribers, etc.) and a list
 * of recent users for the per-user trial tools.
 */
export const getSubscriptionOverview = query({
  args: { sinceMs: v.optional(v.number()) },
  handler: async (ctx, { sinceMs }) => {
    await requireAdminUser(ctx);
    const trialDays = await getTrialDays(ctx);

    const all = await ctx.db.query("subscriptions").collect();
    const inProgressTrials = all.filter((s) => s.status === "trial");
    const expiredTrials = all.filter((s) => s.status === "expired");
    const paidActive = all.filter((s) => s.status === "active");
    const canceled = all.filter((s) => s.status === "canceled");

    // Filter expired trials by the sinceMs cutoff for the "re-activate
    // expired trials in the last N days" UI.
    const cutoff = sinceMs ?? 0;
    const expiredSince = expiredTrials.filter(
      (s) => (s.trialEndsAt ?? 0) >= cutoff,
    );

    // Build a recent-users list for the per-user tools — join
    // subscriptions with their user rows, sort by most-recent activity.
    const rows: Array<{
      userId: Id<"users">;
      userName: string;
      userEmail: string;
      status: string;
      trialActiveDays: number;
      trialDaysRemaining: number;
      trialStartedAt: number | null;
      trialEndsAt: number | null;
      currentPeriodEnd: number | null;
      lastActiveDate: string | null;
    }> = [];
    for (const sub of all) {
      const user = await ctx.db.get(sub.userId);
      rows.push({
        userId: sub.userId,
        userName: user?.name ?? "Unknown",
        userEmail: user?.email ?? "",
        status: sub.status,
        trialActiveDays: sub.trialActiveDays,
        trialDaysRemaining: Math.max(0, trialDays - sub.trialActiveDays),
        trialStartedAt: sub.trialStartedAt ?? null,
        trialEndsAt: sub.trialEndsAt ?? null,
        currentPeriodEnd: sub.currentPeriodEnd ?? null,
        lastActiveDate: sub.lastActiveDate ?? null,
      });
    }
    // Most recently active first (by lastActiveDate for in-progress, by
    // trialEndsAt for expired, by currentPeriodEnd for paid). lastActiveDate
    // is a "YYYY-MM-DD" string, so we parse it to epoch ms for comparison.
    rows.sort((a, b) => {
      const aT = (a.lastActiveDate ? new Date(a.lastActiveDate).getTime() : 0)
        || a.trialEndsAt
        || a.currentPeriodEnd
        || 0;
      const bT = (b.lastActiveDate ? new Date(b.lastActiveDate).getTime() : 0)
        || b.trialEndsAt
        || b.currentPeriodEnd
        || 0;
      return bT - aT;
    });

    return {
      trialDaysConfigured: trialDays,
      stats: {
        inProgressTrials: inProgressTrials.length,
        expiredTrials: expiredTrials.length,
        expiredSinceCutoff: expiredSince.length,
        paidActive: paidActive.length,
        canceled: canceled.length,
        total: all.length,
      },
      users: rows.slice(0, 100), // cap for the table view
    };
  },
});
