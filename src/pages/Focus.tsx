import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AudioLines,
  CheckCircle2,
  Coffee,
  Flame,
  GraduationCap,
  History,
  ListTodo,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Star,
  StopCircle,
  Target,
  Timer,
  Volume2,
  VolumeX,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { QuizFlow } from "@/components/QuizFlow";
import { FocusIntelligence } from "@/components/focus/FocusIntelligence";
import { MissionPicker, type MissionLink } from "@/components/focus/MissionPicker";
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
import { Switch } from "@/components/ui/switch";
import { formatClock, lastNDayWindows, localDateKey } from "@/lib/dates";
import { useFriendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { SCENES, useMusic } from "@/components/music-player";
import type { FocusSessionSnapshot } from "@/convex/focusSessions";

// ─── Session modes (Phase 5) ─────────────────────────────────────────────
const MODES = [
  { id: "sprint", label: "Sprint", minutes: 15, breakMinutes: 0, tag: "15 min" },
  { id: "pomodoro", label: "Pomodoro", minutes: 25, breakMinutes: 5, tag: "25 + 5" },
  { id: "deep_work", label: "Deep Work", minutes: 50, breakMinutes: 10, tag: "50 + 10" },
  { id: "custom", label: "Custom", minutes: 25, breakMinutes: 0, tag: "your pace" },
] as const;

type ModeId = (typeof MODES)[number]["id"];
type Phase = "idle" | "running" | "paused" | "break" | "celebrating";

const GOAL_KEY = "nexus-focus-daily-goal";
const NOTIF_KEY = "nexus-focus-notif";
const RING_RADIUS = 88;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// ─── Helpers ─────────────────────────────────────────────────────────────
function playChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.connect(g1); g1.connect(ctx.destination);
    o1.frequency.value = 880; o1.type = "sine";
    g1.gain.setValueAtTime(0.25, now);
    g1.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    o1.start(now); o1.stop(now + 1.2);
    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.connect(g2); g2.connect(ctx.destination);
    o2.frequency.value = 1318.5; o2.type = "sine";
    g2.gain.setValueAtTime(0, now + 0.18);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.22);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 1.4);
    o2.start(now + 0.18); o2.stop(now + 1.4);
    const o3 = ctx.createOscillator();
    const g3 = ctx.createGain();
    o3.connect(g3); g3.connect(ctx.destination);
    o3.frequency.value = 1760; o3.type = "sine";
    g3.gain.setValueAtTime(0, now + 0.4);
    g3.gain.linearRampToValueAtTime(0.1, now + 0.45);
    g3.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
    o3.start(now + 0.4); o3.stop(now + 1.0);
    void ctx.close();
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
  try { localStorage.setItem(GOAL_KEY, String(m)); } catch { /* ignore */ }
}

function newClientSessionId(): string {
  try {
    return `fs-${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  } catch {
    return `fs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/** Remaining ms for a snapshot at the (offset-corrected) local clock. */
function remainingMsOfSnapshot(s: FocusSessionSnapshot, offsetMs: number): number {
  const reference = s.pausedAt ?? Date.now() + offsetMs;
  const elapsed = Math.max(0, reference - s.startedAt - s.pausedTotalMs);
  return Math.max(0, s.plannedSeconds * 1000 - elapsed);
}

// ─── Component ───────────────────────────────────────────────────────────
export default function Focus() {
  const friendlyError = useFriendlyError();
  const { t } = useTranslation(["focus", "common"]);
  const music = useMusic();
  const { setFocusMode } = music;

  // ── Queries ──
  const subjects = useQuery(api.subjects.getAll);
  const history = useQuery(api.studySessions.getHistory);
  const streak = useQuery(api.studySessions.getStreak);
  const recentSessions = useQuery(api.studySessions.getRecentSessions, { limit: 50 });
  const activeSession = useQuery(api.focusSessions.getActive);

  // ── Mutations / actions ──
  const startSession = useMutation(api.focusSessions.start);
  const pauseSession = useMutation(api.focusSessions.pause);
  const resumeSession = useMutation(api.focusSessions.resume);
  const finishSession = useMutation(api.focusSessions.finish);
  const abandonSession = useMutation(api.focusSessions.abandon);
  const addReflection = useMutation(api.focusSessions.addReflection);
  const toggleTodo = useMutation(api.todos.toggleDone);
  const generateRecap = useAction(api.recap.generateRecap);

  // ── Analytics windows (client-local days; server buckets by them) ──
  const overviewDays = useMemo(() => lastNDayWindows(84), []);
  const overview = useQuery(api.focusSessions.getOverview, { days: overviewDays, subjectDays: 30 });

  // ── Core state ──
  const [phase, setPhase] = useState<Phase>("idle");
  const [serverSession, setServerSession] = useState<FocusSessionSnapshot | null>(null);
  const [activeMode, setActiveMode] = useState<ModeId>("pomodoro");
  const [customMinutes, setCustomMinutes] = useState("");
  const [customBreak, setCustomBreak] = useState("");
  const [breakRemaining, setBreakRemaining] = useState(0);
  const [subjectId, setSubjectId] = useState("");
  const [mission, setMission] = useState<MissionLink | null>(null);
  const [missionPickerOpen, setMissionPickerOpen] = useState(false);
  const [displayRemaining, setDisplayRemaining] = useState(25 * 60);
  const [sessionResult, setSessionResult] = useState<{
    xpAwarded: number; levelUp: boolean; newLevel: number; completedMinutes: number;
    newAchievements: { name: string }[]; taskId?: string; reflectionSaved?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [quizPromptOpen, setQuizPromptOpen] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const [recapText, setRecapText] = useState<string | null>(null);
  const [dailyGoal, setDailyGoal] = useState(readGoal);
  const [showGoalEdit, setShowGoalEdit] = useState(false);
  const [goalInput, setGoalInput] = useState("");

  const offsetRef = useRef(0);
  const serverSessionRef = useRef<FocusSessionSnapshot | null>(null);
  const restoredRef = useRef(false);
  const finishingRef = useRef(false);
  const lastFinishedIdRef = useRef<string | null>(null);
  const finishRef = useRef<(early: boolean) => Promise<void>>(async () => {});

  const setSession = useCallback((s: FocusSessionSnapshot | null) => {
    serverSessionRef.current = s;
    setServerSession(s);
  }, []);

  // ── Derived config ──
  const modeConfig = MODES.find((m) => m.id === activeMode)!;
  const plannedMinutes =
    activeMode === "custom"
      ? Math.max(1, Math.min(240, Number(customMinutes) || 25))
      : modeConfig.minutes;
  const breakMinutes =
    activeMode === "custom"
      ? Math.max(0, Math.min(30, Number(customBreak) || 0))
      : modeConfig.breakMinutes;

  const selectedSubject = subjects?.find((s) => s._id === (subjectId as never));
  const canStart = !!subjectId && phase === "idle" && !busy;
  const isLowTime = phase === "running" && displayRemaining <= 60 && displayRemaining > 0;
  const progress =
    serverSession && (phase === "running" || phase === "paused")
      ? Math.max(0, Math.min(1, 1 - displayRemaining / (serverSession.plannedSeconds || 1)))
      : 0;

  // ── Reload recovery (server-aware) ──
  useEffect(() => {
    if (restoredRef.current || activeSession === undefined) return;
    restoredRef.current = true;
    if (activeSession) {
      offsetRef.current = activeSession.session.serverNow - Date.now();
      setSession(activeSession.session);
      setDisplayRemaining(Math.round(activeSession.remainingMs / 1000));
      setActiveMode(activeSession.session.mode);
      setPhase(activeSession.session.pausedAt ? "paused" : "running");
      setFocusMode("work");
      const mins = Math.round(activeSession.remainingMs / 60000);
      toast.info(`Welcome back — your session is still live.`, {
        description: `${mins} min remaining, timed on Learnyx servers.`,
      });
    }
  }, [activeSession, setSession, setFocusMode]);

  // Re-sync the local clock offset when the tab becomes visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && serverSessionRef.current) {
        offsetRef.current = serverSessionRef.current.serverNow - Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Finish (timer rang → complete; Esc / End early → honest partial) ──
  const handleFinish = useCallback(
    async (early: boolean) => {
      const s = serverSessionRef.current;
      if (!s || finishingRef.current) return;
      finishingRef.current = true;
      setBusy(true);
      lastFinishedIdRef.current = s.focusSessionId;
      try {
        const result = early
          ? await abandonSession({ focusSessionId: s.focusSessionId as never, localDate: localDateKey() })
          : await finishSession({ focusSessionId: s.focusSessionId as never, localDate: localDateKey() });
        setSession(null);
        setFocusMode("idle");
        const completedMinutes = Math.round(result.completedSeconds / 60);
        if (result.status === "completed" && !result.alreadyDone) {
          setSessionResult({
            xpAwarded: result.xpAwarded,
            levelUp: result.levelUp,
            newLevel: result.newLevel,
            completedMinutes,
            newAchievements: result.newAchievements ?? [],
            taskId: mission?.taskId,
          });
          setPhase("celebrating");
          playChime();
          sendNotification(
            "Focus session complete!",
            `${completedMinutes} min of ${selectedSubject?.name ?? "studying"} logged${result.xpAwarded > 0 ? ` (+${result.xpAwarded} XP)` : ""}`,
          );
          if (result.xpAwarded > 0) toast.success(`+${result.xpAwarded} XP earned.`);
          if (result.levelUp) toast.success(`Level up — you're now level ${result.newLevel}.`);
          for (const a of result.newAchievements ?? []) toast.success(`Achievement unlocked: ${a.name}`);
          generateRecap({ type: "focus_session" })
            .then((r) => { if (r.text) setRecapText(r.text); })
            .catch(() => {});
        } else if (result.status === "completed" && result.alreadyDone) {
          // Sweeper or another device already completed it.
          toast.info("This session was already completed on the server.");
          setPhase("idle");
        } else {
          // Honest partial — minutes kept, no completion XP.
          if (completedMinutes > 0) {
            toast.info(`Session ended early — ${completedMinutes} min kept. Streaks and hours count; completion XP waits for a full run.`);
          } else {
            toast.info("Session ended — under a minute, nothing logged.");
          }
          setPhase("idle");
        }
      } catch (error) {
        toast.error(friendlyError(error, "Could not complete the session."));
        setPhase("idle");
        setSession(null);
      } finally {
        finishingRef.current = false;
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [abandonSession, finishSession, friendlyError, generateRecap, mission?.taskId, selectedSubject, setFocusMode, setSession],
  );

  // Keep the tick's reference fresh without re-arming the interval.
  useEffect(() => {
    finishRef.current = handleFinish;
  }, [handleFinish]);

  // ── Tick: derive remaining from SERVER timestamps (no drift) ──
  useEffect(() => {
    if (phase !== "running" || !serverSession) return;
    const tick = () => {
      const remaining = Math.round(remainingMsOfSnapshot(serverSession, offsetRef.current) / 1000);
      setDisplayRemaining(remaining);
      if (remaining <= 0) void finishRef.current(false);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [phase, serverSession]);

  // ── Break countdown (client-side — breaks are not study time) ──
  useEffect(() => {
    if (phase !== "break") return;
    setFocusMode("break");
    if (music.autoScene) {
      const sceneId = music.sceneForMode("break");
      if (sceneId) music.applyScene(sceneId);
    }
    const interval = setInterval(() => {
      setBreakRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (phase === "break" && breakRemaining === 0) {
      playChime();
      sendNotification("Break over", "Ready for the next block when you are.");
      toast.success("Break complete — ready for the next block?");
      setFocusMode("idle");
      setPhase("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakRemaining, phase]);

  // ── Celebration → back to idle (+ quiz prompt) ──
  useEffect(() => {
    if (phase !== "celebrating" || !sessionResult) return;
    const timer = setTimeout(() => {
      setPhase("idle");
      if (sessionResult.xpAwarded > 0) setQuizPromptOpen(true);
    }, 8000);
    return () => clearTimeout(timer);
  }, [phase, sessionResult]);

  // ── Start ──
  const handleStart = useCallback(async () => {
    if (!subjectId) {
      toast.error("Choose a subject before starting.");
      return;
    }
    setBusy(true);
    try {
      const result = await startSession({
        mode: activeMode,
        plannedSeconds: plannedMinutes * 60,
        breakSeconds: breakMinutes > 0 ? breakMinutes * 60 : undefined,
        clientSessionId: newClientSessionId(),
        localDate: localDateKey(),
        subjectId: subjectId as never,
        taskId: mission?.taskId,
        planId: mission?.planId,
        planWeek: mission?.planWeek,
        missionLabel: mission?.label,
      });
      if (result.replaced) {
        const keptMin = Math.round(result.replaced.completedSeconds / 60);
        if (keptMin > 0) {
          toast.info(`Your previous session was ended — ${keptMin} min kept honestly (no completion XP).`);
        }
      }
      if (!result.session) throw new Error("Could not start the session.");
      offsetRef.current = result.session.serverNow - Date.now();
      setSession(result.session);
      setDisplayRemaining(result.session.plannedSeconds);
      setPhase("running");
      setFocusMode("work");
      // Audio ritual (Phase 7): apply the scene mapped to this mode — only
      // if the student enabled auto-scenes. The start click is a user
      // gesture, so autoplay policies are respected.
      if (music.autoScene) {
        const sceneId = music.sceneForMode(activeMode);
        if (sceneId) music.applyScene(sceneId);
      }
    } catch (error) {
      toast.error(friendlyError(error, "Could not start the session."));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, activeMode, plannedMinutes, breakMinutes, mission, startSession, friendlyError, music.autoScene, music.sceneForMode, music.applyScene, setSession, setFocusMode]);

  // ── Pause / resume ──
  const handlePause = useCallback(async () => {
    const s = serverSessionRef.current;
    if (!s) return;
    if (phase === "running") {
      setPhase("paused");
      try {
        const r = await pauseSession({ focusSessionId: s.focusSessionId as never });
        if (r.session) {
          offsetRef.current = r.session.serverNow - Date.now();
          setSession(r.session);
          setDisplayRemaining(Math.round(remainingMsOfSnapshot(r.session, offsetRef.current) / 1000));
        }
      } catch (error) {
        setPhase("running");
        toast.error(friendlyError(error, "Pause failed — still running."));
      }
    } else if (phase === "paused") {
      setPhase("running");
      try {
        const r = await resumeSession({ focusSessionId: s.focusSessionId as never });
        if (r.session) {
          offsetRef.current = r.session.serverNow - Date.now();
          setSession(r.session);
        }
      } catch (error) {
        setPhase("paused");
        toast.error(friendlyError(error, "Resume failed."));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pauseSession, resumeSession, friendlyError, setSession]);

  // ── Reflection (optional, one tap) ──
  const handleReflection = useCallback(
    async (reflection: "deep" | "solid" | "distracted", distractions?: number) => {
      const id = lastFinishedIdRef.current;
      if (!id) return;
      try {
        await addReflection({ focusSessionId: id as never, reflection, distractions });
        setSessionResult((prev) => (prev ? { ...prev, reflectionSaved: true } : prev));
        toast.success("Noted — this shapes your focus insights.");
      } catch {
        /* reflection is optional; stay quiet on failure */
      }
    },
    [addReflection],
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (phase === "idle" && canStart) void handleStart();
        else if (phase === "running" || phase === "paused") void handlePause();
      }
      if (e.code === "Escape" && (phase === "running" || phase === "paused")) {
        // Never silently discard: Esc ends early and keeps honest minutes.
        void handleFinish(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, canStart, handleStart, handlePause, handleFinish]);

  // ── Notification permission ──
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default" && localStorage.getItem(NOTIF_KEY) !== "asked") {
      Notification.requestPermission().then((p) => { if (p === "granted") localStorage.setItem(NOTIF_KEY, "granted"); });
    }
  }, []);

  // ── Derived: today stats ──
  const todayKey = localDateKey();
  const todayData = useMemo(() => {
    const sessions =
      recentSessions?.filter((s) => new Date(s.startedAt).toISOString().slice(0, 10) === todayKey) ?? [];
    return {
      sessions: sessions.length,
      minutes: sessions.reduce((sum, s) => sum + Math.round(s.durationSeconds / 60), 0),
    };
  }, [recentSessions, todayKey]);

  const goalProgress = dailyGoal > 0 ? Math.min(todayData.minutes / dailyGoal, 1) : 0;
  const totalFocusMinutes = useMemo(
    () => history?.reduce((sum, e) => sum + Math.round(e.seconds / 60), 0) ?? 0,
    [history],
  );

  const weekDays = useMemo(() => lastNDayWindows(7), []);
  const weekData = overview?.dailySeconds.slice(-7) ?? [];
  const weekMaxMin = useMemo(() => Math.max(1, ...weekData.map((d) => Math.round(d.seconds / 60))), [weekData]);
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const handleGoalSave = () => {
    const v = Number(goalInput);
    if (v >= 5 && v <= 480) { setDailyGoal(v); saveGoal(v); setShowGoalEdit(false); }
  };

  const statusLabel =
    phase === "running"
      ? `${modeConfig.label.toLowerCase()} in progress`
      : phase === "paused"
        ? "paused — timer frozen on the server"
        : phase === "break"
          ? "break — recharge"
          : phase === "celebrating"
            ? "session complete"
            : "ready when you are";

  // ── JSX ──
  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        {/* Header */}
        <div>
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">// {t("focus:eyebrow", { defaultValue: "flowstate" })}</p>
          <h1 className="type-h1 mt-1">{t("focus:title", { defaultValue: "Focus timer" })}</h1>
          <p className="type-body mt-1 text-muted-foreground">
            Deep work builds streaks, earns XP, and locks in knowledge.
          </p>
        </div>

        {/* ── Stats Bar ── */}
        <div className="grid grid-cols-3 gap-3">
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

          <div className="glass-soft flex items-center gap-3 rounded-xl px-4 py-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300">
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

          <div className="glass-soft relative flex flex-col justify-center rounded-xl px-4 py-3">
            {showGoalEdit ? (
              <div className="flex items-center gap-2">
                <Target className="size-4 shrink-0 text-amber-300" />
                <Input type="number" min={5} max={480} value={goalInput} onChange={(e) => setGoalInput(e.target.value)}
                  className="type-mono h-7 w-20 rounded-lg bg-white/5 text-xs px-2" placeholder="min" autoFocus onKeyDown={(e) => e.key === "Enter" && handleGoalSave()} />
                <button onClick={handleGoalSave} aria-label="Save daily goal" className="focus-ring text-xs text-amber-300 hover:text-amber-200">✓</button>
              </div>
            ) : (
              <button onClick={() => { setGoalInput(String(dailyGoal)); setShowGoalEdit(true); }}
                className="focus-ring w-full rounded-sm text-left">
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
                style={{ opacity: phase === "running" || phase === "break" ? 1 : 0.3 }} />
            </div>

            <div className="relative z-10 flex w-full flex-col items-center">
              {/* Status label */}
              <div className="flex items-center gap-2 type-mono text-[11px] text-muted-foreground">
                {phase === "break" ? <Coffee className="size-3.5 text-teal-300" /> : <Timer className="size-3.5 text-amber-300" />}
                {statusLabel}
                {serverSession && (phase === "running" || phase === "paused") && (
                  <span className="ml-1 hidden rounded border border-teal-400/25 bg-teal-400/[0.07] px-1.5 py-px font-mono text-[9px] text-teal-300 sm:inline">
                    server-timed
                  </span>
                )}
              </div>

              {/* Ring */}
              <div className="relative mt-6 flex size-60 items-center justify-center">
                <svg className="size-full -rotate-90" viewBox="0 0 200 200" aria-hidden="true">
                  <defs>
                    <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="oklch(0.76 0.13 255)" />
                      <stop offset="100%" stopColor="oklch(0.83 0.1 195)" />
                    </linearGradient>
                    <filter id="ringGlow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                  </defs>
                  <circle cx="100" cy="100" r={RING_RADIUS} fill="none" strokeWidth="5" className="stroke-white/8" />
                  <motion.circle cx="100" cy="100" r={RING_RADIUS} fill="none" strokeWidth="5" strokeLinecap="round"
                    stroke={phase === "break" ? "url(#ringGradient)" : "url(#ringGradient)"} strokeDasharray={RING_CIRCUMFERENCE}
                    animate={{ strokeDashoffset: RING_CIRCUMFERENCE * (1 - (phase === "break" ? (breakRemaining / Math.max(1, breakMinutes * 60)) : progress)) }}
                    transition={{ duration: 1, ease: "linear" }}
                    className={cn(isLowTime && "low-time-glow")}
                    style={{ filter: phase === "running" ? "url(#ringGlow)" : undefined }} />
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
                    {phase === "celebrating" && sessionResult ? (
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
                          phase === "break" ? "text-teal-300" : isLowTime ? "text-primary" : phase === "running" ? "text-foreground" : "text-muted-foreground")}>
                          {formatClock(phase === "break" ? breakRemaining : displayRemaining)}
                        </span>
                        <span className="type-caption uppercase tracking-[0.2em] text-muted-foreground">
                          {phase === "running" ? (isLowTime ? "final minute" : "in progress")
                            : phase === "paused" ? "paused" : phase === "break" ? "breathe" : phase === "celebrating" ? "complete" : "ready"}
                        </span>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Controls */}
              <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
                {(phase === "running" || phase === "paused") ? (
                  <>
                    <Button size="lg" className="rounded-xl interactive-press" onClick={() => void handlePause()}>
                      {phase === "running" ? <><Pause className="size-4" /> Pause</> : <><Play className="size-4" /> Resume</>}
                    </Button>
                    <Button size="lg" variant="outline" className="rounded-xl bg-white/5 interactive-press"
                      onClick={() => void handleFinish(true)} disabled={busy}>
                      <StopCircle className="size-4" /> End early
                    </Button>
                  </>
                ) : (
                  <Button size="lg" className="rounded-xl interactive-press" onClick={() => void handleStart()}
                    disabled={!subjectId || busy || phase === "celebrating"}>
                    {busy ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                    ) : <Play className="size-4" />}
                    {phase === "break" ? "Skip break · start next" : "Start session"}
                  </Button>
                )}
                <Button size="lg" variant="outline" className="rounded-xl bg-white/5 interactive-press"
                  onClick={() => { setPhase("idle"); setSession(null); setFocusMode("idle"); }}
                  disabled={phase === "running" || phase === "paused" || phase === "celebrating" || busy}>
                  <RotateCcw className="size-4" /> Reset
                </Button>
              </div>

              {/* Reflection (celebrating) */}
              <AnimatePresence>
                {phase === "celebrating" && sessionResult && (
                  <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="mt-4 flex flex-col items-center gap-2">
                    {sessionResult.taskId && (
                      <Button size="sm" variant="outline" className="rounded-lg bg-white/5"
                        onClick={() => {
                          void toggleTodo({ todoId: sessionResult.taskId as never })
                            .then(() => toast.success("Task marked done — nice."))
                            .catch(() => toast.error("Could not update the task."));
                        }}>
                        <ListTodo className="size-3.5" /> Mark linked task done
                      </Button>
                    )}
                    {sessionResult.reflectionSaved ? (
                      <p className="type-caption text-teal-300">Reflection saved ✓</p>
                    ) : (
                      <>
                        <p className="type-caption text-muted-foreground">How did it go?</p>
                        <div className="flex items-center gap-1.5">
                          {([
                            { id: "deep", label: "Went deep" },
                            { id: "solid", label: "Solid" },
                            { id: "distracted", label: "Got distracted" },
                          ] as const).map((r) => (
                            <button key={r.id} type="button"
                              onClick={() => void handleReflection(r.id, r.id === "distracted" ? 2 : undefined)}
                              className="focus-ring cursor-pointer rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition hover:border-teal-400/30 hover:text-foreground">
                              {r.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Config */}
              <div className="mt-7 flex w-full flex-col items-center gap-3 border-t border-white/8 pt-6">
                {/* Mode chips */}
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" onClick={() => setActiveMode(m.id)} disabled={phase !== "idle"}
                      className={cn("cursor-pointer rounded-xl border px-3 py-2 type-mono text-[11px] transition-all duration-200 interactive-press disabled:cursor-not-allowed disabled:opacity-50 focus-ring",
                        activeMode === m.id
                          ? "border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-6px_rgb(251,191,36/0.6)]"
                          : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground")}>
                      {m.label}
                      <span className="ml-1 opacity-40">{m.id === "custom" ? m.tag : m.breakMinutes > 0 ? `${m.minutes}+${m.breakMinutes}` : `${m.minutes}`}</span>
                    </button>
                  ))}
                </div>

                {/* Custom inputs */}
                {activeMode === "custom" && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={1} max={240} value={customMinutes} onChange={(e) => {
                        setCustomMinutes(e.target.value);
                      }} disabled={phase !== "idle"} placeholder="25" aria-label="Custom session minutes"
                        className="type-caption h-9 w-20 rounded-xl bg-white/5 disabled:opacity-50" />
                      <span className="type-caption text-muted-foreground">min focus</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Input type="number" min={0} max={30} value={customBreak} onChange={(e) => {
                        setCustomBreak(e.target.value);
                      }} disabled={phase !== "idle"} placeholder="0" aria-label="Custom break minutes"
                        className="type-caption h-9 w-16 rounded-xl bg-white/5 disabled:opacity-50" />
                      <span className="type-caption text-muted-foreground">min break</span>
                    </div>
                  </div>
                )}

                {/* Subject + mission row */}
                <div className="flex w-full max-w-md flex-col gap-2 sm:flex-row">
                  <div className="min-w-0 flex-1">
                    <Select value={subjectId} onValueChange={setSubjectId} disabled={phase !== "idle"}>
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
                  <Button variant="outline" className="h-10 shrink-0 rounded-xl bg-white/5"
                    onClick={() => setMissionPickerOpen(true)} disabled={phase !== "idle"}>
                    {mission ? (
                      <span className="flex min-w-0 items-center gap-1.5">
                        {mission.kind === "task" ? <ListTodo className="size-3.5 shrink-0 text-amber-300" /> : <GraduationCap className="size-3.5 shrink-0 text-amber-300" />}
                        <span className="max-w-36 truncate">{mission.label}</span>
                      </span>
                    ) : (
                      <><Target className="size-3.5" /> Mission</>
                    )}
                  </Button>
                </div>

                {/* Sound + ritual row */}
                <div className="flex w-full max-w-md flex-col gap-2">
                  <div className="flex w-full items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                    <button onClick={music.toggle} aria-label={music.playing ? "Pause ambient sound" : "Play ambient sound"}
                      className={cn("focus-ring flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                        music.playing ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground/50")}>
                      {music.playing ? <Volume2 className="size-3.5 animate-pulse" /> : <VolumeX className="size-3.5" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="type-caption font-semibold text-foreground/80">Atmosphere</p>
                      <p className="type-caption text-muted-foreground/60">
                        {music.playing ? music.track.label : "Play to focus"}
                      </p>
                    </div>
                    <button onClick={() => music.cycleTrack(1)} aria-label="Next track"
                      className="focus-ring flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/5 text-muted-foreground/50 hover:text-foreground transition-colors">
                      <SkipForward className="size-3.5" />
                    </button>
                    <AudioLines className="hidden size-3.5 text-muted-foreground/40 sm:block" aria-hidden />
                  </div>

                  {/* Audio ritual (Phase 7) */}
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                    <div className="min-w-0">
                      <p className="type-caption font-semibold text-foreground/80">Auto scenes</p>
                      <p className="type-caption text-muted-foreground/60">
                        {music.autoScene
                          ? `Each mode starts its own atmosphere${music.sceneForMode(activeMode) ? ` · ${SCENES.find((s) => s.id === music.sceneForMode(activeMode))?.label}` : " · none set"}`
                          : "Off — you choose the sound"}
                      </p>
                    </div>
                    <Switch checked={music.autoScene} onCheckedChange={music.setAutoScene}
                      aria-label="Automatically apply an audio scene when a session starts" />
                  </div>
                </div>

                {/* Keyboard hint */}
                <p className="type-caption text-muted-foreground/40">
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">Space</kbd> start / pause
                  &nbsp;&middot;&nbsp;
                  <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px]">Esc</kbd> end early (keeps minutes)
                </p>
              </div>
            </div>

            {/* Active session badge */}
            {selectedSubject && (phase === "running" || phase === "paused") && (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="absolute bottom-4 left-4">
                <Badge className="gap-1 bg-amber-400/10 font-mono text-[10px] text-amber-300 border-amber-400/15">
                  logging to: {selectedSubject.name}{mission ? ` · ${mission.label.slice(0, 24)}` : ""}
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
                  const entry = weekData[i];
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

            {/* Focus intelligence (Phase 8) */}
            <FocusIntelligence
              overview={overview}
              streak={streak ? { currentStreak: streak.currentStreak, longestStreak: streak.longestStreak } : undefined}
              dailyGoal={dailyGoal}
              todayMinutes={todayData.minutes}
            />

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
                <div className="mt-3 space-y-2 max-h-[280px] overflow-y-auto pr-1" data-scroll-contain>
                  {recentSessions.slice(0, 12).map((s, i) => {
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
                  {history.slice(0, 6).map((entry, i) => (
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
            className="mx-auto mt-4 w-full max-w-5xl glass-panel flex items-start gap-3 rounded-2xl p-5">
            <Sparkles className="size-5 shrink-0 text-amber-300 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="type-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300 mb-1">// study recap</p>
              <p className="type-body leading-relaxed text-muted-foreground">{recapText}</p>
            </div>
            <button onClick={() => setRecapText(null)} aria-label="Dismiss recap" className="focus-ring shrink-0 text-muted-foreground/50 hover:text-foreground transition-colors interactive-press p-1 rounded-lg">
              <XCircle className="size-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mission picker dialog */}
      <MissionPicker
        open={missionPickerOpen}
        onOpenChange={setMissionPickerOpen}
        subjectId={subjectId}
        current={mission}
        onPick={setMission}
      />

      {/* Quiz prompt */}
      <Dialog open={quizPromptOpen} onOpenChange={setQuizPromptOpen}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 type-h3"><Sparkles className="size-4 text-amber-300" /> Nice work</DialogTitle>
            <DialogDescription className="type-body">
              {selectedSubject ? `You just logged ${sessionResult?.completedMinutes ?? 0} min of ${selectedSubject.name}. Want a quick check to lock it in?` : "Great session! Want a quick quiz?"}
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
