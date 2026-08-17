// Admin command center — gated by the existing admin role check.
// Tabs: Dashboard (live charts + power users), Content (upload + manage),
// Users (usage + premium support), Finance (revenue analytics), Reports
// (student safety), System (env status). Every number here comes from the
// adminCenter queries — server-computed, never fabricated on the client.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Crown,
  FileText,
  Flag,
  Flame,
  Github,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
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
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { AdminContentSection } from "@/components/admin/AdminContentSection";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

const AXIS_COLOR = "var(--muted-foreground)";
const GRID_COLOR = "var(--border)";
const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
};
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const SUB_STATUS_STYLES: Record<string, string> = {
  trial: "bg-primary/10 text-primary",
  active: "bg-emerald-400/10 text-emerald-300",
  expired: "bg-amber-400/10 text-amber-300",
  canceled: "bg-rose-400/10 text-rose-300",
  none: "bg-white/5 text-muted-foreground",
};

const PAY_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-400/10 text-amber-300",
  completed: "bg-emerald-400/10 text-emerald-300",
  failed: "bg-rose-400/10 text-rose-300",
};

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

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "N"
  );
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  money,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
  sub?: string;
  money?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        "glass-soft rounded-2xl p-4",
        money && "border-primary/25 bg-primary/[0.06]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-gradient sm:text-3xl">
        {value}
      </p>
      {sub && <p className="mt-1 font-mono text-[10px] text-muted-foreground">{sub}</p>}
    </motion.div>
  );
}

function ChartCard({
  title,
  sub,
  children,
  className,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass-panel rounded-2xl p-5", className)}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {title}
      </p>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function Admin() {
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const promoteSelf = useMutation(api.admin.promoteSelfIfBootstrap);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "dashboard";

  // ---- Dashboard tab ----
  const dashboard = useQuery(api.adminCenter.getAdminDashboard);

  // ---- Finance tab ----
  const finance = useQuery(api.adminCenter.getFinanceOverview);

  // ---- Users tab ----
  const users = useQuery(api.adminCenter.listUsers);
  const setUserPremium = useMutation(api.adminCenter.setUserPremium);
  const [premiumAction, setPremiumAction] = useState<{
    userId: string;
    action: "activate" | "expire" | "cancel";
  } | null>(null);
  const [acting, setActing] = useState(false);
  const [userQuery, setUserQuery] = useState("");

  // ---- System tab ----
  const system = useQuery(api.adminCenter.getSystemStatus);

  // ---- GitHub connection check ----
  const verifyGithub = useAction(api.github.verifyGithubConnection);
  const [githubStatus, setGithubStatus] = useState<{
    configured: boolean;
    valid: boolean;
    login: string | null;
    repos: { fullName: string; private: boolean; pushedAt: string | null }[];
    error: string | null;
  } | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);

  const runGithubCheck = async () => {
    setCheckingGithub(true);
    try {
      const result = await verifyGithub();
      setGithubStatus(result);
    } catch (error) {
      setGithubStatus({
        configured: true,
        valid: false,
        login: null,
        repos: [],
        error: error instanceof Error ? error.message : "Connection check failed.",
      });
    } finally {
      setCheckingGithub(false);
    }
  };

  // Auto-check once when the System tab opens.
  useEffect(() => {
    if (tab === "system" && githubStatus === null && !checkingGithub) {
      void runGithubCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ---- Reports tab (student safety) ----
  const reports = useQuery(api.safety.listReports);
  const updateReportStatus = useMutation(api.safety.updateReportStatus);
  const [reportFilter, setReportFilter] = useState<string>("open");
  const [reportActing, setReportActing] = useState<string | null>(null);

  const handleReportStatus = async (
    reportId: string,
    status: "open" | "reviewed" | "resolved",
  ) => {
    setReportActing(reportId);
    try {
      await updateReportStatus({ reportId: reportId as never, status });
      toast.success(`Report marked ${status}.`);
    } catch (error) {
      toast.error("Could not update the report.");
    } finally {
      setReportActing(null);
    }
  };

  const handlePromote = async () => {
    const result = await promoteSelf();
    if (result.promoted) {
      toast.success("Admin access granted. Welcome!");
    } else {
      toast.error("Could not grant admin access — an admin account already exists.");
    }
  };

  const handlePremiumAction = async () => {
    if (!premiumAction || acting) return;
    setActing(true);
    try {
      await setUserPremium({
        userId: premiumAction.userId as never,
        action: premiumAction.action,
      });
      toast.success(
        premiumAction.action === "activate"
          ? "Premium activated for this user."
          : premiumAction.action === "expire"
            ? "Premium expired for this user."
            : "Subscription canceled for this user.",
      );
      setPremiumAction(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setActing(false);
    }
  };

  if (isAdmin === undefined) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }

  if (!isAdmin) {
    return (
      <DashboardShell>
        <div className="glass-soft mx-auto flex max-w-lg flex-col items-center rounded-2xl px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight">Admins only</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The control center is restricted to administrators. If this is the
            first account on the platform, you can request the bootstrap admin
            role — otherwise ask the platform owner to set your role to
            &quot;admin&quot;.
          </p>
          <Button className="mt-6 rounded-xl" onClick={handlePromote}>
            <ShieldCheck className="size-4" /> Request admin access
          </Button>
        </div>
      </DashboardShell>
    );
  }

  const filteredUsers =
    users?.filter((user) => {
      const q = userQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        (user.email ?? "").toLowerCase().includes(q) ||
        (user.name ?? "").toLowerCase().includes(q) ||
        (user.displayName ?? "").toLowerCase().includes(q)
      );
    }) ?? [];

  const donutData =
    dashboard?.subscriptionBreakdown.filter((entry) => entry.count > 0) ?? [];

  const maxStream = Math.max(
    1,
    ...(dashboard?.usersByStream.map((s) => s.count) ?? [1]),
  );

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            // control center
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Command center
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Users, money, content, activity and safety — the whole platform in one place.
          </p>
        </div>

        <Tabs
          value={tab}
          onValueChange={(next) =>
            setSearchParams(next === "dashboard" ? {} : { tab: next })
          }
        >
          <TabsList className="glass-panel flex w-fit flex-wrap gap-1 rounded-xl p-1">
            <TabsTrigger value="dashboard" className="rounded-lg">
              <Activity className="size-3.5" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="content" className="rounded-lg">
              <FileText className="size-3.5" /> Content
            </TabsTrigger>
            <TabsTrigger value="users" className="rounded-lg">
              <UserRound className="size-3.5" /> Users
            </TabsTrigger>
            <TabsTrigger value="finance" className="rounded-lg">
              <Wallet className="size-3.5" /> Finance
            </TabsTrigger>
            <TabsTrigger value="reports" className="rounded-lg">
              <Flag className="size-3.5" /> Reports
            </TabsTrigger>
            <TabsTrigger value="system" className="rounded-lg">
              <KeyRound className="size-3.5" /> System
            </TabsTrigger>
          </TabsList>

          {/* ------- Dashboard ------- */}
          <TabsContent value="dashboard" className="flex flex-col gap-4">
            {dashboard === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Live totals */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <StatCard
                    label="users"
                    value={dashboard.totals.users}
                    icon={Users}
                    sub="all accounts"
                  />
                  <StatCard
                    label="active this week"
                    value={dashboard.totals.activeThisWeek}
                    icon={Activity}
                    sub={`${dashboard.totals.activeToday} today`}
                  />
                  <StatCard
                    label="paying / trial"
                    value={dashboard.totals.payingUsers}
                    icon={Crown}
                    sub="with premium access"
                  />
                  <StatCard
                    label="total earned"
                    value={`${fmtMoney(dashboard.totals.revenueTotal)} ETB`}
                    icon={Wallet}
                    money
                    sub={`${dashboard.totals.paymentsCompleted} payments`}
                  />
                  <StatCard
                    label="this month"
                    value={`${fmtMoney(dashboard.totals.revenueThisMonth)} ETB`}
                    icon={TrendingUp}
                    money
                    sub="completed payments"
                  />
                  <StatCard
                    label="content items"
                    value={dashboard.totals.contentItems}
                    icon={FileText}
                    sub="in the library"
                  />
                </div>

                {/* Revenue + subscriptions */}
                <div className="grid gap-4 lg:grid-cols-3">
                  <ChartCard
                    title="revenue · last 12 months"
                    sub="Money earned from completed payments, in ETB"
                    className="lg:col-span-2"
                  >
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={dashboard.revenueByMonth}
                          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            width={46}
                          />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="var(--primary)"
                            strokeWidth={2}
                            fill="url(#revGrad)"
                            name="ETB"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartCard>

                  <ChartCard title="subscriptions" sub="Premium access split">
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donutData}
                            dataKey="count"
                            nameKey="status"
                            innerRadius={46}
                            outerRadius={68}
                            paddingAngle={3}
                            stroke="none"
                          >
                            {donutData.map((entry, index) => (
                              <Cell
                                key={entry.status}
                                fill={CHART_COLORS[index % CHART_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dashboard.subscriptionBreakdown.map((entry, index) => (
                        <Badge
                          key={entry.status}
                          variant="outline"
                          className="gap-1 font-mono text-[9px] text-muted-foreground"
                        >
                          <span
                            className="size-2 rounded-full"
                            style={{
                              background: CHART_COLORS[index % CHART_COLORS.length],
                            }}
                          />
                          {entry.status} · {entry.count}
                        </Badge>
                      ))}
                    </div>
                  </ChartCard>
                </div>

                {/* Growth + provider + content/streams */}
                <div className="grid gap-4 lg:grid-cols-3">
                  <ChartCard title="new users · last 6 months">
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dashboard.newUsersByMonth}
                          margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                        >
                          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            allowDecimals={false}
                          />
                          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
                          <Bar dataKey="count" fill="var(--chart-2)" radius={[6, 6, 0, 0]} name="new users" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartCard>

                  <ChartCard title="revenue by provider" sub="ETB from completed payments">
                    <div className="h-44">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dashboard.revenueByProvider}
                          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                        >
                          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="provider"
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            width={46}
                          />
                          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
                          <Bar dataKey="total" fill="var(--chart-3)" radius={[6, 6, 0, 0]} name="ETB" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartCard>

                  <div className="glass-panel flex flex-col gap-4 rounded-2xl p-5">
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        streams
                      </p>
                      <div className="mt-3 flex flex-col gap-2.5">
                        {dashboard.usersByStream.map((entry) => (
                          <div key={entry.stream}>
                            <div className="flex items-center justify-between font-mono text-[10px]">
                              <span className="text-muted-foreground">
                                {STREAM_LABELS[entry.stream] ?? entry.stream}
                              </span>
                              <span className="font-bold tabular-nums">{entry.count}</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-primary/70"
                                style={{ width: `${(entry.count / maxStream) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                        content inventory
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {dashboard.contentByType.map((entry) => (
                          <Badge
                            key={entry.contentType}
                            className="gap-1 bg-white/5 font-mono text-[9px] text-muted-foreground"
                          >
                            {CONTENT_TYPE_LABELS[entry.contentType] ?? entry.contentType} ·{" "}
                            {entry.count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Power users + recent signups */}
                <div className="grid gap-4 lg:grid-cols-5">
                  <div className="glass-panel rounded-2xl p-5 lg:col-span-3">
                    <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      <Trophy className="size-3.5 text-primary" /> power users · ranked by XP
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      The students actually using the platform — XP aggregates every
                      study action (quizzes, focus, plans, challenges).
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      {dashboard.powerUsers.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No study activity yet — power users appear as students earn XP.
                        </p>
                      ) : (
                        dashboard.powerUsers.map((user, index) => (
                          <div
                            key={user.userId}
                            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                          >
                            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg font-mono text-[11px] font-extrabold text-muted-foreground">
                              {index + 1}
                            </span>
                            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-mono text-xs font-extrabold text-primary">
                              {initials(user.name)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold">{user.name}</p>
                              <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                                {user.hours} h · {user.sessions} sessions · {user.quizzes} quizzes
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="flex items-center justify-end gap-1 font-mono text-sm font-extrabold tabular-nums text-primary">
                                <Zap className="size-3" /> {user.xp}
                              </p>
                              <p className="flex items-center justify-end gap-1 font-mono text-[9px] text-muted-foreground">
                                <Flame className="size-3 text-amber-300" /> {user.streak}d streak
                              </p>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      recent signups
                    </p>
                    <div className="mt-4 flex flex-col gap-2">
                      {dashboard.recentSignups.map((user) => (
                        <div
                          key={user.userId}
                          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-xs font-extrabold text-muted-foreground">
                            {initials(user.name)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {user.name}
                              {user.isAnonymous && (
                                <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">
                                  guest
                                </span>
                              )}
                            </p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {user.email ?? "no email"}
                            </p>
                          </div>
                          <p className="shrink-0 font-mono text-[10px] text-muted-foreground">
                            {relativeTime(user.createdAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ------- Content ------- */}
          <TabsContent value="content">
            <AdminContentSection />
          </TabsContent>

          {/* ------- Users ------- */}
          <TabsContent value="users" className="flex flex-col gap-4">
            <div className="glass-panel rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">Users</h2>
                  <p className="text-sm text-muted-foreground">
                    Who signed up, who&apos;s actually studying, and premium access
                    management for support cases.
                  </p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="Search users…"
                    className="h-9 w-56 rounded-xl bg-white/5 pl-9 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                {users === undefined ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    No users match.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>User</TableHead>
                        <TableHead>Stream</TableHead>
                        <TableHead>Subscription</TableHead>
                        <TableHead>Usage</TableHead>
                        <TableHead>Last active</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => (
                        <TableRow key={user._id} className="hover:bg-white/5">
                          <TableCell className="max-w-[13rem]">
                            <p className="truncate font-semibold">
                              {user.displayName ?? user.name ?? "Guest"}
                              {user.isAnonymous && (
                                <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">
                                  anonymous
                                </span>
                              )}
                            </p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">
                              {user.email ?? "no email"}
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground">
                            {user.stream ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={cn(
                                "gap-1 font-mono text-[10px]",
                                SUB_STATUS_STYLES[user.subscriptionStatus],
                              )}
                            >
                              {user.subscriptionStatus}
                              {user.subscriptionStatus === "trial"
                                ? ` · ${user.trialActiveDays}/14`
                                : ""}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
                              {user.usage.studyHours} h · {user.usage.sessions} sess ·{" "}
                              {user.usage.quizzes} quiz
                            </p>
                            <p className="font-mono text-[10px] font-bold tabular-nums text-primary">
                              {user.usage.xp} XP
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-muted-foreground">
                            {user.usage.lastActiveAt
                              ? relativeTime(user.usage.lastActiveAt)
                              : "never"}
                          </TableCell>
                          <TableCell className="text-right">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"
                                >
                                  <Crown className="size-3" /> Manage
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="glass-panel">
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Manage premium access</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    <span className="font-semibold">
                                      {user.displayName ?? user.name ?? user.email ?? "This user"}
                                    </span>{" "}
                                    is currently{" "}
                                    <span className="font-semibold">
                                      {user.subscriptionStatus}
                                    </span>
                                    .
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <div className="flex flex-col gap-2">
                                  <Button
                                    variant="outline"
                                    className="rounded-xl bg-white/5"
                                    onClick={() =>
                                      setPremiumAction({ userId: user._id, action: "activate" })
                                    }
                                  >
                                    <CheckCircle2 className="size-4 text-emerald-300" /> Activate
                                    premium (30 days)
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="rounded-xl bg-white/5"
                                    onClick={() =>
                                      setPremiumAction({ userId: user._id, action: "expire" })
                                    }
                                  >
                                    <AlertTriangle className="size-4 text-amber-300" /> Expire
                                    premium now
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="rounded-xl bg-white/5"
                                    onClick={() =>
                                      setPremiumAction({ userId: user._id, action: "cancel" })
                                    }
                                  >
                                    <XCircle className="size-4 text-rose-300" /> Cancel
                                    subscription
                                  </Button>
                                </div>
                                <AlertDialogFooter>
                                  <AlertDialogCancel className="rounded-xl">Close</AlertDialogCancel>
                                  {premiumAction?.userId === user._id && (
                                    <AlertDialogAction
                                      className="cursor-pointer rounded-xl"
                                      disabled={acting}
                                      onClick={() => handlePremiumAction()}
                                    >
                                      {acting ? (
                                        <Loader2 className="size-4 animate-spin" />
                                      ) : (
                                        <>
                                          Confirm <ChevronRight className="size-4" />
                                        </>
                                      )}
                                    </AlertDialogAction>
                                  )}
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TabsContent>

          {/* ------- Finance ------- */}
          <TabsContent value="finance" className="flex flex-col gap-4">
            {finance === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <StatCard
                    label="total earned"
                    value={`${fmtMoney(finance.totalEarned)} ETB`}
                    icon={Wallet}
                    money
                    sub={`${finance.completedCount} completed payments`}
                  />
                  <StatCard
                    label="this month"
                    value={`${fmtMoney(finance.thisMonth)} ETB`}
                    icon={TrendingUp}
                    money
                    sub="completed payments"
                  />
                  <StatCard
                    label="last 30 days"
                    value={`${fmtMoney(finance.last30Days)} ETB`}
                    icon={Timer}
                    money
                  />
                  <StatCard
                    label="avg payment"
                    value={`${fmtMoney(finance.avgPayment)} ETB`}
                    icon={Zap}
                    sub={`${finance.pendingCount} pending · ${finance.failedCount} failed`}
                  />
                  <StatCard
                    label="conversion"
                    value={`${(finance.conversionRate * 100).toFixed(1)}%`}
                    icon={Users}
                    sub={`${finance.payingUsers} paying / trial`}
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <ChartCard
                    title="revenue · last 12 months"
                    sub="Completed payments in ETB"
                    className="lg:col-span-2"
                  >
                    <div className="h-60">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={finance.revenueByMonth}
                          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="finGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} />
                              <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                            axisLine={false}
                            tickLine={false}
                            width={46}
                          />
                          <Tooltip contentStyle={TOOLTIP_STYLE} />
                          <Area
                            type="monotone"
                            dataKey="revenue"
                            stroke="var(--chart-4)"
                            strokeWidth={2}
                            fill="url(#finGrad)"
                            name="ETB"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </ChartCard>

                  <ChartCard title="by provider" sub="ETB from completed payments">
                    <div className="flex h-full min-h-48 flex-col justify-center gap-3">
                      {finance.revenueByProvider.length === 0 ? (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                          No completed payments yet.
                        </p>
                      ) : (
                        finance.revenueByProvider.map((entry, index) => {
                          const max = Math.max(
                            1,
                            ...finance.revenueByProvider.map((p) => p.total),
                          );
                          return (
                            <div key={entry.provider}>
                              <div className="flex items-center justify-between font-mono text-[11px]">
                                <span className="flex items-center gap-2 capitalize">
                                  <span
                                    className="size-2.5 rounded-full"
                                    style={{
                                      background:
                                        CHART_COLORS[index % CHART_COLORS.length],
                                    }}
                                  />
                                  {entry.provider}
                                </span>
                                <span className="font-bold tabular-nums">
                                  {fmtMoney(entry.total)} ETB
                                </span>
                              </div>
                              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${(entry.total / max) * 100}%`,
                                    background:
                                      CHART_COLORS[index % CHART_COLORS.length],
                                  }}
                                />
                              </div>
                              <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                                {entry.count} payments
                              </p>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ChartCard>
                </div>

                <div className="glass-panel rounded-2xl p-5">
                  <h2 className="text-lg font-extrabold tracking-tight">
                    Recent transactions
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    The latest payment attempts for reconciliation.
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    {finance.recentTransactions.length === 0 ? (
                      <p className="py-10 text-center text-sm text-muted-foreground">
                        No payments yet.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>User</TableHead>
                            <TableHead>Provider</TableHead>
                            <TableHead>Amount</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Reference</TableHead>
                            <TableHead>Created</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {finance.recentTransactions.map((payment) => (
                            <TableRow key={payment._id} className="hover:bg-white/5">
                              <TableCell className="max-w-[12rem]">
                                <p className="truncate text-sm font-semibold">
                                  {payment.userName ?? "Guest"}
                                </p>
                                <p className="truncate font-mono text-[10px] text-muted-foreground">
                                  {payment.userEmail ?? "no email"}
                                </p>
                              </TableCell>
                              <TableCell className="font-mono text-[11px] capitalize">
                                {payment.provider}
                              </TableCell>
                              <TableCell className="font-mono text-[11px] tabular-nums">
                                {payment.amount} {payment.currency}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  className={cn(
                                    "font-mono text-[10px]",
                                    PAY_STATUS_STYLES[payment.status],
                                  )}
                                >
                                  {payment.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">
                                {payment.providerTransactionId ?? "—"}
                              </TableCell>
                              <TableCell className="font-mono text-[10px] text-muted-foreground">
                                {relativeTime(payment.createdAt)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* ------- Reports (student safety) ------- */}
          <TabsContent value="reports" className="flex flex-col gap-4">
            <div className="glass-panel rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold tracking-tight">Safety reports</h2>
                  <p className="text-sm text-muted-foreground">
                    Student reports with enough context to act — reporter, reported,
                    reason, room/group — without exposing unrelated private data.
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {["open", "reviewed", "resolved"].map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setReportFilter(status)}
                      className={cn(
                        "cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors",
                        reportFilter === status
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-white/5",
                      )}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {reports === undefined ? (
                <div className="mt-6 flex items-center justify-center py-10">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {reports.filter((report) => report.status === reportFilter).length === 0 && (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No {reportFilter} reports.
                    </p>
                  )}
                  {reports
                    .filter((report) => report.status === reportFilter)
                    .map((report) => (
                      <div
                        key={report._id}
                        className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
                              <Flag className="size-4" />
                            </div>
                            <div>
                              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                                {report.reported.name}
                                <Badge className="border-rose-400/20 bg-rose-400/10 font-mono text-[9px] uppercase text-rose-300">
                                  {report.reason.replace(/_/g, " ")}
                                </Badge>
                              </p>
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                                {report.reported.email ?? "no email"} · reported by{" "}
                                {report.reporter.name} ({report.reporter.email ?? "no email"}) ·{" "}
                                {relativeTime(report.createdAt)}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            {report.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="cursor-pointer rounded-lg bg-white/5 text-xs"
                                onClick={() => void handleReportStatus(report._id, "reviewed")}
                                disabled={reportActing === report._id}
                              >
                                Mark reviewed
                              </Button>
                            )}
                            {report.status !== "resolved" && (
                              <Button
                                size="sm"
                                className="cursor-pointer rounded-lg text-xs"
                                onClick={() => void handleReportStatus(report._id, "resolved")}
                                disabled={reportActing === report._id}
                              >
                                Resolve
                              </Button>
                            )}
                          </div>
                        </div>

                        {report.details && (
                          <p className="mt-3 rounded-lg bg-white/[0.03] p-3 text-[13px] leading-relaxed text-muted-foreground">
                            “{report.details}”
                          </p>
                        )}

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {report.room && (
                            <Badge variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">
                              room: {report.room.name} ({report.room.status})
                            </Badge>
                          )}
                          {report.group && (
                            <Badge variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">
                              group: {report.group.name}
                            </Badge>
                          )}
                          {report.reportedGroupMemberships.map((group) => (
                            <Badge key={group.groupId} variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">
                              member of: {group.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ------- System ------- */}
          <TabsContent value="system" className="flex flex-col gap-4">
            <div className="glass-panel rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                    <Github className="size-4" /> GitHub connection
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Live check of the GITHUB_TOKEN used by the platform&apos;s
                    GitHub sync (pushing is managed from the Integrations tab).
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer rounded-lg bg-white/5"
                  onClick={() => void runGithubCheck()}
                  disabled={checkingGithub}
                >
                  {checkingGithub ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  Re-check
                </Button>
              </div>

              {checkingGithub && githubStatus === null ? (
                <div className="mt-4 flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Checking GitHub…
                </div>
              ) : !githubStatus ? (
                <p className="mt-4 py-6 text-sm text-muted-foreground">
                  Click re-check to test the token.
                </p>
              ) : !githubStatus.configured ? (
                <div className="mt-4 rounded-xl bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-200">
                  {githubStatus.error}
                </div>
              ) : !githubStatus.valid ? (
                <div className="mt-4 rounded-xl bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-200">
                  {githubStatus.error}
                </div>
              ) : (
                <div className="mt-4">
                  <p className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="size-4 text-emerald-300" />
                    Connected as{" "}
                    <span className="font-mono font-bold">@{githubStatus.login}</span>
                  </p>
                  {githubStatus.repos.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {githubStatus.repos.map((repo) => (
                        <Badge
                          key={repo.fullName}
                          variant="outline"
                          className="gap-1 font-mono text-[10px] text-muted-foreground"
                        >
                          {repo.private ? (
                            <Lock className="size-3 text-emerald-300" />
                          ) : (
                            <Globe className="size-3 text-amber-300" />
                          )}
                          {repo.fullName}
                        </Badge>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                    token scope: repo access · {githubStatus.repos.length} repos visible
                  </p>
                </div>
              )}
            </div>

            <div className="glass-panel rounded-2xl p-5">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">System status</h2>
                <p className="text-sm text-muted-foreground">
                  Read-only view of which keys are configured. Add or fix them in
                  the Keys / API keys tab — secrets are never shown here.
                </p>
              </div>
              <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
                {system?.keys.map((key) => (
                  <div
                    key={key.key}
                    className="flex items-center justify-between rounded-xl bg-white/4 px-3.5 py-2.5"
                  >
                    <span className="font-mono text-[11px] text-muted-foreground">{key.key}</span>
                    {key.configured ? (
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300">
                        <CheckCircle2 className="size-3.5" /> configured
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 font-mono text-[10px] text-amber-300">
                        <AlertTriangle className="size-3.5" /> missing
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {system?.convexUrl && (
                <p className="mt-4 truncate font-mono text-[10px] text-muted-foreground">
                  convex url: {system.convexUrl}
                </p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardShell>
  );
}
