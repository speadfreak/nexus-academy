// Admin Fraud-Pattern View — surfaces suspicious patterns for HUMAN
// REVIEW only. Never auto-blocks, never auto-rejects. Consistent with
// the platform's "always allow manual review, never auto-reject"
// philosophy.
//
// Three pattern types, each in its own collapsible card:
//   1. Referral farming — >5 signups from the same code within 1 hour
//   2. Duplicate transaction references — same ref from >=2 users
//   3. Rapid repeated submissions — same user, 3+ in 1 hour
//
// Privacy-respecting: uses only signals already present in existing
// data (timestamps, referral codes, transaction references). No device
// fingerprinting, no IP tracking, no invasive identification.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Clock,
  Copy,
  Eye,
  Loader2,
  Shield,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  UserX,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Severity helpers ───────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { ring: string; text: string; bg: string; label: string }> = {
  high: {
    ring: "border-rose-400/40",
    text: "text-rose-300",
    bg: "bg-rose-400/[0.06]",
    label: "High",
  },
  medium: {
    ring: "border-amber-400/40",
    text: "text-amber-300",
    bg: "bg-amber-400/[0.06]",
    label: "Medium",
  },
  low: {
    ring: "border-sky-400/40",
    text: "text-sky-300",
    bg: "bg-sky-400/[0.06]",
    label: "Low",
  },
};

function timeRange(start: number, end: number): string {
  const startDate = new Date(start).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const endDate = new Date(end).toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startDate} → ${endDate}`;
}

// ── Component ──────────────────────────────────────────────────────────

export function AdminFraudSection() {
  const report = useQuery(api.fraudDetection.getFraudPatternReport);

  if (report === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (report === null) {
    return (
      <div className="glass-panel rounded-2xl p-5 text-center text-sm text-muted-foreground">
        Admin access required to view the fraud-pattern report.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-rose-400/[0.05] via-white/[0.01] to-transparent p-5 sm:p-6"
      >
        <div className="pointer-events-none absolute -top-12 -right-10 size-40 rounded-full bg-rose-400/[0.1] blur-[60px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 16 }}
              className="flex size-11 items-center justify-center rounded-2xl bg-rose-400/15 text-rose-300"
              style={{ boxShadow: "0 0 24px -4px rgb(244,63,94/0.4)" }}
            >
              <ShieldAlert className="size-5" />
            </motion.div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-rose-300">
                // fraud patterns · review only
              </p>
              <h2 className="text-lg font-extrabold tracking-tight">Fraud-Pattern Detection</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider",
                report.totalFlags === 0
                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
                  : "border-rose-400/20 bg-rose-400/10 text-rose-300",
              )}
            >
              <Shield className="size-3" />
              {report.totalFlags === 0 ? "All clear" : `${report.totalFlags} flag${report.totalFlags === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>

        {/* Privacy note */}
        <div className="relative mt-4 flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
          <Sparkles className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="font-semibold text-foreground">Privacy-respecting:</span> uses
            only signals already present in existing data (timestamps, referral codes,
            transaction references). No device fingerprinting, no IP tracking. Patterns
            are surfaced for human review only — nothing is ever auto-blocked or
            auto-rejected. Take action via the existing admin tools (Users / Payment
            Reviews).
          </p>
        </div>

        {/* Quick stats */}
        {report.totalFlags > 0 && (
          <div className="relative mt-4 grid grid-cols-3 gap-2">
            <QuickStatCard
              icon={<Users className="size-4" />}
              label="Referral farms"
              counts={report.counts.referralFarms}
            />
            <QuickStatCard
              icon={<Copy className="size-4" />}
              label="Duplicate refs"
              counts={report.counts.duplicateRefs}
            />
            <QuickStatCard
              icon={<Clock className="size-4" />}
              label="Rapid submissions"
              counts={report.counts.rapidSubmissions}
            />
          </div>
        )}
      </motion.div>

      {/* Patterns */}
      {report.totalFlags === 0 ? (
        <AllClearState />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Referral farms */}
          {report.referralFarms.length > 0 && (
            <PatternCard
              icon={<Users className="size-4" />}
              title="Referral farming"
              subtitle={`>5 signups from the same referrer within 1 hour · ${report.referralFarms.length} flag${report.referralFarms.length === 1 ? "" : "s"}`}
            >
              <div className="flex flex-col gap-2">
                {report.referralFarms.map((flag, i) => {
                  const style = SEVERITY_STYLES[flag.severity]!;
                  return (
                    <motion.div
                      key={`${flag.referrerUserId}-${i}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className={cn(
                        "rounded-2xl border bg-white/[0.02] p-4",
                        style.ring,
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                                style.bg,
                                style.text,
                              )}
                            >
                              {style.label}
                            </span>
                            <p className="truncate text-sm font-bold text-foreground">
                              {flag.referrerName}
                            </p>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {flag.signupCount} signups in a 1-hour window · referrer {flag.referrerEmail ?? "no email"}
                          </p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {timeRange(flag.windowStart, flag.windowEnd)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("font-mono text-2xl font-bold tabular-nums", style.text)}>
                            {flag.signupCount}
                          </p>
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            signups
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                        <Eye className="size-3" />
                        Investigate via Admin → Users → filter by referrer. Each signup user
                        ID is in the audit log.
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </PatternCard>
          )}

          {/* Duplicate transaction refs */}
          {report.duplicateRefs.length > 0 && (
            <PatternCard
              icon={<Copy className="size-4" />}
              title="Duplicate transaction references"
              subtitle={`Same transactionRef submitted by ≥2 different users · ${report.duplicateRefs.length} flag${report.duplicateRefs.length === 1 ? "" : "s"}`}
            >
              <div className="flex flex-col gap-2">
                {report.duplicateRefs.map((flag, i) => {
                  const style = SEVERITY_STYLES[flag.severity]!;
                  return (
                    <motion.div
                      key={`${flag.transactionRef}-${i}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className={cn(
                        "rounded-2xl border bg-white/[0.02] p-4",
                        style.ring,
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                                style.bg,
                                style.text,
                              )}
                            >
                              {style.label}
                            </span>
                            <p className="truncate font-mono text-sm font-bold text-foreground">
                              {flag.transactionRef}
                            </p>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            Submitted by {flag.submitterCount} different user{flag.submitterCount === 1 ? "" : "s"}:
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {flag.submitterNames.map((name, j) => (
                              <span
                                key={j}
                                className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("font-mono text-2xl font-bold tabular-nums", style.text)}>
                            {flag.submitterCount}
                          </p>
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            users
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                        <Eye className="size-3" />
                        Compare the screenshots in Admin → Payment Reviews. If one user
                        copied another's reference, reject the duplicate.
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </PatternCard>
          )}

          {/* Rapid submissions */}
          {report.rapidSubmissions.length > 0 && (
            <PatternCard
              icon={<Clock className="size-4" />}
              title="Rapid repeated submissions"
              subtitle={`Same user, 3+ manual payments in 1 hour · ${report.rapidSubmissions.length} flag${report.rapidSubmissions.length === 1 ? "" : "s"}`}
            >
              <div className="flex flex-col gap-2">
                {report.rapidSubmissions.map((flag, i) => {
                  const style = SEVERITY_STYLES[flag.severity]!;
                  return (
                    <motion.div
                      key={`${flag.userId}-${i}`}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25, delay: i * 0.04 }}
                      className={cn(
                        "rounded-2xl border bg-white/[0.02] p-4",
                        style.ring,
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                                style.bg,
                                style.text,
                              )}
                            >
                              {style.label}
                            </span>
                            <p className="truncate text-sm font-bold text-foreground">
                              {flag.userName}
                            </p>
                            {flag.userEmail && (
                              <span className="truncate font-mono text-[10px] text-muted-foreground">
                                {flag.userEmail}
                              </span>
                            )}
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {flag.submissionCount} manual payment submission{flag.submissionCount === 1 ? "" : "s"} in a 1-hour window
                          </p>
                          <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {timeRange(flag.windowStart, flag.windowEnd)}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className={cn("font-mono text-2xl font-bold tabular-nums", style.text)}>
                            {flag.submissionCount}
                          </p>
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            submissions
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                        <Eye className="size-3" />
                        Review the user's submissions in Admin → Payment Reviews. Multiple
                        attempts could be a genuine mistake — verify before acting.
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </PatternCard>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function PatternCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel rounded-3xl p-5 sm:p-6"
    >
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
          {icon}
        </div>
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </motion.div>
  );
}

function QuickStatCard({
  icon,
  label,
  counts,
}: {
  icon: React.ReactNode;
  label: string;
  counts: { high: number; medium: number; low: number };
}) {
  const total = counts.high + counts.medium + counts.low;
  return (
    <div className="glass-soft rounded-2xl p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-rose-300/80">{icon}</span>
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          {label}
        </p>
      </div>
      <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-foreground">{total}</p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px]">
        <span className="font-mono text-rose-300">{counts.high}h</span>
        <span className="font-mono text-amber-300">{counts.medium}m</span>
        <span className="font-mono text-sky-300">{counts.low}l</span>
      </div>
    </div>
  );
}

function AllClearState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-soft flex flex-col items-center rounded-3xl px-6 py-16 text-center"
    >
      <div className="relative">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 shadow-[0_0_40px_-12px_rgb(16,185,129/0.6)]">
          <Shield className="size-8" />
        </div>
        <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-300">
          <Sparkles className="size-3" />
        </div>
      </div>
      <h3 className="mt-6 text-xl font-extrabold tracking-tight">No suspicious patterns detected</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        All three detection rules (referral farming, duplicate transaction references,
        rapid repeated submissions) ran against the live data and found nothing worth
        flagging. Keep monitoring — the report refreshes every time you open this tab.
      </p>
    </motion.div>
  );
}
