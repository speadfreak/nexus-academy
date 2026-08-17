import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BellRing,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Crown,
  Download,
  FileSearch,
  Flame,
  GraduationCap,
  HelpCircle,
  Loader2,
  MessageSquare,
  Presentation,
  Quote,
  RotateCcw,
  Search,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { lastNDayWindows, localDateKey } from "@/lib/dates";
import { DashboardShell } from "@/components/DashboardShell";
import { QuizFlow } from "@/components/QuizFlow";
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
import {
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  type ContentType,
} from "@/convex/constants";
import type { ContentItemWithSubject } from "@/convex/content";
import { cn } from "@/lib/utils";

const TYPE_STYLES: Record<
  ContentType,
  { icon: typeof BookOpen; classes: string }
> = {
  textbook: { icon: BookOpen, classes: "bg-indigo-400/10 text-indigo-300" },
  past_exam: { icon: CalendarDays, classes: "bg-sky-400/10 text-sky-300" },
  worksheet: { icon: ClipboardList, classes: "bg-violet-400/10 text-violet-300" },
  student_guide: { icon: GraduationCap, classes: "bg-teal-400/10 text-teal-300" },
  teacher_guide: { icon: Presentation, classes: "bg-amber-400/10 text-amber-300" },
};

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Animated count-up for stat numbers — respects prefers-reduced-motion. */
function StatNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const duration = 700;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{display.toFixed(decimals)}</>;
}

function ContentCard({
  item,
  onOpen,
  onQuiz,
  opening,
}: {
  item: ContentItemWithSubject;
  onOpen: (item: ContentItemWithSubject) => void;
  onQuiz: (item: ContentItemWithSubject) => void;
  opening: boolean;
}) {
  const style = TYPE_STYLES[item.contentType];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="glass-panel group flex flex-col rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-1"
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`flex size-11 items-center justify-center rounded-xl ${style.classes}`}>
          <style.icon className="size-5" />
        </div>
        <div className="flex items-center gap-1.5">
          {item.isPremium && (
            <Badge className="gap-1 bg-amber-400/10 text-amber-300">
              <Sparkles className="size-3" /> Premium
            </Badge>
          )}
          <Link
            to={`/tutor?subject=${encodeURIComponent(item.subjectSlug)}&contentId=${item._id}`}
            title={`Ask the tutor about ${item.title}`}
            aria-label={`Ask the tutor about ${item.title}`}
            className="flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <MessageSquare className="size-3.5" />
          </Link>
          <button
            type="button"
            onClick={() => onQuiz(item)}
            title={`Quick check on ${item.subjectName}`}
            aria-label={`Start a quiz for ${item.subjectName}`}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <HelpCircle className="size-3.5" />
          </button>
        </div>
      </div>

      <h3 className="mt-4 line-clamp-2 text-sm font-bold leading-snug tracking-tight">
        {item.title}
      </h3>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
        <span className="glass-chip rounded-md px-2 py-0.5 text-muted-foreground">
          {item.subjectName}
        </span>
        <span className="glass-chip rounded-md px-2 py-0.5 text-muted-foreground">
          Grade {item.grade}
        </span>
        {item.examYear ? (
          <span className="glass-chip rounded-md px-2 py-0.5 text-muted-foreground">
            {item.examYear}
          </span>
        ) : null}
      </div>

      <div className="mt-3 text-[11px] text-muted-foreground">
        {formatBytes(item.fileSizeBytes)}
        {item.pageCount ? ` · ${item.pageCount} pages` : ""}
      </div>

      <Button
        size="sm"
        variant="outline"
        className="mt-4 w-full cursor-pointer rounded-xl bg-white/5"
        onClick={() => onOpen(item)}
        disabled={opening}
      >
        {opening ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Download className="size-3.5" />
        )}
        {item.isPremium ? "Open signed copy" : "Open"}
      </Button>
    </motion.div>
  );
}

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [grade, setGrade] = useState("");
  const [subjectSlug, setSubjectSlug] = useState("");
  const [contentType, setContentType] = useState("");
  const [examYear, setExamYear] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [quizSubjectId, setQuizSubjectId] = useState<string>("");
  const [quizOpen, setQuizOpen] = useState(false);

  const subjects = useQuery(api.subjects.getAll);
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const getDownloadUrl = useAction(api.contentAdmin.getDownloadUrl);

  // Daily quote: reactive query + one on-demand backfill so the AI quote is
  // generated even before the daily cron runs.
  const quote = useQuery(api.quotes.getTodaysQuote);
  const ensureQuote = useAction(api.quotes.ensureTodaysQuote);
  const quoteSyncedRef = useRef(false);
  useEffect(() => {
    if (quoteSyncedRef.current) return;
    quoteSyncedRef.current = true;
    void ensureQuote().catch(() => {});
  }, [ensureQuote]);

  // Trial/subscription state + reminder banner (single source of truth).
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const reminder = useQuery(api.reminders.getReminderBanner);
  const syncReminders = useMutation(api.reminders.syncReminderSettings);
  const dismissReminder = useMutation(api.reminders.dismissReminder);

  // Make sure reminder settings exist for this user (idempotent).
  const remindersSyncedRef = useRef(false);
  useEffect(() => {
    if (remindersSyncedRef.current) return;
    remindersSyncedRef.current = true;
    void syncReminders().catch(() => {});
  }, [syncReminders]);

  const content = useQuery(api.content.getContent, {
    grade: grade ? Number(grade) : undefined,
    subjectSlug: subjectSlug || undefined,
    contentType: (contentType || undefined) as ContentType | undefined,
    examYear: examYear ? Number(examYear) : undefined,
    searchQuery: searchQuery.trim() || undefined,
  });

  const streak = useQuery(api.studySessions.getStreak);
  const todos = useQuery(api.todos.list);
  const todayKey = localDateKey();
  const weekDays = useMemo(() => lastNDayWindows(7), [todayKey]);
  const weekActivity = useQuery(api.studySessions.getWeekActivity, {
    days: weekDays as never,
  });

  const pendingTodoCount = useMemo(
    () => todos?.filter((todo) => !todo.isDone).length ?? 0,
    [todos],
  );
  const weekHours = useMemo(
    () => (weekActivity ?? []).reduce((sum, day) => sum + day.hours, 0),
    [weekActivity],
  );
  const maxWeekSeconds = useMemo(
    () => Math.max(...(weekActivity ?? []).map((day) => day.seconds), 1),
    [weekActivity],
  );

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: current - 2002 }, (_, i) => current - i);
  }, []);

  const hasFilters =
    searchQuery.trim() !== "" ||
    grade !== "" ||
    subjectSlug !== "" ||
    contentType !== "" ||
    examYear !== "";

  const handleOpen = async (item: ContentItemWithSubject) => {
    if (!item.isPremium) {
      window.open(item.fileUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setOpeningId(item._id);
    try {
      const { url } = await getDownloadUrl({ contentId: item._id });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not generate a download link.",
      );
    } finally {
      setOpeningId(null);
    }
  };

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
              National exam prep
            </p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
              The Library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Textbooks, past exams, worksheets and guides for grades 9–12.
            </p>
          </div>
          {isAdmin && (
            <Button asChild variant="outline" size="sm" className="rounded-xl bg-white/5">
              <Link to="/admin">
                <Sparkles className="size-4" /> Admin
              </Link>
            </Button>
          )}
        </div>

        {/* Daily quote — small, earned, not a banner */}
        {quote && (
          <div className="glass-panel flex items-start gap-3 rounded-2xl px-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Quote className="size-3.5" />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                // today
              </p>
              <p className="mt-1 text-sm leading-6 text-foreground/90">{quote.text}</p>
              {quote.author && (
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  — {quote.author}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Trial status banner */}
        <AnimatePresence>
          {subscription && subscription.status === "trial" && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Crown className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold tracking-tight">
                    Free trial — {subscription.trialDaysRemaining} active day
                    {subscription.trialDaysRemaining === 1 ? "" : "s"} left
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Days you actually study count toward the 14-day trial. Premium
                    unlocks past exams, plans and unlimited tutoring.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="rounded-xl">
                <Link to="/upgrade">Go premium</Link>
              </Button>
            </motion.div>
          )}
          {subscription && subscription.status !== "trial" && subscription.needsUpgrade && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-amber-400/25 bg-amber-400/8 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                    <Crown className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold tracking-tight">Your free trial has ended</p>
                    <p className="text-xs text-muted-foreground">
                      Premium downloads and study plans are paused until you upgrade.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="rounded-xl">
                  <Link to="/upgrade">Upgrade now</Link>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Streak reminder banner */}
        <AnimatePresence>
          {reminder?.show && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border-primary/20 px-4 py-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BellRing className="size-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold tracking-tight">Keep your streak alive</p>
                  <p className="text-xs text-muted-foreground">
                    You haven&apos;t logged a study session today — a 25-minute focus
                    session is all it takes.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button asChild size="sm" className="rounded-xl">
                  <Link to="/focus">Start session</Link>
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-xl text-muted-foreground"
                  onClick={() => void dismissReminder().catch(() => {})}
                >
                  Dismiss
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">streak</span>
              <Flame className="size-4 text-primary" />
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-gradient">
                <StatNumber value={streak?.currentStreak ?? 0} />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">days</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">longest {streak?.longestStreak ?? 0}</p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">studied</span>
              <Timer className="size-4 text-primary" />
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-gradient">
                <StatNumber value={streak?.totalHoursStudied ?? 0} decimals={1} />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">hours</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">all time</p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">this week</span>
              <CalendarDays className="size-4 text-primary" />
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-gradient">
                <StatNumber value={weekHours} decimals={1} />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">hours</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">last 7 days</p>
          </div>
          <Link to="/todos" className="glass-panel group rounded-2xl p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">todos</span>
              <Sparkles className="size-4 text-primary" />
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-gradient">
                <StatNumber value={pendingTodoCount} />
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">open</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground group-hover:text-primary">manage tasks</p>
          </Link>
        </div>

        {/* Week activity strip */}
        <div className="glass-panel rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">focus minutes · last 7 days</span>
            <Flame className="size-3.5 text-primary/60" />
          </div>
          <div className="mt-3 flex h-20 items-end gap-2">
            {weekActivity?.map((day) => {
              const height = day.seconds > 0 ? Math.max(8, Math.min(78, Math.round((day.seconds / maxWeekSeconds) * 100))) : 0;
              const label = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
              return (
                <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${day.date} · ${day.hours} h`}>
                  <div
                    className={cn(
                      "w-full rounded-t-md transition-all",
                      day.seconds > 0
                        ? "bg-gradient-to-t from-primary/40 to-primary"
                        : "bg-white/5",
                    )}
                    style={{ height: `${height}%` }}
                  />
                  <span className="font-mono text-[9px] uppercase text-muted-foreground">{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Search + filters */}
        <div className="glass-panel rounded-2xl p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search titles and subjects — e.g. “physics past exam”"
              className="h-10 rounded-xl bg-white/5 pl-9 pr-9 font-mono text-sm"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Grade</span>
            <Select value={grade} onValueChange={(v) => setGrade(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All grades" />
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
            <span className="text-[11px] font-semibold text-muted-foreground">Subject</span>
            <Select value={subjectSlug} onValueChange={(v) => setSubjectSlug(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects?.map((subject) => (
                  <SelectItem key={subject._id} value={subject.slug}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">Type</span>
            <Select value={contentType} onValueChange={(v) => setContentType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {CONTENT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {CONTENT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold text-muted-foreground">
              Exam year {contentType && contentType !== "past_exam" ? "· n/a" : ""}
            </span>
            {contentType === "" || contentType === "past_exam" ? (
              <Select value={examYear} onValueChange={(v) => setExamYear(v === "any" ? "" : v)} disabled={contentType === ""}>
                <SelectTrigger className="h-9 rounded-xl bg-white/5">
                  <SelectValue placeholder={contentType === "" ? "Pick Past Exams first" : "Any year"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any year</SelectItem>
                  {yearOptions.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex h-9 items-center rounded-xl border border-dashed border-border bg-white/5 px-3 text-xs text-muted-foreground">
                Only for past exams
              </div>
            )}
          </div>
          </div>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="w-fit cursor-pointer rounded-xl text-muted-foreground"
            onClick={() => {
              setSearchQuery("");
              setGrade("");
              setSubjectSlug("");
              setContentType("");
              setExamYear("");
            }}
          >
            <RotateCcw className="size-3.5" /> Reset filters
          </Button>
        )}

        {/* Content */}
        {content === undefined ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="glass-panel rounded-2xl p-5">
                <div className="size-11 animate-pulse rounded-xl bg-white/5" />
                <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-white/5" />
                <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/5" />
                <div className="mt-4 h-9 w-full animate-pulse rounded-xl bg-white/5" />
              </div>
            ))}
          </div>
        ) : content.length === 0 ? (
          <div className="glass-soft flex flex-col items-center justify-center rounded-2xl px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileSearch className="size-6" />
            </div>
            <h3 className="mt-4 font-bold tracking-tight">No content here yet</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {hasFilters
                ? "Nothing matches those filters. Try widening your search."
                : "The library is being stocked. Check back soon, or ask an admin to upload content."}
            </p>
              {isAdmin && !hasFilters && (
              <Button asChild size="sm" className="mt-5 rounded-xl">
                <Link to="/admin">
                  <Sparkles className="size-4" /> Upload the first item
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <motion.div layout className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {content.map((item) => (
              <ContentCard
                key={item._id}
                item={item}
                onOpen={handleOpen}
                onQuiz={(clicked) => {
                  setQuizSubjectId(clicked.subjectId);
                  setQuizOpen(true);
                }}
                opening={openingId === item._id}
              />
            ))}
          </motion.div>
        )}
      </div>

      <QuizFlow
        open={quizOpen}
        onOpenChange={setQuizOpen}
        initialSubjectId={quizSubjectId || undefined}
        title="Quick check"
      />
    </DashboardShell>
  );
}
