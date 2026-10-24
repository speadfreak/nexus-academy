// LEARNYX FLOWSTATE — Focus intelligence (Phase 8).
//
// Analytics built ONLY from real session data (the canonical studySessions
// table + FLOWSTATE focusSessions), aggregated server-side via
// focusSessions.getOverview. Design rules:
//
//   - Study time and demonstrated learning are shown SEPARATELY. Minutes
//     are minutes; mastery comes from quizzes, mistakes and exams. This
//     panel never conflates the two.
//   - No streak pressure: streaks are shown where they already exist, but
//     nothing here nags, guilt-trips or sends notifications.
//   - New students see an honest, warm empty state — not zeros pretending
//     to be data.

import { useMemo } from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import {
  Activity,
  CalendarDays,
  Flame,
  Target,
  TrendingUp,
  Wrench,
} from "lucide-react";
import type { FocusOverview } from "@/convex/focusSessions";
import { cn } from "@/lib/utils";

const dayLabels = ["M", "T", "W", "T", "F", "S", "S"];

/** 12-week × 7-day heatmap from overview.dailySeconds (client-local days). */
function Heatmap({ daily }: { daily: { date: string; seconds: number }[] }) {
  const cells = useMemo(() => {
    const byDate = new Map(daily.map((d) => [d.date, d.seconds]));
    // Arrange into columns of 7 (weeks), Monday-first for study rhythm.
    const out: { date: string; minutes: number }[][] = [];
    let column: { date: string; minutes: number }[] = [];
    for (const d of daily) {
      const date = new Date(d.date + "T12:00:00");
      const dow = (date.getDay() + 6) % 7; // 0 = Monday
      column.push({ date: d.date, minutes: Math.round((byDate.get(d.date) ?? 0) / 60) });
      if (column.length === 7 || dow === 6) {
        out.push(column);
        column = [];
      }
    }
    if (column.length) out.push(column);
    return out;
  }, [daily]);

  const max = Math.max(1, ...daily.map((d) => d.seconds / 60));

  const shade = (minutes: number) => {
    if (minutes <= 0) return "bg-white/[0.04]";
    const r = minutes / max;
    if (r > 0.75) return "bg-amber-400/80";
    if (r > 0.5) return "bg-amber-400/55";
    if (r > 0.25) return "bg-amber-400/30";
    return "bg-amber-400/15";
  };

  return (
    <div>
      <div className="flex gap-1">
        <div className="mr-0.5 flex flex-col justify-between py-px">
          {dayLabels.map((l, i) => (
            <span key={i} className="flex h-3.5 items-center font-mono text-[7px] text-muted-foreground/50">{l}</span>
          ))}
        </div>
        {cells.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {Array.from({ length: 7 }).map((_, di) => {
              const cell = week.find((c) => {
                const date = new Date(c.date + "T12:00:00");
                return (date.getDay() + 6) % 7 === di;
              });
              if (!cell) {
                return <span key={di} className="size-3.5 rounded-[3px]" />;
              }
              return (
                <motion.span
                  key={di}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2, delay: Math.min(wi * 0.01 + di * 0.005, 0.4) }}
                  title={`${cell.date} — ${cell.minutes} min`}
                  className={cn("size-3.5 rounded-[3px]", shade(cell.minutes))}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground/50">12 weeks</p>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[8px] text-muted-foreground/50">less</span>
          {["bg-white/[0.04]", "bg-amber-400/15", "bg-amber-400/30", "bg-amber-400/55", "bg-amber-400/80"].map((c) => (
            <span key={c} className={cn("size-2 rounded-[2px]", c)} />
          ))}
          <span className="font-mono text-[8px] text-muted-foreground/50">more</span>
        </div>
      </div>
    </div>
  );
}

export function FocusIntelligence({
  overview,
  streak,
  dailyGoal,
  todayMinutes,
}: {
  overview: FocusOverview | undefined;
  streak: { currentStreak: number; longestStreak: number } | undefined;
  dailyGoal: number;
  todayMinutes: number;
}) {
  const hasData = !!overview && (overview.totals.scannedSessions > 0 || overview.totals.totalMinutes > 0);
  const totalHours = overview ? Math.round(overview.totals.totalMinutes / 60) : 0;
  const consistency = useMemo(() => {
    if (!overview) return 0;
    const activeDays = overview.dailySeconds.filter((d) => d.seconds > 0).length;
    return Math.round((activeDays / Math.max(1, overview.dailySeconds.length)) * 100);
  }, [overview]);
  const goalPct = dailyGoal > 0 ? Math.min(100, Math.round((todayMinutes / dailyGoal) * 100)) : 0;

  // Learning signals — deliberately separate from study time.
  const missionsCompleted = overview?.missions.completed ?? 0;
  const avgSession = overview?.missions.avgCompletedSeconds
    ? Math.round(overview.missions.avgCompletedSeconds / 60)
    : 0;

  return (
    <div className="glass-panel flex flex-col gap-5 rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">// focus intelligence</p>
        <Activity className="size-4 text-muted-foreground" />
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300/50 shadow-[0_0_30px_-10px_rgb(251,191,36/0.4)]">
            <CalendarDays className="size-6" />
          </div>
          <p className="type-h3 mt-4 text-foreground/80">Your story starts with one session</p>
          <p className="type-body mt-1 max-w-xs text-muted-foreground">
            Finish your first focused session and this panel fills with your
            real study rhythm — no invented numbers, ever.
          </p>
        </div>
      ) : (
        <>
          {/* Top stats */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { icon: Flame, label: "Total", value: `${totalHours}h`, tint: "text-orange-300 bg-orange-400/10" },
              { icon: Target, label: "Missions done", value: String(missionsCompleted), tint: "text-teal-300 bg-teal-400/10" },
              { icon: TrendingUp, label: "Avg session", value: `${avgSession}m`, tint: "text-violet-300 bg-violet-400/10" },
              { icon: CalendarDays, label: "Consistency", value: `${consistency}%`, tint: "text-amber-300 bg-amber-400/10" },
            ].map((s) => (
              <div key={s.label} className="glass-soft rounded-xl px-3 py-2.5">
                <div className={cn("mb-1 flex size-6 items-center justify-center rounded-md", s.tint)}>
                  <s.icon className="size-3" />
                </div>
                <p className="type-mono text-base font-bold leading-tight">{s.value}</p>
                <p className="type-caption text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Goal + streak */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="glass-soft flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2">
              <Target className="size-3.5 shrink-0 text-amber-300" />
              <p className="type-caption min-w-0 flex-1 text-muted-foreground">
                Today's goal <span className="font-semibold text-foreground">{todayMinutes}/{dailyGoal} min</span>
              </p>
              <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/5">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400/60 to-amber-400"
                  initial={false}
                  animate={{ width: `${goalPct}%` }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </div>
            {streak && streak.currentStreak > 0 && (
              <div className="glass-soft flex items-center gap-2 rounded-xl px-3 py-2">
                <Flame className="size-3.5 text-orange-300" />
                <p className="type-caption text-muted-foreground">
                  <span className="font-semibold text-foreground">{streak.currentStreak}</span> day streak · best {streak.longestStreak}
                </p>
              </div>
            )}
          </div>

          {/* Heatmap */}
          <div>
            <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Study rhythm</p>
            <Heatmap daily={overview?.dailySeconds ?? []} />
          </div>

          {/* Subject distribution (30 days) */}
          {overview && overview.subjectDist.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">Where the time went · 30 days</p>
              <div className="space-y-1.5">
                {overview.subjectDist.slice(0, 5).map((s) => {
                  const maxSec = overview.subjectDist[0]?.seconds ?? 1;
                  const pct = Math.round((s.seconds / maxSec) * 100);
                  return (
                    <div key={s.subjectId} className="flex items-center gap-2">
                      <span className="w-24 min-w-0 shrink-0 truncate text-[11px] font-medium">{s.subjectName}</span>
                      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/5">
                        <motion.div
                          className="h-full rounded-full bg-primary/40"
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.5, ease: "easeOut" }}
                        />
                      </div>
                      <span className="w-14 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                        {Math.round(s.seconds / 60)}m
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Learning signals — SEPARATE from study time */}
          {overview && (overview.missions.avgDistractions !== null || overview.missions.reflected > 0) && (
            <div className="rounded-xl border border-teal-400/15 bg-teal-400/[0.04] px-3 py-2.5">
              <p className="mb-1 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-teal-300">
                <Wrench className="size-3" /> Learning signals
              </p>
              <p className="type-caption leading-relaxed text-muted-foreground">
                {overview.missions.reflected} session{overview.missions.reflected === 1 ? "" : "s"} reflected on
                {overview.missions.avgDistractions !== null
                  ? ` · avg ${overview.missions.avgDistractions} distractions noted`
                  : ""}
                . Study minutes measure time — real progress shows up in your
                quizzes, mistakes and exams.
              </p>
              <Link to="/mistakes" className="focus-ring mt-1.5 inline-flex items-center gap-1 rounded-sm text-[11px] font-semibold text-teal-300 hover:text-teal-200">
                Open Mistake Lab
              </Link>
            </div>
          )}
        </>
      )}
    </div>
  );
}
