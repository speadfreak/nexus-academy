// LEARNYX FLOWSTATE — Study mission picker (Phase 6).
//
// Links a focus session to REAL learning objects using canonical ids:
// an open task (todos), an active study-plan week, a Mistake Lab review,
// or Matric OS exam prep. Linking records provenance only — completing a
// timer NEVER auto-completes the linked task/week or awards mastery.
// The picker renders inside a compact dialog so the Focus page stays calm.

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  BookOpenCheck,
  CheckCircle2,
  GraduationCap,
  ListTodo,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface MissionLink {
  taskId?: Id<"todos">;
  planId?: Id<"studyPlans">;
  planWeek?: number;
  /** Display snapshot stored on the session (missionLabel column). */
  label: string;
  /** Which panel the label came from — for the chip icon. */
  kind: "task" | "plan" | "mistakes" | "matric" | "custom" | null;
}

interface PlanWeekInfo {
  week: number;
  focusHours: number;
  topicNames: string[];
}

export function MissionPicker({
  open,
  onOpenChange,
  subjectId,
  current,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subjectId: string;
  current: MissionLink | null;
  onPick: (mission: MissionLink | null) => void;
}) {
  const todos = useQuery(api.todos.list, {});
  const plan = useQuery(
    api.studyPlans.getActivePlan,
    subjectId ? { subjectId: subjectId as Id<"subjects"> } : "skip",
  );

  const openTasks = useMemo(
    () => (todos ?? []).filter((t) => !t.isDone).slice(0, 6),
    [todos],
  );

  const planWeeks: PlanWeekInfo[] = useMemo(() => {
    if (!plan?.weeks) return [];
    return plan.weeks
      .map((w) => ({
        week: w.week,
        focusHours: w.focusHours,
        topicNames: (w.topics ?? []).map((t) => t.name).slice(0, 3),
      }))
      .sort((a, b) => a.week - b.week)
      .slice(0, 8);
  }, [plan]);

  const [customLabel, setCustomLabel] = useState("");

  const pick = (m: MissionLink | null) => {
    onPick(m);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-h-[80vh] overflow-y-auto rounded-2xl sm:max-w-md" data-scroll-contain>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-4 text-amber-300" /> Link a study mission
          </DialogTitle>
          <DialogDescription>
            Your timer will record what this session worked toward. It never
            auto-completes tasks or awards mastery — the work does that.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tasks */}
          <section>
            <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
              <ListTodo className="size-3" /> Open tasks
            </p>
            {todos === undefined ? (
              <p className="text-[11px] text-muted-foreground">Loading tasks…</p>
            ) : openTasks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No open tasks — add some from the Dashboard.</p>
            ) : (
              <div className="space-y-1">
                {openTasks.map((task) => (
                  <button
                    key={task._id}
                    type="button"
                    onClick={() =>
                      pick({ taskId: task._id, label: task.text, kind: "task" })
                    }
                    className={cn(
                      "focus-ring flex w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[12px] transition",
                      current?.taskId === task._id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-white/10 bg-white/[0.03] hover:border-primary/25 hover:bg-white/[0.05]",
                    )}
                  >
                    <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{task.text}</span>
                    {task.subjectName && (
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{task.subjectName}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Plan week */}
          <section>
            <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
              <BookOpenCheck className="size-3" /> Study plan week
            </p>
            {!subjectId ? (
              <p className="text-[11px] text-muted-foreground">Pick a subject first to see its active plan.</p>
            ) : plan === undefined ? (
              <p className="text-[11px] text-muted-foreground">Loading plan…</p>
            ) : planWeeks.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No active plan for this subject.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {planWeeks.map((w) => (
                  <button
                    key={w.week}
                    type="button"
                    onClick={() =>
                      pick({
                        planId: plan!._id,
                        planWeek: w.week,
                        label: `Plan week ${w.week}${w.topicNames.length ? ` — ${w.topicNames.join(", ")}` : ""}`,
                        kind: "plan",
                      })
                    }
                    className={cn(
                      "focus-ring cursor-pointer rounded-lg border px-2.5 py-2 text-left transition",
                      current?.planWeek === w.week && current?.planId === plan!._id
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-white/10 bg-white/[0.03] hover:border-primary/25 hover:bg-white/[0.05]",
                    )}
                  >
                    <p className="text-[11px] font-semibold">Week {w.week}</p>
                    <p className="truncate text-[9px] text-muted-foreground">
                      {w.topicNames.length ? w.topicNames.join(" · ") : `${w.focusHours}h focus target`}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Quick missions */}
          <section>
            <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
              <Wrench className="size-3" /> Quick missions
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => pick({ label: "Mistake Lab review", kind: "mistakes" })}
                className={cn(
                  "focus-ring cursor-pointer rounded-lg border px-2.5 py-2 text-left transition",
                  current?.kind === "mistakes"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.03] hover:border-primary/25 hover:bg-white/[0.05]",
                )}
              >
                <p className="text-[11px] font-semibold">Mistake Lab review</p>
                <p className="text-[9px] text-muted-foreground">Study time next to your open mistakes</p>
              </button>
              <button
                type="button"
                onClick={() => pick({ label: "Matric OS exam prep", kind: "matric" })}
                className={cn(
                  "focus-ring cursor-pointer rounded-lg border px-2.5 py-2 text-left transition",
                  current?.kind === "matric"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.03] hover:border-primary/25 hover:bg-white/[0.05]",
                )}
              >
                <p className="text-[11px] font-semibold">Matric OS prep</p>
                <p className="text-[9px] text-muted-foreground">Practice toward the national exam</p>
              </button>
            </div>
          </section>

          {/* Custom label */}
          <section>
            <p className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
              Or name it yourself
            </p>
            <div className="flex items-center gap-1.5">
              <Input
                type="text"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Chapter 5 — Trigonometric identities"
                maxLength={120}
                aria-label="Custom mission label"
                className="focus-ring h-8 flex-1 rounded-lg bg-white/5 text-[12px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && customLabel.trim()) {
                    pick({ label: customLabel.trim(), kind: "custom" });
                    setCustomLabel("");
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8 rounded-lg"
                disabled={!customLabel.trim()}
                onClick={() => {
                  pick({ label: customLabel.trim(), kind: "custom" });
                  setCustomLabel("");
                }}
              >
                Link
              </Button>
            </div>
          </section>
        </div>

        {current && (
          <Button
            variant="outline"
            className="w-full rounded-xl bg-white/5"
            onClick={() => pick(null)}
          >
            <X className="size-3.5" /> Remove mission link
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
