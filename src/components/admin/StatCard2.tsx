// Futuristic finance stat card with animated number, sparkline mini-chart,
// and delta indicator. Used by the Admin Dashboard's finance sections to
// surface metrics that feel ALIVE — not just static numbers.
//
// Features:
//   - Animated number counter (counts up from 0 to the value on mount)
//   - Optional sparkline mini-chart rendered inline (no Recharts overhead)
//   - Delta indicator showing % change vs previous period (green up / red down)
//   - Optional health badge (green/amber/red) for instant status reading
//   - Currency suffix appended automatically when `money` is set
//   - Hover lift + glow

import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

// ── Animated number counter ────────────────────────────────────────────
//
// Smoothly counts from 0 to `value` over `duration` ms on mount. Used
// inside StatCard2 to give the dashboard a "live data ticking in" feel
// rather than the values just appearing.

function useCountUp(value: number, duration = 800) {
  const [display, setDisplay] = useState(0);
  const startRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    let raf = 0;
    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(fromRef.current + (value - fromRef.current) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);
  return display;
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// ── Inline SVG sparkline ────────────────────────────────────────────────
//
// Tiny SVG polyline — no chart library. Renders a 80×24 sparkline of
// the last N values. Used for the "last 30 days" revenue spark inside
// each StatCard2.

function Sparkline({
  data,
  color = "var(--primary)",
  width = 88,
  height = 28,
}: {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (data.length === 0) return null;
  const max = Math.max(1, ...data);
  const min = Math.min(0, ...data);
  const range = Math.max(0.0001, max - min);
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  // Build a smooth area under the line for visual richness.
  const areaPath =
    data.length > 0
      ? `M0,${height} L${points
          .split(" ")
          .map((p) => p.replace(",", " "))
          .join(" L")} L${width},${height} Z`
      : "";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={`spark-grad-${color.replace(/[^a-z0-9]/gi, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill={`url(#spark-grad-${color.replace(/[^a-z0-9]/gi, "")})`} />}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* End dot — the "current" value marker */}
      {data.length > 0 && (
        <circle
          cx={(data.length - 1) * stepX}
          cy={height - ((data[data.length - 1]! - min) / range) * height}
          r={2.5}
          fill={color}
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      )}
    </svg>
  );
}

// ── Health badge ────────────────────────────────────────────────────────

export function FinanceHealthBadge({ health }: { health: "green" | "amber" | "red" }) {
  const label = health === "green" ? "Healthy" : health === "amber" ? "Watch" : "Action needed";
  const dotClass =
    health === "green"
      ? "bg-emerald-400"
      : health === "amber"
        ? "bg-amber-400"
        : "bg-rose-400";
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
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
        bgClass,
        textClass,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dotClass)} style={{ boxShadow: "0 0 6px currentColor" }} />
      {label}
    </span>
  );
}

// ── Delta indicator ────────────────────────────────────────────────────

function DeltaBadge({ delta, suffix = "%" }: { delta: number | null; suffix?: string }) {
  if (delta === null) {
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
        <Minus className="size-2.5" /> —
      </span>
    );
  }
  const positive = delta > 0;
  const neutral = delta === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
        neutral
          ? "bg-white/5 text-muted-foreground"
          : positive
            ? "bg-emerald-400/15 text-emerald-300"
            : "bg-rose-400/15 text-rose-300",
      )}
    >
      {neutral ? (
        <Minus className="size-2.5" />
      ) : positive ? (
        <ArrowUpRight className="size-2.5" />
      ) : (
        <ArrowDownRight className="size-2.5" />
      )}
      {neutral ? "0" : `${positive ? "+" : ""}${delta}${suffix}`}
    </span>
  );
}

// ── StatCard2 ──────────────────────────────────────────────────────────

export function StatCard2({
  label,
  value,
  icon: Icon,
  sub,
  money,
  currency = "ETB",
  delta,
  deltaSuffix = "%",
  sparkData,
  sparkColor,
  health,
  accent = "default",
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  sub?: string;
  money?: boolean;
  currency?: string;
  delta?: number | null;
  deltaSuffix?: string;
  sparkData?: number[];
  sparkColor?: string;
  health?: "green" | "amber" | "red";
  accent?: "default" | "money" | "warning" | "danger" | "success";
}) {
  const animated = useCountUp(value);
  const display = money ? `${fmtMoney(animated)} ${currency}` : Math.round(animated).toLocaleString();
  const accentClass =
    accent === "money"
      ? "border-primary/25 bg-primary/[0.06]"
      : accent === "warning"
        ? "border-amber-400/25 bg-amber-400/[0.06]"
        : accent === "danger"
          ? "border-rose-400/25 bg-rose-400/[0.06]"
          : accent === "success"
            ? "border-emerald-400/25 bg-emerald-400/[0.06]"
            : "border-white/10 bg-white/[0.035]";
  const iconBgClass =
    accent === "money"
      ? "bg-primary/15 text-primary"
      : accent === "warning"
        ? "bg-amber-400/15 text-amber-300"
        : accent === "danger"
          ? "bg-rose-400/15 text-rose-300"
          : accent === "success"
            ? "bg-emerald-400/15 text-emerald-300"
            : "bg-white/5 text-muted-foreground group-hover:text-primary";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border p-4 transition-all hover:shadow-lg",
        accentClass,
        "hover:border-primary/40 hover:bg-primary/[0.04]",
      )}
    >
      {/* Top gradient line on hover */}
      <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-2">
        <span className="truncate font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {health && <FinanceHealthBadge health={health} />}
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
              iconBgClass,
            )}
          >
            <Icon className="size-3.5" />
          </span>
        </div>
      </div>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-2xl font-bold tabular-nums text-gradient sm:text-[1.75rem]">
            {display}
          </p>
          {sub && (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              {sub}
            </p>
          )}
          {delta !== undefined && (
            <div className="mt-2 flex items-center gap-2">
              <DeltaBadge delta={delta} suffix={deltaSuffix} />
              <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/60">
                vs prev
              </span>
            </div>
          )}
        </div>
        {sparkData && sparkData.length > 1 && (
          <div className="shrink-0 pb-1">
            <Sparkline data={sparkData} color={sparkColor ?? "var(--primary)"} />
          </div>
        )}
      </div>
    </motion.div>
  );
}
