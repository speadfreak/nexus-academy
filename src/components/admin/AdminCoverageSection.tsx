// Admin Content Gap Dashboard — surfaces the same subject × grade ×
// content-type matrix as the public Coverage page, but with admin-relevant
// detail:
//   - Exact counts (not just filled/empty)
//   - A sortable/filterable "biggest gaps" list (every cell with count === 0)
//     pre-sorted by priority (stream relevance + grade relevance + content
//     type weight) so the admin sees the highest-leverage gaps first
//   - Per-stream / per-content-type / per-grade gap totals so the admin can
//     see where the library is weakest
//
// This becomes the admin's actual to-do list for future MoE upload
// sessions — turn sourcing work into a clear checklist rather than
// guesswork.
//
// Reuses the same getAdminGapDashboard query (admin-gated) which itself
// reuses the coverage-matrix computation. No duplicate data fetching.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownUp,
  BookOpen,
  CheckCircle2,
  Grid3x3,
  Layers,
  Loader2,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  STREAM_LABELS,
  type ContentType,
} from "@/convex/constants";

type SortKey = "priority" | "subject" | "grade" | "contentType";
type FilterStream = "all" | "natural" | "social" | "common";

export function AdminCoverageSection() {
  const data = useQuery(api.coverage.getAdminGapDashboard);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [streamFilter, setStreamFilter] = useState<FilterStream>("all");
  const [contentTypeFilter, setContentTypeFilter] = useState<"all" | ContentType>("all");
  const [gradeFilter, setGradeFilter] = useState<"all" | number>("all");
  const [search, setSearch] = useState("");

  const filteredGaps = useMemo(() => {
    if (!data?.gaps) return [];
    let rows = [...data.gaps];
    if (streamFilter !== "all") {
      rows = rows.filter((g) => g.subjectStream === streamFilter);
    }
    if (contentTypeFilter !== "all") {
      rows = rows.filter((g) => g.contentType === contentTypeFilter);
    }
    if (gradeFilter !== "all") {
      rows = rows.filter((g) => g.grade === gradeFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (g) =>
          g.subjectName.toLowerCase().includes(q) ||
          g.contentTypeLabel.toLowerCase().includes(q),
      );
    }
    // Sort
    rows.sort((a, b) => {
      switch (sortKey) {
        case "priority":
          return a.priority - b.priority;
        case "subject":
          return a.subjectName.localeCompare(b.subjectName) || a.grade - b.grade;
        case "grade":
          return b.grade - a.grade || a.subjectName.localeCompare(b.subjectName);
        case "contentType":
          return a.contentTypeLabel.localeCompare(b.contentTypeLabel) || a.priority - b.priority;
        default:
          return 0;
      }
    });
    return rows;
  }, [data, sortKey, streamFilter, contentTypeFilter, gradeFilter, search]);

  if (data === undefined) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (data === null) {
    return (
      <div className="glass-panel rounded-2xl p-5 text-center text-sm text-muted-foreground">
        Admin access required to view the coverage gap dashboard.
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Hero stats */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-amber-400/[0.05] via-white/[0.01] to-transparent p-5 sm:p-6"
      >
        <div className="pointer-events-none absolute -top-12 -right-10 size-40 rounded-full bg-amber-400/[0.1] blur-[60px]" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 16 }}
              className="flex size-11 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300"
              style={{ boxShadow: "0 0 24px -4px var(--primary)" }}
            >
              <Grid3x3 className="size-5" />
            </motion.div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
                // coverage gaps
              </p>
              <h2 className="text-lg font-extrabold tracking-tight">Content Gap Dashboard</h2>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              <CheckCircle2 className="size-3" /> {data.matrix.totals.grandTotal} uploaded
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/20 bg-rose-400/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-rose-300">
              <XCircle className="size-3" /> {data.gapCount} gaps
            </span>
          </div>
        </div>

        {/* Quick stats grid */}
        <div className="relative mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <GapStat
            label="Gaps by stream"
            rows={[
              { label: "Natural", value: data.gapsByStream.natural ?? 0, tone: "emerald" },
              { label: "Social", value: data.gapsByStream.social ?? 0, tone: "amber" },
              { label: "Shared", value: data.gapsByStream.common ?? 0, tone: "default" },
            ]}
          />
          <GapStat
            label="Gaps by grade"
            rows={[
              { label: "Grade 12", value: data.gapsByGrade[12] ?? 0, tone: "danger" },
              { label: "Grade 11", value: data.gapsByGrade[11] ?? 0, tone: "warning" },
              { label: "Grade 10", value: data.gapsByGrade[10] ?? 0, tone: "default" },
              { label: "Grade 9", value: data.gapsByGrade[9] ?? 0, tone: "default" },
            ]}
          />
          <GapStat
            label="Coverage %"
            rows={[
              {
                label: "Filled",
                value:
                  data.matrix.totals.grandTotal + data.gapCount > 0
                    ? Math.round(
                        (data.matrix.totals.grandTotal /
                          (data.matrix.totals.grandTotal + data.gapCount)) *
                          100,
                      )
                    : 0,
                tone: "emerald",
                suffix: "%",
              },
              {
                label: "Total cells",
                value: data.matrix.totals.grandTotal + data.gapCount,
                tone: "default",
              },
            ]}
          />
          <GapStat
            label="By content type"
            rows={CONTENT_TYPES.map((ct) => ({
              label: CONTENT_TYPE_LABELS[ct as ContentType],
              value: data.gapsByContentType[ct as ContentType] ?? 0,
              tone: "default",
            }))}
          />
        </div>
      </motion.div>

      {/* Filters + sort */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3"
      >
        <div className="flex items-center gap-2">
          <ArrowDownUp className="size-3.5 text-muted-foreground" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            sort
          </span>
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-foreground outline-none focus:border-primary/40"
        >
          <option value="priority">Priority (most urgent first)</option>
          <option value="subject">Subject A→Z</option>
          <option value="grade">Grade (12 first)</option>
          <option value="contentType">Content type A→Z</option>
        </select>

        <div className="hidden h-6 w-px bg-white/[0.06] sm:block" />

        <div className="flex flex-wrap gap-1.5">
          {(["all", "natural", "social", "common"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStreamFilter(s)}
              className={cn(
                "cursor-pointer rounded-lg px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                streamFilter === s
                  ? "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30"
                  : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              {s === "all" ? "All streams" : STREAM_LABELS[s]}
            </button>
          ))}
        </div>

        <select
          value={contentTypeFilter}
          onChange={(e) =>
            setContentTypeFilter(e.target.value === "all" ? "all" : (e.target.value as ContentType))
          }
          className="cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground outline-none focus:border-primary/40"
        >
          <option value="all">All content types</option>
          {CONTENT_TYPES.map((ct) => (
            <option key={ct} value={ct}>
              {CONTENT_TYPE_LABELS[ct as ContentType]}
            </option>
          ))}
        </select>

        <select
          value={gradeFilter === "all" ? "all" : String(gradeFilter)}
          onChange={(e) =>
            setGradeFilter(e.target.value === "all" ? "all" : Number(e.target.value))
          }
          className="cursor-pointer rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground outline-none focus:border-primary/40"
        >
          <option value="all">All grades</option>
          {[12, 11, 10, 9].map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search subject or type…"
          className="h-8 flex-1 min-w-[140px] rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/40"
        />
      </motion.div>

      {/* Gaps list */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
        className="glass-panel rounded-3xl p-5 sm:p-6"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
              <AlertTriangle className="size-4" />
            </div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                biggest gaps · sourcing checklist
              </p>
              <p className="text-xs text-muted-foreground">
                {filteredGaps.length} of {data.gapCount} shown · sorted by priority
              </p>
            </div>
          </div>
        </div>

        {filteredGaps.length === 0 ? (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] px-6 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300">
              <CheckCircle2 className="size-7" />
            </div>
            <p className="mt-4 text-base font-bold text-foreground">
              {data.gapCount === 0
                ? "Library is fully covered!"
                : "No gaps match the current filters"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.gapCount === 0
                ? "Every subject × grade × content type has at least one resource. Outstanding work."
                : "Try adjusting the filters above to see more gaps."}
            </p>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-1.5">
            {filteredGaps.slice(0, 200).map((gap, i) => (
              <motion.div
                key={`${gap.subjectId}-${gap.grade}-${gap.contentType}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(i * 0.01, 0.4) }}
                className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:border-rose-400/20 hover:bg-rose-400/[0.03]"
              >
                {/* Priority badge */}
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-xl font-mono text-xs font-bold",
                    gap.priority < 100
                      ? "bg-rose-400/15 text-rose-300"
                      : gap.priority < 200
                        ? "bg-amber-400/15 text-amber-300"
                        : "bg-white/5 text-muted-foreground",
                  )}
                  title={`Priority ${gap.priority} (lower = more urgent)`}
                >
                  {i + 1}
                </div>

                {/* Subject */}
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    {gap.subjectName}
                    <span
                      className={cn(
                        "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
                        gap.subjectStream === "natural"
                          ? "bg-emerald-400/10 text-emerald-300"
                          : gap.subjectStream === "social"
                            ? "bg-amber-400/10 text-amber-300"
                            : "bg-white/5 text-muted-foreground",
                      )}
                    >
                      {STREAM_LABELS[gap.subjectStream as keyof typeof STREAM_LABELS] ?? gap.subjectStream}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    Grade {gap.grade} · {gap.contentTypeLabel}
                  </p>
                </div>

                {/* Status */}
                <div className="shrink-0 text-right">
                  <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/20 bg-rose-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                    <XCircle className="size-2.5" /> 0 resources
                  </span>
                </div>
              </motion.div>
            ))}
            {filteredGaps.length > 200 && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                Showing first 200 of {filteredGaps.length} matching gaps. Use filters to narrow down.
              </p>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function GapStat({
  label,
  rows,
}: {
  label: string;
  rows: Array<{ label: string; value: number; tone?: string; suffix?: string }>;
}) {
  return (
    <div className="glass-soft rounded-2xl p-3">
      <p className="font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <div className="mt-2 flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-muted-foreground">{row.label}</span>
            <span
              className={cn(
                "font-mono text-xs font-bold tabular-nums",
                row.tone === "emerald"
                  ? "text-emerald-300"
                  : row.tone === "amber"
                    ? "text-amber-300"
                    : row.tone === "danger"
                      ? "text-rose-300"
                      : row.tone === "warning"
                        ? "text-amber-300"
                        : "text-foreground",
              )}
            >
              {row.value}
              {row.suffix ?? ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
