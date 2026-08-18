// In-app notification bell — the surface for achievement, level-up, group and
// plan-week notifications. No push infra: these are visible when the app is
// open, read on click, and quietly marked as read.

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { Bell, CheckCheck, Trophy } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

function timeAgo(ms: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const TYPE_ICONS: Record<string, typeof Trophy> = {
  achievement: Trophy,
  level_up: Trophy,
};

export function NotificationBell() {
  const notifications = useQuery(api.notifications.getMyNotifications);
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const unread = notifications?.filter((n) => n.readAt === null).length ?? 0;

  const handleClick = async (notification: NonNullable<typeof notifications>[number]) => {
    if (notification.readAt === null) {
      void markRead({ notificationId: notification._id as never }).catch(() => {});
    }
    setOpen(false);
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
  };

  const handleMarkAll = async () => {
    await markAllRead().catch(() => {});
    toast.success("All notifications marked as read.");
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          className="relative size-10 min-h-10 min-w-10 cursor-pointer rounded-xl text-muted-foreground hover:bg-white/5 hover:text-foreground"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary font-mono text-[9px] font-bold text-primary-foreground shadow-[0_0_10px_2px_var(--primary)]">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="glass-panel w-[min(92vw,360px)] rounded-2xl border-white/10 p-0"
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <DropdownMenuLabel className="p-0 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            notifications
          </DropdownMenuLabel>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 cursor-pointer rounded-lg px-2 font-mono text-[10px] text-primary hover:bg-primary/10"
              onClick={() => void handleMarkAll()}
            >
              <CheckCheck className="size-3" /> Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator className="bg-white/10" />

        <ScrollArea className="max-h-[60vh]">
          {notifications === undefined ? (
            <div className="flex flex-col gap-2 px-4 py-6">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-semibold text-foreground/80">All quiet here</p>
              <p className="mx-auto mt-1 max-w-[220px] text-xs leading-5 text-muted-foreground">
                Achievements, level-ups and group activity will show up here.
              </p>
            </div>
          ) : (
            <div className="flex flex-col p-1.5">
              {notifications.map((notification) => {
                const Icon = TYPE_ICONS[notification.type] ?? Bell;
                return (
                  <DropdownMenuItem
                    key={notification._id}
                    onSelect={() => void handleClick(notification)}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl px-2.5 py-2.5",
                      notification.readAt === null
                        ? "bg-primary/5 text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                        notification.readAt === null
                          ? "bg-primary/10 text-primary"
                          : "bg-white/5 text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold leading-5">{notification.title}</p>
                      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
                        {notification.body}
                      </p>
                      <p className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted-foreground/70">
                        {timeAgo(notification.createdAt)}
                      </p>
                    </div>
                    {notification.readAt === null && (
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
