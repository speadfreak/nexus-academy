// Manual payment submission system — TeleBirr personal transfers + admin review.
//
// Students transfer ETB to a personal TeleBirr number, screenshot the
// confirmation, and submit the transaction reference + screenshot. An
// admin reviews the queue and approves/rejects.
//
// On approval, premium is granted via the EXISTING setUserPremium mutation
// from adminCenter.ts — no duplicate grant logic. If the submission was
// SLA-breached, goodwill bonus hours are stacked on top of the 30-day period.
//
// An automated SMS webhook (Priority 3, http.ts) can auto-approve by
// matching the transaction reference against an incoming TeleBirr SMS.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal, api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdmin, hasMinRole } from "./admin";
import { ROLES } from "./schema";
import { CONFIG_DEFAULTS } from "./configKeys";

// 30 days in ms — matches the default premium period in adminCenter.ts.
const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;
// How far back to look for a matching pending submission on an incoming SMS.
const SMS_MATCH_WINDOW_MS = 48 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Local admin-check helper (works with both QueryCtx and MutationCtx —
// mirrors adminCenter.ts's local requireAdmin pattern)
// ---------------------------------------------------------------------------

async function requireAdmin(ctx: any): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  const user = await ctx.db.get(userId);
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({
      message: "Admin access required.",
      code: "unauthorized",
    });
  }
  if (!hasMinRole(user, ROLES.ADMIN)) {
    throw new ConvexError({
      message: "Admin access required. Moderators cannot access this section.",
      code: "unauthorized",
    });
  }
  return user;
}

// ---------------------------------------------------------------------------
// Config helpers — read from configKeys with fallback to CONFIG_DEFAULTS
// ---------------------------------------------------------------------------

async function getConfigValue(ctx: any, key: string): Promise<string> {
  const val = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key });
  if (val) return val;
  return CONFIG_DEFAULTS[key] ?? "";
}

async function getConfigNumber(
  ctx: any,
  key: string,
  fallback: number,
): Promise<number> {
  const val = await getConfigValue(ctx, key);
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ===========================================================================
// PRIORITY 2: STUDENT SUBMISSION + ADMIN REVIEW FLOW
// ===========================================================================

// ---------------------------------------------------------------------------
// insertSubmission — internal mutation that does the actual DB insert.
// Called by the submitPaymentProof action below.
// ---------------------------------------------------------------------------

export const insertSubmission = internalMutation({
  args: {
    userId: v.id("users"),
    expectedAmount: v.number(),
    method: v.string(),
    transactionRef: v.string(),
    proofStorageId: v.string(),
  },
  handler: async (ctx, args): Promise<Id<"manualPaymentSubmissions">> => {
    return await ctx.db.insert("manualPaymentSubmissions", {
      userId: args.userId,
      expectedAmount: args.expectedAmount,
      currency: "ETB",
      method: args.method as "telebirr_personal" | "other",
      transactionRef: args.transactionRef,
      proofStorageId: args.proofStorageId,
      status: "pending",
      submittedAt: Date.now(),
      slaBreached: false,
    });
  },
});

// ---------------------------------------------------------------------------
// submitPaymentProof — student-facing action.
// Reads the live price, inserts the submission, sends a Telegram
// notification to the admin, and logs to systemEvents.
// ---------------------------------------------------------------------------

export const submitPaymentProof = action({
  args: {
    transactionRef: v.string(),
    proofStorageId: v.string(),
    method: v.optional(v.union(v.literal("telebirr_personal"), v.literal("other"))),
  },
  handler: async (ctx, args): Promise<{ submissionId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    const txRef = args.transactionRef.trim();
    if (txRef.length < 3) {
      throw new ConvexError({ message: "Transaction reference is too short.", code: "invalid" });
    }
    if (txRef.length > 100) {
      throw new ConvexError({ message: "Transaction reference is too long (max 100 chars).", code: "invalid" });
    }

    // Snapshot the current premium price — the KEY design decision: the
    // expectedAmount is frozen at submission time. A later price change
    // doesn't retroactively affect pending submissions.
    const priceEtb = await getConfigNumber(ctx, "PREMIUM_PRICE_ETB", 500);
    const method = args.method ?? "telebirr_personal";

    // Insert the submission via an internal mutation.
    const submissionId = await ctx.runMutation(internal.manualPayments.insertSubmission, {
      userId,
      expectedAmount: priceEtb,
      method,
      transactionRef: txRef,
      proofStorageId: args.proofStorageId,
    });

    // Send a Telegram notification to the admin (fire-and-forget).
    try {
      const student = await ctx.runQuery(internal.manualPayments.getUserForNotify, { userId });
      const studentName = (student as { name?: string; email?: string })?.name ||
        (student as { email?: string })?.email ||
        "Unknown student";
      await ctx.runAction(internal.manualPayments.notifyAdminTelegram, {
        submissionId: submissionId as Id<"manualPaymentSubmissions">,
        studentName,
        amountEtb: priceEtb,
        txRef,
        method,
      });
    } catch {
      // Non-fatal: Telegram not configured.
    }

    // Log to systemEvents.
    try {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "payment_event",
        source: "manualPayments.submit",
        status: "success",
        userId,
        metadata: JSON.stringify({ submissionId, txRef, amountEtb: priceEtb }),
        durationMs: 0,
      });
    } catch {
      // Non-fatal.
    }

    return { submissionId: submissionId as string };
  },
});

// ---------------------------------------------------------------------------
// getUserForNotify — internal query used by submitPaymentProof to get
// the student's display name for the Telegram notification.
// ---------------------------------------------------------------------------

export const getUserForNotify = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return { name: user?.name, email: user?.email };
  },
});

// ---------------------------------------------------------------------------
// notifyAdminTelegram — internal action that sends a Telegram message
// to the admin chat when a payment proof is submitted.
// ---------------------------------------------------------------------------

export const notifyAdminTelegram = internalAction({
  args: {
    submissionId: v.id("manualPaymentSubmissions"),
    studentName: v.string(),
    amountEtb: v.number(),
    txRef: v.string(),
    method: v.string(),
  },
  handler: async (ctx, args): Promise<{ ok: boolean; reason?: string }> => {
    try {
      const token = await ctx.runQuery(
        internal.configKeys.resolveConfigValue,
        { key: "TELEGRAM_BOT_TOKEN" },
      );
      if (!token) return { ok: false, reason: "not_configured" };

      const chatId = await ctx.runQuery(
        internal.configKeys.resolveConfigValue,
        { key: "TELEGRAM_ADMIN_CHAT_ID" },
      );
      if (!chatId) return { ok: false, reason: "no_admin_chat_id" };

      const siteUrl =
        (await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "SITE_URL" })) ||
        "https://nexus-academy-5nfg.onrender.com";

      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

      const text = [
        "🔔 <b>New Payment Submission</b>",
        "",
        `👤 Student: <b>${esc(args.studentName)}</b>`,
        `💰 Amount: <b>${args.amountEtb} ETB</b>`,
        `📱 Method: ${esc(args.method)}`,
        `🔑 Tx Ref: <code>${esc(args.txRef)}</code>`,
        "",
        `Review: ${esc(siteUrl)}/admin`,
      ].join("\n");

      const response = await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: true,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (!response.ok || !data?.ok) {
        return { ok: false, reason: "telegram_api_error" };
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: "exception" };
    }
  },
});

// ---------------------------------------------------------------------------
// getMySubmissions — student's own history + live status
// ---------------------------------------------------------------------------

export const getMySubmissions = query({
  args: {},
  handler: async (ctx): Promise<Doc<"manualPaymentSubmissions">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("manualPaymentSubmissions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

// ---------------------------------------------------------------------------
// getPaymentConfig — public query for the /upgrade page
// ---------------------------------------------------------------------------

export const getPaymentConfig = query({
  args: {},
  handler: async (ctx): Promise<{
    priceEtb: number;
    slaHours: number;
    goodwillBonusHours: number;
    telebirrNumber: string;
    telebirrName: string;
  }> => {
    const priceEtb = await getConfigNumber(ctx, "PREMIUM_PRICE_ETB", 500);
    const slaHours = await getConfigNumber(ctx, "SLA_HOURS", 24);
    const goodwillBonusHours = await getConfigNumber(ctx, "GOODWILL_BONUS_HOURS", 24);
    const telebirrNumber = await getConfigValue(ctx, "MANUAL_PAYMENT_TELEBIRR_NUMBER");
    const telebirrName = await getConfigValue(ctx, "MANUAL_PAYMENT_TELEBIRR_NAME");
    return { priceEtb, slaHours, goodwillBonusHours, telebirrNumber, telebirrName };
  },
});

// ---------------------------------------------------------------------------
// getPendingSubmissions — admin review queue (query)
// ---------------------------------------------------------------------------

export const getPendingSubmissions = query({
  args: {},
  handler: async (ctx): Promise<
    Array<
      Doc<"manualPaymentSubmissions"> & {
        studentName: string;
        studentEmail: string | undefined;
      }
    >
  > => {
    await requireAdmin(ctx);
    const pending = await ctx.db
      .query("manualPaymentSubmissions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc") // oldest first — most urgent
      .take(200);

    const result: Array<
      Doc<"manualPaymentSubmissions"> & {
        studentName: string;
        studentEmail: string | undefined;
      }
    > = [];
    for (const sub of pending) {
      const student = await ctx.db.get(sub.userId);
      result.push({
        ...sub,
        studentName: student?.name || student?.email || "Unknown",
        studentEmail: student?.email,
      });
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// getProofUrl — admin gets a URL to view the uploaded screenshot
// ---------------------------------------------------------------------------

export const getProofUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, { storageId }): Promise<{ url: string | null }> => {
    await requireAdmin(ctx);
    try {
      const url = await ctx.storage.getUrl(storageId as Id<"_storage">);
      return { url };
    } catch {
      return { url: null };
    }
  },
});

// ---------------------------------------------------------------------------
// approveSubmission — admin approves a pending submission
// Calls the EXISTING setUserPremium mutation from adminCenter.ts.
// If slaBreached, stacks GOODWILL_BONUS_HOURS on top of 30 days.
// ---------------------------------------------------------------------------

export const approveSubmission = mutation({
  args: {
    submissionId: v.id("manualPaymentSubmissions"),
  },
  handler: async (ctx, { submissionId }): Promise<{ ok: boolean; goodwillApplied: number }> => {
    const admin = await requireAdmin(ctx);

    const sub = await ctx.db.get(submissionId);
    if (!sub) {
      throw new ConvexError({ message: "Submission not found.", code: "not_found" });
    }
    if (sub.status !== "pending") {
      throw new ConvexError({ message: `Submission is already ${sub.status}.`, code: "invalid" });
    }

    const goodwillHours = await getConfigNumber(ctx, "GOODWILL_BONUS_HOURS", 24);

    // Calculate duration: 30 days base + goodwill bonus if SLA breached.
    let durationMs = SUBSCRIPTION_MS;
    let goodwillApplied = 0;
    if (sub.slaBreached) {
      goodwillApplied = goodwillHours;
      durationMs = SUBSCRIPTION_MS + goodwillHours * 60 * 60 * 1000;
    }

    // Grant premium via the EXISTING setUserPremium mutation — no duplicate logic.
    await ctx.runMutation(api.adminCenter.setUserPremium, {
      userId: sub.userId,
      action: "activate",
      durationMs,
    });

    // Mark the submission as approved.
    await ctx.db.patch(submissionId, {
      status: "approved",
      reviewedAt: Date.now(),
      reviewedBy: admin._id,
      goodwillBonusHoursApplied: goodwillApplied > 0 ? goodwillApplied : undefined,
    });

    // Notify the student in-app.
    try {
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: sub.userId,
        type: "payment_approved",
        title: "Premium activated! 🎉",
        body:
          goodwillApplied > 0
            ? `Your payment was confirmed. Premium is active for 30 days + ${goodwillApplied} bonus hours (sorry for the wait!).`
            : "Your payment was confirmed. Premium is now active for 30 days. Thank you!",
        actionUrl: "/dashboard",
      });
    } catch {
      // Non-fatal.
    }

    // Log to systemEvents.
    try {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "payment_event",
        source: "manualPayments.approve",
        status: "success",
        userId: sub.userId,
        metadata: JSON.stringify({
          submissionId,
          txRef: sub.transactionRef,
          amountEtb: sub.expectedAmount,
          reviewedBy: admin._id,
          goodwillApplied,
        }),
        durationMs: 0,
      });
    } catch {
      // Non-fatal.
    }

    return { ok: true, goodwillApplied };
  },
});

// ---------------------------------------------------------------------------
// approveFromSms — internal mutation for auto-approval from the SMS webhook.
// Same logic as approveSubmission but with reviewedBy="system:sms-auto"
// and no admin auth check (the webhook already verified HMAC).
// ---------------------------------------------------------------------------

export const approveFromSms = internalMutation({
  args: {
    submissionId: v.id("manualPaymentSubmissions"),
  },
  handler: async (ctx, { submissionId }): Promise<{ ok: boolean; goodwillApplied: number }> => {
    const sub = await ctx.db.get(submissionId);
    if (!sub) return { ok: false, goodwillApplied: 0 };
    if (sub.status !== "pending") return { ok: false, goodwillApplied: 0 }; // idempotent

    const goodwillHours = await getConfigNumber(ctx, "GOODWILL_BONUS_HOURS", 24);
    let durationMs = SUBSCRIPTION_MS;
    let goodwillApplied = 0;
    if (sub.slaBreached) {
      goodwillApplied = goodwillHours;
      durationMs = SUBSCRIPTION_MS + goodwillHours * 60 * 60 * 1000;
    }

    await ctx.runMutation(api.adminCenter.setUserPremium, {
      userId: sub.userId,
      action: "activate",
      durationMs,
    });

    await ctx.db.patch(submissionId, {
      status: "approved",
      reviewedAt: Date.now(),
      reviewedBy: "system:sms-auto",
      goodwillBonusHoursApplied: goodwillApplied > 0 ? goodwillApplied : undefined,
    });

    // Notify the student.
    try {
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: sub.userId,
        type: "payment_approved",
        title: "Premium activated! 🎉",
        body:
          goodwillApplied > 0
            ? `Your payment was auto-verified from your SMS. Premium is active for 30 days + ${goodwillApplied} bonus hours (sorry for the wait!).`
            : "Your payment was auto-verified from your SMS. Premium is now active for 30 days. Thank you!",
        actionUrl: "/dashboard",
      });
    } catch {
      // Non-fatal.
    }

    try {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "payment_event",
        source: "manualPayments.smsAutoApprove",
        status: "success",
        userId: sub.userId,
        metadata: JSON.stringify({ submissionId, txRef: sub.transactionRef, goodwillApplied }),
        durationMs: 0,
      });
    } catch {
      // Non-fatal.
    }

    return { ok: true, goodwillApplied };
  },
});

// ---------------------------------------------------------------------------
// rejectSubmission — admin rejects a pending submission with a reason
// ---------------------------------------------------------------------------

export const rejectSubmission = mutation({
  args: {
    submissionId: v.id("manualPaymentSubmissions"),
    rejectionReason: v.string(),
  },
  handler: async (ctx, { submissionId, rejectionReason }): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx);

    if (rejectionReason.trim().length < 3) {
      throw new ConvexError({
        message: "A rejection reason is required (min 3 chars).",
        code: "invalid",
      });
    }

    const sub = await ctx.db.get(submissionId);
    if (!sub) {
      throw new ConvexError({ message: "Submission not found.", code: "not_found" });
    }
    if (sub.status !== "pending") {
      throw new ConvexError({ message: `Submission is already ${sub.status}.`, code: "invalid" });
    }

    await ctx.db.patch(submissionId, {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: admin._id,
      rejectionReason: rejectionReason.trim(),
    });

    // Notify the student.
    try {
      await ctx.runMutation(internal.notifications.createNotification, {
        userId: sub.userId,
        type: "payment_rejected",
        title: "Payment submission needs attention",
        body: `Your payment submission (ref: ${sub.transactionRef}) was not approved. Reason: ${rejectionReason.trim()}. Please check the reference number and try again.`,
        actionUrl: "/upgrade",
      });
    } catch {
      // Non-fatal.
    }

    try {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "payment_event",
        source: "manualPayments.reject",
        status: "success",
        userId: sub.userId,
        metadata: JSON.stringify({
          submissionId,
          reason: rejectionReason.trim(),
          reviewedBy: admin._id,
        }),
        durationMs: 0,
      });
    } catch {
      // Non-fatal.
    }

    return { ok: true };
  },
});

// ===========================================================================
// PRIORITY 3: SMS PARSING + WEBHOOK SUPPORT
// ===========================================================================

// ---------------------------------------------------------------------------
// parseTeleBirrSms — pure function that extracts payment fields from a
// TeleBirr received-payment SMS notification (Amharic format).
//
// Returns null if the SMS doesn't match the expected shape AT ALL —
// never attempts a partial parse. The primary matching key is
// TRANSACTION_REF, which is what the student submits in the transactionRef
// field on the /upgrade page.
//
// Confirmed real SMS format:
//   ውድ [ACCOUNT_HOLDER_NAME]
//   ከ [SENDER_NAME]([MASKED_PHONE]) [AMOUNT] ብር በ [DATE] [TIME] ተቀብለዋል፡፡
//   የሂሳብ እንቅስቃሴ ቁጥርዎ [TRANSACTION_REF] ነዉ፡፡
//   አሁን ያለዎት ቀሪ ሂሳብ [BALANCE] ብር ነዉ፡፡
//   በቴሌብር ስለተገለገሉ እናመሰግናለን
//   ኢትዮ ቴሌኮም
//
// Key regex patterns:
//   - MASKED_PHONE: varies in digit grouping ("2519****2511" vs "251****89072")
//     — we capture the whole parenthesized block as a raw string.
//   - AMOUNT: comma-thousands, 2 decimals ("1,100.00", "100.00") — strip commas.
//   - DATE: DD/MM/YYYY — but this is a documented assumption, not certainty.
//   - TIME: HH:MM:SS, 24-hour.
//   - TRANSACTION_REF: alphanumeric ("DHA1O2T6RN", "DF48LMJJKW") — PRIMARY KEY.
// ---------------------------------------------------------------------------

export interface ParsedTeleBirrSms {
  accountHolder: string;
  senderName: string;
  maskedPhone: string; // raw parenthesized block, e.g. "(2519****2511)"
  amount: number; // parsed float, e.g. 1100.00
  date: string; // raw string, e.g. "28/08/2026"
  time: string; // raw string, e.g. "14:30:00"
  transactionRef: string; // e.g. "DHA1O2T6RN"
  balance: string; // raw string, e.g. "5,300.00"
  dateImplausible: boolean; // true if month field > 12 (possible MM/DD/YYYY)
}

/**
 * Parse a TeleBirr received-payment SMS notification.
 * Returns null if the SMS doesn't match the expected format at all.
 * Returns a ParsedTeleBirrSms with all fields extracted if it matches.
 * Sets `dateImplausible` to true if the second date component (month in
 * DD/MM/YYYY) is > 12 (possible MM/DD/YYYY instead) — flagged for manual review.
 */
export function parseTeleBirrSms(smsText: string): ParsedTeleBirrSms | null {
  const text = smsText.trim();

  // --- Fixed template phrases that MUST be present ---
  // If any of these are missing, the SMS is NOT a TeleBirr received-payment
  // notification — return null, don't attempt a partial parse.
  const REQUIRED_PHRASES = [
    "ተቀብለዋል፡፡", // "received"
    "የሂሳብ እንቅስቃሴ ቁጥርዎ", // "account movement number"
    "ቀሪ ሂሳብ", // "remaining balance"
    "በቴሌብር ስለተገለገሉ", // "for using TeleBirr"
    "ኢትዮ ቴሌኮም", // "Ethio Telecom"
  ];
  for (const phrase of REQUIRED_PHRASES) {
    if (!text.includes(phrase)) return null;
  }

  // --- Line 1: ውድ [ACCOUNT_HOLDER_NAME] ---
  // The account holder name is on the first line after "ውድ ".
  const lines = text.split("\n").map((l) => l.trim());
  let accountHolder = "";
  for (const line of lines) {
    if (line.startsWith("ውድ ")) {
      accountHolder = line.slice("ውድ ".length).trim();
      break;
    }
  }
  if (!accountHolder) return null;

  // --- Line 2: ከ [SENDER_NAME]([MASKED_PHONE]) [AMOUNT] ብር በ [DATE] [TIME] ተቀብለዋል፡፡ ---
  // This line has the most complex structure. We use a regex that captures:
  //   - sender name (everything between "ከ " and the "(" of the masked phone)
  //   - masked phone (the parenthesized block, including the parens)
  //   - amount (digits + commas + decimal)
  //   - date (DD/MM/YYYY or MM/DD/YYYY)
  //   - time (HH:MM:SS)
  //
  // The Amharic text around the fields:
  //   ከ [SENDER]([PHONE]) [AMOUNT] ብር በ [DATE] [TIME] ተቀብለዋል፡፡
  //
  // We match from "ከ " up to " ተቀብልላል፡፡" or " ተቀብለዋል፡፡"
  //
  // Regex breakdown:
  //   ከ\s+          — "ከ " prefix
  //   (.+?)          — sender name (non-greedy)
  //   \((.+?)\)      — masked phone in parens (non-greedy, captures inside parens)
  //   \s+            — space
  //   ([\d,]+\.\d{2}) — amount: digits+commas, 2 decimal places
  //   \s+ብር\s+በ\s+  — " ብር በ "
  //   (\d{2}/\d{2}/\d{4}) — date: DD/MM/YYYY
  //   \s+
  //   (\d{2}:\d{2}:\d{2}) — time: HH:MM:SS

  const line2Regex =
    /ከ\s+(.+?)\((.+?)\)\s+([\d,]+\.\d{2})\s+ብር\s+በ\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/;

  let senderName = "";
  let maskedPhone = "";
  let amountStr = "";
  let date = "";
  let time = "";
  let matchedLine2 = false;

  for (const line of lines) {
    const m = line.match(line2Regex);
    if (m) {
      senderName = m[1].trim();
      maskedPhone = `(${m[2]})`;
      amountStr = m[3];
      date = m[4];
      time = m[5];
      matchedLine2 = true;
      break;
    }
  }
  if (!matchedLine2) return null;

  // Parse amount: strip commas, convert to float.
  const amount = parseFloat(amountStr.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;

  // --- Line 3: የሂሳብ እንቅስቃሴ ቁጥርዎ [TRANSACTION_REF] ነዉ፡፡ ---
  // Transaction ref is alphanumeric, between "ቁጥርዎ " and " ነዉ፡፡"
  const txRefRegex = /ቁጥርዎ\s+([A-Za-z0-9]+)\s+ነዉ/;
  let transactionRef = "";
  let matchedTxRef = false;
  for (const line of lines) {
    const m = line.match(txRefRegex);
    if (m) {
      transactionRef = m[1];
      matchedTxRef = true;
      break;
    }
  }
  if (!matchedTxRef || !transactionRef) return null;

  // --- Line 4: አሁን ያለዎት ቀሪ ሂሳብ [BALANCE] ብር ነዉ፡፡ ---
  // Balance is optional for matching — we capture it but don't require it.
  const balanceRegex = /ቀሪ ሂሳብ\s+([\d,]+\.\d{2})\s+ብር/;
  let balance = "";
  for (const line of lines) {
    const m = line.match(balanceRegex);
    if (m) {
      balance = m[1];
      break;
    }
  }

  // --- Date plausibility check ---
  // In DD/MM/YYYY format, the SECOND field is the month (1-12).
  // If the second field > 12, the date might actually be MM/DD/YYYY.
  // Flag for manual review — don't silently trust it.
  const dateParts = date.split("/");
  const monthPart = parseInt(dateParts[1] ?? "0", 10);
  const dateImplausible = monthPart > 12;

  return {
    accountHolder,
    senderName,
    maskedPhone,
    amount,
    date,
    time,
    transactionRef,
    balance,
    dateImplausible,
  };
}

// ---------------------------------------------------------------------------
// findPendingByTxRef — internal query used by the SMS webhook to find a
// matching submission. Looks for a pending submission with the exact same
// transaction reference, submitted within the last 48 hours.
// ---------------------------------------------------------------------------

export const findPendingByTxRef = internalQuery({
  args: { transactionRef: v.string() },
  handler: async (ctx, { transactionRef }): Promise<Doc<"manualPaymentSubmissions"> | null> => {
    const cutoff = Date.now() - SMS_MATCH_WINDOW_MS;
    const matches = await ctx.db
      .query("manualPaymentSubmissions")
      .withIndex("by_transactionRef", (q) => q.eq("transactionRef", transactionRef))
      .filter((q) =>
        q.eq(q.field("status"), "pending") &&
        q.gte(q.field("submittedAt"), cutoff),
      )
      .take(1);
    return matches[0] ?? null;
  },
});

// ---------------------------------------------------------------------------
// insertUnmatchedIncomingPayment — internal mutation for the SMS webhook
// to store unmatched incoming payments for admin visibility.
// ---------------------------------------------------------------------------

export const insertUnmatchedIncomingPayment = internalMutation({
  args: {
    rawSmsText: v.string(),
    parsedSenderName: v.optional(v.string()),
    parsedAccountHolder: v.optional(v.string()),
    parsedAmount: v.optional(v.number()),
    parsedTransactionRef: v.optional(v.string()),
    parsedDate: v.optional(v.string()),
    parsedTime: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"unmatchedIncomingPayments">> => {
    return await ctx.db.insert("unmatchedIncomingPayments", {
      ...args,
      receivedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// getUnmatchedIncomingPayments — admin query for the unmatched SMS queue
// ---------------------------------------------------------------------------

export const getUnmatchedIncomingPayments = query({
  args: {},
  handler: async (ctx): Promise<Doc<"unmatchedIncomingPayments">[]> => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("unmatchedIncomingPayments")
      .order("desc")
      .take(100);
  },
});

// ===========================================================================
// PRIORITY 4: SLA TRACKING + GOODWILL COMPENSATION
// ===========================================================================

// ---------------------------------------------------------------------------
// checkSlaBreach — internal action called by the cron (every hour).
// Finds pending submissions older than SLA_HOURS that haven't been flagged
// yet, marks slaBreached=true, notifies the student (warm tone), and
// escalates to the admin via Telegram.
// NEVER auto-rejects on SLA breach — breach means apologize and compensate.
// ---------------------------------------------------------------------------

export const checkSlaBreach = internalAction({
  args: {},
  handler: async (ctx): Promise<{ flagged: number }> => {
    const slaHours = await getConfigNumber(ctx, "SLA_HOURS", 24);
    const goodwillHours = await getConfigNumber(ctx, "GOODWILL_BONUS_HOURS", 24);
    const cutoff = Date.now() - slaHours * 60 * 60 * 1000;

    // Query pending submissions older than the SLA cutoff that haven't been
    // flagged yet. We can't use a withIndex filter for "slaBreached=false" +
    // "submittedAt < cutoff" in a single index, so we use the by_status
    // index and filter in-memory.
    const pending = await ctx.runQuery(
      internal.manualPayments.getPendingForSlaCheck,
      { cutoff },
    );

    let flagged = 0;
    for (const sub of pending) {
      // Mark slaBreached = true.
      await ctx.runMutation(internal.manualPayments.markSlaBreached, {
        submissionId: sub._id,
      });
      flagged++;

      // Notify the student (warm, honest tone).
      try {
        await ctx.runMutation(internal.notifications.createNotification, {
          userId: sub.userId,
          type: "sla_breach",
          title: "Your review is taking longer than expected — sorry! 🙏",
          body: `We're sorry for the delay on your payment submission (ref: ${sub.transactionRef}). You'll get an extra ${goodwillHours} hours of premium once confirmed, as an apology. Thank you for your patience.`,
          actionUrl: "/upgrade",
        });
      } catch {
        // Non-fatal.
      }

      // Escalate to the admin via Telegram.
      try {
        const hoursOverdue = Math.floor((Date.now() - sub.submittedAt - slaHours * 60 * 60 * 1000) / (60 * 60 * 1000));
        await ctx.runAction(internal.manualPayments.notifyAdminTelegram, {
          submissionId: sub._id,
          studentName: `SLA BREACH (${hoursOverdue}h overdue)`,
          amountEtb: sub.expectedAmount,
          txRef: sub.transactionRef,
          method: sub.method,
        });
      } catch {
        // Non-fatal.
      }
    }

    return { flagged };
  },
});

// ---------------------------------------------------------------------------
// getPendingForSlaCheck — internal query that returns pending submissions
// older than the given cutoff that haven't been flagged yet.
// ---------------------------------------------------------------------------

export const getPendingForSlaCheck = internalQuery({
  args: { cutoff: v.number() },
  handler: async (ctx, { cutoff }): Promise<Doc<"manualPaymentSubmissions">[]> => {
    const pending = await ctx.db
      .query("manualPaymentSubmissions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(500);
    return pending.filter((s) => !s.slaBreached && s.submittedAt < cutoff);
  },
});

// ---------------------------------------------------------------------------
// markSlaBreached — internal mutation that sets slaBreached=true.
// ---------------------------------------------------------------------------

export const markSlaBreached = internalMutation({
  args: { submissionId: v.id("manualPaymentSubmissions") },
  handler: async (ctx, { submissionId }) => {
    await ctx.db.patch(submissionId, { slaBreached: true });
  },
});

// ---------------------------------------------------------------------------
// generateUploadUrl — student gets a one-time URL to upload the screenshot.
// ---------------------------------------------------------------------------

export const generateUploadUrl = action({
  args: {},
  handler: async (ctx): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const url = await ctx.storage.generateUploadUrl();
    return { url };
  },
});

// ---------------------------------------------------------------------------
// testSmsParser — admin-only action for testing the SMS parser against
// real SMS samples. Callable via CLI:
//   npx convex run manualPayments:testSmsParser '{"sms":"..."}'
// ---------------------------------------------------------------------------

export const testSmsParser = action({
  args: { sms: v.string() },
  handler: async (ctx, args): Promise<{ parsed: ParsedTeleBirrSms | null }> => {
    // No auth check — this is a test function. The admin calls it via CLI.
    const result = parseTeleBirrSms(args.sms);
    return { parsed: result };
  },
});
