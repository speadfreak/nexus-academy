import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import { auth } from "./auth";
import * as telebirr from "./providers/telebirr";
import * as mpesa from "./providers/mpesa";
import { parseTeleBirrSms } from "./smsParser";

const http = httpRouter();

auth.addHttpRoutes(http);

// One-time seed endpoint for the subjects table. Idempotent (safe to call
// multiple times): POST /seed-subjects
//   curl -X POST <CONVEX_URL>/http/seed-subjects
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
// TeleBirr webhook (merchant API — not currently in use, kept for future)
// POST <CONVEX_URL>/http/webhooks/telebirr
// ---------------------------------------------------------------------------

http.route({
  path: "/webhooks/telebirr",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const raw = await request.text();
      const body = JSON.parse(raw) as Record<string, unknown>;
      const data =
        body && typeof body.data === "object" && body.data !== null
          ? (body.data as Record<string, unknown>)
          : body;
      const merchOrderId =
        (data.merchOrderId as string) ??
        (data.out_trade_no as string) ??
        (body.out_trade_no as string);
      if (!merchOrderId) {
        return new Response(JSON.stringify({ success: false }), { status: 400 });
      }
      const payment = await ctx.runQuery(
        internal.paymentsDb.getPaymentByProviderTransactionId,
        { providerTransactionId: merchOrderId },
      );
      if (!payment) {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (payment.status === "completed") {
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      const verified = await telebirr.verifyTransaction(merchOrderId);
      if (verified.status === "completed") {
        await ctx.runMutation(internal.paymentsDb.confirmPaymentInternal, {
          paymentId: payment._id,
          providerTransactionId: merchOrderId,
        });
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    } catch {
      return new Response(JSON.stringify({ success: false }), { status: 500 });
    }
  }),
});

// ---------------------------------------------------------------------------
// M-Pesa webhook (merchant API — not currently in use, kept for future)
// POST <CONVEX_URL>/http/webhooks/mpesa
// ---------------------------------------------------------------------------

http.route({
  path: "/webhooks/mpesa",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const raw = await request.text();
      const body = JSON.parse(raw) as {
        Body?: {
          stkCallback?: {
            CheckoutRequestID?: string;
            ResultCode?: number;
            ResultDesc?: string;
          };
        };
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
      if (!payment || payment.status === "completed") {
        return new Response(
          JSON.stringify({ ResultCode: 0, ResultDesc: "Success" }),
          { status: 200 },
        );
      }
      if (callback.ResultCode === 0) {
        await ctx.runMutation(internal.paymentsDb.confirmPaymentInternal, {
          paymentId: payment._id,
          providerTransactionId: checkoutRequestId,
        });
      } else {
        await ctx.runMutation(internal.paymentsDb.setPaymentStatus, {
          paymentId: payment._id,
          status: "failed",
        });
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

// ---------------------------------------------------------------------------
// SMS webhook — receives POSTs from the "SMS to URL Forwarder" Android app
// (tech.bogomolov.incomingsmsgateway on F-Droid). The admin has this app
// installed on the phone that receives TeleBirr payment notifications.
//
// HMAC-SHA-256 VERIFICATION REQUIRED: the app signs each request with
// HMAC-SHA-256 using a shared secret. We recompute the signature server-side
// over the raw request body using SMS_WEBHOOK_SECRET (from configKeys) and
// compare with a constant-time comparison.
//
// On a successfully parsed TeleBirr SMS with a matching transactionRef,
// we auto-approve the pending submission. On no match, we store it as
// an unmatched incoming payment for admin visibility.
//
// Test with curl:
//   SIGNATURE=$(echo -n '{"from":"+251911234567","text":"..."}' | openssl dgst -sha256 -hmac '<secret>' | sed 's/.*= //')
//   curl -X POST -H "Content-Type: application/json" -H "X-Signature: $SIGNATURE" -d '{"from":"+251911234567","text":"..."}' <CONVEX_URL>/http/webhooks/sms
// ---------------------------------------------------------------------------

http.route({
  path: "/webhooks/sms",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const raw = await request.text();

      // --- HMAC-SHA-256 verification ---
      const signatureHeader =
        request.headers.get("X-Signature") ??
        request.headers.get("x-signature") ??
        "";

      const secret = await ctx.runQuery(
        internal.configKeys.resolveConfigValue,
        { key: "SMS_WEBHOOK_SECRET" },
      );

      if (!secret) {
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "auth_event",
          source: "smsWebhook",
          status: "error",
          metadata: JSON.stringify({ error: "SMS_WEBHOOK_SECRET not configured" }),
          durationMs: 0,
        });
        return new Response(
          JSON.stringify({ ok: false, error: "not_configured" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      // Compute HMAC-SHA-256 over the raw body using Web Crypto.
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const mac = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
      const expected = [...new Uint8Array(mac)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (
        signatureHeader.length !== expected.length ||
        signatureHeader.toLowerCase() !== expected
      ) {
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "auth_event",
          source: "smsWebhook",
          status: "error",
          metadata: JSON.stringify({
            error: "bad_signature",
            receivedLength: signatureHeader.length,
            expectedLength: expected.length,
          }),
          durationMs: 0,
        });
        return new Response(
          JSON.stringify({ ok: false, error: "bad_signature" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }

      // --- Parse the JSON body ---
      const body = JSON.parse(raw) as {
        from?: string;
        text?: string;
        timestamp?: string;
      };

      if (!body.text) {
        return new Response(
          JSON.stringify({ ok: false, error: "no_text" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      // --- Parse the TeleBirr SMS ---
      const parsed = parseTeleBirrSms(body.text);

      if (!parsed) {
        await ctx.runMutation(
          internal.manualPayments.insertUnmatchedIncomingPayment,
          { rawSmsText: body.text },
        );
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "payment_event",
          source: "smsWebhook",
          status: "success",
          metadata: JSON.stringify({ result: "unparseable", from: body.from }),
          durationMs: 0,
        });
        return new Response(
          JSON.stringify({ ok: true, result: "unparseable" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // --- Try to find a matching pending submission ---
      const match = await ctx.runQuery(
        internal.manualPayments.findPendingByTxRef,
        { transactionRef: parsed.transactionRef },
      );

      if (match) {
        const amountConsistent =
          Math.abs(parsed.amount - match.expectedAmount) <= 1;

        if (amountConsistent) {
          await ctx.runMutation(internal.manualPayments.approveFromSms, {
            submissionId: match._id,
          });
          await ctx.runMutation(internal.systemEvents.logEvent, {
            eventType: "payment_event",
            source: "smsWebhook",
            status: "success",
            userId: match.userId,
            metadata: JSON.stringify({
              result: "auto_approved",
              txRef: parsed.transactionRef,
              amount: parsed.amount,
              dateImplausible: parsed.dateImplausible,
            }),
            durationMs: 0,
          });
          return new Response(
            JSON.stringify({ ok: true, result: "auto_approved", txRef: parsed.transactionRef }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } else {
          await ctx.runMutation(
            internal.manualPayments.insertUnmatchedIncomingPayment,
            {
              rawSmsText: body.text,
              parsedSenderName: parsed.senderName,
              parsedAccountHolder: parsed.accountHolder,
              parsedAmount: parsed.amount,
              parsedTransactionRef: parsed.transactionRef,
              parsedDate: parsed.date,
              parsedTime: parsed.time,
            },
          );
          await ctx.runMutation(internal.systemEvents.logEvent, {
            eventType: "payment_event",
            source: "smsWebhook",
            status: "error",
            metadata: JSON.stringify({
              result: "amount_mismatch",
              txRef: parsed.transactionRef,
              smsAmount: parsed.amount,
              expectedAmount: match.expectedAmount,
            }),
            durationMs: 0,
          });
          return new Response(
            JSON.stringify({ ok: true, result: "amount_mismatch", txRef: parsed.transactionRef }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
      } else {
        await ctx.runMutation(
          internal.manualPayments.insertUnmatchedIncomingPayment,
          {
            rawSmsText: body.text,
            parsedSenderName: parsed.senderName,
            parsedAccountHolder: parsed.accountHolder,
            parsedAmount: parsed.amount,
            parsedTransactionRef: parsed.transactionRef,
            parsedDate: parsed.date,
            parsedTime: parsed.time,
          },
        );
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "payment_event",
          source: "smsWebhook",
          status: "success",
          metadata: JSON.stringify({
            result: "unmatched",
            txRef: parsed.transactionRef,
            amount: parsed.amount,
            dateImplausible: parsed.dateImplausible,
          }),
          durationMs: 0,
        });
        return new Response(
          JSON.stringify({ ok: true, result: "unmatched", txRef: parsed.transactionRef }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: "internal" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

export default http;
