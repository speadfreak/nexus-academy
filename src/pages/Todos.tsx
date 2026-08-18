import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
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

  const pending = useMemo(() => todos?.filter((t: { isDone: boolean }) => !t.isDone) ?? [], [todos]);
  const done = useMemo(() => todos?.filter((t: { isDone: boolean }) => t.isDone) ?? [], [todos]);

  const handleAdd = async () => {
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
  };

  const handleToggle = async (id: string) => {
    setBusyId(id);
    try {
      await toggleDone({ todoId: id as never });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const handleCyclePriority = async (id: string, current: Priority) => {
    const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(current) + 1) % PRIORITY_CYCLE.length];
    try {
      await update({ todoId: id as never, priority: next });
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const handleRemove = async (id: string) => {
    setBusyId(id);
    try {
      await remove({ todoId: id as never });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  const renderRow = (todo: Doc<"todos"> & { subjectName?: string | null }) => {
    const isBusy = busyId === (todo._id as string);
    return (
      <motion.div
        key={todo._id}
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
        className={cn(
          "glass-soft group flex items-center gap-3 rounded-xl px-3.5 py-3 transition-colors",
          todo.isDone && "opacity-55",
        )}
      >
        <button
          type="button"
          onClick={() => handleToggle(todo._id as string)}
          aria-label={todo.isDone ? "Mark as not done" : "Mark as done"}
          className={cn(
            "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-colors",
            todo.isDone
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-white/5 hover:border-primary/60",
          )}
        >
          {isBusy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : todo.isDone ? (
            <Check className="size-3.5" />
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => handleCyclePriority(todo._id as string, todo.priority)}
          title={`Priority: ${todo.priority} — click to change`}
          className="group/dot relative shrink-0 cursor-pointer"
        >
          <span className={cn("block size-2 rounded-full", PRIORITY_DOT[todo.priority])} />
          <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-popover px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground opacity-0 transition-opacity group-hover/dot:opacity-100">
            {PRIORITY_LABEL[todo.priority]}
          </span>
        </button>

        <p
          className={cn(
            "min-w-0 flex-1 text-sm font-medium leading-snug transition-all",
            todo.isDone && "text-muted-foreground line-through",
          )}
        >
          {todo.text}
        </p>

        {todo.subjectName && (
          <span className="hidden shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            {todo.subjectName}
          </span>
        )}
        {todo.dueDate && (
          <span
            className={cn(
              "hidden shrink-0 font-mono text-[10px] sm:block",
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
          className="shrink-0 cursor-pointer rounded-md p-1 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
        >
          <Trash2 className="size-3.5" />
        </button>
      </motion.div>
    );
  };

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            // study tasks
          </p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Todos</h1>
            <p className="font-mono text-[11px] text-muted-foreground">
              {pending.length} open · {done.length} done
            </p>
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
            placeholder="Add a task — e.g. “Finish Physics worksheet on forces”"
            className="h-10 flex-1 rounded-xl bg-white/5 font-mono text-sm"
          />
          <div className="flex items-center gap-2">
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="h-10 w-36 rounded-xl bg-white/5 font-mono text-xs">
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
              className="h-10 w-36 rounded-xl bg-white/5 font-mono text-xs [color-scheme:dark]"
            />
            <Button className="h-10 shrink-0 rounded-xl" onClick={handleAdd} disabled={!text.trim()}>
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>

        {/* Pending */}
        <div className="space-y-2">
          {todos === undefined ? (
            <div className="glass-soft flex h-40 items-center justify-center rounded-2xl">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : pending.length === 0 ? (
            <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
              <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ListChecks className="size-5" />
              </div>
              <h3 className="mt-4 font-bold tracking-tight">Nothing on the list</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Add your first study task above — keep it specific so it&apos;s easy
                to tick off.
              </p>
            </div>
          ) : (
            <AnimatePresence mode="popLayout">
              {pending.map((todo) => renderRow(todo))}
            </AnimatePresence>
          )}
        </div>

        {/* Completed */}
        {done.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              completed · {done.length}
            </p>
            <AnimatePresence initial={false}>
              {done.map((todo) => renderRow(todo))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
