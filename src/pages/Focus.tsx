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
  SkipForward,
  Sparkles,
  Star,
  Target,
  Timer,
  Volume2,
  VolumeX,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ─── Constants ───────────────────────────────────────────────────────────
const PRESETS = [
  { label: "15 min", minutes: 15, tag: "Quick" },
  { label: "25 min", minutes: 25, tag: "Pomodoro" },
  { label: "45 min", minutes: 45, tag: "Deep" },
  { label: "60 min", minutes: 60, tag: "Marathon" },
];

const GOAL_KEY = "nexus-focus-daily-goal";
const NOTIF_KEY = "nexus-focus-notif";

const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// ─── Helpers ─────────────────────────────────────────────────────────────
function playChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    // Note 1 — warm bell
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.connect(g1); g1.connect(ctx.destination);
    o1.frequency.value = 880; o1.type = "sine";
    g1.gain.setValueAtTime(0.25, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    o1.start(now); o1.stop(now + 1.2);
    // Note 2 — bright chime
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.connect(g2); g2.connect(ctx.destination);
    o2.frequency.value = 1318.5; o2.type = "sine";
    g2.gain.setValueAtTime(0, now + 0.18);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.22);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    o2.start(now + 0.18); o2.stop(now + 1.4);
    // Note 3 — shimmer
    const o3 = ctx.createOscillator();
    const g3 = ctx.createGain();
    o3.connect(g3); g3.connect(ctx.destination);
    o3.frequency.value = 1760; o3.type = "sine";
    g3.gain.setValueAtTime(0, now + 0.4);
    g3.gain.linearRampToValueAtTime(0.1, now + 0.45);
    g3.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    o3.start(now + 0.4); o3.stop(now + 1.0);
  } catch { /* audio blocked */ }
}

function sendNotification(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try { new Notification(title, { body, icon: "⚡" }); } catch { /* blocked */ }
}

function readGoal(): number {
  try { const v = localStorage.getItem(GOAL_KEY); return v ? Number(v) : 60; } catch { return 60; }
}
function saveGoal(m: number) {
  try { localStorage.setItem(GOAL_KEY, String(m)); } catch {}
}

// ─── Component ───────────────────────────────────────────────────────────
type TimerStatus = "idle" | "running" | "paused" | "done" | "celebrating";

export default function Focus() {
  // ── Queries ──
  const subjects = useQuery(api.subjects.getAll);
  const history = useQuery(api.studySessions.getHistory);
  const streak = useQuery(api.studySessions.getStreak);
  const recentSessions = useQuery(api.studySessions.getRecentSessions, { limit: 50 });
  const logSession = useMutation(api.studySessions.logSession);
  const generateRecap = useAction(api.recap.generateRecap);
  const music = useMusic();

  // ── Week activity (last 7 days) ──
  const weekDays = useMemo(() => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      days.push({ date, startMs: d.getTime(), endMs: d.getTime() + 86400000 });
    }
    return days;
  }, []);
  const weekActivity = useQuery(api.studySessions.getWeekActivity, { days: weekDays });

  // ── State ──
  const [recapText, setRecapText] = useState<string | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState("");
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [remaining, setRemaining] = useState(25 * 60);
  const [logging, setLogging] = useState(false);
  const [quizPromptOpen, setQuizPromptOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [sessionResult, setSessionResult] = useState<{
    xpAwarded: number; levelUp: boolean; newLevel: number; newAchievements: { name: string }[];
  } | null>(null);
  const [dailyGoal, setDailyGoal] = useState(readGoal);
  const [showGoalEdit, setShowGoalEdit] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  const startedAtRef = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const loggedRef = useRef(false);
  const sessionIdRef = useRef<string>(Date.now().toString(36));

  const isLowTime = status === "running" && remaining <= 60 && remaining > 0;

  // ── Derived: today stats ──
  const todayKey = localDateKey();
  const todayData = useMemo(() => {
    const sessions = recentSessions?.filter((s) => {
      return new Date(s.startedAt).toISOString().slice(0, 10) === todayKey;
    }) ?? [];
    return {
      sessions: sessions.length,
      minutes: sessions.reduce((sum, s) => sum + Math.round(s.durationSeconds / 60), 0),
      bestSession: sessions.length > 0 ? Math.max(...sessions.map((s) => s.durationSeconds)) : 0,
    };
  }, [recentSessions, todayKey]);

  const goalProgress = dailyGoal > 0 ? Math.min(todayData.minutes / dailyGoal, 1) : 0;

  const totalFocusMinutes = useMemo(
    () => history?.reduce((sum, e) => sum + Math.round(e.seconds / 60), 0) ?? 0,
    [history],
  );

  const selectedSubject = subjects?.find((s) => s._id === (subjectId as never));
  const progress = minutes > 0 ? 1 - remaining / (minutes * 60) : 0;

  // ── Week chart max ──
  const weekMaxMin = useMemo(
    () => Math.max(1, ...(weekActivity?.map((d) => Math.round(d.seconds / 60)) ?? [1])),
    [weekActivity],
  );
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // ── Timer tick ──
  useEffect(() => {
    if (status === "idle") {
      setRemaining(minutes * 60);
      elapsedRef.current = 0;
    }
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
        elapsedRef.current += 1;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [status]);

  // ── Session logging ──
  useEffect(() => {
    if (status !== "done") return;
    if (loggedRef.current) return;
    if (!subjectId) {
      toast.error("Pick a subject to log this session.");
      setStatus("idle");
      return;
    }
    loggedRef.current = true;
    const durationSeconds = elapsedRef.current;
    const realMinutes = Math.round(durationSeconds / 60);
    setLogging(true);
    logSession({
      subjectId: subjectId as never,
      durationSeconds,
      startedAt: startedAtRef.current || Date.now() - durationSeconds * 1000,
      endedAt: Date.now(),
      localDate: todayKey,
    })
      .then((result) => {
        setSessionResult({
          xpAwarded: result.xpAwarded ?? 0,
          levelUp: result.levelUp ?? false,
          newLevel: result.newLevel ?? 0,
          newAchievements: result.newAchievements ?? [],
        });
        setStatus("celebrating");
        playChime();
        sendNotification(
          "Focus session complete!",
          `${realMinutes} min of ${selectedSubject?.name ?? "studying"} logged${result.xpAwarded > 0 ? ` (+${result.xpAwarded} XP)` : ""}`,
        );
        if (result.xpAwarded > 0) toast.success(`+${result.xpAwarded} XP earned.`);
        if (result.levelUp) toast.success(`Level up — you're now level ${result.newLevel}.`);
        for (const a of result.newAchievements) toast.success(`Achievement unlocked: ${a.name}`);
        generateRecap({ type: "focus_session" })
          .then((r) => { if (r.text) setRecapText(r.text); })
          .catch(() => {});
        setTimeout(() => {
          setSessionResult(null);
          setStatus("idle");
          if (result.xpAwarded > 0) setQuizPromptOpen(true);
        }, 4000);
      })
      .catch((error) => {
        toast.error(errorMessage(error, "Could not log the session."));
        setStatus("idle");
      })
      .finally(() => {
        loggedRef.current = false;
        setLogging(false);
      });
  }, [status, subjectId, logSession, generateRecap, selectedSubject, todayKey]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (status === "idle" && subjectId) handleStart();
        else if (status === "running" || status === "paused") handlePause();
      }
      if (e.code === "Escape" && (status === "running" || status === "paused")) handleReset();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status, subjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Notification permission ──
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default" && localStorage.getItem(NOTIF_KEY) !== "asked") {
      Notification.requestPermission().then((p) => { if (p === "granted") localStorage.setItem(NOTIF_KEY, "granted"); });
    }
  }, []);

  // ── Handlers ──
  const handleStart = useCallback(() => {
    if (!subjectId) { toast.error("Choose a subject before starting."); return; }
    loggedRef.current = false;
    setSessionResult(null);
    startedAtRef.current = Date.now();
    elapsedRef.current = 0;
    sessionIdRef.current = Date.now().toString(36);
    setStatus("running");
  }, [subjectId]);

  const handlePause = useCallback(() => setStatus((s) => (s === "running" ? "paused" : "running")), []);
  const handleReset = useCallback(() => { setStatus("idle"); elapsedRef.current = 0; setSessionResult(null); }, []);

  const applyPreset = useCallback(
    (value: number) => {
      if (status !== "idle") return;
      setMinutes(value);
      setCustomMinutes("");
      setRemaining(value * 60);
    },
    [status],
  );

  const handleGoalSave = () => {
    const v = Number(goalInput);
    if (v >= 5 && v <= 480) { setDailyGoal(v); saveGoal(v); setShowGoalEdit(false); }
  };

  // ── JSX ──
  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        {/* Header */}
        <div>
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">// focus sessions</p>
          <h1 className="type-h1 mt-1">Focus timer</h1>
          <p className="type-body mt-1 text-muted-foreground">
            Deep work builds streaks, earns XP, and locks in knowledge.
          </p>
        </div>

        {/* ── Stats Bar ── */}
        <div className="grid grid-cols-3 gap-3">
          {/* Streak */}
          <div className="glass-soft flex items-center gap-3 rounded-xl px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-orange-400/10 text-orange-300">
              <Flame className="size-4" />
            </div>
            <div>
              <p className="type-caption text-muted-foreground">Streak</p>
              <p className="type-mono text-lg font-bold leading-tight">
                {streak?.currentStreak ?? 0}<span className="text-muted-foreground/50 text-xs font-normal"> day{((streak?.currentStreak ?? 0) !== 1) ? "s" : ""}</span>
              </p>
            </div>
          </div>

          {/* Today */}
          <div className="glass-soft flex items-center gap-3 rounded-xl px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sky-400/10 text-sky-300">
              <Timer className="size-4" />
            </div>
            <div>
              <p className="type-caption text-muted-foreground">Today</p>
              <p className="type-mono text-lg font-bold leading-tight">
                {todayData.minutes}<span className="text-muted-foreground/50 text-xs font-normal"> min</span>
                <span className="text-muted-foreground/40 text-xs font-normal ml-1">{todayData.sessions} session{(todayData.sessions !== 1) ? "s" : ""}</span>
              </p>
            </div>
          </div>

          {/* Daily Goal */}
          <div className="glass-soft relative flex flex-col justify-center rounded-xl px-4 py-3">
            {showGoalEdit ? (
              <div className="flex items-center gap-2">
                <Target className="size-4 shrink-0 text-amber-300" />
                <Input type="number" min={5} max={480} value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
                  className="type-mono h-7 w-20 rounded-lg bg-white/5 text-xs px-2" placeholder="min" autoFocus onKeyDown={(e) => e.key === "Enter" && handleGoalSave()} />
                <button onClick={handleGoalSave} className="text-xs text-amber-300 hover:text-amber-200">✓</button>
              </div>
            ) : (
              <button onClick={() => { setGoalInput(String(dailyGoal)); setShowGoalEdit(true); }}
                className="w-full text-left">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="size-4 shrink-0 text-amber-300" />
                    <span className="type-caption text-muted-foreground">Daily goal</span>
                  </div>
                  <span className="type-mono text-xs text-muted-foreground">{Math.round(goalProgress * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                  <motion.div className="h-full rounded-full bg-gradient-to-r from-amber-400/60 to-amber-400"
                    initial={false} animate={{ width: `${goalProgress * 100}%` }} transition={{ duration: 0.5, ease: "easeOut" }} />
                </div>
                <p className="type-caption mt-1 text-muted-foreground/60">{todayData.minutes}/{dailyGoal} min</p>
              </button>
            )}
          </div>
        </div>

        {/* ── Main Grid ── */}
        <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          {/* ───── Timer Panel ───── */}
          <div className="glass-panel relative flex flex-col items-center rounded-2xl p-8 overflow-hidden">
            <div className="pointer-events-none absolute inset-0 z-0" aria-hidden="true">
              <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400/[0.04] blur-3xl transition-opacity duration-500"
                style={{ opacity: status === "running" ? 1 : 0.3 }} />
            </div>

            <div className="relative z-10 flex flex-col items-center">
              {/* Status label */}
              <div className="flex items-center gap-2 type-mono text-[11px] text-muted-foreground">
                <Timer className="size-3.5 text-amber-300" />
                {status === "running" ? "session in progress" : status === "paused" ? "paused"
                  : status === "celebrating" ? "session complete" : "ready when you are"}
              </div>

              {/* Ring */}
              <div className="relative mt-6 flex size-60 items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 200 200">
                  <defs>
                    <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="oklch(0.76 0.13 255)" />
                      <stop offset="100%" stopColor="oklch(0.83 0.1 195)" />
                    </linearGradient>
                    <filter id="ringGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <circle cx="100" cy="100" r={RING_RADIUS} fill="none" strokeWidth="5" className="stroke-white/8" />
                  <motion.circle cx="100" cy="100" r={RING_RADIUS} fill="none" strokeWidth="5" strokeLinecap="round"
                    stroke="url(#ringGradient)" strokeDasharray={RING_CIRCUMFERENCE}
                    animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - progress) }} transition={{ duration: 1, ease: "linear" }}
                    className={cn(isLowTime && "low-time-glow")}
                    style={{ filter: status === "running" ? "url(#ringGlow)" : undefined }} />
                  <AnimatePresence>
                    {isLowTime && (
                      <motion.circle cx="100" cy="100" r={RING_RADIUS} fill="none" strokeWidth="2"
                        stroke="oklch(0.74 0.15 232 / 0.3)" initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: [0, 0.6, 0], scale: [0.98, 1.02, 0.98] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} exit={{ opacity: 0 }}
                        style={{ transformOrigin: "center" }} />
                    )}
                  </AnimatePresence>
                </svg>

                {/* Ring center */}
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                  <AnimatePresence mode="wait">
                    {status === "celebrating" && sessionResult ? (
                      <motion.div key="celebration" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                        className="flex flex-col items-center gap-2">
                        <motion.div initial={{ scale: 0, rotate: -180 }} animate={{ scale: 1, rotate: 0 }}
                          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                          className="flex size-14 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300 shadow-[0_0_40px_-8px_rgb(251,191,36/0.7)]">
                          <CheckCircle2 className="size-7" />
                        </motion.div>
                        <p className="type-mono text-[10px] uppercase tracking-[0.2em] text-amber-300">complete</p>
                        {sessionResult.xpAwarded > 0 && (
                          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
                            className="flex items-center gap-1.5 rounded-xl bg-premium/10 border border-premium/20 px-3 py-1.5">
                            <Zap className="size-3.5 text-premium" />
                            <span className="type-mono text-sm font-bold text-premium">+{sessionResult.xpAwarded} XP</span>
                          </motion.div>
                        )}
                        {sessionResult.levelUp && (
                          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
                            className="flex items-center gap-1.5 type-mono text-[11px] text-amber-300">
                            <Star className="size-3" /> Level {sessionResult.newLevel}
                          </motion.div>
                        )}
                      </motion.div>
                    ) : (
                      <motion.div key="clock" initial={false} className="flex flex-col items-center gap-1">
                        <span className={cn("font-mono text-5xl font-bold tracking-tight tabular-nums",
                          status === "running" ? (isLowTime ? "text-primary" : "text-foreground") : "text-muted-foreground")}>
                          {formatClock(remaining)}
                        </span>
                        <span className="type-caption uppercase tracking-[0.2em] text-muted-foreground">
                          {status === "running" ? (isLowTime ? "final minute" : "in progress")
                            : status === "paused" ? "paused" : status === "done" ? "complete" : "ready"}
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
                    {status === "running" ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> Resume</>}
                  </Button>
                ) : (
                  <Button size="lg" className="rounded-xl interactive-press" onClick={handleStart}
                    disabled={!subjectId || logging || status === "celebrating"}>
                    {logging ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    ) : <Play className="size-4" />}
                    Start session
                  </Button>
                )}
                <Button size="lg" variant="outline" className="rounded-xl bg-white/5 interactive-press"
                  onClick={handleReset} disabled={status === "idle" || status === "celebrating"}>
                  <RotateCcw className="size-4" /> Reset
                </Button>
              </div>

              {/* Config */}
              <div className="mt-7 flex w-full flex-col items-center gap-3 border-t border-white/8 pt-6">
                {/* Presets */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {PRESETS.map((preset) => (
                    <button key={preset.minutes} type="button" onClick={() => applyPreset(preset.minutes)} disabled={status !== "idle"}
                      className={cn("cursor-pointer rounded-xl border px-3 py-2 type-mono text-[11px] transition-all duration-200 interactive-press disabled:cursor-not-allowed disabled:opacity-50",
                        minutes === preset.minutes
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-6px_rgb(251,191,36/0.6)]"
                          : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground")}>
                      {preset.label}
                      <span className="ml-1 opacity-40">{preset.tag}</span>
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Input type="number" min={1} max={180} value={customMinutes} onChange={(e) => {
                        setCustomMinutes(e.target.value);
                        const v = Number(e.target.value);
                        if (v >= 1 && v <= 180) { setMinutes(v); if (status === "idle") setRemaining(v * 60); }
                      }} disabled={status !== "idle"} placeholder="min"
                      className="type-caption h-9 w-20 rounded-xl bg-white/5 disabled:opacity-50" />
                    <span className="type-caption text-muted-foreground">custom</span>
                  </div>
                </div>

                {/* Subject select */}
                <div className="w-full max-w-xs">
                  <Select value={subjectId} onValueChange={setSubjectId} disabled={status !== "idle"}>
                    <SelectTrigger className="type-caption h-10 w-full rounded-xl bg-white/5">
                      <SelectValue placeholder="Subject for this session..." />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects?.map((subject) => (
                        <SelectItem key={subject._id} value={subject._id as string}>{subject.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Sound controls */}
                <div className="flex w-full max-w-xs items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                  <button onClick={music.toggle} className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                    music.playing ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground/50")}>
                    {music.playing ? <Volume2 className="size-3.5 animate-pulse" /> : <VolumeX className="size-3.5" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="type-caption font-semibold text-foreground/80">Ambient sound</p>
                    <p className="type-caption text-muted-foreground/60">{music.playing ? music.track.label : "Play to focus"}</p>
                  </div>
                  <button onClick={() => music.cycleTrack(1)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted-foreground/50 hover:text-foreground transition-colors">
                    <SkipForward className="size-3.5" />
                  </button>
                </div>

                {/* Keyboard hint */}
                <p className="type-caption text-muted-foreground/40">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">Space</kbd> start / pause
                  &nbsp;&middot;&nbsp;
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">Esc</kbd> reset
                </p>
              </div>
            </div>

            {/* Active session badge */}
            {selectedSubject && (status === "running" || status === "paused") && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-4 left-4">
                <Badge className="gap-1 bg-amber-400/10 font-mono text-[10px] text-amber-300 border-amber-400/15">
                  logging to: {selectedSubject.name}
                </Badge>
              </motion.div>
            )}
          </div>

          {/* ───── Right Panel ───── */}
          <div className="flex flex-col gap-4">
            {/* Week activity chart */}
            <div className="glass-panel flex flex-col rounded-2xl p-5">
              <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">// this week</p>
              <div className="mt-4 flex items-end justify-between gap-1.5" style={{ height: 80 }}>
                {weekDays.map((day, i) => {
                  const entry = weekActivity?.find((e) => e.date === day.date);
                  const mins = entry ? Math.round(entry.seconds / 60) : 0;
                  const height = weekMaxMin > 0 ? Math.max(4, (mins / weekMaxMin) * 100) : 4;
                  const isToday = day.date === todayKey;
                  const d = new Date(day.date + "T12:00:00");
                  return (
                    <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="type-caption tabular-nums text-[10px] text-muted-foreground/60">{mins > 0 ? `${mins}m` : ""}</span>
                      <div className="w-full flex-1 flex items-end">
                        <motion.div
                          initial={{ height: 4 }} animate={{ height: `${height}%` }}
                          transition={{ duration: 0.4, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
                          className={cn("w-full rounded-t-md transition-colors",
                            isToday ? "bg-amber-400/40" : mins > 0 ? "bg-primary/30" : "bg-white/5")} />
                      </div>
                      <span className={cn("type-caption text-[10px]", isToday ? "text-amber-300 font-bold" : "text-muted-foreground/50")}>
                        {dayLabels[d.getDay()]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Recent sessions */}
            <div className="glass-panel flex flex-col rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">// recent sessions</p>
                <div className="flex items-center gap-2">
                  {totalFocusMinutes > 0 && (
                    <span className="type-mono text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{totalFocusMinutes}</span> min total
                    </span>
                  )}
                  <History className="size-4 text-muted-foreground" />
                </div>
              </div>

              {recentSessions === undefined ? (
                <div className="flex items-center justify-center py-10">
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }}
                    className="size-5 rounded-full border-2 border-primary/30 border-t-primary" />
                </div>
              ) : recentSessions.length === 0 ? (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center justify-center py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300/50 shadow-[0_0_30px_-10px_rgb(251,191,36/0.4)]">
                    <Flame className="size-6" />
                  </div>
                  <p className="type-h3 mt-4 text-foreground/80">No sessions yet</p>
                  <p className="type-body mt-1 max-w-xs text-muted-foreground">Complete a focus session and your history appears here.</p>
                </motion.div>
              ) : (
                <div className=" data-lenis-prevent-wheelmt-3 space-y-2 max-h-[320px] overflow-y-auto pr-1">
                  {recentSessions.slice(0, 15).map((s, i) => {
                    const d = new Date(s.startedAt);
                    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });
                    return (
                      <motion.div key={s._id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, delay: 0.03 * i, ease: [0.22, 1, 0.36, 1] }}
                        className="glass-soft flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 hover-lift">
                        <div className="min-w-0">
                          <p className="type-body text-sm font-semibold truncate">{s.subjectName}</p>
                          <p className="type-caption text-muted-foreground/60">{dateStr} at {timeStr}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="type-mono text-sm font-bold tabular-nums">{Math.round(s.durationSeconds / 60)}<span className="text-xs font-normal text-muted-foreground/50">m</span></p>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Per-subject breakdown */}
            {history && history.length > 0 && (
              <div className="glass-panel flex flex-col rounded-2xl p-5">
                <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">// by subject</p>
                <div className="mt-3 space-y-2">
                  {history.slice(0, 8).map((entry, i) => (
                    <motion.div key={entry.subjectId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.3, delay: 0.04 * i, ease: [0.22, 1, 0.36, 1] }}
                      className="glass-soft flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 hover-lift">
                      <div className="min-w-0">
                        <p className="type-body font-semibold truncate">{entry.subjectName}</p>
                        <p className="type-caption text-muted-foreground">{entry.count} session{entry.count === 1 ? "" : "s"}</p>
                      </div>
                      <div className="text-right">
                        <p className="type-mono text-sm font-bold tabular-nums">{entry.hours} h</p>
                        <p className="type-caption text-muted-foreground">{Math.round(entry.seconds / 60)} min</p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI recap */}
      <AnimatePresence>
        {recapText && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="mx-auto w-full max-w-2xl glass-panel flex items-start gap-3 rounded-2xl p-5">
            <Sparkles className="size-5 shrink-0 text-amber-300 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="type-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300 mb-1">// study recap</p>
              <p className="type-body leading-relaxed text-muted-foreground">{recapText}</p>
            </div>
            <button onClick={() => setRecapText(null)} className="shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors interactive-press p-1 rounded-lg">
              <XCircle className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quiz prompt */}
      <Dialog open={quizPromptOpen} onOpenChange={setQuizPromptOpen}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 type-h3"><Sparkles className="size-4 text-amber-300" /> Nice work</DialogTitle>
            <DialogDescription className="type-body">
              {selectedSubject ? `You just logged ${Math.round(elapsedRef.current / 60)} min of ${selectedSubject.name}. Want a quick check to lock it in?` : "Great session! Want a quick quiz?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl bg-white/5 interactive-press" onClick={() => setQuizPromptOpen(false)}>Not now</Button>
            <Button className="rounded-xl interactive-press" onClick={() => { setQuizPromptOpen(false); setQuizOpen(true); }} disabled={!subjectId}>
              <Sparkles className="size-4" /> Start quiz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <QuizFlow open={quizOpen} onOpenChange={setQuizOpen} initialSubjectId={subjectId || undefined} title="Quick check" />
    </DashboardShell>
  );
}
