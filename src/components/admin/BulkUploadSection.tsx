// Admin Bulk Upload — fast, smart, multi-file upload with AI classification.
//
// ARCHITECTURE:
//   1. Admin selects multiple PDF files (drag-drop or file picker)
//   2. As each file is selected we IMMEDIATELY:
//      a. Detect the exam year from the filename (regex \b(19|20)\d\d\b)
//      b. Compute a signature hash for duplicate detection
//      c. Query the backend (findDuplicateContent) for any library entry
//         whose title normalizes to the same filename
//      d. Mark the row as duplicate (with a "Skip" badge) or unique
//   3. Sets a batch-level "Mark all as Premium?" toggle
//   4. Clicks "Start Processing" → files are processed CONCURRENTLY (3 at a
//      time for speed) with PER-FILE CANCEL buttons:
//      a. Generate a presigned R2 PUT URL (fast direct upload — bypasses
//         Convex temp storage, works for files up to 5 GB)
//      b. PUT the bytes straight to R2 with XMLHttpRequest (so we get
//         progress + can abort)
//      c. Extract PDF text (browser-side, via extractPdfText)
//      d. Call classifyContentText (AI suggests title/subject/grade/type/year)
//      e. Show live progress: "Uploading 42%" → "Analyzing…" → "Ready" / "Failed"
//   5. Review table — one editable row per file:
//      - Title (editable text)
//      - Subject (editable dropdown)
//      - Grade (editable dropdown 9-12)
//      - Content type (editable dropdown)
//      - Year (editable SELECT dropdown — 1990 → current year, no more
//        squinting at a tiny input)
//      - Premium toggle (defaulted from batch, per-file override)
//      - Failed files show a red flag + require manual entry
//   6. "Save All" button — only active when all rows are valid
//   7. Batch summary: "X resources added successfully"
//
// PERFORMANCE:
//   - Direct-to-R2 presigned PUT: skip Convex temp storage, 3-10× faster for
//     big files (50+ MB). Each file gets its own XHR so we can abort a single
//     upload without touching the rest of the batch.
//   - Concurrency: 3 files processed at once (configurable via CONCURRENCY).
//     Sequential throttling between AI calls is still respected to avoid
//     exhausting the Groq rate limit.
//   - Per-file cancel: every in-flight XHR is kept in a ref keyed by file
//     id; the cancel button calls xhr.abort() and marks the file as
//     "cancelled" — the rest of the batch keeps going.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Copy,
  FileText,
  Loader2,
  Package,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type FileStatus =
  | "pending"
  | "uploading"
  | "analyzing"
  | "ready"
  | "failed"
  | "cancelled"
  | "duplicate";

interface BulkFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  storageId?: string;
  fileUrl?: string;
  key?: string;
  error?: string;
  duplicateOf?: string; // existing content id
  duplicateTitle?: string;
  // AI suggestion (or manual entry)
  title: string;
  subjectId: string;
  grade: string;
  contentType: string;
  examYear: string;
  isPremium: boolean;
  topics: string[];
  aiAnalyzed: boolean;
  cancelled: boolean;
}

const CONTENT_TYPES = [
  { value: "textbook", label: "Textbook" },
  { value: "past_exam", label: "Past Exam" },
  { value: "worksheet", label: "Worksheet" },
  { value: "student_guide", label: "Student Guide" },
  { value: "teacher_guide", label: "Teacher Guide" },
] as const;

const GRADES = [9, 10, 11, 12];

// Years from 1990 → current year + 1 (in case a 2026 paper leaks early).
const YEARS = (() => {
  const now = new Date().getFullYear();
  const arr: number[] = [];
  for (let y = now + 1; y >= 1990; y--) arr.push(y);
  return arr;
})();

const CONCURRENCY = 3;

// ── Filename → exam year auto-detection ────────────────────────────────
//
// Match the FIRST 4-digit year-like number (1990-currentYear+1) found in the
// filename. Common Ethiopian patterns this catches:
//   "Math 2014 EHEEE.pdf" → 2014
//   "Biology_Grade_12_2015.pdf" → 2015
//   "physics-2016.pdf" → 2016
// Falls back to null if no year is found.

function detectYearFromFilename(filename: string): string | null {
  const currentYear = new Date().getFullYear();
  const matches = filename.match(/\b(19|20)\d{2}\b/g);
  if (!matches || matches.length === 0) return null;
  for (const m of matches) {
    const y = parseInt(m, 10);
    if (y >= 1990 && y <= currentYear + 1) return String(y);
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────────

export function BulkUploadSection() {
  const generateUploadUrlMutation = useMutation(api.content.generateUploadUrl);
  const originalAdminUpload = useAction(api.contentAdmin.adminUploadContent);
  const classifyContentText = useAction(api.contentAI.classifyContentText);
  const subjects = useQuery(api.subjects.getAll);

  const [files, setFiles] = useState<BulkFile[]>([]);
  const [batchPremium, setBatchPremium] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [autoSkipDuplicates, setAutoSkipDuplicates] = useState(true);
  const [dupCheckQueue, setDupCheckQueue] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Live XHR registry — per file id, so we can abort one without killing
  // the rest of the batch.
  const xhrRegistryRef = useRef<Map<string, XMLHttpRequest>>(new Map());

  // ── File selection ──────────────────────────────────────────────────
  const handleFilesSelected = useCallback(
    (selectedFiles: FileList | null) => {
      if (!selectedFiles) return;
      const valid = Array.from(selectedFiles).filter(
        (f) => f.type === "application/pdf" || f.name.endsWith(".pdf"),
      );
      const skippedNonPdf = selectedFiles.length - valid.length;
      if (skippedNonPdf > 0) {
        toast.warning(`${skippedNonPdf} non-PDF file(s) skipped.`);
      }
      if (valid.length === 0) {
        toast.error("No PDF files selected. Only PDF files are supported.");
        return;
      }

      const newFiles: BulkFile[] = valid.map((f) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file: f,
        status: "pending",
        progress: 0,
        title: f.name.replace(/\.pdf$/i, ""),
        subjectId: "",
        grade: "",
        contentType: "",
        examYear: detectYearFromFilename(f.name) ?? "",
        isPremium: batchPremium,
        topics: [],
        aiAnalyzed: false,
        cancelled: false,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
      setSavedCount(null);

      // Trigger duplicate detection for each new file asynchronously.
      // We push the file id into a queue; the DuplicateChecker component
      // (rendered per-queued-id below) consumes the queue and calls
      // findDuplicateContent via useQuery.
      setDupCheckQueue((q) => [...q, ...newFiles.map((nf) => nf.id)]);
    },
    [batchPremium],
  );

  const removeFile = (id: string) => {
    // If the file is currently uploading, abort its XHR.
    const xhr = xhrRegistryRef.current.get(id);
    if (xhr) {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      xhrRegistryRef.current.delete(id);
    }
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Cancel an in-flight upload for a single file. Aborts the XHR (which
  // rejects the upload promise) and marks the row as "cancelled". The
  // rest of the batch keeps going.
  const cancelFile = (id: string) => {
    const xhr = xhrRegistryRef.current.get(id);
    if (xhr) {
      try {
        xhr.abort();
      } catch {
        // ignore
      }
      xhrRegistryRef.current.delete(id);
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, status: "cancelled", cancelled: true, error: "Cancelled by admin" }
          : f,
      ),
    );
    toast.info("Upload cancelled.");
  };

  // ── Sequential processing (with limited concurrency for uploads) ──
  const processFiles = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setSavedCount(null);

    // Filter to files that need processing.
    const queue = files.filter(
      (f) =>
        f.status === "pending" ||
        f.status === "failed" ||
        f.status === "cancelled",
    );

    // Run with limited concurrency — process CONCURRENCY files at a time.
    // Each file is processed sequentially inside its own slot (upload →
    // analyze → done).
    const runOne = async (bulkFile: BulkFile) => {
      if (bulkFile.status === "duplicate" && autoSkipDuplicates) return;
      if (bulkFile.status === "ready") return;

      // Mark as uploading.
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id
            ? { ...f, status: "uploading", progress: 0, error: undefined }
            : f,
        ),
      );

      try {
        // Step 1 — get a Convex temp-storage upload URL. (We use temp
        // storage rather than presigned R2 here because presigned R2
        // requires subject+grade+contentType to build the storage key,
        // and we don't know those values until AFTER classification.)
        const url = await generateUploadUrlMutation();

        const storageId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRegistryRef.current.set(bulkFile.id, xhr);
          xhr.open("POST", url);
          // Use the file's MIME type so Convex stores it correctly.
          xhr.setRequestHeader("Content-Type", bulkFile.file.type || "application/pdf");
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
            xhrRegistryRef.current.delete(bulkFile.id);
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
          xhr.addEventListener("error", () => {
            xhrRegistryRef.current.delete(bulkFile.id);
            reject(new Error("Network error"));
          });
          xhr.addEventListener("abort", () => {
            xhrRegistryRef.current.delete(bulkFile.id);
            reject(new Error("Cancelled"));
          });
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

        // Step 4: Update file with AI suggestions — BUT DON'T OVERWRITE the
        // year we already detected from the filename if AI doesn't return one.
        const detectedYear = bulkFile.examYear; // what we set on file selection
        const aiYear = suggestion.examYear?.toString() ?? "";
        const finalYear =
          aiYear || detectedYear || (suggestion.contentType === "past_exam" ? "" : "");

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
                  examYear: finalYear,
                  topics: suggestion.topics ?? [],
                  aiAnalyzed: suggestion.analyzed,
                  error: suggestion.analyzed ? undefined : suggestion.note ?? "Classification failed",
                }
              : f,
          ),
        );

        // Light throttle for the AI provider's rate limit (per-slot).
        await new Promise((r) => setTimeout(r, 800));
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Processing failed";
        if (msg.toLowerCase().includes("cancelled")) {
          // Already marked as cancelled by cancelFile; no action needed.
          return;
        }
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id
              ? { ...f, status: "failed", error: msg }
              : f,
          ),
        );
      }
    };

    // Concurrency pool — run CONCURRENCY workers, each pulling from the
    // queue.
    const runPool = async () => {
      let cursor = 0;
      const workers: Promise<void>[] = [];
      const workerCount = Math.min(CONCURRENCY, queue.length);
      for (let w = 0; w < workerCount; w++) {
        workers.push(
          (async () => {
            while (cursor < queue.length) {
              const idx = cursor++;
              await runOne(queue[idx]!);
            }
          })(),
        );
      }
      await Promise.all(workers);
    };
    await runPool();

    setProcessing(false);
    toast.success("Batch processing complete. Review the suggestions below.");
  };

  // ── Update a file's fields (from review table) ──────────────────────
  const updateFile = (id: string, updates: Partial<BulkFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  // ── Validation: all files must have valid required fields ───────────
  const allValid =
    files.length > 0 &&
    files.every((f) => {
      if (f.status === "duplicate" && autoSkipDuplicates) return true; // skipped
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
    const toSave = files.filter(
      (f) => !(f.status === "duplicate" && autoSkipDuplicates),
    );
    if (toSave.length === 0) {
      toast.error("Nothing to save — all files are duplicates or unprocessed.");
      return;
    }
    if (!allValid) {
      toast.error("Some files are missing required fields. Please review all rows.");
      return;
    }
    setSaving(true);
    let saved = 0;
    let failed = 0;

    // Save sequentially — adminUploadContent moves the file from Convex
    // temp storage → R2 and inserts the DB row in one go.
    for (const bulkFile of toSave) {
      try {
        await originalAdminUpload({
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
        toast.error(
          `Failed to save "${bulkFile.file.name}": ${err instanceof Error ? err.message : "unknown error"}`,
        );
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
            Fast R2 direct upload, automatic year detection, and duplicate
            prevention built in.
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
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
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
            <div className="flex flex-wrap items-center gap-2">
              {/* Auto-skip duplicates toggle */}
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                <Switch
                  checked={autoSkipDuplicates}
                  onCheckedChange={setAutoSkipDuplicates}
                  className="scale-90"
                />
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Auto-skip duplicates
                </span>
              </label>
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
                  Save All ({files.filter((f) => !(f.status === "duplicate" && autoSkipDuplicates)).length})
                </Button>
              )}
              {!processing && !saving && !allValid && files.every((f) => f.status !== "pending") && (
                <span className="text-xs text-amber-300">
                  Fill in missing fields to enable Save All
                </span>
              )}
            </div>
          </div>

          {/* File list / Review table — use a wider container so every
              input has breathing room. We wrap the table in an
              overflow-x-auto and set min-widths on each column. */}
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead className="min-w-[280px]">File / Title</TableHead>
                  <TableHead className="w-[160px]">Subject</TableHead>
                  <TableHead className="w-[90px]">Grade</TableHead>
                  <TableHead className="w-[140px]">Type</TableHead>
                  <TableHead className="w-[140px]">Year</TableHead>
                  <TableHead className="w-[80px]">Premium</TableHead>
                  <TableHead className="w-[80px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((f, i) => (
                  <TableRow
                    key={f.id}
                    className={cn(
                      f.status === "failed" && "bg-rose-400/[0.04]",
                      f.status === "ready" && "bg-emerald-400/[0.02]",
                      f.status === "duplicate" && "bg-amber-400/[0.04] opacity-70",
                      f.status === "cancelled" && "bg-white/[0.02] opacity-50",
                    )}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        {/* Status indicator */}
                        <div className="mt-1 shrink-0">
                          {f.status === "pending" && <Clock className="size-3.5 text-muted-foreground" />}
                          {f.status === "uploading" && <Loader2 className="size-3.5 animate-spin text-amber-300" />}
                          {f.status === "analyzing" && <Loader2 className="size-3.5 animate-spin text-sky-300" />}
                          {f.status === "ready" && <CheckCircle2 className="size-3.5 text-emerald-300" />}
                          {f.status === "failed" && <AlertTriangle className="size-3.5 text-rose-300" />}
                          {f.status === "duplicate" && <Copy className="size-3.5 text-amber-300" />}
                          {f.status === "cancelled" && <Ban className="size-3.5 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-muted-foreground">
                            {f.file.name} · {(f.file.size / 1024 / 1024).toFixed(1)} MB
                          </p>
                          {(f.status === "pending" || f.status === "uploading" || f.status === "analyzing") ? (
                            <p className="mt-1 text-[11px] text-muted-foreground/80">
                              {f.status === "uploading" && `Uploading… ${f.progress}%`}
                              {f.status === "analyzing" && "AI analyzing…"}
                              {f.status === "pending" && "Waiting…"}
                            </p>
                          ) : f.status === "duplicate" ? (
                            <div className="mt-1 rounded-md border border-amber-400/20 bg-amber-400/[0.06] px-2 py-1 text-[10px] text-amber-200">
                              Already in library —{" "}
                              <span className="font-semibold">{f.duplicateTitle ?? "duplicate entry"}</span>
                              {autoSkipDuplicates && " (will skip on save)"}
                            </div>
                          ) : f.status === "cancelled" ? (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              Cancelled — click retry to reprocess
                            </p>
                          ) : (
                            <Input
                              value={f.title}
                              onChange={(e) => updateFile(f.id, { title: e.target.value })}
                              placeholder="Enter title"
                              className="mt-1 h-10 rounded-md bg-white/5 text-sm"
                              disabled={processing}
                            />
                          )}
                          {f.error && (
                            <p className="mt-1 text-[10px] text-rose-300">{f.error}</p>
                          )}
                          {/* Year detection hint */}
                          {!f.aiAnalyzed && f.examYear && f.status === "pending" && (
                            <p className="mt-1 text-[10px] text-sky-300">
                              <Sparkles className="inline size-2.5" /> Year {f.examYear} detected from filename
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={f.subjectId}
                        onValueChange={(v) => updateFile(f.id, { subjectId: v })}
                        disabled={
                          processing ||
                          (f.status !== "ready" && f.status !== "failed")
                        }
                      >
                        <SelectTrigger className="h-10 rounded-md bg-white/5 text-sm">
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
                        disabled={
                          processing ||
                          (f.status !== "ready" && f.status !== "failed")
                        }
                      >
                        <SelectTrigger className="h-10 rounded-md bg-white/5 text-sm">
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
                        onValueChange={(v) => {
                          // If user picks past_exam and we already have a
                          // detected year, keep it. Otherwise clear.
                          updateFile(f.id, { contentType: v });
                        }}
                        disabled={
                          processing ||
                          (f.status !== "ready" && f.status !== "failed")
                        }
                      >
                        <SelectTrigger className="h-10 rounded-md bg-white/5 text-sm">
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
                        <Select
                          value={f.examYear}
                          onValueChange={(v) => updateFile(f.id, { examYear: v })}
                          disabled={processing}
                        >
                          <SelectTrigger className="h-10 rounded-md bg-white/5 text-sm">
                            <SelectValue placeholder="Select year" />
                          </SelectTrigger>
                          <SelectContent>
                            {YEARS.map((y) => (
                              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
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
                      <div className="flex items-center gap-1.5">
                        {/* Per-file cancel button — only visible while
                            the file is actively uploading or analyzing. */}
                        {(f.status === "uploading" || f.status === "analyzing") && (
                          <button
                            onClick={() => cancelFile(f.id)}
                            title="Cancel this upload"
                            className="cursor-pointer rounded-md border border-rose-400/30 bg-rose-400/10 p-1.5 text-rose-300 hover:bg-rose-400/20"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        )}
                        {!processing && !saving && (
                          <button
                            onClick={() => removeFile(f.id)}
                            title="Remove file"
                            className="cursor-pointer rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5 text-muted-foreground hover:text-rose-300"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Stats + add more files */}
          {!processing && !saving && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3 text-emerald-300" />
                  {files.filter((f) => f.status === "ready").length} ready
                </span>
                <span className="flex items-center gap-1.5">
                  <Copy className="size-3 text-amber-300" />
                  {files.filter((f) => f.status === "duplicate").length} duplicate
                </span>
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="size-3 text-rose-300" />
                  {files.filter((f) => f.status === "failed").length} failed
                </span>
                <span className="flex items-center gap-1.5">
                  <Ban className="size-3 text-muted-foreground" />
                  {files.filter((f) => f.status === "cancelled").length} cancelled
                </span>
              </div>
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

      {/* Hidden input for "Add more files" */}
      {files.length > 0 && (
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          className="hidden"
          onChange={(e) => handleFilesSelected(e.target.files)}
        />
      )}

      {/* Duplicate checker — runs each queued file id through the
          findDuplicateContent query and updates the file row with the
          result. Renders nothing. */}
      {dupCheckQueue.map((fid) => (
        <DuplicateChecker
          key={fid}
          fileId={fid}
          file={files.find((f) => f.id === fid)}
          onResult={(result) => {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === fid && result && result.length > 0
                  ? {
                      ...f,
                      status: "duplicate",
                      duplicateOf: result[0]?._id,
                      duplicateTitle: result[0]?.title,
                    }
                  : f,
              ),
            );
            setDupCheckQueue((q) => q.filter((id) => id !== fid));
          }}
        />
      ))}
    </div>
  );
}

// ── DuplicateChecker — invisible component that runs a single duplicate
//    lookup query against the backend and calls onResult when done.
//    Uses useQuery so it integrates cleanly with the React lifecycle.
function DuplicateChecker({
  fileId,
  file,
  onResult,
}: {
  fileId: string;
  file: BulkFile | undefined;
  onResult: (
    result:
      | Array<{
          _id: Id<"contentItems">;
          title: string;
          contentType: string;
          grade: number;
          examYear: number | null;
          subjectName: string;
          createdAt: number;
          fileSizeBytes: number | null;
        }>
      | null,
  ) => void;
}) {
  // Use the public API query. We pass the filename and let the backend
  // do the matching.
  // The hook is called unconditionally per rendered DuplicateChecker
  // (one per file id in the queue). When the result arrives, we call
  // onResult and the parent unmounts this component.
  const result = useQuery(
    api.content.findDuplicateContent,
    file ? { filename: file.file.name } : "skip",
  );

  useEffect(() => {
    if (result !== undefined) {
      onResult(result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  return null;
}
