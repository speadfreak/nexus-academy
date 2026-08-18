// Payments row plumbing — mutations and queries that the payments actions
// (payments.ts, "use node") and the webhooks (http.ts) call via
// ctx.runMutation / ctx.runQuery. Kept out of the "use node" file because
// only actions can be defined in Node.js-runtime modules.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";

export const getPaymentById = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) =>
    (await ctx.db.get(paymentId)) ?? null,
});

export const getPaymentByProviderTransactionId = internalQuery({
  args: { providerTransactionId: v.string() },
  handler: async (ctx, { providerTransactionId }) =>
    (await ctx.db
      .query("payments")
      .withIndex("by_providerTransactionId", (q) =>
        q.eq("providerTransactionId", providerTransactionId),
      )
      .unique()) ?? null,
});

export const insertPaymentRow = internalMutation({
  args: {
    userId: v.id("users"),
    provider: v.union(v.literal("telebirr"), v.literal("mpesa")),
    amount: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("payments", {
      userId: args.userId,
      provider: args.provider,
      amount: args.amount,
      currency: "ETB",
      status: "pending",
      createdAt: args.createdAt,
    }),
});

export const setProviderTransactionId = internalMutation({
  args: {
    paymentId: v.id("payments"),
    providerTransactionId: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, {
      providerTransactionId: args.providerTransactionId,
    });
    return { ok: true };
  },
});

export const setPaymentStatus = internalMutation({
  args: {
    paymentId: v.id("payments"),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.paymentId, { status: args.status });
    return { ok: true };
  },
});

/**
 * Idempotent settlement: flips the payment to "completed" and activates the
 * subscription. Called by webhooks and by client polling. Never double-fulfills.
 */
export const confirmPaymentInternal = internalMutation({
  args: {
    paymentId: v.id("payments"),
    providerTransactionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) {
      return { ok: false, alreadyCompleted: false };
    }
    if (payment.status === "completed") {
      return { ok: true, alreadyCompleted: true }; // idempotent — no double fulfillment
    }
    if (args.providerTransactionId && payment.providerTransactionId !== args.providerTransactionId) {
      // Only accept a settlement for the transaction that was actually initiated.
      return { ok: false, alreadyCompleted: false };
    }

    await ctx.db.patch(payment._id, {
      status: "completed",
      completedAt: Date.now(),
      providerTransactionId: args.providerTransactionId ?? payment.providerTransactionId,
    });
    await ctx.runMutation(internal.subscriptions.activateSubscription, {
      userId: payment.userId,
      periodEnd: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    return { ok: true, alreadyCompleted: false };
  },
});

/** The current user's recent payment attempts, newest first. */
export const getMyPayments = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("payments")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(20);
  },
});
