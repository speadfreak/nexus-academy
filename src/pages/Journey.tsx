// Journey — the student's analytics dashboard: hours per subject, quiz score
// trend, real topic completion per subject, and cross-subject topic
// correlations surfaced for the first time in the UI.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BookOpen,
  Brain,
  Link2,
  Loader2,
  Sparkles,
  Target,
  TrendingUp,
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
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/lib/dates";

const AXIS_COLOR = "var(--muted-foreground)";
const GRID_COLOR = "var(--border)";
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

  if (journey === undefined) {
    return (
      <DashboardShell>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
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
      <div className="flex flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            // journey
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Your journey</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Real data from your sessions, quizzes and plans — not estimates.
          </p>
        </div>

        {/* Hours per subject */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-2xl p-5"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="size-4 text-primary" />
              <p className="text-sm font-bold tracking-tight">Hours studied per subject</p>
            </div>
            <Badge className="bg-white/5 font-mono text-[10px] text-muted-foreground">
              {journey.hoursBySubject.reduce((sum, entry) => sum + entry.hours, 0).toFixed(1)} h total
            </Badge>
          </div>
          {hoursData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Log a focus session and your time-per-subject shows up here.
            </p>
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
          transition={{ delay: 0.05 }}
          className="glass-panel rounded-2xl p-5"
        >
          <div className="flex items-center gap-2">
            <TrendingUp className="size-4 text-primary" />
            <p className="text-sm font-bold tracking-tight">Quiz score trend</p>
          </div>
          {trendData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
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
        </motion.div>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Topic completion */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="glass-panel rounded-2xl p-5"
          >
            <div className="flex items-center gap-2">
              <Target className="size-4 text-primary" />
              <p className="text-sm font-bold tracking-tight">Topic completion</p>
            </div>
            {journey.topicCompletion.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No syllabus topics exist yet. Add topics and generate plans to track completion.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                {journey.topicCompletion.map((entry) => (
                  <div key={entry.subjectId}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">{entry.subjectName}</p>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {entry.completed}/{entry.total} · {entry.pct}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-sky-400"
                        style={{ width: `${entry.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Topic correlations */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="glass-panel rounded-2xl p-5"
          >
            <div className="flex items-center gap-2">
              <Link2 className="size-4 text-primary" />
              <p className="text-sm font-bold tracking-tight">Cross-subject links</p>
            </div>
            {journey.correlations.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Topics shared across subjects appear here once content is linked — the AI uses
                these to teach related concepts together.
              </p>
            ) : (
              <div className="mt-4 flex flex-col gap-2.5">
                {journey.correlations.map((correlation) => (
                  <div
                    key={correlation.topicId}
                    className="glass-soft rounded-xl px-3.5 py-3"
                  >
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Brain className="size-3.5 text-primary" />
                      {correlation.topicName}
                      <Badge className="bg-white/5 font-mono text-[9px] text-muted-foreground">
                        grade {correlation.grade}
                      </Badge>
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      appears in: {correlation.subjects.join(" · ")}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        </div>

        {/* Recent quiz history */}
        {journey.quizTrend.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-panel rounded-2xl p-5"
          >
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
              // recent attempts
            </p>
            <div className="mt-3 space-y-1.5">
              {[...journey.quizTrend].reverse().slice(0, 10).map((attempt) => (
                <div
                  key={attempt.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/4 px-3.5 py-2.5"
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-3.5 text-primary" />
                    {attempt.subjectName}
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {relativeTime(attempt.completedAt)}
                    </span>
                    <span className="font-mono text-sm font-bold tabular-nums">
                      {attempt.score}/{attempt.total} · {attempt.pct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </div>
    </DashboardShell>
  );
}
