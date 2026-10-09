// PartnerStats — /partner/:secretToken
//
// The promoter-facing stats page. NO LOGIN — gated by the promoter's
// unguessable secret token (32+ hex chars, regenerable by the admin).
// Mobile-first, premium dark/gold, consistent with the app's design
// language.
//
// PRIVACY (absolute): everything on this page is AGGREGATE. The public
// query returns only the promoter's own numbers — never a referred
// student's name, email, or any identifying detail, including in API
// responses. Many referred students are minors; the published Privacy
// Policy forbids sharing student data with third parties.
//
// BEHAVIOR:
//   • Works even when the program is paused/disabled — shows a calm
//     notice that new referrals are currently paused; earnings and
//     payout history remain visible.
//   • Invalid token renders the generic NotFound with NO hint about
//     token validity (the page doesn't exist, as far as anyone can tell).
//   • "How it works" states the hold window honestly — no promises about
//     official exam outcomes, no fake urgency, no fabricated numbers.

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useParams } from "react-router";
import { lazy, Suspense, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BadgeCheck,
  Check,
  Copy,
  Eye,
  Loader2,
  PauseCircle,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

function money(n: number): string {
  return Math.round(n * 100) / 100 >= 1000
    ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n)
    : String(Math.round(n * 100) / 100);
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Invalid token → the REAL generic NotFound page (lazy). Identical to any
// random 404 — no hint that a partner page exists at this URL.
const LazyNotFound = lazy(() => import("@/pages/NotFound"));
function GenericNotFound() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <LazyNotFound />
    </Suspense>
  );
}

export default function PartnerStats() {
  const { secretToken } = useParams<{ secretToken: string }>();
  const stats = useQuery(api.affiliates.getPartnerStats, {
    token: secretToken ?? "",
  });
  const [copied, setCopied] = useState(false);

  // While resolving: quiet blank — never a hint about validity.
  if (stats === undefined) {
    return <div className="min-h-dvh bg-[#0a0c10]" aria-hidden="true" />;
  }
  // Unknown token → the generic NotFound. No "invalid token" message.
  if (stats === null) {
    return <GenericNotFound />;
  }

  const link = `${window.location.origin}/${stats.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable — the link is visible regardless
    }
  };

  const paused = !stats.programEnabled || stats.status !== "active";

  return (
    <div className="min-h-dvh bg-[#0a0c10] text-[#f4f1ea]">
      {/* subtle gold ambience */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-amber-400/[0.07] blur-3xl" />
        <div className="absolute -left-32 top-1/2 size-96 rounded-full bg-amber-500/[0.05] blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-xl px-4 pb-16 pt-10 sm:pt-14">
        {/* ── Header ── */}
        <header className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-amber-300/25 bg-gradient-to-br from-amber-300/15 to-amber-600/5 shadow-[0_0_32px_-8px_rgba(245,197,66,0.4)]">
            <span className="bg-gradient-to-br from-amber-200 to-amber-500 bg-clip-text text-2xl font-black text-transparent">
              L
            </span>
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">
            {stats.displayName}
          </h1>
          <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-300/20 bg-amber-300/[0.07] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-300">
            <BadgeCheck className="size-3.5" /> Learnyx partner
          </p>
          {stats.welcomeMessage ? (
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-white/60">
              “{stats.welcomeMessage}”
            </p>
          ) : null}
        </header>

        {/* ── Paused notice (calm, honest) ── */}
        {paused && (
          <div className="mt-6 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <PauseCircle className="mt-0.5 size-4 shrink-0 text-amber-300/80" />
            <p className="text-xs leading-5 text-white/70">
              New referrals are currently paused. Your existing earnings and
              payout history remain fully visible below — nothing is lost.
            </p>
          </div>
        )}

        {/* ── Their link + copy ── */}
        <section className="mt-6 rounded-2xl border border-amber-300/20 bg-gradient-to-b from-amber-300/[0.08] to-transparent p-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300/80">
            your link
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-[13px] text-amber-100">
              {link}
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-b from-amber-300 to-amber-500 px-3.5 py-2.5 text-xs font-bold text-black shadow-[0_6px_20px_-8px_rgba(245,197,66,0.7)] transition active:scale-95"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </section>

        {/* ── Funnel stats ── */}
        <section className="mt-5 grid grid-cols-3 gap-2.5">
          <FunnelCard icon={<Eye className="size-4" />} label="Visits" value={money(stats.totals.visits)} />
          <FunnelCard icon={<UserPlus className="size-4" />} label="Signups" value={money(stats.totals.signups)} />
          <FunnelCard
            icon={<Users className="size-4" />}
            label="Paying"
            value={money(stats.totals.payingUsers)}
          />
        </section>
        <p className="mt-2 text-center text-[11px] text-white/45">
          {money(Math.round(stats.totals.conversion * 1000) / 10)}% of visits became paying
          students
        </p>

        {/* ── Earnings ── */}
        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-amber-300" />
            <h2 className="text-sm font-bold">Earnings</h2>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2.5">
            <MoneyTile label="Pending" value={stats.totals.pendingEtb} hint="in the hold window" />
            <MoneyTile label="Payable" value={stats.totals.payableEtb} hint="ready to be paid" accent />
            <MoneyTile label="Paid" value={stats.totals.paidEtb} hint="sent via TeleBirr" />
          </div>
          <p className="mt-3 text-[11px] leading-5 text-white/45">
            Lifetime earned {money(stats.totals.lifetimeEarnedEtb)} ETB · paid out{" "}
            {money(stats.totals.paidOutEtb)} ETB · running balance{" "}
            <span className={stats.totals.balanceEtb < 0 ? "text-rose-300" : "text-emerald-300"}>
              {money(stats.totals.balanceEtb)} ETB
            </span>
          </p>
        </section>

        {/* ── 30-day chart ── */}
        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-amber-300" />
            <h2 className="text-sm font-bold">Last 30 days</h2>
          </div>
          <div className="mt-3 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.days} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="partnerVisits" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f5c542" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#f5c542" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="partnerSignups" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#70c4ff" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#70c4ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={28}
                />
                <YAxis tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "#11141a",
                    border: "1px solid rgba(245,197,66,0.25)",
                    borderRadius: 12,
                    fontSize: 11,
                    color: "#f4f1ea",
                  }}
                />
                <Area type="monotone" dataKey="visits" stroke="#f5c542" strokeWidth={2} fill="url(#partnerVisits)" name="Visits" />
                <Area type="monotone" dataKey="signups" stroke="#70c4ff" strokeWidth={2} fill="url(#partnerSignups)" name="Signups" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* ── Per-campaign ── */}
        {stats.campaigns.length > 0 && (
          <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-bold">Campaign performance</h2>
            <div className="mt-3 space-y-2.5">
              {stats.campaigns.slice(0, 8).map((c) => {
                const max = Math.max(1, ...stats.campaigns.map((x) => x.visits));
                return (
                  <div key={c.campaign}>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="min-w-0 truncate font-medium text-white/80">{c.campaign}</span>
                      <span className="ml-2 shrink-0 font-mono text-white/50">
                        {c.visits} visits · {c.signups} signups
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500"
                        style={{ width: `${(c.visits / max) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Payout history ── */}
        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <h2 className="text-sm font-bold">Payout history</h2>
          {stats.payouts.length === 0 ? (
            <p className="mt-3 text-xs text-white/45">
              No payouts yet. Once your payable balance reaches{" "}
              {money(stats.howItWorks.minPayoutEtb)} ETB, the platform sends
              your TeleBirr payment and it appears here.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {stats.payouts.map((p, i) => (
                <li key={i} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-xs font-semibold text-emerald-300">+{money(p.amountEtb)} ETB</p>
                    <p className="text-[10px] text-white/40">
                      {fmtDate(p.paidAt)} · {p.method}
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-400/25 bg-emerald-400/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                    sent
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── How it works (honest) ── */}
        <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-amber-300" />
            <h2 className="text-sm font-bold">How it works</h2>
          </div>
          <ul className="mt-3 space-y-2 text-[11px] leading-5 text-white/55">
            <li>• Share your link. When someone signs up through it, they're yours.</li>
            <li>
              • When they actually pay, you earn a commission — tracked to the
              birr, based only on real approved payments.
            </li>
            <li>
              • Every commission waits <b className="text-white/80">{stats.howItWorks.holdHours} hours</b>{" "}
              after the payment clears (the refund window) before becoming
              payable. That protects both sides.
            </li>
            <li>
              • Once your payable balance is at least{" "}
              <b className="text-white/80">{money(stats.howItWorks.minPayoutEtb)} ETB</b>, the platform
              pays you via TeleBirr and records it here.
            </li>
            <li>• Student identities are never shown here — only totals. Privacy is absolute.</li>
          </ul>
        </section>

        <p className="mt-8 text-center text-[10px] text-white/30">
          Learnyx Academy ET 🇪🇹 — The exam room shouldn't be a surprise.
        </p>
      </div>
    </div>
  );
}

function FunnelCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center">
      <div className="mx-auto flex size-8 items-center justify-center rounded-lg bg-amber-300/10 text-amber-300">
        {icon}
      </div>
      <p className="mt-1.5 text-lg font-extrabold tabular-nums leading-none">{value}</p>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45">
        {label}
      </p>
    </div>
  );
}

function MoneyTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={
        accent
          ? "rounded-xl border border-amber-300/30 bg-amber-300/[0.08] p-2.5 text-center"
          : "rounded-xl border border-white/10 bg-black/20 p-2.5 text-center"
      }
    >
      <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/45">{label}</p>
      <p className={accent ? "mt-0.5 text-base font-extrabold tabular-nums text-amber-200" : "mt-0.5 text-base font-extrabold tabular-nums"}>
        {money(value)}
      </p>
      <p className="text-[9px] text-white/35">{hint}</p>
    </div>
  );
}
