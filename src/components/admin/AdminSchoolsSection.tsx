// Admin Schools section — the full school-system management console.
//
// Everything the platform admin needs to run the schools feature:
//   • One-glance stats — schools, classes, students, licensed seats,
//     license health, pending bulk-purchase queue + value
//   • SCHOOL_FEATURE_ENABLED live status chip (links to the Keys tab)
//   • School bulk purchase queue — distinct "SCHOOL BULK" badge so these
//     never get confused with individual student payments, with
//     Approve / Reject + proof screenshot viewer
//   • School cards — director, contact, location, seats, license status
//     (active / expiring soon / expired / none), class count
//   • Create + edit schools with director assignment (searchable picker)
//   • Detail drilldown — classes table + per-class roster
//   • Delete with cascade (memberships → classes → school) + confirm
//
// NOT gated on SCHOOL_FEATURE_ENABLED — the admin can prepare a school's
// full setup before flipping the public switch.

import { api } from "@/convex/_generated/api";
import { useAppBootstrap } from "@/components/AppBootstrap";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  GraduationCap,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Search,
  Armchair,
  TrendingUp,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { relativeTime } from "@/lib/dates";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types (mirror the backend return shapes)
// ---------------------------------------------------------------------------

type AdminSchool = {
  _id: Id<"schools">;
  name: string;
  directorId: Id<"users">;
  directorName: string;
  directorEmail: string | null;
  seatsPurchased: number;
  seatsExpireAt: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  location: string | null;
  classCount: number;
  createdAt: number;
};

type AdminSeatSubmission = {
  _id: Id<"schoolSeatSubmissions">;
  schoolId: Id<"schools">;
  schoolName: string;
  directorName: string;
  seatCount: number;
  durationMonths: number;
  tierRate: number;
  totalAmount: number;
  tierUsed: number;
  method: string;
  transactionRef: string;
  proofStorageId: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: number;
  reviewedAt: number | null;
  rejectionReason: string | null;
};

type AdminUserLite = {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
};

const fmtMoney = (n: number) => n.toLocaleString("en-US");

type LicenseState = {
  key: "active" | "expiring" | "expired" | "none";
  label: string;
  badgeCls: string;
};

function licenseStatus(s: AdminSchool): LicenseState {
  const now = Date.now();
  if (!s.seatsExpireAt) {
    return {
      key: "none",
      label: "No license",
      badgeCls: "border-white/10 bg-white/5 text-muted-foreground",
    };
  }
  const days = Math.ceil((s.seatsExpireAt - now) / 86_400_000);
  if (days <= 0) {
    return {
      key: "expired",
      label: `Expired ${-days}d ago`,
      badgeCls: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    };
  }
  if (days <= 14) {
    return {
      key: "expiring",
      label: `${days}d left`,
      badgeCls: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    };
  }
  return {
    key: "active",
    label: `${days}d left`,
    badgeCls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  };
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function SchoolStat({
  label,
  value,
  icon: Icon,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  sub?: string;
  accent: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="glass-soft rounded-2xl p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="type-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </p>
        <span className={cn("flex size-7 items-center justify-center rounded-lg", accent)}>
          <Icon className="size-3.5" />
        </span>
      </div>
      <p className="mt-1.5 type-mono text-2xl font-extrabold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function AdminSchoolsSection() {
  const friendlyError = useFriendlyError();
  const stats = useQuery(api.schools.adminSchoolsStats, {});
  const schools = useQuery(api.schools.adminListSchools, {});
  const submissions = useQuery(api.schools.adminListSeatSubmissions, {});
  const { schoolFeatureEnabled: featureEnabled } = useAppBootstrap(); // shared subscription (AppBootstrap)
  const users = useQuery(api.adminCenter.listUsers, {});

  const approveMut = useMutation(api.schools.adminApproveSeatSubmission);
  const rejectMut = useMutation(api.schools.adminRejectSeatSubmission);
  const deleteMut = useMutation(api.schools.adminDeleteSchool);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingSchool, setEditingSchool] = useState<AdminSchool | null>(null);
  const [detailSchool, setDetailSchool] = useState<AdminSchool | null>(null);
  const [deletingSchool, setDeletingSchool] = useState<AdminSchool | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);
  const [schoolSearch, setSchoolSearch] = useState("");
  const [subFilter, setSubFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const proofResult = useQuery(
    api.manualPayments.getProofUrl,
    loadingProofId ? { storageId: loadingProofId } : "skip",
  );

  const handleViewProof = (storageId: string) => {
    setLoadingProofId(storageId);
  };

  // Open the proof URL in a new tab once resolved.
  useEffect(() => {
    if (proofResult?.url) {
      window.open(proofResult.url, "_blank", "noopener,noreferrer");
      setLoadingProofId(null);
    }
    if (proofResult && proofResult.url === null) {
      setLoadingProofId(null);
    }
  }, [proofResult]);

  const handleApprove = async (submissionId: string) => {
    setApprovingId(submissionId);
    try {
      await approveMut({ submissionId: submissionId as never });
      toast.success("School bulk purchase approved — seats granted! 🎉");
    } catch (e) {
      toast.error(friendlyError(e, "Approval failed."));
    } finally {
      setApprovingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectingId) return;
    if (rejectReason.trim().length < 3) {
      toast.error("A rejection reason is required (min 3 chars).");
      return;
    }
    setRejecting(true);
    try {
      await rejectMut({
        submissionId: rejectingId as never,
        rejectionReason: rejectReason.trim(),
      });
      toast.success("Submission rejected — the director has been notified.");
      setRejectingId(null);
      setRejectReason("");
    } catch (e) {
      toast.error(friendlyError(e, "Rejection failed."));
    } finally {
      setRejecting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingSchool) return;
    setDeleting(true);
    try {
      const res = await deleteMut({ schoolId: deletingSchool._id });
      toast.success(
        `Deleted ${deletingSchool.name} — ${res.removedClasses} classes and ${res.removedMembers} memberships removed.`,
      );
      setDeletingSchool(null);
    } catch (e) {
      toast.error(friendlyError(e, "Delete failed."));
    } finally {
      setDeleting(false);
    }
  };

  const filteredSchools = useMemo(() => {
    if (!schools) return [];
    const q = schoolSearch.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.directorName.toLowerCase().includes(q) ||
        (s.directorEmail ?? "").toLowerCase().includes(q) ||
        (s.location ?? "").toLowerCase().includes(q),
    );
  }, [schools, schoolSearch]);

  const filteredSubs = useMemo(() => {
    if (!submissions) return [];
    if (subFilter === "all") return submissions;
    return submissions.filter((s) => s.status === subFilter);
  }, [submissions, subFilter]);

  const pendingCount = stats?.pendingSubmissions ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ══════ HEADER BAND ══════ */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="glass-panel relative overflow-hidden rounded-2xl p-5"
      >
        <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-violet-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-32 size-48 rounded-full bg-sky-500/[0.07] blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
                <Building2 className="size-4.5" />
              </span>
              <div>
                <h2 className="text-lg font-extrabold tracking-tight">Schools</h2>
                <p className="text-xs text-muted-foreground">
                  Bulk class onboarding, director management, and tiered seat licenses.
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Live feature-toggle chip */}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                const evt = new CustomEvent("admin:navigate-tab", { detail: "keys" });
                window.dispatchEvent(evt);
                toast.info("Toggle SCHOOL_FEATURE_ENABLED in the Keys tab → System.");
              }}
              className={cn(
                "glass-chip flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.14em] transition-colors",
                featureEnabled === undefined
                  ? "border-white/10 bg-white/5 text-muted-foreground"
                  : featureEnabled
                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                    : "border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20",
              )}
              title="Click to jump to the Keys tab"
            >
              <span
                className={cn(
                  "relative flex size-1.5",
                  featureEnabled === undefined && "bg-muted-foreground",
                  featureEnabled === true && "bg-emerald-400",
                  featureEnabled === false && "bg-amber-400",
                )}
              >
                {featureEnabled !== undefined && (
                  <span
                    className={cn(
                      "absolute inline-flex size-full animate-ping rounded-full opacity-60",
                      featureEnabled ? "bg-emerald-400" : "bg-amber-400",
                    )}
                  />
                )}
              </span>
              {featureEnabled === undefined
                ? "checking…"
                : featureEnabled
                  ? "feature LIVE"
                  : "feature OFF"}
              <KeyRound className="size-3" />
            </a>
            <Button
              className="interactive-press cursor-pointer gap-1.5 rounded-xl"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-4" /> New school
            </Button>
          </div>
        </div>
      </motion.div>

      {/* ══════ STATS ROW ══════ */}
      {stats === undefined ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-6">
          <SchoolStat label="schools" value={stats.totalSchools} icon={Building2} sub="on the platform" accent="bg-violet-400/10 text-violet-300" />
          <SchoolStat label="classes" value={stats.totalClasses} icon={GraduationCap} sub="across all schools" accent="bg-sky-400/10 text-sky-300" />
          <SchoolStat label="students joined" value={stats.totalMembers} icon={Users} sub="via class codes" accent="bg-emerald-400/10 text-emerald-300" />
          <SchoolStat label="seats licensed" value={fmtMoney(stats.totalSeatsLicensed)} icon={Armchair} sub={`${stats.activeLicenses} active license${stats.activeLicenses === 1 ? "" : "s"}`} accent="bg-amber-400/10 text-amber-300" />
          <SchoolStat label="license health" value={`${stats.activeLicenses + stats.expiredLicenses}`} icon={Calendar} sub={stats.expiringSoon > 0 ? `${stats.expiringSoon} expiring ≤14d` : "no renewals due soon"} accent="bg-rose-400/10 text-rose-300" />
          <SchoolStat label="pending purchases" value={stats.pendingSubmissions} icon={Receipt} sub={`${fmtMoney(stats.pendingValueEtb)} ETB in queue`} accent="bg-violet-400/10 text-violet-300" />
        </div>
      )}

      {/* ══════ BULK PURCHASE QUEUE ══════ */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <Receipt className="size-4 text-violet-300" />
              School bulk purchases
            </h3>
            <p className="text-xs text-muted-foreground">
              Tiered seat-license requests from directors. Approve to grant seats + set the expiry date.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {(["pending", "approved", "rejected", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSubFilter(f)}
                className={cn(
                  "cursor-pointer rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors",
                  subFilter === f
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                {f}
                {f === "pending" && pendingCount > 0 && (
                  <span className="ml-1 rounded-full bg-amber-400/20 px-1 text-[9px] text-amber-300">
                    {pendingCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          {submissions === undefined ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSubs.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-2">
              <CheckCircle2 className="size-6 text-emerald-400/60" />
              <p className="text-sm text-muted-foreground">
                {subFilter === "pending" ? "No pending school purchases." : `No ${subFilter === "all" ? "" : subFilter + " "}submissions.`}
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {filteredSubs.map((sub, i) => (
                <motion.div
                  key={sub._id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.3) }}
                  className={cn(
                    "rounded-xl border p-4",
                    sub.status === "pending"
                      ? "border-violet-400/25 bg-violet-400/[0.04]"
                      : "border-white/[0.06] bg-white/[0.02]",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Distinct school-bulk badge — never confusable with student payments */}
                        <Badge className="gap-1 border-violet-400/30 bg-gradient-to-r from-violet-500/20 to-sky-500/15 font-mono text-[9px] font-extrabold uppercase tracking-[0.12em] text-violet-200">
                          <Building2 className="size-3" /> School bulk
                        </Badge>
                        <span className="text-sm font-bold">{sub.schoolName}</span>
                        <Badge
                          className={cn(
                            "font-mono text-[9px]",
                            sub.status === "pending" && "border-amber-400/30 bg-amber-400/10 text-amber-300",
                            sub.status === "approved" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                            sub.status === "rejected" && "border-rose-400/30 bg-rose-400/10 text-rose-300",
                          )}
                        >
                          {sub.status}
                        </Badge>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="flex items-center gap-1.5 rounded-md border border-sky-400/20 bg-sky-400/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                          <Users className="size-3" /> {sub.seatCount} seats
                        </span>
                        <span className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          <Clock className="size-3" /> {sub.durationMonths} month{sub.durationMonths === 1 ? "" : "s"}
                        </span>
                        <span className="flex items-center gap-1.5 rounded-md border border-violet-400/20 bg-violet-400/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-300">
                          Tier {sub.tierUsed} · {sub.tierRate} ETB/seat/mo
                        </span>
                        <span className="flex items-center gap-1.5 font-mono font-bold text-amber-300">
                          = {fmtMoney(sub.totalAmount)} ETB
                        </span>
                        <span className="flex items-center gap-1.5 font-mono text-muted-foreground">
                          ref: <code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-violet-200">{sub.transactionRef}</code>
                        </span>
                        <span className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                          {relativeTime(sub.submittedAt)} · {sub.directorName}
                        </span>
                      </div>
                      {sub.rejectionReason && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-rose-300/80">
                          <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {sub.rejectionReason}
                        </p>
                      )}
                    </div>
                    {sub.status === "pending" && (
                      <div className="flex shrink-0 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="cursor-pointer gap-1.5 rounded-lg"
                          onClick={() => handleViewProof(sub.proofStorageId)}
                          disabled={!!loadingProofId}
                        >
                          {loadingProofId ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
                          View proof
                        </Button>
                        <Button
                          size="sm"
                          className="cursor-pointer gap-1.5 rounded-lg bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                          onClick={() => handleApprove(sub._id)}
                          disabled={approvingId === sub._id}
                        >
                          {approvingId === sub._id ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                          Approve
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="cursor-pointer gap-1.5 rounded-lg border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
                          onClick={() => {
                            setRejectingId(sub._id);
                            setRejectReason("");
                          }}
                        >
                          <XCircle className="size-3.5" />
                          Reject
                        </Button>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ══════ SCHOOLS GRID ══════ */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
              <Building2 className="size-4 text-violet-300" />
              All schools
            </h3>
            <p className="text-xs text-muted-foreground">
              Create a school, designate a director, and track licenses. The director handles classes + codes from /school-admin.
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={schoolSearch}
              onChange={(e) => setSchoolSearch(e.target.value)}
              placeholder="Search schools, directors…"
              className="h-9 w-56 rounded-xl bg-white/5 pl-9 font-mono text-xs"
            />
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {schools === undefined ? (
            <div className="flex h-32 items-center justify-center lg:col-span-2">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredSchools.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 lg:col-span-2">
              <Building2 className="size-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {schools.length === 0
                  ? "No schools yet — create your first one to prepare a demo before flipping the feature live."
                  : "No schools match your search."}
              </p>
            </div>
          ) : (
            filteredSchools.map((s, i) => {
              const lic = licenseStatus(s);
              return (
                <motion.div
                  key={s._id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.4), ease: "easeOut" }}
                  className="hover-lift glass-soft group rounded-2xl border border-white/[0.06] p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/20 to-sky-500/10 text-violet-300">
                        <Building2 className="size-4.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold tracking-tight">{s.name}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {s.directorName}
                          {s.directorEmail ? ` · ${s.directorEmail}` : ""}
                        </p>
                      </div>
                    </div>
                    <Badge className={cn("shrink-0 gap-1 border font-mono text-[9px]", lic.badgeCls)}>
                      {lic.key === "active" && <CheckCircle2 className="size-2.5" />}
                      {lic.key === "expiring" && <AlertTriangle className="size-2.5" />}
                      {lic.key === "expired" && <XCircle className="size-2.5" />}
                      {lic.key === "none" && <Clock className="size-2.5" />}
                      {lic.label}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 font-mono font-bold text-foreground">
                      <Armchair className="size-3 text-amber-300" /> {fmtMoney(s.seatsPurchased)} seats
                    </span>
                    <span className="flex items-center gap-1">
                      <GraduationCap className="size-3 text-sky-300" /> {s.classCount} class{s.classCount === 1 ? "" : "es"}
                    </span>
                    {s.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="size-3" /> {s.location}
                      </span>
                    )}
                    {s.contactEmail && (
                      <span className="flex items-center gap-1 truncate">
                        <Mail className="size-3" /> {s.contactEmail}
                      </span>
                    )}
                    {s.contactPhone && (
                      <span className="flex items-center gap-1">
                        <Phone className="size-3" /> {s.contactPhone}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-mono text-[9px] text-muted-foreground/60">
                      created {relativeTime(s.createdAt)}
                    </span>
                    <div className="flex gap-1.5 opacity-70 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 cursor-pointer gap-1 rounded-lg bg-white/5 font-mono text-[10px]"
                        onClick={() => setDetailSchool(s)}
                      >
                        <Users className="size-3" /> Details
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 cursor-pointer gap-1 rounded-lg bg-white/5 font-mono text-[10px]"
                        onClick={() => setEditingSchool(s)}
                      >
                        <Pencil className="size-3" /> Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 cursor-pointer gap-1 rounded-lg border-rose-400/25 bg-white/5 font-mono text-[10px] text-rose-300 hover:bg-rose-400/10"
                        onClick={() => setDeletingSchool(s)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      {/* ══════ DIALOGS ══════ */}
      <SchoolFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={users ?? []}
      />
      <SchoolFormDialog
        open={editingSchool !== null}
        onOpenChange={(open) => {
          if (!open) setEditingSchool(null);
        }}
        users={users ?? []}
        school={editingSchool}
      />
      <SchoolDetailDialog
        school={detailSchool}
        onClose={() => setDetailSchool(null)}
      />

      {/* Delete confirm */}
      <AlertDialog open={deletingSchool !== null} onOpenChange={(open) => !open && setDeletingSchool(null)}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingSchool?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the school, its classes, and all class
              memberships ({deletingSchool?.classCount ?? 0} classes). Seat
              purchase history is kept as a payment record. The director will
              be notified. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer rounded-xl bg-rose-600 text-white hover:bg-rose-500"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Delete school
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject dialog */}
      <Dialog
        open={rejectingId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectingId(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="glass-panel">
          <DialogHeader>
            <DialogTitle>Reject school bulk purchase</DialogTitle>
            <DialogDescription>
              The director will be notified with this reason. Be specific —
              e.g. &quot;Transaction reference doesn&apos;t match our SMS records&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="school-reject-reason" className="text-xs font-semibold text-muted-foreground">
              Rejection reason (min 3 chars)
            </Label>
            <Textarea
              id="school-reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. The transaction reference doesn't match any received payment."
              className="min-h-[80px] rounded-xl bg-white/5 text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              className="cursor-pointer"
              onClick={() => {
                setRejectingId(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="cursor-pointer"
              onClick={handleReject}
              disabled={rejecting || rejectReason.trim().length < 3}
            >
              {rejecting ? <Loader2 className="size-3.5 animate-spin" /> : <XCircle className="size-3.5" />}
              Reject submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create / edit school dialog — shared form with a searchable director picker
// ---------------------------------------------------------------------------

function SchoolFormDialog({
  open,
  onOpenChange,
  users,
  school,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  users: AdminUserLite[];
  school?: AdminSchool | null;
}) {
  const friendlyError = useFriendlyError();
  const isEdit = !!school;
  const createMut = useMutation(api.schools.adminCreateSchool);
  const updateMut = useMutation(api.schools.adminUpdateSchool);

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [directorId, setDirectorId] = useState<string | null>(null);
  const [directorQuery, setDirectorQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // Hydrate the form when opening for an edit (or reset when opening fresh).
  if (open && !hydratedFor) {
    setHydratedFor(school?._id ?? "new");
    setName(school?.name ?? "");
    setLocation(school?.location ?? "");
    setContactEmail(school?.contactEmail ?? "");
    setContactPhone(school?.contactPhone ?? "");
    setDirectorId(school?.directorId ?? null);
    setDirectorQuery("");
  } else if (!open && hydratedFor) {
    setHydratedFor(null);
  }

  const filteredDirectors = useMemo(() => {
    const q = directorQuery.trim().toLowerCase();
    if (!q) return users.slice(0, 30);
    return users
      .filter(
        (u) =>
          (u.name ?? "").toLowerCase().includes(q) ||
          (u.email ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [users, directorQuery]);

  const selectedDirector = users.find((u) => u._id === directorId) ?? null;

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("School name is required.");
      return;
    }
    if (!isEdit && !directorId) {
      toast.error("Assign a director — they manage classes and seat purchases.");
      return;
    }
    setSaving(true);
    try {
      if (isEdit && school) {
        await updateMut({
          schoolId: school._id,
          name: name.trim(),
          location: location.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          directorId: (directorId as Id<"users"> | null) ?? undefined,
        });
        toast.success("School updated.");
      } else {
        await createMut({
          name: name.trim(),
          location: location.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          contactPhone: contactPhone.trim() || undefined,
          directorId: directorId as Id<"users">,
        });
        toast.success(`${name.trim()} created — the director got a welcome notification 🎓`);
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(friendlyError(e, isEdit ? "Update failed." : "Create failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-h-[85vh] max-w-lg overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="size-4 text-violet-300" />
            {isEdit ? `Edit ${school?.name}` : "Create a school"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the school's details or hand it to a different director."
              : "Set up the school, assign a director, and they take it from there — the director gets a welcome notification with next steps."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">School name *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Safari Academy"
              className="h-10 rounded-xl bg-white/5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <MapPin className="size-3" /> Location
              </Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Addis Ababa"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                <Phone className="size-3" /> Phone
              </Label>
              <Input
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+251 …"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
              <Mail className="size-3" /> Contact email
            </Label>
            <Input
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="director@school.edu"
              className="h-10 rounded-xl bg-white/5"
            />
          </div>

          {/* Director picker */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">
              Director * <span className="font-normal text-muted-foreground/70">(must have a Learnyx account)</span>
            </Label>
            {selectedDirector ? (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/[0.06] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold">{selectedDirector.name ?? "Unnamed user"}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">
                    {selectedDirector.email ?? "no email"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"
                  onClick={() => setDirectorId(null)}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-white/[0.03]">
                <div className="relative border-b border-white/[0.06]">
                  <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={directorQuery}
                    onChange={(e) => setDirectorQuery(e.target.value)}
                    placeholder="Search by name or email…"
                    className="h-9 rounded-t-xl border-0 bg-transparent pl-9 font-mono text-xs"
                  />
                </div>
                <div className="max-h-44 overflow-y-auto p-1">
                  {users.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">Loading users…</p>
                  ) : filteredDirectors.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-muted-foreground">No users match.</p>
                  ) : (
                    filteredDirectors.map((u) => (
                      <button
                        key={u._id}
                        type="button"
                        onClick={() => {
                          setDirectorId(u._id);
                          setDirectorQuery("");
                        }}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/5"
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-400/10 font-mono text-[10px] font-bold text-violet-300">
                          {(u.name ?? u.email ?? "?").charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-semibold">{u.name ?? "Unnamed user"}</span>
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {u.email ?? "no email"}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="cursor-pointer rounded-xl" onClick={() => void handleSave()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : isEdit ? "Save changes" : "Create school"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Detail drilldown — school info + classes + rosters
// ---------------------------------------------------------------------------

type AdminSchoolClass = {
  _id: Id<"schoolClasses">;
  name: string;
  gradeLevel: number;
  stream: string;
  classCode: string;
  memberCount: number;
  createdAt: number;
};

type AdminClassMember = {
  _id: Id<"schoolClassMembers">;
  studentId: Id<"users">;
  studentName: string;
  studentEmail: string | null;
  shareProgressWithSchool: boolean;
  joinedAt: number;
};

function SchoolDetailDialog({
  school,
  onClose,
}: {
  school: AdminSchool | null;
  onClose: () => void;
}) {
  const classes = useQuery(
    api.schools.adminListSchoolClasses,
    school ? { schoolId: school._id } : "skip",
  );
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);
  const lic = school ? licenseStatus(school) : null;

  return (
    <Dialog open={school !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-panel max-h-[85vh] max-w-2xl overflow-y-auto rounded-2xl">
        {school && lic && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-violet-300" /> {school.name}
              </DialogTitle>
              <DialogDescription>
                {school.directorName} · {school.directorEmail ?? "no email"} · {school.location ?? "no location"}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              {/* License + seats summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="glass-soft rounded-xl p-3">
                  <p className="type-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">seats</p>
                  <p className="mt-1 font-mono text-xl font-extrabold tabular-nums">{fmtMoney(school.seatsPurchased)}</p>
                </div>
                <div className="glass-soft rounded-xl p-3">
                  <p className="type-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">license</p>
                  <p className={cn("mt-1 font-mono text-xs font-extrabold", lic.badgeCls.split(" ").find((c) => c.startsWith("text-")) ?? "")}>
                    {lic.label}
                  </p>
                  {school.seatsExpireAt && (
                    <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">
                      until {new Date(school.seatsExpireAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="glass-soft rounded-xl p-3">
                  <p className="type-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">classes</p>
                  <p className="mt-1 font-mono text-xl font-extrabold tabular-nums">{classes?.length ?? "…"}</p>
                </div>
              </div>

              {/* Classes + rosters */}
              <div>
                <p className="type-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Classes — click to expand roster
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {classes === undefined ? (
                    <div className="flex h-20 items-center justify-center">
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : classes.length === 0 ? (
                    <div className="glass-soft flex flex-col items-center rounded-xl px-4 py-8 text-center">
                      <GraduationCap className="size-6 text-muted-foreground/40" />
                      <p className="mt-2 text-xs text-muted-foreground">
                        No classes yet — the director creates them from /school-admin.
                      </p>
                    </div>
                  ) : (
                    classes.map((c) => (
                      <ClassRosterRow
                        key={c._id}
                        schoolClass={c}
                        expanded={expandedClassId === c._id}
                        onToggle={() =>
                          setExpandedClassId((p) => (p === c._id ? null : c._id))
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ClassRosterRow({
  schoolClass,
  expanded,
  onToggle,
}: {
  schoolClass: AdminSchoolClass;
  expanded: boolean;
  onToggle: () => void;
}) {
  const members = useQuery(
    api.schools.adminListClassMembers,
    expanded ? { classId: schoolClass._id } : "skip",
  );
  return (
    <div className="glass-soft overflow-hidden rounded-xl border border-white/[0.06]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
      >
        <GraduationCap className="size-4 shrink-0 text-sky-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold">{schoolClass.name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Grade {schoolClass.gradeLevel} · {schoolClass.stream} · {schoolClass.memberCount} member{schoolClass.memberCount === 1 ? "" : "s"}
          </p>
        </div>
        <code className="rounded bg-violet-400/10 px-2 py-1 font-mono text-[10px] font-bold text-violet-300">
          {schoolClass.classCode}
        </code>
        <Chevron className={cn("size-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeInOut" }}
            className="overflow-hidden border-t border-white/[0.06]"
          >
            <div className="flex flex-col gap-1 p-2.5">
              {members === undefined ? (
                <div className="flex h-14 items-center justify-center">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
              ) : members.length === 0 ? (
                <p className="py-3 text-center text-[11px] text-muted-foreground">
                  No students have joined this class yet.
                </p>
              ) : (
                members.map((m) => (
                  <div
                    key={m._id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-white/5 font-mono text-[9px] font-bold text-muted-foreground">
                      {m.studentName.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-semibold">{m.studentName}</span>
                    {m.studentEmail && (
                      <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:block">
                        {m.studentEmail}
                      </span>
                    )}
                    {m.shareProgressWithSchool && (
                      <Badge className="shrink-0 border-emerald-400/30 bg-emerald-400/10 font-mono text-[8px] uppercase text-emerald-300">
                        shares progress
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Chevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
