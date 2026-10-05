import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Atom,
  Beaker,
  BookOpen,
  Bookmark,
  Bot,
  Brain,
  BrainCircuit,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Compass,
  Copy,
  Edit3,
  FileText,
  Flame,
  Gauge,
  Globe,
  GraduationCap,
  Layers,
  MessageCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  MoreHorizontal,
  NotebookPen,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  PenLine,
  RefreshCw,
  Rocket,
  Search,
  Share2,
  Sparkles,
  Target,
  Timer,
  Trash2,
  Trophy,
  Volume2,
  VolumeX,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { clockTime, relativeTime } from "@/lib/dates";
import { useFriendlyError, errorCode, errorMessage } from "@/lib/errors";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// LEARNYX TUTOR — THE STUDY ROOM.
//
// Not a chat app with a Learnyx skin: a private study room where the AI sits
// across from the student. The architecture is an app shell, not a webpage:
//
//   ┌ sidebar ┬────────── workspace ──────────┬ tools ┐
//   │ search  │ header  (context switchers)   │ drawer│
//   │ context │ mode tabs (gold underline)    │  (xl) │
//   │ threads │ chat canvas (scrolls alone)   │       │
//   │         │ composer (fixed, grows)       │       │
//
// The outer page NEVER scrolls — each region scrolls independently. Messages
// are not floating cards: assistant replies are typography on the canvas with
// a ✦ LEARNYX TUTOR byline; user turns are the only bubbles. Hover reveals
// message actions (copy / retry / edit / branch / read aloud / share).
// 80% calm surface · 15% typography · 5% Learnyx gold.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MessageDoc = {
  _id: string;
  role: "user" | "assistant";
  content: string;
  images?: string[];
  createdAt: number;
};

type TutorMode =
  | "learn"
  | "practice"
  | "exam"
  | "revision"
  | "solve"
  | "quiz";

type SubjectRow = { _id: string; name: string; stream: string; slug: string };

// ---------------------------------------------------------------------------
// Tutor modes — each mode reshapes how the AI behaves (system prompt block
// injected server-side). Rendered as calm tabs with a gold underline.
// ---------------------------------------------------------------------------

const MODES: {
  id: TutorMode;
  label: string;
  icon: React.ElementType;
  hint: string;
}[] = [
  {
    id: "learn",
    label: "Learn",
    icon: Brain,
    hint: "Concepts explained step by step, with a worked example.",
  },
  {
    id: "practice",
    label: "Practice",
    icon: PenLine,
    hint: "One exam-style question at a time — it grades your answers.",
  },
  {
    id: "exam",
    label: "Exam Mode",
    icon: GraduationCap,
    hint: "Strict national-exam simulation. No hints. Running score.",
  },
  {
    id: "revision",
    label: "Quick Revision",
    icon: Zap,
    hint: "Ultra-short key facts, formulas and exam traps.",
  },
  {
    id: "solve",
    label: "Solve With Me",
    icon: Search,
    hint: "Guided reasoning — you attempt each step before I reveal it.",
  },
  {
    id: "quiz",
    label: "Quiz Me",
    icon: Target,
    hint: "Adaptive 5-question quiz that finds your weak sub-topics.",
  },
];

const MODE_STORAGE_KEY = "learnyx.tutor.mode";
const GRADE_STORAGE_KEY = "learnyx.tutor.grade";
const CONCISE_STORAGE_KEY = "learnyx.tutor.concise";
const VOICE_OUT_STORAGE_KEY = "learnyx.tutor.voiceOut";
const TOOLS_STORAGE_KEY = "learnyx.tutor.tools";

// ---------------------------------------------------------------------------
// Starters — grounded in the Ethiopian curriculum + the student's stream.
// ---------------------------------------------------------------------------

const STARTERS: Record<string, string[]> = {
  natural: [
    "Explain Newton's Third Law with an example from everyday life.",
    "Walk me through balancing a chemical equation step by step.",
    "What's the difference between mitosis and meiosis?",
  ],
  social: [
    "Summarise the causes of the 1974 Ethiopian revolution.",
    "Explain the difference between demand and quantity demanded.",
    "Describe Ethiopia's major climate regions in simple terms.",
  ],
  common: [
    "Walk me through solving a quadratic equation step by step.",
    "Explain when to use 'which' vs 'that', with examples.",
    "Give me a practice reasoning question like the SAT exam.",
  ],
};

const GENERAL_STARTERS = [
  "Give me a 3-day revision plan for my stream's exams.",
  "How should I approach a past national exam paper?",
  "Quiz me on anything I've studied — keep it exam-style.",
];

// Subject icon map — gives each conversation a distinctive visual anchor
const SUBJECT_ICONS: Record<string, React.ElementType> = {
  Physics: Atom,
  Chemistry: Beaker,
  Biology: BrainCircuit,
  Mathematics: Calculator,
  English: BookOpen,
  "English Language": BookOpen,
  History: Globe,
  Geography: Globe,
  Economics: GraduationCap,
  Civics: GraduationCap,
  "Civic and Ethical Education": GraduationCap,
  SAT: BrainCircuit,
  General: MessageCircle,
};

function getSubjectIcon(name: string | null): React.ElementType {
  if (!name) return MessageCircle;
  if (SUBJECT_ICONS[name]) return SUBJECT_ICONS[name];
  for (const [key, icon] of Object.entries(SUBJECT_ICONS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return MessageCircle;
}

// ---------------------------------------------------------------------------
// Study Session — a guided 30-minute coached session. The tutor drives the
// student through four timed phases and awards real focus XP at the end.
// ---------------------------------------------------------------------------

const SESSION_PHASES = [
  {
    id: "warmup",
    label: "Warm-up",
    minutes: 5,
    prompt: (s: string) =>
      `Phase 1 — Warm-up (5 min): ask me 3 quick recall questions on ${s} fundamentals to activate what I already know. One at a time.`,
  },
  {
    id: "learn",
    label: "Learn",
    minutes: 10,
    prompt: (s: string) =>
      `Phase 2 — Learn (10 min): teach me the most exam-important ${s} concepts step by step, one at a time, with worked examples.`,
  },
  {
    id: "practice",
    label: "Practice",
    minutes: 10,
    prompt: (s: string) =>
      `Phase 3 — Practice (10 min): exam-style questions on today's material, one at a time. Grade my answers honestly.`,
  },
  {
    id: "challenge",
    label: "Challenge",
    minutes: 5,
    prompt: (s: string) =>
      `Phase 4 — Challenge (5 min): give me your single hardest question on today's material.`,
  },
] as const;

const SESSION_PHASE_STARTS = [0, 5, 15, 25]; // minute boundaries
const SESSION_TOTAL_MINUTES = 30;

type SessionState = {
  subjectId: string;
  subjectName: string;
  startedAt: number;
  phaseIndex: number;
  running: boolean;
  userMessages: number;
} | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip markdown decorations so text-to-speech reads clean prose. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Downscale an image file to a compact JPEG data URL for vision upload. */
async function fileToDownscaledDataUrl(
  file: File,
  maxDim = 1024,
  quality = 0.78,
): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Fallback: raw data URL. The backend cap may reject oversized files.
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Render inline markdown (bold / italic / code) as React nodes — no HTML. */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(
        <strong
          key={`${keyPrefix}-b${i}`}
          className="font-semibold text-foreground"
        >
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded bg-foreground/[0.07] px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<em key={`${keyPrefix}-i${i}`}>{token.slice(1, -1)}</em>);
    }
    last = match.index + token.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** Lightweight markdown renderer for assistant messages — headings, lists,
 * bold, italic, inline code. Deliberately minimal: the tutor's replies are
 * conversational study notes, not documents. Typography does the work. */
function MarkdownLite({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.split("\n");
    const out: React.ReactNode[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    let key = 0;

    const flush = () => {
      if (!list) return;
      const items = list.items;
      out.push(
        list.ordered ? (
          <ol key={`l${key++}`} className="ml-5 list-decimal space-y-1 marker:text-primary/60">
            {items.map((item, j) => (
              <li key={j} className="pl-1">
                {renderInline(item, `l${key}-${j}`)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={`l${key++}`} className="ml-4 list-disc space-y-1 marker:text-primary/50">
            {items.map((item, j) => (
              <li key={j} className="pl-1">
                {renderInline(item, `l${key}-${j}`)}
              </li>
            ))}
          </ul>
        ),
      );
      list = null;
    };

    lines.forEach((line, idx) => {
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (heading) {
        flush();
        out.push(
          <p
            key={`h${idx}`}
            className="mt-2 text-[14px] font-bold tracking-wide text-foreground first:mt-0"
          >
            {renderInline(heading[2], `h${idx}`)}
          </p>,
        );
      } else if (bullet) {
        if (!list || list.ordered) {
          flush();
          list = { ordered: false, items: [] };
        }
        list.items.push(bullet[1]);
      } else if (ordered) {
        if (!list || !list.ordered) {
          flush();
          list = { ordered: true, items: [] };
        }
        list.items.push(ordered[1]);
      } else if (line.trim() === "") {
        flush();
      } else {
        flush();
        out.push(
          <p key={`p${idx}`} className="leading-7">
            {renderInline(line, `p${idx}`)}
          </p>,
        );
      }
    });
    flush();
    return out;
  }, [text]);

  return <div className="flex flex-col gap-1.5">{blocks}</div>;
}

/** Readiness model — merges every completed result (paper exams, mock
 * exams, quizzes) into a per-subject readiness score. Recent results weigh
 * more (5,4,3,2,1), so improvement shows up fast. */
function computeReadiness(
  rows: { subjectName: string | null; scorePct: number | null; status: string; date: number }[],
): { per: Map<string, number>; overall: number | null } {
  const bySubject = new Map<string, { score: number; date: number }[]>();
  for (const row of rows) {
    if (!row.subjectName || row.scorePct === null || row.status !== "completed") continue;
    const list = bySubject.get(row.subjectName) ?? [];
    list.push({ score: row.scorePct, date: row.date });
    bySubject.set(row.subjectName, list);
  }
  const per = new Map<string, number>();
  for (const [name, entries] of bySubject) {
    const recent = entries.sort((a, b) => b.date - a.date).slice(0, 5);
    const weights = [5, 4, 3, 2, 1].slice(0, recent.length);
    const wsum = weights.reduce((a, b) => a + b, 0);
    per.set(
      name,
      Math.round(
        recent.reduce((acc, e, i) => acc + e.score * weights[i], 0) / wsum,
      ),
    );
  }
  const values = [...per.values()];
  const overall = values.length
    ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
    : null;
  return { per, overall };
}

function readinessColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-400";
  if (pct >= 50) return "bg-amber-400";
  return "bg-rose-400";
}

/** Day buckets for the sidebar thread list — Today / Yesterday / This week /
 * Earlier. The study room reads like a study journal, not a flat dump. */
function conversationBucket(updatedAt: number): "today" | "yesterday" | "week" | "earlier" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (updatedAt >= startOfToday) return "today";
  if (updatedAt >= startOfToday - 86_400_000) return "yesterday";
  if (updatedAt >= startOfToday - 6 * 86_400_000) return "week";
  return "earlier";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  earlier: "Earlier",
};

// ---------------------------------------------------------------------------
// The ✦ Learnyx mark — a single glyph, used sparingly.
// ---------------------------------------------------------------------------

function TutorMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block leading-none text-primary", className)}
    >
      ✦
    </span>
  );
}

// ---------------------------------------------------------------------------
// Thinking — "✦ Learnyx is thinking" with three extremely subtle dots.
// Flat on the canvas: no bubble, no border, no scan lines.
// ---------------------------------------------------------------------------

function ThinkingIndicator({ modeLabel }: { modeLabel: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex items-center gap-2.5 pl-7"
    >
      <TutorMark className="text-sm" />
      <span className="type-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground/80">
        Learnyx is thinking
      </span>
      <span className="flex items-center gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.22, ease: "easeInOut" }}
            className="size-1 rounded-full bg-primary"
          />
        ))}
      </span>
      <span className="type-mono text-[10px] text-muted-foreground/40">· {modeLabel}</span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Message action buttons — tiny, quiet, revealed on hover. The premium rule:
// actions exist everywhere, but they never shout.
// ---------------------------------------------------------------------------

function MsgAction({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning,
  active,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  spinning?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 type-mono text-[10px] transition-colors",
        "text-muted-foreground/60 hover:bg-primary/10 hover:text-foreground",
        active && "text-primary hover:text-primary",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <motion.span
        animate={spinning ? { rotate: 360 } : { rotate: 0 }}
        transition={spinning ? { duration: 1.1, repeat: Infinity, ease: "linear" } : { duration: 0.2 }}
        className="flex"
      >
        <Icon className="size-3" />
      </motion.span>
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Assistant message — typography on the canvas, not a floating card.
// Byline: ✦ LEARNYX TUTOR. Actions fade in on hover; the ⋯ menu holds the
// study moves (continue, notes, flashcards, share, simplify…).
// ---------------------------------------------------------------------------

function AssistantMessage({
  message,
  index,
  isLast,
  copiedId,
  onCopy,
  onRegenerate,
  onReadAloud,
  onContinue,
  regenerating,
}: {
  message: MessageDoc;
  index: number;
  isLast: boolean;
  copiedId: string | null;
  onCopy: (message: MessageDoc) => void;
  onRegenerate: () => void;
  onReadAloud: (content: string) => void;
  onContinue: () => void;
  regenerating: boolean;
}) {
  const { t } = useTranslation(["tutor", "common"]);
  const navigate = useNavigate();
  const copied = copiedId === message._id;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.02 * Math.min(index, 6), ease: [0.22, 1, 0.36, 1] }}
      className="group/msg flex flex-col gap-1.5"
    >
      {/* Byline */}
      <div className="flex items-center gap-2 pl-0.5">
        <TutorMark className="text-xs" />
        <span className="type-mono text-[10px] font-bold uppercase tracking-[0.24em] text-primary/90">
          Learnyx Tutor
        </span>
      </div>

      {/* Body — flat text, generous line height */}
      <div className="pl-0.5 text-[14.5px] leading-7 text-foreground/90">
        <MarkdownLite text={message.content} />
      </div>

      {/* Hover actions */}
      <div
        className={cn(
          "-ml-1 flex flex-wrap items-center gap-0.5 pl-0.5 transition-opacity duration-200",
          "opacity-0 group-hover/msg:opacity-100 focus-within:opacity-100",
          isLast && "opacity-100",
        )}
      >
        <MsgAction
          icon={copied ? Check : Copy}
          label={copied
            ? t("tutor:copied", { defaultValue: "Copied" })
            : t("tutor:copy", { defaultValue: "Copy" })}
          onClick={() => onCopy(message)}
          active={copied}
        />
        {isLast && (
          <MsgAction
            icon={RefreshCw}
            label={t("tutor:retry", { defaultValue: "Retry" })}
            onClick={onRegenerate}
            spinning={regenerating}
            disabled={regenerating}
          />
        )}
        <MsgAction
          icon={Volume2}
          label={t("tutor:listen", { defaultValue: "Listen" })}
          onClick={() => onReadAloud(message.content)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className="flex cursor-pointer items-center rounded-lg px-1.5 py-1 text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={onContinue}>
              <Zap className="size-3.5" /> Continue where you stopped
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/notes")}>
              <NotebookPen className="size-3.5" /> Open notes
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onReadAloud(message.content)}>
              <Volume2 className="size-3.5" /> Read aloud
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                const text = stripMarkdown(message.content).slice(0, 400);
                if (navigator.share) {
                  void navigator.share({ title: "Learnyx Tutor", text }).catch(() => {});
                } else {
                  void navigator.clipboard.writeText(text);
                  toast.success("Answer copied — ready to share.");
                }
              }}
            >
              <Share2 className="size-3.5" /> Share answer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-1.5 type-mono text-[10px] text-muted-foreground/40">
          {clockTime(message.createdAt)}
        </span>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// User message — the only bubble in the room. Subtle gold-tinted, right
// aligned. Hover: copy · edit · more (edit & branch, retry from here,
// delete from here). Editing transforms the bubble into an inline editor.
// ---------------------------------------------------------------------------

function UserMessage({
  message,
  index,
  editing,
  onEditStart,
  onEditChange,
  onEditCancel,
  onEditSave,
  onEditBranch,
  onCopy,
  onRetryFrom,
  onDeleteFrom,
  busy,
}: {
  message: MessageDoc;
  index: number;
  editing: { messageId: string; content: string; branch: boolean } | null;
  onEditStart: (message: MessageDoc, branch: boolean) => void;
  onEditChange: (content: string) => void;
  onEditCancel: () => void;
  onEditSave: (message: MessageDoc, content: string) => void;
  onEditBranch: (message: MessageDoc, content: string) => void;
  onCopy: (message: MessageDoc) => void;
  onRetryFrom: (message: MessageDoc) => void;
  onDeleteFrom: (message: MessageDoc) => void;
  busy: boolean;
}) {
  const { t } = useTranslation(["tutor", "common"]);
  const isEditing = editing?.messageId === message._id;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(
        textareaRef.current.value.length,
        textareaRef.current.value.length,
      );
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-end"
      >
        <div className="w-full max-w-[85%] rounded-2xl rounded-br-md border border-primary/40 bg-primary/[0.07] p-3 shadow-[0_0_0_1px_rgb(230_167_46/0.12)] sm:max-w-[75%]">
          <textarea
            ref={textareaRef}
            value={editing?.content ?? ""}
            onChange={(e) => onEditChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (editing && editing.content.trim() && !busy) {
                  if (editing.branch) onEditBranch(message, editing.content);
                  else onEditSave(message, editing.content);
                }
              }
              if (e.key === "Escape") onEditCancel();
            }}
            rows={Math.min(6, (editing?.content ?? "").split("\n").length + 1)}
            className="w-full resize-none bg-transparent text-[14px] leading-6 text-foreground outline-none placeholder:text-muted-foreground/50"
            placeholder="Rewrite your message…"
          />
          <p className="mt-1 type-mono text-[9.5px] text-muted-foreground/60">
            {editing?.branch
              ? t("tutor:branchHint", {
                  defaultValue:
                    "A new branch is created — the original conversation stays untouched.",
                })
              : message.images?.length
                ? t("tutor:editKeepImages", {
                    defaultValue: "Your attached images will be kept.",
                  })
                : t("tutor:editHint", {
                    defaultValue: "The tutor re-answers from this point.",
                  })}
          </p>
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-lg px-2.5 text-xs"
              onClick={onEditCancel}
            >
              {t("tutor:editCancel", { defaultValue: "Cancel" })}
            </Button>
            {editing?.branch ? (
              <Button
                size="sm"
                className="h-7 rounded-lg px-3 text-xs interactive-press"
                disabled={!editing.content.trim() || busy}
                onClick={() => onEditBranch(message, editing.content)}
              >
                <GitBranchFallback /> {t("tutor:branchCreate", { defaultValue: "Create branch" })}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 rounded-lg px-3 text-xs interactive-press"
                disabled={!editing.content.trim() || busy}
                onClick={() => onEditSave(message, editing?.content ?? "")}
              >
                <RefreshCw className="size-3" />
                {t("tutor:editResend", { defaultValue: "Save & resend" })}
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.02 * Math.min(index, 6), ease: [0.22, 1, 0.36, 1] }}
      className="group/msg flex flex-col items-end gap-1"
    >
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-4 py-3 sm:max-w-[75%]">
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap justify-end gap-2">
            {message.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="Attached study material"
                className="max-h-44 rounded-xl border border-primary/20 object-cover"
              />
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-7 text-foreground">
          {message.content}
        </p>
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/msg:opacity-100 focus-within:opacity-100">
        <MsgAction
          icon={Copy}
          label={t("tutor:copy", { defaultValue: "Copy" })}
          onClick={() => onCopy(message)}
        />
        <MsgAction
          icon={Pencil}
          label={t("tutor:edit", { defaultValue: "Edit" })}
          onClick={() => onEditStart(message, false)}
          disabled={busy}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="More actions"
              className="flex cursor-pointer items-center rounded-lg px-1.5 py-1 text-muted-foreground/60 transition-colors hover:bg-primary/10 hover:text-foreground"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => onEditStart(message, true)}>
              <Edit3 className="size-3.5" /> Edit & branch
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRetryFrom(message)} disabled={busy}>
              <RefreshCw className="size-3.5" /> Retry from here
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDeleteFrom(message)}
              disabled={busy}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="size-3.5" /> Delete from here
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-1.5 type-mono text-[10px] text-muted-foreground/40">
          {t("tutor:you", { defaultValue: "you" })} · {clockTime(message.createdAt)}
        </span>
      </div>
    </motion.div>
  );
}

/** Tiny inline branch glyph for the branch button (no extra import weight). */
function GitBranchFallback() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="6" r="2.4" />
      <path d="M6 8.4v7.2M18 8.4c0 4-4 5.6-8 5.6" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Mode tabs — Learn / Practice / Exam / Revision / Solve / Quiz as calm
// text tabs with a sliding gold underline. No chunky pills.
// ---------------------------------------------------------------------------

function ModeTabs({
  mode,
  onModeChange,
  disabled,
}: {
  mode: TutorMode;
  onModeChange: (mode: TutorMode) => void;
  disabled: boolean;
}) {
  const active = MODES.find((m) => m.id === mode) ?? MODES[0];
  return (
    <div className="flex items-center gap-3 px-2 sm:px-3">
      <div
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Tutor mode"
      >
        {MODES.map((m) => {
          const isActive = m.id === mode;
          return (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={disabled}
              onClick={() => onModeChange(m.id)}
              className={cn(
                "relative shrink-0 cursor-pointer px-3 py-2.5 text-xs font-semibold transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isActive ? "text-foreground" : "text-muted-foreground/70 hover:text-foreground",
              )}
            >
              {m.label}
              {isActive && (
                <motion.span
                  layoutId="tutor-mode-underline"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-x-2.5 -bottom-px h-[2px] rounded-full bg-primary shadow-[0_0_8px_rgb(230_167_46/0.55)]"
                />
              )}
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={active.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="hidden shrink-0 type-mono text-[10px] text-muted-foreground/60 xl:block"
        >
          {active.hint}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — study context card. What Learnyx knows, at a glance.
// ---------------------------------------------------------------------------

function StudyContextCard({
  displayName,
  grade,
  streamLabel,
  weakestName,
  readinessOverall,
  concise,
  onConciseChange,
}: {
  displayName: string | null;
  grade: number | null;
  streamLabel: string;
  weakestName: string | null;
  readinessOverall: number | null;
  concise: boolean;
  onConciseChange: (next: boolean) => void;
}) {
  const { t } = useTranslation(["tutor", "common"]);
  return (
    <div className="glass-soft rounded-xl p-3">
      <p className="type-mono text-[9px] font-bold uppercase tracking-[0.22em] text-muted-foreground/70">
        {t("tutor:studyContext", { defaultValue: "Your study context" })}
      </p>
      <ul className="mt-2 flex flex-col gap-1.5 type-body text-[11.5px] text-muted-foreground">
        <li className="flex items-center gap-2 truncate">
          <Sparkles className="size-3 shrink-0 text-primary/70" />
          <span className="truncate font-medium text-foreground">
            {displayName ?? t("tutor:memoryName", { defaultValue: "Your name" })}
          </span>
        </li>
        <li className="flex items-center gap-2">
          <GraduationCap className="size-3 shrink-0 text-primary/70" />
          {grade
            ? t("tutor:memoryGrade", { defaultValue: "Grade {{grade}}", grade })
            : t("tutor:memoryNoGrade", { defaultValue: "Grade not set" })}
          <span className="text-muted-foreground/40">·</span>
          <span className="truncate">{streamLabel}</span>
        </li>
        {weakestName && (
          <li className="flex items-center gap-2">
            <Target className="size-3 shrink-0 text-rose-300/80" />
            <span className="truncate">
              {t("tutor:memoryWeak", { defaultValue: "{{subject}} needs work", subject: weakestName })}
            </span>
          </li>
        )}
        {readinessOverall !== null && (
          <li className="flex items-center gap-2">
            <Gauge className="size-3 shrink-0 text-emerald-300/80" />
            {t("tutor:readinessLabel", { defaultValue: "{{pct}}% exam ready", pct: readinessOverall })}
          </li>
        )}
      </ul>
      <button
        type="button"
        onClick={() => onConciseChange(!concise)}
        className={cn(
          "mt-2.5 flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors interactive-press",
          concise
            ? "bg-primary/15 text-primary"
            : "bg-foreground/[0.05] text-muted-foreground hover:text-foreground",
        )}
      >
        {t("tutor:memoryConcise", { defaultValue: "Prefers concise" })}
        <span
          className={cn(
            "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
            concise ? "bg-primary/70" : "bg-foreground/15",
          )}
        >
          <span
            className={cn(
              "size-3 rounded-full bg-background transition-transform",
              concise && "translate-x-3",
            )}
          />
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — one conversation row. Subject glyph · title · relative time.
// Hover reveals a two-step delete (arm → confirm) so threads never vanish
// by accident but never need a modal either.
// ---------------------------------------------------------------------------

function ConversationRow({
  conversation,
  active,
  armed,
  onSelect,
  onArmDelete,
  onDelete,
}: {
  conversation: {
    _id: string;
    title?: string;
    subjectName: string | null;
    subjectId?: string;
    updatedAt: number;
  };
  active: boolean;
  armed: boolean;
  onSelect: () => void;
  onArmDelete: () => void;
  onDelete: () => void;
}) {
  const SubjectIcon = getSubjectIcon(conversation.subjectName);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8, scale: 0.97 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "group/conv relative flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors",
        active ? "bg-primary/[0.1]" : "hover:bg-foreground/[0.045]",
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-[2.5px] rounded-full bg-primary" aria-hidden="true" />
      )}
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
          active ? "bg-primary/15 text-primary" : "bg-foreground/[0.05] text-muted-foreground/60",
        )}
      >
        <SubjectIcon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <p className={cn("type-caption truncate font-semibold", active && "text-primary")}>
          {conversation.title ?? "Untitled chat"}
        </p>
        <p className="mt-0.5 flex items-center justify-between type-caption text-muted-foreground/55">
          <span className="truncate">{conversation.subjectName ?? "general"}</span>
          <span className="shrink-0 pl-2">{relativeTime(conversation.updatedAt)}</span>
        </p>
      </div>
      <button
        type="button"
        aria-label={armed ? "Confirm delete" : "Delete conversation"}
        title={armed ? "Click again to delete" : "Delete"}
        onClick={(e) => {
          e.stopPropagation();
          if (armed) onDelete();
          else onArmDelete();
        }}
        onBlur={() => {
          if (armed) onArmDelete();
        }}
        className={cn(
          "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-lg opacity-0 transition-all group-hover/conv:opacity-100",
          armed
            ? "bg-destructive/15 text-destructive opacity-100"
            : "text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive",
        )}
      >
        {armed ? <span className="type-mono text-[8px] font-bold">SURE</span> : <Trash2 className="size-3" />}
      </button>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar — tutor history search. Turns the thread list into a knowledge
// archive: matches inside message content, not just titles.
// ---------------------------------------------------------------------------

type SearchResult = {
  messageId: string;
  conversationId: string;
  title: string;
  role: "user" | "assistant";
  snippet: string;
  createdAt: number;
};

function SearchPanel({
  query,
  onQueryChange,
  results,
  loading,
  onOpenResult,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[] | undefined;
  loading: boolean;
  onOpenResult: (r: SearchResult) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search Tutor history…"
          className="h-9 rounded-xl bg-foreground/[0.05] pl-9 text-xs"
        />
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5" data-lenis-prevent-wheel>
        {query.trim().length < 2 ? (
          <p className="px-1 py-6 text-center type-mono text-[10px] leading-5 text-muted-foreground/50">
            Type at least two characters.
            <br />
            Every message you've had with the
            <br />
            Tutor is searchable.
          </p>
        ) : results === undefined || loading ? (
          <div className="flex justify-center py-6">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
              className="size-4 rounded-full border-2 border-primary/30 border-t-primary"
            />
          </div>
        ) : results.length === 0 ? (
          <p className="px-1 py-6 text-center type-mono text-[10px] text-muted-foreground/50">
            No matches in your history.
          </p>
        ) : (
          results.map((r) => {
            const SubjectIcon = getSubjectIcon(r.title.split(":")[0]);
            return (
              <button
                key={r.messageId}
                type="button"
                onClick={() => onOpenResult(r)}
                className="flex w-full cursor-pointer flex-col gap-1 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.045]"
              >
                <span className="flex items-center gap-2 type-caption font-semibold text-foreground/90">
                  <SubjectIcon className="size-3 shrink-0 text-primary/70" />
                  <span className="truncate">{r.title}</span>
                  <span className="ml-auto shrink-0 type-mono text-[9px] font-normal text-muted-foreground/50">
                    {relativeTime(r.createdAt)}
                  </span>
                </span>
                <span className="line-clamp-2 text-[11px] leading-4 text-muted-foreground/75">
                  {r.snippet}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome dashboard — the study-room empty state. "WHAT ARE WE LEARNING?"
// plus every personalized instrument the Tutor owns: journey stats, today's
// mission, the exam coach, textbook grounding, starters and the guided
// study session.
// ---------------------------------------------------------------------------

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="glass-soft flex items-center gap-2.5 rounded-xl px-3 py-2.5">
      <div
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          accent,
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 leading-tight">
        <p className="type-h3 truncate">{value}</p>
        <p className="type-mono truncate text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70">
          {label}
        </p>
      </div>
    </div>
  );
}

function ExamCoachCard({
  readiness,
  weakest,
  onTrain,
  disabled,
}: {
  readiness: { per: Map<string, number>; overall: number | null };
  weakest: { name: string; readiness: number } | null;
  onTrain: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation(["tutor", "common"]);
  const navigate = useNavigate();

  const bars = [...readiness.per.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="w-full rounded-2xl border border-primary/15 bg-primary/[0.04] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 type-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
          <GraduationCap className="size-3.5" />
          {t("tutor:coachTitle", { defaultValue: "Exam Coach" })}
        </p>
        {readiness.overall !== null && (
          <Badge className="border-primary/20 bg-primary/10 font-mono text-[10px] text-primary">
            {readiness.overall}% {t("tutor:coachReady", { defaultValue: "ready" })}
          </Badge>
        )}
      </div>

      {bars.length === 0 ? (
        <div className="mt-3 flex flex-col items-start gap-2.5">
          <p className="type-body text-sm text-muted-foreground">
            {t("tutor:coachEmpty", {
              defaultValue:
                "Take your first mock exam or quiz to unlock your readiness map — Learnyx will track every subject and point you at the gaps.",
            })}
          </p>
          <Button
            size="sm"
            className="rounded-xl interactive-press"
            onClick={() => navigate("/mock-exam")}
          >
            <Trophy className="size-3.5" />
            {t("tutor:coachTakeMock", { defaultValue: "Take a mock exam" })}
          </Button>
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-col gap-2">
            {bars.map(([name, pct]) => (
              <div key={name} className="flex items-center gap-2.5">
                <span className="w-20 shrink-0 truncate text-right type-mono text-[10px] text-muted-foreground">
                  {name}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, pct)}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("h-full rounded-full", readinessColor(pct))}
                  />
                </div>
                <span className="w-9 shrink-0 type-mono text-[10px] text-foreground/80">
                  {pct}%
                </span>
              </div>
            ))}
          </div>
          {weakest && (
            <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-foreground/[0.07] pt-3">
              <p className="min-w-0 type-body text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {t("tutor:coachToday", { defaultValue: "Recommended today" })}:{" "}
                </span>
                {weakest.name} → {t("tutor:coachQuestions", { defaultValue: "10 questions" })}
              </p>
              <Button
                size="sm"
                className="shrink-0 rounded-xl interactive-press"
                disabled={disabled}
                onClick={onTrain}
              >
                <Rocket className="size-3.5" />
                {t("tutor:coachStart", { defaultValue: "Start Training" })}
              </Button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

function WelcomeState({
  displayName,
  grade,
  streamLabel,
  streak,
  level,
  readiness,
  weakest,
  quizCount,
  missionSubjectId,
  onMissionContinue,
  onMissionQuiz,
  onSubjectPick,
  onStudySession,
  onTrain,
  disabled,
  starters,
  latestMock,
  scopedTextbooks,
  contentId,
  onGroundTextbook,
  onOpenReader,
  onSendStarter,
}: {
  displayName: string | null;
  grade: number | null;
  streamLabel: string;
  streak: number;
  level: number;
  readiness: { per: Map<string, number>; overall: number | null };
  weakest: { name: string; readiness: number } | null;
  quizCount: number;
  missionSubjectId: string | null;
  onMissionContinue: () => void;
  onMissionQuiz: () => void;
  onSubjectPick: (subject: SubjectRow) => void;
  onStudySession: () => void;
  onTrain: () => void;
  disabled: boolean;
  starters: string[];
  latestMock: { totalScore: number } | null;
  scopedTextbooks: { _id: string; title: string; contentType: string; grade: number }[];
  contentId: string | null;
  onGroundTextbook: (book: { _id: string; title: string }) => void;
  onOpenReader: (id: string) => void;
  onSendStarter: (prompt: string) => void;
}) {
  const { t } = useTranslation(["tutor", "common"]);

  const recommended = [...readiness.per.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);

  const missionPct = weakest?.readiness ?? 0;

  return (
    <div className="flex w-full flex-col gap-6 py-2">
      {/* ── Hero — the study room welcome ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-2.5 pt-4 text-center"
      >
        <TutorMark className="text-2xl" />
        <h1 className="type-h1 tracking-tight">
          {t("tutor:whatLearning", { defaultValue: "WHAT ARE WE LEARNING?" })}
        </h1>
        <p className="type-body max-w-lg text-muted-foreground">
          {t("tutor:welcomeSubStudyRoom", {
            defaultValue:
              "Ask a question, upload a problem, or start an exam-focused session.",
          })}
          {displayName
            ? ` ${t("tutor:welcomeReady", {
                defaultValue: "{{name}} — Grade {{grade}} · {{stream}} · built for the Ethiopian national exam.",
                name: "",
                grade: grade ?? "9–12",
                stream: streamLabel,
              })}`
            : grade
              ? ` ${t("tutor:welcomeScoped", {
                  defaultValue: "Grade {{grade}} · {{stream}} · built for the Ethiopian national exam 🇪🇹.",
                  grade,
                  stream: streamLabel,
                })}`
              : ` ${t("tutor:welcomeGeneric", {
                  defaultValue: "Grades 9–12 · built for the Ethiopian national exam 🇪🇹.",
                })}`}
        </p>
      </motion.div>

      {/* ── Journey stats ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
        className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4"
      >
        <StatTile
          icon={Flame}
          label={t("tutor:statStreak", { defaultValue: "day streak" })}
          value={`${streak}`}
          accent="bg-orange-400/12 text-orange-300"
        />
        <StatTile
          icon={Target}
          label={t("tutor:statReadiness", { defaultValue: "readiness" })}
          value={readiness.overall !== null ? `${readiness.overall}%` : "—"}
          accent="bg-emerald-400/12 text-emerald-300"
        />
        <StatTile
          icon={PenLine}
          label={t("tutor:statQuizzes", { defaultValue: "quizzes done" })}
          value={`${quizCount}`}
          accent="bg-teal-400/12 text-teal-300"
        />
        <StatTile
          icon={Zap}
          label={t("tutor:statLevel", { defaultValue: "level" })}
          value={`${level}`}
          accent="bg-violet-400/12 text-violet-300"
        />
      </motion.div>

      {/* ── Mission + Exam Coach — side by side on wide screens ── */}
      <div className="grid w-full gap-3 lg:grid-cols-2">
        {weakest && missionSubjectId && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="glass-soft w-full rounded-2xl p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 type-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                  <Target className="size-3.5" />
                  {t("tutor:missionTitle", { defaultValue: "Today's Mission" })}
                </p>
                <p className="type-h3 mt-1.5 truncate">{weakest.name}</p>
                <p className="type-mono mt-0.5 text-[10px] text-muted-foreground">
                  {t("tutor:missionSub", {
                    defaultValue: "Your weakest subject right now — fix it before the exam.",
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  className="rounded-xl interactive-press"
                  disabled={disabled}
                  onClick={onMissionContinue}
                >
                  {t("tutor:missionContinue", { defaultValue: "Continue" })}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl bg-foreground/5 interactive-press"
                  disabled={disabled}
                  onClick={onMissionQuiz}
                >
                  {t("tutor:missionQuiz", { defaultValue: "Quiz Me" })}
                </Button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2.5">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, missionPct)}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className={cn("h-full rounded-full", readinessColor(missionPct))}
                />
              </div>
              <span className="type-mono text-[10px] text-muted-foreground">{missionPct}%</span>
            </div>
          </motion.div>
        )}
        <ExamCoachCard
          readiness={readiness}
          weakest={weakest}
          onTrain={onTrain}
          disabled={disabled}
        />
      </div>

      {/* ── Recommended for you ── */}
      {recommended.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <p className="mb-2 px-1 type-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
            {t("tutor:recommendedTitle", { defaultValue: "Recommended for you" })}
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {recommended.map(([name, pct]) => {
              const Icon = getSubjectIcon(name);
              return (
                <button
                  key={name}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    const match = subjects_pickFallback(name);
                    if (match) onSubjectPick(match);
                  }}
                  className="glass-soft group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all hover:border-primary/30 hover:bg-primary/[0.06] disabled:cursor-not-allowed disabled:opacity-50 interactive-press"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-xs font-semibold text-foreground">{name}</p>
                    <p className="type-mono text-[9px] text-muted-foreground">
                      {pct}% {t("tutor:recReady", { defaultValue: "readiness" })}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Textbook grounding ── */}
      {scopedTextbooks.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <p className="mb-2 px-1 type-mono text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
            📖 {t("tutor:textbookTitle", { defaultValue: "Answer from your textbooks" })}
          </p>
          <div className="flex flex-wrap gap-2">
            {scopedTextbooks.map((book) => {
              const isGrounded = contentId === book._id;
              return (
                <div
                  key={book._id}
                  className={cn(
                    "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs transition-all interactive-press",
                    isGrounded
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "glass-soft text-muted-foreground hover:text-foreground",
                  )}
                >
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-1.5"
                    onClick={() => onGroundTextbook(book)}
                  >
                    <Bookmark className="size-3.5" />
                    <span className="max-w-[180px] truncate font-medium">{book.title}</span>
                    <span className="type-mono text-[9px] opacity-70">G{book.grade}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Open in reader"
                    className="cursor-pointer opacity-60 transition-opacity hover:opacity-100"
                    onClick={() => onOpenReader(book._id)}
                  >
                    →
                  </button>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ── Starters ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="grid w-full gap-2.5 sm:grid-cols-2"
      >
        {starters.map((prompt, i) => (
          <motion.button
            key={prompt}
            type="button"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.24 + 0.05 * i, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => onSendStarter(prompt)}
            disabled={disabled}
            className={cn(
              "cursor-pointer rounded-xl px-4 py-3.5 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:bg-foreground/[0.045] hover:text-foreground disabled:opacity-50 interactive-press border border-transparent",
              i === 0 && latestMock
                ? "border-primary/20 bg-primary/[0.06] text-foreground hover:border-primary/40 hover:bg-primary/[0.1]"
                : "glass-soft",
            )}
          >
            <span className="mr-2.5 font-mono text-[10px] text-primary">$</span>
            {prompt}
          </motion.button>
        ))}
      </motion.div>

      {/* ── Guided Study Session CTA ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="w-full pb-2"
      >
        <button
          type="button"
          disabled={disabled}
          onClick={onStudySession}
          className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.06] p-4 text-left transition-all hover:border-primary/40 hover:bg-primary/[0.1] disabled:cursor-not-allowed disabled:opacity-50 interactive-press"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Timer className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">
              🚀 {t("tutor:sessionCta", { defaultValue: "Start 30-min Study Session" })}
            </p>
            <p className="type-mono mt-0.5 text-[10px] text-muted-foreground">
              {t("tutor:sessionCtaSub", {
                defaultValue:
                  "Warm-up → Learn → Practice → Challenge — coached end to end, focus XP on completion.",
              })}
            </p>
          </div>
          <div className="type-mono text-xs text-primary opacity-60 transition-opacity group-hover:opacity-100">
            →
          </div>
        </button>
      </motion.div>
    </div>
  );
}

// Module-level hook shim so recommended chips can resolve subjects without
// prop drilling the full list through two layers.
let subjectsResolver: ((name: string) => SubjectRow | null) | null = null;
function subjects_pickFallback(name: string): SubjectRow | null {
  return subjectsResolver?.(name) ?? null;
}

// ---------------------------------------------------------------------------
// Contextual action chips — under the latest assistant answer. Every AI
// answer becomes a study workflow: simplify, quiz, flashcards, notes,
// different explanation, open the grounded source.
// ---------------------------------------------------------------------------

function ActionChips({
  canOpenSource,
  canMakeNotes,
  onSimplify,
  onQuiz,
  onFlashcards,
  onNotes,
  onDifferently,
  onOpenSource,
  disabled,
}: {
  canOpenSource: boolean;
  canMakeNotes: boolean;
  onSimplify: () => void;
  onQuiz: () => void;
  onFlashcards: () => void;
  onNotes: () => void;
  onDifferently: () => void;
  onOpenSource: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation(["tutor", "common"]);
  const chips: {
    key: string;
    label: string;
    icon: React.ElementType;
    onClick: () => void;
    show: boolean;
  }[] = [
    { key: "source", label: t("tutor:actSource", { defaultValue: "Open source" }), icon: BookOpen, onClick: onOpenSource, show: canOpenSource },
    { key: "simplify", label: t("tutor:actSimplify", { defaultValue: "Explain deeper" }), icon: Sparkles, onClick: onSimplify, show: true },
    { key: "quiz", label: t("tutor:actQuiz", { defaultValue: "Quiz me" }), icon: Target, onClick: onQuiz, show: true },
    { key: "cards", label: t("tutor:actFlashcards", { defaultValue: "Make flashcards" }), icon: Layers, onClick: onFlashcards, show: true },
    { key: "notes", label: t("tutor:actNotes", { defaultValue: "Make notes" }), icon: FileText, onClick: onNotes, show: canMakeNotes },
    { key: "differently", label: t("tutor:actDifferently", { defaultValue: "Explain differently" }), icon: Compass, onClick: onDifferently, show: true },
  ];

  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {chips
        .filter((chip) => chip.show)
        .map((chip) => {
          const Icon = chip.icon;
          return (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onClick}
              disabled={disabled}
              className="group flex cursor-pointer items-center gap-1.5 rounded-full border border-primary/15 bg-primary/[0.05] px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:border-primary/40 hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 interactive-press"
            >
              <Icon className="size-3 text-primary/80 transition-colors group-hover:text-primary" />
              {chip.label}
            </button>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The study composer. Grows to ~200px, keeps its tools visible (image,
// textbook grounding, voice), shows the grounded context chip, and sends
// with Enter. The single most-used surface in the room — built like it.
// ---------------------------------------------------------------------------

function Composer({
  input,
  onInputChange,
  inputRef,
  fileInputRef,
  onFilesPicked,
  images,
  attaching,
  onAttachClick,
  onRemoveImage,
  onSend,
  isAwaiting,
  speech,
  entitlements,
  groundedTitle,
  onClearGrounded,
  textbooks,
  activeTextbookId,
  onPickTextbook,
  t,
}: {
  input: string;
  onInputChange: (v: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFilesPicked: (files: FileList | null) => void;
  images: string[];
  attaching: boolean;
  onAttachClick: () => void;
  onRemoveImage: (i: number) => void;
  onSend: () => void;
  isAwaiting: boolean;
  speech: {
    supported: boolean;
    listening: boolean;
    start: () => void;
    stop: () => void;
  };
  entitlements: { premiumAccess: boolean; tutorRemainingToday: number; tutorDailyLimit: number } | null | undefined;
  groundedTitle: string | null;
  onClearGrounded: () => void;
  textbooks: { _id: string; title: string; contentType: string; grade: number }[];
  activeTextbookId: string | null;
  onPickTextbook: (book: { _id: string; title: string }) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

  // Auto-grow: the textarea breathes with the question, up to ~200px.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input, inputRef]);

  return (
    <div className="relative z-10 shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5">
      <div className="mx-auto w-full max-w-[960px]">
        {/* Grounded context chip — "I'm not just talking to an AI, I'm studying THIS." */}
        <AnimatePresence>
          {groundedTitle && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.2 }}
              className="mb-2 flex"
            >
              <span className="flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 py-1 pl-2.5 pr-1.5 text-[11px] font-medium text-primary">
                <BookOpen className="size-3" />
                <span className="max-w-[260px] truncate">{groundedTitle}</span>
                <button
                  type="button"
                  aria-label="Stop grounding answers in this document"
                  onClick={onClearGrounded}
                  className="flex size-4 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-primary/20"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Attachment previews */}
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {images.map((src, i) => (
              <div
                key={i}
                className="group relative size-14 overflow-hidden rounded-lg border border-primary/20"
              >
                <img src={src} alt="Attachment preview" className="size-full object-cover" />
                <button
                  type="button"
                  aria-label="Remove attachment"
                  onClick={() => onRemoveImage(i)}
                  className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <X className="size-4 text-white" />
                </button>
              </div>
            ))}
            <span className="type-mono text-[10px] text-muted-foreground">
              {images.length}/2 · {t("tutor:attachHint", { defaultValue: "the AI will read your images" })}
            </span>
          </div>
        )}

        {/* The composer shell — one border, no card-in-card */}
        <div
          className={cn(
            "rounded-2xl border border-border/80 bg-card/50 backdrop-blur-md transition-all duration-200",
            "focus-within:border-primary/45 focus-within:shadow-[0_0_0_1px_rgb(230_167_46/0.18),0_12px_40px_-16px_rgb(230_167_46/0.3)]",
          )}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            rows={1}
            placeholder={
              speech.listening
                ? t("tutor:listening", { defaultValue: "Listening… speak now" })
                : t("tutor:inputPlaceholder", {
                    defaultValue: "Ask Learnyx anything…",
                  })
            }
            disabled={isAwaiting}
            className={cn(
              "block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 type-body leading-6 outline-none placeholder:text-muted-foreground/60",
              speech.listening && "placeholder:text-rose-300",
            )}
          />
          <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1.5">
            {/* Image upload */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(e) => onFilesPicked(e.target.files)}
            />
            <button
              type="button"
              onClick={onAttachClick}
              disabled={isAwaiting || images.length >= 2 || attaching}
              aria-label="Attach an image"
              title="Attach a textbook page, handwritten work or a problem screenshot (max 2)"
              className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground/70 transition-colors hover:bg-primary/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              {attaching ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="block size-3.5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
                />
              ) : (
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              )}
            </button>

            {/* Textbook grounding picker */}
            {textbooks.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Ground answers in a textbook"
                    title="Ground answers in one of your textbooks"
                    className={cn(
                      "flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-primary/10 hover:text-foreground",
                      activeTextbookId ? "text-primary" : "text-muted-foreground/70",
                    )}
                  >
                    <BookOpen className="size-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" className="w-72 p-2">
                  <p className="px-1.5 pb-1.5 type-mono text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
                    {t("tutor:textbookTitle", { defaultValue: "Answer from your textbooks" })}
                  </p>
                  <div className="max-h-56 overflow-y-auto">
                    {textbooks.map((book) => (
                      <button
                        key={book._id}
                        type="button"
                        onClick={() => onPickTextbook(book)}
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-primary/10",
                          activeTextbookId === book._id && "bg-primary/10 text-primary",
                        )}
                      >
                        <BookOpen className="size-3.5 shrink-0 opacity-70" />
                        <span className="truncate font-medium">{book.title}</span>
                        <span className="ml-auto shrink-0 type-mono text-[9px] opacity-60">G{book.grade}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {entitlements && !entitlements.premiumAccess && (
              <span
                title={
                  entitlements.tutorRemainingToday > 0
                    ? `${entitlements.tutorRemainingToday} of ${entitlements.tutorDailyLimit} free messages left today`
                    : "Daily free messages used — they reset tomorrow"
                }
                className="ml-1 hidden shrink-0 rounded-lg border border-premium/30 bg-premium/8 px-2 py-1 font-mono text-[10px] text-premium sm:block"
              >
                free · {entitlements.tutorRemainingToday}/{entitlements.tutorDailyLimit}
              </span>
            )}

            <span className="hidden flex-1 items-center gap-1.5 pl-2 type-mono text-[9.5px] text-muted-foreground/40 md:flex">
              <kbd className="rounded border border-foreground/10 px-1">Enter</kbd> send
              <kbd className="rounded border border-foreground/10 px-1">Shift+Enter</kbd> new line
            </span>
            <span className="flex-1 md:hidden" />

            {speech.supported && (
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                disabled={isAwaiting}
                aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
                title={
                  speech.listening
                    ? "Stop listening"
                    : "Speak your question — transcribed text appears in the input"
                }
                className={cn(
                  "flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  speech.listening
                    ? "bg-rose-500/15 text-rose-300"
                    : "text-muted-foreground/70 hover:bg-primary/10 hover:text-foreground",
                )}
              >
                {speech.listening ? (
                  <motion.span
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                    className="flex"
                  >
                    <MicOff className="size-4" />
                  </motion.span>
                ) : (
                  <Mic className="size-4" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onSend}
              disabled={(!input.trim() && images.length === 0) || isAwaiting}
              aria-label="Send message"
              className="ml-1 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-primary font-semibold text-primary-foreground shadow-[0_6px_20px_-8px_rgb(230_167_46/0.8)] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
            >
              {isAwaiting ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  className="block size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>
        <p className="mt-1.5 hidden text-center type-mono text-[9px] text-muted-foreground/35 sm:block">
          {t("tutor:composerFootnote", {
            defaultValue: "Learnyx tutors — it can still make mistakes. Check important facts.",
          })}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component — the Study Room.
// ---------------------------------------------------------------------------

export default function Tutor() {
  const friendlyError = useFriendlyError();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation(["tutor", "common"]);

  // ── Data ──
  const subjects = useQuery(api.subjects.getAll);
  const conversations = useQuery(api.ai.listConversations);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const profile = useQuery(api.profile.getProfile);
  const streakData = useQuery(api.studySessions.getStreak);
  const levelData = useQuery(api.xp.getMyLevel);
  const prepResults = useQuery(api.examPrep.getMyExamPrepResults);
  const mockExamHistory = useQuery(api.mockExam.getMyMockExams);

  const updateProfile = useMutation(api.profile.updateProfile);
  const logSession = useMutation(api.studySessions.logSession);
  const saveNotes = useAction(api.ai.saveNotesFromConversation);

  // ── Study Room engine — edit / branch / regenerate / search / delete ──
  const truncateFrom = useMutation(api.ai.truncateFromMessage);
  const regenerateReply = useAction(api.ai.regenerateReply);
  const branchConversation = useAction(api.ai.branchConversation);
  const deleteConversationMutation = useMutation(api.ai.deleteConversation);

  // ── Core chat state ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capPromptOpen, setCapPromptOpen] = useState(false);
  const [scopeSubjectId, setScopeSubjectId] = useState("");
  const [contentId, setContentId] = useState<string | null>(
    searchParams.get("contentId"),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState<{ content: string; edited?: boolean } | null>(null);
  const [isAwaiting, setIsAwaiting] = useState(false);

  // ── Message-level interaction state ──
  const [editing, setEditing] = useState<{ messageId: string; content: string; branch: boolean } | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [branching, setBranching] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // ── Sidebar state ──
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [armDeleteId, setArmDeleteId] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // ── Tools drawer (persisted) ──
  const [toolsOpen, setToolsOpen] = useState(
    () => localStorage.getItem(TOOLS_STORAGE_KEY) === "true",
  );
  const changeToolsOpen = (next: boolean) => {
    setToolsOpen(next);
    localStorage.setItem(TOOLS_STORAGE_KEY, String(next));
  };

  // ── Tutor mode + academic memory (persisted client-side) ──
  const [mode, setMode] = useState<TutorMode>(() => {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    return MODES.some((m) => m.id === stored) ? (stored as TutorMode) : "learn";
  });
  const [grade, setGrade] = useState<number | null>(() => {
    const stored = Number(localStorage.getItem(GRADE_STORAGE_KEY));
    return [9, 10, 11, 12].includes(stored) ? stored : null;
  });
  const [stream, setStream] = useState<"natural" | "social">("natural");
  const [concise, setConcise] = useState(
    () => localStorage.getItem(CONCISE_STORAGE_KEY) === "true",
  );
  const profileSynced = useRef(false);
  useEffect(() => {
    if (!profile || profileSynced.current) return;
    profileSynced.current = true;
    if (profile.stream === "social") setStream("social");
    if (!grade && profile.gradeLevel) setGrade(profile.gradeLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const changeGrade = (next: number | null) => {
    setGrade(next);
    if (next) localStorage.setItem(GRADE_STORAGE_KEY, String(next));
    else localStorage.removeItem(GRADE_STORAGE_KEY);
    if (next && next !== profile?.gradeLevel) {
      void updateProfile({ gradeLevel: next as 9 | 10 | 11 | 12 }).catch(() => {});
    }
  };

  const changeStream = (next: "natural" | "social") => {
    setStream(next);
    setScopeSubjectId("");
    if (next !== profile?.stream) {
      void updateProfile({ stream: next }).catch(() => {});
    }
  };

  const changeMode = (next: TutorMode) => {
    setMode(next);
    localStorage.setItem(MODE_STORAGE_KEY, next);
  };

  const changeConcise = (next: boolean) => {
    setConcise(next);
    localStorage.setItem(CONCISE_STORAGE_KEY, String(next));
  };

  // ── Voice output (TTS) ──
  const [voiceOut, setVoiceOut] = useState(
    () => localStorage.getItem(VOICE_OUT_STORAGE_KEY) === "true",
  );
  const voiceOutRef = useRef(voiceOut);
  useEffect(() => {
    voiceOutRef.current = voiceOut;
  }, [voiceOut]);
  const changeVoiceOut = (next: boolean) => {
    setVoiceOut(next);
    localStorage.setItem(VOICE_OUT_STORAGE_KEY, String(next));
    if (!next && "speechSynthesis" in window) window.speechSynthesis.cancel();
  };
  const speechLang = i18n.language?.startsWith("am") ? "am-ET" : "en-US";
  const speak = useCallback(
    (text: string) => {
      if (!("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(stripMarkdown(text).slice(0, 1200));
      utterance.lang = speechLang;
      const voice = window.speechSynthesis
        .getVoices()
        .find((v) => v.lang?.toLowerCase().startsWith(speechLang.slice(0, 2)));
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    },
    [speechLang],
  );
  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  // ── Voice input ──
  const speech = useSpeechRecognition({ lang: speechLang, continuous: false });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (speech.transcript) {
      setInput((prev) => (prev ? prev + " " : "") + speech.transcript);
      speech.reset();
      inputRef.current?.focus();
    }
  }, [speech.transcript, speech.reset]);
  useEffect(() => {
    if (!speech.error) return;
    if (speech.error === "not-allowed" || speech.error === "service-not-allowed") {
      toast.error("Microphone access denied. Enable it in your browser settings to use voice input.");
    } else if (speech.error === "no-speech") {
      // Silent — the user just didn't say anything audible.
    } else {
      toast.error(`Voice input error: ${speech.error}`);
    }
  }, [speech.error]);

  // ── Image attachments ──
  const [images, setImages] = useState<string[]>([]);
  const [attaching, setAttaching] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAttach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = 2 - images.length;
    if (room <= 0) {
      toast.error("Max 2 images per message.");
      return;
    }
    setAttaching(true);
    try {
      const converted: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        if (!file.type.startsWith("image/")) continue;
        converted.push(await fileToDownscaledDataUrl(file));
      }
      setImages((prev) => [...prev, ...converted].slice(0, 2));
    } catch {
      toast.error("Couldn't read that image — try a JPEG or PNG.");
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Follow-ups + mini-check ──
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [miniCheck, setMiniCheck] = useState<{
    question: string; options: string[]; correctIndex: number; explanation: string;
  } | null>(null);
  const [miniCheckAnswer, setMiniCheckAnswer] = useState<number | null>(null);
  const [fetchingFollowUps, setFetchingFollowUps] = useState(false);

  const contentMeta = useQuery(
    api.content.getContentItemMeta,
    contentId ? { contentId: contentId as never } : "skip",
  );

  const sendMessage = useAction(api.ai.sendMessage);
  const generateFollowUps = useAction(api.ai.generateFollowUps);
  const messages = useQuery(
    api.ai.getMessages,
    selectedId ? { conversationId: selectedId as never } : "skip",
  );

  // ── Tutor history search (debounced) ──
  useEffect(() => {
    const id = setTimeout(() => setSearchQ(searchInput), 280);
    return () => clearTimeout(id);
  }, [searchInput]);
  const searchResults = useQuery(
    api.ai.searchMessages,
    searchOpen && searchQ.trim().length >= 2 ? { q: searchQ.trim() } : "skip",
  );

  useEffect(() => {
    if (!subjects) return;
    const slug = searchParams.get("subject");
    if (!slug) return;
    const match = subjects.find(
      (s: { slug: string; _id: string }) => s.slug === slug,
    );
    if (match) setScopeSubjectId(match._id as string);
  }, [subjects, searchParams]);

  // ── Derived: stream-filtered subjects ──
  const streamSubjects = useMemo(() => {
    if (!subjects) return [];
    return (subjects as SubjectRow[]).filter(
      (s) => s.stream === stream || s.stream === "common",
    );
  }, [subjects, stream]);

  const scopeSubject = useMemo(
    () => streamSubjects.find((s) => s._id === scopeSubjectId) ?? null,
    [streamSubjects, scopeSubjectId],
  );

  // ── Derived: readiness model from real results ──
  const readiness = useMemo(
    () =>
      computeReadiness(
        (prepResults ?? []) as {
          subjectName: string | null;
          scorePct: number | null;
          status: string;
          date: number;
        }[],
      ),
    [prepResults],
  );
  const weakest = useMemo(() => {
    if (readiness.per.size === 0) return null;
    let best: { name: string; readiness: number } | null = null;
    for (const [name, pct] of readiness.per) {
      if (!best || pct < best.readiness) best = { name, readiness: pct };
    }
    return best;
  }, [readiness]);
  const weakestSubjectRow = useMemo(() => {
    if (!weakest || !subjects) return null;
    return (
      (subjects as SubjectRow[]).find(
        (s) => s.name.toLowerCase() === weakest.name.toLowerCase(),
      ) ?? null
    );
  }, [weakest, subjects]);
  const quizCount = useMemo(
    () =>
      ((prepResults ?? []) as { kind: string }[]).filter((r) => r.kind === "quiz")
        .length,
    [prepResults],
  );
  const latestMock = useMemo(() => {
    if (!mockExamHistory) return null;
    const completed = mockExamHistory.filter(
      (h) => h.status === "completed" && h.totalScore !== undefined,
    );
    return completed.length > 0 ? completed[0] : null;
  }, [mockExamHistory]);

  // ── Textbooks scoped to the current subject (grounding) ──
  const textbooks = useQuery(
    api.content.getContent,
    scopeSubject ? { subjectSlug: scopeSubject.slug } : "skip",
  );
  const scopedTextbooks = useMemo(() => {
    if (!textbooks) return [];
    const gradeFiltered =
      grade && grade !== 12
        ? textbooks.filter((b: { grade: number }) => b.grade === grade)
        : textbooks;
    const rank = (tItem: { contentType: string }) =>
      tItem.contentType === "textbook" ? 0 : tItem.contentType === "past_exam" ? 1 : 2;
    return [...gradeFiltered]
      .sort((a: { contentType: string }, b: { contentType: string }) => rank(a) - rank(b))
      .slice(0, 4) as { _id: string; title: string; contentType: string; grade: number }[];
  }, [textbooks, grade]);

  // Register the resolver used by Recommended chips.
  useEffect(() => {
    subjectsResolver = (name: string) => {
      if (!subjects) return null;
      return (
        (subjects as SubjectRow[]).find(
          (s) => s.name.toLowerCase() === name.toLowerCase(),
        ) ?? null
      );
    };
    return () => {
      subjectsResolver = null;
    };
  }, [subjects]);

  const starters = useMemo(() => {
    if (!scopeSubject) {
      return [
        ...GENERAL_STARTERS,
        ...STARTERS.natural.slice(0, 1),
        ...STARTERS.social.slice(0, 1),
      ].slice(0, 4);
    }
    return [
      ...GENERAL_STARTERS.slice(0, 1),
      ...(STARTERS[scopeSubject.stream] ?? []),
    ].slice(0, 4);
  }, [scopeSubject]);

  const startersWithMock = useMemo(() => {
    if (!latestMock) return starters;
    const mockPrompt = `I scored ${latestMock.totalScore}% on my last mock exam — what should I focus on to improve?`;
    return [mockPrompt, ...starters].slice(0, 4);
  }, [starters, latestMock]);

  // ── Canvas scroll model — the canvas scrolls, the page never does. ──
  const canvasRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const [newBelow, setNewBelow] = useState(false);

  const handleCanvasScroll = () => {
    const el = canvasRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 80;
    atBottomRef.current = atBottom;
    setNewBelow((below) => (atBottom ? false : below));
  };

  const scrollToBottom = (smooth = true) => {
    const el = canvasRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottomRef.current = true;
    setNewBelow(false);
  };

  useEffect(() => {
    const count = (messages?.length ?? 0) + (sending ? 1 : 0) + (isAwaiting || regenerating ? 1 : 0);
    const grew = count > prevCountRef.current;
    prevCountRef.current = count;
    if (!grew) return;
    if (atBottomRef.current) {
      const el = canvasRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setNewBelow(true);
    }
  }, [messages, sending, isAwaiting, regenerating]);

  useEffect(() => {
    // New conversation opened → land at the latest message instantly.
    scrollToBottom(false);
    setEditing(null);
    setFollowUps([]);
    setMiniCheck(null);
    setMiniCheckAnswer(null);
  }, [selectedId]);

  // ── Exam-mode transformation — the coach timer ──
  const [examStartedAt, setExamStartedAt] = useState<number | null>(null);
  const [examTick, setExamTick] = useState(0);
  useEffect(() => {
    if (mode === "exam") {
      setExamStartedAt((prev) => prev ?? Date.now());
      const id = setInterval(() => setExamTick((v) => v + 1), 1000);
      return () => clearInterval(id);
    }
    setExamStartedAt(null);
    return undefined;
  }, [mode]);
  void examTick;
  const examElapsedSec = examStartedAt ? Math.floor((Date.now() - examStartedAt) / 1000) : 0;

  // ── Send pipeline ──
  const handleSend = async (
    raw?: string,
    opts?: {
      subjectId?: string;
      modeOverride?: TutorMode;
      imagesOverride?: string[];
      edited?: boolean;
    },
  ) => {
    const content = (raw ?? input).trim();
    if ((!content && images.length === 0) || isAwaiting) return;
    setInput("");
    const sentImages = opts?.imagesOverride ?? images;
    setImages([]);
    setSending({ content: content || "📸 Solve this and explain every step.", edited: opts?.edited });
    setIsAwaiting(true);
    setFollowUps([]);
    setMiniCheck(null);
    setMiniCheckAnswer(null);
    const effectiveMode = opts?.modeOverride ?? mode;
    try {
      const result = await sendMessage({
        conversationId: (selectedId || undefined) as never,
        content,
        subjectId: ((opts?.subjectId ?? scopeSubjectId) || undefined) as never,
        contentId: (contentId || undefined) as never,
        mode: effectiveMode,
        grade: (grade ?? undefined) as 9 | 10 | 11 | 12 | undefined,
        images: sentImages.length > 0 ? sentImages : undefined,
        concise,
      });
      if (!selectedId) setSelectedId(result.conversationId as string);

      // Voice output — read the reply aloud when the student enabled it.
      if (voiceOutRef.current) speak(result.reply);

      if (session?.running) {
        setSession((s) =>
          s ? { ...s, userMessages: s.userMessages + 1 } : s,
        );
      }

      // Follow-ups (fire-and-forget)
      setFetchingFollowUps(true);
      try {
        const fu = await generateFollowUps({
          conversationId: result.conversationId as never,
          subjectId: ((opts?.subjectId ?? scopeSubjectId) || undefined) as never,
        });
        setFollowUps(fu.followUps ?? []);
        setMiniCheck(fu.miniCheck ?? null);
      } catch {
        // Non-fatal
      } finally {
        setFetchingFollowUps(false);
      }
    } catch (error) {
      if (errorCode(error) === "daily_limit_reached") {
        setCapPromptOpen(true);
      } else {
        toast.error(friendlyError(error, "The tutor couldn't reply. Try again."));
      }
    } finally {
      setSending(null);
      setIsAwaiting(false);
    }
  };

  // Keep a ref so the session timer can trigger sends without stale closures.
  const sendRef = useRef(handleSend);
  useEffect(() => {
    sendRef.current = handleSend;
  });

  // ── Message actions — copy, edit & resend, branch, retry, trim ──

  const handleCopy = useCallback(async (message: MessageDoc) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message._id);
      setTimeout(() => setCopiedId((c) => (c === message._id ? null : c)), 1600);
    } catch {
      toast.error("Couldn't copy — select the text manually.");
    }
  }, []);

  const handleRegenerate = async () => {
    if (!selectedId || regenerating || isAwaiting) return;
    setRegenerating(true);
    try {
      await regenerateReply({
        conversationId: selectedId as never,
        mode,
        grade: (grade ?? undefined) as 9 | 10 | 11 | 12 | undefined,
        concise,
      });
    } catch (error) {
      if (errorCode(error) === "daily_limit_reached") setCapPromptOpen(true);
      else toast.error(friendlyError(error, "Couldn't regenerate the answer."));
    } finally {
      setRegenerating(false);
    }
  };

  const saveEdit = async (message: MessageDoc, content: string) => {
    if (!selectedId || !content.trim() || isAwaiting) return;
    setEditing(null);
    try {
      await truncateFrom({
        conversationId: selectedId as never,
        messageId: message._id as never,
      });
      await sendRef.current(content, {
        imagesOverride: message.images ?? [],
        edited: true,
      });
    } catch (error) {
      toast.error(friendlyError(error, "Couldn't resend that message."));
    }
  };

  const branchEdit = async (message: MessageDoc, content: string) => {
    if (!selectedId || !content.trim() || isAwaiting || branching) return;
    setEditing(null);
    setBranching(true);
    try {
      const result = await branchConversation({
        conversationId: selectedId as never,
        messageId: message._id as never,
        content,
        mode,
        grade: (grade ?? undefined) as 9 | 10 | 11 | 12 | undefined,
        concise,
      });
      setSelectedId(result.conversationId as string);
      toast.success("Branch created — the original conversation stays untouched.");
    } catch (error) {
      if (errorCode(error) === "daily_limit_reached") setCapPromptOpen(true);
      else toast.error(friendlyError(error, "Couldn't create the branch."));
    } finally {
      setBranching(false);
    }
  };

  const retryFrom = async (message: MessageDoc) => {
    if (!selectedId || isAwaiting) return;
    try {
      await truncateFrom({
        conversationId: selectedId as never,
        messageId: message._id as never,
      });
      await sendRef.current(message.content, {
        imagesOverride: message.images ?? [],
      });
    } catch (error) {
      toast.error(friendlyError(error, "Couldn't retry from there."));
    }
  };

  const deleteFrom = async (message: MessageDoc) => {
    if (!selectedId || isAwaiting) return;
    try {
      await truncateFrom({
        conversationId: selectedId as never,
        messageId: message._id as never,
      });
      toast("Thread trimmed — everything from that point is gone.");
    } catch (error) {
      toast.error(friendlyError(error, "Couldn't trim the thread."));
    }
  };

  const handleDeleteConversation = async (id: string) => {
    try {
      await deleteConversationMutation({ conversationId: id as never });
      if (selectedId === id) handleNewChat();
      toast.success("Conversation deleted.");
    } catch (error) {
      toast.error(friendlyError(error, "Couldn't delete the conversation."));
    }
  };

  // ── Guided Study Session ──
  const [session, setSession] = useState<SessionState>(null);
  const [sessionComplete, setSessionComplete] = useState<{
    xpAwarded: number;
    levelUp: boolean;
    userMessages: number;
    subjectName: string;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!session?.running) return;
    const id = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, [session?.running]);

  const completeSession = useCallback(
    async (state: NonNullable<SessionState>) => {
      const endedAt = Date.now();
      const duration = Math.max(
        1,
        Math.min(
          Math.floor((endedAt - state.startedAt) / 1000),
          SESSION_TOTAL_MINUTES * 60,
        ),
      );
      setSession((s) => (s ? { ...s, running: false } : s));
      try {
        const result = await logSession({
          subjectId: state.subjectId as never,
          durationSeconds: duration,
          startedAt: state.startedAt,
          endedAt,
          localDate: new Date().toLocaleDateString("en-CA"),
        });
        setSessionComplete({
          xpAwarded: result.xpAwarded,
          levelUp: result.levelUp,
          userMessages: state.userMessages,
          subjectName: state.subjectName,
        });
      } catch {
        toast.error("Session finished, but focus XP couldn't be logged.");
        setSessionComplete({
          xpAwarded: 0,
          levelUp: false,
          userMessages: state.userMessages,
          subjectName: state.subjectName,
        });
      }
    },
    [logSession],
  );

  const sessionElapsedSec = session?.running
    ? Math.floor((Date.now() - session.startedAt) / 1000)
    : 0;

  // Phase advance + completion — driven by the 1-second tick.
  useEffect(() => {
    if (!session?.running) return;
    const elapsedMin = Math.floor(sessionElapsedSec / 60);
    if (elapsedMin >= SESSION_TOTAL_MINUTES) {
      void completeSession(session);
      return;
    }
    let idx = 0;
    for (let i = SESSION_PHASES.length - 1; i >= 0; i--) {
      if (elapsedMin >= SESSION_PHASE_STARTS[i]) {
        idx = i;
        break;
      }
    }
    if (idx !== session.phaseIndex) {
      setSession((s) => (s ? { ...s, phaseIndex: idx } : s));
      const phase = SESSION_PHASES[idx];
      void sendRef.current?.(phase.prompt(session.subjectName), {
        subjectId: session.subjectId,
        modeOverride: idx === 2 ? "practice" : "learn",
      });
      toast(`⏱ Phase ${idx + 1}: ${phase.label}`, { duration: 3500 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, session?.running]);

  const startSession = (subject: SubjectRow) => {
    setSelectedId(null);
    setContentId(null);
    setSending(null);
    setInput("");
    setScopeSubjectId(subject._id);
    setMode("learn");
    localStorage.setItem(MODE_STORAGE_KEY, "learn");
    const fresh: NonNullable<SessionState> = {
      subjectId: subject._id,
      subjectName: subject.name,
      startedAt: Date.now(),
      phaseIndex: 0,
      running: true,
      userMessages: 0,
    };
    setSession(fresh);
    void sendRef.current?.(SESSION_PHASES[0].prompt(subject.name), {
      subjectId: subject._id,
      modeOverride: "learn",
    });
  };

  const activeConversation = conversations?.find(
    (c: { _id: string }) => c._id === (selectedId as never),
  );

  const discussing =
    activeConversation?.contentTitle ?? contentMeta?.title ?? null;

  const lastAssistantId = useMemo(() => {
    if (!messages) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i]._id as string;
    }
    return null;
  }, [messages]);

  const modeLabel = MODES.find((m) => m.id === mode)?.label ?? "Learn";
  const sessionRemainingSec = session?.running
    ? Math.max(0, SESSION_TOTAL_MINUTES * 60 - sessionElapsedSec)
    : 0;
  const fmtCountdown = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

  const makeNotes = async () => {
    if (!selectedId) return;
    toast.loading("Turning the last answer into notes…", { id: "notes" });
    try {
      await saveNotes({ conversationId: selectedId as never });
      toast.success("Saved to your Notes 📝", {
        id: "notes",
        action: { label: "Open", onClick: () => navigate("/notes") },
      });
    } catch (error) {
      toast.error(errorMessage(error, "Couldn't save the note."), { id: "notes" });
    }
  };

  const handleNewChat = useCallback(() => {
    setSelectedId(null);
    setContentId(null);
    setSending(null);
    setIsAwaiting(false);
    setInput("");
    setEditing(null);
    setFollowUps([]);
    setMiniCheck(null);
    setMobileNavOpen(false);
  }, []);

  const openConversation = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSending(null);
      setContentId(null);
      const match = conversations?.find((c) => c._id === (id as never));
      if (match?.subjectId) setScopeSubjectId(match.subjectId as string);
      setMobileNavOpen(false);
    },
    [conversations],
  );

  const groundTextbook = (book: { _id: string; title: string }) => {
    // Reset the thread FIRST (it clears contentId), then apply the grounding —
    // otherwise the reset wipes the freshly-picked textbook.
    handleNewChat();
    setContentId(book._id);
    toast.success(
      t("tutor:textbookGrounded", {
        defaultValue: "Answers will now be grounded in “{{title}}”",
        title: book.title,
      }),
    );
  };

  // ── Sidebar thread groups ──
  const grouped = useMemo(() => {
    type ConversationLike = {
      _id: string;
      title?: string;
      subjectName: string | null;
      subjectId?: string;
      updatedAt: number;
    };
    const buckets: Record<string, ConversationLike[]> = {
      today: [], yesterday: [], week: [], earlier: [],
    };
    for (const conversation of (conversations ?? []) as ConversationLike[]) {
      buckets[conversationBucket(conversation.updatedAt)].push(conversation);
    }
    return buckets;
  }, [conversations]);

  const busy = isAwaiting || branching;

  const sidebarInner = (
    <>
      <div className="flex items-center gap-2">
        <Button
          className="h-9 flex-1 rounded-xl interactive-press"
          onClick={handleNewChat}
          disabled={isAwaiting}
        >
          <MessageSquarePlus className="size-4" /> New chat
        </Button>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            "size-9 shrink-0 rounded-xl bg-foreground/5 interactive-press",
            searchOpen && "border-primary/40 text-primary",
          )}
          onClick={() => {
            setSearchOpen((o) => !o);
            setSearchInput("");
          }}
          aria-label="Search your Tutor history"
          title="Search your Tutor history"
        >
          <Search className="size-4" />
        </Button>
      </div>

      {searchOpen ? (
        <SearchPanel
          query={searchInput}
          onQueryChange={setSearchInput}
          results={searchResults as SearchResult[] | undefined}
          loading={searchResults === undefined && searchQ.trim().length >= 2}
          onOpenResult={(r) => openConversation(r.conversationId)}
        />
      ) : (
        <>
          <StudyContextCard
            displayName={profile?.displayName ?? null}
            grade={grade}
            streamLabel={
              stream === "social"
                ? t("tutor:ctxSocial", { defaultValue: "Social Science" })
                : t("tutor:ctxNatural", { defaultValue: "Natural Science" })
            }
            weakestName={weakest?.name ?? null}
            readinessOverall={readiness.overall}
            concise={concise}
            onConciseChange={changeConcise}
          />

          <div className="flex items-center justify-between px-1 pt-1">
            <span className="type-caption font-bold uppercase tracking-[0.2em] text-muted-foreground/70">
              {t("tutor:conversations", { defaultValue: "conversations" })}
            </span>
            <span className="type-caption text-muted-foreground/50">
              {conversations?.length ?? "—"}
            </span>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2 pr-0.5" data-lenis-prevent-wheel>
            {conversations === undefined ? (
              <div className="flex justify-center py-6">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  className="size-4 rounded-full border-2 border-primary/30 border-t-primary"
                />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl bg-foreground/5">
                  <MessageCircle className="size-4 text-muted-foreground/40" />
                </div>
                <p className="type-mono text-[10px] leading-5 text-muted-foreground/50">
                  No conversations yet.
                  <br />
                  Start a chat to begin.
                </p>
              </div>
            ) : (
              (["today", "yesterday", "week", "earlier"] as const).map((bucketKey) => {
                const items = grouped[bucketKey];
                if (!items || items.length === 0) return null;
                return (
                  <div key={bucketKey}>
                    <p className="px-1 pb-1 type-mono text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/45">
                      {BUCKET_LABELS[bucketKey]}
                    </p>
                    <div className="space-y-0.5">
                      <AnimatePresence mode="popLayout" initial={false}>
                        {items.map(
                          (
                            conversation: {
                              _id: string;
                              title?: string;
                              subjectName: string | null;
                              subjectId?: string;
                              updatedAt: number;
                            },
                          ) => (
                            <ConversationRow
                              key={conversation._id}
                              conversation={conversation}
                              active={conversation._id === (selectedId as never)}
                              armed={armDeleteId === conversation._id}
                              onSelect={() => openConversation(conversation._id)}
                              onArmDelete={() => {
                                setArmDeleteId(conversation._id);
                                setTimeout(
                                  () =>
                                    setArmDeleteId((cur) =>
                                      cur === conversation._id ? null : cur,
                                    ),
                                  2600,
                                );
                              }}
                              onDelete={() => {
                                setArmDeleteId(null);
                                void handleDeleteConversation(conversation._id);
                              }}
                            />
                          ),
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </>
  );

  return (
    <DashboardShell immersive>
      <div className="flex h-full min-h-0 gap-0 lg:gap-5">
        {/* ── Left rail — the study room directory (desktop) ── */}
        <aside className="hidden w-[290px] shrink-0 flex-col gap-3 border-r border-border/60 py-1 pr-4 lg:flex">
          {sidebarInner}
        </aside>

        {/* ── Workspace ── */}
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Header — small, calm, functional */}
          <header className="flex items-center justify-between gap-3 border-b border-border/60 px-1 pb-3 pt-1 sm:px-2">
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Mobile conversations drawer */}
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-9 shrink-0 rounded-xl bg-foreground/5 lg:hidden"
                    aria-label="Open conversations"
                  >
                    <PanelLeft className="size-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-[300px] gap-3 p-3 sm:w-[320px]">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Conversations</SheetTitle>
                  </SheetHeader>
                  {sidebarInner}
                </SheetContent>
              </Sheet>

              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary shadow-[0_0_24px_-10px_rgb(230_167_46/0.7)]">
                <Bot className="size-4.5" />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
                  <TutorMark className="text-xs" />
                  {t("tutor:title", { defaultValue: "LEARNYX TUTOR" })}
                  <span className="type-mono hidden text-[9px] font-semibold tracking-[0.26em] text-muted-foreground/45 sm:inline">
                    {t("tutor:studyRoom", { defaultValue: "STUDY ROOM" })}
                  </span>
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {/* Grade switcher */}
                  <Select
                    value={grade ? String(grade) : "all"}
                    onValueChange={(v) => changeGrade(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="h-6 w-auto gap-1 rounded-lg border-0 bg-foreground/[0.05] px-2 type-mono text-[10px] text-muted-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("tutor:ctxAllGrades", { defaultValue: "Grade 9–12" })}
                      </SelectItem>
                      {[9, 10, 11, 12].map((g) => (
                        <SelectItem key={g} value={String(g)}>
                          {t("tutor:ctxGrade", { defaultValue: "Grade {{g}}", g })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  {/* Stream switcher */}
                  <Select
                    value={stream}
                    onValueChange={(v) => changeStream(v as "natural" | "social")}
                  >
                    <SelectTrigger className="h-6 w-auto gap-1 rounded-lg border-0 bg-foreground/[0.05] px-2 type-mono text-[10px] text-muted-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="natural">
                        {t("tutor:ctxNatural", { defaultValue: "Natural Science" })}
                      </SelectItem>
                      <SelectItem value="social">
                        {t("tutor:ctxSocial", { defaultValue: "Social Science" })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="hidden text-[10px] text-muted-foreground/40 sm:inline">·</span>
                  {/* Subject switcher */}
                  <Select value={scopeSubjectId || "all"} onValueChange={setScopeSubjectId}>
                    <SelectTrigger className="h-6 w-auto gap-1 rounded-lg border-0 bg-foreground/[0.05] px-2 type-mono text-[10px] text-muted-foreground">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t("tutor:ctxAllSubjects", { defaultValue: "All subjects" })}
                      </SelectItem>
                      {streamSubjects.map((subject) => (
                        <SelectItem key={subject._id} value={subject._id}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* Grounded textbook indicator */}
                  {(contentId || activeConversation?.contentId) && discussing && (
                    <Badge className="h-6 gap-1 border-primary/15 bg-primary/8 px-2 font-mono text-[9px] text-primary">
                      <BookOpen className="size-2.5" />
                      <span className="max-w-[140px] truncate">{discussing}</span>
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {(activeConversation?.subjectId || scopeSubjectId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden gap-1.5 rounded-lg font-mono text-[10px] text-muted-foreground hover:text-primary interactive-press md:flex"
                  onClick={() => {
                    const subjId = activeConversation?.subjectId ?? scopeSubjectId;
                    if (subjId) {
                      navigate(`/flashcards?subject=${subjId}&conversation=${selectedId ?? ""}`);
                    }
                  }}
                >
                  <Layers className="size-3" /> {t("tutor:actFlashcards", { defaultValue: "Make flashcards" })}
                </Button>
              )}
              {/* Voice output toggle — Talk to Learnyx */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-8 rounded-lg interactive-press",
                  voiceOut ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => changeVoiceOut(!voiceOut)}
                aria-label={voiceOut ? "Disable voice replies" : "Enable voice replies"}
                title={
                  voiceOut
                    ? "Voice replies ON — the tutor reads answers aloud"
                    : "Voice replies OFF — tap to have the tutor read answers aloud"
                }
              >
                {voiceOut ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
              </Button>
              {/* Study tools drawer toggle */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "hidden size-8 rounded-lg interactive-press xl:flex",
                  toolsOpen ? "text-primary hover:text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => changeToolsOpen(!toolsOpen)}
                aria-label={toolsOpen ? "Close study tools" : "Open study tools"}
                title="Study tools"
              >
                {toolsOpen ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
              </Button>
            </div>
          </header>

          {/* Mode bar — tabs with a gold underline */}
          <div className="border-b border-border/60">
            <ModeTabs mode={mode} onModeChange={changeMode} disabled={isAwaiting} />
          </div>

          {/* Guided Study Session bar */}
          {session && (
            <div className="border-b border-primary/15 bg-primary/[0.05] px-4 py-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {SESSION_PHASES.map((phase, i) => (
                    <div
                      key={phase.id}
                      className={cn(
                        "h-1.5 w-8 rounded-full transition-colors sm:w-12",
                        session.running && i === session.phaseIndex
                          ? "bg-primary"
                          : i < session.phaseIndex
                            ? "bg-primary/40"
                            : "bg-foreground/10",
                      )}
                      title={phase.label}
                    />
                  ))}
                </div>
                <p className="type-mono flex-1 truncate text-[10px] text-foreground">
                  {session.running
                    ? `⚡ ${t("tutor:sessionPhase", { defaultValue: "Phase {{n}}: {{name}}", n: session.phaseIndex + 1, name: SESSION_PHASES[Math.min(session.phaseIndex, SESSION_PHASES.length - 1)].label })} · ${session.subjectName}`
                    : `✅ ${t("tutor:sessionDone", { defaultValue: "Session complete" })} · ${session.subjectName}`}
                </p>
                {session.running && (
                  <>
                    <span className="type-mono text-[11px] font-semibold text-primary">
                      {fmtCountdown(sessionRemainingSec)}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 rounded-lg bg-foreground/5 px-2.5 text-[10px] interactive-press"
                      onClick={() => void completeSession(session)}
                    >
                      {t("tutor:sessionEnd", { defaultValue: "End & save" })}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Exam-mode transformation — the tutor becomes an examiner */}
          <AnimatePresence>
            {mode === "exam" && !session && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden border-b border-primary/15 bg-primary/[0.04]"
              >
                <div className="flex items-center gap-3 px-4 py-2">
                  <span className="flex items-center gap-1.5 type-mono text-[10px] font-bold uppercase tracking-[0.2em] text-primary">
                    <GraduationCap className="size-3.5" />
                    {t("tutor:examBanner", { defaultValue: "Exam Mode" })}
                  </span>
                  <span className="hidden truncate type-mono text-[10px] text-muted-foreground sm:block">
                    {t("tutor:examBannerSub", {
                      defaultValue: "Strict simulation · no hints · running score — commit before you see the answer.",
                    })}
                  </span>
                  <span className="flex-1" />
                  {examStartedAt && (
                    <span className="type-mono text-[11px] font-semibold tabular-nums text-primary">
                      {fmtCountdown(examElapsedSec)}
                    </span>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── CHAT CANVAS ── */}
          <div className="relative min-h-0 flex-1">
            <div
              ref={canvasRef}
              onScroll={handleCanvasScroll}
              className="absolute inset-0 overflow-y-auto"
              data-lenis-prevent-wheel
            >
              <div className="mx-auto flex w-full max-w-[960px] flex-col gap-7 px-5 py-6 sm:px-8 sm:py-8">
                {selectedId === null ? (
                  <WelcomeState
                    displayName={profile?.displayName ?? null}
                    grade={grade}
                    streamLabel={
                      stream === "social"
                        ? t("tutor:ctxSocial", { defaultValue: "Social Science" })
                        : t("tutor:ctxNatural", { defaultValue: "Natural Science" })
                    }
                    streak={streakData?.currentStreak ?? 0}
                    level={levelData?.currentLevel ?? 1}
                    readiness={readiness}
                    weakest={weakest}
                    quizCount={quizCount}
                    missionSubjectId={weakestSubjectRow?._id ?? null}
                    onMissionContinue={() => {
                      if (!weakestSubjectRow) return;
                      setScopeSubjectId(weakestSubjectRow._id);
                      changeMode("learn");
                      void handleSend(
                        `Teach me the exam-critical fundamentals of ${weakestSubjectRow.name} step by step, with one worked example.`,
                        { subjectId: weakestSubjectRow._id, modeOverride: "learn" },
                      );
                    }}
                    onMissionQuiz={() => {
                      if (!weakestSubjectRow) return;
                      setScopeSubjectId(weakestSubjectRow._id);
                      changeMode("quiz");
                      void handleSend(
                        `Quiz me on ${weakestSubjectRow.name} — 5 adaptive questions, one at a time.`,
                        { subjectId: weakestSubjectRow._id, modeOverride: "quiz" },
                      );
                    }}
                    onSubjectPick={(subject) => {
                      setScopeSubjectId(subject._id);
                      changeMode("learn");
                      void handleSend(
                        `Give me a 5-minute overview of ${subject.name} — what does the national exam focus on?`,
                        { subjectId: subject._id, modeOverride: "learn" },
                      );
                    }}
                    onStudySession={() => {
                      const subject = weakestSubjectRow ?? streamSubjects[0];
                      if (subject) startSession(subject);
                    }}
                    onTrain={() => {
                      if (!weakestSubjectRow) return;
                      setScopeSubjectId(weakestSubjectRow._id);
                      changeMode("practice");
                      void handleSend(
                        `Start training me on ${weakestSubjectRow.name} — 10 exam-style questions, one at a time, grade each answer.`,
                        { subjectId: weakestSubjectRow._id, modeOverride: "practice" },
                      );
                    }}
                    disabled={isAwaiting}
                    starters={startersWithMock}
                    latestMock={latestMock as { totalScore: number } | null}
                    scopedTextbooks={scopedTextbooks}
                    contentId={contentId}
                    onGroundTextbook={groundTextbook}
                    onOpenReader={(id) => navigate(`/read/${id}`)}
                    onSendStarter={(prompt) => void handleSend(prompt)}
                  />
                ) : messages === undefined ? (
                  <div className="flex h-40 items-center justify-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                      className="size-5 rounded-full border-2 border-primary/30 border-t-primary"
                    />
                  </div>
                ) : (
                  <>
                    {messages.map((message: MessageDoc, i: number) =>
                      message.role === "user" ? (
                        <UserMessage
                          key={message._id}
                          message={message as MessageDoc}
                          index={i}
                          editing={editing}
                          onEditStart={(m, branchFlag) =>
                            setEditing({ messageId: m._id, content: m.content, branch: branchFlag })
                          }
                          onEditChange={(content) =>
                            setEditing((cur) => (cur ? { ...cur, content } : cur))
                          }
                          onEditCancel={() => setEditing(null)}
                          onEditSave={(m, content) => void saveEdit(m, content)}
                          onEditBranch={(m, content) => void branchEdit(m, content)}
                          onCopy={(m) => void handleCopy(m)}
                          onRetryFrom={(m) => void retryFrom(m)}
                          onDeleteFrom={(m) => void deleteFrom(m)}
                          busy={busy}
                        />
                      ) : (
                        <AssistantMessage
                          key={message._id}
                          message={message as MessageDoc}
                          index={i}
                          isLast={message._id === (lastAssistantId as never)}
                          copiedId={copiedId}
                          onCopy={(m) => void handleCopy(m)}
                          onRegenerate={() => void handleRegenerate()}
                          onReadAloud={(content) => speak(content)}
                          onContinue={() =>
                            void handleSend(
                              "Continue from exactly where you stopped — same explanation, next part. Don't repeat what you already wrote.",
                            )
                          }
                          regenerating={regenerating}
                        />
                      ),
                    )}

                    {/* Contextual study moves under the latest answer */}
                    {!isAwaiting && !sending && lastAssistantId && (
                      <ActionChips
                        canOpenSource={Boolean(contentId || activeConversation?.contentId)}
                        canMakeNotes={Boolean(
                          (activeConversation?.subjectId ?? scopeSubjectId) && selectedId,
                        )}
                        disabled={isAwaiting}
                        onOpenSource={() => {
                          const id = contentId ?? activeConversation?.contentId;
                          if (id) navigate(`/read/${id}`);
                        }}
                        onSimplify={() =>
                          void handleSend(
                            "Explain that more deeply — go one level below what you just covered, with a concrete example.",
                            { modeOverride: "learn" },
                          )
                        }
                        onQuiz={() =>
                          void handleSend(
                            "Quiz me on that topic — 5 adaptive questions, one at a time.",
                            { modeOverride: "quiz" },
                          )
                        }
                        onFlashcards={() => {
                          const subjId = activeConversation?.subjectId ?? scopeSubjectId;
                          if (subjId) {
                            navigate(`/flashcards?subject=${subjId}&conversation=${selectedId ?? ""}`);
                          } else {
                            toast.error("Scope the chat to a subject first — flashcards are filed per subject.");
                          }
                        }}
                        onNotes={() => void makeNotes()}
                        onDifferently={() =>
                          void handleSend(
                            "Explain that differently — use a different approach or analogy.",
                            { modeOverride: "learn" },
                          )
                        }
                      />
                    )}
                  </>
                )}

                {/* Optimistic user message */}
                <AnimatePresence>
                  {sending && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="flex flex-col items-end gap-1"
                    >
                      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-primary/20 bg-primary/[0.08] px-4 py-3 text-[14.5px] leading-7 sm:max-w-[75%]">
                        {sending.content}
                      </div>
                      <span className="px-1 type-mono text-[10px] text-muted-foreground/40">
                        {t("tutor:you", { defaultValue: "you" })}
                        {sending.edited ? ` · ${t("tutor:editedLabel", { defaultValue: "edited" })}` : ""} ·{" "}
                        {t("tutor:sending", { defaultValue: "sending…" })}
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Thinking indicator */}
                <AnimatePresence>
                  {(isAwaiting || regenerating) && (
                    <ThinkingIndicator
                      modeLabel={regenerating && !isAwaiting ? "Regenerating" : modeLabel}
                    />
                  )}
                </AnimatePresence>

                {/* Follow-up suggestions + mini-check */}
                {selectedId && !isAwaiting && !sending && (followUps.length > 0 || miniCheck) && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col gap-3 px-1"
                  >
                    {followUps.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {followUps.map((q, i) => (
                          <button
                            key={i}
                            type="button"
                            onClick={() => void handleSend(q)}
                            className="cursor-pointer rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground interactive-press"
                          >
                            <span className="mr-1.5 font-mono text-[9px] text-primary/60">→</span>
                            {q}
                          </button>
                        ))}
                      </div>
                    )}

                    {miniCheck && (
                      <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-3">
                        {miniCheckAnswer === null ? (
                          <>
                            <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                              <Sparkles className="size-3.5" />
                              {t("tutor:miniCheck", { defaultValue: "Test yourself — quick check" })}
                            </p>
                            <p className="mt-2 text-sm text-foreground/90">{miniCheck.question}</p>
                            <div className="mt-3 flex flex-col gap-1.5">
                              {miniCheck.options.map((opt, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => setMiniCheckAnswer(idx)}
                                  className="cursor-pointer rounded-lg border border-border/70 bg-transparent px-3 py-2 text-left text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
                                >
                                  <span className="mr-2 font-mono text-[10px] text-muted-foreground">
                                    {String.fromCharCode(65 + idx)}
                                  </span>
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <div className={cn(
                            "rounded-xl border px-3 py-2.5",
                            miniCheckAnswer === miniCheck.correctIndex
                              ? "border-emerald-400/25 bg-emerald-400/5"
                              : "border-rose-400/25 bg-rose-400/5",
                          )}>
                            <p className="flex items-center gap-2 text-xs font-bold">
                              {miniCheckAnswer === miniCheck.correctIndex ? (
                                <><CheckCircle2 className="size-4 text-emerald-300" /> {t("tutor:miniCorrect", { defaultValue: "Correct!" })}</>
                              ) : (
                                <><XCircle className="size-4 text-rose-300" /> {t("tutor:miniWrong", { defaultValue: "Not quite." })}</>
                              )}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{miniCheck.explanation}</p>
                            <button
                              type="button"
                              onClick={() => { setMiniCheckAnswer(null); }}
                              className="mt-2 cursor-pointer text-[10px] text-primary hover:underline"
                            >
                              {t("tutor:miniRetry", { defaultValue: "Try again" })}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </motion.div>
                )}
              </div>
            </div>

            {/* Scroll-to-bottom pill — appears only when you're away from the latest */}
            <AnimatePresence>
              {newBelow && (
                <motion.button
                  type="button"
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => scrollToBottom(true)}
                  className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-primary/30 bg-background/90 px-3.5 py-1.5 text-[11px] font-semibold text-foreground shadow-[0_8px_30px_-10px_rgb(230_167_46/0.5)] backdrop-blur-md transition-colors hover:border-primary/50"
                >
                  <ChevronDown className="size-3.5 text-primary" />
                  {t("tutor:newMessages", { defaultValue: "New messages" })}
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          {/* ── SMART COMPOSER ── */}
          <Composer
            input={input}
            onInputChange={setInput}
            inputRef={inputRef}
            fileInputRef={fileInputRef}
            onFilesPicked={(files) => void handleAttach(files)}
            images={images}
            attaching={attaching}
            onAttachClick={() => fileInputRef.current?.click()}
            onRemoveImage={(i) => setImages((prev) => prev.filter((_, j) => j !== i))}
            onSend={() => void handleSend()}
            isAwaiting={isAwaiting}
            speech={speech}
            entitlements={
              entitlements as {
                premiumAccess: boolean;
                tutorRemainingToday: number;
                tutorDailyLimit: number;
              } | null | undefined
            }
            groundedTitle={discussing}
            onClearGrounded={() => setContentId(null)}
            textbooks={scopedTextbooks}
            activeTextbookId={(contentId ?? (activeConversation?.contentId as string | undefined)) ?? null}
            onPickTextbook={groundTextbook}
            t={t}
          />
        </section>

        {/* ── Study tools drawer (xl+) — collapsible, never wastes space ── */}
        <AnimatePresence initial={false}>
          {toolsOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 300, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="hidden min-h-0 shrink-0 overflow-hidden xl:block"
              aria-label="Study tools"
            >
              <div className="flex h-full w-[300px] flex-col border-l border-border/60 pl-4">
                <div className="flex items-center justify-between pb-2 pt-1">
                  <p className="type-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground/70">
                    {t("tutor:toolsTitle", { defaultValue: "Study tools" })}
                  </p>
                  <button
                    type="button"
                    onClick={() => changeToolsOpen(false)}
                    aria-label="Close study tools"
                    className="flex size-6 cursor-pointer items-center justify-center rounded-lg text-muted-foreground/60 transition-colors hover:bg-foreground/5 hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-0.5" data-lenis-prevent-wheel>
                  {/* Grounded document */}
                  {discussing && (
                    <div className="glass-soft rounded-xl p-3">
                      <p className="type-mono text-[9px] font-bold uppercase tracking-[0.2em] text-primary/80">
                        📖 {t("tutor:toolsGrounded", { defaultValue: "Grounded on" })}
                      </p>
                      <p className="mt-1.5 line-clamp-2 text-xs font-semibold text-foreground">
                        {discussing}
                      </p>
                      {(contentId ?? activeConversation?.contentId) && (
                        <button
                          type="button"
                          onClick={() => {
                            const id = contentId ?? activeConversation?.contentId;
                            if (id) navigate(`/read/${id}`);
                          }}
                          className="mt-2 flex cursor-pointer items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                        >
                          {t("tutor:toolsOpenReader", { defaultValue: "Open in Reader" })} →
                        </button>
                      )}
                    </div>
                  )}

                  {/* Textbook shelf — switch grounding mid-conversation */}
                  {scopedTextbooks.length > 0 && (
                    <div>
                      <p className="px-0.5 pb-1.5 type-mono text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                        {t("tutor:toolsShelf", { defaultValue: "Textbook shelf" })}
                      </p>
                      <div className="space-y-1">
                        {scopedTextbooks.map((book) => (
                          <button
                            key={book._id}
                            type="button"
                            onClick={() => groundTextbook(book)}
                            className={cn(
                              "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-primary/10",
                              (contentId ?? (activeConversation?.contentId as string | undefined)) === book._id
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <BookOpen className="size-3.5 shrink-0 opacity-70" />
                            <span className="truncate font-medium">{book.title}</span>
                            <span className="ml-auto shrink-0 type-mono text-[9px] opacity-60">G{book.grade}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div>
                    <p className="px-0.5 pb-1.5 type-mono text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
                      {t("tutor:toolsActions", { defaultValue: "Quick actions" })}
                    </p>
                    <div className="space-y-1">
                      {[
                        {
                          icon: Layers,
                          label: t("tutor:actFlashcards", { defaultValue: "Make flashcards" }),
                          onClick: () => {
                            const subjId = activeConversation?.subjectId ?? scopeSubjectId;
                            if (subjId) {
                              navigate(`/flashcards?subject=${subjId}&conversation=${selectedId ?? ""}`);
                            } else {
                              toast.error("Scope the chat to a subject first.");
                            }
                          },
                        },
                        {
                          icon: FileText,
                          label: t("tutor:actNotes", { defaultValue: "Make notes" }),
                          onClick: () => void makeNotes(),
                        },
                        {
                          icon: Timer,
                          label: t("tutor:sessionCta", { defaultValue: "Start 30-min Study Session" }),
                          onClick: () => {
                            const subject =
                              (scopeSubject ??
                              weakestSubjectRow ??
                              streamSubjects[0]) ?? null;
                            if (subject) startSession(subject);
                          },
                        },
                        {
                          icon: Bookmark,
                          label: t("tutor:toolsLibrary", { defaultValue: "Open library" }),
                          onClick: () => navigate("/dashboard"),
                        },
                      ].map((action) => {
                        const Icon = action.icon;
                        return (
                          <button
                            key={action.label}
                            type="button"
                            onClick={action.onClick}
                            className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground"
                          >
                            <span className="flex size-6 items-center justify-center rounded-md bg-primary/10 text-primary">
                              <Icon className="size-3" />
                            </span>
                            <span className="truncate">{action.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Session complete modal */}
      <AnimatePresence>
        {sessionComplete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
            onClick={() => setSessionComplete(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="glass-panel w-full max-w-sm rounded-3xl p-6 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[0_0_40px_-12px_rgb(230_167_46/0.8)]">
                <Trophy className="size-6" />
              </div>
              <p className="type-h2 mt-4">
                {t("tutor:sessionCompleteTitle", { defaultValue: "Session Complete 🎉" })}
              </p>
              <p className="type-mono mt-1 text-[11px] text-muted-foreground">
                {sessionComplete.subjectName} · {SESSION_TOTAL_MINUTES} min
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <div className="glass-soft rounded-xl p-3">
                  <p className="type-h2 text-primary">+{sessionComplete.xpAwarded}</p>
                  <p className="type-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    {t("tutor:sessionXp", { defaultValue: "focus XP" })}
                  </p>
                </div>
                <div className="glass-soft rounded-xl p-3">
                  <p className="type-h2 text-emerald-300">{sessionComplete.userMessages}</p>
                  <p className="type-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                    {t("tutor:sessionMsgs", { defaultValue: "turns coached" })}
                  </p>
                </div>
              </div>
              {sessionComplete.levelUp && (
                <Badge className="mt-3 gap-1 border-violet-400/25 bg-violet-400/10 text-violet-300">
                  <Rocket className="size-3" /> {t("tutor:sessionLevelUp", { defaultValue: "Level up!" })}
                </Badge>
              )}
              <p className="mt-4 type-body text-xs text-muted-foreground">
                {t("tutor:sessionNext", {
                  defaultValue:
                    "Nice work. Come back tomorrow — spaced repetition beats cramming.",
                })}
              </p>
              <Button
                className="mt-4 w-full rounded-xl interactive-press"
                onClick={() => {
                  setSessionComplete(null);
                  setSession(null);
                }}
              >
                {t("tutor:sessionClose", { defaultValue: "Done" })}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PremiumPrompt
        open={capPromptOpen}
        onOpenChange={setCapPromptOpen}
        reason="daily_limit_reached"
      />
    </DashboardShell>
  );
}
