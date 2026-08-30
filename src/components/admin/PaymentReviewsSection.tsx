// Admin Payment Reviews section — queue of pending manual payment submissions
// with inline screenshot viewer, Approve/Reject actions, and the receiving
// TeleBirr number prominently displayed as a reminder to cross-check the
// real SMS, not just trust the screenshot.
//
// REAL-TIME NOTIFICATIONS: when a new payment submission arrives while the
// admin is on this page, the system:
//   1. Plays a distinctive notification sound (generated via Web Audio API —
//      no external audio file needed)
//   2. Shows a browser notification (via the Notification API, if permission
//      is granted)
//   3. Shows a Sonner toast with the student name + amount
//   4. Vibrates the device (if supported, e.g. on mobile)
// The poller runs every 10 seconds via Convex's reactive useQuery — when
// the pending count or latest submission ID changes, the notification fires.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Receipt,
  Smartphone,
  Sparkles,
  Volume2,
  VolumeX,
  Wallet,
  XCircle,
} from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useRef, useState, useCallback } from "react";
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

// ---------------------------------------------------------------------------
// Notification sound generator — uses the Web Audio API to play a pleasant
// two-tone "ding-dong" sound. No external audio file needed; works on all
// modern browsers (Chrome, Firefox, Safari, Edge). Falls back silently if
// Web Audio isn't available.
// ---------------------------------------------------------------------------

function playNotificationSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();

    // Two-tone "ding-dong" — a rising E5 (659 Hz) then falling C5 (523 Hz).
    // Pleasant, distinct from system sounds, and not annoying on repeat.
    const now = ctx.currentTime;

    // First tone (higher, shorter)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.value = 659.25; // E5
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.01); // quick fade-in
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25); // decay
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second tone (lower, slightly delayed — the "dong")
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.value = 523.25; // C5
    gain2.gain.setValueAtTime(0, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.3, now + 0.13);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.5);

    // Clean up the audio context after the sound finishes.
    setTimeout(() => ctx.close(), 1000);
  } catch {
    // Web Audio not available or blocked — silent fallback.
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PaymentReviewsSection() {
  const pendingSubs = useQuery(api.manualPayments.getPendingSubmissions, {});
  const pendingCount = useQuery(api.manualPayments.getPendingCount, {});
  const paymentConfig = useQuery(api.manualPayments.getPaymentConfig, {});
  const unmatched = useQuery(api.manualPayments.getUnmatchedIncomingPayments, {});

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [loadingProofId, setLoadingProofId] = useState<string | null>(null);

  // Notification settings
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  // Track the previous state to detect NEW submissions.
  // We compare the latest submission ID + count — if either changes
  // AND the count increased, a new submission arrived.
  const prevLatestIdRef = useRef<string | null>(null);
  const prevCountRef = useRef<number>(0);

  // Ref to the pending subs so the notification effect can access the
  // latest data without re-running on every render.
  const pendingSubsRef = useRef(pendingSubs);
  pendingSubsRef.current = pendingSubs;

  const approveSubmission = useMutation(api.manualPayments.approveSubmission);
  const rejectSubmission = useMutation(api.manualPayments.rejectSubmission);

  const [viewingProofId, setViewingProofId] = useState<string | null>(null);
  const proofResult = useQuery(
    api.manualPayments.getProofUrl,
    viewingProofId ? { storageId: viewingProofId } : "skip",
  );

  useEffect(() => {
    if (proofResult?.url) {
      window.open(proofResult.url, "_blank", "noopener,noreferrer");
      setViewingProofId(null);
    }
  }, [proofResult]);

  // --- Real-time notification system ---
  // Fires when a new pending submission is detected (count increased or
  // latestId changed). Plays a sound, shows a browser notification, shows
  // a toast, and vibrates.
  useEffect(() => {
    if (!pendingCount) return;

    const { count, latestId } = pendingCount;
    const prevCount = prevCountRef.current;
    const prevLatestId = prevLatestIdRef.current;

    // Update refs FIRST so we don't fire again on re-renders.
    prevLatestIdRef.current = latestId;
    prevCountRef.current = count;

    // Skip on initial load (no previous state) — don't blast the admin
    // with a notification for submissions that were already pending when
    // they opened the page.
    if (prevLatestId === null && prevCount === 0) {
      // This is the first load — just record the state, don't notify.
      return;
    }

    // Check if a new submission arrived:
    // - count increased, OR
    // - latestId changed (new submission even if count is the same —
    //   e.g. one was approved and another came in simultaneously)
    const isNewSubmission =
      (count > prevCount || (latestId !== prevLatestId && latestId !== null)) &&
      count > 0;

    if (!isNewSubmission) return;

    // Find the new submission's details from the full pending list.
    const newSub = pendingSubsRef.current?.find((s) => s._id === latestId);
    const studentName = newSub?.studentName ?? "A student";
    const amount = newSub?.expectedAmount ?? "the premium amount";

    // 1. Play sound
    if (soundEnabled) {
      playNotificationSound();
    }

    // 2. Vibrate (mobile)
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }

    // 3. Browser notification
    if (notifPermission === "granted" && latestId) {
      try {
        const n = new Notification("🔔 New Payment Submission!", {
          body: `${studentName} submitted ${amount} ETB · ref: ${newSub?.transactionRef ?? "unknown"}`,
          icon: "/logo.svg",
          tag: "payment-notification",
          requireInteraction: true,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Notification API not available — toast only.
      }
    }

    // 4. In-app toast
    toast.success(`🔔 New payment submission from ${studentName} — ${amount} ETB`, {
      duration: 10000,
      description: newSub?.transactionRef
        ? `Ref: ${newSub.transactionRef} · Click to review`
        : undefined,
      action: {
        label: "Review",
        onClick: () => {
          // Scroll to the top of the section.
          const el = document.querySelector("[data-payment-reviews]");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      },
    });
  }, [pendingCount, soundEnabled, notifPermission]);

  // Request browser notification permission when the admin enables it.
  const handleEnableNotifications = useCallback(async () => {
    if (typeof Notification === "undefined") {
      toast.error("Your browser doesn't support notifications.");
      return;
    }
    if (Notification.permission === "granted") {
      setNotifPermission("granted");
      toast.success("Browser notifications are already enabled!");
      return;
    }
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === "granted") {
      toast.success("Browser notifications enabled! You'll be alerted when new submissions arrive.");
      // Play a test sound so the admin knows what it sounds like.
      playNotificationSound();
    } else {
      toast.info("Notifications blocked. You can still get in-app toast + sound alerts.");
    }
  }, []);

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
    setTimeout(() => setLoadingProofId(null), 2000);
  };

  return (
    <div className="flex flex-col gap-4" data-payment-reviews>
      {/* Real-time notification banner */}
      <div className="glass-panel flex items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/[0.03] p-3.5">
        <div className="flex items-center gap-3">
          <div className="relative">
            {pendingCount && pendingCount.count > 0 ? (
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              >
                <BellRing className="size-5 text-amber-300" />
              </motion.div>
            ) : (
              <Bell className="size-5 text-muted-foreground" />
            )}
            {pendingCount && pendingCount.count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold text-amber-950">
                {pendingCount.count}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold tracking-tight">
              {pendingCount && pendingCount.count > 0
                ? `${pendingCount.count} pending review${pendingCount.count === 1 ? "" : "s"}`
                : "All caught up — no pending reviews"}
            </p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {notifPermission === "granted"
                ? "🔔 Browser notifications + sound ON"
                : "In-app alerts only · click to enable browser notifications"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Sound toggle */}
          <button
            type="button"
            onClick={() => {
              setSoundEnabled((v) => !v);
              if (!soundEnabled) playNotificationSound(); // test sound when enabling
            }}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:text-foreground"
            title={soundEnabled ? "Mute notifications" : "Enable sound"}
          >
            {soundEnabled ? (
              <Volume2 className="size-4 text-amber-300" />
            ) : (
              <VolumeX className="size-4" />
            )}
          </button>
          {/* Browser notification enable */}
          {notifPermission !== "granted" && (
            <button
              type="button"
              onClick={handleEnableNotifications}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-400/20"
              title="Enable browser notifications"
            >
              <BellRing className="size-3.5" />
              Enable alerts
            </button>
          )}
          {notifPermission === "granted" && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-300">
              <CheckCircle2 className="size-3" />
              Live
            </span>
          )}
        </div>
      </div>

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
                No pending submissions. You&apos;re all caught up!
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
                TeleBirr payment notifications that didn&apos;t match any pending
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
              (e.g. &quot;Transaction reference doesn&apos;t match our SMS records&quot; or
              &quot;Amount received was 400 ETB, not 500 ETB&quot;).
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
