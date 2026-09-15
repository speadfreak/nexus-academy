// SchoolAdmin — the director's command center for managing classes,
// members, and bulk seat licenses.
//
// Sections:
//   • License banner — school name, seats, expiry countdown + progress bar
//     (amber warning inside 14 days, rose when expired, with renewal CTA)
//   • Stats row — students joined, classes, seats licensed, days remaining
//   • Classes — create classes, share codes, expandable privacy-preserving
//     rosters (total count always; names only for students who opted in to
//     "share detailed progress with school")
//   • Purchase seats — tiered bulk pricing with a live calculator pulling
//     real configKeys rates, TeleBirr payment instructions, proof upload,
//     and snapshot-at-submit submission
//   • Payment history — every submission with status + rejection reasons
//
// Gated on SCHOOL_FEATURE_ENABLED at the route level (main.tsx SchoolFeatureGate).

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Armchair,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  Copy,
  CreditCard,
  GraduationCap,
  History,
  Info,
  Loader2,
  Plus,
  ShieldCheck,
  Smartphone,
  Upload,
  Users,
  XCircle,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
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
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { relativeTime } from "@/lib/dates";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Pricing helpers — mirror the backend getTierRateForSeatCount exactly.
// ---------------------------------------------------------------------------

type TierPricing = { tier1: number; tier2: number; tier3: number; tier4: number };

function tierForSeatCount(seats: number): 1 | 2 | 3 | 4 {
  if (seats >= 100) return 4;
  if (seats >= 50) return 3;
  if (seats >= 20) return 2;
  return 1;
}

function rateForSeatCount(seats: number, p: TierPricing): number {
  if (seats >= 100) return p.tier4;
  if (seats >= 50) return p.tier3;
  if (seats >= 20) return p.tier2;
  return p.tier1;
}

const fmtMoney = (n: number) => n.toLocaleString("en-US");

const EXPIRING_SOON_DAYS = 14;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SchoolAdmin() {
  const friendlyError = useFriendlyError();
  const school = useQuery(api.schools.directorGetMySchool);
  const pricing = useQuery(api.configKeys.getSchoolSeatPricing, {});
  const paymentConfig = useQuery(api.manualPayments.getPaymentConfig, {});
  const mySubmissions = useQuery(api.schools.directorListMySubmissions, {});
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);

  if (school === undefined) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-amber-300/60" />
        </div>
      </DashboardShell>
    );
  }

  if (school === null) {
    return (
      <DashboardShell>
        <div className="glass-soft mx-auto mt-20 max-w-md rounded-3xl p-8 text-center">
          <Building2 className="mx-auto size-10 text-muted-foreground/40" />
          <h2 className="mt-4 type-h2">Not a school director</h2>
          <p className="mt-2 type-body text-muted-foreground">
            This dashboard is for designated school directors. If you believe
            this is an error, contact the platform admin.
          </p>
        </div>
      </DashboardShell>
    );
  }

  // License state
  const now = Date.now();
  const hasLicense = school.seatsExpireAt !== null;
  const daysLeft = school.seatsExpireAt
    ? Math.ceil((school.seatsExpireAt - now) / 86_400_000)
    : null;
  const licenseExpired = daysLeft !== null && daysLeft <= 0;
  const licenseExpiring = daysLeft !== null && daysLeft > 0 && daysLeft <= EXPIRING_SOON_DAYS;
  const totalMembers = school.classes.reduce((sum, c) => sum + c.memberCount, 0);

  // License progress bar — assumes a 12-month max window; the bar fills by
  // remaining fraction of the most recent 365 days. Simple + honest.
  const licenseProgress = school.seatsExpireAt
    ? Math.max(0, Math.min(100, (Math.min(daysLeft ?? 0, 365) / 365) * 100))
    : 0;

  const pendingSub = mySubmissions?.find((s) => s.status === "pending");

  return (
    <DashboardShell>
      <div className="flex flex-col gap-5 sm:gap-6">
        {/* ══════ HEADER + LICENSE BANNER ══════ */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="uppercase tracking-[0.22em] text-violet-300 font-semibold type-caption">
            // school admin
          </p>
          <h1 className="mt-1 type-h1 text-gradient">{school.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge className="border-violet-400/30 bg-violet-400/10 text-violet-300">
              <Users className="size-2.5" /> {school.seatsPurchased} seats
            </Badge>
            <Badge
              className={cn(
                "border",
                !hasLicense
                  ? "border-white/10 bg-white/5 text-muted-foreground"
                  : licenseExpired
                    ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
                    : licenseExpiring
                      ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
              )}
            >
              <Calendar className="size-2.5" />
              {!hasLicense
                ? "No license yet"
                : licenseExpired
                  ? `License ended ${-daysLeft!}d ago`
                  : `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining`}
            </Badge>
          </div>

          {/* License progress + renewal nudge */}
          {hasLicense && (
            <div className="glass-soft mt-4 rounded-2xl p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="type-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Premium license — until{" "}
                  {new Date(school.seatsExpireAt!).toLocaleDateString()}
                </p>
                <p
                  className={cn(
                    "font-mono text-[10px] font-bold",
                    licenseExpired
                      ? "text-rose-300"
                      : licenseExpiring
                        ? "text-amber-300"
                        : "text-emerald-300",
                  )}
                >
                  {licenseExpired ? "ended" : `${daysLeft}d left`}
                </p>
              </div>
              <Progress
                value={licenseProgress}
                className={cn(
                  "mt-2 h-1.5",
                  licenseExpired ? "[&>div]:bg-rose-400" : licenseExpiring ? "[&>div]:bg-amber-400" : "[&>div]:bg-emerald-400",
                )}
              />
              {(licenseExpiring || licenseExpired || !pendingSub) && (
                <p
                  className={cn(
                    "mt-2 flex items-start gap-1.5 text-[11px]",
                    licenseExpired ? "text-rose-300" : "text-amber-300",
                  )}
                >
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {licenseExpired
                    ? "Your school's premium access has ended — your students' premium features are paused. Renew below and they're back instantly, no data lost."
                    : licenseExpiring
                      ? `License is running low — renew before ${new Date(school.seatsExpireAt!).toLocaleDateString()} so your students keep uninterrupted premium access.`
                      : "Seat licenses are time-limited. When a license ends, students keep their accounts and history — premium features pause until renewal. Nothing is ever deleted."}
                </p>
              )}
            </div>
          )}
        </motion.div>

        {/* ══════ STATS ROW ══════ */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="students joined" value={totalMembers} icon={Users} accent="bg-emerald-400/10 text-emerald-300" />
          <StatTile label="classes" value={school.classes.length} icon={GraduationCap} accent="bg-sky-400/10 text-sky-300" />
          <StatTile label="seats licensed" value={school.seatsPurchased} icon={Armchair} accent="bg-amber-400/10 text-amber-300" />
          <StatTile
            label="days remaining"
            value={hasLicense ? Math.max(0, daysLeft!) : "—"}
            icon={Clock}
            accent={licenseExpired ? "bg-rose-400/10 text-rose-300" : "bg-violet-400/10 text-violet-300"}
          />
        </div>

        {/* ══════ CLASSES ══════ */}
        <div className="glass-panel rounded-3xl p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                Classes
              </p>
              <p className="mt-0.5 type-caption text-muted-foreground">
                Create classes and share the code with your students — they join
                pre-configured with the right grade and stream
              </p>
            </div>
            <Button className="interactive-press cursor-pointer rounded-xl" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> New class
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {school.classes.length === 0 ? (
              <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-10 text-center">
                <GraduationCap className="size-7 text-muted-foreground/40" />
                <p className="mt-2 type-body text-muted-foreground">No classes yet.</p>
                <p className="type-caption text-muted-foreground/70">
                  Create your first class — students join with the shareable code.
                </p>
              </div>
            ) : (
              school.classes.map((c, i) => (
                <motion.div
                  key={c._id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.4), ease: "easeOut" }}
                  className="glass-soft overflow-hidden rounded-2xl border border-white/5"
                >
                  <div className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
                      <GraduationCap className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate type-body font-bold">{c.name}</p>
                      <p className="type-caption text-muted-foreground">
                        Grade {c.gradeLevel} · {c.stream} · {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(c.classCode);
                          toast.success("Class code copied.");
                        } catch {
                          toast.error("Could not copy.");
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 font-mono text-xs font-bold text-violet-300 transition hover:bg-violet-400/20"
                    >
                      <Copy className="size-3" /> {c.classCode}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedClassId((p) => (p === c._id ? null : c._id))
                      }
                      className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                      title="View roster"
                    >
                      <ChevronDown
                        className={cn("size-4 transition-transform", expandedClassId === c._id && "rotate-180")}
                      />
                    </button>
                  </div>
                  <AnimatePresence initial={false}>
                    {expandedClassId === c._id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: "easeInOut" }}
                        className="overflow-hidden border-t border-white/5"
                      >
                        <ClassRoster classId={c._id} memberCount={c.memberCount} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* ══════ PURCHASE SEATS ══════ */}
        <SeatPurchasePanel
          pricing={pricing}
          telebirrNumber={paymentConfig?.telebirrNumber ?? ""}
          telebirrName={paymentConfig?.telebirrName ?? ""}
          hasPending={!!pendingSub}
        />

        {/* ══════ PAYMENT HISTORY ══════ */}
        <PaymentHistory submissions={mySubmissions ?? []} loading={mySubmissions === undefined} />
      </div>

      <CreateClassDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        schoolId={school._id}
      />
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

function StatTile({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Users;
  accent: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
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
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Class roster — privacy-preserving. Total count is always shown; individual
// names appear ONLY for students who opted in via "share detailed progress
// with school" in Settings. This is the promise we make on the landing page,
// and the dashboard honors it literally.
// ---------------------------------------------------------------------------

function ClassRoster({
  classId,
  memberCount,
}: {
  classId: Id<"schoolClasses">;
  memberCount: number;
}) {
  const roster = useQuery(api.schools.directorListClassMembers, { classId });

  return (
    <div className="flex flex-col gap-2 p-3.5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-3.5 text-emerald-300" />
        <p className="text-[11px] text-muted-foreground">
          <span className="font-bold text-foreground">{memberCount}</span> student{memberCount === 1 ? "" : "s"} in this class.{" "}
          {roster && roster.optedInCount < roster.totalMembers
            ? `${roster.totalMembers - roster.optedInCount} haven't opted in to progress sharing — their names stay private, by design.`
            : "Only students who chose to share progress are listed."}
        </p>
      </div>
      {roster === undefined ? (
        <div className="flex h-12 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : roster.optedIn.length === 0 ? (
        <p className="rounded-xl bg-white/[0.03] px-3 py-3 text-center text-[11px] text-muted-foreground">
          No students have opted in to progress sharing yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {roster.optedIn.map((m) => (
            <div key={m._id} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-violet-400/10 font-mono text-[9px] font-bold text-violet-300">
                {m.studentName.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{m.studentName}</span>
              {m.studentEmail && (
                <span className="hidden truncate font-mono text-[10px] text-muted-foreground sm:block">
                  {m.studentEmail}
                </span>
              )}
              <Badge className="shrink-0 border-emerald-400/30 bg-emerald-400/10 font-mono text-[8px] uppercase text-emerald-300">
                opted in
              </Badge>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Seat purchase panel — live tier calculator + TeleBirr payment + submit
// ---------------------------------------------------------------------------

function SeatPurchasePanel({
  pricing,
  telebirrNumber,
  telebirrName,
  hasPending,
}: {
  pricing: TierPricing | undefined;
  telebirrNumber: string;
  telebirrName: string;
  hasPending: boolean;
}) {
  const friendlyError = useFriendlyError();
  const generateUploadUrl = useMutation(api.schools.directorGenerateProofUploadUrl);
  const submitPurchase = useMutation(api.schools.directorSubmitSeatPurchase);

  const [seats, setSeats] = useState(40);
  const [months, setMonths] = useState(3);
  const [txRef, setTxRef] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tier = tierForSeatCount(seats);
  const rate = pricing ? rateForSeatCount(seats, pricing) : 0;
  const total = rate * seats * months;

  const tierColors: Record<number, string> = {
    1: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    2: "border-violet-400/30 bg-violet-400/10 text-violet-300",
    3: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    4: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  };

  const handleSubmit = async () => {
    if (!txRef.trim()) {
      toast.error("Enter the TeleBirr transaction reference from your SMS.");
      return;
    }
    if (!proofFile) {
      toast.error("Attach a screenshot of the payment confirmation.");
      return;
    }
    setSubmitting(true);
    try {
      // Step 1 — one-time upload URL from Convex storage.
      const uploadUrl = await generateUploadUrl({});

      // Step 2 — upload the proof screenshot via XHR (progress tracking).
      const storageId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) setUploadPct(Math.round((e.loaded / e.total) * 100));
        });
        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText) as { storageId: string };
              resolve(res.storageId);
            } catch {
              reject(new Error("Upload succeeded but response was malformed."));
            }
          } else {
            reject(new Error(`Upload failed (${xhr.status}).`));
          }
        });
        xhr.addEventListener("error", () => reject(new Error("Upload failed.")));
        xhr.send(proofFile);
      });

      // Step 3 — submit with a snapshot of the calculated values. A later
      // price change never affects an already-submitted request.
      const result = await submitPurchase({
        seatCount: seats,
        durationMonths: months,
        transactionRef: txRef.trim(),
        proofStorageId: storageId,
      });

      toast.success(
        `Submitted! ${fmtMoney(result.totalAmount)} ETB for ${seats} seats × ${months} month${months === 1 ? "" : "s"} — the admin reviews it shortly.`,
        { duration: 8000 },
      );
      setTxRef("");
      setProofFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      toast.error(friendlyError(e, "Submission failed — please try again."));
    } finally {
      setSubmitting(false);
      setUploadPct(null);
    }
  };

  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
            Purchase seats
          </p>
          <p className="mt-0.5 type-caption text-muted-foreground">
            Bulk premium for your students — the bigger the group, the lower the per-seat rate
          </p>
        </div>
        <CreditCard className="size-5 shrink-0 text-violet-300/60" />
      </div>

      {hasPending && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-3.5 py-2.5">
          <Clock className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <p className="text-[11px] text-amber-200/90">
            You already have a purchase awaiting review. You can submit another —
            the admin processes them in order.
          </p>
        </div>
      )}

      {/* Tier table */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(
          [
            { t: 1, range: "1–19", key: "tier1" as const },
            { t: 2, range: "20–49", key: "tier2" as const },
            { t: 3, range: "50–99", key: "tier3" as const },
            { t: 4, range: "100+", key: "tier4" as const },
          ]
        ).map(({ t, range, key }) => (
          <div
            key={t}
            className={cn(
              "rounded-xl border p-2.5 transition-colors",
              tier === t
                ? tierColors[t]
                : "border-white/[0.06] bg-white/[0.02] text-muted-foreground",
            )}
          >
            <p className="type-mono text-[9px] font-bold uppercase tracking-[0.14em]">
              Tier {t}
            </p>
            <p className="mt-0.5 font-mono text-sm font-extrabold">
              {pricing ? `${fmtMoney(pricing[key])} ብር` : "…"}
            </p>
            <p className="font-mono text-[9px] opacity-70">{range} seats / month</p>
          </div>
        ))}
      </div>

      {/* Live calculator */}
      <div className="glass-soft mt-4 rounded-2xl p-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold text-muted-foreground">Seats</Label>
              <span className="font-mono text-sm font-extrabold tabular-nums text-violet-300">{seats}</span>
            </div>
            <Slider
              value={[seats]}
              onValueChange={([v]) => setSeats(v ?? 1)}
              min={1}
              max={500}
              step={1}
              className="mt-2.5 cursor-pointer"
            />
            <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground/60">
              <span>1</span><span>20</span><span>50</span><span>100</span><span>500</span>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-[11px] font-semibold text-muted-foreground">Duration</Label>
              <span className="font-mono text-sm font-extrabold tabular-nums text-violet-300">
                {months} month{months === 1 ? "" : "s"}
              </span>
            </div>
            <Slider
              value={[months]}
              onValueChange={([v]) => setMonths(v ?? 1)}
              min={1}
              max={12}
              step={1}
              className="mt-2.5 cursor-pointer"
            />
            <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground/60">
              <span>1</span><span>3</span><span>6</span><span>9</span><span>12</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={cn("border font-mono text-[10px] font-bold", tierColors[tier])}>
              Tier {tier} — {fmtMoney(rate)} ETB/seat/mo
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">
              {seats} × {months} × {fmtMoney(rate)}
            </span>
          </div>
          <div className="text-right">
            <p className="type-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Estimated total
            </p>
            <motion.p
              key={total}
              initial={{ scale: 0.92, opacity: 0.6 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.18 }}
              className="font-mono text-2xl font-extrabold tabular-nums text-amber-300"
            >
              {fmtMoney(total)} <span className="text-sm">ETB</span>
            </motion.p>
          </div>
        </div>
      </div>

      {/* Payment instructions + submit */}
      <div className="mt-4 flex flex-col gap-3">
        {telebirrNumber ? (
          <div className="flex items-center gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3.5 py-3">
            <Smartphone className="size-4 shrink-0 text-amber-300" />
            <div className="min-w-0 flex-1">
              <p className="type-mono text-[9px] font-bold uppercase tracking-[0.14em] text-amber-300">
                Pay via TeleBirr — send exactly {fmtMoney(total)} ETB
              </p>
              <p className="font-mono text-lg font-extrabold">{telebirrNumber}</p>
              {telebirrName && <p className="text-[10px] text-muted-foreground">{telebirrName}</p>}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0 cursor-pointer gap-1.5 rounded-lg bg-white/5 font-mono text-[10px]"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(telebirrNumber);
                  toast.success("TeleBirr number copied.");
                } catch {
                  toast.error("Could not copy.");
                }
              }}
            >
              <ClipboardCheck className="size-3" /> Copy
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3">
            <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            <p className="text-[11px] text-muted-foreground">
              TeleBirr receiving details aren&apos;t published yet — contact the
              platform admin for payment instructions.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">
              Transaction reference *
            </Label>
            <Input
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
              placeholder="From your TeleBirr SMS"
              className="h-10 rounded-xl bg-white/5 font-mono text-xs"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11px] font-semibold text-muted-foreground">
              Payment screenshot *
            </Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-muted-foreground transition-colors hover:bg-white/10"
            >
              <Upload className="size-3.5 shrink-0" />
              <span className="truncate">
                {proofFile ? proofFile.name : "Attach confirmation screenshot"}
              </span>
            </button>
          </div>
        </div>

        {uploadPct !== null && (
          <div>
            <Progress value={uploadPct} className="h-1.5" />
            <p className="mt-1 font-mono text-[9px] text-muted-foreground">
              Uploading proof… {uploadPct}%
            </p>
          </div>
        )}

        <Button
          className="interactive-press cursor-pointer gap-2 rounded-xl"
          onClick={() => void handleSubmit()}
          disabled={submitting || uploadPct !== null}
        >
          {submitting ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
          {submitting ? "Submitting…" : "Submit purchase for review"}
        </Button>
        <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground/70">
          <Info className="mt-0.5 size-3 shrink-0" />
          The total, tier, and duration are locked in when you submit — a later
          price change never affects your request.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment history — this school's submissions with status + reasons
// ---------------------------------------------------------------------------

type DirectorSubmission = {
  _id: Id<"schoolSeatSubmissions">;
  seatCount: number;
  durationMonths: number;
  tierRate: number;
  totalAmount: number;
  tierUsed: number;
  method: string;
  transactionRef: string;
  status: "pending" | "approved" | "rejected";
  submittedAt: number;
  reviewedAt: number | null;
  rejectionReason: string | null;
};

function PaymentHistory({
  submissions,
  loading,
}: {
  submissions: DirectorSubmission[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="glass-panel flex h-24 items-center justify-center rounded-3xl">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
            Payment history
          </p>
          <p className="mt-0.5 type-caption text-muted-foreground">
            Every purchase request, with the exact amounts you submitted
          </p>
        </div>
        <History className="size-5 shrink-0 text-violet-300/60" />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        {submissions.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No purchases yet — use the calculator above to buy your first seats.
          </p>
        ) : (
          submissions.map((s, i) => (
            <motion.div
              key={s._id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.3) }}
              className="glass-soft rounded-2xl border border-white/5 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    className={cn(
                      "gap-1 border font-mono text-[9px] font-bold uppercase",
                      s.status === "pending" && "border-amber-400/30 bg-amber-400/10 text-amber-300",
                      s.status === "approved" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
                      s.status === "rejected" && "border-rose-400/30 bg-rose-400/10 text-rose-300",
                    )}
                  >
                    {s.status === "pending" && <Clock className="size-2.5" />}
                    {s.status === "approved" && <CheckCircle2 className="size-2.5" />}
                    {s.status === "rejected" && <XCircle className="size-2.5" />}
                    {s.status}
                  </Badge>
                  <span className="text-xs font-bold">
                    {s.seatCount} seats · {s.durationMonths} month{s.durationMonths === 1 ? "" : "s"}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Tier {s.tierUsed} · ref {s.transactionRef}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-mono text-sm font-extrabold tabular-nums text-amber-300">
                    {fmtMoney(s.totalAmount)} ETB
                  </span>
                  <p className="font-mono text-[9px] text-muted-foreground">{relativeTime(s.submittedAt)}</p>
                </div>
              </div>
              {s.rejectionReason && (
                <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-400/[0.06] px-2.5 py-1.5 text-[11px] text-rose-300/90">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {s.rejectionReason}
                </p>
              )}
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create class dialog
// ---------------------------------------------------------------------------

function CreateClassDialog({
  open,
  onOpenChange,
  schoolId: _schoolId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  schoolId: Id<"schools">;
}) {
  const friendlyError = useFriendlyError();
  const createClass = useMutation(api.schools.directorCreateClass);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<string>("9");
  const [stream, setStream] = useState<string>("natural");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Class name is required.");
      return;
    }
    setCreating(true);
    try {
      const result = await createClass({
        name: name.trim(),
        gradeLevel: Number(grade) as 9 | 10 | 11 | 12,
        stream: stream as "natural" | "social" | "common",
      });
      toast.success(`Class created! Share code ${result.classCode} with your students.`, {
        duration: 9000,
      });
      onOpenChange(false);
      setName("");
    } catch (e) {
      toast.error(friendlyError(e, "Could not create the class."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4 text-violet-300" /> Create a class
          </DialogTitle>
          <DialogDescription>
            Students join with the auto-generated shareable code — they&apos;re
            pre-configured with the right grade and stream automatically.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Class name</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Grade 12 Natural — Section A"
              className="h-10 rounded-xl bg-white/5"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Grade</span>
              <Select value={grade} onValueChange={setGrade}>
                <SelectTrigger className="h-10 cursor-pointer rounded-xl bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[9, 10, 11, 12].map((g) => (
                    <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Stream</span>
              <Select value={stream} onValueChange={setStream}>
                <SelectTrigger className="h-10 cursor-pointer rounded-xl bg-white/5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="natural">Natural</SelectItem>
                  <SelectItem value="social">Social</SelectItem>
                  <SelectItem value="common">Common</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="cursor-pointer rounded-xl" onClick={() => void handleCreate()} disabled={creating}>
            {creating ? <Loader2 className="size-4 animate-spin" /> : "Create class"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
