// Study Cards — bite-sized quick-reference cards per topic.
//
// Browsing view: sidebar filters (grade + subject) + main content area
// showing one card at a time. Card has title, "When to use it" practical
// usage explanation, "Watch for" common-mistake warning, and the body
// reference content. Like/save action reuses the existing "Saved"
// terminology + UX patterns (separate table because the existing
// bookmarks table is typed to contentItems/PDFs).
//
// Browsing mode toggle: sequential (default order) vs shuffled (random
// order — useful for review sessions).
//
// AI generation: premium-gated. Free users can browse all existing cards;
// premium users can trigger generation of new cards on a topic.
//
// BROWSING IS FREE for everyone (consistent with the project's "browsing
// content is free" principle). AI GENERATION is premium-gated, matching
// how quizzes/flashcards gate generation.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  GraduationCap,
  Lightbulb,
  Loader2,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
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
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface StudyCard {
  _id: Id<"studyCards">;
  subjectId: Id<"subjects">;
  subjectName: string;
  gradeLevel: 9 | 10 | 11 | 12;
  topicId: Id<"topics"> | null;
  title: string;
  whenToUseIt: string;
  commonMistake: string;
  bodyContent: string;
  createdVia: "admin" | "ai";
  createdAt: number;
  isBookmarked: boolean;
}

export default function StudyCardsPage() {
  const { t } = useTranslation(["common"]);
  const friendlyError = useFriendlyError();
  const subjects = useQuery(api.subjects.getAll);
  const profile = useQuery(api.profile.getProfile);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const generateAI = useAction(api.studyCards.generateAI);
  const toggleBookmark = useMutation(api.studyCards.toggleBookmark);

  // Filters — grade defaults to the student's gradeLevel (smart default,
  // same logic as the Library: grade 12 sees all 4 years, others see only
  // their grade). Subject defaults to "all".
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [browseMode, setBrowseMode] = useState<"sequential" | "shuffled">("sequential");
  const [currentIdx, setCurrentIdx] = useState(0);
  const [generateOpen, setGenerateOpen] = useState(false);

  // Apply smart default grade filter when profile loads (one-shot)
  const appliedDefaultRef = useRef(false);
  useEffect(() => {
    if (appliedDefaultRef.current) return;
    if (profile === undefined) return;
    appliedDefaultRef.current = true;
    if (!profile || profile.gradeLevel === null || profile.gradeLevel === undefined) return;
    // Grade 12 → leave "all" (shows 9-12 combined); other grades → filter
    if (profile.gradeLevel !== 12) {
      setGradeFilter(String(profile.gradeLevel));
    }
  }, [profile]);

  // Fetch cards with current filters
  const cards = useQuery(api.studyCards.list, {
    subjectId: subjectFilter !== "all" ? (subjectFilter as Id<"subjects">) : undefined,
    gradeLevel: gradeFilter !== "all" ? (Number(gradeFilter) as 9 | 10 | 11 | 12) : undefined,
  });

  // Shuffle the card order when in shuffled mode
  const orderedCards = useMemo<StudyCard[]>(() => {
    if (!cards) return [];
    if (browseMode === "sequential") return cards;
    // Fisher-Yates shuffle (stable per-render via memo so re-renders don't
    // reshuffle during a session unless the user toggles)
    const shuffled = [...cards];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    return shuffled;
  }, [cards, browseMode]);

  // Reset index when filters/mode change
  useEffect(() => {
    setCurrentIdx(0);
  }, [gradeFilter, subjectFilter, browseMode]);

  const currentCard = orderedCards[currentIdx] ?? null;
  const isPremium = entitlements?.premiumAccess ?? false;

  const goPrev = () => setCurrentIdx((i) => Math.max(0, i - 1));
  const goNext = () => setCurrentIdx((i) => Math.min(orderedCards.length - 1, i + 1));

  const handleBookmark = async (cardId: Id<"studyCards">) => {
    try {
      await toggleBookmark({ studyCardId: cardId });
    } catch (error) {
      toast.error(friendlyError(error, "Could not save the card."));
    }
  };

  return (
    <DashboardShell>
      <div className="flex flex-col gap-4 sm:gap-6">
        {/* ═══ HERO ═══ */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <div className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full bg-amber-400/10 blur-[80px]" />
          <div className="pointer-events-none absolute -right-6 top-0 size-32 rounded-full bg-amber-400/[0.06] blur-[64px]" />
          <div className="relative">
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold type-caption">
              // quick reference
            </p>
            <h1 className="mt-1 type-h1 text-gradient">Study Cards</h1>
            <p className="mt-2 max-w-2xl type-body text-muted-foreground">
              Bite-sized reference cards for quick concept lookup — like a well-organized
              cheat sheet per topic. Browse any subject, save cards you want to revisit,
              and switch to shuffle mode for review sessions.
            </p>
          </div>
        </motion.section>

        {/* ═══ FILTERS + BROWSE MODE ═══ */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel relative overflow-hidden rounded-2xl p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <div className="flex flex-col gap-1.5">
                <span className="type-caption font-semibold text-muted-foreground">Grade</span>
                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                  <SelectTrigger className="h-9 w-32 rounded-xl bg-white/5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All grades</SelectItem>
                    {[9, 10, 11, 12].map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        Grade {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="type-caption font-semibold text-muted-foreground">Subject</span>
                <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                  <SelectTrigger className="h-9 w-44 rounded-xl bg-white/5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subjects</SelectItem>
                    {subjects?.map((s) => (
                      <SelectItem key={s._id} value={s._id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                <button
                  type="button"
                  onClick={() => setBrowseMode("sequential")}
                  className={cn(
                    "interactive-press rounded-lg px-3 py-1.5 type-caption font-bold uppercase tracking-wider transition",
                    browseMode === "sequential"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Sequential
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseMode("shuffled")}
                  className={cn(
                    "interactive-press flex items-center gap-1 rounded-lg px-3 py-1.5 type-caption font-bold uppercase tracking-wider transition",
                    browseMode === "shuffled"
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Shuffle className="size-3" /> Shuffle
                </button>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="interactive-press cursor-pointer rounded-xl bg-white/5"
                onClick={() => setGenerateOpen(true)}
                disabled={!isPremium}
                title={isPremium ? "Generate a new study card with AI" : "Premium — upgrade to generate study cards with AI"}
              >
                <Sparkles className="size-3.5" /> Generate
              </Button>
            </div>
          </div>
        </motion.div>

        {/* ═══ MAIN CONTENT — one card at a time ═══ */}
        {!cards ? (
          <div className="glass-panel flex h-64 items-center justify-center rounded-3xl">
            <Loader2 className="size-6 animate-spin text-amber-300/60" />
          </div>
        ) : orderedCards.length === 0 ? (
          <EmptyState
            isPremium={isPremium}
            onGenerate={() => setGenerateOpen(true)}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Card counter + nav */}
            <div className="flex items-center justify-between">
              <p className="type-caption text-muted-foreground">
                {currentIdx + 1} of {orderedCards.length} cards
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  className="interactive-press cursor-pointer rounded-lg"
                  onClick={goPrev}
                  disabled={currentIdx === 0}
                >
                  <ChevronLeft className="size-4" /> Prev
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="interactive-press cursor-pointer rounded-lg"
                  onClick={goNext}
                  disabled={currentIdx === orderedCards.length - 1}
                >
                  Next <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            {/* The card itself */}
            <AnimatePresence mode="wait">
              {currentCard && (
                <motion.div
                  key={currentCard._id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -16 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="glass-panel relative overflow-hidden rounded-3xl p-5 sm:p-7"
                >
                  <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-amber-400/10 blur-[60px]" />

                  <div className="relative">
                    {/* Header — subject + grade + bookmark */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
                          {currentCard.subjectName}
                        </Badge>
                        <Badge className="border-white/10 bg-white/5 text-muted-foreground">
                          <GraduationCap className="size-2.5" /> Grade {currentCard.gradeLevel}
                        </Badge>
                        {currentCard.createdVia === "ai" && (
                          <Badge className="border-purple-400/30 bg-purple-400/10 text-purple-300">
                            <Sparkles className="size-2.5" /> AI-generated
                          </Badge>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleBookmark(currentCard._id)}
                        className={cn(
                          "interactive-press flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border transition-colors",
                          currentCard.isBookmarked
                            ? "border-amber-400/30 bg-amber-400/15 text-amber-300"
                            : "border-white/10 bg-white/[0.03] text-muted-foreground hover:text-foreground",
                        )}
                        title={currentCard.isBookmarked ? "Saved" : "Save this card"}
                      >
                        {currentCard.isBookmarked ? (
                          <BookmarkCheck className="size-4" />
                        ) : (
                          <Bookmark className="size-4" />
                        )}
                      </button>
                    </div>

                    {/* Title */}
                    <h2 className="mt-4 type-h1 text-gradient">{currentCard.title}</h2>

                    {/* When to use it */}
                    <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
                      <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                        <Lightbulb className="size-3.5" /> When to use it
                      </p>
                      <p className="mt-1.5 type-body text-foreground/90">{currentCard.whenToUseIt}</p>
                    </div>

                    {/* Watch for — common mistake */}
                    <div className="mt-3 rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-4">
                      <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-rose-300">
                        <AlertTriangle className="size-3.5" /> Watch for
                      </p>
                      <p className="mt-1.5 type-body text-foreground/90">{currentCard.commonMistake}</p>
                    </div>

                    {/* Body content — render with paragraph breaks */}
                    <div className="mt-5">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                        Reference
                      </p>
                      <div className="mt-2 flex flex-col gap-3">
                        {currentCard.bodyContent
                          .split(/\n\n+/)
                          .filter((p) => p.trim().length > 0)
                          .map((para, i) => (
                            <p key={i} className="type-body-lg text-foreground/90">
                              {para}
                            </p>
                          ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Progress dots */}
            {orderedCards.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-1">
                {orderedCards.slice(0, 12).map((c, i) => (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() => setCurrentIdx(i)}
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      i === currentIdx
                        ? "w-6 bg-amber-400"
                        : "w-1.5 bg-white/15 hover:bg-white/30",
                    )}
                    aria-label={`Go to card ${i + 1}`}
                  />
                ))}
                {orderedCards.length > 12 && (
                  <span className="ml-1 type-caption text-muted-foreground/60">
                    +{orderedCards.length - 12}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ AI GENERATE DIALOG ═══ */}
      <GenerateDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        subjects={subjects ?? []}
        onGenerate={async (subjectId, gradeLevel, topicName) => {
          try {
            const result = await generateAI({ subjectId, gradeLevel, topicName });
            toast.success("Study card generated! 🎉");
            setGenerateOpen(false);
            // Force a refresh by toggling the filter (the useQuery will re-fetch)
            // The new card will appear at the top of the list since we order desc.
            void result;
          } catch (error) {
            toast.error(friendlyError(error, "Could not generate the card."));
          }
        }}
      />
    </DashboardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EMPTY STATE — no cards yet
// ═══════════════════════════════════════════════════════════════════════

function EmptyState({
  isPremium,
  onGenerate,
}: {
  isPremium: boolean;
  onGenerate: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-soft flex flex-col items-center rounded-3xl px-6 py-16 text-center"
    >
      <div className="relative">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.6)]">
          <FileText className="size-7" />
        </div>
        <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_12px_-4px_rgb(245_197_66/0.8)]">
          <Sparkles className="size-3" />
        </div>
      </div>
      <h3 className="type-h3 mt-6 text-foreground">No study cards yet</h3>
      <p className="type-body mt-2 max-w-sm text-muted-foreground">
        {isPremium
          ? "Be the first to generate a study card on this topic — your AI tutor will write a quick-reference card you can save and revisit anytime."
          : "When admins or premium students generate study cards, they'll show up here. Browsing is free for everyone."}
      </p>
      {isPremium && (
        <Button
          className="interactive-press mt-6 cursor-pointer rounded-xl"
          onClick={onGenerate}
        >
          <Sparkles className="size-4" /> Generate the first card
        </Button>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AI GENERATE DIALOG
// ═══════════════════════════════════════════════════════════════════════

function GenerateDialog({
  open,
  onOpenChange,
  subjects,
  onGenerate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  subjects: { _id: Id<"subjects">; name: string }[];
  onGenerate: (subjectId: Id<"subjects">, gradeLevel: 9 | 10 | 11 | 12, topicName?: string) => Promise<void>;
}) {
  const [subjectId, setSubjectId] = useState<string>("");
  const [gradeLevel, setGradeLevel] = useState<string>("");
  const [topicName, setTopicName] = useState("");
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!subjectId || !gradeLevel) {
      toast.error("Pick a subject and grade.");
      return;
    }
    setGenerating(true);
    try {
      await onGenerate(
        subjectId as Id<"subjects">,
        Number(gradeLevel) as 9 | 10 | 11 | 12,
        topicName.trim() || undefined,
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-amber-300" /> Generate a study card
          </DialogTitle>
          <DialogDescription>
            The AI writes a quick-reference card grounded in the real Ethiopian
            curriculum for your chosen subject and grade. Original wording — never
            copied from any reference material.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Subject</span>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger className="h-10 rounded-xl bg-white/5">
                <SelectValue placeholder="Pick a subject" />
              </SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s._id} value={s._id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Grade</span>
            <Select value={gradeLevel} onValueChange={setGradeLevel}>
              <SelectTrigger className="h-10 rounded-xl bg-white/5">
                <SelectValue placeholder="Pick a grade" />
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
            <span className="text-[11px] font-semibold text-muted-foreground">
              Topic (optional — leave empty for a general card)
            </span>
            <input
              type="text"
              value={topicName}
              onChange={(e) => setTopicName(e.target.value)}
              placeholder="e.g. Photosynthesis, Integration by substitution"
              className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm outline-none focus:border-amber-400/40"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="cursor-pointer rounded-xl" onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Sparkles className="size-4" /> Generate card
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
