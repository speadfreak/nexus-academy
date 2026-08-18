// Admin command center — gated by the existing admin role check.
// Layout: sidebar nav (left) + scrollable content (right).  Uses plain
// button-based tab switching to avoid shadcn Tabs internal DOM breaking
// the flex layout behind Cloudflare/Render.

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
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/* ── Constants ──────────────────────────────────────────────────────── */

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

const ADMIN_TABS = [
  { id: "dashboard", label: "Dashboard", index: "01", icon: Activity },
  { id: "content", label: "Content", index: "02", icon: FileText },
  { id: "users", label: "Users", index: "03", icon: UserRound },
  { id: "finance", label: "Finance", index: "04", icon: Wallet },
  { id: "reports", label: "Reports", index: "05", icon: Flag },
  { id: "terminal", label: "Terminal", index: "06", icon: Terminal },
  { id: "broadcast", label: "Broadcast", index: "07", icon: Send },
  { id: "system", label: "System", index: "08", icon: KeyRound },
] as const;

type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

/* ── Small helpers ──────────────────────────────────────────────────── */

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
      {now.toLocaleTimeString([], { hour12: false })}{" "}
      <span className="text-primary">UTC</span>
    </span>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone?: "ok" | "warn";
}) {
  return (
    <span
      className={cn(
        "glass-chip flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em]",
        tone === "ok"
          ? "text-emerald-300"
          : tone === "warn"
            ? "text-amber-300"
            : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "size-1.5 animate-pulse rounded-full",
          tone === "ok"
            ? "bg-emerald-300"
            : tone === "warn"
              ? "bg-amber-300"
              : "bg-muted-foreground/60",
        )}
      />
      {label}
    </span>
  );
}

function fmtMoney(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

function formatEventMeta(m: Record<string, unknown> | null) {
  if (!m) return "";
  return Object.entries(m)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "N"
  );
}

/* ── Reusable card components ───────────────────────────────────────── */

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
        "admin-stat group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-4 transition-colors hover:border-primary/30",
        money && "border-primary/25 bg-primary/[0.06]",
      )}
    >
      <span className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
            money
              ? "bg-primary/15 text-primary"
              : "bg-white/5 text-muted-foreground group-hover:text-primary",
          )}
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-2.5 font-mono text-2xl font-bold tabular-nums text-gradient sm:text-3xl">
        {value}
      </p>
      {sub && (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
          {sub}
        </p>
      )}
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
      {sub && (
        <p className="mt-1 text-sm text-muted-foreground">{sub}</p>
      )}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ADMIN PAGE
   ══════════════════════════════════════════════════════════════════════ */

export default function Admin() {
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const promoteSelf = useMutation(api.admin.promoteSelfIfBootstrap);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") ?? "dashboard") as AdminTabId;
  const setTab = (id: AdminTabId) =>
    setSearchParams(id === "dashboard" ? {} : { tab: id });

  const adminAccess = isAdmin === true;

  /* ── Dashboard ── */
  const dashboard = useQuery(
    api.adminCenter.getAdminDashboard,
    adminAccess ? undefined : "skip",
  );

  /* ── Finance ── */
  const finance = useQuery(
    api.adminCenter.getFinanceOverview,
    adminAccess ? undefined : "skip",
  );

  /* ── Users ── */
  const users = useQuery(
    api.adminCenter.listUsers,
    adminAccess ? undefined : "skip",
  );
  const setUserPremium = useMutation(api.adminCenter.setUserPremium);
  const [premiumAction, setPremiumAction] = useState<{
    userId: string;
    action: "activate" | "expire" | "cancel";
  } | null>(null);
  const [acting, setActing] = useState(false);
  const [userQuery, setUserQuery] = useState("");

  /* ── System ── */
  const system = useQuery(
    api.adminCenter.getSystemStatus,
    adminAccess ? undefined : "skip",
  );
  const integrations = useQuery(
    api.adminCenter.getIntegrationStatus,
    adminAccess ? undefined : "skip",
  );
  const testIntegration = useAction(api.systemEvents.testIntegrationConnection);
  const [integrationResults, setIntegrationResults] = useState<
    Record<string, { ok: boolean; detail: string | null }>
  >({});
  const [testingIntegration, setTestingIntegration] = useState<string | null>(
    null,
  );
  const runIntegrationTest = async (integration: string) => {
    setTestingIntegration(integration);
    try {
      const r = await testIntegration({ integration: integration as never });
      setIntegrationResults((p) => ({ ...p, [integration]: r }));
    } catch (error) {
      setIntegrationResults((p) => ({
        ...p,
        [integration]: {
          ok: false,
          detail: error instanceof Error ? error.message : "Failed.",
        },
      }));
    } finally {
      setTestingIntegration(null);
    }
  };

  /* ── Terminal (system events) ── */
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
          status: (statusFilter || undefined) as
            | "success"
            | "error"
            | undefined,
          since: sinceFilter ? Number(sinceFilter) : undefined,
        }
      : "skip",
  );

  const liveFeed = Array.isArray(systemEvents)
    ? systemEvents
    : (systemEvents?.events ?? []);
  const liveHasMore =
    !Array.isArray(systemEvents) &&
    (systemEvents?.nextCursor ?? null) !== null;

  const health = useQuery(
    api.systemEvents.getSystemHealthSummary,
    adminAccess ? undefined : "skip",
  );

  const resetOlder = () => {
    setOlderEvents([]);
    setOlderCursor(null);
  };

  const loadOlderEvents = async () => {
    if (!adminAccess || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await convexClient.query(
        api.systemEvents.getSystemEvents,
        {
          eventType: eventFilter || undefined,
          status: (statusFilter || undefined) as
            | "success"
            | "error"
            | undefined,
          since: sinceFilter ? Number(sinceFilter) : undefined,
          cursor:
            olderCursor ??
            (Array.isArray(systemEvents)
              ? undefined
              : (systemEvents?.nextCursor ?? undefined)),
          limit: 60,
        },
      );
      setOlderEvents((p) => [...p, ...page.events]);
      setOlderCursor(page.nextCursor);
    } catch {
      /* keep live tail working */
    } finally {
      setLoadingOlder(false);
    }
  };

  /* ── Broadcast (Telegram) ── */
  const channels = useQuery(
    api.telegram.listTelegramChannels,
    adminAccess ? undefined : "skip",
  );
  const templates = useQuery(
    api.telegram.getBroadcastTemplates,
    adminAccess ? undefined : "skip",
  );
  const broadcastLog = useQuery(
    api.telegram.getBroadcastLog,
    adminAccess ? undefined : "skip",
  );
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

  /* ── GitHub ── */
  const verifyGithub = useAction(api.github.verifyGithubConnection);
  const [githubStatus, setGithubStatus] = useState<{
    configured: boolean;
    valid: boolean;
    login: string | null;
    repos: {
      fullName: string;
      private: boolean;
      pushedAt: string | null;
    }[];
    error: string | null;
  } | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);

  const runGithubCheck = async () => {
    setCheckingGithub(true);
    try {
      const r = await verifyGithub();
      setGithubStatus(r);
    } catch (error) {
      setGithubStatus({
        configured: true,
        valid: false,
        login: null,
        repos: [],
        error:
          error instanceof Error ? error.message : "Connection check failed.",
      });
    } finally {
      setCheckingGithub(false);
    }
  };

  useEffect(() => {
    if (tab === "system" && githubStatus === null && !checkingGithub)
      void runGithubCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* ── Reports ── */
  const reports = useQuery(
    api.safety.listReports,
    adminAccess ? undefined : "skip",
  );
  const updateReportStatus = useMutation(api.safety.updateReportStatus);
  const [reportFilter, setReportFilter] = useState("open");
  const [reportActing, setReportActing] = useState<string | null>(null);

  const handleReportStatus = async (
    reportId: string,
    status: "open" | "reviewed" | "resolved",
  ) => {
    setReportActing(reportId);
    try {
      await updateReportStatus({ reportId: reportId as never, status });
      toast.success(`Report marked ${status}.`);
    } catch {
      toast.error("Could not update the report.");
    } finally {
      setReportActing(null);
    }
  };

  /* ── Handlers ── */
  const handlePromote = async () => {
    const r = await promoteSelf();
    r.promoted
      ? toast.success("Admin access granted. Welcome!")
      : toast.error(
          "Could not grant admin access — an admin account already exists.",
        );
  };

  const handleAddChannel = async () => {
    if (addingChannel) return;
    if (!channelName.trim() || !channelChatId.trim()) {
      toast.error("Channel name and chat id are required.");
      return;
    }
    setAddingChannel(true);
    try {
      await addChannel({
        name: channelName.trim(),
        chatId: channelChatId.trim(),
      });
      toast.success(
        "Channel added. Auto-post starts OFF — toggle it if you want it.",
      );
      setChannelName("");
      setChannelChatId("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add the channel.",
      );
    } finally {
      setAddingChannel(false);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    try {
      await removeChannel({ channelId: channelId as never });
      setSelectedChannels((p) => p.filter((id) => id !== channelId));
      toast.success("Channel removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the channel.",
      );
    }
  };

  const handleToggleAutoPost = async (channelId: string, enabled: boolean) => {
    setAutoPostActing(channelId);
    try {
      await setAutoPost({ channelId: channelId as never, enabled });
      toast.success(
        enabled
          ? "Auto-post enabled for this channel."
          : "Auto-post disabled.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update auto-post.",
      );
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
      const r = await sendBroadcastAction({
        channelIds: selectedChannels as never[],
        message: broadcastMessage.trim(),
      });
      toast.success(
        `Broadcast sent — ${r.sent} delivered${r.failed > 0 ? `, ${r.failed} failed` : ""}.`,
      );
      setBroadcastMessage("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Broadcast failed.",
      );
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
      toast.error("Action failed.");
    } finally {
      setActing(false);
    }
  };

  /* ── Early returns ── */
  if (isAdmin === undefined)
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );

  if (!isAdmin)
    return (
      <DashboardShell>
        <div className="glass-soft mx-auto flex max-w-lg flex-col items-center rounded-2xl px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight">
            Admins only
          </h1>
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

  /* ── Derived data ── */
  const filteredUsers =
    users?.filter((u) => {
      const q = userQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.displayName ?? "").toLowerCase().includes(q)
      );
    }) ?? [];

  const donutData =
    dashboard?.subscriptionBreakdown.filter((e) => e.count > 0) ?? [];
  const maxStream = Math.max(
    1,
    ...(dashboard?.usersByStream.map((s) => s.count) ?? [1]),
  );

  /* ════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════ */
  return (
    <DashboardShell>
      <div className="admin-surface flex min-h-0 flex-col gap-5 pb-32 sm:gap-6">
        {/* ── Command header ── */}
        <div className="admin-command-header relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.035] px-4 py-5 sm:px-6 sm:py-6">
          <div className="admin-grid-bg pointer-events-none absolute inset-0" />
          <div className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-[radial-gradient(ellipse_at_right,rgba(112,196,255,0.12),transparent_68%)]" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                // control center
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Chip label="convex linked" tone="ok" />
                <LiveClock />
              </div>
            </div>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">
              Command center
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Users, money, content, activity and safety — the whole platform
              in one place.
            </p>
          </div>
        </div>

        {/* ── Main layout: sidebar + content ── */}
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:gap-6">
          {/* Sidebar nav */}
          <nav className="glass-panel flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl p-1.5 sm:p-2 xl:w-56 xl:flex-col xl:overflow-x-visible xl:overflow-y-auto xl:p-2.5 xl:sticky xl:top-24 xl:self-start">
            {ADMIN_TABS.map(({ id, label, index, icon: TabIcon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "group flex shrink-0 cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-medium transition-all sm:text-sm",
                  "xl:w-full xl:justify-start",
                  tab === id
                    ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgba(112,196,255,0.18),0_8px_24px_-18px_rgba(112,196,255,0.8)]"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    tab === id
                      ? "bg-primary/15 text-primary"
                      : "bg-white/5 text-muted-foreground group-hover:text-primary",
                  )}
                >
                  <TabIcon className="size-4" />
                </span>
                <span>{label}</span>
                <span className="ml-auto hidden font-mono text-[9px] text-muted-foreground/50 xl:inline">
                  {index}
                </span>
              </button>
            ))}
          </nav>

          {/* Content area */}
          <main className="flex min-w-0 flex-1 flex-col gap-4">
            {/* ══════ DASHBOARD ══════ */}
            {tab === "dashboard" && (
              <div className="flex min-w-0 flex-col gap-4">
                {dashboard === undefined ? (
                  <div className="flex h-40 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
                      <StatCard label="users" value={dashboard.totals.users} icon={Users} sub="all accounts" />
                      <StatCard label="active this week" value={dashboard.totals.activeThisWeek} icon={Activity} sub={`${dashboard.totals.activeToday} today`} />
                      <StatCard label="paying / trial" value={dashboard.totals.payingUsers} icon={Crown} sub="with premium access" />
                      <StatCard label="total earned" value={`${fmtMoney(dashboard.totals.revenueTotal)} ETB`} icon={Wallet} money sub={`${dashboard.totals.paymentsCompleted} payments`} />
                      <StatCard label="this month" value={`${fmtMoney(dashboard.totals.revenueThisMonth)} ETB`} icon={TrendingUp} money sub="completed payments" />
                      <StatCard label="content items" value={dashboard.totals.contentItems} icon={FileText} sub="in the library" />
                    </div>

                    <div className="grid gap-4 2xl:grid-cols-3">
                      <ChartCard title="revenue · last 12 months" sub="Money earned from completed payments, in ETB" className="lg:col-span-2">
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={dashboard.revenueByMonth} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                              <defs><linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient></defs>
                              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                              <Area type="monotone" dataKey="revenue" stroke="var(--primary)" strokeWidth={2} fill="url(#revGrad)" name="ETB" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </ChartCard>
                      <ChartCard title="subscriptions" sub="Premium access split">
                        <div className="h-40">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={donutData} dataKey="count" nameKey="status" innerRadius={46} outerRadius={68} paddingAngle={3} stroke="none">
                                {donutData.map((e, i) => <Cell key={e.status} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
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
                      </ChartCard>
                    </div>

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
                      <ChartCard title="revenue by provider" sub="ETB from completed payments">
                        <div className="h-44">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={dashboard.revenueByProvider} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="provider" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
                              <Bar dataKey="total" fill="var(--chart-3)" radius={[6, 6, 0, 0]} name="ETB" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </ChartCard>
                      <div className="glass-panel flex flex-col gap-4 rounded-2xl p-5">
                        <div>
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">streams</p>
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
                          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">content inventory</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {dashboard.contentByType.map((e) => (
                              <Badge key={e.contentType} className="gap-1 bg-white/5 font-mono text-[9px] text-muted-foreground">
                                {CONTENT_TYPE_LABELS[e.contentType] ?? e.contentType} · {e.count}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-5">
                      <div className="glass-panel rounded-2xl p-5 lg:col-span-3">
                        <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                          <Trophy className="size-3.5 text-primary" /> power users · ranked by XP
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">The students actually using the platform — XP aggregates every study action.</p>
                        <div className="mt-4 flex flex-col gap-2">
                          {dashboard.powerUsers.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">No study activity yet.</p>
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
                      </div>
                      <div className="glass-panel rounded-2xl p-5 lg:col-span-2">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">recent signups</p>
                        <div className="mt-4 flex flex-col gap-2">
                          {dashboard.recentSignups.map((u) => (
                            <div key={u.userId} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 font-mono text-xs font-extrabold text-muted-foreground">{initials(u.name)}</div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold">{u.name}{u.isAnonymous && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">guest</span>}</p>
                                <p className="truncate font-mono text-[10px] text-muted-foreground">{u.email ?? "no email"}</p>
                              </div>
                              <p className="shrink-0 font-mono text-[10px] text-muted-foreground">{relativeTime(u.createdAt)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══════ CONTENT ══════ */}
            {tab === "content" && (
              <div className="min-w-0">
                <AdminContentSection />
              </div>
            )}

            {/* ══════ USERS ══════ */}
            {tab === "users" && (
              <div className="glass-panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">Users</h2>
                    <p className="text-sm text-muted-foreground">Who signed up, who's actually studying, and premium access management.</p>
                  </div>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder="Search users…" className="h-9 w-56 rounded-xl bg-white/5 pl-9 font-mono text-xs" />
                  </div>
                </div>
                <div className="mt-4 overflow-x-auto">
                  {users === undefined ? (
                    <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                  ) : filteredUsers.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">No users match.</p>
                  ) : (
                    <Table>
                      <TableHeader><TableRow className="hover:bg-transparent"><TableHead>User</TableHead><TableHead>Stream</TableHead><TableHead>Subscription</TableHead><TableHead>Usage</TableHead><TableHead>Last active</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {filteredUsers.map((u) => (
                          <TableRow key={u._id} className="hover:bg-white/5">
                            <TableCell className="max-w-[13rem]">
                              <p className="truncate font-semibold">{u.displayName ?? u.name ?? "Guest"}{u.isAnonymous && <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">anonymous</span>}</p>
                              <p className="truncate font-mono text-[10px] text-muted-foreground">{u.email ?? "no email"}</p>
                            </TableCell>
                            <TableCell className="font-mono text-[11px] text-muted-foreground">{u.stream ?? "—"}</TableCell>
                            <TableCell>
                              <Badge className={cn("gap-1 font-mono text-[10px]", SUB_STATUS_STYLES[u.subscriptionStatus])}>
                                {u.subscriptionStatus}{u.subscriptionStatus === "trial" ? ` · ${u.trialActiveDays}/14` : ""}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <p className="font-mono text-[10px] tabular-nums text-muted-foreground">{u.usage.studyHours} h · {u.usage.sessions} sess · {u.usage.quizzes} quiz</p>
                              <p className="font-mono text-[10px] font-bold tabular-nums text-primary">{u.usage.xp} XP</p>
                            </TableCell>
                            <TableCell className="font-mono text-[10px] text-muted-foreground">{u.usage.lastActiveAt ? relativeTime(u.usage.lastActiveAt) : "never"}</TableCell>
                            <TableCell className="text-right">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-8 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"><Crown className="size-3" /> Manage</Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent className="glass-panel">
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Manage premium access</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      <span className="font-semibold">{u.displayName ?? u.name ?? u.email ?? "This user"}</span> is currently <span className="font-semibold">{u.subscriptionStatus}</span>.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <div className="flex flex-col gap-2">
                                    <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setPremiumAction({ userId: u._id, action: "activate" })}><CheckCircle2 className="size-4 text-emerald-300" /> Activate premium (30 days)</Button>
                                    <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setPremiumAction({ userId: u._id, action: "expire" })}><AlertTriangle className="size-4 text-amber-300" /> Expire premium now</Button>
                                    <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setPremiumAction({ userId: u._id, action: "cancel" })}><XCircle className="size-4 text-rose-300" /> Cancel subscription</Button>
                                  </div>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel className="rounded-xl">Close</AlertDialogCancel>
                                    {premiumAction?.userId === u._id && (
                                      <AlertDialogAction className="cursor-pointer rounded-xl" disabled={acting} onClick={() => handlePremiumAction()}>
                                        {acting ? <Loader2 className="size-4 animate-spin" /> : <>Confirm <ChevronRight className="size-4" /></>}
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
            )}

            {/* ══════ FINANCE ══════ */}
            {tab === "finance" && (
              <div className="flex min-w-0 flex-col gap-4">
                {finance === undefined ? (
                  <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                      <StatCard label="total earned" value={`${fmtMoney(finance.totalEarned)} ETB`} icon={Wallet} money sub={`${finance.completedCount} completed payments`} />
                      <StatCard label="this month" value={`${fmtMoney(finance.thisMonth)} ETB`} icon={TrendingUp} money sub="completed payments" />
                      <StatCard label="last 30 days" value={`${fmtMoney(finance.last30Days)} ETB`} icon={Timer} money />
                      <StatCard label="avg payment" value={`${fmtMoney(finance.avgPayment)} ETB`} icon={Zap} sub={`${finance.pendingCount} pending · ${finance.failedCount} failed`} />
                      <StatCard label="conversion" value={`${(finance.conversionRate * 100).toFixed(1)}%`} icon={Users} sub={`${finance.payingUsers} paying / trial`} />
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                      <ChartCard title="revenue · last 12 months" sub="Completed payments in ETB" className="lg:col-span-2">
                        <div className="h-60">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={finance.revenueByMonth} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                              <defs><linearGradient id="finGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} /></linearGradient></defs>
                              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                              <Area type="monotone" dataKey="revenue" stroke="var(--chart-4)" strokeWidth={2} fill="url(#finGrad)" name="ETB" />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </ChartCard>
                      <ChartCard title="by provider" sub="ETB from completed payments">
                        <div className="flex h-full min-h-48 flex-col justify-center gap-3">
                          {finance.revenueByProvider.length === 0 ? (
                            <p className="py-10 text-center text-sm text-muted-foreground">No completed payments yet.</p>
                          ) : finance.revenueByProvider.map((e, i) => {
                            const max = Math.max(1, ...finance.revenueByProvider.map((p) => p.total));
                            return (
                              <div key={e.provider}>
                                <div className="flex items-center justify-between font-mono text-[11px]">
                                  <span className="flex items-center gap-2 capitalize"><span className="size-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />{e.provider}</span>
                                  <span className="font-bold tabular-nums">{fmtMoney(e.total)} ETB</span>
                                </div>
                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${(e.total / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} /></div>
                                <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{e.count} payments</p>
                              </div>
                            );
                          })}
                        </div>
                      </ChartCard>
                    </div>
                    <div className="glass-panel rounded-2xl p-5">
                      <h2 className="text-lg font-extrabold tracking-tight">Recent transactions</h2>
                      <p className="text-sm text-muted-foreground">The latest payment attempts for reconciliation.</p>
                      <div className="mt-4 overflow-x-auto">
                        {finance.recentTransactions.length === 0 ? (
                          <p className="py-10 text-center text-sm text-muted-foreground">No payments yet.</p>
                        ) : (
                          <Table>
                            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>User</TableHead><TableHead>Provider</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Reference</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {finance.recentTransactions.map((p) => (
                                <TableRow key={p._id} className="hover:bg-white/5">
                                  <TableCell className="max-w-[12rem]"><p className="truncate text-sm font-semibold">{p.userName ?? "Guest"}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{p.userEmail ?? "no email"}</p></TableCell>
                                  <TableCell className="font-mono text-[11px] capitalize">{p.provider}</TableCell>
                                  <TableCell className="font-mono text-[11px] tabular-nums">{p.amount} {p.currency}</TableCell>
                                  <TableCell><Badge className={cn("font-mono text-[10px]", PAY_STATUS_STYLES[p.status])}>{p.status}</Badge></TableCell>
                                  <TableCell className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">{p.providerTransactionId ?? "—"}</TableCell>
                                  <TableCell className="font-mono text-[10px] text-muted-foreground">{relativeTime(p.createdAt)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ══════ REPORTS ══════ */}
            {tab === "reports" && (
              <div className="glass-panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">Safety reports</h2>
                    <p className="text-sm text-muted-foreground">Student reports with enough context to act.</p>
                  </div>
                  <div className="flex gap-1.5">
                    {["open", "reviewed", "resolved"].map((s) => (
                      <button key={s} type="button" onClick={() => setReportFilter(s)} className={cn("cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors", reportFilter === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5")}>{s}</button>
                    ))}
                  </div>
                </div>
                {reports === undefined ? (
                  <div className="mt-6 flex items-center justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {reports.filter((r) => r.status === reportFilter).length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No {reportFilter} reports.</p>}
                    {reports.filter((r) => r.status === reportFilter).map((r) => (
                      <div key={r._id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300"><Flag className="size-4" /></div>
                            <div>
                              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">{r.reported.name}<Badge className="border-rose-400/20 bg-rose-400/10 font-mono text-[9px] uppercase text-rose-300">{r.reason.replace(/_/g, " ")}</Badge></p>
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{r.reported.email ?? "no email"} · reported by {r.reporter.name} ({r.reporter.email ?? "no email"}) · {relativeTime(r.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            {r.status === "open" && <Button size="sm" variant="outline" className="cursor-pointer rounded-lg bg-white/5 text-xs" onClick={() => void handleReportStatus(r._id, "reviewed")} disabled={reportActing === r._id}>Mark reviewed</Button>}
                            {r.status !== "resolved" && <Button size="sm" className="cursor-pointer rounded-lg text-xs" onClick={() => void handleReportStatus(r._id, "resolved")} disabled={reportActing === r._id}>Resolve</Button>}
                          </div>
                        </div>
                        {r.details && <p className="mt-3 rounded-lg bg-white/[0.03] p-3 text-[13px] leading-relaxed text-muted-foreground">"{r.details}"</p>}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {r.room && <Badge variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">room: {r.room.name} ({r.room.status})</Badge>}
                          {r.group && <Badge variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">group: {r.group.name}</Badge>}
                          {r.reportedGroupMemberships.map((g) => <Badge key={g.groupId} variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">member of: {g.name}</Badge>)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══════ TERMINAL ══════ */}
            {tab === "terminal" && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="glass-panel rounded-2xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Terminal className="size-4 text-primary" /> System terminal</h2>
                      <p className="text-sm text-muted-foreground">Live feed of critical paths — AI, payments, rooms, uploads. Real-time via Convex.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <select value={eventFilter} onChange={(e) => { setEventFilter(e.target.value); resetOlder(); }} className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none">
                        <option value="">all types</option>
                        {["api_call", "error", "auth_event", "payment_event", "room_event", "content_event"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetOlder(); }} className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none">
                        <option value="">all statuses</option>
                        <option value="success">success</option>
                        <option value="error">error</option>
                      </select>
                      <select value={sinceFilter} onChange={(e) => { setSinceFilter(e.target.value); resetOlder(); }} className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none">
                        <option value="">all time</option>
                        <option value="86400000">last 24h</option>
                        <option value="604800000">last 7d</option>
                      </select>
                    </div>
                  </div>
                  {health === undefined ? (
                    <div className="mt-4 flex h-14 items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">events 24h</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums">{health.last24hCount}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">error rate</p><p className={cn("mt-1 font-mono text-lg font-extrabold tabular-nums", health.errorRate > 0.05 ? "text-rose-300" : "text-emerald-300")}>{(health.errorRate * 100).toFixed(1)}%</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">AI latency avg</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums">{health.avgAiLatencyMs > 0 ? `${health.avgAiLatencyMs}ms` : "—"}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">AI calls 24h</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums">{health.aiCallsLast24h}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">active now</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-primary">{health.activeUsersRightNow}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">by type</p><p className="mt-1 truncate font-mono text-[10px] font-bold text-muted-foreground">{health.byType.map((s) => `${s.eventType}:${s.count}`).join(" · ") || "—"}</p></div>
                    </div>
                  )}
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <div className="overflow-hidden rounded-xl border border-white/5 bg-black/40">
                    <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                      <span className="size-2 rounded-full bg-rose-400/80" />
                      <span className="size-2 rounded-full bg-amber-400/80" />
                      <span className="size-2 rounded-full bg-emerald-400/80" />
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">nexus://system-events --tail -f</span>
                      <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px] text-emerald-300"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> live</span>
                    </div>
                    <div className="max-h-[26rem] overflow-y-auto p-3 font-mono text-[11px] leading-5">
                      {systemEvents === undefined ? (
                        <div className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> connecting…</div>
                      ) : liveFeed.length === 0 && olderEvents.length === 0 ? (
                        <p className="py-6 text-muted-foreground">no events yet — actions will stream in as students use the platform</p>
                      ) : (
                        <>
                          {[...olderEvents, ...liveFeed].map((e) => (
                            <div key={e._id} className="flex gap-2 border-b border-white/[0.03] py-1.5 last:border-0">
                              <span className="shrink-0 text-muted-foreground/70">{new Date(e.createdAt).toLocaleTimeString([], { hour12: false })}</span>
                              <span className={cn("shrink-0 font-bold", e.status === "error" ? "text-rose-300" : "text-emerald-300")}>{e.status === "error" ? "✖" : "✓"}</span>
                              <span className="shrink-0 text-primary">{e.eventType}</span>
                              <span className="shrink-0 text-amber-200/80">{e.source}</span>
                              {e.durationMs !== null && <span className="shrink-0 text-muted-foreground">{e.durationMs}ms</span>}
                              <span className="truncate text-muted-foreground/80">{formatEventMeta(e.metadata)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    {(liveHasMore || olderCursor) && (
                      <button type="button" onClick={() => void loadOlderEvents()} disabled={loadingOlder} className="flex w-full items-center justify-center gap-2 border-t border-white/5 py-2 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground">
                        {loadingOlder ? <><Loader2 className="size-3 animate-spin" /> loading older…</> : "⌥ load older events"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Integrations */}
                <div className="glass-panel rounded-2xl p-5">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Plug className="size-4 text-primary" /> Integrations</h2>
                    <p className="text-sm text-muted-foreground">Configuration status plus real 24h usage per service. Secrets are never displayed.</p>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    {(integrations ?? []).map((ig) => {
                      const tr = integrationResults[ig.id];
                      return (
                        <div key={ig.id} className="rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-3">
                          <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", ig.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>
                                {ig.configured ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                              </span>
                              <span className="truncate text-sm font-semibold">{ig.label}</span>
                            </div>
                            <span className={cn("flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide", ig.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>
                              {ig.configured ? "configured" : "key missing"}
                            </span>
                            <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
                              <span className="truncate font-mono text-[10px] text-muted-foreground">{ig.calls24h} calls · {(ig.errorRate * 100).toFixed(0)}% err · {ig.lastUsedAt ? relativeTime(ig.lastUsedAt) : "never used"}</span>
                              {(["xai", "gemini", "telegram", "github"] as string[]).includes(ig.id) && (
                                <Button variant="outline" size="sm" className="h-7 shrink-0 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]" onClick={() => void runIntegrationTest(ig.id)} disabled={testingIntegration === ig.id}>
                                  {testingIntegration === ig.id ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Test
                                </Button>
                              )}
                            </div>
                          </div>
                          {tr && <p className={cn("mt-2 border-t border-white/5 pt-2 font-mono text-[10px]", tr.ok ? "text-emerald-300" : "text-rose-300")}>{tr.detail ?? (tr.ok ? "connected" : "failed")}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ══════ BROADCAST ══════ */}
            {tab === "broadcast" && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="glass-panel rounded-2xl p-5">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Send className="size-4 text-primary" /> Telegram broadcast</h2>
                    <p className="text-sm text-muted-foreground">Send a message to one or more channels. Auto-post on new content is OFF per channel.</p>
                  </div>
                  {integrations?.find((i) => i.id === "telegram")?.configured === false && (
                    <Alert className="glass-soft mt-4 border-amber-400/25 bg-amber-400/10">
                      <AlertTriangle className="size-4 text-amber-300" />
                      <AlertTitle className="text-amber-300">TELEGRAM_BOT_TOKEN not set</AlertTitle>
                      <AlertDescription className="text-amber-200/80">Create a bot with @BotFather and paste its token in the Keys tab.</AlertDescription>
                    </Alert>
                  )}
                  <div className="mt-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">channels</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {channels === undefined ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : channels.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border bg-white/[0.02] px-4 py-6 text-center text-sm text-muted-foreground">No channels yet — add the first one below.</p>
                      ) : channels.map((ch) => (
                        <div key={ch._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3">
                          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{ch.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">chat id: {ch.chatId}</p></div>
                          <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-muted-foreground"><Switch checked={ch.autoPost} disabled={autoPostActing === ch._id} onCheckedChange={(next) => void handleToggleAutoPost(ch._id, next)} /> auto-post</label>
                          <Button variant="ghost" size="sm" className="h-8 cursor-pointer text-muted-foreground hover:text-rose-300" onClick={() => void handleRemoveChannel(ch._id)}><Trash2 className="size-3.5" /></Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Channel name" className="h-9 w-56 rounded-xl bg-white/5 font-mono text-xs" />
                    <Input value={channelChatId} onChange={(e) => setChannelChatId(e.target.value)} placeholder="chat id (e.g. -1001234567890)" className="h-9 w-56 rounded-xl bg-white/5 font-mono text-xs" />
                    <Button size="sm" className="h-9 cursor-pointer rounded-xl" onClick={() => void handleAddChannel()} disabled={addingChannel}>{addingChannel ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add channel</Button>
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">How to get a chat id: add your bot to the group/channel, then send any message and open <code className="rounded bg-white/10 px-1">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> — the numeric id appears in the result.</p>
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">compose broadcast</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(templates ?? []).map((t) => (
                      <button key={t.id} type="button" onClick={() => setBroadcastMessage(t.text)} className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{t.id}</button>
                    ))}
                  </div>
                  <Textarea value={broadcastMessage} onChange={(e) => setBroadcastMessage(e.target.value)} placeholder="Write the message… (HTML is supported)" className="mt-3 min-h-24 rounded-xl bg-white/5 font-mono text-xs" />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(channels ?? []).map((ch) => (
                      <label key={ch._id} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[11px] transition-colors", selectedChannels.includes(ch._id) ? "border-primary/50 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/25")}>
                        <input type="checkbox" className="accent-[var(--primary)]" checked={selectedChannels.includes(ch._id)} onChange={(e) => setSelectedChannels((p) => e.target.checked ? [...p, ch._id] : p.filter((id) => id !== ch._id))} />
                        {ch.name}
                      </label>
                    ))}
                  </div>
                  <Button onClick={() => void handleBroadcast()} disabled={broadcasting} className="mt-4 h-10 cursor-pointer rounded-xl">
                    {broadcasting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send broadcast
                  </Button>
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">broadcast history</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {(broadcastLog ?? []).length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">Nothing broadcast yet.</p>
                    ) : (broadcastLog ?? []).map((e) => (
                      <div key={e._id} className="rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm">{e.message}</p>
                          <Badge className={cn("shrink-0 font-mono text-[9px]", e.status === "sent" ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}>{e.status}</Badge>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{e.channels.join(", ")} · {relativeTime(e.sentAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══════ SYSTEM ══════ */}
            {tab === "system" && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="glass-panel rounded-2xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Github className="size-4" /> GitHub connection</h2>
                      <p className="text-sm text-muted-foreground">Live check of the GITHUB_TOKEN used by the platform's GitHub sync.</p>
                    </div>
                    <Button variant="outline" size="sm" className="cursor-pointer rounded-lg bg-white/5" onClick={() => void runGithubCheck()} disabled={checkingGithub}>
                      {checkingGithub ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Re-check
                    </Button>
                  </div>
                  {checkingGithub && githubStatus === null ? (
                    <div className="mt-4 flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking GitHub…</div>
                  ) : !githubStatus ? (
                    <p className="mt-4 py-6 text-sm text-muted-foreground">Click re-check to test the token.</p>
                  ) : !githubStatus.configured ? (
                    <div className="mt-4 rounded-xl bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-200">{githubStatus.error}</div>
                  ) : !githubStatus.valid ? (
                    <div className="mt-4 rounded-xl bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-200">{githubStatus.error}</div>
                  ) : (
                    <div className="mt-4">
                      <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-emerald-300" /> Connected as <span className="font-mono font-bold">@{githubStatus.login}</span></p>
                      {githubStatus.repos.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {githubStatus.repos.map((r) => (
                            <Badge key={r.fullName} variant="outline" className="gap-1 font-mono text-[10px] text-muted-foreground">
                              {r.private ? <Lock className="size-3 text-emerald-300" /> : <Globe className="size-3 text-amber-300" />} {r.fullName}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">token scope: repo access · {githubStatus.repos.length} repos visible</p>
                    </div>
                  )}
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">System status</h2>
                    <p className="text-sm text-muted-foreground">Read-only view of which keys are configured. Add or fix them in the Keys tab.</p>
                  </div>
                  <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
                    {system?.keys.map((k) => (
                      <div key={k.key} className="flex items-center justify-between rounded-xl bg-white/4 px-3.5 py-2.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{k.key}</span>
                        {k.configured ? (
                          <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300"><CheckCircle2 className="size-3.5" /> configured</span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-mono text-[10px] text-amber-300"><AlertTriangle className="size-3.5" /> missing</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {system?.convexUrl && <p className="mt-4 truncate font-mono text-[10px] text-muted-foreground">convex url: {system.convexUrl}</p>}
                </div>
              </div>
            )}
          </main>
        </div>

        {/* ── Footer ── */}
        <div className="admin-foot mt-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-2.5 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-2"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> nexus://admin · 8 modules online</span>
          <span className="hidden sm:inline">convex reactive · no polling</span>
          <span className="flex items-center gap-2"><ShieldCheck className="size-3.5 text-primary" /> access: admin <LiveClock /></span>
        </div>
      </div>
    </DashboardShell>
  );
}
