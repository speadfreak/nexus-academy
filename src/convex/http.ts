import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import * as telebirr from "./providers/telebirr";
import * as mpesa from "./providers/mpesa";

const http = httpRouter();

auth.addHttpRoutes(http);

// One-time seed endpoint for the subjects table. Idempotent (safe to call
// multiple times): POST /seed-subjects
//   curl -X POST <CONVEX_URL>/seed-subjects
http.route({
  path: "/seed-subjects",
  method: "POST",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runMutation(api.subjects.seed);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// ---------------------------------------------------------------------------
// Payment webhooks — async confirmation from the providers.
//
// Both handlers verify server-to-server with the provider before settling
// (never trust the callback payload alone), then settle idempotently via
// confirmPaymentInternal. Any non-2xx response tells the provider to retry.
// ---------------------------------------------------------------------------

// TeleBirr POSTs a JSON notification to the configured notifyUrl. The body is
// sometimes wrapped in a `data` envelope. Acknowledge with {"success": true}.
http.route({
  path: "/webhooks/telebirr",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const raw = await request.text();
      const body = JSON.parse(raw) as Record<string, unknown>;
      // Unwrap the documented data envelope if present.
      const data =
        body && typeof body.data === "object" && body.data !== null
          ? (body.data as Record<string, unknown>)
          : body;
      const merchOrderId =
        (data.merch_order_id as string | undefined) ??
        (data.merchOrderId as string | undefined) ??
        (body.merch_order_id as string | undefined);

      if (!merchOrderId) {
        return new Response(JSON.stringify({ success: false }), { status: 400 });
      }

      const payment = await ctx.runQuery(
        internal.paymentsDb.getPaymentByProviderTransactionId,
        { providerTransactionId: merchOrderId },
      );
      if (!payment) {
        // Unknown order — acknowledge but don't settle.
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (payment.status === "completed") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }

      // Confirm server-to-server with TeleBirr, then settle idempotently.
      const verified = await telebirr.verifyTransaction(merchOrderId);
      if (verified.status === "completed") {
        await ctx.runMutation(internal.paymentsDb.confirmPaymentInternal, {
          paymentId: payment._id,
          providerTransactionId: merchOrderId,
        });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch {
      // Return non-2xx so TeleBirr retries the notification.
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
  }),
});

// M-Pesa STK push callback: { Body: { stkCallback: { CheckoutRequestID,
// ResultCode, ResultDesc, CallbackMetadata } } }. ResultCode 0 = success.
http.route({
  path: "/webhooks/mpesa",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const raw = await request.text();
      const body = JSON.parse(raw) as {
        Body?: { stkCallback?: { CheckoutRequestID?: string; ResultCode?: number; ResultDesc?: string } };
      };
      const callback = body.Body?.stkCallback;
      const checkoutRequestId = callback?.CheckoutRequestID;
      if (!checkoutRequestId) {
        return new Response(
          JSON.stringify({ ResultCode: 1, ResultDesc: "Missing CheckoutRequestID" }),
          { status: 400 },
        );
      }

      const payment = await ctx.runQuery(
        internal.paymentsDb.getPaymentByProviderTransactionId,
        { providerTransactionId: checkoutRequestId },
      );
      if (!payment) {
        return new Response(
          JSON.stringify({ ResultCode: 1, ResultDesc: "Unknown transaction" }),
          { status: 400 },
        );
      }

      if (callback?.ResultCode === 0 && payment.status !== "completed") {
        // Cross-check with M-Pesa, then settle idempotently.
        const verified = await mpesa.verifyTransaction(checkoutRequestId);
        if (verified.status === "completed") {
          await ctx.runMutation(internal.paymentsDb.confirmPaymentInternal, {
            paymentId: payment._id,
            providerTransactionId: checkoutRequestId,
          });
        }
      }
      return new Response(
        JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }),
        { status: 200 },
      );
    } catch {
      return new Response(
        JSON.stringify({ ResultCode: 1, ResultDesc: "Internal error" }),
        { status: 500 },
      );
    }
  }),
});

export default http;
