// Admin control center backend.
//
// Everything here is gated server-side by the existing admin role check
// (admin.ts). Queries return empty/throw for non-admins; mutations throw
// before touching anything. Password/auth internals are never exposed — the
// users list only returns display-level fields.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdmin, hasMinRole } from "./admin";
import { ROLES } from "./schema";

type DbCtx = MutationCtx | QueryCtx;

async function requireAdmin(ctx: DbCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  const user = await ctx.db.get(userId);
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({
      message: "Admin access required. Sign in with an admin account.",
      code: "unauthorized",
    });
  }
  // Admin center requires role >= admin (not just moderator)
  if (!hasMinRole(user, ROLES.ADMIN)) {
    throw new ConvexError({
      message: "Admin access required. Moderators cannot access this section.",
      code: "unauthorized",
    });
  }
  return user;
}

const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Last `count` month keys, oldest first, ending at the current month. */
function recentMonthKeys(count: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[(m ?? 1) - 1]} ’${String(y ?? 0).slice(2)}`;
}

/** When a completed payment actually earned money (falls back to creation). */
function completedPaymentTs(payment: Doc<"payments">): number {
  return payment.completedAt ?? payment.createdAt;
}

function buildRevenueSeries(
  payments: Doc<"payments">[],
  keys: string[],
): { label: string; revenue: number; payments: number }[] {
  const byIndex = new Map(keys.map((k, i) => [k, i]));
  const series = keys.map((key) => ({ label: monthLabel(key), revenue: 0, payments: 0 }));
  for (const payment of payments) {
    if (payment.status !== "completed") continue;
    const idx = byIndex.get(monthKey(completedPaymentTs(payment)));
    if (idx !== undefined) {
      series[idx]!.revenue += payment.amount;
      series[idx]!.payments += 1;
    }
  }
  return series;
}

function providerTotals(
  payments: Doc<"payments">[],
): { provider: string; total: number; count: number }[] {
  const totals = new Map<string, { total: number; count: number }>();
  for (const payment of payments) {
    if (payment.status !== "completed") continue;
    const entry = totals.get(payment.provider) ?? { total: 0, count: 0 };
    entry.total += payment.amount;
    entry.count += 1;
    totals.set(payment.provider, entry);
  }
  return [...totals.entries()]
    .map(([provider, value]) => ({ provider, ...value }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  isAnonymous: boolean;
  role: string | null;
  createdAt: number;
  subscriptionStatus: string;
  trialActiveDays: number;
  planTier: string | null;
  stream: string | null;
  displayName: string | null;
  usage: {
    studyHours: number;
    sessions: number;
    quizzes: number;
    xp: number;
    lastActiveAt: number | null;
  };
}

export const listUsers = query({
  args: {},
  handler: async (ctx): Promise<AdminUserRow[]> => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(100);
    const subscriptions = await ctx.db.query("subscriptions").collect();
    const profiles = await ctx.db.query("userProfiles").collect();
    const sessions = await ctx.db.query("studySessions").collect();
    const xpRows = await ctx.db.query("xpLedger").collect();
    const attempts = await ctx.db.query("quizAttempts").collect();

    const subByUser = new Map(
      subscriptions.map((sub) => [sub.userId, sub]),
    );
    const profileByUser = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    );

    // Per-user usage aggregates — who is ACTUALLY studying, not just signed up.
    const hoursByUser = new Map<Id<"users">, number>();
    const sessionsByUser = new Map<Id<"users">, number>();
    const lastActiveByUser = new Map<Id<"users">, number>();
    for (const session of sessions) {
      hoursByUser.set(
        session.userId,
        (hoursByUser.get(session.userId) ?? 0) + session.durationSeconds / 3600,
      );
      sessionsByUser.set(
        session.userId,
        (sessionsByUser.get(session.userId) ?? 0) + 1,
      );
      const last = lastActiveByUser.get(session.userId) ?? 0;
      if (session.endedAt > last) lastActiveByUser.set(session.userId, session.endedAt);
    }
    const xpByUser = new Map<Id<"users">, number>();
    for (const row of xpRows) {
      xpByUser.set(row.userId, (xpByUser.get(row.userId) ?? 0) + row.amount);
    }
    const quizzesByUser = new Map<Id<"users">, number>();
    for (const attempt of attempts) {
      quizzesByUser.set(attempt.userId, (quizzesByUser.get(attempt.userId) ?? 0) + 1);
    }

    return users.map((user) => {
      const sub = subByUser.get(user._id);
      const profile = profileByUser.get(user._id);
      return {
        _id: user._id,
        name: user.name ?? null,
        email: user.email ?? null,
        isAnonymous: user.isAnonymous ?? false,
        role: user.role ?? null,
        createdAt: user._creationTime,
        subscriptionStatus: sub?.status ?? "none",
        trialActiveDays: sub?.trialActiveDays ?? 0,
        planTier: sub?.planTier ?? null,
        stream: profile?.stream ?? null,
        displayName: profile?.displayName ?? null,
        usage: {
          studyHours: Math.round((hoursByUser.get(user._id) ?? 0) * 10) / 10,
          sessions: sessionsByUser.get(user._id) ?? 0,
          quizzes: quizzesByUser.get(user._id) ?? 0,
          xp: xpByUser.get(user._id) ?? 0,
          lastActiveAt: lastActiveByUser.get(user._id) ?? null,
        },
      };
    });
  },
});

/**
 * Manually grant / expire / cancel premium for a user (support cases).
 * Only admins can call this, and it only touches the subscription row.
 */
export const setUserPremium = mutation({
  args: {
    userId: v.id("users"),
    action: v.union(v.literal("activate"), v.literal("expire"), v.literal("cancel")),
  },
  handler: async (ctx, { userId, action }) => {
    await requireAdmin(ctx);
    const target = await ctx.db.get(userId);
    if (!target) {
      throw new ConvexError({ message: "User not found.", code: "not_found" });
    }

    // Ensure a row exists so we never hit a missing-subscription edge case.
    const subId: Id<"subscriptions"> = await ctx.runMutation(
      internal.subscriptions.ensureSubscription,
      { userId },
    );
    const sub = await ctx.db.get(subId);
    if (!sub) return { ok: false };

    if (action === "activate") {
      const base = Math.max(Date.now(), sub.currentPeriodEnd ?? 0);
      await ctx.db.patch(sub._id, {
        status: "active",
        currentPeriodEnd: base + SUBSCRIPTION_MS,
        planTier: "premium",
      });
    } else if (action === "expire") {
      await ctx.db.patch(sub._id, {
        status: "expired",
        trialEndsAt: Date.now(),
      });
    } else {
      await ctx.db.patch(sub._id, { status: "canceled" });
    }
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const listAllPayments = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const payments = await ctx.db
      .query("payments")
      .order("desc")
      .take(100);

    const userCache = new Map<Id<"users">, Doc<"users">>();
    const result = [];
    for (const payment of payments) {
      let user = userCache.get(payment.userId);
      if (!user) {
        user = (await ctx.db.get(payment.userId)) ?? undefined;
        if (user) userCache.set(payment.userId, user);
      }
      result.push({
        _id: payment._id,
        provider: payment.provider,
        amount: payment.amount,
        currency: payment.currency,
        providerTransactionId: payment.providerTransactionId ?? null,
        status: payment.status,
        createdAt: payment.createdAt,
        completedAt: payment.completedAt ?? null,
        userEmail: user?.email ?? null,
        userName: user?.name ?? null,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

async function countTable(ctx: QueryCtx, table: string): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const page = await ctx.db.query(table as never).paginate({
      numItems: 100,
      cursor: cursor ?? null,
    });
    total += page.page.length;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return total;
}

export const getAdminStats = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [users, contentItems, payments, subscriptions, quizzes, quizAttempts, studyPlans, todos, notes] =
      await Promise.all([
        countTable(ctx, "users"),
        countTable(ctx, "contentItems"),
        countTable(ctx, "payments"),
        countTable(ctx, "subscriptions"),
        countTable(ctx, "quizzes"),
        countTable(ctx, "quizAttempts"),
        countTable(ctx, "studyPlans"),
        countTable(ctx, "todos"),
        countTable(ctx, "notes"),
      ]);

    const paymentRows = await ctx.db.query("payments").collect();
    const subscriptionRows = await ctx.db.query("subscriptions").collect();
    const byPaymentStatus = { pending: 0, completed: 0, failed: 0 };
    for (const payment of paymentRows) {
      byPaymentStatus[payment.status] = (byPaymentStatus[payment.status] ?? 0) + 1;
    }
    const bySubscriptionStatus = { trial: 0, active: 0, expired: 0, canceled: 0 };
    for (const sub of subscriptionRows) {
      bySubscriptionStatus[sub.status] = (bySubscriptionStatus[sub.status] ?? 0) + 1;
    }

    return {
      users,
      contentItems,
      payments,
      subscriptions,
      quizzes,
      quizAttempts,
      studyPlans,
      todos,
      notes,
      byPaymentStatus,
      bySubscriptionStatus,
    };
  },
});

// ---------------------------------------------------------------------------
// Dashboard + finance (the command center)
// ---------------------------------------------------------------------------

export interface AdminDashboard {
  totals: {
    users: number;
    activeThisWeek: number;
    activeToday: number;
    contentItems: number;
    payingUsers: number;
    revenueTotal: number;
    revenueThisMonth: number;
    paymentsCompleted: number;
  };
  revenueByMonth: { label: string; revenue: number; payments: number }[];
  revenueByProvider: { provider: string; total: number; count: number }[];
  newUsersByMonth: { label: string; count: number }[];
  contentByType: { contentType: string; count: number }[];
  usersByStream: { stream: string; count: number }[];
  subscriptionBreakdown: { status: string; count: number }[];
  powerUsers: {
    userId: Id<"users">;
    name: string;
    xp: number;
    hours: number;
    sessions: number;
    quizzes: number;
    streak: number;
  }[];
  recentSignups: {
    userId: Id<"users">;
    name: string;
    email: string | null;
    createdAt: number;
    isAnonymous: boolean;
  }[];
}

/**
 * The main admin dashboard: live totals, revenue series, activity, content
 * inventory, stream split, power users and recent signups. One reactive
 * query so the control center feels instant.
 */
export const getAdminDashboard = query({
  args: {},
  handler: async (ctx): Promise<AdminDashboard> => {
    await requireAdmin(ctx);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [users, subscriptions, payments, contentItems, profiles, streaks, sessions, xpRows, attempts] =
      await Promise.all([
        ctx.db.query("users").take(300),
        ctx.db.query("subscriptions").collect(),
        ctx.db.query("payments").collect(),
        ctx.db.query("contentItems").take(500),
        ctx.db.query("userProfiles").collect(),
        ctx.db.query("studyStreaks").collect(),
        ctx.db.query("studySessions").collect(),
        ctx.db.query("xpLedger").collect(),
        ctx.db.query("quizAttempts").collect(),
      ]);

    // --- Revenue ---------------------------------------------------------
    const revenueByMonth = buildRevenueSeries(payments, recentMonthKeys(12));
    let revenueTotal = 0;
    let revenueThisMonth = 0;
    let paymentsCompleted = 0;
    for (const payment of payments) {
      if (payment.status !== "completed") continue;
      const ts = completedPaymentTs(payment);
      revenueTotal += payment.amount;
      paymentsCompleted += 1;
      if (ts >= monthStart.getTime()) revenueThisMonth += payment.amount;
    }
    const revenueByProvider = providerTotals(payments);

    // --- Activity (who actually used the app this week / today) ----------
    const activeWeek = new Set<Id<"users">>();
    const activeToday = new Set<Id<"users">>();
    const hoursByUser = new Map<Id<"users">, number>();
    const sessionsByUser = new Map<Id<"users">, number>();
    for (const session of sessions) {
      hoursByUser.set(
        session.userId,
        (hoursByUser.get(session.userId) ?? 0) + session.durationSeconds / 3600,
      );
      sessionsByUser.set(
        session.userId,
        (sessionsByUser.get(session.userId) ?? 0) + 1,
      );
      if (session.startedAt >= weekAgo) activeWeek.add(session.userId);
      if (session.startedAt >= dayAgo) activeToday.add(session.userId);
    }
    for (const row of xpRows) {
      if (row.createdAt >= weekAgo) activeWeek.add(row.userId);
      if (row.createdAt >= dayAgo) activeToday.add(row.userId);
    }
    for (const attempt of attempts) {
      if (attempt.completedAt >= weekAgo) activeWeek.add(attempt.userId);
    }

    // --- Subscriptions ---------------------------------------------------
    const statusCounts: Record<string, number> = { trial: 0, active: 0, expired: 0, canceled: 0 };
    let payingUsers = 0;
    for (const sub of subscriptions) {
      statusCounts[sub.status] = (statusCounts[sub.status] ?? 0) + 1;
      if (sub.status === "active" || sub.status === "trial") payingUsers += 1;
    }
    const usersWithSub = new Set(subscriptions.map((s) => s.userId));
    const subscriptionBreakdown = [
      ...Object.entries(statusCounts).map(([status, count]) => ({ status, count })),
      { status: "none", count: users.filter((u) => !usersWithSub.has(u._id)).length },
    ];

    // --- Content + streams + signups -------------------------------------
    const contentCounts: Record<string, number> = {};
    for (const item of contentItems) {
      contentCounts[item.contentType] = (contentCounts[item.contentType] ?? 0) + 1;
    }
    const contentByType = Object.entries(contentCounts)
      .map(([contentType, count]) => ({ contentType, count }))
      .sort((a, b) => b.count - a.count);

    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const streamCounts: Record<string, number> = { natural: 0, social: 0, onboarding: 0 };
    for (const user of users) {
      const stream = profileByUser.get(user._id)?.stream;
      streamCounts[stream ?? "onboarding"] = (streamCounts[stream ?? "onboarding"] ?? 0) + 1;
    }
    const usersByStream = Object.entries(streamCounts).map(([stream, count]) => ({ stream, count }));

    const signupKeys = recentMonthKeys(6);
    const newUsersByMonth = signupKeys.map((key) => ({ label: monthLabel(key), count: 0 }));
    const signupIndex = new Map(signupKeys.map((k, i) => [k, i]));
    for (const user of users) {
      const idx = signupIndex.get(monthKey(user._creationTime));
      if (idx !== undefined) newUsersByMonth[idx]!.count += 1;
    }

    // --- Power users (ranked by XP — every study action aggregates here) -
    const xpByUser = new Map<Id<"users">, number>();
    for (const row of xpRows) {
      xpByUser.set(row.userId, (xpByUser.get(row.userId) ?? 0) + row.amount);
    }
    const quizzesByUser = new Map<Id<"users">, number>();
    for (const attempt of attempts) {
      quizzesByUser.set(attempt.userId, (quizzesByUser.get(attempt.userId) ?? 0) + 1);
    }
    const streakByUser = new Map(streaks.map((s) => [s.userId, s.currentStreak]));

    const powerUsers = [...xpByUser.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([userId, xp]) => {
        const user = users.find((u) => u._id === userId);
        const profile = profileByUser.get(userId);
        return {
          userId,
          name: profile?.displayName ?? user?.name ?? user?.email ?? "Guest",
          xp,
          hours: Math.round((hoursByUser.get(userId) ?? 0) * 10) / 10,
          sessions: sessionsByUser.get(userId) ?? 0,
          quizzes: quizzesByUser.get(userId) ?? 0,
          streak: streakByUser.get(userId) ?? 0,
        };
      });

    const recentSignups = [...users]
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 6)
      .map((user) => ({
        userId: user._id,
        name: profileByUser.get(user._id)?.displayName ?? user.name ?? user.email ?? "Guest",
        email: user.email ?? null,
        createdAt: user._creationTime,
        isAnonymous: user.isAnonymous ?? false,
      }));

    return {
      totals: {
        users: users.length,
        activeThisWeek: activeWeek.size,
        activeToday: activeToday.size,
        contentItems: contentItems.length,
        payingUsers,
        revenueTotal,
        revenueThisMonth,
        paymentsCompleted,
      },
      revenueByMonth,
      revenueByProvider,
      newUsersByMonth,
      contentByType,
      usersByStream,
      subscriptionBreakdown,
      powerUsers,
      recentSignups,
    };
  },
});

export interface FinanceOverview {
  totalEarned: number;
  thisMonth: number;
  last30Days: number;
  avgPayment: number;
  completedCount: number;
  pendingCount: number;
  failedCount: number;
  payingUsers: number;
  conversionRate: number;
  revenueByMonth: { label: string; revenue: number; payments: number }[];
  revenueByProvider: { provider: string; total: number; count: number }[];
  recentTransactions: {
    _id: Id<"payments">;
    provider: string;
    amount: number;
    currency: string;
    status: string;
    createdAt: number;
    completedAt: number | null;
    providerTransactionId: string | null;
    userEmail: string | null;
    userName: string | null;
  }[];
}

/** Finance page: money earned, monthly series, provider split, conversion. */
export const getFinanceOverview = query({
  args: {},
  handler: async (ctx): Promise<FinanceOverview> => {
    await requireAdmin(ctx);
    const now = Date.now();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    const [payments, users, subscriptions] = await Promise.all([
      ctx.db.query("payments").collect(),
      ctx.db.query("users").take(300),
      ctx.db.query("subscriptions").collect(),
    ]);

    let totalEarned = 0;
    let thisMonth = 0;
    let last30Days = 0;
    let completedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    for (const payment of payments) {
      if (payment.status === "completed") {
        const ts = completedPaymentTs(payment);
        totalEarned += payment.amount;
        completedCount += 1;
        if (ts >= monthStart.getTime()) thisMonth += payment.amount;
        if (ts >= thirtyDaysAgo) last30Days += payment.amount;
      } else if (payment.status === "pending") {
        pendingCount += 1;
      } else {
        failedCount += 1;
      }
    }

    const userById = new Map(users.map((u) => [u._id, u]));
    const recentTransactions = [...payments]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 25)
      .map((payment) => {
        const user = userById.get(payment.userId);
        return {
          _id: payment._id,
          provider: payment.provider,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          createdAt: payment.createdAt,
          completedAt: payment.completedAt ?? null,
          providerTransactionId: payment.providerTransactionId ?? null,
          userEmail: user?.email ?? null,
          userName: user?.name ?? null,
        };
      });

    const payingUsers = subscriptions.filter(
      (s) => s.status === "active" || s.status === "trial",
    ).length;

    return {
      totalEarned,
      thisMonth,
      last30Days,
      avgPayment: completedCount > 0 ? totalEarned / completedCount : 0,
      completedCount,
      pendingCount,
      failedCount,
      payingUsers,
      conversionRate: users.length > 0 ? payingUsers / users.length : 0,
      revenueByMonth: buildRevenueSeries(payments, recentMonthKeys(12)),
      revenueByProvider: providerTotals(payments),
      recentTransactions,
    };
  },
});

// ---------------------------------------------------------------------------
// System — read-only env configuration status
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "GROQ_API_KEY",
  "AI_MODEL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "TELEBIRR_APP_ID",
  "TELEBIRR_APP_KEY",
  "TELEBIRR_SHORT_CODE",
  "TELEBIRR_FABRIC_APP_ID",
  "TELEBIRR_PRIVATE_KEY",
  "MPESA_CONSUMER_KEY",
  "MPESA_CONSUMER_SECRET",
  "MPESA_SHORT_CODE",
  "MPESA_PASSKEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_TOKEN",
  "TELEGRAM_BOT_TOKEN",
  "LIVEKIT_URL",
  "LIVEKIT_API_KEY",
  "LIVEKIT_API_SECRET",
  "YOUTUBE_API_KEY",
] as const;

export const getSystemStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    // Check both configKeys table and env vars.
    const stored = await ctx.db.query("configKeys").collect();
    const storedMap = new Map(stored.map((r) => [r.key, r.value]));
    return {
      keys: ENV_KEYS.map((key) => ({
        key,
        configured: Boolean(storedMap.get(key) || process.env[key]),
      })),
      convexUrl: process.env.CONVEX_SITE_URL ?? null,
    };
  },
});

// ---------------------------------------------------------------------------
// Integration status (A3) — configured + real usage from systemEvents.
// NEVER returns a key value back to the browser, even to an admin.
// ---------------------------------------------------------------------------

const INTEGRATION_DEFS = [
  {
    id: "groq",
    label: "Groq (primary AI)",
    envKey: "GROQ_API_KEY",
    sourcePrefix: "ai.",
  },
  {
    id: "groqReader",
    label: "Groq (reader)",
    envKey: "GROQ_API_KEY",
    sourcePrefix: "reader.",
  },
  {
    id: "telegram",
    label: "Telegram",
    envKey: "TELEGRAM_BOT_TOKEN",
    sourcePrefix: "telegram.",
  },
  {
    id: "livekit",
    label: "LiveKit (rooms)",
    envKey: "LIVEKIT_API_KEY",
    sourcePrefix: "rooms.",
  },
  {
    id: "r2",
    label: "Cloudflare R2",
    envKey: "R2_ACCOUNT_ID",
    sourcePrefix: "contentAdmin.",
  },
  {
    id: "telebirr",
    label: "TeleBirr",
    envKey: "TELEBIRR_APP_ID",
    sourcePrefix: "payments.initiate",
  },
  {
    id: "mpesa",
    label: "M-Pesa",
    envKey: "MPESA_CONSUMER_KEY",
    sourcePrefix: "payments.initiate",
  },
  {
    id: "google",
    label: "Google OAuth",
    envKey: "GOOGLE_CLIENT_ID",
    sourcePrefix: null,
  },
  {
    id: "github",
    label: "GitHub",
    envKey: "GITHUB_TOKEN",
    sourcePrefix: "github",
  },
] as const;

export interface IntegrationStatusRow {
  id: string;
  label: string;
  configured: boolean;
  calls24h: number;
  errors24h: number;
  errorRate: number;
  lastUsedAt: number | null;
}

/**
 * Per-integration status: configured (env key present — value never shown),
 * plus real 24h call volume + error rate derived from systemEvents.
 */
export const getIntegrationStatus = query({
  args: {},
  handler: async (ctx): Promise<IntegrationStatusRow[]> => {
    await requireAdmin(ctx);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("systemEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .take(2000);

    const rows: IntegrationStatusRow[] = [];
    for (const def of INTEGRATION_DEFS) {
      const relevant = def.sourcePrefix
        ? events.filter((event) => event.source.startsWith(def.sourcePrefix))
        : [];

      // TeleBirr vs M-Pesa share the payments.initiate source — split by
      // the provider field in the JSON metadata.
      let calls = relevant.length;
      let errors = 0;
      let lastUsedAt: number | null = null;
      if (def.sourcePrefix === "payments.initiate") {
        calls = 0;
        for (const event of relevant) {
          let provider: string | null = null;
          if (event.metadata) {
            try {
              const parsed = JSON.parse(event.metadata) as { provider?: string };
              provider = parsed.provider ?? null;
            } catch {
              // ignore
            }
          }
          if (provider !== def.id) continue;
          calls += 1;
          if (event.status === "error") errors += 1;
          if (event.createdAt > (lastUsedAt ?? 0)) lastUsedAt = event.createdAt;
        }
      } else {
        for (const event of relevant) {
          if (event.status === "error") errors += 1;
          if (event.createdAt > (lastUsedAt ?? 0)) lastUsedAt = event.createdAt;
        }
      }

      const dbKeyEntry = await ctx.db
        .query("configKeys")
        .withIndex("by_key", (q) => q.eq("key", def.envKey))
        .first();

      rows.push({
        id: def.id,
        label: def.label,
        configured: Boolean(dbKeyEntry?.value || process.env[def.envKey]),
        calls24h: calls,
        errors24h: errors,
        errorRate: calls > 0 ? errors / calls : 0,
        lastUsedAt,
      });
    }
    return rows;
  },
});

// ------------------------------------------------------------------
// Auth rate-limit helpers
// ------------------------------------------------------------------

/** Clear sign-in rate limits for a specific email (or all). */
export const clearAuthRateLimits = mutation({
  args: { email: v.optional(v.string()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    if (args.email) {
      const existing = await ctx.db
        .query("authRateLimits")
        .withIndex("identifier", (q) => q.eq("identifier", args.email!.toLowerCase()))
        .unique();
      if (existing) await ctx.db.delete(existing._id);
      return { cleared: true, email: args.email };
    }
    // Clear all rate limits
    const all = await ctx.db.query("authRateLimits").collect();
    for (const r of all) await ctx.db.delete(r._id);
    return { cleared: true, count: all.length };
  },
});
