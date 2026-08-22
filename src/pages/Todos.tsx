import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ListChecks, Plus, Trash2, CircleDot, Sparkles } from "lucide-react";
import { useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Priority = "low" | "medium" | "high";

const PRIORITY_CYCLE: Priority[] = ["low", "medium", "high"];
const PRIORITY_DOT: Record<Priority, string> = {
  low: "bg-white/25",
  medium: "bg-amber-400",
  high: "bg-rose-400",
};
const PRIORITY_GLOW: Record<Priority, string> = {
  low: "shadow-[0_0_6px_1px_rgb(255_255_255/0.15)]",
  medium: "shadow-[0_0_8px_2px_rgb(251_191_36/0.35)]",
  high: "shadow-[0_0_8px_2px_rgb(251_113_133/0.4)]",
};
const PRIORITY_LABEL: Record<Priority, string> = {
  low: "low",
  medium: "medium",
  high: "high",
};

function dueLabel(dueMs: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueMs);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  return `in ${diffDays}d`;
}

// Completion glow burst — a brief radial pulse at the checkbox position
function CompletionBurst({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0.8, scale: 0.5 }}
          animate={{ opacity: 0, scale: 2.2 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 -m-2 rounded-full bg-primary/20"
        />
      )}
    </AnimatePresence>
  );
}

export default function Todos() {
  const todos = useQuery(api.todos.list);
  const create = useMutation(api.todos.create);
  const toggleDone = useMutation(api.todos.toggleDone);
  const remove = useMutation(api.todos.remove);
  const update = useMutation(api.todos.update);
  const subjects = useQuery(api.subjects.getAll);

  const [text, setText] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState<string | null>(null);

  const pending = useMemo(() => todos?.filter((t: { isDone: boolean }) => !t.isDone) ?? [], [todos]);
  const done = useMemo(() => todos?.filter((t: { isDone: boolean }) => t.isDone) ?? [], [todos]);

  const handleAdd = useCallback(async () => {
    const value = text.trim();
    if (!value) return;
    try {
      await create({
        text: value,
        subjectId: (subjectId || undefined) as never,
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00`).getTime() : undefined,
      });
      setText("");
      setDueDate("");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [text, subjectId, dueDate, create]);

  const handleToggle = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await toggleDone({ todoId: id as never });
      // If we just completed it, show the burst
      const todo = todos?.find((t: { _id: string; isDone: boolean }) => t._id === (id as never));
      if (todo && !todo.isDone) {
        setJustCompleted(id);
        setTimeout(() => setJustCompleted(null), 700);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }, [todos, toggleDone]);

  const handleCyclePriority = useCallback(async (id: string, current: Priority) => {
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(current) + 1) % PRIORITY_CYCLE.length];
    try {
      await update({ todoId: id as never, priority: next });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }, [update]);

  const handleRemove = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await remove({ todoId: id as never });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  }, [remove]);

  const renderRow = (todo: Doc<"todos"> & { subjectName?: string | null }) => {
    const isBusy = busyId === (todo._id as string);
    const justDone = justCompleted === (todo._id as string);
    return (
      <motion.div
        key={todo._id}
        layout
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.22 } }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "glass-soft group flex items-center gap-3 rounded-xl px-3.5 py-3 transition-colors",
          todo.isDone && "opacity-50",
        )}
      >
        {/* Checkbox with completion burst */}
        <div className="relative">
          <CompletionBurst show={!!justDone} />
          <button
            type="button"
            onClick={() => handleToggle(todo._id as string)}
            aria-label={todo.isDone ? "Mark as not done" : "Mark as done"}
            className={cn(
              "relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-all duration-200 interactive-press",
              todo.isDone
                ? "border-primary bg-primary text-primary-foreground shadow-[0_0_12px_2px_rgb(56_189_248/0.25)]"
                : "border-border bg-white/5 hover:border-primary/60",
            )}
          >
            {isBusy ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                className="size-3 rounded-full border-2 border-primary/30 border-t-primary"
              />
            ) : todo.isDone ? (
              <motion.div
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              >
                <Check className="size-3.5" />
              </motion.div>
            ) : null}
          </button>
        </div>

        {/* Priority dot with glow */}
        <button
          type="button"
          onClick={() => handleCyclePriority(todo._id as string, todo.priority)}
          title={`Priority: ${todo.priority} — click to cycle`}
          className="group/dot relative shrink-0 cursor-pointer p-0.5"
        >
          <span
            className={cn(
              "block size-2.5 rounded-full transition-all duration-200",
              PRIORITY_DOT[todo.priority],
              PRIORITY_GLOW[todo.priority],
            )}
          />
          <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-popover px-1.5 py-0.5 type-mono text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover/dot:opacity-100">
            {PRIORITY_LABEL[todo.priority]}
          </span>
        </button>

        {/* Text with refined strike-through */}
        <motion.p
          layout
          className={cn(
            "min-w-0 flex-1 type-body leading-snug",
            todo.isDone && "text-muted-foreground",
          )}
        >
          {todo.text}
          {todo.isDone && (
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-0 flex items-center"
              style={{
                transformOrigin: "left",
              }}
            >
              <span className="w-full border-t-2 border-muted-foreground/40" />
            </motion.span>
          )}
        </motion.p>

        {todo.subjectName && (
          <span className="hidden shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 type-mono text-[10px] text-muted-foreground sm:block">
            {todo.subjectName}
          </span>
        )}
        {todo.dueDate && (
          <span
            className={cn(
              "hidden shrink-0 type-mono text-[10px] sm:block",
              todo.dueDate < Date.now() && !todo.isDone
                ? "text-rose-400"
                : "text-muted-foreground",
            )}
          >
            {dueLabel(todo.dueDate)}
          </span>
        )}

        <button
          type="button"
          onClick={() => handleRemove(todo._id as string)}
          aria-label="Delete todo"
          className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100 interactive-press"
        >
          <Trash2 className="size-3.5" />
        </button>
      </motion.div>
    );
  };

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Header */}
        <div>
          <p className="type-mono uppercase tracking-[0.22em] text-primary">
            // study tasks
          </p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <h1 className="type-h1">Todos</h1>
            <div className="flex items-center gap-3">
              {pending.length > 0 && (
                <span className="type-mono text-muted-foreground">
                  <span className="text-foreground font-semibold">{pending.length}</span> open · <span className="text-primary font-semibold">{done.length}</span> done
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Add row */}
        <div className="glass-panel flex flex-col gap-2.5 rounded-2xl p-4 sm:flex-row sm:items-center">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder={'Add a task — e.g. Finish Physics worksheet on forces'}
            className="type-body h-10 flex-1 rounded-xl bg-white/5 font-mono"
          />
          <div className="flex items-center gap-2">
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="type-caption h-10 w-36 rounded-xl bg-white/5">
                <SelectValue placeholder="Subject…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">No subject</SelectItem>
                {subjects?.map((subject: { _id: string; name: string }) => (
                  <SelectItem key={subject._id} value={subject._id as string}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-label="Due date"
              className="type-caption h-10 w-36 rounded-xl bg-white/5 [color-scheme:dark]"
            />
            <Button
              className="h-10 shrink-0 rounded-xl interactive-press"
              onClick={handleAdd}
              disabled={!text.trim()}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>

        {/* Pending */}
        <div className="space-y-2">
          {todos === undefined ? (
            <div className="glass-soft flex h-40 items-center justify-center rounded-2xl">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                className="size-5 rounded-full border-2 border-primary/30 border-t-primary"
              />
            </div>
          ) : pending.length === 0 && done.length === 0 ? (
            /* Premium empty state — no todos at all */
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="glass-soft flex flex-col items-center rounded-2xl px-6 py-16 text-center"
            >
              <div className="relative">
                <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/8 text-primary shadow-[0_0_40px_-12px_rgb(56_189_248/0.6)]">
                  <ListChecks className="size-7" />
                </div>
                <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_12px_-4px_rgb(245_197_66/0.8)]">
                  <Sparkles className="size-3" />
                </div>
              </div>
              <h3 className="type-h3 mt-6 text-foreground">
                Your task board is clear
              </h3>
              <p className="type-body mt-2 max-w-sm text-muted-foreground">
                Add your first study task above — keep it specific so it&apos;s
                easy to tick off and track your progress.
              </p>
              <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5">
                <CircleDot className="size-3.5 text-muted-foreground/50" />
                <span className="type-mono text-[11px] text-muted-foreground/60">
                  tip: use priority dots and due dates to stay organized
                </span>
              </div>
            </motion.div>
          ) : pending.length === 0 ? (
            /* All done — celebratory */
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="glass-soft flex items-center gap-3 rounded-2xl px-5 py-4 border-primary/10"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Check className="size-4" />
              </div>
              <div>
                <p className="type-body font-semibold text-foreground">
                  All caught up
                </p>
                <p className="type-caption text-muted-foreground">
                  {done.length} task{done.length !== 1 ? "s" : ""} completed — nice work.
                </p>
              </div>
            </motion.div>
          ) : (
            <AnimatePresence mode="popLayout">
              {pending.map((todo) => renderRow(todo))}
            </AnimatePresence>
          )}
        </div>

        {/* Completed */}
        {done.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2 px-1">
              <span className="type-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                completed
              </span>
              <span className="flex size-5 items-center justify-center rounded-md bg-primary/10 type-mono text-[10px] font-bold text-primary">
                {done.length}
              </span>
            </div>
            <AnimatePresence initial={false}>
              {done.map((todo) => renderRow(todo))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </DashboardShell>
  );
}
