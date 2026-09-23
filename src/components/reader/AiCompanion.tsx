// AI Reading Companion — the cyan-glow AI panel in the Smart Reader.
//
// Extracted from Reader.tsx so chat typing never re-renders the PDF
// canvas (the stage is memoized; this panel is its own tree).
//
// Quick actions are real, page-aware prompts: they extract the text of
// the CURRENT page(s) from the already-loaded pdf.js document (range
// requests pull only the missing chunks — zero extra downloads) and send
// one composed question through the existing readerAI action.

import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  Bot,
  GalleryVerticalEnd,
  Lightbulb,
  ListChecks,
  Loader2,
  NotebookPen,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type CompanionQuickAction =
  | "explain_page"
  | "summarize"
  | "quiz_me"
  | "make_notes"
  | "make_flashcards";

interface AiCompanionProps {
  itemTitle: string;
  subjectName: string;
  grade?: number | null;
  pageNumber: number;
  docReady: boolean;
  messages: ChatMessage[];
  asking: boolean;
  question: string;
  onQuestionChange: (value: string) => void;
  onAsk: (override?: string) => void;
  onQuickAction: (action: CompanionQuickAction) => void;
  /** The quick action currently running (spinner shows on that chip only). */
  pendingAction: CompanionQuickAction | null;
  generatingFlashcards: boolean;
}

const QUICK_ACTIONS: {
  id: CompanionQuickAction;
  label: string;
  icon: typeof Lightbulb;
}[] = [
  { id: "explain_page", label: "Explain this page", icon: Lightbulb },
  { id: "summarize", label: "Summarize", icon: ListChecks },
  { id: "quiz_me", label: "Quiz me", icon: NotebookPen },
  { id: "make_notes", label: "Make notes", icon: Bot },
  { id: "make_flashcards", label: "Make flashcards", icon: GalleryVerticalEnd },
];

export function AiCompanion({
  itemTitle,
  subjectName,
  grade,
  pageNumber,
  docReady,
  messages,
  asking,
  question,
  onQuestionChange,
  onAsk,
  onQuickAction,
  pendingAction,
  generatingFlashcards,
}: AiCompanionProps) {
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, asking]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-lenis-prevent-wheel>
        {/* Hero — electric cyan AI identity */}
        <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-cyan-400/[0.09] via-sky-500/[0.04] to-transparent p-4">
          <div className="absolute -right-8 -top-10 size-28 rounded-full bg-cyan-400/10 blur-2xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/40 to-transparent" />
          <p className="relative flex items-center gap-2 type-h3 text-foreground">
            <span className="relative flex size-6 items-center justify-center rounded-lg bg-cyan-400/15 ring-1 ring-cyan-300/30">
              <Sparkles className="size-3 text-cyan-700 dark:text-cyan-300" />
            </span>
            AI READING COMPANION
          </p>
          <p className="type-caption relative mt-2.5 leading-relaxed text-foreground/75">
            I know this textbook.
          </p>
          <p className="type-caption relative mt-0.5 leading-relaxed text-muted-foreground/70">
            Ask me about the page, chapter, or concept you&apos;re reading —
            or tap a shortcut below.
          </p>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_ACTIONS.map((action, i) => {
            const isFlashcards = action.id === "make_flashcards";
            const isPending = pendingAction === action.id || (isFlashcards && generatingFlashcards);
            return (
              <motion.button
                key={action.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.03 * i, duration: 0.2 }}
                type="button"
                disabled={asking || generatingFlashcards}
                onClick={() => onQuickAction(action.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left text-[11px] font-semibold transition-all duration-150 interactive-press disabled:opacity-50",
                  i === QUICK_ACTIONS.length - 1 && QUICK_ACTIONS.length % 2 === 1 && "col-span-2",
                  isFlashcards
                    ? "border-amber-300/25 bg-amber-300/[0.07] text-amber-700 dark:text-amber-200 hover:bg-amber-300/[0.12]"
                    : "border-cyan-400/15 bg-cyan-400/[0.05] text-cyan-700 dark:text-cyan-200/90 hover:border-cyan-400/30 hover:bg-cyan-400/[0.1]",
                )}
              >
                {isPending ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" />
                ) : (
                  <action.icon className="size-3.5 shrink-0" />
                )}
                <span className="truncate">{action.label}</span>
              </motion.button>
            );
          })}
        </div>

        {!docReady && messages.length === 0 && (
          <p className="type-mono px-1 text-[10px] leading-relaxed text-muted-foreground/35">
            Page-aware shortcuts unlock as soon as the document opens. You can still ask anything right now.
          </p>
        )}

        {/* Messages */}
        {messages.map((message, index) => (
          <div
            key={index}
            className={cn(
              "rounded-xl px-3.5 py-2.5 text-[13px] leading-6 transition-all duration-200",
              message.role === "user"
                ? "ml-6 border border-cyan-400/15 bg-cyan-400/[0.07] text-foreground"
                : "mr-1 border border-foreground/[0.06] bg-foreground/[0.02] text-foreground/85",
            )}
          >
            <p className={cn("whitespace-pre-wrap", message.role === "assistant" && "text-[12.5px] leading-[1.7]")}>
              {message.content}
            </p>
          </div>
        ))}

        {asking && (
          <div className="type-mono mr-1 flex items-center gap-2 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.03] px-4 py-3 text-cyan-700 dark:text-cyan-200/60">
            <div className="flex gap-1">
              <div className="size-1.5 animate-bounce rounded-full bg-cyan-300/70" style={{ animationDelay: "0ms" }} />
              <div className="size-1.5 animate-bounce rounded-full bg-cyan-300/70" style={{ animationDelay: "150ms" }} />
              <div className="size-1.5 animate-bounce rounded-full bg-cyan-300/70" style={{ animationDelay: "300ms" }} />
            </div>
            <span className="ml-1">reading the page…</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Chat input */}
      <div className="relative shrink-0 border-t border-foreground/[0.06] p-3">
        <div className="flex items-center gap-2 rounded-xl border border-foreground/[0.08] bg-foreground/[0.03] p-1.5 transition-all duration-200 focus-within:border-cyan-400/30 focus-within:bg-foreground/[0.05]">
          <label htmlFor="reader-question" className="sr-only">Ask the reading companion</label>
          <Input
            id="reader-question"
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onAsk();
              }
            }}
            placeholder={`Ask about page ${pageNumber}…`}
            className="h-8 flex-1 rounded-lg border-0 bg-transparent px-2 text-[13px] shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
          />
          <Button
            size="icon"
            className="size-8 shrink-0 cursor-pointer rounded-lg bg-cyan-400/20 text-cyan-700 dark:text-cyan-200 hover:bg-cyan-400/30"
            onClick={() => onAsk()}
            disabled={asking || !question.trim()}
            aria-label="Send"
          >
            <Send className="size-3.5" />
          </Button>
        </div>
        <p className="type-mono mt-1.5 hidden px-1 text-[9px] text-muted-foreground/30 sm:block">
          {subjectName}
          {grade ? ` · Grade ${grade}` : ""} · {itemTitle}
        </p>
      </div>
    </div>
  );
}
