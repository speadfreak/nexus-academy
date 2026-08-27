// Admin topic management — seed, list, add, delete. Rendered inside the
// /admin Content tab (next to the upload form). Lets the admin build the
// syllabus topic list per subject+grade WITHOUT having to upload a PDF and
// let AI classify it — which was the only way to create topics before, and
// blocked plan generation for subjects with no uploads.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  Library,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GRADES } from "@/convex/constants";

export function AdminTopicsSection() {
  const subjects = useQuery(api.subjects.getAll);
  const [subjectId, setSubjectId] = useState<string>("");
  const [grade, setGrade] = useState<string>("");
  const [newTopicName, setNewTopicName] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [seedingAll, setSeedingAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const seedDefaultTopics = useAction(api.adminTopics.seedDefaultTopics);
  const seedAllDefaultTopics = useAction(api.adminTopics.seedAllDefaultTopics);
  const addTopic = useMutation(api.adminTopics.addTopic);
  const deleteTopic = useMutation(api.adminTopics.deleteTopic);

  // Topics grouped by grade for the selected subject.
  const topicsByGrade = useQuery(
    api.adminTopics.listTopicsGroupedByGrade,
    subjectId ? ({ subjectId: subjectId as never } as never) : "skip",
  );

  // Counts per subject — for the dashboard summary at the top.
  const selectedSubject = useMemo(
    () => subjects?.find((s) => s._id === subjectId),
    [subjects, subjectId],
  );

  const handleSeedOne = async () => {
    if (!subjectId) {
      toast.error("Pick a subject first.");
      return;
    }
    setSeeding(true);
    try {
      const result = await seedDefaultTopics({ subjectId: subjectId as never });
      toast.success(
        `Seeded ${result.seeded} new topics for ${result.subjectName} across grades 9–12. ` +
          (result.skipped > 0 ? `${result.skipped} already existed.` : ""),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Seeding failed.");
    } finally {
      setSeeding(false);
    }
  };

  const handleSeedAll = async () => {
    setSeedingAll(true);
    try {
      const result = await seedAllDefaultTopics({});
      toast.success(
        `Seeded ${result.totalSeeded} topics across all subjects. ` +
          `${result.results.length} subjects processed.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Bulk seed failed.");
    } finally {
      setSeedingAll(false);
    }
  };

  const handleAddTopic = async () => {
    if (!subjectId) {
      toast.error("Pick a subject first.");
      return;
    }
    if (!grade) {
      toast.error("Pick a grade.");
      return;
    }
    if (!newTopicName.trim()) {
      toast.error("Topic name is required.");
      return;
    }
    setAdding(true);
    try {
      const result = await addTopic({
        subjectId: subjectId as never,
        grade: Number(grade),
        name: newTopicName.trim(),
      });
      if (result.created) {
        toast.success(`Added topic "${newTopicName.trim()}".`);
      } else {
        toast.info(`Topic "${newTopicName.trim()}" already exists — no change.`);
      }
      setNewTopicName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add topic.");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (topicId: string, name: string) => {
    setDeletingId(topicId);
    try {
      await deleteTopic({ topicId: topicId as never });
      toast.success(`Removed topic "${name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const totalTopics = useMemo(() => {
    if (!topicsByGrade) return 0;
    return Object.values(topicsByGrade).reduce((sum, arr) => sum + arr.length, 0);
  }, [topicsByGrade]);

  return (
    <div className="glass-panel flex flex-col gap-4 rounded-2xl p-5 sm:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Library className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight">Syllabus topics</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              AI study plans need a syllabus to sequence. Seed the standard Ethiopian topics for
              each subject, or add custom topics per grade.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSeedAll}
          disabled={seedingAll || !subjects || subjects.length === 0}
          className="cursor-pointer gap-2 self-start border-amber-400/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
        >
          {seedingAll ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          Seed all subjects
        </Button>
      </div>

      {/* Subject + grade picker + seed button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="type-caption font-semibold text-muted-foreground">Subject</span>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="type-body h-10 rounded-xl bg-white/5">
              <SelectValue placeholder="Pick a subject..." />
            </SelectTrigger>
            <SelectContent>
              {subjects?.map((subject) => (
                <SelectItem key={subject._id} value={subject._id as string}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          onClick={handleSeedOne}
          disabled={seeding || !subjectId}
          className="cursor-pointer gap-2 self-end"
        >
          {seeding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          Seed {selectedSubject?.name ?? "subject"}
        </Button>
      </div>

      {/* Status alerts */}
      {subjectId && (
        <>
          {totalTopics > 0 ? (
            <Alert className="border-emerald-400/25 bg-emerald-400/[0.06]">
              <CheckCircle2 className="size-4 text-emerald-300" />
              <AlertTitle className="text-emerald-300">
                {totalTopics} topic{totalTopics === 1 ? "" : "s"} ready for {selectedSubject?.name}
              </AlertTitle>
              <AlertDescription className="text-emerald-200/80">
                Students can now generate AI study plans for this subject.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-amber-400/25 bg-amber-400/[0.06]">
              <Sparkles className="size-4 text-amber-300" />
              <AlertTitle className="text-amber-300">No topics yet for {selectedSubject?.name}</AlertTitle>
              <AlertDescription className="text-amber-200/80">
                Click <span className="font-semibold">Seed {selectedSubject?.name}</span> to populate the standard
                Ethiopian syllabus, or add a topic manually below.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Add custom topic form */}
      {subjectId && (
        <div className="flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 sm:flex-row sm:items-end">
          <div className="flex w-20 flex-col gap-1.5">
            <Label className="type-caption font-semibold text-muted-foreground">Grade</Label>
            <Select value={grade} onValueChange={setGrade}>
              <SelectTrigger className="h-9 rounded-lg bg-white/5 text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {GRADES.map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    Grade {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            <Label className="type-caption font-semibold text-muted-foreground">New topic name</Label>
            <Input
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !adding) {
                  e.preventDefault();
                  handleAddTopic();
                }
              }}
              placeholder="e.g. Trigonometric identities"
              className="h-9 rounded-lg bg-white/5 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            onClick={handleAddTopic}
            disabled={adding || !subjectId || !grade || !newTopicName.trim()}
            className="cursor-pointer gap-2 self-end"
          >
            {adding ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add
          </Button>
        </div>
      )}

      {/* Topic list grouped by grade */}
      {subjectId && topicsByGrade && (
        <div className="flex flex-col gap-3">
          {Object.keys(topicsByGrade)
            .map(Number)
            .sort((a, b) => a - b)
            .map((g) => {
              const topics = topicsByGrade[g] ?? [];
              if (topics.length === 0) return null;
              return (
                <div key={g} className="rounded-xl border border-white/[0.06] bg-black/20 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="type-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                      Grade {g}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {topics.length}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {topics.map((topic) => (
                      <div
                        key={topic._id}
                        className="group inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[11px] transition-colors hover:bg-rose-400/10 hover:text-rose-300"
                      >
                        <span>{topic.name}</span>
                        <button
                          type="button"
                          onClick={() => handleDelete(topic._id as string, topic.name)}
                          disabled={deletingId === topic._id}
                          aria-label={`Delete topic ${topic.name}`}
                          className="cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          {deletingId === topic._id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <Trash2 className="size-3" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          {totalTopics === 0 && (
            <div className="flex h-20 items-center justify-center text-xs text-muted-foreground">
              No topics for this subject yet.
            </div>
          )}
        </div>
      )}

      {/* Loading state */}
      {subjectId && topicsByGrade === undefined && (
        <div className="flex h-20 items-center justify-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
