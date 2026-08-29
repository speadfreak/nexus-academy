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

// ---------------------------------------------------------------------------
// SMS webhook — receives POSTs from the "SMS to URL Forwarder" Android app
// (tech.bogomolov.incomingsmsgateway on F-Droid). The admin has this app
// installed on the phone that receives TeleBirr payment notifications.
//
// The app signs each request with HMAC-SHA-256 using a shared secret.
// We recompute the signature server-side over the raw request body using
// SMS_WEBHOOK_SECRET (from configKeys) and compare with a constant-time
// comparison. Any missing/mismatched signature is rejected and logged
// to systemEvents — this endpoint grants real monetary value, treat it
// as a sensitive financial surface.
//
// On a successfully parsed TeleBirr SMS with a matching transactionRef,
// we auto-approve the pending submission. On no match, we store it as
// an unmatched incoming payment for admin visibility.
//
// The SMS forwarder app sends a JSON body: { "from": "...", "text": "...", "timestamp": "..." }
// and signs it with an HMAC-SHA-256 hex digest in the "X-Signature" header
// (or sometimes "x-signature" — we check both, case-insensitive).
//
// Test with curl:
//   SIGNATURE=$(echo -n '{"from":"+251911234567","text":"..."}' | openssl dgst -sha256 -hmac '<secret>' | sed 's/.*= //')
//   curl -X POST -H "Content-Type: application/json" -H "X-Signature: $SIGNATURE" -d '{"from":"+251911234567","text":"..."}' <CONVEX_URL>/webhooks/sms
// ---------------------------------------------------------------------------

import { parseTeleBirrSms } from "./manualPayments";

http.route({
  path: "/webhooks/sms",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      // Read the raw body ONCE — used for both HMAC verification and JSON parsing.
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
        // Webhook secret not configured — log and reject.
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

      // Constant-time-ish comparison.
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
        // SMS doesn't match the TeleBirr format — log as unparseable.
        await ctx.runMutation(
          internal.manualPayments.insertUnmatchedIncomingPayment,
          {
            rawSmsText: body.text,
          },
        );
        await ctx.runMutation(internal.systemEvents.logEvent, {
          eventType: "payment_event",
          source: "smsWebhook",
          status: "success",
          metadata: JSON.stringify({ result: "unparseable", from: body.from }),
          durationMs: 0,
        });
        // Return 200 so the forwarder app doesn't retry.
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
        // --- EXACT MATCH: auto-approve ---
        // Check amount consistency — the parsed SMS amount should match
        // the expected amount on the submission (within 1 ETB tolerance
        // for rounding differences in different display formats).
        const amountConsistent =
          Math.abs(parsed.amount - match.expectedAmount) <= 1;

        if (amountConsistent) {
          // Auto-approve via the same approveFromSms mutation that
          // grants premium + handles goodwill bonus.
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
          // Amount mismatch — store as unmatched for manual review.
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
        // --- NO MATCH: store as unmatched for admin visibility ---
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
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, error: "internal" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }),
});

export default http;
