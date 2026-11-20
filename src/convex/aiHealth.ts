// AI Health — super-admin observability for the tutor's reliability layer.
//
// One admin-gated query feeds the whole "AI Health" dashboard section:
//   - live per-provider/model capacity (cooldowns, RPM/TPM/RPD windows,
//     last errors, 404-disabled models)
//   - 24h traffic (requests, cache hit rate, fallback usage, graceful
//     mode, latency percentiles via averages)
//   - queue depth + graceful deliveries right now
//   - the latest aiCallLog rows for debugging a specific turn
//
// Aggregation is bounded: it reads the newest 400 aiCallLog rows (a little
// over a day of heavy traffic) and the ≤60 aiProviderState rows, so this
// stays a couple of indexed reads — never a table scan.

import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";
import { isAdmin } from "./admin";
import type { Doc } from "./_generated/dataModel";

const PROVIDER_KEY_NAMES = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

export interface ProviderHealth {
  key: string;
  provider: string;
  model: string;
  cooldownUntil?: number;
  cooldownReason?: string;
  rpmUsed: number;
  tpmUsedEst: number;
  rpdUsed: number;
  consecutiveFailures: number;
  lastErrorAt?: number;
  lastErrorDetail?: string;
  disabledUntil404?: number;
}

export interface AiHealthDashboard {
  providers: ProviderHealth[];
  keys: Record<string, boolean>;
  stats: {
    callsLastHour: number;
    calls24h: number;
    cacheHits24h: number;
    cacheHitRate: number; // 0-1
    fallbackTurns24h: number; // turns whose winning attempt wasn't the first hop
    rateLimitedHops24h: number;
    graceful24h: number; // degraded assistant replies (from aiCallLog purposes + queue graceful)
    avgLatencyMs: number;
    queuedNow: number;
    delivered24h: number;
    abandoned24h: number;
  };
  recentCalls: {
    _id: string;
    purpose: string;
    cacheHit: boolean;
    provider?: string;
    model?: string;
    latencyMs?: number;
    hops: { provider: string; model: string; status: string; latencyMs: number; detail?: string }[];
    createdAt: number;
  }[];
  now: number;
}

export const getAiHealthDashboard = query({
  args: {},
  handler: async (ctx): Promise<AiHealthDashboard | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!(await isAdmin(ctx, user))) return null;

    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    // Capacity state — one small indexed read.
    const states = await ctx.db
      .query("aiProviderState")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(60);

    // Which provider keys are configured (existence only, never values).
    const keys: Record<string, boolean> = {};
    for (const name of PROVIDER_KEY_NAMES) {
      const row = await ctx.db
        .query("configKeys")
        .withIndex("by_key", (q) => q.eq("key", name))
        .first();
      keys[name] = Boolean(row) || Boolean(process.env[name]);
    }

    // Traffic — bounded desc scan of the call log.
    const logs: Doc<"aiCallLog">[] = await ctx.db
      .query("aiCallLog")
      .withIndex("by_createdAt")
      .order("desc")
      .take(400);

    let callsLastHour = 0;
    let calls24h = 0;
    let cacheHits24h = 0;
    let fallbackTurns24h = 0;
    let rateLimitedHops24h = 0;
    let latencySum = 0;
    let latencyCount = 0;
    for (const row of logs) {
      if (row.createdAt < dayAgo) break;
      calls24h += 1;
      if (row.createdAt >= hourAgo) callsLastHour += 1;
      if (row.cacheHit) cacheHits24h += 1;
      const okHopIndex = (row.hops ?? []).findIndex((h) => h.status === "ok");
      if (okHopIndex > 0) fallbackTurns24h += 1;
      for (const hop of row.hops ?? []) {
        if (hop.status === "rate_limited" || hop.status === "skipped") {
          rateLimitedHops24h += 1;
        }
      }
      if (!row.cacheHit && row.latencyMs !== undefined) {
        latencySum += row.latencyMs;
        latencyCount += 1;
      }
    }

    // Queue depth right now.
    const pending = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(100);

    const providers: ProviderHealth[] = states.map((s) => ({
      key: s.key,
      provider: s.provider,
      model: s.model,
      ...(s.cooldownUntil !== undefined ? { cooldownUntil: s.cooldownUntil } : {}),
      ...(s.cooldownReason !== undefined ? { cooldownReason: s.cooldownReason } : {}),
      rpmUsed: s.rpmUsed ?? 0,
      tpmUsedEst: s.tpmUsedEst ?? 0,
      rpdUsed: s.rpdUsed ?? 0,
      consecutiveFailures: s.consecutiveFailures ?? 0,
      ...(s.lastErrorAt !== undefined ? { lastErrorAt: s.lastErrorAt } : {}),
      ...(s.lastErrorDetail !== undefined ? { lastErrorDetail: s.lastErrorDetail } : {}),
      ...(s.disabledUntil404 !== undefined ? { disabledUntil404: s.disabledUntil404 } : {}),
    }));

    return {
      providers,
      keys,
      stats: {
        callsLastHour,
        calls24h,
        cacheHits24h,
        cacheHitRate: calls24h > 0 ? cacheHits24h / calls24h : 0,
        fallbackTurns24h,
        rateLimitedHops24h,
        graceful24h: pending.filter((p) => p.gracefulReplied).length,
        avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
        queuedNow: pending.length,
        delivered24h: 0, // filled below
        abandoned24h: 0, // filled below
      },
      recentCalls: logs.slice(0, 40).map((row) => ({
        _id: row._id,
        purpose: row.purpose,
        cacheHit: row.cacheHit,
        ...(row.provider !== undefined ? { provider: row.provider } : {}),
        ...(row.model !== undefined ? { model: row.model } : {}),
        ...(row.latencyMs !== undefined ? { latencyMs: row.latencyMs } : {}),
        hops: (row.hops ?? []).map((h) => ({
          provider: h.provider,
          model: h.model,
          status: h.status,
          latencyMs: h.latencyMs,
          ...(h.detail !== undefined ? { detail: h.detail } : {}),
        })),
        createdAt: row.createdAt,
      })),
      now,
    };
  },
});

export const getQueueOutcomeStats = query({
  args: {},
  handler: async (ctx): Promise<{ delivered24h: number; abandoned24h: number; gracefulPending: number } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!(await isAdmin(ctx, user))) return null;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const delivered = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "delivered"))
      .order("desc")
      .take(200);
    const abandoned = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "abandoned"))
      .order("desc")
      .take(200);
    const graceful = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "graceful"))
      .order("desc")
      .take(200);
    return {
      delivered24h: delivered.filter((r) => r.updatedAt >= dayAgo).length,
      abandoned24h: abandoned.filter((r) => r.updatedAt >= dayAgo).length,
      gracefulPending: graceful.filter((r) => r.updatedAt >= dayAgo).length,
    };
  },
});
