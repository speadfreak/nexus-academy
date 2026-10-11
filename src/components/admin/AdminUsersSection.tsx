// Learnyx Command OS — People · Users directory.
// Upgraded from the legacy inline users tab (same queries, same premium
// management actions — nothing removed):
//  · subscription status filter chips (new, same data)
//  · responsive: table on desktop, record cards on mobile (no squeezed table)
//  · kit primitives (SectionHeader / MetricCard / StatusBadge / EmptyState)

import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Crown,
  Loader2,
  Search,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  EmptyState,
  LoadingPanel,
  SectionHeader,
  SkeletonRows,
  StatusBadge,
  type StatusTone,
} from "./cmdos/kit";

type AdminUser = FunctionReturnType<typeof api.adminCenter.listUsers>[number];

const SUB_STATUS_TONES: Record<string, StatusTone> = {
  trial: "info",
  active: "ok",
  expired: "warn",
  canceled: "danger",
  none: "idle",
};

const FILTERS = ["all", "trial", "active", "expired", "none"] as const;

export function AdminUsersSection() {
  const users = useQuery(api.adminCenter.listUsers);
  const setUserPremium = useMutation(api.adminCenter.setUserPremium);
  const [userQuery, setUserQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof FILTERS)[number]>("all");
  const [premiumAction, setPremiumAction] = useState<{
    userId: string;
    action: "activate" | "expire" | "cancel";
  } | null>(null);
  const [acting, setActing] = useState(false);

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    return (
      users?.filter((u) => {
        if (statusFilter !== "all" && (u.subscriptionStatus ?? "none") !== statusFilter)
          return false;
        if (!q) return true;
        return (
          (u.email ?? "").toLowerCase().includes(q) ||
          (u.name ?? "").toLowerCase().includes(q) ||
          (u.displayName ?? "").toLowerCase().includes(q)
        );
      }) ?? []
    );
  }, [users, userQuery, statusFilter]);

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
    } catch {
      toast.error("Action failed.");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <SectionHeader
        eyebrow="people · directory"
        title="Users"
        description="Who signed up, who's actually studying, and premium access management."
        actions={
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              placeholder="Search users…"
              aria-label="Search users by name or email"
              className="h-9 w-52 rounded-xl bg-white/5 pl-9 font-mono text-xs sm:w-64"
            />
          </div>
        }
      />

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setStatusFilter(f)}
            aria-pressed={statusFilter === f}
            className={cn(
              "interactive-press cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors",
              statusFilter === f
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {users === undefined ? (
        <div className="cmdos-panel p-5">
          <SkeletonRows rows={6} />
          <LoadingPanel label="Loading directory" className="h-0 pb-2" />
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="cmdos-panel">
          <EmptyState
            icon={userQuery || statusFilter !== "all" ? Search : Users}
            title="No users match"
            hint={
              userQuery || statusFilter !== "all"
                ? "Try a different search or clear the status filter."
                : "New signups will appear here."
            }
          />
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="cmdos-panel hidden overflow-x-auto p-2 md:block">
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
                {filteredUsers.map((u) => (
                  <UserRow
                    key={u._id}
                    u={u}
                    premiumAction={premiumAction}
                    setPremiumAction={setPremiumAction}
                    acting={acting}
                    onConfirm={handlePremiumAction}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile record cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {filteredUsers.map((u) => (
              <UserCard
                key={u._id}
                u={u}
                premiumAction={premiumAction}
                setPremiumAction={setPremiumAction}
                acting={acting}
                onConfirm={handlePremiumAction}
              />
            ))}
          </div>

          <p className="font-mono text-[10px] text-muted-foreground/60">
            {filteredUsers.length} of {users.length} accounts shown
          </p>
        </>
      )}
    </div>
  );
}

/* ── Premium manage dialog (shared by table row + mobile card) ──────── */

function PremiumDialog({
  u,
  premiumAction,
  setPremiumAction,
  acting,
  onConfirm,
  trigger,
}: {
  u: AdminUser;
  premiumAction: { userId: string; action: "activate" | "expire" | "cancel" } | null;
  setPremiumAction: (v: { userId: string; action: "activate" | "expire" | "cancel" } | null) => void;
  acting: boolean;
  onConfirm: () => void;
  trigger: React.ReactNode;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="glass-panel">
        <AlertDialogHeader>
          <AlertDialogTitle>Manage premium access</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-semibold">
              {u.displayName ?? u.name ?? u.email ?? "This user"}
            </span>{" "}
            is currently <span className="font-semibold">{u.subscriptionStatus}</span>
            {u.subscriptionStatus === "trial" ? ` · ${u.trialActiveDays}/${u.freeTrialDays} trial days used` : ""}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setPremiumAction({ userId: u._id, action: "activate" })}>
            <CheckCircle2 className="size-4 text-emerald-300" /> Activate premium (30 days)
          </Button>
          <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setPremiumAction({ userId: u._id, action: "expire" })}>
            <AlertTriangle className="size-4 text-amber-300" /> Expire premium now
          </Button>
          <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setPremiumAction({ userId: u._id, action: "cancel" })}>
            <XCircle className="size-4 text-rose-300" /> Cancel subscription
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-xl">Close</AlertDialogCancel>
          {premiumAction?.userId === u._id && (
            <AlertDialogAction
              className="cursor-pointer rounded-xl"
              disabled={acting}
              onClick={() => onConfirm()}
            >
              {acting ? <Loader2 className="size-4 animate-spin" /> : <>Confirm <ChevronRight className="size-4" /></>}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function UserRow({
  u,
  premiumAction,
  setPremiumAction,
  acting,
  onConfirm,
}: Omit<Parameters<typeof PremiumDialog>[0], "trigger">) {
  return (
    <TableRow className="hover:bg-white/5">
      <TableCell className="max-w-[13rem]">
        <p className="truncate font-semibold">
          {u.displayName ?? u.name ?? "Guest"}
          {u.isAnonymous && (
            <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">anonymous</span>
          )}
        </p>
        <p className="truncate font-mono text-[10px] text-muted-foreground">{u.email ?? "no email"}</p>
      </TableCell>
      <TableCell className="font-mono text-[11px] text-muted-foreground">{u.stream ?? "—"}</TableCell>
      <TableCell>
        <StatusBadge tone={SUB_STATUS_TONES[u.subscriptionStatus] ?? "idle"}>
          {u.subscriptionStatus}
          {u.subscriptionStatus === "trial" ? ` · ${u.trialActiveDays}/${u.freeTrialDays}` : ""}
        </StatusBadge>
      </TableCell>
      <TableCell>
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {u.usage.studyHours} h · {u.usage.sessions} sess · {u.usage.quizzes} quiz
        </p>
        <p className="font-mono text-[10px] font-bold tabular-nums text-primary">{u.usage.xp} XP</p>
      </TableCell>
      <TableCell className="font-mono text-[10px] text-muted-foreground">
        {u.usage.lastActiveAt ? relativeTime(u.usage.lastActiveAt) : "never"}
      </TableCell>
      <TableCell className="text-right">
        <PremiumDialog
          u={u}
          premiumAction={premiumAction}
          setPremiumAction={setPremiumAction}
          acting={acting}
          onConfirm={onConfirm}
          trigger={
            <Button variant="outline" size="sm" className="h-8 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]">
              <Crown className="size-3" /> Manage
            </Button>
          }
        />
      </TableCell>
    </TableRow>
  );
}

function UserCard(props: Omit<Parameters<typeof PremiumDialog>[0], "trigger">) {
  const { u } = props;
  return (
    <div className="cmdos-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {u.displayName ?? u.name ?? "Guest"}
            {u.isAnonymous && (
              <span className="ml-1.5 font-mono text-[9px] text-muted-foreground">anonymous</span>
            )}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{u.email ?? "no email"}</p>
        </div>
        <StatusBadge tone={SUB_STATUS_TONES[u.subscriptionStatus] ?? "idle"}>
          {u.subscriptionStatus}
        </StatusBadge>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {u.usage.studyHours} h · {u.usage.xp} XP · {u.usage.lastActiveAt ? relativeTime(u.usage.lastActiveAt) : "never"}
        </p>
        <PremiumDialog
          {...props}
          trigger={
            <Button variant="outline" size="sm" className="h-8 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]">
              <Crown className="size-3" /> Manage
            </Button>
          }
        />
      </div>
    </div>
  );
}

