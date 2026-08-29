// Admin Payment Reviews section — queue of pending manual payment submissions
// with inline screenshot viewer, Approve/Reject actions, and the receiving
// TeleBirr number prominently displayed as a reminder to cross-check the
// real SMS, not just trust the screenshot.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Receipt,
  Smartphone,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clockTime, relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

export function PaymentReviewsSection() {
  const pendingSubs = useQuery(api.manualPayments.getPendingSubmissions, {});
  const paymentConfig = useQuery(api.manualPayments.getPaymentConfig, {});
  const unmatched = useQuery(api.manualPayments.getUnmatchedIncomingPayments, {});

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);

  const approveSubmission = useMutation(api.manualPayments.approveSubmission);
  const rejectSubmission = useMutation(api.manualPayments.rejectSubmission);

  const [viewingProofId, setViewingProofId] = useState<string | null>(null);
  const proofResult = useQuery(
    api.manualPayments.getProofUrl,
    viewingProofId ? { storageId: viewingProofId } : "skip",
  );

  // Open the proof URL in a new tab when it loads.
  useEffect(() => {
    if (proofResult?.url) {
      window.open(proofResult.url, "_blank", "noopener,noreferrer");
      setViewingProofId(null);
    }
  }, [proofResult]);

  const handleApprove = async (submissionId: string) => {
    setApprovingId(submissionId);
    try {
      await approveSubmission({ submissionId: submissionId as never });
      toast.success("Payment approved — premium granted! 🎉");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Approval failed.");
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
      await rejectSubmission({
        submissionId: rejectingId as never,
        rejectionReason: rejectReason.trim(),
      });
      toast.success("Submission rejected — student notified.");
      setRejectingId(null);
      setRejectReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rejection failed.");
    } finally {
      setRejecting(false);
    }
  };

  const handleViewProof = (storageId: string, submissionId: string) => {
    setLoadingProofId(submissionId);
    setViewingProofId(storageId);
    // The useEffect above will open the URL when the query resolves.
    // Clear the loading state after a brief timeout.
    setTimeout(() => setLoadingProofId(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Receiving number reminder */}
      {paymentConfig && paymentConfig.telebirrNumber && (
        <div className="glass-panel flex items-center gap-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <Smartphone className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">
              Receiving TeleBirr number — cross-check against real SMS
            </p>
            <p className="mt-0.5 font-mono text-lg font-bold text-foreground">
              {paymentConfig.telebirrNumber}
            </p>
            {paymentConfig.telebirrName && (
              <p className="text-xs text-muted-foreground">{paymentConfig.telebirrName}</p>
            )}
          </div>
          <div className="hidden text-right sm:block">
            <p className="font-mono text-[10px] text-muted-foreground">Price</p>
            <p className="font-mono text-base font-bold text-amber-300">
              {paymentConfig.priceEtb} ETB
            </p>
          </div>
        </div>
      )}

      {/* Pending submissions queue */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <Receipt className="size-4 text-amber-300" />
              Payment Reviews
            </h2>
            <p className="text-sm text-muted-foreground">
              Pending submissions awaiting your review. Cross-check the
              transaction reference against the real SMS on the receiving phone.
            </p>
          </div>
          {pendingSubs && pendingSubs.length > 0 && (
            <Badge className="bg-amber-400/10 font-mono text-[10px] text-amber-300">
              {pendingSubs.length} pending
            </Badge>
          )}
        </div>

        {/* Queue */}
        <div className="mt-4 flex flex-col gap-3">
          {pendingSubs === undefined ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : pendingSubs.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2">
              <CheckCircle2 className="size-6 text-emerald-400/60" />
              <p className="text-sm text-muted-foreground">
                No pending submissions. You're all caught up!
              </p>
            </div>
          ) : (
            pendingSubs.map((sub) => (
              <div
                key={sub._id}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  sub.slaBreached
                    ? "border-amber-400/30 bg-amber-400/[0.04]"
                    : "border-white/[0.06] bg-white/[0.02]",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {/* Left: submission details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{sub.studentName}</span>
                      {sub.slaBreached && (
                        <Badge className="bg-amber-400/15 font-mono text-[9px] text-amber-300">
                          <AlertTriangle className="mr-1 size-2.5" />
                          SLA BREACHED
                        </Badge>
                      )}
                    </div>
                    {sub.studentEmail && (
                      <p className="text-[10px] text-muted-foreground">{sub.studentEmail}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="flex items-center gap-1.5 font-mono">
                        <Wallet className="size-3 text-amber-300" />
                        {sub.expectedAmount} {sub.currency}
                      </span>
                      <span className="flex items-center gap-1.5 font-mono">
                        <span className="text-muted-foreground">ref:</span>
                        <code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-amber-200">
                          {sub.transactionRef}
                        </code>
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-muted-foreground">
                        <Clock className="size-3" />
                        {relativeTime(sub.submittedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="cursor-pointer gap-1.5 rounded-lg"
                      onClick={() =>
                        handleViewProof(sub.proofStorageId, sub._id)
                      }
                      disabled={loadingProofId === sub._id}
                    >
                      {loadingProofId === sub._id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <ExternalLink className="size-3.5" />
                      )}
                      View proof
                    </Button>
                    <Button
                      size="sm"
                      className="cursor-pointer gap-1.5 rounded-lg bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
                      onClick={() => handleApprove(sub._id)}
                      disabled={approvingId === sub._id}
                    >
                      {approvingId === sub._id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5" />
                      )}
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Unmatched incoming payments */}
      {unmatched && unmatched.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <AlertTriangle className="size-4 text-amber-300" />
                Unmatched incoming SMS
              </h2>
              <p className="text-xs text-muted-foreground">
                TeleBirr payment notifications that didn't match any pending
                submission. Investigate manually.
              </p>
            </div>
            <Badge className="bg-amber-400/10 font-mono text-[10px] text-amber-300">
              {unmatched.length}
            </Badge>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {unmatched.slice(0, 10).map((item) => (
              <div
                key={item._id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-xs font-mono">
                    {item.parsedTransactionRef ? (
                      <code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-amber-200">
                        {item.parsedTransactionRef}
                      </code>
                    ) : (
                      <span className="text-muted-foreground">no ref parsed</span>
                    )}
                    {item.parsedAmount !== undefined && (
                      <span className="text-amber-300">{item.parsedAmount} ETB</span>
                    )}
                  </p>
                  <p className="truncate font-mono text-[9px] text-muted-foreground">
                    {item.parsedSenderName ?? "unknown sender"} · {relativeTime(item.receivedAt)}
                  </p>
                </div>
                <p className="truncate font-mono text-[9px] text-muted-foreground/50">
                  {item.rawSmsText.slice(0, 80)}…
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

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
            <DialogTitle>Reject payment submission</DialogTitle>
            <DialogDescription>
              The student will be notified with this reason. Please be specific
              (e.g. "Transaction reference doesn't match our SMS records" or
              "Amount received was 400 ETB, not 500 ETB").
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="reject-reason" className="text-xs font-semibold text-muted-foreground">
              Rejection reason (min 3 chars)
            </Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. The transaction reference doesn't match any received payment."
              className="min-h-[80px] rounded-xl bg-white/5 text-sm"
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setRejectingId(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejecting || rejectReason.trim().length < 3}
            >
              {rejecting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <XCircle className="size-3.5" />
              )}
              Reject submission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
