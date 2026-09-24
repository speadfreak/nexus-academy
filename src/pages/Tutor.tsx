import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  FileText,
  MessageSquarePlus,
  Sparkles,
  Layers,
  Atom,
  BookOpen,
  Globe,
  Calculator,
  Beaker,
  BrainCircuit,
  GraduationCap,
  MessageCircle,
  Mic,
  MicOff,
  XCircle,
  Brain,
  PenLine,
  Zap,
  Search,
  Target,
  Flame,
  Trophy,
  Paperclip,
  Volume2,
  VolumeX,
  Rocket,
  X,
  Bookmark,
  Compass,
  Timer,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clockTime, relativeTime } from "@/lib/dates";
import { useFriendlyError, errorCode, errorMessage } from "@/lib/errors";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { cn } from "@/lib/utils";

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

// ---------------------------------------------------------------------------
// Tutor modes — each mode reshapes how the AI behaves (system prompt block
// injected server-side). The selector is the core "learning system" upgrade:
// one question can be taught, drilled, examined, compressed or coached.
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

// Animated thinking characters that cycle through
const THINKING_CHARS = ["∼", "≈", "Δ", "∫", "λ", "π", "∑", "√", "∞", "θ"];

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
          className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.85em]"
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

/** Lightweight markdown renderer for assistant bubbles — lists, headings,
 * bold, italic, inline code. Deliberately minimal: the tutor's replies are
 * conversational markdown, not documents. */
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
          <ol key={`l${key++}`} className="ml-4 list-decimal space-y-1">
            {items.map((item, j) => (
              <li key={j} className="pl-1">
                {renderInline(item, `l${key}-${j}`)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={`l${key++}`} className="ml-3 list-disc space-y-1">
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
            className="mt-1 text-[13px] font-semibold tracking-wide text-foreground"
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
          <p key={`p${idx}`} className="leading-6">
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

// ---------------------------------------------------------------------------
// Chat pieces
// ---------------------------------------------------------------------------

function ThinkingIndicator({ modeLabel }: { modeLabel: string }) {
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCharIndex((prev) => (prev + 1) % THINKING_CHARS.length);
    }, 180);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-start gap-1.5"
    >
      <div className="glass-soft relative overflow-hidden rounded-2xl rounded-bl-md px-5 py-4 min-w-[180px]">
        <div className="scan-line" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-400/10">
            <Bot className="size-3.5 text-amber-300" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="type-mono text-muted-foreground/60 text-[10px] uppercase tracking-widest">
              {modeLabel}
            </span>
            <div className="flex items-center gap-1.5">
              <motion.span
                key={charIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="type-mono text-amber-300 text-sm"
              >
                {THINKING_CHARS[charIndex]}
              </motion.span>
              <span className="type-mono text-muted-foreground text-xs">
                AI is thinking…
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Bubble({ message, index }: { message: MessageDoc; index: number }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: 0.03 * Math.min(index, 8),
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] break-words rounded-2xl px-4 py-3 type-body transition-colors duration-200",
          isUser
            ? "rounded-br-md border border-primary/25 bg-primary/10 text-foreground"
            : "glass-soft rounded-bl-md text-foreground",
        )}
      >
        {/* Image attachments (textbook page, handwritten work, screenshot) */}
        {message.images && message.images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {message.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="Attached study material"
                className="max-h-44 rounded-xl border border-white/10 object-cover"
              />
            ))}
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap leading-6">{message.content}</p>
        ) : (
          <MarkdownLite text={message.content} />
        )}
      </div>
      <span className="px-1 type-caption text-muted-foreground/60">
        {isUser ? "you" : "AI Tutor"} · {clockTime(message.createdAt)}
      </span>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Action chips — every AI answer becomes a study workflow: simplify it,
// quiz on it, save it to notes, turn it into flashcards, or hear a
// different explanation. Rendered under the latest assistant message.
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
    { key: "simplify", label: t("tutor:actSimplify", { defaultValue: "Simplify" }), icon: Sparkles, onClick: onSimplify, show: true },
    { key: "quiz", label: t("tutor:actQuiz", { defaultValue: "Quiz me" }), icon: Target, onClick: onQuiz, show: true },
    { key: "cards", label: t("tutor:actFlashcards", { defaultValue: "Make flashcards" }), icon: Layers, onClick: onFlashcards, show: true },
    { key: "notes", label: t("tutor:actNotes", { defaultValue: "Make notes" }), icon: FileText, onClick: onNotes, show: canMakeNotes },
    { key: "differently", label: t("tutor:actDifferently", { defaultValue: "Explain differently" }), icon: Compass, onClick: onDifferently, show: true },
  ];

  return (
    <div className="flex flex-wrap gap-1.5">
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
              className="group flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-400/15 bg-amber-400/[0.05] px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-all hover:border-amber-400/35 hover:bg-amber-400/[0.1] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 interactive-press"
            >
              <Icon className="size-3 text-amber-300/80 transition-colors group-hover:text-amber-300" />
              {chip.label}
            </button>
          );
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode selector — the six learning modes as pills.
// ---------------------------------------------------------------------------

function ModeSelector({
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
    <div className="flex flex-col gap-1.5">
      <div
        className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Tutor mode"
      >
        {MODES.map((m) => {
          const Icon = m.icon;
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
                "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-semibold transition-all interactive-press disabled:cursor-not-allowed disabled:opacity-50",
                isActive
                  ? "bg-amber-400/15 text-amber-300 shadow-[inset_0_0_0_1px_rgb(251,191,36/0.25),0_6px_20px_-12px_rgb(251,191,36/0.8)]"
                  : "glass-soft text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>
      <AnimatePresence mode="wait">
        <motion.p
          key={active.id}
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 3 }}
          transition={{ duration: 0.18 }}
          className="type-mono px-1 text-[10px] text-muted-foreground/70"
        >
          {active.hint}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Welcome dashboard — the tutor's "academic command center" empty state.
// Personalized greeting + real stats + Today's Mission + Exam Coach +
// recommendations + textbook grounding + the guided Study Session CTA.
// ---------------------------------------------------------------------------

type SubjectRow = { _id: string; name: string; stream: string; slug: string };

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
      className="w-full rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 type-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
          <GraduationCap className="size-3.5" />
          {t("tutor:coachTitle", { defaultValue: "Exam Coach" })}
        </p>
        {readiness.overall !== null && (
          <Badge className="border-amber-400/20 bg-amber-400/10 font-mono text-[10px] text-amber-300">
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
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, pct)}%` }}
                    transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    className={cn(
                      "h-full rounded-full",
                      readinessColor(pct),
                    )}
                  />
                </div>
                <span className="w-9 shrink-0 type-mono text-[10px] text-foreground/80">
                  {pct}%
                </span>
              </div>
            ))}
          </div>
          {weakest && (
            <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-white/8 pt-3">
              <p className="min-w-0 type-body text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {t("tutor:coachToday", { defaultValue: "Recommended today" })}
                  :{" "}
                </span>
                {weakest.name} →{" "}
                {t("tutor:coachQuestions", { defaultValue: "10 questions" })}
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

function WelcomeDashboard({
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
}) {
  const { t } = useTranslation(["tutor", "common"]);

  const recommended = [...readiness.per.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3);

  const missionPct = weakest?.readiness ?? 0;

  return (
    <div className="flex w-full flex-col gap-4">
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-2 text-center"
      >
        <div className="mx-auto mb-1 flex size-14 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.7)]">
          <Bot className="size-6" />
        </div>
        <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold type-mono text-[10px]">
          // {t("tutor:eyebrow", { defaultValue: "learnyx tutor" })} 🇪🇹
        </p>
        <h2 className="type-h1">
          {t("tutor:welcomeBack", {
            defaultValue: "Welcome back, {{name}}",
            name: displayName ?? t("tutor:futureTopper", { defaultValue: "Future Topper" }),
          })}
        </h2>
        <p className="type-body max-w-md text-muted-foreground">
          {grade
            ? t("tutor:welcomeSubScoped", {
                defaultValue:
                  "Your AI academic command center — Grade {{grade}} · {{stream}} · built for the Ethiopian national exam.",
                grade,
                stream: streamLabel,
              })
            : t("tutor:welcomeSub", {
                defaultValue:
                  "Your AI academic command center — grades 9–12 · built for the Ethiopian national exam 🇪🇹.",
              })}
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
          accent="bg-sky-400/12 text-sky-300"
        />
        <StatTile
          icon={Zap}
          label={t("tutor:statLevel", { defaultValue: "level" })}
          value={`${level}`}
          accent="bg-violet-400/12 text-violet-300"
        />
      </motion.div>

      {/* ── Today's Mission ── */}
      {weakest && missionSubjectId && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass-soft w-full rounded-2xl p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 type-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-300">
                <Target className="size-3.5" />
                {t("tutor:missionTitle", { defaultValue: "Today's Mission" })}
              </p>
              <p className="type-h3 mt-1.5 truncate">
                {weakest.name}
              </p>
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
                className="rounded-xl bg-white/5 interactive-press"
                disabled={disabled}
                onClick={onMissionQuiz}
              >
                {t("tutor:missionQuiz", { defaultValue: "Quiz Me" })}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2.5">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/8">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, missionPct)}%` }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className={cn("h-full rounded-full", readinessColor(missionPct))}
              />
            </div>
            <span className="type-mono text-[10px] text-muted-foreground">
              {missionPct}%
            </span>
          </div>
        </motion.div>
      )}

      {/* ── Exam Coach ── */}
      <ExamCoachCard
        readiness={readiness}
        weakest={weakest}
        onTrain={onTrain}
        disabled={disabled}
      />

      {/* ── Recommended for you ── */}
      {recommended.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          <p className="mb-2 px-1 type-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
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
                  className="glass-soft group flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all hover:border-amber-400/25 hover:bg-amber-400/[0.06] disabled:cursor-not-allowed disabled:opacity-50 interactive-press"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-xs font-semibold text-foreground">
                      {name}
                    </p>
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

      {/* ── Guided Study Session CTA ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="w-full"
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
// Main component
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

  // ── Core chat state ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capPromptOpen, setCapPromptOpen] = useState(false);
  const [scopeSubjectId, setScopeSubjectId] = useState("");
  const [contentId, setContentId] = useState<string | null>(
    searchParams.get("contentId"),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState<{ content: string } | null>(null);
  const [isAwaiting, setIsAwaiting] = useState(false);

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
  const inputRef = useRef<HTMLInputElement>(null);
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

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending, isAwaiting]);

  // ── Send pipeline ──
  const handleSend = async (
    raw?: string,
    opts?: { subjectId?: string; modeOverride?: TutorMode },
  ) => {
    const content = (raw ?? input).trim();
    if ((!content && images.length === 0) || isAwaiting) return;
    setInput("");
    const sentImages = images;
    setImages([]);
    setSending({ content: content || "📸 Solve this and explain every step." });
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
    setFollowUps([]);
    setMiniCheck(null);
  }, []);

  return (
    <DashboardShell>
      <div className="grid h-[calc(100vh-7.5rem)] gap-4 lg:grid-cols-[280px_1fr]">
        {/* ───── Left rail ───── */}
        <aside className="glass-panel hidden flex-col rounded-2xl p-3 lg:flex">
          <Button
            className="w-full rounded-xl interactive-press"
            onClick={handleNewChat}
            disabled={isAwaiting}
          >
            <MessageSquarePlus className="size-4" /> New chat
          </Button>

          {/* Academic memory — what the tutor already knows, made visible */}
          <div className="glass-soft mt-3 rounded-xl p-3">
            <p className="type-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              🧠 {t("tutor:memoryTitle", { defaultValue: "What Learnyx knows" })}
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 type-body text-[11px] text-muted-foreground">
              <li className="flex items-center gap-1.5 truncate">
                <Sparkles className="size-3 shrink-0 text-amber-300/70" />
                {profile?.displayName ?? t("tutor:memoryName", { defaultValue: "Your name" })}
              </li>
              <li className="flex items-center gap-1.5">
                <GraduationCap className="size-3 shrink-0 text-amber-300/70" />
                {grade
                  ? t("tutor:memoryGrade", { defaultValue: "Grade {{grade}}", grade })
                  : t("tutor:memoryNoGrade", { defaultValue: "Grade not set" })}
              </li>
              <li className="flex items-center gap-1.5">
                <Atom className="size-3 shrink-0 text-amber-300/70" />
                {stream === "social"
                  ? t("tutor:memorySocial", { defaultValue: "Social Science" })
                  : t("tutor:memoryNatural", { defaultValue: "Natural Science" })}
              </li>
              {weakest && (
                <li className="flex items-center gap-1.5">
                  <Target className="size-3 shrink-0 text-amber-300/70" />
                  {t("tutor:memoryWeak", {
                    defaultValue: "{{subject}} needs work",
                    subject: weakest.name,
                  })}
                </li>
              )}
            </ul>
            <button
              type="button"
              onClick={() => changeConcise(!concise)}
              className={cn(
                "mt-2.5 flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1.5 text-[10px] font-semibold transition-colors interactive-press",
                concise
                  ? "bg-amber-400/15 text-amber-300"
                  : "bg-white/5 text-muted-foreground hover:text-foreground",
              )}
            >
              {t("tutor:memoryConcise", { defaultValue: "Prefers concise" })}
              <span
                className={cn(
                  "flex h-4 w-7 items-center rounded-full p-0.5 transition-colors",
                  concise ? "bg-amber-400/60" : "bg-white/15",
                )}
              >
                <span
                  className={cn(
                    "size-3 rounded-full bg-white transition-transform",
                    concise && "translate-x-3",
                  )}
                />
              </span>
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between px-1">
            <span className="type-caption font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {t("tutor:conversations", { defaultValue: "conversations" })}
            </span>
            <span className="type-caption text-muted-foreground/60">
              {conversations?.length ?? "—"}
            </span>
          </div>

          <div className="mt-2 flex-1 space-y-1 overflow-y-auto pr-0.5" data-lenis-prevent-wheel>
            {conversations === undefined ? (
              <div className="flex justify-center py-6">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  className="size-4 rounded-full border-2 border-primary/30 border-t-primary"
                />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 px-2 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl bg-white/5">
                  <MessageCircle className="size-4 text-muted-foreground/40" />
                </div>
                <p className="type-mono text-muted-foreground/50 leading-5">
                  No conversations yet.
                  <br />
                  Start a chat to begin.
                </p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {conversations.map(
                  (
                    conversation: {
                      _id: string;
                      title?: string;
                      subjectName: string | null;
                      subjectId?: string;
                      updatedAt: number;
                    },
                    i: number,
                  ) => {
                    const active = conversation._id === (selectedId as never);
                    const SubjectIcon = getSubjectIcon(conversation.subjectName);
                    return (
                      <motion.button
                        key={conversation._id}
                        type="button"
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8, scale: 0.96 }}
                        transition={{
                          duration: 0.25,
                          delay: 0.015 * Math.min(i, 12),
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        onClick={() => {
                          setSelectedId(conversation._id as string);
                          setSending(null);
                          setContentId(null);
                          if (conversation.subjectId) {
                            setScopeSubjectId(conversation.subjectId as string);
                          }
                        }}
                        className={cn(
                          "w-full cursor-pointer rounded-xl px-3 py-2.5 text-left interactive-press",
                          active
                            ? "bg-amber-400/12 text-amber-300 shadow-[inset_0_0_0_1px_rgb(251,191,36/0.14),0_8px_24px_-18px_rgb(251,191,36/0.9)]"
                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={cn(
                              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-180",
                              active
                                ? "bg-primary/15 text-primary"
                                : "bg-white/5 text-muted-foreground/50",
                            )}
                          >
                            <SubjectIcon className="size-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="type-caption flex items-center gap-1.5 truncate font-semibold">
                              <span className="truncate">{conversation.title}</span>
                            </p>
                            <p className="mt-0.5 flex items-center justify-between type-caption text-muted-foreground/60">
                              <span className="truncate">
                                {conversation.subjectName ?? "general"}
                              </span>
                              <span className="shrink-0 pl-2">
                                {relativeTime(conversation.updatedAt)}
                              </span>
                            </p>
                          </div>
                        </div>
                      </motion.button>
                    );
                  },
                )}
              </AnimatePresence>
            )}
          </div>
        </aside>

        {/* ───── Main panel ───── */}
        <section className="glass-panel relative flex min-h-0 flex-col rounded-2xl overflow-hidden">
          {/* Ambient glow */}
          <div
            className="pointer-events-none absolute inset-0 z-0"
            aria-hidden="true"
          >
            <div className="absolute -top-20 right-0 h-48 w-48 rounded-full bg-amber-400/4 blur-3xl" />
            <div className="absolute bottom-20 -left-10 h-36 w-36 rounded-full bg-amber-400/[0.03] blur-3xl" />
          </div>

          {/* Header — LEARNYX TUTOR + curriculum context switchers */}
          <div className="relative z-10 flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300 shadow-[0_0_20px_-8px_rgb(251,191,36/0.4)]">
                <Bot className="size-4.5" />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="type-h3 flex items-center gap-1.5 truncate">
                  LEARNYX TUTOR
                  <span className="text-xs">🇪🇹</span>
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {/* Grade switcher */}
                  <Select
                    value={grade ? String(grade) : "all"}
                    onValueChange={(v) => changeGrade(v === "all" ? null : Number(v))}
                  >
                    <SelectTrigger className="h-6 w-auto gap-1 rounded-lg border-0 bg-white/5 px-2 type-mono text-[10px] text-muted-foreground">
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
                  <span className="text-[10px] text-muted-foreground/50">·</span>
                  {/* Stream switcher */}
                  <Select
                    value={stream}
                    onValueChange={(v) => changeStream(v as "natural" | "social")}
                  >
                    <SelectTrigger className="h-6 w-auto gap-1 rounded-lg border-0 bg-white/5 px-2 type-mono text-[10px] text-muted-foreground">
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
                  <span className="text-[10px] text-muted-foreground/50">·</span>
                  {/* Subject switcher */}
                  <Select value={scopeSubjectId || "all"} onValueChange={setScopeSubjectId}>
                    <SelectTrigger className="h-6 w-auto gap-1 rounded-lg border-0 bg-white/5 px-2 type-mono text-[10px] text-muted-foreground">
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
                    <Badge className="h-6 gap-1 border-amber-400/15 bg-amber-400/8 px-2 font-mono text-[9px] text-amber-300">
                      <BookOpen className="size-2.5" />
                      <span className="max-w-[140px] truncate">{discussing}</span>
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
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
                  voiceOut ? "text-amber-300 hover:text-amber-300" : "text-muted-foreground hover:text-foreground",
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
              <Badge className="hidden gap-1.5 bg-amber-400/10 font-mono text-[10px] text-amber-300 border-amber-400/15 sm:flex">
                <Sparkles className="size-3" /> {t("tutor:headerBadge", { defaultValue: "AI Tutor · national exam prep" })}
              </Badge>
            </div>
          </div>

          {/* Mobile controls */}
          <div className="relative z-10 flex items-center gap-2 border-b border-white/8 px-4 py-2.5 lg:hidden">
            <Select value={scopeSubjectId || "all"} onValueChange={setScopeSubjectId}>
              <SelectTrigger className="h-9 w-32 shrink-0 rounded-lg bg-white/5 type-mono">
                <SelectValue placeholder="Scope…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("tutor:ctxAllSubjects", { defaultValue: "All subjects" })}</SelectItem>
                {subjects?.map(
                  (subject: { _id: string; name: string }) => (
                    <SelectItem key={subject._id} value={subject._id as string}>
                      {subject.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select
              value={selectedId ?? "new"}
              onValueChange={(value) => {
                if (value === "new") {
                  handleNewChat();
                  return;
                }
                const match = conversations?.find(
                  (c: { _id: string; subjectId?: string }) =>
                    c._id === (value as never),
                );
                setSelectedId(value);
                setSending(null);
                setContentId(null);
                if (match?.subjectId) setScopeSubjectId(match.subjectId as string);
              }}
            >
              <SelectTrigger className="h-9 flex-1 rounded-lg bg-white/5 type-mono">
                <SelectValue placeholder="Select a chat…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ {t("tutor:newChat", { defaultValue: "New chat" })}</SelectItem>
                {conversations?.map(
                  (conversation: { _id: string; title?: string }) => (
                    <SelectItem
                      key={conversation._id}
                      value={conversation._id as string}
                    >
                      {conversation.title ?? "Untitled chat"}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 rounded-lg bg-white/5"
              onClick={handleNewChat}
              aria-label="New chat"
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </div>

          {/* Guided Study Session bar */}
          {session && (
            <div className="relative z-10 border-b border-primary/15 bg-primary/[0.05] px-4 py-2">
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
                            : "bg-white/10",
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
                      className="h-7 rounded-lg bg-white/5 px-2.5 text-[10px] interactive-press"
                      onClick={() => void completeSession(session)}
                    >
                      {t("tutor:sessionEnd", { defaultValue: "End & save" })}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Mode selector — always visible */}
          <div className="relative z-10 border-b border-white/8 px-4 py-2">
            <ModeSelector mode={mode} onModeChange={changeMode} disabled={isAwaiting} />
          </div>

          {/* Thread */}
          <div
            ref={threadRef}
            className="relative z-10 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
            data-lenis-prevent-wheel
          >
            {selectedId === null ? (
              <div className="flex h-full flex-col items-center justify-center gap-5">
                <div className="w-full max-w-2xl overflow-y-auto" data-lenis-prevent-wheel>
                  <WelcomeDashboard
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
                  />

                  {/* ── Textbook grounding ── */}
                  {scopeSubject && scopedTextbooks.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="mt-4 w-full"
                    >
                      <p className="mb-2 px-1 type-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        📖 {t("tutor:textbookTitle", {
                          defaultValue: "Answer from your textbooks",
                        })}
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
                                  ? "border-amber-400/40 bg-amber-400/[0.1] text-amber-300"
                                  : "glass-soft text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <button
                                type="button"
                                className="flex cursor-pointer items-center gap-1.5"
                                onClick={() => {
                                  setContentId(book._id);
                                  handleNewChat();
                                  toast.success(
                                    t("tutor:textbookGrounded", {
                                      defaultValue: "Answers will now be grounded in “{{title}}”",
                                      title: book.title,
                                    }),
                                  );
                                }}
                              >
                                <Bookmark className="size-3.5" />
                                <span className="max-w-[180px] truncate font-medium">
                                  {book.title}
                                </span>
                                <span className="type-mono text-[9px] opacity-70">
                                  G{book.grade}
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label="Open in reader"
                                className="cursor-pointer opacity-60 transition-opacity hover:opacity-100"
                                onClick={() => navigate(`/read/${book._id}`)}
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
                    transition={{ duration: 0.5, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
                    className="mt-4 grid w-full gap-2.5"
                  >
                    {startersWithMock.map((prompt, i) => (
                      <motion.button
                        key={prompt}
                        type="button"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.35,
                          delay: 0.26 + 0.06 * i,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        onClick={() => handleSend(prompt)}
                        disabled={isAwaiting}
                        className={cn(
                          "cursor-pointer rounded-xl px-4 py-3.5 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground hover:border-primary/10 disabled:opacity-50 interactive-press border border-transparent",
                          i === 0 && latestMock
                            ? "border-amber-400/20 bg-amber-400/[0.06] text-foreground hover:border-amber-400/40 hover:bg-amber-400/[0.1]"
                            : "glass-soft",
                        )}
                      >
                        <span className="mr-2.5 font-mono text-[10px] text-amber-300">
                          $
                        </span>
                        {prompt}
                      </motion.button>
                    ))}
                  </motion.div>
                </div>
              </div>
            ) : messages === undefined ? (
              <div className="flex h-full items-center justify-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  className="size-5 rounded-full border-2 border-primary/30 border-t-primary"
                />
              </div>
            ) : (
              <>
                {messages.map((message: MessageDoc, i: number) => (
                  <Bubble key={message._id} message={message as MessageDoc} index={i} />
                ))}

                {/* Action chips under the latest assistant answer */}
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
                        "Explain that more simply — like I'm new to it, with a simple everyday analogy.",
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
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-end gap-1.5"
                >
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 px-4 py-3 type-body leading-6">
                    {sending.content}
                  </div>
                  <span className="px-1 type-caption text-muted-foreground/60">
                    you · sending…
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Thinking indicator */}
            <AnimatePresence>
              {isAwaiting && <ThinkingIndicator modeLabel={modeLabel} />}
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
                        onClick={() => handleSend(q)}
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
                              className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
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

          {/* Input */}
          <div className="relative z-10 border-t border-white/8 p-4">
            {/* Attachment previews */}
            {images.length > 0 && (
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                {images.map((src, i) => (
                  <div
                    key={i}
                    className="group relative size-14 overflow-hidden rounded-lg border border-white/15"
                  >
                    <img src={src} alt="Attachment preview" className="size-full object-cover" />
                    <button
                      type="button"
                      aria-label="Remove attachment"
                      onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
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
            <div className="flex items-center gap-2.5">
              {entitlements && !entitlements.premiumAccess && (
                <span
                  title={
                    entitlements.tutorRemainingToday > 0
                      ? `${entitlements.tutorRemainingToday} of ${entitlements.tutorDailyLimit} free messages left today`
                      : "Daily free messages used — they reset tomorrow"
                  }
                  className="hidden shrink-0 rounded-lg border border-premium/30 bg-premium/8 px-2.5 py-1.5 font-mono text-[10px] text-premium sm:block"
                >
                  free · {entitlements.tutorRemainingToday}/{entitlements.tutorDailyLimit} today
                </span>
              )}
              {/* Image upload */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                className="hidden"
                onChange={(e) => void handleAttach(e.target.files)}
              />
              <Button
                variant="outline"
                size="icon"
                className="size-10 shrink-0 rounded-xl bg-white/5 interactive-press"
                onClick={() => fileInputRef.current?.click()}
                disabled={isAwaiting || images.length >= 2 || attaching}
                aria-label="Attach an image"
                title="Attach a textbook page, handwritten work or a problem screenshot (max 2)"
              >
                {attaching ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="size-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground"
                  />
                ) : (
                  <Paperclip className="size-4" />
                )}
              </Button>
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  speech.listening
                    ? t("tutor:listening", { defaultValue: "Listening… speak now" })
                    : t("tutor:inputPlaceholder", { defaultValue: "Ask the tutor anything about your exams…" })
                }
                disabled={isAwaiting}
                className={cn(
                  "type-body h-10 flex-1 rounded-xl bg-white/5 font-mono",
                  speech.listening && "border-rose-400/40 bg-rose-400/[0.04] ring-1 ring-rose-400/30",
                )}
              />
              {speech.supported && (
                <Button
                  size="icon"
                  variant={speech.listening ? "default" : "outline"}
                  className={cn(
                    "size-10 shrink-0 cursor-pointer rounded-xl interactive-press",
                    speech.listening
                      ? "bg-rose-500 text-white hover:bg-rose-600"
                      : "bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                  disabled={isAwaiting}
                  aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
                  title={
                    speech.listening
                      ? "Stop listening"
                      : "Speak your question — transcribed text appears in the input, never auto-sent"
                  }
                >
                  {speech.listening ? (
                    <motion.span
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <MicOff className="size-4" />
                    </motion.span>
                  ) : (
                    <Mic className="size-4" />
                  )}
                </Button>
              )}
              <Button
                size="icon"
                className="size-10 shrink-0 rounded-xl interactive-press"
                onClick={() => handleSend()}
                disabled={(!input.trim() && images.length === 0) || isAwaiting}
                aria-label="Send message"
              >
                {isAwaiting ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                  />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </section>
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
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.8)]">
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
                  <p className="type-h2 text-amber-300">+{sessionComplete.xpAwarded}</p>
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




