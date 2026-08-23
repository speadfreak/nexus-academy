// Journey — the student's analytics dashboard: hero stats, hours per subject,
// quiz score trend, topic completion, and cross-subject correlations.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Brain,
  Clock,
  Flame,
  Link2,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { DashboardShell } from "@/components/DashboardShell";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";
import { relativeTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

const AXIS_COLOR = "var(--muted-foreground)";
const GRID_COLOR = "var(--border)";

function PremiumBlur({
  locked,
  onUnlock,
  children,
}: {
  locked: boolean;
  onUnlock: () => void;
  children: React.ReactNode;
}) {
  if (!locked) return <>{children}</>;
  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-md" aria-hidden="true">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-2xl bg-background/30 backdrop-blur-[1px]">
        <span className="flex items-center gap-1.5 rounded-full border border-premium/30 bg-premium/10 px-3 py-1 type-mono text-[10px] font-bold uppercase tracking-[0.15em] text-premium">
          <Lock className="size-3" /> premium analytics
        </span>
        <p className="type-body max-w-xs text-center text-muted-foreground">
          Your real scores and completion are tracked here — unlock the full view
          with premium.
        </p>
        <Button size="sm" className="rounded-xl interactive-press" onClick={onUnlock}>
          See what premium includes
        </Button>
      </div>
    </div>
  );
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  color: "var(--popover-foreground)",
  fontSize: 12,
  fontFamily: "JetBrains Mono, monospace",
};

export default function Journey() {
  const journey = useQuery(api.journey.getJourney);
  const [analyticsPromptOpen, setAnalyticsPromptOpen] = useState(false);

  const heroStats = useMemo(() => {
    if (!journey) return null;
    const totalHours = journey.hoursBySubject.reduce((sum, e) => sum + e.hours, 0);
    const totalQuizzes = journey.quizTrend.length;
    const avgScore = totalQuizzes > 0
      ? Math.round(journey.quizTrend.reduce((sum, e) => sum + e.pct, 0) / totalQuizzes)
      : 0;
    // Most improved: compare last 3 vs first 3 quizzes
    const sorted = [...journey.quizTrend].sort((a, b) => a.completedAt - b.completedAt);
    let mostImproved = null;
    if (sorted.length >= 4) {
      const early = sorted.slice(0, 3);
      const late = sorted.slice(-3);
      const earlyAvg = early.reduce((s, e) => s + e.pct, 0) / early.length;
      const lateAvg = late.reduce((s, e) => s + e.pct, 0) / late.length;
      const improvement = Math.round(lateAvg - earlyAvg);
      if (improvement > 0) {
        mostImproved = { subject: late[late.length - 1]?.subjectName ?? "Quiz", improvement };
      }
    }
    return { totalHours, totalQuizzes, avgScore, mostImproved };
  }, [journey]);

  if (journey === undefined) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
            className="size-5 rounded-full border-2 border-primary/30 border-t-primary"
          />
        </div>
      </DashboardShell>
    );
  }

  const hoursData = journey.hoursBySubject.map((entry) => ({
    name: entry.subjectName,
    hours: entry.hours,
  }));

  const trendData = journey.quizTrend.map((entry) => ({
    name: new Date(entry.completedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    pct: entry.pct,
    subject: entry.subjectName,
  }));

  return (
    <DashboardShell>
      <div className="relative flex flex-col gap-6">
        {/* Ambient glow behind header */}
        <div className="pointer-events-none absolute -top-12 -left-8 size-44 rounded-full bg-amber-400/8 blur-[80px]" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-8 top-4 size-36 rounded-full bg-amber-400/[0.05] blur-[64px]" aria-hidden="true" />

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // analytics · journey
          </p>
          <h1 className="type-h1 mt-1">Your journey</h1>
          <p className="type-body mt-1 text-muted-foreground">
            Real data from your sessions, quizzes and plans — not estimates.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="glass-chip flex items-center gap-1.5 rounded-lg px-2.5 py-1 type-mono text-[10px]">
              <Clock className="size-3 text-amber-300" />
              {heroStats ? `${heroStats.totalHours.toFixed(1)}h studied` : "no data"}
            </span>
            <span className="glass-chip flex items-center gap-1.5 rounded-lg px-2.5 py-1 type-mono text-[10px]">
              <Sparkles className="size-3 text-amber-300" />
              {heroStats?.totalQuizzes ?? 0} quizzes
            </span>
            {journey.premiumAccess && (
              <span className="glass-chip flex items-center gap-1.5 rounded-lg px-2.5 py-1 type-mono text-[10px] text-premium">
                <Zap className="size-3" /> premium analytics active
              </span>
            )}
          </div>
        </motion.div>

        {/* Hero stats — visual hierarchy anchors */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: "Total hours",
              value: heroStats ? `${heroStats.totalHours.toFixed(1)}` : "0",
              unit: "h",
              icon: Clock,
              accent: "text-amber-300",
              iconBg: "bg-amber-400/10",
              glow: "shadow-[0_0_24px_-8px_rgb(251,191,36/0.5)]",
            },
            {
              label: "Quizzes taken",
              value: String(heroStats?.totalQuizzes ?? 0),
              unit: "",
              icon: Sparkles,
              accent: "text-amber-300",
              iconBg: "bg-amber-400/10",
              glow: "shadow-[0_0_24px_-8px_rgb(251,191,36/0.4)]",
            },
            {
              label: "Avg. score",
              value: heroStats ? `${heroStats.avgScore}` : "—",
              unit: "%",
              icon: Target,
              accent: heroStats && heroStats.avgScore >= 70 ? "text-emerald-400" : "text-premium",
              iconBg: heroStats && heroStats.avgScore >= 70 ? "bg-emerald-400/10" : "bg-premium/10",
              glow: heroStats && heroStats.avgScore >= 70
                ? "shadow-[0_0_24px_-8px_rgb(52_211_153/0.4)]"
                : "shadow-[0_0_24px_-8px_rgb(245_197_66/0.4)]",
            },
            {
              label: heroStats?.mostImproved ? `Most improved` : "Trending",
              value: heroStats?.mostImproved
                ? `+${heroStats.mostImproved.improvement}%`
                : "—",
              unit: "",
              icon: TrendingUp,
              accent: "text-premium",
              iconBg: "bg-premium/10",
              glow: "shadow-[0_0_24px_-8px_rgb(245_197_66/0.5)]",
            },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.06 * i, ease: [0.22, 1, 0.36, 1] }}
              className="glass-panel hover-lift relative overflow-hidden flex flex-col gap-2 rounded-2xl p-4"
            >
              <div className={cn("flex size-9 items-center justify-center rounded-xl", stat.iconBg, stat.glow, stat.accent)}>
                <stat.icon className="size-4" />
              </div>
              <p className="type-caption text-muted-foreground">{stat.label}</p>
              <p className={cn("type-h2 tabular-nums", stat.accent)}>
                {stat.value}{stat.unit}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Hours per subject */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel rounded-2xl p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
                <BookOpen className="size-4" />
              </div>
              <p className="type-body font-semibold">Hours studied per subject</p>
            </div>
            <Badge className="glass-chip border-0 type-mono text-[10px] text-muted-foreground">
              {journey.hoursBySubject.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)} h total
            </Badge>
          </div>
          {hoursData.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Flame className="size-6 text-amber-300/30" />
              <p className="type-body mt-3 text-muted-foreground">
                Log a focus session and your time-per-subject shows up here.
              </p>
            </div>
          ) : (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hoursData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                    axisLine={{ stroke: GRID_COLOR }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "var(--accent)" }} />
                  <Bar dataKey="hours" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </motion.div>

        {/* Quiz trend */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel rounded-2xl p-5"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <TrendingUp className="size-4" />
            </div>
            <p className="type-body font-semibold">Quiz score trend</p>
          </div>
          <PremiumBlur
            locked={!journey.premiumAccess}
            onUnlock={() => setAnalyticsPromptOpen(true)}
          >
          {trendData.length === 0 ? (
            <p className="py-12 text-center type-body text-muted-foreground">
              Take a quiz from the library or after a focus session to start your trend line.
            </p>
          ) : (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                    axisLine={{ stroke: GRID_COLOR }}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: AXIS_COLOR, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    formatter={(value) => [`${value}%`, "accuracy"]}
                    labelFormatter={(label, payload) =>
                      payload?.[0]?.payload?.subject ? `${payload[0].payload.subject} · ${label}` : label
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="pct"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: "var(--chart-2)", strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          </PremiumBlur>
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Topic completion */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.34, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel rounded-2xl p-5"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
                <Target className="size-4" />
              </div>
              <p className="type-body font-semibold">Topic completion</p>
            </div>
            <PremiumBlur
              locked={!journey.premiumAccess}
              onUnlock={() => setAnalyticsPromptOpen(true)}
            >
            {journey.topicCompletion.length === 0 ? (
              <p className="py-12 text-center type-body text-muted-foreground">
                No syllabus topics exist yet. Add topics and generate plans to track completion.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                {journey.topicCompletion.map((entry, i) => (
                  <motion.div
                    key={entry.subjectId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div className="flex items-center justify-between">
                      <p className="type-body font-semibold">{entry.subjectName}</p>
                      <span className="type-caption text-muted-foreground">
                        {entry.completed}/{entry.total} · {entry.pct}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/5">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          background: entry.pct >= 80
                            ? "linear-gradient(90deg, oklch(0.74 0.15 232), oklch(0.82 0.13 85))"
                            : "linear-gradient(90deg, oklch(0.74 0.15 232), oklch(0.68 0.16 240))",
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${entry.pct}%` }}
                        transition={{ duration: 0.8, delay: 0.1 + 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                      />
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
            </PremiumBlur>
          </motion.div>

          {/* Topic correlations — discovery cards */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel rounded-2xl p-5"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
                <Link2 className="size-4" />
              </div>
              <p className="type-body font-semibold">Cross-subject links</p>
            </div>
            <PremiumBlur
              locked={!journey.premiumAccess}
              onUnlock={() => setAnalyticsPromptOpen(true)}
            >
            {journey.correlations.length === 0 ? (
              <p className="py-12 text-center type-body text-muted-foreground">
                Topics shared across subjects appear here once content is linked — the AI uses
                these to teach related concepts together.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-2.5">
                {journey.correlations.map((correlation, i) => (
                  <motion.div
                    key={correlation.topicId}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-soft rounded-xl px-3.5 py-3 hover-lift"
                  >
                    <p className="flex items-center gap-2 type-body font-semibold">
                      <Brain className="size-3.5 text-amber-300" />
                      {correlation.topicName}
                      <Badge className="glass-chip border-0 type-mono text-[9px] text-muted-foreground">
                        grade {correlation.grade}
                      </Badge>
                    </p>
                    <p className="mt-1.5 flex items-center gap-1.5 type-caption text-muted-foreground">
                      <Link2 className="size-3" />
                      {correlation.subjects.join(" · ")}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
            </PremiumBlur>
          </motion.div>
        </div>

        {/* Recent quiz history */}
        {journey.premiumAccess && journey.quizTrend.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="glass-panel rounded-2xl p-5"
          >
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
                <Sparkles className="size-4" />
              </div>
              <p className="type-body font-semibold">Recent quiz attempts</p>
            </div>
            <div className="mt-3 space-y-1.5">
              {[...journey.quizTrend].reverse().slice(0, 10).map((attempt, i) => (
                <motion.div
                  key={attempt.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: 0.03 * i, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/4 px-3.5 py-2.5 hover-lift"
                >
                  <p className="flex items-center gap-2 type-body font-semibold">
                    <Sparkles className="size-3.5 text-amber-300" />
                    {attempt.subjectName}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="type-caption text-muted-foreground">
                      {relativeTime(attempt.completedAt)}
                    </span>
                    <span className={cn(
                      "type-mono text-sm font-bold tabular-nums",
                      attempt.pct >= 70 ? "text-emerald-400" : attempt.pct >= 50 ? "text-premium" : "text-rose-400",
                    )}>
                      {attempt.score}/{attempt.total} · {attempt.pct}%
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <PremiumPrompt
        open={analyticsPromptOpen}
        onOpenChange={setAnalyticsPromptOpen}
        reason="premium_analytics"
      />
    </DashboardShell>
  );
}
