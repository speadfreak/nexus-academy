// Futuristic notifications panel — a dedicated section for the user
// dashboard that surfaces the latest notifications with rich visual
// hierarchy, type-specific gradients, animated transitions, and quick
// actions (mark-read / dismiss). Independent from the NotificationBell
// dropdown — this is a fuller, more discoverable surface for catching
// up on what happened while the student was away.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Award,
  Bell,
  BellRing,
  CheckCheck,
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
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Helpers (duplicated from NotificationBell to keep this component
// self-contained — the dashboard panel is meant to drop in anywhere) ──

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

type FilterTab = "all" | "unread" | "achievements";

const TAB_LABELS: Record<FilterTab, string> = {
  all: "All",
  unread: "Unread",
  achievements: "Mentions",
};

// ── Component ──────────────────────────────────────────────────────────

export function NotificationsPanel() {
  const data = useQuery(api.notifications.getMyNotificationsExtended);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const deleteNotification = useMutation(api.notifications.deleteNotification);
  const clearReadNotifications = useMutation(api.notifications.clearReadNotifications);
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterTab>("all");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;
  const total = data?.totalCount ?? 0;

  const filtered = notifications.filter((n) => {
    if (filter === "unread") return n.readAt === null;
    if (filter === "achievements")
      return n.type === "achievement" || n.type === "level_up" || n.type === "milestone";
    return true;
  });

  const buckets: Record<string, typeof notifications> = {
    today: [],
    yesterday: [],
    thisWeek: [],
    earlier: [],
  };
  for (const n of filtered) {
    buckets[dateBucket(n.createdAt)].push(n);
  }

  const handleClick = async (notification: (typeof notifications)[number]) => {
    if (notification.readAt === null) {
      void markRead({ notificationId: notification._id as never }).catch(() => {});
    }
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
  };

  const handleMarkAll = async () => {
    await markAllRead().catch(() => {});
    toast.success("All notifications marked as read.");
  };

  const handleDismiss = async (id: Id<"notifications">, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteNotification({ notificationId: id as never });
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

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel relative overflow-hidden rounded-3xl p-5 sm:p-6"
    >
      {/* Ambient glow that intensifies with unread count */}
      <div
        className="pointer-events-none absolute -top-12 -right-12 size-48 rounded-full blur-3xl"
        style={{
          background:
            unread > 0
              ? "radial-gradient(circle, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0) 70%)"
              : "radial-gradient(circle, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 70%)",
        }}
      />

      {/* Header */}
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <motion.div
            animate={unread > 0 ? { rotate: [0, -10, 10, -10, 0] } : {}}
            transition={{ duration: 0.6, repeat: unread > 0 ? 3 : 0, ease: "easeInOut" }}
            className="flex size-10 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            style={unread > 0 ? { boxShadow: "0 0 20px -4px var(--primary)" } : undefined}
          >
            {unread > 0 ? <BellRing className="size-5" /> : <Inbox className="size-5" />}
          </motion.div>
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // activity feed
            </p>
            <h2 className="type-h3 mt-0.5">Notifications</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <motion.span
              key={unread}
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 16 }}
              className="flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 font-mono text-[10px] font-bold text-primary"
            >
              <span className="size-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 6px var(--primary)" }} />
              {unread} unread
            </motion.span>
          )}
          {unread > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleMarkAll()}
              className="h-8 cursor-pointer gap-1.5 rounded-lg border-primary/20 px-2.5 font-mono text-[10px] text-primary hover:bg-primary/10"
            >
              <CheckCheck className="size-3" /> Mark all
            </Button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      {total > 0 && (
        <div className="mt-5 flex items-center gap-1 rounded-2xl bg-white/[0.03] p-1">
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
                  "relative flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                  active ? "text-amber-200" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="notif-panel-tab-bg"
                    className="absolute inset-0 rounded-xl bg-primary/15"
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
      )}

      {/* Feed */}
      <div className="mt-4 flex flex-col gap-3">
        {data === undefined ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl bg-white/5"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : total === 0 ? (
          <PanelEmptyState />
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-5 py-10 text-center">
            <p className="text-sm font-semibold text-foreground/80">
              No {filter === "unread" ? "unread" : filter === "achievements" ? "achievement" : ""} notifications
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {filter === "unread"
                ? "You're all caught up. Check back later."
                : "Switch filters to see other activity."}
            </p>
          </div>
        ) : (
          (Object.keys(buckets) as (keyof typeof buckets)[])
            .filter((b) => buckets[b].length > 0)
            .map((bucket) => (
              <div key={bucket} className="flex flex-col gap-2">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {BUCKET_LABELS[bucket]}
                </p>
                <div className="flex flex-col gap-1.5">
                  <AnimatePresence initial={false}>
                    {buckets[bucket].map((notification) => {
                      const meta = metaFor(notification.type);
                      const Icon = meta.icon;
                      const isUnread = notification.readAt === null;
                      return (
                        <motion.div
                          key={notification._id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, x: -8, height: 0, marginBottom: 0 }}
                          transition={{ duration: 0.18 }}
                          onMouseEnter={() => setHoveredId(notification._id)}
                          onMouseLeave={() => setHoveredId(null)}
                          onClick={() => void handleClick(notification)}
                          className={cn(
                            "group relative flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3.5 transition-all",
                            isUnread
                              ? "border-primary/20 bg-primary/[0.06] hover:border-primary/40 hover:bg-primary/[0.1]"
                              : "border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
                          )}
                        >
                          <div
                            className={cn(
                              "relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br",
                              meta.gradient,
                            )}
                            style={{ boxShadow: isUnread ? `0 0 16px -4px ${meta.glow}` : undefined }}
                          >
                            <Icon className="size-4 text-foreground" />
                            {isUnread && (
                              <span
                                className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary"
                                style={{ boxShadow: "0 0 6px var(--primary)" }}
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1 pr-7">
                            <div className="flex items-center gap-2">
                              <p
                                className={cn(
                                  "truncate text-sm font-semibold",
                                  isUnread ? "text-foreground" : "text-foreground/80",
                                )}
                              >
                                {notification.title}
                              </p>
                              <span
                                className={cn(
                                  "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider",
                                  `bg-gradient-to-r ${meta.gradient}`,
                                )}
                              >
                                {meta.label}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              {notification.body}
                            </p>
                            <p className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                              {timeAgo(notification.createdAt)}
                              {notification.actionUrl && (
                                <span className="flex items-center gap-0.5 text-primary/80">
                                  <ArrowRight className="size-2.5" /> View
                                </span>
                              )}
                            </p>
                          </div>
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
              </div>
            ))
        )}
      </div>

      {/* Footer */}
      {total > 0 && (
        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {filtered.length} of {total} shown
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleClearRead()}
            className="h-7 cursor-pointer gap-1.5 rounded-lg px-2 font-mono text-[10px] text-muted-foreground hover:text-rose-300"
          >
            <Trash2 className="size-3" /> Clear read
          </Button>
        </div>
      )}
    </motion.section>
  );
}

// ── Panel empty state (richer than the bell dropdown's empty state) ────

function PanelEmptyState() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.03] px-6 py-12 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 16 }}
        className="relative mx-auto flex size-16 items-center justify-center"
      >
        <div className="absolute inset-0 rounded-2xl bg-emerald-400/20 blur-2xl" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06]">
          <CheckCheck className="size-8 text-emerald-300" />
        </div>
      </motion.div>
      <p className="mt-4 text-base font-bold text-foreground/90">You&apos;re all caught up</p>
      <p className="mx-auto mt-1.5 max-w-[280px] text-sm text-muted-foreground">
        Achievements, level-ups, streaks, study plan reminders, and group
        activity will show up here. We never push anything to your phone —
        check back whenever you want.
      </p>
    </div>
  );
}
