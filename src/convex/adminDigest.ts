// Admin Weekly Business Digest — sends a single Telegram message every
// Monday morning (5 minutes after the personal digest) to the already-
// configured TELEGRAM_ADMIN_CHAT_ID with real weekly numbers:
//
//   - Total revenue (sum of approved manualPaymentSubmissions this week)
//   - New signups this week
//   - Referral conversions this week
//   - Active user count this week (study sessions / XP / quiz attempts)
//   - Paid active subscriptions count
//   - Pending payment submissions awaiting review
//   - SLA breaches
//
// All numbers are REAL — computed from existing data via direct
// ctx.db.query() calls (no recomputation from scratch, no
// fabrication). The admin can read the digest and know exactly how the
// week went.
//
// Reuses the existing TELEGRAM_ADMIN_CHAT_ID config key (already in the
// Keys tab) — no new channel/config for this. If the chat ID isn't
// configured, the action logs the gap and exits cleanly (no spam).
//
// Same callBot + resolveTelegramToken pattern as telegramDigest.ts —
// duplicated locally because the helpers in telegramActions.ts are
// file-private.

"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { logEventAction } from "./systemEvents";

const API_BASE = "https://api.telegram.org";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

async function callBot(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description ?? `Telegram API error ${response.status}`);
  }
  return data;
}

async function resolveConfigValue(ctx: any, key: string): Promise<string | null> {
  try {
    const value = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key });
    return value ?? null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// ── Compose the digest message ─────────────────────────────────────────

function composeAdminDigest({
  weekStart,
  revenueThisWeek,
  approvedCountThisWeek,
  newSignupsThisWeek,
  referralConversionsThisWeek,
  referralSignupsThisWeek,
  activeUsersThisWeek,
  paidActiveSubscriptions,
  inProgressTrials,
  pendingSubmissions,
  slaBreached,
  contentItemsTotal,
  totalUsers,
}: {
  weekStart: number;
  revenueThisWeek: number;
  approvedCountThisWeek: number;
  newSignupsThisWeek: number;
  referralConversionsThisWeek: number;
  referralSignupsThisWeek: number;
  activeUsersThisWeek: number;
  paidActiveSubscriptions: number;
  inProgressTrials: number;
  pendingSubmissions: number;
  slaBreached: number;
  contentItemsTotal: number;
  totalUsers: number;
}): string {
  const now = new Date();
  const weekStartDate = new Date(weekStart);
  const dateRange = `${weekStartDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const lines: string[] = [];
  lines.push(`📊 <b>Nexus Academy — Weekly Business Digest</b>`);
  lines.push(`<i>${dateRange}</i>`);
  lines.push(`──────────────────────`);

  // Revenue
  lines.push(`<b>💰 Revenue (approved payments)</b>`);
  lines.push(`This week: <b>${formatMoney(revenueThisWeek)} ETB</b> across ${approvedCountThisWeek} approved payment${approvedCountThisWeek === 1 ? "" : "s"}`);
  if (approvedCountThisWeek === 0) {
    lines.push(`<i>No payments were approved this week.</i>`);
  }
  lines.push("");

  // Users + signups
  lines.push(`<b>👥 Users</b>`);
  lines.push(`New signups this week: <b>${newSignupsThisWeek}</b>`);
  lines.push(`Total accounts: <b>${totalUsers}</b>`);
  lines.push(`Active this week (any study action): <b>${activeUsersThisWeek}</b>`);
  lines.push("");

  // Referrals
  lines.push(`<b>🎯 Referrals</b>`);
  lines.push(`Referral signups this week: <b>${referralSignupsThisWeek}</b>`);
  lines.push(`Converted to paid this week: <b>${referralConversionsThisWeek}</b>`);
  lines.push("");

  // Subscriptions
  lines.push(`<b>👑 Subscriptions</b>`);
  lines.push(`Paid active: <b>${paidActiveSubscriptions}</b>`);
  lines.push(`Trials in progress: <b>${inProgressTrials}</b>`);
  lines.push("");

  // Pipeline + health
  lines.push(`<b>📋 Pipeline</b>`);
  lines.push(`Pending payment reviews: <b>${pendingSubmissions}</b>`);
  if (slaBreached > 0) {
    lines.push(`⚠️ <b>SLA breaches: ${slaBreached}</b> — review urgently`);
  } else {
    lines.push(`SLA breaches: 0 ✅`);
  }
  lines.push(`Content items in library: <b>${contentItemsTotal}</b>`);
  lines.push("");
  lines.push(`──────────────────────`);
  lines.push(`<i>Numbers are real, computed from live data. No fabrication.</i>`);
  lines.push(`<i>— Nexus Academy ET 🇪🇹 admin bot</i>`);

  return lines.join("\n");
}

// ── The weekly admin digest action ─────────────────────────────────────

export const sendWeeklyBusinessDigest = internalAction({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; sent: boolean; reason?: string }> => {
    // Resolve the bot token + admin chat ID.
    const token = await resolveConfigValue(ctx, "TELEGRAM_BOT_TOKEN");
    if (!token) {
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "adminDigest.weekly",
        status: "error",
        metadata: { reason: "telegram_not_configured" },
      });
      return { ok: false, sent: false, reason: "telegram_not_configured" };
    }
    const adminChatId = await resolveConfigValue(ctx, "TELEGRAM_ADMIN_CHAT_ID");
    if (!adminChatId) {
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "adminDigest.weekly",
        status: "error",
        metadata: { reason: "no_admin_chat_id_configured" },
      });
      // Not an error per se — the admin just hasn't set the chat ID yet.
      // Log + return ok so the cron doesn't retry-spam.
      return { ok: true, sent: false, reason: "no_admin_chat_id_configured" };
    }

    const now = Date.now();
    const weekStart = now - WEEK_MS;

    // ── Compute the digest numbers ──────────────────────────────────
    // All direct ctx.db queries — no admin gate, no recomputation
    // from scratch, honest data only.

    const [users, manualSubmissions, referrals, subscriptions, sessions, xpRows, attempts, contentItems] =
      await Promise.all([
        ctx.runQuery(internal.adminDigestData.listAllUsers, {}),
        ctx.runQuery(internal.adminDigestData.listAllManualSubmissions, {}),
        ctx.runQuery(internal.adminDigestData.listAllReferrals, {}),
        ctx.runQuery(internal.adminDigestData.listAllSubscriptions, {}),
        ctx.runQuery(internal.adminDigestData.listRecentSessions, { since: weekStart }),
        ctx.runQuery(internal.adminDigestData.listRecentXp, { since: weekStart }),
        ctx.runQuery(internal.adminDigestData.listRecentQuizAttempts, { since: weekStart }),
        ctx.runQuery(internal.adminDigestData.countContentItems, {}),
      ]) as [
        Array<{ _id: Id<"users">; _creationTime: number }>,
        Array<{
          status: "pending" | "approved" | "rejected";
          expectedAmount: number;
          submittedAt: number;
          reviewedAt?: number;
          slaBreached: boolean;
        }>,
        Array<{
          status: string;
          signedUpAt: number;
          convertedAt?: number;
        }>,
        Array<{ status: string }>,
        Array<{ userId: Id<"users"> }>,
        Array<{ userId: Id<"users"> }>,
        Array<{ userId: Id<"users"> }>,
        number,
      ];

    // Revenue this week — sum of expectedAmount for submissions
    // approved (reviewedAt) within the last 7 days.
    let revenueThisWeek = 0;
    let approvedCountThisWeek = 0;
    let pendingSubmissions = 0;
    let slaBreached = 0;
    for (const sub of manualSubmissions) {
      if (sub.status === "approved" && (sub.reviewedAt ?? 0) >= weekStart) {
        revenueThisWeek += sub.expectedAmount;
        approvedCountThisWeek += 1;
      }
      if (sub.status === "pending") {
        pendingSubmissions += 1;
        if (sub.slaBreached) slaBreached += 1;
      }
    }

    // New signups this week.
    const newSignupsThisWeek = users.filter((u) => u._creationTime >= weekStart).length;
    const totalUsers = users.length;

    // Active users this week (any study action — session, XP, or quiz).
    const activeSet = new Set<Id<"users">>();
    for (const s of sessions) activeSet.add(s.userId);
    for (const x of xpRows) activeSet.add(x.userId);
    for (const a of attempts) activeSet.add(a.userId);
    const activeUsersThisWeek = activeSet.size;

    // Referrals this week.
    let referralSignupsThisWeek = 0;
    let referralConversionsThisWeek = 0;
    for (const r of referrals) {
      if (r.signedUpAt >= weekStart) referralSignupsThisWeek += 1;
      if (
        (r.status === "converted" || r.status === "rewarded") &&
        (r.convertedAt ?? 0) >= weekStart
      ) {
        referralConversionsThisWeek += 1;
      }
    }

    // Subscriptions.
    let paidActiveSubscriptions = 0;
    let inProgressTrials = 0;
    for (const sub of subscriptions) {
      if (sub.status === "active") paidActiveSubscriptions += 1;
      else if (sub.status === "trial") inProgressTrials += 1;
    }

    const text = composeAdminDigest({
      weekStart,
      revenueThisWeek,
      approvedCountThisWeek,
      newSignupsThisWeek,
      referralConversionsThisWeek,
      referralSignupsThisWeek,
      activeUsersThisWeek,
      paidActiveSubscriptions,
      inProgressTrials,
      pendingSubmissions,
      slaBreached,
      contentItemsTotal: contentItems,
      totalUsers,
    });

    // Send to the admin chat.
    try {
      await callBot(token, "sendMessage", {
        chat_id: adminChatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "adminDigest.weekly.sendFailed",
        status: "error",
        metadata: { adminChatId, error: errMsg.slice(0, 200) },
      });
      return { ok: false, sent: false, reason: "send_failed" };
    }

    await logEventAction(ctx, {
      eventType: "api_call",
      source: "adminDigest.weekly",
      status: "success",
      metadata: {
        revenueThisWeek,
        approvedCountThisWeek,
        newSignupsThisWeek,
        activeUsersThisWeek,
        referralConversionsThisWeek,
      },
    });

    return { ok: true, sent: true };
  },
});
