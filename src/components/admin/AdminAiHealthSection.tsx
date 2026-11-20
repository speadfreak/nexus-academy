// Admin AI Health — live super-admin view of the tutor reliability layer.
//
// Shows, in one screen:
//   - Traffic stats: requests/hour + /24h, cache hit rate, fallback usage,
//     rate-limit avoidance (hops skipped before a 429), average latency,
//     queue depth, queue outcomes
//   - Provider capacity: per model cooldowns, RPM/TPM/RPD usage vs free-tier
//     limits, consecutive failures, 404-disabled models, last errors
//   - The 40 most recent router turns with every hop and its status
//
// Data comes from aiHealth.getAiHealthDashboard (admin-gated) — the same
// Convex tables the router writes on every turn.

import { api } from "@/convex/_generated/api";
import { useQuerySafe } from "@/hooks/useQuerySafe";
import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Bot,
  BrainCircuit,
  CheckCircle2,
  Clock,
  Database,
  Loader2,
  ShieldAlert,
  Timer,
  TrendingUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "good" | "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card/60 p-3",
        tone === "good" && "border-emerald-500/25 bg-emerald-500/[0.04]",
        tone === "warn" && "border-amber-500/30 bg-amber-500/[0.04]",
        tone === "default" && "border-border/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums leading-none">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function providerStateBadge(
  p: {
    cooldownUntil?: number;
    cooldownReason?: string;
    disabledUntil404?: number;
    consecutiveFailures: number;
  },
  now: number,
): { label: string; tone: "good" | "warn" | "bad" } {
  if (p.disabledUntil404 && p.disabledUntil404 > now) {
    return { label: `404-disabled ${Math.ceil((p.disabledUntil404 - now) / 3600000)}h`, tone: "bad" };
  }
  if (p.cooldownUntil && p.cooldownUntil > now) {
    const s = Math.ceil((p.cooldownUntil - now) / 1000);
    return {
      label: `cooling ${s >= 90 ? `${Math.ceil(s / 60)}m` : `${s}s`} (${p.cooldownReason ?? "?"})`,
      tone: s > 120 ? "bad" : "warn",
    };
  }
  if (p.consecutiveFailures > 0) {
    return { label: `${p.consecutiveFailures} fail${p.consecutiveFailures === 1 ? "" : "s"}`, tone: "warn" };
  }
  return { label: "healthy", tone: "good" };
}

const HOP_TONE: Record<string, string> = {
  ok: "text-emerald-500",
  skipped: "text-muted-foreground/60",
  no_key: "text-muted-foreground/60",
  rate_limited: "text-amber-500",
  server_error: "text-orange-500",
  auth_error: "text-red-500",
  model_missing: "text-red-500",
  timeout: "text-orange-500",
  network: "text-orange-500",
  error: "text-red-500",
};

export function AdminAiHealthSection() {
  // useQuerySafe: admin dashboard survives backend/frontend deploy windows —
  // a missing/errored AI Health query renders as "loading" instead of crashing.
  const data = useQuerySafe(api.aiHealth.getAiHealthDashboard);
  const queueStats = useQuerySafe(api.aiHealth.getQueueOutcomeStats);

  if (data === undefined) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading AI health…
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        Admin access required.
      </div>
    );
  }

  const { stats } = data;
  const noProviders = Object.values(data.keys).every((v) => !v);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Traffic ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">AI Tutor traffic</h2>
          <span className="text-[10px] text-muted-foreground">
            reliability layer · last 24h
          </span>
        </div>
        {noProviders && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-xs text-amber-600">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              No provider keys configured — the router has nothing to route to.
              Add GROQ_API_KEY / GEMINI_API_KEY / CEREBRAS_API_KEY /
              OPENROUTER_API_KEY in the Keys tab.
            </span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            icon={Activity}
            label="Requests / hour"
            value={String(stats.callsLastHour)}
            sub={`${stats.calls24h} in 24h`}
          />
          <StatCard
            icon={Zap}
            label="Cache hit rate"
            value={`${Math.round(stats.cacheHitRate * 100)}%`}
            sub={`${stats.cacheHits24h} served from cache`}
            tone={stats.cacheHitRate >= 0.2 ? "good" : "default"}
          />
          <StatCard
            icon={BrainCircuit}
            label="Fallback turns"
            value={String(stats.fallbackTurns24h)}
            sub={`${Math.round(
              stats.calls24h > 0 ? (stats.fallbackTurns24h / stats.calls24h) * 100 : 0,
            )}% needed a 2nd provider`}
          />
          <StatCard
            icon={ShieldAlert}
            label="Limits avoided"
            value={String(stats.rateLimitedHops24h)}
            sub="hops skipped before a 429"
          />
          <StatCard
            icon={Timer}
            label="Avg latency"
            value={`${stats.avgLatencyMs}ms`}
            sub="provider turn"
          />
          <StatCard
            icon={Clock}
            label="Queued now"
            value={String(stats.queuedNow)}
            sub={
              queueStats
                ? `24h: ${queueStats.delivered24h} delivered · ${queueStats.gracefulPending} graceful · ${queueStats.abandoned24h} abandoned`
                : undefined
            }
            tone={stats.queuedNow > 0 ? "warn" : "default"}
          />
        </div>
      </section>

      {/* ── Provider capacity ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Provider capacity</h2>
          <span className="text-[10px] text-muted-foreground">
            live cooldowns + rolling windows · {data.providers.length} models seen
          </span>
        </div>
        {data.providers.length === 0 ? (
          <div className="rounded-lg border border-border/60 p-4 text-xs text-muted-foreground">
            No provider state yet — the router writes a row the first time each
            model is tried (or skipped). Send a tutor message to populate this.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {data.providers.map((p, i) => {
              const badge = providerStateBadge(p, data.now);
              return (
                <motion.div
                  key={p.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.03, 0.3) }}
                  className="rounded-xl border border-border/60 bg-card/60 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{p.model}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {p.provider}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        badge.tone === "good" &&
                          "bg-emerald-500/10 text-emerald-600",
                        badge.tone === "warn" &&
                          "bg-amber-500/10 text-amber-600",
                        badge.tone === "bad" && "bg-red-500/10 text-red-600",
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                    <div>
                      <span className="block font-medium text-foreground">{p.rpmUsed}</span>
                      rpm window
                    </div>
                    <div>
                      <span className="block font-medium text-foreground">
                        {p.tpmUsedEst.toLocaleString()}
                      </span>
                      tpm est.
                    </div>
                    <div>
                      <span className="block font-medium text-foreground">{p.rpdUsed}</span>
                      rpd
                    </div>
                  </div>
                  {p.lastErrorDetail && p.lastErrorAt && data.now - p.lastErrorAt < 6 * 3600_000 && (
                    <div className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                      <span className="line-clamp-2 break-all">{p.lastErrorDetail}</span>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.keys).map(([name, present]) => (
            <span
              key={name}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-mono",
                present
                  ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-600"
                  : "border-border/60 text-muted-foreground/60",
              )}
            >
              {present ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Database className="h-2.5 w-2.5" />}
              {name}
            </span>
          ))}
        </div>
      </section>

      {/* ── Recent calls ──────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Recent router turns</h2>
          <span className="text-[10px] text-muted-foreground">last 40</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Purpose</th>
                <th className="px-3 py-2 font-medium">Served by</th>
                <th className="px-3 py-2 font-medium">Latency</th>
                <th className="px-3 py-2 font-medium">Hops</th>
              </tr>
            </thead>
            <tbody>
              {data.recentCalls.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">
                    No calls logged yet.
                  </td>
                </tr>
              )}
              {data.recentCalls.map((call) => (
                <tr key={call._id} className="border-t border-border/40">
                  <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                    {new Date(call.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </td>
                  <td className="px-3 py-1.5">
                    {call.cacheHit && (
                      <span className="mr-1 rounded bg-emerald-500/10 px-1 py-0.5 text-[9px] font-medium text-emerald-600">
                        cache
                      </span>
                    )}
                    {call.purpose}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10px]">
                    {call.provider ? `${call.provider}/${call.model}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 tabular-nums text-muted-foreground">
                    {call.latencyMs !== undefined ? `${call.latencyMs}ms` : "—"}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {call.hops.length === 0 && (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                      {call.hops.map((h, i) => (
                        <span
                          key={`${call._id}-${i}`}
                          title={`${h.provider}/${h.model} · ${h.status} · ${h.latencyMs}ms${h.detail ? ` · ${h.detail}` : ""}`}
                          className={cn(
                            "rounded px-1 py-0.5 font-mono text-[9px]",
                            HOP_TONE[h.status] ?? "text-muted-foreground",
                            h.status !== "ok" && "bg-muted/50",
                          )}
                        >
                          {h.status === "ok" ? "✓" : h.status === "skipped" ? "⤼" : "✗"}
                          {h.provider}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
