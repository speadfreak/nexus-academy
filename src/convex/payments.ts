// Payment orchestration for the premium subscription.
//
// Flow: initiatePayment (action) creates a pending `payments` row and asks the
// provider adapter for a checkout URL/reference -> customer pays -> the
// provider webhook (see http.ts) or client polling via verifyPayment runs
// confirmPaymentInternal (paymentsDb.ts), which is idempotent and flips the
// subscription to "active" with a 30-day period.
//
// This module is "use node" because the provider adapters need Node APIs
// (Buffer, fetch). Only actions can live here — the row plumbing mutations
// and public queries are in paymentsDb.ts.
"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import * as telebirr from "./providers/telebirr";
import * as mpesa from "./providers/mpesa";
import { PREMIUM_PRICE_ETB, SUBSCRIPTION_DAYS } from "./constants";
import { logEventAction } from "./systemEvents";

const SUBSCRIPTION_MS = SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000;

type Provider = "telebirr" | "mpesa";
type PaymentStatus = "pending" | "completed" | "failed";

// ---------------------------------------------------------------------------
// initiatePayment — creates the row, then asks the provider for a reference
// ---------------------------------------------------------------------------

export const initiatePayment = action({
  args: {
    provider: v.union(v.literal("telebirr"), v.literal("mpesa")),
    amount: v.number(),
    phoneNumber: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    paymentId: Id<"payments">;
    checkoutUrl: string | null;
    providerTransactionId: string | null;
    provider: Provider;
    amount: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    // Validate amount — only the premium price is accepted server-side.
    if (!Number.isInteger(args.amount) || args.amount !== PREMIUM_PRICE_ETB) {
      throw new ConvexError({
        message: `Invalid amount. Premium access costs ${PREMIUM_PRICE_ETB} ETB.`,
        code: "invalid",
      });
    }
    if (args.provider === "mpesa" && !args.phoneNumber) {
      throw new ConvexError({
        message: "An M-Pesa phone number is required (e.g. 251912345678).",
        code: "invalid",
      });
    }

    const now = Date.now();
    const paymentId = await ctx.runMutation(internal.paymentsDb.insertPaymentRow, {
      userId,
      provider: args.provider,
      amount: args.amount,
      createdAt: now,
    });

    try {
      if (args.provider === "telebirr") {
        // TeleBirr requires an alphanumeric merchant order id.
        const merchOrderId = `NX${now}${Math.floor(Math.random() * 900 + 100)}`;
        const result = await telebirr.initiateCheckout({
          amount: args.amount,
          merchOrderId,
          userId,
        });
        await ctx.runMutation(internal.paymentsDb.setProviderTransactionId, {
          paymentId,
          providerTransactionId: result.providerTransactionId,
        });
        await logEventAction(ctx, {
          eventType: "payment_event",
          source: "payments.initiate",
          status: "success",
          userId,
          metadata: { provider: "telebirr", amount: args.amount, paymentId },
        });
        return {
          paymentId,
          checkoutUrl: result.checkoutUrl,
          providerTransactionId: result.providerTransactionId,
          provider: "telebirr",
          amount: args.amount,
        };
      }

      const result = await mpesa.initiateCheckout({
        amount: args.amount,
        phoneNumber: args.phoneNumber!,
        userId,
      });
      await ctx.runMutation(internal.paymentsDb.setProviderTransactionId, {
        paymentId,
        providerTransactionId: result.providerTransactionId,
      });
      await logEventAction(ctx, {
        eventType: "payment_event",
        source: "payments.initiate",
        status: "success",
        userId,
        metadata: { provider: "mpesa", amount: args.amount, paymentId },
      });
      return {
        paymentId,
        checkoutUrl: null,
        providerTransactionId: result.providerTransactionId,
        provider: "mpesa",
        amount: args.amount,
      };
    } catch (error) {
      // Mark the row failed so it never lingers as "pending" on failure.
      await ctx.runMutation(internal.paymentsDb.setPaymentStatus, {
        paymentId,
        status: "failed",
      });
      await logEventAction(ctx, {
        eventType: "payment_event",
        source: "payments.initiate",
        status: "error",
        userId,
        metadata: {
          provider: args.provider,
          amount: args.amount,
          paymentId,
          message: error instanceof Error ? error.message : "unknown",
        },
      });
      throw error;
    }
  },
});

// ---------------------------------------------------------------------------
// Client polling — asks the provider, settles if paid.
// ---------------------------------------------------------------------------

export const verifyPayment = action({
  args: { paymentId: v.id("payments") },
  handler: async (
    ctx,
    { paymentId },
  ): Promise<{ status: "completed" | "pending" | "failed" }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const payment = await ctx.runQuery(internal.paymentsDb.getPaymentById, { paymentId });
    if (!payment || payment.userId !== userId) {
      throw new ConvexError({ message: "Payment not found.", code: "not_found" });
    }
    if (payment.status === "completed") {
      return { status: "completed" as const };
    }
    if (!payment.providerTransactionId) {
      return { status: payment.status as PaymentStatus };
    }

    let verified: { status: "completed" | "pending" | "failed" };
    if (payment.provider === "telebirr") {
      verified = await telebirr.verifyTransaction(payment.providerTransactionId);
    } else {
      verified = await mpesa.verifyTransaction(payment.providerTransactionId);
    }

    if (verified.status === "completed") {
      await ctx.runMutation(internal.paymentsDb.confirmPaymentInternal, {
        paymentId,
        providerTransactionId: payment.providerTransactionId,
      });
      await logEventAction(ctx, {
        eventType: "payment_event",
        source: "payments.verify",
        status: "success",
        userId,
        metadata: { paymentId, provider: payment.provider, amount: payment.amount, outcome: "completed" },
      });
      return { status: "completed" as const };
    }
    if (verified.status === "failed") {
      await ctx.runMutation(internal.paymentsDb.setPaymentStatus, {
        paymentId,
        status: "failed",
      });
      await logEventAction(ctx, {
        eventType: "payment_event",
        source: "payments.verify",
        status: "error",
        userId,
        metadata: { paymentId, provider: payment.provider, amount: payment.amount, outcome: "failed" },
      });
      return { status: "failed" as const };
    }
    return { status: "pending" as const };
  },
});

export type PaymentDoc = Doc<"payments">;
