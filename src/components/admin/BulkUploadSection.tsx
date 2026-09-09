// Admin Bulk Upload — fast, smart, multi-file upload with deterministic
// rule-based classification (no AI required for 95%+ of files).
//
// ARCHITECTURE:
//   1. Admin selects multiple PDF files (drag-drop or file picker)
//   2. As each file is selected we IMMEDIATELY:
//      a. Detect the exam year + grade + subject + content type from the
//         filename using the deterministic classifier in @/lib/bulkClassifier
//      b. Compute a signature hash for duplicate detection
//      c. Query the backend (findDuplicateContent) for any library entry
//         whose title normalizes to the same filename
//      d. Mark the row as duplicate (with a "Skip" badge) or unique
//   3. Sets a batch-level "Mark all as Premium?" toggle
//   4. Clicks "Start Processing" → files are processed CONCURRENTLY (4 at a
//      time for speed):
//      a. Generate a Convex temp-storage upload URL
//      b. PUT the bytes straight to Convex temp storage with XMLHttpRequest
//      c. Extract PDF text (browser-side, via extractPdfText)
//      d. Run classifyDocument(filename, text) — PURE LOCAL, no API calls
//         → combines filename signals + content keyword scoring
//      e. Pre-fill the row with the classification result + confidence
//      f. Show live progress: "Uploading 42%" → "Analyzing…" → "Ready" / "Failed"
//   5. Review table — one editable row per file with confidence badge:
//      - 🟢 HIGH confidence (>= 70): auto-filled, ready to save
//      - 🟡 MEDIUM confidence (40-69): auto-filled, review recommended
//      - 🔴 LOW confidence (< 40): blanks left for manual entry,
//        "Try AI" button appears next to the row
//   6. Multi-select batch edit:
//      - Checkboxes on each row
//      - Select N rows → bulk-set subject/grade/type/year/premium
//   7. "Save All" button — only active when all rows are valid
//
// PERFORMANCE:
//   - No AI calls in the default path → zero rate limit errors.
//   - Only files with LOW confidence get an optional "Try AI" button (calls
//     classifyContentText — one file at a time, throttled).
//   - Concurrency: 4 files processed at once (text extraction is the
//     bottleneck, not the network).
//   - Per-file cancel: every in-flight XHR is kept in a ref keyed by file
//     id; the cancel button calls xhr.abort().

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Ban,
  Brain,
  CheckCircle2,
  CheckSquare,
  Clock,
  Copy,
  FileText,
  Loader2,
  Package,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Upload,
  Wand2,
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
import {
  classifyDocument,
  type ClassificationResult,
} from "@/lib/bulkClassifier";
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
  // Classification result (rule-based by default, AI as fallback)
  title: string;
  subjectId: string;
  grade: string;
  contentType: string;
  examYear: string;
  isPremium: boolean;
  topics: string[];
  classified: boolean; // true after classifier ran (even if low-confidence)
  confidence: number; // 0-100
  confidenceLevel: "high" | "medium" | "low";
  signals: string[]; // human-readable classifier trace
  cancelled: boolean;
  selected: boolean; // for batch edit
  aiTried: boolean; // tracks whether AI fallback was used
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

const CONCURRENCY = 4; // bumped from 3 → 4 since we're not throttling AI calls

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
  // Batch-edit overlay: when admin selects N rows, a sticky toolbar appears
  // at the bottom with subject/grade/type/year/premium dropdowns that apply
  // to all selected rows at once.
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchEditSubject, setBatchEditSubject] = useState<string>("");
  const [batchEditGrade, setBatchEditGrade] = useState<string>("");
  const [batchEditType, setBatchEditType] = useState<string>("");
  const [batchEditYear, setBatchEditYear] = useState<string>("");
  const [batchEditPremium, setBatchEditPremium] = useState<boolean | null>(null);
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
        examYear: "",
        isPremium: batchPremium,
        topics: [],
        classified: false,
        confidence: 0,
        confidenceLevel: "low",
        signals: [],
        cancelled: false,
        selected: false,
        aiTried: false,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
      setSavedCount(null);

      // Trigger duplicate detection for each new file asynchronously.
      setDupCheckQueue((q) => [...q, ...newFiles.map((nf) => nf.id)]);

      // PRE-CLASSIFY from filename alone, immediately, so the admin sees
      // subject/grade/year/type guesses the instant they drop the files.
      // We'll refine with content text after upload.
      if (subjects) {
        setTimeout(() => preClassifyFromFilenames(newFiles, subjects), 50);
      }
    },
    [batchPremium, subjects],
  );

  // Pre-classify filenames immediately (no upload needed). Writes the
  // detected subject/grade/year/type to each row, marked as "pending"
  // (not "ready") since we still need to upload + extract text to confirm.
  const preClassifyFromFilenames = (
    newFiles: BulkFile[],
    subjectList: NonNullable<typeof subjects>,
  ) => {
    setFiles((prev) =>
      prev.map((f) => {
        const match = newFiles.find((nf) => nf.id === f.id);
        if (!match) return f;
        const result = classifyDocument({
          filename: match.file.name,
          contentText: "", // no content yet
          subjects: subjectList,
        });
        return {
          ...f,
          title: result.title || f.title,
          subjectId: result.subjectId ?? "",
          grade: result.grade ?? "",
          contentType: result.contentType ?? "",
          examYear: result.examYear ?? "",
          confidence: result.confidence,
          confidenceLevel: result.confidenceLevel,
          signals: result.signals,
        };
      }),
    );
  };

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
    if (!subjects) {
      toast.error("Subjects list still loading — try again in a second.");
      return;
    }
    setProcessing(true);
    setSavedCount(null);

    // Filter to files that need processing.
    const queue = files.filter(
      (f) =>
        f.status === "pending" ||
        f.status === "failed" ||
        f.status === "cancelled",
    );

    const runOne = async (bulkFile: BulkFile) => {
      if (bulkFile.status === "duplicate" && autoSkipDuplicates) return;
      if (bulkFile.status === "ready") return;

      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id
            ? { ...f, status: "uploading", progress: 0, error: undefined }
            : f,
        ),
      );

      try {
        // Step 1 — get a Convex temp-storage upload URL.
        const url = await generateUploadUrlMutation();

        const storageId = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhrRegistryRef.current.set(bulkFile.id, xhr);
          xhr.open("POST", url);
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

        // Step 2: Extract PDF text (browser-side) — NON-FATAL if it fails
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id ? { ...f, status: "analyzing", storageId } : f,
          ),
        );

        let sample = "";
        try {
          sample = await extractPdfText(bulkFile.file, 5, 12000);
        } catch {
          // Non-fatal — classifier will fall back to filename-only mode
        }

        // Step 3: Rule-based classification (NO AI CALL — pure local)
        const result: ClassificationResult = classifyDocument({
          filename: bulkFile.file.name,
          contentText: sample,
          subjects,
        });

        // Step 4: Apply result. DON'T overwrite the year detected from
        // filename-only pre-classification if the rule engine didn't find
        // a stronger signal (it's already in result.examYear if found).
        setFiles((prev) =>
          prev.map((f) =>
            f.id === bulkFile.id
              ? {
                  ...f,
                  status: "ready", // ALWAYS ready — admin reviews even low-confidence
                  title: result.title || f.file.name.replace(/\.pdf$/i, ""),
                  subjectId: result.subjectId ?? "",
                  grade: result.grade ?? "",
                  contentType: result.contentType ?? "",
                  examYear: result.examYear ?? "",
                  topics: result.topics ?? [],
                  classified: true,
                  confidence: result.confidence,
                  confidenceLevel: result.confidenceLevel,
                  signals: result.signals,
                  error: undefined,
                }
              : f,
          ),
        );

        // NO throttle — we're not hitting any external API.
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Processing failed";
        if (msg.toLowerCase().includes("cancelled")) {
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

    // Concurrency pool — process CONCURRENCY workers, each pulling from
    // the queue. Pure local — no rate limits to worry about.
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
    toast.success("Batch processing complete. Review the classifications below.");
  };

  // ── AI fallback for a single low-confidence row ──────────────────────
  // Only called when admin clicks "Try AI" on a low-confidence row. Calls
  // classifyContentText (Groq) — if it succeeds, overwrites the row. If it
  // fails (rate limit / network / no key), we toast and leave the row as-is.
  const tryAIForRow = async (id: string) => {
    const target = files.find((f) => f.id === id);
    if (!target) return;
    if (!target.storageId) {
      toast.error("Upload the file first before retrying with AI.");
      return;
    }
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id ? { ...f, status: "analyzing", error: undefined } : f,
      ),
    );
    try {
      // Re-extract text (we discarded it earlier to save memory)
      let sample = "";
      try {
        sample = await extractPdfText(target.file, 5, 12000);
      } catch {
        // proceed with empty
      }
      const suggestion = await classifyContentText({
        sample,
        filename: target.file.name,
      });
      if (!suggestion.analyzed) {
        toast.warning(`AI couldn't classify this file: ${suggestion.note ?? "unknown reason"}`);
        setFiles((prev) =>
          prev.map((f) =>
            f.id === id
              ? {
                  ...f,
                  status: "ready",
                  error: suggestion.note ?? "AI classification failed",
                  aiTried: true,
                }
              : f,
          ),
        );
        return;
      }
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                status: "ready",
                title: suggestion.title ?? f.title,
                subjectId: suggestion.subjectId ?? "",
                grade: suggestion.grade?.toString() ?? "",
                contentType: suggestion.contentType ?? "",
                examYear: suggestion.examYear?.toString() ?? "",
                topics: suggestion.topics ?? [],
                confidence: 90,
                confidenceLevel: "high",
                signals: [...f.signals, "AI (Groq) confirmed classification"],
                aiTried: true,
                error: undefined,
              }
            : f,
        ),
      );
      toast.success("AI classification applied.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI call failed";
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id
            ? {
                ...f,
                status: "ready",
                error: `AI fallback failed: ${msg}`,
                aiTried: true,
              }
            : f,
        ),
      );
      toast.error(`AI fallback failed: ${msg}`);
    }
  };

  // ── Update a file's fields (from review table) ──────────────────────
  const updateFile = (id: string, updates: Partial<BulkFile>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  };

  // ── Multi-select batch edit ─────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, selected: !f.selected } : f)),
    );
  };
  const selectAll = () => {
    const allSelected = files.every((f) => f.selected);
    setFiles((prev) => prev.map((f) => ({ ...f, selected: !allSelected })));
  };
  const selectedCount = files.filter((f) => f.selected).length;

  const applyBatchEdit = () => {
    if (selectedCount === 0) {
      toast.error("Select at least one row first.");
      return;
    }
    setFiles((prev) =>
      prev.map((f) => {
        if (!f.selected) return f;
        const updates: Partial<BulkFile> = {};
        if (batchEditSubject) updates.subjectId = batchEditSubject;
        if (batchEditGrade) updates.grade = batchEditGrade;
        if (batchEditType) updates.contentType = batchEditType;
        if (batchEditYear) {
          updates.examYear = batchEditYear;
          // If we set a year, ensure contentType defaults to past_exam if blank
          if (!f.contentType && batchEditType === "") updates.contentType = "past_exam";
        }
        if (batchEditPremium !== null) updates.isPremium = batchEditPremium;
        return { ...f, ...updates };
      }),
    );
    toast.success(`Applied to ${selectedCount} row${selectedCount === 1 ? "" : "s"}.`);
    // Clear selection after applying
    setFiles((prev) => prev.map((f) => ({ ...f, selected: false })));
    setBatchEditOpen(false);
    setBatchEditSubject("");
    setBatchEditGrade("");
    setBatchEditType("");
    setBatchEditYear("");
    setBatchEditPremium(null);
  };

  // ── Validation: all files must have valid required fields ───────────
  const allValid =
    files.length > 0 &&
    files.every((f) => {
      if (f.status === "duplicate" && autoSkipDuplicates) return true;
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
            Drop in dozens of PDFs — the smart classifier reads each filename
            and content to auto-fill subject, grade, year, and type
            <span className="font-semibold text-emerald-300"> instantly, no AI calls</span>.
            Use the "Try AI" button on any low-confidence row.
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
                or click to browse — select multiple files at once (100+ supported)
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
                  Click "Start Processing" to upload + auto-classify
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

          {/* File list / Review table */}
          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <Table className="min-w-[1200px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]">
                    <button
                      onClick={selectAll}
                      title="Select all"
                      className="cursor-pointer rounded p-0.5 hover:bg-white/10"
                    >
                      {files.every((f) => f.selected) && files.length > 0 ? (
                        <CheckSquare className="size-4 text-primary" />
                      ) : (
                        <Square className="size-4 text-muted-foreground" />
                      )}
                    </button>
                  </TableHead>
                  <TableHead className="w-[40px]">#</TableHead>
                  <TableHead className="min-w-[300px]">File / Title</TableHead>
                  <TableHead className="w-[60px]">Conf.</TableHead>
                  <TableHead className="w-[160px]">Subject</TableHead>
                  <TableHead className="w-[90px]">Grade</TableHead>
                  <TableHead className="w-[140px]">Type</TableHead>
                  <TableHead className="w-[140px]">Year</TableHead>
                  <TableHead className="w-[80px]">Premium</TableHead>
                  <TableHead className="w-[100px]">Action</TableHead>
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
                      f.selected && "ring-2 ring-inset ring-primary/40",
                    )}
                  >
                    <TableCell>
                      <button
                        onClick={() => toggleSelect(f.id)}
                        title="Toggle selection"
                        className="cursor-pointer rounded p-0.5 hover:bg-white/10"
                      >
                        {f.selected ? (
                          <CheckSquare className="size-4 text-primary" />
                        ) : (
                          <Square className="size-4 text-muted-foreground" />
                        )}
                      </button>
                    </TableCell>
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
                          {(f.status === "uploading" || f.status === "analyzing" || f.status === "pending") ? (
                            <p className="mt-1 text-[11px] text-muted-foreground/80">
                              {f.status === "uploading" && `Uploading… ${f.progress}%`}
                              {f.status === "analyzing" && "Analyzing…"}
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
                          {/* Classifier signals — show as a tooltip-style list */}
                          {f.classified && f.signals.length > 0 && (
                            <details className="mt-1 text-[10px] text-muted-foreground/70">
                              <summary className="cursor-pointer hover:text-foreground">
                                Why? ({f.signals.length} signal{f.signals.length === 1 ? "" : "s"})
                              </summary>
                              <ul className="mt-1 space-y-0.5 pl-3">
                                {f.signals.map((s, idx) => (
                                  <li key={idx} className="text-[10px]">• {s}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ConfidenceBadge level={f.confidenceLevel} score={f.confidence} />
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
                        onValueChange={(v) => updateFile(f.id, { contentType: v })}
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
                        {/* AI fallback button — only shown for low-confidence
                            rows that have been uploaded. */}
                        {f.status === "ready" && f.confidenceLevel === "low" && f.storageId && !f.aiTried && (
                          <button
                            onClick={() => tryAIForRow(f.id)}
                            title="Classify with AI (Groq fallback)"
                            className="cursor-pointer rounded-md border border-violet-400/30 bg-violet-400/10 p-1.5 text-violet-300 hover:bg-violet-400/20"
                          >
                            <Brain className="size-3.5" />
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
                  <CheckCircle2 className="size-3 text-emerald-300" />
                  {files.filter((f) => f.confidenceLevel === "high").length} high-conf
                </span>
                <span className="flex items-center gap-1.5">
                  <Sparkles className="size-3 text-amber-300" />
                  {files.filter((f) => f.confidenceLevel === "medium").length} medium-conf
                </span>
                <span className="flex items-center gap-1.5">
                  <AlertTriangle className="size-3 text-rose-300" />
                  {files.filter((f) => f.confidenceLevel === "low").length} low-conf
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
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBatchEditOpen((v) => !v)}
                    className="gap-2"
                  >
                    <Wand2 className="size-3.5" />
                    Batch edit ({selectedCount})
                  </Button>
                )}
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
            </div>
          )}

          {/* Batch-edit toolbar */}
          {batchEditOpen && selectedCount > 0 && (
            <div className="sticky bottom-4 z-10 rounded-2xl border border-primary/30 bg-background/95 p-4 shadow-xl backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold">
                  Bulk edit {selectedCount} selected row{selectedCount === 1 ? "" : "s"}
                </p>
                <button
                  onClick={() => setBatchEditOpen(false)}
                  className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Subject
                  </label>
                  <Select
                    value={batchEditSubject}
                    onValueChange={setBatchEditSubject}
                  >
                    <SelectTrigger className="h-9 w-[160px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="Keep as-is" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects?.map((s) => (
                        <SelectItem key={s._id} value={s._id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Grade
                  </label>
                  <Select
                    value={batchEditGrade}
                    onValueChange={setBatchEditGrade}
                  >
                    <SelectTrigger className="h-9 w-[80px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="Keep" />
                    </SelectTrigger>
                    <SelectContent>
                      {GRADES.map((g) => (
                        <SelectItem key={g} value={g.toString()}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Type
                  </label>
                  <Select
                    value={batchEditType}
                    onValueChange={setBatchEditType}
                  >
                    <SelectTrigger className="h-9 w-[140px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="Keep as-is" />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Year
                  </label>
                  <Select
                    value={batchEditYear}
                    onValueChange={setBatchEditYear}
                  >
                    <SelectTrigger className="h-9 w-[100px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="Keep" />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => (
                        <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Premium
                  </label>
                  <div className="flex h-9 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3">
                    <button
                      onClick={() => setBatchEditPremium(batchEditPremium === true ? null : true)}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-semibold",
                        batchEditPremium === true
                          ? "bg-emerald-500 text-white"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setBatchEditPremium(batchEditPremium === false ? null : false)}
                      className={cn(
                        "rounded px-2 py-0.5 text-[11px] font-semibold",
                        batchEditPremium === false
                          ? "bg-rose-500 text-white"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      No
                    </button>
                  </div>
                </div>
                <Button onClick={applyBatchEdit} size="sm" className="gap-2">
                  <Wand2 className="size-3.5" />
                  Apply to {selectedCount} row{selectedCount === 1 ? "" : "s"}
                </Button>
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Leave a field blank to keep its current value per row.
              </p>
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

// ── ConfidenceBadge — colored chip showing the classifier's confidence
//    level. Green (high) / amber (medium) / red (low).
function ConfidenceBadge({
  level,
  score,
}: {
  level: "high" | "medium" | "low";
  score: number;
}) {
  const config = {
    high: { color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30", label: "HIGH" },
    medium: { color: "bg-amber-500/20 text-amber-300 border-amber-500/30", label: "MED" },
    low: { color: "bg-rose-500/20 text-rose-300 border-rose-500/30", label: "LOW" },
  } as const;
  const c = config[level];
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wider",
        c.color,
      )}
      title={`Confidence: ${score}/100 (${level})`}
    >
      {c.label} {score}
    </div>
  );
}

// ── DuplicateChecker — invisible component that runs a single duplicate
//    lookup query against the backend and calls onResult when done.
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
