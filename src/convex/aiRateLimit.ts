// aiRateLimit — the GLOBAL AI rate orchestrator.
//
// The old conversion guard capped the platform at 2 concurrent pipelines
// and paced every pipeline with fixed sleeps. That kept the free AI tier
// alive — and made the whole library drain at a crawl, so students kept
// seeing "Waiting for a free conversion slot".
//
// This module replaces the crude slot cap as the true rate guard:
//
//   1. acquireAiPermit — a distributed, staggered time-slot scheduler.
//      Every AI call on the platform reserves its slot through here.
//      Slots are handed out exactly `interval` ms apart PER LANE no matter
//      how many tabs or pipelines call at once (Convex serializes the
//      mutation, so reservations can never collide). Result: 8 pipelines
//      in parallel still average ≈20 Groq calls/min — safely under the
//      free tier's 30/min ceiling. Parallelism and rate safety are finally
//      decoupled.
//
//   2. reportAiRateLimitHit — the shared circuit breaker. When Groq ever
//      answers 429, the caller reports it here and EVERY pipeline on that
//      lane pauses until `cooldownUntil` (Groq's error message even states
//      the exact cooldown — we honor it). No more per-paper 429 crashes:
//      the platform absorbs the hit together and keeps converting.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Minimum spacing between AI calls per lane, platform-wide. Lanes are
 * PER MODEL because Groq meters each model's rate independently on the
 * same key — three models = three independent token budgets, used in
 * parallel with automatic failover (see callGroqWithRetry).
 *
 * Probed live against this account: gpt-oss-120b is metered at 8,000
 * TOKENS per minute (not just requests) — one chunk call can cost 4-10k
 * tokens, so request spacing alone can't guarantee compliance. The
 * intervals below start reasonable and the shared 429 circuit breaker
 * self-tunes: whenever the provider answers 429, every pipeline on that
 * model's lane pauses for the exact cooldown the provider requests.
 */
const PERMIT_INTERVAL_MS: Record<string, number> = {
  "groq:openai/gpt-oss-120b": 20_000,
  "groq:openai/gpt-oss-20b": 15_000,
  "groq:qwen/qwen3.8-27b": 12_000,
  "groq:llama-3.3-70b-versatile": 15_000,
  "groq:llama-3.1-8b-instant": 8_000,
  // Legacy generic lanes (still honored if referenced anywhere).
  "groq-text": 20_000,
  "groq-vision": 12_000,
};

/** Fallback interval for unknown lanes. */
const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Reserve the next time slot on a lane. Returns how long the caller must
 * wait before firing its request. Reservations stack: if 5 pipelines are
 * already queued on the lane, the 6th gets a slot 5 × interval out — the
 * wait IS the pacing, and it is exactly what lets concurrency scale
 * without ever tripping the provider.
 */
export const acquireAiPermit = internalMutation({
  args: { lane: v.string() },
  handler: async (ctx, args): Promise<{ waitMs: number }> => {
    const interval = PERMIT_INTERVAL_MS[args.lane] ?? DEFAULT_INTERVAL_MS;
    const now = Date.now();

    const row = await ctx.db
      .query("aiRateLimit")
      .withIndex("by_key", (q) => q.eq("key", args.lane))
      .unique();

    if (!row) {
      // First caller on this lane ever — it goes through immediately.
      await ctx.db.insert("aiRateLimit", {
        key: args.lane,
        lastPermitAt: now,
      });
      return { waitMs: 0 };
    }

    // The next free slot: after the last reservation (which may itself be
    // in the future — that's the queue), after any 429 cooldown, and never
    // in the past. An idle platform catches up instantly (no burst: the
    // next N callers still stagger out from `now`).
    const next = Math.max(
      row.lastPermitAt + interval,
      row.cooldownUntil ?? 0,
      now,
    );
    await ctx.db.patch(row._id, { lastPermitAt: next });
    return { waitMs: Math.max(0, next - now) };
  },
});

/**
 * Shared 429 circuit breaker. Called by the Groq retry wrapper the moment
 * the provider answers 429, with the cooldown Groq itself requested.
 * Every subsequent acquireAiPermit on this lane then waits it out — so a
 * rate-limit spike pauses the platform once, briefly, instead of failing
 * one paper after another.
 */
export const reportAiRateLimitHit = internalMutation({
  args: { lane: v.string(), backoffMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db
      .query("aiRateLimit")
      .withIndex("by_key", (q) => q.eq("key", args.lane))
      .unique();
    const cooldownUntil = Math.max(row?.cooldownUntil ?? 0, now + (args.backoffMs ?? 30_000));
    if (row) {
      await ctx.db.patch(row._id, {
        cooldownUntil,
        hits: (row.hits ?? 0) + 1,
      });
    } else {
      await ctx.db.insert("aiRateLimit", {
        key: args.lane,
        lastPermitAt: now,
        cooldownUntil,
        hits: 1,
      });
    }
    return { cooldownUntil };
  },
});
