// Referral + discount code + announcement system.
//
// Referrals: students generate a unique code, share it, and when their
// referral's first premium payment is approved, BOTH get bonus premium
// days (referrer: REFERRER_REWARD_DAYS, referee: REFEREE_REWARD_DAYS).
// Rewards are granted via the EXISTING setUserPremium mutation from
// adminCenter.ts — no duplicate grant logic.
//
// Discount codes: admin-creatable codes that reduce the expectedAmount
// on a manual payment submission. Applied at submission time, so the
// snapshot reflects the discounted price.
//
// Announcements: admin-creatable banners shown on the landing page.

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

const SUBSCRIPTION_MS = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Admin check helper (same pattern as manualPayments.ts)
// ---------------------------------------------------------------------------

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
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  return user;
}

async function getConfigValue(ctx: any, key: string): Promise<string> {
  const val = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key });
  if (val) return val;
  return CONFIG_DEFAULTS[key] ?? "";
}

async function getConfigNumber(ctx: any, key: string, fallback: number): Promise<number> {
  const val = await getConfigValue(ctx, key);
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ===========================================================================
// REFERRAL CODES
// ===========================================================================

// Generate a short unique referral code from the user's name/username.
function generateReferralCode(name: string | undefined, username: string | undefined): string {
  const base = (username || name || "friend")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 6) || "friend";
  const suffix = Math.random().toString(36).slice(2, 5);
  return `${base}${suffix}`;
}

// ---------------------------------------------------------------------------
// getMyReferralCode — auto-generate if not exists, return the code
// ---------------------------------------------------------------------------

export const getMyReferralCode = query({
  args: {},
  handler: async (ctx): Promise<{ code: string | null; enabled: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { code: null, enabled: false };

    const enabled = (await getConfigValue(ctx, "REFERRAL_PROGRAM_ENABLED")) === "true";
    if (!enabled) return { code: null, enabled: false };

    const existing = await ctx.db
      .query("referralCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return { code: existing.code, enabled: true };

    // Auto-generate — need user info for the base name. We use a mutation
    // via ctx since queries can't insert. Return null code with enabled=true
    // so the frontend knows to call getOrCreateReferralCode mutation.
    return { code: null, enabled: true };
  },
});

export const getOrCreateReferralCode = mutation({
  args: {},
  handler: async (ctx): Promise<{ code: string | null; enabled: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { code: null, enabled: false };

    const enabled = (await getConfigValue(ctx, "REFERRAL_PROGRAM_ENABLED")) === "true";
    if (!enabled) return { code: null, enabled: false };

    const existing = await ctx.db
      .query("referralCodes")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (existing) return { code: existing.code, enabled: true };

    // Auto-generate
    const user = await ctx.db.get(userId);
    const code = generateReferralCode(user?.name, undefined);
    await ctx.db.insert("referralCodes", { userId, code, createdAt: Date.now() });
    return { code, enabled: true };
  },
});

// ---------------------------------------------------------------------------
// getMyReferralStats — student's own referral stats
// ---------------------------------------------------------------------------

export const getMyReferralStats = query({
  args: {},
  handler: async (ctx): Promise<{
    signedUp: number;
    converted: number;
    rewarded: number;
    totalRewardDays: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { signedUp: 0, converted: 0, rewarded: 0, totalRewardDays: 0 };

    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerUserId", userId))
      .collect();

    const rewarded = referrals.filter((r) => r.status === "rewarded");
    const referrerDays = await getConfigNumber(ctx, "REFERRER_REWARD_DAYS", 7);

    return {
      signedUp: referrals.filter((r) => r.status === "signed_up").length + referrals.filter((r) => r.status !== "signed_up").length,
      converted: referrals.filter((r) => r.status === "converted" || r.status === "rewarded").length,
      rewarded: rewarded.length,
      totalRewardDays: rewarded.length * referrerDays,
    };
  },
});

// ---------------------------------------------------------------------------
// recordReferralSignup — called during sign-up flow with ?ref=CODE
// ---------------------------------------------------------------------------

export const recordReferralSignup = mutation({
  args: { referralCode: v.string() },
  handler: async (ctx, { referralCode }): Promise<{ ok: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { ok: false };

    // Look up the referral code
    const refCode = await ctx.db
      .query("referralCodes")
      .withIndex("by_code", (q) => q.eq("code", referralCode.trim().toLowerCase()))
      .first();
    if (!refCode) return { ok: false }; // Invalid code — fail silently

    // Block self-referral
    if (refCode.userId === userId) return { ok: false };

    // Check if this user already has a referral record (prevent re-attribution)
    const existing = await ctx.db
      .query("referrals")
      .withIndex("by_referred", (q) => q.eq("referredUserId", userId))
      .first();
    if (existing) return { ok: false }; // Already attributed

    // Create the referral record
    await ctx.db.insert("referrals", {
      referrerUserId: refCode.userId,
      referredUserId: userId,
      status: "signed_up",
      signedUpAt: Date.now(),
    });

    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// getReferralLeaderboard — top referrers by conversions
// ---------------------------------------------------------------------------

export const getReferralLeaderboard = query({
  args: {},
  handler: async (ctx): Promise<
    Array<{ referrerName: string; converted: number; rewarded: number }>
  > => {
    const allReferrals = await ctx.db
      .query("referrals")
      .withIndex("by_status", (q) => q.eq("status", "rewarded"))
      .collect();

    // Group by referrer
    const byReferrer = new Map<string, number>();
    for (const r of allReferrals) {
      byReferrer.set(r.referrerUserId, (byReferrer.get(r.referrerUserId) ?? 0) + 1);
    }

    // Get names + sort
    const entries: Array<{ referrerName: string; converted: number; rewarded: number }> = [];
    for (const [referrerId, count] of byReferrer) {
      const user = await ctx.db.get(referrerId as Id<"users">);
      const name = user?.name || user?.email?.split("@")[0] || "Anonymous";
      // Show only first name for privacy
      const firstName = name.split(" ")[0] || name;
      entries.push({ referrerName: firstName, converted: count, rewarded: count });
    }
    entries.sort((a, b) => b.converted - a.converted);
    return entries.slice(0, 20);
  },
});

// ---------------------------------------------------------------------------
// Internal: process referral rewards when a payment is approved.
// Called from manualPayments.approveSubmission / approveFromSms.
// ---------------------------------------------------------------------------

export const processReferralReward = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ rewarded: boolean }> => {
    // Check if this user was referred
    const referral = await ctx.db
      .query("referrals")
      .withIndex("by_referred", (q) => q.eq("referredUserId", userId))
      .first();
    if (!referral) return { rewarded: false };
    if (referral.status !== "signed_up") return { rewarded: false }; // Already converted/rewarded

    // Mark as converted
    await ctx.db.patch(referral._id, {
      status: "converted",
      convertedAt: Date.now(),
    });

    // Grant rewards via EXISTING setUserPremium
    const referrerDays = await getConfigNumber(ctx, "REFERRER_REWARD_DAYS", 7);
    const refereeDays = await getConfigNumber(ctx, "REFEREE_REWARD_DAYS", 3);

    // Grant referrer their bonus days
    try {
      await ctx.runMutation(api.adminCenter.setUserPremium, {
        userId: referral.referrerUserId,
        action: "activate",
        durationMs: referrerDays * 24 * 60 * 60 * 1000,
      });
    } catch {
      // Non-fatal — referrer might not exist anymore
    }

    // Grant referee their bonus days (stacked on top of what they just paid for)
    if (refereeDays > 0) {
      try {
        await ctx.runMutation(api.adminCenter.setUserPremium, {
          userId: referral.referredUserId,
          action: "activate",
          durationMs: refereeDays * 24 * 60 * 60 * 1000,
        });
      } catch {
        // Non-fatal
      }
    }

    // Mark as rewarded
    await ctx.db.patch(referral._id, {
      status: "rewarded",
      rewardedAt: Date.now(),
    });

    // Award achievements via the EXISTING achievements system
    try {
      await ctx.runMutation(internal.achievements.checkAndAward, {
        userId: referral.referrerUserId,
      });
    } catch {
      // Non-fatal
    }

    return { rewarded: true };
  },
});

// ===========================================================================
// DISCOUNT CODES
// ===========================================================================

// ---------------------------------------------------------------------------
// validateDiscountCode — student checks if a code is valid before submitting
// ---------------------------------------------------------------------------

export const validateDiscountCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<{
    valid: boolean;
    reason?: string;
    discountType?: "percent" | "fixed_etb";
    value?: number;
    adjustedAmount?: number;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { valid: false, reason: "Sign in required." };

    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return { valid: false, reason: "Enter a code." };

    const discount = await ctx.db
      .query("discountCodes")
      .withIndex("by_code", (q) => q.eq("code", cleanCode))
      .first();

    if (!discount) return { valid: false, reason: "Code not found." };
    if (!discount.isActive) return { valid: false, reason: "This code is no longer active." };
    if (discount.expiresAt && discount.expiresAt < Date.now()) {
      return { valid: false, reason: "This code has expired." };
    }
    if (discount.maxUses !== undefined && discount.usedCount >= discount.maxUses) {
      return { valid: false, reason: "This code has reached its usage limit." };
    }

    // Check if this user already redeemed this code
    const existing = await ctx.db
      .query("discountRedemptions")
      .withIndex("by_code_user", (q) =>
        q.eq("codeId", discount._id).eq("userId", userId),
      )
      .first();
    if (existing) return { valid: false, reason: "You've already used this code." };

    // Calculate adjusted amount
    const priceEtb = await getConfigNumber(ctx, "PREMIUM_PRICE_ETB", 500);
    let adjustedAmount = priceEtb;
    if (discount.discountType === "percent") {
      adjustedAmount = Math.max(0, Math.round(priceEtb * (1 - discount.value / 100)));
    } else {
      adjustedAmount = Math.max(0, priceEtb - discount.value);
    }

    return {
      valid: true,
      discountType: discount.discountType,
      value: discount.value,
      adjustedAmount,
    };
  },
});

// ---------------------------------------------------------------------------
// redeemDiscountCode — called inside submitPaymentProof to apply the discount
// ---------------------------------------------------------------------------

export const redeemDiscountCode = internalMutation({
  args: {
    code: v.string(),
    userId: v.id("users"),
    submissionId: v.id("manualPaymentSubmissions"),
  },
  handler: async (ctx, { code, userId, submissionId }): Promise<{ ok: boolean; adjustedAmount: number }> => {
    const cleanCode = code.trim().toUpperCase();
    const discount = await ctx.db
      .query("discountCodes")
      .withIndex("by_code", (q) => q.eq("code", cleanCode))
      .first();
    if (!discount || !discount.isActive) return { ok: false, adjustedAmount: 0 };
    if (discount.expiresAt && discount.expiresAt < Date.now()) return { ok: false, adjustedAmount: 0 };
    if (discount.maxUses !== undefined && discount.usedCount >= discount.maxUses) {
      return { ok: false, adjustedAmount: 0 };
    }

    // Check if already redeemed by this user
    const existing = await ctx.db
      .query("discountRedemptions")
      .withIndex("by_code_user", (q) =>
        q.eq("codeId", discount._id).eq("userId", userId),
      )
      .first();
    if (existing) return { ok: false, adjustedAmount: 0 };

    // Calculate adjusted amount
    const priceEtb = await getConfigNumber(ctx, "PREMIUM_PRICE_ETB", 500);
    let adjustedAmount = priceEtb;
    if (discount.discountType === "percent") {
      adjustedAmount = Math.max(0, Math.round(priceEtb * (1 - discount.value / 100)));
    } else {
      adjustedAmount = Math.max(0, priceEtb - discount.value);
    }

    // Increment usedCount
    await ctx.db.patch(discount._id, { usedCount: discount.usedCount + 1 });

    // Record the redemption
    await ctx.db.insert("discountRedemptions", {
      codeId: discount._id,
      userId,
      redeemedAt: Date.now(),
      submissionId,
    });

    return { ok: true, adjustedAmount };
  },
});

// ---------------------------------------------------------------------------
// Admin CRUD for discount codes
// ---------------------------------------------------------------------------

export const createDiscountCode = mutation({
  args: {
    code: v.string(),
    discountType: v.union(v.literal("percent"), v.literal("fixed_etb")),
    value: v.number(),
    maxUses: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx);
    const cleanCode = args.code.trim().toUpperCase();
    if (cleanCode.length < 3) {
      throw new ConvexError({ message: "Code must be at least 3 characters.", code: "invalid" });
    }
    // Check if code already exists
    const existing = await ctx.db
      .query("discountCodes")
      .withIndex("by_code", (q) => q.eq("code", cleanCode))
      .first();
    if (existing) {
      throw new ConvexError({ message: "A code with this name already exists.", code: "duplicate" });
    }
    await ctx.db.insert("discountCodes", {
      code: cleanCode,
      discountType: args.discountType,
      value: args.value,
      maxUses: args.maxUses,
      usedCount: 0,
      expiresAt: args.expiresAt,
      isActive: true,
      createdBy: admin._id,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

export const listDiscountCodes = query({
  args: {},
  handler: async (ctx): Promise<Doc<"discountCodes">[]> => {
    await requireAdmin(ctx);
    return await ctx.db.query("discountCodes").order("desc").take(100);
  },
});

export const deactivateDiscountCode = mutation({
  args: { codeId: v.id("discountCodes") },
  handler: async (ctx, { codeId }): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx);
    await ctx.db.patch(codeId, { isActive: false });
    return { ok: true };
  },
});

// ===========================================================================
// ANNOUNCEMENTS
// ===========================================================================

export const getActiveAnnouncements = query({
  args: {},
  handler: async (ctx): Promise<Doc<"announcements">[]> => {
    const now = Date.now();
    const all = await ctx.db
      .query("announcements")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
    return all.filter((a) => !a.expiresAt || a.expiresAt > now);
  },
});

export const createAnnouncement = mutation({
  args: {
    title: v.string(),
    body: v.string(),
    type: v.union(v.literal("info"), v.literal("feature"), v.literal("event"), v.literal("referral")),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const admin = await requireAdmin(ctx);
    await ctx.db.insert("announcements", {
      title: args.title.trim(),
      body: args.body.trim(),
      type: args.type,
      isActive: true,
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
      createdBy: admin._id,
    });
    return { ok: true };
  },
});

export const listAnnouncements = query({
  args: {},
  handler: async (ctx): Promise<Doc<"announcements">[]> => {
    await requireAdmin(ctx);
    return await ctx.db.query("announcements").order("desc").take(100);
  },
});

export const deactivateAnnouncement = mutation({
  args: { announcementId: v.id("announcements") },
  handler: async (ctx, { announcementId }): Promise<{ ok: boolean }> => {
    await requireAdmin(ctx);
    await ctx.db.patch(announcementId, { isActive: false });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Admin referral stats — for the Marketing tab dashboard
// ---------------------------------------------------------------------------

export const getAdminReferralStats = query({
  args: {},
  handler: async (ctx): Promise<{
    totalSignups: number;
    totalConversions: number;
    totalRewarded: number;
    conversionRate: number;
    topReferrers: Array<{ referrerName: string; converted: number }>;
  }> => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("referrals").collect();
    const totalSignups = all.length;
    const conversions = all.filter((r) => r.status === "converted" || r.status === "rewarded").length;
    const rewarded = all.filter((r) => r.status === "rewarded").length;
    const conversionRate = totalSignups > 0 ? Math.round((conversions / totalSignups) * 100) : 0;

    // Top referrers
    const byReferrer = new Map<string, number>();
    for (const r of all) {
      if (r.status === "converted" || r.status === "rewarded") {
        byReferrer.set(r.referrerUserId, (byReferrer.get(r.referrerUserId) ?? 0) + 1);
      }
    }
    const topReferrers: Array<{ referrerName: string; converted: number }> = [];
    for (const [referrerId, count] of byReferrer) {
      const user = await ctx.db.get(referrerId as Id<"users">);
      const name = user?.name?.split(" ")[0] || "Anonymous";
      topReferrers.push({ referrerName: name, converted: count });
    }
    topReferrers.sort((a, b) => b.converted - a.converted);

    return {
      totalSignups,
      totalConversions: conversions,
      totalRewarded: rewarded,
      conversionRate,
      topReferrers: topReferrers.slice(0, 10),
    };
  },
});
