// Upgrade — a genuine value comparison, not a hard sell.
//
// The comparison table renders from PREMIUM_COMPARISON (src/lib/premium.ts),
// which imports the SAME limit constants the backend gates enforce — so the
// marketing table can never drift from reality. The \"why upgrade\" line is
// built from the user's REAL usage (tutor cap hit, weekly quiz used), trial
// state is shown factually, and renewal terms are stated plainly.

import { api } from "@/convex/_generated/api";
import { PREMIUM_PRICE_ETB, SUBSCRIPTION_DAYS } from "@/convex/constants";
import { useAction, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  ChevronRight,
  Crown,
  Info,
  Loader2,
  Lock,
  Smartphone,
  Sparkles,
  Wallet,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clockTime, relativeTime } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { FREE_INCLUDED_IDS, PREMIUM_COMPARISON } from "@/lib/premium";
import { cn } from "@/lib/utils";

type Provider = "telebirr" | "mpesa";
type PaymentState =
  | { phase: "idle" }
  | { phase: "initiating" }
  | { phase: "pending"; paymentId: string; provider: Provider }
  | { phase: "completed"; paymentId: string }
  | { phase: "failed"; message: string };

const PROVIDERS: { id: Provider; name: string; note: string }[] = [
  {
    id: "telebirr",
    name: "TeleBirr",
    note: "Pay with the TeleBirr app — H5 checkout opens in a new tab.",
  },
  {
    id: "mpesa",
    name: "M-Pesa",
    note: "STK push to your phone — approve the prompt on your device.",
  },
];

/** A short, honest \"why upgrade\" line based on this user's real usage. */
function whyUpgrade(entitlements: NonNullable<ReturnType<typeof useEntitlements>>): string {
  if (entitlements.premiumAccess) {
    return "You have premium access right now — this page is for renewing or understanding what you have.";
  }
  if (entitlements.tutorRemainingToday === 0) {
    return `You used all ${entitlements.tutorDailyLimit} free tutor messages today. Premium makes it unlimited — no waiting for tomorrow.`;
  }
  if (entitlements.quizUsedThisWeekTotal >= entitlements.quizWeeklyLimit) {
    return `You used your free weekly quiz allowance this week. Premium unlocks unlimited quizzes and your full score history.`;
  }
  return "Free already gives you the library, todos, timer, streaks, 15 tutor messages a day and a weekly quiz. Premium adds the rest — when you're ready.";
}

/** Small helper so we can type the entitlements query result. */
function useEntitlements() {
  return useQuery(api.subscriptions.getEntitlements);
}

export default function Upgrade() {
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const entitlements = useEntitlements();
  const payments = useQuery(api.paymentsDb.getMyPayments);
  const initiatePayment = useAction(api.payments.initiatePayment);
  const verifyPayment = useAction(api.payments.verifyPayment);

  const [provider, setProvider] = useState<Provider>("telebirr");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [payment, setPayment] = useState<PaymentState>({ phase: "idle" });
  const pollTimerRef = useRef<number | null>(null);

  // Poll the provider until the payment settles, then stop.
  useEffect(() => {
    if (payment.phase !== "pending") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await verifyPayment({ paymentId: payment.paymentId as never });
        if (cancelled) return;
        if (result.status === "completed") {
          setPayment({ phase: "completed", paymentId: payment.paymentId });
          toast.success("Payment confirmed — premium is active.");
        } else if (result.status === "failed") {
          setPayment({ phase: "failed", message: "The payment was not completed." });
        } else {
          pollTimerRef.current = window.setTimeout(poll, 5000);
        }
      } catch (error) {
        if (cancelled) return;
        toast.error(errorMessage(error, "Could not check the payment status."));
        pollTimerRef.current = window.setTimeout(poll, 8000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, [payment, verifyPayment]);

  const handlePay = async () => {
    if (payment.phase === "initiating" || payment.phase === "pending") return;
    if (provider === "mpesa" && phoneNumber.trim().length < 9) {
      toast.error("Enter your phone number in international format (e.g. 251912345678).");
      return;
    }
    setPayment({ phase: "initiating" });
    try {
      const result = await initiatePayment({
        provider,
        amount: PREMIUM_PRICE_ETB,
        phoneNumber: provider === "mpesa" ? phoneNumber.trim() : undefined,
      });
      if (result.checkoutUrl) {
        window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
      }
      setPayment({
        phase: "pending",
        paymentId: result.paymentId as string,
        provider,
      });
    } catch (error) {
      setPayment({ phase: "failed", message: errorMessage(error) });
      toast.error(errorMessage(error, "Could not start the payment."));
    }
  };

  const activeLabel = subscription
    ? subscription.status === "active"
      ? `Premium active · period ends ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : ""}`
      : subscription.status === "trial"
        ? `Trial · ${subscription.trialDaysRemaining} active day${subscription.trialDaysRemaining === 1 ? "" : "s"} left (days you actually study)`
        : subscription.needsUpgrade
          ? "Trial ended — premium features are paused, everything free still works"
          : subscription.status
    : null;

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            // premium access
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Upgrade</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One payment unlocks the full Nexus Academy experience for {SUBSCRIPTION_DAYS} days.
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
                {entitlements.premiumAccess ? "You're on premium" : "Where you are right now"}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{whyUpgrade(entitlements)}</p>
              {!entitlements.premiumAccess && (
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  tutor: {entitlements.tutorUsedToday}/{entitlements.tutorDailyLimit} free messages
                  today · quizzes this week: {entitlements.quizUsedThisWeekTotal}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Free vs premium comparison — rendered from the real limits */}
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

        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          {/* ------- Pricing card ------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel relative overflow-hidden rounded-2xl p-6"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-premium/70 to-transparent" />
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-10 items-center justify-center rounded-xl bg-premium/10 text-premium">
                  <Crown className="size-5" />
                </div>
                <div>
                  <p className="text-base font-extrabold tracking-tight">Nexus Premium</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    plan tier: premium · {SUBSCRIPTION_DAYS}-day access
                  </p>
                </div>
              </div>
              {subscription?.premiumAccess && (
                <Badge className="gap-1 bg-emerald-400/10 font-mono text-[10px] text-emerald-300">
                  <CheckCircle2 className="size-3" /> active
                </Badge>
              )}
            </div>

            <div className="mt-6 flex items-baseline gap-1.5">
              <span className="font-mono text-5xl font-extrabold tabular-nums text-gradient">
                {PREMIUM_PRICE_ETB}
              </span>
              <span className="font-mono text-sm text-muted-foreground">ETB / {SUBSCRIPTION_DAYS} days</span>
            </div>

            <ul className="mt-6 space-y-2.5 text-sm">
              {[
                "Unlimited AI tutor messages, grounded in your stream's curriculum",
                "Unlimited quiz generation + full score history on your journey",
                "AI study plans per subject, auto-scheduled onto your calendar",
                "Premium past exams and teacher guides via signed links",
                "Full journey analytics — score trends, correlations, completion",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2.5 text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-premium" />
                  {feature}
                </li>
              ))}
            </ul>

            {subscription && (
              <p className="mt-6 rounded-xl border border-white/8 bg-white/4 px-3.5 py-2.5 font-mono text-[11px] text-muted-foreground">
                {subscription.status === "active"
                  ? `status: active · period ends ${subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString() : "—"}`
                  : subscription.status === "trial"
                    ? `status: trial · ${subscription.trialActiveDays}/${subscription.trialActiveDays + subscription.trialDaysRemaining} active days used`
                    : subscription.needsUpgrade
                      ? "status: expired — premium features are paused, the free tier still works"
                      : `status: ${subscription.status}`}
              </p>
            )}

            {/* Renewal terms — stated plainly, not in fine print */}
            <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-white/8 bg-white/4 px-3.5 py-3">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <p className="font-mono text-[10px] leading-5 text-muted-foreground">
                How renewal works: manual, never automatic. Your premium lasts{" "}
                {SUBSCRIPTION_DAYS} days from the moment your payment is confirmed.
                When it ends, nothing is charged and nothing is lost — your streaks,
                notes and progress stay. You decide whether to renew.{" "}
                {PREMIUM_PRICE_ETB} ETB is the full amount you pay; there are no
                hidden fees.
              </p>
            </div>
          </motion.div>

          {/* ------- Checkout ------- */}
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="glass-panel flex flex-col rounded-2xl p-6"
          >
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // checkout
            </p>

            <div className="mt-4 space-y-2">
              {PROVIDERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setProvider(option.id)}
                  disabled={payment.phase === "pending" || payment.phase === "initiating"}
                  className={cn(
                    "w-full cursor-pointer rounded-xl border p-3.5 text-left transition-colors disabled:opacity-60",
                    provider === option.id
                      ? "border-premium/45 bg-premium/8"
                      : "border-white/10 bg-white/4 hover:border-white/20",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm font-bold">
                      {option.id === "telebirr" ? (
                        <Wallet className="size-4 text-premium" />
                      ) : (
                        <Smartphone className="size-4 text-premium" />
                      )}
                      {option.name}
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-4 transition-transform",
                        provider === option.id ? "text-premium" : "text-muted-foreground/50",
                      )}
                    />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.note}</p>
                </button>
              ))}
            </div>

            {provider === "mpesa" && (
              <div className="mt-3">
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Phone number · 251912345678"
                  inputMode="tel"
                  disabled={payment.phase === "pending"}
                  className="h-10 rounded-xl bg-white/5 font-mono text-sm"
                />
                <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                  International format — the STK prompt is sent to this number.
                </p>
              </div>
            )}

            <Button
              className="mt-5 h-11 w-full rounded-xl"
              onClick={handlePay}
              disabled={
                payment.phase === "initiating" ||
                payment.phase === "pending" ||
                (provider === "mpesa" && phoneNumber.trim().length < 9)
              }
            >
              {payment.phase === "initiating" || payment.phase === "pending" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
              {payment.phase === "pending"
                ? "Waiting for confirmation…"
                : payment.phase === "initiating"
                  ? "Contacting provider…"
                  : `Pay ${PREMIUM_PRICE_ETB} ETB`}
            </Button>

            <AnimatePresence>
              {payment.phase === "pending" && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 rounded-xl border border-premium/25 bg-premium/8 px-3.5 py-3"
                >
                  <p className="font-mono text-[11px] text-premium">
                    {payment.provider === "telebirr"
                      ? "Checkout opened in a new tab. Complete the payment there — this page updates automatically."
                      : "Check your phone for the M-Pesa prompt and approve it. This page updates automatically."}
                  </p>
                </motion.div>
              )}
              {payment.phase === "completed" && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 flex items-start gap-2.5 rounded-xl border border-emerald-400/25 bg-emerald-400/8 px-3.5 py-3"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                  <div>
                    <p className="text-sm font-bold text-emerald-300">Payment confirmed</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Premium is active for {SUBSCRIPTION_DAYS} days — past exams, plans and
                      unlimited tutoring are unlocked.
                    </p>
                  </div>
                </motion.div>
              )}
              {payment.phase === "failed" && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-400/25 bg-rose-400/8 px-3.5 py-3"
                >
                  <XCircle className="mt-0.5 size-4 shrink-0 text-rose-300" />
                  <div>
                    <p className="text-sm font-bold text-rose-300">Payment not completed</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{payment.message}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="mt-auto pt-5 font-mono text-[10px] leading-4 text-muted-foreground/70">
              {activeLabel ?? "status: checking…"}
              <br />
              Payments are processed by TeleBirr (Ethio telecom) or M-Pesa. Your
              subscription activates the moment the provider confirms — no automatic
              charges afterwards.
            </p>
          </motion.div>
        </div>

        {/* ------- Payment history ------- */}
        <div className="glass-panel rounded-2xl p-5">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            // payment history
          </p>
          {payments === undefined ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : payments.length === 0 ? (
            <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
              No payments yet.
            </p>
          ) : (
            <div className="mt-3 space-y-1.5">
              {payments.map((row: { _id: string; provider: string; amount: number; currency: string; providerTransactionId?: string; createdAt: number; status: string }) => (
                <div
                  key={row._id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/4 px-3.5 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      {row.provider === "telebirr" ? (
                        <Wallet className="size-3.5 text-amber-300" />
                      ) : (
                        <Smartphone className="size-3.5 text-amber-300" />
                      )}
                      {row.provider === "telebirr" ? "TeleBirr" : "M-Pesa"} · {row.amount} {row.currency}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {row.providerTransactionId ?? "pending reference"} ·{" "}
                      {relativeTime(row.createdAt)} · {clockTime(row.createdAt)}
                    </p>
                  </div>
                  <Badge
                    className={cn(
                      "shrink-0 font-mono text-[10px]",
                      row.status === "completed" && "bg-emerald-400/10 text-emerald-300",
                      row.status === "pending" && "bg-amber-400/10 text-amber-300",
                      row.status === "failed" && "bg-rose-400/10 text-rose-300",
                    )}
                  >
                    {row.status}
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
