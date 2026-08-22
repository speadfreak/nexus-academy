import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  CheckCircle2,
  Flame,
  History,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Star,
  Timer,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { QuizFlow } from "@/components/QuizFlow";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatClock, localDateKey } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useMusic } from "@/components/music-player";

const PRESETS = [
  { label: "25 min", minutes: 25 },
  { label: "50 min", minutes: 50 },
];

type TimerStatus = "idle" | "running" | "paused" | "done" | "celebrating";

export default function Focus() {
  const subjects = useQuery(api.subjects.getAll);
  const history = useQuery(api.studySessions.getHistory);
  const logSession = useMutation(api.studySessions.logSession);
  const generateRecap = useAction(api.recap.generateRecap);
  const [recapText, setRecapText] = useState<string | null>(null);
  const music = useMusic();

  const [subjectId, setSubjectId] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState("");
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [remaining, setRemaining] = useState(25 * 60);
  const [logging, setLogging] = useState(false);
  const [quizPromptOpen, setQuizPromptOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [sessionResult, setSessionResult] = useState<{
    xpAwarded: number;
    levelUp: boolean;
    newLevel: number;
    newAchievements: { name: string }[];
  } | null>(null);

  const startedAtRef = useRef<number>(0);
  const loggedRef = useRef(false);

  const isLowTime = status === "running" && remaining <= 60 && remaining > 0;

  useEffect(() => {
    if (status === "idle") setRemaining(minutes * 60);
  }, [minutes, status]);

  useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setStatus("done");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Persist the completed session
  useEffect(() => {
    if (status !== "done") return;
    if (loggedRef.current) return;
    if (!subjectId) {
      toast.error("Pick a subject to log this session.");
      setStatus("idle");
      setRemaining(minutes * 60);
      return;
    }
    loggedRef.current = true;
    const durationSeconds = minutes * 60;
    setLogging(true);
    logSession({
      subjectId: subjectId as never,
      durationSeconds,
      startedAt: startedAtRef.current || Date.now(),
      endedAt: Date.now(),
      localDate: localDateKey(),
    })
      .then((result) => {
        // Show the celebration state with XP right in the timer ring
        setSessionResult({
          xpAwarded: result.xpAwarded ?? 0,
          levelUp: result.levelUp ?? false,
          newLevel: result.newLevel ?? 0,
          newAchievements: result.newAchievements ?? [],
        });
        setStatus("celebrating");

        // Background toasts for achievements
        if (result.xpAwarded > 0) {
          toast.success(`+${result.xpAwarded} XP earned.`);
        }
        if (result.levelUp) {
          toast.success(`Level up — you're now level ${result.newLevel}.`);
        }
        for (const achievement of result.newAchievements) {
          toast.success(`Achievement unlocked: ${achievement.name}`);
        }

        // Generate a study recap
        generateRecap({ type: "focus_session" })
          .then((r) => { if (r.text) setRecapText(r.text); })
          .catch(() => {});

        // Auto-dismiss celebration after 4s
        setTimeout(() => {
          setSessionResult(null);
          setStatus("idle");
          setRemaining(minutes * 60);
          setQuizPromptOpen(true);
        }, 4000);
      })
      .catch((error) => {
        toast.error(errorMessage(error, "Could not log the session."));
        setStatus("idle");
        setRemaining(minutes * 60);
      })
      .finally(() => {
        loggedRef.current = false;
        setLogging(false);
      });
  }, [status, subjectId, minutes, logSession, generateRecap]);

  const handleStart = () => {
    if (!subjectId) {
      toast.error("Choose a subject before starting.");
      return;
    }
    loggedRef.current = false;
    setSessionResult(null);
    startedAtRef.current = Date.now();
    setStatus("running");
  };

  const handlePause = () => setStatus((s) => (s === "running" ? "paused" : "running"));
  const handleReset = () => {
    setStatus("idle");
    setRemaining(minutes * 60);
    setSessionResult(null);
  };

  const applyPreset = (value: number) => {
    if (status !== "idle") return;
    setMinutes(value);
    setRemaining(value * 60);
  };

  const progress = minutes > 0 ? 1 - remaining / (minutes * 60) : 0;
  const RING_RADIUS = 88;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const selectedSubject = subjects?.find((s) => s._id === (subjectId as never));

  const totalFocusMinutes = useMemo(
    () => history?.reduce((sum, e) => sum + Math.round(e.seconds / 60), 0) ?? 0,
    [history],
  );

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <p className="type-mono uppercase tracking-[0.22em] text-primary">
            // focus sessions
          </p>
          <h1 className="type-h1 mt-1">Focus timer</h1>
          <p className="type-body mt-1 text-muted-foreground">
            Every completed session is logged to your streak and study history.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          {/* ───── Timer ───── */}
          <div className="glass-panel relative flex flex-col items-center rounded-2xl p-8 overflow-hidden">
            {/* Ambient glow behind the ring */}
            <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
              <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.04] blur-3xl transition-opacity duration-500"
                style={{ opacity: status === "running" ? 1 : 0.3 }}
              />
            </div>

            <div className="relative z-10 flex flex-col items-center">
              <div className="flex items-center gap-2 type-mono text-[11px] text-muted-foreground">
                <Timer className="size-3.5 text-primary" />
                {status === "running"
                  ? "session in progress"
                  : status === "paused"
                    ? "paused"
                    : status === "celebrating"
                      ? "session complete"
                      : "ready when you are"}
              </div>

              {/* Countdown ring — THE visual centerpiece */}
              <div className="relative mt-6 flex size-60 items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 200 200">
                  <defs>
                    <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="oklch(0.76 0.13 255)" />
                      <stop offset="100%" stopColor="oklch(0.83 0.1 195)" />
                    </linearGradient>
                    {/* Glow filter for active state */}
                    <filter id="ringGlow">
                      <feGaussianBlur stdDeviation="3" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {/* Track ring */}
                  <circle
                    cx="100" cy="100" r={RING_RADIUS}
                    fill="none"
                    strokeWidth="5"
                    className="stroke-white/8"
                  />
                  {/* Progress ring */}
                  <motion.circle
                    cx="100" cy="100" r={RING_RADIUS}
                    fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    stroke="url(#ringGradient)"
                    strokeDasharray={RING_CIRCUMFERENCE}
                    animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress) }}
                    transition={{ duration: 1, ease: "linear" }}
                    className={cn(
                      isLowTime && "low-time-glow",
                      status === "running" && "filter: drop-shadow(0 0 6px oklch(0.74 0.15 232 / 0.3))",
                    )}
                    style={{ filter: status === "running" ? "url(#ringGlow)" : undefined }}
                  />
                  {/* Pulse ring when time is low */}
                  <AnimatePresence>
                    {isLowTime && (
                      <motion.circle
                        cx="100" cy="100" r={RING_RADIUS}
                        fill="none"
                        strokeWidth="2"
                        stroke="oklch(0.74 0.15 232 / 0.3)"
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{
                          opacity: [0, 0.6, 0],
                          scale: [0.98, 1.02, 0.98],
                        }}
                        transition={{
                          duration: 2,
                          repeat: Infinity,
                          ease: "easeInOut",
                        }}
                        exit={{ opacity: 0 }}
                        style={{ transformOrigin: "center" }}
                      />
                    )}
                  </AnimatePresence>
                </svg>

                {/* Ring content: clock or celebration */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <AnimatePresence mode="wait">
                    {status === "celebrating" && sessionResult ? (
                      <motion.div
                        key="celebration"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        className="flex flex-col items-center gap-2"
                      >
                        <motion.div
                          initial={{ scale: 0, rotate: -180 }}
                          animate={{ scale: 1, rotate: 0 }}
                          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                          className="flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-[0_0_40px_-8px_rgb(56_189_248/0.7)]"
                        >
                          <CheckCircle2 className="size-7" />
                        </motion.div>
                        <p className="type-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                          complete
                        </p>
                        {sessionResult.xpAwarded > 0 && (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.3 }}
                            className="flex items-center gap-1.5 rounded-xl bg-premium/10 border border-premium/20 px-3 py-1.5"
                          >
                            <Zap className="size-3.5 text-premium" />
                            <span className="type-mono text-sm font-bold text-premium">
                              +{sessionResult.xpAwarded} XP
                            </span>
                          </motion.div>
                        )}
                        {sessionResult.levelUp && (
                          <motion.div
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                            className="flex items-center gap-1.5 type-mono text-[11px] text-primary"
                          >
                            <Star className="size-3" />
                            Level {sessionResult.newLevel}
                          </motion.div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div
                        key="clock"
                        initial={false}
                        className="flex flex-col items-center gap-1"
                      >
                        <span
                          className={cn(
                            "font-mono text-5xl font-bold tracking-tight tabular-nums",
                            status === "running"
                              ? isLowTime
                                ? "text-primary"
                                : "text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {formatClock(remaining)}
                        </span>
                        <span className="type-caption uppercase tracking-[0.2em] text-muted-foreground">
                          {status === "running"
                            ? isLowTime
                              ? "final minute"
                              : "in progress"
                            : status === "paused"
                              ? "paused"
                              : status === "done"
                                ? "complete"
                                : "ready"}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-7 flex items-center gap-2">
                {(status === "running" || status === "paused") ? (
                  <Button size="lg" className="rounded-xl interactive-press" onClick={handlePause}>
                    {status === "running" ? (
                      <><Pause className="size-4" /> Pause</>
                    ) : (
                      <><Play className="size-4" /> Resume</>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="rounded-xl interactive-press"
                    onClick={handleStart}
                    disabled={!subjectId || logging || status === "celebrating"}
                  >
                    {logging ? (
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                      />
                    ) : (
                      <Play className="size-4" />
                    )}
                    Start session
                  </Button>
                )}
                <Button
                  size="lg"
                  variant="outline"
                  className="rounded-xl bg-white/5 interactive-press"
                  onClick={handleReset}
                  disabled={status === "idle" || status === "celebrating"}
                >
                  <RotateCcw className="size-4" /> Reset
                </Button>
              </div>

              {/* Config */}
              <div className="mt-7 flex w-full flex-col items-center gap-3 border-t border-white/8 pt-6">
                <div className="flex items-center gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.minutes}
                      type="button"
                      onClick={() => applyPreset(preset.minutes)}
                      disabled={status !== "idle"}
                      className={cn(
                        "cursor-pointer rounded-xl border px-4 py-2 type-mono text-xs transition-all duration-200 interactive-press disabled:cursor-not-allowed disabled:opacity-50",
                        minutes === preset.minutes
                          ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_16px_-6px_rgb(56_189_248/0.6)]"
                          : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1} max={120}
                      value={customMinutes}
                      onChange={(e) => {
                        setCustomMinutes(e.target.value);
                        const value = Number(e.target.value);
                        if (value >= 1 && value <= 120) {
                          setMinutes(value);
                          if (status === "idle") setRemaining(value * 60);
                        }
                      }}
                      disabled={status !== "idle"}
                      placeholder="min"
                      className="type-caption h-9 w-20 rounded-xl bg-white/5 disabled:opacity-50"
                    />
                    <span className="type-caption text-muted-foreground">custom</span>
                  </div>
                </div>

                <div className="w-full max-w-xs">
                  <Select value={subjectId} onValueChange={setSubjectId} disabled={status !== "idle"}>
                    <SelectTrigger className="type-caption h-10 w-full rounded-xl bg-white/5">
                      <SelectValue placeholder="Subject for this session..." />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects?.map((subject) => (
                        <SelectItem key={subject._id} value={subject._id as string}>
                          {subject.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Music integration on Focus page */}
                <div className="flex w-full max-w-xs items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                  <div className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
                    music.playing ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground/50",
                  )}>
                    <AudioLines className={cn("size-3.5", music.playing && "animate-pulse")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="type-caption font-semibold text-foreground/80">Ambient sound</p>
                    <p className="type-caption text-muted-foreground/60">
                      {music.playing ? music.track.label : "Tap the player below to focus"}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ───── History ───── */}
          <div className="glass-panel flex flex-col rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <p className="type-mono uppercase tracking-[0.22em] text-primary">
                // history
              </p>
              <div className="flex items-center gap-3">
                {totalFocusMinutes > 0 && (
                  <span className="type-mono text-[10px] text-muted-foreground">
                    <span className="font-semibold text-foreground">{totalFocusMinutes}</span> min total
                  </span>
                )}
                <History className="size-4 text-muted-foreground" />
              </div>
            </div>

            {history === undefined ? (
              <div className="flex flex-1 items-center justify-center py-12">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                  className="size-5 rounded-full border-2 border-primary/30 border-t-primary"
                />
              </div>
            ) : history.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-1 flex-col items-center justify-center py-12 text-center"
              >
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/8 text-primary/50 shadow-[0_0_30px_-10px_rgb(56_189_248/0.4)]">
                  <Flame className="size-6" />
                </div>
                <p className="type-h3 mt-4 text-foreground/80">No sessions yet</p>
                <p className="type-body mt-1 max-w-xs text-muted-foreground">
                  Complete a focus session and your time-per-subject shows up here.
                </p>
              </motion.div>
            ) : (
              <div className="mt-4 space-y-2">
                {history.map((entry, i) => (
                  <motion.div
                    key={entry.subjectId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-soft flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 hover-lift"
                  >
                    <div className="min-w-0">
                      <p className="type-body font-semibold truncate">{entry.subjectName}</p>
                      <p className="type-caption text-muted-foreground">
                        {entry.count} session{entry.count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="type-mono text-sm font-bold tabular-nums">
                        {entry.hours} h
                      </p>
                      <p className="type-caption text-muted-foreground">
                        {Math.round(entry.seconds / 60)} min
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {selectedSubject && (status === "running" || status === "paused") && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-4"
              >
                <Badge className="gap-1 bg-primary/10 font-mono text-[10px] text-primary border-primary/15">
                  logging to: {selectedSubject.name}
                </Badge>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* AI recap card */}
      <AnimatePresence>
        {recapText && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-auto w-full max-w-2xl glass-panel flex items-start gap-3 rounded-2xl p-5"
          >
            <Sparkles className="size-5 shrink-0 text-primary mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="type-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary mb-1">
                // study recap
              </p>
              <p className="type-body leading-relaxed text-muted-foreground">{recapText}</p>
            </div>
            <button
              onClick={() => setRecapText(null)}
              className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors interactive-press p-1 rounded-lg"
            >
              <XCircle className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quiz prompt after session */}
      <Dialog open={quizPromptOpen} onOpenChange={setQuizPromptOpen}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 type-h3">
              <Sparkles className="size-4 text-primary" /> Nice work
            </DialogTitle>
            <DialogDescription className="type-body">
              {selectedSubject
                ? `You just logged ${formatClock(minutes * 60)} of ${selectedSubject.name}. Want a quick check to lock it in?`
                : "You just logged a focus session. Want a quick check?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl bg-white/5 interactive-press"
              onClick={() => setQuizPromptOpen(false)}
            >
              Not now
            </Button>
            <Button
              className="rounded-xl interactive-press"
              onClick={() => {
                setQuizPromptOpen(false);
                setQuizOpen(true);
              }}
              disabled={!subjectId}
            >
              <Sparkles className="size-4" /> Start quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuizFlow
        open={quizOpen}
        onOpenChange={setQuizOpen}
        initialSubjectId={subjectId || undefined}
        title="Quick check"
      />
    </DashboardShell>
  );
}
