// Flashcards — AI-generated flashcard decks with flip-card study sessions.
// Premium gated: generation requires active subscription/trial.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
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
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export default function Flashcards() {
  const decks = useQuery(api.flashcards.getMyDecks);
  const subjects = useQuery(api.subjects.getAll);
  const generateDeck = useAction(api.flashcards.generateDeck as any);

  const [generating, setGenerating] = useState(false);
  const [genSubjectId, setGenSubjectId] = useState("");
  const [showGenerate, setShowGenerate] = useState(false);

  // Study session state
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null);
  const cards = useQuery(
    api.flashcards.getDeckCards,
    activeDeckId ? { deckId: activeDeckId as never } : "skip"
  );
  const submitReview = useMutation(api.flashcards.submitCardReview as any);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, "got_it" | "review_again">>({});

  const currentCard = cards?.[currentIndex];
  const totalCards = cards?.length ?? 0;
  const isComplete = totalCards > 0 && currentIndex >= totalCards;
  const gotItCount = Object.values(results).filter((r) => r === "got_it").length;
  const reviewCount = Object.values(results).filter((r) => r === "review_again").length;

  const handleGenerate = async () => {
    if (!genSubjectId) {
      toast.error("Pick a subject first.");
      return;
    }
    setGenerating(true);
    try {
      const result = await generateDeck({ subjectId: genSubjectId as never });
      toast.success(`Created deck with ${result.cardCount} cards!`);
      setShowGenerate(false);
      setGenSubjectId("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not generate flashcards."));
    } finally {
      setGenerating(false);
    }
  };

  const handleFlip = () => setFlipped((f) => !f);

  const handleReview = async (result: "got_it" | "review_again") => {
    if (!currentCard) return;
    setResults((prev) => ({ ...prev, [currentCard._id]: result }));
    try {
      await submitReview({ cardId: currentCard._id as never, result });
    } catch {
      // Review already recorded locally
    }
    setFlipped(false);
    setTimeout(() => setCurrentIndex((i) => i + 1), 150);
  };

  const startSession = (deckId: string) => {
    setActiveDeckId(deckId);
    setCurrentIndex(0);
    setFlipped(false);
    setResults({});
  };

  const endSession = () => {
    setActiveDeckId(null);
    setCurrentIndex(0);
    setFlipped(false);
    setResults({});
  };

  // Active study session
  if (activeDeckId) {
    return (
      <DashboardShell>
        <div className="mx-auto max-w-xl">
          {/* Session header */}
          <div className="mb-6 flex items-center justify-between">
            <button
              type="button"
              onClick={endSession}
              className="interactive-press flex items-center gap-1.5 type-caption text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronLeft className="size-4" /> Back to decks
            </button>
            <span className="type-mono text-xs text-muted-foreground">
              {currentIndex + (isComplete ? 0 : 1)} / {totalCards}
            </span>
          </div>

          {cards === undefined ? (
            <div className="flex h-60 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : isComplete ? (
            /* Session complete */
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-panel flex flex-col items-center rounded-2xl p-10 text-center"
            >
              <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Sparkles className="size-8" />
              </div>
              <h2 className="type-h1 mt-5">Session complete!</h2>
              <div className="mt-4 flex gap-6">
                <div className="text-center">
                  <p className="type-h2 text-emerald-400">{gotItCount}</p>
                  <p className="type-mono text-xs text-muted-foreground">Got it</p>
                </div>
                <div className="text-center">
                  <p className="type-h2 text-amber-400">{reviewCount}</p>
                  <p className="type-mono text-xs text-muted-foreground">Review again</p>
                </div>
              </div>
              <p className="type-body mt-3 max-w-xs text-muted-foreground">
                {reviewCount > 0
                  ? "Cards marked for review will surface first next time."
                  : "Perfect session — you nailed every card!"}
              </p>
              <div className="mt-6 flex gap-3">
                {reviewCount > 0 && (
                  <Button
                    variant="outline"
                    className="rounded-xl bg-white/5"
                    onClick={() => {
                      setCurrentIndex(0);
                      setFlipped(false);
                      setResults({});
                    }}
                  >
                    <RotateCcw className="size-4" /> Review again
                  </Button>
                )}
                <Button className="rounded-xl" onClick={endSession}>
                  Done
                </Button>
              </div>
            </motion.div>
          ) : currentCard ? (
            /* Active card */
            <div className="flex flex-col items-center">
              {/* Flip card */}
              <button
                type="button"
                onClick={handleFlip}
                className="interactive-press group relative h-64 w-full cursor-pointer rounded-2xl"
                style={{ perspective: "1000px" }}
              >
                <motion.div
                  animate={{ rotateY: flipped ? 180 : 0 }}
                  transition={{ duration: 0.4, ease: "easeInOut" }}
                  className="glass-panel absolute inset-0 flex items-center justify-center rounded-2xl p-8"
                  style={{ transformStyle: "preserve-3d" }}
                >
                  {/* Front */}
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center p-8"
                    style={{ backfaceVisibility: "hidden" }}
                  >
                    <p className="type-mono mb-2 text-xs text-muted-foreground">QUESTION</p>
                    <p className="type-body-lg text-center leading-7">{currentCard.front}</p>
                    <p className="type-caption mt-4 text-muted-foreground">tap to flip</p>
                  </div>
                  {/* Back */}
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center p-8"
                    style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                  >
                    <p className="type-mono mb-2 text-xs text-primary">ANSWER</p>
                    <p className="type-body-lg text-center leading-7">{currentCard.back}</p>
                  </div>
                </motion.div>
              </button>

              {/* Review buttons */}
              <AnimatePresence>
                {flipped && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 12 }}
                    className="mt-6 flex gap-4"
                  >
                    <button
                      type="button"
                      onClick={() => handleReview("review_again")}
                      className="interactive-press flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-6 py-3 text-sm font-semibold text-amber-300 transition-colors hover:bg-amber-400/20"
                    >
                      <RotateCcw className="size-4" /> Review again
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReview("got_it")}
                      className="interactive-press flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-6 py-3 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/20"
                    >
                      <Check className="size-4" /> Got it
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : null}
        </div>
      </DashboardShell>
    );
  }

  // Deck list view
  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="type-mono uppercase tracking-[0.2em] text-primary">
              // flashcards
            </p>
            <h1 className="type-h1 mt-1">Flashcards</h1>
            <p className="type-body mt-1 text-muted-foreground">
              AI-generated flashcard decks. Flip, review, repeat — spaced repetition does the rest.
            </p>
          </div>
          <Button
            className="rounded-xl"
            onClick={() => setShowGenerate(true)}
            disabled={generating}
          >
            <Plus className="size-4" /> New deck
          </Button>
        </div>

        {/* Deck grid */}
        {decks === undefined ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : decks.length === 0 ? (
          <div className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Layers className="size-6" />
            </div>
            <h3 className="type-h3 mt-4">No flashcard decks yet</h3>
            <p className="type-body mt-1 max-w-sm text-muted-foreground">
              Generate your first deck from any subject. The AI will create
              question/answer pairs you can flip through.
            </p>
            <Button className="mt-5 rounded-xl" onClick={() => setShowGenerate(true)}>
              <Plus className="size-4" /> Create first deck
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence>
              {decks.map((deck) => {
                const subject = subjects?.find((s) => s._id === deck.subjectId);
                return (
                  <motion.div
                    key={deck._id}
                    layout
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="glass-panel hover-lift group flex flex-col rounded-2xl p-5"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Brain className="size-5" />
                      </div>
                      <span className="type-mono rounded-lg bg-white/5 px-2 py-1 text-xs text-muted-foreground">
                        {deck.cardCount} cards
                      </span>
                    </div>
                    <h3 className="type-h3 mt-3">{deck.title}</h3>
                    <p className="type-caption mt-1 text-muted-foreground">
                      {subject?.name ?? "Subject"} ·{" "}
                      {deck.sourceType === "content"
                        ? "from library"
                        : deck.sourceType === "conversation"
                          ? "from tutor chat"
                          : "from topic"}
                    </p>
                    <p className="type-caption mt-0.5 text-muted-foreground/60">
                      {new Date(deck.createdAt).toLocaleDateString()}
                    </p>
                    <div className="mt-auto pt-4">
                      <Button
                        className="w-full rounded-xl"
                        variant="outline"
                        onClick={() => startSession(deck._id)}
                      >
                        Study now
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Generate dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle>Generate flashcard deck</DialogTitle>
            <DialogDescription>
              Pick a subject — the AI will create 10–15 question/answer pairs from the curriculum.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Select value={genSubjectId} onValueChange={setGenSubjectId}>
              <SelectTrigger className="type-body h-10 rounded-xl bg-white/5">
                <SelectValue placeholder="Choose a subject" />
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
          <DialogFooter>
            <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setShowGenerate(false)}>
              Cancel
            </Button>
            <Button className="rounded-xl" onClick={handleGenerate} disabled={generating || !genSubjectId}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
