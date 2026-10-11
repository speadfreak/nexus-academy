// Learnyx Command OS — Executive Command Center (the redesigned dashboard).
// Reference implementation for all Command OS workspaces.
//
// Data honesty rules enforced here:
//  - every metric comes from getAdminDashboard / getSystemHealthSummary;
//  - loading renders skeletons, not zeros;
//  - operational rows render only for real, non-zero signals;
//  - every card drills down into the workspace where the admin can act.

import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Crown,
  Flame,
  Plus,
  Receipt,
  Terminal as TerminalIcon,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard2 } from "@/components/admin/StatCard2";
import { relativeTime } from "@/lib/dates";
import type { AdminTabId } from "./nav";
import {
  ActionRow,
  EmptyState,
  LoadingPanel,
  MetricCard,
  Panel,
  SectionHeader,
} from "./kit";
import {
  AXIS_COLOR,
  CHART_COLORS,
  ChartCard,
  FinanceHeroBanner,
  GRID_COLOR,
  TOOLTIP_STYLE,
  fmtMoney,
  initials,
} from "./blocks";

export type AdminDashboardData = FunctionReturnType<
  typeof api.adminCenter.getAdminDashboard
>;
export type SystemHealthData = FunctionReturnType<
  typeof api.systemEvents.getSystemHealthSummary
>;

const STREAM_LABELS: Record<string, string> = {
  natural: "Natural science",
  social: "Social science",
  onboarding: "Onboarding",
};

const CONTENT_TYPE_LABELS: Record<string, string> = {
  textbook: "Textbooks",
  past_exam: "Past exams",
  worksheet: "Worksheets",
  student_guide: "Student guides",
  teacher_guide: "Teacher guides",
};

export function CommandCenter({
  dashboard,
  health,
  onNavigate,
}: {
  dashboard: AdminDashboardData | undefined;
  health: SystemHealthData | undefined;
  onNavigate: (tab: AdminTabId) => void;
}) {
  if (dashboard === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <div className="cmdos-skeleton h-16 w-64" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="cmdos-skeleton h-24" />
          ))}
        </div>
        <LoadingPanel label="Preparing the command center" />
      </div>
    );
  }

  const t = dashboard.totals;
  const currency = t.currency;

  /* Real period comparison: new signups this month vs last month,
     derived from the same newUsersByMonth series that feeds the chart. */
  const months = dashboard.newUsersByMonth;
  const lastMonth = months.length >= 1 ? months[months.length - 1].count : null;
  const prevMonth =
    months.length >= 2 ? months[months.length - 2].count : null;
  let signupDelta: number | null = null;
  if (lastMonth !== null && prevMonth !== null && prevMonth > 0) {
    signupDelta = Math.round(((lastMonth - prevMonth) / prevMonth) * 100);
  } else if (lastMonth !== null && prevMonth === 0 && lastMonth > 0) {
    signupDelta = null; // 0 → N is not a meaningful percentage
  }

  const donutData = dashboard.subscriptionBreakdown.filter((e) => e.count > 0);
  const maxStream = Math.max(1, ...dashboard.usersByStream.map((s) => s.count));

  const needsAttention: {
    id: string;
    icon: LucideIcon;
    tone: "danger" | "warn";
    title: string;
    detail: string;
    tab: AdminTabId;
  }[] = [];
  if (t.slaBreachedSubmissions > 0) {
    needsAttention.push({
      id: "sla",
      icon: AlertTriangle,
      tone: "danger",
      title: `${t.slaBreachedSubmissions} payment submission${t.slaBreachedSubmissions === 1 ? "" : "s"} breached the SLA`,
      detail: "Students are waiting — resolve these first.",
      tab: "payments",
    });
  }
  if (t.pendingManualSubmissions > 0) {
    needsAttention.push({
      id: "manual",
      icon: Receipt,
      tone: "warn",
      title: `${t.pendingManualSubmissions} manual payment${t.pendingManualSubmissions === 1 ? "" : "s"} waiting for review`,
      detail: "TeleBirr personal transfers queued for approval.",
      tab: "payments",
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* 1 · Executive heading */}
      <SectionHeader
        eyebrow="overview · command center"
        title="Good to see you — here's the platform right now"
        description="Users, money, content, activity and safety in one view. Every card drills into the workspace where you act."
        actions={
          <>
            <Button
              size="sm"
              className="cursor-pointer rounded-xl font-mono text-[11px] font-bold uppercase tracking-wide"
              onClick={() => onNavigate("content")}
            >
              <Plus className="size-3.5" /> Add content
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer rounded-xl bg-white/[0.04] font-mono text-[11px] font-bold uppercase tracking-wide"
              onClick={() => onNavigate("users")}
            >
              <Users className="size-3.5" /> Find a user
            </Button>
          </>
        }
      />

      {/* 2 · Primary metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="users"
          value={t.users}
          icon={Users}
          sub={`${t.activeToday} active today`}
          onClick={() => onNavigate("users")}
        />
        <MetricCard
          label="active this week"
          value={t.activeThisWeek}
          icon={Activity}
          sub="rolled over the last 7 days"
          onClick={() => onNavigate("users")}
        />
        <MetricCard
          label="paying / trial"
          value={t.payingUsers}
          icon={Crown}
          sub="with premium access"
          tone="gold"
          onClick={() => onNavigate("subscriptions")}
        />
        <MetricCard
          label="total earned"
          value={`${fmtMoney(t.revenueTotal)} ${currency}`}
          icon={Wallet}
          sub={`${t.paymentsCompleted} payments · all time`}
          tone="gold"
          onClick={() => onNavigate("finance")}
        />
        <MetricCard
          label="this month"
          value={`${fmtMoney(t.revenueThisMonth)} ${currency}`}
          icon={t.revenueChangePercent30d !== null && t.revenueChangePercent30d < 0 ? TrendingDown : TrendingUp}
          sub={
            t.revenueChangePercent30d === null
              ? "completed payments"
              : `${t.revenueChangePercent30d >= 0 ? "+" : ""}${t.revenueChangePercent30d}% vs prior 30d`
          }
          tone={t.revenueChangePercent30d !== null && t.revenueChangePercent30d < 0 ? "danger" : "ok"}
          onClick={() => onNavigate("finance")}
        />
        <MetricCard
          label="new signups · month"
          value={lastMonth ?? 0}
          icon={ArrowUpRight}
          sub={
            signupDelta === null
              ? "last 30 days"
              : `${signupDelta >= 0 ? "+" : ""}${signupDelta}% vs previous month`
          }
          onClick={() => onNavigate("users")}
        />
      </div>

      {/* 3 · Operational attention */}
      <Panel className="p-4">
        <p className="cmdos-eyebrow">Needs attention</p>
        {needsAttention.length === 0 ? (
          <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04] px-4 py-3">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
            <p className="text-[13px] font-semibold text-emerald-200">
              All clear — no SLA breaches, no queued payment reviews.
            </p>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {needsAttention.map((a) => (
              <ActionRow
                key={a.id}
                icon={a.icon}
                tone={a.tone}
                title={a.title}
                detail={a.detail}
                actionLabel="Review"
                onAction={() => onNavigate(a.tab)}
              />
            ))}
          </div>
        )}
      </Panel>

      {/* 4 · Revenue & subscription health */}
      <FinanceHeroBanner
        currency={currency}
        revenueTotal={t.revenueTotal}
        revenueThisMonth={t.revenueThisMonth}
        pendingRevenue={t.pendingRevenue}
        pendingManualSubmissions={t.pendingManualSubmissions}
        slaBreached={t.slaBreachedSubmissions}
        paymentSuccessRate={t.paymentSuccessRate}
        arpu={t.arpu}
        estimatedLtv={t.estimatedLtv}
        revenueChange30d={t.revenueChangePercent30d}
        revenueByDay={dashboard.revenueByDay}
        health={t.financeHealth}
      />

      {/* 5 · Revenue + subscription charts */}
      <div className="grid gap-4 2xl:grid-cols-3">
        <ChartCard
          title="revenue · last 12 months"
          sub={`Money earned from completed payments, in ${currency}`}
          className="2xl:col-span-2"
        >
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dashboard.revenueByMonth} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  <linearGradient id="cmdosRevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} fill="url(#cmdosRevGrad)" name={currency} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="subscriptions" sub="Premium access split">
          {donutData.length === 0 ? (
            <EmptyState
              icon={Crown}
              title="No premium activity yet"
              hint="Subscription states appear here as soon as students activate trials or premium."
            />
          ) : (
            <>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donutData} dataKey="count" nameKey="status" innerRadius={46} outerRadius={68} paddingAngle={3} stroke="none">
                      {donutData.map((e, i) => (
                        <Cell key={e.status} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {dashboard.subscriptionBreakdown.map((e, i) => (
                  <Badge key={e.status} variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    {e.status} · {e.count}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </ChartCard>
      </div>

      {/* 6 · Growth + composition */}
      <div className="grid gap-4 2xl:grid-cols-3">
        <ChartCard title="new users · last 6 months">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dashboard.newUsersByMonth} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
                <Bar dataKey="count" fill="var(--chart-2)" radius={[6, 6, 0, 0]} name="new users" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartCard>
        <ChartCard title="revenue by provider" sub={`${currency} from completed payments`}>
          {dashboard.revenueByProvider.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No completed payments yet"
              hint="Provider breakdown appears with the first completed payment."
            />
          ) : (
            <div className="flex h-full min-h-44 flex-col justify-center gap-3">
              {dashboard.revenueByProvider.map((e, i) => {
                const max = Math.max(1, ...dashboard.revenueByProvider.map((p) => p.total));
                return (
                  <div key={e.provider}>
                    <div className="flex items-center justify-between font-mono text-[11px]">
                      <span className="flex items-center gap-2 capitalize">
                        <span className="size-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        {e.provider}
                      </span>
                      <span className="font-bold tabular-nums">{fmtMoney(e.total)} {currency}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full" style={{ width: `${(e.total / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{e.count} payments</p>
                  </div>
                );
              })}
            </div>
          )}
        </ChartCard>
        <Panel className="flex flex-col gap-4 p-5">
          <div>
            <p className="cmdos-eyebrow">streams</p>
            <div className="mt-3 flex flex-col gap-2.5">
              {dashboard.usersByStream.map((e) => (
                <div key={e.stream}>
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-muted-foreground">{STREAM_LABELS[e.stream] ?? e.stream}</span>
                    <span className="font-bold tabular-nums">{e.count}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div className="h-full rounded-full bg-primary/70" style={{ width: `${(e.count / maxStream) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="cmdos-eyebrow">content inventory</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {dashboard.contentByType.map((e) => (
                <Badge key={e.contentType} className="gap-1 bg-white/5 font-mono text-[9px] text-muted-foreground">
                  {CONTENT_TYPE_LABELS[e.contentType] ?? e.contentType} · {e.count}
                </Badge>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onNavigate("coverage")}
              className="interactive-press mt-3 flex cursor-pointer items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary hover:underline"
            >
              Check coverage gaps <ArrowUpRight className="size-3" />
            </button>
          </div>
        </Panel>
      </div>

      {/* 7 · Engagement: power users + recent signups */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel className="p-5 lg:col-span-3">
          <div className="flex items-center justify-between gap-2">
            <p className="cmdos-eyebrow flex items-center gap-2">
              <Trophy className="size-3.5 text-primary" /> power users · ranked by XP
            </p>
            <button
              type="button"
              onClick={() => onNavigate("users")}
              className="interactive-press cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary"
            >
              all users
            </button>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            The students actually using the platform — XP aggregates every study action.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {dashboard.powerUsers.length === 0 ? (
              <EmptyState
                icon={Zap}
                title="No study activity yet"
                hint="Power users appear as soon as students earn XP."
              />
            ) : (
              dashboard.powerUsers.map((u, i) => (
                <div key={u.userId} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-extrabold text-muted-foreground">{i + 1}</span>
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-mono text-xs font-extrabold text-primary">{initials(u.name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{u.name}</p>
                    <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">{u.hours} h · {u.sessions} sessions · {u.quizzes} quizzes</p>
                  </div>
                  <div className="text-right">
                    <p className="flex items-center justify-end gap-1 font-mono text-sm font-extrabold tabular-nums text-primary"><Zap className="size-3" /> {u.xp}</p>
                    <p className="flex items-center justify-end gap-1 font-mono text-[9px] text-muted-foreground"><Flame className="size-3 text-amber-300" /> {u.streak}d streak</p>
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
        <Panel className="p-5 lg:col-span-2">
          <p className="cmdos-eyebrow">recent signups</p>
          <div className="mt-4 flex flex-col gap-2">
            {dashboard.recentSignups.length === 0 ? (
              <EmptyState icon={Users} title="No signups yet" />
            ) : (
              dashboard.recentSignups.map((u) => (
                <div key={u.userId} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-xs font-extrabold text-muted-foreground">{initials(u.name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {u.name}
                      {u.isAnonymous && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">guest</span>}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{u.email ?? "no email"}</p>
                  </div>
                  <p className="shrink-0 font-mono text-[10px] text-muted-foreground">{relativeTime(u.createdAt)}</p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      {/* 8 · System health strip (real signals only) */}
      {health !== undefined && (
        <Panel hover className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
          <p className="cmdos-eyebrow flex w-full items-center gap-2 sm:w-auto">
            <TerminalIcon className="size-3.5 text-primary" /> system pulse · 24h
          </p>
          <div className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-2">
            <HealthStat label="events" value={`${health.last24hCount}`} />
            <HealthStat
              label="error rate"
              value={`${(health.errorRate * 100).toFixed(1)}%`}
              tone={health.errorRate > 0.05 ? "danger" : "ok"}
            />
            <HealthStat
              label="AI latency"
              value={health.avgAiLatencyMs > 0 ? `${health.avgAiLatencyMs}ms` : "—"}
            />
            <HealthStat label="AI calls" value={`${health.aiCallsLast24h}`} />
            <HealthStat label="active now" value={`${health.activeUsersRightNow}`} tone="gold" />
          </div>
          <button
            type="button"
            onClick={() => onNavigate("terminal")}
            className="interactive-press flex cursor-pointer items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary"
          >
            open terminal <ArrowUpRight className="size-3" />
          </button>
        </Panel>
      )}
      {health === undefined && (
        <Panel className="flex items-center justify-between gap-3 px-5 py-4">
          <p className="cmdos-eyebrow flex items-center gap-2">
            <TerminalIcon className="size-3.5" /> system pulse
          </p>
          <button
            type="button"
            onClick={() => onNavigate("terminal")}
            className="interactive-press flex cursor-pointer items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-primary"
          >
            open terminal <ArrowUpRight className="size-3" />
          </button>
        </Panel>
      )}
    </div>
  );
}

function HealthStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "ok" | "danger" | "gold";
}) {
  return (
    <div>
      <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p
        className={
          "mt-0.5 font-mono text-sm font-extrabold tabular-nums " +
          (tone === "danger"
            ? "text-rose-300"
            : tone === "ok"
              ? "text-emerald-300"
              : tone === "gold"
                ? "text-primary"
                : "text-foreground")
        }
      >
        {value}
      </p>
    </div>
  );
}

