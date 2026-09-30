// ═══════════════════════════════════════════════════════════════════════
// Settings — THE LEARNYX CONTROL CENTER
// ═══════════════════════════════════════════════════════════════════════
// Not "a page containing settings" — the control center for a student's
// entire Learnyx experience. Desktop architecture:
//
//   ┌────────────┬──────────────────────────────┬──────────────────┐
//   │ SETTINGS   │  active section content      │  YOUR LEARNYX    │
//   │ sticky nav │  (one section at a time,     │  live summary    │
//   │ 6 groups   │   deep-linked via ?s=)       │  (xl+ only)      │
//   │ 14 items   │                              │                  │
//   └────────────┴──────────────────────────────┴──────────────────┘
//
// Every control from the old long-form page survives — reorganized into
// Account / Learning / Experience / Notifications / Connect / Data —
// plus new Control Center sections: AI Tutor preferences, Reader
// defaults, Notification reminders (real backend), Accessibility, and
// Storage & export. Honesty rule: a toggle only ships if something
// actually reads it (backend mutation or localStorage the app applies).
// ═══════════════════════════════════════════════════════════════════════

import { api } from "@/convex/_generated/api";
import { useAppBootstrap } from "@/components/AppBootstrap";
import { STREAM_LABELS } from "@/convex/constants";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Accessibility,
  Atom,
  Bell,
  BellOff,
  BookOpen,
  Bot,
  Camera,
  Check,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  Crown,
  Download,
  Eye,
  Flame,
  GraduationCap,
  HardDrive,
  Landmark,
  Languages,
  LifeBuoy,
  Link2,
  Loader2,
  LogOut,
  MessageSquareQuote,
  MessageSquareText,
  Monitor,
  Moon,
  Music,
  RefreshCw,
  Send,
  Send as TelegramIcon,
  ShieldCheck,
  Share2,
  Shield,
  Sparkles,
  Sun,
  Timer,
  Type as TypeIcon,
  Unlink,
  UserRound,
  Youtube,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { ShareExperienceDialog } from "@/components/ShareExperienceDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/use-auth";
import { useTheme, type ThemeChoice } from "@/components/theme-provider";
import { useFriendlyError, errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useTour } from "@/components/tour";
import { lastNDayWindows } from "@/lib/dates";
import {
  loadA11yPrefs,
  loadTutorPrefs,
  saveA11yPrefs,
  saveTutorPrefs,
  applyA11yPrefs,
  loadReaderPrefs,
  saveReaderPrefs,
  loadQuietHours,
  saveQuietHours,
  type A11yPrefs,
  type ReaderPrefs,
  type TutorPrefs,
  type TextScale,
  type QuietHours,
} from "@/lib/prefs";

// Two streams only. English, Mathematics and the SAT are sat by every
// candidate, so they're shown inside both tracks — never as a third choice.
const SHARED_SUBJECTS = "English · Mathematics · SAT";

const STREAM_OPTIONS = [
  { id: "natural", icon: Atom, label: "Natural Science", subjects: "Physics · Chemistry · Biology" },
  { id: "social", icon: Landmark, label: "Social Science", subjects: "History · Geography · Economics" },
] as const;

// ─── Navigation model ───────────────────────────────────────────────────

type SectionId =
  | "profile" | "membership" | "security"
  | "study-track" | "tutor" | "reader"
  | "appearance" | "accessibility"
  | "reminders" | "digest"
  | "music" | "referrals" | "help"
  | "data-privacy";

const NAV_GROUPS: { id: string; label: string; items: { id: SectionId; icon: typeof UserRound; title: string; blurb: string }[] }[] = [
  {
    id: "account",
    label: "Account",
    items: [
      { id: "profile", icon: UserRound, title: "Profile", blurb: "Name, avatar, handle" },
      { id: "membership", icon: Crown, title: "Membership", blurb: "Premium status" },
      { id: "security", icon: ShieldCheck, title: "Security", blurb: "Sign-in & session" },
    ],
  },
  {
    id: "learning",
    label: "Learning",
    items: [
      { id: "study-track", icon: Atom, title: "Study Track", blurb: "Stream & grade" },
      { id: "tutor", icon: Bot, title: "AI Tutor", blurb: "How it teaches you" },
      { id: "reader", icon: BookOpen, title: "Reader", blurb: "Textbook defaults" },
    ],
  },
  {
    id: "experience",
    label: "Experience",
    items: [
      { id: "appearance", icon: Sun, title: "Appearance", blurb: "Theme & accent" },
      { id: "accessibility", icon: Accessibility, title: "Accessibility", blurb: "Motion & contrast" },
    ],
  },
  {
    id: "notifications",
    label: "Notifications",
    items: [
      { id: "reminders", icon: Bell, title: "Study reminders", blurb: "Nudges & quiet hours" },
      { id: "digest", icon: Send, title: "Weekly digest", blurb: "Telegram · Mondays" },
    ],
  },
  {
    id: "connect",
    label: "Connect",
    items: [
      { id: "music", icon: Music, title: "Music", blurb: "YouTube & Spotify" },
      { id: "referrals", icon: Share2, title: "Referrals", blurb: "Earn premium days" },
      { id: "help", icon: LifeBuoy, title: "Help & contact", blurb: "Talk to the team" },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { id: "data-privacy", icon: HardDrive, title: "Storage & export", blurb: "Your data, your call" },
    ],
  },
];

const SECTION_META: Record<SectionId, { eyebrow: string; title: string; blurb: string }> = {
  profile: { eyebrow: "account · profile", title: "Profile", blurb: "Who you are across Learnyx." },
  membership: { eyebrow: "account · membership", title: "Membership", blurb: "Your premium standing and what's unlocked." },
  security: { eyebrow: "account · security", title: "Security", blurb: "Your sign-in and this device's session." },
  "study-track": { eyebrow: "learning · study identity", title: "Study Track", blurb: "The identity every Learnyx tool personalizes around." },
  tutor: { eyebrow: "learning · ai tutor", title: "AI Tutor", blurb: "Decide how the tutor teaches you — before you ever ask." },
  reader: { eyebrow: "learning · reader", title: "Reader", blurb: "Defaults your textbooks open with." },
  appearance: { eyebrow: "experience · appearance", title: "Appearance", blurb: "Obsidian, Paper, or your OS — always Learnyx gold." },
  accessibility: { eyebrow: "experience · accessibility", title: "Accessibility", blurb: "Calm motion, honest contrast, comfortable type." },
  reminders: { eyebrow: "notifications · reminders", title: "Study reminders", blurb: "A gentle nudge — never noise." },
  digest: { eyebrow: "notifications · weekly digest", title: "Weekly digest", blurb: "Your Monday morning progress report." },
  music: { eyebrow: "connect · music", title: "Your music", blurb: "Study playlists — zero hosting, your streams." },
  referrals: { eyebrow: "connect · referrals", title: "Refer friends", blurb: "Share Learnyx, both earn premium days." },
  help: { eyebrow: "connect · help", title: "Help & contact", blurb: "Real humans, one message away." },
  "data-privacy": { eyebrow: "data · privacy", title: "Storage & export", blurb: "What Learnyx keeps, and what you can take." },
};

// ─── Shared micro-components ────────────────────────────────────────────

/** Section card shell — quiet panel, consistent header. */
function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("glass-panel rounded-2xl p-5 sm:p-6", className)}>{children}</div>
  );
}

/** Gold "// eyebrow" header used by every inner card. */
function CardEyebrow({ icon: Icon, label }: { icon: typeof UserRound; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <p className="type-mono text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
        // {label}
      </p>
    </div>
  );
}

/**
 * Save button with the Control Center micro-interaction:
 * Save → spinner → "✓ Saved" with a soft gold pulse → back to idle.
 */
function SaveButton({
  onSave,
  disabled,
  label = "Save",
  className,
}: {
  onSave: () => Promise<void>;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const handleClick = async () => {
    setState("saving");
    try {
      await onSave();
      setState("saved");
      setTimeout(() => setState("idle"), 1600);
    } catch {
      setState("idle");
    }
  };

  return (
    <Button
      className={cn(
        "interactive-press h-10 shrink-0 rounded-xl",
        state === "saved" && "saved-pulse border border-primary/40 bg-primary/15 text-primary",
        className,
      )}
      onClick={() => void handleClick()}
      disabled={disabled || state === "saving" || state === "saved"}
    >
      {state === "saving" ? (
        <Loader2 className="size-4 animate-spin" />
      ) : state === "saved" ? (
        <Check className="size-4" />
      ) : null}
      {state === "saved" ? "Saved" : state === "saving" ? "Saving…" : label}
    </Button>
  );
}

/** Choice tile — the gold treatment for selectable cards. */
function ChoiceTile({
  active,
  onClick,
  children,
  className,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        "interactive-press relative cursor-pointer overflow-hidden rounded-xl border p-4 text-left",
        active
          ? "choice-sweep border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_rgb(251,191,36/0.12),0_8px_24px_-18px_rgb(251,191,36/0.8)]"
          : "border-border/60 bg-card/40 hover:border-primary/30 hover:bg-card/70",
        className,
      )}
    >
      {children}
      {active && (
        <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Check className="size-3" />
        </span>
      )}
    </button>
  );
}

/** Labelled toggle row — Switch + copy, the standard Control Center row. */
function ToggleRow({
  checked,
  onCheckedChange,
  title,
  desc,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/30 p-4",
        disabled && "opacity-60",
      )}
    >
      <div className="min-w-0">
        <p className="type-body text-sm font-semibold">{title}</p>
        <p className="type-caption mt-0.5 text-muted-foreground">{desc}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}

/** Segmented picker (Concise / Balanced / Detailed …) */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex gap-1 rounded-xl border border-border/50 bg-card/30 p-1"
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              "interactive-press flex-1 cursor-pointer rounded-lg px-3 py-2 text-center text-xs font-semibold transition-colors",
              active
                ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_rgb(251,191,36/0.25)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN — the Control Center
// ═══════════════════════════════════════════════════════════════════════

export default function Settings() {
  const friendlyError = useFriendlyError();
  const { t } = useTranslation(["settings", "common"]);
  const { user, signOut } = useAuth();
  const { theme, themeChoice, setTheme } = useTheme();
  const { profile } = useAppBootstrap(); // shared subscription (AppBootstrap)
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const updateProfile = useMutation(api.profile.updateProfile);
  const generateAvatarUploadUrl = useMutation(api.profile.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profile.setAvatar);
  const setUsername = useMutation(api.profile.setUsername);
  const navigate = useNavigate();
  const { startTour } = useTour();

  // ── Active section (deep-linkable via ?s=) ──
  const [searchParams, setSearchParams] = useSearchParams();
  const rawSection = searchParams.get("s") as SectionId | null;
  const active: SectionId =
    rawSection && SECTION_META[rawSection] ? rawSection : "profile";
  const setActive = (id: SectionId) => {
    setSearchParams(
      { s: id },
      { replace: true, preventScrollReset: true },
    );
    // Lenis owns smooth scrolling; a plain jump keeps section swaps instant.
    window.scrollTo({ top: 0, behavior: "auto" });
  };

  // ── Live data for the quick bar + YOUR LEARNYX panel ──
  const streak = useQuery(api.studySessions.getStreak, {});
  const level = useQuery(api.xp.getMyLevel, {});
  const bookmarkIds = useQuery(api.bookmarks.getMyBookmarkIds, {});
  const reminderSettings = useQuery(api.reminders.getReminderSettings, {});
  const conversations = useQuery(api.ai.listConversations, {});
  const recentSessions = useQuery(api.studySessions.getRecentSessions, { limit: 1 });
  const weekDays = useMemo(() => lastNDayWindows(7), []);
  const weekActivity = useQuery(api.studySessions.getWeekActivity, {
    days: weekDays as never,
  });
  const updateReminderSettings = useMutation(api.reminders.updateReminderSettings);

  const weekHours = useMemo<number | null>(
    () =>
      weekActivity === undefined
        ? null
        : (weekActivity ?? []).reduce((sum, day) => sum + day.hours, 0),
    [weekActivity],
  );

  // ── Client-side preference state (tutor / reader / a11y / quiet hours) ──
  const [tutorPrefs, setTutorPrefs] = useState<TutorPrefs>(() => loadTutorPrefs());
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(() => loadReaderPrefs());
  const [a11y, setA11y] = useState<A11yPrefs>(() => loadA11yPrefs());
  const [quietHours, setQuietHoursState] = useState<QuietHours>(() => loadQuietHours());

  const setQuietHours = (next: QuietHours) => {
    setQuietHoursState(next);
    saveQuietHours(next);
  };

  const patchTutor = (patch: Partial<TutorPrefs>) => {
    setTutorPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveTutorPrefs(next);
      return next;
    });
  };

  const patchReader = (patch: Partial<ReaderPrefs>) => {
    setReaderPrefs((prev) => {
      const next = { ...prev, ...patch };
      saveReaderPrefs(next);
      return next;
    });
  };

  const patchA11y = (patch: Partial<A11yPrefs>) => {
    setA11y((prev) => {
      const next = { ...prev, ...patch };
      saveA11yPrefs(next);
      applyA11yPrefs(next);
      return next;
    });
  };

  /** Theme change with the smooth crossfade micro-interaction. */
  const changeTheme = (choice: ThemeChoice) => {
    const root = document.documentElement;
    root.classList.add("theme-fade");
    setTheme(choice);
    void updateProfile({ themePreference: choice === "system" ? undefined : choice }).catch(() => {});
    setTimeout(() => root.classList.remove("theme-fade"), 450);
  };

  // ── Profile field state ──
  const [displayName, setDisplayName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [username, setUsernameValue] = useState("");
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveName = async () => {
    await updateProfile({ displayName: displayName.trim() || undefined });
    setNameDirty(false);
    toast.success("Display name updated.");
  };

  const handleAvatar = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Avatar must be under 2 MB.");
      return;
    }
    setUploadingAvatar(true);
    try {
      const uploadUrl = await generateAvatarUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!response.ok) throw new Error("Could not upload the image.");
      const raw = await response.json();
      const storageId: string = raw?.storageId ?? raw?.fileId ?? Object.values(raw)[0] as string;
      if (!storageId) throw new Error("Upload response missing storage ID.");
      await setAvatar({ storageId });
      toast.success("Avatar updated.");
    } catch (error) {
      toast.error(friendlyError(error, "Could not upload the avatar."));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveUsername = async () => {
    const value = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(value)) {
      setUsernameError("3–20 characters: lowercase letters, numbers and underscores only.");
      throw new Error("invalid username");
    }
    setUsernameError(null);
    const result = await setUsername({ username: value });
    setUsernameDirty(false);
    setUsernameValue(result.username);
    toast.success(`Username set — you can now sign in with "${result.username}".`);
  };

  const handleStream = async (stream: "natural" | "social") => {
    try {
      await updateProfile({ stream });
      toast.success(`Stream set to ${STREAM_LABELS[stream]}.`);
    } catch (error) {
      toast.error(friendlyError(error, "Could not save your stream."));
    }
  };

  const handleGrade = async (gradeLevel: 9 | 10 | 11 | 12) => {
    try {
      await updateProfile({ gradeLevel });
      const note = gradeLevel === 12
        ? "Grade 12 set — Library will show all 4 years since your exam covers the full curriculum."
        : `Grade ${gradeLevel} set — Library will default to your grade's resources.`;
      toast.success(note);
    } catch (error) {
      toast.error(friendlyError(error, "Could not save your grade."));
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const initials = (user?.name || user?.email || "N")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("");

  const streamLabel = profile?.stream
    ? STREAM_LABELS[profile.stream as keyof typeof STREAM_LABELS]
    : null;

  const lastSession = recentSessions?.[0] ?? null;

  // ── Quick settings bar model ──
  const themeChip =
    themeChoice === "system"
      ? { icon: Monitor, label: "System" }
      : theme === "dark"
        ? { icon: Moon, label: "Obsidian" }
        : { icon: Sun, label: "Paper" };

  const cycleTheme = () => {
    const order: ThemeChoice[] = ["light", "dark", "system"];
    const next = order[(order.indexOf(themeChoice) + 1) % order.length];
    changeTheme(next);
  };

  const cycleGrade = () => {
    const grades = [9, 10, 11, 12] as const;
    const current = grades.indexOf((profile?.gradeLevel ?? 12) as 9 | 10 | 11 | 12);
    void handleGrade(grades[(current + 1) % grades.length]);
  };

  const cycleStream = () => {
    void handleStream(profile?.stream === "natural" ? "social" : "natural");
  };

  const toggleReminders = (next: boolean) => {
    updateReminderSettings({ enabled: next })
      .then(() => toast.success(next ? "Study reminders on." : "Study reminders off."))
      .catch((error) => toast.error(friendlyError(error, "Could not update reminders.")));
  };

  return (
    <DashboardShell>
      <div className="relative mx-auto w-full max-w-[1500px]">
        {/* Warm ambient glow */}
        <div
          className="pointer-events-none absolute -top-16 left-1/2 size-64 -translate-x-1/2 rounded-full bg-primary/[0.07] blur-[100px]"
          aria-hidden="true"
        />

        {/* ── Header ── */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="type-mono text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
            // {t("settings:eyebrow", { defaultValue: "control center" })}
          </p>
          <h1 className="type-h1 mt-1">{t("settings:title", { defaultValue: "Settings" })}</h1>
          <p className="type-body mt-1 text-muted-foreground">
            Your learning environment, your way.
          </p>
        </motion.div>

        {/* ── Quick settings bar ── */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel mt-5 flex flex-wrap items-center gap-2 rounded-2xl p-2.5"
          role="toolbar"
          aria-label="Quick settings"
        >
          <span className="type-mono ml-2 text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Quick
          </span>

          {/* Theme */}
          <button
            type="button"
            onClick={cycleTheme}
            className="glass-chip interactive-press flex cursor-pointer items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold hover:border-primary/40"
            title="Cycle theme: Paper → Obsidian → System"
          >
            <themeChip.icon className="size-3.5 text-primary" />
            {themeChip.label}
          </button>

          {/* Grade */}
          <button
            type="button"
            onClick={cycleGrade}
            className="glass-chip interactive-press flex cursor-pointer items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold hover:border-primary/40"
            title="Cycle grade level"
          >
            <GraduationCap className="size-3.5 text-primary" />
            {profile?.gradeLevel ? `Grade ${profile.gradeLevel}` : "Set grade"}
          </button>

          {/* Stream */}
          <button
            type="button"
            onClick={cycleStream}
            className="glass-chip interactive-press flex cursor-pointer items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold hover:border-primary/40"
            title="Switch stream"
          >
            <Atom className="size-3.5 text-primary" />
            {streamLabel ? `${streamLabel} science` : "Set stream"}
          </button>

          {/* Reminders */}
          <button
            type="button"
            onClick={() => toggleReminders(!(reminderSettings?.enabled ?? true))}
            className="glass-chip interactive-press flex cursor-pointer items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold hover:border-primary/40"
            title="Toggle study reminders"
          >
            {reminderSettings?.enabled === false ? (
              <BellOff className="size-3.5 text-muted-foreground" />
            ) : (
              <Bell className="size-3.5 text-primary" />
            )}
            Reminders {reminderSettings?.enabled === false ? "off" : "on"}
          </button>

          {/* Tutor style — writes the key the tutor actually reads */}
          <button
            type="button"
            onClick={() => patchTutor({ concise: !tutorPrefs.concise })}
            className="glass-chip interactive-press flex cursor-pointer items-center gap-2 rounded-xl border border-border/50 px-3 py-2 text-xs font-semibold hover:border-primary/40"
            title="Toggle concise tutor answers"
          >
            <Bot className="size-3.5 text-primary" />
            Tutor {tutorPrefs.concise ? "concise" : "balanced"}
          </button>
        </motion.div>

        {/* ── Control Center grid ── */}
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[228px_minmax(0,1fr)] xl:grid-cols-[232px_minmax(0,1fr)_296px]">
          {/* LEFT — sticky settings navigation */}
          <SettingsNav active={active} onSelect={setActive} />

          {/* CENTER — active section */}
          <div className="min-w-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                {/* Section heading */}
                <div className="mb-4 px-1">
                  <p className="type-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
                    {SECTION_META[active].eyebrow}
                  </p>
                  <h2 className="type-h2 mt-0.5 tracking-tight">{SECTION_META[active].title}</h2>
                  <p className="type-caption text-muted-foreground">{SECTION_META[active].blurb}</p>
                </div>

                <div className="flex flex-col gap-4">
                  {active === "profile" && (
                    <ProfileSection
                      profile={profile}
                      user={user}
                      initials={initials}
                      uploadingAvatar={uploadingAvatar}
                      fileInputRef={fileInputRef}
                      onAvatar={handleAvatar}
                      displayName={displayName}
                      setDisplayName={setDisplayName}
                      nameDirty={nameDirty}
                      setNameDirty={setNameDirty}
                      onSaveName={handleSaveName}
                      username={username}
                      setUsernameValue={setUsernameValue}
                      usernameDirty={usernameDirty}
                      setUsernameDirty={setUsernameDirty}
                      usernameError={usernameError}
                      setUsernameError={setUsernameError}
                      onSaveUsername={handleSaveUsername}
                      onOpenShare={() => setShareOpen(true)}
                      streakDays={streak?.currentStreak ?? null}
                      savedCount={bookmarkIds?.length ?? null}
                    />
                  )}
                  {active === "membership" && <MembershipSection subscription={subscription} />}
                  {active === "security" && (
                    <SecuritySection
                      email={profile?.email ?? user?.email ?? ""}
                      onSignOut={handleSignOut}
                      onReplayTour={() => {
                        startTour();
                        toast.success("Welcome tour restarted.");
                      }}
                    />
                  )}
                  {active === "study-track" && (
                    <StudyTrackSection
                      stream={profile?.stream ?? null}
                      gradeLevel={profile?.gradeLevel ?? null}
                      onStream={handleStream}
                      onGrade={handleGrade}
                    />
                  )}
                  {active === "tutor" && (
                    <TutorSection prefs={tutorPrefs} onChange={patchTutor} />
                  )}
                  {active === "reader" && (
                    <ReaderSection prefs={readerPrefs} onChange={patchReader} />
                  )}
                  {active === "appearance" && (
                    <AppearanceSection
                      theme={theme}
                      themeChoice={themeChoice}
                      onTheme={changeTheme}
                    />
                  )}
                  {active === "accessibility" && (
                    <AccessibilitySection prefs={a11y} onChange={patchA11y} />
                  )}
                  {active === "reminders" && (
                    <RemindersSection
                      enabled={reminderSettings?.enabled ?? true}
                      hour={reminderSettings?.hour ?? 19}
                      onChange={updateReminderSettings}
                      quietHours={quietHours}
                      onQuietHours={setQuietHours}
                    />
                  )}
                  {active === "digest" && <TelegramLinkSection />}
                  {active === "music" && <ConnectMusicSection />}
                  {active === "referrals" && <ReferralSection />}
                  {active === "help" && (
                    <HelpSection
                      userEmail={profile?.email ?? user?.email ?? ""}
                      displayName={profile?.displayName ?? user?.name ?? ""}
                      onReplayTour={() => {
                        startTour();
                        toast.success("Welcome tour restarted.");
                      }}
                    />
                  )}
                  {active === "data-privacy" && (
                    <DataSection
                      savedCount={bookmarkIds?.length ?? 0}
                      conversationCount={conversations?.length ?? 0}
                      profile={profile}
                      user={user}
                      streak={streak}
                      level={level}
                    />
                  )}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* RIGHT — YOUR LEARNYX live summary (xl+) */}
          <YourLearnyxPanel
            profile={profile}
            initials={initials}
            streamLabel={streamLabel}
            streak={streak}
            level={level}
            savedCount={bookmarkIds?.length ?? 0}
            weekHours={weekHours}
            lastSession={lastSession}
            onNavigate={navigate}
          />
        </div>
      </div>

      {/* In-app testimonial submission */}
      <ShareExperienceDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        defaultName={profile?.displayName ?? profile?.name ?? ""}
      />
    </DashboardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LEFT — sticky settings navigation
// lg+: vertical grouped rail · below lg: horizontal scrolling chips
// ═══════════════════════════════════════════════════════════════════════

function SettingsNav({
  active,
  onSelect,
}: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <nav aria-label="Settings sections" className="min-w-0">
      {/* ── Compact horizontal chips (below lg) ── */}
      <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {NAV_GROUPS.flatMap((group) => group.items).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active === item.id ? "true" : undefined}
            className={cn(
              "interactive-press flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold whitespace-nowrap",
              active === item.id
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/50 bg-card/40 text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="size-3.5" />
            {item.title}
          </button>
        ))}
      </div>

      {/* ── Full grouped rail (lg+) ── */}
      <div className="sticky top-6 hidden flex-col gap-4 lg:flex">
        {NAV_GROUPS.map((group) => (
          <div key={group.id}>
            <p className="type-mono mb-1.5 px-3 text-[9px] font-bold uppercase tracking-[0.26em] text-muted-foreground/70">
              {group.label}
            </p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={isActive ? "true" : undefined}
                    className={cn(
                      "interactive-press group relative flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-left",
                      isActive
                        ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgb(251,191,36/0.16)]"
                        : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                    )}
                  >
                    {/* gold active bar */}
                    <span
                      className={cn(
                        "absolute top-1/2 left-0 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-primary transition-opacity",
                        isActive ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <item.icon className={cn("size-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{item.title}</span>
                      <span className="block truncate text-[10px] text-muted-foreground/70">{item.blurb}</span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "size-3.5 shrink-0 transition-all",
                        isActive ? "text-primary opacity-100" : "opacity-0 group-hover:opacity-40",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// RIGHT — "YOUR LEARNYX" live summary panel (xl+)
// ═══════════════════════════════════════════════════════════════════════

function YourLearnyxPanel({
  profile,
  initials,
  streamLabel,
  streak,
  level,
  savedCount,
  weekHours,
  lastSession,
  onNavigate,
}: {
  profile: ProfileShape;
  initials: string;
  streamLabel: string | null;
  streak: { currentStreak: number; longestStreak: number; totalHoursStudied: number } | undefined;
  level: { currentLevel: number; totalXp: number } | undefined;
  savedCount: number;
  weekHours: number | null;
  lastSession: { subjectName: string; startedAt: number } | null;
  onNavigate: (path: string) => void;
}) {
  const formatHours = (h: number) => {
    const totalMinutes = Math.round(h * 60);
    return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
  };

  const lastStudiedLabel = lastSession
    ? new Date(lastSession.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : null;

  return (
    <aside className="sticky top-6 hidden xl:block" aria-label="Your Learnyx summary">
      <div className="glass-panel relative overflow-hidden rounded-2xl p-5">
        <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-primary/[0.07] blur-3xl" />

        {/* Identity */}
        <p className="type-mono text-[9px] font-bold uppercase tracking-[0.26em] text-muted-foreground">
          Your Learnyx
        </p>
        <div className="relative mt-3 flex items-center gap-3">
          <span className="rounded-full bg-gradient-to-br from-primary/60 via-primary/30 to-transparent p-[1.5px]">
            <Avatar className="size-11 rounded-full">
              <AvatarImage src={profile?.avatarUrl ?? undefined} />
              <AvatarFallback className="rounded-full bg-card text-sm font-bold text-primary">
                {initials || "N"}
              </AvatarFallback>
            </Avatar>
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{profile?.displayName ?? "Student"}</p>
            <p className="type-mono truncate text-[10px] text-muted-foreground">
              {profile?.gradeLevel ? `Grade ${profile.gradeLevel}` : "Grade —"}
              {streamLabel ? ` · ${streamLabel}` : ""}
            </p>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-4 flex flex-col gap-1 border-t border-border/50 pt-4">
          <StatRow icon={Flame} label="Day streak" value={streak ? `${streak.currentStreak}` : "—"} gold />
          <StatRow icon={Zap} label="Level" value={level ? `${level.currentLevel} · ${level.totalXp.toLocaleString()} XP` : "—"} />
          <StatRow icon={BookOpen} label="Saved resources" value={`${savedCount}`} />
          <StatRow icon={Timer} label="Studied this week" value={weekHours === null ? "—" : formatHours(weekHours)} />
        </div>

        {/* Today */}
        <div className="mt-4 rounded-xl border border-border/50 bg-card/40 p-3.5">
          <p className="type-mono text-[9px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
            Continue
          </p>
          {lastSession ? (
            <>
              <p className="mt-1.5 text-sm font-bold">{lastSession.subjectName}</p>
              <p className="type-caption text-muted-foreground">
                Last studied {lastStudiedLabel}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm font-semibold text-muted-foreground">
              No sessions yet — your first one starts a streak.
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="interactive-press h-8 flex-1 cursor-pointer rounded-lg text-xs"
              onClick={() => onNavigate("/library")}
            >
              Library
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="interactive-press h-8 flex-1 cursor-pointer rounded-lg border-border/60 bg-card/40 text-xs hover:border-primary/40"
              onClick={() => onNavigate("/exam-prep")}
            >
              Exam prep
            </Button>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatRow({
  icon: Icon,
  label,
  value,
  gold,
}: {
  icon: typeof Flame;
  label: string;
  value: string;
  gold?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
      <Icon className={cn("size-4 shrink-0", gold ? "text-primary" : "text-muted-foreground/70")} />
      <span className="type-caption flex-1 text-muted-foreground">{label}</span>
      <span className={cn("type-mono text-xs font-bold", gold ? "text-primary" : "text-foreground")}>
        {value}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ACCOUNT SECTIONS
// ═══════════════════════════════════════════════════════════════════════

type ProfileShape = {
  displayName?: string | null;
  name?: string | null;
  email?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  stream?: string | null;
  gradeLevel?: number | null;
} | null | undefined;

function ProfileSection({
  profile,
  user,
  initials,
  uploadingAvatar,
  fileInputRef,
  onAvatar,
  displayName,
  setDisplayName,
  nameDirty,
  setNameDirty,
  onSaveName,
  username,
  setUsernameValue,
  usernameDirty,
  setUsernameDirty,
  usernameError,
  setUsernameError,
  onSaveUsername,
  onOpenShare,
  streakDays,
  savedCount,
}: {
  profile: ProfileShape;
  user?: { name?: string; email?: string } | null;
  initials: string;
  uploadingAvatar: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onAvatar: (file: File | null) => Promise<void>;
  displayName: string;
  setDisplayName: (v: string) => void;
  nameDirty: boolean;
  setNameDirty: (v: boolean) => void;
  onSaveName: () => Promise<void>;
  username: string;
  setUsernameValue: (v: string) => void;
  usernameDirty: boolean;
  setUsernameDirty: (v: boolean) => void;
  usernameError: string | null;
  setUsernameError: (v: string | null) => void;
  onSaveUsername: () => Promise<void>;
  onOpenShare: () => void;
  streakDays: number | null;
  savedCount: number | null;
}) {
  return (
    <>
      {/* Identity card */}
      <SectionCard>
        <CardEyebrow icon={UserRound} label="who you are" />

        <div className="mt-5 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            {/* Subtle gold ring around the avatar */}
            <span className="rounded-[22px] bg-gradient-to-br from-primary/70 via-primary/25 to-transparent p-[2px]">
              <Avatar className="size-20 rounded-[20px]">
                <AvatarImage src={profile?.avatarUrl ?? undefined} />
                <AvatarFallback className="rounded-[20px] bg-primary/10 text-xl font-bold text-primary">
                  {initials || "N"}
                </AvatarFallback>
              </Avatar>
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label="Upload avatar"
              className="interactive-press absolute -right-1.5 -bottom-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_16px_-4px_rgb(251,191,36/0.5)] disabled:opacity-60"
            >
              {uploadingAvatar ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Camera className="size-3.5" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onAvatar(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold tracking-tight">
              {profile?.displayName ?? user?.name ?? "Guest"}
            </p>
            <p className="type-mono truncate text-xs text-muted-foreground">
              {profile?.username ? `@${profile.username}` : "no handle yet"}
              {profile?.email ? ` · ${profile.email}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {profile?.stream && (
                <Badge className="glass-chip type-mono gap-1 border-0 text-[10px] text-primary">
                  <Atom className="size-3" /> {STREAM_LABELS[profile.stream as keyof typeof STREAM_LABELS]}
                </Badge>
              )}
              {profile?.gradeLevel && (
                <Badge className="glass-chip type-mono gap-1 border-0 text-[10px] text-primary">
                  <GraduationCap className="size-3" /> Grade {profile.gradeLevel}
                </Badge>
              )}
              {streakDays !== null && streakDays > 0 && (
                <Badge className="glass-chip type-mono gap-1 border-0 text-[10px] text-primary">
                  <Flame className="size-3" /> {streakDays}-day streak
                </Badge>
              )}
              {savedCount !== null && savedCount > 0 && (
                <Badge className="glass-chip type-mono gap-1 border-0 text-[10px] text-muted-foreground">
                  <BookOpen className="size-3" /> {savedCount} saved
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Display name */}
        <div className="mt-6 flex flex-col gap-2">
          <Label className="type-caption font-semibold text-muted-foreground">Display name</Label>
          <div className="flex gap-2">
            <Input
              value={nameDirty ? displayName : (displayName || (profile?.displayName ?? user?.name ?? ""))}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameDirty(true);
              }}
              placeholder="How the tutor should call you"
              className="type-body h-10 rounded-xl bg-card/50 font-mono"
            />
            <SaveButton onSave={onSaveName} disabled={!nameDirty} />
          </div>
        </div>

        {/* Username */}
        <div className="mt-4 flex flex-col gap-2">
          <Label className="type-caption font-semibold text-muted-foreground">Username (login handle)</Label>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                value={usernameDirty ? username : (username || (profile?.username ?? ""))}
                onChange={(e) => {
                  setUsernameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                  setUsernameDirty(true);
                  setUsernameError(null);
                }}
                placeholder="e.g. abebe_12"
                className="type-body h-10 rounded-xl bg-card/50 font-mono"
              />
              {usernameError ? (
                <p className="type-caption mt-1 text-destructive">{usernameError}</p>
              ) : (
                <p className="type-caption mt-1 text-muted-foreground">
                  {profile?.username
                    ? `Sign in with your username or email — "${profile.username}".`
                    : "Optional: pick one so you can sign in with your username instead of your email."}
                </p>
              )}
            </div>
            <SaveButton onSave={onSaveUsername} disabled={!usernameDirty} />
          </div>
        </div>
      </SectionCard>

      {/* Share your experience */}
      <SectionCard className="relative overflow-hidden">
        <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-primary/[0.06] blur-[60px]" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquareQuote className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="type-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">
                // share your story
              </p>
              <p className="type-body mt-1 font-bold">
                Tell other students what Learnyx has done for you
              </p>
              <p className="type-caption mt-1 max-w-lg text-muted-foreground">
                Real words from real students only — your submission goes to our team for
                review. If featured, it&apos;ll appear on the public landing page to help
                other students discover Learnyx.
              </p>
            </div>
          </div>
          <Button
            className="interactive-press shrink-0 cursor-pointer rounded-xl"
            onClick={onOpenShare}
          >
            <Sparkles className="size-4" /> Share your experience
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

function MembershipSection({
  subscription,
}: {
  subscription: { status?: string; planTier?: string; trialDaysRemaining?: number; needsUpgrade?: boolean } | undefined;
}) {
  const isActive = subscription?.status === "active";
  const isTrial = subscription?.status === "trial";

  return (
    <SectionCard className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-premium/10 blur-[40px]" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-premium/10 text-premium shadow-[0_0_20px_-8px_rgb(245_197_66/0.5)]">
            <Crown className="size-5" />
          </div>
          <div>
            <p className="type-mono text-[10px] font-bold uppercase tracking-[0.22em] text-premium">
              ✦ Learnyx Premium {isActive ? "· active ✓" : isTrial ? "· trial" : ""}
            </p>
            <p className="type-body mt-0.5 font-bold">
              {isActive
                ? "Your premium learning tools are unlocked."
                : isTrial
                  ? `Free trial · ${subscription?.trialDaysRemaining ?? 0} active day${subscription?.trialDaysRemaining === 1 ? "" : "s"} left`
                  : subscription?.needsUpgrade
                    ? "Trial ended — premium paused"
                    : "No active subscription"}
            </p>
            <p className="type-mono mt-0.5 text-[10px] text-muted-foreground">
              status: {subscription?.status ?? "checking…"} · tier: {subscription?.planTier ?? "premium"}
            </p>
          </div>
        </div>
        {subscription?.needsUpgrade ? (
          <Button asChild className="interactive-press rounded-xl">
            <a href="/upgrade">Upgrade now</a>
          </Button>
        ) : (
          <Badge className="glass-chip gap-1 border-0 type-mono text-[10px] text-emerald-400">
            <Check className="size-3" /> access granted
          </Badge>
        )}
      </div>

      {/* What's unlocked */}
      <div className="relative mt-5 grid grid-cols-2 gap-2 border-t border-border/50 pt-4 sm:grid-cols-4">
        {[
          { label: "AI Tutor", on: true },
          { label: "Advanced Practice", on: true },
          { label: "Mock Exams", on: true },
          { label: "Study Analytics", on: true },
        ].map((f) => (
          <div
            key={f.label}
            className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-3 py-2"
          >
            {f.on ? (
              <Check className="size-3.5 shrink-0 text-primary" />
            ) : (
              <Shield className="size-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <span className="type-caption truncate text-foreground/90">{f.label}</span>
          </div>
        ))}
      </div>

      <div className="relative mt-4 flex justify-end">
        <Button asChild variant="outline" size="sm" className="cursor-pointer rounded-xl border-border/60 bg-card/40 hover:border-primary/40">
          <a href="/plans">
            Manage membership <ChevronRight className="size-3.5" />
          </a>
        </Button>
      </div>
    </SectionCard>
  );
}

function SecuritySection({
  email,
  onSignOut,
  onReplayTour,
}: {
  email: string;
  onSignOut: () => Promise<void> | void;
  onReplayTour: () => void;
}) {
  return (
    <>
      <SectionCard>
        <CardEyebrow icon={ShieldCheck} label="account security" />
        <div className="mt-5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/30 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UserRound className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="type-body text-sm font-semibold">Passwordless sign-in</p>
                <p className="type-caption truncate text-muted-foreground">
                  {email ? `${email} · verification code or username` : "Verification code or username"}
                </p>
              </div>
            </div>
            <Badge className="glass-chip gap-1 border-0 type-mono text-[10px] text-emerald-400">
              <Check className="size-3" /> enabled
            </Badge>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/30 p-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Monitor className="size-4" />
              </div>
              <div className="min-w-0">
                <p className="type-body text-sm font-semibold">This device</p>
                <p className="type-caption truncate text-muted-foreground">
                  Active session · signed in now
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="interactive-press cursor-pointer rounded-xl border-border/60 bg-card/40 text-muted-foreground hover:text-destructive"
              onClick={() => void onSignOut()}
            >
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>

          <p className="type-caption px-1 text-muted-foreground/70">
            Signing out keeps your streak, notes and progress saved to your account.
          </p>
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Compass} label="onboarding" />
        <p className="type-body mt-3 text-sm font-semibold">Replay the welcome tour</p>
        <p className="type-caption mt-1 text-muted-foreground">
          Refresh your memory — a short walkthrough of Library, Tutor, Exam Prep and Focus.
        </p>
        <Button
          variant="outline"
          className="interactive-press mt-3 w-full cursor-pointer justify-start gap-3 rounded-xl border-border/60 bg-card/40 hover:border-primary/40 hover:bg-primary/5"
          onClick={onReplayTour}
        >
          <Compass className="size-4 text-primary" />
          Start the tour
        </Button>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LEARNING SECTIONS
// ═══════════════════════════════════════════════════════════════════════

function StudyTrackSection({
  stream,
  gradeLevel,
  onStream,
  onGrade,
}: {
  stream: string | null;
  gradeLevel: number | null;
  onStream: (s: "natural" | "social") => Promise<void>;
  onGrade: (g: 9 | 10 | 11 | 12) => Promise<void>;
}) {
  return (
    <>
      <SectionCard>
        <CardEyebrow icon={Atom} label="your study track" />
        <p className="type-caption mt-3 text-muted-foreground">
          The AI tutor and dashboard organize around your stream&apos;s exam subjects.
          English, Mathematics and the SAT are part of both streams.
        </p>
        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {STREAM_OPTIONS.map((option) => {
            const active = stream === option.id;
            return (
              <ChoiceTile key={option.id} active={active} onClick={() => void onStream(option.id)}>
                <option.icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
                <p className="type-body mt-2 font-semibold">{option.label}</p>
                <p className="type-mono text-[10px] text-muted-foreground">{option.subjects}</p>
                <p className="type-mono text-[10px] text-muted-foreground/70">
                  + {SHARED_SUBJECTS} <span className="text-primary/70">(both streams)</span>
                </p>
              </ChoiceTile>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={GraduationCap} label="grade level" />
        <p className="type-caption mt-3 text-muted-foreground">
          We use this to default the Library to your grade&apos;s resources. Grade 12
          sees all 4 years since the EHEEE/ESSLCE covers the cumulative curriculum.
          You can always browse any grade from the Library filter.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {([9, 10, 11, 12] as const).map((g) => {
            const active = gradeLevel === g;
            return (
              <ChoiceTile
                key={g}
                active={active}
                onClick={() => void onGrade(g)}
                className="flex flex-col items-center gap-1 p-3 text-center"
                ariaLabel={`Grade ${g}`}
              >
                <span className={cn("text-2xl font-extrabold", active ? "text-primary" : "text-foreground/90")}>
                  {g}
                </span>
                <span className="type-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  {g === 12 ? "exam year" : "grade"}
                </span>
                {g === 12 && (
                  <span className="type-mono text-[8px] text-primary/70">all 4 years</span>
                )}
              </ChoiceTile>
            );
          })}
        </div>
        <p className="type-caption mt-3 flex items-start gap-1.5 text-muted-foreground/80">
          <Sparkles className="mt-0.5 size-3 shrink-0 text-primary/70" />
          Your study track controls recommendations, Tutor context, Library defaults,
          Exam Prep and mock-exam content.
        </p>
      </SectionCard>
    </>
  );
}

function TutorSection({
  prefs,
  onChange,
}: {
  prefs: TutorPrefs;
  onChange: (patch: Partial<TutorPrefs>) => void;
}) {
  return (
    <>
      <SectionCard>
        <CardEyebrow icon={Bot} label="how should the tutor teach you?" />
        <div className="mt-5 flex flex-col gap-5">
          <div>
            <Label className="type-caption font-semibold text-muted-foreground">Explanation style</Label>
            <div className="mt-2">
              <Segmented
                ariaLabel="Explanation style"
                value={prefs.explain}
                options={[
                  { value: "concise", label: "Concise" },
                  { value: "balanced", label: "Balanced" },
                  { value: "detailed", label: "Detailed" },
                ]}
                onChange={(explain) => onChange({ explain, concise: explain === "concise" })}
              />
            </div>
            <p className="type-caption mt-1.5 text-muted-foreground/70">
              Concise mirrors the tutor&apos;s existing short-answer mode — both stay in sync.
            </p>
          </div>

          <div>
            <Label className="type-caption font-semibold text-muted-foreground">Difficulty</Label>
            <div className="mt-2">
              <Segmented
                ariaLabel="Difficulty"
                value={prefs.difficulty}
                options={[
                  { value: "beginner", label: "Beginner" },
                  { value: "exam", label: "Exam level" },
                  { value: "advanced", label: "Advanced" },
                ]}
                onChange={(difficulty) => onChange({ difficulty })}
              />
            </div>
          </div>

          <div>
            <Label className="type-caption font-semibold text-muted-foreground">Answer style</Label>
            <div className="mt-2 flex flex-col gap-2">
              <ToggleRow
                checked={prefs.showReasoning}
                onCheckedChange={(showReasoning) => onChange({ showReasoning })}
                title="Show reasoning"
                desc="Walk through the why, not just the final line."
              />
              <ToggleRow
                checked={prefs.giveExamples}
                onCheckedChange={(giveExamples) => onChange({ giveExamples })}
                title="Give examples"
                desc="Anchor every explanation to a worked example."
              />
              <ToggleRow
                checked={prefs.answerImmediately}
                onCheckedChange={(answerImmediately) => onChange({ answerImmediately })}
                title="Give the answer immediately"
                desc="Lead with the answer, then explain — good for checking work."
              />
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Languages} label="voice & language" />
        <div className="mt-4 flex flex-col gap-4">
          <ToggleRow
            checked={prefs.voiceOut}
            onCheckedChange={(voiceOut) => onChange({ voiceOut })}
            title="Read answers aloud"
            desc="The tutor speaks its answers — useful for audio learners."
          />
          <div>
            <Label className="type-caption font-semibold text-muted-foreground">AI language</Label>
            <Select value={prefs.language} onValueChange={(v) => onChange({ language: v as TutorPrefs["language"] })}>
              <SelectTrigger className="mt-2 h-11 rounded-xl bg-card/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto — match the language you write in</SelectItem>
                <SelectItem value="english">English</SelectItem>
                <SelectItem value="amharic">አማርኛ · Amharic</SelectItem>
                <SelectItem value="tigrinya">ትግርኛ · Tigrinya</SelectItem>
                <SelectItem value="afaan-oromoo">Afaan Oromoo</SelectItem>
              </SelectContent>
            </Select>
            <p className="type-caption mt-1.5 text-muted-foreground/70">
              Applies to your AI Tutor sessions — explanation style and voice take effect on your next message.
            </p>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

function ReaderSection({
  prefs,
  onChange,
}: {
  prefs: ReaderPrefs;
  onChange: (patch: Partial<ReaderPrefs>) => void;
}) {
  return (
    <>
      <SectionCard>
        <CardEyebrow icon={BookOpen} label="textbook defaults" />
        <p className="type-caption mt-3 text-muted-foreground">
          How every textbook opens — the Reader applies these on launch. Stored on this device.
        </p>
        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label className="type-caption font-semibold text-muted-foreground">Default zoom</Label>
            <div className="mt-2">
              <Segmented
                ariaLabel="Default zoom"
                value={prefs.defaultZoom}
                options={[
                  { value: "fit", label: "Fit width" },
                  { value: "100", label: "100%" },
                  { value: "125", label: "125%" },
                ]}
                onChange={(defaultZoom) => onChange({ defaultZoom })}
              />
            </div>
          </div>

          <ToggleRow
            checked={prefs.companionOpen}
            onCheckedChange={(companionOpen) => onChange({ companionOpen })}
            title="AI Reading Companion panel"
            desc="Open the companion sidebar automatically on desktop."
          />

          <ToggleRow
            checked
            onCheckedChange={() => toast.info("Always on — the Reader saves your position locally after every page turn.")}
            disabled
            title="Auto-save reading position"
            desc="Resume exactly where you stopped — already built into every book."
          />
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Sparkles} label="good to know" />
        <p className="type-caption mt-3 leading-relaxed text-muted-foreground">
          Highlights, reading progress and the scratchpad are stored locally on this
          device — instant, private, and they survive offline. Bookmarks and notes
          tied to your account stay synced wherever you sign in.
        </p>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EXPERIENCE SECTIONS
// ═══════════════════════════════════════════════════════════════════════

const THEME_CHOICES: { id: ThemeChoice; title: string; sub: string; icon: typeof Moon; swatch: string }[] = [
  { id: "dark", title: "Obsidian", sub: "Premium dark", icon: Moon, swatch: "linear-gradient(135deg,#171511,#0B0A08 60%,#1D1A15)" },
  { id: "light", title: "Paper", sub: "Warm light", icon: Sun, swatch: "linear-gradient(135deg,#F7F5F0,#EFEAE0 60%,#FFFFFF)" },
  { id: "system", title: "System", sub: "Follow your OS", icon: Monitor, swatch: "linear-gradient(105deg,#F7F5F0 49.5%,#0B0A08 50.5%)" },
];

function AppearanceSection({
  theme,
  themeChoice,
  onTheme,
}: {
  theme: "dark" | "light";
  themeChoice: ThemeChoice;
  onTheme: (choice: ThemeChoice) => void;
}) {
  return (
    <>
      <SectionCard>
        <CardEyebrow icon={Sun} label="theme" />
        <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
          {THEME_CHOICES.map((choice) => {
            const active = themeChoice === choice.id;
            return (
              <ChoiceTile key={choice.id} active={active} onClick={() => onTheme(choice.id)} ariaLabel={`${choice.title} theme`}>
                <div
                  className="h-14 w-full rounded-lg border border-border/40"
                  style={{ background: choice.swatch }}
                  aria-hidden="true"
                />
                <div className="mt-2.5 flex items-center gap-2">
                  <choice.icon className={cn("size-4", active ? "text-primary" : "text-muted-foreground")} />
                  <p className="type-body text-sm font-semibold">{choice.title}</p>
                </div>
                <p className="type-caption mt-0.5 text-muted-foreground">{choice.sub}</p>
              </ChoiceTile>
            );
          })}
        </div>
        {themeChoice === "system" && (
          <p className="type-caption mt-3 flex items-center gap-1.5 text-muted-foreground">
            <Monitor className="size-3.5 text-primary/70" />
            Following your OS — currently showing {theme === "dark" ? "Obsidian" : "Paper"}.
          </p>
        )}
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Sparkles} label="accent" />
        <div className="mt-4 flex flex-col gap-2.5">
          <ChoiceTile active onClick={() => {}} className="flex items-center gap-3">
            <span className="size-8 shrink-0 rounded-lg bg-gradient-to-br from-[#F4C45F] via-[#E6A72E] to-[#8A641F] shadow-[0_2px_10px_-2px_rgb(230_167_46/0.5)]" />
            <div className="min-w-0 flex-1">
              <p className="type-body text-sm font-semibold">Learnyx Gold</p>
              <p className="type-caption text-muted-foreground">The Learnyx identity — gold of the Ethiopian visual heritage</p>
            </div>
            <Badge className="glass-chip border-0 type-mono text-[9px] text-primary">default</Badge>
          </ChoiceTile>
          <p className="type-caption px-1 text-muted-foreground/70">
            More accents (Sage, Amber) may arrive later — Gold stays the Learnyx identity.
          </p>
        </div>
      </SectionCard>

      {/* Live preview — token-driven, so it re-themes with the page instantly */}
      <SectionCard>
        <CardEyebrow icon={Eye} label="live preview" />
        <p className="type-caption mt-3 text-muted-foreground">
          A miniature of your dashboard — switch themes above and watch it follow.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-border/60 bg-background">
          <div className="flex items-center justify-between border-b border-border/50 bg-card/50 px-4 py-2.5">
            <span className="type-mono text-[9px] font-bold uppercase tracking-[0.22em] text-primary">// learlyx</span>
            <span className="type-mono text-[9px] text-muted-foreground">dashboard · preview</span>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border/40 bg-card/40 p-3">
              <p className="type-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground">Study streak</p>
              <p className="mt-1 text-xl font-extrabold text-primary">12 days</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                <div className="h-full w-[72%] rounded-full bg-primary" />
              </div>
            </div>
            <div className="rounded-lg border border-border/40 bg-card/40 p-3">
              <p className="type-mono text-[8px] uppercase tracking-[0.2em] text-muted-foreground">Exam readiness</p>
              <p className="mt-1 text-xl font-extrabold text-foreground">47%</p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                <div className="h-full w-[47%] rounded-full bg-gradient-to-r from-primary to-[#F7E3AD]" />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-card/40 px-3 py-2.5 sm:col-span-2">
              <span className="type-caption text-muted-foreground">Physics · Kinematics</span>
              <span className="rounded-lg bg-primary px-3 py-1 text-[10px] font-bold text-primary-foreground">
                Continue studying
              </span>
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

function AccessibilitySection({
  prefs,
  onChange,
}: {
  prefs: A11yPrefs;
  onChange: (patch: Partial<A11yPrefs>) => void;
}) {
  const scales: { value: TextScale; label: string }[] = [
    { value: "compact", label: "A−" },
    { value: "normal", label: "A" },
    { value: "large", label: "A+" },
  ];

  return (
    <>
      <SectionCard>
        <CardEyebrow icon={TypeIcon} label="text size" />
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <p className="type-body text-sm font-semibold">Interface text size</p>
            <p className="type-caption text-muted-foreground">
              Scales type across the whole app — layout stays fluid.
            </p>
          </div>
          <Segmented
            ariaLabel="Text size"
            value={prefs.textScale}
            options={scales}
            onChange={(textScale) => onChange({ textScale })}
          />
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Accessibility} label="comfort" />
        <div className="mt-4 flex flex-col gap-2">
          <ToggleRow
            checked={prefs.reduceMotion}
            onCheckedChange={(reduceMotion) => onChange({ reduceMotion })}
            title="Reduce motion"
            desc="Calms animations across Learnyx — no pulses, no sweeps."
          />
          <ToggleRow
            checked={prefs.highContrast}
            onCheckedChange={(highContrast) => onChange({ highContrast })}
            title="High contrast"
            desc="Firm up borders and text so nothing fades into the background."
          />
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={ShieldCheck} label="built in" />
        <p className="type-caption mt-3 leading-relaxed text-muted-foreground">
          Keyboard navigation and screen-reader semantics are always on — every control
          on this page carries real labels and focus states. Learnyx also respects your
          OS-level reduced-motion preference automatically.
        </p>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// NOTIFICATIONS SECTIONS
// ═══════════════════════════════════════════════════════════════════════

const HOUR_OPTIONS = [6, 7, 8, 9, 12, 17, 18, 19, 20, 21, 22];

function RemindersSection({
  enabled,
  hour,
  onChange,
  quietHours,
  onQuietHours,
}: {
  enabled: boolean;
  hour: number;
  onChange: (args: { enabled?: boolean; hour?: number }) => Promise<{ ok: boolean }>;
  quietHours: QuietHours;
  onQuietHours: (q: QuietHours) => void;
}) {
  const friendlyError = useFriendlyError();
  const [saving, setSaving] = useState(false);

  const apply = async (patch: { enabled?: boolean; hour?: number }) => {
    setSaving(true);
    try {
      await onChange(patch);
      if (patch.enabled !== undefined) {
        toast.success(patch.enabled ? "Study reminders on." : "Study reminders off.");
      }
      if (patch.hour !== undefined) {
        toast.success(`Reminder time set to ${String(patch.hour).padStart(2, "0")}:00.`);
      }
    } catch (error) {
      toast.error(friendlyError(error, "Could not update your reminders."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionCard>
        <CardEyebrow icon={Bell} label="study reminders" />
        <p className="type-caption mt-3 text-muted-foreground">
          One gentle nudge when you haven&apos;t studied today — sent only if you&apos;ve
          been inactive. Never spam, never repeated.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <ToggleRow
            checked={enabled}
            onCheckedChange={(next) => void apply({ enabled: next })}
            title="Study reminders"
            desc="A nudge when you haven't studied today."
          />
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-card/30 p-4">
            <div className="min-w-0">
              <p className="type-body text-sm font-semibold">Reminder time</p>
              <p className="type-caption mt-0.5 text-muted-foreground">
                When the nudge may arrive.
              </p>
            </div>
            <Select
              value={String(hour)}
              onValueChange={(v) => void apply({ hour: Number(v) })}
              disabled={saving || !enabled}
            >
              <SelectTrigger className="h-9 w-[110px] rounded-xl bg-card/50 text-sm" aria-label="Reminder hour">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOUR_OPTIONS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, "0")}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Moon} label="quiet hours" />
        <p className="type-caption mt-3 text-muted-foreground">
          Mute the in-app reminder banner during these hours — nudges wait for morning.
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <ToggleRow
            checked={quietHours.enabled}
            onCheckedChange={(qEnabled) => onQuietHours({ ...quietHours, enabled: qEnabled })}
            title="Enable quiet hours"
            desc="No reminder banners while you rest."
          />
          <div className="flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card/30 p-4">
            <span className="type-body text-sm font-semibold">Window</span>
            <div className="flex items-center gap-2">
              <Select
                value={String(quietHours.start)}
                onValueChange={(v) => onQuietHours({ ...quietHours, start: Number(v) })}
                disabled={!quietHours.enabled}
              >
                <SelectTrigger className="h-9 w-[92px] rounded-xl bg-card/50 text-sm" aria-label="Quiet start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="type-mono text-xs text-muted-foreground">→</span>
              <Select
                value={String(quietHours.end)}
                onValueChange={(v) => onQuietHours({ ...quietHours, end: Number(v) })}
                disabled={!quietHours.enabled}
              >
                <SelectTrigger className="h-9 w-[92px] rounded-xl bg-card/50 text-sm" aria-label="Quiet end">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, h) => h).map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, "0")}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </SectionCard>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CONNECT + DATA SECTIONS
// ═══════════════════════════════════════════════════════════════════════

function HelpSection({
  userEmail,
  displayName,
  onReplayTour,
}: {
  userEmail: string;
  displayName: string;
  onReplayTour: () => void;
}) {
  return (
    <>
      <SectionCard>
        <div className="flex items-center justify-between gap-3">
          <CardEyebrow icon={Compass} label="lost?" />
          <Button
            variant="outline"
            size="sm"
            className="interactive-press cursor-pointer rounded-xl border-border/60 bg-card/40 hover:border-primary/40"
            onClick={onReplayTour}
          >
            <Compass className="size-3.5 text-primary" /> Replay the tour
          </Button>
        </div>
      </SectionCard>
      <ContactSection userEmail={userEmail} displayName={displayName} />
    </>
  );
}

function DataSection({
  savedCount,
  conversationCount,
  profile,
  user,
  streak,
  level,
}: {
  savedCount: number;
  conversationCount: number;
  profile: ProfileShape;
  user?: { name?: string; email?: string } | null;
  streak: { currentStreak: number; totalHoursStudied: number } | undefined;
  level: { currentLevel: number; totalXp: number } | undefined;
}) {
  const [storageBytes, setStorageBytes] = useState<number | null>(null);

  useEffect(() => {
    // Real on-device footprint (IndexedDB PDF cache, localStorage, …).
    let cancelled = false;
    const estimate = async () => {
      try {
        if (navigator.storage?.estimate) {
          const { usage } = await navigator.storage.estimate();
          if (!cancelled && typeof usage === "number") setStorageBytes(usage);
        }
      } catch {
        // unsupported — leave null
      }
    };
    void estimate();
    return () => {
      cancelled = true;
    };
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  };

  const handleExport = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      profile: {
        displayName: profile?.displayName ?? user?.name ?? null,
        email: profile?.email ?? user?.email ?? null,
        username: profile?.username ?? null,
        stream: profile?.stream ?? null,
        gradeLevel: profile?.gradeLevel ?? null,
      },
      stats: {
        currentStreak: streak?.currentStreak ?? 0,
        totalHoursStudied: streak?.totalHoursStudied ?? 0,
        level: level?.currentLevel ?? null,
        totalXp: level?.totalXp ?? null,
        savedResources: savedCount,
        aiConversations: conversationCount,
      },
      note: "Exported from Learnyx Academy ET — Settings → Storage & export.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `learnyx-data-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Your data export has downloaded.");
  };

  return (
    <>
      <SectionCard>
        <CardEyebrow icon={HardDrive} label="your footprint" />
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <FootprintStat label="Saved resources" value={String(savedCount)} />
          <FootprintStat label="AI conversations" value={String(conversationCount)} />
          <FootprintStat label="Study streak" value={streak ? `${streak.currentStreak}d` : "—"} />
          <FootprintStat label="On this device" value={storageBytes !== null ? formatBytes(storageBytes) : "—"} />
        </div>
        <p className="type-caption mt-3 text-muted-foreground/70">
          On-device usage includes the offline PDF cache — clearing your browser data
          removes it anytime.
        </p>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Download} label="take your data with you" />
        <p className="type-caption mt-3 text-muted-foreground">
          Download a portable copy of your profile and study stats as JSON. It&apos;s
          your data — Learnyx just keeps it safe.
        </p>
        <Button
          className="interactive-press mt-4 cursor-pointer rounded-xl"
          onClick={handleExport}
        >
          <Download className="size-4" /> Export my data
        </Button>
      </SectionCard>

      <SectionCard>
        <CardEyebrow icon={Shield} label="privacy by design" />
        <p className="type-caption mt-3 leading-relaxed text-muted-foreground">
          Reading positions, highlights and scratchpad notes live only on this device.
          Music is embedded — never uploaded or stored. Passwords don&apos;t exist here:
          sign-in is passwordless by code or username. We collect the minimum needed to
          personalize your study experience, nothing more.
        </p>
      </SectionCard>
    </>
  );
}

function FootprintStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-3.5 text-center">
      <p className="text-xl font-extrabold text-primary">{value}</p>
      <p className="type-mono mt-0.5 text-[9px] uppercase tracking-[0.15em] text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

// ─── Referral section ──────────────────────────────────────────────────
function ReferralSection() {
  const referralInfo = useQuery(api.marketing.getMyReferralCode, {});
  const getOrCreate = useMutation(api.marketing.getOrCreateReferralCode);
  const referralStats = useQuery(api.marketing.getMyReferralStats, {});
  const [copied, setCopied] = useState(false);

  // If enabled but no code yet, auto-generate
  useEffect(() => {
    if (referralInfo?.enabled && !referralInfo.code) {
      void getOrCreate({});
    }
  }, [referralInfo, getOrCreate]);

  if (!referralInfo || !referralInfo.enabled) return null;
  if (!referralInfo.code) return null;

  const referralLink = `https://nexus-academy-5nfg.onrender.com/?ref=${referralInfo.code}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Referral link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Learnyx Academy ET 🇪🇹 — Ethiopian Exam Prep",
          text: "Join me on Learnyx Academy ET 🇪🇹 for the best EHEEE exam prep. Use my referral link!",
          url: referralLink,
        });
      } catch {
        // User cancelled — non-fatal
      }
    } else {
      handleCopy();
    }
  };

  const stats = referralStats ?? { signedUp: 0, converted: 0, rewarded: 0, totalRewardDays: 0 };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      className="glass-panel relative overflow-hidden rounded-2xl p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/5 blur-3xl" />
      <div className="relative">
        <p className="type-mono text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
          // refer friends
        </p>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">Refer friends, earn premium</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your link. When a friend upgrades to premium, you both get bonus days — free premium time, no cost.
        </p>

        {/* Referral link */}
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/50 bg-card/[0.03] p-2">
          <span className="flex-1 truncate font-mono text-xs text-foreground/80">{referralLink}</span>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer gap-1.5 rounded-lg bg-card/50"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="sm"
            className="cursor-pointer gap-1.5 rounded-lg"
            onClick={() => void handleShare()}
          >
            <Share2 className="size-3.5" />
            Share
          </Button>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-border/40 bg-card/30 p-3 text-center">
            <p className="type-mono text-2xl font-bold text-gradient">{stats.signedUp}</p>
            <p className="type-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Signed up</p>
          </div>
          <div className="rounded-xl border border-border/40 bg-card/30 p-3 text-center">
            <p className="type-mono text-2xl font-bold text-emerald-300">{stats.converted}</p>
            <p className="type-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Converted</p>
          </div>
          <div className="rounded-xl border border-border/40 bg-card/30 p-3 text-center">
            <p className="type-mono text-2xl font-bold text-primary">{stats.totalRewardDays}</p>
            <p className="type-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Days earned</p>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground/60">
          How it works: your friend must sign up via your link AND upgrade to premium. When their payment is confirmed, you both get bonus days. Self-referrals are blocked.
        </p>
      </div>
    </motion.div>
  );
}

// ─── Contact the team ──────────────────────────────────────────────────
// Users can write a message (question, advice, complaint, bug report)
// and the message is delivered straight to the team's Telegram group(s)
// via the `telegramActions.sendContactMessage` action. Falls back
// gracefully — if Telegram isn't configured, the message is persisted
// in the `contactMessages` table for the admin to read from the
// dashboard.
function ContactSection({
  userEmail,
  displayName,
}: {
  userEmail: string;
  displayName: string;
}) {
  const friendlyError = useFriendlyError();
  const sendContactMessage = useAction(api.telegramActions.sendContactMessage);
  const [name, setName] = useState(displayName ?? "");
  const [email, setEmail] = useState(userEmail ?? "");
  const [category, setCategory] = useState("question");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !message.trim()) {
      toast.error("Please enter your email and a message.");
      return;
    }
    if (message.trim().length < 5) {
      toast.error("Please describe your concern in at least a few words.");
      return;
    }
    setSending(true);
    try {
      const result = await sendContactMessage({
        name: name.trim() || undefined,
        email: email.trim(),
        category,
        message: message.trim(),
      });
      if (result.sent > 0) {
        toast.success("Message sent — our team will reply soon.");
      } else {
        toast.success("Message saved — our team will get back to you.");
      }
      setMessage("");
    } catch (error) {
      toast.error(friendlyError(error, "Could not send your message. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel relative overflow-hidden rounded-2xl p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/[0.04] blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-teal-400/10 text-teal-300 shadow-[0_0_16px_-4px_rgb(45,212,191/0.35)]">
            <LifeBuoy className="size-4" />
          </div>
          <p className="type-mono text-[11px] font-bold uppercase tracking-[0.22em] text-teal-300">
            // contact the team
          </p>
        </div>
        <h2 className="mt-4 text-lg font-extrabold tracking-tight">
          We&apos;re here to help.
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions, advice, complaints, bug reports — anything. Your message
          goes straight to our Telegram group where the team will reply
          quickly. You&apos;ll hear back via email or directly in the app.
        </p>

        {/* Form grid */}
        <div className="mt-5 flex flex-col gap-4">
          {/* Name + email row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                Your name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Abebe Bekele"
                className="h-11 rounded-xl bg-card/50"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                Email (we&apos;ll reply here)
              </Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                className="h-11 rounded-xl bg-card/50"
              />
            </div>
          </div>

          {/* Category picker */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              What is this about?
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-11 rounded-xl bg-card/50 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="question">❓ Question</SelectItem>
                <SelectItem value="advice">💡 Advice</SelectItem>
                <SelectItem value="complaint">⚠️ Complaint</SelectItem>
                <SelectItem value="bug">🐞 Bug report</SelectItem>
                <SelectItem value="other">📝 Something else</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              Your message
            </Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind. The more detail, the faster we can help."
              rows={5}
              className="resize-none rounded-xl bg-card/50 text-sm"
              maxLength={5000}
            />
            <p className="text-[10px] text-muted-foreground/60">
              {message.length} / 5000 characters
            </p>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MessageSquareText className="size-3.5" />
              Delivered to the team&apos;s Telegram group
            </p>
            <Button
              onClick={() => void handleSubmit()}
              disabled={sending || !message.trim() || !email.trim()}
              className="interactive-press cursor-pointer gap-2 rounded-xl"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {sending ? "Sending…" : "Send message"}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Telegram weekly digest linking ───────────────────────────────────
// Students link their OWN Telegram account (separate from the admin
// broadcast bot) to receive a personalized progress digest every Monday
// morning — XP, quiz trends, streak, and a focus tip.
//
// Flow: student clicks "Get linking code" → we generate a 6-char code
// (valid for 10 minutes) → student sends `/start CODE` to the bot → the
// webhook matches the code + creates the link → student gets a
// confirmation reply in Telegram. The Settings UI polls `getMyTelegramLink`
// so the "linked" state appears within a few seconds of the bot reply.
function TelegramLinkSection() {
  const friendlyError = useFriendlyError();
  const link = useQuery(api.telegram.getMyTelegramLink);
  const startLink = useMutation(api.telegram.startTelegramLink);
  const unlink = useMutation(api.telegram.unlinkMyTelegram);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [unLinking, setUnLinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Tick every second so the countdown updates live.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await startLink({});
      setCode({ code: result.code, expiresAt: result.expiresAt });
      setCopied(false);
      toast.success("Linking code generated — send it to the bot within 10 minutes.");
    } catch (error) {
      toast.error(friendlyError(error, "Could not generate a linking code."));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      toast.success("Code copied.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy — type the code manually.");
    }
  };

  const handleUnlink = async () => {
    setUnLinking(true);
    try {
      await unlink({});
      toast.success("Telegram unlinked. You won't receive weekly digests anymore.");
    } catch (error) {
      toast.error(friendlyError(error, "Could not unlink Telegram."));
    } finally {
      setUnLinking(false);
    }
  };

  const isLinked = Boolean(link);
  const secondsLeft = code ? Math.max(0, Math.ceil((code.expiresAt - nowTick) / 1000)) : 0;
  const codeExpired = code && secondsLeft === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel relative overflow-hidden rounded-2xl p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[#229ED9]/[0.08] blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#229ED9]/10 text-[#229ED9] shadow-[0_0_16px_-4px_rgb(34,158,217/0.45)]">
            <TelegramIcon className="size-4" />
          </div>
          <p className="type-mono text-[11px] font-bold uppercase tracking-[0.22em] text-[#229ED9]">
            // weekly digest
          </p>
        </div>
        <h2 className="mt-4 text-lg font-extrabold tracking-tight">
          Link Telegram for weekly updates
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Get a personalized progress report every Monday morning — XP earned,
          quiz trends, your streak, and a focus tip. Honest numbers, no spam,
          cancel anytime.
        </p>

        {/* Linked state */}
        {isLinked ? (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                <Check className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Telegram linked
                </p>
                <p className="text-xs text-muted-foreground">
                  Chat ID <span className="font-mono">{link?.telegramChatId}</span> · linked{" "}
                  {link?.linkedAt
                    ? new Date(link.linkedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                  {link?.lastDigestSentAt
                    ? ` · last digest ${new Date(link.lastDigestSentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                    : " · no digest sent yet (first one lands next Monday)"}
                </p>
              </div>
            </div>
            <Button
              onClick={() => void handleUnlink()}
              disabled={unLinking}
              variant="outline"
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-card/50 text-muted-foreground hover:text-rose-300 disabled:opacity-50"
            >
              {unLinking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlink className="size-4" />
              )}
              {unLinking ? "Unlinking…" : "Unlink Telegram"}
            </Button>
          </div>
        ) : code && !codeExpired ? (
          /* Code generated — show the code + countdown + instructions */
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#229ED9]/20 bg-[#229ED9]/[0.04] p-5 text-center">
              <p className="type-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                your linking code · expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </p>
              <button
                onClick={() => void handleCopy()}
                className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-[#229ED9]/30 bg-[#229ED9]/[0.08] px-6 py-4 transition-colors hover:bg-[#229ED9]/[0.12]"
                title="Click to copy"
              >
                <span className="font-mono text-3xl font-extrabold tracking-[0.3em] text-[#229ED9]">
                  {code.code}
                </span>
                <span className="flex items-center gap-1 rounded-lg bg-[#229ED9]/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#229ED9]">
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied ? "Copied" : "Copy"}
                </span>
              </button>
            </div>

            <div className="rounded-xl border border-border/40 bg-card/30 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <TelegramIcon className="size-3.5 text-[#229ED9]" />
                How to link
              </p>
              <ol className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-mono font-bold text-[#229ED9]">1.</span>
                  Open Telegram and search for our bot (the admin adds it via BotFather, then shares the bot username with you).
                </li>
                <li className="flex gap-2">
                  <span className="font-mono font-bold text-[#229ED9]">2.</span>
                  Send the message <code className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-foreground">/start {code.code}</code> to the bot.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono font-bold text-[#229ED9]">3.</span>
                  The bot replies with a confirmation. This page will update automatically within a few seconds.
                </li>
              </ol>
            </div>

            <Button
              onClick={() => void handleGenerate()}
              disabled={generating}
              variant="outline"
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-card/50 disabled:opacity-50"
            >
              <RefreshCw className="size-4" />
              Generate a new code
            </Button>
          </div>
        ) : (
          /* Not linked, no code yet (or code expired) — CTA */
          <div className="mt-5 flex flex-col gap-4">
            {codeExpired && (
              <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.06] p-3 text-xs text-primary">
                <Clock className="size-3.5" />
                Your previous code expired. Generate a new one to continue.
              </div>
            )}
            <div className="flex items-start gap-3 rounded-xl border border-border/40 bg-card/30 p-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#229ED9]/10 text-[#229ED9]">
                <Link2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  How it works
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click "Get linking code" → send the code to our bot in
                  Telegram → you're linked. Codes expire after 10 minutes.
                  You'll get one digest every Monday morning — that's it, no
                  other messages.
                </p>
              </div>
            </div>
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-[#229ED9] text-white hover:bg-[#1b8dc7] disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              {generating ? "Generating…" : "Get linking code"}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Connect your music ────────────────────────────────────────────────
// Explains both Spotify + YouTube integration honestly, including their
// real limitations (Spotify Premium requirement, YouTube requiring a
// public/embeddable link). CRITICAL: we NEVER store or host user audio —
// external music streams from the external service's own infrastructure.

function ConnectMusicSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel rounded-2xl p-6"
    >
      <p className="type-mono text-[11px] font-bold uppercase tracking-[0.22em] text-primary">
        // your music
      </p>
      <h2 className="type-h1 mt-1">Connect your music</h2>
      <p className="type-body mt-2 text-muted-foreground">
        Bring your own study playlists — without us ever storing your audio.
        Both options stream from the external service's own infrastructure.
        We only embed their player.
      </p>

      {/* YouTube — works for any account */}
      <div className="mt-5 rounded-xl border border-border/40 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <Youtube className="size-5 text-rose-400" />
          <p className="text-sm font-bold">YouTube</p>
          <span className="ml-auto rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
            Free · No account needed
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          Paste any public YouTube video or playlist URL into the music
          player's YouTube tab (the <Youtube className="inline size-3" /> icon
          in the player bar). The video plays through YouTube's own embedded
          player — we never store, host, or proxy the audio. Works with any
          YouTube account, no premium subscription required.
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          Note: some videos block embedding — if a link doesn't play, try
          a different one. Look for "study music", "lo-fi beats", or
          "ambient soundscape" playlists on YouTube.
        </p>
      </div>

      {/* Spotify — requires Premium on student's account */}
      <div className="mt-3 rounded-xl border border-border/40 bg-card/30 p-4">
        <div className="flex items-center gap-2">
          <Music className="size-5 text-emerald-400" />
          <p className="text-sm font-bold">Spotify</p>
          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            Coming soon
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          We're working on letting you connect your own Spotify account so
          your playlists play right here in Learnyx. The actual audio would
          stream from Spotify's own licensed infrastructure — we'd never
          store or host any of your music.
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          Note: Spotify integration requires a Spotify Premium account on
          the student's side — a real limitation of Spotify's Web Playback
          SDK, not something we can work around.
        </p>
      </div>

      {/* Copyright notice */}
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/30 bg-card/20 px-3 py-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-400/60" />
        <p className="text-[11px] leading-relaxed text-muted-foreground/70">
          We never upload, store, or host any user-provided audio files. All
          external music plays through the original service's own licensed
          infrastructure. Learnyx takes on zero hosting liability.
        </p>
      </div>
    </motion.div>
  );
}




