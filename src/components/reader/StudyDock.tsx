// Study Dock — the slide-up study sheet under the textbook.
//
// 📌 Notes · 🔖 Highlights · 🎴 Flashcards · 🤖 AI — students never
// leave the textbook to study. The dock shares the scratchpad state
// with the right-panel Calc tab (single source of truth in Reader), and
// its AI tab simply opens the AI Reading Companion panel.
//
// All highlight persistence is localStorage-only (see readerStorage) —
// zero new Convex queries/mutations by design.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  GalleryVerticalEnd,
  Highlighter,
  Loader2,
  Sparkles,
  StickyNote,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ReaderHighlight } from "@/lib/readerStorage";

export type DockTab = "notes" | "highlights" | "flashcards";

interface StudyDockProps {
  docReady: boolean;
  pageNumber: number;
  numPages: number | null;
  /** Controlled open tab (Reader owns it — quick actions can open the dock). */
  open: DockTab | null;
  onOpenChange: (tab: DockTab | null) => void;
  // notes (scratchpad shared state)
  scratchText: string;
  onScratchTextChange: (value: string) => void;
  scratchSaved: boolean;
  savingScratch: boolean;
  onSaveScratch: () => void;
  // highlights
  highlights: ReaderHighlight[];
  onCaptureSelection: () => void;
  onRemoveHighlight: (id: string) => void;
  onClearHighlights: () => void;
  onJumpToPage: (page: number) => void;
  // flashcards
  onGenerateFlashcards: (start: number, end: number) => void;
  generatingFlashcards: boolean;
  flashcardResult: { cardCount: number; deckId: string } | null;
  onFlashcardResultDismiss: () => void;
  // ai
  onOpenAI: () => void;
  // placement nudge when the practice panel occupies the bottom
  raised?: boolean;
}

const DOCK_TABS: { id: DockTab; label: string; icon: typeof StickyNote }[] = [
  { id: "notes", label: "Notes", icon: StickyNote },
  { id: "highlights", label: "Highlights", icon: Highlighter },
  { id: "flashcards", label: "Cards", icon: GalleryVerticalEnd },
];

export function StudyDock({
  docReady,
  pageNumber,
  numPages,
  open,
  onOpenChange,
  scratchText,
  onScratchTextChange,
  scratchSaved,
  savingScratch,
  onSaveScratch,
  highlights,
  onCaptureSelection,
  onRemoveHighlight,
  onClearHighlights,
  onJumpToPage,
  onGenerateFlashcards,
  generatingFlashcards,
  flashcardResult,
  onFlashcardResultDismiss,
  onOpenAI,
  raised,
}: StudyDockProps) {
  const toggle = (tab: DockTab) => onOpenChange(open === tab ? null : tab);

  return (
    <>
      {/* ── Dock buttons ── */}
      <div
        className={cn(
          "absolute right-3 z-40 flex flex-col gap-1.5",
          raised ? "bottom-56" : "bottom-20",
        )}
      >
        {DOCK_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => toggle(tab.id)}
            className={cn(
              "group relative flex size-10 cursor-pointer items-center justify-center rounded-xl border shadow-[0_8px_30px_-6px_rgba(0,0,0,0.7)] backdrop-blur-2xl transition-all duration-200 active:scale-90",
              open === tab.id
                ? "border-primary/40 bg-primary/20 text-primary"
                : "border-white/10 bg-black/60 text-muted-foreground hover:border-white/25 hover:text-foreground",
            )}
            title={`${tab.label}${tab.id === "notes" ? " · auto-saved" : ""}`}
            aria-label={`Study dock: ${tab.label}`}
          >
            <tab.icon className="size-4" />
            {tab.id === "highlights" && highlights.length > 0 && (
              <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 text-[8px] font-bold text-black">
                {highlights.length > 9 ? "9+" : highlights.length}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={onOpenAI}
          className="flex size-10 cursor-pointer items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-400/15 text-cyan-200 shadow-[0_8px_30px_-6px_rgba(34,211,238,0.25)] backdrop-blur-2xl transition-all duration-200 hover:bg-cyan-400/25 active:scale-90"
          title="AI Reading Companion"
          aria-label="Study dock: AI companion"
        >
          <Sparkles className="size-4" />
        </button>
      </div>

      {/* ── Slide-up sheet ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="study-dock-sheet"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36 }}
            role="dialog"
            aria-label={`Study dock — ${open}`}
            className={cn(
              "absolute inset-x-3 z-40 flex max-h-[min(58vh,420px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0e17]/95 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.85)] backdrop-blur-2xl sm:inset-x-auto sm:right-3 sm:w-[400px]",
              raised ? "bottom-64" : "bottom-36",
            )}
          >
            {/* Sheet header */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-3 py-2">
              <div className="flex items-center gap-1">
                {DOCK_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => toggle(tab.id)}
                    className={cn(
                      "flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all",
                      open === tab.id
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground/60 hover:bg-white/5 hover:text-foreground",
                    )}
                  >
                    <tab.icon className="size-3.5" />
                    {tab.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onOpenChange(null)}
                className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 hover:bg-white/10 hover:text-foreground"
                aria-label="Close study dock"
              >
                <X className="size-3.5" />
              </button>
            </div>

            {/* ── NOTES ── */}
            {open === "notes" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between px-3 pb-1 pt-2">
                  <p className="type-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
                    Notes · page {pageNumber}
                    {scratchSaved ? " · saved" : " · unsaved"}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 cursor-pointer rounded-lg px-2 text-[11px] text-muted-foreground/60 hover:text-foreground"
                    onClick={onSaveScratch}
                    disabled={savingScratch || scratchSaved}
                  >
                    {savingScratch ? <Loader2 className="size-3 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <textarea
                  aria-label="Study notes"
                  value={scratchText}
                  onChange={(e) => onScratchTextChange(e.target.value)}
                  placeholder="Write notes, formulas, summaries… (auto-syncs with the Calc tab)"
                  className="mx-3 mb-3 min-h-0 flex-1 resize-none rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 font-mono text-[12px] leading-[1.7] text-foreground/85 outline-none transition-all placeholder:text-muted-foreground/30 focus:border-primary/30"
                />
              </div>
            )}

            {/* ── HIGHLIGHTS ── */}
            {open === "highlights" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex items-center justify-between px-3 py-2">
                  <p className="type-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/50">
                    Saved on this device
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 cursor-pointer rounded-lg gap-1 border border-amber-300/20 bg-amber-300/[0.06] px-2 text-[11px] text-amber-200 hover:bg-amber-300/[0.12]"
                      onClick={onCaptureSelection}
                      title="Highlight the text you selected in the PDF"
                    >
                      <Highlighter className="size-3" /> From selection
                    </Button>
                    {highlights.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 cursor-pointer rounded-lg px-2 text-[11px] text-muted-foreground/50 hover:text-rose-300"
                        onClick={onClearHighlights}
                        aria-label="Clear all highlights"
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3 scrollbar-none" data-lenis-prevent-wheel>
                  {highlights.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-8 text-center">
                      <Highlighter className="size-6 text-muted-foreground/20" />
                      <p className="type-caption max-w-[240px] leading-relaxed text-muted-foreground/40">
                        Select any text in the textbook and tap{" "}
                        <span className="text-amber-200/70">Highlight</span> in the popup — or use “From selection”.
                      </p>
                    </div>
                  ) : (
                    highlights.map((highlight) => (
                      <div
                        key={highlight.id}
                        className="group flex cursor-pointer items-start gap-2 rounded-xl border border-amber-300/10 bg-amber-300/[0.03] px-3 py-2 transition-all hover:border-amber-300/25"
                        onClick={() => onJumpToPage(highlight.page)}
                      >
                        <span className="type-mono mt-0.5 shrink-0 rounded-md border border-amber-300/20 bg-amber-300/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
                          p{highlight.page}
                        </span>
                        <p className="line-clamp-3 min-w-0 flex-1 text-[11.5px] leading-[1.6] text-foreground/75">
                          {highlight.text}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveHighlight(highlight.id);
                          }}
                          className="shrink-0 cursor-pointer rounded p-0.5 text-muted-foreground/30 opacity-0 transition-all hover:text-rose-300 group-hover:opacity-100"
                          aria-label="Remove highlight"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* ── FLASHCARDS ── */}
            {open === "flashcards" && (
              <FlashcardsTab
                docReady={docReady}
                pageNumber={pageNumber}
                numPages={numPages}
                onGenerate={onGenerateFlashcards}
                generating={generatingFlashcards}
                result={flashcardResult}
                onDismissResult={onFlashcardResultDismiss}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function FlashcardsTab({
  docReady,
  pageNumber,
  numPages,
  onGenerate,
  generating,
  result,
  onDismissResult,
}: {
  docReady: boolean;
  pageNumber: number;
  numPages: number | null;
  onGenerate: (start: number, end: number) => void;
  generating: boolean;
  result: { cardCount: number; deckId: string } | null;
  onDismissResult: () => void;
}) {
  const [start, setStart] = useState(String(Math.max(1, pageNumber - 3)));
  const [end, setEnd] = useState(String(Math.min(numPages ?? pageNumber + 3, pageNumber + 3)));

  // Re-center the suggested range around the current page.
  useEffect(() => {
    setStart(String(Math.max(1, pageNumber - 3)));
    setEnd(String(Math.min(numPages ?? pageNumber + 3, pageNumber + 3)));
  }, [pageNumber, numPages]);

  if (result) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="relative">
          <div className="absolute -inset-4 rounded-full bg-amber-400/10 blur-xl" />
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10">
            <GalleryVerticalEnd className="size-6 text-amber-300" />
          </div>
        </div>
        <p className="type-h3 text-foreground">{result.cardCount} flashcards ready</p>
        <p className="type-caption max-w-[260px] leading-relaxed text-muted-foreground/60">
          Your deck was created from pages {start}–{end}. Study it in the Flashcards tab.
        </p>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="cursor-pointer rounded-xl bg-amber-300 text-black hover:bg-amber-200">
            <a href="/flashcards" target="_blank" rel="noopener noreferrer">Open Flashcards</a>
          </Button>
          <Button size="sm" variant="outline" className="cursor-pointer rounded-xl border-white/10 bg-white/5" onClick={onDismissResult}>
            Make another
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <p className="type-caption leading-relaxed text-muted-foreground/60">
        Turn the pages you&apos;re reading into an exam-ready deck. The AI reads the{" "}
        <span className="text-foreground/80">actual page text</span> — not just the title.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <label className="type-mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">
          From
          <Input
            type="number"
            min={1}
            max={numPages ?? undefined}
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="type-mono h-8 w-16 rounded-lg border-white/[0.08] bg-white/[0.02] text-center text-xs tabular-nums"
          />
        </label>
        <span className="text-muted-foreground/30">→</span>
        <label className="type-mono flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/50">
          To
          <Input
            type="number"
            min={1}
            max={numPages ?? undefined}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="type-mono h-8 w-16 rounded-lg border-white/[0.08] bg-white/[0.02] text-center text-xs tabular-nums"
          />
        </label>
      </div>
      <Button
        className="mt-3 cursor-pointer rounded-xl bg-amber-300 text-black hover:bg-amber-200"
        disabled={generating || !docReady}
        onClick={() => {
          const s = Math.max(1, Number.parseInt(start, 10) || pageNumber);
          const e = Math.min(numPages ?? s + 3, Number.parseInt(end, 10) || pageNumber);
          onGenerate(Math.min(s, e), Math.max(s, e));
        }}
      >
        {generating ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Reading pages & crafting cards…
          </>
        ) : (
          <>
            <GalleryVerticalEnd className="size-4" /> Generate deck
          </>
        )}
      </Button>
      {!docReady && (
        <p className="type-mono mt-2 text-[10px] text-muted-foreground/35">
          Opens once the document is loaded.
        </p>
      )}
      <p className="type-mono mt-2 text-[9px] leading-relaxed text-muted-foreground/30">
        Premium feature · deck appears in your Flashcards tab
      </p>
    </div>
  );
}
