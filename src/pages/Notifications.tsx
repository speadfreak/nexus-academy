// /notifications — dedicated, fuller notifications surface.
//
// Why this exists: the dashboard's in-context notifications panel was too
// big + forced the user to scroll past it on the library page. The bell
// dropdown is great for quick scan-and-mark-read, but the dedicated page
// is where students come to:
//   - Read the full body of every notification (no truncation)
//   - Filter (All · Unread · Mentions) and bucket by date (Today · Yesterday · This week · Earlier)
//   - Dismiss individual notifications
//   - Mark all as read
//   - Clear all read notifications older than 30 days
//   - Click "View →" on a notification with an actionUrl to navigate (the
//     ONLY navigation trigger — clicking a row no longer redirects)
//
// The page is wrapped in DashboardShell so the sidebar nav + bell still
// appear. The page itself is a single column with the same futuristic
// visual language as the bell dropdown (gradient icons, animated
// transitions, type-specific colors).

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  Award,
  Bell,
  BellRing,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Flame,
  GitBranch,
  Heart,
  Inbox,
  Sparkles,
  Trash2,
  Trophy,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Time helpers ────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function dateBucket(ms: number): "today" | "yesterday" | "thisWeek" | "earlier" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOfWeek = startOfToday - (now.getDay() || 7 - 1) * 24 * 60 * 60 * 1000;
  if (ms >= startOfToday) return "today";
  if (ms >= startOfYesterday) return "yesterday";
  if (ms >= startOfWeek) return "thisWeek";
  return "earlier";
}

const BUCKET_LABELS: Record<string, string> = {
  today: "Today",
  yesterday: "Yesterday",
  thisWeek: "This week",
  earlier: "Earlier",
};

// ── Type metadata (same as NotificationBell — kept in sync) ─────────────

type TypeMeta = {
  icon: typeof Trophy;
  gradient: string;
  glow: string;
  label: string;
};

const TYPE_META: Record<string, TypeMeta> = {
  achievement: {
    icon: Trophy,
    gradient: "from-amber-400/30 to-orange-400/20",
    glow: "rgba(251, 191, 36, 0.45)",
    label: "Achievement",
  },
  level_up: {
    icon: Zap,
    gradient: "from-emerald-400/30 to-teal-400/20",
    glow: "rgba(52, 211, 153, 0.45)",
    label: "Level up",
  },
  group_join: {
    icon: Users,
    gradient: "from-sky-400/30 to-indigo-400/20",
    glow: "rgba(56, 189, 248, 0.45)",
    label: "Group",
  },
  streak: {
    icon: Flame,
    gradient: "from-orange-400/30 to-red-400/20",
    glow: "rgba(249, 115, 22, 0.45)",
    label: "Streak",
  },
  plan_week: {
    icon: Sparkles,
    gradient: "from-violet-400/30 to-fuchsia-400/20",
    glow: "rgba(167, 139, 250, 0.45)",
    label: "Plan",
  },
  system: {
    icon: Bell,
    gradient: "from-white/15 to-white/5",
    glow: "rgba(255, 255, 255, 0.15)",
    label: "System",
  },
  milestone: {
    icon: Award,
    gradient: "from-rose-400/30 to-pink-400/20",
    glow: "rgba(251, 113, 133, 0.45)",
    label: "Milestone",
  },
  social: {
    icon: Heart,
    gradient: "from-pink-400/30 to-rose-400/20",
    glow: "rgba(244, 114, 182, 0.45)",
    label: "Social",
  },
  update: {
    icon: GitBranch,
    gradient: "from-cyan-400/30 to-blue-400/20",
    glow: "rgba(34, 211, 238, 0.45)",
    label: "Update",
  },
};

const DEFAULT_META: TypeMeta = {
  icon: Bell,
  gradient: "from-white/10 to-white/5",
  glow: "rgba(255, 255, 255, 0.1)",
  label: "Notification",
};

function metaFor(type: string): TypeMeta {
  return TYPE_META[type] ?? DEFAULT_META;
}

// ── Filter tabs ────────────────────────────────────────────────────────

type FilterTab = "all" | "unread" | "achievements";

const TAB_LABELS: Record<FilterTab, string> = {
  all: "All",
  unread: "Unread",
  achievements: "Mentions",
};

// ── Page component ──────────────────────────────────────────────────────

export default function NotificationsPage() {
  const data = useQuery(api.notifications.getMyNotificationsExtended);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const deleteNotification = useMutation(api.notifications.deleteNotification);
  const clearReadNotifications = useMutation(api.notifications.clearReadNotifications);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;
  const total = data?.totalCount ?? 0;

  const filtered = useMemo(() => {
    if (filter === "unread") return notifications.filter((n) => n.readAt === null);
    if (filter === "achievements")
      return notifications.filter((n) => n.type === "achievement" || n.type === "level_up" || n.type === "milestone");
    return notifications;
  }, [notifications, filter]);

  const buckets: Record<string, typeof notifications> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };
  for (const n of filtered) {
    buckets[dateBucket(n.createdAt)].push(n);
  }

  const handleRowClick = async (notification: (typeof notifications)[number]) => {
    if (notification.readAt === null) {
      void markRead({ notificationId: notification._id as never }).catch(() => {});
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(notification._id)) {
        next.delete(notification._id);
      } else {
        next.add(notification._id);
      }
      return next;
    });
  };

  const handleViewClick = (
    notification: (typeof notifications)[number],
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const url = notification.actionUrl;
    if (!url || url === "/" || url === "") return;
    navigate(url);
  };

  const handleMarkAll = async () => {
    await markAllRead().catch(() => {});
    toast.success("All notifications marked as read.");
  };

  const handleDismiss = async (id: Id<"notifications">, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteNotification({ notificationId: id as never });
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(id as string);
        return next;
      });
      toast.success("Notification dismissed.");
    } catch {
      toast.error("Could not dismiss this notification.");
    }
  };

  const handleClearRead = async () => {
    try {
      const result = await clearReadNotifications({});
      if (result && result.deleted > 0) {
        toast.success(`${result.deleted} read notification${result.deleted === 1 ? "" : "s"} cleared.`);
      } else {
        toast.info("Nothing to clear — no read notifications older than 30 days.");
      }
    } catch {
      toast.error("Could not clear read notifications.");
    }
  };

  const hasActionable = (n: (typeof notifications)[number]) =>
    Boolean(n.actionUrl) && n.actionUrl !== "/" && n.actionUrl !== "";

  return (
    <DashboardShell>
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Ambient glow */}
        <div
          className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 size-64 rounded-full blur-[100px]"
          style={{
            background:
              unread > 0
                ? "radial-gradient(circle, rgba(251,191,36,0.12) 0%, rgba(251,191,36,0) 70%)"
                : "radial-gradient(circle, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%)",
          }}
          aria-hidden="true"
        />

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="relative flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3">
            <motion.div
              animate={unread > 0 ? { rotate: [0, -10, 10, -10, 0] } : {}}
              transition={{ duration: 0.6, repeat: unread > 0 ? 3 : 0, ease: "easeInOut" }}
              className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"
              style={unread > 0 ? { boxShadow: "0 0 20px -4px var(--primary)" } : undefined}
            >
              {unread > 0 ? <BellRing className="size-5" /> : <Inbox className="size-5" />}
            </motion.div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-amber-300">
                // activity
              </p>
              <h1 className="type-h1 mt-0.5">Notifications</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {unread > 0
                  ? `${unread} unread ${unread === 1 ? "item" : "items"} · ${total} total`
                  : `All caught up · ${total} total`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="h-9 cursor-pointer gap-1.5 rounded-xl text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Back
            </Button>
            {unread > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleMarkAll()}
                className="h-9 cursor-pointer gap-1.5 rounded-xl border-primary/20 px-3 text-primary hover:bg-primary/10"
              >
                <CheckCheck className="size-3.5" /> Mark all read
              </Button>
            )}
          </div>
        </motion.div>

        {/* Filter tabs */}
        {total > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-1 rounded-2xl bg-white/[0.03] p-1"
          >
            {(Object.keys(TAB_LABELS) as FilterTab[]).map((tab) => {
              const active = filter === tab;
              const count =
                tab === "unread"
                  ? unread
                  : tab === "achievements"
                    ? (data?.byType?.achievement ?? 0) +
                      (data?.byType?.level_up ?? 0) +
                      (data?.byType?.milestone ?? 0)
                    : total;
              return (
                <button
                  key={tab}
                  onClick={() => setFilter(tab)}
                  className={cn(
                    "relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[11px] font-bold uppercase tracking-wider transition-colors",
                    active ? "text-amber-200" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="notif-page-tab-bg"
                      className="absolute inset-0 rounded-xl bg-primary/15"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className="relative">{TAB_LABELS[tab]}</span>
                  {count > 0 && (
                    <span
                      className={cn(
                        "relative rounded-full px-1.5 font-mono text-[10px] font-bold tabular-nums",
                        active ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground",
                      )}
                    >
                      {count > 99 ? "99+" : count}
                    </span>
                  )}
                </button>
              );
            })}
          </motion.div>
        )}

        {/* Feed */}
        <div className="flex flex-col gap-4">
          {data === undefined ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-2xl bg-white/5"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : total === 0 ? (
            <PageEmptyState />
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-6 py-12 text-center">
              <p className="text-base font-semibold text-foreground/80">
                No {filter === "unread" ? "unread" : filter === "achievements" ? "achievement" : ""} notifications
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {filter === "unread"
                  ? "Every notification has been read. Nice work."
                  : "Switch filters to see other activity."}
              </p>
            </div>
          ) : (
            (Object.keys(buckets) as (keyof typeof buckets)[])
              .filter((b) => buckets[b].length > 0)
              .map((bucket) => (
                <motion.div
                  key={bucket}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col gap-2"
                >
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                    {BUCKET_LABELS[bucket]}
                  </p>
                  <div className="flex flex-col gap-2">
                    <AnimatePresence initial={false}>
                      {buckets[bucket].map((notification) => {
                        const meta = metaFor(notification.type);
                        const Icon = meta.icon;
                        const isUnread = notification.readAt === null;
                        const isExpanded = expanded.has(notification._id);
                        const actionable = hasActionable(notification);
                        return (
                          <motion.div
                            key={notification._id}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, x: -8, height: 0, marginBottom: 0 }}
                            transition={{ duration: 0.18 }}
                            onMouseEnter={() => setHoveredId(notification._id)}
                            onMouseLeave={() => setHoveredId(null)}
                            onClick={() => void handleRowClick(notification)}
                            className={cn(
                              "group relative flex cursor-pointer items-start gap-4 rounded-2xl border px-5 py-4 transition-all",
                              isUnread
                                ? "border-primary/20 bg-primary/[0.06] hover:border-primary/40 hover:bg-primary/[0.1]"
                                : "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
                              isExpanded && "ring-1 ring-primary/20",
                            )}
                          >
                            {/* Type icon */}
                            <div
                              className={cn(
                                "relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br",
                                meta.gradient,
                              )}
                              style={{ boxShadow: isUnread ? `0 0 16px -4px ${meta.glow}` : undefined }}
                            >
                              <Icon className="size-5 text-foreground" />
                              {isUnread && (
                                <span
                                  className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary"
                                  style={{ boxShadow: "0 0 6px var(--primary)" }}
                                />
                              )}
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1 pr-7">
                              <div className="flex items-center gap-2">
                                <p
                                  className={cn(
                                    "truncate text-sm font-bold",
                                    isUnread ? "text-foreground" : "text-foreground/80",
                                  )}
                                >
                                  {notification.title}
                                </p>
                                <span
                                  className={cn(
                                    "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider bg-gradient-to-r",
                                    meta.gradient,
                                  )}
                                >
                                  {meta.label}
                                </span>
                              </div>
                              <p
                                className={cn(
                                  "mt-1 text-sm leading-5 text-muted-foreground",
                                  isExpanded ? "line-clamp-none" : "line-clamp-2",
                                )}
                              >
                                {notification.body}
                              </p>
                              <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                {timeAgo(notification.createdAt)}
                                {actionable && !isExpanded && (
                                  <span className="flex items-center gap-0.5 text-primary/80">
                                    <ChevronRight className="size-2.5" /> tap to expand
                                  </span>
                                )}
                                {isExpanded && (
                                  <span className="flex items-center gap-0.5 text-muted-foreground/60">
                                    <ChevronDown className="size-2.5" /> tap to collapse
                                  </span>
                                )}
                              </p>

                              {/* Expanded detail */}
                              <AnimatePresence initial={false}>
                                {isExpanded && (
                                  <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
                                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                        {fullDate(notification.createdAt)}
                                      </p>
                                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                                        {notification.body}
                                      </p>
                                      {actionable && (
                                        <button
                                          onClick={(e) => handleViewClick(notification, e)}
                                          className="mt-3 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                                        >
                                          View
                                          <ExternalLink className="size-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>

                            {/* Hover dismiss */}
                            <AnimatePresence>
                              {hoveredId === notification._id && (
                                <motion.button
                                  initial={{ opacity: 0, scale: 0.7 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  exit={{ opacity: 0, scale: 0.7 }}
                                  onClick={(e) =>
                                    void handleDismiss(notification._id as Id<"notifications">, e)
                                  }
                                  title="Dismiss"
                                  className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-400/15 hover:text-rose-300"
                                >
                                  <X className="size-3.5" />
                                </motion.button>
                              )}
                            </AnimatePresence>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </motion.div>
              ))
          )}
        </div>

        {/* Footer actions */}
        {total > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="flex items-center justify-between border-t border-white/[0.06] pt-4"
          >
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
              showing {filtered.length} of {total}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void handleClearRead()}
              className="h-8 cursor-pointer gap-1.5 rounded-lg px-2.5 font-mono text-[11px] text-muted-foreground hover:text-rose-300"
            >
              <Trash2 className="size-3.5" /> Clear read (older than 30d)
            </Button>
          </motion.div>
        )}
      </div>
    </DashboardShell>
  );
}

// ── Page empty state ────────────────────────────────────────────────────

function PageEmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-3xl border border-emerald-400/15 bg-emerald-400/[0.03] px-6 py-16 text-center"
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="relative mx-auto flex size-20 items-center justify-center"
      >
        <div className="absolute inset-0 rounded-3xl bg-emerald-400/20 blur-2xl" />
        <div className="relative flex size-20 items-center justify-center rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.06]">
          <CheckCheck className="size-10 text-emerald-300" />
        </div>
      </motion.div>
      <p className="mt-6 text-xl font-extrabold tracking-tight text-foreground/90">
        You&apos;re all caught up
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Achievements, level-ups, streaks, study plan reminders, and group
        activity will show up here. We never push anything to your phone —
        check back whenever you want.
      </p>
    </motion.div>
  );
}
