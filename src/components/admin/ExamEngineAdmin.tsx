// ExamEngineAdmin — the quality-control console for deterministically
// parsed past papers.
//
// Sections:
//   • Overview   — live confidence + queue stats
//   • Papers     — every past paper: status, confidence, review state,
//                  open reports; Review opens the question-by-question
//                  correction dialog; Accept / Original-PDF-only routes
//                  the paper; Convert/Reconvert re-enqueues it.
//   • Reports    — the student crowdsourced error inbox; resolve/dismiss.
//   • Queue      — conversion controls: digitize the whole library,
//                  re-parse everything through the deterministic engine,
//                  retry failures, and OCR the scan backlog in this tab
//                  (Tesseract.js — zero cloud AI).
//
// There is no AI in this pipeline: the parser computes an honest
// confidence score from real signals, and this console is where the rare
// low-confidence paper gets a human glance.

import { useConvex, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Inbox,
  Layers,
  Loader2,
  ListChecks,
  Pencil,
  RefreshCw,
  ScanLine,
  Search,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OriginalPageButton } from "@/components/exam/DigitalExamPlayerParts";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

type PaperFilter =
  | "all"
  | "ready"
  | "needs_review"
  | "auto"
  | "pdf_only"
  | "failed"
  | "scans"
  | "not_converted";

const REPORT_LABELS: Record<string, string> = {
  wrong_answer: "Wrong answer",
  garbled_text: "Garbled text",
  missing_options: "Missing options",
  missing_figure: "Missing figure",
  not_in_paper: "Not in the real paper",
  other: "Other",
};

export function ExamEngineAdmin() {
  const overview = useQuery(api.examQuality.adminExamOverview, {});
  const [section, setSection] = useState<"papers" | "reports" | "queue">("papers");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Header + stats */}
      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
              <Wand2 className="size-4 text-primary" /> Exam Engine
            </h2>
            <p className="text-sm text-muted-foreground">
              Quality control for deterministically parsed past papers — review the rare
              low-confidence parse, correct questions, and keep the queue healthy.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {(
              [
                { id: "papers", label: "Papers", icon: Layers },
                { id: "reports", label: "Reports", icon: Inbox },
                { id: "queue", label: "Queue", icon: ListChecks },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSection(t.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition",
                  section === t.id
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="size-3.5" /> {t.label}
                {t.id === "reports" && (overview?.openReports ?? 0) > 0 && (
                  <span className="rounded-md bg-rose-400/20 px-1.5 text-[10px] font-black text-rose-300">
                    {overview!.openReports}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {overview ? (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <MiniStat
              label="Digitized"
              value={overview.readyCount}
              hint={
                overview.avgConfidence !== null
                  ? `avg confidence ${overview.avgConfidence}%`
                  : undefined
              }
              tone="text-amber-300"
            />
            <MiniStat
              label="Auto (high conf)"
              value={overview.autoCount}
              tone="text-emerald-300"
            />
            <MiniStat label="Accepted" value={overview.acceptedCount} tone="text-emerald-200" />
            <MiniStat
              label="Needs review"
              value={overview.needsReviewCount}
              hint={overview.needsReviewCount > 0 ? "glance & accept" : undefined}
              tone="text-amber-200"
            />
            <MiniStat
              label="Waiting for OCR"
              value={overview.scansWaiting}
              hint="scans — zero cloud AI"
              tone="text-sky-300"
            />
            <MiniStat
              label="Queue"
              value={overview.queue.queued}
              hint={`${overview.queue.running} running`}
              tone="text-violet-300"
            />
          </div>
        ) : (
          <Loader2 className="mt-4 size-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {section === "papers" && <PapersSection />}
      {section === "reports" && <ReportsSection />}
      {section === "queue" && <QueueSection />}
    </div>
  );
}

// ─── Mini stat ────────────────────────────────────────────────────────────

function MiniStat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className={cn("text-xl font-black tabular-nums", tone)}>{value}</p>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      {hint && <p className="text-[10px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

// ─── Papers section ───────────────────────────────────────────────────────

function PapersSection() {
  const [filter, setFilter] = useState<PaperFilter>("all");
  const [search, setSearch] = useState("");
  const rows = useQuery(api.examQuality.adminListDigitalPapers, {
    filter,
    search: search.trim().length >= 2 ? search.trim() : undefined,
  });
  const reviewDecide = useMutation(api.examQuality.adminReviewDecide);
  const enqueueSingle = useMutation(api.examQuality.enqueueSinglePaper);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const act = useCallback(
    async (fn: () => Promise<unknown>, done: string) => {
      try {
        await fn();
        toast.success(done);
      } catch (err) {
        toast.error((err as Error).message || "Something went wrong.");
      }
    },
    [],
  );

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search papers by title…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as PaperFilter)}>
          <SelectTrigger className="w-52 rounded-xl border-white/10 bg-white/[0.03] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-white/10 bg-background">
            <SelectItem value="all">All papers</SelectItem>
            <SelectItem value="needs_review">Needs review (low confidence)</SelectItem>
            <SelectItem value="auto">Auto-published (high confidence)</SelectItem>
            <SelectItem value="scans">Waiting for OCR (scans)</SelectItem>
            <SelectItem value="pdf_only">Original-PDF only</SelectItem>
            <SelectItem value="failed">Failed conversions</SelectItem>
            <SelectItem value="not_converted">Not converted yet</SelectItem>
            <SelectItem value="ready">All digitized</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!rows ? (
        <Loader2 className="mt-6 size-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No papers match this filter.
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <div
              key={r.contentId}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-bold">{r.title}</p>
                  {r.openReports > 0 && (
                    <Badge className="gap-1 border-rose-400/40 bg-rose-400/15 text-rose-200">
                      <FileWarning className="size-3" /> {r.openReports} report{r.openReports === 1 ? "" : "s"}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{r.subjectName} · Grade {r.grade}{r.examYear !== null ? ` · ${r.examYear}` : ""}</span>
                  {r.status === "ready" && (
                    <span className="inline-flex items-center gap-1.5">
                      {r.reviewStatus === "needs_review" ? (
                        <Badge className="border-amber-400/40 bg-amber-400/10 text-amber-200">
                          needs review
                        </Badge>
                      ) : (
                        <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
                          {r.reviewStatus === "accepted" ? "accepted" : "auto"}
                        </Badge>
                      )}
                      {r.confidence !== null && (
                        <span
                          className={cn(
                            "font-bold tabular-nums",
                            r.confidence >= 70 ? "text-emerald-300/90" : "text-amber-300",
                          )}
                        >
                          {r.confidence}% conf
                        </span>
                      )}
                      <span className="text-muted-foreground/70">· {r.questionCount} Qs</span>
                    </span>
                  )}
                  {r.status === "processing" && r.sourceMode === "scan" && (
                    <span className="inline-flex items-center gap-1 text-sky-300">
                      <ScanLine className="size-3" /> waiting for OCR…
                    </span>
                  )}
                  {r.status === "processing" && r.sourceMode !== "scan" && (
                    <span className="inline-flex items-center gap-1 text-sky-300">
                      <Loader2 className="size-3 animate-spin" /> converting…
                    </span>
                  )}
                  {r.status === "failed" && (
                    <span className="text-rose-300">failed — {(r.error ?? "").slice(0, 80)}…</span>
                  )}
                  {r.status === null && <span className="text-muted-foreground/60">not converted</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {r.status === "ready" && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 rounded-xl border-white/15 text-xs"
                      onClick={() => setReviewing(r.contentId)}
                    >
                      <Pencil className="size-3" /> Review
                    </Button>
                    {r.reviewStatus !== "accepted" && (
                      <Button
                        size="sm"
                        className="h-8 gap-1 rounded-xl bg-emerald-500/90 text-xs text-black hover:bg-emerald-400"
                        onClick={() =>
                          act(
                            () => reviewDecide({ contentId: r.contentId as never, decision: "accept" }),
                            "Paper accepted — it's live for students.",
                          )
                        }
                      >
                        <Check className="size-3" /> Accept
                      </Button>
                    )}
                    {r.reviewStatus !== "pdf_only" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 rounded-xl border-rose-400/30 text-xs text-rose-300 hover:bg-rose-400/10"
                        onClick={() =>
                          act(
                            () => reviewDecide({ contentId: r.contentId as never, decision: "pdf_only" }),
                            "Routed to the original PDF — students will read the source.",
                          )
                        }
                      >
                        <X className="size-3" /> Original only
                      </Button>
                    )}
                  </>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 rounded-xl border-white/15 text-xs"
                  onClick={() =>
                    act(
                      () => enqueueSingle({ contentId: r.contentId as never }),
                      r.status
                        ? "Requeued — the deterministic engine re-parses it in seconds."
                        : "Queued — the engine takes it within a minute.",
                    )
                  }
                >
                  <RefreshCw className="size-3" /> {r.status === null ? "Convert" : "Reconvert"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Review dialog */}
      {reviewing && (
        <ReviewDialog contentId={reviewing} onClose={() => setReviewing(null)} />
      )}
    </div>
  );
}

// ─── Review dialog (question-by-question QC) ─────────────────────────────

interface ReviewQuestion {
  number: number;
  kind?: "mcq" | "structured";
  text: string;
  passage?: string;
  options: { label: string; text: string }[];
  answer?: string;
  suggestedAnswer?: string;
  explanation?: string;
  topic?: string;
  sourcePage?: number;
  figureHint?: boolean;
}

function ReviewDialog({ contentId, onClose }: { contentId: string; onClose: () => void }) {
  const paper = useQuery(api.examQuality.adminGetDigitalPaper, { contentId: contentId as never });
  const meta = useQuery(api.examQuality.adminGetFileUrl, { contentId: contentId as never });
  const fixQuestion = useMutation(api.examQuality.adminFixQuestion);
  const reviewDecide = useMutation(api.examQuality.adminReviewDecide);

  const [idx, setIdx] = useState(0);
  const questions = (paper?.questions ?? []) as unknown as ReviewQuestion[];
  const q = questions[idx];

  // Draft state — rekeyed per question so edits don't bleed across items.
  const [draft, setDraft] = useState<Record<number, Partial<ReviewQuestion>>>({});
  const d = q ? (draft[q.number] ?? {}) : {};
  const setD = (patch: Partial<ReviewQuestion>) =>
    q && setDraft((prev) => ({ ...prev, [q.number]: { ...prev[q.number], ...patch } }));

  const [saving, setSaving] = useState(false);
  const dirty = Object.keys(d).length > 0;

  const save = useCallback(async () => {
    if (!q || !dirty) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { contentId: contentId as never, questionNumber: q.number };
      for (const key of ["text", "passage", "options", "answer", "suggestedAnswer", "explanation", "topic", "sourcePage", "figureHint"] as const) {
        if (key in d) payload[key] = d[key];
      }
      await fixQuestion(payload as never);
      setDraft((prev) => {
        const next = { ...prev };
        delete next[q.number];
        return next;
      });
      toast.success(`Question ${q.number} saved.`);
    } catch (err) {
      toast.error((err as Error).message || "Couldn't save the fix.");
    } finally {
      setSaving(false);
    }
  }, [contentId, d, dirty, fixQuestion, q]);

  const decide = useCallback(
    async (decision: "accept" | "pdf_only") => {
      try {
        if (dirty) await save();
        await reviewDecide({ contentId: contentId as never, decision });
        toast.success(
          decision === "accept"
            ? "Paper accepted — it's live for students."
            : "Routed to the original PDF.",
        );
        if (decision === "accept") onClose();
      } catch (err) {
        toast.error((err as Error).message || "Couldn't update the review state.");
      }
    },
    [contentId, dirty, onClose, reviewDecide, save],
  );

  if (!paper) {
    return (
      <DialogContent className="max-w-3xl rounded-3xl border-white/10 bg-background">
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" /> Loading the paper…
        </div>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-3xl border-white/10 bg-background">
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 type-h3">
          Review — {meta?.title ?? "paper"}
          {paper.confidence !== null && (
            <Badge
              className={cn(
                paper.confidence >= 70
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-200"
                  : "border-amber-400/40 bg-amber-400/10 text-amber-200",
              )}
            >
              {paper.confidence}% confidence
            </Badge>
          )}
          {paper.reviewStatus && (
            <Badge variant="outline" className="border-white/15 text-muted-foreground">
              {paper.reviewStatus}
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription className="type-caption">
          {questions.length} questions parsed deterministically
          {paper.parserMeta
            ? ` · numbering "${paper.parserMeta.numberingStyle}" · options "${paper.parserMeta.optionStyle}" · ${paper.parserMeta.answerKeyCount} answers from the paper's key`
            : ""}
          . Fix anything the parser misread, then accept to publish.
        </DialogDescription>
      </DialogHeader>

      {q ? (
        <div className="grid gap-3">
          {/* Question nav */}
          <div className="flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1 rounded-xl"
              disabled={idx === 0}
              onClick={() => setIdx((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="size-4" /> Prev
            </Button>
            <div className="flex items-center gap-1.5">
              <span className="type-caption font-bold tabular-nums text-muted-foreground">
                Question {q.number} / {questions.length}
              </span>
              <div className="mx-2 hidden max-w-40 flex-wrap gap-1 sm:flex">
                {questions.slice(Math.max(0, idx - 3), idx + 4).map((x, i) => (
                  <button
                    key={x.number}
                    type="button"
                    onClick={() => setIdx(Math.max(0, idx - 3) + i)}
                    className={cn(
                      "size-6 rounded-md text-[10px] font-bold transition",
                      x.number === q.number
                        ? "bg-amber-400 text-black"
                        : "bg-white/5 text-muted-foreground hover:bg-white/10",
                    )}
                  >
                    {x.number}
                  </button>
                ))}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 rounded-xl"
              disabled={idx >= questions.length - 1}
              onClick={() => setIdx((i) => Math.min(questions.length - 1, i + 1))}
            >
              Next <ChevronRight className="size-4" />
            </Button>
          </div>

          {/* Fields */}
          <div className="grid gap-2.5">
            <label className="grid gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Question text
              </span>
              <textarea
                value={d.text ?? q.text}
                onChange={(e) => setD({ text: e.target.value })}
                rows={3}
                className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm outline-none focus:border-amber-400/50"
              />
            </label>

            {q.options.length > 0 ? (
              <div className="grid gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Options — correct answer:{" "}
                  <Select
                    value={d.answer ?? q.answer ?? "none"}
                    onValueChange={(v) => setD({ answer: v === "none" ? undefined : v })}
                  >
                    <SelectTrigger className="ml-1 inline-flex h-7 w-20 rounded-lg border-white/10 bg-white/[0.03] text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border-white/10 bg-background">
                      <SelectItem value="none">none</SelectItem>
                      {q.options.map((o) => (
                        <SelectItem key={o.label} value={o.label}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </span>
                {(d.options ?? q.options).map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-xs font-black text-muted-foreground">
                      {o.label}
                    </span>
                    <input
                      value={o.text}
                      onChange={(e) => {
                        const opts = [...(d.options ?? q.options)];
                        opts[i] = { ...opts[i]!, text: e.target.value };
                        setD({ options: opts });
                      }}
                      className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm outline-none focus:border-amber-400/50"
                    />
                  </div>
                ))}
              </div>
            ) : (
              <label className="grid gap-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  Suggested answer (structured)
                </span>
                <textarea
                  value={d.suggestedAnswer ?? q.suggestedAnswer ?? ""}
                  onChange={(e) => setD({ suggestedAnswer: e.target.value })}
                  rows={2}
                  className="w-full resize-y rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm outline-none focus:border-amber-400/50"
                />
              </label>
            )}

            <label className="grid gap-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Explanation (optional)
              </span>
              <input
                value={d.explanation ?? q.explanation ?? ""}
                onChange={(e) => setD({ explanation: e.target.value })}
                className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-sm outline-none focus:border-amber-400/50"
              />
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <input
                  type="checkbox"
                  checked={d.figureHint ?? q.figureHint ?? false}
                  onChange={(e) => setD({ figureHint: e.target.checked })}
                  className="size-4 accent-amber-400"
                />
                Needs a figure/diagram
              </label>
              {q.sourcePage && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ScanLine className="size-3.5" /> Source page {q.sourcePage}
                  {meta?.url && (
                    <OriginalPageButton
                      pdfUrl={meta.url}
                      page={q.sourcePage}
                      pageCount={meta.pageCount ?? null}
                    />
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Save line */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground/60">
              {dirty ? "You have unsaved corrections on this question." : "All good — no edits on this question."}
            </p>
            <Button size="sm" onClick={() => void save()} disabled={!dirty || saving} className="gap-1 rounded-xl">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save fix
            </Button>
          </div>
        </div>
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {paper.status === "failed"
            ? "This paper's conversion failed — reconvert it before reviewing."
            : "This paper has no stored questions."}
        </p>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">
          Close
        </Button>
        {paper.status === "ready" && (
          <>
            <Button
              variant="outline"
              onClick={() => void decide("pdf_only")}
              className="flex-1 gap-1 border-rose-400/30 text-rose-300 hover:bg-rose-400/10"
            >
              <X className="size-4" /> Original PDF only
            </Button>
            <Button onClick={() => void decide("accept")} className="flex-1 gap-1">
              <BadgeCheck className="size-4" /> Accept paper
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ─── Reports inbox ────────────────────────────────────────────────────────

function ReportsSection() {
  const reports = useQuery(api.examQuality.adminListReports, { status: "open", limit: 120 });
  const resolve = useMutation(api.examQuality.resolveQuestionReport);
  const [reviewing, setReviewing] = useState<string | null>(null);

  const act = useCallback(async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      toast.error((err as Error).message || "Something went wrong.");
    }
  }, []);

  return (
    <div className="glass-panel rounded-2xl p-5">
      <h3 className="flex items-center gap-2 text-sm font-extrabold">
        <Inbox className="size-4 text-sky-300" /> Student reports — open
      </h3>
      {!reports ? (
        <Loader2 className="mt-4 size-4 animate-spin text-muted-foreground" />
      ) : reports.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No open reports — the papers are clean. 🎉
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          {reports.map((r) => (
            <div
              key={r._id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-white/15 text-muted-foreground">
                    {REPORT_LABELS[r.category] ?? r.category}
                  </Badge>
                  <p className="truncate text-sm font-bold">{r.paperTitle}</p>
                  <span className="text-xs font-bold text-amber-300">Q{r.questionNumber}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  “{r.details}”
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 rounded-xl border-white/15 text-xs"
                  onClick={() => setReviewing(r.contentId)}
                >
                  <Pencil className="size-3" /> Open question
                </Button>
                <Button
                  size="sm"
                  className="h-8 gap-1 rounded-xl bg-emerald-500/90 text-xs text-black hover:bg-emerald-400"
                  onClick={() =>
                    act(
                      () => resolve({ reportId: r._id, decision: "resolved" }),
                      "Report resolved.",
                    )
                  }
                >
                  <Check className="size-3" /> Fixed
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1 rounded-xl text-xs text-muted-foreground"
                  onClick={() =>
                    act(
                      () => resolve({ reportId: r._id, decision: "dismissed" }),
                      "Report dismissed.",
                    )
                  }
                >
                  <X className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {reviewing && <ReviewDialog contentId={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  );
}

// ─── Queue section (conversion controls) ──────────────────────────────────

function QueueSection() {
  const overview = useQuery(api.examQuality.adminExamOverview, {});
  const autopilot = useQuery(api.examQuality.libraryAutopilotStatus, {});
  const jobs = useQuery(api.examQuality.adminListQueue, {});
  const scans = useQuery(api.examQuality.adminListScansNeedingOcr, {});
  const enqueueAll = useMutation(api.examQuality.enqueueBatchDigitization);
  const reconvertAll = useMutation(api.examQuality.adminReconvertAll);
  const retryFailed = useMutation(api.examQuality.adminRetryFailedJobs);
  const clearBatch = useMutation(api.examQuality.adminClearBatchQueue);
  const abandonScan = useMutation(api.examQuality.adminAbandonScan);
  const [ocrBusy, setOcrBusy] = useState(false);
  const stopRef = useRef(false);
  const convex = useConvex();
  const [msg, setMsg] = useState<string | null>(null);

  /**
   * OCR the scan backlog IN THIS TAB with Tesseract.js — zero cloud AI.
   * One paper at a time, resume-aware (pages already read are skipped via
   * exact per-page presence), and broken scans are quarantined instead of
   * stopping the run.
   */
  const runScanOcr = useCallback(async () => {
    if (ocrBusy) return;
    setOcrBusy(true);
    stopRef.current = false;
    let papersRead = 0;
    try {
      for (;;) {
        if (stopRef.current) {
          setMsg("OCR stopped by you.");
          break;
        }
        const list = (await convex.query(api.examQuality.adminListScansNeedingOcr, {})) as {
          contentId: string;
          title: string;
          pageCount: number;
          pagesDone: number;
          pagesPresent?: boolean[];
        }[];
        const next = list[0];
        if (!next) {
          setMsg(
            papersRead > 0
              ? `Done — ${papersRead} paper${papersRead === 1 ? "" : "s"} read. No scans are waiting.`
              : "No scans are waiting — every scan has been read.",
          );
          break;
        }
        if (next.pageCount === 0) {
          // Broken stamp (page count never arrived) — quarantine and move
          // on; stopping would strand the whole backlog behind one row.
          setMsg(`"${next.title}" has no page count — quarantining and moving on.`);
          await abandonScan({ contentId: next.contentId as never, reason: "no page count" }).catch(
            () => {},
          );
          continue;
        }
        setMsg(`Reading scan: ${next.title} (${next.pagesDone}/${next.pageCount} pages done)`);
        const meta = (await convex.query(api.examQuality.adminGetFileUrl, {
          contentId: next.contentId as never,
        })) as { url: string } | null;
        if (!meta?.url) {
          setMsg(`Couldn't resolve the PDF for "${next.title}" — quarantining and moving on.`);
          await abandonScan({ contentId: next.contentId as never, reason: "file URL missing" }).catch(
            () => {},
          );
          continue;
        }
        // Exact per-page presence snapshot so concurrent tabs stay honest.
        const present =
          next.pagesPresent && next.pagesPresent.length === next.pageCount
            ? [...next.pagesPresent]
            : Array.from({ length: next.pageCount }, (_, i) => i < next.pagesDone);
        const { ocrMissingPages } = await import("@/lib/scanOcr");
        await ocrMissingPages(convex, {
          contentId: next.contentId,
          url: meta.url,
          pageCount: next.pageCount,
          present,
          shouldStop: () => stopRef.current,
        });
        papersRead += 1;
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch (err) {
      setMsg(`OCR stopped: ${(err as Error).message}`);
    } finally {
      setOcrBusy(false);
    }
  }, [convex, ocrBusy, abandonScan]);

  const act = useCallback(async (fn: () => Promise<unknown>, done: string) => {
    try {
      const res = (await fn()) as { enqueued?: number } | undefined;
      toast.success(res?.enqueued !== undefined ? `${done} (${res.enqueued} papers queued)` : done);
    } catch (err) {
      toast.error((err as Error).message || "Something went wrong.");
    }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {/* Engine status */}
      <div className="glass-panel rounded-2xl border border-emerald-400/20 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              Deterministic engine — ON
            </h3>
            <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Every past exam is queued for automatic parsing (new uploads included). Text-layer
              papers convert in seconds — zero AI, zero rate limits. Scanned papers wait for a
              browser tab to read them with Tesseract.js (also zero cloud AI), and low-confidence
              parses land in the review queue above.
            </p>
          </div>
          {autopilot && (
            <div className="text-right">
              <p className="text-2xl font-black tabular-nums text-emerald-300">
                {autopilot.coveragePct}%
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                library digital
              </p>
            </div>
          )}
        </div>
        {autopilot && (
          <>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-300 transition-all"
                style={{ width: `${autopilot.coveragePct}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
              <MiniStat label="Papers" value={autopilot.libraryTotal} tone="text-foreground" />
              <MiniStat label="Digital" value={autopilot.ready} tone="text-emerald-300" />
              <MiniStat label="In flight" value={autopilot.queued + autopilot.running} tone="text-sky-300" />
              <MiniStat label="Waiting OCR" value={autopilot.scansWaiting} tone="text-violet-300" />
              <MiniStat label="Need review" value={autopilot.needsReview} tone="text-amber-300" />
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              {autopilot.questionTotal.toLocaleString()} questions parsed across the digital library.
            </p>
          </>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-extrabold">
              <Sparkles className="size-4 text-amber-300" /> Manual controls
            </h3>
            <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
              The engine keeps the queue full on its own — these are for speeding it up or
              re-running the library through a parser improvement. Students always jump the line.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              className="gap-1 rounded-xl"
              onClick={() => act(() => enqueueAll({}), "Library scan complete")}
            >
              <Wand2 className="size-3.5" /> Digitize entire library
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 rounded-xl border-amber-400/30 text-xs text-amber-300"
              onClick={() =>
                act(
                  () => reconvertAll({}),
                  "Re-parsing everything — text papers finish in seconds.",
                )
              }
            >
              <RefreshCw className="size-3.5" /> Re-parse entire library
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1 rounded-xl border-sky-400/30 text-xs text-sky-300"
              disabled={ocrBusy}
              onClick={() => void runScanOcr()}
            >
              {ocrBusy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanLine className="size-3.5" />}
              OCR scans in this tab
            </Button>
            {ocrBusy && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1 rounded-xl border-rose-400/30 text-xs text-rose-300"
                onClick={() => {
                  stopRef.current = true;
                  setMsg("OCR will stop after the current page.");
                }}
              >
                <Square className="size-3.5" /> Stop
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="gap-1 rounded-xl border-white/15 text-xs"
              onClick={() => act(() => retryFailed({}), "Failed jobs requeued")}
            >
              <RefreshCw className="size-3.5" /> Retry failed
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 rounded-xl text-xs text-muted-foreground"
              onClick={() => act(() => clearBatch({}), "Batch queue cleared")}
            >
              <X className="size-3.5" /> Clear batch queue
            </Button>
          </div>
        </div>
        {msg && (
          <p className="mt-3 rounded-xl border border-sky-400/25 bg-sky-400/[0.07] px-3 py-2 text-xs font-semibold text-sky-200">
            {msg}
          </p>
        )}
        {overview && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MiniStat label="Queued" value={overview.queue.queued} tone="text-violet-300" />
            <MiniStat label="Running" value={overview.queue.running} tone="text-sky-300" />
            <MiniStat label="Done" value={overview.queue.done} tone="text-emerald-300" />
            <MiniStat label="Failed" value={overview.queue.failed} tone="text-rose-300" />
          </div>
        )}
      </div>

      <div className="glass-panel rounded-2xl p-5">
        <h3 className="text-sm font-extrabold">Queue (latest 80)</h3>
        {!jobs ? (
          <Loader2 className="mt-4 size-4 animate-spin text-muted-foreground" />
        ) : jobs.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing queued yet — “Digitize entire library” fills this up.
          </p>
        ) : (
          <div className="mt-3 grid max-h-80 gap-1.5 overflow-y-auto pr-1">
            {jobs.map((j) => (
              <motion.div
                key={j._id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
              >
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase",
                    j.status === "done" && "bg-emerald-400/15 text-emerald-300",
                    j.status === "failed" && "bg-rose-400/15 text-rose-300",
                    j.status === "running" && "bg-sky-400/15 text-sky-300",
                    j.status === "queued" && "bg-white/10 text-muted-foreground",
                  )}
                >
                  {j.status}
                </span>
                <span className={cn(
                  "rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase",
                  j.priority === "student" ? "bg-amber-400/15 text-amber-300" : "bg-white/5 text-muted-foreground",
                )}>
                  {j.priority}
                </span>
                <p className="min-w-0 flex-1 truncate text-xs font-semibold">{j.title}</p>
                {j.lastError && (
                  <span className="max-w-64 truncate text-[10px] text-rose-300/80" title={j.lastError}>
                    {j.lastError}
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Scans waiting for OCR — live progress */}
      {scans && scans.length > 0 && (
        <div className="glass-panel rounded-2xl p-5">
          <h3 className="flex items-center gap-2 text-sm font-extrabold">
            <ScanLine className="size-4 text-sky-300" /> Scans being read ({scans.length})
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Open any of these papers yourself, or press “OCR scans in this tab” — reading is free
            and local (Tesseract.js).
          </p>
          <div className="mt-3 grid max-h-60 gap-1.5 overflow-y-auto pr-1">
            {scans.map((s) => (
              <div
                key={s.contentId}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2"
              >
                <p className="min-w-0 flex-1 truncate text-xs font-semibold">{s.title}</p>
                <span className="text-[10px] font-bold tabular-nums text-sky-300">
                  {s.pagesDone}/{s.pageCount} pages
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
