// Admin Bulk Upload — multi-file upload with AI classification.
//
// ARCHITECTURE:
//   1. Admin selects multiple PDF files (drag-drop or file picker)
//   2. Sets a batch-level "Mark all as Premium?" toggle
//   3. Clicks "Start Processing" → files are processed ONE AT A TIME:
//      a. Upload to Convex storage (get storageId)
//      b. Extract PDF text (browser-side, via extractPdfText)
//      c. Call classifyContentText (AI suggests title/subject/grade/type)
//      d. Show live progress: "Uploading" → "Analyzing" → "Ready" / "Failed"
//   4. Review table — one editable row per file:
//      - Title (editable text)
//      - Subject (editable dropdown)
//      - Grade (editable dropdown 9-12)
//      - Content type (editable dropdown)
//      - Year (editable, only for past_exam)
//      - Premium toggle (defaulted from batch, per-file override)
//      - Failed files show a red flag + require manual entry
//   5. "Save All" button — only active when all rows are valid
//   6. Batch summary: "X resources added successfully"
//
// THROTTLING: Files are processed sequentially, not concurrently.
// Each AI classification call waits for the previous to complete.
// A 2-second delay between files prevents rate-limit exhaustion.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Lock,
  Package,
  Save,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { extractPdfText } from "@/lib/pdf";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

type FileStatus = "pending" | "uploading" | "analyzing" | "ready" | "failed";

interface BulkFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  storageId?: string;
  error?: string;
  // AI suggestion (or manual entry)
  title: string;
  subjectId: string;
  grade: string;
  contentType: string;
  examYear: string;
  isPremium: boolean;
  topics: string[];
  aiAnalyzed: boolean;
}

const CONTENT_TYPES = [
  { value: "textbook", label: "Textbook" },
  { value: "past_exam", label: "Past Exam" },
  { value: "worksheet", label: "Worksheet" },
  { value: "student_guide", label: "Student Guide" },
  { value: "teacher_guide", label: "Teacher Guide" },
] as const;

const GRADES = [9, 10, 11, 12];

// ── Component ──────────────────────────────────────────────────────────

export function BulkUploadSection() {
  const generateUploadUrl = useAction(api.contentAdmin.generateUploadUrl);
  const adminUploadContent = useAction(api.contentAdmin.adminUploadContent);
  const classifyContentText = useAction(api.contentAI.classifyContentText);
  const subjects = useQuery(api.subjects.getAll);

  const [files, setFiles] = useState<BulkFile[]>([]);
  const [batchPremium, setBatchPremium] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File selection ──────────────────────────────────────────────────
  const handleFilesSelected = useCallback(
    (selectedFiles: FileList | null) => {
      if (!selectedFiles) return;
      const newFiles: BulkFile[] = Array.from(selectedFiles)
        .filter((f) => f.type === "application/pdf" || f.name.endsWith(".pdf"))
        .map((f) => ({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          file: f,
          status: "pending" as FileStatus,
          progress: 0,
          title: "",
          subjectId: "",
          grade: "",
          contentType: "",
          examYear: "",
          isPremium: batchPremium,
          topics: [],
          aiAnalyzed: false,
        }));
      if (newFiles.length === 0) {
        toast.error("No PDF files selected. Only PDF files are supported.");
        return;
      }
      // Filter out non-PDF files
      const skipped = selectedFiles.length - newFiles.length;
      if (skipped > 0) {
        toast.warning(`${skipped} non-PDF file(s) skipped.`);
      }
      setFiles((prev) => [...prev, ...newFiles]);
      setSavedCount(null);
    },
    [batchPremium],
  );

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // ── Sequential processing ───────────────────────────────────────────
  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setSavedCount(null);

    for (const bulkFile of files) {
      if (bulkFile.status === "ready") continue; // Already processed

      // Update status to "uploading"
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id ? { ...f, status: "uploading", progress: 0, error: undefined } : f,
        ),
      );

      try {
        // Step 1: Upload to Convex storage
        const convexUploadUrl = await generateUploadUrl({});
        const storageId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", convexUploadUrl);
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setFiles((prev) =>
                prev.map((f) =>
                  f.id === bulkFile.id ? { ...f, progress: pct } : f,
                ),
              );
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const res = JSON.parse(xhr.responseText) as { storageId: string };
                if (res.storageId) resolve(res.storageId);
                else reject(new Error("No storageId in response"));
              } catch {
                reject(new Error("Upload response was not JSON"));
              }
            } else {
              reject(new Error(`Upload HTTP ${xhr.status}`));
            }
          });
          xhr.addEventListener("error", () => reject(new Error("Network error")));
          xhr.send(bulkFile.file);
        });

        // Step 2: Extract PDF text (browser-side)
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id ? { ...f, status: "analyzing", storageId } : f,
          ),
        );

        let sample = "";
        try {
          sample = await extractPdfText(bulkFile.file, 5, 12000);
        } catch {
          // Non-fatal — classification will return "no extractable text"
        }

        // Step 3: AI classification
        const suggestion = await classifyContentText({
          sample,
          filename: bulkFile.file.name,
        });

        // Step 4: Update file with AI suggestions
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id
              ? {
                  ...f,
                  status: suggestion.analyzed ? "ready" : "failed",
                  title: suggestion.title ?? f.file.name.replace(/\.pdf$/i, ""),
                  subjectId: suggestion.subjectId ?? "",
                  grade: suggestion.grade?.toString() ?? "",
                  contentType: suggestion.contentType ?? "",
                  examYear: suggestion.examYear?.toString() ?? "",
                  topics: suggestion.topics ?? [],
                  aiAnalyzed: suggestion.analyzed,
                  error: suggestion.analyzed ? undefined : suggestion.note ?? "Classification failed",
                }
              : f,
          ),
        );

        // Throttle: 2-second delay between files to stay under rate limits
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Processing failed";
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id
              ? { ...f, status: "failed", error: msg }
              : f,
          ),
        );
        // Continue to next file — don't fail the whole batch
      }
    }

    setProcessing(false);
    toast.success("Batch processing complete. Review the suggestions below.");
  };

  // ── Update a file's fields (from review table) ──────────────────────
  const updateFile = (id: string, updates: Partial<BulkFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  // ── Validation: all files must have valid required fields ───────────
  const allValid = files.length > 0 && files.every((f) => {
    if (!f.storageId) return false;
    if (!f.title.trim()) return false;
    if (!f.contentType) return false;
    if (!f.grade) return false;
    if (!f.subjectId) return false;
    if (f.contentType === "past_exam" && !f.examYear) return false;
    return true;
  });

  // ── Save all ────────────────────────────────────────────────────────
  const handleSaveAll = async () => {
    if (!allValid) {
      toast.error("Some files are missing required fields. Please review all rows.");
      return;
    }
    setSaving(true);
    let saved = 0;
    let failed = 0;

    for (const bulkFile of files) {
      try {
        await adminUploadContent({
          title: bulkFile.title.trim(),
          contentType: bulkFile.contentType as never,
          grade: Number(bulkFile.grade),
          subjectId: bulkFile.subjectId as Id<"subjects">,
          examYear: bulkFile.contentType === "past_exam" ? Number(bulkFile.examYear) : undefined,
          isPremium: bulkFile.isPremium,
          storageId: bulkFile.storageId!,
          filename: bulkFile.file.name,
          topicCandidates: bulkFile.topics.length > 0 ? bulkFile.topics : undefined,
        });
        saved++;
      } catch (err) {
        failed++;
        toast.error(`Failed to save "${bulkFile.file.name}": ${err instanceof Error ? err.message : "unknown error"}`);
      }
    }

    setSaving(false);
    setSavedCount(saved);
    if (saved > 0) {
      toast.success(`${saved} resource${saved === 1 ? "" : "s"} added to the library.`);
    }
    // Clear the batch
    setFiles([]);
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (savedCount !== null) {
    return (
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-8 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10">
          <CheckCircle2 className="size-8 text-emerald-300" />
        </div>
        <h3 className="mt-4 text-xl font-extrabold tracking-tight">
          {savedCount} resource{savedCount === 1 ? "" : "s"} added successfully
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Your batch has been saved to the library. Students can now access these resources.
        </p>
        <Button
          className="mt-6 gap-2"
          onClick={() => setSavedCount(null)}
        >
          <Package className="size-4" />
          Upload another batch
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
            // bulk upload
          </p>
          <h3 className="mt-1 text-lg font-extrabold tracking-tight">
            Bulk Upload Resources
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Select multiple PDF files, let AI classify them, review, and save.
          </p>
        </div>
      </div>

      {/* Step 1: File selection + batch premium toggle */}
      {files.length === 0 && (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFilesSelected(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors",
              dragOver
                ? "border-primary bg-primary/10"
                : "border-border bg-white/[0.02]",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              className="hidden"
              onChange={(e) => handleFilesSelected(e.target.files)}
            />
            <div className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
              <Upload className="size-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Drop PDF files here</p>
              <p className="mt-1 text-xs text-muted-foreground">
                or click to browse — select multiple files at once
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="gap-2"
            >
              <FileText className="size-4" />
              Select PDF files
            </Button>
          </div>

          {/* Batch premium toggle */}
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <div>
              <p className="text-sm font-semibold">Mark all as Premium?</p>
              <p className="text-xs text-muted-foreground">
                Sets the default for every file in this batch. Can be overridden per file in the review step.
              </p>
            </div>
            <Switch
              checked={batchPremium}
              onCheckedChange={setBatchPremium}
            />
          </div>
        </div>
      )}

      {/* File list + process button */}
      {files.length > 0 && (
        <>
          {/* Process bar */}
          <div className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="flex items-center gap-3">
              <Package className="size-4 text-primary" />
              <span className="text-sm font-semibold">
                {files.length} file{files.length === 1 ? "" : "s"} selected
              </span>
              {!processing && files.some((f) => f.status === "pending") && (
                <span className="text-xs text-muted-foreground">
                  Click "Start Processing" to upload and classify
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!processing && !saving && files.some((f) => f.status === "pending") && (
                <Button
                  onClick={processFiles}
                  className="gap-2"
                  size="sm"
                >
                  <Zap className="size-3.5" />
                  Start Processing
                </Button>
              )}
              {!processing && !saving && allValid && (
                <Button
                  onClick={handleSaveAll}
                  className="gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
                  size="sm"
                >
                  <Save className="size-3.5" />
                  Save All ({files.length})
                </Button>
              )}
              {!processing && !saving && !allValid && files.every((f) => f.status !== "pending") && (
                <span className="text-xs text-amber-300">
                  Fill in missing fields to enable Save All
                </span>
              )}
            </div>
          </div>

          {/* File list / Review table */}
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead>File / Title</TableHead>
                  <TableHead className="w-[140px]">Subject</TableHead>
                  <TableHead className="w-[80px]">Grade</TableHead>
                  <TableHead className="w-[120px]">Type</TableHead>
                  <TableHead className="w-[80px]">Year</TableHead>
                  <TableHead className="w-[60px]">Premium</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f, i) => (
                  <TableRow key={f.id} className={cn(
                    f.status === "failed" && "bg-rose-400/[0.04]",
                    f.status === "ready" && "bg-emerald-400/[0.02]",
                  )}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      {/* Status indicator */}
                      <div className="flex items-center gap-2">
                        {f.status === "pending" && <Clock className="size-3.5 text-muted-foreground" />}
                        {f.status === "uploading" && <Loader2 className="size-3.5 animate-spin text-amber-300" />}
                        {f.status === "analyzing" && <Loader2 className="size-3.5 animate-spin text-sky-300" />}
                        {f.status === "ready" && <CheckCircle2 className="size-3.5 text-emerald-300" />}
                        {f.status === "failed" && <AlertTriangle className="size-3.5 text-rose-300" />}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-muted-foreground">{f.file.name}</p>
                          {(f.status === "pending" || f.status === "uploading" || f.status === "analyzing") ? (
                            <p className="text-[10px] text-muted-foreground/60">
                              {f.status === "uploading" && `Uploading… ${f.progress}%`}
                              {f.status === "analyzing" && "AI analyzing…"}
                              {f.status === "pending" && "Waiting…"}
                            </p>
                          ) : (
                            <Input
                              value={f.title}
                              onChange={(e) => updateFile(f.id, { title: e.target.value })}
                              placeholder="Enter title"
                              className="mt-0.5 h-8 rounded-md bg-white/5 text-xs"
                              disabled={processing}
                            />
                          )}
                          {f.error && (
                            <p className="mt-0.5 text-[10px] text-rose-300">{f.error}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={f.subjectId}
                        onValueChange={(v) => updateFile(f.id, { subjectId: v })}
                        disabled={processing || !f.status.includes("ready") && f.status !== "failed"}
                      >
                        <SelectTrigger className="h-8 rounded-md bg-white/5 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {subjects?.map((s) => (
                            <SelectItem key={s._id} value={s._id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={f.grade}
                        onValueChange={(v) => updateFile(f.id, { grade: v })}
                        disabled={processing || (f.status !== "ready" && f.status !== "failed")}
                      >
                        <SelectTrigger className="h-8 rounded-md bg-white/5 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {GRADES.map((g) => (
                            <SelectItem key={g} value={g.toString()}>{g}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={f.contentType}
                        onValueChange={(v) => updateFile(f.id, { contentType: v })}
                        disabled={processing || (f.status !== "ready" && f.status !== "failed")}
                      >
                        <SelectTrigger className="h-8 rounded-md bg-white/5 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTENT_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {f.contentType === "past_exam" ? (
                        <Input
                          type="number"
                          value={f.examYear}
                          onChange={(e) => updateFile(f.id, { examYear: e.target.value })}
                          placeholder="2024"
                          className="h-8 rounded-md bg-white/5 text-xs"
                          disabled={processing}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={f.isPremium}
                        onCheckedChange={(v) => updateFile(f.id, { isPremium: v })}
                        disabled={processing}
                      />
                    </TableCell>
                    <TableCell>
                      {!processing && !saving && (
                        <button
                          onClick={() => removeFile(f.id)}
                          className="text-muted-foreground hover:text-rose-300"
                        >
                          <X className="size-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Add more files button */}
          {!processing && !saving && (
            <div className="flex justify-center">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <FileText className="size-3.5" />
                Add more files
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
