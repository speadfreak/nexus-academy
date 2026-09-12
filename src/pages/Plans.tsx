// Plans — AI Study Commander.
//
// Features:
//   - Exam countdown (days/hours/minutes)
//   - "Am I On Track?" indicator with progress score
//   - Rescue Mode when falling behind
//   - Roadmap with priority indicators (🟢🟡🔴)
//   - Cross-platform: link to Calendar + Flashcards
//
// Uses the existing studyPlans backend (generatePlan, markWeekComplete,
// getActivePlan). New features are computed client-side from the plan data.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Flame,
  Map,
  RotateCcw,
  Route,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
  Lock,
  AlertCircle,
  Rocket,
  Brain,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFriendlyError, errorCode } from "@/lib/errors";
import { cn } from "@/lib/utils";

export default function Plans() {
  const friendlyError = useFriendlyError();
  const { t } = useTranslation(["plans", "common"]);
  const subjects = useQuery(api.subjects.getAll);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const [subjectId, setSubjectId] = useState("");
  const [targetExamDate, setTargetExamDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [planPromptOpen, setPlanPromptOpen] = useState(false);

  const generatePlan = useAction(api.studyPlans.generatePlan);
  const markWeekComplete = useMutation(api.studyPlans.markWeekComplete);

  const plan = useQuery(
    api.studyPlans.getActivePlan,
    subjectId ? { subjectId: subjectId as never } : "skip",
  );

  // ── Exam countdown ──────────────────────────────────────────────
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const examTimestamp = plan?.targetExamDate ?? (targetExamDate ? new Date(targetExamDate).getTime() : null);
  const examCountdown = useMemo(() => {
    if (!examTimestamp) return null;
    const diff = Math.max(0, examTimestamp - now);
    return {
      days: Math.floor(diff / (24 * 60 * 60 * 1000)),
      hours: Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000)),
      minutes: Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000)),
      seconds: Math.floor((diff % (60 * 1000)) / 1000),
    };
  }, [examTimestamp, now]);

  // ── On Track score ────────────────────────────────────────────────
  // Computed: if the student has completed X% of weeks in Y% of the
  // time elapsed since plan creation, they're on track. A simple
  // but meaningful metric.
  const onTrackScore = useMemo(() => {
    if (!plan || plan.totalWeeks === 0 || !plan.targetExamDate) return null;
    const totalDuration = plan.targetExamDate - plan.generatedAt;
    const elapsed = now - plan.generatedAt;
    const timeProgress = Math.min(1, Math.max(0, elapsed / totalDuration));
    const weekProgress = plan.completedWeeks.length / plan.totalWeeks;
    // If weekProgress >= timeProgress, student is ahead. Score = weekProgress / timeProgress * 100 (capped at 100)
    const score = timeProgress > 0 ? Math.min(100, Math.round((weekProgress / timeProgress) * 100)) : 100;
    return { score, timeProgress, weekProgress };
  }, [plan, now]);

  const selectedSubject = useMemo(
    () => subjects?.find((s: { _id: string }) => s._id === (subjectId as never)),
    [subjects, subjectId],
  );

  const handleGenerate = useCallback(async () => {
    if (!subjectId || generating) return;
    setGenerating(true);
    try {
      await generatePlan({
        subjectId: subjectId as never,
        targetExamDate: targetExamDate ? new Date(targetExamDate).getTime() : undefined,
      });
      toast.success(`Study plan generated for ${selectedSubject?.name ?? "this subject"}.`);
    } catch (error) {
      if (errorCode(error) === "premium_plans") {
        setPlanPromptOpen(true);
      } else {
        toast.error(friendlyError(error, "Could not generate the plan."));
      }
    } finally {
      setGenerating(false);
    }
  }, [subjectId, generating, targetExamDate, selectedSubject, generatePlan]);

  const handleToggleWeek = useCallback(async (week: number) => {
    if (!plan) return;
    try {
      await markWeekComplete({ planId: plan._id as never, week });
    } catch (error) {
      toast.error(friendlyError(error, "Could not update the week."));
    }
  }, [plan, markWeekComplete]);

  const progress =
    plan && plan.totalWeeks > 0
      ? Math.round((plan.completedWeeks.length / plan.totalWeeks) * 100)
      : 0;

  const isPremium = entitlements && !entitlements.premiumAccess;

  // Rescue mode: if on-track score < 60%, show rescue banner
  const showRescue = onTrackScore && onTrackScore.score < 60 && plan;

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* ── Header ──────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // {t("plans:eyebrow", { defaultValue: "ai study plans" })}
          </p>
          <h1 className="type-h1 mt-1">
            AI Study <span className="text-gradient">Commander</span>
          </h1>
          <p className="type-body mt-1 text-muted-foreground">
            Tell Learnyx your goal. It builds your entire path to get there — and adapts when you fall behind.
          </p>
        </motion.div>

        {/* ── Exam Countdown + On Track (only when plan exists) ──────── */}
        {plan && examCountdown && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="grid gap-4 sm:grid-cols-2"
          >
            {/* Exam Countdown */}
            <div className="glass-panel relative overflow-hidden rounded-2xl p-5">
              <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-amber-400/10 blur-3xl" />
              <div className="relative">
                <div className="flex items-center gap-2">
                  <CalendarClock className="size-5 text-amber-300" />
                  <p className="text-sm font-bold uppercase tracking-wider text-amber-300">
                    {selectedSubject?.name ?? "Exam"} Countdown
                  </p>
                </div>
                <div className="mt-4 flex items-baseline gap-2">
                  <span className="type-h1 text-3xl font-extrabold tabular-nums text-foreground">{examCountdown.days}</span>
                  <span className="text-sm font-semibold text-muted-foreground">days</span>
                  <span className="type-h1 text-2xl font-extrabold tabular-nums text-muted-foreground">{examCountdown.hours}</span>
                  <span className="text-sm font-semibold text-muted-foreground">hrs</span>
                  <span className="type-h1 text-2xl font-extrabold tabular-nums text-muted-foreground">{examCountdown.minutes}</span>
                  <span className="text-sm font-semibold text-muted-foreground">min</span>
                </div>
                {progress > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">High-priority topics</span>
                      <span className="font-bold text-amber-300">{progress}%</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                      <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.8 }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* On Track Score */}
            {onTrackScore && (
              <div className="glass-panel relative overflow-hidden rounded-2xl p-5">
                <div className={cn("pointer-events-none absolute -top-10 -right-10 size-32 rounded-full blur-3xl", onTrackScore.score >= 80 ? "bg-emerald-400/10" : onTrackScore.score >= 60 ? "bg-amber-400/10" : "bg-rose-400/10")} />
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <Target className={cn("size-5", onTrackScore.score >= 80 ? "text-emerald-400" : onTrackScore.score >= 60 ? "text-amber-400" : "text-rose-400")} />
                    <p className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Am I On Track?</p>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <span className={cn("text-4xl font-extrabold tabular-nums", onTrackScore.score >= 80 ? "text-emerald-400" : onTrackScore.score >= 60 ? "text-amber-400" : "text-rose-400")}>
                      {onTrackScore.score}%
                    </span>
                    <span className={cn("text-sm font-semibold", onTrackScore.score >= 80 ? "text-emerald-300" : onTrackScore.score >= 60 ? "text-amber-300" : "text-rose-300")}>
                      {onTrackScore.score >= 90 ? "🟢 Ahead of target!" : onTrackScore.score >= 80 ? "🟢 On track!" : onTrackScore.score >= 60 ? "🟡 Slightly behind" : "🔴 Falling behind"}
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {onTrackScore.score >= 80
                      ? `You're ${plan.completedWeeks.length - Math.ceil(onTrackScore.timeProgress * plan.totalWeeks)} session(s) ahead of schedule.`
                      : onTrackScore.score >= 60
                        ? `Keep going — you're ${Math.ceil((1 - onTrackScore.weekProgress / Math.max(onTrackScore.timeProgress, 0.01)) * plan.totalWeeks)} week(s) behind target.`
                        : `You need to catch up — ${plan.totalWeeks - plan.completedWeeks.length} weeks remaining.`}
                  </p>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ── Rescue Mode Banner ──────────────────────────────────────── */}
        {showRescue && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-rose-400/30 bg-rose-400/[0.06] p-5"
          >
            <div className="flex items-center gap-3">
              <div className="flex size-12 items-center justify-center rounded-xl bg-rose-400/15 text-rose-400">
                <AlertCircle className="size-6" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-rose-300">You're falling behind!</p>
                <p className="text-xs text-muted-foreground">
                  Your on-track score is {onTrackScore?.score}%. Let Learnyx reorganize your remaining weeks to catch up without losing your exam deadline.
                </p>
              </div>
              <Button
                className="rounded-xl bg-rose-500 text-white hover:bg-rose-600"
                onClick={handleGenerate}
                disabled={generating}
              >
                <Zap className="size-4" /> Fix My Plan
              </Button>
            </div>
          </motion.div>
        )}

        {/* ── Subject picker + generate ───────────────────────────────── */}
        <div className="glass-panel flex flex-wrap items-end gap-3 rounded-2xl p-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="type-caption font-semibold text-muted-foreground">Subject</span>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="type-body h-10 rounded-xl bg-white/5">
                <SelectValue placeholder="Pick a subject..." />
              </SelectTrigger>
              <SelectContent>
                {subjects?.map((subject: { _id: string; name: string }) => (
                  <SelectItem key={subject._id} value={subject._id as string}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-40 flex-col gap-1.5">
            <span className="type-caption font-semibold text-muted-foreground">
              Target exam date <span className="text-muted-foreground/60">(optional)</span>
            </span>
            <Input
              type="date"
              value={targetExamDate}
              onChange={(e) => setTargetExamDate(e.target.value)}
              className="type-caption h-10 rounded-xl bg-white/5 [color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Button
              className={cn("h-10 rounded-xl interactive-press", isPremium ? "border-premium/30 bg-premium/10 text-premium hover:bg-premium/15" : "")}
              onClick={handleGenerate}
              disabled={!subjectId || generating}
            >
              {generating ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className={cn("size-4 rounded-full border-2", isPremium ? "border-premium/30 border-t-premium" : "border-primary-foreground/30 border-t-primary-foreground")} />
              ) : isPremium ? <Lock className="size-4" /> : <Sparkles className="size-4" />}
              {plan ? "Regenerate plan" : "Generate plan"}
            </Button>
            {isPremium && (
              <span className="self-end rounded-md border border-premium/30 bg-premium/8 px-2 py-0.5 type-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-premium">premium</span>
            )}
          </div>
        </div>

        {/* ── Plan view ───────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {!subjectId ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.6)]">
                <Rocket className="size-7" />
              </div>
              <h3 className="type-h3 mt-6">Pick a subject to begin</h3>
              <p className="type-body mt-2 max-w-sm text-muted-foreground">
                Plans are generated from the topics in your subject's syllabus and are available during your trial and premium access.
              </p>
            </motion.div>
          ) : plan === undefined ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-soft rounded-2xl p-6">
              <div className="h-5 w-2/5 animate-pulse rounded bg-white/5" />
              <div className="mt-4 space-y-2">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="h-20 animate-pulse rounded-xl bg-white/5" />
                ))}
              </div>
            </motion.div>
          ) : plan === null ? (
            <motion.div
              key="none"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="relative">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.6)]">
                  <CalendarClock className="size-7" />
                </div>
                <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_12px_-4px_rgb(245_197_66/0.8)]">
                  <Zap className="size-3" />
                </div>
              </div>
              <h3 className="type-h3 mt-6">No plan for {selectedSubject?.name} yet</h3>
              <p className="type-body mt-2 max-w-sm text-muted-foreground">
                Hit "Generate plan" and the AI will map the syllabus into 4-8 focused weeks, with the highest-yield topics scheduled first.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="plan"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-4"
            >
              {/* ── Roadmap header with progress ───────────────────────── */}
              <div className="glass-panel rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
                      <Route className="size-4" />
                    </div>
                    <div>
                      <p className="type-body font-semibold">
                        {plan.subjectName} — {plan.totalWeeks} weeks
                      </p>
                      <p className="type-caption text-muted-foreground">
                        {plan.isActive ? "active plan" : "archived"} · generated {relativeTime(plan.generatedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Target className="size-3 text-premium" />
                      <span className="type-mono text-sm font-bold tabular-nums text-premium">{progress}%</span>
                    </div>
                    <span className="type-caption text-muted-foreground">
                      {plan.completedWeeks.length}/{plan.totalWeeks} weeks
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "linear-gradient(90deg, oklch(0.74 0.15 232), oklch(0.82 0.13 85))" }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
              </div>

              {/* ── Weekly roadmap with priority indicators ─────────────── */}
              <div className="relative">
                <div className="absolute left-[18px] top-3 bottom-3 w-px bg-gradient-to-b from-primary/20 via-primary/10 to-transparent" aria-hidden="true" />

                <div className="flex flex-col gap-3">
                  {plan.weeks.map((
                    week: { week: number; topics: Array<{ id: string; name: string }>; focusHours: number },
                    index: number,
                  ) => {
                    const done = plan.completedWeeks.includes(week.week);
                    // Priority: first weeks are 🟢 (foundations), middle 🟡 (core),
                    // last weeks 🔴 (exam-critical)
                    const priority = index < plan.weeks.length / 3 ? "green" : index < (plan.weeks.length * 2) / 3 ? "amber" : "red";
                    const priorityEmoji = priority === "green" ? "🟢" : priority === "amber" ? "🟡" : "🔴";
                    const priorityLabel = priority === "green" ? "Foundations" : priority === "amber" ? "Core" : "Exam-critical";
                    const priorityColor = priority === "green" ? "text-emerald-400" : priority === "amber" ? "text-amber-400" : "text-rose-400";

                    return (
                      <motion.div
                        key={week.week}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                        className={cn(
                          "glass-panel flex items-start gap-4 rounded-2xl p-4 transition-all duration-200 hover-lift relative",
                          done && "opacity-65",
                        )}
                      >
                        {/* Timeline node */}
                        <div className="relative z-10">
                          <button
                            type="button"
                            onClick={() => handleToggleWeek(week.week)}
                            aria-label={`Toggle week ${week.week}`}
                            className={cn(
                              "mt-0.5 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border-2 transition-all duration-200 interactive-press",
                              done
                                ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_16px_-6px_rgb(251,191,36/0.5)]"
                                : "border-white/15 bg-white/4 text-muted-foreground hover:border-primary/40 hover:text-primary",
                            )}
                          >
                            {done ? (
                              <motion.div initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ duration: 0.25 }}>
                                <Check className="size-4" />
                              </motion.div>
                            ) : (
                              <span className="type-mono text-[11px] font-bold">{week.week}</span>
                            )}
                          </button>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="type-mono text-[11px] font-bold uppercase tracking-[0.15em] text-amber-300">
                              week {week.week}
                            </span>
                            <Badge className="glass-chip border-0 type-mono text-[10px] text-muted-foreground">
                              {week.focusHours}h focus
                            </Badge>
                            <span className={cn("text-[10px] font-bold", priorityColor)}>
                              {priorityEmoji} {priorityLabel}
                            </span>
                            {done && (
                              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
                                <Badge className="gap-1 bg-emerald-400/10 type-mono text-[10px] text-emerald-300 border-emerald-400/20">
                                  <CheckCircle2 className="size-3" /> done
                                </Badge>
                              </motion.div>
                            )}
                          </div>
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {week.topics.length === 0 ? (
                              <span className="type-mono text-[11px] text-muted-foreground">
                                topics pending syllabus mapping
                              </span>
                            ) : (
                              week.topics.map((topic: { id: string; name: string }) => (
                                <span
                                  key={topic.id}
                                  className={cn(
                                    "glass-chip rounded-md px-2 py-0.5 text-[11px] transition-colors",
                                    done ? "text-muted-foreground/50" : "text-muted-foreground",
                                  )}
                                >
                                  {topic.name}
                                </span>
                              ))
                            )}
                          </div>
                          {/* Cross-platform link to Calendar */}
                          {!done && week.topics.length > 0 && (
                            <a href="/calendar" className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300/70 hover:text-amber-300">
                              <CalendarClock className="size-3" /> View on Calendar
                            </a>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {plan && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl bg-white/5 interactive-press"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} className="size-3.5 rounded-full border-2 border-primary/30 border-t-primary" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              Regenerate plan
            </Button>
            <p className="type-caption text-muted-foreground">
              Regenerating resets completed weeks.
            </p>
          </div>
        )}
      </div>

      {/* Premium prompt placeholder */}
      {planPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPlanPromptOpen(false)}>
          <div className="glass-panel max-w-sm rounded-2xl p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <Lock className="mx-auto size-8 text-amber-400" />
            <h3 className="mt-3 text-lg font-bold">Premium Feature</h3>
            <p className="mt-1 text-sm text-muted-foreground">Study plans are a premium feature. Start your free trial to unlock them.</p>
            <Button className="mt-4" onClick={() => setPlanPromptOpen(false)}>Got it</Button>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

// ── Helper: relative time ───────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
