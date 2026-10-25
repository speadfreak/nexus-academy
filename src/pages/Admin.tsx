// Learnyx Command OS — admin page. Gated by the existing admin role check.
// Shell: cmdos/AdminShell (grouped nav · command palette · notifications).
// Dashboard: cmdos/CommandCenter. Users: AdminUsersSection. Every ?tab= ID
// is preserved — route map in docs/command-os/AUDIT.md §4.

import { api } from "@/convex/_generated/api";
import { useAppBootstrap } from "@/components/AppBootstrap";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Flag,
  Github,
  Globe,
  KeyRound,
  Loader2,
  Lock,
  Megaphone,
  Plus,
  Plug,
  RefreshCw,
  Send,
  ShieldCheck,
  Terminal,
  Timer,
  Trash2,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { AdminAdminsSection } from "@/components/admin/AdminAdminsSection";
import { AdminAuditLogSection } from "@/components/admin/AdminAuditLogSection";
import { AdminUsersSection } from "@/components/admin/AdminUsersSection";
import { AdminFraudSection } from "@/components/admin/AdminFraudSection";
import { AdminCoverageSection } from "@/components/admin/AdminCoverageSection";
import { AdminTestimonialsSection } from "@/components/admin/AdminTestimonialsSection";
import { AdminTopicsSection } from "@/components/admin/AdminTopicsSection";
import { ContactGroupPanel } from "@/components/admin/ContactGroupPanel";
import { StatCard2 } from "@/components/admin/StatCard2";
import { AdminShell } from "@/components/admin/cmdos/AdminShell";
import type { ShellNotification } from "@/components/admin/cmdos/AdminShell";
import { CommandCenter } from "@/components/admin/cmdos/CommandCenter";
import {
  AXIS_COLOR,
  CHART_COLORS,
  ChartCard,
  FinanceHeroBanner,
  GRID_COLOR,
  TOOLTIP_STYLE,
  fmtMoney,
} from "@/components/admin/cmdos/blocks";
import type { AdminTabId } from "@/components/admin/cmdos/nav";
import { ALL_SECTIONS } from "@/components/admin/cmdos/nav";
import { SkeletonRows } from "@/components/admin/cmdos/kit";
import { DashboardShell } from "@/components/DashboardShell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

/* Heavy workspaces load on demand — keeps the /admin route chunk light. */
const AdminContentSection = lazy(() =>
  import("@/components/admin/AdminContentSection").then((m) => ({ default: m.AdminContentSection })),
);
const AdminSchoolsSection = lazy(() =>
  import("@/components/admin/AdminSchoolsSection").then((m) => ({ default: m.AdminSchoolsSection })),
);
const AdminAffiliatesSection = lazy(() =>
  import("@/components/admin/AdminAffiliatesSection").then((m) => ({ default: m.AdminAffiliatesSection })),
);
const AdminSubscriptionsSection = lazy(() =>
  import("@/components/admin/AdminSubscriptionsSection").then((m) => ({ default: m.AdminSubscriptionsSection })),
);
const AdminMarketingSection = lazy(() =>
  import("@/components/admin/AdminMarketingSection").then((m) => ({ default: m.AdminMarketingSection })),
);
const PaymentReviewsSection = lazy(() =>
  import("@/components/admin/PaymentReviewsSection").then((m) => ({ default: m.PaymentReviewsSection })),
);
const ExamEngineAdmin = lazy(() =>
  import("@/components/admin/ExamEngineAdmin").then((m) => ({ default: m.ExamEngineAdmin })),
);
const MatricAdmin = lazy(() =>
  import("@/components/admin/MatricAdmin").then((m) => ({ default: m.MatricAdmin })),
);

function SectionFallback() {
  return (
    <div className="cmdos-panel p-5">
      <SkeletonRows rows={5} />
    </div>
  );
}

/* ── Constants ──────────────────────────────────────────────────────── */

const PAY_STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-400/10 text-amber-300",
  completed: "bg-emerald-400/10 text-emerald-300",
  failed: "bg-rose-400/10 text-rose-300",
};

function formatEventMeta(m: Record<string, unknown> | null) {
  if (!m) return "";
  return Object.entries(m)
    .filter(([, v]) => typeof v === "string" || typeof v === "number")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

/* ── Keys tab (API key configuration) ────────────────────────────── */

function KeysTabContent({ adminAccess }: { adminAccess: boolean }) {
  const categories = useQuery(
    api.configKeys.getKeyStatusesByCategory,
    adminAccess ? undefined : "skip",
  );
  const customKeys = useQuery(
    api.configKeys.listCustomKeys,
    adminAccess ? undefined : "skip",
  );
  const setKey = useMutation(api.configKeys.setKey);
  const deleteKey = useMutation(api.configKeys.deleteKey);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customSaving, setCustomSaving] = useState(false);

  // ── Backend version probe (error-safe) ───────────────────────────
  const convex = useConvex();
  const [backendOutdated, setBackendOutdated] = useState<boolean | null>(null);
  useEffect(() => {
    if (!adminAccess) return;
    let cancelled = false;
    convex
      .query(api.configKeys.getBackendVersion)
      .then((data) => {
        if (!cancelled) setBackendOutdated((data as any)?.version < 3);
      })
      .catch(() => {
        if (!cancelled) setBackendOutdated(true);
      });
    return () => { cancelled = true; };
  }, [convex, adminAccess]);

  const handleSave = async (key: string) => {
    if (!editValue.trim()) return;
    setSaving(key);
    try {
      await setKey({ key, value: editValue.trim() });
      toast.success(`${key} saved!`);
      setEditingKey(null);
      setEditValue("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save key.");
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await deleteKey({ key });
      toast.success(`${key} removed — will use env var if set.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete key.");
    }
  };

  const handleAddCustom = async () => {
    if (!customName.trim() || !customValue.trim()) return;
    setCustomSaving(true);
    try {
      await setKey({ key: `custom:${customName.trim()}`, value: customValue.trim() });
      toast.success(`Custom key "${customName.trim()}" saved!`);
      setCustomName("");
      setCustomValue("");
      setShowAddCustom(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save key.");
    } finally {
      setCustomSaving(false);
    }
  };

  if (categories === undefined)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );

  // Count configured (excluding env-only keys like Google OAuth)
  const envOnlyKeys = new Set(
    categories
      .flatMap((c) => c.keys)
      .filter((k) => (k as any).isEnvOnly)
      .map((k) => k.key),
  );
  const regularKeys = categories.flatMap((c) => c.keys.filter((k) => !envOnlyKeys.has(k.key)));
  const configured = regularKeys.filter((k) => k.configured).length;
  const total = regularKeys.length;
  const authCategory = categories.find((c) => c.id === "auth");
  const authConfigured = authCategory ? authCategory.keys.filter((k) => k.configured).length : 0;
  const authTotal = authCategory?.keys.length ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Status banner */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <KeyRound className="size-4 text-primary" /> API Keys & Integrations
            </h2>
            <p className="text-sm text-muted-foreground">
              All keys are stored in the database and picked up by the backend automatically.
              No Convex dashboard access needed (except Google OAuth — see below).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="glass-chip flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px]">
              <span className={cn("size-2 rounded-full", configured === total ? "bg-emerald-400" : "bg-amber-400")} /> {configured}/{total} configured
            </span>
          </div>
        </div>
      </div>

      {/* ── GOOGLE OAUTH — HONEST NOTICE ──────────────────────────── */}
      {authCategory && (
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/15">
              <ShieldCheck className="size-4 text-amber-300" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold">Google OAuth — requires one manual Convex step</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Google OAuth credentials <strong className="text-foreground">cannot be database-backed</strong> because
                Convex&apos;s auth provider reads them at deploy/cold-start time — before any database query is possible.
                This is an architectural constraint of <code className="rounded bg-white/5 px-1 py-0.5 text-[11px]">@convex-dev/auth</code>, not something we can work around.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {authCategory.keys.map((k) => (
                  <div key={k.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5">
                    <Badge className={cn("font-mono text-[9px]", k.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>
                      {k.configured ? "configured · env" : "not set · env"}
                    </Badge>
                    <span className="text-sm font-semibold">{k.label}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{k.key}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-4">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">How to set Google OAuth (one-time setup):</p>
                <ol className="list-inside list-decimal space-y-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  <li>Go to <strong className="text-foreground">convex.dev/dashboard</strong> → select your project → <strong className="text-foreground">Settings</strong> → <strong className="text-foreground">Environment Variables</strong></li>
                  <li>Add <code className="rounded bg-white/5 px-1 py-0.5">GOOGLE_CLIENT_ID</code> with your OAuth client ID from <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">Google Cloud Console</a></li>
                  <li>Add <code className="rounded bg-white/5 px-1 py-0.5">GOOGLE_CLIENT_SECRET</code> with your OAuth client secret</li>
                  <li>Redeploy: run <code className="rounded bg-white/5 px-1 py-0.5">npx convex dev</code> locally, or push to trigger a production deploy</li>
                </ol>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Status: {authConfigured === authTotal ? (
                    <span className="text-emerald-300 font-semibold">Both keys detected — Google sign-in should work</span>
                  ) : (
                    <span className="text-amber-300">Keys not yet set in Convex env vars</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── BACKEND OUTDATED WARNING ──────────────────────────────── */}
      {backendOutdated === true && configured > 0 && (
        <div className="rounded-2xl border border-red-400/30 bg-red-400/[0.08] p-5">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-red-400/15">
              <AlertTriangle className="size-5 text-red-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-red-300">Backend needs updating — your keys won&apos;t work yet</h3>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Keys are saved in the database, but the Convex backend is running
                <strong className="text-foreground"> older code</strong> that doesn&apos;t read from the database yet.
              </p>
              <div className="mt-3 rounded-xl border border-white/5 bg-black/20 p-4 font-mono text-[12px] leading-loose">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Run on your computer:</p>
                <code className="block text-emerald-300">cd nexus-academy</code>
                <code className="block text-emerald-300">git pull</code>
                <code className="block text-emerald-300">npx convex dev</code>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ALL CONFIGURED SUCCESS ────────────────────────────────── */}
      {configured === total && total > 0 && backendOutdated !== true && (
        <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15">
              <CheckCircle2 className="size-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-300">All integrations configured!</p>
              <p className="text-[12px] text-muted-foreground">AI, payments, video, Telegram, and GitHub are all database-backed and ready.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── KEY CATEGORIES (skip auth — handled above) ────────────── */}
      {categories
        .filter((cat) => cat.id !== "auth")
        .map((cat) => (
          <div key={cat.id} className="glass-panel rounded-2xl p-5">
            <p className="mb-4 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {cat.label} · {cat.keys.filter((k) => k.configured).length}/{cat.keys.length}
            </p>
            <div className="flex flex-col gap-2">
              {cat.keys.map((k) => {
                const isEnvOnly = (k as any).isEnvOnly === true;
                return (
                  <div key={k.key} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">{k.label}</span>
                          <Badge className={cn("font-mono text-[9px]", k.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>
                            {k.configured ? "configured" : "not set"}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[9px] text-muted-foreground">
                            {k.source}
                          </Badge>
                        </div>
                        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{k.key} · {k.description}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {editingKey === k.key ? (
                          <>
                            <Input
                              type="password"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              placeholder="Paste the key value here..."
                              className="h-8 w-64 rounded-lg bg-white/5 font-mono text-xs"
                              autoFocus
                              onKeyDown={(e) => { if (e.key === "Enter") void handleSave(k.key); if (e.key === "Escape") { setEditingKey(null); setEditValue(""); } }}
                            />
                            <Button size="sm" className="h-8 cursor-pointer rounded-lg" onClick={() => void handleSave(k.key)} disabled={saving === k.key || !editValue.trim()}>
                              {saving === k.key ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />} Save
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 cursor-pointer rounded-lg text-muted-foreground" onClick={() => { setEditingKey(null); setEditValue(""); }}>
                              Cancel
                            </Button>
                          </>
                        ) : isEnvOnly ? (
                          <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-amber-400/20 bg-amber-400/[0.06] px-2.5 font-mono text-[10px] text-amber-300">
                            <Lock className="size-3" /> env only
                          </span>
                        ) : (
                          <>
                            {k.helpUrl && !k.configured && (
                              <a href={k.helpUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground">
                                Get Key <ExternalLink className="size-3" />
                              </a>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"
                              onClick={() => { setEditingKey(k.key); setEditValue(""); }}
                            >
                              {k.configured ? "Update" : "Add key"}
                            </Button>
                            {k.configured && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 cursor-pointer rounded-lg text-muted-foreground hover:text-rose-300"
                                onClick={() => void handleDelete(k.key)}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

      {/* ── CUSTOM KEYS (PART 4) ──────────────────────────────────── */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Custom Keys{customKeys && customKeys.length > 0 ? ` · ${customKeys.length}` : ""}
          </p>
          {!showAddCustom && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"
              onClick={() => setShowAddCustom(true)}
            >
              <Plus className="mr-1 size-3" /> Add custom key
            </Button>
          )}
        </div>

        {showAddCustom && (
          <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-primary/20 bg-primary/[0.04] p-3">
            <div className="min-w-0 flex-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Name</label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g. MY_API_KEY"
                className="h-8 rounded-lg bg-white/5 font-mono text-xs"
                autoFocus
                onKeyDown={(e) => { if (e.key === "Escape") { setShowAddCustom(false); setCustomName(""); setCustomValue(""); } }}
              />
            </div>
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Value</label>
              <Input
                type="password"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder="Paste the secret value..."
                className="h-8 rounded-lg bg-white/5 font-mono text-xs"
                onKeyDown={(e) => { if (e.key === "Enter") void handleAddCustom(); if (e.key === "Escape") { setShowAddCustom(false); setCustomName(""); setCustomValue(""); } }}
              />
            </div>
            <Button size="sm" className="h-8 cursor-pointer rounded-lg" onClick={() => void handleAddCustom()} disabled={customSaving || !customName.trim() || !customValue.trim()}>
              {customSaving ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />} Save
            </Button>
            <Button size="sm" variant="ghost" className="h-8 cursor-pointer rounded-lg text-muted-foreground" onClick={() => { setShowAddCustom(false); setCustomName(""); setCustomValue(""); }}>
              Cancel
            </Button>
          </div>
        )}

        {customKeys && customKeys.length > 0 && (
          <div className="flex flex-col gap-2">
            {customKeys.map((k) => (
              <div key={k.key} className="rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{k.label}</span>
                      <Badge className="bg-emerald-400/10 font-mono text-[9px] text-emerald-300">configured</Badge>
                      <Badge variant="outline" className="font-mono text-[9px] text-muted-foreground">database</Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">custom:{k.label}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]"
                      onClick={() => { setEditingKey(k.key); setEditValue(""); }}
                    >
                      Update
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 cursor-pointer rounded-lg text-muted-foreground hover:text-rose-300"
                      onClick={() => void handleDelete(k.key)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {(!customKeys || customKeys.length === 0) && !showAddCustom && (
          <p className="text-[12px] text-muted-foreground">
            No custom keys yet. Use &quot;Add custom key&quot; for any integration that doesn&apos;t have a dedicated field above.
            Custom keys are resolved with <code className="rounded bg-white/5 px-1 py-0.5">resolveConfigValue</code> just like the built-in ones.
          </p>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   ADMIN PAGE
   ══════════════════════════════════════════════════════════════════════ */

export default function Admin() {
  const { adminInfo: isAdmin } = useAppBootstrap(); // shared subscription (AppBootstrap)
  const adminIdentity = useQuery(api.admin.getCurrentAdminInfo);
  const promoteSelf = useMutation(api.admin.promoteSelfIfBootstrap);
  const enforceCanonical = useMutation(api.admin.enforceCanonicalAdmins);
  const canonicalEnforcedRef = useRef(false);

  // Canonical ownership sweep (idempotent, once per session): the platform
  // owner's email is pinned in convex/canonicalAdmin.ts. When they open the
  // admin workspace, one mutation promotes them to super_admin, demotes
  // EVERY other elevated account to plain "user", voids pending admin
  // invites for non-canonical emails, and writes one audit entry. Safe on
  // every visit — subsequent sweeps find nothing to change.
  useEffect(() => {
    if (!adminIdentity?.isCanonical || canonicalEnforcedRef.current) return;
    canonicalEnforcedRef.current = true;
    void enforceCanonical().catch(() => {
      // Never block the workspace on the sweep; it retries next visit.
      canonicalEnforcedRef.current = false;
    });
  }, [adminIdentity?.isCanonical, enforceCanonical]);

  // Persist the owner's super_admin role if it isn't written yet (queries
  // never write; the first gated mutation would, but this makes the role
  // visible immediately in the Admins section).
  useEffect(() => {
    if (isAdmin?.isAdmin && !isAdmin.role) {
      void promoteSelf();
    }
  }, [isAdmin?.isAdmin, isAdmin?.role, promoteSelf]);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = (searchParams.get("tab") ?? "dashboard") as AdminTabId;
  const setTab = (id: AdminTabId) =>
    setSearchParams(id === "dashboard" ? {} : { tab: id });

  // Cross-section jump links (e.g. the Schools console's feature-toggle chip
  // deep-links to the Keys tab) speak this tiny custom event protocol.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const target = (e as CustomEvent<string>).detail;
      if (typeof target === "string" && ALL_SECTIONS.some((t) => t.id === target)) {
        setTab(target as AdminTabId);
      }
    };
    window.addEventListener("admin:navigate-tab", onNavigate);
    return () => window.removeEventListener("admin:navigate-tab", onNavigate);
  }, [setTab]);

  const adminAccess = isAdmin?.isAdmin ?? false;

  /* ── Subscriptions — one per active workspace, not one per tab. ──
     The shell-level queues below are the only always-on reads; everything
     else subscribes when its tab is on screen. Convex dedupes identical
     subscriptions, so sections re-subscribing the same query cost nothing. */
  const dashboard = useQuery(
    api.adminCenter.getAdminDashboard,
    adminAccess && tab === "dashboard" ? undefined : "skip",
  );

  const finance = useQuery(
    api.adminCenter.getFinanceOverview,
    adminAccess && tab === "finance" ? undefined : "skip",
  );

  /* Shell notification queues — real operational signals only. */
  const pendingPayments = useQuery(
    api.manualPayments.getPendingCount,
    adminAccess ? undefined : "skip",
  );
  const pendingSeatSubmissions = useQuery(
    api.schools.adminListSeatSubmissions,
    adminAccess ? { status: "pending" as const } : "skip",
  );

  /* ── System (System tab) + Integrations (Terminal & Broadcast tabs) ── */
  const system = useQuery(
    api.adminCenter.getSystemStatus,
    adminAccess && tab === "system" ? undefined : "skip",
  );
  const integrations = useQuery(
    api.adminCenter.getIntegrationStatus,
    adminAccess && (tab === "terminal" || tab === "broadcast") ? undefined : "skip",
  );
  const testIntegration = useAction(api.systemEvents.testIntegrationConnection);
  const [integrationResults, setIntegrationResults] = useState<
    Record<string, { ok: boolean; detail: string | null }>
  >({});
  const [testingIntegration, setTestingIntegration] = useState<string | null>(
    null,
  );
  const runIntegrationTest = async (integration: string) => {
    setTestingIntegration(integration);
    try {
      const r = await testIntegration({ integration: integration as never });
      setIntegrationResults((p) => ({ ...p, [integration]: r }));
    } catch (error) {
      setIntegrationResults((p) => ({
        ...p,
        [integration]: {
          ok: false,
          detail: error instanceof Error ? error.message : "Failed.",
        },
      }));
    } finally {
      setTestingIntegration(null);
    }
  };

  /* ── Terminal (system events) ── */
  const convexClient = useConvex();
  const [eventFilter, setEventFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sinceFilter, setSinceFilter] = useState("");
  const [olderEvents, setOlderEvents] = useState<
    {
      _id: string;
      eventType: string;
      source: string;
      status: string;
      userId: string | null;
      metadata: Record<string, unknown> | null;
      durationMs: number | null;
      createdAt: number;
    }[]
  >([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const systemEvents = useQuery(
    api.systemEvents.getSystemEvents,
    adminAccess && tab === "terminal"
      ? {
          eventType: eventFilter || undefined,
          status: (statusFilter || undefined) as
            | "success"
            | "error"
            | undefined,
          since: sinceFilter ? Number(sinceFilter) : undefined,
        }
      : "skip",
  );

  const liveFeed = Array.isArray(systemEvents)
    ? systemEvents
    : (systemEvents?.events ?? []);
  const liveHasMore =
    !Array.isArray(systemEvents) &&
    (systemEvents?.nextCursor ?? null) !== null;

  const health = useQuery(
    api.systemEvents.getSystemHealthSummary,
    adminAccess && (tab === "terminal" || tab === "dashboard") ? undefined : "skip",
  );

  const resetOlder = () => {
    setOlderEvents([]);
    setOlderCursor(null);
  };

  const loadOlderEvents = async () => {
    if (!adminAccess || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await convexClient.query(
        api.systemEvents.getSystemEvents,
        {
          eventType: eventFilter || undefined,
          status: (statusFilter || undefined) as
            | "success"
            | "error"
            | undefined,
          since: sinceFilter ? Number(sinceFilter) : undefined,
          cursor:
            olderCursor ??
            (Array.isArray(systemEvents)
              ? undefined
              : (systemEvents?.nextCursor ?? undefined)),
          limit: 60,
        },
      );
      setOlderEvents((p) => [...p, ...page.events]);
      setOlderCursor(page.nextCursor);
    } catch {
      /* keep live tail working */
    } finally {
      setLoadingOlder(false);
    }
  };

  /* ── Broadcast (Telegram) ── */
  const channels = useQuery(
    api.telegram.listTelegramChannels,
    adminAccess && tab === "broadcast" ? undefined : "skip",
  );
  const templates = useQuery(
    api.telegram.getBroadcastTemplates,
    adminAccess && tab === "broadcast" ? undefined : "skip",
  );
  const broadcastLog = useQuery(
    api.telegram.getBroadcastLog,
    adminAccess && tab === "broadcast" ? undefined : "skip",
  );
  const addChannel = useMutation(api.telegram.addTelegramChannel);
  const removeChannel = useMutation(api.telegram.removeTelegramChannel);
  const setAutoPost = useMutation(api.telegram.setAutoPost);
  const sendBroadcastAction = useAction(api.telegramActions.sendBroadcast);
  const [channelName, setChannelName] = useState("");
  const [channelChatId, setChannelChatId] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);
  const [autoPostActing, setAutoPostActing] = useState<string | null>(null);

  /* ── GitHub ── */
  const verifyGithub = useAction(api.github.verifyGithubConnection);
  const [githubStatus, setGithubStatus] = useState<{
    configured: boolean;
    valid: boolean;
    login: string | null;
    repos: {
      fullName: string;
      private: boolean;
      pushedAt: string | null;
    }[];
    error: string | null;
  } | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);

  const runGithubCheck = async () => {
    setCheckingGithub(true);
    try {
      const r = await verifyGithub();
      setGithubStatus(r);
    } catch (error) {
      setGithubStatus({
        configured: true,
        valid: false,
        login: null,
        repos: [],
        error:
          error instanceof Error ? error.message : "Connection check failed.",
      });
    } finally {
      setCheckingGithub(false);
    }
  };

  useEffect(() => {
    if (tab === "system" && githubStatus === null && !checkingGithub)
      void runGithubCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /* ── Reports ── */
  const reports = useQuery(
    api.safety.listReports,
    adminAccess && tab === "reports" ? undefined : "skip",
  );
  const updateReportStatus = useMutation(api.safety.updateReportStatus);
  const [reportFilter, setReportFilter] = useState("open");
  const [reportActing, setReportActing] = useState<string | null>(null);

  const handleReportStatus = async (
    reportId: string,
    status: "open" | "reviewed" | "resolved",
  ) => {
    setReportActing(reportId);
    try {
      await updateReportStatus({ reportId: reportId as never, status });
      toast.success(`Report marked ${status}.`);
    } catch {
      toast.error("Could not update the report.");
    } finally {
      setReportActing(null);
    }
  };

  /* ── Handlers ── */
  const handlePromote = async () => {
    const r = await promoteSelf();
    if (r.promoted) {
      toast.success("Admin access granted. Welcome!");
    } else {
      toast.error(
        "Could not grant admin access — an admin account already exists.",
      );
    }
  };

  const handleAddChannel = async () => {
    if (addingChannel) return;
    if (!channelName.trim() || !channelChatId.trim()) {
      toast.error("Channel name and chat id are required.");
      return;
    }
    setAddingChannel(true);
    try {
      await addChannel({
        name: channelName.trim(),
        chatId: channelChatId.trim(),
      });
      toast.success(
        "Channel added. Auto-post starts OFF — toggle it if you want it.",
      );
      setChannelName("");
      setChannelChatId("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add the channel.",
      );
    } finally {
      setAddingChannel(false);
    }
  };

  const handleRemoveChannel = async (channelId: string) => {
    try {
      await removeChannel({ channelId: channelId as never });
      setSelectedChannels((p) => p.filter((id) => id !== channelId));
      toast.success("Channel removed.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not remove the channel.",
      );
    }
  };

  const handleToggleAutoPost = async (channelId: string, enabled: boolean) => {
    setAutoPostActing(channelId);
    try {
      await setAutoPost({ channelId: channelId as never, enabled });
      toast.success(
        enabled
          ? "Auto-post enabled for this channel."
          : "Auto-post disabled.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update auto-post.",
      );
    } finally {
      setAutoPostActing(null);
    }
  };

  const handleBroadcast = async () => {
    if (broadcasting) return;
    if (selectedChannels.length === 0) {
      toast.error("Pick at least one channel to broadcast to.");
      return;
    }
    if (!broadcastMessage.trim()) {
      toast.error("Write a message first.");
      return;
    }
    setBroadcasting(true);
    try {
      const r = await sendBroadcastAction({
        channelIds: selectedChannels as never[],
        message: broadcastMessage.trim(),
      });
      toast.success(
        `Broadcast sent — ${r.sent} delivered${r.failed > 0 ? `, ${r.failed} failed` : ""}.`,
      );
      setBroadcastMessage("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Broadcast failed.",
      );
    } finally {
      setBroadcasting(false);
    }
  };

  /* ── Early returns ── */
  if (isAdmin === undefined)
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );

  if (!isAdmin?.isAdmin)
    return (
      <DashboardShell>
        <div className="glass-soft mx-auto flex max-w-lg flex-col items-center rounded-2xl px-6 py-14 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Lock className="size-6" />
          </div>
          <h1 className="mt-4 text-xl font-extrabold tracking-tight">
            Admins only
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The control center is restricted to administrators. If this is the
            first account on the platform, you can request the bootstrap admin
            role — otherwise ask the platform owner to set your role to
            &quot;admin&quot;.
          </p>
          <Button className="mt-6 rounded-xl" onClick={handlePromote}>
            <ShieldCheck className="size-4" /> Request admin access
          </Button>
        </div>
      </DashboardShell>
    );

  /* ── Shell notifications — only real, non-zero queues render. ── */
  const notifications: ShellNotification[] = [];
  if ((pendingPayments?.count ?? 0) > 0) {
    notifications.push({
      id: "payments",
      tone: "warn",
      title: `${pendingPayments!.count} manual payment${pendingPayments!.count === 1 ? "" : "s"} awaiting review`,
      detail: "TeleBirr transfers · Payment Reviews",
      tab: "payments",
    });
  }
  if ((pendingSeatSubmissions?.length ?? 0) > 0) {
    notifications.push({
      id: "seats",
      tone: "info",
      title: `${pendingSeatSubmissions!.length} school seat request${pendingSeatSubmissions!.length === 1 ? "" : "s"} pending`,
      detail: "Bulk purchase approvals · Payment Reviews",
      tab: "payments",
    });
  }

  /* ════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════ */
  return (
    <DashboardShell>
      <AdminShell
        tab={tab}
        onTabChange={setTab}
        role={isAdmin?.role}
        notifications={notifications}
      >
        {/* ══════ DASHBOARD — Executive Command Center ══════ */}
        {tab === "dashboard" && (
          <CommandCenter
            dashboard={dashboard}
            health={health}
            onNavigate={setTab}
          />
        )}

        {/* ══════ CONTENT ══════ */}
        {tab === "content" && (
          <div className="min-w-0 flex flex-col gap-6">
            <Suspense fallback={<SectionFallback />}>
              <AdminContentSection />
            </Suspense>
            <AdminTopicsSection />
          </div>
        )}

        {/* ══════ COVERAGE GAPS ══════ */}
        {tab === "coverage" && <AdminCoverageSection />}

        {/* ══════ USERS — People directory ══════ */}
        {tab === "users" && <AdminUsersSection />}

            {/* ══════ ADMINS ══════ */}
            {tab === "admins" && (
              <AdminAdminsSection />
            )}

            {/* ══════ KEYS ══════ */}
            {tab === "keys" && (
              <KeysTabContent adminAccess={adminAccess} />
            )}

            {/* ══════ FINANCE ══════ */}
            {tab === "finance" && (
              <div className="flex min-w-0 flex-col gap-4">
                {finance === undefined ? (
                  <div className="flex h-40 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <>
                    {/* Finance Hero Banner — re-used on the dedicated Finance tab too */}
                    <FinanceHeroBanner
                      currency={finance.currency}
                      revenueTotal={finance.totalEarned}
                      revenueThisMonth={finance.thisMonth}
                      pendingRevenue={finance.pendingRevenue}
                      pendingManualSubmissions={finance.pendingManualSubmissions}
                      slaBreached={finance.slaBreachedSubmissions}
                      paymentSuccessRate={finance.paymentSuccessRate}
                      arpu={finance.arpu}
                      estimatedLtv={finance.estimatedLtv}
                      revenueChange30d={finance.revenueChangePercent30d}
                      revenueByDay={finance.revenueByDay}
                      health={finance.health}
                    />

                    {/* Secondary stats — additional finance metrics */}
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                      <StatCard2
                        label="last 30 days"
                        value={finance.last30Days}
                        icon={Timer}
                        money
                        currency={finance.currency}
                        sub="rolling 30-day window"
                        delta={finance.revenueChangePercent30d}
                        deltaSuffix="%"
                        accent="default"
                      />
                      <StatCard2
                        label="avg payment"
                        value={finance.avgPayment}
                        icon={Zap}
                        money
                        currency={finance.currency}
                        sub={`${finance.completedCount} completed`}
                        accent="default"
                      />
                      <StatCard2
                        label="pending count"
                        value={finance.pendingCount}
                        icon={Timer}
                        sub={`${finance.pendingCount} provider + ${finance.pendingManualSubmissions} manual`}
                        accent={finance.pendingCount + finance.pendingManualSubmissions > 0 ? "warning" : "default"}
                      />
                      <StatCard2
                        label="failed"
                        value={finance.failedCount}
                        icon={AlertTriangle}
                        sub="failed payment attempts"
                        accent={finance.failedCount > 0 ? "danger" : "default"}
                      />
                      <StatCard2
                        label="conversion"
                        value={Math.round(finance.conversionRate * 1000) / 10}
                        icon={Users}
                        sub={`${finance.payingUsers} paying / trial · ${Math.round(finance.paymentSuccessRate * 100)}% success`}
                        accent={finance.conversionRate >= 0.1 ? "success" : "default"}
                      />
                    </div>

                    {/* Affiliate cost lines — gross revenue above stays EXACTLY
                        as it is; commissions are shown as a separate cost line
                        (revenue is revenue; commissions are what it costs). */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <StatCard2
                        label="affiliate commissions accrued"
                        value={finance.affiliateCommissionsAccrued}
                        icon={Megaphone}
                        money
                        currency={finance.currency}
                        sub="owed to promoters (non-void, all time)"
                        accent="warning"
                      />
                      <StatCard2
                        label="affiliate commissions paid"
                        value={finance.affiliateCommissionsPaid}
                        icon={Send}
                        money
                        currency={finance.currency}
                        sub="recorded TeleBirr payouts"
                        accent="default"
                      />
                      <StatCard2
                        label="net revenue after commissions"
                        value={finance.netRevenueAfterCommissions}
                        icon={Wallet}
                        money
                        currency={finance.currency}
                        sub={`gross ${fmtMoney(finance.totalEarned)} − accrued ${fmtMoney(finance.affiliateCommissionsAccrued)}`}
                        accent={finance.netRevenueAfterCommissions >= 0 ? "success" : "danger"}
                      />
                    </div>

                    {/* Daily revenue + provider breakdown */}
                    <div className="grid gap-4 lg:grid-cols-3">
                      <ChartCard
                        title="revenue · last 30 days"
                        sub={`Daily completed revenue, in ${finance.currency}`}
                        className="lg:col-span-2"
                      >
                        <div className="h-56">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart
                              data={finance.revenueByDay}
                              margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
                            >
                              <defs>
                                <linearGradient id="dailyGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.35} />
                                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                              <XAxis
                                dataKey="label"
                                tick={{ fill: AXIS_COLOR, fontSize: 10 }}
                                axisLine={false}
                                tickLine={false}
                                interval="preserveStartEnd"
                                minTickGap={24}
                              />
                              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                              <Area
                                type="monotone"
                                dataKey="revenue"
                                stroke="var(--primary)"
                                strokeWidth={2}
                                fill="url(#dailyGrad)"
                                name={finance.currency}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </ChartCard>
                      <ChartCard title="by provider" sub={`${finance.currency} from completed payments`}>
                        <div className="flex h-full min-h-48 flex-col justify-center gap-3">
                          {finance.revenueByProvider.length === 0 ? (
                            <p className="py-10 text-center text-sm text-muted-foreground">No completed payments yet.</p>
                          ) : finance.revenueByProvider.map((e, i) => {
                            const max = Math.max(1, ...finance.revenueByProvider.map((p) => p.total));
                            return (
                              <div key={e.provider}>
                                <div className="flex items-center justify-between font-mono text-[11px]">
                                  <span className="flex items-center gap-2 capitalize"><span className="size-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />{e.provider}</span>
                                  <span className="font-bold tabular-nums">{fmtMoney(e.total)} {finance.currency}</span>
                                </div>
                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full" style={{ width: `${(e.total / max) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} /></div>
                                <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{e.count} payments</p>
                              </div>
                            );
                          })}
                        </div>
                      </ChartCard>
                    </div>

                    {/* 12-month revenue + manual pipeline */}
                    <div className="grid gap-4 lg:grid-cols-3">
                      <ChartCard
                        title="revenue · last 12 months"
                        sub={`Completed payments in ${finance.currency}`}
                        className="lg:col-span-2"
                      >
                        <div className="h-60">
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={finance.revenueByMonth} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                              <defs><linearGradient id="finGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} /></linearGradient></defs>
                              <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                              <YAxis tick={{ fill: AXIS_COLOR, fontSize: 11 }} axisLine={false} tickLine={false} width={46} />
                              <Tooltip contentStyle={TOOLTIP_STYLE} />
                              <Area type="monotone" dataKey="revenue" stroke="var(--chart-4)" strokeWidth={2} fill="url(#finGrad)" name={finance.currency} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </ChartCard>
                      <ChartCard title="manual submissions" sub="TeleBirr personal transfers pipeline">
                        <div className="flex h-full min-h-48 flex-col justify-center gap-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3">
                              <p className="font-mono text-[9px] uppercase tracking-wider text-amber-300/80">Pending</p>
                              <p className="mt-1 font-mono text-2xl font-bold text-amber-200">{finance.pendingManualSubmissions}</p>
                            </div>
                            <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
                              <p className="font-mono text-[9px] uppercase tracking-wider text-emerald-300/80">Approved</p>
                              <p className="mt-1 font-mono text-2xl font-bold text-emerald-200">{finance.approvedManualSubmissions}</p>
                            </div>
                            <div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3">
                              <p className="font-mono text-[9px] uppercase tracking-wider text-rose-300/80">Rejected</p>
                              <p className="mt-1 font-mono text-2xl font-bold text-rose-200">{finance.rejectedManualSubmissions}</p>
                            </div>
                            <div className="rounded-xl border border-rose-400/30 bg-rose-400/[0.08] p-3">
                              <p className="font-mono text-[9px] uppercase tracking-wider text-rose-300/80">SLA breached</p>
                              <p className="mt-1 font-mono text-2xl font-bold text-rose-200">{finance.slaBreachedSubmissions}</p>
                            </div>
                          </div>
                          <p className="text-[10px] text-muted-foreground/70">
                            Pending submissions are reviewed in the Payments tab.
                            SLA-breached items should be addressed first.
                          </p>
                        </div>
                      </ChartCard>
                    </div>

                    {/* Recent transactions */}
                    <div className="glass-panel rounded-2xl p-5">
                      <h2 className="text-lg font-extrabold tracking-tight">Recent transactions</h2>
                      <p className="text-sm text-muted-foreground">The latest payment attempts for reconciliation.</p>
                      <div className="mt-4 overflow-x-auto">
                        {finance.recentTransactions.length === 0 ? (
                          <p className="py-10 text-center text-sm text-muted-foreground">No payments yet.</p>
                        ) : (
                          <Table>
                            <TableHeader><TableRow className="hover:bg-transparent"><TableHead>User</TableHead><TableHead>Provider</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Reference</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                            <TableBody>
                              {finance.recentTransactions.map((p) => (
                                <TableRow key={p._id} className="hover:bg-white/5">
                                  <TableCell className="max-w-[12rem]"><p className="truncate text-sm font-semibold">{p.userName ?? "Guest"}</p><p className="truncate font-mono text-[10px] text-muted-foreground">{p.userEmail ?? "no email"}</p></TableCell>
                                  <TableCell className="font-mono text-[11px] capitalize">{p.provider}</TableCell>
                                  <TableCell className="font-mono text-[11px] tabular-nums">{p.amount} {p.currency}</TableCell>
                                  <TableCell><Badge className={cn("font-mono text-[10px]", PAY_STATUS_STYLES[p.status])}>{p.status}</Badge></TableCell>
                                  <TableCell className="max-w-[10rem] truncate font-mono text-[10px] text-muted-foreground">{p.providerTransactionId ?? "—"}</TableCell>
                                  <TableCell className="font-mono text-[10px] text-muted-foreground">{relativeTime(p.createdAt)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </div>

                    {/* Contact Group admin panel — manage where student
                        contact-form messages are delivered */}
                    <ContactGroupPanel />
                  </>
                )}
              </div>
            )}

        {/* ══════ PAYMENT REVIEWS ══════ */}
        {tab === "payments" && (
          <Suspense fallback={<SectionFallback />}>
            <PaymentReviewsSection />
          </Suspense>
        )}

        {/* ══════ SCHOOLS — school system management console ══════ */}
        {tab === "schools" && (
          <Suspense fallback={<SectionFallback />}>
            <AdminSchoolsSection />
          </Suspense>
        )}

        {/* ══════ AFFILIATES — promoter/commission control room ══════ */}
        {/* Usable even while the master toggle is OFF so the owner can
            prepare promoters before launching — mirrors the Schools tab
            pattern. Gated to admin+ like Payments/Finance. */}
        {tab === "affiliates" && (
          <Suspense fallback={<SectionFallback />}>
            <AdminAffiliatesSection />
          </Suspense>
        )}

        {/* ══════ FRAUD PATTERNS — review-only suspicious-pattern detection ══════ */}
        {tab === "fraud" && <AdminFraudSection />}

        {/* ══════ MARKETING — referral + discounts + announcements ══════ */}
        {tab === "marketing" && (
          <Suspense fallback={<SectionFallback />}>
            <AdminMarketingSection />
          </Suspense>
        )}

        {/* ══════ TESTIMONIALS — review queue + feature/reorder + manual add ══════ */}
        {tab === "testimonials" && <AdminTestimonialsSection />}

        {/* ══════ SUBSCRIPTIONS — trial program control ══════ */}
        {tab === "subscriptions" && (
          <Suspense fallback={<SectionFallback />}>
            <AdminSubscriptionsSection />
          </Suspense>
        )}

            {/* ══════ REPORTS ══════ */}
            {tab === "reports" && (
              <div className="glass-panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">Safety reports</h2>
                    <p className="text-sm text-muted-foreground">Student reports with enough context to act.</p>
                  </div>
                  <div className="flex gap-1.5">
                    {["open", "reviewed", "resolved"].map((s) => (
                      <button key={s} type="button" onClick={() => setReportFilter(s)} className={cn("cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wide transition-colors", reportFilter === s ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/5")}>{s}</button>
                    ))}
                  </div>
                </div>
                {reports === undefined ? (
                  <div className="mt-6 flex items-center justify-center py-10"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {reports.filter((r) => r.status === reportFilter).length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No {reportFilter} reports.</p>}
                    {reports.filter((r) => r.status === reportFilter).map((r) => (
                      <div key={r._id} className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300"><Flag className="size-4" /></div>
                            <div>
                              <p className="flex flex-wrap items-center gap-2 text-sm font-bold">{r.reported.name}<Badge className="border-rose-400/20 bg-rose-400/10 font-mono text-[9px] uppercase text-rose-300">{r.reason.replace(/_/g, " ")}</Badge></p>
                              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{r.reported.email ?? "no email"} · reported by {r.reporter.name} ({r.reporter.email ?? "no email"}) · {relativeTime(r.createdAt)}</p>
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            {r.status === "open" && <Button size="sm" variant="outline" className="cursor-pointer rounded-lg bg-white/5 text-xs" onClick={() => void handleReportStatus(r._id, "reviewed")} disabled={reportActing === r._id}>Mark reviewed</Button>}
                            {r.status !== "resolved" && <Button size="sm" className="cursor-pointer rounded-lg text-xs" onClick={() => void handleReportStatus(r._id, "resolved")} disabled={reportActing === r._id}>Resolve</Button>}
                          </div>
                        </div>
                        {r.details && <p className="mt-3 rounded-lg bg-white/[0.03] p-3 text-[13px] leading-relaxed text-muted-foreground">"{r.details}"</p>}
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {r.room && <Badge variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">room: {r.room.name} ({r.room.status})</Badge>}
                          {r.group && <Badge variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">group: {r.group.name}</Badge>}
                          {r.reportedGroupMemberships.map((g) => <Badge key={g.groupId} variant="outline" className="gap-1 font-mono text-[9px] text-muted-foreground">member of: {g.name}</Badge>)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ══════ TERMINAL ══════ */}
            {tab === "terminal" && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="glass-panel rounded-2xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Terminal className="size-4 text-primary" /> System terminal</h2>
                      <p className="text-sm text-muted-foreground">Live feed of critical paths — AI, payments, rooms, uploads. Real-time via Convex.</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <select value={eventFilter} onChange={(e) => { setEventFilter(e.target.value); resetOlder(); }} className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none">
                        <option value="">all types</option>
                        {["api_call", "error", "auth_event", "payment_event", "room_event", "content_event"].map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetOlder(); }} className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none">
                        <option value="">all statuses</option>
                        <option value="success">success</option>
                        <option value="error">error</option>
                      </select>
                      <select value={sinceFilter} onChange={(e) => { setSinceFilter(e.target.value); resetOlder(); }} className="h-8 cursor-pointer rounded-lg border border-border bg-white/5 px-2 font-mono text-[10px] text-muted-foreground outline-none">
                        <option value="">all time</option>
                        <option value="86400000">last 24h</option>
                        <option value="604800000">last 7d</option>
                      </select>
                    </div>
                  </div>
                  {health === undefined ? (
                    <div className="mt-4 flex h-14 items-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">events 24h</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums">{health.last24hCount}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">error rate</p><p className={cn("mt-1 font-mono text-lg font-extrabold tabular-nums", health.errorRate > 0.05 ? "text-rose-300" : "text-emerald-300")}>{(health.errorRate * 100).toFixed(1)}%</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">AI latency avg</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums">{health.avgAiLatencyMs > 0 ? `${health.avgAiLatencyMs}ms` : "—"}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">AI calls 24h</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums">{health.aiCallsLast24h}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">active now</p><p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-primary">{health.activeUsersRightNow}</p></div>
                      <div className="rounded-xl bg-white/4 px-3 py-2.5"><p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">by type</p><p className="mt-1 truncate font-mono text-[10px] font-bold text-muted-foreground">{health.byType.map((s) => `${s.eventType}:${s.count}`).join(" · ") || "—"}</p></div>
                    </div>
                  )}
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <div className="overflow-hidden rounded-xl border border-white/5 bg-black/40">
                    <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
                      <span className="size-2 rounded-full bg-rose-400/80" />
                      <span className="size-2 rounded-full bg-amber-400/80" />
                      <span className="size-2 rounded-full bg-emerald-400/80" />
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">learnyx://system-events --tail -f</span>
                      <span className="ml-auto flex items-center gap-1.5 font-mono text-[9px] text-emerald-300"><span className="size-1.5 animate-pulse rounded-full bg-emerald-300" /> live</span>
                    </div>
                    <div className="max-h-[26rem] overflow-y-auto p-3 font-mono text-[11px] leading-5" data-scroll-contain>
                      {systemEvents === undefined ? (
                        <div className="flex items-center gap-2 py-6 text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> connecting…</div>
                      ) : liveFeed.length === 0 && olderEvents.length === 0 ? (
                        <p className="py-6 text-muted-foreground">no events yet — actions will stream in as students use the platform</p>
                      ) : (
                        <>
                          {[...olderEvents, ...liveFeed].map((e) => (
                            <div key={e._id} className="flex gap-2 border-b border-white/[0.03] py-1.5 last:border-0">
                              <span className="shrink-0 text-muted-foreground/70">{new Date(e.createdAt).toLocaleTimeString([], { hour12: false })}</span>
                              <span className={cn("shrink-0 font-bold", e.status === "error" ? "text-rose-300" : "text-emerald-300")}>{e.status === "error" ? "✖" : "✓"}</span>
                              <span className="shrink-0 text-primary">{e.eventType}</span>
                              <span className="shrink-0 text-amber-200/80">{e.source}</span>
                              {e.durationMs !== null && <span className="shrink-0 text-muted-foreground">{e.durationMs}ms</span>}
                              <span className="truncate text-muted-foreground/80">{formatEventMeta(e.metadata)}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                    {(liveHasMore || olderCursor) && (
                      <button type="button" onClick={() => void loadOlderEvents()} disabled={loadingOlder} className="flex w-full items-center justify-center gap-2 border-t border-white/5 py-2 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground">
                        {loadingOlder ? <><Loader2 className="size-3 animate-spin" /> loading older…</> : "⌥ load older events"}
                      </button>
                    )}
                  </div>
                </div>
                {/* Integrations */}
                <div className="glass-panel rounded-2xl p-5">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Plug className="size-4 text-primary" /> Integrations</h2>
                    <p className="text-sm text-muted-foreground">Configuration status plus real 24h usage per service. Secrets are never displayed.</p>
                  </div>
                  <div className="mt-4 flex flex-col gap-2">
                    {(integrations ?? []).map((ig) => {
                      const tr = integrationResults[ig.id];
                      return (
                        <div key={ig.id} className="rounded-xl border border-white/5 bg-white/[0.03] px-3.5 py-3">
                          <div className="grid items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", ig.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>
                                {ig.configured ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                              </span>
                              <span className="truncate text-sm font-semibold">{ig.label}</span>
                            </div>
                            <span className={cn("flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wide", ig.configured ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300")}>
                              {ig.configured ? "configured" : "key missing"}
                            </span>
                            <div className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
                              <span className="truncate font-mono text-[10px] text-muted-foreground">{ig.calls24h} calls · {(ig.errorRate * 100).toFixed(0)}% err · {ig.lastUsedAt ? relativeTime(ig.lastUsedAt) : "never used"}</span>
                              {(["groq", "telegram", "github"] as string[]).includes(ig.id) && (
                                <Button variant="outline" size="sm" className="h-7 shrink-0 cursor-pointer rounded-lg bg-white/5 font-mono text-[10px]" onClick={() => void runIntegrationTest(ig.id)} disabled={testingIntegration === ig.id}>
                                  {testingIntegration === ig.id ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Test
                                </Button>
                              )}
                            </div>
                          </div>
                          {tr && <p className={cn("mt-2 border-t border-white/5 pt-2 font-mono text-[10px]", tr.ok ? "text-emerald-300" : "text-rose-300")}>{tr.detail ?? (tr.ok ? "connected" : "failed")}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ══════ BROADCAST ══════ */}
            {tab === "broadcast" && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="glass-panel rounded-2xl p-5">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Send className="size-4 text-primary" /> Telegram broadcast</h2>
                    <p className="text-sm text-muted-foreground">Send a message to one or more channels. Auto-post on new content is OFF per channel.</p>
                  </div>
                  {integrations?.find((i) => i.id === "telegram")?.configured === false && (
                    <Alert className="glass-soft mt-4 border-amber-400/25 bg-amber-400/10">
                      <AlertTriangle className="size-4 text-amber-300" />
                      <AlertTitle className="text-amber-300">TELEGRAM_BOT_TOKEN not set</AlertTitle>
                      <AlertDescription className="text-amber-200/80">Create a bot with @BotFather and paste its token in the Keys tab.</AlertDescription>
                    </Alert>
                  )}
                  <div className="mt-5">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">channels</p>
                    <div className="mt-3 flex flex-col gap-2">
                      {channels === undefined ? (
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      ) : channels.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-border bg-white/[0.02] px-4 py-6 text-center text-sm text-muted-foreground">No channels yet — add the first one below.</p>
                      ) : channels.map((ch) => (
                        <div key={ch._id} className="flex flex-wrap items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3">
                          <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{ch.name}</p><p className="truncate font-mono text-[10px] text-muted-foreground">chat id: {ch.chatId}</p></div>
                          <label className="flex cursor-pointer items-center gap-2 font-mono text-[10px] text-muted-foreground"><Switch checked={ch.autoPost} disabled={autoPostActing === ch._id} onCheckedChange={(next) => void handleToggleAutoPost(ch._id, next)} /> auto-post</label>
                          <Button variant="ghost" size="sm" className="h-8 cursor-pointer text-muted-foreground hover:text-rose-300" onClick={() => void handleRemoveChannel(ch._id)}><Trash2 className="size-3.5" /></Button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Channel name" className="h-9 w-56 rounded-xl bg-white/5 font-mono text-xs" />
                    <Input value={channelChatId} onChange={(e) => setChannelChatId(e.target.value)} placeholder="chat id (e.g. -1001234567890)" className="h-9 w-56 rounded-xl bg-white/5 font-mono text-xs" />
                    <Button size="sm" className="h-9 cursor-pointer rounded-xl" onClick={() => void handleAddChannel()} disabled={addingChannel}>{addingChannel ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Add channel</Button>
                  </div>
                  <p className="mt-2 font-mono text-[10px] text-muted-foreground">How to get a chat id: add your bot to the group/channel, then send any message and open <code className="rounded bg-white/10 px-1">https://api.telegram.org/bot&lt;TOKEN&gt;/getUpdates</code> — the numeric id appears in the result.</p>
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">compose broadcast</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {(templates ?? []).map((t) => (
                      <button key={t.id} type="button" onClick={() => setBroadcastMessage(t.text)} className="cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary">{t.id}</button>
                    ))}
                  </div>
                  <Textarea value={broadcastMessage} onChange={(e) => setBroadcastMessage(e.target.value)} placeholder="Write the message… (HTML is supported)" className="mt-3 min-h-24 rounded-xl bg-white/5 font-mono text-xs" />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {(channels ?? []).map((ch) => (
                      <label key={ch._id} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 font-mono text-[11px] transition-colors", selectedChannels.includes(ch._id) ? "border-primary/50 bg-primary/10 text-primary" : "border-white/10 bg-white/5 text-muted-foreground hover:border-white/25")}>
                        <input type="checkbox" className="accent-[var(--primary)]" checked={selectedChannels.includes(ch._id)} onChange={(e) => setSelectedChannels((p) => e.target.checked ? [...p, ch._id] : p.filter((id) => id !== ch._id))} />
                        {ch.name}
                      </label>
                    ))}
                  </div>
                  <Button onClick={() => void handleBroadcast()} disabled={broadcasting} className="mt-4 h-10 cursor-pointer rounded-xl">
                    {broadcasting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send broadcast
                  </Button>
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">broadcast history</p>
                  <div className="mt-3 flex flex-col gap-2">
                    {(broadcastLog ?? []).length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">Nothing broadcast yet.</p>
                    ) : (broadcastLog ?? []).map((e) => (
                      <div key={e._id} className="rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm">{e.message}</p>
                          <Badge className={cn("shrink-0 font-mono text-[9px]", e.status === "sent" ? "bg-emerald-400/10 text-emerald-300" : "bg-rose-400/10 text-rose-300")}>{e.status}</Badge>
                        </div>
                        <p className="mt-1 font-mono text-[10px] text-muted-foreground">{e.channels.join(", ")} · {relativeTime(e.sentAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ══════ SYSTEM ══════ */}
            {tab === "system" && (
              <div className="flex min-w-0 flex-col gap-4">
                <div className="glass-panel rounded-2xl p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight"><Github className="size-4" /> GitHub connection</h2>
                      <p className="text-sm text-muted-foreground">Live check of the GITHUB_TOKEN used by the platform's GitHub sync.</p>
                    </div>
                    <Button variant="outline" size="sm" className="cursor-pointer rounded-lg bg-white/5" onClick={() => void runGithubCheck()} disabled={checkingGithub}>
                      {checkingGithub ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Re-check
                    </Button>
                  </div>
                  {checkingGithub && githubStatus === null ? (
                    <div className="mt-4 flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking GitHub…</div>
                  ) : !githubStatus ? (
                    <p className="mt-4 py-6 text-sm text-muted-foreground">Click re-check to test the token.</p>
                  ) : !githubStatus.configured ? (
                    <div className="mt-4 rounded-xl bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-200">{githubStatus.error}</div>
                  ) : !githubStatus.valid ? (
                    <div className="mt-4 rounded-xl bg-rose-400/10 px-4 py-3 text-sm leading-6 text-rose-200">{githubStatus.error}</div>
                  ) : (
                    <div className="mt-4">
                      <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="size-4 text-emerald-300" /> Connected as <span className="font-mono font-bold">@{githubStatus.login}</span></p>
                      {githubStatus.repos.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {githubStatus.repos.map((r) => (
                            <Badge key={r.fullName} variant="outline" className="gap-1 font-mono text-[10px] text-muted-foreground">
                              {r.private ? <Lock className="size-3 text-emerald-300" /> : <Globe className="size-3 text-amber-300" />} {r.fullName}
                            </Badge>
                          ))}
                        </div>
                      )}
                      <p className="mt-2 font-mono text-[10px] text-muted-foreground">token scope: repo access · {githubStatus.repos.length} repos visible</p>
                    </div>
                  )}
                </div>
                <div className="glass-panel rounded-2xl p-5">
                  <div>
                    <h2 className="text-lg font-extrabold tracking-tight">System status</h2>
                    <p className="text-sm text-muted-foreground">Read-only view of which keys are configured. Add or fix them in the Keys tab.</p>
                  </div>
                  <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
                    {system?.keys.map((k) => (
                      <div key={k.key} className="flex items-center justify-between rounded-xl bg-white/4 px-3.5 py-2.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{k.key}</span>
                        {k.configured ? (
                          <span className="flex items-center gap-1.5 font-mono text-[10px] text-emerald-300"><CheckCircle2 className="size-3.5" /> configured</span>
                        ) : (
                          <span className="flex items-center gap-1.5 font-mono text-[10px] text-amber-300"><AlertTriangle className="size-3.5" /> missing</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {system?.convexUrl && <p className="mt-4 truncate font-mono text-[10px] text-muted-foreground">convex url: {system.convexUrl}</p>}
                </div>
              </div>
            )}

        {/* ══════ AUDIT LOG ══════ */}
        {tab === "audit" && <AdminAuditLogSection />}

        {/* ══════ EXAM ENGINE (digital past-paper QC) ══════ */}
        {tab === "examengine" && (
          <Suspense fallback={<SectionFallback />}>
            <ExamEngineAdmin />
          </Suspense>
        )}

        {/* ══════ MATRIC OS (non-AI exam engine ops) ══════ */}
        {tab === "matric" && (
          <Suspense fallback={<SectionFallback />}>
            <MatricAdmin />
          </Suspense>
        )}
      </AdminShell>
    </DashboardShell>
  );
}
