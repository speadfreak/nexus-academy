// /coverage — public coverage map. No auth required.
//
// Shows EXACTLY what's in the library: every subject × every grade × every
// content type, with real counts. Filled cells = coverage, dimmed cells =
// gaps. Honest data — no inflating numbers.
//
// Linked from the Landing page nav as "See exactly what's inside" — this
// is a trust-building page, not a marketing trick. A prospective student
// can see the real state of the library before signing up.
//
// Design: matches the premium dark/gold system used across the app.
//   - Subjects grouped by stream (Natural Science · Social Science · Shared)
//   - Filterable by stream + content type (client-side; the matrix is
//     shipped whole so no extra round-trip on filter change)
//   - Each cell shows the real count; well-covered cells glow, gap cells
//     are visibly dim. Hover reveals exact numbers + labels.
//   - Footer: marginal totals (by grade, by content type, grand total)

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Grid3x3,
  Library,
  Lock,
  Layers,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  STREAM_LABELS,
  type ContentType,
} from "@/convex/constants";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

// ── Helpers ────────────────────────────────────────────────────────────

function coverageTone(count: number): {
  cell: string;
  number: string;
  ring: string;
  glow: boolean;
} {
  if (count === 0) {
    return {
      cell: "bg-white/[0.015] border-white/[0.04]",
      number: "text-muted-foreground/30",
      ring: "",
      glow: false,
    };
  }
  if (count === 1) {
    return {
      cell: "bg-amber-400/[0.06] border-amber-400/20",
      number: "text-amber-200/80",
      ring: "",
      glow: false,
    };
  }
  if (count <= 3) {
    return {
      cell: "bg-amber-400/[0.1] border-amber-400/30",
      number: "text-amber-200",
      ring: "",
      glow: false,
    };
  }
  if (count <= 8) {
    return {
      cell: "bg-amber-400/[0.16] border-amber-400/40",
      number: "text-amber-100",
      ring: "ring-1 ring-amber-400/30",
      glow: true,
    };
  }
  // 9+
  return {
    cell: "bg-gradient-to-br from-amber-400/25 to-amber-500/10 border-amber-400/50",
    number: "text-amber-50",
    ring: "ring-1 ring-amber-400/50",
    glow: true,
  };
}

// ── Page component ─────────────────────────────────────────────────────

export default function Coverage() {
  const matrixQuery = useQuery(api.coverage.getCoverageMatrix);
  const [streamFilter, setStreamFilter] = useState<"all" | "natural" | "social" | "common">("all");
  const [contentTypeFilter, setContentTypeFilter] = useState<"all" | ContentType>(CONTENT_TYPES[0] as ContentType);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  const matrix = matrixQuery;

  const grandTotal = matrix?.totals.grandTotal ?? 0;
  const hasCoverage = grandTotal > 0;

  return (
    <div className="relative mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
      {/* Ambient glows — same warm/gold language as the rest of the app */}
      <div className="pointer-events-none fixed -top-20 -right-20 size-96 rounded-full bg-amber-400/[0.06] blur-[120px]" />
      <div className="pointer-events-none fixed -bottom-20 -left-20 size-96 rounded-full bg-amber-400/[0.04] blur-[120px]" />

      {/* ── Nav (minimal — links back to landing) ── */}
      <header className="relative mb-8 flex items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <Library className="size-4.5" />
          </div>
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // learnyx academy
            </p>
            <p className="text-sm font-bold">Coverage map</p>
          </div>
        </Link>
        <Button asChild size="sm" variant="outline" className="rounded-xl bg-white/5">
          <Link to="/">
            Back home <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </header>

      {/* ── Hero ── */}
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-amber-400/[0.04] via-white/[0.01] to-transparent p-6 sm:p-8"
      >
        <div className="pointer-events-none absolute -top-16 -right-12 size-64 rounded-full bg-amber-400/[0.1] blur-[80px]" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1">
            <Sparkles className="size-3.5 text-amber-300" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              honest coverage · no inflation
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
            See <span className="text-gradient">exactly</span> what&apos;s inside
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Every subject. Every grade. Every content type. This is the real
            state of our library — filled cells mean we have it, dimmed cells
            are gaps we&apos;re working to fill. No inflating numbers, no
            hidden counts.
          </p>

          {/* Quick stats */}
          {matrix && (
            <div className="mt-6 flex flex-wrap gap-3">
              <QuickStat
                icon={<Library className="size-4" />}
                value={grandTotal}
                label="total resources"
              />
              <QuickStat
                icon={<BookOpen className="size-4" />}
                value={matrix.subjects.length}
                label="subjects"
              />
              <QuickStat
                icon={<Layers className="size-4" />}
                value={matrix.grades.length * matrix.contentTypes.length * matrix.subjects.length}
                label="cells"
              />
              <QuickStat
                icon={<CheckCircle2 className="size-4" />}
                value={
                  matrix.cells.filter((c) => c.count > 0).length
                }
                label="filled"
                tone="emerald"
              />
            </div>
          )}
        </div>
      </motion.section>

      {/* ── Filters ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 sm:p-4"
      >
        <div className="flex items-center gap-2">
          <Grid3x3 className="size-4 text-muted-foreground" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            filters
          </span>
        </div>

        {/* Stream filter */}
        <div className="flex flex-wrap gap-1.5">
          {(["all", "natural", "social", "common"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStreamFilter(s)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
                streamFilter === s
                  ? "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30"
                  : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              {s === "all" ? "All streams" : STREAM_LABELS[s]}
            </button>
          ))}
        </div>

        <div className="hidden h-6 w-px bg-white/[0.06] sm:block" />

        {/* Content type filter */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setContentTypeFilter("all")}
            className={cn(
              "cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
              contentTypeFilter === "all"
                ? "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30"
                : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
            )}
          >
            All types
          </button>
          {CONTENT_TYPES.map((ct) => (
            <button
              key={ct}
              onClick={() => setContentTypeFilter(ct as ContentType)}
              className={cn(
                "cursor-pointer rounded-lg px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
                contentTypeFilter === ct
                  ? "bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30"
                  : "bg-white/[0.03] text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
              )}
            >
              {CONTENT_TYPE_LABELS[ct as ContentType]}
            </button>
          ))}
        </div>
      </motion.div>

      {/* ── Matrix ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="mt-6"
      >
        {matrix === undefined ? (
          <CoverageSkeleton />
        ) : !hasCoverage ? (
          <EmptyCoverage />
        ) : (
          <CoverageMatrixView
            matrix={matrix}
            streamFilter={streamFilter}
            contentTypeFilter={contentTypeFilter}
            hoveredCell={hoveredCell}
            setHoveredCell={setHoveredCell}
          />
        )}
      </motion.div>

      {/* ── Footer: marginal totals ── */}
      {matrix && hasCoverage && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 grid gap-4 sm:grid-cols-3"
        >
          <TotalsCard
            title="By grade"
            icon={<TrendingUp className="size-4" />}
            rows={matrix.grades.map((g) => ({
              label: `Grade ${g}`,
              value: matrix.totals.byGrade[g] ?? 0,
            }))}
          />
          <TotalsCard
            title="By content type"
            icon={<Layers className="size-4" />}
            rows={CONTENT_TYPES.map((ct) => ({
              label: CONTENT_TYPE_LABELS[ct as ContentType],
              value: matrix.totals.byContentType[ct as ContentType] ?? 0,
            }))}
          />
          <TotalsCard
            title="By stream"
            icon={<BookOpen className="size-4" />}
            rows={(["natural", "social", "common"] as const).map((s) => ({
              label: STREAM_LABELS[s],
              value: matrix.subjects
                .filter((sub) => sub.stream === s)
                .reduce((sum, sub) => sum + (matrix.totals.bySubject[sub._id] ?? 0), 0),
            }))}
          />
        </motion.div>
      )}

      {/* ── Premium note ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, delay: 0.36, ease: [0.22, 1, 0.36, 1] }}
        className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/[0.03] p-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <Lock className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Some resources are premium
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Free trial gives you 14 active days to explore everything — keep
              your account, cancel anytime.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="rounded-xl">
          <Link to="/auth?returnTo=%2Fdashboard">
            Start free trial <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </motion.div>
    </div>
  );
}

// ── CoverageMatrixView — extracted so TypeScript can prove matrix is
//    defined inside the .map() callbacks. The parent only renders this
//    when matrix !== undefined, so the prop type is the non-undefined
//    variant. ─────────────────────────────────────────────────────────

type CoverageMatrixData = NonNullable<ReturnType<typeof useQuery<typeof api.coverage.getCoverageMatrix>>>;

function CoverageMatrixView({
  matrix,
  streamFilter,
  contentTypeFilter,
  hoveredCell,
  setHoveredCell,
}: {
  matrix: CoverageMatrixData;
  streamFilter: "all" | "natural" | "social" | "common";
  contentTypeFilter: "all" | ContentType;
  hoveredCell: string | null;
  setHoveredCell: (id: string | null) => void;
}) {
  // Group subjects by stream (respecting the filter).
  const subjectsByStream = useMemo(() => {
    const map = new Map<string, typeof matrix.subjects>();
    for (const subject of matrix.subjects) {
      if (streamFilter !== "all" && subject.stream !== streamFilter) continue;
      if (!map.has(subject.stream)) map.set(subject.stream, []);
      map.get(subject.stream)!.push(subject);
    }
    return map;
  }, [matrix, streamFilter]);

  // Cell lookup: `${subjectId}:${grade}:${contentType}` -> count.
  const cellMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const cell of matrix.cells) {
      m.set(`${cell.subjectId}:${cell.grade}:${cell.contentType}`, cell.count);
    }
    return m;
  }, [matrix]);

  const getCount = (subjectId: string, grade: number): number => {
    if (contentTypeFilter === "all") {
      let total = 0;
      for (const ct of CONTENT_TYPES) {
        total += cellMap.get(`${subjectId}:${grade}:${ct}`) ?? 0;
      }
      return total;
    }
    return cellMap.get(`${subjectId}:${grade}:${contentTypeFilter}`) ?? 0;
  };

  return (
    <div className="flex flex-col gap-6">
      {[...subjectsByStream.entries()].map(([stream, subjects], streamIdx) => {
        const streamTotal = subjects.reduce(
          (sum, s) => sum + (matrix.totals.bySubject[s._id] ?? 0),
          0,
        );
        return (
          <motion.div
            key={stream}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.2 + streamIdx * 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel rounded-3xl p-5 sm:p-6"
          >
            {/* Stream header */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                  <BookOpen className="size-4" />
                </div>
                <div>
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                    {STREAM_LABELS[stream as keyof typeof STREAM_LABELS] ?? stream}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {subjects.length} subject{subjects.length === 1 ? "" : "s"} ·{" "}
                    {streamTotal} resource{streamTotal === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </div>

            {/* Matrix grid — grades as columns, subjects as rows */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-transparent p-2 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Subject
                    </th>
                    {matrix.grades.map((grade) => (
                      <th
                        key={grade}
                        className="p-2 text-center font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground"
                      >
                        G{grade}
                      </th>
                    ))}
                    <th className="p-2 text-right font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {subjects.map((subject, rowIdx) => {
                    const rowTotal = matrix.totals.bySubject[subject._id] ?? 0;
                    return (
                      <tr key={subject._id} className="group">
                        <td className="sticky left-0 z-10 bg-transparent p-2">
                          <div className="flex items-center gap-2">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 font-mono text-[11px] font-bold text-amber-300">
                              {subject.name[0]?.toUpperCase() ?? "?"}
                            </div>
                            <span className="truncate text-sm font-semibold text-foreground">
                              {subject.name}
                            </span>
                          </div>
                        </td>
                        {matrix.grades.map((grade) => {
                          const count = getCount(subject._id, grade);
                          const tone = coverageTone(count);
                          const cellKey = `${subject._id}:${grade}`;
                          const isHovered = hoveredCell === cellKey;
                          return (
                            <td key={grade} className="p-1.5">
                              <motion.div
                                initial={{ opacity: 0, scale: 0.9 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.25, delay: rowIdx * 0.02 }}
                                onMouseEnter={() => setHoveredCell(cellKey)}
                                onMouseLeave={() => setHoveredCell(null)}
                                className={cn(
                                  "relative flex h-12 w-12 cursor-default items-center justify-center rounded-xl border font-mono text-sm font-bold tabular-nums transition-all sm:h-14 sm:w-14",
                                  tone.cell,
                                  tone.number,
                                  tone.ring,
                                  tone.glow && "shadow-[0_0_16px_-4px_rgb(251,191,36/0.4)]",
                                  isHovered && "scale-110 ring-2 ring-amber-400/50",
                                )}
                                title={
                                  count === 0
                                    ? `${subject.name} · Grade ${grade} · ${contentTypeFilter === "all" ? "all types" : CONTENT_TYPE_LABELS[contentTypeFilter]} — gap (nothing here yet)`
                                    : `${subject.name} · Grade ${grade} · ${count} ${contentTypeFilter === "all" ? "resource" : CONTENT_TYPE_LABELS[contentTypeFilter] + (count === 1 ? "" : "s")}`
                                }
                              >
                                {count === 0 ? (
                                  <span className="text-xs">—</span>
                                ) : (
                                  count
                                )}
                              </motion.div>
                            </td>
                          );
                        })}
                        <td className="p-2 text-right">
                          <span className="font-mono text-sm font-bold tabular-nums text-foreground">
                            {rowTotal}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────

function QuickStat({
  icon,
  value,
  label,
  tone = "default",
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  tone?: "default" | "emerald";
}) {
  return (
    <div
      className={cn(
        "glass-chip flex items-center gap-2.5 rounded-xl px-3 py-2",
        tone === "emerald" && "bg-emerald-400/[0.08] border-emerald-400/20",
      )}
    >
      <span className={cn(tone === "emerald" ? "text-emerald-300" : "text-amber-300")}>
        {icon}
      </span>
      <div>
        <p
          className={cn(
            "font-mono text-lg font-bold tabular-nums",
            tone === "emerald" ? "text-emerald-300" : "text-foreground",
          )}
        >
          {value}
        </p>
        <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
          {label}
        </p>
      </div>
    </div>
  );
}

function TotalsCard({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex items-center gap-2">
        <div className="flex size-7 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
          {icon}
        </div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {title}
        </p>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-1.5"
          >
            <span className="truncate text-xs font-medium text-muted-foreground">
              {row.label}
            </span>
            <span className="font-mono text-sm font-bold tabular-nums text-foreground">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoverageSkeleton() {
  return (
    <div className="glass-panel rounded-3xl p-5 sm:p-6">
      <div className="mb-4 h-8 w-40 animate-pulse rounded-xl bg-white/5" />
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-2">
            <div className="h-12 w-32 animate-pulse rounded-xl bg-white/5 sm:w-40" />
            {[0, 1, 2, 3].map((j) => (
              <div
                key={j}
                className="h-12 w-12 animate-pulse rounded-xl bg-white/5 sm:w-14"
                style={{ animationDelay: `${(i * 4 + j) * 30}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyCoverage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-soft flex flex-col items-center rounded-3xl px-6 py-16 text-center"
    >
      <div className="relative">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-400/[0.08] text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.6)]">
          <Library className="size-7" />
        </div>
        <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_12px_-4px_rgb(245_197_66/0.8)]">
          <Sparkles className="size-3" />
        </div>
      </div>
      <h3 className="mt-6 text-xl font-extrabold tracking-tight">
        Library is being curated
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        We&apos;re still uploading our first batch of textbooks, past exams,
        and worksheets. Check back soon — new resources land every week.
      </p>
      <Button asChild size="sm" className="mt-6 rounded-xl">
        <Link to="/">
          Back to home <ArrowRight className="size-3.5" />
        </Link>
      </Button>
    </motion.div>
  );
}
