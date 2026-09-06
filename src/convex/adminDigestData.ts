// Internal queries used by the admin weekly digest action. These MUST
// live in a non-"use node" module because Convex only allows actions
// (not queries) in the Node.js runtime.
//
// All queries here skip the admin gate since they're called from a cron
// context (no user). The data they return is the same as the admin-gated
// equivalents — honest numbers, no fabrication.

import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const listAllUsers = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Take 1000 — covers the realistic user base. If we ever exceed that,
    // we'll add a paginated helper, but for now this is the same cap the
    // admin dashboard uses (300) bumped up.
    const users = await ctx.db.query("users").take(1000);
    return users.map((u) => ({
      _id: u._id,
      _creationTime: u._creationTime,
    }));
  },
});

export const listAllManualSubmissions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db.query("manualPaymentSubmissions").collect();
    return subs.map((s) => ({
      status: s.status,
      expectedAmount: s.expectedAmount,
      submittedAt: s.submittedAt,
      reviewedAt: s.reviewedAt,
      slaBreached: s.slaBreached,
    }));
  },
});

export const listAllReferrals = internalQuery({
  args: {},
  handler: async (ctx) => {
    const refs = await ctx.db.query("referrals").collect();
    return refs.map((r) => ({
      status: r.status,
      signedUpAt: r.signedUpAt,
      convertedAt: r.convertedAt,
    }));
  },
});

export const listAllSubscriptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const subs = await ctx.db.query("subscriptions").collect();
    return subs.map((s) => ({ status: s.status }));
  },
});

export const listRecentSessions = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    // by_user_startedAt is composite with userId first, so we can't
    // range-query on startedAt without a userId filter. Collect all,
    // filter in-memory. Caps at 2000 rows to keep the action cheap.
    const sessions = await ctx.db.query("studySessions").take(2000);
    return sessions
      .filter((s) => s.startedAt >= since)
      .map((s) => ({ userId: s.userId }));
  },
});

export const listRecentXp = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    // by_user_createdAt is composite with userId first — same situation.
    const rows = await ctx.db.query("xpLedger").take(2000);
    return rows
      .filter((r) => r.createdAt >= since)
      .map((r) => ({ userId: r.userId }));
  },
});

export const listRecentQuizAttempts = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    // No by_user_completedAt index exists — collect all then filter
    // in-memory, matching the established pattern in recap.getRecentQuizAttempts.
    const attempts = await ctx.db.query("quizAttempts").take(2000);
    return attempts
      .filter((a) => a.completedAt >= since)
      .map((a) => ({ userId: a.userId }));
  },
});

export const countContentItems = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("contentItems").collect().then((items) => items.length);
  },
});
