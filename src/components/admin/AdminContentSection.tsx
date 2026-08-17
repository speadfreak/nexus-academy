// Admin content management — upload form + recent uploads. Rendered inside the
// /admin Content tab (gated by the admin role check at the page level; the
// server-side functions enforce the gate independently).

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type ContentType,
} from "@/convex/constants";
import type { ContentItemWithSubject } from "@/convex/content";
import { cn } from "@/lib/utils";

function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AdminContentSection() {
  const subjects = useQuery(api.subjects.getAll);

  // --- R2 configuration status -----------------------------------------
  const getR2Status = useAction(api.contentAdmin.getR2Status);
  const [r2Status, setR2Status] = useState<{ configured: boolean; missing: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getR2Status()
      .then((status) => {
        if (!cancelled) setR2Status(status);
      })
      .catch(() => {
        if (!cancelled) setR2Status({ configured: false, missing: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [getR2Status]);

  // --- Upload form state ------------------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [grade, setGrade] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [examYear, setExamYear] = useState("");
  const [isPremium, setIsPremium] = useState(false);
  const [uploading, setUploading] = useState(false);

  const generateUploadUrl = useMutation(api.content.generateUploadUrl);
  const adminUploadContent = useAction(api.contentAdmin.adminUploadContent);

  // --- Recent uploads ---------------------------------------------------
  const [adminGrade, setAdminGrade] = useState("");
  const [adminType, setAdminType] = useState("");
  const [adminSubjectId, setAdminSubjectId] = useState("");
  const adminContent = useQuery(api.content.getAdminContent, {
    grade: adminGrade ? Number(adminGrade) : undefined,
    subjectId: (adminSubjectId || undefined) as never,
    contentType: (adminType || undefined) as ContentType | undefined,
  });
  const deleteContentItem = useAction(api.contentAdmin.deleteContentItem);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleFile = (next: File | null) => {
    if (next && !next.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported for now.");
      return;
    }
    setFile(next);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Choose a PDF file first.");
      return;
    }
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (!contentType) {
      toast.error("Pick a content type.");
      return;
    }
    if (!grade) {
      toast.error("Pick a grade (9–12).");
      return;
    }
    if (!subjectId) {
      toast.error("Pick a subject.");
      return;
    }
    if (contentType === "past_exam" && !examYear) {
      toast.error("Past exams need an exam year.");
      return;
    }

    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/pdf" },
        body: file,
      });
      if (!response.ok) {
        throw new Error("Could not stage the file. Please try again.");
      }
      const { storageId } = (await response.json()) as { storageId: string };

      await adminUploadContent({
        title: title.trim(),
        contentType,
        grade: Number(grade),
        subjectId: subjectId as never,
        examYear: contentType === "past_exam" ? Number(examYear) : undefined,
        isPremium,
        storageId,
        filename: file.name,
      });

      toast.success("Content uploaded to the library.");
      setFile(null);
      setTitle("");
      setContentType("");
      setGrade("");
      setSubjectId("");
      setExamYear("");
      setIsPremium(false);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error &&
              "data" in error &&
              typeof (error as { data: { message?: string } }).data?.message === "string"
            ? (error as { data: { message: string } }).data.message
            : "Upload failed. Check the details and try again.";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (item: ContentItemWithSubject) => {
    setDeletingId(item._id);
    try {
      const result = await deleteContentItem({ contentId: item._id });
      if (result.r2Error) {
        toast.warning(result.r2Error);
      } else {
        toast.success(`Removed "${item.title}" from the library.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* R2 storage status */}
      {r2Status && !r2Status.configured && (
        <Alert className="glass-soft border-amber-400/25 bg-amber-400/10">
          <AlertTriangle className="size-4 text-amber-300" />
          <AlertTitle className="text-amber-300">R2 storage not configured yet</AlertTitle>
          <AlertDescription className="text-amber-200/80">
            To enable uploads, create an R2 bucket in the Cloudflare dashboard
            and add these keys in the project&apos;s Keys / API keys tab:{" "}
            <code className="rounded bg-white/10 px-1 text-[11px]">
              {r2Status.missing.join(", ") || "R2_*"}
            </code>
            . Uploads are disabled until then.
          </AlertDescription>
        </Alert>
      )}
      {r2Status && r2Status.configured && (
        <Alert className="glass-soft border-emerald-400/25 bg-emerald-400/10">
          <CheckCircle2 className="size-4 text-emerald-300" />
          <AlertTitle className="text-emerald-300">R2 storage is connected</AlertTitle>
          <AlertDescription className="text-emerald-200/80">
            Files are stored under the human-browsable key layout.
          </AlertDescription>
        </Alert>
      )}

      {/* Upload form */}
      <div className="glass-panel grid gap-5 rounded-2xl p-5 sm:p-6 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              handleFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={cn(
              "flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors",
              dragging ? "border-primary bg-primary/10" : "border-border bg-white/[0.03]",
            )}
          >
            <input
              id="admin-content-file"
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <>
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileUp className="size-5" />
                </div>
                <p className="mt-3 max-w-full truncate text-sm font-semibold">{file.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-3 cursor-pointer text-muted-foreground"
                  onClick={() => setFile(null)}
                >
                  <X className="size-3.5" /> Remove file
                </Button>
              </>
            ) : (
              <>
                <div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <UploadCloud className="size-5" />
                </div>
                <p className="mt-3 text-sm font-semibold">Drop a PDF here</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  or{" "}
                  <label
                    htmlFor="admin-content-file"
                    className="cursor-pointer font-semibold text-primary underline underline-offset-2"
                  >
                    browse your files
                  </label>
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">Title</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 2023 Grade 12 Physics National Examination"
              className="h-9 rounded-xl bg-white/5"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Content type</Label>
              <Select
                value={contentType}
                onValueChange={(value) => {
                  setContentType(value as ContentType);
                  if (value !== "past_exam") setExamYear("");
                }}
              >
                <SelectTrigger className="h-9 rounded-xl bg-white/5">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {CONTENT_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Grade</Label>
              <Select value={grade} onValueChange={setGrade}>
                <SelectTrigger className="h-9 rounded-xl bg-white/5">
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {[9, 10, 11, 12].map((g) => (
                    <SelectItem key={g} value={String(g)}>
                      Grade {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Subject</Label>
              <Select value={subjectId} onValueChange={setSubjectId}>
                <SelectTrigger className="h-9 rounded-xl bg-white/5">
                  <SelectValue placeholder={subjects ? "Select subject" : "Loading…"} />
                </SelectTrigger>
                <SelectContent>
                  {subjects?.map((subject) => (
                    <SelectItem key={subject._id} value={subject._id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {contentType === "past_exam" ? (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Exam year</Label>
                <Input
                  type="number"
                  min={1990}
                  max={new Date().getFullYear()}
                  value={examYear}
                  onChange={(e) => setExamYear(e.target.value)}
                  placeholder="e.g. 2023"
                  className="h-9 rounded-xl bg-white/5"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Exam year</Label>
                <div className="flex h-9 items-center rounded-xl border border-dashed border-border bg-white/5 px-3 text-xs text-muted-foreground">
                  Only for past exams
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white/5 px-4 py-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Sparkles className="size-4 text-amber-500" /> Premium content
              </p>
              <p className="text-xs text-muted-foreground">
                Signed, time-limited download URLs gated behind the subscription.
              </p>
            </div>
            <Switch checked={isPremium} onCheckedChange={setIsPremium} />
          </div>

          <Button
            onClick={handleUpload}
            disabled={uploading || (r2Status !== null && !r2Status.configured)}
            className="h-11 rounded-xl"
          >
            {uploading ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Uploading to R2…
              </>
            ) : (
              <>
                <UploadCloud className="size-4" /> Upload to library
              </>
            )}
          </Button>
        </div>

        <div className="glass-soft hidden rounded-2xl p-5 lg:block">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            Storage layout
          </p>
          <div className="mt-4 space-y-3 font-mono text-[11px] leading-5 text-muted-foreground">
            <div className="rounded-lg border border-white/8 bg-black/30 p-3">
              <p className="text-foreground">natural/11/physics/past-exam/</p>
              <p>2023-physics-national-exam.pdf</p>
            </div>
            <div className="rounded-lg border border-white/8 bg-black/30 p-3">
              <p className="text-foreground">common/9/mathematics/textbook/</p>
              <p>grade-9-mathematics-unit-1.pdf</p>
            </div>
            <div className="rounded-lg border border-white/8 bg-black/30 p-3">
              <p className="text-foreground">social/12/history/student-guide/</p>
              <p>exam-season-revision-guide.pdf</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">
            Keys are built from the selected stream, grade, subject slug and
            content type, so the bucket stays human-browsable even without the
            database.
          </p>
        </div>
      </div>

      {/* Recent uploads */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">Recent uploads</h2>
            <p className="text-sm text-muted-foreground">Manage what&apos;s already in the library.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={adminGrade} onValueChange={(v) => setAdminGrade(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 w-28 rounded-lg bg-white/5 text-xs">
                <SelectValue placeholder="Grade" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All grades</SelectItem>
                {[9, 10, 11, 12].map((g) => (
                  <SelectItem key={g} value={String(g)}>
                    Grade {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={adminType} onValueChange={(v) => setAdminType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 w-32 rounded-lg bg-white/5 text-xs">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CONTENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CONTENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={adminSubjectId} onValueChange={(v) => setAdminSubjectId(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 w-32 rounded-lg bg-white/5 text-xs">
                <SelectValue placeholder="Subject" />
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
            {(adminGrade || adminType || adminSubjectId) && (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 cursor-pointer text-muted-foreground"
                onClick={() => {
                  setAdminGrade("");
                  setAdminType("");
                  setAdminSubjectId("");
                }}
                aria-label="Reset filters"
              >
                <RotateCcw className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          {adminContent === undefined ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : adminContent.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No uploads yet{adminGrade || adminType || adminSubjectId ? " for these filters" : ""}.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adminContent.map((item) => (
                  <TableRow key={item._id} className="hover:bg-white/5">
                    <TableCell className="max-w-[15rem]">
                      <p className="truncate font-semibold">{item.title}</p>
                      {item.isPremium && (
                        <Badge className="mt-1 gap-1 bg-amber-400/10 text-amber-300">
                          <Sparkles className="size-3" /> Premium
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {CONTENT_TYPE_LABELS[item.contentType]}
                    </TableCell>
                    <TableCell>Grade {item.grade}</TableCell>
                    <TableCell className="text-muted-foreground">{item.subjectName}</TableCell>
                    <TableCell>{item.examYear ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatBytes(item.fileSizeBytes)}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 cursor-pointer text-muted-foreground hover:text-destructive"
                            aria-label={`Delete ${item.title}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="glass-panel">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this item?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This removes <strong>{item.title}</strong> from the library and
                              deletes the file from Cloudflare R2. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              className="cursor-pointer rounded-xl bg-destructive text-white hover:bg-destructive/90"
                              disabled={deletingId === item._id}
                              onClick={() => handleDelete(item)}
                            >
                              {deletingId === item._id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4" />
                              )}
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
