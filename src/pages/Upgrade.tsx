// Upgrade — premium access page with manual TeleBirr payment submission.
//
// Three sections:
//   1. Honest free-vs-premium comparison (existing — rendered from real
//      limit constants in src/lib/premium.ts).
//   2. Manual payment submission — live price from config, the receiving
//      TeleBirr number, numbered instructions, screenshot upload + tx ref,
//      and a status view (pending → approved/rejected/SLA breach).
//   3. Payment history (existing + manual submissions merged).
//
// The manual payment flow is the primary path now — no merchant API is
// available. Students transfer to a personal TeleBirr number, screenshot
// the confirmation, and submit. Admins review in the /admin Payment
// Reviews tab. An automated SMS webhook can also auto-approve.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  Crown,
  FileText,
  Info,
  Loader2,
  Lock,
  RotateCw,
  Smartphone,
  Sparkles,
  Upload,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { clockTime, relativeTime } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { FREE_INCLUDED_IDS, PREMIUM_COMPARISON } from "@/lib/premium";
import { SUBSCRIPTION_DAYS } from "@/convex/constants";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Upgrade() {
  const entitlements = useQuery(api.subscriptions.getEntitlements, {});
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus, {});
  const paymentConfig = useQuery(api.manualPayments.getPaymentConfig, {});
  const mySubmissions = useQuery(api.manualPayments.getMySubmissions, {});
  const payments = useQuery(api.paymentsDb.getMyPayments, {}) as any;

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Header */}
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            // premium access
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Upgrade
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One payment unlocks the full Nexus Academy experience for{" "}
            {SUBSCRIPTION_DAYS} days.
          </p>
        </div>

        {/* Honest, usage-based framing */}
        {entitlements && (
          <div className="glass-panel flex items-start gap-3 rounded-2xl px-4 py-3">
            <div
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-lg",
                entitlements.premiumAccess
                  ? "bg-emerald-400/10 text-emerald-300"
                  : "bg-premium/10 text-premium",
              )}
            >
              {entitlements.premiumAccess ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold tracking-tight">
                {entitlements.premiumAccess
                  ? "You're on premium"
                  : "Where you are right now"}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                {whyUpgrade(entitlements)}
              </p>
              {!entitlements.premiumAccess && (
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  tutor: {entitlements.tutorUsedToday}/
                  {entitlements.tutorDailyLimit} free messages today · quizzes
                  this week: {entitlements.quizUsedThisWeekTotal}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Free vs premium comparison */}
        <div className="glass-panel overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // free vs premium
            </p>
            <span className="font-mono text-[10px] text-muted-foreground">
              limits enforced by the app, shown exactly
            </span>
          </div>
          <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-px bg-white/5 text-sm">
            <div className="bg-background/60 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              feature
            </div>
            <div className="bg-background/60 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">
              free
            </div>
            <div className="flex items-center gap-1.5 bg-premium/8 px-4 py-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.15em] text-premium">
              <Crown className="size-3" /> premium
            </div>
            {PREMIUM_COMPARISON.map((row) => (
              <div key={row.id} className="contents">
                <div className="bg-background/60 px-4 py-3 font-medium text-foreground/90">
                  {row.feature}
                </div>
                <div className="bg-background/60 px-4 py-3 text-muted-foreground">
                  {FREE_INCLUDED_IDS.has(row.id) ? (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-400/80" />
                      {row.free}
                    </span>
                  ) : (
                    row.free
                  )}
                </div>
                <div className="flex items-center gap-1.5 bg-premium/5 px-4 py-3 text-foreground/90">
                  <CheckCircle2 className="size-3.5 shrink-0 text-premium" />
                  {row.premium}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Manual payment section */}
        <ManualPaymentSection
          priceEtb={paymentConfig?.priceEtb ?? 500}
          telebirrNumber={paymentConfig?.telebirrNumber ?? ""}
          telebirrName={paymentConfig?.telebirrName ?? ""}
          slaHours={paymentConfig?.slaHours ?? 24}
          goodwillHours={paymentConfig?.goodwillBonusHours ?? 24}
          submissions={mySubmissions ?? []}
        />

        {/* Payment history (merged: existing + manual) */}
        <div className="glass-panel rounded-2xl p-5">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            // payment history
          </p>
          {payments === undefined && mySubmissions === undefined ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (payments?.length ?? 0) === 0 && (mySubmissions?.length ?? 0) === 0 ? (
            <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
              No payments yet.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {/* Manual submissions */}
              {mySubmissions?.map((sub) => (
                <div
                  key={sub._id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/4 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Wallet className="size-3.5 text-amber-300" />
                      {sub.method === "telebirr_personal" ? "TeleBirr" : "Manual"} · {sub.expectedAmount} ETB
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      ref: {sub.transactionRef} · {relativeTime(sub.submittedAt)} · {clockTime(sub.submittedAt)}
                    </p>
                  </div>
                  <Badge
                    className={cn(
                      "shrink-0 font-mono text-[10px]",
                      sub.status === "approved" && "bg-emerald-400/10 text-emerald-300",
                      sub.status === "pending" && "bg-amber-400/10 text-amber-300",
                      sub.status === "rejected" && "bg-rose-400/10 text-rose-300",
                    )}
                  >
                    {sub.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}

// ---------------------------------------------------------------------------
// Manual payment section — the core of the new payment system
// ---------------------------------------------------------------------------

function ManualPaymentSection({
  priceEtb,
  telebirrNumber,
  telebirrName,
  slaHours,
  goodwillHours,
  submissions,
}: {
  priceEtb: number;
  telebirrNumber: string;
  telebirrName: string;
  slaHours: number;
  goodwillHours: number;
  submissions: Array<{
    _id: string;
    expectedAmount: number;
    transactionRef: string;
    status: string;
    submittedAt: number;
    reviewedAt?: number;
    rejectionReason?: string;
    slaBreached: boolean;
    goodwillBonusHoursApplied?: number;
    reviewedBy?: string;
  }>;
}) {
  const submitPaymentProof = useAction(api.manualPayments.submitPaymentProof);
  const generateUploadUrl = useAction(api.manualPayments.generateUploadUrl);

  const [transactionRef, setTransactionRef] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // The latest pending submission (or the most recent one).
  const latestSubmission = submissions[0]; // submissions are desc by date

  // Handle file selection
  const handleFile = useCallback((next: File | null) => {
    if (next && !next.type.startsWith("image/") && next.type !== "application/pdf") {
      toast.error("Only image or PDF files are accepted as proof.");
      return;
    }
    if (next && next.size > 10 * 1024 * 1024) {
      toast.error("File too large — maximum 10 MB.");
      return;
    }
    setFile(next);
  }, []);

  // Submit the payment proof
  const handleSubmit = async () => {
    if (!file) {
      toast.error("Upload a screenshot of your payment confirmation first.");
      return;
    }
    if (transactionRef.trim().length < 3) {
      toast.error("Enter the transaction reference from your TeleBirr confirmation SMS.");
      return;
    }
    setSubmitting(true);
    setUploadProgress(0);
    try {
      // Step 1 — get a one-time upload URL from Convex storage.
      const { url: uploadUrl } = await generateUploadUrl({});

      // Step 2 — upload the screenshot to Convex storage via XHR (for
      // upload progress). The response body contains the storageId.
      const storageId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", uploadUrl);
        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
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
            reject(new Error(`Upload returned HTTP ${xhr.status}.`));
          }
        });
        xhr.addEventListener("error", () => {
          reject(new Error("Upload failed (network error)."));
        });
        xhr.send(file);
      });

      // Step 3 — submit the payment proof (action inserts row + sends
      // Telegram notification + logs to systemEvents).
      await submitPaymentProof({
        transactionRef: transactionRef.trim(),
        proofStorageId: storageId,
        method: "telebirr_personal",
      });

      toast.success("Payment proof submitted! An admin will review it shortly.");
      setFile(null);
      setTransactionRef("");
      setUploadProgress(0);
    } catch (error) {
      toast.error(errorMessage(error, "Could not submit your payment proof."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel relative overflow-hidden rounded-2xl p-5 sm:p-6"
    >
      {/* Premium gradient top line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-premium/70 to-transparent" />
      {/* Background glow */}
      <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-premium/5 blur-3xl" />

      <div className="relative">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            // manual payment · TeleBirr
          </p>
          <span className="font-mono text-[10px] text-muted-foreground">
            personal transfer · no merchant API needed
          </span>
        </div>

        {/* Price + receiving number — the "pay to" card */}
        <div className="mt-5 grid gap-4 sm:grid-cols-[0.9fr_1.1fr]">
          {/* Left: price */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:p-5">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-premium/10 text-premium">
                <Crown className="size-5" />
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight">Nexus Premium</p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  {SUBSCRIPTION_DAYS}-day access
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-baseline gap-1.5">
              <span className="font-mono text-4xl font-extrabold tabular-nums text-gradient">
                {priceEtb}
              </span>
              <span className="font-mono text-sm text-muted-foreground">ETB</span>
            </div>
            <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-premium" />
                Unlimited AI tutor messages
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-premium" />
                Unlimited quizzes + full score history
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-premium" />
                AI study plans + calendar sync
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-premium" />
                Premium past exams + teacher guides
              </li>
            </ul>
          </div>

          {/* Right: receiving number + instructions */}
          <div className="flex flex-col rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-4 sm:p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-300">
              send payment to
            </p>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                <Smartphone className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                {telebirrNumber ? (
                  <>
                    <p className="font-mono text-lg font-bold tracking-tight text-foreground">
                      {telebirrNumber}
                    </p>
                    {telebirrName && (
                      <p className="text-xs text-muted-foreground">{telebirrName}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Receiving number not configured yet. Ask the admin to set it in
                    the Keys tab.
                  </p>
                )}
              </div>
              {telebirrNumber && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(telebirrNumber);
                    toast.success("Number copied to clipboard.");
                  }}
                  className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:text-foreground"
                  title="Copy number"
                >
                  <Copy className="size-3.5" />
                </button>
              )}
            </div>

            {/* Numbered instructions */}
            <div className="mt-4 space-y-2.5">
              {[
                { n: 1, text: `Send ${priceEtb} ETB to the TeleBirr number above.` },
                { n: 2, text: "Screenshot the confirmation SMS you receive." },
                { n: 3, text: "Enter the transaction reference below (e.g. DHA1O2T6RN)." },
                { n: 4, text: "Upload the screenshot and submit. An admin reviews it — usually within " + slaHours + " hours." },
              ].map((step) => (
                <div key={step.n} className="flex items-start gap-2.5">
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-amber-400/15 font-mono text-[10px] font-bold text-amber-300">
                    {step.n}
                  </span>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {step.text}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Submission form */}
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          {/* Left: screenshot upload */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-muted-foreground">
              Payment screenshot
            </Label>
            <FileUploadArea file={file} onFile={handleFile} disabled={submitting} />
          </div>

          {/* Right: transaction ref + submit */}
          <div className="flex flex-col gap-2">
            <Label className="text-xs font-semibold text-muted-foreground">
              Transaction reference
            </Label>
            <Input
              value={transactionRef}
              onChange={(e) => setTransactionRef(e.target.value)}
              placeholder="e.g. DHA1O2T6RN"
              className="h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={submitting}
            />
            <p className="text-[10px] text-muted-foreground">
              From your TeleBirr confirmation SMS — the alphanumeric code after
              "የሂሳብ እንቅስቃሴ ቁጥርዎ".
            </p>

            {/* Submit button */}
            <Button
              className="mt-2 h-10 w-full cursor-pointer gap-2 rounded-xl"
              onClick={handleSubmit}
              disabled={submitting || !file || transactionRef.trim().length < 3}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {uploadProgress > 0 && uploadProgress < 100
                    ? `Uploading… ${uploadProgress}%`
                    : "Submitting…"}
                </>
              ) : (
                <>
                  <Upload className="size-4" />
                  Submit payment proof
                </>
              )}
            </Button>

            {submitting && uploadProgress > 0 && uploadProgress < 100 && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-premium/80 to-premium transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Status view — tells the student exactly where things stand */}
        {latestSubmission && (
          <SubmissionStatusCard
            submission={latestSubmission}
            slaHours={slaHours}
            goodwillHours={goodwillHours}
          />
        )}

        {/* Renewal terms */}
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/8 bg-white/4 px-3.5 py-3">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <p className="font-mono text-[10px] leading-5 text-muted-foreground">
            How renewal works: manual, never automatic. Your premium lasts{" "}
            {SUBSCRIPTION_DAYS} days from the moment your payment is confirmed.
            When it ends, nothing is charged and nothing is lost — your
            streaks, notes and progress stay. {priceEtb} ETB is the full
            amount you pay; there are no hidden fees.
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// File upload area — drag-and-drop or click to browse
// ---------------------------------------------------------------------------

function FileUploadArea({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  disabled: boolean;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFile(e.dataTransfer.files?.[0] ?? null);
      }}
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
        dragging
          ? "border-primary bg-primary/10"
          : "border-border bg-white/[0.02]",
        disabled && "opacity-50",
      )}
    >
      <input
        id="payment-screenshot"
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        disabled={disabled}
      />
      {file ? (
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
            <CheckCircle2 className="size-5" />
          </div>
          <p className="max-w-full truncate text-xs font-semibold">{file.name}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {(file.size / 1024).toFixed(0)} KB
          </p>
          <button
            type="button"
            onClick={() => onFile(null)}
            disabled={disabled}
            className="cursor-pointer text-xs text-muted-foreground hover:text-rose-300"
          >
            Remove
          </button>
        </div>
      ) : (
        <label
          htmlFor="payment-screenshot"
          className="flex cursor-pointer flex-col items-center gap-2"
        >
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Upload className="size-5" />
          </div>
          <p className="text-xs font-semibold">Drop screenshot here</p>
          <p className="text-[10px] text-muted-foreground">
            or{" "}
            <span className="font-semibold text-primary underline underline-offset-2">
              browse files
            </span>
          </p>
        </label>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Submission status card — shows the student where their submission stands
// ---------------------------------------------------------------------------

function SubmissionStatusCard({
  submission,
  slaHours,
  goodwillHours,
}: {
  submission: {
    _id: string;
    expectedAmount: number;
    transactionRef: string;
    status: string;
    submittedAt: number;
    reviewedAt?: number;
    rejectionReason?: string;
    slaBreached: boolean;
    goodwillBonusHoursApplied?: number;
    reviewedBy?: string;
  };
  slaHours: number;
  goodwillHours: number;
}) {
  const isAutoApproved = submission.reviewedBy === "system:sms-auto";

  if (submission.status === "approved") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.06] p-4"
      >
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-300" />
        <div>
          <p className="text-sm font-bold text-emerald-300">Premium activated! 🎉</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your payment (ref: {submission.transactionRef}) was{" "}
            {isAutoApproved ? "auto-verified from your SMS" : "confirmed by an admin"}.
            Premium is active for {SUBSCRIPTION_DAYS} days
            {submission.goodwillBonusHoursApplied
              ? ` + ${submission.goodwillBonusHoursApplied} bonus hours (sorry for the wait!)`
              : ""}
            .
          </p>
        </div>
      </motion.div>
    );
  }

  if (submission.status === "rejected") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-5 flex items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-400/[0.06] p-4"
      >
        <XCircle className="mt-0.5 size-5 shrink-0 text-rose-300" />
        <div>
          <p className="text-sm font-bold text-rose-300">
            Submission not approved
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your submission (ref: {submission.transactionRef}) was not approved.
            {submission.rejectionReason && (
              <span>
                {" "}
                Reason: {submission.rejectionReason}
              </span>
            )}
            {" "}
            Please check your reference number and try again.
          </p>
        </div>
      </motion.div>
    );
  }

  // Pending
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mt-5 flex items-start gap-3 rounded-2xl border p-4",
        submission.slaBreached
          ? "border-amber-400/25 bg-amber-400/[0.06]"
          : "border-white/8 bg-white/[0.03]",
      )}
    >
      {submission.slaBreached ? (
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-300" />
      ) : (
        <Clock className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      )}
      <div>
        <p
          className={cn(
            "text-sm font-bold",
            submission.slaBreached ? "text-amber-300" : "text-foreground",
          )}
        >
          {submission.slaBreached
            ? "Your review is taking longer than expected — sorry! 🙏"
            : "Payment proof submitted — awaiting review"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {submission.slaBreached
            ? `We're sorry for the delay. You'll get an extra ${goodwillHours} hours of premium once confirmed, as an apology. Thank you for your patience.`
            : `Usually confirmed within ${slaHours} hours. If an SMS auto-verification is set up, it may be confirmed within minutes of your transfer.`}
        </p>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Helper: why upgrade copy
// ---------------------------------------------------------------------------

function whyUpgrade(e: {
  premiumAccess: boolean;
  tutorUsedToday: number;
  tutorDailyLimit: number;
  quizUsedThisWeekTotal: number;
}): string {
  if (e.premiumAccess) {
    return "Full premium access is unlocked — past exams, plans, and unlimited tutoring are all available. Enjoy!";
  }
  if (e.tutorUsedToday >= e.tutorDailyLimit) {
    return "You've used all your free tutor messages for today — upgrade for unlimited messages, grounded in your stream's curriculum.";
  }
  return "Free tier is active: browse the library, use the focus timer, and study with limited AI help. Upgrade for past exams, plans, and unlimited tutoring.";
}
