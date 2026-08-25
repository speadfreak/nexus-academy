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
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { NotificationBell } from "@/components/NotificationBell";
import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router";
import { localDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { MusicPlayer } from "@/components/music-player";
import { AnimatePresence, motion } from "framer-motion";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import logo from "@/assets/nexus-logo.svg";

const SIDEBAR_KEY = "nexus-sidebar-collapsed";
const COLLAPSED_W = "4.5rem";
const EXPANDED_W = "15rem";

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const touch = useMutation(api.subscriptions.touch);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "true"; } catch { return false; }
  });

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [mobileOpen]);

  // Ctrl+B  → toggle sidebar collapse (desktop only)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        toggleCollapsed();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [toggleCollapsed]);

  // Lock body scroll while mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // First activity of any authenticated session: create the trial subscription
  const touchedRef = useRef(false);
  useEffect(() => {
    if (touchedRef.current) return;
    touchedRef.current = true;
    void touch({ localDate: localDateKey() }).catch(() => {});
  }, [touch]);

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
    ...(isAdmin?.isAdmin ? [{ to: "/admin", label: "Admin", icon: ShieldCheck }] : []),
  ];

  const initials = (user?.name || user?.email || "N")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  // ── Desktop nav link (supports collapsed tooltips) ──
  const renderDesktopNavLink = (item: typeof navItems[number], idx: number) => {
    const active = location.pathname === item.to;
    const link = (
      <Link
        to={item.to}
        aria-current={active ? "page" : undefined}
        className={cn(
          "sidebar-nav-item interactive-press group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-all",
          active
            ? "student-nav-active bg-amber-400/10 text-amber-300 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.12)]"
            : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
          collapsed && "justify-center px-0",
        )}
      >
        <span className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg transition-all",
          active ? "bg-amber-400/15" : "bg-white/[0.035]",
        )}>
          <item.icon className="size-4" />
        </span>
        <span className={cn(
          "sidebar-label truncate transition-all duration-300",
          collapsed ? "pointer-events-none absolute w-0 opacity-0" : "opacity-100",
        )}>
          {item.label}
        </span>
        {item.premiumActive && (
          <span
            title="Premium active"
            className={cn(
              "size-1.5 shrink-0 rounded-full bg-premium shadow-[0_0_8px_1px_var(--premium)] transition-all duration-300",
              collapsed ? "absolute right-1" : "ml-auto",
            )}
          />
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.to} delayDuration={0}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={12} className="sidebar-tooltip">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }
    return <div key={item.to}>{link}</div>;
  };

  // ── Mobile nav link (unchanged) ──
  const renderMobileNavLink = (item: typeof navItems[number]) => {
    const active = location.pathname === item.to;
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={() => setMobileOpen(false)}
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
  };

  return (
    <div className="student-app-shell relative mx-auto flex min-h-[100dvh] min-w-0 w-full max-w-[1600px] items-start gap-4 px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      {/* ═══ Desktop sidebar (hidden below xl) ═══ */}
      <motion.aside
        animate={{ width: collapsed ? COLLAPSED_W : EXPANDED_W }}
        transition={{ type: "spring", stiffness: 400, damping: 34, mass: 0.8 }}
        className="student-sidebar sidebar-collapsible relative hidden h-[calc(100dvh-2rem)] min-h-0 shrink-0 !overflow-hidden !overflow-x-clip flex-col rounded-2xl p-3 xl:flex lg:top-6 lg:h-[calc(100dvh-3rem)]"
      >
        {/* ── Collapsed/Expanded toggle button ── */}
        <button
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "sidebar-toggle-btn group absolute -right-3 top-8 z-50 flex size-6 items-center justify-center rounded-full border transition-all duration-300",
            "border-white/10 bg-background/90 backdrop-blur-md shadow-lg",
            "hover:border-amber-400/40 hover:bg-amber-400/10 hover:shadow-[0_0_16px_-4px_rgb(251,191,36,0.7)]",
            "active:scale-90",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-3 text-muted-foreground transition-colors group-hover:text-amber-300" />
          ) : (
            <PanelLeftClose className="size-3 text-muted-foreground transition-colors group-hover:text-amber-300" />
          )}
        </button>

        {/* ── Animated edge glow line ── */}
        <div className={cn(
          "sidebar-edge-glow pointer-events-none absolute -right-px top-0 bottom-0 w-px transition-opacity duration-500",
          collapsed ? "opacity-0" : "opacity-100",
        )} />

        {/* Logo + brand */}
        <Link
          to="/"
          className={cn(
            "student-brand-lockup group relative flex items-center gap-3 rounded-2xl border border-white/10 px-3 py-3 transition-all hover:border-primary/35 hover:bg-primary/[0.06]",
            collapsed && "justify-center border-transparent px-0 hover:bg-white/5",
          )}
        >
          <span className="relative shrink-0">
            <img
              src={logo}
              alt="Nexus Academy logo"
              className="size-10 rounded-xl transition-transform group-hover:scale-105"
            />
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[#f5c542] shadow-[0_0_10px_#f5c542]" />
          </span>
          <div className={cn(
            "sidebar-label min-w-0 leading-tight transition-all duration-300",
            collapsed ? "pointer-events-none absolute w-0 opacity-0" : "opacity-100",
          )}>
            <p className="text-sm font-extrabold tracking-tight">Nexus Academy</p>
            <p className="text-[10px] text-muted-foreground">Exam prep & library</p>
          </div>
          {!collapsed && <NotificationBell />}
        </Link>

        {/* Notification bell (collapsed: below brand, centered) */}
        {collapsed && (
          <div className="mt-1 flex justify-center">
            <NotificationBell />
          </div>
        )}

        <div className={cn(
          "mx-3 my-2 h-px bg-white/[0.06] transition-all duration-300",
          collapsed && "mx-1.5",
        )} />

        {/* Main navigation */}
        <nav
          aria-label="Student navigation"
          data-lenis-prevent-wheel
          className={cn(
            "student-sidebar-nav min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1 transition-all duration-300",
            collapsed && "items-center gap-1 pr-0",
          )}
        >
          {navItems
            .filter((item) => item.to !== "/upgrade" && item.to !== "/admin")
            .map((item, idx) => renderDesktopNavLink(item, idx))}
        </nav>

        {/* Bottom section: Premium + Admin + Profile */}
        <div className="student-sidebar-footer shrink-0 flex flex-col gap-1.5 pt-2">
          <div className={cn(
            "mx-3 h-px bg-white/[0.06] transition-all duration-300",
            collapsed && "mx-1.5",
          )} />

          {/* Premium CTA */}
          {(() => {
            const premium = navItems.find((item) => item.to === "/upgrade");
            if (!premium) return null;
            const active = location.pathname === premium.to;
            const link = (
              <Link
                to={premium.to}
                className={cn(
                  "student-premium-link sidebar-nav-item interactive-press group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-all",
                  premium.premiumActive
                    ? "bg-premium/10 text-premium"
                    : active
                      ? "bg-amber-400/10 text-amber-300"
                      : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                  collapsed && "justify-center px-0",
                )}
              >
                <premium.icon className="size-4 shrink-0" />
                <span className={cn(
                  "sidebar-label truncate transition-all duration-300",
                  collapsed ? "pointer-events-none absolute w-0 opacity-0" : "opacity-100",
                )}>
                  {premium.label}
                </span>
                {premium.premiumActive && (
                  <span
                    title="Premium active"
                    className={cn(
                      "size-1.5 shrink-0 rounded-full bg-premium shadow-[0_0_8px_1px_var(--premium)] transition-all duration-300",
                      collapsed ? "absolute right-1" : "ml-auto",
                    )}
                  />
                )}
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key="premium" delayDuration={0}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12} className="sidebar-tooltip">
                    {premium.label}
                  </TooltipContent>
                </Tooltip>
              );
            }
            return <div key="premium">{link}</div>;
          })()}

          {/* Admin badge */}
          {isAdmin?.isAdmin && (() => {
            const link = (
              <Link
                to="/admin"
                className={cn(
                  "student-admin-link sidebar-nav-item interactive-press group relative flex items-center gap-2.5 rounded-xl border border-primary/15 px-3 py-2 text-sm font-semibold transition-all",
                  location.pathname === "/admin"
                    ? "bg-amber-400/10 text-amber-300"
                    : "text-amber-300/70 hover:bg-amber-400/5 hover:text-amber-300",
                  collapsed && "justify-center border-transparent px-0",
                )}
              >
                <ShieldCheck className="size-4 shrink-0" />
                <span className={cn(
                  "sidebar-label truncate transition-all duration-300",
                  collapsed ? "pointer-events-none absolute w-0 opacity-0" : "opacity-100",
                )}>
                  Admin
                </span>
              </Link>
            );
            if (collapsed) {
              return (
                <Tooltip key="admin" delayDuration={0}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={12} className="sidebar-tooltip">
                    Admin
                  </TooltipContent>
                </Tooltip>
              );
            }
            return <div key="admin">{link}</div>;
          })()}

          {/* Profile card */}
          <div className={cn(
            "student-profile-card glass-soft relative flex items-center gap-2.5 rounded-2xl border border-white/10 p-2.5 transition-all duration-300",
            collapsed && "justify-center p-2",
          )}>
            <Link to="/settings" title="Open settings">
              <Avatar className="size-9 cursor-pointer">
                <AvatarFallback className="bg-gradient-to-br from-amber-400/25 to-amber-400/5 text-xs font-bold text-amber-300">
                  {initials || "N"}
                </AvatarFallback>
              </Avatar>
            </Link>
            <div className={cn(
              "sidebar-label flex min-w-0 flex-1 leading-tight transition-all duration-300",
              collapsed ? "pointer-events-none absolute w-0 opacity-0" : "opacity-100",
            )}>
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
        </div>
      </motion.aside>

      {/* ═══ Main content area ═══ */}
      <div className="student-app-main flex min-w-0 flex-1 flex-col gap-4 self-stretch">
        {/* Mobile top bar (hidden at xl+) */}
        <header className="student-mobile-header glass-panel relative z-30 flex items-center justify-between rounded-2xl px-4 py-2.5 xl:hidden">
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
              aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
              className="size-10 min-h-10 min-w-10 text-muted-foreground"
            >
              {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
            </Button>
          </div>
        </header>

        <main
          className="student-page-frame min-w-0 flex-1 pb-20 sm:pb-28"
          data-page={location.pathname.replace(/^\//, "").split("/")[0] || "dashboard"}
        >
          {children}
        </main>

        {/* ═══ FOOTER ═══ */}
        <footer className="mt-auto pb-3 pt-2">
          <div className="footer-gradient-line mx-auto max-w-xs rounded-full" />
          <div className="footer-dots relative flex flex-col items-center gap-1.5 pt-3">
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
            <p className="type-caption text-muted-foreground/30">
              © 2025 Nexus Academy
            </p>
          </div>
        </footer>
      </div>

      {/* ═══ Mobile drawer overlay ═══ */}
      {createPortal(
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                key="mobile-drawer-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm xl:hidden"
                onClick={() => setMobileOpen(false)}
                aria-hidden="true"
              />
              <motion.div
                key="mobile-drawer-panel"
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] as const }}
                className="fixed inset-x-3 top-[4.5rem] z-[9999] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/10 bg-background/[0.97] p-2 shadow-2xl backdrop-blur-xl xl:hidden"
                data-lenis-prevent-wheel
                role="dialog"
                aria-label="Navigation menu"
              >
                <nav aria-label="Mobile navigation" className="grid gap-1">
                  {navItems.map(renderMobileNavLink)}
                  <div className="my-1 h-px bg-white/[0.06]" />
                  <Button
                    variant="ghost"
                    onClick={() => { setMobileOpen(false); void handleSignOut(); }}
                    className="justify-start gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted-foreground"
                  >
                    <LogOut className="size-4" /> Sign out
                  </Button>
                </nav>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Persistent study-vibe player */}
      <MusicPlayer />
    </div>
  );
}
