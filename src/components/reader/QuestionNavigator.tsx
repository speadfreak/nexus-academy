// QuestionNavigator — shared question/page navigator for the two exam-taking
// experiences on past papers:
//
//   • ReaderExamMode (strict, timed)  — Pages + Questions + session Highlights
//   • PracticePanel (untimed practice) — same grids plus per-question check marks
//
// Papers are real scanned PDFs, so there is no structured question data to
// lean on: the student declares the question count when the session starts
// and tracks their own progress. That mirrors how students actually work
// through a physical paper (question palette on paper-based mocks) and stays
// honest — no invented question text, no fake answer data.
//
// Session scope: answered/flagged/check state and highlights live in React
// state for the CURRENT session only. Cross-session history is the job of
// examPrepAttempts (logged on finish), not of this component.

import { Flag, Highlighter, LayoutGrid, ListChecks } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Session tracker state (shared shape for both modes) ────────────────

export type CheckMark = "right" | "wrong";

export type QuestionEntry = {
  answered: boolean;
  flagged: boolean;
  /** Practice mode only — result of an explicit "Check answer" action. */
  check: CheckMark | null;
};

/** question number → its session state. Sparse: absent = untouched. */
export type QuestionMap = Record<number, QuestionEntry>;

export type SessionHighlights = { id: string; text: string; page: number };

export type TrackerMode = "answers" | "flags";

export function emptyQuestionMap(): QuestionMap {
  return {};
}

export function entryOf(
  map: QuestionMap,
  n: number,
): QuestionEntry {
  return map[n] ?? { answered: false, flagged: false, check: null };
}

/** Counted progress for the progress bars + finish summary. */
export function trackerStats(map: QuestionMap, total: number) {
  let answered = 0;
  let flagged = 0;
  let right = 0;
  let wrong = 0;
  for (let n = 1; n <= total; n++) {
    const e = entryOf(map, n);
    if (e.answered) answered++;
    if (e.flagged) flagged++;
    if (e.check === "right") right++;
    if (e.check === "wrong") wrong++;
  }
  return { answered, flagged, right, wrong };
}

// ─── Question palette ────────────────────────────────────────────────────

function QuestionChip({
  n,
  entry,
  active,
  mode,
  showChecks,
  onClick,
}: {
  n: number;
  entry: QuestionEntry;
  active: boolean;
  mode: TrackerMode;
  showChecks: boolean;
  onClick: () => void;
}) {
  const checked = showChecks && entry.check !== null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Question ${n}${entry.answered ? ", answered" : ""}${entry.flagged ? ", flagged for review" : ""}${entry.check ? `, checked ${entry.check}` : ""}`}
      className={cn(
        "relative flex size-9 items-center justify-center rounded-lg border type-mono text-xs font-semibold transition-colors cursor-pointer select-none",
        checked && entry.check === "right" &&
          "border-emerald-400/60 bg-emerald-400/25 text-emerald-100",
        checked && entry.check === "wrong" &&
          "border-rose-400/60 bg-rose-400/25 text-rose-100",
        !checked && entry.answered &&
          "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
        !checked && !entry.answered &&
          "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/10",
        entry.flagged &&
          "border-amber-300/70 ring-1 ring-amber-300/40 text-amber-200",
        active && "outline-2 outline-offset-1 outline-amber-300/70",
      )}
    >
      {n}
      {entry.flagged && (
        <Flag className="absolute -right-1 -top-1 size-2.5 fill-amber-300 text-amber-300" />
      )}
    </button>
  );
}

export function QuestionPalette({
  questionCount,
  tracker,
  mode,
  activeQuestion,
  showChecks,
  onToggle,
}: {
  questionCount: number;
  tracker: QuestionMap;
  mode: TrackerMode;
  activeQuestion: number | null;
  showChecks: boolean;
  onToggle: (n: number) => void;
}) {
  const nums: number[] = [];
  for (let n = 1; n <= questionCount; n++) nums.push(n);
  return (
    <div className="flex flex-wrap gap-1.5">
      {nums.map((n) => (
        <QuestionChip
          key={n}
          n={n}
          entry={entryOf(tracker, n)}
          active={activeQuestion === n}
          mode={mode}
          showChecks={showChecks}
          onClick={() => onToggle(n)}
        />
      ))}
    </div>
  );
}

// ─── Page grid (jump to any page — the PDF twin of the question palette) ──

export function PagePalette({
  numPages,
  currentPage,
  onJump,
}: {
  numPages: number;
  currentPage: number;
  onJump: (page: number) => void;
}) {
  if (numPages <= 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Page navigation appears once the PDF has loaded.
      </p>
    );
  }
  const pages: number[] = [];
  for (let p = 1; p <= numPages; p++) pages.push(p);
  return (
    <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto pr-1">
      {pages.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onJump(p)}
          aria-label={`Go to page ${p}`}
          aria-current={p === currentPage}
          className={cn(
            "flex size-9 cursor-pointer items-center justify-center rounded-lg border type-mono text-xs font-semibold transition-colors",
            p === currentPage
              ? "border-amber-300/60 bg-amber-300/15 text-amber-200"
              : "border-white/10 bg-white/[0.04] text-muted-foreground hover:bg-white/10",
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// ─── Session highlights list ─────────────────────────────────────────────

export function HighlightsList({
  highlights,
  onJump,
}: {
  highlights: SessionHighlights[];
  onJump: (page: number) => void;
}) {
  if (highlights.length === 0) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Highlighter className="size-3.5 shrink-0 text-amber-300/70" />
        Select text in the paper, then tap “Highlight” to keep it here for
        this session.
      </p>
    );
  }
  return (
    <ul className="flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1">
      {highlights.map((h) => (
        <li key={h.id}>
          <button
            type="button"
            onClick={() => onJump(h.page)}
            className="w-full cursor-pointer rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-2.5 py-1.5 text-left transition-colors hover:bg-amber-300/[0.12]"
          >
            <span className="type-mono text-[10px] font-bold text-amber-300">
              p.{h.page}
            </span>
            <span className="ml-2 line-clamp-2 text-xs text-foreground/85">
              {h.text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ─── Mode toggle (answers vs flags) ──────────────────────────────────────

export function TrackerModeToggle({
  mode,
  onModeChange,
}: {
  mode: TrackerMode;
  onModeChange: (m: TrackerMode) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
      {(
        [
          { value: "answers" as const, label: "Answers", icon: ListChecks },
          { value: "flags" as const, label: "Review flags", icon: Flag },
        ]
      ).map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => onModeChange(m.value)}
          aria-pressed={mode === m.value}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
            mode === m.value
              ? "bg-amber-300/15 text-amber-200"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <m.icon className="size-3" />
          {m.label}
        </button>
      ))}
    </div>
  );
}

// ─── Slim progress bar ───────────────────────────────────────────────────

export function SlimProgress({
  value,
  tone = "amber",
}: {
  /** 0–100 */
  value: number;
  tone?: "amber" | "emerald";
}) {
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="h-1 w-full overflow-hidden rounded-full bg-white/[0.07]"
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "amber"
            ? "bg-gradient-to-r from-amber-400/80 to-amber-300"
            : "bg-gradient-to-r from-emerald-500/80 to-emerald-400",
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

// Small shared label for the navigator sections.
export function NavigatorSectionLabel({
  icon: Icon,
  children,
}: {
  icon: typeof LayoutGrid;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <Icon className="size-3 text-amber-300/80" />
      {children}
    </p>
  );
}
