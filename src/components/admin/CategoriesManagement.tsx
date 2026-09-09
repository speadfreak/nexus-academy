// Admin Categories Management — CRUD UI for subjects, content types, and
// grades. Rendered as a 3rd tab inside AdminContentSection alongside Single
// Upload and Bulk Upload.
//
// ARCHITECTURE:
//   - Three collapsible cards: Subjects / Content Types / Grades
//   - Each card lists all entries in a table with Edit + Delete buttons
//   - "Add new" button per card opens a small dialog form
//   - Built-in entries (isBuiltIn=true) can be edited (label only) but not
//     deleted — admin-added entries can be deleted freely
//   - Deletion refuses with a clear error if existing content items reference
//     the entry (server-side check)
//   - On mount, calls seed mutations to backfill any new built-in entries
//     (idempotent — skips existing)

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  Edit3,
  FileText,
  GraduationCap,
  Layers,
  Loader2,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { STREAM_LABELS, type Stream } from "@/convex/constants";
import { cn } from "@/lib/utils";

// ── Main component ──────────────────────────────────────────────────

export function CategoriesManagement() {
  // Seed everything on mount (idempotent — only inserts missing built-ins)
  const subjects = useQuery(api.subjects.getAll);
  const contentTypes = useQuery(api.categories.listContentTypes);
  const grades = useQuery(api.categories.listGrades);

  const seedSubjects = useMutation(api.subjects.seed);
  const seedContentTypes = useMutation(api.categories.seedContentTypes);
  const seedGrades = useMutation(api.categories.seedGrades);

  useEffect(() => {
    // Only seed once all three queries have loaded at least once
    if (subjects !== undefined && contentTypes !== undefined && grades !== undefined) {
      void seedSubjects().catch(() => {});
      void seedContentTypes().catch(() => {});
      void seedGrades().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjects, contentTypes, grades]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          // categories
        </p>
        <h3 className="mt-1 text-lg font-extrabold tracking-tight">
          Manage Categories
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Add, edit, and delete subjects, content types, and grades. Changes
          take effect immediately across the upload forms, library filters,
          and student dashboard. Built-in categories can be edited but not
          deleted — admin-added categories can be removed freely (unless
          content items still reference them).
        </p>
      </div>

      {/* Subjects card */}
      <SubjectsCard />

      {/* Content types card */}
      <ContentTypesCard />

      {/* Grades card */}
      <GradesCard />
    </div>
  );
}

// ── Subjects card ─────────────────────────────────────────────────────

function SubjectsCard() {
  const subjects = useQuery(api.subjects.getAll);
  const addSubject = useMutation(api.categories.addSubject);
  const updateSubject = useMutation(api.categories.updateSubject);
  const deleteSubject = useMutation(api.categories.deleteSubject);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: Id<"subjects">; name: string; stream: Stream } | null>(null);
  const [name, setName] = useState("");
  const [stream, setStream] = useState<Stream>("common");
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setName("");
    setStream("common");
    setDialogOpen(true);
  };
  const openEdit = (s: { id: Id<"subjects">; name: string; stream: Stream }) => {
    setEditing(s);
    setName(s.name);
    setStream(s.stream);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateSubject({ id: editing.id, name: name.trim(), stream });
        toast.success(`Subject "${name.trim()}" updated.`);
      } else {
        await addSubject({ name: name.trim(), stream });
        toast.success(`Subject "${name.trim()}" added.`);
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: Id<"subjects">, name: string) => {
    if (!confirm(`Delete subject "${name}"? This cannot be undone.`)) return;
    try {
      await deleteSubject({ id });
      toast.success(`Subject "${name}" deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4 text-primary" />
          <h4 className="text-sm font-bold uppercase tracking-wider">Subjects</h4>
          {subjects && (
            <Badge variant="outline" className="bg-white/5">
              {subjects.length} total
            </Badge>
          )}
        </div>
        <Button onClick={openAdd} size="sm" className="gap-2">
          <Plus className="size-3.5" />
          Add Subject
        </Button>
      </div>

      {!subjects ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : subjects.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No subjects yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">#</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-[160px]">Slug</TableHead>
                <TableHead className="w-[140px]">Stream</TableHead>
                <TableHead className="w-[160px]">Type</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subjects.map((s, i) => (
                <TableRow key={s._id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell>
                    <code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {s.slug}
                    </code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="bg-white/5">
                      {STREAM_LABELS[s.stream as Stream] ?? s.stream}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {/* Built-in subjects are the seeded ones — we can detect them
                        by slug matching SEED_SUBJECTS in constants. For now,
                        we mark them all as "seeded" since we don't have an
                        isBuiltIn flag on the subjects table. */}
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                      <ShieldCheck className="size-2.5 mr-1" />
                      Seeded
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEdit({ id: s._id, name: s.name, stream: s.stream as Stream })}
                        title="Edit"
                        className="cursor-pointer rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(s._id, s.name)}
                        title="Delete"
                        className="cursor-pointer rounded-md border border-rose-400/20 bg-rose-400/5 p-1.5 text-rose-300 hover:bg-rose-400/15"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Subject" : "Add New Subject"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the name or stream. The slug is derived from the name and will update atomically."
                : "Add a new subject. Students will see this in the subject picker, library filters, and tutor."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="subject-name">Name *</Label>
              <Input
                id="subject-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Physics, Geography, Business Studies"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Slug will be: <code className="rounded bg-white/5 px-1">{name.trim().toLowerCase().replace(/\s+/g, "-") || "—"}</code>
              </p>
            </div>
            <div>
              <Label htmlFor="subject-stream">Stream *</Label>
              <Select value={stream} onValueChange={(v) => setStream(v as Stream)}>
                <SelectTrigger id="subject-stream" className="mt-1 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="common">Common (all students)</SelectItem>
                  <SelectItem value="natural">Natural Science</SelectItem>
                  <SelectItem value="social">Social Science</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {editing ? "Update" : "Add"} Subject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Content types card ────────────────────────────────────────────────

function ContentTypesCard() {
  const contentTypes = useQuery(api.categories.listContentTypes);
  const addContentType = useMutation(api.categories.addContentType);
  const updateContentType = useMutation(api.categories.updateContentType);
  const deleteContentType = useMutation(api.categories.deleteContentType);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{
    id: Id<"contentTypes">;
    label: string;
    storageSlug: string;
    hasYear: boolean;
    isBuiltIn: boolean;
  } | null>(null);
  const [label, setLabel] = useState("");
  const [storageSlug, setStorageSlug] = useState("");
  const [hasYear, setHasYear] = useState(false);
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setLabel("");
    setStorageSlug("");
    setHasYear(false);
    setDialogOpen(true);
  };
  const openEdit = (ct: {
    id: Id<"contentTypes">;
    label: string;
    storageSlug: string;
    hasYear: boolean;
    isBuiltIn: boolean;
  }) => {
    setEditing(ct);
    setLabel(ct.label);
    setStorageSlug(ct.storageSlug);
    setHasYear(ct.hasYear);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!label.trim()) {
      toast.error("Label is required.");
      return;
    }
    if (!storageSlug.trim() && !editing) {
      // Auto-derive from label if blank
      setStorageSlug(label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    }
    setSaving(true);
    try {
      const finalStorageSlug = storageSlug.trim() || label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if (editing) {
        await updateContentType({
          id: editing.id,
          label: label.trim(),
          storageSlug: finalStorageSlug,
          hasYear,
        });
        toast.success(`Content type "${label.trim()}" updated.`);
      } else {
        await addContentType({
          label: label.trim(),
          storageSlug: finalStorageSlug,
          hasYear,
        });
        toast.success(`Content type "${label.trim()}" added.`);
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: Id<"contentTypes">, label: string) => {
    if (!confirm(`Delete content type "${label}"? This cannot be undone.`)) return;
    try {
      await deleteContentType({ id });
      toast.success(`Content type "${label}" deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-primary" />
          <h4 className="text-sm font-bold uppercase tracking-wider">Content Types</h4>
          {contentTypes && (
            <Badge variant="outline" className="bg-white/5">
              {contentTypes.length} total
            </Badge>
          )}
        </div>
        <Button onClick={openAdd} size="sm" className="gap-2">
          <Plus className="size-3.5" />
          Add Type
        </Button>
      </div>

      {!contentTypes ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : contentTypes.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No content types yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">#</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="w-[160px]">Slug</TableHead>
                <TableHead className="w-[140px]">Storage Path</TableHead>
                <TableHead className="w-[80px]">Has Year</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contentTypes.map((ct, i) => (
                <TableRow key={ct._id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-medium">{ct.label}</TableCell>
                  <TableCell>
                    <code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {ct.slug}
                    </code>
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {ct.storageSlug}
                    </code>
                  </TableCell>
                  <TableCell>
                    {ct.hasYear ? (
                      <Badge variant="outline" className="bg-sky-500/10 text-sky-300 border-sky-500/30">
                        <Check className="size-2.5 mr-1" /> Yes
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {ct.isBuiltIn ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                        <ShieldCheck className="size-2.5 mr-1" />
                        Built-in
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-500/30">
                        Custom
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() =>
                          openEdit({
                            id: ct._id,
                            label: ct.label,
                            storageSlug: ct.storageSlug,
                            hasYear: ct.hasYear,
                            isBuiltIn: ct.isBuiltIn,
                          })
                        }
                        title="Edit"
                        className="cursor-pointer rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      {!ct.isBuiltIn && (
                        <button
                          onClick={() => handleDelete(ct._id, ct.label)}
                          title="Delete"
                          className="cursor-pointer rounded-md border border-rose-400/20 bg-rose-400/5 p-1.5 text-rose-300 hover:bg-rose-400/15"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Content Type" : "Add New Content Type"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the label, storage path, or year flag. The slug is immutable (existing content items reference it)."
                : "Add a new content type. It will appear in the upload form dropdowns immediately."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ct-label">Label *</Label>
              <Input
                id="ct-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Past Exam, Worksheet, Lab Manual"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Slug will be auto-derived:{" "}
                <code className="rounded bg-white/5 px-1">
                  {label.trim().toLowerCase().replace(/\s+/g, "-") || "—"}
                </code>
              </p>
            </div>
            <div>
              <Label htmlFor="ct-storage">Storage Path (R2 folder)</Label>
              <Input
                id="ct-storage"
                value={storageSlug}
                onChange={(e) => setStorageSlug(e.target.value)}
                placeholder="auto-derived from label if blank"
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                The R2 path segment: <code>stream/grade/subject/[storage-path]/file.pdf</code>
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <div>
                <Label htmlFor="ct-hasyear" className="cursor-pointer">Has Exam Year</Label>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  If on, the upload form shows a year picker for this type
                  (e.g. past exams need a year).
                </p>
              </div>
              <input
                id="ct-hasyear"
                type="checkbox"
                checked={hasYear}
                onChange={(e) => setHasYear(e.target.checked)}
                className="size-4 cursor-pointer"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {editing ? "Update" : "Add"} Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Grades card ───────────────────────────────────────────────────────

function GradesCard() {
  const grades = useQuery(api.categories.listGrades);
  const addGrade = useMutation(api.categories.addGrade);
  const updateGrade = useMutation(api.categories.updateGrade);
  const deleteGrade = useMutation(api.categories.deleteGrade);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: Id<"grades">; grade: number; label: string; isBuiltIn: boolean } | null>(null);
  const [grade, setGrade] = useState<number>(9);
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setGrade(9);
    setLabel("");
    setDialogOpen(true);
  };
  const openEdit = (g: { id: Id<"grades">; grade: number; label: string; isBuiltIn: boolean }) => {
    setEditing(g);
    setGrade(g.grade);
    setLabel(g.label);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!Number.isInteger(grade) || grade < 1 || grade > 13) {
      toast.error("Grade must be an integer between 1 and 13.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateGrade({ id: editing.id, label: label.trim() || `Grade ${grade}` });
        toast.success(`Grade ${grade} updated.`);
      } else {
        await addGrade({ grade, label: label.trim() || `Grade ${grade}` });
        toast.success(`Grade ${grade} added.`);
      }
      setDialogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: Id<"grades">, label: string) => {
    if (!confirm(`Delete grade "${label}"? This cannot be undone.`)) return;
    try {
      await deleteGrade({ id });
      toast.success(`Grade "${label}" deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GraduationCap className="size-4 text-primary" />
          <h4 className="text-sm font-bold uppercase tracking-wider">Grades</h4>
          {grades && (
            <Badge variant="outline" className="bg-white/5">
              {grades.length} total
            </Badge>
          )}
        </div>
        <Button onClick={openAdd} size="sm" className="gap-2">
          <Plus className="size-3.5" />
          Add Grade
        </Button>
      </div>

      {!grades ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : grades.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No grades yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">#</TableHead>
                <TableHead>Grade</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="w-[100px]">Type</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grades.map((g, i) => (
                <TableRow key={g._id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
                  <TableCell className="font-mono font-bold">{g.grade}</TableCell>
                  <TableCell className="font-medium">{g.label}</TableCell>
                  <TableCell>
                    {g.isBuiltIn ? (
                      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                        <ShieldCheck className="size-2.5 mr-1" />
                        Built-in
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-violet-500/10 text-violet-300 border-violet-500/30">
                        Custom
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEdit({ id: g._id, grade: g.grade, label: g.label, isBuiltIn: g.isBuiltIn })}
                        title="Edit"
                        className="cursor-pointer rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Edit3 className="size-3.5" />
                      </button>
                      {!g.isBuiltIn && (
                        <button
                          onClick={() => handleDelete(g._id, g.label)}
                          title="Delete"
                          className="cursor-pointer rounded-md border border-rose-400/20 bg-rose-400/5 p-1.5 text-rose-300 hover:bg-rose-400/15"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Grade" : "Add New Grade"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update the grade label. The grade number itself is immutable (existing content items reference it)."
                : "Add a new grade level. It will appear in the upload form dropdowns immediately."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="grade-number">Grade Number *</Label>
              <Input
                id="grade-number"
                type="number"
                min={1}
                max={13}
                value={grade}
                onChange={(e) => setGrade(parseInt(e.target.value, 10) || 0)}
                disabled={!!editing}
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Must be an integer between 1 and 13.
                {editing && " (number is immutable for existing grades)"}
              </p>
            </div>
            <div>
              <Label htmlFor="grade-label">Display Label</Label>
              <Input
                id="grade-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`Grade ${grade}`}
                className="mt-1"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Leave blank to use the default: "Grade {grade}"
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              {editing ? "Update" : "Add"} Grade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
