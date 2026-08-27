// Admin content management — upload form + recent uploads. Rendered inside the
// /admin Content tab (gated by the admin role check at the page level; the
// server-side functions enforce the gate independently).

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileUp,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2,
  X,
} from "lucide-react";
import { extractPdfText } from "@/lib/pdf";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  CONTENT_TYPE_SLUGS,
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
  const seedSubjects = useMutation(api.subjects.seed);

  // Auto-seed subjects on mount (idempotent — skips existing slugs).
  // This ensures new subjects added to SEED_SUBJECTS appear automatically.
  useEffect(() => {
    if (subjects !== undefined) {
      seedSubjects().catch(() => {});
    }
  }, [subjects, seedSubjects]);

  // --- R2 configuration status -----------------------------------------
  const getR2Status = useAction(api.contentAdmin.getR2Status);
  const syncR2CorsForOrigin = useAction(api.contentAdmin.syncR2CorsForOrigin);
  // Capture the admin's current browser origin once — this is what needs to
  // be in the R2 CORS AllowedOrigins for PUT to succeed.
  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";
  type R2StatusResult = {
    configured: boolean;
    missing: string[];
    corsRules?: { allowedOrigins: string[]; allowedMethods: string[]; allowedHeaders?: string[] }[];
    callerOrigin?: string;
    putAllowedForCaller?: boolean;
  };
  const [r2Status, setR2Status] = useState<R2StatusResult | null>(null);
  const [corsSyncing, setCorsSyncing] = useState(false);

  const refreshR2Status = useCallback(() => {
    getR2Status({ origin: currentOrigin })
      .then((status) => setR2Status(status))
      .catch(() => setR2Status({ configured: false, missing: [] }));
  }, [getR2Status, currentOrigin]);

  useEffect(() => {
    let cancelled = false;
    getR2Status({ origin: currentOrigin })
      .then((status) => {
        if (!cancelled) setR2Status(status);
      })
      .catch(() => {
        if (!cancelled) setR2Status({ configured: false, missing: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [getR2Status, currentOrigin]);

  // Manually sync R2 CORS to include this origin. Useful when uploads have
  // already failed (e.g. admin opened the page before CORS auto-healed) or
  // when previewing a new deployment URL before the first upload.
  const handleSyncCors = async () => {
    if (!currentOrigin) return;
    setCorsSyncing(true);
    try {
      const result = await syncR2CorsForOrigin({ origin: currentOrigin });
      if (result.updated) {
        toast.success(`Added ${currentOrigin} to R2 CORS AllowedOrigins for PUT.`);
      } else if (result.reason === "already_allowed") {
        toast.info(`${currentOrigin} is already allowed — no change needed.`);
      } else {
        toast.message(`CORS sync: ${result.reason}`);
      }
      // Refresh status so the UI reflects the new rule.
      refreshR2Status();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to sync R2 CORS.");
    } finally {
      setCorsSyncing(false);
    }
  };

  // --- Upload form state ------------------------------------------------
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [grade, setGrade] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [examYear, setExamYear] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isPremium, setIsPremium] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Direct browser→R2 upload via presigned URLs. The file never passes through
  // the Convex action runtime, so large files won’t cause “Connection lost while
  // action was in flight” errors. Only lightweight metadata calls go through Convex.
  const getPresignedR2UploadUrl = useAction(api.contentAdmin.getPresignedR2UploadUrl);
  const finalizeUpload = useAction(api.contentAdmin.finalizeUpload);
  const classifyContentText = useAction(api.contentAI.classifyContentText);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<Awaited<
    ReturnType<typeof classifyContentText>
  > | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setAiSuggestion(null);
    try {
      const sample = await extractPdfText(file);
      const suggestion = await classifyContentText({
        sample,
        filename: file.name,
      });
      setAiSuggestion(suggestion);
      if (suggestion.analyzed) {
        if (suggestion.title) setTitle(suggestion.title);
        if (suggestion.contentType) setContentType(suggestion.contentType as ContentType);
        if (suggestion.grade) setGrade(String(suggestion.grade));
        if (suggestion.subjectId) setSubjectId(suggestion.subjectId);
        if (suggestion.examYear) setExamYear(String(suggestion.examYear));
        toast.success("AI suggestion ready — review before confirming.");
      } else {
        toast.warning(suggestion.note ?? "Could not analyze this file.");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  // --- Recent uploads ---------------------------------------------------
  const [adminGrade, setAdminGrade] = useState("");
  const [adminType, setAdminType] = useState("");
  const [adminSubjectId, setAdminSubjectId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const adminContent = useQuery(api.content.getAdminContent, {
    grade: adminGrade ? Number(adminGrade) : undefined,
    subjectId: (adminSubjectId || undefined) as never,
    contentType: (adminType || undefined) as ContentType | undefined,
  });
  const deleteContentItem = useAction(api.contentAdmin.deleteContentItem);
  const updateContentItem = useAction(api.contentAdmin.updateContentItem);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // --- Edit dialog state -----------------------------------------------
  const [editItem, setEditItem] = useState<ContentItemWithSubject | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editGrade, setEditGrade] = useState("");
  const [editSubjectId, setEditSubjectId] = useState("");
  const [editContentType, setEditContentType] = useState("");
  const [editExamYear, setEditExamYear] = useState("");
  const [editIsPremium, setEditIsPremium] = useState(false);
  const [editSaving, setEditSaving] = useState(false);

  const openEditDialog = useCallback((item: ContentItemWithSubject) => {
    setEditItem(item);
    setEditTitle(item.title);
    setEditGrade(String(item.grade));
    setEditSubjectId(item.subjectId);
    setEditContentType(item.contentType);
    setEditExamYear(item.examYear ? String(item.examYear) : "");
    setEditIsPremium(item.isPremium);
  }, []);

  const handleEditSave = async () => {
    if (!editItem) return;
    setEditSaving(true);
    try {
      await updateContentItem({
        contentId: editItem._id,
        title: editTitle.trim(),
        grade: Number(editGrade),
        subjectId: editSubjectId as never,
        contentType: editContentType as ContentType,
        examYear: editContentType === "past_exam" ? (editExamYear ? Number(editExamYear) : undefined) : undefined,
        isPremium: editIsPremium,
      });
      toast.success(`Updated "${editTitle.trim()}".`);
      setEditItem(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setEditSaving(false);
    }
  };

  // Quick premium toggle (no dialog)
  const [togglingPremiumId, setTogglingPremiumId] = useState<string | null>(null);
  const handleQuickPremiumToggle = async (item: ContentItemWithSubject) => {
    setTogglingPremiumId(item._id);
    try {
      await updateContentItem({ contentId: item._id, isPremium: !item.isPremium });
      toast.success(item.isPremium ? `"${item.title}" is now free.` : `"${item.title}" is now premium.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Toggle failed.");
    } finally {
      setTogglingPremiumId(null);
    }
  };

  // Client-side search filter
  const filteredContent = useMemo(() => {
    if (!adminContent) return adminContent;
    if (!searchQuery.trim()) return adminContent;
    const q = searchQuery.toLowerCase();
    return adminContent.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.subjectName.toLowerCase().includes(q) ||
        CONTENT_TYPE_LABELS[item.contentType].toLowerCase().includes(q),
    );
  }, [adminContent, searchQuery]);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied!`),
      () => toast.error("Copy failed."),
    );
  }, []);

  // --- Sample library (one-shot demo content for an empty library) --------
  const seedSampleLibrary = useAction(api.sampleContent.seedSampleLibrary);
  const isLibraryEmpty = useAction(api.sampleContent.isLibraryEmpty);
  const [libraryEmpty, setLibraryEmpty] = useState<boolean | null>(null);
  const [seedConfirmOpen, setSeedConfirmOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isLibraryEmpty()
      .then((result) => {
        if (!cancelled) setLibraryEmpty(result.empty);
      })
      .catch(() => {
        if (!cancelled) setLibraryEmpty(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLibraryEmpty]);

  const handleSeedSample = async () => {
    if (seeding) return;
    setSeeding(true);
    try {
      const result = await seedSampleLibrary();
      if (result.seeded > 0) {
        toast.success(
          `Loaded ${result.seeded} sample items — clearly labeled as demo content.`,
        );
        setLibraryEmpty(false);
      } else {
        toast.info("Nothing to seed — the library already has content.");
        setLibraryEmpty(false);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not seed the library.");
    } finally {
      setSeeding(false);
      setSeedConfirmOpen(false);
    }
  };

  const handleFile = (next: File | null) => {
    if (next && !next.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Only PDF files are supported for now.");
      return;
    }
    if (next && next.size > 200 * 1024 * 1024) {
      toast.error("File too large — maximum 200 MB.");
      return;
    }
    setFile(next);
  };

  /** Upload the file directly to R2 via a presigned URL, then finalize metadata.
   *  This avoids sending large file bytes through the Convex action runtime,
   *  which causes “Connection lost while action was in flight” on bigger files. */
  const handleUpload = () => {
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

    // We use a non-async runner so the XHR progress callbacks can drive state
    // without competing with an async chain.
    (async () => {
      setUploading(true);
      setUploadProgress(0);
      try {
        // Step 1 — get a presigned PUT URL (fast, tiny payload through Convex).
        // Also auto-merges the browser origin into R2 CORS AllowedOrigins
        // for PUT if not already covered — self-heals the most common upload
        // failure ("CORS configuration issue") when an admin uploads from a
        // new deployment URL.
        toast.info("Getting upload URL…");
        const { uploadUrl, fileUrl } = await getPresignedR2UploadUrl({
          filename: file.name,
          contentType: file.type || "application/pdf",
          grade: Number(grade),
          subjectId: subjectId as never,
          contentSlug: CONTENT_TYPE_SLUGS[contentType as ContentType],
          origin: currentOrigin,
        });

        // Step 2 — upload file directly from browser to R2 (no Convex in the loop).
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "application/pdf");
          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              setUploadProgress(pct);
            }
          });
          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              reject(new Error(`R2 upload returned HTTP ${xhr.status}`));
            }
          });
          xhr.addEventListener("error", () => {
            // A network-level error (usually CORS) — the browser never got a
            // response from R2. Show a helpful, origin-aware message so the
            // admin knows exactly what to add to the bucket's CORS policy.
            const bucketHost = (() => {
              try { return new URL(uploadUrl).host; } catch { return "your R2 bucket"; }
            })();
            reject(
              new Error(
                `Upload to R2 failed — this is usually a CORS configuration issue. ` +
                `Your browser origin is "${currentOrigin}" and the bucket host is ${bucketHost}. ` +
                `Go to your Cloudflare R2 bucket → Settings → CORS Policy and ensure a rule ` +
                `with AllowedOrigins including "${currentOrigin}", AllowedMethods including "PUT", ` +
                `and AllowedHeaders ["*"]. ` +
                `Or click "Sync CORS for this origin" below — the app can update the bucket for you.`,
              ),
            );
          });
          xhr.addEventListener("timeout", () => {
            reject(new Error("Upload to R2 timed out. Check your connection and try again."));
          });
          xhr.timeout = 10 * 60 * 1000; // 10 minutes
          xhr.send(file);
        });

        // Step 3 — save metadata to the DB (fast, tiny payload through Convex).
        toast.info("Saving to library…");
        await finalizeUpload({
          title: title.trim(),
          contentType,
          grade: Number(grade),
          subjectId: subjectId as never,
          examYear: contentType === "past_exam" ? Number(examYear) : undefined,
          isPremium,
          fileUrl,
          fileSizeBytes: file.size,
          filename: file.name,
          topicCandidates: aiSuggestion?.analyzed ? aiSuggestion.topics : undefined,
          sourceName: sourceName.trim() || undefined,
          sourceUrl: sourceUrl.trim() || undefined,
        });

        toast.success("Content uploaded to the library.");
        setFile(null);
        setTitle("");
        setContentType("");
        setGrade("");
        setSubjectId("");
        setExamYear("");
        setSourceName("");
        setSourceUrl("");
        setIsPremium(false);
        setUploadProgress(0);
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
        setUploadProgress(0);
      }
    })();
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
        <div className="glass-soft flex flex-col gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
          {/* Top row: connection status + sync button */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-300" />
              <div>
                <p className="text-sm font-semibold text-emerald-300">
                  R2 storage is connected
                </p>
                <p className="mt-0.5 text-xs text-emerald-200/70">
                  Files are stored under the human-browsable key layout.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSyncCors}
              disabled={corsSyncing}
              className="cursor-pointer gap-2 self-start border-emerald-400/30 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
            >
              {corsSyncing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              Sync CORS for this origin
            </Button>
          </div>

          {/* Origin + PUT permission status */}
          {currentOrigin && (
            <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="type-mono uppercase tracking-[0.15em] text-muted-foreground">
                  Current origin:
                </span>
                <code className="rounded bg-white/10 px-1.5 py-0.5 text-foreground">
                  {currentOrigin}
                </code>
                {r2Status.putAllowedForCaller === true ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-300">
                    <Check className="size-3" /> PUT allowed
                  </span>
                ) : r2Status.putAllowedForCaller === false ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-amber-300">
                    <ShieldAlert className="size-3" /> PUT not in CORS for this origin
                  </span>
                ) : null}
              </div>
              {r2Status.putAllowedForCaller === false && (
                <p className="text-amber-200/80">
                  Click <span className="font-semibold">Sync CORS for this origin</span> to
                  auto-add it to the bucket&apos;s AllowedOrigins. After sync, retry the upload.
                </p>
              )}
            </div>
          )}

          {/* Current CORS rules (collapsible list) */}
          {r2Status.corsRules && r2Status.corsRules.length > 0 && (
            <details className="group rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
              <summary className="flex cursor-pointer items-center gap-2 text-muted-foreground hover:text-foreground">
                <RotateCcw className="size-3.5 transition-transform group-open:rotate-90" />
                <span className="type-mono uppercase tracking-[0.15em]">
                  Current R2 CORS rules ({r2Status.corsRules.length})
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                {r2Status.corsRules.map((rule, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-white/5 bg-black/20 p-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="type-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        Origins:
                      </span>
                      {rule.allowedOrigins.map((o) => (
                        <code
                          key={o}
                          className={`rounded px-1.5 py-0.5 text-[10px] ${
                            o === currentOrigin
                              ? "bg-emerald-400/20 text-emerald-300"
                              : "bg-white/10 text-foreground/80"
                          }`}
                        >
                          {o}
                        </code>
                      ))}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="type-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        Methods:
                      </span>
                      {rule.allowedMethods.map((m) => (
                        <code
                          key={m}
                          className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-foreground/80"
                        >
                          {m}
                        </code>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
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
            {file && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 cursor-pointer border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                onClick={handleAnalyze}
                disabled={analyzing}
              >
                {analyzing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Wand2 className="size-3.5" />
                )}
                {analyzing ? "Analyzing with AI…" : "Analyze with AI"}
              </Button>
            )}
          </div>

          {aiSuggestion && (
            <div
              className={cn(
                "flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-5",
                aiSuggestion.analyzed
                  ? "border-primary/30 bg-primary/10"
                  : "border-amber-400/30 bg-amber-400/10",
              )}
            >
              <Wand2
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  aiSuggestion.analyzed ? "text-primary" : "text-amber-300",
                )}
              />
              <div>
                {aiSuggestion.analyzed ? (
                  <>
                    <p className="font-semibold text-foreground">
                      AI suggested — review before confirming
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Analyzed {aiSuggestion.sampleChars.toLocaleString()} chars.
                      {aiSuggestion.subjectSlug
                        ? ` Detected subject: ${aiSuggestion.subjectSlug}.`
                        : ""}
                      {aiSuggestion.topics.length > 0
                        ? ` Topics: ${aiSuggestion.topics.join(", ")}.`
                        : ""}
                      Nothing is saved until you confirm below.
                    </p>
                  </>
                ) : (
                  <p className="font-semibold text-amber-300">
                    {aiSuggestion.note ?? "Could not analyze this file."}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setAiSuggestion(null)}
                  className="mt-1 cursor-pointer text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

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

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Official source name <span className="font-normal">(optional)</span></Label>
              <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} placeholder="Ministry of Education (MoE)" className="h-9 rounded-xl bg-white/5" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Official source URL <span className="font-normal">(optional)</span></Label>
              <Input type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://www.moe.gov.et/..." className="h-9 rounded-xl bg-white/5" />
            </div>
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
                <Loader2 className="size-4 animate-spin" />{" "}
                {uploadProgress > 0 && uploadProgress < 100
                  ? `Uploading ${uploadProgress}%…`
                  : "Preparing upload…"}
              </>
            ) : (
              <>
                <UploadCloud className="size-4" /> Upload to library
              </>
            )}
          </Button>
          {uploading && uploadProgress > 0 && (
            <div className="mt-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-2 rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          )}
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

      {/* Library management */}
      <div className="glass-panel rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-extrabold tracking-tight">Library</h2>
            <p className="text-sm text-muted-foreground">
              {adminContent !== undefined && (
                <>
                  {filteredContent?.length ?? 0} item{((filteredContent?.length ?? 0) !== 1) ? "s" : ""}
                  {(adminGrade || adminType || adminSubjectId || searchQuery) && (
                    <span className="text-muted-foreground/60">
                      {" "}(filtered from {adminContent.length})
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {libraryEmpty && (
              <AlertDialog open={seedConfirmOpen} onOpenChange={setSeedConfirmOpen}>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 cursor-pointer rounded-lg border-primary/30 bg-primary/10 font-mono text-[10px] text-primary hover:bg-primary/20"
                  >
                    <Sparkles className="size-3" /> Load sample library
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="glass-panel">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Load sample content?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Adds a clearly-labeled <strong>demo library</strong> (~20 items:
                      textbooks, past-exam papers, worksheets, guides across all
                      subjects and grades 9-12) so the bookshelf, reader and
                      analytics are testable before real files are uploaded. Every
                      item is marked &quot;Sample&quot; and is not official MoE
                      material. This only runs while the library is empty and can
                      be deleted item-by-item afterwards.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="cursor-pointer rounded-xl"
                      disabled={seeding}
                      onClick={() => void handleSeedSample()}
                    >
                      {seeding ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Sparkles className="size-4" />
                      )}
                      Load sample content
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Search + filters row */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, subject, or type\u2026"
              className="h-8 rounded-lg bg-white/5 pl-8 text-xs"
            />
          </div>
          <Select value={adminGrade} onValueChange={(v) => setAdminGrade(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 w-28 rounded-lg bg-white/5 text-xs">
              <SelectValue placeholder="Grade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All grades</SelectItem>
              {[9, 10, 11, 12].map((g) => (
                <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
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
                <SelectItem key={type} value={type}>{CONTENT_TYPE_LABELS[type]}</SelectItem>
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
                <SelectItem key={subject._id} value={subject._id}>{subject.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {(adminGrade || adminType || adminSubjectId || searchQuery) && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer text-muted-foreground"
              onClick={() => {
                setAdminGrade("");
                setAdminType("");
                setAdminSubjectId("");
                setSearchQuery("");
              }}
              aria-label="Reset filters"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="mt-4 overflow-x-auto">
          {adminContent === undefined ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredContent !== undefined && filteredContent.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {searchQuery || adminGrade || adminType || adminSubjectId
                ? "No items match your filters."
                : "No uploads yet."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="min-w-[14rem]">Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Grade</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredContent?.map((item) => (
                  <TableRow key={item._id} className="hover:bg-white/5">
                    <TableCell className="max-w-[14rem]">
                      <p className="truncate font-semibold">{item.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {item.isPremium && (
                          <Badge className="gap-1 bg-amber-400/10 text-amber-300">
                            <Sparkles className="size-2.5" /> Premium
                          </Badge>
                        )}
                        <Badge variant="outline" className="bg-white/5 text-[10px] font-normal text-muted-foreground">
                          {item.sourceName || "\u2014"}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {CONTENT_TYPE_LABELS[item.contentType]}
                    </TableCell>
                    <TableCell className="text-xs">Grade {item.grade}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{item.subjectName}</TableCell>
                    <TableCell className="text-xs">{item.examYear ?? "\u2014"}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {formatBytes(item.fileSizeBytes)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        {/* Edit */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 cursor-pointer text-muted-foreground hover:text-foreground"
                          onClick={() => openEditDialog(item)}
                          aria-label={`Edit ${item.title}`}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {/* Copy URL */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 cursor-pointer text-muted-foreground hover:text-foreground"
                          onClick={() => copyToClipboard(item.fileUrl, "File URL")}
                          aria-label="Copy file URL"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                        {/* Open in new tab */}
                        <a
                          href={item.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex size-7 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground"
                          aria-label="Open file"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                        {/* Premium toggle */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "size-7 cursor-pointer",
                            item.isPremium
                              ? "text-amber-400 hover:text-amber-300"
                              : "text-muted-foreground hover:text-amber-400",
                            togglingPremiumId === item._id && "opacity-50",
                          )}
                          disabled={togglingPremiumId === item._id}
                          onClick={() => handleQuickPremiumToggle(item)}
                          aria-label={item.isPremium ? "Remove premium" : "Set premium"}
                        >
                          <Sparkles className="size-3.5" />
                        </Button>
                        {/* Delete */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7 cursor-pointer text-muted-foreground hover:text-destructive"
                              aria-label={`Delete ${item.title}`}
                            >
                              <Trash2 className="size-3.5" />
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
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editItem} onOpenChange={(open) => !open && setEditItem(null)}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Edit content</DialogTitle>
            <DialogDescription>Update metadata for this library item.</DialogDescription>
          </DialogHeader>
          {editItem && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Title</Label>
                <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-9 rounded-xl bg-white/5" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Content type</Label>
                  <Select value={editContentType} onValueChange={(v) => { setEditContentType(v); if (v !== "past_exam") setEditExamYear(""); }}>
                    <SelectTrigger className="h-9 rounded-xl bg-white/5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTENT_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>{CONTENT_TYPE_LABELS[type]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Grade</Label>
                  <Select value={editGrade} onValueChange={setEditGrade}>
                    <SelectTrigger className="h-9 rounded-xl bg-white/5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[9, 10, 11, 12].map((g) => (
                        <SelectItem key={g} value={String(g)}>Grade {g}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">Subject</Label>
                  <Select value={editSubjectId} onValueChange={setEditSubjectId}>
                    <SelectTrigger className="h-9 rounded-xl bg-white/5">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects?.map((s) => (
                        <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-semibold text-muted-foreground">
                    Exam year {editContentType !== "past_exam" && <span className="font-normal text-muted-foreground/50">(past exams only)</span>}
                  </Label>
                  <Input
                    type="number"
                    min={1990}
                    max={new Date().getFullYear()}
                    value={editExamYear}
                    onChange={(e) => setEditExamYear(e.target.value)}
                    disabled={editContentType !== "past_exam"}
                    placeholder="e.g. 2023"
                    className="h-9 rounded-xl bg-white/5 disabled:opacity-40"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-border/70 bg-white/5 px-4 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="size-4 text-amber-500" /> Premium
                  </p>
                  <p className="text-xs text-muted-foreground">Gated behind subscription.</p>
                </div>
                <Switch checked={editIsPremium} onCheckedChange={setEditIsPremium} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setEditItem(null)}>Cancel</Button>
            <Button className="rounded-xl" disabled={editSaving || !editTitle.trim()} onClick={handleEditSave}>
              {editSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
