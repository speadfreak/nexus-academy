import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  Award,
  BookOpen,
  CalendarDays,
  Crown,
  ListChecks,
  LogOut,
  Menu,
  Map,
  MessageSquareText,
  NotebookPen,
  Settings,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { localDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MusicPlayer } from "@/components/music-player";
import logo from "@/assets/nexus-logo.svg";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const touch = useMutation(api.subscriptions.touch);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  // First activity of any authenticated session: create the trial subscription
  // if needed and count the active day. Both are idempotent server-side, so
  // double-fire (StrictMode) is safe.
  const touchedRef = useRef(false);
  useEffect(() => {
    if (touchedRef.current) return;
    touchedRef.current = true;
    void touch({ localDate: localDateKey() }).catch(() => {});
  }, [touch]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const navItems: {
    to: string;
    label: string;
    icon: typeof Crown;
    premiumActive?: boolean;
  }[] = [
    { to: "/dashboard", label: "Library", icon: BookOpen },
    { to: "/tutor", label: "Tutor", icon: MessageSquareText },
    { to: "/todos", label: "Todos", icon: ListChecks },
    { to: "/focus", label: "Focus", icon: Timer },
    { to: "/plans", label: "Plans", icon: Map },
    { to: "/journey", label: "Journey", icon: TrendingUp },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    { to: "/notes", label: "Notes", icon: NotebookPen },
    { to: "/achievements", label: "Achievements", icon: Award },
    { to: "/groups", label: "Groups", icon: Users },
    { to: "/settings", label: "Settings", icon: Settings },
    {
      to: "/upgrade",
      label:
        subscription?.status === "trial"
          ? `Premium · ${subscription.trialDaysRemaining}d trial`
          : subscription?.needsUpgrade
            ? "Premium · upgrade"
            : "Premium",
      icon: Crown,
      premiumActive: Boolean(subscription?.premiumAccess),
    },
    ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  const initials = (user?.name || user?.email || "N")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <div className="mx-auto flex min-h-[100dvh] min-w-0 w-full max-w-[1600px] gap-6 overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Sidebar (desktop) */}
      <aside className="glass-panel sticky top-6 hidden h-[calc(100vh-3rem)] w-60 shrink-0 flex-col rounded-2xl p-4 xl:flex">
        <div className="flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 px-1 py-2">
            <img src={logo} alt="Nexus Academy logo" className="size-9 rounded-xl" />
            <div className="leading-tight">
              <p className="text-sm font-extrabold tracking-tight">Nexus Academy</p>
              <p className="font-mono text-[10px] text-muted-foreground">exam-prep · library</p>
            </div>
          </Link>
          <NotificationBell />
        </div>

        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="size-4" />
                {item.label}
                {item.premiumActive && (
                  <span
                    title="Premium access active"
                    className="ml-auto size-1.5 rounded-full bg-premium shadow-[0_0_8px_1px_var(--premium)]"
                  />
                )}
              </Link>
            );
          })}
        </nav>

        {isAdmin && (
          <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-primary/5 px-3 py-2 text-[11px] font-medium text-primary">
            <ShieldCheck className="size-3.5" /> Admin access enabled
          </p>
        )}

        <div className="glass-soft flex items-center gap-2.5 rounded-xl p-2.5">
          <Link to="/settings" title="Open settings" aria-label="Open settings">
            <Avatar className="size-9 cursor-pointer">
              <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                {initials || "N"}
              </AvatarFallback>
            </Avatar>
          </Link>
          <Link to="/settings" className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-semibold hover:text-primary">
              {user?.name || "Guest"}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{user?.email || "Anonymous session"}</p>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="cursor-pointer text-muted-foreground hover:text-destructive"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="glass-panel relative flex items-center justify-between rounded-2xl px-4 py-2.5 xl:hidden">
          <Link to="/" className="flex items-center gap-2">
            <img src={logo} alt="Nexus Academy logo" className="size-8 rounded-lg" />
            <span className="text-sm font-extrabold tracking-tight">Nexus Academy</span>
          </Link>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileOpen((open) => !open)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-navigation"
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              className="size-8 text-muted-foreground"
            >
              {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </Button>
          </div>
          {mobileOpen && (
            <div
              id="mobile-navigation"
              className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 rounded-2xl border border-white/10 bg-background/95 p-2 shadow-2xl backdrop-blur-xl"
            >
              <nav aria-label="Mobile navigation" className="grid gap-1">
                {navItems.map((item) => {
                  const active = location.pathname === item.to;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold",
                        active
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                      )}
                    >
                      <item.icon className="size-4" />
                      {item.label}
                    </Link>
                  );
                })}
                <Button
                  variant="ghost"
                  onClick={handleSignOut}
                  className="justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground"
                >
                  <LogOut className="size-4" /> Sign out
                </Button>
              </nav>
            </div>
          )}
        </header>

        <main className="min-w-0 flex-1 pb-24">{children}</main>
      </div>

      {/* Persistent study-vibe player — lives at the app root so it survives
          navigation. Defaults to off; never autoplays. */}
      <MusicPlayer />
    </div>
  );
}
