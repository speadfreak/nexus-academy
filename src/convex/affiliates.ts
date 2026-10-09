// Affiliate (promoter) program — the cash-commission engine.
//
// SEPARATE from the student referral program (marketing.ts — premium
// days, non-cash). The two coexist: a user can have both a referral
// relationship and an affiliate attribution; each rewards on its own
// terms. Neither touches the other.
//
// MONEY DISCIPLINE:
//   • Commission accrues ONLY on approved real payments — never on
//     signups, trials, admin premium grants, goodwill bonuses, or
//     school-seat purchases (seats excluded by default; the accrual
//     engine skips them unless AFFILIATE_INCLUDE_SCHOOL_SEATS is true).
//   • Money never moves automatically. This system tracks what is
//     owed; the admin pays manually via TeleBirr and records the payout.
//   • Amounts are SNAPSHOTTED at approval time — later price or config
//     changes never rewrite history.
//
// PRIVACY DISCIPLINE:
//   • Promoter-facing surfaces (partner stats page) return AGGREGATE
//     numbers only — never a referred student's name, email, or any
//     identifying detail. Many referred students are minors; the
//     published Privacy Policy forbids sharing student data.
//
// CONVEX USAGE DISCIPLINE (the project was suspended once for excess
// query volume):
//   • Every query here uses an index. No unbounded .collect() in
//     reactive queries — bounded takes with explicit limits.
//   • Visit tracking uses DAILY AGGREGATE counters
//     (affiliateDailyStats, one doc per promoter+date+campaign,
//     incremented) plus denormalized lifetime counters on the promoter
//     row — never one row per click, never a per-click table.
//   • No polling anywhere; the admin tab subscribes once per tab and
//     shares data via props.
//
// TOGGLE DISCIPLINE:
//   • AFFILIATE_PROGRAM_ENABLED (default OFF) gates every PUBLIC
//     behavior: link resolution, visit pings, attribution, commission
//     accrual. The admin Affiliates tab + the partner stats page stay
//     usable while OFF so the owner can prepare promoters before
//     launch and promoters can always see their earnings.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdmin, hasMinRole } from "./admin";
import { ROLES } from "./schema";
import { CONFIG_DEFAULTS } from "./configKeys";
import {
  validatePromoterCode,
  isValidCodeShape,
  generateUniquePromoterCode,
} from "../lib/affiliateCodes";

// ===========================================================================
// HELPERS
// ===========================================================================

async function requireAdmin(ctx: any): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  const user = await ctx.db.get(userId);
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  if (!hasMinRole(user, ROLES.ADMIN)) {
    throw new ConvexError({
      message: "Admin access required. Moderators cannot access this section.",
      code: "unauthorized",
    });
  }
  return user;
}

/** Insert into the existing adminAuditLog (append-only). */
async function audit(
  ctx: any,
  actorUserId: Id<"users">,
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, unknown>,
) {
  try {
    await ctx.runMutation(internal.adminManagement.internalInsertAuditLog, {
      actorUserId,
      action,
      targetType,
      targetId,
      details: details ? JSON.stringify(details) : undefined,
    });
  } catch {
    // Non-fatal — audit logging must never break the business action.
  }
}

/** Read one config value with CONFIG_DEFAULTS fallback. */
async function getCfg(ctx: any, key: string): Promise<string> {
  try {
    const val = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key });
    if (val !== undefined && val !== null && val !== "") return val;
  } catch {
    // fall through to default
  }
  return CONFIG_DEFAULTS[key] ?? "";
}

async function getCfgNumber(ctx: any, key: string, fallback: number): Promise<number> {
  const raw = await getCfg(ctx, key);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function isProgramEnabled(ctx: any): Promise<boolean> {
  return (await getCfg(ctx, "AFFILIATE_PROGRAM_ENABLED")) === "true";
}

/**
 * Resolve an affiliate code (primary or alias, case-insensitive) to an
 * active promoter. Returns null for unknown codes. Used by the public
 * link resolver, visit pings, and attribution.
 */
async function resolveCodeToPromoter(
  ctx: any,
  codeRaw: string,
): Promise<{ promoter: Doc<"affiliatePromoters">; campaignCode: string } | null> {
  const code = (codeRaw || "").trim().toUpperCase();
  if (!isValidCodeShape(code)) return null;
  const promoter = await ctx.db
    .query("affiliatePromoters")
    .withIndex("by_code", (q: any) => q.eq("code", code))
    .unique();
  if (promoter) return { promoter, campaignCode: promoter.code };
  const alias = await ctx.db
    .query("affiliateCodeAliases")
    .withIndex("by_alias", (q: any) => q.eq("aliasCode", code))
    .unique();
  if (!alias) return null;
  const aliasPromoter = await ctx.db.get(alias.promoterId);
  if (!aliasPromoter) return null;
  return { promoter: aliasPromoter, campaignCode: code };
}

/** Resolve the effective commission settings (override else global default). */
async function resolveEffectiveCommission(
  ctx: any,
  promoter: Doc<"affiliatePromoters">,
): Promise<{ type: "fixed" | "percent"; value: number; scope: "first_only" | "every_payment" }> {
  const type =
    promoter.commissionType !== "inherit"
      ? promoter.commissionType
      : ((await getCfg(ctx, "AFFILIATE_DEFAULT_COMMISSION_TYPE")) === "percent"
          ? "percent"
          : "fixed");
  const rawValue =
    promoter.commissionType !== "inherit" && promoter.commissionValue !== undefined
      ? promoter.commissionValue
      : await getCfgNumber(ctx, "AFFILIATE_DEFAULT_COMMISSION_VALUE", 50);
  const scope =
    promoter.commissionScope !== "inherit"
      ? promoter.commissionScope
      : ((await getCfg(ctx, "AFFILIATE_DEFAULT_SCOPE")) === "every_payment"
          ? "every_payment"
          : "first_only");
  const value = Math.max(0, rawValue);
  return { type, value, scope };
}

/** Unambiguous Addis-Ababa calendar date key ("YYYY-MM-DD") for aggregates. */
function addisDateKey(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ts));
}

/** Cryptographically-random URL-safe token for the partner stats page. */
function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Round money to 2 decimals, never negative. */
function money(n: number): number {
  return Math.max(0, Math.round(n * 100) / 100);
}

// ===========================================================================
// PUBLIC: MASTER TOGGLE + LINK RESOLUTION
// ===========================================================================

/**
 * AFFILIATE_PROGRAM_ENABLED — public master toggle, same pattern as
 * getSchoolFeatureEnabled. The landing page / redirect route read this to
 * decide whether promoter links do anything. Default OFF.
 */
export const getAffiliateProgramEnabled = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", "AFFILIATE_PROGRAM_ENABLED"))
      .first();
    return row?.value === "true";
  },
});

/**
 * Public link resolution for /:code. Case-insensitive (primary code or
 * alias). Returns ONLY { valid, displayName, welcomeMessage } — never an
 * email, phone, id, or any other identifying detail. When the program is
 * disabled or the code is unknown/paused, returns valid:false (the caller
 * redirects to / silently — a promoter's bio link must never look broken).
 */
export const resolveAffiliateCode = query({
  args: { code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ valid: boolean; displayName: string; welcomeMessage: string | null }> => {
    return await ctx.runQuery(internal.affiliates.resolveAffiliateCodeCore, args);
  },
});

export const resolveAffiliateCodeCore = internalQuery({
  args: { code: v.string() },
  handler: async (
    ctx,
    { code },
  ): Promise<{ valid: boolean; displayName: string; welcomeMessage: string | null }> => {
    const empty = { valid: false, displayName: "", welcomeMessage: null as string | null };
    if (!(await isProgramEnabled(ctx))) return empty;
    const hit = await resolveCodeToPromoter(ctx, code);
    if (!hit) return empty;
    if (hit.promoter.status !== "active") return empty;
    return {
      valid: true,
      displayName: hit.promoter.name,
      welcomeMessage: hit.promoter.welcomeMessage?.trim() || null,
    };
  },
});

// ===========================================================================
// PUBLIC: VISIT PING (daily aggregate — never one row per click)
// ===========================================================================

/**
 * Visit ping fired by the /:code redirect route. The CLIENT throttles to
 * at most one ping per browser per day per code (localStorage guard) —
 * this mutation just does the cheap indexed increment. One upsert per
 * promoter+date+campaign; no per-click rows, no unbounded growth.
 */
export const recordAffiliateVisit = mutation({
  args: { code: v.string(), campaign: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    return await ctx.runMutation(internal.affiliates.recordAffiliateVisitCore, args);
  },
});

export const recordAffiliateVisitCore = internalMutation({
  args: { code: v.string(), campaign: v.optional(v.string()) },
  handler: async (ctx, { code, campaign }) => {
    if (!(await isProgramEnabled(ctx))) return { ok: false };
    const hit = await resolveCodeToPromoter(ctx, code);
    if (!hit) return { ok: false };
    // Paused promoters still collect visits (the link still works and the
    // owner may resume them); archived promoters are dead.
    if (hit.promoter.status === "archived") return { ok: false };

    const date = addisDateKey(Date.now());
    const camp = (campaign || "").trim().slice(0, 40);
    const promoterId = hit.promoter._id;

    const existing = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_promoter_date_campaign", (q) =>
        q.eq("promoterId", promoterId).eq("date", date).eq("campaign", camp),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { visits: existing.visits + 1, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("affiliateDailyStats", {
        promoterId,
        date,
        campaign: camp,
        visits: 1,
        updatedAt: Date.now(),
      });
    }
    // Denormalized lifetime counter — the admin overview sums this across
    // promoters instead of scanning the daily table.
    await ctx.db.patch(promoterId, {
      totalVisits: (hit.promoter.totalVisits ?? 0) + 1,
    });
    return { ok: true };
  },
});

// ===========================================================================
// PUBLIC: ATTRIBUTION (brand-new signups only)
// ===========================================================================

/**
 * Called ONCE when a brand-new account completes sign-up — the SAME hook
 * point used by the student referral flow (Auth.tsx, after the profile
 * loads). Reads the code the client stored in localStorage (`lx_aff`) at
 * link-click time, re-validates EVERYTHING server-side, and creates the
 * affiliateAttributions row.
 *
 * Rules:
 *   • Program must be enabled — no attribution accrues while disabled.
 *   • FIRST attribution wins: a user already attributed (to any promoter)
 *     is never overwritten.
 *   • Brand-new accounts only: the account must have been created within
 *     the last 48h (existing accounts clicking links are NOT attributed).
 *   • The captured code must be younger than AFFILIATE_ATTRIBUTION_DAYS.
 *   • Promoter must be active (paused/archived stop NEW attributions).
 *   • Self-attribution blocked: the promoter's own email can never be
 *     attributed to themselves.
 */
export const attachAffiliateAttribution = mutation({
  args: {
    code: v.string(),
    capturedAt: v.optional(v.number()),
    campaign: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { code, capturedAt, campaign },
  ): Promise<{ ok: boolean; reason?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false, reason: "unauthenticated" };
    return await ctx.runMutation(internal.affiliates.attachAffiliateAttributionCore, {
      userId,
      code,
      capturedAt,
      campaign,
    });
  },
});

/**
 * Core attribution logic (internal) — called by the public mutation with
 * the authenticated userId. Internal so the self-test harness can exercise
 * the exact same code path headlessly.
 */
export const attachAffiliateAttributionCore = internalMutation({
  args: {
    userId: v.id("users"),
    code: v.string(),
    capturedAt: v.optional(v.number()),
    campaign: v.optional(v.string()),
  },
  handler: async (ctx, { userId, code, capturedAt, campaign }) => {
    if (!(await isProgramEnabled(ctx))) return { ok: false, reason: "program_disabled" };

    const user = await ctx.db.get(userId);
    if (!user) return { ok: false, reason: "no_user" };

    // Brand-new accounts only — 48h grace window covers slow OTP flows.
    const NEW_ACCOUNT_WINDOW_MS = 48 * 60 * 60 * 1000;
    if (user._creationTime < Date.now() - NEW_ACCOUNT_WINDOW_MS) {
      return { ok: false, reason: "existing_account" };
    }

    // FIRST attribution wins — never overwrite.
    const existing = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return { ok: false, reason: "already_attributed" };

    const hit = await resolveCodeToPromoter(ctx, code);
    if (!hit) return { ok: false, reason: "invalid_code" };
    if (hit.promoter.status !== "active") return { ok: false, reason: "promoter_not_active" };

    // Attribution window — how long after the click the code stays valid.
    const days = await getCfgNumber(ctx, "AFFILIATE_ATTRIBUTION_DAYS", 30);
    const captured = capturedAt ?? Date.now();
    if (Date.now() - captured > days * 24 * 60 * 60 * 1000) {
      return { ok: false, reason: "attribution_window_expired" };
    }

    // Block self-attribution (promoter's own email).
    const promoterEmail = hit.promoter.email.trim().toLowerCase();
    const userEmail = (user.email ?? "").trim().toLowerCase();
    if (promoterEmail && userEmail && promoterEmail === userEmail) {
      return { ok: false, reason: "self_attribution" };
    }

    await ctx.db.insert("affiliateAttributions", {
      userId,
      promoterId: hit.promoter._id,
      campaign: (campaign || "").trim().slice(0, 40),
      attributedAt: Date.now(),
    });
    await ctx.db.patch(hit.promoter._id, {
      totalSignups: (hit.promoter.totalSignups ?? 0) + 1,
    });
    return { ok: true, reason: "attributed" };
  },
});

/**
 * Public, per-user query for the /upgrade page (P6 perk): returns the
 * attributed promoter's follower-perk discount code, if any. Only ever
 * returns the promoter's DISPLAY NAME + the perk code — no emails, no ids.
 */
export const getMyPromoterPerk = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ perkCode: string | null; promoterName: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { perkCode: null, promoterName: null };
    const attribution = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!attribution) return { perkCode: null, promoterName: null };
    const promoter = await ctx.db.get(attribution.promoterId);
    if (!promoter || promoter.status === "archived") return { perkCode: null, promoterName: null };
    const perk = promoter.perkDiscountCode?.trim().toUpperCase() || null;
    return { perkCode: perk, promoterName: promoter.name };
  },
});

// ===========================================================================
// COMMISSION ENGINE — the single accrual path
// ===========================================================================

/**
 * accrueAffiliateCommission — THE one internal mutation that creates a
 * commission when a payment becomes approved. Called from EVERY approval
 * path (manual admin approval, SMS auto-approve, and — when the config
 * allows it — school-seat approval). No duplicated logic.
 *
 * Idempotency: affiliateCommissions.submissionId is UNIQUE. Approving
 * twice, or both paths racing, inserts exactly one commission; the second
 * call hits the unique guard and returns early.
 *
 * Gates (each returns silently — accrual must never block approval):
 *   • Program enabled
 *   • Paying user has an attribution → promoter exists, not archived
 *     (PAUSED promoters still earn on already-attributed users — pausing
 *     stops NEW attributions, not earnings)
 *   • School-seat submissions skipped unless AFFILIATE_INCLUDE_SCHOOL_SEATS
 *   • first_only scope: skip when the user already has a non-void commission
 *   • Commission = fixed value, or percent of the amount ACTUALLY paid
 *     (post-discount) — never exceeding the paid amount
 */
export const accrueAffiliateCommission = internalMutation({
  args: {
    submissionId: v.string(),
    source: v.union(v.literal("manual_payment"), v.literal("school_seat")),
  },
  handler: async (
    ctx,
    { submissionId, source },
  ): Promise<{ accrued: boolean; reason?: string; commissionId?: string }> => {
    // Unique-submission guard — the idempotency lock. One read.
    const existing = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_submission", (q) => q.eq("submissionId", submissionId))
      .unique();
    if (existing) return { accrued: false, reason: "already_accrued" };

    if (!(await isProgramEnabled(ctx))) return { accrued: false, reason: "program_disabled" };

    // Load the paid submission. School seats are a different table.
    let userId: Id<"users"> | null = null;
    let gross = 0;
    if (source === "manual_payment") {
      const sub = await ctx.db.get(submissionId as Id<"manualPaymentSubmissions">);
      if (!sub) return { accrued: false, reason: "submission_not_found" };
      if (sub.status !== "approved") return { accrued: false, reason: "not_approved" };
      userId = sub.userId;
      // expectedAmount is snapshotted post-discount at submission time —
      // the amount ACTUALLY paid.
      gross = sub.expectedAmount;
    } else {
      // School seats — excluded by default. Only accrue when the admin
      // explicitly opted in via the config key.
      const includeSeats = (await getCfg(ctx, "AFFILIATE_INCLUDE_SCHOOL_SEATS")) === "true";
      if (!includeSeats) return { accrued: false, reason: "school_seats_excluded" };
      const sub = await ctx.db.get(submissionId as Id<"schoolSeatSubmissions">);
      if (!sub) return { accrued: false, reason: "submission_not_found" };
      if (sub.status !== "approved") return { accrued: false, reason: "not_approved" };
      userId = sub.directorId;
      gross = sub.totalAmount;
    }
    if (!userId || gross <= 0) return { accrued: false, reason: "no_amount" };

    // Attribution → promoter.
    const attribution = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!attribution) return { accrued: false, reason: "no_attribution" };
    const promoter = await ctx.db.get(attribution.promoterId);
    if (!promoter) return { accrued: false, reason: "promoter_missing" };
    // Archived ends everything. Paused still earns on already-attributed
    // users (pausing stops NEW attributions, not earnings).
    if (promoter.status === "archived") return { accrued: false, reason: "promoter_archived" };

    // Effective commission settings (promoter override else global default).
    const eff = await resolveEffectiveCommission(ctx, promoter);

    // first_only: skip when the user already has ANY non-void commission
    // (from this promoter or any other — a student's first payment can
    // only pay a first-commission once).
    if (eff.scope === "first_only") {
      const prior = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
        .first();
      if (prior) return { accrued: false, reason: "first_only_already_commissioned" };
      const priorPayable = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "payable"))
        .first();
      if (priorPayable) return { accrued: false, reason: "first_only_already_commissioned" };
      const priorPaid = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "paid"))
        .first();
      if (priorPaid) return { accrued: false, reason: "first_only_already_commissioned" };
    }

    // Commission math — fixed value or percent of the paid amount, capped
    // at the paid amount. Zero/negative → skip.
    let commission: number;
    if (eff.type === "percent") {
      commission = money((gross * Math.min(eff.value, 100)) / 100);
    } else {
      commission = money(eff.value);
    }
    commission = Math.min(commission, money(gross));
    if (commission <= 0) return { accrued: false, reason: "zero_commission" };

    // Hold window — must exceed the 48h refund window (default 72h).
    const holdHours = await getCfgNumber(ctx, "AFFILIATE_HOLD_HOURS", 72);
    const now = Date.now();

    const commissionId = await ctx.db.insert("affiliateCommissions", {
      promoterId: promoter._id,
      userId,
      submissionId,
      source,
      grossAmountEtb: money(gross),
      commissionEtb: commission,
      status: "pending",
      payableAt: now + Math.max(0, holdHours) * 60 * 60 * 1000,
      createdAt: now,
    });

    // Telegram ping to the admin — a commission was created (fire-and-forget
    // style: scheduled so this mutation stays fast and failures don't
    // block the approval path).
    try {
      await ctx.scheduler.runAfter(0, internal.affiliates.sendCommissionTelegram, {
        promoterName: promoter.name,
        promoterCode: promoter.code,
        grossEtb: money(gross),
        commissionEtb: commission,
        source,
      });
    } catch {
      // Non-fatal.
    }

    return { accrued: true, commissionId };
  },
});

// ---------------------------------------------------------------------------
// sendCommissionTelegram — internal action: one Telegram line to the admin
// chat when a commission accrues. Aggregate-safe: mentions the PROMOTER
// name and amounts, never the student.
// ---------------------------------------------------------------------------

export const sendCommissionTelegram = internalAction({
  args: {
    promoterName: v.string(),
    promoterCode: v.string(),
    grossEtb: v.number(),
    commissionEtb: v.number(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    await sendTelegramToAdmin(ctx, [
      "🤝 <b>Affiliate commission accrued</b>",
      "",
      `📣 Promoter: <b>${args.promoterName}</b> (${args.promoterCode})`,
      `💰 Payment: <b>${args.grossEtb} ETB</b> (${args.source === "school_seat" ? "school seats" : "student premium"})`,
      `🏷 Commission owed: <b>${args.commissionEtb} ETB</b> (pending hold)`,
    ].join("\n"));
  },
});

/**
 * Shared Telegram send helper (internal actions). Reads the bot token +
 * admin chat ID from configKeys; silently no-ops when not configured.
 */
async function sendTelegramToAdmin(ctx: any, text: string): Promise<boolean> {
  try {
    const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: "TELEGRAM_BOT_TOKEN",
    });
    if (!token) return false;
    const chatId = await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: "TELEGRAM_ADMIN_CHAT_ID",
    });
    if (!chatId) return false;
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(response.ok && data?.ok);
  } catch {
    return false;
  }
}

// ===========================================================================
// HOLD-WINDOW CRON — pending → payable (hourly, early-exit)
// ===========================================================================

/**
 * flipDueCommissions — hourly cron (see crons.ts). Indexed by
 * status+payableAt (order asc), so when nothing is due the first read
 * exits immediately — the cheap early-exit the usage discipline demands.
 * Flips at most 200 due commissions per run; the next hour picks up the
 * rest (there will not be a rest at realistic volumes).
 *
 * After flipping, for each affected promoter whose payable balance now
 * crosses AFFILIATE_MIN_PAYOUT_ETB, send ONE Telegram ping (throttled to
 * at most once per 7 days via the promoter's minPayoutNotifiedAt).
 */
export const flipDueCommissions = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ flipped: number; notified: number }> => {
    const now = Date.now();

    // Earliest-due-first. If the oldest pending commission isn't due yet,
    // nothing is — exit after one indexed read.
    const due = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_status_payableAt", (q) =>
        q.eq("status", "pending").lte("payableAt", now),
      )
      .order("asc")
      .take(200);
    if (due.length === 0) return { flipped: 0, notified: 0 };

    const touchedPromoters = new Set<string>();
    for (const c of due) {
      await ctx.db.patch(c._id, { status: "payable" });
      touchedPromoters.add(c.promoterId);
    }

    // Payout-ready pings.
    const minPayout = await getCfgNumber(ctx, "AFFILIATE_MIN_PAYOUT_ETB", 200);
    const PING_THROTTLE_MS = 7 * 24 * 60 * 60 * 1000;
    let notified = 0;
    for (const promoterId of touchedPromoters) {
      const payable = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_promoter_status", (q) =>
          q.eq("promoterId", promoterId as Id<"affiliatePromoters">).eq("status", "payable"),
        )
        .take(500);
      const payableSum = payable.reduce((s, c) => s + c.commissionEtb, 0);
      if (payableSum < minPayout) continue;
      const promoter = await ctx.db.get(promoterId as Id<"affiliatePromoters">);
      if (!promoter) continue;
      if (
        promoter.minPayoutNotifiedAt &&
        now - promoter.minPayoutNotifiedAt < PING_THROTTLE_MS
      ) {
        continue;
      }
      await ctx.db.patch(promoter._id, { minPayoutNotifiedAt: now });
      notified++;
      try {
        await ctx.scheduler.runAfter(0, internal.affiliates.sendPayoutReadyTelegram, {
          promoterName: promoter.name,
          promoterCode: promoter.code,
          payableEtb: money(payableSum),
          minPayoutEtb: minPayout,
        });
      } catch {
        // Non-fatal.
      }
    }

    return { flipped: due.length, notified };
  },
});

export const sendPayoutReadyTelegram = internalAction({
  args: {
    promoterName: v.string(),
    promoterCode: v.string(),
    payableEtb: v.number(),
    minPayoutEtb: v.number(),
  },
  handler: async (ctx, args) => {
    await sendTelegramToAdmin(
      ctx,
      [
        "💸 <b>Affiliate payout ready</b>",
        "",
        `📣 ${args.promoterName} (${args.promoterCode}) reached <b>${args.payableEtb} ETB</b> payable (min ${args.minPayoutEtb}).`,
        `Record the payout in Admin → Affiliates → Payouts when you've sent the TeleBirr transfer.`,
      ].join("\n"),
    );
  },
});

// ===========================================================================
// VOID / CLAWBACK
// ===========================================================================

/**
 * voidAffiliateCommission — admin action when a payment is refunded or
 * deemed fraudulent. Reason REQUIRED.
 *
 * If the commission was already PAID, the row is NOT deleted — it's
 * marked void and the promoter's running balance drops below what was
 * paid out (earned excludes void, payouts stay), making the clawback
 * visible as a negative balance. The admin settles it in the next
 * payout conversation — deliberately honest, deliberately manual.
 */
export const voidCommission = mutation({
  args: { commissionId: v.id("affiliateCommissions"), reason: v.string() },
  handler: async (ctx, { commissionId, reason }): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx);
    return await ctx.runMutation(internal.affiliates.voidCommissionCore, {
      commissionId,
      reason,
      adminId: admin._id,
    });
  },
});

export const voidCommissionCore = internalMutation({
  args: {
    commissionId: v.id("affiliateCommissions"),
    reason: v.string(),
    adminId: v.id("users"),
  },
  handler: async (ctx, { commissionId, reason, adminId }) => {
    const admin = { _id: adminId };
    const clean = reason.trim();
    if (clean.length < 3) {
      throw new ConvexError({
        message: "A void reason is required (min 3 chars).",
        code: "invalid",
      });
    }
    const commission = await ctx.db.get(commissionId);
    if (!commission) {
      throw new ConvexError({ message: "Commission not found.", code: "not_found" });
    }
    if (commission.status === "void") {
      throw new ConvexError({ message: "Commission is already void.", code: "invalid" });
    }
    await ctx.db.patch(commissionId, {
      status: "void",
      voidReason: clean,
      voidedBy: admin._id,
      voidedAt: Date.now(),
    });
    await audit(ctx, admin._id, "affiliate.commission_void", "affiliateCommission", commissionId, {
      promoterId: commission.promoterId,
      wasStatus: commission.status,
      commissionEtb: commission.commissionEtb,
      reason: clean,
    });
    return { ok: true };
  },
});

// ===========================================================================
// PAYOUTS — the admin records manual TeleBirr transfers
// ===========================================================================

/**
 * recordAffiliatePayout — the admin pays a promoter via TeleBirr OUTSIDE
 * the system, then records it here. Marks the covered payable
 * commissions as paid (FIFO by payableAt — oldest first) and inserts the
 * affiliatePayouts receipt row.
 *
 * Refuses when:
 *   • amount <= 0 or amount exceeds the payable balance
 *   • amount < AFFILIATE_MIN_PAYOUT_ETB without explicit override
 *   • the payout can't cover even one payable commission
 */
export const recordAffiliatePayout = mutation({
  args: {
    promoterId: v.id("affiliatePromoters"),
    amountEtb: v.number(),
    method: v.optional(v.string()),
    reference: v.string(),
    screenshotStorageId: v.optional(v.string()),
    note: v.optional(v.string()),
    overrideMinPayout: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; payoutId: Id<"affiliatePayouts">; coveredCommissions: number; coveredEtb: number }> => {
    const admin = await requireAdmin(ctx);
    return await ctx.runMutation(internal.affiliates.recordPayoutCore, {
      ...args,
      adminId: admin._id,
    });
  },
});

export const recordPayoutCore = internalMutation({
  args: {
    promoterId: v.id("affiliatePromoters"),
    amountEtb: v.number(),
    method: v.optional(v.string()),
    reference: v.string(),
    screenshotStorageId: v.optional(v.string()),
    note: v.optional(v.string()),
    overrideMinPayout: v.optional(v.boolean()),
    adminId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const admin = { _id: args.adminId };
    const amount = money(args.amountEtb);
    if (!(amount > 0)) {
      throw new ConvexError({ message: "Payout amount must be positive.", code: "invalid" });
    }
    const reference = args.reference.trim();
    if (reference.length < 3) {
      throw new ConvexError({
        message: "A TeleBirr transaction reference is required.",
        code: "invalid",
      });
    }
    const promoter = await ctx.db.get(args.promoterId);
    if (!promoter) {
      throw new ConvexError({ message: "Promoter not found.", code: "not_found" });
    }

    // Payable commissions — FIFO by payableAt (oldest first).
    const payable = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_promoter_status", (q) =>
        q.eq("promoterId", args.promoterId).eq("status", "payable"),
      )
      .order("asc")
      .take(500);
    const payableBalance = money(payable.reduce((s, c) => s + c.commissionEtb, 0));

    if (amount > payableBalance + 0.001) {
      throw new ConvexError({
        message: `Payout (${amount} ETB) exceeds the payable balance (${payableBalance} ETB).`,
        code: "invalid",
      });
    }
    const minPayout = await getCfgNumber(ctx, "AFFILIATE_MIN_PAYOUT_ETB", 200);
    if (amount < minPayout && !args.overrideMinPayout) {
      throw new ConvexError({
        message: `Payout is below the ${minPayout} ETB minimum. Tick "override" to record it anyway.`,
        code: "invalid",
      });
    }

    // Insert the payout receipt FIRST, then mark the covered commissions
    // FIFO while they fit in the payout amount — one pass, atomic fields.
    const now = Date.now();
    const payoutId = await ctx.db.insert("affiliatePayouts", {
      promoterId: args.promoterId,
      amountEtb: amount,
      method: args.method?.trim() || "telebirr",
      reference,
      screenshotStorageId: args.screenshotStorageId,
      note: args.note?.trim() || undefined,
      paidAt: now,
      paidBy: admin._id,
    });

    let covered = 0;
    let coveredCount = 0;
    for (const c of payable) {
      if (covered + c.commissionEtb <= amount + 0.001) {
        await ctx.db.patch(c._id, {
          status: "paid",
          paidAt: now,
          payoutId,
        });
        covered += c.commissionEtb;
        coveredCount++;
      }
    }
    if (coveredCount === 0) {
      throw new ConvexError({
        message: "Amount is too small to cover any payable commission.",
        code: "invalid",
      });
    }

    await audit(ctx, admin._id, "affiliate.payout_recorded", "affiliatePromoter", args.promoterId, {
      payoutId,
      amountEtb: amount,
      coveredCommissions: coveredCount,
      reference,
    });

    // Notify the promoter-facing admin chat that the ledger updated.
    try {
      await ctx.scheduler.runAfter(0, internal.affiliates.sendPayoutRecordedTelegram, {
        promoterName: promoter.name,
        promoterCode: promoter.code,
        amountEtb: amount,
      });
    } catch {
      // Non-fatal.
    }

    return { ok: true, payoutId, coveredCommissions: coveredCount, coveredEtb: covered };
  },
});

export const sendPayoutRecordedTelegram = internalAction({
  args: { promoterName: v.string(), promoterCode: v.string(), amountEtb: v.number() },
  handler: async (ctx, args) => {
    await sendTelegramToAdmin(
      ctx,
      `✅ Affiliate payout recorded: <b>${args.amountEtb} ETB</b> to <b>${args.promoterName}</b> (${args.promoterCode}). Ledger updated.`,
    );
  },
});

// ===========================================================================
// ADMIN: PROMOTER CRUD
// ===========================================================================

/** Does a code collide with any promoter primary code or alias? */
async function isCodeTaken(ctx: any, code: string): Promise<boolean> {
  const promoter = await ctx.db
    .query("affiliatePromoters")
    .withIndex("by_code", (q: any) => q.eq("code", code))
    .unique();
  if (promoter) return true;
  const alias = await ctx.db
    .query("affiliateCodeAliases")
    .withIndex("by_alias", (q: any) => q.eq("aliasCode", code))
    .unique();
  return Boolean(alias);
}

export const createPromoter = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    tiktokHandle: v.optional(v.string()),
    payoutAccount: v.optional(v.string()),
    // Empty → auto-generate from the name. Non-empty → admin-typed code.
    code: v.optional(v.string()),
    commissionType: v.union(
      v.literal("inherit"),
      v.literal("fixed"),
      v.literal("percent"),
    ),
    commissionValue: v.optional(v.number()),
    commissionScope: v.union(
      v.literal("inherit"),
      v.literal("first_only"),
      v.literal("every_payment"),
    ),
    welcomeMessage: v.optional(v.string()),
    perkDiscountCode: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    if (name.length < 2) {
      throw new ConvexError({ message: "Promoter name is required.", code: "invalid" });
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new ConvexError({ message: "A valid email is required.", code: "invalid" });
    }

    // Code: admin-typed or auto-generated from the name. Reserved words
    // (every top-level route in main.tsx + PARTNER/API) are rejected.
    let code: string;
    const typed = (args.code || "").trim().toUpperCase();
    if (typed) {
      const err = validatePromoterCode(typed);
      if (err) throw new ConvexError({ message: err, code: "invalid" });
      if (await isCodeTaken(ctx, typed)) {
        throw new ConvexError({
          message: `Code "${typed}" is already taken.`,
          code: "duplicate",
        });
      }
      code = typed;
    } else {
      code = await generateUniquePromoterCode(name, (c) => isCodeTaken(ctx, c));
      if (!code) {
        throw new ConvexError({
          message:
            "Couldn't generate a code from this name (non-Latin characters or every candidate taken/reserved). Type a code manually.",
          code: "invalid",
        });
      }
    }

    // Perk must reference an existing discount code when provided.
    const perk = args.perkDiscountCode?.trim().toUpperCase() || undefined;
    if (perk) {
      const discount = await ctx.db
        .query("discountCodes")
        .withIndex("by_code", (q) => q.eq("code", perk))
        .unique();
      if (!discount) {
        throw new ConvexError({
          message: `Perk code "${perk}" is not an existing discount code. Create it in Marketing first.`,
          code: "not_found",
        });
      }
    }

    const promoterId = await ctx.db.insert("affiliatePromoters", {
      name,
      email,
      phone: args.phone?.trim() || undefined,
      tiktokHandle: args.tiktokHandle?.trim() || undefined,
      payoutAccount: args.payoutAccount?.trim() || undefined,
      code,
      status: "active",
      commissionType: args.commissionType,
      commissionValue: args.commissionValue,
      commissionScope: args.commissionScope,
      welcomeMessage: args.welcomeMessage?.trim() || undefined,
      perkDiscountCode: perk,
      notes: args.notes?.trim() || undefined,
      secretToken: randomToken(),
      totalVisits: 0,
      totalSignups: 0,
      createdAt: Date.now(),
      createdBy: admin._id,
    });

    await audit(ctx, admin._id, "affiliate.promoter_create", "affiliatePromoter", promoterId, {
      name,
      code,
      email,
    });
    return { ok: true, promoterId, code };
  },
});

export const updatePromoter = mutation({
  args: {
    promoterId: v.id("affiliatePromoters"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    tiktokHandle: v.optional(v.string()),
    payoutAccount: v.optional(v.string()),
    commissionType: v.optional(
      v.union(v.literal("inherit"), v.literal("fixed"), v.literal("percent")),
    ),
    commissionValue: v.optional(v.number()),
    commissionScope: v.optional(
      v.union(v.literal("inherit"), v.literal("first_only"), v.literal("every_payment")),
    ),
    welcomeMessage: v.optional(v.string()),
    perkDiscountCode: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);
    const promoter = await ctx.db.get(args.promoterId);
    if (!promoter) {
      throw new ConvexError({ message: "Promoter not found.", code: "not_found" });
    }
    // NOTE: the code itself is deliberately NOT editable here — once a
    // code has visits or attributions it's locked (the promoter's bio
    // link points at it). Offer "add alias" instead.
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2) throw new ConvexError({ message: "Name too short.", code: "invalid" });
      patch.name = name;
    }
    if (args.email !== undefined) {
      const email = args.email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new ConvexError({ message: "Invalid email.", code: "invalid" });
      }
      patch.email = email;
    }
    for (const key of ["phone", "tiktokHandle", "payoutAccount", "welcomeMessage", "notes"] as const) {
      if (args[key] !== undefined) patch[key] = args[key]!.trim() || undefined;
    }
    if (args.commissionType !== undefined) patch.commissionType = args.commissionType;
    if (args.commissionValue !== undefined) patch.commissionValue = Math.max(0, args.commissionValue);
    if (args.commissionScope !== undefined) patch.commissionScope = args.commissionScope;
    if (args.perkDiscountCode !== undefined) {
      const perk = args.perkDiscountCode.trim().toUpperCase();
      if (perk) {
        const discount = await ctx.db
          .query("discountCodes")
          .withIndex("by_code", (q) => q.eq("code", perk))
          .unique();
        if (!discount) {
          throw new ConvexError({
            message: `Perk code "${perk}" is not an existing discount code.`,
            code: "not_found",
          });
        }
        patch.perkDiscountCode = perk;
      } else {
        patch.perkDiscountCode = undefined;
      }
    }
    await ctx.db.patch(args.promoterId, patch);
    await audit(ctx, admin._id, "affiliate.promoter_update", "affiliatePromoter", args.promoterId, patch);
    return { ok: true };
  },
});

/** Pause / resume / archive. Archiving preserves the ledger forever. */
export const setPromoterStatus = mutation({
  args: {
    promoterId: v.id("affiliatePromoters"),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("archived")),
  },
  handler: async (ctx, { promoterId, status }) => {
    const admin = await requireAdmin(ctx);
    const promoter = await ctx.db.get(promoterId);
    if (!promoter) {
      throw new ConvexError({ message: "Promoter not found.", code: "not_found" });
    }
    await ctx.db.patch(promoterId, { status });
    await audit(ctx, admin._id, "affiliate.promoter_status", "affiliatePromoter", promoterId, {
      from: promoter.status,
      to: status,
    });
    return { ok: true };
  },
});

/**
 * Hard delete — ONLY for a completely untouched promoter (zero visits,
 * zero attributions, zero commissions). Anything else must use archive,
 * which preserves the ledger and keeps the link redirecting silently.
 */
export const deletePromoter = mutation({
  args: { promoterId: v.id("affiliatePromoters") },
  handler: async (ctx, { promoterId }) => {
    const admin = await requireAdmin(ctx);
    const promoter = await ctx.db.get(promoterId);
    if (!promoter) {
      throw new ConvexError({ message: "Promoter not found.", code: "not_found" });
    }
    const attribution = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .first();
    if (attribution) {
      throw new ConvexError({
        message:
          "This promoter already has attributed students — archive instead of deleting (the ledger must be preserved).",
        code: "invalid",
      });
    }
    const commission = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .first();
    if (commission) {
      throw new ConvexError({
        message: "This promoter has commissions on the ledger — archive instead of deleting.",
        code: "invalid",
      });
    }
    const stats = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(1);
    if (stats.length > 0) {
      throw new ConvexError({
        message: "This promoter already has visit history — archive instead of deleting.",
        code: "invalid",
      });
    }
    // Remove aliases too (cascading — they're meaningless without the promoter).
    const aliases = await ctx.db
      .query("affiliateCodeAliases")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(50);
    for (const a of aliases) await ctx.db.delete(a._id);
    await ctx.db.delete(promoterId);
    await audit(ctx, admin._id, "affiliate.promoter_delete", "affiliatePromoter", promoterId, {
      code: promoter.code,
    });
    return { ok: true };
  },
});

/** Add an extra code that resolves to the same promoter. */
export const addPromoterAlias = mutation({
  args: { promoterId: v.id("affiliatePromoters"), aliasCode: v.string() },
  handler: async (ctx, { promoterId, aliasCode }) => {
    const admin = await requireAdmin(ctx);
    const promoter = await ctx.db.get(promoterId);
    if (!promoter) {
      throw new ConvexError({ message: "Promoter not found.", code: "not_found" });
    }
    const code = aliasCode.trim().toUpperCase();
    const err = validatePromoterCode(code);
    if (err) throw new ConvexError({ message: err, code: "invalid" });
    if (code === promoter.code) {
      throw new ConvexError({ message: "That's already the promoter's main code.", code: "duplicate" });
    }
    if (await isCodeTaken(ctx, code)) {
      throw new ConvexError({ message: `Code "${code}" is already taken.`, code: "duplicate" });
    }
    await ctx.db.insert("affiliateCodeAliases", {
      promoterId,
      aliasCode: code,
      createdAt: Date.now(),
      createdBy: admin._id,
    });
    await audit(ctx, admin._id, "affiliate.alias_create", "affiliatePromoter", promoterId, {
      aliasCode: code,
    });
    return { ok: true };
  },
});

/** List a promoter's aliases (admin detail drawer). */
export const listPromoterAliases = query({
  args: { promoterId: v.id("affiliatePromoters") },
  handler: async (ctx, { promoterId }) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("affiliateCodeAliases")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(50);
  },
});

/** Regenerate the partner-page secret token (old link stops working). */
export const regeneratePartnerToken = mutation({
  args: { promoterId: v.id("affiliatePromoters") },
  handler: async (ctx, { promoterId }) => {
    const admin = await requireAdmin(ctx);
    const token = randomToken();
    await ctx.db.patch(promoterId, { secretToken: token });
    await audit(ctx, admin._id, "affiliate.token_regenerate", "affiliatePromoter", promoterId, {});
    return { ok: true, secretToken: token };
  },
});

/** One-time upload URL for the optional payout screenshot (admin-only). */
export const generatePayoutScreenshotUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// ===========================================================================
// ADMIN: QUERIES (one subscription per tab, shared via props)
// ===========================================================================

/** Per-promoter rollup used by the leaderboard + detail drawer balance. */
async function promoterLedgerTotals(
  ctx: any,
  promoterId: Id<"affiliatePromoters">,
): Promise<{
  pending: number;
  payable: number;
  paid: number;
  voided: number;
  earnedNonVoid: number;
  payingUsers: number;
  commissionCount: number;
}> {
  // Bounded reads per status — the ledger is naturally bounded by real
  // payment volume.
  const pending = await ctx.db
    .query("affiliateCommissions")
    .withIndex("by_promoter_status", (q: any) => q.eq("promoterId", promoterId).eq("status", "pending"))
    .take(500);
  const payable = await ctx.db
    .query("affiliateCommissions")
    .withIndex("by_promoter_status", (q: any) => q.eq("promoterId", promoterId).eq("status", "payable"))
    .take(500);
  const paid = await ctx.db
    .query("affiliateCommissions")
    .withIndex("by_promoter_status", (q: any) => q.eq("promoterId", promoterId).eq("status", "paid"))
    .take(500);
  const voided = await ctx.db
    .query("affiliateCommissions")
    .withIndex("by_promoter_status", (q: any) => q.eq("promoterId", promoterId).eq("status", "void"))
    .take(500);
  const sum = (arr: { commissionEtb: number }[]) => money(arr.reduce((s, c) => s + c.commissionEtb, 0));
  const nonVoid = [...pending, ...payable, ...paid];
  const users = new Set(nonVoid.map((c) => c.userId));
  return {
    pending: sum(pending),
    payable: sum(payable),
    paid: sum(paid),
    voided: sum(voided),
    earnedNonVoid: sum(nonVoid),
    payingUsers: users.size,
    commissionCount: nonVoid.length + voided.length,
  };
}

export const getAffiliateOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const promoters = await ctx.db
      .query("affiliatePromoters")
      .withIndex("by_createdAt")
      .order("desc")
      .take(300);

    const activePromoters = promoters.filter((p) => p.status === "active").length;

    // Denormalized lifetime counters — no daily-table scan.
    const totalVisits = promoters.reduce((s, p) => s + (p.totalVisits ?? 0), 0);
    const totalSignups = promoters.reduce((s, p) => s + (p.totalSignups ?? 0), 0);

    // Whole-ledger aggregates (bounded take — commissions grow with real
    // payment volume, not clicks).
    const pending = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_status_payableAt", (q) => q.eq("status", "pending").gt("payableAt", 0))
      .take(1000);
    const payable = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_status_payableAt", (q) => q.eq("status", "payable").gt("payableAt", 0))
      .take(1000);
    const paid = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_status_payableAt", (q) => q.eq("status", "paid").gt("payableAt", 0))
      .take(1000);
    const voided = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_status_payableAt", (q) => q.eq("status", "void").gt("payableAt", 0))
      .take(1000);
    const all = [...pending, ...payable, ...paid, ...voided];
    const sumEtb = (arr: { commissionEtb: number }[]) =>
      money(arr.reduce((s, c) => s + c.commissionEtb, 0));
    const sumGross = (arr: { grossAmountEtb: number }[]) =>
      money(arr.reduce((s, c) => s + c.grossAmountEtb, 0));
    const nonVoid = [...pending, ...payable, ...paid];
    const payingUsers = new Set(nonVoid.map((c) => c.userId)).size;

    const payouts = await ctx.db
      .query("affiliatePayouts")
      .withIndex("by_paidAt")
      .order("desc")
      .take(500);
    const totalPaidOut = money(payouts.reduce((s, p) => s + p.amountEtb, 0));

    // 30-day chart: visits per day (indexed by_date range) + signups and
    // commissions per day computed from bounded windows.
    const sinceKey = addisDateKey(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const dailyStats = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_date", (q) => q.gte("date", sinceKey))
      .take(1000);
    const visitsByDay = new Map<string, number>();
    for (const row of dailyStats) {
      visitsByDay.set(row.date, (visitsByDay.get(row.date) ?? 0) + row.visits);
    }
    const signupsByDay = new Map<string, number>();
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const p of promoters) {
      const rows = await ctx.db
        .query("affiliateAttributions")
        .withIndex("by_promoter_attributedAt", (q) =>
          q.eq("promoterId", p._id).gte("attributedAt", cutoff30),
        )
        .take(200);
      for (const r of rows) {
        const key = addisDateKey(r.attributedAt);
        signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
      }
    }
    const commissionsByDay = new Map<string, number>();
    for (const c of all) {
      if (c.createdAt >= cutoff30) {
        const key = addisDateKey(c.createdAt);
        commissionsByDay.set(key, (commissionsByDay.get(key) ?? 0) + c.commissionEtb);
      }
    }

    const days: { date: string; label: string; visits: number; signups: number; commissions: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const ts = Date.now() - i * 24 * 60 * 60 * 1000;
      const key = addisDateKey(ts);
      const label = new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      days.push({
        date: key,
        label,
        visits: visitsByDay.get(key) ?? 0,
        signups: signupsByDay.get(key) ?? 0,
        commissions: commissionsByDay.get(key) ?? 0,
      });
    }

    // Leaderboard — per-promoter rollup.
    const leaderboard = [];
    for (const p of promoters) {
      const totals = await promoterLedgerTotals(ctx, p._id);
      leaderboard.push({
        promoterId: p._id,
        name: p.name,
        code: p.code,
        status: p.status,
        visits: p.totalVisits ?? 0,
        signups: p.totalSignups ?? 0,
        payingUsers: totals.payingUsers,
        earnedNonVoid: totals.earnedNonVoid,
      });
    }
    leaderboard.sort((a, b) => b.earnedNonVoid - a.earnedNonVoid || b.signups - a.signups);

    const grossRevenue = sumGross(nonVoid);
    const commissionsTotal = sumEtb(nonVoid);

    return {
      programEnabled: await isProgramEnabled(ctx),
      totalPromoters: promoters.length,
      activePromoters,
      totalVisits,
      totalSignups,
      payingUsers,
      signupConversion: totalVisits > 0 ? totalSignups / totalVisits : 0,
      payConversion: totalSignups > 0 ? payingUsers / totalSignups : 0,
      visitToPaid: totalVisits > 0 ? payingUsers / totalVisits : 0,
      grossRevenue,
      commissionsPending: sumEtb(pending),
      commissionsPayable: sumEtb(payable),
      commissionsPaid: sumEtb(paid),
      commissionsVoided: sumEtb(voided),
      commissionsTotal,
      netRevenue: money(grossRevenue - commissionsTotal),
      totalPaidOut,
      balanceOwed: money(sumEtb(payable)),
      days,
      leaderboard: leaderboard.slice(0, 50),
    };
  },
});

export type AffiliateOverview = {
  programEnabled: boolean;
  totalPromoters: number;
  activePromoters: number;
  totalVisits: number;
  totalSignups: number;
  payingUsers: number;
  signupConversion: number;
  payConversion: number;
  visitToPaid: number;
  grossRevenue: number;
  commissionsPending: number;
  commissionsPayable: number;
  commissionsPaid: number;
  commissionsVoided: number;
  commissionsTotal: number;
  netRevenue: number;
  totalPaidOut: number;
  balanceOwed: number;
  days: { date: string; label: string; visits: number; signups: number; commissions: number }[];
  leaderboard: {
    promoterId: Id<"affiliatePromoters">;
    name: string;
    code: string;
    status: string;
    visits: number;
    signups: number;
    payingUsers: number;
    earnedNonVoid: number;
  }[];
};

export const listAffiliatePromoters = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const promoters = await ctx.db
      .query("affiliatePromoters")
      .withIndex("by_createdAt")
      .order("desc")
      .take(300);
    const rows = [];
    for (const p of promoters) {
      const totals = await promoterLedgerTotals(ctx, p._id);
      const payouts = await ctx.db
        .query("affiliatePayouts")
        .withIndex("by_promoter_paidAt", (q) => q.eq("promoterId", p._id))
        .take(100);
      const paidOut = money(payouts.reduce((s, x) => s + x.amountEtb, 0));
      rows.push({
        _id: p._id,
        name: p.name,
        email: p.email,
        phone: p.phone,
        tiktokHandle: p.tiktokHandle,
        payoutAccount: p.payoutAccount,
        code: p.code,
        status: p.status,
        commissionType: p.commissionType,
        commissionValue: p.commissionValue,
        commissionScope: p.commissionScope,
        welcomeMessage: p.welcomeMessage,
        perkDiscountCode: p.perkDiscountCode,
        notes: p.notes,
        secretToken: p.secretToken,
        totalVisits: p.totalVisits ?? 0,
        totalSignups: p.totalSignups ?? 0,
        payingUsers: totals.payingUsers,
        pendingEtb: totals.pending,
        payableEtb: totals.payable,
        paidEtb: totals.paid,
        voidedEtb: totals.voided,
        earnedNonVoidEtb: totals.earnedNonVoid,
        paidOutEtb: paidOut,
        balanceEtb: money(totals.earnedNonVoid - paidOut),
        createdAt: p.createdAt,
      });
    }
    return rows;
  },
});

/** Promoter detail drawer — funnel, campaigns, ledger, payouts, balance. */
export const getAffiliatePromoterDetail = query({
  args: { promoterId: v.id("affiliatePromoters") },
  handler: async (ctx, { promoterId }) => {
    await requireAdmin(ctx);
    const promoter = await ctx.db.get(promoterId);
    if (!promoter) return null;

    // Funnel + ledger totals.
    const totals = await promoterLedgerTotals(ctx, promoterId);
    const payouts = await ctx.db
      .query("affiliatePayouts")
      .withIndex("by_promoter_paidAt", (q) => q.eq("promoterId", promoterId))
      .order("desc")
      .take(100);
    const paidOut = money(payouts.reduce((s, x) => s + x.amountEtb, 0));

    // Per-campaign breakdown: visits from the daily aggregate + signups
    // from attribution rows (bounded). AGGREGATE numbers only.
    const stats = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(400);
    const campaignVisits = new Map<string, number>();
    for (const row of stats) {
      campaignVisits.set(row.campaign, (campaignVisits.get(row.campaign) ?? 0) + row.visits);
    }
    const attributed = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(500);
    const campaignSignups = new Map<string, number>();
    for (const a of attributed) {
      campaignSignups.set(a.campaign, (campaignSignups.get(a.campaign) ?? 0) + 1);
    }
    const campaigns = Array.from(
      new Set([...campaignVisits.keys(), ...campaignSignups.keys()]),
    ).map((c) => ({
      campaign: c || "(no campaign)",
      visits: campaignVisits.get(c) ?? 0,
      signups: campaignSignups.get(c) ?? 0,
    }));
    campaigns.sort((a, b) => b.visits - a.visits || b.signups - a.signups);

    // 30-day daily series (visits + signups).
    const sinceKey = addisDateKey(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentStats = stats.filter((s) => s.date >= sinceKey);
    const visitsByDay = new Map<string, number>();
    for (const row of recentStats) visitsByDay.set(row.date, (visitsByDay.get(row.date) ?? 0) + row.visits);
    const signupsByDay = new Map<string, number>();
    for (const a of attributed) {
      if (a.attributedAt >= cutoff30) {
        const key = addisDateKey(a.attributedAt);
        signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
      }
    }
    const days: { date: string; label: string; visits: number; signups: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const ts = Date.now() - i * 24 * 60 * 60 * 1000;
      const key = addisDateKey(ts);
      days.push({
        date: key,
        label: new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        visits: visitsByDay.get(key) ?? 0,
        signups: signupsByDay.get(key) ?? 0,
      });
    }

    // Commission ledger (bounded, newest first).
    const commissions = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(200);
    commissions.sort((a, b) => b.createdAt - a.createdAt);

    const holdHours = await getCfgNumber(ctx, "AFFILIATE_HOLD_HOURS", 72);
    const minPayout = await getCfgNumber(ctx, "AFFILIATE_MIN_PAYOUT_ETB", 200);

    return {
      promoter: {
        _id: promoter._id,
        name: promoter.name,
        email: promoter.email,
        phone: promoter.phone,
        tiktokHandle: promoter.tiktokHandle,
        payoutAccount: promoter.payoutAccount,
        code: promoter.code,
        status: promoter.status,
        commissionType: promoter.commissionType,
        commissionValue: promoter.commissionValue,
        commissionScope: promoter.commissionScope,
        welcomeMessage: promoter.welcomeMessage,
        perkDiscountCode: promoter.perkDiscountCode,
        notes: promoter.notes,
        secretToken: promoter.secretToken,
        totalVisits: promoter.totalVisits ?? 0,
        totalSignups: promoter.totalSignups ?? 0,
        createdAt: promoter.createdAt,
      },
      funnel: {
        visits: promoter.totalVisits ?? 0,
        signups: promoter.totalSignups ?? 0,
        payingUsers: totals.payingUsers,
        signupConversion: (promoter.totalVisits ?? 0) > 0 ? (promoter.totalSignups ?? 0) / (promoter.totalVisits ?? 1) : 0,
        payConversion: (promoter.totalSignups ?? 0) > 0 ? totals.payingUsers / (promoter.totalSignups ?? 1) : 0,
      },
      ledger: {
        pendingEtb: totals.pending,
        payableEtb: totals.payable,
        paidEtb: totals.paid,
        voidedEtb: totals.voided,
        earnedNonVoidEtb: totals.earnedNonVoid,
        paidOutEtb: paidOut,
        balanceEtb: money(totals.earnedNonVoid - paidOut),
        commissionCount: totals.commissionCount,
      },
      campaigns,
      days,
      commissions,
      payouts,
      holdHours,
      minPayout,
    };
  },
});

/** Commission ledger with filters (promoter / status / date range). */
export const listAffiliateCommissions = query({
  args: {
    promoterId: v.optional(v.id("affiliatePromoters")),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("payable"),
        v.literal("paid"),
        v.literal("void"),
      ),
    ),
    fromTs: v.optional(v.number()),
    toTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    let rows: Doc<"affiliateCommissions">[];
    if (args.promoterId && args.status) {
      rows = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_promoter_status", (q) =>
          q.eq("promoterId", args.promoterId!).eq("status", args.status!),
        )
        .take(500);
    } else if (args.promoterId) {
      rows = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_promoter", (q) => q.eq("promoterId", args.promoterId!))
        .take(500);
    } else if (args.status) {
      rows = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_status_payableAt", (q) => q.eq("status", args.status!).gt("payableAt", 0))
        .take(500);
    } else {
      rows = await ctx.db
        .query("affiliateCommissions")
        .withIndex("by_createdAt")
        .order("desc")
        .take(500);
    }
    rows = rows
      .filter((r) => {
        if (args.fromTs !== undefined && r.createdAt < args.fromTs) return false;
        if (args.toTs !== undefined && r.createdAt > args.toTs) return false;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 300);

    // Enrich with the promoter code/name (admin view — user ids stay ids;
    // the admin Finance/Payments tabs are the only place student identity
    // is ever shown, and this ledger deliberately shows NO student detail,
    // keeping the affiliate system's privacy wall intact even for admins).
    const promoterIds = Array.from(new Set(rows.map((r) => r.promoterId)));
    const promoters = new Map<string, { name: string; code: string }>();
    for (const pid of promoterIds) {
      const p = await ctx.db.get(pid);
      if (p) promoters.set(pid, { name: p.name, code: p.code });
    }
    return rows.map((r) => ({
      _id: r._id,
      promoterId: r.promoterId,
      promoterName: promoters.get(r.promoterId)?.name ?? "unknown",
      promoterCode: promoters.get(r.promoterId)?.code ?? "?",
      source: r.source,
      grossAmountEtb: r.grossAmountEtb,
      commissionEtb: r.commissionEtb,
      status: r.status,
      payableAt: r.payableAt,
      paidAt: r.paidAt,
      voidReason: r.voidReason,
      createdAt: r.createdAt,
    }));
  },
});

/** All payouts (newest first) for the Payouts tab. */
export const listAffiliatePayouts = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const payouts = await ctx.db
      .query("affiliatePayouts")
      .withIndex("by_paidAt")
      .order("desc")
      .take(200);
    const out = [];
    for (const p of payouts) {
      const promoter = await ctx.db.get(p.promoterId);
      out.push({
        _id: p._id,
        promoterId: p.promoterId,
        promoterName: promoter?.name ?? "unknown",
        promoterCode: promoter?.code ?? "?",
        amountEtb: p.amountEtb,
        method: p.method,
        reference: p.reference,
        screenshotStorageId: p.screenshotStorageId,
        note: p.note,
        paidAt: p.paidAt,
      });
    }
    return out;
  },
});

/** Read the 8 AFFILIATE_* keys for the Settings section form. */
export const getAffiliateSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const keys = [
      "AFFILIATE_PROGRAM_ENABLED",
      "AFFILIATE_DEFAULT_COMMISSION_TYPE",
      "AFFILIATE_DEFAULT_COMMISSION_VALUE",
      "AFFILIATE_DEFAULT_SCOPE",
      "AFFILIATE_HOLD_HOURS",
      "AFFILIATE_ATTRIBUTION_DAYS",
      "AFFILIATE_MIN_PAYOUT_ETB",
      "AFFILIATE_INCLUDE_SCHOOL_SEATS",
    ];
    const values: Record<string, string> = {};
    for (const k of keys) values[k] = await getCfg(ctx, k);
    return values;
  },
});

/**
 * P6 — one-click "link health" check for a promoter: does the code
 * resolve RIGHT NOW? Useful whenever the program toggle or the reserved-
 * word rules change. Returns the exact failure reason when unhealthy.
 */
export const checkPromoterLinkHealth = query({
  args: { promoterId: v.id("affiliatePromoters") },
  handler: async (ctx, { promoterId }) => {
    await requireAdmin(ctx);
    const promoter = await ctx.db.get(promoterId);
    if (!promoter) return { healthy: false, reason: "Promoter not found." };
    if (!isValidCodeShape(promoter.code)) {
      return { healthy: false, reason: `Code "${promoter.code}" fails the 3–20 A–Z0–9 shape rule.` };
    }
    const err = validatePromoterCode(promoter.code);
    if (err) return { healthy: false, reason: err };
    const hit = await resolveCodeToPromoter(ctx, promoter.code);
    if (!hit) return { healthy: false, reason: "Code no longer resolves in the database." };
    if (!(await isProgramEnabled(ctx))) {
      return {
        healthy: false,
        reason: "Resolves correctly, but the program master toggle is OFF — links currently redirect to the landing page silently.",
      };
    }
    if (promoter.status !== "active") {
      return {
        healthy: false,
        reason: `Resolves, but the promoter is ${promoter.status} — no new attributions while paused/archived.`,
      };
    }
    return { healthy: true, reason: `OK — /${promoter.code} resolves and attributes right now.` };
  },
});

/**
 * P6 — per-promoter weekly summary numbers for the DM-ready text the
 * admin copies into Telegram/WhatsApp.
 */
export const getPromoterWeeklySummary = query({
  args: { promoterId: v.id("affiliatePromoters") },
  handler: async (ctx, { promoterId }) => {
    await requireAdmin(ctx);
    const promoter = await ctx.db.get(promoterId);
    if (!promoter) return null;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const sinceKey = addisDateKey(weekAgo);

    const stats = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_promoter_date", (q) =>
        q.eq("promoterId", promoterId).gte("date", sinceKey),
      )
      .take(60);
    const visits = stats.reduce((s, r) => s + r.visits, 0);

    const attributed = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_promoter_attributedAt", (q) =>
        q.eq("promoterId", promoterId).gte("attributedAt", weekAgo),
      )
      .take(500);
    const signups = attributed.length;

    const commissions = await ctx.db
      .query("affiliateCommissions")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoterId))
      .take(500);
    const weekCommissions = commissions.filter((c) => c.createdAt >= weekAgo && c.status !== "void");
    const paidUsers = new Set(weekCommissions.map((c) => c.userId)).size;
    const earned = money(weekCommissions.reduce((s, c) => s + c.commissionEtb, 0));

    const totals = await promoterLedgerTotals(ctx, promoterId);

    return {
      promoterName: promoter.name,
      code: promoter.code,
      weekVisits: visits,
      weekSignups: signups,
      weekPaidUsers: paidUsers,
      weekEarnedEtb: earned,
      lifetimeEarnedEtb: totals.earnedNonVoid,
      payableEtb: totals.payable,
    };
  },
});

// ===========================================================================
// PUBLIC: PARTNER STATS PAGE (no login — token-gated, AGGREGATE ONLY)
// ===========================================================================

/**
 * getPartnerStats — drives /partner/:secretToken. Token-gated (unguessable,
 * regenerable). Returns ONLY the promoter's own aggregates: NO student
 * names, emails, ids, or any identifying detail — not in any field, not
 * in any array. Many referred students are minors; the published Privacy
 * Policy forbids sharing student data with third parties.
 *
 * Works while the program is paused/disabled (the page shows a calm
 * notice; earnings and payouts remain visible). Returns null for an
 * unknown token — the route renders the generic NotFound with no hint
 * about token validity.
 */
export interface PartnerCampaignRow {
  campaign: string;
  visits: number;
  signups: number;
}

export interface PartnerStatsData {
  displayName: string;
  code: string;
  status: string;
  programEnabled: boolean;
  welcomeMessage: string | null;
  totals: {
    visits: number;
    signups: number;
    payingUsers: number;
    conversion: number;
    pendingEtb: number;
    payableEtb: number;
    paidEtb: number;
    lifetimeEarnedEtb: number;
    paidOutEtb: number;
    balanceEtb: number;
  };
  days: { date: string; label: string; visits: number; signups: number }[];
  campaigns: PartnerCampaignRow[];
  payouts: { paidAt: number; amountEtb: number; method: string }[];
  howItWorks: { holdHours: number; minPayoutEtb: number };
}

export const getPartnerStats = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<PartnerStatsData | null> => {
    return await ctx.runQuery(internal.affiliates.getPartnerStatsCore, args);
  },
});

export const getPartnerStatsCore = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<PartnerStatsData | null> => {
    const clean = (token || "").trim().toLowerCase();
    if (!clean || clean.length < 16) return null;
    const promoter = await ctx.db
      .query("affiliatePromoters")
      .withIndex("by_secretToken", (q) => q.eq("secretToken", clean))
      .unique();
    if (!promoter) return null;

    // Visits per day (last 30) + lifetime.
    const sinceKey = addisDateKey(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const stats = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_promoter_date", (q) =>
        q.eq("promoterId", promoter._id).gte("date", sinceKey),
      )
      .take(200);
    const visitsByDay = new Map<string, number>();
    for (const row of stats) visitsByDay.set(row.date, (visitsByDay.get(row.date) ?? 0) + row.visits);

    // Signups per day (last 30) + per-campaign.
    const cutoff30 = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const attributed = await ctx.db
      .query("affiliateAttributions")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoter._id))
      .take(500);
    const signupsByDay = new Map<string, number>();
    const campaignSignups = new Map<string, number>();
    for (const a of attributed) {
      if (a.attributedAt >= cutoff30) {
        const key = addisDateKey(a.attributedAt);
        signupsByDay.set(key, (signupsByDay.get(key) ?? 0) + 1);
      }
      campaignSignups.set(a.campaign, (campaignSignups.get(a.campaign) ?? 0) + 1);
    }

    const days: { date: string; label: string; visits: number; signups: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const ts = Date.now() - i * 24 * 60 * 60 * 1000;
      const key = addisDateKey(ts);
      days.push({
        date: key,
        label: new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        visits: visitsByDay.get(key) ?? 0,
        signups: signupsByDay.get(key) ?? 0,
      });
    }

    const campaignVisits = new Map<string, number>();
    const allStats = await ctx.db
      .query("affiliateDailyStats")
      .withIndex("by_promoter", (q) => q.eq("promoterId", promoter._id))
      .take(400);
    for (const row of allStats) {
      campaignVisits.set(row.campaign, (campaignVisits.get(row.campaign) ?? 0) + row.visits);
    }
    const campaigns = Array.from(
      new Set([...campaignVisits.keys(), ...campaignSignups.keys()]),
    ).map((c) => ({
      campaign: c || "(no campaign)",
      visits: campaignVisits.get(c) ?? 0,
      signups: campaignSignups.get(c) ?? 0,
    }));
    campaigns.sort((a, b) => b.visits - a.visits || b.signups - a.signups);

    const totals = await promoterLedgerTotals(ctx, promoter._id);

    const payouts = await ctx.db
      .query("affiliatePayouts")
      .withIndex("by_promoter_paidAt", (q) => q.eq("promoterId", promoter._id))
      .order("desc")
      .take(50);
    const paidOut = money(payouts.reduce((s, p) => s + p.amountEtb, 0));

    const holdHours = await getCfgNumber(ctx, "AFFILIATE_HOLD_HOURS", 72);
    const minPayout = await getCfgNumber(ctx, "AFFILIATE_MIN_PAYOUT_ETB", 200);

    // Campaigns with visits+signups — map into the shared shape.
    const campaignRows = campaigns.map((c) => ({
      campaign: c.campaign,
      visits: c.visits,
      signups: c.signups,
    }));

    return {
      displayName: promoter.name,
      code: promoter.code,
      status: promoter.status,
      programEnabled: await isProgramEnabled(ctx),
      welcomeMessage: promoter.welcomeMessage ?? null,
      totals: {
        visits: promoter.totalVisits ?? 0,
        signups: promoter.totalSignups ?? 0,
        payingUsers: totals.payingUsers,
        conversion: (promoter.totalVisits ?? 0) > 0 ? totals.payingUsers / (promoter.totalVisits ?? 1) : 0,
        pendingEtb: totals.pending,
        payableEtb: totals.payable,
        paidEtb: totals.paid,
        lifetimeEarnedEtb: totals.earnedNonVoid,
        paidOutEtb: paidOut,
        balanceEtb: money(totals.earnedNonVoid - paidOut),
      },
      days,
      campaigns: campaignRows,
      payouts: payouts.map((p) => ({
        paidAt: p.paidAt,
        amountEtb: p.amountEtb,
        method: p.method,
      })),
      howItWorks: {
        holdHours,
        minPayoutEtb: minPayout,
      },
    };
  },
});

// (The partner page + admin tab derive their prop types from useQuery —
// no exported type helper needed here.)
