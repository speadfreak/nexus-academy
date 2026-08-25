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
  Layers,
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
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Close mobile menu on click outside
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mobileOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen]);

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
    { to: "/flashcards", label: "Flashcards", icon: Layers },
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
    <div className="student-app-shell mx-auto flex min-h-[100dvh] min-w-0 w-full max-w-[1600px] items-start gap-6 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* Sidebar (desktop) — sticky + overflow-visible override on glass-panel */}
      <aside className="student-sidebar glass-panel sticky top-4 hidden h-[calc(100dvh-2rem)] min-h-0 w-60 shrink-0 !overflow-hidden !overflow-x-clip flex-col rounded-2xl p-3 xl:flex lg:top-6 lg:h-[calc(100dvh-3rem)]">
        {/* Logo + brand */}
        <Link to="/" className="student-brand-lockup group flex items-center gap-3 rounded-2xl border border-white/10 px-3 py-3 transition-all hover:border-primary/35 hover:bg-primary/[0.06]">
          <span className="relative">
            <img src={logo} alt="Nexus Academy logo" className="size-10 shrink-0 rounded-xl transition-transform group-hover:scale-105" />
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[#f5c542] shadow-[0_0_10px_#f5c542]" />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-extrabold tracking-tight">Nexus Academy</p>
            <p className="text-[10px] text-muted-foreground">Exam prep & library</p>
          </div>
          <NotificationBell />
        </Link>

        {/* Divider */}
        <div className="mx-3 my-2 h-px bg-white/[0.06]" />

        {/* Main navigation */}
        <nav aria-label="Student navigation" data-lenis-prevent-wheel className="student-sidebar-nav min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
          {navItems.filter((item) => item.to !== "/upgrade" && item.to !== "/admin").map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "interactive-press flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
                    active
                     ? "student-nav-active bg-amber-400/10 text-amber-300 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.12)]"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
                aria-current={active ? "page" : undefined}
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", active ? "bg-amber-400/15" : "bg-white/[0.035]")}>
                  <item.icon className="size-4" />
                </span>
                <span className="truncate">{item.label}</span>
                {item.premiumActive && (
                  <span title="Premium active" className="ml-auto size-1.5 shrink-0 rounded-full bg-premium shadow-[0_0_8px_1px_var(--premium)]" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Bottom section: Premium + Admin + Profile */}
        <div className="student-sidebar-footer shrink-0 flex flex-col gap-1.5 pt-2">
          <div className="mx-3 h-px bg-white/[0.06]" />

          {/* Premium CTA */}
          {(() => {
            const premium = navItems.find((item) => item.to === "/upgrade");
            if (!premium) return null;
            const active = location.pathname === premium.to;
            return (
              <Link
                to={premium.to}
                className={cn(
                  "student-premium-link interactive-press flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all",
                  premium.premiumActive
                    ? "bg-premium/10 text-premium"
                    : active
                      ? "bg-amber-400/10 text-amber-300"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <premium.icon className="size-4 shrink-0" />
                <span className="truncate">{premium.label}</span>
                {premium.premiumActive && (
                  <span title="Premium active" className="ml-auto size-1.5 shrink-0 rounded-full bg-premium shadow-[0_0_8px_1px_var(--premium)]" />
                )}
              </Link>
            );
          })()}

          {/* Admin badge */}
          {isAdmin && (
            <Link
              to="/admin"
              className={cn(
                "student-admin-link interactive-press flex items-center gap-2.5 rounded-xl border border-primary/15 px-3 py-2 text-sm font-semibold transition-all",
                location.pathname === "/admin"
                  ? "bg-amber-400/10 text-amber-300"
                  : "text-amber-300/70 hover:bg-amber-400/5 hover:text-amber-300",
              )}
            >
              <ShieldCheck className="size-4 shrink-0" /> Admin
            </Link>
          )}

          {/* Profile card */}
          <div className="student-profile-card glass-soft flex items-center gap-2.5 rounded-2xl border border-white/10 p-2.5">
            <Link to="/settings" title="Open settings">
              <Avatar className="size-9 cursor-pointer">
                <AvatarFallback className="bg-gradient-to-br from-amber-400/25 to-amber-400/5 text-xs font-bold text-amber-300">
                  {initials || "N"}
                </AvatarFallback>
              </Avatar>
            </Link>
            <Link to="/settings" className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-xs font-semibold hover:text-amber-300">
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
        </div>
      </aside>

      {/* Main content area */}
      <div className="student-app-main flex min-w-0 flex-1 flex-col gap-4 self-stretch">
        <header className="student-mobile-header glass-panel relative flex items-center justify-between rounded-2xl px-4 py-2.5 !overflow-visible xl:hidden">
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
              className="size-10 min-h-10 min-w-10 text-muted-foreground"
            >
              {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </Button>
          </div>
          {mobileOpen && (
            <div
              id="mobile-navigation"
              ref={mobileMenuRef}
               className="student-mobile-drawer absolute inset-x-0 top-[calc(100%+0.5rem)] z-50 max-h-[75vh] overflow-y-auto rounded-2xl border border-white/10 bg-background/98 p-2 shadow-2xl backdrop-blur-xl"
              data-lenis-prevent-wheel
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
                        "interactive-press flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold",
                         active
                           ? "student-nav-active bg-amber-400/10 text-amber-300"
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

        <main
          className="student-page-frame min-w-0 flex-1 pb-20 sm:pb-28"
          data-page={location.pathname.replace(/^\//, "").split("/")[0] || "dashboard"}
        >
          {children}
        </main>

        {/* ═══ FOOTER ═══ */}
        <footer className="mt-auto pb-3 pt-2">
          {/* Animated gradient border line */}
          <div className="footer-gradient-line mx-auto max-w-xs rounded-full" />

          {/* Footer content with faint dot pattern */}
          <div className="footer-dots relative flex flex-col items-center gap-1.5 pt-3">
            {/* Developed-by line */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground/40">
                Developed by
              </span>
              <span className="footer-dev-glow">
                <span className="text-gradient footer-shimmer inline-block text-xs font-extrabold tracking-[0.06em]">
                  Joseph James
                </span>
              </span>
            </div>

            {/* Copyright metadata */}
            <p className="type-caption text-muted-foreground/30">
              © 2025 Nexus Academy
            </p>
          </div>
        </footer>
      </div>

      {/* Persistent study-vibe player — lives at the app root so it survives
          navigation. Defaults to off; never autoplays. */}
      <MusicPlayer />
    </div>
  );
}
