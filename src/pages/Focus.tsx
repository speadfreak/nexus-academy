import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Flame,
  History,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Timer,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { formatClock, localDateKey } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "25 min", minutes: 25 },
  { label: "50 min", minutes: 50 },
];

type TimerStatus = "idle" | "running" | "paused" | "done";

export default function Focus() {
  const subjects = useQuery(api.subjects.getAll);
  const history = useQuery(api.studySessions.getHistory);
  const logSession = useMutation(api.studySessions.logSession);

  const [subjectId, setSubjectId] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState("");
  const [status, setStatus] = useState<TimerStatus>("idle");
  const [remaining, setRemaining] = useState(25 * 60);
  const [logging, setLogging] = useState(false);

  const startedAtRef = useRef<number>(0);
  const loggedRef = useRef(false);

  // Reset the clock whenever the configured duration changes while idle.
  useEffect(() => {
    if (status === "idle") setRemaining(minutes * 60);
  }, [minutes, status]);

  // Tick while running.
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

  // Persist the completed session. loggedRef guards against double-firing
  // (e.g. strict-mode effect re-runs) so a session is never counted twice.
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
      .then(() => {
        toast.success(`Session logged — ${formatClock(durationSeconds)} of focus.`);
        setStatus("idle");
        setRemaining(minutes * 60);
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
  }, [status, subjectId, minutes, logSession]);

  const handleStart = () => {
    if (!subjectId) {
      toast.error("Choose a subject before starting.");
      return;
    }
    loggedRef.current = false;
    startedAtRef.current = Date.now();
    setStatus("running");
  };

  const handlePause = () => setStatus((s) => (s === "running" ? "paused" : "running"));
  const handleReset = () => {
    setStatus("idle");
    setRemaining(minutes * 60);
  };

  const applyPreset = (value: number) => {
    if (status !== "idle") return;
    setMinutes(value);
    setRemaining(value * 60);
  };

  const progress = minutes > 0 ? 1 - remaining / (minutes * 60) : 0;
  const RING_CIRCUMFERENCE = 2 * Math.PI * 88;
  const selectedSubject = subjects?.find((s) => s._id === (subjectId as never));

  return (
    <DashboardShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
            // focus sessions
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">Focus timer</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every completed session is logged to your streak and study history.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          {/* ------- Timer ------- */}
          <div className="glass-panel flex flex-col items-center rounded-2xl p-8">
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <Timer className="size-3.5 text-primary" />
              {status === "running"
                ? "session in progress"
                : status === "paused"
                  ? "paused"
                  : status === "done"
                    ? "session complete"
                    : "ready when you are"}
            </div>

            {/* Circular progress ring — depletes as the session runs */}
            <div className="relative mt-6 flex size-56 items-center justify-center">
              <svg className="size-full -rotate-90" viewBox="0 0 200 200">
                <defs>
                  <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="oklch(0.76 0.13 255)" />
                    <stop offset="100%" stopColor="oklch(0.83 0.1 195)" />
                  </linearGradient>
                </defs>
                <circle
                  cx="100"
                  cy="100"
                  r="88"
                  fill="none"
                  strokeWidth="6"
                  className="stroke-white/8"
                />
                <motion.circle
                  cx="100"
                  cy="100"
                  r="88"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  stroke="url(#ringGradient)"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  animate={{ strokeDashoffset: RING_CIRCUMFERENCE * progress }}
                  transition={{ duration: 1, ease: "linear" }}
                  className={cn(
                    status === "running" && remaining <= 60 && "low-time-glow",
                  )}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                <span
                  className={cn(
                    "font-mono text-5xl font-bold tracking-tight tabular-nums",
                    status === "running" ? "text-foreground" : "text-muted-foreground",
                    status === "running" && remaining <= 60 && "animate-pulse text-primary",
                  )}
                >
                  {formatClock(remaining)}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {status === "running"
                    ? remaining <= 60
                      ? "final minute"
                      : "in progress"
                    : status === "paused"
                      ? "paused"
                      : status === "done"
                        ? "complete"
                        : "ready"}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="mt-7 flex items-center gap-2">
              {status === "running" || status === "paused" ? (
                <Button size="lg" className="rounded-xl" onClick={handlePause}>
                  {status === "running" ? (
                    <>
                      <Pause className="size-4" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="size-4" /> Resume
                    </>
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="rounded-xl"
                  onClick={handleStart}
                  disabled={!subjectId || logging}
                >
                  {logging ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                  Start session
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                className="rounded-xl bg-white/5"
                onClick={handleReset}
                disabled={status === "idle"}
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
                      "cursor-pointer rounded-xl border px-4 py-2 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      minutes === preset.minutes
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min={1}
                    max={120}
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
                    className="h-9 w-20 rounded-xl bg-white/5 font-mono text-xs disabled:opacity-50"
                  />
                  <span className="font-mono text-[10px] text-muted-foreground">custom</span>
                </div>
              </div>

              <div className="w-full max-w-xs">
                <Select value={subjectId} onValueChange={setSubjectId} disabled={status !== "idle"}>
                  <SelectTrigger className="h-10 w-full rounded-xl bg-white/5 font-mono text-xs">
                    <SelectValue placeholder="Subject for this session…" />
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
            </div>
          </div>

          {/* ------- History ------- */}
          <div className="glass-panel flex flex-col rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                // history
              </p>
              <History className="size-4 text-muted-foreground" />
            </div>

            {history === undefined ? (
              <div className="flex flex-1 items-center justify-center py-12">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                <Flame className="size-8 text-primary/40" />
                <p className="mt-3 text-sm font-semibold">No sessions yet</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  Complete a focus session and your time-per-subject shows up here.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2">
                {history.map((entry) => (
                  <motion.div
                    key={entry.subjectId}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="glass-soft flex items-center justify-between gap-3 rounded-xl px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{entry.subjectName}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {entry.count} session{entry.count === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm font-bold tabular-nums">
                        {entry.hours} h
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {Math.round(entry.seconds / 60)} min
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {selectedSubject && status === "running" && (
              <Badge className="mt-4 w-fit gap-1 bg-primary/10 font-mono text-[10px] text-primary">
                logging to: {selectedSubject.name}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
