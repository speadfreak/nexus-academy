// Matric OS — Admin Operations (Phase 8, Command OS section).
//
// Vault overview (REAL coverage from the import), import control with
// dry-run, duplicate detection, blueprint availability, session
// diagnostics + ingestion retries. Every operation is role-gated
// server-side (requireAdminMutation / requireAdminAction) — this UI is a
// convenience layer, never the security boundary.

import { useState, useTransition } from "react";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { SectionHeader, Panel, MetricCard, StatusBadge, EmptyState, SkeletonRows } from "@/components/admin/cmdos/kit";
import { Button } from "@/components/ui/button";
import {
  Database,
  ShieldCheck,
  RefreshCw,
  Copy,
  GraduationCap,
  Activity,
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Sparkles,
  Calculator,
} from "lucide-react";

export function MatricAdmin() {
  const overview = useQuery(api.matricAdmin.adminVaultOverview, {});
  const diagnostics = useQuery(api.matricAdmin.adminSessionDiagnostics, {});
  const duplicates = useQuery(api.matricAdmin.adminDuplicateDetection, {});
  const blueprints = useQuery(api.matricBlueprints.adminListBlueprints, {});
  const validation = useQuery(api.matricAdmin.adminValidationReport, {});

  const runImport = useAction(api.matricAdmin.adminRunVaultImport);
  const seedBank = useMutation(api.matricAdmin.adminSeedStarterBank);
  const recalcCoverage = useMutation(api.matricAdmin.adminRecalculateCoverage);
  const retryIngestion = useMutation(api.matricAdmin.adminRetryIngestion);
  const toggleBlueprint = useMutation(api.matricBlueprints.adminSetBlueprintStatus);
  const reseed = useMutation(api.matricBlueprints.adminReseedBlueprints);
  const [pending, startTransition] = useTransition();
  const [importBusy, setImportBusy] = useState<string | null>(null);

  const doImport = (mode: "full" | "incremental", dryRun: boolean) => {
    setImportBusy(`${mode}:${dryRun}`);
    startTransition(async () => {
      try {
        // adminRunVaultImport is an ACTION — useMutation handles the
        // client-side call for actions too (Convex routes by reference).
        const res = await runImport({
          dryRun,
          ...(mode === "incremental" ? { incremental: true } : {}),
        });
        toast.success(
          `Import ${dryRun ? "(dry run) " : ""}complete — ${res.papersScanned} papers, ${res.imported} imported, ${res.updated} updated, ${res.excludedUnverified} excluded (no key), ${res.errors} errors.`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Import failed.");
      } finally {
        setImportBusy(null);
      }
    });
  };

  const doSeedBank = () => {
    setImportBusy("seed");
    startTransition(async () => {
      try {
        const res = await seedBank({});
        toast.success(
          `Starter bank imported — ${res.imported} new, ${res.updated} updated, ${res.skippedUnchanged} unchanged (${res.subjectsCreated.length ? `created subjects: ${res.subjectsCreated.join(", ")}` : "no new subjects"}).`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Starter bank import failed.");
      } finally {
        setImportBusy(null);
      }
    });
  };

  const doRecalcCoverage = () => {
    setImportBusy("recalc");
    startTransition(async () => {
      try {
        const res = await recalcCoverage({});
        toast.success(`Coverage recalculated for ${res.subjects} subjects.`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Coverage recalc failed.");
      } finally {
        setImportBusy(null);
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        eyebrow="Matric OS"
        title="Non-AI examination engine"
        description="The verified question vault, blueprints, and live session operations. Zero AI in the critical path — reliability comes from the vault, not providers."
      />

      {/* ── VAULT OVERVIEW ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Exam-eligible questions"
          value={overview ? overview.totalEligible.toLocaleString() : "—"}
          icon={Database}
          tone="gold"
          loading={overview === undefined}
          sub="verified answer keys, 4-choice MCQ"
        />
        <MetricCard
          label="Admin-verified keys"
          value={overview ? overview.totalAdminVerified.toLocaleString() : "—"}
          icon={ShieldCheck}
          tone="ok"
          loading={overview === undefined}
          sub="accepted via Exam Engine QC"
        />
        <MetricCard
          label="Subjects covered"
          value={overview ? overview.subjectsCovered : "—"}
          icon={GraduationCap}
          loading={overview === undefined}
          sub="with ≥1 eligible question"
        />
        <MetricCard
          label="Duplicate groups"
          value={duplicates ? duplicates.duplicateGroups.length : "—"}
          icon={Copy}
          tone={duplicates && duplicates.duplicateGroups.length > 0 ? "warn" : "default"}
          loading={duplicates === undefined}
          sub={`scanned ${duplicates?.scanned ?? 0} vault rows`}
        />
      </div>

      {/* ── VAULT INITIALIZATION (starter bank + paper sync) ── */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Sparkles className="size-4 text-amber-300" /> Vault initialization
            </p>
            <p className="text-[11px] text-muted-foreground">
              Cold-start ops. The starter bank is 58 human-verified curriculum
              questions (labeled "Learnyx Verified Starter Bank", never as
              official ESSLCE). Paper sync materializes the vault from real
              digitized papers. Both are idempotent — safe to re-run.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={importBusy !== null || pending}
              onClick={doSeedBank}
            >
              <Sparkles className={`size-3.5 ${importBusy === "seed" ? "animate-spin" : "text-amber-300"}`} />
              Import starter bank
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={importBusy !== null || pending}
              onClick={doRecalcCoverage}
            >
              <Calculator className={`size-3.5 ${importBusy === "recalc" ? "animate-spin" : ""}`} />
              Recalculate coverage
            </Button>
          </div>
        </div>
      </Panel>

      {/* ── IMPORT CONTROL ── */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-foreground">Vault import</p>
            <p className="text-[11px] text-muted-foreground">
              Idempotent — safe to re-run any time. Dry-run reports what would
              change without writing. Incremental processes papers updated in
              the last ~26h (the cron does this daily).
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={importBusy !== null || pending}
              onClick={() => doImport("incremental", false)}
            >
              <RefreshCw className={`size-3.5 ${importBusy === "incremental:false" ? "animate-spin" : ""}`} />
              Sync recent
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={importBusy !== null || pending}
              onClick={() => doImport("full", false)}
            >
              <Database className={`size-3.5 ${importBusy === "full:false" ? "animate-spin" : ""}`} />
              Full rebuild
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={importBusy !== null || pending}
              onClick={() => doImport("full", true)}
            >
              <FlaskConical className="size-3.5" />
              Dry run
            </Button>
          </div>
        </div>

        {/* Recent runs */}
        <div className="mt-4">
          {overview === undefined ? (
            <SkeletonRows rows={3} />
          ) : overview.recentRuns.length === 0 ? (
            <EmptyState
              icon={Database}
              title="No import runs yet"
              hint="Import the starter bank above for a day-one vault, then run the first paper sync to materialize real digitized papers."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-1.5 pr-3 font-medium">Started</th>
                    <th className="py-1.5 pr-3 font-medium">Trigger</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Papers</th>
                    <th className="py-1.5 pr-3 font-medium">+New</th>
                    <th className="py-1.5 pr-3 font-medium">Updated</th>
                    <th className="py-1.5 pr-3 font-medium">Unchanged</th>
                    <th className="py-1.5 pr-3 font-medium">No-key</th>
                    <th className="py-1.5 pr-3 font-medium">Deactivated</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {overview.recentRuns.map((r) => (
                    <tr key={r._id} className="border-b border-border/30">
                      <td className="py-1.5 pr-3">
                        {new Date(r.startedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="py-1.5 pr-3">
                        {r.trigger}
                        {r.dryRun ? " · dry" : ""}
                      </td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge
                          tone={r.status === "done" ? "ok" : r.status === "failed" ? "danger" : "info"}
                        >
                          {r.status}
                        </StatusBadge>
                      </td>
                      <td className="py-1.5 pr-3">{r.papersScanned}</td>
                      <td className="py-1.5 pr-3">{r.imported}</td>
                      <td className="py-1.5 pr-3">{r.updated}</td>
                      <td className="py-1.5 pr-3">{r.skippedUnchanged}</td>
                      <td className="py-1.5 pr-3">{r.excludedUnverified}</td>
                      <td className="py-1.5 pr-3">{r.deactivated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Panel>

      {/* ── VALIDATION REPORT (why is coverage what it is) ── */}
      <Panel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <ShieldCheck className="size-4 text-muted-foreground" /> Validation report
          </p>
          {validation && validation.eligible === 0 && (
            <StatusBadge tone="warn">vault empty — run initialization above</StatusBadge>
          )}
        </div>
        {validation === undefined ? (
          <SkeletonRows rows={3} className="mt-3" />
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard
                label="Vault rows"
                value={validation.totalRows.toLocaleString()}
                icon={Database}
                sub={`${validation.active.toLocaleString()} active`}
              />
              <MetricCard
                label="Exam-eligible"
                value={validation.eligible.toLocaleString()}
                icon={CheckCircle2}
                tone="ok"
                sub="4-choice MCQ + verified key"
              />
              <MetricCard
                label="Duplicate rows"
                value={validation.duplicateRows.toLocaleString()}
                icon={Copy}
                tone={validation.duplicateRows > 0 ? "warn" : "default"}
                sub="content-hash groups (deduped at selection)"
              />
              <MetricCard
                label="Last paper sync"
                value={validation.lastRun ? validation.lastRun.status : "—"}
                icon={Activity}
                sub={
                  validation.lastRun
                    ? `${validation.lastRun.trigger}${validation.lastRun.dryRun ? " · dry" : ""} · ${validation.lastRun.papersScanned} papers`
                    : "never run"
                }
              />
            </div>
            {(validation.ineligibleReasons.noAnswerKey > 0 ||
              validation.ineligibleReasons.choicesNotFour > 0 ||
              validation.ineligibleReasons.emptyStem > 0 ||
              validation.ineligibleReasons.unverifiedTier > 0 ||
              validation.ineligibleReasons.deactivated > 0) && (
              <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] font-mono">
                {Object.entries(validation.ineligibleReasons)
                  .filter(([, v]) => v > 0)
                  .map(([k, v]) => (
                    <span key={k} className="rounded border border-border/50 px-1.5 py-0.5 text-muted-foreground">
                      {k}: {v}
                    </span>
                  ))}
              </div>
            )}
            {validation.lastRun && validation.lastRun.errors.length > 0 && (
              <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-400/[0.04] px-3 py-2">
                <p className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
                  <AlertTriangle className="size-3.5 text-rose-300" /> Import errors ({validation.lastRun.errors.length})
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
                  {validation.lastRun.errors.slice(0, 5).map((err, i) => (
                    <li key={i} className="truncate">{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Panel>

      {/* ── COVERAGE BY SUBJECT ── */}
      <Panel className="p-4">
        <p className="text-sm font-bold text-foreground">Coverage by subject</p>
        {overview === undefined ? (
          <SkeletonRows rows={5} className="mt-3" />
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <th className="py-1.5 pr-3 font-medium">Subject</th>
                  <th className="py-1.5 pr-3 font-medium">Stream</th>
                  <th className="py-1.5 pr-3 font-medium">Eligible</th>
                  <th className="py-1.5 pr-3 font-medium">Admin-verified</th>
                  <th className="py-1.5 pr-3 font-medium">Papers</th>
                  <th className="py-1.5 pr-3 font-medium">Years</th>
                  <th className="py-1.5 pr-3 font-medium">Top topics</th>
                </tr>
              </thead>
              <tbody>
                {overview.perSubject.map((s) => (
                  <tr key={s.subjectId} className="border-b border-border/30">
                    <td className="py-1.5 pr-3 font-semibold text-foreground">{s.subjectName}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{s.stream}</td>
                    <td className="py-1.5 pr-3 font-mono">{s.eligibleCount}</td>
                    <td className="py-1.5 pr-3 font-mono">{s.adminVerifiedCount}</td>
                    <td className="py-1.5 pr-3 font-mono">{s.paperCount}</td>
                    <td className="py-1.5 pr-3 font-mono">{s.yearsCount}</td>
                    <td className="max-w-[220px] truncate py-1.5 pr-3 text-muted-foreground">
                      {s.topTopics
                        .slice(0, 3)
                        .map((t) => `${t.topicText} (${t.count})`)
                        .join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ── BLUEPRINTS ── */}
      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-foreground">Blueprints</p>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await reseed({});
                  toast.success("Blueprints reseeded from live coverage.");
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Reseed failed.");
                }
              })
            }
          >
            <RefreshCw className="size-3.5" /> Reseed from coverage
          </Button>
        </div>
        {blueprints === undefined ? (
          <SkeletonRows rows={4} className="mt-3" />
        ) : blueprints.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="No blueprints seeded"
            hint="Seed runs automatically after the first vault import."
          />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {blueprints.map((b) => {
              const totalQ = b.subjects.reduce((acc, sp) => acc + sp.questionCount, 0);
              const coverageOk = b.subjects.every((sp) => sp.eligibleCount >= sp.questionCount);
              return (
                <div
                  key={b._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                      {b.title}
                      <span className="font-mono text-[10px] text-muted-foreground">v{b.version}</span>
                      {b.status === "active" ? (
                        coverageOk ? (
                          <StatusBadge tone="ok">offered</StatusBadge>
                        ) : (
                          <StatusBadge tone="warn">low coverage</StatusBadge>
                        )
                      ) : (
                        <StatusBadge tone="idle">disabled</StatusBadge>
                      )}
                    </p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">
                      {b.key} · {b.mode} · {totalQ}q · {Math.round(b.timeLimitSeconds / 60)}min ·{" "}
                      {b.subjects.length} subject(s)
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        try {
                          await toggleBlueprint({
                            blueprintId: b._id,
                            status: b.status === "active" ? "disabled" : "active",
                          });
                          toast.success(`${b.title} ${b.status === "active" ? "disabled" : "enabled"}.`);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Toggle failed.");
                        }
                      })
                    }
                  >
                    {b.status === "active" ? "Disable" : "Enable"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {/* ── SESSION DIAGNOSTICS ── */}
      <Panel className="p-4">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-bold text-foreground">
            <Activity className="size-4 text-muted-foreground" /> Session diagnostics
          </p>
          {diagnostics && (
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
              {Object.entries(diagnostics.counts).map(([k, v]) => (
                <span key={k} className="rounded border border-border/50 px-1.5 py-0.5 text-muted-foreground">
                  {k}: {v}
                </span>
              ))}
            </div>
          )}
        </div>
        {diagnostics === undefined ? (
          <SkeletonRows rows={4} className="mt-3" />
        ) : (
          <>
            {diagnostics.ingestIssues.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {diagnostics.ingestIssues.map((issue) => (
                  <div
                    key={issue.sessionId}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-400/30 bg-rose-400/[0.04] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                        <AlertTriangle className="size-3.5 text-rose-300" />
                        Ingestion {issue.ingestState} · {issue.title}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">
                        {issue.sessionId} · attempts {issue.attempts} · {issue.ingestError ?? "pending"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await retryIngestion({ sessionId: issue.sessionId });
                          toast.success("Ingestion retried.");
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Retry failed.");
                        }
                      }}
                    >
                      <RefreshCw className="size-3.5" /> Retry
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[11px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <th className="py-1.5 pr-3 font-medium">Session</th>
                    <th className="py-1.5 pr-3 font-medium">Mode</th>
                    <th className="py-1.5 pr-3 font-medium">Status</th>
                    <th className="py-1.5 pr-3 font-medium">Score</th>
                    <th className="py-1.5 pr-3 font-medium">Qs</th>
                    <th className="py-1.5 pr-3 font-medium">Ingest</th>
                    <th className="py-1.5 pr-3 font-medium">Started</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {diagnostics.rows.map((r) => (
                    <tr key={r.sessionId} className="border-b border-border/30">
                      <td className="max-w-[200px] truncate py-1.5 pr-3 font-sans">{r.title}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{r.mode}</td>
                      <td className="py-1.5 pr-3">
                        <StatusBadge
                          tone={
                            r.status === "graded"
                              ? "ok"
                              : r.status === "active"
                                ? "info"
                                : r.status === "invalidated"
                                  ? "danger"
                                  : "warn"
                          }
                        >
                          {r.status}
                        </StatusBadge>
                      </td>
                      <td className="py-1.5 pr-3">{r.scorePct !== null ? `${r.scorePct}%` : "—"}</td>
                      <td className="py-1.5 pr-3">{r.questionCount}</td>
                      <td className="py-1.5 pr-3">
                        {r.ingestState === "done" ? (
                          <CheckCircle2 className="size-3.5 text-emerald-300" />
                        ) : (
                          <span className="text-amber-300">
                            {r.ingestState}
                            {r.ingestAttempts ? ` (×${r.ingestAttempts})` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">
                        {new Date(r.startedAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      {/* ── DUPLICATES ── */}
      <Panel className="p-4">
        <p className="text-sm font-bold text-foreground">Duplicate detection</p>
        <p className="text-[11px] text-muted-foreground">
          Same stem + same options appearing across papers. Selection dedupes
          automatically; this list is for content review.
        </p>
        {duplicates === undefined ? (
          <SkeletonRows rows={3} className="mt-3" />
        ) : duplicates.duplicateGroups.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No duplicates found"
            hint={`Scanned ${duplicates.scanned} vault rows.`}
          />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {duplicates.duplicateGroups.map((g) => (
              <div key={g.duplicateKey} className="rounded-xl border border-amber-400/30 bg-amber-400/[0.04] px-3 py-2">
                <p className="flex items-center gap-2 text-[12px] font-semibold">
                  <Copy className="size-3.5 text-amber-300" />
                  {g.count} copies
                  <span className="font-mono text-[10px] font-normal text-muted-foreground">{g.duplicateKey}</span>
                </p>
                <ul className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                  {g.items.map((item) => (
                    <li key={item.vaultId} className="truncate">
                      {item.paperTitle} · Q{item.questionNumber} — {item.stem}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
