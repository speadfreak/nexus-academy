// Fraud-pattern detection — surfaces suspicious patterns for HUMAN REVIEW
// only. Never auto-blocks, never auto-rejects. Uses ONLY signals already
// present in existing data (timestamps, referral codes, transaction
// references). No new device fingerprinting, no IP tracking, no invasive
// identification — privacy-respecting detection over maximal surveillance,
// consistent with this platform's "always allow manual review, never
// auto-reject" philosophy.
//
// PATTERNS DETECTED:
//   1. Referral farming — more than 5 signups from the same referral code
//      within 1 hour. Possible fake-account farming.
//   2. Duplicate transaction references — the same transactionRef value
//      submitted by different users. Possible reference-copying fraud.
//   3. Rapid repeated submissions — the same user submitting 3+ manual
//      payment submissions within 1 hour. Possible spam / testing.
//
// Admin-gated: non-admins get null. Returns arrays of flagged items,
// each with enough context for an admin to investigate manually.

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { isAdmin } from "./admin";
import type { Id } from "./_generated/dataModel";

// ── Return shapes ───────────────────────────────────────────────────────

export interface ReferralFarmFlag {
  referrerUserId: Id<"users">;
  referrerName: string;
  referrerEmail: string | null;
  referralCode: string;
  signupCount: number;
  windowStart: number;
  windowEnd: number;
  signupUserIds: Id<"users">[];
  severity: "high" | "medium" | "low";
}

export interface DuplicateTransactionRefFlag {
  transactionRef: string;
  submitterCount: number;
  submitterUserIds: Id<"users">[];
  submitterNames: string[];
  submittedAt: number[];
  severity: "high" | "medium" | "low";
}

export interface RapidSubmissionsFlag {
  userId: Id<"users">;
  userName: string;
  userEmail: string | null;
  submissionCount: number;
  windowStart: number;
  windowEnd: number;
  submissionIds: Id<"manualPaymentSubmissions">[];
  severity: "high" | "medium" | "low";
}

export interface FraudPatternReport {
  referralFarms: ReferralFarmFlag[];
  duplicateRefs: DuplicateTransactionRefFlag[];
  rapidSubmissions: RapidSubmissionsFlag[];
  totalFlags: number;
  generatedAt: number;
  // Per-pattern severity counts for the admin UI header.
  counts: {
    referralFarms: { high: number; medium: number; low: number };
    duplicateRefs: { high: number; medium: number; low: number };
    rapidSubmissions: { high: number; medium: number; low: number };
  };
}

// ── Detection thresholds ───────────────────────────────────────────────
// Tuned conservatively — false positives are OK (admin reviews), but
// we don't want to flag normal behavior. These match the spec:
//   - Referral farming: >5 signups from the same code within 1 hour.
//   - Duplicate refs: same transactionRef submitted by >=2 different users.
//   - Rapid submissions: same user submitting >=3 manual payments within
//     1 hour.

const REFERRAL_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const REFERRAL_THRESHOLD = 5; // more than 5 in the window
const DUPLICATE_REF_THRESHOLD = 2; // same ref from >=2 different users
const RAPID_SUBMISSION_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RAPID_SUBMISSION_THRESHOLD = 3; // 3+ from same user in window

// ── Query ───────────────────────────────────────────────────────────────

export const getFraudPatternReport = query({
  args: {},
  handler: async (ctx): Promise<FraudPatternReport | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!(await isAdmin(ctx, user))) return null;

    const [referrals, manualSubmissions, users] = await Promise.all([
      ctx.db.query("referrals").collect(),
      ctx.db.query("manualPaymentSubmissions").collect(),
      ctx.db.query("users").take(1000),
    ]);

    const userById = new Map(users.map((u) => [u._id, u]));

    // ── 1. Referral farming — group by referrerUserId, look for any
    // 1-hour window with > REFERRAL_THRESHOLD signups.
    const referralsByReferrer = new Map<
      Id<"users">,
      Array<{ signedUpAt: number; referredUserId: Id<"users"> }>
    >();
    for (const r of referrals) {
      const arr = referralsByReferrer.get(r.referrerUserId) ?? [];
      arr.push({ signedUpAt: r.signedUpAt, referredUserId: r.referredUserId });
      referralsByReferrer.set(r.referrerUserId, arr);
    }

    const referralFarms: ReferralFarmFlag[] = [];
    for (const [referrerId, signups] of referralsByReferrer.entries()) {
      if (signups.length <= REFERRAL_THRESHOLD) continue;
      // Sort by signedUpAt + slide a 1-hour window.
      const sorted = signups.sort((a, b) => a.signedUpAt - b.signedUpAt);
      for (let i = 0; i < sorted.length; i++) {
        const windowStart = sorted[i]!.signedUpAt;
        const windowEnd = windowStart + REFERRAL_WINDOW_MS;
        const inWindow = sorted.filter((s) => s.signedUpAt >= windowStart && s.signedUpAt < windowEnd);
        if (inWindow.length > REFERRAL_THRESHOLD) {
          const referrer = userById.get(referrerId);
          // Find the referral code used — look it up via the referrer's
          // referral info. We don't store the code directly on the
          // referral row, but the marketing module does. For now we
          // surface the referrer's user ID + name; the admin can look
          // up the code from the marketing tab.
          const severity: "high" | "medium" | "low" =
            inWindow.length >= 10 ? "high" : inWindow.length >= 7 ? "medium" : "low";
          referralFarms.push({
            referrerUserId: referrerId,
            referrerName: referrer?.name ?? referrer?.email ?? "Unknown",
            referrerEmail: referrer?.email ?? null,
            referralCode: "(see marketing tab)", // we don't denormalize the code here
            signupCount: inWindow.length,
            windowStart,
            windowEnd,
            signupUserIds: inWindow.map((s) => s.referredUserId),
            severity,
          });
          // Only report the FIRST qualifying window per referrer to avoid
          // duplicates — the admin can investigate further from there.
          break;
        }
      }
    }

    // ── 2. Duplicate transaction references — group by transactionRef,
    // flag any ref submitted by >=2 DIFFERENT users.
    const refsByValue = new Map<
      string,
      Array<{ userId: Id<"users">; submissionId: Id<"manualPaymentSubmissions">; submittedAt: number }>
    >();
    for (const sub of manualSubmissions) {
      const ref = sub.transactionRef.trim().toLowerCase();
      if (!ref) continue; // skip empty refs
      const arr = refsByValue.get(ref) ?? [];
      arr.push({ userId: sub.userId, submissionId: sub._id, submittedAt: sub.submittedAt });
      refsByValue.set(ref, arr);
    }

    const duplicateRefs: DuplicateTransactionRefFlag[] = [];
    for (const [refValue, submissions] of refsByValue.entries()) {
      const distinctUsers = new Set(submissions.map((s) => s.userId));
      if (distinctUsers.size < DUPLICATE_REF_THRESHOLD) continue;
      // Skip very generic refs like "0", "1", "N/A" that are likely just
      // placeholder values rather than real duplicates.
      if (refValue.length < 3) continue;
      if (["n/a", "na", "none", "0", "test"].includes(refValue)) continue;
      const usersList = [...distinctUsers];
      const submitterNames = usersList.map((uid) => {
        const u = userById.get(uid);
        return u?.name ?? u?.email ?? "Unknown";
      });
      const severity: "high" | "medium" | "low" =
        distinctUsers.size >= 4 ? "high" : distinctUsers.size === 3 ? "medium" : "low";
      duplicateRefs.push({
        transactionRef: refValue,
        submitterCount: distinctUsers.size,
        submitterUserIds: usersList,
        submitterNames,
        submittedAt: submissions.map((s) => s.submittedAt),
        severity,
      });
    }
    // Sort by severity (high first), then by submitter count desc.
    const severityRank = { high: 0, medium: 1, low: 2 };
    duplicateRefs.sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.submitterCount - a.submitterCount,
    );

    // ── 3. Rapid repeated submissions — group by userId, look for any
    // 1-hour window with >= RAPID_SUBMISSION_THRESHOLD submissions.
    const submissionsByUser = new Map<
      Id<"users">,
      Array<{ submissionId: Id<"manualPaymentSubmissions">; submittedAt: number }>
    >();
    for (const sub of manualSubmissions) {
      const arr = submissionsByUser.get(sub.userId) ?? [];
      arr.push({ submissionId: sub._id, submittedAt: sub.submittedAt });
      submissionsByUser.set(sub.userId, arr);
    }

    const rapidSubmissions: RapidSubmissionsFlag[] = [];
    for (const [uid, subs] of submissionsByUser.entries()) {
      if (subs.length < RAPID_SUBMISSION_THRESHOLD) continue;
      const sorted = subs.sort((a, b) => a.submittedAt - b.submittedAt);
      for (let i = 0; i < sorted.length; i++) {
        const windowStart = sorted[i]!.submittedAt;
        const windowEnd = windowStart + RAPID_SUBMISSION_WINDOW_MS;
        const inWindow = sorted.filter(
          (s) => s.submittedAt >= windowStart && s.submittedAt < windowEnd,
        );
        if (inWindow.length >= RAPID_SUBMISSION_THRESHOLD) {
          const u = userById.get(uid);
          const severity: "high" | "medium" | "low" =
            inWindow.length >= 6 ? "high" : inWindow.length >= 4 ? "medium" : "low";
          rapidSubmissions.push({
            userId: uid,
            userName: u?.name ?? u?.email ?? "Unknown",
            userEmail: u?.email ?? null,
            submissionCount: inWindow.length,
            windowStart,
            windowEnd,
            submissionIds: inWindow.map((s) => s.submissionId),
            severity,
          });
          // Only report the FIRST qualifying window per user.
          break;
        }
      }
    }
    rapidSubmissions.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || b.submissionCount - a.submissionCount);

    // ── Aggregate ──────────────────────────────────────────────────
    const countBy = (arr: { severity: "high" | "medium" | "low" }[]) => ({
      high: arr.filter((x) => x.severity === "high").length,
      medium: arr.filter((x) => x.severity === "medium").length,
      low: arr.filter((x) => x.severity === "low").length,
    });

    return {
      referralFarms,
      duplicateRefs,
      rapidSubmissions,
      totalFlags: referralFarms.length + duplicateRefs.length + rapidSubmissions.length,
      generatedAt: Date.now(),
      counts: {
        referralFarms: countBy(referralFarms),
        duplicateRefs: countBy(duplicateRefs),
        rapidSubmissions: countBy(rapidSubmissions),
      },
    };
  },
});

