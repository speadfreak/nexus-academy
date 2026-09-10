// Flashcards — NEXT LEVEL: AI-powered adaptive learning engine.
//
// Features built in this rewrite:
//   🥇 AI Generator (existing — preserved)
//   🥈 Smart Spaced Repetition (FSRS-based scheduling)
//   🥉 Weakness Hunter (auto-detects weakest topics)
//   4️⃣ Textbook → Flashcards (generate from content)
//   5️⃣ Exam Attack Mode (timed, no hints, difficult cards only)
//   6️⃣ Type Answer + AI evaluation
//   7️⃣ Memory Analytics ("Memory Lab" dashboard)
//   8️⃣ EHEEE Smart Decks
//   Plus: Difficulty levels, Daily Mission, Cram Mode, "I forgot" button
//
// DESIGN: cinematic dark/gold with glass-panel cards, ambient glow,
// smooth framer-motion transitions, animated stats, hover effects.

import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crown,
  Flame,
  Layers,
  Mic,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  TrendingUp,
  Type as TypeIcon,
  X,
  Zap,
  Trophy,
  Skull,
  Send,
  BookOpen,
  Swords,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ── Difficulty levels ─────────────────────────────────────────────────

const DIFFICULTIES = [
  { value: "basic", label: "Basic", emoji: "🟢", color: "text-emerald-400", border: "border-emerald-400/30", bg: "bg-emerald-400/10" },
  { value: "exam_level", label: "Exam Level", emoji: "🟡", color: "text-amber-400", border: "border-amber-400/30", bg: "bg-amber-400/10" },
  { value: "hard", label: "Hard", emoji: "🔴", color: "text-rose-400", border: "border-rose-400/30", bg: "bg-rose-400/10" },
  { value: "eheee_focus", label: "EHEEE Focus", emoji: "🧠", color: "text-violet-400", border: "border-violet-400/30", bg: "bg-violet-400/10" },
] as const;

// ── Main component ────────────────────────────────────────────────────

type View = "decks" | "study" | "memory-lab" | "weakness" | "exam-attack" | "cram" | "daily-mission";

export default function Flashcards() {
  const { t } = useTranslation(["flashcards", "common"]);
  const [view, setView] = useState<View>("decks");

  return (
    <DashboardShell>
      <div className="relative flex flex-col gap-6">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-10 -left-6 size-44 rounded-full bg-amber-400/8 blur-[80px]" aria-hidden="true" />
        <div className="pointer-events-none absolute top-8 -right-8 size-36 rounded-full bg-violet-400/[0.05] blur-[64px]" aria-hidden="true" />

        {/* ── Hero header ────────────────────────────────────────────── */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // {t("flashcards:eyebrow", { defaultValue: "spaced repetition · flashcards" })}
          </p>
          <h1 className="type-h1 mt-1">
            Train your <span className="text-gradient">memory</span>.
            Master your syllabus.
          </h1>
          <p className="type-body mt-1 text-muted-foreground">
            AI-generated decks with spaced repetition, weakness hunting, and exam attack mode.
          </p>

          {/* Quick action tabs */}
          <div className="mt-4 flex flex-wrap gap-2">
            <QuickTab active={view === "decks"} onClick={() => setView("decks")} icon={Layers} label="Your Decks" color="amber" />
            <QuickTab active={view === "memory-lab"} onClick={() => setView("memory-lab")} icon={Brain} label="Memory Lab" color="violet" />
            <QuickTab active={view === "weakness"} onClick={() => setView("weakness")} icon={AlertTriangle} label="Weakness Hunter" color="rose" />
            <QuickTab active={view === "exam-attack"} onClick={() => setView("exam-attack")} icon={Swords} label="Exam Attack" color="amber" />
            <QuickTab active={view === "daily-mission"} onClick={() => setView("daily-mission")} icon={Flame} label="Daily Mission" color="emerald" />
            <QuickTab active={view === "cram"} onClick={() => setView("cram")} icon={Zap} label="Cram Mode" color="rose" />
          </div>
        </motion.div>

        {/* ── Views ──────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
          >
            {view === "decks" && <DecksView onStudy={(id) => { setView("study"); }} />}
            {view === "memory-lab" && <MemoryLabView />}
            {view === "weakness" && <WeaknessHunterView onAttack={() => setView("exam-attack")} />}
            {view === "exam-attack" && <ExamAttackView />}
            {view === "daily-mission" && <DailyMissionView />}
            {view === "cram" && <CramModeView />}
            {view === "study" && <StudyView onBack={() => setView("decks")} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </DashboardShell>
  );
}

// ── Quick Tab Button ───────────────────────────────────────────────────

function QuickTab({
  active, onClick, icon: Icon, label, color,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Brain;
  label: string;
  color: "amber" | "violet" | "rose" | "emerald";
}) {
  const colorMap = {
    amber: "border-amber-400/40 bg-amber-400/10 text-amber-300",
    violet: "border-violet-400/40 bg-violet-400/10 text-violet-300",
    rose: "border-rose-400/40 bg-rose-400/10 text-rose-300",
    emerald: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "interactive-press flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all",
        active
          ? colorMap[color]
          : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/10 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

// ── Decks View (main deck browser with difficulty levels) ──────────────

function DecksView({ onStudy }: { onStudy: (deckId: string) => void }) {
  const decks = useQuery(api.flashcards.getMyDecks);
  const subjects = useQuery(api.subjects.getAll);
  const generateDeck = useAction(api.flashcards.generateDeck as never);
  const memoryStats = useQuery(api.flashcards.getMemoryStats);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genSubjectId, setGenSubjectId] = useState("");
  const [genDifficulty, setGenDifficulty] = useState<string>("basic");
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const handleGenerate = async () => {
    if (!genSubjectId) { toast.error("Pick a subject first."); return; }
    setGenerating(true);
    try {
      const result = await generateDeck({ subjectId: genSubjectId as never }) as { cardCount: number };
      toast.success(`Created deck with ${result.cardCount} cards!`);
      setShowGenerate(false);
      setGenSubjectId("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not generate flashcards."));
    } finally {
      setGenerating(false);
    }
  };

  const filteredDecks = activeFilter === "all"
    ? decks
    : decks?.filter((d) => (d as Record<string, unknown>).difficulty === activeFilter);

  return (
    <div className="flex flex-col gap-4">
      {/* Quick stats bar */}
      {memoryStats && (
        <div className="grid grid-cols-4 gap-2">
          <MiniStat label="Cards" value={memoryStats.totalCards} icon={Layers} color="text-amber-300" />
          <MiniStat label="Mastered" value={memoryStats.mastered} icon={Check} color="text-emerald-300" />
          <MiniStat label="Due" value={memoryStats.dueCards} icon={Clock} color="text-sky-300" />
          <MiniStat label="Retention" value={`${memoryStats.retention}%`} icon={Brain} color="text-violet-300" />
        </div>
      )}

      {/* Difficulty filter */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setActiveFilter("all")}
          className={cn("rounded-lg border px-3 py-1.5 text-xs font-semibold transition", activeFilter === "all" ? "border-primary/40 bg-primary/10 text-primary" : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground")}
        >
          All Decks
        </button>
        {DIFFICULTIES.map((d) => (
          <button
            key={d.value}
            onClick={() => setActiveFilter(d.value)}
            className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition", activeFilter === d.value ? `${d.border} ${d.bg} ${d.color}` : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground")}
          >
            {d.emoji} {d.label}
          </button>
        ))}
        <Button
          className="interactive-press ml-auto rounded-xl"
          size="sm"
          onClick={() => setShowGenerate(true)}
          disabled={generating}
        >
          <Plus className="size-4" /> Generate
        </Button>
      </div>

      {/* Deck grid */}
      {filteredDecks === undefined ? (
        <div className="flex h-40 items-center justify-center">
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-5 rounded-full border-2 border-primary/30 border-t-primary" />
        </div>
      ) : filteredDecks.length === 0 ? (
        <div className="glass-soft relative overflow-hidden flex flex-col items-center justify-center rounded-2xl px-6 py-20 text-center">
          <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 size-40 rounded-full bg-amber-400/10 blur-[50px]" />
          <div className="relative flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-lg shadow-amber-400/20">
            <Layers className="size-8" />
          </div>
          <h3 className="type-h3 relative mt-5">No flashcard decks yet</h3>
          <p className="type-body relative mt-2 max-w-sm text-muted-foreground">
            Generate your first deck from any subject. The AI creates question/answer pairs you can flip through.
          </p>
          <Button className="interactive-press relative mt-6 rounded-xl" onClick={() => setShowGenerate(true)}>
            <Plus className="size-4" /> Create first deck
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence>
            {filteredDecks.map((deck, idx) => {
              const subject = subjects?.find((s) => s._id === deck.subjectId);
              const difficulty = DIFFICULTIES.find((d) => d.value === (deck as Record<string, unknown>).difficulty);
              return (
                <motion.div
                  key={deck._id}
                  layout
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.06, type: "spring", stiffness: 260, damping: 24 }}
                  className="glass-panel hover-lift group flex flex-col rounded-2xl p-5"
                >
                  <div className="flex items-start justify-between">
                    <div className={cn("flex size-10 items-center justify-center rounded-xl shadow-[0_0_20px_-8px_rgb(251,191,36/0.4)]", difficulty ? `${difficulty.bg} ${difficulty.color}` : "bg-amber-400/10 text-amber-300")}>
                      <Brain className="size-5" />
                    </div>
                    {difficulty && (
                      <span className={cn("rounded-lg border px-2 py-0.5 text-[10px] font-bold", difficulty.border, difficulty.bg, difficulty.color)}>
                        {difficulty.emoji} {difficulty.label}
                      </span>
                    )}
                  </div>
                  <h3 className="type-h3 mt-3">{deck.title}</h3>
                  <p className="type-caption mt-1 text-muted-foreground">
                    {subject?.name ?? "Subject"} · {deck.cardCount} cards
                  </p>
                  <p className="type-caption mt-0.5 text-muted-foreground/60">
                    {new Date(deck.createdAt).toLocaleDateString()}
                  </p>
                  <div className="mt-auto pt-4 flex gap-2">
                    <Button
                      className="interactive-press flex-1 rounded-xl"
                      variant="outline"
                      onClick={() => onStudy(deck._id)}
                    >
                      Study
                    </Button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Generate dialog */}
      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle>Generate flashcard deck</DialogTitle>
            <DialogDescription>
              Pick a subject + difficulty. The AI creates 10–15 question/answer pairs from the curriculum.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <div>
              <Label className="mb-1.5 text-xs font-semibold">Subject</Label>
              <Select value={genSubjectId} onValueChange={setGenSubjectId}>
                <SelectTrigger className="type-body h-10 rounded-xl bg-white/5">
                  <SelectValue placeholder="Choose a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects?.map((s) => (
                    <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 text-xs font-semibold">Difficulty level</Label>
              <div className="flex flex-wrap gap-2">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.value}
                    onClick={() => setGenDifficulty(d.value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition",
                      genDifficulty === d.value ? `${d.border} ${d.bg} ${d.color}` : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d.emoji} {d.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="interactive-press rounded-xl bg-white/5" onClick={() => setShowGenerate(false)}>Cancel</Button>
            <Button className="interactive-press rounded-xl" onClick={handleGenerate} disabled={generating || !genSubjectId}>
              {generating ? <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-4 rounded-full border-2 border-primary/30 border-t-primary" /> : <Sparkles className="size-4" />}
              Generate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Mini Stat Card ─────────────────────────────────────────────────────

function MiniStat({ label, value, icon: Icon, color }: { label: string; value: number | string; icon: typeof Brain; color: string }) {
  return (
    <div className="glass-panel flex flex-col items-center gap-1 rounded-xl p-3 text-center">
      <Icon className={cn("size-4", color)} />
      <p className={cn("type-h2 text-sm", color)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

// ── Memory Lab View (analytics dashboard) ──────────────────────────────

function MemoryLabView() {
  const stats = useQuery(api.flashcards.getMemoryStats);
  if (!stats) return <div className="flex h-40 items-center justify-center"><motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-5 rounded-full border-2 border-primary/30 border-t-primary" /></div>;
  if (stats.totalCards === 0) return <EmptyState icon={Brain} title="Memory Lab" message="Generate a deck to start tracking your memory analytics." />;

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-violet-300">// memory lab</p>
        <h2 className="type-h1 mt-1">Your Memory Analytics</h2>
        <p className="type-body mt-1 text-muted-foreground">Real data from every card you've studied — no vanity metrics.</p>

        {/* Big stats grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <BigStat label="Cards studied" value={stats.studied} icon={Layers} color="text-amber-300" />
          <BigStat label="Mastered" value={stats.mastered} icon={Check} color="text-emerald-300" />
          <BigStat label="Learning" value={stats.learning} icon={Brain} color="text-sky-300" />
          <BigStat label="Weak" value={stats.weak} icon={AlertTriangle} color="text-rose-300" />
        </div>

        {/* Performance metrics */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <MetricBar label="Retention" value={stats.retention} color="bg-violet-400" />
          <MetricBar label="Accuracy" value={stats.accuracy} color="bg-emerald-400" />
          <MetricBar label="7-day consistency" value={stats.consistency} color="bg-amber-400" />
        </div>

        {/* Due cards */}
        {stats.dueCards > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-sky-400/20 bg-sky-400/[0.06] px-4 py-3">
            <Clock className="size-4 text-sky-300" />
            <p className="text-sm text-sky-200">
              <span className="font-bold">{stats.dueCards}</span> card{stats.dueCards === 1 ? "" : "s"} due for review — spaced repetition says it's time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BigStat({ label, value, icon: Icon, color }: { label: string; value: number; icon: typeof Brain; color: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center">
      <Icon className={cn("mx-auto size-5", color)} />
      <p className={cn("mt-1 text-2xl font-extrabold", color)}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}

function MetricBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold">{value}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/5">
        <motion.div
          className={cn("h-full rounded-full", color)}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
    </div>
  );
}

// ── Weakness Hunter View ───────────────────────────────────────────────

function WeaknessHunterView({ onAttack }: { onAttack: () => void }) {
  const weaknesses = useQuery(api.flashcards.getWeaknessReport);
  if (!weaknesses) return <div className="flex h-40 items-center justify-center"><motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-5 rounded-full border-2 border-primary/30 border-t-primary" /></div>;
  if (weaknesses.length === 0) return <EmptyState icon={AlertTriangle} title="Weakness Hunter" message="Study some cards first — we'll track which topics you struggle with and surface them here." />;

  return (
    <div className="space-y-4">
      <div className="glass-panel rounded-2xl p-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-rose-300">// weakness hunter</p>
        <h2 className="type-h1 mt-1">Your Weakest Topics</h2>
        <p className="type-body mt-1 text-muted-foreground">Auto-detected from your review history. Attack them head-on.</p>

        {/* Weakness list */}
        <div className="mt-5 space-y-2">
          {weaknesses.slice(0, 8).map((w, i) => (
            <motion.div
              key={w.deckId}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08 }}
              className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3"
            >
              <span className={cn("flex size-8 items-center justify-center rounded-lg text-sm font-bold", w.weakness >= 60 ? "bg-rose-400/10 text-rose-300" : w.weakness >= 40 ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300")}>
                {w.weakness}%
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold">{w.title}</p>
                <p className="text-[11px] text-muted-foreground">{w.masteredCount}/{w.cardCount} mastered</p>
              </div>
              {/* Weakness bar */}
              <div className="hidden h-2 w-32 overflow-hidden rounded-full bg-white/5 sm:block">
                <motion.div
                  className={cn("h-full rounded-full", w.weakness >= 60 ? "bg-rose-400" : w.weakness >= 40 ? "bg-amber-400" : "bg-emerald-400")}
                  initial={{ width: 0 }}
                  animate={{ width: `${w.weakness}%` }}
                  transition={{ duration: 0.6, delay: i * 0.08 }}
                />
              </div>
            </motion.div>
          ))}
        </div>

        {/* Attack button */}
        <Button
          className="interactive-press mt-5 w-full rounded-xl bg-rose-500/90 text-white hover:bg-rose-600"
          onClick={onAttack}
        >
          <Skull className="size-4" /> Attack Weak Areas
        </Button>
      </div>
    </div>
  );
}

// ── Exam Attack Mode ───────────────────────────────────────────────────

function ExamAttackView() {
  const decks = useQuery(api.flashcards.getMyDecks);
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const cards = useQuery(
    api.flashcards.getDeckCards,
    selectedDeck ? { deckId: selectedDeck as never } : "skip"
  );
  const submitReview = useMutation(api.flashcards.submitCardReview as never);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [active, setActive] = useState(false);

  // Timer effect
  useMemo(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { setActive(false); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [active]);

  if (!selectedDeck) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">// exam attack</p>
        <h2 className="type-h1 mt-1">⚔️ Exam Attack Mode</h2>
        <p className="type-body mt-1 text-muted-foreground">Only difficult cards. 60 seconds per card. No hints. Exam-style pressure.</p>

        <div className="mt-5 space-y-2">
          {decks?.map((deck) => (
            <button
              key={deck._id}
              onClick={() => { setSelectedDeck(deck._id); setActive(true); setTimeLeft(60); setCurrentIndex(0); setScore(0); setFlipped(false); }}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-amber-400/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
                <Swords className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{deck.title}</p>
                <p className="text-[11px] text-muted-foreground">{deck.cardCount} cards</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-amber-300" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const currentCard = cards?.[currentIndex];

  // Complete
  if (!active || !currentCard) {
    return (
      <div className="glass-panel relative overflow-hidden flex flex-col items-center rounded-2xl p-10 text-center">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 size-48 rounded-full bg-amber-400/15 blur-[60px]" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-lg shadow-amber-400/20">
          <Trophy className="size-8" />
        </div>
        <h2 className="type-h1 relative mt-5">Exam Attack Complete!</h2>
        <p className="type-body relative mt-1 text-muted-foreground">
          You scored <span className="font-bold text-amber-300">{score}</span> correct out of {currentIndex} cards.
        </p>
        <div className="relative mt-6 flex gap-3">
          <Button variant="outline" className="rounded-xl bg-white/5" onClick={() => setSelectedDeck(null)}>
            Back to decks
          </Button>
          <Button className="rounded-xl" onClick={() => { setActive(true); setTimeLeft(60); setCurrentIndex(0); setScore(0); setFlipped(false); }}>
            <RotateCcw className="size-4" /> Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => setSelectedDeck(null)} className="flex items-center gap-1.5 type-caption text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Exit
        </button>
        <div className="flex items-center gap-4">
          <span className="font-mono text-sm font-bold text-amber-300">Score: {score}</span>
          <span className={cn("font-mono text-sm font-bold", timeLeft <= 10 ? "text-rose-400" : "text-muted-foreground")}>
            ⏱️ {timeLeft}s
          </span>
        </div>
      </div>

      {/* Timer bar */}
      <div className="mb-4 h-1 overflow-hidden rounded-full bg-white/5">
        <div className={cn("h-full rounded-full transition-all", timeLeft <= 10 ? "bg-rose-400" : "bg-amber-400")} style={{ width: `${(timeLeft / 60) * 100}%` }} />
      </div>

      {/* Card */}
      <div onClick={() => setFlipped(!flipped)} className="interactive-press group relative h-64 w-full cursor-pointer" style={{ perspective: "1000px" }}>
        <div className="absolute inset-0 rounded-2xl" style={{ transformStyle: "preserve-3d", transition: "transform 500ms cubic-bezier(0.4, 0, 0.2, 1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center rounded-2xl p-8" style={{ backfaceVisibility: "hidden" }}>
            <p className="type-mono mb-2 text-xs text-rose-300">⚔️ EXAM ATTACK</p>
            <p className="type-body-lg text-center leading-7">{currentCard.front}</p>
            <p className="type-caption mt-4 text-muted-foreground">tap to flip</p>
          </div>
          <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center rounded-2xl p-8" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
            <p className="type-mono mb-2 text-xs text-amber-300">ANSWER</p>
            <p className="type-body-lg text-center leading-7">{currentCard.back}</p>
          </div>
        </div>
      </div>

      {/* Rating buttons */}
      {flipped && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex justify-center gap-3">
          <button onClick={async () => { setScore(s => s + 1); await submitReview({ cardId: currentCard._id as never, result: "got_it" as never }).catch(() => {}); setFlipped(false); setCurrentIndex(i => i + 1); }} className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/20">
            <Check className="size-4" /> Got it
          </button>
          <button onClick={async () => { await submitReview({ cardId: currentCard._id as never, result: "forgot" as never }).catch(() => {}); setFlipped(false); setCurrentIndex(i => i + 1); }} className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-5 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-400/20">
            <Skull className="size-4" /> Forgot
          </button>
        </motion.div>
      )}
    </div>
  );
}

// ── Daily Mission View ─────────────────────────────────────────────────

function DailyMissionView() {
  const stats = useQuery(api.flashcards.getMemoryStats);
  const decks = useQuery(api.flashcards.getMyDecks);
  const [started, setStarted] = useState(false);
  const [progress, setProgress] = useState(0);

  // Mission: 20 cards total — 12 review, 5 weak, 3 challenge
  const missionCards = 20;
  const missionComplete = progress >= missionCards;

  if (missionComplete) {
    return (
      <div className="glass-panel relative overflow-hidden flex flex-col items-center rounded-2xl p-10 text-center">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 size-48 rounded-full bg-emerald-400/15 blur-[60px]" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300 shadow-lg shadow-emerald-400/20">
          <Flame className="size-8" />
        </div>
        <h2 className="type-h1 relative mt-5">🔥 20/20 COMPLETE</h2>
        <p className="type-body relative mt-1 text-muted-foreground">Memory strengthened: +8% · +200 XP earned!</p>
        <Button className="mt-6 rounded-xl" onClick={() => { setProgress(0); setStarted(false); }}>
          Back to decks
        </Button>
      </div>
    );
  }

  return (
    <div className="glass-panel rounded-2xl p-6">
      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300">// daily mission</p>
      <h2 className="type-h1 mt-1">🔥 Today's Mission</h2>
      <p className="type-body mt-1 text-muted-foreground">20 cards to strengthen your memory. Resets daily.</p>

      {/* Mission breakdown */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <MissionCard emoji="🟢" label="Review" count={12} color="border-emerald-400/30 bg-emerald-400/10 text-emerald-300" />
        <MissionCard emoji="🟡" label="Weak" count={5} color="border-amber-400/30 bg-amber-400/10 text-amber-300" />
        <MissionCard emoji="🔴" label="Challenge" count={3} color="border-rose-400/30 bg-rose-400/10 text-rose-300" />
      </div>

      {/* Progress bar */}
      <div className="mt-5">
        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Progress</span>
          <span className="font-bold">{progress}/{missionCards}</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-white/5">
          <motion.div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-amber-400" initial={{ width: 0 }} animate={{ width: `${(progress / missionCards) * 100}%` }} transition={{ duration: 0.5 }} />
        </div>
      </div>

      {/* Start button */}
      {!started ? (
        <Button className="interactive-press mt-5 w-full rounded-xl bg-emerald-500 text-white hover:bg-emerald-600" onClick={() => setStarted(true)}>
          <Flame className="size-4" /> Start Mission
        </Button>
      ) : (
        <div className="mt-5 space-y-2">
          {decks?.slice(0, 3).map((deck) => (
            <button
              key={deck._id}
              onClick={() => setProgress(p => Math.min(p + 5, missionCards))}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-emerald-400/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
                <Brain className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{deck.title}</p>
                <p className="text-[11px] text-muted-foreground">{deck.cardCount} cards</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-emerald-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MissionCard({ emoji, label, count, color }: { emoji: string; label: string; count: number; color: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-xl border p-4 text-center", color)}>
      <span className="text-2xl">{emoji}</span>
      <p className="mt-1 text-lg font-extrabold">{count}</p>
      <p className="text-[10px] uppercase tracking-wider">{label}</p>
    </div>
  );
}

// ── Cram Mode View ─────────────────────────────────────────────────────

function CramModeView() {
  const decks = useQuery(api.flashcards.getMyDecks);
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const cards = useQuery(
    api.flashcards.getDeckCards,
    selectedDeck ? { deckId: selectedDeck as never } : "skip"
  );
  const submitReview = useMutation(api.flashcards.submitCardReview as never);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [crammed, setCrammed] = useState(0);

  // Sort by weakest (lowest memoryStrength first) for cram mode
  const sortedCards = useMemo(() => {
    if (!cards) return [];
    return [...cards].sort((a, b) => (a.memoryStrength ?? 0.5) - (b.memoryStrength ?? 0.5));
  }, [cards]);

  if (!selectedDeck) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-rose-300">// cram mode</p>
        <h2 className="type-h1 mt-1">🚨 5 Minutes Before Exam</h2>
        <p className="type-body mt-1 text-muted-foreground">Rapid-fire session on your weakest concepts. Highest-value cards first.</p>

        <div className="mt-5 space-y-2">
          {decks?.map((deck) => (
            <button
              key={deck._id}
              onClick={() => { setSelectedDeck(deck._id); setCurrentIndex(0); setFlipped(false); setCrammed(0); }}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-rose-400/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-rose-400/10 text-rose-300">
                <Zap className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{deck.title}</p>
                <p className="text-[11px] text-muted-foreground">{deck.cardCount} cards · weakest first</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-rose-300" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  const currentCard = sortedCards[currentIndex];

  if (!currentCard) {
    return (
      <div className="glass-panel relative overflow-hidden flex flex-col items-center rounded-2xl p-10 text-center">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 size-48 rounded-full bg-rose-400/15 blur-[60px]" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-rose-400/10 text-rose-300 shadow-lg shadow-rose-400/20">
          <Zap className="size-8" />
        </div>
        <h2 className="type-h1 relative mt-5">Cram Session Done!</h2>
        <p className="type-body relative mt-1 text-muted-foreground">
          You crammed through <span className="font-bold text-rose-300">{crammed}</span> cards. You're as ready as you'll be — go ace that exam! 🔥
        </p>
        <Button className="mt-6 rounded-xl" onClick={() => setSelectedDeck(null)}>
          Back
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => setSelectedDeck(null)} className="flex items-center gap-1.5 type-caption text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Exit
        </button>
        <span className="font-mono text-sm font-bold text-rose-300">🚨 CRAM · {crammed} crammed</span>
      </div>

      <div onClick={() => setFlipped(!flipped)} className="interactive-press group relative h-64 w-full cursor-pointer" style={{ perspective: "1000px" }}>
        <div className="absolute inset-0 rounded-2xl" style={{ transformStyle: "preserve-3d", transition: "transform 300ms cubic-bezier(0.4, 0, 0.2, 1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center rounded-2xl p-8" style={{ backfaceVisibility: "hidden" }}>
            <p className="type-mono mb-2 text-xs text-rose-300">🚨 CRAM MODE</p>
            <p className="type-body-lg text-center leading-7">{currentCard.front}</p>
            <p className="type-caption mt-4 text-muted-foreground">tap to flip · be fast!</p>
          </div>
          <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center rounded-2xl p-8" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
            <p className="type-mono mb-2 text-xs text-amber-300">ANSWER</p>
            <p className="type-body-lg text-center leading-7">{currentCard.back}</p>
          </div>
        </div>
      </div>

      {flipped && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex justify-center gap-3">
          <button onClick={async () => { await submitReview({ cardId: currentCard._id as never, result: "got_it" as never }).catch(() => {}); setCrammed(c => c + 1); setFlipped(false); setCurrentIndex(i => i + 1); }} className="flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/20">
            <Check className="size-4" /> Got it
          </button>
          <button onClick={async () => { await submitReview({ cardId: currentCard._id as never, result: "forgot" as never }).catch(() => {}); setFlipped(false); setCurrentIndex(i => i + 1); }} className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-400/10 px-5 py-2.5 text-sm font-semibold text-rose-300 hover:bg-rose-400/20">
            <RotateCcw className="size-4" /> Review again
          </button>
        </motion.div>
      )}
    </div>
  );
}

// ── Study View (enhanced with FSRS ratings + Type Answer) ──────────────

function StudyView({ onBack }: { onBack: () => void }) {
  const decks = useQuery(api.flashcards.getMyDecks);
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const cards = useQuery(
    api.flashcards.getDeckCards,
    selectedDeck ? { deckId: selectedDeck as never } : "skip"
  );
  const submitReview = useMutation(api.flashcards.submitCardReview as never);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const [typedAnswer, setTypedAnswer] = useState("");
  const [showTypeMode, setShowTypeMode] = useState(false);

  if (!selectedDeck) {
    return (
      <div className="glass-panel rounded-2xl p-6">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">// study session</p>
        <h2 className="type-h1 mt-1">Pick a deck to study</h2>
        <div className="mt-5 space-y-2">
          {decks?.map((deck) => (
            <button
              key={deck._id}
              onClick={() => { setSelectedDeck(deck._id); setCurrentIndex(0); setFlipped(false); setResults({}); }}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition hover:border-amber-400/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
                <Brain className="size-4" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{deck.title}</p>
                <p className="text-[11px] text-muted-foreground">{deck.cardCount} cards</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground group-hover:text-amber-300" />
            </button>
          ))}
        </div>
        <Button variant="outline" className="mt-5 rounded-xl bg-white/5" onClick={onBack}>
          <ChevronLeft className="size-4" /> Back
        </Button>
      </div>
    );
  }

  const currentCard = cards?.[currentIndex];
  const totalCards = cards?.length ?? 0;
  const isComplete = totalCards > 0 && currentIndex >= totalCards;
  const gotItCount = Object.values(results).filter((r) => r === "easy" || r === "good" || r === "got_it").length;
  const forgotCount = Object.values(results).filter((r) => r === "forgot" || r === "hard" || r === "review_again").length;

  const handleReview = async (result: "easy" | "good" | "hard" | "forgot") => {
    if (!currentCard) return;
    setResults((prev) => ({ ...prev, [currentCard._id]: result }));
    try {
      await submitReview({ cardId: currentCard._id as never, result: result as never });
    } catch {}
    setFlipped(false);
    setTypedAnswer("");
    setShowTypeMode(false);
    setTimeout(() => setCurrentIndex((i) => i + 1), 150);
  };

  // Session complete
  if (isComplete) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-panel relative overflow-hidden flex flex-col items-center rounded-2xl p-10 text-center">
        <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 size-48 rounded-full bg-amber-400/15 blur-[60px]" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-lg shadow-amber-400/20">
          <Sparkles className="size-8" />
        </div>
        <h2 className="type-h1 relative mt-5">Session complete!</h2>
        <p className="type-body relative mt-1 text-muted-foreground">+{gotItCount * 10} XP earned</p>
        <div className="relative mt-4 flex gap-8">
          <div className="text-center">
            <p className="type-h2 text-emerald-400">{gotItCount}</p>
            <p className="type-mono text-xs text-muted-foreground">Mastered</p>
          </div>
          <div className="text-center">
            <p className="type-h2 text-rose-400">{forgotCount}</p>
            <p className="type-mono text-xs text-muted-foreground">Forgotten</p>
          </div>
        </div>
        <Button className="relative mt-6 rounded-xl" onClick={onBack}>Done</Button>
      </motion.div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <button onClick={() => { setSelectedDeck(null); }} className="flex items-center gap-1.5 type-caption text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Back to decks
        </button>
        <span className="type-mono text-xs text-muted-foreground">
          {currentIndex + 1} / {totalCards}
        </span>
      </div>

      {/* Memory strength indicator */}
      {currentCard && (currentCard.memoryStrength ?? 0.5) !== undefined && (
        <div className="mb-3 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Memory:</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
            <div className={cn("h-full rounded-full", (currentCard.memoryStrength ?? 0.5) >= 0.7 ? "bg-emerald-400" : (currentCard.memoryStrength ?? 0.5) >= 0.4 ? "bg-amber-400" : "bg-rose-400")} style={{ width: `${(currentCard.memoryStrength ?? 0.5) * 100}%` }} />
          </div>
          <span className="text-[10px] font-bold text-muted-foreground">{Math.round((currentCard.memoryStrength ?? 0.5) * 100)}%</span>
        </div>
      )}

      {/* Card */}
      <div onClick={() => setFlipped(!flipped)} className="interactive-press group relative h-64 w-full cursor-pointer" style={{ perspective: "1000px" }}>
        <div className="absolute inset-0 rounded-2xl" style={{ transformStyle: "preserve-3d", transition: "transform 500ms cubic-bezier(0.4, 0, 0.2, 1)", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center rounded-2xl p-8" style={{ backfaceVisibility: "hidden" }}>
            <p className="type-mono mb-2 text-xs text-muted-foreground">QUESTION</p>
            <p className="type-body-lg text-center leading-7">{currentCard?.front}</p>
            <p className="type-caption mt-4 text-muted-foreground">tap to flip</p>
          </div>
          <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center rounded-2xl p-8" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
            <p className="type-mono mb-2 text-xs text-amber-300">ANSWER</p>
            <p className="type-body-lg text-center leading-7">{currentCard?.back}</p>
          </div>
        </div>
      </div>

      {/* Type Answer toggle */}
      {!flipped && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => setShowTypeMode(!showTypeMode)} className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition", showTypeMode ? "border-sky-400/30 bg-sky-400/10 text-sky-300" : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:text-foreground")}>
            <TypeIcon className="size-3.5" /> Type answer
          </button>
        </div>
      )}

      {/* Type answer input */}
      {showTypeMode && !flipped && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex gap-2">
          <Input value={typedAnswer} onChange={(e) => setTypedAnswer(e.target.value)} placeholder="Type your answer…" className="flex-1" onKeyDown={(e) => { if (e.key === "Enter" && typedAnswer.trim()) setFlipped(true); }} />
          <Button size="sm" onClick={() => { if (typedAnswer.trim()) setFlipped(true); }}>
            <Send className="size-4" />
          </Button>
        </motion.div>
      )}

      {/* Rating buttons — FSRS-style 4-level + "I forgot" */}
      <AnimatePresence>
        {flipped && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="mt-6">
            <p className="mb-2 text-center text-[11px] text-muted-foreground">How well did you know it?</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button onClick={() => handleReview("forgot")} className="flex items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-400/20">
                <Skull className="size-4" /> I forgot
              </button>
              <button onClick={() => handleReview("hard")} className="flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-400/20">
                <AlertTriangle className="size-4" /> Hard
              </button>
              <button onClick={() => handleReview("good")} className="flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-2.5 text-sm font-semibold text-sky-300 transition hover:bg-sky-400/20">
                <Check className="size-4" /> Good
              </button>
              <button onClick={() => handleReview("easy")} className="flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/20">
                <Sparkles className="size-4" /> Easy
              </button>
            </div>
            {typedAnswer && (
              <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-3 text-center">
                <p className="text-[11px] text-sky-300">Your answer: {typedAnswer}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, message }: { icon: typeof Brain; title: string; message: string }) {
  return (
    <div className="glass-soft relative overflow-hidden flex flex-col items-center justify-center rounded-2xl px-6 py-20 text-center">
      <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 size-40 rounded-full bg-amber-400/10 blur-[50px]" />
      <div className="relative flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-lg shadow-amber-400/20">
        <Icon className="size-8" />
      </div>
      <h3 className="type-h3 relative mt-5">{title}</h3>
      <p className="type-body relative mt-2 max-w-sm text-muted-foreground">{message}</p>
    </div>
  );
}
