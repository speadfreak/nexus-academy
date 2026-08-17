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
import { isAdmin } from "./admin";

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
  return user;
}

const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(100);
    const subscriptions = await ctx.db.query("subscriptions").collect();
    const profiles = await ctx.db.query("userProfiles").collect();

    const subByUser = new Map(
      subscriptions.map((sub) => [sub.userId, sub]),
    );
    const profileByUser = new Map(
      profiles.map((profile) => [profile.userId, profile]),
    );

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
    const subId = await ctx.runMutation(internal.subscriptions.ensureSubscription, {
      userId,
    });
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
// System — read-only env configuration status
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "XAI_API_KEY",
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
  "MPESA_SHORTCODE",
  "MPESA_PASSKEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_TOKEN",
] as const;

export const getSystemStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return {
      keys: ENV_KEYS.map((key) => ({ key, configured: Boolean(process.env[key]) })),
      convexUrl: process.env.CONVEX_SITE_URL ?? null,
    };
  },
});
