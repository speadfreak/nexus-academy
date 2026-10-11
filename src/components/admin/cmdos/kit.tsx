// Learnyx Command OS — shared admin component kit.
// Reusable primitives for the redesigned admin: section headers, metric
// cards, status indicators, operational action rows, empty / loading /
// permission states. Built on the cmdos-* token layer in index.css.
// Design spec: docs/command-os/DESIGN_SYSTEM.md

import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── SectionHeader ─────────────────────────────────────────────────────
   One heading idiom for the whole admin: mono eyebrow (domain), title,
   one-line description, and a right-aligned contextual actions slot.   */

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-end justify-between gap-3",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && <p className="cmdos-eyebrow">{eyebrow}</p>}
        <h2 className="mt-1 truncate text-lg font-extrabold tracking-tight text-foreground sm:text-xl">
          {title}
        </h2>
        {description && (
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

/* ── Panel ──────────────────────────────────────────────────────────── */

export function Panel({
  children,
  className,
  raised,
  accent,
  hover,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
  accent?: boolean;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "cmdos-panel",
        raised && "cmdos-panel--raised",
        accent && "cmdos-panel--accent",
        hover && "cmdos-panel--hover",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── MetricCard ────────────────────────────────────────────────────────
   The single stat-card for Command OS surfaces. Real values only —
   pass `loading` while the source query is undefined; pass `hint`
   (not a fake zero) when data is genuinely unavailable.               */

export function MetricCard({
  label,
  value,
  icon: Icon,
  sub,
  tone = "default",
  loading,
  onClick,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  sub?: ReactNode;
  tone?: "default" | "gold" | "ok" | "warn" | "danger";
  loading?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const toneIcon: Record<string, string> = {
    default: "bg-white/5 text-muted-foreground",
    gold: "bg-[rgb(230_167_46/0.15)] text-primary",
    ok: "bg-emerald-400/10 text-emerald-300",
    warn: "bg-amber-400/10 text-amber-300",
    danger: "bg-rose-400/10 text-rose-300",
  };
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      {...(onClick
        ? {
            type: "button" as const,
            onClick,
            className: cn(
              "cmdos-panel cmdos-panel--hover interactive-press cursor-pointer p-4 text-left",
              className,
            ),
          }
        : { className: cn("cmdos-panel p-4", className) })}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="cmdos-eyebrow truncate">{label}</span>
        {Icon && (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              toneIcon[tone],
            )}
          >
            <Icon className="size-3.5" />
          </span>
        )}
      </div>
      {loading ? (
        <div className="cmdos-skeleton mt-2.5 h-7 w-20" />
      ) : (
        <p
          className={cn(
            "mt-2 font-mono text-xl font-bold tabular-nums sm:text-2xl",
            tone === "gold"
              ? "cmdos-figure"
              : tone === "ok"
                ? "text-emerald-300"
                : tone === "warn"
                  ? "text-amber-300"
                  : tone === "danger"
                    ? "text-rose-300"
                    : "text-foreground",
          )}
        >
          {value}
        </p>
      )}
      {sub && !loading && (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {sub}
        </p>
      )}
    </Comp>
  );
}

/* ── StatusBadge / StatusDot ───────────────────────────────────────────
   Restrained semantic status. Never neon.                             */

export type StatusTone = "ok" | "warn" | "danger" | "info" | "idle";

const STATUS_BADGE_TONES: Record<StatusTone, string> = {
  ok: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300",
  warn: "border-amber-400/20 bg-amber-400/[0.08] text-amber-300",
  danger: "border-rose-400/25 bg-rose-400/[0.09] text-rose-300",
  info: "border-sky-400/20 bg-sky-400/[0.08] text-sky-300",
  idle: "border-white/10 bg-white/[0.04] text-muted-foreground",
};

export function StatusBadge({
  tone = "idle",
  children,
  className,
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider",
        STATUS_BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  tone = "idle",
  pulse,
  className,
}: {
  tone?: StatusTone;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "cmdos-dot",
        tone === "ok" && "cmdos-dot--ok",
        tone === "warn" && "cmdos-dot--warn",
        tone === "danger" && "cmdos-dot--danger",
        tone === "info" && "cmdos-dot--info",
        tone === "idle" && "cmdos-dot--idle",
        pulse && "animate-pulse",
        className,
      )}
    />
  );
}

/* ── ActionRow ─────────────────────────────────────────────────────────
   One pending item that needs an admin decision: what it is, why it
   matters, and where to act. Real data in — rendered by the caller.   */

export function ActionRow({
  icon: Icon,
  tone = "warn",
  title,
  detail,
  actionLabel,
  onAction,
  className,
}: {
  icon: LucideIcon;
  tone?: StatusTone;
  title: string;
  detail?: string;
  actionLabel: string;
  onAction: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "cmdos-panel cmdos-panel--hover flex items-center gap-3 px-4 py-3",
        className,
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          tone === "danger"
            ? "bg-rose-400/10 text-rose-300"
            : tone === "warn"
              ? "bg-amber-400/10 text-amber-300"
              : tone === "ok"
                ? "bg-emerald-400/10 text-emerald-300"
                : "bg-white/5 text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground">
          {title}
        </p>
        {detail && (
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onAction}
        className="interactive-press shrink-0 rounded-lg border border-primary/25 bg-primary/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary transition-colors hover:bg-primary/15"
      >
        {actionLabel}
      </button>
    </div>
  );
}

/* ── Empty / Loading / Error / Permission states ────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03] text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {hint && (
        <p className="max-w-sm text-[12px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function LoadingPanel({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-40 flex-col items-center justify-center gap-3",
        className,
      )}
      role="status"
      aria-label={label}
    >
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <span className="cmdos-eyebrow">{label}…</span>
    </div>
  );
}

export function SkeletonRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="cmdos-skeleton h-12"
          style={{ opacity: 1 - i * 0.15 }}
        />
      ))}
    </div>
  );
}

export function PermissionState({
  title = "Restricted",
  detail,
  icon: Icon,
}: {
  title?: string;
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <Panel className="mx-auto flex max-w-lg flex-col items-center px-6 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
        <Icon className="size-5" />
      </div>
      <p className="mt-3 text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-[12px] leading-relaxed text-muted-foreground">
        {detail}
      </p>
    </Panel>
  );
}
