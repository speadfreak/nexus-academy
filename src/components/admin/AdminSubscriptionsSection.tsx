// Admin Subscriptions section — full control over the free-trial program.
//
// Four sub-panels (top-level tabs):
//   1. Overview   — trial program stats, current FREE_TRIAL_DAYS config
//                   with inline edit, recent activity chart.
//   2. Bulk tools — bulk-extend active trials, bulk-reactivate expired
//                   trials (with optional time cutoff), confirm dialogs
//                   that show exactly how many users will be affected.
//   3. Users      — searchable table of all users with their subscription
//                   state + per-user trial tools (extend, reset, set
//                   exact days).
//   4. Help       — explains the active-day trial model + how the
//                   admin tools interact with it.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Crown,
  Gift,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────── */
/* Top-level section                                                      */
/* ──────────────────────────────────────────────────────────────────── */

const SUB_TABS = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "bulk", label: "Bulk tools", icon: Gift },
  { id: "users", label: "Users", icon: Users },
  { id: "help", label: "How it works", icon: Sparkles },
] as const;

type SubTabId = (typeof SUB_TABS)[number]["id"];

export function AdminSubscriptionsSection() {
  const [subTab, setSubTab] = useState<SubTabId>("overview");
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          // subscriptions · trial program · premium access
        </p>
        <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">
          Subscriptions
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Control the free-trial program — set how many active days new users
          get, extend trials for individual users or everyone at once, and
          re-activate expired trials. All changes take effect immediately.
        </p>
      </div>

      {/* Sub-tab nav */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-1.5">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors",
                subTab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Sub-tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={subTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {subTab === "overview" && <OverviewPanel />}
          {subTab === "bulk" && <BulkPanel />}
          {subTab === "users" && <UsersPanel />}
          {subTab === "help" && <HelpPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Overview panel — stats + FREE_TRIAL_DAYS config                      */
/* ──────────────────────────────────────────────────────────────────── */

function OverviewPanel() {
  const overview = useQuery(api.subscriptions.getSubscriptionOverview, {});
  const setKey = useMutation(api.configKeys.setKey);
  const [trialDaysInput, setTrialDaysInput] = useState("");
  const [saving, setSaving] = useState(false);

  // Load current value into the input when the query resolves.
  useMemo(() => {
    if (overview && trialDaysInput === "") {
      setTrialDaysInput(String(overview.trialDaysConfigured));
    }
  }, [overview, trialDaysInput]);

  if (overview === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSave = async () => {
    const n = Number(trialDaysInput);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      toast.error("Trial days must be a number between 1 and 365.");
      return;
    }
    setSaving(true);
    try {
      await setKey({
        key: "FREE_TRIAL_DAYS",
        value: String(Math.round(n)),
      });
      toast.success(`Free trial set to ${Math.round(n)} active days.`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save trial days.",
      );
    } finally {
      setSaving(false);
    }
  };

  const stats = overview.stats;

  return (
    <div className="space-y-5">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Timer} label="In progress" value={stats.inProgressTrials} color="text-amber-300" />
        <StatCard icon={Clock} label="Expired" value={stats.expiredTrials} color="text-rose-300" />
        <StatCard icon={Crown} label="Paid active" value={stats.paidActive} color="text-emerald-300" />
        <StatCard icon={CheckCircle2} label="Canceled" value={stats.canceled} color="text-muted-foreground" />
        <StatCard icon={Users} label="Total users" value={stats.total} color="text-sky-300" />
        <StatCard
          icon={TrendingUp}
          label="Trial → paid rate"
          value={
            stats.total > 0
              ? `${Math.round((stats.paidActive / Math.max(1, stats.expiredTrials + stats.paidActive)) * 100)}%`
              : "—"
          }
          color="text-primary"
        />
      </div>

      {/* FREE_TRIAL_DAYS config card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // free trial length (active days)
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          The number of ACTIVE-usage days new users get as a free premium
          trial. The trial counts days the student actually opens the app —
          not calendar days since signup. Changing this affects in-progress
          trials on the user's next active day, but does NOT retroactively
          extend already-expired trials (use the Bulk tools tab for that).
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label className="text-xs font-semibold text-muted-foreground">
              Free trial days
            </Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={trialDaysInput}
              onChange={(e) => setTrialDaysInput(e.target.value)}
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={saving}
            />
          </div>
          <Button
            className="h-10 gap-2"
            onClick={handleSave}
            disabled={saving || trialDaysInput === String(overview.trialDaysConfigured)}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Save
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Current value: <span className="font-mono font-bold text-foreground">{overview.trialDaysConfigured}</span> active days
        </p>
      </div>

      {/* Trial-program quick-glance summary */}
      <div className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.04] p-5">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
          <Sparkles className="size-3.5" /> quick summary
        </p>
        <p className="mt-2 text-sm leading-6 text-foreground">
          Right now you have{" "}
          <span className="font-mono font-bold text-amber-300">{stats.inProgressTrials}</span> student
          {stats.inProgressTrials === 1 ? "" : "s"} using their free trial,{" "}
          <span className="font-mono font-bold text-emerald-300">{stats.paidActive}</span> paid subscriber
          {stats.paidActive === 1 ? "" : "s"}, and{" "}
          <span className="font-mono font-bold text-rose-300">{stats.expiredTrials}</span> expired trial
          {stats.expiredTrials === 1 ? "" : "s"} waiting to upgrade.
          {stats.expiredTrials > 0 && (
            <>
              {" "}Use the <span className="font-semibold">Bulk tools</span> tab
              above to re-activate expired trials (e.g. give everyone whose
              trial expired in the last 30 days an extra 3 days).
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Bulk tools panel                                                     */
/* ──────────────────────────────────────────────────────────────────── */

function BulkPanel() {
  const overview = useQuery(api.subscriptions.getSubscriptionOverview, {});
  const bulkExtendActive = useMutation(api.subscriptions.bulkExtendActiveTrials);
  const bulkExtendExpired = useMutation(api.subscriptions.bulkExtendExpiredTrials);

  const [activeExtraDays, setActiveExtraDays] = useState("3");
  const [expiredExtraDays, setExpiredExtraDays] = useState("3");
  const [expiredSinceDays, setExpiredSinceDays] = useState("30");
  const [activeBusy, setActiveBusy] = useState(false);
  const [expiredBusy, setExpiredBusy] = useState(false);

  if (overview === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleBulkExtendActive = async () => {
    const n = Number(activeExtraDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      toast.error("Extra days must be between 1 and 365.");
      return;
    }
    if (
      !confirm(
        `Add ${n} extra active days to ALL ${overview.stats.inProgressTrials} in-progress trial(s)? ` +
          `Each user's trialActiveDays counter will be reduced by ${n}, effectively giving them ${n} more active days before the gate triggers.`,
      )
    )
      return;
    setActiveBusy(true);
    try {
      const result = await bulkExtendActive({ extraDays: Math.round(n) });
      toast.success(`Extended ${result.updated} in-progress trial(s) by ${n} days.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk extend failed.");
    } finally {
      setActiveBusy(false);
    }
  };

  const handleBulkExtendExpired = async () => {
    const n = Number(expiredExtraDays);
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      toast.error("Extra days must be between 1 and 365.");
      return;
    }
    const sinceDays = Number(expiredSinceDays);
    const sinceMs =
      Number.isFinite(sinceDays) && sinceDays > 0
        ? Date.now() - sinceDays * 24 * 60 * 60 * 1000
        : undefined;
    const affectedCount = sinceMs !== undefined ? overview.stats.expiredSinceCutoff : overview.stats.expiredTrials;
    if (
      !confirm(
        `Re-activate ${affectedCount} expired trial(s)${sinceMs !== undefined ? ` from the last ${expiredSinceDays} days` : " (all time)"} ` +
          `with ${n} extra active days? Each expired trial's status will flip back to "trial" and the user will be able to use premium features again.`,
      )
    )
      return;
    setExpiredBusy(true);
    try {
      const result = await bulkExtendExpired({
        extraDays: Math.round(n),
        sinceMs,
      });
      toast.success(`Re-activated ${result.updated} expired trial(s) with ${n} extra days.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk re-activate failed.");
    } finally {
      setExpiredBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Bulk extend ACTIVE trials */}
      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-5">
        <div className="flex items-center gap-2">
          <Gift className="size-4 text-amber-300" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
            // extend all in-progress trials
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Give every student currently using their free trial some extra days.
          Great for promotional campaigns ("everyone gets +3 free days this
          week!") or as an apology after a service outage.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Label className="text-xs font-semibold text-muted-foreground">
              Extra days
            </Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={activeExtraDays}
              onChange={(e) => setActiveExtraDays(e.target.value)}
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={activeBusy}
            />
          </div>
          <Button
            className="h-10 gap-2"
            onClick={handleBulkExtendActive}
            disabled={activeBusy || overview.stats.inProgressTrials === 0}
          >
            {activeBusy ? <Loader2 className="size-4 animate-spin" /> : <Gift className="size-4" />}
            Extend {overview.stats.inProgressTrials} active trial{overview.stats.inProgressTrials === 1 ? "" : "s"}
          </Button>
          {overview.stats.inProgressTrials === 0 && (
            <p className="text-xs text-muted-foreground">No active trials to extend.</p>
          )}
        </div>
      </div>

      {/* Bulk re-activate EXPIRED trials */}
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-5">
        <div className="flex items-center gap-2">
          <RotateCcw className="size-4 text-emerald-300" />
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-300">
            // re-activate expired trials
          </p>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Bring expired trials back to life. Each re-activated user's trial
          status flips back to "trial" with the extra active days applied.
          Useful for "we messed up, here's a fresh trial for everyone" recovery
          scenarios, or for targeted win-back campaigns.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Label className="text-xs font-semibold text-muted-foreground">
              Extra days
            </Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={expiredExtraDays}
              onChange={(e) => setExpiredExtraDays(e.target.value)}
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={expiredBusy}
            />
          </div>
          <div className="w-40">
            <Label className="text-xs font-semibold text-muted-foreground">
              Expired within (days)
            </Label>
            <Input
              type="number"
              min={1}
              max={3650}
              value={expiredSinceDays}
              onChange={(e) => setExpiredSinceDays(e.target.value)}
              placeholder="All time"
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={expiredBusy}
            />
          </div>
          <Button
            className="h-10 gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
            onClick={handleBulkExtendExpired}
            disabled={expiredBusy || overview.stats.expiredSinceCutoff === 0}
          >
            {expiredBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            Re-activate {overview.stats.expiredSinceCutoff} expired trial{overview.stats.expiredSinceCutoff === 1 ? "" : "s"}
          </Button>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Showing count for the last {expiredSinceDays} days. Total expired (all time):{" "}
          <span className="font-mono font-bold">{overview.stats.expiredTrials}</span>
        </p>
      </div>

      {/* Safety warning */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-3.5 py-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
        <p className="font-mono text-[10px] leading-5 text-muted-foreground">
          Bulk operations are irreversible. They affect real students
          immediately. Double-check the affected count before confirming —
          the dialog shows the exact number of users that will be touched.
          Paid subscribers are NEVER affected by these tools (their trial
          counter is irrelevant once they have an active paid subscription).
        </p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Users panel — searchable table + per-user trial tools                */
/* ──────────────────────────────────────────────────────────────────── */

function UsersPanel() {
  const overview = useQuery(api.subscriptions.getSubscriptionOverview, {});
  const extendUser = useMutation(api.subscriptions.extendUserTrial);
  const resetUser = useMutation(api.subscriptions.resetUserTrial);
  const setUserDays = useMutation(api.subscriptions.setUserTrialDays);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "trial" | "expired" | "active" | "canceled">("all");
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [setDaysFor, setSetDaysFor] = useState<{ userId: Id<"users">; name: string } | null>(null);
  const [setDaysValue, setSetDaysValue] = useState("");

  const filtered = useMemo(() => {
    if (!overview) return [];
    const q = search.trim().toLowerCase();
    return overview.users.filter((u) => {
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.userName.toLowerCase().includes(q) ||
        u.userEmail.toLowerCase().includes(q)
      );
    });
  }, [overview, search, statusFilter]);

  if (overview === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleExtend = async (userId: Id<"users">, name: string, days: number) => {
    setBusyUserId(userId);
    try {
      const result = await extendUser({ userId, extraDays: days });
      if (result.ok) {
        toast.success(`Extended ${name}'s trial by ${days} days.`);
      } else {
        toast.error(`Could not extend: ${result.reason ?? "unknown error"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extend failed.");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleReset = async (userId: Id<"users">, name: string) => {
    if (!confirm(`Reset ${name}'s trial to a fresh state? This wipes their trialActiveDays counter and re-activates the trial. Cannot be undone.`))
      return;
    setBusyUserId(userId);
    try {
      const result = await resetUser({ userId });
      if (result.ok) {
        toast.success(`${name}'s trial has been reset to a fresh state.`);
      } else {
        toast.error(`Could not reset: ${result.reason ?? "unknown error"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Reset failed.");
    } finally {
      setBusyUserId(null);
    }
  };

  const handleSetDays = async () => {
    if (!setDaysFor) return;
    const n = Number(setDaysValue);
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      toast.error("Days must be between 0 and 365.");
      return;
    }
    setBusyUserId(setDaysFor.userId);
    try {
      const result = await setUserDays({ userId: setDaysFor.userId, days: Math.round(n) });
      if (result.ok) {
        toast.success(`${setDaysFor.name}'s trial counter set to ${Math.round(n)} days.`);
        setSetDaysFor(null);
        setSetDaysValue("");
      } else {
        toast.error(`Could not set: ${result.reason ?? "unknown error"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Set days failed.");
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Search + filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="h-10 rounded-xl bg-white/5 pl-9"
          />
        </div>
        <div className="w-44">
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
          >
            <SelectTrigger className="h-10 rounded-xl bg-white/5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="trial">Trial (in progress)</SelectItem>
              <SelectItem value="expired">Trial (expired)</SelectItem>
              <SelectItem value="active">Paid active</SelectItem>
              <SelectItem value="canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trial used</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                    No users match this filter.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((u) => (
                  <TableRow key={u.userId}>
                    <TableCell>
                      <p className="text-sm font-semibold">{u.userName}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {u.userEmail || "no email"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={u.status} />
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs">
                        {u.trialActiveDays} / {overview.trialDaysConfigured} days
                      </span>
                      <div className="mt-1 h-1 w-20 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            u.status === "trial"
                              ? "bg-amber-400"
                              : u.status === "expired"
                                ? "bg-rose-400"
                                : "bg-emerald-400",
                          )}
                          style={{
                            width: `${Math.min(100, (u.trialActiveDays / Math.max(1, overview.trialDaysConfigured)) * 100)}%`,
                          }}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {u.lastActiveDate || u.trialEndsAt || u.currentPeriodEnd
                          ? relativeTime(
                              (u.lastActiveDate
                                ? new Date(u.lastActiveDate).getTime()
                                : 0) ||
                                u.trialEndsAt ||
                                u.currentPeriodEnd ||
                                0,
                            )
                          : "never"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {u.status === "active" ? (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          Paid subscriber
                        </span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleExtend(u.userId, u.userName, 3)}
                            disabled={busyUserId === u.userId}
                            className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:opacity-50"
                            title="Add 3 extra active days"
                          >
                            +3d
                          </button>
                          <button
                            type="button"
                            onClick={() => handleExtend(u.userId, u.userName, 7)}
                            disabled={busyUserId === u.userId}
                            className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] font-semibold text-amber-200 transition-colors hover:bg-amber-400/20 disabled:opacity-50"
                            title="Add 7 extra active days"
                          >
                            +7d
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSetDaysFor({ userId: u.userId, name: u.userName });
                              setSetDaysValue(String(u.trialActiveDays));
                            }}
                            disabled={busyUserId === u.userId}
                            className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-1 font-mono text-[10px] font-semibold text-sky-200 transition-colors hover:bg-sky-400/20 disabled:opacity-50"
                            title="Set exact trial days"
                          >
                            Set…
                          </button>
                          <button
                            type="button"
                            onClick={() => handleReset(u.userId, u.userName)}
                            disabled={busyUserId === u.userId}
                            className="rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 font-mono text-[10px] font-semibold text-rose-200 transition-colors hover:bg-rose-400/20 disabled:opacity-50"
                            title="Reset trial to fresh state"
                          >
                            Reset
                          </button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {filtered.length > 0 && (
          <p className="mt-3 px-2 text-[10px] text-muted-foreground">
            Showing {filtered.length} of {overview.users.length} (capped at 100 most-recently-active).
          </p>
        )}
      </div>

      {/* Set-exact-days dialog */}
      {setDaysFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setSetDaysFor(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-card p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
              // set exact trial days
            </p>
            <h3 className="mt-1 text-lg font-extrabold tracking-tight">
              Set trial counter for {setDaysFor.name}
            </h3>
            <p className="mt-2 text-xs text-muted-foreground">
              Set this user's <code className="rounded bg-white/5 px-1 py-0.5 font-mono">trialActiveDays</code>{" "}
              counter to an exact value. The current free-trial length is{" "}
              <span className="font-mono font-bold">{overview.trialDaysConfigured}</span> days —
              setting the counter to that value or higher will cause the trial
              to expire on the user's next active day.
            </p>
            <div className="mt-4">
              <Label className="text-xs font-semibold text-muted-foreground">
                trialActiveDays (0 – {overview.trialDaysConfigured * 2})
              </Label>
              <Input
                type="number"
                min={0}
                max={365}
                value={setDaysValue}
                onChange={(e) => setSetDaysValue(e.target.value)}
                className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
                disabled={busyUserId === setDaysFor.userId}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setSetDaysFor(null);
                  setSetDaysValue("");
                }}
                disabled={busyUserId === setDaysFor.userId}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSetDays}
                disabled={busyUserId === setDaysFor.userId}
                className="gap-2"
              >
                {busyUserId === setDaysFor.userId ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Set counter
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "trial")
    return <Badge className="bg-amber-400/10 text-amber-300">Trial</Badge>;
  if (status === "expired")
    return <Badge className="bg-rose-400/10 text-rose-300">Expired</Badge>;
  if (status === "active")
    return <Badge className="bg-emerald-400/10 text-emerald-300">Paid</Badge>;
  return <Badge className="bg-white/5 text-muted-foreground">{status}</Badge>;
}

/* ──────────────────────────────────────────────────────────────────── */
/* Help panel — explains the trial model                                */
/* ──────────────────────────────────────────────────────────────────── */

function HelpPanel() {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-amber-300">
          <CalendarClock className="size-3.5" /> how the active-day trial works
        </p>
        <div className="mt-3 space-y-3 text-sm leading-6 text-foreground">
          <p>
            Learnyx Academy ET 🇪🇹's free trial is counted in <strong>active days</strong>,
            not calendar days. A student on a 14-day trial can use the app on
            any 14 calendar days they actually open it — if they sign up and
            don't use the app for a month, their trial is still unused.
          </p>
          <p>
            The counter increments once per calendar day (in the student's
            local timezone) on the first authenticated action they take that
            day. So a student who opens the app at 8am and again at 11pm on
            the same day only burns one trial day.
          </p>
          <p>
            When <code className="rounded bg-white/5 px-1 py-0.5 font-mono">trialActiveDays</code>{" "}
            reaches <code className="rounded bg-white/5 px-1 py-0.5 font-mono">FREE_TRIAL_DAYS</code>,
            the subscription's status flips from <code className="rounded bg-white/5 px-1 py-0.5 font-mono">"trial"</code>{" "}
            to <code className="rounded bg-white/5 px-1 py-0.5 font-mono">"expired"</code> and
            premium features are gated behind the upgrade page.
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
          <Sparkles className="size-3.5" /> how the admin tools interact with it
        </p>
        <ol className="mt-3 space-y-3 text-sm leading-6 text-foreground">
          <li>
            <span className="font-mono text-sky-300">1. FREE_TRIAL_DAYS config:</span>{" "}
            Setting this in the Overview tab changes the threshold against
            which ALL in-progress trials are compared. So if a student has
            used 8 of 14 days and you bump the config to 21, their next
            active day will be day 9 of 21 — they now have 13 more active
            days instead of 6. This does NOT affect expired trials.
          </li>
          <li>
            <span className="font-mono text-sky-300">2. Bulk extend active trials:</span>{" "}
            Reduces every in-progress trial's <code className="rounded bg-white/5 px-1 py-0.5 font-mono">trialActiveDays</code> by
            N. So a student who used 8 of 14 days gets bumped back to 5 of
            14 — they now have 9 more active days.
          </li>
          <li>
            <span className="font-mono text-sky-300">3. Bulk re-activate expired trials:</span>{" "}
            Flips expired trials back to <code className="rounded bg-white/5 px-1 py-0.5 font-mono">"trial"</code> status
            AND reduces their <code className="rounded bg-white/5 px-1 py-0.5 font-mono">trialActiveDays</code> by
            N. So a student who used all 14 days gets bumped back to 11 of
            14 — they now have 3 more active days. Use this for win-back
            campaigns.
          </li>
          <li>
            <span className="font-mono text-sky-300">4. Per-user extend / reset:</span>{" "}
            Same mechanics as the bulk tools, but scoped to one user. The{" "}
            <code className="rounded bg-white/5 px-1 py-0.5 font-mono">Set…</code> button
            lets you set an exact <code className="rounded bg-white/5 px-1 py-0.5 font-mono">trialActiveDays</code> value
            (useful for undoing a botched bulk operation on a single user).
          </li>
          <li>
            <span className="font-mono text-sky-300">5. Paid subscribers:</span>{" "}
            None of these tools affect users with <code className="rounded bg-white/5 px-1 py-0.5 font-mono">status: "active"</code>.
            Once a student pays, their trial counter is irrelevant.
          </li>
        </ol>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Shared StatCard component                                            */
/* ──────────────────────────────────────────────────────────────────── */

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <Icon className={cn("size-4", color)} />
      <p className="mt-2 font-mono text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
