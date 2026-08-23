// Notes — student sticky notes with difficulty marking. The difficulty tag
// (easy / medium / hard) is the student's own call and is fed into the AI
// tutor's system prompt so it adjusts pacing for subjects marked "hard".

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Difficulty = "easy" | "medium" | "hard";
type NoteColor = "default" | "blue" | "green" | "amber" | "rose" | "violet";

const DIFFICULTY_META: Record<Difficulty, { label: string; classes: string }> = {
  easy: { label: "easy", classes: "border-emerald-400/60 text-emerald-300" },
  medium: { label: "medium", classes: "border-amber-400/60 text-amber-300" },
  hard: { label: "hard", classes: "border-rose-400/60 text-rose-300" },
};

const COLOR_META: Record<NoteColor, { bar: string; tint: string }> = {
  default: { bar: "bg-amber-400/70", tint: "bg-amber-400/[0.04]" },
  blue: { bar: "bg-sky-400/70", tint: "bg-sky-400/[0.05]" },
  green: { bar: "bg-emerald-400/70", tint: "bg-emerald-400/[0.05]" },
  amber: { bar: "bg-amber-400/70", tint: "bg-amber-400/[0.05]" },
  rose: { bar: "bg-rose-400/70", tint: "bg-rose-400/[0.05]" },
  violet: { bar: "bg-violet-400/70", tint: "bg-violet-400/[0.05]" },
};

const COLORS: NoteColor[] = ["default", "blue", "green", "amber", "rose", "violet"];

interface NoteDraft {
  subjectId: string;
  content: string;
  difficulty: Difficulty | "none";
  color: NoteColor;
}

const EMPTY_DRAFT: NoteDraft = {
  subjectId: "",
  content: "",
  difficulty: "none",
  color: "default",
};

export default function Notes() {
  const [searchParams, setSearchParams] = useSearchParams();
  const subjectParam = searchParams.get("subject") ?? "";
  const [subjectFilter, setSubjectFilter] = useState(subjectParam);

  const subjects = useQuery(api.subjects.getAll);
  const notes = useQuery(api.notes.list, {
    subjectId: subjectFilter ? (subjectFilter as never) : undefined,
  });
  const createNote = useMutation(api.notes.create);
  const updateNote = useMutation(api.notes.update);
  const deleteNote = useMutation(api.notes.remove);

  const [draft, setDraft] = useState<NoteDraft>(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{
    id: string;
    content: string;
    difficulty: Difficulty | "none";
    color: NoteColor;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const subjectName = useMemo(
    () => subjects?.find((s) => s._id === (subjectFilter as never))?.name,
    [subjects, subjectFilter],
  );

  const handleCreate = async () => {
    if (!draft.subjectId) {
      toast.error("Pick a subject for the note.");
      return;
    }
    if (!draft.content.trim()) {
      toast.error("Write something first.");
      return;
    }
    setCreating(true);
    try {
      await createNote({
        subjectId: draft.subjectId as never,
        content: draft.content.trim(),
        difficulty: draft.difficulty === "none" ? undefined : draft.difficulty,
        color: draft.color,
      });
      setDraft(EMPTY_DRAFT);
      toast.success("Note pinned.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the note."));
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setSavingEdit(true);
    try {
      await updateNote({
        noteId: editing.id as never,
        content: editing.content.trim(),
        difficulty: editing.difficulty === "none" ? undefined : editing.difficulty,
        color: editing.color,
      });
      setEditing(null);
      toast.success("Note updated.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not update the note."));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteNote({ noteId: id as never });
      toast.success("Note deleted.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the note."));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <DashboardShell>
      <div className="relative flex flex-col gap-6">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 size-52 rounded-full bg-amber-400/8 blur-[90px]" aria-hidden="true" />

        <motion.div
          className="flex flex-wrap items-end justify-between gap-3 relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // notes · sticky
            </p>
            <h1 className="type-h1 mt-1">Notes</h1>
            <p className="type-body mt-1 text-muted-foreground">
              Pin what matters. Mark subjects easy or hard — the tutor reads those tags.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={subjectFilter}
              onValueChange={(value) => {
                setSubjectFilter(value);
                if (value) setSearchParams({ subject: value });
                else setSearchParams({});
              }}
            >
              <SelectTrigger className="type-caption h-9 w-44 rounded-xl bg-white/5">
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects?.map((subject) => (
                  <SelectItem key={subject._id} value={subject._id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-9 rounded-xl bg-white/5"
              onClick={() => {
                setSubjectFilter("");
                setSearchParams({});
              }}
            >
              <X className="size-3.5" /> Clear
            </Button>
          </div>
        </motion.div>

        {/* Quick create */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel rounded-2xl p-5"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <Pencil className="size-4" />
            </div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // pin a note
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-3">
            <Textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              placeholder="e.g. Newton's second law: F = ma — remember to convert grams to kilograms first…"
              rows={2}
              className="type-body rounded-xl bg-white/5 font-mono"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Select
                value={draft.subjectId}
                onValueChange={(value) => setDraft({ ...draft, subjectId: value })}
              >
                <SelectTrigger className="type-caption h-9 w-44 rounded-xl bg-white/5">
                  <SelectValue placeholder="Subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects?.map((subject) => (
                    <SelectItem key={subject._id} value={subject._id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={draft.difficulty}
                onValueChange={(value) =>
                  setDraft({ ...draft, difficulty: value as Difficulty | "none" })
                }
              >
                <SelectTrigger className="type-caption h-9 w-36 rounded-xl bg-white/5">
                  <SelectValue placeholder="Difficulty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No tag</SelectItem>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Color ${color}`}
                    onClick={() => setDraft({ ...draft, color })}
                    className={cn(
                      "size-5 cursor-pointer rounded-full border transition-transform",
                      COLOR_META[color].bar,
                      draft.color === color
                        ? "scale-110 border-foreground/60"
                        : "border-white/20",
                    )}
                  />
                ))}
              </div>
              <Button className="ml-auto h-9 rounded-xl interactive-press" onClick={handleCreate} disabled={creating}>
                {creating ? (
                  <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}} className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                ) : <Plus className="size-4" />}
                Pin note
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Notes grid */}
        {notes === undefined ? (
          <div className="flex h-40 items-center justify-center">
            <motion.div animate={{rotate:360}} transition={{duration:1.2,repeat:Infinity,ease:'linear'}} className="size-5 rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        ) : notes.length === 0 ? (
          <motion.div
            initial={{opacity:0,y:12}}
            animate={{opacity:1,y:0}}
            transition={{duration:0.5,ease:[0.22,1,0.36,1]}}
            className="glass-soft relative overflow-hidden flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center"
          >
            <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 size-40 rounded-full bg-amber-400/10 blur-[50px]" />
            <div className="relative">
              <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.5)]">
                <StickyNote className="size-7" />
              </div>
            </div>
            <h3 className="type-h3 mt-6">
              {subjectName ? `No notes for ${subjectName} yet` : "No notes yet"}
            </h3>
            <p className="type-body mt-2 max-w-sm text-muted-foreground">
              Pin formulas, exam tricks or reminders. Notes marked{" "}
              <span className="text-rose-300">hard</span> make the tutor slow down on that subject.
            </p>
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5">
              <Pencil className="size-3.5 text-muted-foreground/50" />
              <span className="type-mono text-[11px] text-muted-foreground/60">
                tip: use difficulty tags to help the tutor adapt
              </span>
            </div>
          </motion.div>
        ) : (
          <motion.div layout className="columns-1 gap-4 sm:columns-2 lg:columns-3">
            <AnimatePresence>
              {notes.map((note: { _id: string; difficulty?: string; color: string; content: string; subjectId?: string; subjectName?: string }, noteIndex: number) => {
                const meta = note.difficulty
                  ? DIFFICULTY_META[note.difficulty as keyof typeof DIFFICULTY_META]
                  : null;
                const colorMeta = COLOR_META[(note.color as NoteColor) ?? "default"];
                return (
                  <motion.div
                    key={note._id}
                    layout
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, delay: 0.03 * Math.min(noteIndex, 15), ease: [0.22, 1, 0.36, 1] }}
                    className={cn(
                      "glass-panel hover-lift relative mb-4 break-inside-avoid overflow-hidden rounded-2xl p-5",
                      colorMeta.tint,
                    )}
                  >
                    <span className={cn("absolute inset-y-0 left-0 w-1", colorMeta.bar)} />
                    <div className="flex items-start justify-between gap-2">
                      <p className="type-caption font-semibold text-muted-foreground">
                        {note.subjectName}
                      </p>
                      <div className="flex items-center gap-1">
                        {meta && (
                          <span
                            className={cn(
                              "type-mono rounded-md border px-1.5 py-0.5 uppercase tracking-wider",
                              meta.classes,
                            )}
                          >
                            {meta.label}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label="Edit note"
                          onClick={() =>
                            setEditing({
                              id: note._id,
                              content: note.content,
                              difficulty: (note.difficulty ?? "none") as Difficulty | "none",
                              color: (note.color as NoteColor) ?? "default",
                            })
                          }
                          className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground interactive-press"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete note"
                          disabled={deletingId === note._id}
                          onClick={() => handleDelete(note._id)}
                          className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50 interactive-press"
                        >
                          {deletingId === note._id ? (
                            <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}} className="size-3.5 rounded-full border-2 border-destructive/30 border-t-destructive" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <p className="type-body mt-2.5 whitespace-pre-wrap leading-6">
                      {note.content}
                    </p>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit note</DialogTitle>
            <DialogDescription>Update the note and its difficulty tag.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="flex flex-col gap-3">
              <Textarea
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                rows={4}
                className="type-body rounded-xl bg-white/5 font-mono"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={editing.difficulty}
                  onValueChange={(value) =>
                    setEditing({ ...editing, difficulty: value as Difficulty | "none" })
                  }
                >
                  <SelectTrigger className="type-caption h-9 w-36 rounded-xl bg-white/5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No tag</SelectItem>
                    <SelectItem value="easy">Easy</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="hard">Hard</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1.5">
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Color ${color}`}
                      onClick={() => setEditing({ ...editing, color })}
                      className={cn(
                        "size-5 cursor-pointer rounded-full border transition-transform",
                        COLOR_META[color].bar,
                        editing.color === color
                          ? "scale-110 border-foreground/60"
                          : "border-white/20",
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl bg-white/5 interactive-press"
              onClick={() => setEditing(null)}
            >
              Cancel
            </Button>
            <Button className="rounded-xl interactive-press" onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? (
                <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}} className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
              ) : <Check className="size-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
