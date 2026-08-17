// Admin command center — gated by the existing admin role check.
// Tabs: Dashboard (live charts + power users), Content (upload + manage),
// Users (usage + premium support), Finance (revenue analytics), Reports
// (student safety), System (env status). Every number here comes from the
// adminCenter queries — server-computed, never fabricated on the client.

import { api } from "@/convex/_generated/api";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
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
  Plug,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Terminal,
  Timer,
  Trash2,
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
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

function formatEventMeta(metadata: Record<string, unknown> | null): string {
  if (!metadata) return "";
  const entries = Object.entries(metadata)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}=${String(value)}`);
  return entries.length > 0 ? entries.join(" ") : "";
}

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

  // Every admin-only query below is gated with Convex's "skip" sentinel
  // until the admin check resolves to true. Otherwise a non-admin landing on
  // /admin fires all of them at once and the server-side "Admin access
  // required" errors crash the page (and the preview boundary).
  const adminAccess = isAdmin === true;

  // ---- Dashboard tab ----
  const dashboard = useQuery(
    api.adminCenter.getAdminDashboard,
    adminAccess ? undefined : "skip",
  );

  // ---- Finance tab ----
  const finance = useQuery(
    api.adminCenter.getFinanceOverview,
    adminAccess ? undefined : "skip",
  );

  // ---- Users tab ----
  const users = useQuery(api.adminCenter.listUsers, adminAccess ? undefined : "skip");
  const setUserPremium = useMutation(api.adminCenter.setUserPremium);
  const [premiumAction, setPremiumAction] = useState<{
    userId: string;
    action: "activate" | "expire" | "cancel";
  } | null>(null);
  const [acting, setActing] = useState(false);
  const [userQuery, setUserQuery] = useState("");

  // ---- System tab ----
  const system = useQuery(api.adminCenter.getSystemStatus, adminAccess ? undefined : "skip");
  const integrations = useQuery(
    api.adminCenter.getIntegrationStatus,
    adminAccess ? undefined : "skip",
  );
  const testIntegration = useAction(api.systemEvents.testIntegrationConnection);
  const [integrationResults, setIntegrationResults] = useState<Record<
    string,
    { ok: boolean; detail: string | null }
  >>({});
  const [testingIntegration, setTestingIntegration] = useState<string | null>(null);

  const runIntegrationTest = async (integration: string) => {
    setTestingIntegration(integration);
    try {
      const result = await testIntegration({ integration: integration as never });
      setIntegrationResults((prev) => ({ ...prev, [integration]: result }));
    } catch (error) {
      setIntegrationResults((prev) => ({
        ...prev,
        [integration]: {
          ok: false,
          detail: error instanceof Error ? error.message : "Connection test failed.",
        },
      }));
    } finally {
      setTestingIntegration(null);
    }
  };

  // ---- Terminal tab (system events) ----
  const convexClient = useConvex();
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [olderEvents, setOlderEvents] = useState<
    {
      _id: string;
      eventType: string;
      source: string;
      status: string;
      userId: string | null;
      metadata: Record<string, unknown> | null;
      durationMs: number | null;
      createdAt: number;
    }[]
  >([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const systemEvents = useQuery(
    api.systemEvents.getSystemEvents,
    adminAccess
      ? {
          eventType: eventFilter || undefined,
          status: (statusFilter || undefined) as "success" | "error" | undefined,
          since: sinceFilter ? Number(sinceFilter) : undefined,
        }
      : "skip",
  );
  const health = useQuery(
    api.systemEvents.getSystemHealthSummary,
    adminAccess ? undefined : "skip",
  );

  // "Load older" — keyset-paginated history appended below the live tail.
  const resetOlder = () => {
    setOlderEvents([]);
    setOlderCursor(null);
  };

  const loadOlderEvents = async () => {
    if (!adminAccess || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await convexClient.query(api.systemEvents.getSystemEvents, {
        eventType: eventFilter || undefined,
        status: (statusFilter || undefined) as "success" | "error" | undefined,
        since: sinceFilter ? Number(sinceFilter) : undefined,
        cursor: olderCursor ?? systemEvents?.nextCursor ?? undefined,
        limit: 60,
      });
      setOlderEvents((prev) => [...prev, ...page.events]);
      setOlderCursor(page.nextCursor);
    } catch {
      // the live tail keeps working even if an older-page fetch fails
    } finally {
      setLoadingOlder(false);
    }
  };

  // ---- Broadcast tab (Telegram) ----
  const channels = useQuery(api.telegram.listTelegramChannels, adminAccess ? undefined : "skip");
  const templates = useQuery(api.telegram.getBroadcastTemplates, adminAccess ? undefined : "skip");
  const broadcastLog = useQuery(api.telegram.getBroadcastLog, adminAccess ? undefined : "skip");
  const addChannel = useMutation(api.telegram.addTelegramChannel);
  const removeChannel = useMutation(api.telegram.removeTelegramChannel);
  const setAutoPost = useMutation(api.telegram.setAutoPost);
  const sendBroadcastAction = useAction(api.telegramActions.sendBroadcast);
  const [channelName, setChannelName] = useState("");
  const [channelChatId, setChannelChatId] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);
  const [autoPostActing, setAutoPostActing] = useState<string | null>(null);

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
  const reports = useQuery(api.safety.listReports, adminAccess ? undefined : "skip");
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

  const handleAddChannel = async () => {
    if (addingChannel) return;
    if (!channelName.trim() || !channelChatId.trim()) {
      toast.error("Channel name and chat id are required.");
      return;
    }
    setAddingChannel(true);
    try {
      await addChannel({ name: channelName.trim(), chatId: channelChatId.trim() });
      toast.success("Channel added. Auto-post starts OFF — toggle it if you want it.");
      setChannelName("");
      setChannelChatId("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add the channel.");
    } finally {
      setAddingChannel(false);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    try {
      await removeChannel({ channelId: channelId as never });
      setSelectedChannels((prev) => prev.filter((id) => id !== channelId));
      toast.success("Channel removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the channel.");
    }
  };

  const handleToggleAutoPost = async (channelId: string, enabled: boolean) => {
    setAutoPostActing(channelId);
    try {
      await setAutoPost({ channelId: channelId as never, enabled });
      toast.success(enabled ? "Auto-post enabled for this channel." : "Auto-post disabled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update auto-post.");
    } finally {
      setAutoPostActing(null);
    }
  };

  const handleBroadcast = async () => {
    if (broadcasting) return;
    if (selectedChannels.length === 0) {
      toast.error("Pick at least one channel to broadcast to.");
      return;
    }
    if (!broadcastMessage.trim()) {
      toast.error("Write a message first.");
      return;
    }
    setBroadcasting(true);
    try {
      const result = await sendBroadcastAction({
        channelIds: selectedChannels as never[],
        message: broadcastMessage.trim(),
      });
      toast.success(`Broadcast sent — ${result.sent} delivered${result.failed > 0 ? `, ${result.failed} failed` : ""}.`);
      setBroadcastMessage("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Broadcast failed.");
    } finally {
      setBroadcasting(false);
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
          className="flex flex-col gap-4 lg:flex-row lg:items-start"
        >
          {/* Command-center rail: horizontal scroll on mobile, sidebar on lg */}
          <TabsList className="glass-panel flex w-full shrink-0 items-center gap-1 overflow-x-auto rounded-2xl p-2 lg:w-56 lg:flex-col lg:items-stretch lg:overflow-visible lg:p-2.5">
            <TabsTrigger value="dashboard" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <Activity className="size-4" /> Dashboard
            </TabsTrigger>
            <TabsTrigger value="content" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <FileText className="size-4" /> Content
            </TabsTrigger>
            <TabsTrigger value="users" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <UserRound className="size-4" /> Users
            </TabsTrigger>
            <TabsTrigger value="finance" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <Wallet className="size-4" /> Finance
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <Flag className="size-4" /> Reports
            </TabsTrigger>
            <TabsTrigger value="terminal" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <Terminal className="size-4" /> Terminal
            </TabsTrigger>
            <TabsTrigger value="broadcast" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <Send className="size-4" /> Broadcast
            </TabsTrigger>
            <TabsTrigger value="system" className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm lg:w-full lg:justify-start">
              <KeyRound className="size-4" /> System
            </TabsTrigger>
          </TabsList>

          <div className="flex min-w-0 flex-1 flex-col gap-4">

          {/* ------- Dashboard ------- */}
          <TabsContent value="dashboard" className="flex flex-col gap-4">
            {dashboard === undefined ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Live totals */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
                <div className="grid gap-4 2xl:grid-cols-3">
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
                <div className="grid gap-4 2xl:grid-cols-3">
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

          {/* ------- Terminal (live system events) ------- */}
          <TabsContent value="terminal" className="flex flex-col gap-4">
            <div className="glass-panel rounded-2xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                    <Terminal className="size-4 text-primary" /> System terminal
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Live feed of the platform&apos;s critical paths — AI calls,
                    payments, rooms, uploads. Updates in real time via Convex
                    reactivity (no polling).
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <select
                    value={eventFilter}
                    onChange={(e) => {
                      setEventFilter(e.target.value);
                      resetOlder();
                    }}
                    aria-label="Filter by event type"
                    className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none"
                  >
                    <option value="">all types</option>
                    {["api_call", "error", "auth_event", "payment_event", "room_event", "content_event"].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      resetOlder();
                    }}
                    aria-label="Filter by status"
                    className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none"
                  >
                    <option value="">all statuses</option>
                    <option value="success">success</option>
                    <option value="error">error</option>
                  </select>
                  <select
                    value={sinceFilter}
                    onChange={(e) => {
                      setSinceFilter(e.target.value);
                      resetOlder();
                    }}
                    aria-label="Filter by date range"
                    className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none"
                  >
                    <option value="">all time</option>
                    <option value="86400000">last 24h</option>
                    <option value="604800000">last 7d</option>
                  </select>
                </div>
              </div>

              {/* Health strip */}
              {health === undefined ? (
                <div className="mt-4 flex h-14 items-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="rounded-xl bg-white/4 px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      events 24h
                    </p>
                    <p className="mt-1 font-mono text-lg font-extrabold tabular-nums">
                      {health.last24hCount}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/4 px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      error rate
                    </p>
                    <p className={cn("mt-1 font-mono text-lg font-extrabold tabular-nums", health.errorRate > 0.05 ? "text-rose-300" : "text-emerald-300")}>
                      {(health.errorRate * 100).toFixed(1)}%
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/4 px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      AI latency avg
                    </p>
                    <p className="mt-1 font-mono text-lg font-extrabold tabular-nums">
                      {health.avgAiLatencyMs > 0 ? `${health.avgAiLatencyMs}ms` : "—"}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/4 px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      AI calls 24h
                    </p>
                    <p className="mt-1 font-mono text-lg font-extrabold tabular-nums">
                      {health.aiCallsLast24h}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/4 px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      active now
                    </p>
                    <p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-primary">
                      {health.activeUsersRightNow}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white/4 px-3 py-2.5">
                    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      by type
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] font-bold text-muted-foreground">
                      {health.byType.map((entry) => `${entry.eventType}:${entry.count}`).join(" · ") || "—"}
                    </p>
                  </div>
                </div>
              )}

              {/* Live feed */}
              <div className="mt-4 overflow-hidden rounded-xl border border-white/5 bg-black/40">
                <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                  <span className="size-2 rounded-full bg-rose-400/80" />
                  <span className="size-2 rounded-full bg-amber-400/80" />
                  <span className="size-2 rounded-full bg-emerald-400/80" />
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    nexus://system-events --tail -f
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px] text-emerald-300">
                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> live
                  </span>
                </div>
                <div className="max-h-[26rem] overflow-y-auto p-3 font-mono text-[11px] leading-5">
                  {systemEvents === undefined ? (
                    <div className="flex items-center gap-2 py-6 text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" /> connecting…
                    </div>
                  ) : systemEvents.events.length === 0 && olderEvents.length === 0 ? (
                    <p className="py-6 text-muted-foreground">
                      no events yet — actions will stream in as students use the platform
                    </p>
                  ) : (
                    <>
                      {systemEvents.events.map((event) => (
                        <div key={event._id} className="flex gap-2 border-b border-white/[0.03] py-1.5 last:border-0">
                          <span className="shrink-0 text-muted-foreground/70">
                            {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-bold",
                              event.status === "error" ? "text-rose-300" : "text-emerald-300",
                            )}
                          >
                            {event.status === "error" ? "✖" : "✓"}
                          </span>
                          <span className="shrink-0 text-primary">{event.eventType}</span>
                          <span className="shrink-0 text-amber-200/80">{event.source}</span>
                          {event.durationMs !== null && (
                            <span className="shrink-0 text-muted-foreground">
                              {event.durationMs}ms
                            </span>
                          )}
                          <span className="truncate text-muted-foreground/80">
                            {formatEventMeta(event.metadata)}
                          </span>
                        </div>
                      ))}
                      {olderEvents.map((event) => (
                        <div key={event._id} className="flex gap-2 border-b border-white/[0.03] py-1.5 last:border-0">
                          <span className="shrink-0 text-muted-foreground/70">
                            {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}
                          </span>
                          <span
                            className={cn(
                              "shrink-0 font-bold",
                              event.status === "error" ? "text-rose-300" : "text-emerald-300",
                            )}
                          >
                            {event.status === "error" ? "✖" : "✓"}
                          </span>
                          <span className="shrink-0 text-primary">{event.eventType}</span>
                          <span className="shrink-0 text-amber-200/80">{event.source}</span>
                          {event.durationMs !== null && (
                            <span className="shrink-0 text-muted-foreground">
                              {event.durationMs}ms
                            </span>
                          )}
                          <span className="truncate text-muted-foreground/80">
                            {formatEventMeta(event.metadata)}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
                {(systemEvents !== undefined &&
                  (systemEvents.nextCursor !== null || olderCursor !== null)) && (
                  <button
                    onClick={loadOlderEvents}
                    disabled={loadingOlder}
                    className="flex w-full items-center justify-center gap-2 border-t border-white/5 py-2 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    {loadingOlder ? (
                      <>
                        <Loader2 className="size-3 animate-spin" /> loading older…
                      </>
                    ) : (
                      "⌥ load older events"
                    )}
                  </button>
                )}
              </div>
            </div>
            <div className="glass-panel rounded-2xl p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                  <Plug className="size-4 text-primary" /> Integrations
                </h2>
                <p className="text-sm text-muted-foreground">
                  Configuration status plus real 24h usage per service. Secret
                  values are never displayed — even here. Test buttons ping each
                  provider with a read-only call.
                </p>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {(integrations ?? []).map((integration) => {
                  const testResult = integrationResults[integration.id];
                  return (
                    <div
                      key={integration.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl bg-white/4 px-3.5 py-2.5"
                    >
                      <span className="w-44 shrink-0 text-sm font-semibold">
                        {integration.label}
                      </span>
                      {integration.configured ? (
                        <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300">
                          <CheckCircle2 className="size-3.5" /> configured
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5 font-mono text-[10px] text-amber-300">
                          <AlertTriangle className="size-3.5" /> key missing
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {integration.calls24h} calls ·{" "}
                        {(integration.errorRate * 100).toFixed(0)}% err ·{" "}
                        {integration.lastUsedAt
                          ? relativeTime(integration.lastUsedAt)
                          : "never used"}
                      </span>
                      {["xai", "gemini", "telegram", "github"].includes(integration.id) && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-auto h-7 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"
                          onClick={() => void runIntegrationTest(integration.id)}
                          disabled={testingIntegration === integration.id}
                        >
                          {testingIntegration === integration.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <RefreshCw className="size-3" />
                          )}
                          Test
                        </Button>
                      )}
                      {testResult && (
                        <p
                          className={cn(
                            "w-full font-mono text-[10px]",
                            testResult.ok ? "text-emerald-300" : "text-rose-300",
                          )}
                        >
                          {testResult.detail ?? (testResult.ok ? "connected" : "failed")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </TabsContent>

          {/* ------- Broadcast (Telegram) ------- */}
          <TabsContent value="broadcast" className="flex flex-col gap-4">
            <div className="glass-panel rounded-2xl p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
                  <Send className="size-4 text-primary" /> Telegram broadcast
                </h2>
                <p className="text-sm text-muted-foreground">
                  Send a message to one or more channels. Broadcasting is always
                  an explicit action — and auto-post on new content is OFF per
                  channel until you toggle it.
                </p>
              </div>

              {integrations?.find((integration) => integration.id === "telegram")
                ?.configured === false && (
                <Alert className="glass-soft mt-4 border-amber-400/25 bg-amber-400/10">
                  <AlertTriangle className="size-4 text-amber-300" />
                  <AlertTitle className="text-amber-300">
                    TELEGRAM_BOT_TOKEN not set
                  </AlertTitle>
                  <AlertDescription className="text-amber-200/80">
                    Create a bot with @BotFather and paste its token in the Keys
                    tab before broadcasting. Channels can be added now and will
                    work the moment the key lands.
                  </AlertDescription>
                </Alert>
              )}

              {/* Channels */}
              <div className="mt-5">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  channels
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {channels === undefined ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : channels.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border bg-white/[0.02] px-4 py-6 text-center text-sm text-muted-foreground">
                      No channels yet — add the first one below.
                    </p>
                  ) : (
                    channels.map((channel) => (
                      <div
                        key={channel._id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{channel.name}</p>
                          <p className="truncate font-mono text-[10px] text-muted-foreground">
                            chat id: {channel.chatId}
                          </p>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-muted-foreground">
                          <Switch
                            checked={channel.autoPost}
                            disabled={autoPostActing === channel._id}
                            onCheckedChange={(next) => void handleToggleAutoPost(channel._id, next)}
                          />
                          auto-post
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 cursor-pointer text-muted-foreground hover:text-rose-300"
                          onClick={() => void handleRemoveChannel(channel._id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Add channel */}
              <div className="mt-4 flex flex-wrap gap-2">
                <Input
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  placeholder="Channel name (e.g. Grade 12 Physics)"
                  className="h-9 w-56 rounded-xl bg-white/5 font-mono text-xs"
                />
                <Input
                  value={channelChatId}
                  onChange={(e) => setChannelChatId(e.target.value)}
                  placeholder="chat id (e.g. -1001234567890)"
                  className="h-9 w-56 rounded-xl bg-white/5 font-mono text-xs"
                />
                <Button
                  size="sm"
                  className="h-9 cursor-pointer rounded-xl"
                  onClick={() => void handleAddChannel()}
                  disabled={addingChannel}
                >
                  {addingChannel ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                  Add channel
                </Button>
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                How to get a chat id: add your bot to the group/channel, then send
                any message and open{" "}
                <code className="rounded bg-white/10 px-1">
                  https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates
                </code>{" "}
                — the numeric id appears in the result.
              </p>
            </div>

            {/* Composer */}
            <div className="glass-panel rounded-2xl p-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                compose broadcast
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(templates ?? []).map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => setBroadcastMessage(template.text)}
                    className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    {template.id}
                  </button>
                ))}
              </div>
              <Textarea
                value={broadcastMessage}
                onChange={(e) => setBroadcastMessage(e.target.value)}
                placeholder="Write the message… (HTML is supported)"
                className="mt-3 min-h-24 rounded-xl bg-white/5 font-mono text-xs"
              />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {(channels ?? []).map((channel) => (
                  <label
                    key={channel._id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[11px] transition-colors",
                      selectedChannels.includes(channel._id)
                        ? "border-primary/50 bg-primary/10 text-primary"
                        : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/25",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--primary)]"
                      checked={selectedChannels.includes(channel._id)}
                      onChange={(e) =>
                        setSelectedChannels((prev) =>
                          e.target.checked
                            ? [...prev, channel._id]
                            : prev.filter((id) => id !== channel._id),
                        )
                      }
                    />
                    {channel.name}
                  </label>
                ))}
              </div>
              <Button
                onClick={() => void handleBroadcast()}
                disabled={broadcasting}
                className="mt-4 h-10 cursor-pointer rounded-xl"
              >
                {broadcasting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Send broadcast
              </Button>
            </div>

            {/* Log */}
            <div className="glass-panel rounded-2xl p-5">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                broadcast history
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {(broadcastLog ?? []).length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    Nothing broadcast yet.
                  </p>
                ) : (
                  (broadcastLog ?? []).map((entry) => (
                    <div key={entry._id} className="rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm">{entry.message}</p>
                        <Badge
                          className={cn(
                            "shrink-0 font-mono text-[9px]",
                            entry.status === "sent"
                              ? "bg-emerald-400/10 text-emerald-300"
                              : "bg-rose-400/10 text-rose-300",
                          )}
                        >
                          {entry.status}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {entry.channels.join(", ")} · {relativeTime(entry.sentAt)}
                      </p>
                    </div>
                  ))
                )}
              </div>
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
          </div>
        </Tabs>
      </div>
    </DashboardShell>
  );
}
