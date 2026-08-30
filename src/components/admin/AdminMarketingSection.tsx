// Admin Marketing section — referral program + discount codes + landing
// announcements. Visible to admins. Four sub-tabs at the top:
//   1. Overview   — referral stats, top referrers leaderboard, config toggles
//   2. Discounts  — create / list / pause / delete discount codes
//   3. Announcements — create / list / pause / delete landing announcements
//   4. Referral   — program toggle + reward-days config
//
// All backend functions live in src/convex/marketing.ts. The config keys
// (REFERRAL_PROGRAM_ENABLED, REFERRER_REWARD_DAYS, REFEREE_REWARD_DAYS,
// PREMIUM_PRICE_ETB) are stored in the configKeys table — we read them via
// getMarketingConfig and write via the existing configKeys.setKey mutation.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Copy,
  Gift,
  Loader2,
  Megaphone,
  Plus,
  Power,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
  Trophy,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

/* ──────────────────────────────────────────────────────────────────── */
/* Top-level section                                                      */
/* ──────────────────────────────────────────────────────────────────── */

const SUB_TABS = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "discounts", label: "Discount codes", icon: Tag },
  { id: "announcements", label: "Announcements", icon: Megaphone },
  { id: "referral", label: "Referral program", icon: Gift },
] as const;

type SubTabId = (typeof SUB_TABS)[number]["id"];

export function AdminMarketingSection() {
  const [subTab, setSubTab] = useState<SubTabId>("overview");
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          // marketing · referral · discounts · announcements
        </p>
        <h2 className="mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">
          Marketing
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the referral program, create discount codes, and announce
          new features, events, or affiliate highlights to students on the
          landing page — all in one place.
        </p>
      </div>

      {/* Sub-tab nav */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-1.5">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors",
                subTab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Sub-tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={subTab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {subTab === "overview" && <OverviewPanel />}
          {subTab === "discounts" && <DiscountsPanel />}
          {subTab === "announcements" && <AnnouncementsPanel />}
          {subTab === "referral" && <ReferralPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Overview panel — referral stats + leaderboard + quick config       */
/* ──────────────────────────────────────────────────────────────────── */

function OverviewPanel() {
  const stats = useQuery(api.marketing.getAdminReferralStats, {});
  const config = useQuery(api.marketing.getMarketingConfig, {});

  if (stats === undefined || config === undefined) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          icon={Users}
          label="Signups"
          value={stats.totalSignups}
          color="text-sky-300"
        />
        <StatCard
          icon={CheckCircle2}
          label="Conversions"
          value={stats.totalConversions}
          color="text-emerald-300"
        />
        <StatCard
          icon={Gift}
          label="Rewarded"
          value={stats.totalRewarded}
          color="text-amber-300"
        />
        <StatCard
          icon={TrendingUp}
          label="Conversion rate"
          value={`${stats.conversionRate}%`}
          color="text-primary"
        />
      </div>

      {/* Quick config snapshot */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // current configuration
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ConfigPill label="Referral program" value={config.referralEnabled ? "Enabled" : "Disabled"} positive={config.referralEnabled} />
          <ConfigPill label="Referrer reward" value={`${config.referrerRewardDays} days`} />
          <ConfigPill label="Referee reward" value={`${config.refereeRewardDays} days`} />
          <ConfigPill label="Premium price" value={`${config.premiumPriceEtb} ETB`} />
        </div>
      </div>

      {/* Top referrers leaderboard */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            // top referrers leaderboard
          </p>
          <Trophy className="size-4 text-amber-300" />
        </div>
        {stats.topReferrers.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No conversions yet. Share the program with students to start
            populating this leaderboard.
          </p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {stats.topReferrers.map((r, i) => (
              <div
                key={`${r.referrerName}-${i}`}
                className="flex items-center justify-between rounded-xl bg-white/[0.03] px-3.5 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-xs font-bold",
                      i === 0 && "bg-amber-400/20 text-amber-300",
                      i === 1 && "bg-slate-300/10 text-slate-300",
                      i === 2 && "bg-orange-400/15 text-orange-300",
                      i > 2 && "bg-white/5 text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <p className="text-sm font-semibold">{r.referrerName}</p>
                </div>
                <Badge className="bg-emerald-400/10 text-emerald-300">
                  {r.converted} {r.converted === 1 ? "referral" : "referrals"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Users;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <Icon className={cn("size-4", color)} />
      <p className="mt-2 font-mono text-2xl font-extrabold tabular-nums">{value}</p>
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function ConfigPill({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-sm font-bold",
          positive === true && "text-emerald-300",
          positive === false && "text-rose-300",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Referral panel — toggle + reward days config                        */
/* ──────────────────────────────────────────────────────────────────── */

function ReferralPanel() {
  const config = useQuery(api.marketing.getMarketingConfig, {});
  const setKey = useMutation(api.configKeys.setKey);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [referrerDays, setReferrerDays] = useState("");
  const [refereeDays, setRefereeDays] = useState("");
  const [saving, setSaving] = useState(false);

  // Load config into the form when it arrives
  useEffect(() => {
    if (config && enabled === null) {
      setEnabled(config.referralEnabled);
      setReferrerDays(String(config.referrerRewardDays));
      setRefereeDays(String(config.refereeRewardDays));
    }
  }, [config, enabled]);

  if (config === undefined || enabled === null) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      await setKey({
        key: "REFERRAL_PROGRAM_ENABLED",
        value: enabled ? "true" : "false",
      });
      const r = Number(referrerDays);
      if (Number.isFinite(r) && r > 0) {
        await setKey({ key: "REFERRER_REWARD_DAYS", value: String(Math.round(r)) });
      }
      const ref = Number(refereeDays);
      if (Number.isFinite(ref) && ref >= 0) {
        await setKey({ key: "REFEREE_REWARD_DAYS", value: String(Math.round(ref)) });
      }
      toast.success("Referral program settings saved.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save settings.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Toggle card */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-sm font-bold">
              <Gift className="size-4 text-amber-300" /> Referral program
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, every student gets a unique referral link in their
              Settings page. When a referral's first premium payment is
              confirmed, both students get bonus premium days.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(v) => setEnabled(v)}
            disabled={saving}
          />
        </div>
      </div>

      {/* Reward config */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // reward configuration
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              Referrer reward (days)
            </Label>
            <Input
              type="number"
              min={1}
              value={referrerDays}
              onChange={(e) => setReferrerDays(e.target.value)}
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={saving}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Premium days granted to the referrer when their friend upgrades.
            </p>
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              Referee reward (days)
            </Label>
            <Input
              type="number"
              min={0}
              value={refereeDays}
              onChange={(e) => setRefereeDays(e.target.value)}
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={saving}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Bonus days granted to the referred friend on top of their
              purchase. Set 0 to disable the referee bonus.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="gap-2"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            Save settings
          </Button>
        </div>
      </div>

      {/* How it works */}
      <div className="rounded-2xl border border-sky-400/15 bg-sky-400/[0.04] p-5">
        <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-sky-300">
          <Sparkles className="size-3.5" /> how it works
        </p>
        <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
          <li>
            <span className="font-mono text-sky-300">1.</span> A student shares
            their unique link (e.g. <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-[10px]">?ref=joseph7xk</code>) with a friend.
          </li>
          <li>
            <span className="font-mono text-sky-300">2.</span> When the friend
            signs up via that link, the referral is recorded (self-referrals
            are blocked automatically).
          </li>
          <li>
            <span className="font-mono text-sky-300">3.</span> When the friend's
            first premium payment is confirmed (manual admin review or
            automated SMS verification), the reward is granted — both
            students get bonus premium days.
          </li>
          <li>
            <span className="font-mono text-sky-300">4.</span> Referral
            achievements fire automatically via the existing achievements
            system. The leaderboard above updates in real time.
          </li>
        </ol>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Discount codes panel                                                */
/* ──────────────────────────────────────────────────────────────────── */

function DiscountsPanel() {
  const codes = useQuery(api.marketing.listDiscountCodes, {});
  const createCode = useMutation(api.marketing.createDiscountCode);
  const toggleCode = useMutation(api.marketing.toggleDiscountCode);
  const deleteCode = useMutation(api.marketing.deleteDiscountCode);

  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed_etb">("percent");
  const [value, setValue] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const clean = code.trim().toUpperCase();
    if (clean.length < 3) {
      toast.error("Code must be at least 3 characters.");
      return;
    }
    const val = Number(value);
    if (!Number.isFinite(val) || val <= 0) {
      toast.error("Value must be a positive number.");
      return;
    }
    if (discountType === "percent" && val > 100) {
      toast.error("Percent discount cannot exceed 100%.");
      return;
    }
    const max = maxUses.trim() ? Number(maxUses) : undefined;
    const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
    const expiresAt =
      days !== undefined && Number.isFinite(days) && days > 0
        ? Date.now() + days * 24 * 60 * 60 * 1000
        : undefined;

    setCreating(true);
    try {
      await createCode({
        code: clean,
        discountType,
        value: val,
        maxUses: max,
        expiresAt,
      });
      toast.success(`Discount code ${clean} created.`);
      setCode("");
      setValue("");
      setMaxUses("");
      setExpiresInDays("");
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not create the discount code.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Create form */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // create new discount code
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">Code</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="STUDY2026"
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm tracking-wider"
              autoCapitalize="characters"
              disabled={creating}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">Type</Label>
            <Select
              value={discountType}
              onValueChange={(v) => setDiscountType(v as "percent" | "fixed_etb")}
              disabled={creating}
            >
              <SelectTrigger className="mt-1.5 h-10 rounded-xl bg-white/5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percent (%)</SelectItem>
                <SelectItem value="fixed_etb">Fixed ETB</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              Value ({discountType === "percent" ? "%" : "ETB"})
            </Label>
            <Input
              type="number"
              min={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={discountType === "percent" ? "20" : "100"}
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={creating}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              Max uses (optional)
            </Label>
            <Input
              type="number"
              min={1}
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="Unlimited"
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={creating}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">
              Expires in (days)
            </Label>
            <Input
              type="number"
              min={1}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              placeholder="Never"
              className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
              disabled={creating}
            />
          </div>
          <div className="flex items-end">
            <Button
              className="h-10 w-full gap-2"
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Create code
            </Button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // existing codes
        </p>
        {codes === undefined ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : codes.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No discount codes yet. Create one above to give students a discount
            on their premium upgrade.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Discount</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.map((c) => {
                  const expired = c.expiresAt !== undefined && c.expiresAt < Date.now();
                  const exhausted =
                    c.maxUses !== undefined && c.usedCount >= c.maxUses;
                  return (
                    <TableRow key={c._id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <code className="rounded bg-white/5 px-2 py-1 font-mono text-xs font-bold tracking-wider">
                            {c.code}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(c.code);
                              toast.success("Code copied.");
                            }}
                            className="text-muted-foreground hover:text-foreground"
                            title="Copy code"
                          >
                            <Copy className="size-3" />
                          </button>
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.discountType === "percent"
                          ? `${c.value}% off`
                          : `${c.value} ETB off`}
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">
                          {c.usedCount}
                          {c.maxUses !== undefined && ` / ${c.maxUses}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        {c.expiresAt ? (
                          <span
                            className={cn(
                              "font-mono text-xs",
                              expired && "text-rose-300",
                            )}
                          >
                            {expired ? "Expired " : ""}
                            {relativeTime(c.expiresAt)}
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-muted-foreground">never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {expired || exhausted ? (
                          <Badge className="bg-rose-400/10 text-rose-300">
                            {expired ? "Expired" : "Used up"}
                          </Badge>
                        ) : c.isActive ? (
                          <Badge className="bg-emerald-400/10 text-emerald-300">Active</Badge>
                        ) : (
                          <Badge className="bg-amber-400/10 text-amber-300">Paused</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await toggleCode({ codeId: c._id as Id<"discountCodes">, isActive: !c.isActive });
                                toast.success(c.isActive ? "Code paused." : "Code activated.");
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Failed.");
                              }
                            }}
                            className={cn(
                              "rounded-lg p-2 transition-colors",
                              c.isActive
                                ? "text-amber-300 hover:bg-amber-400/10"
                                : "text-emerald-300 hover:bg-emerald-400/10",
                            )}
                            title={c.isActive ? "Pause code" : "Activate code"}
                          >
                            <Power className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`Delete discount code ${c.code}? This cannot be undone.`)) return;
                              try {
                                await deleteCode({ codeId: c._id as Id<"discountCodes"> });
                                toast.success("Code deleted.");
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "Failed.");
                              }
                            }}
                            className="rounded-lg p-2 text-rose-300 transition-colors hover:bg-rose-400/10"
                            title="Delete code"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */
/* Announcements panel                                                  */
/* ──────────────────────────────────────────────────────────────────── */

const ANNOUNCEMENT_TYPES = [
  { id: "info", label: "Info", icon: "💡", color: "text-sky-300 border-sky-400/30 bg-sky-400/[0.06]" },
  { id: "feature", label: "New feature", icon: "✨", color: "text-amber-300 border-amber-400/30 bg-amber-400/[0.06]" },
  { id: "event", label: "Event", icon: "🎉", color: "text-emerald-300 border-emerald-400/30 bg-emerald-400/[0.06]" },
  { id: "referral", label: "Affiliate", icon: "🤝", color: "text-primary border-primary/30 bg-primary/[0.06]" },
] as const;

function AnnouncementsPanel() {
  const announcements = useQuery(api.marketing.listAnnouncements, {});
  const createAnnouncement = useMutation(api.marketing.createAnnouncement);
  const toggleAnnouncement = useMutation(api.marketing.toggleAnnouncement);
  const deleteAnnouncement = useMutation(api.marketing.deleteAnnouncement);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<"info" | "feature" | "event" | "referral">("feature");
  const [expiresInDays, setExpiresInDays] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (title.trim().length < 3) {
      toast.error("Title must be at least 3 characters.");
      return;
    }
    if (body.trim().length < 5) {
      toast.error("Body must be at least 5 characters.");
      return;
    }
    const days = expiresInDays.trim() ? Number(expiresInDays) : undefined;
    const expiresAt =
      days !== undefined && Number.isFinite(days) && days > 0
        ? Date.now() + days * 24 * 60 * 60 * 1000
        : undefined;

    setCreating(true);
    try {
      await createAnnouncement({
        title: title.trim(),
        body: body.trim(),
        type,
        expiresAt,
      });
      toast.success("Announcement published to the landing page.");
      setTitle("");
      setBody("");
      setExpiresInDays("");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not publish announcement.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Create form */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // create new announcement
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Announcements appear at the top of the landing page (the public
          site). Use them to announce new features, special events, affiliate
          program highlights, or anything else your students should see first.
        </p>

        {/* Type picker */}
        <div className="mt-4">
          <Label className="text-xs font-semibold text-muted-foreground">Type</Label>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ANNOUNCEMENT_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border p-3 text-xs font-semibold transition-all",
                  type === t.id
                    ? `${t.color} ring-1 ring-current/40`
                    : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:bg-white/5",
                )}
              >
                <span className="text-base">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. New AI Mock Exam is live!"
              className="mt-1.5 h-10 rounded-xl bg-white/5"
              disabled={creating}
            />
          </div>
          <div>
            <Label className="text-xs font-semibold text-muted-foreground">Body</Label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="One or two sentences. Keep it tight — students scan the banner."
              className="mt-1.5 min-h-[80px] rounded-xl bg-white/5"
              disabled={creating}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-semibold text-muted-foreground">
                Expires in (days) — optional
              </Label>
              <Input
                type="number"
                min={1}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="Never"
                className="mt-1.5 h-10 rounded-xl bg-white/5 font-mono text-sm"
                disabled={creating}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="h-10 w-full gap-2"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Megaphone className="size-4" />
                )}
                Publish announcement
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Live preview */}
      {title.trim() && (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            // live preview
          </p>
          <div
            className={cn(
              "mt-3 flex items-center gap-3 rounded-2xl border p-3.5 text-sm",
              ANNOUNCEMENT_TYPES.find((t) => t.id === type)?.color ?? "",
            )}
          >
            <span className="text-lg">
              {ANNOUNCEMENT_TYPES.find((t) => t.id === type)?.icon ?? "💡"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.18em] opacity-70">
                  {ANNOUNCEMENT_TYPES.find((t) => t.id === type)?.label ?? "Info"}
                </span>
                <span className="opacity-30">·</span>
                <p className="font-semibold text-foreground">{title || "Your title"}</p>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {body || "Your body text will appear here."}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          // existing announcements
        </p>
        {announcements === undefined ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : announcements.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No announcements yet. Create one above to broadcast news to
            students on the landing page.
          </p>
        ) : (
          <div className="mt-3 space-y-2">
            {announcements.map((a) => {
              const meta = ANNOUNCEMENT_TYPES.find((t) => t.id === a.type);
              const expired = a.expiresAt !== undefined && a.expiresAt < Date.now();
              return (
                <div
                  key={a._id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <span className="text-lg">{meta?.icon ?? "💡"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-foreground">{a.title}</p>
                        <Badge
                          variant="outline"
                          className={cn(
                            "font-mono text-[9px] uppercase tracking-[0.15em]",
                            a.isActive && !expired
                              ? "border-emerald-400/30 text-emerald-300"
                              : "border-rose-400/30 text-rose-300",
                          )}
                        >
                          {a.isActive && !expired ? "Active" : expired ? "Expired" : "Paused"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{a.body}</p>
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                        {meta?.label ?? "Info"} · created {relativeTime(a.createdAt)}
                        {a.expiresAt ? ` · expires ${relativeTime(a.expiresAt)}` : " · no expiry"}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await toggleAnnouncement({
                            announcementId: a._id as Id<"announcements">,
                            isActive: !a.isActive,
                          });
                          toast.success(a.isActive ? "Announcement paused." : "Announcement activated.");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed.");
                        }
                      }}
                      className={cn(
                        "rounded-lg p-2 transition-colors",
                        a.isActive
                          ? "text-amber-300 hover:bg-amber-400/10"
                          : "text-emerald-300 hover:bg-emerald-400/10",
                      )}
                      title={a.isActive ? "Pause" : "Activate"}
                    >
                      <Power className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm("Delete this announcement permanently?")) return;
                        try {
                          await deleteAnnouncement({
                            announcementId: a._id as Id<"announcements">,
                          });
                          toast.success("Announcement deleted.");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Failed.");
                        }
                      }}
                      className="rounded-lg p-2 text-rose-300 transition-colors hover:bg-rose-400/10"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
