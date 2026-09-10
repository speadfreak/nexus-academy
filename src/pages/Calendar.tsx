// Calendar — Student Command Center.
//
// Features:
//   - Today's Mission panel (what to study today + total load)
//   - Exam countdown mode (days until next exam)
//   - Week view with study blocks (from AI plans), exams, reminders
//   - Study load calculation (total planned minutes per day)
//   - Quick stats: study time this week, sessions, plan completion
//   - Cross-platform links: study blocks → Plans, flashcards → Flashcards
//
// Uses existing calendar backend (listEvents, createEvent, deleteEvent).
// New features (today's load, exam countdown, weekly stats) are
// computed client-side from the existing event data.

import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Link2,
  Plus,
  Rocket,
  Target,
  Trash2,
  TrendingUp,
  Zap,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type EventType = "study_block" | "exam" | "reminder" | "custom";
type EventRow = Doc<"calendarEvents"> & { subjectName: string | null };

const TYPE_META: Record<EventType, { label: string; classes: string; dot: string; icon: typeof Clock }> = {
  study_block: { label: "study", classes: "glass-chip border-primary/30 text-primary", dot: "bg-primary", icon: Clock },
  exam: { label: "exam", classes: "glass-chip border-rose-400/30 text-rose-300", dot: "bg-rose-400", icon: AlertCircle },
  reminder: { label: "reminder", classes: "glass-chip border-amber-400/30 text-amber-300", dot: "bg-amber-400", icon: Target },
  custom: { label: "custom", classes: "glass-chip border-violet-400/30 text-violet-300", dot: "bg-violet-400", icon: Zap },
};

const WEEK_START_MS = 24 * 60 * 60 * 1000;

function startOfWeek(date: Date): Date {
  const day = date.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
  start.setHours(0, 0, 0, 0);
  return start;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function toLocalInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / (60 * 1000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

interface EventDraft {
  title: string;
  type: EventType;
  subjectId: string;
  startAt: string;
  endAt: string;
}

export default function CalendarPage() {
  const { t } = useTranslation(["calendar", "common"]);
  const [weekOffset, setWeekOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);

  const subjects = useQuery(api.subjects.getAll);
  const weekDays = useMemo(() => {
    const monday = startOfWeek(new Date());
    monday.setDate(monday.getDate() + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      return date;
    });
  }, [weekOffset]);

  const rangeStart = weekDays[0]!.getTime();
  const rangeEnd = weekDays[6]!.getTime() + WEEK_START_MS;

  const events = useQuery(api.calendar.listEvents, {
    startAt: rangeStart,
    endAt: rangeEnd,
  });

  const createEvent = useMutation(api.calendar.createEvent);
  const deleteEvent = useMutation(api.calendar.deleteEvent);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const day of weekDays) {
      map.set(day.toDateString(), []);
    }
    for (const event of events ?? []) {
      const day = new Date(event.startAt).toDateString();
      const list = map.get(day) ?? [];
      list.push(event);
      map.set(day, list);
    }
    for (const list of map.values()) list.sort((a, b) => a.startAt - b.startAt);
    return map;
  }, [events, weekDays]);

  // ── Today's events + study load ─────────────────────────────────────
  const todayKey = new Date().toDateString();
  const todayEvents = eventsByDay.get(todayKey) ?? [];
  const todayStudyLoad = useMemo(() => {
    return todayEvents.reduce((sum, e) => {
      if (e.endAt) return sum + (e.endAt - e.startAt);
      return sum + 60 * 60 * 1000; // default 1 hour
    }, 0);
  }, [todayEvents]);

  // ── Weekly stats ─────────────────────────────────────────────────────
  const weeklyStats = useMemo(() => {
    const allEvents = events ?? [];
    const studyBlocks = allEvents.filter((e) => e.type === "study_block");
    const exams = allEvents.filter((e) => e.type === "exam");
    const totalStudyTime = studyBlocks.reduce((sum, e) => {
      return sum + (e.endAt ? e.endAt - e.startAt : 60 * 60 * 1000);
    }, 0);
    return {
      sessions: studyBlocks.length,
      studyTime: totalStudyTime,
      exams: exams.length,
      totalEvents: allEvents.length,
    };
  }, [events]);

  // ── Next exam countdown ─────────────────────────────────────────────
  const nextExam = useMemo(() => {
    const exams = (events ?? []).filter((e) => e.type === "exam" && e.startAt > Date.now());
    if (exams.length === 0) return null;
    exams.sort((a, b) => a.startAt - b.startAt);
    return exams[0]!;
  }, [events]);

  const examDaysLeft = nextExam ? Math.ceil((nextExam.startAt - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  // ── Handlers ─────────────────────────────────────────────────────────
  const openCreate = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setDraft({
      title: "",
      type: "custom",
      subjectId: "",
      startAt: toLocalInputValue(start),
      endAt: toLocalInputValue(end),
    });
    setCreating(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    if (!draft.title.trim()) { toast.error("Give the event a title."); return; }
    const startAt = new Date(draft.startAt).getTime();
    const endAt = new Date(draft.endAt).getTime();
    if (!Number.isFinite(startAt)) { toast.error("Pick a start time."); return; }
    if (!Number.isFinite(endAt) || endAt <= startAt) { toast.error("End time must be after the start time."); return; }
    setSaving(true);
    try {
      await createEvent({
        title: draft.title.trim(),
        type: draft.type,
        subjectId: draft.subjectId ? (draft.subjectId as never) : undefined,
        startAt,
        endAt,
      });
      toast.success("Event added to your calendar.");
      setCreating(false);
      setDraft(null);
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the event."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (event: EventRow) => {
    setDeletingId(event._id);
    try {
      await deleteEvent({ eventId: event._id as never });
      toast.success("Event removed.");
      setSelectedEvent(null);
    } catch (error) {
      toast.error(errorMessage(error, "Could not delete the event."));
    } finally {
      setDeletingId(null);
    }
  };

  const monthLabel = weekDays[0]!.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekLabel =
    weekDays[0]!.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " – " +
    weekDays[6]!.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <DashboardShell>
      <div className="relative flex flex-col gap-6">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-10 -right-6 size-44 rounded-full bg-amber-400/8 blur-[80px]" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-0 -left-10 size-36 rounded-full bg-amber-400/[0.05] blur-[64px]" aria-hidden="true" />

        {/* ── Header ───────────────────────────────────────────────────── */}
        <motion.div
          className="flex flex-wrap items-end justify-between gap-3 relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // {t("calendar:eyebrow", { defaultValue: "schedule · calendar" })}
            </p>
            <h1 className="mt-1 type-h1">
              Student <span className="text-gradient">Command Center</span>
            </h1>
            <p className="mt-1 type-body text-muted-foreground">
              Your daily operating system — study blocks, exams, and your mission for today.
            </p>
          </div>
          <Button className="interactive-press rounded-xl" onClick={openCreate}>
            <Plus className="size-4" /> New event
          </Button>
        </motion.div>

        {/* ── Today's Mission + Exam Countdown ─────────────────────────── */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Today's Mission */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="glass-panel relative overflow-hidden rounded-2xl p-5"
          >
            <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <Flame className="size-5 text-emerald-400" />
                <p className="text-sm font-bold uppercase tracking-wider text-emerald-300">Today's Mission</p>
              </div>
              {todayEvents.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No study blocks scheduled for today. Add an event or generate an AI plan to auto-schedule.
                </p>
              ) : (
                <>
                  <p className="mt-3 text-2xl font-extrabold tabular-nums text-foreground">
                    {formatDuration(todayStudyLoad)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">total planned for today</p>
                  <div className="mt-3 space-y-1.5">
                    {todayEvents.slice(0, 4).map((event) => {
                      const Icon = TYPE_META[event.type].icon;
                      return (
                        <div key={event._id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
                          <Icon className={cn("size-3.5 shrink-0", TYPE_META[event.type].dot.replace("bg-", "text-"))} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold">{event.title}</p>
                            <p className="text-[10px] text-muted-foreground">{formatTime(event.startAt)}{event.endAt ? ` – ${formatTime(event.endAt)}` : ""}</p>
                          </div>
                        </div>
                      );
                    })}
                    {todayEvents.length > 4 && (
                      <p className="text-[10px] text-muted-foreground">+ {todayEvents.length - 4} more</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>

          {/* Exam Countdown */}
          {nextExam && examDaysLeft !== null && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="glass-panel relative overflow-hidden rounded-2xl p-5"
            >
              <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-rose-400/10 blur-3xl" />
              <div className="relative">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-5 text-rose-400" />
                  <p className="text-sm font-bold uppercase tracking-wider text-rose-300">Next Exam</p>
                </div>
                <p className="mt-3 text-2xl font-extrabold tabular-nums text-foreground">{examDaysLeft}</p>
                <p className="text-[11px] text-muted-foreground">days until {nextExam.title}</p>
                <div className="mt-3">
                  <div className="h-2 overflow-hidden rounded-full bg-white/5">
                    <motion.div
                      className={cn("h-full rounded-full", examDaysLeft <= 7 ? "bg-rose-500" : examDaysLeft <= 30 ? "bg-amber-400" : "bg-emerald-400")}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(10, 100 - (examDaysLeft / 365) * 100)}%` }}
                      transition={{ duration: 0.8 }}
                    />
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full rounded-xl bg-white/5 text-rose-300 hover:bg-rose-400/10"
                  onClick={() => setSelectedEvent(nextExam)}
                >
                  <Rocket className="size-3.5" /> View details
                </Button>
              </div>
            </motion.div>
          )}

          {/* Weekly Stats */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="glass-panel relative overflow-hidden rounded-2xl p-5"
          >
            <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-amber-400/10 blur-3xl" />
            <div className="relative">
              <div className="flex items-center gap-2">
                <TrendingUp className="size-5 text-amber-300" />
                <p className="text-sm font-bold uppercase tracking-wider text-amber-300">This Week</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xl font-extrabold tabular-nums text-foreground">{formatDuration(weeklyStats.studyTime)}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Study time</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold tabular-nums text-foreground">{weeklyStats.sessions}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sessions</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold tabular-nums text-foreground">{weeklyStats.totalEvents}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total events</p>
                </div>
                <div>
                  <p className="text-xl font-extrabold tabular-nums text-foreground">{weeklyStats.exams}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Exams</p>
                </div>
              </div>
              <Link
                to="/flashcards"
                className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-amber-300/70 hover:text-amber-300"
              >
                <Flame className="size-3" /> Go to Flashcards →
              </Link>
            </div>
          </motion.div>
        </div>

        {/* ── Week header ─────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
        >
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="icon" className="interactive-press size-8 cursor-pointer text-muted-foreground" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="interactive-press size-8 cursor-pointer text-muted-foreground" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className={cn("interactive-press ml-1 h-8 cursor-pointer rounded-lg type-caption", weekOffset === 0 && "border-amber-400/40 bg-amber-400/10 text-amber-300 shadow-[0_0_12px_-4px_rgb(251,191,36/0.5)] ring-1 ring-amber-400/30")}
              onClick={() => setWeekOffset(0)}
            >
              Today
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-amber-300" />
            <p className="type-body font-semibold tracking-tight">{monthLabel}</p>
            <span className="type-caption text-muted-foreground">{weekLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            {(Object.keys(TYPE_META) as EventType[]).map((type) => (
              <span key={type} className="flex items-center gap-1.5 type-caption text-muted-foreground">
                <span className={cn("size-2 rounded-full", TYPE_META[type].dot)} />
                {TYPE_META[type].label}
              </span>
            ))}
          </div>
        </motion.div>

        {/* ── Week grid ──────────────────────────────────────────────── */}
        {events === undefined ? (
          <div className="flex h-48 items-center justify-center">
            <motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-5 rounded-full border-2 border-primary/30 border-t-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
            {weekDays.map((day, dayIndex) => {
              const key = day.toDateString();
              const dayEvents = eventsByDay.get(key) ?? [];
              const isToday = key === todayKey;
              const dayStudyTime = dayEvents.reduce((sum, e) => {
                if (e.type === "study_block" && e.endAt) return sum + (e.endAt - e.startAt);
                return sum;
              }, 0);

              return (
                <motion.div
                  key={key}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.04 * dayIndex, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "glass-panel flex min-h-44 flex-col rounded-2xl p-3 hover-lift",
                    isToday && "border-primary/30 shadow-[0_0_16px_-4px_rgb(251,191,36/0.6)] ring-1 ring-amber-400/30",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("type-caption uppercase tracking-wider font-bold", isToday ? "text-primary" : "text-muted-foreground")}>
                      {day.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                    <span className={cn("flex size-6 items-center justify-center rounded-lg type-mono font-bold", isToday ? "bg-primary text-primary-foreground shadow-[0_0_12px_-4px_rgb(251,191,36/0.5)]" : "text-muted-foreground")}>
                      {day.getDate()}
                    </span>
                  </div>
                  {/* Daily study load indicator */}
                  {dayStudyTime > 0 && (
                    <p className="mt-1 text-[9px] font-semibold text-amber-300/70">
                      {formatDuration(dayStudyTime)} study
                    </p>
                  )}
                  <div className="mt-2.5 flex flex-1 flex-col gap-1.5">
                    {dayEvents.length === 0 ? (
                      <p className="pt-2 text-center type-caption text-muted-foreground/40">—</p>
                    ) : (
                      dayEvents.map((event) => {
                        const Icon = TYPE_META[event.type].icon;
                        return (
                          <button
                            key={event._id}
                            type="button"
                            onClick={() => setSelectedEvent(event)}
                            className={cn("hover-lift interactive-press w-full cursor-pointer rounded-lg border px-2 py-1.5 text-left", TYPE_META[event.type].classes)}
                          >
                            <div className="flex items-center gap-1.5">
                              <Icon className="size-3 shrink-0 opacity-60" />
                              <p className="truncate text-[11px] font-bold leading-4">{event.title}</p>
                            </div>
                            <p className="mt-0.5 flex items-center gap-1 font-mono text-[8.5px] opacity-80">
                              <Clock className="size-2.5" />
                              {formatTime(event.startAt)}{event.endAt ? `–${formatTime(event.endAt)}` : ""}
                            </p>
                          </button>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        <p className="type-caption text-muted-foreground">
          Study blocks are generated when you create an AI plan. Regenerating a plan replaces its blocks automatically.
        </p>
      </div>

      {/* ── Create dialog ─────────────────────────────────────────────── */}
      <Dialog open={creating} onOpenChange={(open) => !open && setCreating(false)}>
        <DialogContent className="glass-panel rounded-2xl">
          <DialogHeader>
            <DialogTitle>New event</DialogTitle>
            <DialogDescription>Exam date, reminder, or your own study block.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex flex-col gap-3">
              <Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Mock exam — Grade 12 Physics" className="h-10 rounded-xl bg-white/5 font-mono text-sm" />
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">Type</span>
                  <Select value={draft.type} onValueChange={(value) => setDraft({ ...draft, type: value as EventType })}>
                    <SelectTrigger className="h-10 rounded-xl bg-white/5 font-mono text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="study_block">Study block</SelectItem>
                      <SelectItem value="exam">Exam</SelectItem>
                      <SelectItem value="reminder">Reminder</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">Subject</span>
                  <Select value={draft.subjectId} onValueChange={(value) => setDraft({ ...draft, subjectId: value })}>
                    <SelectTrigger className="h-10 rounded-xl bg-white/5 font-mono text-xs"><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {subjects?.map((s) => (<SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">Start</span>
                  <Input type="datetime-local" value={draft.startAt} onChange={(e) => setDraft({ ...draft, startAt: e.target.value })} className="h-10 rounded-xl bg-white/5 font-mono text-xs" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">End</span>
                  <Input type="datetime-local" value={draft.endAt} onChange={(e) => setDraft({ ...draft, endAt: e.target.value })} className="h-10 rounded-xl bg-white/5 font-mono text-xs" />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" className="interactive-press rounded-xl bg-white/5" onClick={() => setCreating(false)}>Cancel</Button>
            <Button className="interactive-press rounded-xl" onClick={handleSave} disabled={saving}>
              {saving ? (<motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-4 rounded-full border-2 border-primary/30 border-t-primary" />) : (<Plus className="size-4" />)}
              Add event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Event detail dialog ───────────────────────────────────────── */}
      <Dialog open={selectedEvent !== null} onOpenChange={(open) => !open && setSelectedEvent(null)}>
        <DialogContent className="glass-panel rounded-2xl">
          <AnimatePresence>
            {selectedEvent && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <span className={cn("size-2.5 rounded-full", TYPE_META[selectedEvent.type].dot)} />
                    {selectedEvent.title}
                  </DialogTitle>
                  <DialogDescription>
                    {new Date(selectedEvent.startAt).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}{" "}· {formatTime(selectedEvent.startAt)}{selectedEvent.endAt ? ` – ${formatTime(selectedEvent.endAt)}` : ""}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-2 py-2">
                  <p className="flex items-center gap-2 type-mono uppercase tracking-[0.22em] text-muted-foreground">
                    type: {TYPE_META[selectedEvent.type].label}
                  </p>
                  {selectedEvent.subjectName && (
                    <p className="flex items-center gap-2 type-mono uppercase tracking-[0.22em] text-muted-foreground">
                      subject: {selectedEvent.subjectName}
                    </p>
                  )}
                  {selectedEvent.endAt && (
                    <p className="flex items-center gap-2 type-mono uppercase tracking-[0.22em] text-muted-foreground">
                      duration: {formatDuration(selectedEvent.endAt - selectedEvent.startAt)}
                    </p>
                  )}
                  {selectedEvent.sourceStudyPlanId && (
                    <Link to="/plans" className="interactive-press flex items-center gap-2 uppercase tracking-[0.22em] text-amber-300 font-semibold hover:underline">
                      <Link2 className="size-3 text-amber-300/60" /> generated from an AI study plan — open plans
                    </Link>
                  )}
                  {/* Cross-platform: link to Flashcards for study blocks */}
                  {selectedEvent.type === "study_block" && selectedEvent.subjectName && (
                    <Link to="/flashcards" className="interactive-press flex items-center gap-2 uppercase tracking-[0.22em] text-violet-300 font-semibold hover:underline">
                      <Flame className="size-3 text-violet-300/60" /> study flashcards for {selectedEvent.subjectName}
                    </Link>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" className="interactive-press rounded-xl bg-white/5 text-muted-foreground hover:text-destructive" disabled={deletingId === selectedEvent._id} onClick={() => handleDelete(selectedEvent)}>
                    {deletingId === selectedEvent._id ? (<motion.div animate={{ rotate: 360 }} transition={{ duration: 1.2, repeat: Infinity, ease: "linear" }} className="size-4 rounded-full border-2 border-primary/30 border-t-primary" />) : (<Trash2 className="size-4" />)}
                    Delete
                  </Button>
                  <Button variant="outline" className="interactive-press rounded-xl bg-white/5" onClick={() => setSelectedEvent(null)}>
                    <X className="size-4" /> Close
                  </Button>
                </DialogFooter>
              </motion.div>
            )}
          </AnimatePresence>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}
