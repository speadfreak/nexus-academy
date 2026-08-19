import { api } from "@/convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Atom,
  BellRing,
  Bookmark,
  BookmarkCheck,
  BookOpen,
  Brain,
  CalendarDays,
  Calculator,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  Crown,
  FileSearch,
  Flame,
  Globe2,
  GraduationCap,
  HelpCircle,
  History,
  Languages,
  Leaf,
  Loader2,
  Lock,
  MessageSquare,
  Microscope,
  Presentation,
  Quote,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { lastNDayWindows, localDateKey } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { DashboardShell } from "@/components/DashboardShell";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { QuizFlow } from "@/components/QuizFlow";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

/* ═══════════════════════════════════════════════════════════════════════
   SUBJECT GLYPHS — large decorative icons inside each book cover
   ═══════════════════════════════════════════════════════════════════════ */

const SUBJECT_GLYPHS: Record<string, typeof Atom> = {
  physics: Atom,
  chemistry: Microscope,
  biology: Leaf,
  mathematics: Calculator,
  english: Languages,
  history: History,
  geography: Globe2,
  economics: TrendingUp,
  "scholastic-aptitude-test": Brain,
};

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

/** Per-subject book-cover palettes — the "spine" of each shelf tile. */
const SUBJECT_COVERS: Record<string, { from: string; to: string; accent: string; glyph: string; text: string; pattern: string }> = {
  physics: { from: "#1c3a5e", to: "#0d1b2e", accent: "#38bdf8", glyph: "rgba(56,189,248,0.08)", text: "text-sky-200", pattern: "rgba(56,189,248,0.03)" },
  chemistry: { from: "#1f4d3a", to: "#0c1f16", accent: "#34d399", glyph: "rgba(52,211,153,0.08)", text: "text-emerald-200", pattern: "rgba(52,211,153,0.03)" },
  biology: { from: "#2c4a2a", to: "#12200f", accent: "#a3e635", glyph: "rgba(163,230,53,0.08)", text: "text-lime-200", pattern: "rgba(163,230,53,0.03)" },
  mathematics: { from: "#3b2d5e", to: "#171026", accent: "#a78bfa", glyph: "rgba(167,139,250,0.08)", text: "text-violet-200", pattern: "rgba(167,139,250,0.03)" },
  english: { from: "#5e2335", to: "#260d14", accent: "#fb7185", glyph: "rgba(251,113,133,0.08)", text: "text-rose-200", pattern: "rgba(251,113,133,0.03)" },
  history: { from: "#5e4a1f", to: "#261d0a", accent: "#fbbf24", glyph: "rgba(251,191,36,0.08)", text: "text-amber-200", pattern: "rgba(251,191,36,0.03)" },
  geography: { from: "#1f4d4d", to: "#0c1f1f", accent: "#2dd4bf", glyph: "rgba(45,212,191,0.08)", text: "text-teal-200", pattern: "rgba(45,212,191,0.03)" },
  economics: { from: "#2a335e", to: "#0f1326", accent: "#818cf8", glyph: "rgba(129,140,248,0.08)", text: "text-indigo-200", pattern: "rgba(129,140,248,0.03)" },
  "scholastic-aptitude-test": { from: "#4a2d5e", to: "#1e1026", accent: "#e879f9", glyph: "rgba(232,121,249,0.08)", text: "text-fuchsia-200", pattern: "rgba(232,121,249,0.03)" },
};

function coverFor(subjectSlug: string) {
  return (
    SUBJECT_COVERS[subjectSlug] ?? {
      from: "#2b2f3a",
      to: "#14161c",
      accent: "#94a3b8",
      glyph: "rgba(148,163,184,0.08)",
      text: "text-slate-200",
      pattern: "rgba(148,163,184,0.03)",
    }
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   3D TILT CARD — mouse-tracked perspective transform
   ═══════════════════════════════════════════════════════════════════════ */

function TiltCard({
  children,
  className,
  disabled,
}: {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState("perspective(800px) rotateX(0deg) rotateY(0deg)");
  const [isHovering, setIsHovering] = useState(false);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const rotateX = (0.5 - y) * 8;
      const rotateY = (x - 0.5) * 8;
      setTransform(`perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02,1.02,1.02)`);
    },
    [disabled],
  );

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    setTransform("perspective(800px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)");
  }, []);

  return (
    <div
      ref={ref}
      className={cn("relative", className)}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleMouseLeave}
      style={{
        transform,
        transition: isHovering
          ? "transform 120ms cubic-bezier(0.22, 1, 0.36, 1)"
          : "transform 400ms cubic-bezier(0.22, 1, 0.36, 1)",
        transformStyle: "preserve-3d",
        willChange: "transform",
      }}
    >
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════ */

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Late night grind";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Night session";
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

/* ═══════════════════════════════════════════════════════════════════════
   PREMIUM BOOK TILE — CSS-generated cover with subject glyph + 3D tilt
   ═══════════════════════════════════════════════════════════════════════ */

function BookTile({
  item,
  locked,
  bookmarked,
  onToggleBookmark,
  onOpen,
  onQuiz,
}: {
  item: ContentItemWithSubject;
  locked: boolean;
  bookmarked: boolean;
  onToggleBookmark: (item: ContentItemWithSubject) => void;
  onOpen: (item: ContentItemWithSubject) => void;
  onQuiz: (item: ContentItemWithSubject) => void;
}) {
  const style = TYPE_STYLES[item.contentType];
  const cover = coverFor(item.subjectSlug);
  const GlyphIcon = SUBJECT_GLYPHS[item.subjectSlug] ?? BookOpen;
  const typeLabel = CONTENT_TYPE_LABELS[item.contentType];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, y: -10 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="group flex flex-col gap-3"
    >
      {/* Book cover with 3D tilt */}
      <TiltCard className="w-full">
        <button
          type="button"
          onClick={() => onOpen(item)}
          className="relative flex aspect-[3/4] w-full cursor-pointer flex-col justify-between overflow-hidden rounded-2xl text-left ring-1 ring-white/10 transition-all duration-300 hover:ring-white/25"
          style={{
            background: `linear-gradient(165deg, ${cover.from} 0%, ${cover.to} 100%)`,
            boxShadow: `0 4px 20px -4px rgba(0,0,0,0.5), inset 0 1px 0 ${cover.accent}22`,
          }}
          aria-label={`Open ${item.title}`}
        >
          {/* Subtle pattern overlay for texture */}
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              backgroundImage: `radial-gradient(circle at 30% 20%, ${cover.pattern} 0%, transparent 50%), radial-gradient(circle at 80% 80%, ${cover.pattern} 0%, transparent 50%)`,
            }}
          />

          {/* Spine highlight */}
          <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-white/30 via-white/15 to-white/5" />
          <span className="pointer-events-none absolute inset-y-0 left-[12px] w-px bg-white/8" />

          {/* Top row: type chip + bookmark */}
          <div className="flex items-start justify-between gap-2 p-3 pl-5">
            <span
              className={`flex size-8 items-center justify-center rounded-xl ${style.classes} backdrop-blur-sm`}
              title={typeLabel}
            >
              <style.icon className="size-4" />
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleBookmark(item);
              }}
              title={bookmarked ? "Remove from reading list" : "Save to reading list"}
              aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
              className={cn(
                "flex size-8 cursor-pointer items-center justify-center rounded-xl backdrop-blur-sm transition-all duration-200",
                bookmarked
                  ? "bg-primary/30 text-primary shadow-[0_0_12px_rgba(112,196,255,0.3)]"
                  : "bg-black/30 text-white/50 hover:bg-black/50 hover:text-white",
              )}
            >
              {bookmarked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
            </button>
          </div>

          {/* Center: large subject glyph */}
          <div className="pointer-events-none flex items-center justify-center" style={{ transform: "translateZ(20px)" }}>
            <div
              className="flex size-16 items-center justify-center rounded-2xl backdrop-blur-sm"
              style={{
                background: `linear-gradient(135deg, ${cover.accent}15, ${cover.accent}05)`,
                border: `1px solid ${cover.accent}15`,
              }}
            >
              <GlyphIcon
                className="size-8"
                style={{ color: cover.accent, opacity: 0.6 }}
                strokeWidth={1.5}
              />
            </div>
          </div>

          {/* Bottom: title + meta */}
          <div className="px-3.5 pb-3.5 pl-5">
            <h3 className={`line-clamp-2 type-caption leading-5 font-bold tracking-tight ${cover.text}`}>
              {item.title}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span
                className="rounded-md px-2 py-0.5 type-caption font-bold uppercase tracking-wide"
                style={{
                  background: `${cover.accent}15`,
                  color: cover.accent,
                }}
              >
                Grade {item.grade}
              </span>
              {item.examYear && (
                <span className="rounded-md bg-black/40 px-2 py-0.5 type-caption font-bold text-white/70">
                  {item.examYear}
                </span>
              )}
              {item.isPremium && (
                <span className="flex items-center gap-1 rounded-md bg-amber-400/20 px-2 py-0.5 type-caption font-bold text-amber-200">
                  {locked ? <Lock className="size-2.5" /> : <Crown className="size-2.5" />}
                  Premium
                </span>
              )}
            </div>
          </div>

          {/* Bookmark corner ribbon when saved */}
          {bookmarked && (
            <span className="pointer-events-none absolute -right-0 top-0 border-l-[20px] border-t-[20px] border-l-transparent border-t-primary/80" />
          )}

          {/* Premium lock overlay */}
          {locked && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
              <div className="flex flex-col items-center gap-2">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/15 text-amber-300">
                  <Lock className="size-5" />
                </div>
                <span className="type-caption font-bold text-amber-200/90">Premium Content</span>
              </div>
            </div>
          )}
        </button>
      </TiltCard>

      {/* Action row */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-9 flex-1 cursor-pointer rounded-xl bg-white/5 type-caption interactive-press"
          onClick={() => onOpen(item)}
        >
          <BookOpen className="size-3.5" />
          {item.isPremium && locked ? "Locked" : "Read"}
        </Button>
        <Link
          to={`/tutor?subject=${encodeURIComponent(item.subjectSlug)}&contentId=${item._id}`}
          title={`Ask the tutor about ${item.title}`}
          className="interactive-press flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <MessageSquare className="size-3.5" />
        </Link>
        <button
          type="button"
          onClick={() => onQuiz(item)}
          title={`Quick check on ${item.subjectName}`}
          className="interactive-press flex size-9 cursor-pointer items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          <HelpCircle className="size-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LOADING SKELETON
   ═══════════════════════════════════════════════════════════════════════ */

function BookSkeleton({ index }: { index: number }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="glass-panel aspect-[3/4] w-full animate-pulse rounded-2xl" />
      <div className="h-9 w-full animate-pulse rounded-xl bg-white/5" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   WEEKLY RECAP CARD
   ═══════════════════════════════════════════════════════════════════════ */

function WeeklyRecap() {
  const [recapText, setRecapText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const generateRecap = useAction(api.recap.generateRecap);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateRecap({ type: "weekly" });
      if (result.text) setRecapText(result.text);
    } catch {
      // silent — recap is nice-to-have
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-panel rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <span className="type-mono uppercase text-muted-foreground">this week</span>
        <Sparkles className="size-3.5 text-primary/60" />
      </div>
      {recapText ? (
        <p className="type-body mt-3 leading-relaxed text-muted-foreground">{recapText}</p>
      ) : (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="interactive-press mt-3 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 font-mono text-[11px] font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          {loading ? "Generating…" : "Get weekly recap"}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ═══════════════════════════════════════════════════════════════════════ */

export default function Dashboard() {
  const [searchQuery, setSearchQuery] = useState("");
  const [grade, setGrade] = useState("");
  const [subjectSlug, setSubjectSlug] = useState("");
  const [contentType, setContentType] = useState("");
  const [examYear, setExamYear] = useState("");
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [quizSubjectId, setQuizSubjectId] = useState<string>("");
  const [quizOpen, setQuizOpen] = useState(false);
  const navigate = useNavigate();

  const subjects = useQuery(api.subjects.getAll);
  const bookmarkIds = useQuery(api.bookmarks.getMyBookmarkIds);
  const toggleBookmark = useMutation(api.bookmarks.toggleBookmark);
  const profile = useQuery(api.profile.getProfile);
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const [premiumPrompt, setPremiumPrompt] = useState<{ reason: "premium_content"; open: boolean } | null>(null);

  // Daily quote
  const quote = useQuery(api.quotes.getTodaysQuote);
  const ensureQuote = useAction(api.quotes.ensureTodaysQuote);
  const quoteSyncedRef = useRef(false);
  useEffect(() => {
    if (quoteSyncedRef.current) return;
    quoteSyncedRef.current = true;
    void ensureQuote().catch(() => {});
  }, [ensureQuote]);

  // Daily challenge
  const dailyChallenges = useQuery(api.dailyChallenge.getTodaysChallenges);
  const ensureChallenges = useAction(api.dailyChallenge.ensureDailyChallenges);
  const submitChallenge = useMutation(api.dailyChallenge.submitDailyChallenge);
  const challengesSyncedRef = useRef(false);
  useEffect(() => {
    if (challengesSyncedRef.current) return;
    challengesSyncedRef.current = true;
    void ensureChallenges().catch(() => {});
  }, [ensureChallenges]);

  const [challengeSubjectId, setChallengeSubjectId] = useState<string>("");
  const [challengeAnswer, setChallengeAnswer] = useState<number | null>(null);
  const [challengeSubmitting, setChallengeSubmitting] = useState(false);
  const activeChallenge = useMemo(() => {
    const list = dailyChallenges ?? [];
    return (
      list.find((c) => c.subjectId === (challengeSubjectId as never)) ??
      list.find((c) => !c.answered) ??
      list[0]
    );
  }, [dailyChallenges, challengeSubjectId]);

  const level = useQuery(api.xp.getMyLevel);
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const reminder = useQuery(api.reminders.getReminderBanner);
  const syncReminders = useMutation(api.reminders.syncReminderSettings);
  const dismissReminder = useMutation(api.reminders.dismissReminder);

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
    examYear !== "" ||
    bookmarkedOnly;

  const visibleContent = useMemo(() => {
    if (!content) return content;
    if (!bookmarkedOnly) return content;
    const ids = new Set(bookmarkIds ?? []);
    return content.filter((item) => ids.has(item._id));
  }, [content, bookmarkedOnly, bookmarkIds]);

  // Stream breakdown for the header
  const streamBreakdown = useMemo(() => {
    if (!content) return null;
    const counts = { natural: 0, social: 0, common: 0 };
    for (const item of content) {
      const slug = item.subjectSlug;
      if (SUBJECT_COVERS[slug]) {
        // determine stream from slug
        if (["physics", "chemistry", "biology"].includes(slug)) counts.natural++;
        else if (["history", "geography", "economics"].includes(slug)) counts.social++;
        else counts.common++;
      }
    }
    return counts;
  }, [content]);

  const totalContent = content?.length ?? 0;

  const handleChallengePick = async (optionIndex: number) => {
    if (!activeChallenge || activeChallenge.answered || challengeSubmitting) return;
    setChallengeAnswer(optionIndex);
    setChallengeSubmitting(true);
    try {
      const result = await submitChallenge({
        subjectId: activeChallenge.subjectId as never,
        answer: optionIndex,
      });
      if (result.xpAwarded > 0) toast.success(`Correct! +${result.xpAwarded} XP earned.`);
      if (result.levelUp) toast.success(`Level up — you're now level ${result.newLevel}.`);
      for (const achievement of result.newAchievements) {
        toast.success(`Achievement unlocked: ${achievement.name}`);
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not submit the challenge."));
    } finally {
      setChallengeSubmitting(false);
      setChallengeAnswer(null);
    }
  };

  const handleOpen = (item: ContentItemWithSubject) => {
    if (item.isPremium && entitlements && !entitlements.premiumAccess) {
      setPremiumPrompt({ reason: "premium_content", open: true });
      return;
    }
    navigate(`/read/${item._id}`);
  };

  const handleToggleBookmark = (item: ContentItemWithSubject) => {
    void toggleBookmark({ contentId: item._id })
      .then(() => {})
      .catch(() => toast.error("Could not update your reading list."));
  };

  const resetFilters = () => {
    setSearchQuery("");
    setGrade("");
    setSubjectSlug("");
    setContentType("");
    setExamYear("");
    setBookmarkedOnly(false);
  };

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        {/* ═══ CINEMATIC HERO / GREETING ═══ */}
        <div className="glass-panel relative overflow-hidden rounded-3xl p-6 sm:p-8">
          {/* Ambient glow */}
          <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-16 -left-16 size-48 rounded-full bg-primary/5 blur-3xl" />

          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="flex items-center gap-2.5 type-mono font-bold uppercase tracking-[0.18em] text-primary">
                {profile && (
                  <Avatar className="size-8 ring-2 ring-primary/20">
                    <AvatarImage src={profile.avatarUrl ?? undefined} />
                    <AvatarFallback className="bg-primary/15 type-caption font-extrabold text-primary">
                      {(profile.displayName ?? "N")
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((part) => part[0]?.toUpperCase() ?? "")
                        .join("") || "N"}
                    </AvatarFallback>
                  </Avatar>
                )}
                <span>
                  {timeOfDayGreeting()}
                  {profile?.displayName ? `, ${profile.displayName.split(/\s+/)[0]}` : ""}
                </span>
              </p>
              <h1 className="type-display mt-2">
                The Library
              </h1>
              <p className="type-body mt-1.5 max-w-lg text-muted-foreground">
                Textbooks, past exams, worksheets and guides for grades 9–12.
                {totalContent > 0 && (
                  <span className="ml-1 font-semibold text-foreground/70">
                    {totalContent} resource{totalContent !== 1 ? "s" : ""} available.
                  </span>
                )}
              </p>

              {/* Stream breakdown pills */}
              {streamBreakdown && totalContent > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {streamBreakdown.natural > 0 && (
                    <span className="flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-3 py-1 type-caption font-semibold text-emerald-300">
                      <Leaf className="size-3" /> {streamBreakdown.natural} Natural
                    </span>
                  )}
                  {streamBreakdown.social > 0 && (
                    <span className="flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1 type-caption font-semibold text-amber-300">
                      <Globe2 className="size-3" /> {streamBreakdown.social} Social
                    </span>
                  )}
                  {streamBreakdown.common > 0 && (
                    <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 type-caption font-semibold text-primary">
                      <BookOpen className="size-3" /> {streamBreakdown.common} Common
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Quick action buttons */}
            <div className="flex shrink-0 items-center gap-2">
              {isAdmin && (
                <Button asChild variant="outline" size="sm" className="rounded-xl bg-white/5 interactive-press">
                  <Link to="/admin">
                    <Sparkles className="size-4" /> Admin
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ═══ DAILY QUOTE ═══ */}
        {quote && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel flex items-start gap-4 rounded-2xl px-5 py-4"
          >
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Quote className="size-4.5" />
            </div>
            <div className="min-w-0">
              <p className="type-mono uppercase tracking-[0.2em] text-muted-foreground">
                // today
              </p>
              <p className="type-body-lg mt-1 text-foreground/90">{quote.text}</p>
              {quote.author && (
                <p className="type-caption mt-1 text-muted-foreground">
                  — {quote.author}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══ TRIAL / SUBSCRIPTION BANNERS ═══ */}
        <AnimatePresence>
          {subscription && subscription.status === "trial" && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Crown className="size-4.5" />
                </div>
                <div className="min-w-0">
                  <p className="type-h3">
                    Free trial — {subscription.trialDaysRemaining} active day
                    {subscription.trialDaysRemaining === 1 ? "" : "s"} left
                  </p>
                  <p className="type-body truncate text-muted-foreground">
                    Days you actually study count toward the 14-day trial. Premium
                    unlocks past exams, plans and unlimited tutoring.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="rounded-xl interactive-press">
                <Link to="/upgrade">Go premium</Link>
              </Button>
            </motion.div>
          )}
          {subscription && subscription.status !== "trial" && subscription.needsUpgrade && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-amber-400/25 bg-amber-400/8 px-5 py-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                    <Crown className="size-4.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="type-h3">Your free trial has ended</p>
                    <p className="type-body text-muted-foreground">
                      Premium downloads and study plans are paused until you upgrade.
                    </p>
                  </div>
                </div>
                <Button asChild size="sm" className="rounded-xl interactive-press">
                  <Link to="/upgrade">Upgrade now</Link>
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ═══ STREAK REMINDER ═══ */}
        <AnimatePresence>
          {reminder?.show && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl border-primary/20 px-5 py-4"
            >
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BellRing className="size-4.5" />
                </div>
                <div className="min-w-0">
                  <p className="type-h3">Keep your streak alive</p>
                  <p className="type-body text-muted-foreground">
                    You haven&apos;t logged a study session today — a 25-minute focus
                    session is all it takes.
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button asChild size="sm" className="rounded-xl interactive-press">
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

        {/* ═══ STATS ROW ═══ */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <div className="glass-panel hover-lift rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="type-mono uppercase text-muted-foreground">streak</span>
              <div className="flex size-8 items-center justify-center rounded-xl bg-orange-400/10 text-orange-300">
                <Flame className="size-4" />
              </div>
            </div>
            <p className="type-h2 mt-2 flex items-baseline gap-1.5 tabular-nums text-gradient">
              <StatNumber value={streak?.currentStreak ?? 0} />
              <span className="type-caption text-muted-foreground">days</span>
            </p>
            <p className="type-caption mt-1 text-muted-foreground">
              longest {streak?.longestStreak ?? 0}
            </p>
          </div>

          <div className="glass-panel hover-lift rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="type-mono uppercase text-muted-foreground">studied</span>
              <div className="flex size-8 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
                <Clock className="size-4" />
              </div>
            </div>
            <p className="type-h2 mt-2 flex items-baseline gap-1.5 tabular-nums text-gradient">
              <StatNumber value={streak?.totalHoursStudied ?? 0} decimals={1} />
              <span className="type-caption text-muted-foreground">hours</span>
            </p>
            <p className="type-caption mt-1 text-muted-foreground">all time</p>
          </div>

          <div className="glass-panel hover-lift rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <span className="type-mono uppercase text-muted-foreground">this week</span>
              <div className="flex size-8 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
                <CalendarDays className="size-4" />
              </div>
            </div>
            <p className="type-h2 mt-2 flex items-baseline gap-1.5 tabular-nums text-gradient">
              <StatNumber value={weekHours} decimals={1} />
              <span className="type-caption text-muted-foreground">hours</span>
            </p>
            <p className="type-caption mt-1 text-muted-foreground">last 7 days</p>
          </div>

          <Link to="/todos" className="glass-panel hover-lift group rounded-2xl p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="type-mono uppercase text-muted-foreground">todos</span>
              <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="size-4" />
              </div>
            </div>
            <p className="type-h2 mt-2 flex items-baseline gap-1.5 tabular-nums text-gradient">
              <StatNumber value={pendingTodoCount} />
              <span className="type-caption text-muted-foreground">open</span>
            </p>
            <p className="type-caption mt-1 text-muted-foreground group-hover:text-primary">manage tasks</p>
          </Link>

          <Link to="/achievements" className="glass-panel hover-lift group rounded-2xl p-4 transition-colors hover:border-primary/30">
            <div className="flex items-center justify-between">
              <span className="type-mono uppercase text-muted-foreground">level</span>
              <div className="flex size-8 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                <Trophy className="size-4" />
              </div>
            </div>
            <p className="type-h2 mt-2 flex items-baseline gap-1.5 tabular-nums text-gradient">
              <StatNumber value={level?.currentLevel ?? 1} />
              <span className="type-caption text-muted-foreground">· {level?.totalXp ?? 0} xp</span>
            </p>
            <p className="type-caption mt-1 text-muted-foreground group-hover:text-primary">
              {level?.xpToNext ?? 0} xp to next
            </p>
          </Link>
        </div>

        {/* ═══ WEEK ACTIVITY STRIP ═══ */}
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="type-mono uppercase text-muted-foreground">focus minutes · last 7 days</span>
            <Flame className="size-3.5 text-primary/60" />
          </div>
          <div className="mt-3 flex h-24 items-end gap-2">
            {weekActivity?.map((day) => {
              const height = day.seconds > 0 ? Math.max(8, Math.min(88, Math.round((day.seconds / maxWeekSeconds) * 100))) : 0;
              const label = new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" });
              const isToday = day.date === todayKey;
              return (
                <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${day.date} · ${day.hours} h`}>
                  <div
                    className={cn(
                      "w-full rounded-t-lg transition-all duration-300",
                      day.seconds > 0
                        ? "bg-gradient-to-t from-primary/50 to-primary"
                        : "bg-white/5",
                    )}
                    style={{ height: `${height}%` }}
                  />
                  <span className={cn(
                    "type-caption uppercase",
                    isToday ? "font-bold text-primary" : "text-muted-foreground",
                  )}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ WEEKLY RECAP ═══ */}
        <WeeklyRecap />

        {/* ═══ DAILY CHALLENGE ═══ */}
        {dailyChallenges !== undefined && dailyChallenges.length > 0 && activeChallenge && (
          <div className="glass-panel hover-lift rounded-2xl p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="type-mono uppercase text-muted-foreground">
                  daily challenge · one shot per subject
                </span>
                <p className="type-body-lg mt-1 font-semibold">
                  {activeChallenge.question ?? "Preparing today's question…"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 type-mono font-bold text-primary">
                <Target className="size-3" /> +10 XP
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {dailyChallenges.map((challenge) => (
                <button
                  key={challenge.subjectId}
                  type="button"
                  onClick={() => setChallengeSubjectId(challenge.subjectId as string)}
                  className={cn(
                    "interactive-press flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 type-caption font-semibold",
                    activeChallenge.subjectId === challenge.subjectId
                      ? "bg-primary/15 text-primary"
                      : "bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {challenge.subjectName}
                  {challenge.answered &&
                    (challenge.answeredCorrectly ? (
                      <CheckCircle2 className="size-3 text-emerald-300" />
                    ) : (
                      <XCircle className="size-3 text-rose-300" />
                    ))}
                </button>
              ))}
            </div>

            {activeChallenge.question ? (
              <div className="mt-4 flex flex-col gap-2">
                {activeChallenge.options.map((option, index) => {
                  const answered = activeChallenge.answered;
                  const selected = challengeAnswer === index && !answered;
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => void handleChallengePick(index)}
                      disabled={answered || challengeSubmitting}
                      className={cn(
                        "interactive-press flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left type-body disabled:cursor-default",
                        selected
                          ? "border-primary/50 bg-primary/10"
                          : answered
                            ? "border-white/5 bg-white/[0.02] text-muted-foreground"
                            : "border-white/10 bg-white/5 hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      <span className="type-caption text-muted-foreground">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="flex-1">{option}</span>
                      {challengeSubmitting && selected && (
                        <Loader2 className="size-4 animate-spin text-primary" />
                      )}
                    </button>
                  );
                })}

                {activeChallenge.answered && activeChallenge.explanation && (
                  <div
                    className={cn(
                      "mt-1 rounded-xl border px-4 py-3 type-body leading-6",
                      activeChallenge.answeredCorrectly
                        ? "border-emerald-400/25 bg-emerald-400/5"
                        : "border-rose-400/25 bg-rose-400/5",
                    )}
                  >
                    <p className="type-h3 flex items-center gap-2">
                      {activeChallenge.answeredCorrectly ? (
                        <>
                          <CheckCircle2 className="size-4 text-emerald-300" /> Correct — well done.
                        </>
                      ) : (
                        <>
                          <XCircle className="size-4 text-rose-300" /> Not quite this time.
                        </>
                      )}
                    </p>
                    <p className="type-body mt-1 text-muted-foreground">{activeChallenge.explanation}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="type-body mt-4 flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Generating today's question…
              </div>
            )}
          </div>
        )}

        {/* ═══ SEARCH + FILTERS ═══ */}
        <div className="glass-panel rounded-2xl p-5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder='Search titles and subjects — e.g. "physics past exam"'
              className="h-11 rounded-xl bg-white/5 pl-9 pr-9 type-body"
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setBookmarkedOnly((value) => !value)}
              className={cn(
                "interactive-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 type-caption font-semibold",
                bookmarkedOnly
                  ? "bg-primary/15 text-primary"
                  : "bg-white/5 text-muted-foreground hover:text-foreground",
              )}
            >
              {bookmarkedOnly ? (
                <BookmarkCheck className="size-3.5" />
              ) : (
                <Bookmark className="size-3.5" />
              )}
              Bookmarked
              {bookmarkedOnly && bookmarkIds ? (
                <span className="rounded bg-primary/20 px-1.5 type-caption">
                  {bookmarkIds.length}
                </span>
              ) : null}
            </button>
            {(bookmarkIds?.length ?? 0) > 0 && !bookmarkedOnly && (
              <span className="type-caption text-muted-foreground">
                {bookmarkIds?.length} saved
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <span className="type-caption font-semibold text-muted-foreground">Grade</span>
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
              <span className="type-caption font-semibold text-muted-foreground">Subject</span>
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
              <span className="type-caption font-semibold text-muted-foreground">Type</span>
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
              <span className="type-caption font-semibold text-muted-foreground">
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
                <div className="type-caption flex h-9 items-center rounded-xl border border-dashed border-border bg-white/5 px-3 text-muted-foreground">
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
            className="w-fit cursor-pointer rounded-xl text-muted-foreground interactive-press"
            onClick={resetFilters}
          >
            <RotateCcw className="size-3.5" /> Reset filters
          </Button>
        )}

        {/* ═══ CONTENT GALLERY ═══ */}
        {content === undefined ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Array.from({ length: 8 }).map((_, index) => (
              <BookSkeleton key={index} index={index} />
            ))}
          </div>
        ) : (visibleContent ?? []).length === 0 ? (
          <div className="glass-soft flex flex-col items-center justify-center rounded-3xl px-6 py-20 text-center">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-primary/10 text-primary">
              <FileSearch className="size-7" />
            </div>
            <h3 className="type-h2 mt-5">No content here yet</h3>
            <p className="type-body mt-2 max-w-sm text-muted-foreground">
              {bookmarkedOnly
                ? "Nothing saved to your reading list yet — tap the bookmark on any book to start one."
                : hasFilters
                  ? "Nothing matches those filters. Try widening your search."
                  : "The library is being stocked. Check back soon, or ask an admin to upload content."}
            </p>
            {isAdmin && !hasFilters && (
              <Button asChild size="sm" className="mt-6 rounded-xl interactive-press">
                <Link to="/admin">
                  <Sparkles className="size-4" /> Upload the first item
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Result count header */}
            <div className="flex items-center justify-between">                <p className="type-mono uppercase text-muted-foreground">
                {visibleContent?.length ?? 0} result{(visibleContent?.length ?? 0) !== 1 ? "s" : ""}
              </p>
              {!hasFilters && (
                <Link
                  to="/dashboard"
                  className="interactive-press flex items-center gap-1 type-caption font-semibold text-primary transition-colors hover:text-primary/80"
                >
                  View all <ChevronRight className="size-3" />
                </Link>
              )}
            </div>

            <motion.div
              layout
              className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
            >
              <AnimatePresence mode="popLayout">
                {(visibleContent ?? []).map((item) => (
                  <BookTile
                    key={item._id}
                    item={item}
                    locked={Boolean(entitlements && !entitlements.premiumAccess) && item.isPremium}
                    bookmarked={Boolean(bookmarkIds?.includes(item._id))}
                    onToggleBookmark={handleToggleBookmark}
                    onOpen={handleOpen}
                    onQuiz={(clicked) => {
                      setQuizSubjectId(clicked.subjectId);
                      setQuizOpen(true);
                    }}
                  />
                ))}
              </AnimatePresence>
            </motion.div>
          </>
        )}
      </div>

      <QuizFlow
        open={quizOpen}
        onOpenChange={setQuizOpen}
        initialSubjectId={quizSubjectId || undefined}
        title="Quick check"
      />

      <PremiumPrompt
        open={Boolean(premiumPrompt?.open)}
        onOpenChange={(next) => setPremiumPrompt((prev) => (prev ? { ...prev, open: next } : prev))}
        reason="premium_content"
      />
    </DashboardShell>
  );
}
