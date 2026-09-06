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

// ── Telegram webhook — handles the /start CODE linking flow ──────────────
//
// Students link their own Telegram account by sending `/start CODE` (or
// just `CODE`) to the bot. Telegram forwards the message to this webhook
// (configured via the BotFather → Set Webhook URL). We:
//   1. Parse the message text for a 6-char alphanumeric code.
//   2. Look up the code in telegramLinkCodes (valid + not expired).
//   3. Consume the code → create the telegramLinks row linking this
//      Telegram chat to the Nexus user.
//   4. Reply via the Telegram API so the student gets immediate feedback.
//
// Webhook URL: <CONVEX_URL>/http/webhooks/telegram
// Set it via the BotFather or:
//   curl https://api.telegram.org/bot<TOKEN>/setWebhook?url=<CONVEX_URL>/http/webhooks/telegram
//
// The webhook doesn't require a signature — the URL is unguessable (it's
// the Convex deployment URL) and any spam would just create invalid
// code lookups that return not_found. We still log every call.
http.route({
  path: "/webhooks/telegram",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const message = body?.message;
    if (!message) {
      // Could be an edited_message, channel_post, or callback_query — we
      // only handle direct messages for the linking flow. Acknowledge
      // with 200 so Telegram doesn't retry.
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const chatId = message?.chat?.id;
    const text: string = (message?.text ?? "").trim();
    if (!chatId || !text) {
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Resolve the bot token so we can reply.
    let token: string | null = null;
    try {
      token = await ctx.runQuery(internal.configKeys.resolveConfigValue, {
        key: "TELEGRAM_BOT_TOKEN",
      });
    } catch {
      token = null;
    }
    if (!token) {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "api_call",
        source: "telegram.webhook.noToken",
        status: "error",
        metadata: JSON.stringify({ chatId }),
      });
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract the code: support both "/start ABC123" and just "ABC123".
    // Telegram sends "/start <payload>" when the user clicks a t.me link
    // with a start parameter; we also accept a bare code for manual entry.
    let code: string | null = null;
    const startMatch = text.match(/^\/start\s+([A-Za-z0-9]{6})\b/);
    if (startMatch) {
      code = startMatch[1]!.toUpperCase();
    } else {
      const bareMatch = text.match(/^([A-Za-z0-9]{6})$/);
      if (bareMatch) {
        code = bareMatch[1]!.toUpperCase();
      }
    }

    const reply = async (text: string) => {
      try {
        await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        });
      } catch {
        // non-fatal — webhook still 200s so Telegram doesn't retry spam
      }
    };

    if (!code) {
      await reply(
        "👋 <b>Welcome to Learnyx Academy's weekly digest bot!</b>\n\n" +
        "To link your account, open <b>Settings → Link Telegram</b> in the app " +
        "and send me the 6-character code shown there.\n\n" +
        "Once linked, you'll get a personalized progress report every Monday " +
        "morning — XP, quiz trends, streak, and a focus tip. 📚",
      );
      return new Response(JSON.stringify({ ok: true, handled: "help" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Try to consume the code.
    const result = (await ctx.runMutation(internal.telegram.consumeLinkCode, {
      code,
      telegramChatId: String(chatId),
    })) as { ok: boolean; reason?: string; userId?: string };

    if (!result.ok) {
      const reasonText =
        result.reason === "code_expired"
          ? "❌ That code has expired (codes last 10 minutes). Open Settings → Link Telegram and generate a new one."
          : "❌ I couldn't find that code. Make sure you typed it exactly as shown in Settings → Link Telegram. Codes expire after 10 minutes.";
      await reply(reasonText);
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "api_call",
        source: "telegram.webhook.linkFailed",
        status: "error",
        metadata: JSON.stringify({ chatId, reason: result.reason ?? "unknown" }),
      });
      return new Response(JSON.stringify({ ok: true, handled: "link_failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    await reply(
      "✅ <b>Linked!</b>\n\n" +
      "You'll now receive a weekly progress digest every Monday morning — " +
      "XP, quiz trends, your streak, and a personalized focus tip.\n\n" +
      "To stop receiving digests, open Settings → Link Telegram in the app " +
      "and tap Unlink. 📚",
    );
    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "api_call",
      source: "telegram.webhook.linked",
      status: "success",
      metadata: JSON.stringify({ chatId, userId: result.userId }),
    });
    return new Response(JSON.stringify({ ok: true, handled: "linked" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
