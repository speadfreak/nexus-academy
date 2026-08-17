// Admin control center — gated by the existing admin role check. Tabs:
// Overview (stats + subscriptions), Content (upload + manage), Users (view +
// premium support actions), Payments (reconciliation), System (env status).

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Crown,
  Database,
  FileText,
  Flag,
  KeyRound,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wallet,
  XCircle,
} from "lucide-react";
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

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof Database;
}) {
  return (
    <div className="glass-soft rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </span>
        <Icon className="size-4 text-primary" />
      </div>
      <p className="mt-2 font-mono text-3xl font-bold tabular-nums text-gradient">
        {value}
      </p>
    </div>
  );
}

export default function Admin() {
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const promoteSelf = useMutation(api.admin.promoteSelfIfBootstrap);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") ?? "overview";

  // ---- Users tab ----
  const users = useQuery(api.adminCenter.listUsers);
  const setUserPremium = useMutation(api.adminCenter.setUserPremium);
  const [premiumAction, setPremiumAction] = useState<{ userId: string; action: "activate" | "expire" | "cancel" } | null>(null);
  const [acting, setActing] = useState(false);
  const [userQuery, setUserQuery] = useState("");

  // ---- Payments tab ----
  const payments = useQuery(api.adminCenter.listAllPayments);

  // ---- Overview tab ----
  const stats = useQuery(api.adminCenter.getAdminStats);

  // ---- System tab ----
  const system = useQuery(api.adminCenter.getSystemStatus);

  // ---- Reports tab (student safety) ----
  const reports = useQuery(api.safety.listReports);
  const updateReportStatus = useMutation(api.safety.updateReportStatus);
  const [reportFilter, setReportFilter] = useState<string>("open");
  const [reportActing, setReportActing] = useState<string | null>(null);

  const handleReportStatus = async (reportId: string, status: "open" | "reviewed" | "resolved") => {
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
      await setUserPremium({ userId: premiumAction.userId as never, action: premiumAction.action });
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

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            // control center
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Users, payments, content and system status — one place to run Nexus Academy.
          </p>
        </div>

        <Tabs
          value={tab}
          onValueChange={(next) => setSearchParams(next === "overview" ? {} : { tab: next })}
        >
          <TabsList className="glass-panel flex w-fit gap-1 rounded-xl p-1">
            <TabsTrigger value="overview" className="rounded-lg">
              <Activity className="size-3.5" /> Overview
            </TabsTrigger>
            <TabsTrigger value="content" className="rounded-lg">
              <FileText className="size-3.5" /> Content
            </TabsTrigger>
            <TabsTrigger value="users" className="rounded-lg">
              <UserRound className="size-3.5" /> Users
            </TabsTrigger>
            <TabsTrigger value="payments" className="rounded-lg">
              <Wallet className="size-3.5" /> Payments
            </TabsTrigger>
            <TabsTrigger value="reports" className="rounded-lg">
              <Flag className="size-3.5" /> Reports
            </TabsTrigger>
            <TabsTrigger value="system" className="rounded-lg">
              <KeyRound className="size-3.5" /> System
            </TabsTrigger>
          </TabsList>

          {/* ------- Overview ------- */}
          <TabsContent value="overview" className="flex flex-col gap-6">
            {stats === undefined ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <StatCard label="users" value={stats.users} icon={UserRound} />
                  <StatCard label="content items" value={stats.contentItems} icon={FileText} />
                  <StatCard label="payments" value={stats.payments} icon={Wallet} />
                  <StatCard label="quizzes" value={stats.quizzes} icon={Sparkles} />
                  <StatCard label="quiz attempts" value={stats.quizAttempts} icon={Activity} />
                  <StatCard label="study plans" value={stats.studyPlans} icon={Database} />
                  <StatCard label="todos" value={stats.todos} icon={CheckCircle2} />
                  <StatCard label="notes" value={stats.notes} icon={FileText} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="glass-panel rounded-2xl p-5">
                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                      // subscriptions
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(stats.bySubscriptionStatus).map(([status, count]) => (
                        <Badge key={status} className={cn("gap-1 font-mono text-[10px]", SUB_STATUS_STYLES[status])}>
                          {status} · {count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="glass-panel rounded-2xl p-5">
                    <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                      // payments by status
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Object.entries(stats.byPaymentStatus).map(([status, count]) => (
                        <Badge key={status} className={cn("gap-1 font-mono text-[10px]", PAY_STATUS_STYLES[status])}>
                          {status} · {count}
                        </Badge>
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
                    View accounts and manage premium access for support cases.
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
                        <TableHead>Role</TableHead>
                        <TableHead>Subscription</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((user) => (
                        <TableRow key={user._id} className="hover:bg-white/5">
                          <TableCell className="max-w-[14rem]">
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
                          <TableCell className="font-mono text-[11px]">
                            {user.role ?? "user"}
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("gap-1 font-mono text-[10px]", SUB_STATUS_STYLES[user.subscriptionStatus])}>
                              {user.subscriptionStatus}
                              {user.subscriptionStatus === "trial"
                                ? ` · ${user.trialActiveDays}/14`
                                : ""}
                            </Badge>
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
                                    <span className="font-semibold">{user.subscriptionStatus}</span>.
                                    Choose an action:
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <div className="flex flex-col gap-2">
                                  <Button
                                    variant="outline"
                                    className="rounded-xl bg-white/5"
                                    onClick={() => setPremiumAction({ userId: user._id, action: "activate" })}
                                  >
                                    <CheckCircle2 className="size-4 text-emerald-300" /> Activate premium (30 days)
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="rounded-xl bg-white/5"
                                    onClick={() => setPremiumAction({ userId: user._id, action: "expire" })}
                                  >
                                    <AlertTriangle className="size-4 text-amber-300" /> Expire premium now
                                  </Button>
                                  <Button
                                    variant="outline"
                                    className="rounded-xl bg-white/5"
                                    onClick={() => setPremiumAction({ userId: user._id, action: "cancel" })}
                                  >
                                    <XCircle className="size-4 text-rose-300" /> Cancel subscription
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

          {/* ------- Payments ------- */}
          <TabsContent value="payments" className="flex flex-col gap-4">
            <div className="glass-panel rounded-2xl p-5">
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">Payments</h2>
                <p className="text-sm text-muted-foreground">
                  All payment attempts for manual reconciliation while the
                  provider field names are still unverified.
                </p>
              </div>
              <div className="mt-4 overflow-x-auto">
                {payments === undefined ? (
                  <div className="flex h-32 items-center justify-center">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : payments.length === 0 ? (
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
                      {payments.map((payment) => (
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
                            <Badge className={cn("font-mono text-[10px]", PAY_STATUS_STYLES[payment.status])}>
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
          </TabsContent>

          {/* ------- System ------- */}
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

          <TabsContent value="system" className="flex flex-col gap-4">
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
