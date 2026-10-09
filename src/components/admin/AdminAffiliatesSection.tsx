// Admin Affiliates section — full owner control of the promoter program.
//
// Sub-tabs: Overview · Promoters · Ledger · Payouts · Settings · Playbook.
// The tab stays fully usable while AFFILIATE_PROGRAM_ENABLED is OFF so the
// owner can prepare promoters before launch — only PUBLIC behavior stops.
//
// PRIVACY: this tab shows promoter + aggregate numbers. The affiliate
// ledger deliberately shows NO student identifiers (even for admins —
// the Payments tab is where student identity belongs).
//
// All backend functions live in src/convex/affiliates.ts.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowUpRight,
  BadgeCheck,
  Ban,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  FileDown,
  Gift,
  HeartPulse,
  KeyRound,
  Link2,
  Loader2,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  QrCode,
  RefreshCcw,
  ScrollText,
  Send,
  Settings2,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import QRCodeLib from "qrcode";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";
import {
  cleanPromoterCode,
  isReservedCode,
  isValidCodeShape,
  validatePromoterCode,
} from "@/lib/affiliateCodes";

/* ── Shared formatting ─────────────────────────────────────────────── */

function fmtEtb(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(
    Math.round(n * 100) / 100,
  );
}
function fmtPct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_STYLES: Record<string, string> = {
  active: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300",
  paused: "border-amber-400/25 bg-amber-400/[0.08] text-amber-300",
  archived: "border-white/10 bg-white/[0.04] text-white/50",
  pending: "border-amber-400/25 bg-amber-400/[0.08] text-amber-300",
  payable: "border-sky-400/25 bg-sky-400/[0.08] text-sky-300",
  paid: "border-emerald-400/25 bg-emerald-400/[0.08] text-emerald-300",
  void: "border-rose-400/25 bg-rose-400/[0.08] text-rose-300",
};

const SUBTABS = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "promoters", label: "Promoters", icon: Users },
  { id: "ledger", label: "Ledger", icon: ScrollText },
  { id: "payouts", label: "Payouts", icon: Wallet },
  { id: "settings", label: "Settings", icon: Settings2 },
  { id: "playbook", label: "Playbook", icon: ShieldCheck },
] as const;
type SubTab = (typeof SUBTABS)[number]["id"];

/* ════════════════════════════════════════════════════════════════════ */
/* Top-level section shell                                               */
/* ════════════════════════════════════════════════════════════════════ */

export function AdminAffiliatesSection() {
  const [sub, setSub] = useState<SubTab>("overview");

  // One subscription per tab level; data shared via props downward.
  const overview = useQuery(api.affiliates.getAffiliateOverview, {});
  const settings = useQuery(api.affiliates.getAffiliateSettings, {});

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Header + master toggle */}
      <div className="admin-hero relative overflow-hidden rounded-2xl border border-primary/15 bg-primary/[0.035] px-4 py-5 sm:px-6">
        <div className="admin-grid-bg pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // influencer program
            </p>
            <h1 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">
              Affiliates — TikTok promoter commissions
            </h1>
            <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
              Personal links, real payments, real commissions. Money never
              moves automatically — you track what's owed and pay by TeleBirr.
              Separate from the student referral program.
            </p>
          </div>
          <MasterToggle enabled={settings?.AFFILIATE_PROGRAM_ENABLED === "true"} loading={settings === undefined} />
        </div>
      </div>

      {/* Sub-tab bar */}
      <div className="glass-panel flex flex-row gap-1 overflow-x-auto rounded-2xl p-1.5" data-scroll-contain>
        {SUBTABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            className={cn(
              "interactive-press flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-medium transition-all",
              sub === id
                ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgba(112,196,255,0.18)]"
                : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {label}
          </button>
        ))}
      </div>

      {sub === "overview" && <OverviewSection overview={overview} />}
      {sub === "promoters" && <PromotersSection />}
      {sub === "ledger" && <LedgerSection />}
      {sub === "payouts" && <PayoutsSection />}
      {sub === "settings" && <SettingsSection />}
      {sub === "playbook" && <PlaybookSection />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Master toggle — the one switch for the entire program                 */
/* ════════════════════════════════════════════════════════════════════ */

function MasterToggle({ enabled, loading }: { enabled: boolean; loading: boolean }) {
  const setKey = useMutation(api.configKeys.setKey);
  const [saving, setSaving] = useState(false);

  const flip = async (next: boolean) => {
    setSaving(true);
    try {
      await setKey({ key: "AFFILIATE_PROGRAM_ENABLED", value: next ? "true" : "false" });
      toast.success(next ? "Affiliate program is LIVE." : "Affiliate program paused.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the toggle.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3",
        enabled
          ? "border-emerald-400/30 bg-emerald-400/[0.07]"
          : "border-white/10 bg-white/[0.03]",
      )}
    >
      <div>
        <p className={cn("text-sm font-bold", enabled ? "text-emerald-300" : "text-white/70")}>
          {loading ? "…" : enabled ? "PROGRAM LIVE" : "PROGRAM OFF"}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {enabled
            ? "Links resolve · visits count · commissions accrue"
            : "Public behavior paused — admin prep still works"}
        </p>
      </div>
      <Switch checked={enabled} disabled={loading || saving} onCheckedChange={flip} />
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Overview — KPIs, 30-day chart, leaderboard                            */
/* ════════════════════════════════════════════════════════════════════ */

function OverviewSection({ overview }: { overview: any }) {
  if (overview === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const o = overview;
  const chartMax = Math.max(1, ...o.days.map((d: any) => d.visits));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Kpi label="active promoters" value={String(o.activePromoters)} sub={`${o.totalPromoters} total`} icon={Users} />
        <Kpi label="total visits" value={fmtEtb(o.totalVisits)} sub="link clicks (daily aggregates)" icon={Eye} />
        <Kpi label="signups" value={fmtEtb(o.totalSignups)} sub={fmtPct(o.signupConversion) + " of visits"} icon={UserPlus} />
        <Kpi label="paying users" value={fmtEtb(o.payingUsers)} sub={fmtPct(o.payConversion) + " of signups"} icon={BadgeCheck} />
        <Kpi
          label="gross via affiliates"
          value={`${fmtEtb(o.grossRevenue)} ETB`}
          sub={`${fmtEtb(o.commissionsTotal)} ETB commissions`}
          icon={TrendingUp}
        />
      </div>

      {/* Commission pipeline + net */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="pending" value={`${fmtEtb(o.commissionsPending)} ETB`} sub="in the hold window" icon={Wallet} accent="amber" />
        <Kpi label="payable" value={`${fmtEtb(o.commissionsPayable)} ETB`} sub="ready to pay out" icon={Wallet} accent="sky" />
        <Kpi label="paid out" value={`${fmtEtb(o.commissionsPaid)} ETB`} sub={`${fmtEtb(o.totalPaidOut)} ETB recorded`} icon={Check} accent="emerald" />
        <Kpi label="voided" value={`${fmtEtb(o.commissionsVoided)} ETB`} sub="refunds / clawbacks" icon={Ban} accent="rose" />
        <Kpi
          label="net revenue"
          value={`${fmtEtb(o.netRevenue)} ETB`}
          sub="gross − non-void commissions"
          icon={ShieldCheck}
          accent="emerald"
        />
      </div>

      {/* 30-day chart */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-extrabold tracking-tight">Last 30 days</h2>
            <p className="text-xs text-muted-foreground">Visits · signups · commissions per day (ETB)</p>
          </div>
          <Legend />
        </div>
        <div className="mt-4 h-52">
          <ResponsiveBarCombo data={o.days} max={chartMax} />
        </div>
      </div>

      {/* Leaderboard */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex items-center gap-2">
          <Trophy className="size-4 text-amber-300" />
          <h2 className="text-base font-extrabold tracking-tight">Promoter leaderboard</h2>
        </div>
        {o.leaderboard.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No promoters yet — add your first TikTok creator in the Promoters tab.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>#</TableHead>
                  <TableHead>Promoter</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">Paying</TableHead>
                  <TableHead className="text-right">Earned (ETB)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {o.leaderboard.map((p: any, i: number) => (
                  <TableRow key={p.promoterId} className="hover:bg-white/5">
                    <TableCell className="font-mono text-[11px] text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-[10rem] truncate font-semibold">{p.name}</TableCell>
                    <TableCell><CodeChip code={p.code} /></TableCell>
                    <TableCell><Badge className={cn("font-mono text-[10px]", STATUS_STYLES[p.status])}>{p.status}</Badge></TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">{fmtEtb(p.visits)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">{fmtEtb(p.signups)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">{fmtEtb(p.payingUsers)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] font-bold tabular-nums">{fmtEtb(p.earnedNonVoid)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-amber-300" /> visits</span>
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-sky-400" /> signups</span>
      <span className="flex items-center gap-1.5"><span className="size-2 rounded-sm bg-emerald-400" /> commissions ETB</span>
    </div>
  );
}

/** Tiny CSS bar combo chart — no recharts dependency inside this section. */
function ResponsiveBarCombo({ data, max }: { data: any[]; max: number }) {
  return (
    <div className="flex h-full items-end gap-[3px]">
      {data.map((d) => {
        const visitH = (d.visits / max) * 82;
        const signupH = (d.signups / max) * 82;
        const commMax = Math.max(1, ...data.map((x: any) => x.commissions));
        const commH = (d.commissions / commMax) * 82;
        return (
          <div
            key={d.date}
            className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[1.5px]"
            title={`${d.label}: ${d.visits} visits · ${d.signups} signups · ${fmtEtb(d.commissions)} ETB`}
          >
            <div className="w-1/3 rounded-t-sm bg-amber-300/80" style={{ height: `${Math.max(visitH, 1.5)}%` }} />
            <div className="w-1/3 rounded-t-sm bg-sky-400/80" style={{ height: `${Math.max(signupH, 1.5)}%` }} />
            <div className="w-1/3 rounded-t-sm bg-emerald-400/80" style={{ height: `${Math.max(commH, 1.5)}%` }} />
          </div>
        );
      })}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  icon: any;
  accent?: "amber" | "sky" | "emerald" | "rose";
}) {
  const accentCls =
    accent === "amber"
      ? "text-amber-300"
      : accent === "sky"
        ? "text-sky-300"
        : accent === "emerald"
          ? "text-emerald-300"
          : accent === "rose"
            ? "text-rose-300"
            : "text-primary";
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <Icon className={cn("size-4", accentCls)} />
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-xl font-extrabold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function CodeChip({ code }: { code: string }) {
  return (
    <code className="rounded-md border border-amber-300/25 bg-amber-300/[0.08] px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-200">
      /{code}
    </code>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Promoters — table + add/edit dialogs                                  */
/* ════════════════════════════════════════════════════════════════════ */

function PromotersSection() {
  const promoters = useQuery(api.affiliates.listAffiliatePromoters, {});
  const createPromoter = useMutation(api.affiliates.createPromoter);
  const updatePromoter = useMutation(api.affiliates.updatePromoter);
  const setPromoterStatus = useMutation(api.affiliates.setPromoterStatus);
  const deletePromoter = useMutation(api.affiliates.deletePromoter);

  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<Id<"affiliatePromoters"> | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (promoters === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const doStatus = async (p: any, status: "active" | "paused" | "archived") => {
    setBusyId(p._id);
    try {
      await setPromoterStatus({ promoterId: p._id, status });
      toast.success(
        status === "active"
          ? `${p.name} resumed — link is live again.`
          : status === "paused"
            ? `${p.name} paused — no NEW attributions, existing earnings continue.`
            : `${p.name} archived — ledger preserved, link redirects silently.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status.");
    } finally {
      setBusyId(null);
    }
  };

  const doDelete = async (p: any) => {
    if (!window.confirm(`Hard-delete ${p.name} (${p.code})? Only possible when the promoter has zero visits, attributions and commissions. Otherwise use Archive.`)) return;
    setBusyId(p._id);
    try {
      await deletePromoter({ promoterId: p._id });
      toast.success(`${p.name} deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed — archive instead.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {promoters.length} promoter{promoters.length === 1 ? "" : "s"} · codes are permanent once they have traffic
        </p>
        <Button onClick={() => setAddOpen(true)} className="rounded-xl">
          <Plus className="size-4" /> Add promoter
        </Button>
      </div>

      <div className="glass-panel rounded-2xl p-5">
        {promoters.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No promoters yet. Add one — e.g. "MELODY" — and share{" "}
            <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[11px]">
              {typeof window !== "undefined" ? window.location.origin : ""}/MELODY
            </code>
            .
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Promoter</TableHead>
                  <TableHead>Code / Link</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Commission</TableHead>
                  <TableHead className="text-right">Visits</TableHead>
                  <TableHead className="text-right">Signups</TableHead>
                  <TableHead className="text-right">Payable</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {promoters.map((p: any) => (
                  <TableRow key={p._id} className="hover:bg-white/5">
                    <TableCell className="max-w-[12rem]">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{p.email}</p>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => setDetailId(p._id)}
                        className="cursor-pointer transition hover:opacity-80"
                        title="Open detail drawer"
                      >
                        <CodeChip code={p.code} />
                      </button>
                      {p.perkDiscountCode ? (
                        <span className="ml-1.5 inline-flex items-center rounded-md border border-fuchsia-300/25 bg-fuchsia-300/[0.08] px-1.5 py-0.5 font-mono text-[9px] font-bold text-fuchsia-300" title={`Follower perk: ${p.perkDiscountCode}`}>
                          <Gift className="mr-0.5 size-2.5" />{p.perkDiscountCode}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell><Badge className={cn("font-mono text-[10px]", STATUS_STYLES[p.status])}>{p.status}</Badge></TableCell>
                    <TableCell className="font-mono text-[10px]">
                      {p.commissionType === "inherit"
                        ? "inherit"
                        : p.commissionType === "percent"
                          ? `${p.commissionValue}%`
                          : `${p.commissionValue} ETB`}
                      <span className="block text-[9px] text-muted-foreground">{p.commissionScope === "inherit" ? "scope inherit" : p.commissionScope.replace("_", " ")}</span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">{fmtEtb(p.totalVisits)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">{fmtEtb(p.totalSignups)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] font-bold tabular-nums text-sky-300">{fmtEtb(p.payableEtb)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <IconBtn title="Detail" onClick={() => setDetailId(p._id)}><Eye className="size-3.5" /></IconBtn>
                        <IconBtn title="Edit" onClick={() => setEditing(p)}><Pencil className="size-3.5" /></IconBtn>
                        {p.status === "active" ? (
                          <IconBtn title="Pause (stops new attributions; earnings continue)" onClick={() => doStatus(p, "paused")} busy={busyId === p._id}><Pause className="size-3.5" /></IconBtn>
                        ) : p.status === "paused" ? (
                          <IconBtn title="Resume" onClick={() => doStatus(p, "active")} busy={busyId === p._id}><Play className="size-3.5" /></IconBtn>
                        ) : null}
                        {p.status !== "archived" && (
                          <IconBtn title="Archive (ledger preserved)" onClick={() => doStatus(p, "archived")} busy={busyId === p._id}><Ban className="size-3.5" /></IconBtn>
                        )}
                        <IconBtn title="Hard delete (only when completely untouched)" onClick={() => doDelete(p)} busy={busyId === p._id} danger><Trash2 className="size-3.5" /></IconBtn>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AddPromoterDialog open={addOpen} onOpenChange={setAddOpen} onCreate={createPromoter} />
      <EditPromoterDialog promoter={editing} onClose={() => setEditing(null)} onUpdate={updatePromoter} />
      <PromoterDetailDrawer promoterId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  busy,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-lg border border-white/10 bg-white/[0.04] p-1.5 text-muted-foreground transition hover:bg-white/10 hover:text-foreground disabled:opacity-40",
        danger && "hover:border-rose-400/30 hover:bg-rose-400/10 hover:text-rose-300",
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : children}
    </button>
  );
}

/* ── Add promoter dialog — live code preview + QR ──────────────────── */

function AddPromoterDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: any;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [useManualCode, setUseManualCode] = useState(false);
  const [commissionType, setCommissionType] = useState<"inherit" | "fixed" | "percent">("inherit");
  const [commissionValue, setCommissionValue] = useState("");
  const [commissionScope, setCommissionScope] = useState<"inherit" | "first_only" | "every_payment">("inherit");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [perkDiscountCode, setPerkDiscountCode] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Live code preview: cleaned from the name, or the manually typed code.
  const previewCode = useManualCode
    ? manualCode.trim().toUpperCase()
    : cleanPromoterCode(name);
  const previewError =
    previewCode.length === 0
      ? useManualCode
        ? "Type a code."
        : "Code generates from the name — or type one manually."
      : validatePromoterCode(previewCode);
  const previewLink =
    previewCode && !previewError && typeof window !== "undefined"
      ? `${window.location.origin}/${previewCode}`
      : null;

  const reset = () => {
    setName(""); setEmail(""); setPhone(""); setTiktok(""); setPayoutAccount("");
    setManualCode(""); setUseManualCode(false); setCommissionType("inherit");
    setCommissionValue(""); setCommissionScope("inherit"); setWelcomeMessage("");
    setPerkDiscountCode(""); setNotes("");
  };

  const submit = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    setSaving(true);
    try {
      const result = await onCreate({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        tiktokHandle: tiktok.trim() || undefined,
        payoutAccount: payoutAccount.trim() || undefined,
        code: useManualCode ? manualCode.trim().toUpperCase() : undefined,
        commissionType,
        commissionValue: commissionValue.trim() ? Number(commissionValue) : undefined,
        commissionScope,
        welcomeMessage: welcomeMessage.trim() || undefined,
        perkDiscountCode: perkDiscountCode.trim().toUpperCase() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success(`Promoter created — their link is /${result.code}`);
      // Offer the QR right away via the detail drawer; close for now.
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create promoter.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-extrabold">Add promoter</DialogTitle>
          <DialogDescription>
            The code becomes their personal link: <span className="font-mono">{typeof window !== "undefined" ? window.location.origin : ""}/CODE</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Name *">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Melody" className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="Email *">
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="melody@tiktok" className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="TikTok handle">
              <Input value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="@melody" className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="Phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+251…" className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="Payout account (TeleBirr)">
              <Input value={payoutAccount} onChange={(e) => setPayoutAccount(e.target.value)} placeholder="09…" className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="Follower perk code (optional)">
              <Input value={perkDiscountCode} onChange={(e) => setPerkDiscountCode(e.target.value)} placeholder="MELODY10" className="h-10 rounded-xl bg-white/5 font-mono uppercase" />
            </Field>
          </div>

          {/* Code preview + toggle manual */}
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-3">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-amber-300/80">their code</p>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={useManualCode}
                  onChange={(e) => setUseManualCode(e.target.checked)}
                  className="size-3 accent-amber-400"
                />
                type manually (e.g. Amharic-only name)
              </label>
            </div>
            {useManualCode ? (
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20))}
                placeholder="MELODY"
                className="mt-2 h-10 rounded-xl bg-black/30 font-mono text-base font-bold tracking-widest"
              />
            ) : (
              <p className="mt-1.5 font-mono text-2xl font-black tracking-[0.18em] text-amber-200">
                {previewCode || <span className="text-white/25">———</span>}
              </p>
            )}
            {previewError ? (
              <p className="mt-1.5 flex items-center gap-1 text-[10px] text-rose-300">
                <AlertTriangle className="size-3" /> {previewError}
              </p>
            ) : previewLink ? (
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-amber-100">
                  {previewLink}
                </code>
                <CopyBtn text={previewLink} />
              </div>
            ) : null}
            {previewCode && isReservedCode(previewCode) ? (
              <p className="mt-1 text-[10px] text-rose-300">
                Reserved — this word collides with an app route and can never be a code.
              </p>
            ) : null}
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Commission type">
              <Select value={commissionType} onValueChange={(v) => setCommissionType(v as any)}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit program default</SelectItem>
                  <SelectItem value="fixed">Fixed ETB / payment</SelectItem>
                  <SelectItem value="percent">Percent of payment</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Commission value (when overridden)">
              <Input
                type="number"
                min={0}
                value={commissionValue}
                onChange={(e) => setCommissionValue(e.target.value)}
                placeholder={commissionType === "percent" ? "10 = 10%" : "50 = 50 ETB"}
                className="h-10 rounded-xl bg-white/5"
              />
            </Field>
            <Field label="Scope">
              <Select value={commissionScope} onValueChange={(v) => setCommissionScope(v as any)}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit program default</SelectItem>
                  <SelectItem value="first_only">First payment only</SelectItem>
                  <SelectItem value="every_payment">Every payment</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Welcome message (shown on landing strip)">
              <Input value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} placeholder="Study smart for EHEEE!" maxLength={120} className="h-10 rounded-xl bg-white/5" />
            </Field>
          </div>

          <Field label="Internal notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Contacted via TikTok DM, agreed 50 ETB flat…" className="min-h-16 rounded-xl bg-white/5" />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-xl">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="rounded-xl">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create promoter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function CopyBtn({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Clipboard unavailable — copy manually.");
        }
      }}
      className="flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "copied" : label ?? "copy"}
    </button>
  );
}

/* ── Edit promoter dialog ──────────────────────────────────────────── */

function EditPromoterDialog({
  promoter,
  onClose,
  onUpdate,
}: {
  promoter: any;
  onClose: () => void;
  onUpdate: any;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [tiktok, setTiktok] = useState("");
  const [payoutAccount, setPayoutAccount] = useState("");
  const [commissionType, setCommissionType] = useState("inherit");
  const [commissionValue, setCommissionValue] = useState("");
  const [commissionScope, setCommissionScope] = useState("inherit");
  const [welcomeMessage, setWelcomeMessage] = useState("");
  const [perkDiscountCode, setPerkDiscountCode] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Load the promoter into the form when the dialog opens.
  useEffect(() => {
    if (promoter && loadedFor !== promoter._id) {
      setName(promoter.name ?? "");
      setEmail(promoter.email ?? "");
      setPhone(promoter.phone ?? "");
      setTiktok(promoter.tiktokHandle ?? "");
      setPayoutAccount(promoter.payoutAccount ?? "");
      setCommissionType(promoter.commissionType ?? "inherit");
      setCommissionValue(promoter.commissionValue != null ? String(promoter.commissionValue) : "");
      setCommissionScope(promoter.commissionScope ?? "inherit");
      setWelcomeMessage(promoter.welcomeMessage ?? "");
      setPerkDiscountCode(promoter.perkDiscountCode ?? "");
      setNotes(promoter.notes ?? "");
      setLoadedFor(promoter._id);
    }
  }, [promoter, loadedFor]);

  if (!promoter) return null;

  const submit = async () => {
    setSaving(true);
    try {
      await onUpdate({
        promoterId: promoter._id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        tiktokHandle: tiktok.trim() || undefined,
        payoutAccount: payoutAccount.trim() || undefined,
        commissionType,
        commissionValue: commissionValue.trim() ? Number(commissionValue) : undefined,
        commissionScope,
        welcomeMessage: welcomeMessage.trim() || undefined,
        perkDiscountCode: perkDiscountCode.trim().toUpperCase() || "",
        notes: notes.trim() || undefined,
      });
      toast.success("Promoter updated.");
      setLoadedFor(null);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update promoter.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(promoter)} onOpenChange={(v) => (!v ? (setLoadedFor(null), onClose()) : undefined)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto rounded-2xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg font-extrabold">Edit {promoter.name}</DialogTitle>
          <DialogDescription className="flex items-center gap-2">
            <CodeChip code={promoter.code} />
            {promoter.totalVisits > 0 || promoter.totalSignups > 0 ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-300">
                <KeyRound className="size-3" /> code locked (has traffic — use aliases)
              </span>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3.5">
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} className="h-10 rounded-xl bg-white/5" /></Field>
            <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-10 rounded-xl bg-white/5" /></Field>
            <Field label="TikTok handle"><Input value={tiktok} onChange={(e) => setTiktok(e.target.value)} className="h-10 rounded-xl bg-white/5" /></Field>
            <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} className="h-10 rounded-xl bg-white/5" /></Field>
            <Field label="Payout account (TeleBirr)"><Input value={payoutAccount} onChange={(e) => setPayoutAccount(e.target.value)} className="h-10 rounded-xl bg-white/5" /></Field>
            <Field label="Follower perk code"><Input value={perkDiscountCode} onChange={(e) => setPerkDiscountCode(e.target.value)} className="h-10 rounded-xl bg-white/5 font-mono uppercase" placeholder="empty = none" /></Field>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-3">
            <Field label="Commission type">
              <Select value={commissionType} onValueChange={setCommissionType}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit</SelectItem>
                  <SelectItem value="fixed">Fixed ETB</SelectItem>
                  <SelectItem value="percent">Percent</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Value"><Input type="number" min={0} value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} className="h-10 rounded-xl bg-white/5" /></Field>
            <Field label="Scope">
              <Select value={commissionScope} onValueChange={setCommissionScope}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit</SelectItem>
                  <SelectItem value="first_only">First only</SelectItem>
                  <SelectItem value="every_payment">Every payment</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Welcome message"><Input value={welcomeMessage} onChange={(e) => setWelcomeMessage(e.target.value)} maxLength={120} className="h-10 rounded-xl bg-white/5" /></Field>
          <Field label="Internal notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16 rounded-xl bg-white/5" /></Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { setLoadedFor(null); onClose(); }} className="rounded-xl">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="rounded-xl">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Promoter detail drawer ────────────────────────────────────────── */

function PromoterDetailDrawer({
  promoterId,
  onClose,
}: {
  promoterId: Id<"affiliatePromoters"> | null;
  onClose: () => void;
}) {
  const detail = useQuery(
    api.affiliates.getAffiliatePromoterDetail,
    promoterId ? { promoterId } : "skip",
  );
  const aliases = useQuery(
    api.affiliates.listPromoterAliases,
    promoterId ? { promoterId } : "skip",
  );
  const health = useQuery(
    api.affiliates.checkPromoterLinkHealth,
    promoterId ? { promoterId } : "skip",
  );
  const weekly = useQuery(
    api.affiliates.getPromoterWeeklySummary,
    promoterId ? { promoterId } : "skip",
  );
  const regenerateToken = useMutation(api.affiliates.regeneratePartnerToken);
  const addAlias = useMutation(api.affiliates.addPromoterAlias);
  const voidCommission = useMutation(api.affiliates.voidCommission);
  const generateUploadUrl = useMutation(api.affiliates.generatePayoutScreenshotUploadUrl);

  const [aliasCode, setAliasCode] = useState("");
  const [addingAlias, setAddingAlias] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");

  useEffect(() => {
    if (detail) {
      QRCodeLib.toDataURL(`${window.location.origin}/${detail.promoter.code}`, {
        width: 220,
        margin: 1,
        color: { dark: "#0a0c10", light: "#f5c542" },
      })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [detail?.promoter.code]);

  const partnerUrl =
    detail && typeof window !== "undefined"
      ? `${window.location.origin}/partner/${detail.promoter.secretToken}`
      : "";

  const downloadQr = () => {
    if (!qrDataUrl || !detail) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `learnyx-${detail.promoter.code}.png`;
    a.click();
  };

  if (!promoterId) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 300 }}
        className="fixed inset-y-0 right-0 z-50 w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0b0e13] p-5 shadow-2xl"
      >
        {detail === undefined ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : detail === null ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            Promoter not found.
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-extrabold tracking-tight">{detail.promoter.name}</h2>
                  <Badge className={cn("font-mono text-[10px]", STATUS_STYLES[detail.promoter.status])}>
                    {detail.promoter.status}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{detail.promoter.email}</p>
                <div className="mt-2 flex items-center gap-2">
                  <CodeChip code={detail.promoter.code} />
                  <CopyBtn text={`${window.location.origin}/${detail.promoter.code}`} label="link" />
                  {qrDataUrl ? (
                    <button
                      type="button"
                      onClick={downloadQr}
                      title="Download QR code of the link"
                      className="rounded-lg border border-white/10 bg-white/[0.06] p-1.5 text-muted-foreground transition hover:text-foreground"
                    >
                      <QrCode className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
              <button type="button" onClick={onClose} className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-muted-foreground hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            {/* QR preview */}
            {qrDataUrl && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.04] p-3">
                <img src={qrDataUrl} alt={`QR for ${detail.promoter.code}`} className="size-20 rounded-lg" />
                <div className="min-w-0 text-[11px] leading-5 text-muted-foreground">
                  <p className="font-semibold text-foreground">QR code ready</p>
                  <p>Send this image to {detail.promoter.name} — it opens their link directly.</p>
                </div>
              </div>
            )}

            {/* Link health check (P6) */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2">
                <HeartPulse className="size-4 text-rose-300" />
                <h3 className="text-sm font-bold">Link health</h3>
              </div>
              {health === undefined ? (
                <p className="mt-2 text-[11px] text-muted-foreground">Checking…</p>
              ) : (
                <p className={cn("mt-2 text-[11px] leading-5", health.healthy ? "text-emerald-300" : "text-amber-300")}>
                  {health.healthy ? "✓ " : "⚠ "}{health.reason}
                </p>
              )}
            </div>

            {/* Funnel */}
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <MiniStat label="Visits" value={fmtEtb(detail.funnel.visits)} />
              <MiniStat label="Signups" value={fmtEtb(detail.funnel.signups)} sub={fmtPct(detail.funnel.signupConversion)} />
              <MiniStat label="Paying" value={fmtEtb(detail.funnel.payingUsers)} sub={fmtPct(detail.funnel.payConversion)} />
            </div>

            {/* Balance */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold">Commission ledger balance</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MiniStat label="Pending" value={fmtEtb(detail.ledger.pendingEtb)} />
                <MiniStat label="Payable" value={fmtEtb(detail.ledger.payableEtb)} accent="sky" />
                <MiniStat label="Paid" value={fmtEtb(detail.ledger.paidEtb)} accent="emerald" />
                <MiniStat label="Voided" value={fmtEtb(detail.ledger.voidedEtb)} accent="rose" />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Earned (non-void) <b className="text-foreground">{fmtEtb(detail.ledger.earnedNonVoidEtb)} ETB</b> · paid
                out <b className="text-foreground">{fmtEtb(detail.ledger.paidOutEtb)} ETB</b> · running balance{" "}
                <b className={detail.ledger.balanceEtb < 0 ? "text-rose-300" : "text-emerald-300"}>
                  {fmtEtb(detail.ledger.balanceEtb)} ETB
                </b>
                {detail.ledger.balanceEtb < 0 ? " (clawback owed — a paid commission was voided)" : ""}
              </p>
            </div>

            {/* Daily series (simple bars) */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold">Last 30 days</h3>
              <div className="mt-3 flex h-20 items-end gap-[3px]">
                {detail.days.map((d: any) => {
                  const max = Math.max(1, ...detail.days.map((x: any) => x.visits));
                  return (
                    <div
                      key={d.date}
                      className="relative min-w-0 flex-1 rounded-t-sm bg-amber-300/70"
                      style={{ height: `${Math.max((d.visits / max) * 100, 3)}%` }}
                      title={`${d.label}: ${d.visits} visits · ${d.signups} signups`}
                    />
                  );
                })}
              </div>
            </div>

            {/* Campaigns */}
            {detail.campaigns.length > 0 && (
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <h3 className="text-sm font-bold">Per campaign</h3>
                <div className="mt-2 space-y-1.5">
                  {detail.campaigns.slice(0, 10).map((c: any) => (
                    <div key={c.campaign} className="flex items-center justify-between font-mono text-[11px]">
                      <span className="truncate text-muted-foreground">{c.campaign}</span>
                      <span className="tabular-nums">{c.visits} visits · {c.signups} signups</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Aliases */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold">Alias codes</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Extra codes that resolve to the same promoter. The main code is
                locked once it has traffic.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {(aliases ?? []).map((a: any) => <CodeChip key={a._id} code={a.aliasCode} />)}
                {(aliases ?? []).length === 0 && <span className="text-[11px] text-muted-foreground">none yet</span>}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <Input
                  value={aliasCode}
                  onChange={(e) => setAliasCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20))}
                  placeholder="NEWCODE"
                  className="h-9 w-40 rounded-xl bg-black/30 font-mono text-sm tracking-widest"
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  disabled={addingAlias || !aliasCode}
                  onClick={async () => {
                    setAddingAlias(true);
                    try {
                      await addAlias({ promoterId: promoterId, aliasCode });
                      toast.success(`Alias ${aliasCode} added.`);
                      setAliasCode("");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not add alias.");
                    } finally {
                      setAddingAlias(false);
                    }
                  }}
                >
                  {addingAlias ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add alias
                </Button>
              </div>
            </div>

            {/* Commission ledger (detail) */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold">Commissions ({detail.commissions.length})</h3>
              {detail.commissions.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">No commissions yet.</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {detail.commissions.slice(0, 30).map((c: any) => (
                    <div key={c._id} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] tabular-nums">
                          +{fmtEtb(c.commissionEtb)} ETB <span className="text-muted-foreground">on {fmtEtb(c.grossAmountEtb)} ETB</span>
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {fmtDate(c.createdAt)} · {c.source === "school_seat" ? "school seats" : "premium"} ·{" "}
                          {c.status === "pending" ? `hold until ${fmtDate(c.payableAt)}` : c.status}
                          {c.status === "void" && c.voidReason ? ` — ${c.voidReason}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge className={cn("font-mono text-[9px]", STATUS_STYLES[c.status])}>{c.status}</Badge>
                        {c.status !== "void" && (
                          <IconBtn title="Void (refund / clawback)" danger onClick={() => { setVoidTarget(c); setVoidReason(""); }}>
                            <Ban className="size-3" />
                          </IconBtn>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Payout history */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <h3 className="text-sm font-bold">Payout history ({detail.payouts.length})</h3>
              {detail.payouts.length === 0 ? (
                <p className="mt-2 text-[11px] text-muted-foreground">No payouts recorded yet.</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {detail.payouts.map((p: any) => (
                    <div key={p._id} className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-black/20 px-2.5 py-2">
                      <div>
                        <p className="font-mono text-[11px] font-bold tabular-nums text-emerald-300">−{fmtEtb(p.amountEtb)} ETB paid</p>
                        <p className="text-[9px] text-muted-foreground">{fmtDate(p.paidAt)} · {p.method} · ref {p.reference}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Partner page + token */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2">
                <Link2 className="size-4 text-amber-300" />
                <h3 className="text-sm font-bold">Private partner page</h3>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                No-login stats page for {detail.promoter.name}. Aggregate numbers only — never student data.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-[10px] text-sky-200">
                  {partnerUrl}
                </code>
                <CopyBtn text={partnerUrl} label="copy" />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={partnerUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="rounded-xl">
                    <ArrowUpRight className="size-3.5" /> Open page
                  </Button>
                </a>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={async () => {
                    if (!window.confirm("Regenerate the partner token? The old link stops working.")) return;
                    try {
                      const r = await regenerateToken({ promoterId: promoterId });
                      await navigator.clipboard.writeText(`${window.location.origin}/partner/${r.secretToken}`).catch(() => {});
                      toast.success("Token regenerated — new URL copied.");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "Could not regenerate.");
                    }
                  }}
                >
                  <RefreshCcw className="size-3.5" /> Regenerate token
                </Button>
              </div>
            </div>

            {/* Weekly DM summary (P6) */}
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2">
                <MessageCircle className="size-4 text-amber-300" />
                <h3 className="text-sm font-bold">Weekly summary for {detail.promoter.name}</h3>
              </div>
              {weekly === undefined ? (
                <p className="mt-2 text-[11px] text-muted-foreground">Computing…</p>
              ) : (
                <>
                  <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-5 text-foreground/90">{dmText(weekly)}</pre>
                  <CopyBtn text={dmText(weekly)} label="copy for Telegram/WhatsApp" />
                </>
              )}
            </div>

            {/* Void dialog */}
            <Dialog open={Boolean(voidTarget)} onOpenChange={(v) => (!v ? setVoidTarget(null) : undefined)}>
              <DialogContent className="rounded-2xl sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Void commission</DialogTitle>
                  <DialogDescription>
                    Use this when the payment was refunded or fraudulent. If it
                    was already paid out, the ledger keeps the record and the
                    promoter's balance goes negative — the clawback stays visible.
                  </DialogDescription>
                </DialogHeader>
                <Field label="Reason (required)">
                  <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Student refunded within 48h window…" className="min-h-16 rounded-xl bg-white/5" />
                </Field>
                <DialogFooter>
                  <Button variant="ghost" className="rounded-xl" onClick={() => setVoidTarget(null)}>Cancel</Button>
                  <Button
                    variant="destructive"
                    className="rounded-xl"
                    disabled={voidReason.trim().length < 3}
                    onClick={async () => {
                      try {
                        await voidCommission({ commissionId: voidTarget._id, reason: voidReason.trim() });
                        toast.success("Commission voided.");
                        setVoidTarget(null);
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Could not void.");
                      }
                    }}
                  >
                    <Ban className="size-4" /> Void commission
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* keep unused-var linters calm for conditional hooks above */}
            <span className="hidden">{String(generateUploadUrl)}</span>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function dmText(weekly: any): string {
  return [
    `Hi ${weekly.promoterName}! Your Learnyx week 📊`,
    ``,
    `• ${weekly.weekVisits} link visits`,
    `• ${weekly.weekSignups} new signups`,
    `• ${weekly.weekPaidUsers} paying students`,
    `• You earned ${fmtEtb(weekly.weekEarnedEtb)} ETB this week`,
    ``,
    `Lifetime earned: ${fmtEtb(weekly.lifetimeEarnedEtb)} ETB · payable now: ${fmtEtb(weekly.payableEtb)} ETB`,
    `Keep sharing ${weekly.code} — every real payment counts. 🚀`,
  ].join("\n");
}

function MiniStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "sky" | "emerald" | "rose";
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/20 p-2.5">
      <p className="font-mono text-[8px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-0.5 text-base font-extrabold tabular-nums",
        accent === "sky" ? "text-sky-300" : accent === "emerald" ? "text-emerald-300" : accent === "rose" ? "text-rose-300" : "",
      )}>
        {value}
      </p>
      {sub ? <p className="text-[9px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Ledger — all commissions, filters, void, CSV export                   */
/* ════════════════════════════════════════════════════════════════════ */

function LedgerSection() {
  const promoters = useQuery(api.affiliates.listAffiliatePromoters, {});
  const [promoterFilter, setPromoterFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : undefined;
  const toTs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : undefined;

  const commissions = useQuery(api.affiliates.listAffiliateCommissions, {
    promoterId: promoterFilter !== "all" ? (promoterFilter as Id<"affiliatePromoters">) : undefined,
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    fromTs,
    toTs,
  });
  const voidCommission = useMutation(api.affiliates.voidCommission);
  const [voidTarget, setVoidTarget] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");

  const exportCsv = () => {
    if (!commissions || commissions.length === 0) {
      toast.error("Nothing to export.");
      return;
    }
    const header = ["date", "promoter", "code", "source", "gross_etb", "commission_etb", "status", "payable_at", "paid_at", "void_reason"];
    const rows = commissions.map((c: any) => [
      new Date(c.createdAt).toISOString(),
      `"${c.promoterName}"`,
      c.promoterCode,
      c.source,
      c.grossAmountEtb,
      c.commissionEtb,
      c.status,
      c.payableAt ? new Date(c.payableAt).toISOString() : "",
      c.paidAt ? new Date(c.paidAt).toISOString() : "",
      `"${(c.voidReason ?? "").replace(/"/g, "'")}"`,
    ]);
    const csv = [header.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `learnyx-affiliate-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="glass-panel rounded-2xl p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Promoter">
            <Select value={promoterFilter} onValueChange={setPromoterFilter}>
              <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All promoters</SelectItem>
                {(promoters ?? []).map((p: any) => (
                  <SelectItem key={p._id} value={p._id}>{p.name} (/{p.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending (hold)</SelectItem>
                <SelectItem value="payable">Payable</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="void">Void</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 rounded-xl bg-white/5" />
          </Field>
          <Field label="To">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 rounded-xl bg-white/5" />
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <p className="font-mono text-[10px] text-muted-foreground">
            {commissions === undefined ? "loading…" : `${commissions.length} commission${commissions.length === 1 ? "" : "s"}`}
          </p>
          <Button size="sm" variant="outline" className="rounded-xl" onClick={exportCsv}>
            <FileDown className="size-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <div className="glass-panel rounded-2xl p-5">
        {commissions === undefined ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : commissions.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No commissions match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Created</TableHead>
                  <TableHead>Promoter</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Gross</TableHead>
                  <TableHead className="text-right">Commission</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.map((c: any) => (
                  <TableRow key={c._id} className="hover:bg-white/5">
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{fmtDate(c.createdAt)}</TableCell>
                    <TableCell><CodeChip code={c.promoterCode} /></TableCell>
                    <TableCell className="font-mono text-[10px]">{c.source === "school_seat" ? "school seats" : "premium"}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] tabular-nums">{fmtEtb(c.grossAmountEtb)}</TableCell>
                    <TableCell className="text-right font-mono text-[11px] font-bold tabular-nums">+{fmtEtb(c.commissionEtb)}</TableCell>
                    <TableCell><Badge className={cn("font-mono text-[10px]", STATUS_STYLES[c.status])}>{c.status}</Badge></TableCell>
                    <TableCell className="max-w-[14rem] truncate text-[10px] text-muted-foreground">
                      {c.status === "pending" ? `hold ends ${fmtDate(c.payableAt)}` : c.voidReason ?? ""}
                    </TableCell>
                    <TableCell>
                      {c.status !== "void" && (
                        <IconBtn title="Void" danger onClick={() => { setVoidTarget(c); setVoidReason(""); }}>
                          <Ban className="size-3.5" />
                        </IconBtn>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={Boolean(voidTarget)} onOpenChange={(v) => (!v ? setVoidTarget(null) : undefined)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void commission</DialogTitle>
            <DialogDescription>
              Refund / clawback. Already-paid commissions stay on the ledger and
              the promoter's balance goes negative — visible, never deleted.
            </DialogDescription>
          </DialogHeader>
          <Field label="Reason (required)">
            <Textarea value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="min-h-16 rounded-xl bg-white/5" placeholder="Payment refunded…" />
          </Field>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              className="rounded-xl"
              disabled={voidReason.trim().length < 3}
              onClick={async () => {
                try {
                  await voidCommission({ commissionId: voidTarget._id, reason: voidReason.trim() });
                  toast.success("Commission voided.");
                  setVoidTarget(null);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Could not void.");
                }
              }}
            >
              <Ban className="size-4" /> Void commission
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Payouts — record manual TeleBirr payouts + history                    */
/* ════════════════════════════════════════════════════════════════════ */

function PayoutsSection() {
  const promoters = useQuery(api.affiliates.listAffiliatePromoters, {});
  const payouts = useQuery(api.affiliates.listAffiliatePayouts, {});
  const recordPayout = useMutation(api.affiliates.recordAffiliatePayout);
  const generateUploadUrl = useMutation(api.affiliates.generatePayoutScreenshotUploadUrl);

  const [open, setOpen] = useState(false);
  const [promoterId, setPromoterId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [overrideMin, setOverrideMin] = useState(false);
  const [saving, setSaving] = useState(false);
  // Optional screenshot of the TeleBirr transfer confirmation.
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [uploadingShot, setUploadingShot] = useState(false);

  const uploadScreenshot = async (): Promise<string | undefined> => {
    if (!screenshotFile) return undefined;
    setUploadingShot(true);
    try {
      const url = await generateUploadUrl({});
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": screenshotFile.type || "application/octet-stream" },
        body: screenshotFile,
      });
      const data = (await res.json()) as { storageId?: string };
      return data.storageId;
    } finally {
      setUploadingShot(false);
    }
  };

  const selected = (promoters ?? []).find((p: any) => p._id === promoterId);
  const payableBalance = selected?.payableEtb ?? 0;
  const suggestedAmount = payableBalance > 0 ? String(Math.round(payableBalance * 100) / 100) : "";

  const submit = async () => {
    if (!promoterId) {
      toast.error("Pick a promoter.");
      return;
    }
    setSaving(true);
    try {
      const screenshotStorageId = await uploadScreenshot();
      const result = await recordPayout({
        promoterId: promoterId as Id<"affiliatePromoters">,
        amountEtb: Number(amount),
        reference: reference.trim(),
        note: note.trim() || undefined,
        screenshotStorageId,
        overrideMinPayout: overrideMin || undefined,
      });
      toast.success(`Payout recorded — ${result.coveredCommissions} commission(s) marked paid.`);
      setOpen(false);
      setPromoterId(""); setAmount(""); setReference(""); setNote(""); setOverrideMin(false); setScreenshotFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record payout.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Money moves manually — you send the TeleBirr transfer, then record it here so the ledger stays true.
        </p>
        <Button onClick={() => setOpen(true)} className="rounded-xl">
          <Send className="size-4" /> Record payout
        </Button>
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <h2 className="text-base font-extrabold tracking-tight">Recorded payouts</h2>
        {payouts === undefined ? (
          <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : payouts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No payouts recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Paid at</TableHead>
                  <TableHead>Promoter</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p: any) => (
                  <TableRow key={p._id} className="hover:bg-white/5">
                    <TableCell className="font-mono text-[10px] text-muted-foreground">{fmtDate(p.paidAt)}</TableCell>
                    <TableCell><CodeChip code={p.promoterCode} /> <span className="ml-1.5 text-xs">{p.promoterName}</span></TableCell>
                    <TableCell className="text-right font-mono text-[11px] font-bold tabular-nums text-emerald-300">−{fmtEtb(p.amountEtb)}</TableCell>
                    <TableCell className="font-mono text-[10px]">{p.method}</TableCell>
                    <TableCell className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">{p.reference}</TableCell>
                    <TableCell className="max-w-[10rem] truncate text-[10px] text-muted-foreground">{p.note ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record payout</DialogTitle>
            <DialogDescription>
              Mark the TeleBirr transfer you already sent. Payable commissions
              are covered oldest-first.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5">
            <Field label="Promoter">
              <Select value={promoterId} onValueChange={(v) => { setPromoterId(v); const p = (promoters ?? []).find((x: any) => x._id === v); setAmount(p?.payableEtb ? String(Math.round(p.payableEtb * 100) / 100) : ""); }}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue placeholder="Pick a promoter" /></SelectTrigger>
                <SelectContent>
                  {(promoters ?? []).map((p: any) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name} — {fmtEtb(p.payableEtb)} ETB payable
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {selected && (
              <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.06] p-3 text-[11px]">
                <p>Payable balance: <b className="text-sky-300">{fmtEtb(payableBalance)} ETB</b> (default = full balance)</p>
                {selected.payoutAccount ? (
                  <p className="mt-1 text-muted-foreground">TeleBirr: <span className="font-mono">{selected.payoutAccount}</span></p>
                ) : (
                  <p className="mt-1 text-amber-300">No payout account saved — confirm the number with the promoter.</p>
                )}
              </div>
            )}
            <Field label="Amount (ETB)">
              <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={suggestedAmount || "0"} className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="TeleBirr reference *">
              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. DHA1O2T6RN" className="h-10 rounded-xl bg-white/5 font-mono" />
            </Field>
            <Field label="Note (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-10 rounded-xl bg-white/5" />
            </Field>
            <Field label="Screenshot (optional)">
              <input
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setScreenshotFile(e.target.files?.[0] ?? null)}
                className="w-full cursor-pointer rounded-xl border border-white/10 bg-white/5 p-2 text-[11px] text-muted-foreground file:mr-2 file:cursor-pointer file:rounded-lg file:border-0 file:bg-white/10 file:px-2.5 file:py-1.5 file:text-[10px] file:font-bold file:text-foreground"
              />
              {screenshotFile ? (
                <p className="mt-1 truncate text-[10px] text-emerald-300">✓ {screenshotFile.name}</p>
              ) : null}
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={overrideMin} onChange={(e) => setOverrideMin(e.target.checked)} className="size-3.5 accent-amber-400" />
              Pay below the minimum payout threshold anyway (explicit override)
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-xl" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || uploadingShot} className="rounded-xl">
              {saving || uploadingShot ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Record payout
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Settings — all AFFILIATE_* keys in one form                           */
/* ════════════════════════════════════════════════════════════════════ */

function SettingsSection() {
  const settings = useQuery(api.affiliates.getAffiliateSettings, {});
  const setKey = useMutation(api.configKeys.setKey);
  const [commissionType, setCommissionType] = useState("fixed");
  const [commissionValue, setCommissionValue] = useState("50");
  const [scope, setScope] = useState("first_only");
  const [holdHours, setHoldHours] = useState("72");
  const [attributionDays, setAttributionDays] = useState("30");
  const [minPayout, setMinPayout] = useState("200");
  const [includeSeats, setIncludeSeats] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (settings && !loaded) {
      setCommissionType(settings.AFFILIATE_DEFAULT_COMMISSION_TYPE === "percent" ? "percent" : "fixed");
      setCommissionValue(settings.AFFILIATE_DEFAULT_COMMISSION_VALUE ?? "50");
      setScope(settings.AFFILIATE_DEFAULT_SCOPE === "every_payment" ? "every_payment" : "first_only");
      setHoldHours(settings.AFFILIATE_HOLD_HOURS ?? "72");
      setAttributionDays(settings.AFFILIATE_ATTRIBUTION_DAYS ?? "30");
      setMinPayout(settings.AFFILIATE_MIN_PAYOUT_ETB ?? "200");
      setIncludeSeats(settings.AFFILIATE_INCLUDE_SCHOOL_SEATS === "true");
      setLoaded(true);
    }
  }, [settings, loaded]);

  if (!settings) {
    return (
      <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await setKey({ key: "AFFILIATE_DEFAULT_COMMISSION_TYPE", value: commissionType });
      await setKey({ key: "AFFILIATE_DEFAULT_COMMISSION_VALUE", value: String(Math.max(0, Number(commissionValue) || 0)) });
      await setKey({ key: "AFFILIATE_DEFAULT_SCOPE", value: scope });
      await setKey({ key: "AFFILIATE_HOLD_HOURS", value: String(Math.max(48, Math.round(Number(holdHours) || 72))) });
      await setKey({ key: "AFFILIATE_ATTRIBUTION_DAYS", value: String(Math.max(1, Math.round(Number(attributionDays) || 30))) });
      await setKey({ key: "AFFILIATE_MIN_PAYOUT_ETB", value: String(Math.max(0, Math.round(Number(minPayout) || 0))) });
      await setKey({ key: "AFFILIATE_INCLUDE_SCHOOL_SEATS", value: includeSeats ? "true" : "false" });
      toast.success("Affiliate defaults saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-5">
      <h2 className="text-base font-extrabold tracking-tight">Program defaults</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Promoters can override commission type/value/scope individually. Hold
        window must exceed the 48h refund window (enforced — minimum 48).
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Default commission type">
          <Select value={commissionType} onValueChange={setCommissionType}>
            <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed — flat ETB per payment</SelectItem>
              <SelectItem value="percent">Percent — share of what was paid</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Default commission value">
          <Input type="number" min={0} value={commissionValue} onChange={(e) => setCommissionValue(e.target.value)} className="h-10 rounded-xl bg-white/5" />
          <p className="mt-1 text-[10px] text-muted-foreground">
            {commissionType === "percent" ? "Percent of the amount actually paid (post-discount)." : "Flat ETB per approved payment."}
          </p>
        </Field>
        <Field label="Default scope">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="h-10 rounded-xl bg-white/5"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="first_only">First payment only</SelectItem>
              <SelectItem value="every_payment">Every payment</SelectItem>
            </SelectContent>
          </Select>
          <p className="mt-1 text-[10px] text-muted-foreground">"First only" pays once per attributed student, ever.</p>
        </Field>
        <Field label="Hold window (hours)">
          <Input type="number" min={48} value={holdHours} onChange={(e) => setHoldHours(e.target.value)} className="h-10 rounded-xl bg-white/5" />
          <p className="mt-1 text-[10px] text-muted-foreground">Commissions sit "pending" this long (refund protection) before flipping to payable. Min 48.</p>
        </Field>
        <Field label="Attribution window (days)">
          <Input type="number" min={1} value={attributionDays} onChange={(e) => setAttributionDays(e.target.value)} className="h-10 rounded-xl bg-white/5" />
          <p className="mt-1 text-[10px] text-muted-foreground">How long after clicking a link a brand-new signup still counts.</p>
        </Field>
        <Field label="Minimum payout (ETB)">
          <Input type="number" min={0} value={minPayout} onChange={(e) => setMinPayout(e.target.value)} className="h-10 rounded-xl bg-white/5" />
          <p className="mt-1 text-[10px] text-muted-foreground">You get a Telegram ping when a promoter's payable crosses this.</p>
        </Field>
        <div className="sm:col-span-2 rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-xs font-bold">Include school-seat purchases</span>
              <span className="mt-0.5 block text-[10px] text-muted-foreground">
                OFF by default: commissions come from student premium payments only. Turn on to also pay commissions on approved school bulk purchases.
              </span>
            </span>
            <Switch checked={includeSeats} onCheckedChange={setIncludeSeats} />
          </label>
        </div>
      </div>
      <Button onClick={save} disabled={saving} className="mt-4 rounded-xl">
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save defaults
      </Button>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════ */
/* Playbook — promoter guidelines (copyable)                             */
/* ════════════════════════════════════════════════════════════════════ */

function PlaybookSection() {
  const siteOrigin = typeof window !== "undefined" ? window.location.origin : "https://learnyx-academy-et.vercel.app";
  const guidelines = [
    `LEARNYX ACADEMY ET — PROMOTER GUIDELINES`,
    ``,
    `Welcome aboard! Your personal link looks like:`,
    `  ${siteOrigin}/YOURCODE`,
    `Every person who signs up through it is tracked to you — and every REAL approved payment earns you a commission. Here's how to keep it clean and keep getting paid:`,
    ``,
    `1. ALWAYS DISCLOSE. Every post/story/bio mention must carry "Affiliate link" (or #ad). Ethiopian consumer law and TikTok's branded-content policy both require it, and so do we.`,
    ``,
    `2. NEVER PROMISE RESULTS. Don't claim guaranteed scores, "pass EHEEE for sure", or anything that treats exam outcomes as a promise. Learnyx gives practice, evidence and feedback — not guarantees.`,
    ``,
    `3. NEVER PRESSURE MINORS. Your audience includes students under 18. No fear-marketing ("you'll fail without this"), no fake scarcity, no misleading claims about price or what's free.`,
    ``,
    `4. NO SPAM. No mass-DMs, no comment flooding, no fake accounts. Quality > volume. Accounts that spam get paused and their commissions frozen.`,
    ``,
    `5. HOW YOU GET PAID:`,
    `   • Commission accrues only when a payment is actually approved (never on signups, trials, or free stuff).`,
    `   • Every commission waits ${"72"} hours (the refund window) before becoming payable.`,
    `   • When your payable balance reaches the minimum, the platform pays your TeleBirr and you can watch it on your private stats page.`,
    ``,
    `6. YOUR STATS PAGE: a private link shows your visits, signups and earnings — totals only. Student identities are NEVER shown, to anyone. Share it only with yourself.`,
    ``,
    `7. PAUSED ≠ FORGOTTEN: if your status is "paused", your link keeps working but new signups aren't tracked, and existing earnings still pay out. Ask the team to resume you.`,
    ``,
    `Questions? Contact the Learnyx team. Thank you for growing Ethiopian exam prep. 🇪🇹`,
  ].join("\n");

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold tracking-tight">Promoter guidelines</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy-paste this into your creator's DMs when you onboard them.
          </p>
        </div>
        <CopyBtn text={guidelines} label="copy guidelines" />
      </div>
      <pre className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 p-4 font-mono text-[11px] leading-5 text-foreground/85">{guidelines}</pre>
    </div>
  );
}
