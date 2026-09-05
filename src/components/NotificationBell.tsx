// In-app notification bell — futuristic, click-to-expand (NOT click-to-navigate).
//
// BEHAVIOR FIX (this version):
//   - Clicking a notification MARKS IT AS READ and EXPANDS the row inline to
//     reveal the full body + a "View →" button. The dropdown stays open.
//   - The "View →" button is the ONLY thing that navigates — and only when
//     the notification has an actionUrl. Empty actionUrls show no button.
//   - Previously, clicking anywhere on a notification row would call
//     navigate(actionUrl) which sent users to the landing page if the
//     actionUrl was "/" or similar. That bad UX is gone.
//
// Other features:
//   - Pulse ring + bouncing BellRing icon when there are unread items
//   - Animated unread-count badge with glow
//   - Filter tabs (All · Unread · Mentions) with sliding indicator
//   - Date-bucketed feed (Today · Yesterday · This week · Earlier)
//   - Type-specific gradient icon backgrounds (achievement=amber, level=emerald,
//     group=sky, streak=orange, plan=violet, milestone=rose, social=pink, update=cyan)
//   - Hover-revealed Dismiss (X) per notification
//   - Footer: "View all" → /notifications · "Mark all read" · "Clear read"
//   - Animated empty state

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
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
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ── Time formatting helpers ────────────────────────────────────────────

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

// ── Notification type metadata ──────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────

export function NotificationBell() {
  const data = useQuery(api.notifications.getMyNotificationsExtended);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const deleteNotification = useMutation(api.notifications.deleteNotification);
  const clearReadNotifications = useMutation(api.notifications.clearReadNotifications);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // Expanded row — set of notification ids whose body is currently expanded
  // inline. Clicking a row toggles its expansion (and marks it as read).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  // Filtered feed for the active tab.
  const filtered = useMemo(() => {
    if (filter === "unread") return notifications.filter((n) => n.readAt === null);
    if (filter === "achievements")
      return notifications.filter((n) => n.type === "achievement" || n.type === "level_up" || n.type === "milestone");
    return notifications;
  }, [notifications, filter]);

  // Group by date bucket — preserves order.
  const bucketed = useMemo(() => {
    const buckets: Record<string, typeof notifications> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: [],
    };
    for (const n of filtered) {
      buckets[dateBucket(n.createdAt)].push(n);
    }
    return buckets;
  }, [filtered]);

  // Keyboard: Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // ── THE FIX ─────────────────────────────────────────────────────────
  // Clicking a notification row ONLY marks it as read + toggles inline
  // expansion. It NEVER calls navigate(). The dropdown STAYS OPEN so the
  // student can keep reading other notifications.
  //
  // The "View →" button inside the expanded row is the ONLY thing that
  // navigates — and only when actionUrl is set + non-empty + not just "/".
  const handleRowClick = async (
    notification: (typeof notifications)[number],
  ) => {
    // Mark as read if unread (fire-and-forget).
    if (notification.readAt === null) {
      void markRead({ notificationId: notification._id as never }).catch(() => {});
    }
    // Toggle inline expansion — keeps the dropdown open.
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

  // Navigate ONLY when the user explicitly clicks the "View →" button.
  // We also guard against actionUrl being "/", "" or undefined — those
  // cases show no button at all, so this should never be called with a
  // bad URL, but the guard is here for safety.
  const handleViewClick = (
    notification: (typeof notifications)[number],
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const url = notification.actionUrl;
    if (!url || url === "/" || url === "") return;
    setOpen(false);
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
      // Also remove from the expanded set so we don't render an orphan row.
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

  const hasAny = notifications.length > 0;
  const hasActionable = (n: (typeof notifications)[number]) =>
    Boolean(n.actionUrl) && n.actionUrl !== "/" && n.actionUrl !== "";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          className="relative size-10 min-h-10 min-w-10 cursor-pointer rounded-xl text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          {/* Pulse ring when there are unread notifications */}
          {unread > 0 && (
            <motion.span
              className="absolute inset-0 rounded-xl"
              initial={{ opacity: 0.6, scale: 0.85 }}
              animate={{ opacity: 0, scale: 1.4 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
              style={{ boxShadow: "0 0 0 2px var(--primary)" }}
            />
          )}
          <AnimatePresence mode="wait" initial={false}>
            {unread > 0 ? (
              <motion.span
                key="ring"
                initial={{ rotate: -15, scale: 0.8 }}
                animate={{ rotate: 0, scale: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 14 }}
              >
                <BellRing className="size-4 text-primary" />
              </motion.span>
            ) : (
              <motion.span
                key="bell"
                initial={{ rotate: 0, scale: 0.8 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
              >
                <Bell className="size-4" />
              </motion.span>
            )}
          </AnimatePresence>
          {/* Unread count badge */}
          <AnimatePresence>
            {unread > 0 && (
              <motion.span
                key={unread}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 16 }}
                className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold leading-4 text-primary-foreground"
                style={{ boxShadow: "0 0 12px 2px var(--primary)" }}
              >
                {unread > 9 ? "9+" : unread}
              </motion.span>
            )}
          </AnimatePresence>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="glass-panel w-[min(92vw,420px)] rounded-3xl border-white/10 p-0"
      >
        {/* Header — title + animated unread chip + View all link */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Inbox className="size-4" />
            </div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                notifications
              </p>
              {unread > 0 ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-mono text-[10px] text-primary/80"
                >
                  {unread} unread {unread === 1 ? "item" : "items"}
                </motion.p>
              ) : (
                <p className="font-mono text-[10px] text-muted-foreground">
                  all caught up
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 cursor-pointer gap-1 rounded-lg px-2 font-mono text-[10px] text-primary hover:bg-primary/10"
                onClick={() => void handleMarkAll()}
              >
                <CheckCheck className="size-3" /> Mark all
              </Button>
            )}
          </div>
        </div>

        {/* Filter tabs */}
        {hasAny && (
          <div className="flex items-center gap-1 px-3 pb-2">
            <div className="flex w-full gap-1 rounded-xl bg-white/[0.03] p-1">
              {(Object.keys(TAB_LABELS) as FilterTab[]).map((tab) => {
                const active = filter === tab;
                const count =
                  tab === "unread"
                    ? unread
                    : tab === "achievements"
                      ? (data?.byType?.achievement ?? 0) +
                        (data?.byType?.level_up ?? 0) +
                        (data?.byType?.milestone ?? 0)
                      : notifications.length;
                return (
                  <button
                    key={tab}
                    onClick={() => setFilter(tab)}
                    className={cn(
                      "relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider transition-colors",
                      active
                        ? "text-amber-200"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="notif-tab-bg"
                        className="absolute inset-0 rounded-lg bg-primary/15"
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      />
                    )}
                    <span className="relative">{TAB_LABELS[tab]}</span>
                    {count > 0 && (
                      <span
                        className={cn(
                          "relative rounded-full px-1.5 font-mono text-[9px] font-bold tabular-nums",
                          active ? "bg-primary/20 text-primary" : "bg-white/5 text-muted-foreground",
                        )}
                      >
                        {count > 99 ? "99+" : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Feed — grouped by date bucket */}
        <div className="max-h-[60vh] overflow-y-auto px-2 pb-2">
          {data === undefined ? (
            <div className="flex flex-col gap-2 px-3 py-6">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-white/5"
                  style={{ animationDelay: `${i * 80}ms` }}
                />
              ))}
            </div>
          ) : !hasAny ? (
            <EmptyState />
          ) : filtered.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-foreground/80">
                No {filter === "unread" ? "unread" : filter === "achievements" ? "achievement" : ""} notifications
              </p>
              <p className="mx-auto mt-1 max-w-[240px] text-xs leading-5 text-muted-foreground">
                {filter === "unread"
                  ? "Every notification has been read. Nice work."
                  : "Try a different filter to see more."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3 py-1.5">
              {(Object.keys(bucketed) as (keyof typeof bucketed)[])
                .filter((bucket) => bucketed[bucket].length > 0)
                .map((bucket) => (
                  <div key={bucket} className="flex flex-col gap-1.5">
                    <p className="px-3 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                      {BUCKET_LABELS[bucket]}
                    </p>
                    <div className="flex flex-col gap-1">
                      <AnimatePresence initial={false}>
                        {bucketed[bucket].map((notification) => {
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
                              exit={{ opacity: 0, x: -8, height: 0, marginTop: 0 }}
                              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                              onMouseEnter={() => setHoveredId(notification._id)}
                              onMouseLeave={() => setHoveredId(null)}
                              onClick={() => void handleRowClick(notification)}
                              className={cn(
                                "group relative flex cursor-pointer items-start gap-3 rounded-2xl px-3 py-3 transition-colors",
                                isUnread
                                  ? "bg-primary/[0.06] hover:bg-primary/[0.1]"
                                  : "hover:bg-white/[0.04]",
                                isExpanded && "ring-1 ring-primary/20",
                              )}
                            >
                              {/* Type icon with gradient + glow */}
                              <div
                                className={cn(
                                  "relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br",
                                  meta.gradient,
                                )}
                                style={{
                                  boxShadow: isUnread ? `0 0 16px -4px ${meta.glow}` : undefined,
                                }}
                              >
                                <Icon className="size-4 text-foreground" />
                                {isUnread && (
                                  <span
                                    className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary"
                                    style={{ boxShadow: "0 0 6px var(--primary)" }}
                                  />
                                )}
                              </div>

                              {/* Content */}
                              <div className="min-w-0 flex-1 pr-6">
                                <div className="flex items-center gap-2">
                                  <p
                                    className={cn(
                                      "text-xs font-semibold leading-5",
                                      isUnread ? "text-foreground" : "text-foreground/80",
                                    )}
                                  >
                                    {notification.title}
                                  </p>
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider bg-gradient-to-r",
                                      meta.gradient,
                                    )}
                                  >
                                    {meta.label}
                                  </span>
                                </div>
                                <p
                                  className={cn(
                                    "mt-0.5 text-[11px] leading-4 text-muted-foreground",
                                    isExpanded && "line-clamp-none",
                                  )}
                                >
                                  {notification.body}
                                </p>
                                <p className="mt-1.5 flex items-center gap-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
                                  {timeAgo(notification.createdAt)}
                                  {actionable && !isExpanded && (
                                    <span className="ml-1 flex items-center gap-0.5 text-primary/80">
                                      <ChevronRight className="size-2.5" /> tap to expand
                                    </span>
                                  )}
                                  {isExpanded && (
                                    <span className="ml-1 flex items-center gap-0.5 text-muted-foreground/60">
                                      <ChevronDown className="size-2.5" /> tap to collapse
                                    </span>
                                  )}
                                </p>

                                {/* Expanded detail — only when the row is expanded.
                                    Shows the full timestamp + a "View →" button (only
                                    if actionUrl is set and meaningful). */}
                                <AnimatePresence initial={false}>
                                  {isExpanded && (
                                    <motion.div
                                      initial={{ opacity: 0, height: 0 }}
                                      animate={{ opacity: 1, height: "auto" }}
                                      exit={{ opacity: 0, height: 0 }}
                                      transition={{ duration: 0.2 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="mt-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                                        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                          {fullDate(notification.createdAt)}
                                        </p>
                                        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                                          {notification.body}
                                        </p>
                                        {actionable && (
                                          <button
                                            onClick={(e) => handleViewClick(notification, e)}
                                            className="mt-2.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
                                          >
                                            View
                                            <ExternalLink className="size-3" />
                                          </button>
                                        )}
                                      </div>
                                    </motion.div>
                                  )}
                                </AnimatePresence>
                              </div>

                              {/* Hover actions */}
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
                                    className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-rose-400/15 hover:text-rose-300"
                                  >
                                    <X className="size-3" />
                                  </motion.button>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Footer actions — View all + Clear read */}
        {hasAny && (
          <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-3">
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary transition-colors hover:bg-primary/10"
            >
              <Inbox className="size-3" /> View all
              <ChevronRight className="size-3" />
            </Link>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 cursor-pointer gap-1.5 rounded-lg px-2 font-mono text-[10px] text-muted-foreground hover:text-rose-300"
                onClick={() => void handleClearRead()}
              >
                <Trash2 className="size-3" /> Clear read
              </Button>
            </div>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Empty state ──────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="relative"
      >
        <div className="absolute inset-0 rounded-2xl bg-emerald-400/20 blur-2xl" />
        <div className="relative flex size-14 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06]">
          <CheckCheck className="size-7 text-emerald-300" />
        </div>
      </motion.div>
      <div>
        <p className="text-sm font-semibold text-foreground/90">All quiet here</p>
        <p className="mx-auto mt-1 max-w-[240px] text-xs leading-5 text-muted-foreground">
          Achievements, level-ups, streaks, and group activity will show up
          here. We&apos;ll never ping you — check back whenever.
        </p>
      </div>
    </div>
  );
}
