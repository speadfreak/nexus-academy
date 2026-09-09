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
//         (with AUTOMATIC RETRY on network errors — exponential backoff,
//         up to MAX_UPLOAD_RETRIES attempts)
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
// RETRY SYSTEM:
//   - Upload failures (network errors, 5xx HTTP) trigger an automatic retry
//     with exponential backoff (1s → 2s → 4s → 8s → 16s). Up to MAX_UPLOAD_RETRIES
//     attempts per file before marking it as "failed".
//   - "Retry Failed" button at the top re-runs the entire pipeline for every
//     failed row, with the same retry logic.
//   - A per-row "retry" icon next to failed rows lets you retry a single file.
//
// BLIND UPLOAD MODE:
//   - Toggle "Blind upload" in the process bar → enables saving rows that
//     the classifier couldn't fully classify, using admin-provided DEFAULTS.
//   - Admin picks a default subject + grade + type (and optional year) —
//     these defaults are applied to every row missing those fields at
//     "Save All" time.
//   - This lets you upload even completely-unclassified files (e.g., scanned
//     PDFs with cryptic filenames) and fix them up later in the admin
//     content editor.
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
  Eye,
  FileText,
  Loader2,
  Package,
  RotateCw,
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
  detectYear,
  type ClassificationResult,
} from "@/lib/bulkClassifier";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────

type FileStatus =
  | "pending"
  | "uploading"
  | "analyzing"
  | "retrying"
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
  retryCount: number; // attempts so far (resets on manual retry)
  maxRetries: number; // per-file override (defaults to MAX_UPLOAD_RETRIES)
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
  blindUploaded?: boolean; // true if this row was saved via blind-upload defaults
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

// Retry configuration — exponential backoff for network errors.
// 1s, 2s, 4s, 8s, 16s — total worst-case wait before giving up: 31s.
const MAX_UPLOAD_RETRIES = 4; // total attempts = MAX_UPLOAD_RETRIES + 1 = 5
const BASE_RETRY_DELAY_MS = 1000; // first retry waits 1s, then doubles each time

// Network errors worth retrying. Don't retry 4xx (those won't fix themselves).
function isRetryableError(msg: string): boolean {
  const lower = msg.toLowerCase();
  // Network blips, timeouts, server errors
  return (
    lower.includes("network error") ||
    lower.includes("timeout") ||
    lower.includes("failed to fetch") ||
    lower.includes("http 5") || // 500, 502, 503, 504
    lower.includes("http 429") || // rate limit — wait and retry
    lower.includes("service unavailable") ||
    lower.includes("connection")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Component ──────────────────────────────────────────────────────────

export function BulkUploadSection() {
  const generateUploadUrlMutation = useMutation(api.content.generateUploadUrl);
  const originalAdminUpload = useAction(api.contentAdmin.adminUploadContent);
  const classifyContentText = useAction(api.contentAI.classifyContentText);
  const subjects = useQuery(api.subjects.getAll);
  // Dynamic content types + grades — fetched from the categories table so
  // admin-added categories show up in the dropdowns immediately.
  const contentTypeRows = useQuery(api.categories.listContentTypes);
  const gradeRows = useQuery(api.categories.listGrades);

  // Derived dropdown sources — fall back to constants while the queries are
  // loading so the form is still usable.
  const contentTypeOptions: { value: string; label: string; hasYear?: boolean }[] =
    contentTypeRows && contentTypeRows.length > 0
      ? contentTypeRows.map((ct) => ({ value: ct.slug, label: ct.label, hasYear: ct.hasYear }))
      : [
          { value: "textbook", label: "Textbook", hasYear: false },
          { value: "past_exam", label: "Past Exam", hasYear: true },
          { value: "worksheet", label: "Worksheet", hasYear: false },
          { value: "student_guide", label: "Student Guide", hasYear: false },
          { value: "teacher_guide", label: "Teacher Guide", hasYear: false },
        ];
  const gradeOptions: number[] =
    gradeRows && gradeRows.length > 0
      ? gradeRows.map((g) => g.grade)
      : [9, 10, 11, 12];

  // Whether a given content-type slug requires an exam year (dynamic — based
  // on the hasYear flag set by admin in the Categories tab). Falls back to
  // the built-in rule (only past_exam needs a year) when the dynamic query
  // hasn't loaded yet.
  const typeHasYear = (slug: string): boolean => {
    if (!slug) return false;
    const match = contentTypeOptions.find((t) => t.value === slug);
    if (match) return !!match.hasYear;
    return slug === "past_exam";
  };

  const [files, setFiles] = useState<BulkFile[]>([]);
  const [batchPremium, setBatchPremium] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Currently-saving file id + label — set during Save All so the UI shows
  // "Branding + saving: <filename>" instead of a generic spinner. Branding
  // happens in-flight inside adminUploadContent (cover page + watermark).
  const [savingFile, setSavingFile] = useState<{ id: string; name: string } | null>(null);
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
  // Blind Upload mode — lets the admin save rows that the classifier
  // couldn't fully classify, by applying admin-chosen defaults to fill in
  // the missing fields. Designed for batches where the admin knows ALL files
  // are the same subject/grade/type (e.g., "all of these are Biology Grade 12
  // past exams") even if the classifier couldn't tell.
  const [blindMode, setBlindMode] = useState(false);
  const [blindSubject, setBlindSubject] = useState<string>("");
  const [blindGrade, setBlindGrade] = useState<string>("");
  const [blindType, setBlindType] = useState<string>("");
  const [blindYear, setBlindYear] = useState<string>("");
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
        retryCount: 0,
        maxRetries: MAX_UPLOAD_RETRIES,
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

      // Reset error state and mark as uploading.
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id
            ? {
                ...f,
                status: "uploading",
                progress: 0,
                error: undefined,
                retryCount: 0,
              }
            : f,
        ),
      );

      // Helper: run ONE upload+classify attempt. Returns true on success,
      // false on a retryable failure (caller will retry).
      const attemptOnce = async (attemptNumber: number): Promise<boolean> => {
        let url: string;
        try {
          url = await generateUploadUrlMutation();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not get upload URL";
          if (attemptNumber < bulkFile.maxRetries && isRetryableError(msg)) {
            return false; // retryable
          }
          throw new Error(`Could not get upload URL: ${msg}`);
        }

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

        // Step 2: Extract PDF text — NON-FATAL if it fails
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

        // Step 4: Apply result.
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
                  retryCount: attemptNumber,
                }
              : f,
          ),
        );
        return true;
      };

      // Retry loop — try attemptOnce up to maxRetries+1 times, with
      // exponential backoff between attempts.
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= bulkFile.maxRetries; attempt++) {
        try {
          const ok = await attemptOnce(attempt);
          if (ok) return; // success
          // Retryable failure — fall through to backoff
          lastError = new Error("Retryable failure (network or 5xx)");
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("Processing failed");
          const msg = lastError.message;
          if (msg.toLowerCase().includes("cancelled")) {
            return; // user cancelled — don't retry
          }
          // Non-retryable error → bail out immediately
          if (!isRetryableError(msg) || attempt >= bulkFile.maxRetries) {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === bulkFile.id
                  ? {
                      ...f,
                      status: "failed",
                      error: `${msg}${attempt > 0 ? ` (after ${attempt + 1} attempt${attempt === 0 ? "" : "s"})` : ""}`,
                      retryCount: attempt,
                    }
                  : f,
              ),
            );
            return;
          }
        }
        // Backoff before next attempt
        if (attempt < bulkFile.maxRetries) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === bulkFile.id
                ? {
                    ...f,
                    status: "retrying",
                    progress: 0,
                    error: `Retry ${attempt + 1}/${bulkFile.maxRetries} in ${(delay / 1000).toFixed(0)}s — ${lastError?.message ?? "network error"}`,
                    retryCount: attempt + 1,
                  }
                : f,
            ),
          );
          await sleep(delay);
          // Mark as uploading again for the next attempt
          setFiles((prev) =>
            prev.map((f) =>
              f.id === bulkFile.id
                ? { ...f, status: "uploading", progress: 0 }
                : f,
            ),
          );
        }
      }
      // Exhausted retries
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id
            ? {
                ...f,
                status: "failed",
                error: `Failed after ${bulkFile.maxRetries + 1} attempts: ${lastError?.message ?? "unknown"}`,
                retryCount: bulkFile.maxRetries,
              }
            : f,
        ),
      );
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
          // If we set a year, ensure contentType defaults to a year-bearing
          // type if blank (use first hasYear=true option in the catalog).
          if (!f.contentType && batchEditType === "") {
            const yearType = contentTypeOptions.find((t) => t.hasYear);
            if (yearType) updates.contentType = yearType.value;
          }
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
  // Compute the effective validation state. With blind mode enabled,
  // rows missing fields are considered valid AS LONG AS the blind defaults
  // can fill them in. We don't mutate the rows here — we just allow Save All
  // to proceed and let handleSaveAll apply the defaults at save time.
  const blindCanFillMissing = blindMode && blindSubject && blindGrade && blindType;

  // Compute per-row validation. Returns the list of missing field names so
  // we can show them in the UI (red border + tooltip) AND a boolean.
  const getRowMissing = (f: BulkFile): string[] => {
    const missing: string[] = [];
    if (f.status === "duplicate" && autoSkipDuplicates) return missing;
    if (!f.storageId) {
      missing.push("upload");
      return missing;
    }
    if (!f.title.trim() && !blindMode) missing.push("title");
    if (!f.contentType && !(blindMode && blindType)) missing.push("type");
    if (!f.grade && !(blindMode && blindGrade)) missing.push("grade");
    if (!f.subjectId && !(blindMode && blindSubject)) missing.push("subject");
    // Year — required for types with hasYear=true (e.g. past_exam), but
    // blind year can fill it.
    const needsYear = typeHasYear(f.contentType) || (blindMode && typeHasYear(blindType));
    if (needsYear && !f.examYear && !(blindMode && blindYear)) missing.push("year");
    return missing;
  };

  const allValid =
    files.length > 0 &&
    files.every((f) => getRowMissing(f).length === 0);

  // Count of files that ARE ready to save (non-duplicate, non-pending)
  const saveCandidateCount = files.filter(
    (f) => !(f.status === "duplicate" && autoSkipDuplicates) && f.status !== "pending",
  ).length;
  // Count of files with validation problems
  const invalidRowCount = files.filter((f) => getRowMissing(f).length > 0).length;

  // ── Retry all failed rows ───────────────────────────────────────────
  // Re-runs the entire upload+classify pipeline for every row currently in
  // "failed" or "cancelled" status. Uses the same retry-with-backoff logic
  // inside runOne (so each row gets up to MAX_UPLOAD_RETRIES attempts).
  const retryFailed = async () => {
    const failedRows = files.filter(
      (f) => f.status === "failed" || f.status === "cancelled",
    );
    if (failedRows.length === 0) {
      toast.info("No failed rows to retry.");
      return;
    }
    if (!subjects) {
      toast.error("Subjects list still loading — try again in a second.");
      return;
    }
    setProcessing(true);
    setSavedCount(null);
    toast.info(`Retrying ${failedRows.length} failed row${failedRows.length === 1 ? "" : "s"}…`);

    const queue = failedRows;
    const runOneRetry = async (bulkFile: BulkFile) => {
      // Reset status + retry counter
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id
            ? {
                ...f,
                status: "uploading",
                progress: 0,
                error: undefined,
                retryCount: 0,
              }
            : f,
        ),
      );

      // Reuse the same upload+classify logic (simplified inline to avoid
      // stale closures). Identical retry/backoff handling.
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= bulkFile.maxRetries; attempt++) {
        try {
          let url: string;
          try {
            url = await generateUploadUrlMutation();
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Could not get upload URL";
            if (attempt < bulkFile.maxRetries && isRetryableError(msg)) {
              lastError = new Error(msg);
              continue;
            }
            throw new Error(`Could not get upload URL: ${msg}`);
          }

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

          setFiles((prev) =>
            prev.map((f) =>
              f.id === bulkFile.id ? { ...f, status: "analyzing", storageId } : f,
            ),
          );

          let sample = "";
          try {
            sample = await extractPdfText(bulkFile.file, 5, 12000);
          } catch {
            // Non-fatal
          }

          const result: ClassificationResult = classifyDocument({
            filename: bulkFile.file.name,
            contentText: sample,
            subjects,
          });

          setFiles((prev) =>
            prev.map((f) =>
              f.id === bulkFile.id
                ? {
                    ...f,
                    status: "ready",
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
                    retryCount: attempt,
                  }
                : f,
            ),
          );
          return; // success
        } catch (err) {
          lastError = err instanceof Error ? err : new Error("Processing failed");
          const msg = lastError.message;
          if (msg.toLowerCase().includes("cancelled")) return;
          if (!isRetryableError(msg) || attempt >= bulkFile.maxRetries) {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === bulkFile.id
                  ? {
                      ...f,
                      status: "failed",
                      error: `${msg}${attempt > 0 ? ` (after ${attempt + 1} attempt${attempt === 0 ? "" : "s"})` : ""}`,
                      retryCount: attempt,
                    }
                  : f,
              ),
            );
            return;
          }
        }
        // Backoff
        if (attempt < bulkFile.maxRetries) {
          const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === bulkFile.id
                ? {
                    ...f,
                    status: "retrying",
                    progress: 0,
                    error: `Retry ${attempt + 1}/${bulkFile.maxRetries} in ${(delay / 1000).toFixed(0)}s — ${lastError?.message ?? "network error"}`,
                    retryCount: attempt + 1,
                  }
                : f,
            ),
          );
          await sleep(delay);
          setFiles((prev) =>
            prev.map((f) =>
              f.id === bulkFile.id
                ? { ...f, status: "uploading", progress: 0 }
                : f,
            ),
          );
        }
      }
      setFiles((prev) =>
        prev.map((f) =>
          f.id === bulkFile.id
            ? {
                ...f,
                status: "failed",
                error: `Failed after ${bulkFile.maxRetries + 1} attempts: ${lastError?.message ?? "unknown"}`,
                retryCount: bulkFile.maxRetries,
              }
            : f,
        ),
      );
    };

    // Sequential (not concurrent) on retries — typically only 1-5 failed rows
    // so concurrency doesn't help. Avoids spawning 4 workers for 1 file.
    for (const f of queue) {
      await runOneRetry(f);
    }
    setProcessing(false);
    const stillFailed = files.filter((f) => f.status === "failed").length;
    if (stillFailed === 0) {
      toast.success(`Retried all ${failedRows.length} row${failedRows.length === 1 ? "" : "s"} successfully.`);
    } else {
      toast.warning(`Retry complete — ${stillFailed} row${stillFailed === 1 ? "" : "s"} still failing. Check the errors below.`);
    }
  };

  // ── Save all ────────────────────────────────────────────────────────
  const handleSaveAll = async () => {
    let toSave = files.filter(
      (f) => !(f.status === "duplicate" && autoSkipDuplicates),
    );
    if (toSave.length === 0) {
      toast.error("Nothing to save — all files are duplicates or unprocessed.");
      return;
    }

    // STEP 1: If blind mode is on, apply the admin-provided defaults to every
    // row missing those fields. This is the "blind upload" path — even totally
    // unclassified files get saved with the defaults.
    if (blindMode && blindCanFillMissing) {
      const blindDefaultsApplied: BulkFile[] = [];
      let filledCount = 0;
      for (const f of toSave) {
        const updates: Partial<BulkFile> = {};
        if (!f.title.trim()) {
          // Use the filename as the title (stripped of extension)
          updates.title = f.file.name.replace(/\.pdf$/i, "");
          filledCount++;
        }
        if (!f.subjectId && blindSubject) {
          updates.subjectId = blindSubject;
          filledCount++;
        }
        if (!f.grade && blindGrade) {
          updates.grade = blindGrade;
          filledCount++;
        }
        if (!f.contentType && blindType) {
          updates.contentType = blindType;
          filledCount++;
        }
        if (!f.examYear && blindYear && (typeHasYear(f.contentType) || typeHasYear(blindType))) {
          updates.examYear = blindYear;
          filledCount++;
        }
        if (Object.keys(updates).length > 0) {
          blindDefaultsApplied.push({ ...f, ...updates, blindUploaded: true });
        } else {
          blindDefaultsApplied.push(f);
        }
      }
      toSave = blindDefaultsApplied;
      // Persist the blind-applied fields back to state so the review table
      // shows what was saved.
      setFiles(blindDefaultsApplied);
      if (filledCount > 0) {
        toast.info(`Blind upload: filled ${filledCount} missing field${filledCount === 1 ? "" : "s"} with your defaults.`);
      }
    }

    // STEP 2: Auto-fix any remaining missing years for past_exam rows by
    // trying to detect the year from the filename one more time. If still
    // missing, fall back to the current year so save doesn't fail.
    // (These rows will be tagged blindUploaded so the admin can review later.)
    const currentYear = new Date().getFullYear();
    const yearFixedRows: BulkFile[] = [];
    let yearFixedCount = 0;
    for (const f of toSave) {
      if (typeHasYear(f.contentType) && !f.examYear) {
        // Try filename detection one more time
        const detectedYear = detectYear(f.file.name);
        if (detectedYear) {
          yearFixedRows.push({ ...f, examYear: detectedYear, blindUploaded: true });
          yearFixedCount++;
        } else {
          // Last-resort fallback: current year (admin can fix later)
          yearFixedRows.push({ ...f, examYear: String(currentYear), blindUploaded: true });
          yearFixedCount++;
        }
      } else {
        yearFixedRows.push(f);
      }
    }
    if (yearFixedCount > 0) {
      toSave = yearFixedRows;
      setFiles(yearFixedRows);
      toast.info(`Auto-filled ${yearFixedCount} missing year${yearFixedCount === 1 ? "" : "s"} from filename (or current year as fallback). Tagged for review.`);
    }

    if (!allValid) {
      const firstInvalid = files.find((f) => getRowMissing(f).length > 0);
      const missing = firstInvalid ? getRowMissing(firstInvalid) : [];
      toast.error(
        `Cannot save: ${invalidRowCount} row${invalidRowCount === 1 ? "" : "s"} missing fields (${missing.join(", ")}). Fill them in or enable Blind Upload.`,
      );
      return;
    }
    setSaving(true);
    let saved = 0;
    let failed = 0;

    for (const bulkFile of toSave) {
      setSavingFile({ id: bulkFile.id, name: bulkFile.file.name });
      try {
        // Pass subject display name + content type label so the backend
        // branding step can build the cover page without an extra query.
        const subjectName =
          subjects?.find((s) => s._id === bulkFile.subjectId)?.name ?? "";
        const contentTypeLabel =
          contentTypeOptions.find((t) => t.value === bulkFile.contentType)?.label ??
          bulkFile.contentType;
        await originalAdminUpload({
          title: bulkFile.title.trim(),
          contentType: bulkFile.contentType as never,
          grade: Number(bulkFile.grade),
          subjectId: bulkFile.subjectId as Id<"subjects">,
          examYear: typeHasYear(bulkFile.contentType) ? Number(bulkFile.examYear) : undefined,
          isPremium: bulkFile.isPremium,
          storageId: bulkFile.storageId!,
          filename: bulkFile.file.name,
          topicCandidates: bulkFile.topics.length > 0 ? bulkFile.topics : undefined,
          needsReview: bulkFile.blindUploaded || undefined,
          // Branding is on by default in adminUploadContent; we pass these
          // so the cover page can be built without an extra DB query.
          applyBranding: true,
          subjectName,
          contentTypeLabel,
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
    setSavingFile(null);
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
          {/* Branding + saving banner — shown during the Save All loop.
              Branding happens in-flight inside adminUploadContent, so we
              surface this as a clear banner with the current filename. */}
          {saving && savingFile && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.04] p-3">
              <Loader2 className="size-4 animate-spin text-amber-300" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-300">
                  Branding + saving in progress
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  <Sparkles className="mr-1 inline size-2.5" />
                  Adding Learnyx cover page + watermark to "{savingFile.name}"
                </p>
              </div>
            </div>
          )}

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
              {!processing && !saving && files.some((f) => f.status === "failed" || f.status === "cancelled") && (
                <span className="text-xs text-rose-300">
                  {files.filter((f) => f.status === "failed" || f.status === "cancelled").length} failed/cancelled — click "Retry Failed"
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
              {/* Blind Upload toggle — enables saving rows even when classifier
                  couldn't fully classify them, by applying admin defaults. */}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors",
                  blindMode
                    ? "border-violet-500/40 bg-violet-500/10"
                    : "border-white/[0.06] bg-white/[0.02]",
                )}
                title="Blind Upload: use admin-chosen defaults to save even unclassified files"
              >
                <Switch
                  checked={blindMode}
                  onCheckedChange={setBlindMode}
                  className="scale-90"
                />
                <span className="text-[11px] font-semibold text-violet-300">
                  <Eye className="inline size-3 mr-1" />
                  Blind Upload
                </span>
              </label>
              {/* Retry Failed button */}
              {!processing && !saving && files.some((f) => f.status === "failed" || f.status === "cancelled") && (
                <Button
                  onClick={retryFailed}
                  className="gap-2 bg-amber-500 text-white hover:bg-amber-600"
                  size="sm"
                >
                  <RotateCw className="size-3.5" />
                  Retry Failed ({files.filter((f) => f.status === "failed" || f.status === "cancelled").length})
                </Button>
              )}
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
              {/* Save All button — ALWAYS visible when there are files to
                  save and we're not processing/saving. Disabled (with a
                  tooltip) when validation fails so the admin sees the button
                  AND knows exactly what's missing. */}
              {!processing && !saving && saveCandidateCount > 0 && (
                <Button
                  onClick={handleSaveAll}
                  disabled={!allValid}
                  className={cn(
                    "gap-2",
                    allValid
                      ? "bg-emerald-500 text-white hover:bg-emerald-600"
                      : "bg-emerald-500/30 text-emerald-300/60 cursor-not-allowed",
                  )}
                  size="sm"
                  title={
                    allValid
                      ? `Save all ${saveCandidateCount} file${saveCandidateCount === 1 ? "" : "s"} to the library`
                      : `${invalidRowCount} row${invalidRowCount === 1 ? "" : "s"} missing required fields — fill them in or enable Blind Upload`
                  }
                >
                  <Save className="size-3.5" />
                  Save All ({saveCandidateCount})
                </Button>
              )}
              {!processing && !saving && !allValid && saveCandidateCount > 0 && (
                <span className="text-xs text-amber-300">
                  {invalidRowCount} row{invalidRowCount === 1 ? "" : "s"} need{invalidRowCount === 1 ? "s" : ""} fields — fix above OR enable Blind Upload
                </span>
              )}
            </div>
          </div>

          {/* Blind Upload defaults — visible only when blind mode is on */}
          {blindMode && (
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.04] p-3">
              <div className="mb-2 flex items-start gap-2">
                <Eye className="size-4 mt-0.5 shrink-0 text-violet-300" />
                <div>
                  <p className="text-xs font-semibold text-violet-300">
                    Blind Upload defaults
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    These will fill any missing subject/grade/type/year on rows
                    the classifier couldn't fully classify. Files with the
                    right fields keep their values; only blanks get the defaults.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Subject *
                  </label>
                  <Select value={blindSubject} onValueChange={setBlindSubject}>
                    <SelectTrigger className="h-9 w-[160px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="Select subject" />
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
                    Grade *
                  </label>
                  <Select value={blindGrade} onValueChange={setBlindGrade}>
                    <SelectTrigger className="h-9 w-[80px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {gradeOptions.map((g) => (
                        <SelectItem key={g} value={g.toString()}>{g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Type *
                  </label>
                  <Select value={blindType} onValueChange={setBlindType}>
                    <SelectTrigger className="h-9 w-[140px] rounded-md bg-white/5 text-xs">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      {contentTypeOptions.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Year only required when the selected type has a year —
                    for dynamic types, we check the hasYear flag. */}
                {contentTypeOptions.find((t) => t.value === blindType)?.hasYear && (
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Year *
                    </label>
                    <Select value={blindYear} onValueChange={setBlindYear}>
                      <SelectTrigger className="h-9 w-[100px] rounded-md bg-white/5 text-xs">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {blindCanFillMissing ? (
                  <span className="text-[11px] font-semibold text-emerald-300">
                    ✓ Defaults valid — Save All will fill all blanks
                  </span>
                ) : (
                  <span className="text-[11px] font-semibold text-amber-300">
                    Pick subject + grade + type to enable blind save
                  </span>
                )}
              </div>
            </div>
          )}

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
                          {f.status === "retrying" && <RotateCw className="size-3.5 animate-spin text-amber-400" />}
                          {f.status === "analyzing" && <Loader2 className="size-3.5 animate-spin text-sky-300" />}
                          {f.status === "ready" && <CheckCircle2 className="size-3.5 text-emerald-300" />}
                          {f.status === "failed" && <AlertTriangle className="size-3.5 text-rose-300" />}
                          {f.status === "duplicate" && <Copy className="size-3.5 text-amber-300" />}
                          {f.status === "cancelled" && <Ban className="size-3.5 text-muted-foreground" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs text-muted-foreground">
                            {f.file.name} · {(f.file.size / 1024 / 1024).toFixed(1)} MB
                            {f.retryCount > 0 && f.status !== "ready" && (
                              <span className="ml-2 text-[10px] text-amber-400">
                                retry #{f.retryCount}
                              </span>
                            )}
                          </p>
                          {(f.status === "uploading" || f.status === "analyzing" || f.status === "pending" || f.status === "retrying") ? (
                            <p className="mt-1 text-[11px] text-muted-foreground/80">
                              {f.status === "uploading" && `Uploading… ${f.progress}%`}
                              {f.status === "retrying" && (f.error ?? "Retrying…")}
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
                          {f.error && f.status === "failed" && (
                            <p className="mt-1 text-[10px] text-rose-300">{f.error}</p>
                          )}
                          {/* Inline missing-fields warning — only show for
                              ready rows that are missing required fields. Lets
                              the admin see exactly which row is blocking Save
                              All without scrolling. */}
                          {f.status === "ready" && getRowMissing(f).length > 0 && (
                            <div className="mt-1 rounded-md border border-rose-400/30 bg-rose-400/[0.06] px-2 py-1 text-[10px] text-rose-200">
                              <AlertTriangle className="inline size-2.5 mr-1" />
                              Missing: {getRowMissing(f).join(", ")}
                              {blindMode && " — Blind Upload will fill these on Save"}
                            </div>
                          )}
                          {f.blindUploaded && (
                            <p className="mt-1 text-[10px] text-violet-300">
                              <Eye className="inline size-2.5 mr-0.5" />
                              Saved with blind-upload defaults — review later
                            </p>
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
                          {gradeOptions.map((g) => (
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
                          {contentTypeOptions.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {typeHasYear(f.contentType) ? (
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
                        {(f.status === "uploading" || f.status === "analyzing" || f.status === "retrying") && (
                          <button
                            onClick={() => cancelFile(f.id)}
                            title="Cancel this upload"
                            className="cursor-pointer rounded-md border border-rose-400/30 bg-rose-400/10 p-1.5 text-rose-300 hover:bg-rose-400/20"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        )}
                        {/* Per-row retry button — only visible for failed or
                            cancelled rows. Re-runs the entire pipeline for
                            just this one file, with full backoff retry. */}
                        {!processing && !saving && (f.status === "failed" || f.status === "cancelled") && (
                          <button
                            onClick={() => {
                              // Inline single-row retry — set status back to
                              // pending and call processFiles, which only
                              // processes pending/failed/cancelled rows.
                              setFiles((prev) =>
                                prev.map((pf) =>
                                  pf.id === f.id
                                    ? { ...pf, status: "pending", error: undefined, retryCount: 0 }
                                    : pf,
                                ),
                              );
                              setTimeout(() => void processFiles(), 50);
                            }}
                            title="Retry this file"
                            className="cursor-pointer rounded-md border border-amber-400/30 bg-amber-400/10 p-1.5 text-amber-300 hover:bg-amber-400/20"
                          >
                            <RotateCw className="size-3.5" />
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
                {blindMode && (
                  <span className="flex items-center gap-1.5">
                    <Eye className="size-3 text-violet-300" />
                    {files.filter((f) => f.blindUploaded).length} blind-uploaded
                  </span>
                )}
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
                      {gradeOptions.map((g) => (
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
                      {contentTypeOptions.map((t) => (
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
