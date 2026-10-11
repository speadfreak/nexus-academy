// Learnyx Command OS — shared executive blocks.
// Moved from the legacy Admin.tsx dashboard so the Command Center and the
// Finance workspace render ONE implementation (removes the duplicate that
// used to live inside Admin.tsx).

import { motion } from "framer-motion";
import { AlertTriangle, Crown, ShieldCheck, Timer, TrendingUp, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { StatCard2 } from "@/components/admin/StatCard2";
import { cn } from "@/lib/utils";

/* Chart tokens (recharts) */
export const AXIS_COLOR = "var(--muted-foreground)";
export const GRID_COLOR = "var(--border)";
export const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
};
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

/* Formatting helpers shared across admin surfaces */
export function fmtMoney(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "N"
  );
}

export function FinanceHealthBadgeInline({
  health,
}: {
  health: "green" | "amber" | "red";
}) {
  const label =
    health === "green" ? "Healthy" : health === "amber" ? "Watch" : "Action needed";
  const dotClass =
    health === "green" ? "bg-emerald-400" : health === "amber" ? "bg-amber-400" : "bg-rose-400";
  const textClass =
    health === "green"
      ? "text-emerald-300"
      : health === "amber"
        ? "text-amber-300"
        : "text-rose-300";
  const bgClass =
    health === "green"
      ? "bg-emerald-400/10 border-emerald-400/20"
      : health === "amber"
        ? "bg-amber-400/10 border-amber-400/20"
        : "bg-rose-400/10 border-rose-400/20";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider",
        bgClass,
        textClass,
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", dotClass)}
        style={{ boxShadow: "0 0 6px currentColor" }}
      />
      {label}
    </span>
  );
}

/* ── Finance hero — the revenue pulse banner ─────────────────────────── */

export function FinanceHeroBanner({
  currency,
  revenueTotal,
  revenueThisMonth,
  pendingRevenue,
  pendingManualSubmissions,
  slaBreached,
  paymentSuccessRate,
  arpu,
  estimatedLtv,
  revenueChange30d,
  revenueByDay,
  health,
}: {
  currency: string;
  revenueTotal: number;
  revenueThisMonth: number;
  pendingRevenue: number;
  pendingManualSubmissions: number;
  slaBreached: number;
  paymentSuccessRate: number;
  arpu: number;
  estimatedLtv: number;
  revenueChange30d: number | null;
  revenueByDay: { date: string; label: string; revenue: number; payments: number }[];
  health: "green" | "amber" | "red";
}) {
  const sparkData = revenueByDay.map((d) => d.revenue);
  const successPct = Math.round(paymentSuccessRate * 100);
  const accent: "money" | "warning" | "danger" | "success" =
    health === "green" ? "money" : health === "amber" ? "warning" : "danger";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-primary/[0.06] via-white/[0.02] to-transparent p-5 sm:p-6"
    >
      <div
        className="pointer-events-none absolute -right-10 -top-20 size-72 rounded-full blur-3xl"
        style={{
          background:
            health === "green"
              ? "radial-gradient(circle, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0) 70%)"
              : health === "amber"
                ? "radial-gradient(circle, rgba(251,191,36,0.22) 0%, rgba(251,191,36,0) 70%)"
                : "radial-gradient(circle, rgba(244,63,94,0.22) 0%, rgba(244,63,94,0) 70%)",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 16 }}
            className="flex size-11 items-center justify-center rounded-2xl bg-primary/15 text-primary"
            style={{ boxShadow: "0 0 24px -4px var(--primary)" }}
          >
            <Wallet className="size-5.5" />
          </motion.div>
          <div>
            <p className="cmdos-eyebrow text-amber-300/80">// finance pulse</p>
            <h2 className="text-lg font-extrabold tracking-tight">
              Finance Command Center
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FinanceHealthBadgeInline health={health} />
          <span className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 sm:inline">
            live · auto-refreshes
          </span>
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-5">
        <StatCard2
          label="total earned"
          value={revenueTotal}
          icon={Wallet}
          money
          currency={currency}
          sub={`${currency} · all time`}
          delta={revenueChange30d}
          deltaSuffix="%"
          sparkData={sparkData}
          sparkColor="var(--primary)"
          accent={accent}
        />
        <StatCard2
          label="this month"
          value={revenueThisMonth}
          icon={TrendingUp}
          money
          currency={currency}
          sub="completed payments"
          accent="success"
        />
        <StatCard2
          label="pending revenue"
          value={pendingRevenue}
          icon={Timer}
          money
          currency={currency}
          sub={`${pendingManualSubmissions} manual · waiting`}
          accent={pendingManualSubmissions > 0 ? "warning" : "default"}
        />
        <StatCard2
          label="success rate"
          value={successPct}
          icon={ShieldCheck}
          sub={`${successPct >= 85 ? "Healthy" : successPct >= 50 ? "Needs attention" : "Critical"} · ${slaBreached} SLA breach${slaBreached === 1 ? "" : "es"}`}
          accent={successPct >= 85 ? "success" : successPct >= 50 ? "warning" : "danger"}
        />
        <StatCard2
          label="est. LTV"
          value={estimatedLtv}
          icon={Crown}
          money
          currency={currency}
          sub={`ARPU ${fmtMoney(arpu)} ${currency}/mo`}
          accent="money"
        />
      </div>

      {slaBreached > 0 && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="relative mt-4 flex items-center gap-2.5 rounded-xl border border-rose-400/30 bg-rose-400/[0.06] p-3"
        >
          <AlertTriangle className="size-4 shrink-0 text-rose-300" />
          <p className="text-xs font-semibold text-rose-200">
            {slaBreached} pending submission{slaBreached === 1 ? "" : "s"} breached
            the SLA — review them now in the Payments tab to avoid losing
            student trust.
          </p>
        </motion.div>
      )}
    </motion.div>
  );
}

/* ── ChartCard ───────────────────────────────────────────────────────── */

export function ChartCard({
  title,
  sub,
  children,
  className,
}: {
  title: string;
  sub?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("cmdos-panel p-5", className)}>
      <p className="cmdos-eyebrow">{title}</p>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
