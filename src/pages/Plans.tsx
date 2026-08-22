import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Map,
  RotateCcw,
  Sparkles,
  Zap,
  Route,
  Target,
} from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { relativeTime } from "@/lib/dates";
import { errorCode, errorMessage } from "@/lib/errors";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Plans() {
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
        toast.error(errorMessage(error, "Could not generate the plan."));
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
      toast.error(errorMessage(error, "Could not update the week."));
    }
  }, [plan, markWeekComplete]);

  const progress =
    plan && plan.totalWeeks > 0
      ? Math.round((plan.completedWeeks.length / plan.totalWeeks) * 100)
      : 0;

  const isPremium = entitlements && !entitlements.premiumAccess;

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        {/* Header */}
        <div>
          <p className="type-mono uppercase tracking-[0.22em] text-primary">
            // ai study plans
          </p>
          <h1 className="type-h1 mt-1">Plans</h1>
          <p className="type-body mt-1 text-muted-foreground">
            AI sequences your subject&apos;s syllabus into a week-by-week roadmap, exam-critical
            topics first.
          </p>
        </div>

        {/* Subject picker + generate */}
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
              Target exam date {" "}
              <span className="text-muted-foreground/60">(optional)</span>
            </span>
            <Input
              type="date"
              value={targetExamDate}
              onChange={(e) => setTargetExamDate(e.target.value)}
              className="type-caption h-10 rounded-xl bg-white/5 [color-scheme:dark]"
            />
          </div>
          <div className="flex flex-col gap-1">
            {/* Gold-accent generate button — premium feature treatment */}
            <Button
              className={cn(
                "h-10 rounded-xl interactive-press",
                isPremium
                  ? "border-premium/30 bg-premium/10 text-premium hover:bg-premium/15 shadow-[0_0_20px_-6px_rgb(245_197_66/0.5)]"
                  : "",
              )}
              onClick={handleGenerate}
              disabled={!subjectId || generating}
            >
              {generating ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className={cn(
                    "size-4 rounded-full border-2",
                    isPremium ? "border-premium/30 border-t-premium" : "border-primary-foreground/30 border-t-primary-foreground",
                  )}
                />
              ) : isPremium ? (
                <Lock className="size-4" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {plan ? "Regenerate plan" : "Generate plan"}
            </Button>
            {isPremium && (
              <span className="self-end rounded-md border border-premium/30 bg-premium/8 px-2 py-0.5 type-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-premium">
                premium
              </span>
            )}
          </div>
        </div>

        {/* Plan view */}
        <AnimatePresence mode="wait">
          {!subjectId ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/8 text-primary shadow-[0_0_40px_-12px_rgb(56_189_248/0.6)]">
                <Map className="size-7" />
              </div>
              <h3 className="type-h3 mt-6">Pick a subject to begin</h3>
              <p className="type-body mt-2 max-w-sm text-muted-foreground">
                Plans are generated from the topics in your subject&apos;s syllabus and are
                available during your trial and premium access.
              </p>
            </motion.div>
          ) : plan === undefined ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-soft rounded-2xl p-6"
            >
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
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="relative">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/8 text-primary shadow-[0_0_40px_-12px_rgb(56_189_248/0.6)]">
                  <CalendarClock className="size-7" />
                </div>
                <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_12px_-4px_rgb(245_197_66/0.8)]">
                  <Zap className="size-3" />
                </div>
              </div>
              <h3 className="type-h3 mt-6">No plan for {selectedSubject?.name} yet</h3>
              <p className="type-body mt-2 max-w-sm text-muted-foreground">
                Hit "Generate plan" and the AI will map the syllabus into 4-8 focused weeks,
                with the highest-yield topics scheduled first.
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
              {/* Progress bar — roadmap header */}
              <div className="glass-panel rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Route className="size-4" />
                    </div>
                    <div>
                      <p className="type-body font-semibold">
                        {plan.subjectName} — {plan.totalWeeks} weeks
                      </p>
                      <p className="type-caption text-muted-foreground">
                        {plan.isActive ? "active plan" : "archived"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <Target className="size-3 text-premium" />
                      <span className="type-mono text-sm font-bold tabular-nums text-premium">
                        {progress}%
                      </span>
                    </div>
                    <span className="type-caption text-muted-foreground">
                      {plan.completedWeeks.length}/{plan.totalWeeks}
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      background: "linear-gradient(90deg, oklch(0.74 0.15 232), oklch(0.82 0.13 85))",
                    }}
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between type-caption text-muted-foreground">
                  <span>
                    generated {relativeTime(plan.generatedAt)}
                    {plan.targetExamDate
                      ? ` · target ${new Date(plan.targetExamDate).toLocaleDateString()}`
                      : ""}
                  </span>
                </div>
              </div>

              {/* Weekly cards — connected timeline treatment */}
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-[18px] top-3 bottom-3 w-px bg-gradient-to-b from-primary/20 via-primary/10 to-transparent" aria-hidden="true" />

                <div className="flex flex-col gap-3">
                  {plan.weeks.map((
                    week: { week: number; topics: Array<{ id: string; name: string }>; focusHours: number },
                    index: number,
                  ) => {
                    const done = plan.completedWeeks.includes(week.week);
                    const isLast = index === plan.weeks.length - 1;
                    return (
                      <motion.div
                        key={week.week}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          duration: 0.35,
                          delay: index * 0.05,
                          ease: [0.22, 1, 0.36, 1],
                        }}
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
                                ? "border-primary/50 bg-primary/15 text-primary shadow-[0_0_16px_-6px_rgb(56_189_248/0.5)]"
                                : "border-white/15 bg-white/4 text-muted-foreground hover:border-primary/40 hover:text-primary",
                            )}
                          >
                            {done ? (
                              <motion.div
                                initial={{ scale: 0, rotate: -90 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                              >
                                <Check className="size-4" />
                              </motion.div>
                            ) : (
                              <span className="type-mono text-[11px] font-bold">{week.week}</span>
                            )}
                          </button>
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="type-mono text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
                              week {week.week}
                            </span>
                            <Badge className="glass-chip border-0 type-mono text-[10px] text-muted-foreground">
                              {week.focusHours}h focus
                            </Badge>
                            {done && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                              >
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
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="size-3.5 rounded-full border-2 border-primary/30 border-t-primary"
                />
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

      <PremiumPrompt
        open={planPromptOpen}
        onOpenChange={setPlanPromptOpen}
        reason="premium_plans"
      />
    </DashboardShell>
  );
}
