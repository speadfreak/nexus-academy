import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Loader2,
  Map,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useMemo, useState } from "react";
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

  const handleGenerate = async () => {
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
        // The student picked a subject and reached for a real study tool —
        // surface the premium value at that exact moment, dismissibly.
        setPlanPromptOpen(true);
      } else {
        toast.error(errorMessage(error, "Could not generate the plan."));
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleWeek = async (week: number) => {
    if (!plan) return;
    try {
      await markWeekComplete({ planId: plan._id as never, week });
    } catch (error) {
      toast.error(errorMessage(error, "Could not update the week."));
    }
  };

  const progress =
    plan && plan.totalWeeks > 0 ? Math.round((plan.completedWeeks.length / plan.totalWeeks) * 100) : 0;

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            // ai study plans
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grok sequences your subject&apos;s syllabus into a week-by-week plan, exam-critical
            topics first.
          </p>
        </div>

        {/* Subject picker */}
        <div className="glass-panel flex flex-wrap items-end gap-3 rounded-2xl p-4">
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Subject</span>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="h-10 rounded-xl bg-white/5 font-mono text-sm">
                <SelectValue placeholder="Pick a subject…" />
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
            <span className="text-[11px] font-semibold text-muted-foreground">
              Target exam date <span className="text-muted-foreground/60">(optional)</span>
            </span>
            <Input
              type="date"
              value={targetExamDate}
              onChange={(e) => setTargetExamDate(e.target.value)}
              className="h-10 rounded-xl bg-white/5 font-mono text-sm"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Button
              className="h-10 rounded-xl"
              onClick={handleGenerate}
              disabled={!subjectId || generating}
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : entitlements && !entitlements.premiumAccess ? (
                <Lock className="size-4 text-premium" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {plan ? "Regenerate plan" : "Generate plan"}
            </Button>
            {entitlements && !entitlements.premiumAccess && (
              <span className="self-end rounded-md border border-premium/30 bg-premium/8 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-premium">
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Map className="size-6" />
              </div>
              <h3 className="mt-4 font-bold tracking-tight">Pick a subject to begin</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CalendarClock className="size-6" />
              </div>
              <h3 className="mt-4 font-bold tracking-tight">No plan for {selectedSubject?.name} yet</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Hit “Generate plan” and the AI will map the syllabus into 4–8 focused weeks,
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
              {/* Progress */}
              <div className="glass-panel rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Map className="size-4 text-primary" />
                    <p className="text-sm font-bold tracking-tight">
                      {plan.subjectName} — {plan.totalWeeks} weeks
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {plan.completedWeeks.length}/{plan.totalWeeks} complete · {progress}%
                  </span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-sky-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                  />
                </div>
                <div className="mt-2.5 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                  <span>
                    generated {relativeTime(plan.generatedAt)}
                    {plan.targetExamDate
                      ? ` · target ${new Date(plan.targetExamDate).toLocaleDateString()}`
                      : ""}
                  </span>
                  <span>{plan.isActive ? "active plan" : "archived"}</span>
                </div>
              </div>

              {/* Weekly cards */}
              {plan.weeks.map((week: { week: number; topics: Array<{ id: string; name: string }>; days: string[] }, index: number) => {
                const done = plan.completedWeeks.includes(week.week);
                return (
                  <motion.div
                    key={week.week}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    className={cn(
                      "glass-panel flex items-start gap-4 rounded-2xl p-4 transition-colors",
                      done && "opacity-70",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleWeek(week.week)}
                      aria-label={`Toggle week ${week.week}`}
                      className={cn(
                        "mt-0.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border transition-colors",
                        done
                          ? "border-primary/50 bg-primary/15 text-primary"
                          : "border-white/15 bg-white/4 text-muted-foreground hover:border-primary/40 hover:text-primary",
                      )}
                    >
                      {done ? <Check className="size-4" /> : <Circle className="size-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.15em] text-primary">
                          week {week.week}
                        </span>
                        <Badge className="bg-white/5 font-mono text-[10px] text-muted-foreground">
                          {week.focusHours}h focus
                        </Badge>
                        {done && (
                          <Badge className="gap-1 bg-emerald-400/10 font-mono text-[10px] text-emerald-300">
                            <CheckCircle2 className="size-3" /> done
                          </Badge>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {week.topics.length === 0 ? (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            topics pending syllabus mapping
                          </span>
                        ) : (
                          week.topics.map((topic: { id: string; name: string }) => (
                            <span
                              key={topic.id}
                              className="glass-chip rounded-md px-2 py-0.5 text-[11px] text-muted-foreground"
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
            </motion.div>
          )}
        </AnimatePresence>

        {plan && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl bg-white/5"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RotateCcw className="size-3.5" />
              )}
              Regenerate plan
            </Button>
            <p className="font-mono text-[10px] text-muted-foreground">
              Regenerating keeps your progress? No — a new plan resets completed weeks.
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
