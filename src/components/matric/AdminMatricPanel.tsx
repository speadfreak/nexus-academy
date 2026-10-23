// MATRIC OS — Admin Operations Panel (Phase 8).
//
// Lives at the bottom of the Matric OS hub, visible only to admins
// (moderator+). Covers the operational surface the rebuild spec asks for:
//   - Question bank overview + per-subject coverage
//   - Seed starter bank (one click, idempotent)
//   - Vault sync loop from past papers (batched until done)
//   - OS feature flag (fall back to the legacy AI engine)
//   - Failed/stale session diagnostics + invalidate + regrade (audited)

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function AdminMatricPanel() {
  const overview = useQuery(api.matricVault.getAdminOverview, {});
  const seedBank = useMutation(api.matricVault.seedStarterBank);
  const syncBatch = useMutation(api.matricVault.syncVaultBatch);
  const setOsEnabled = useMutation(api.matricVault.setOsEnabled);
  const invalidate = useMutation(api.matricVault.adminInvalidateSession);
  const regrade = useMutation(api.matricVault.adminRegradeSession);

  const [open, setOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);

  const runSeed = async () => {
    setSeeding(true);
    try {
      const res = await seedBank({});
      toast.success(`Starter bank imported: ${res.imported} new, ${res.updated} refreshed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Seed import failed.");
    } finally {
      setSeeding(false);
    }
  };

  const runSyncLoop = async () => {
    setSyncing(true);
    try {
      let done = false;
      let batches = 0;
      while (!done && batches < 200) {
        const res: { processed: number; cursor: number; total: number; done: boolean } =
          await syncBatch({});
        batches++;
        setSyncProgress(`${res.cursor}/${res.total} papers synced`);
        done = res.done;
      }
      toast.success("Vault sync complete — coverage updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Vault sync failed.");
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  };

  const perSubject = Object.entries((overview?.perSubject ?? {}) as Record<string, {
    verified: number;
    verifiedFree: number;
    verifiedPremium: number;
    unverified: number;
    seedCount: number;
    paperCount: number;
  }>).sort((a, b) => b[1].verified - a[1].verified);

  return (
    <section className="rounded-2xl border bg-card">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold tracking-tight">
          <ShieldCheck className="size-4 text-primary" />
          Matric Operations
          <Badge variant="outline" className="text-[10px]">
            admin
          </Badge>
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-5 border-t px-5 py-4">
          {overview === undefined ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Coverage */}
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Question vault
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    bank v{overview.bankVersion} · {overview.vaultRows} rows · {overview.papersCount} papers ·{" "}
                    {overview.totalVerified} verified
                  </p>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {perSubject.map(([slug, c]) => (
                    <div key={slug} className="rounded-lg border px-2.5 py-1.5 text-xs">
                      <p className="truncate font-medium capitalize">{slug.replace(/-/g, " ")}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        ✓{c.verified}
                        {c.verifiedPremium > 0 ? ` (${c.verifiedPremium} premium)` : ""} · ?{c.unverified}
                        {c.seedCount > 0 ? ` · seed ${c.seedCount}` : ""}
                      </p>
                    </div>
                  ))}
                  {perSubject.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Vault is empty — run the seed import below to boot the engine.
                    </p>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="cursor-pointer" onClick={runSeed} disabled={seeding || syncing}>
                  {seeding ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  Seed starter bank
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="cursor-pointer"
                  onClick={runSyncLoop}
                  disabled={seeding || syncing}
                >
                  {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                  Sync vault from past papers
                </Button>
                {syncProgress && (
                  <span className="self-center font-mono text-[11px] text-muted-foreground">{syncProgress}</span>
                )}
              </div>

              {/* Flag */}
              <div className="flex items-center justify-between rounded-xl border px-3 py-2.5">
                <div>
                  <p className="text-xs font-semibold">Matric OS enabled</p>
                  <p className="text-[11px] text-muted-foreground">
                    Off = /mock-exam falls back to the legacy AI engine (kept for rollback).
                  </p>
                </div>
                <Switch
                  checked={overview.osEnabled}
                  onCheckedChange={(v) => {
                    setOsEnabled({ enabled: v })
                      .then(() => toast.success(`Matric OS ${v ? "enabled" : "disabled"}.`))
                      .catch((e: unknown) =>
                        toast.error(e instanceof Error ? e.message : "Could not update flag."),
                      );
                  }}
                />
              </div>

              {/* Session diagnostics */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Session diagnostics
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {Object.entries(overview.statusCounts).map(([status, count]) => (
                    <Badge key={status} variant="outline" className="font-mono text-[10px]">
                      {status.toLowerCase()}: {count}
                    </Badge>
                  ))}
                  {Object.keys(overview.statusCounts).length === 0 && (
                    <span className="text-xs text-muted-foreground">No sessions yet.</span>
                  )}
                </div>
                <div className="mt-2 space-y-1">
                  {overview.sessions.slice(0, 10).map((s) => (
                    <div key={s._id} className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate">{s.title}</span>
                      <Badge variant="outline" className="shrink-0 font-mono text-[9px]">
                        {s.status.toLowerCase()}
                      </Badge>
                      {s.status === "GRADED" ? (
                        <>
                          <span className="shrink-0 font-mono tabular-nums">{s.totalScore ?? "—"}%</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 cursor-pointer px-2 text-[10px]"
                            onClick={() =>
                              regrade({ sessionId: s._id })
                                .then((r) =>
                                  toast.success(`Regraded: ${r.totalScore}% (audit trail written).`),
                                )
                                .catch((e: unknown) =>
                                  toast.error(e instanceof Error ? e.message : "Regrade failed."),
                                )
                            }
                          >
                            regrade
                          </Button>
                        </>
                      ) : s.status === "ACTIVE" || s.status === "CREATED" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 cursor-pointer px-2 text-[10px] text-destructive"
                          onClick={() =>
                            invalidate({ sessionId: s._id, reason: "admin_invalidated" })
                              .then(() => toast.success("Session invalidated (audited)."))
                              .catch((e: unknown) =>
                                toast.error(e instanceof Error ? e.message : "Invalidate failed."),
                              )
                            }
                          >
                            invalidate
                          </Button>
                        ) : null}
                      {s.invalidationReason && (
                        <span className="hidden shrink-0 text-[10px] text-muted-foreground sm:inline">
                          {s.invalidationReason}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Database className="mt-0.5 size-3 shrink-0" />
                Every admin action here writes to the adminAuditLog — regrades never silently rewrite history.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
