// Learnyx Command OS — application shell.
// Collapsible desktop rail + compact icon-rail mode, mobile sheet drawer,
// breadcrumbs, global command palette (⌘K), real-data notifications,
// permission-aware grouped navigation, per-section scroll restoration,
// keyboard shortcuts (1-9 jump, ⌘K palette) with accessible alternatives.
// All tab IDs are preserved — see docs/command-os/AUDIT.md §4.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Command as CommandIcon,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { StatusDot } from "./kit";
import {
  getSection,
  visibleGroups,
  type AdminTabId,
  type AdminSectionMeta,
} from "./nav";
import {
  CommandPalette,
  readAdminPins,
  recordAdminRecent,
  useAdminPins,
} from "./CommandPalette";
import { cn } from "@/lib/utils";

/* ── Notification item contract ───────────────────────────────────────
   The shell renders whatever real signals the page feeds it — it never
   invents status. Items navigate to the tab where the admin can act.  */

export interface ShellNotification {
  id: string;
  tone: "warn" | "danger" | "info";
  title: string;
  detail?: string;
  tab: AdminTabId;
}

/* ── Live clock (kept from the legacy shell — cosmetic 1 Hz tick) ───── */

function LiveClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="hidden font-mono text-[10px] tabular-nums text-muted-foreground/70 lg:inline">
      {now.toLocaleTimeString([], { hour12: false })}{" "}
      <span className="text-primary/80">UTC</span>
    </span>
  );
}

/* ── Nav item ───────────────────────────────────────────────────────── */

function RailItem({
  section,
  active,
  collapsed,
  pinned,
  index,
  onNavigate,
  onTogglePin,
}: {
  section: AdminSectionMeta;
  active: boolean;
  collapsed: boolean;
  pinned: boolean;
  index?: number;
  onNavigate: () => void;
  onTogglePin?: () => void;
}) {
  const Icon = section.icon;
  return (
    <div className="cmdos-rail-item group/item relative">
      <button
        type="button"
        onClick={onNavigate}
        title={collapsed ? `${section.label} — ${section.description}` : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "interactive-press group flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all",
          collapsed ? "justify-center px-0 py-2.5" : "justify-start",
          active
            ? "admin-rail-item-active bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors",
            active
              ? "bg-primary/15 text-primary"
              : "bg-white/[0.04] text-muted-foreground group-hover:text-primary",
          )}
        >
          <Icon className="size-4" />
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
        )}
        {!collapsed && pinned && (
          <Pin className="size-3 shrink-0 text-primary/60" />
        )}
        {!collapsed && index !== undefined && (
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground/40">
            {index < 9 ? index + 1 : ""}
          </span>
        )}
      </button>
      {collapsed && (
        <span className="cmdos-rail-tip" role="tooltip">
          {section.label}
        </span>
      )}
      {!collapsed && onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? `Unpin ${section.label}` : `Pin ${section.label}`}
          className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 rounded p-1 text-muted-foreground/50 hover:bg-white/10 hover:text-primary group-hover/item:block"
          style={{ display: pinned ? "block" : undefined }}
        >
          {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </button>
      )}
    </div>
  );
}

/* ── Shell ──────────────────────────────────────────────────────────── */

export function AdminShell({
  tab,
  onTabChange,
  role,
  notifications,
  children,
}: {
  tab: AdminTabId;
  onTabChange: (id: AdminTabId) => void;
  role?: string | null;
  notifications: ShellNotification[];
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { pins, toggle: togglePin } = useAdminPins();
  const scrollTops = useRef<Partial<Record<AdminTabId, number>>>({});
  const firstRender = useRef(true);

  const groups = visibleGroups(role);
  const section = getSection(tab);
  const activeGroup = groups.find((g) =>
    g.sections.some((s) => s.id === tab),
  );

  // Collapse preference persists across sessions.
  useEffect(() => {
    try {
      setCollapsed(
        window.localStorage.getItem("nexus-admin-sidebar") === "collapsed",
      );
    } catch {
      // Non-critical.
    }
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "nexus-admin-sidebar",
        collapsed ? "collapsed" : "expanded",
      );
    } catch {
      // Non-critical.
    }
  }, [collapsed]);

  // Record recent destinations for the palette.
  useEffect(() => {
    recordAdminRecent(tab);
  }, [tab]);

  // Deterministic scroll restoration per section (window is the scroller
  // in the classic DashboardShell layout).
  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const el = document.scrollingElement;
    if (!el) return;
    el.scrollTop = scrollTops.current[tab] ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement;
      if (el) scrollTops.current[tab] = el.scrollTop;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [tab]);

  // Global keys: ⌘K opens the palette; 1-9 jumps through visible sections.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((p) => !p);
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      const n = Number(event.key);
      if (n >= 1 && n <= 9) {
        const flat = groups.flatMap((g) => g.sections);
        if (n <= flat.length) {
          event.preventDefault();
          onTabChange(flat[n - 1].id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [groups, onTabChange]);

  const navigate = useCallback(
    (id: AdminTabId) => {
      onTabChange(id);
      setDrawerOpen(false);
    },
    [onTabChange],
  );

  const pinnedSections = pins
    .map((id) => groups.flatMap((g) => g.sections).find((s) => s.id === id))
    .filter((s): s is AdminSectionMeta => Boolean(s));

  const navBody = (collapsedRail: boolean, withPins: boolean) => (
    <>
      {withPins && pinnedSections.length > 0 && (
        <div className="mb-1">
          {!collapsedRail && (
            <p className="cmdos-eyebrow mb-1.5 px-3">Pinned</p>
          )}
          {pinnedSections.map((s) => (
            <RailItem
              key={`pin-${s.id}`}
              section={s}
              active={tab === s.id}
              collapsed={collapsedRail}
              pinned
              onNavigate={() => navigate(s.id)}
            />
          ))}
          <div className="cmdos-hairline my-2" />
        </div>
      )}
      {groups.map((group, gi) => (
        <div key={group.id} className={cn(gi > 0 && "mt-1.5 border-t border-white/[0.06] pt-2")}>
          {!collapsedRail && (
            <p className="cmdos-eyebrow mb-1.5 px-3 !text-[9px]">{group.label}</p>
          )}
          <div className="flex flex-col gap-0.5">
            {group.sections.map((s) => (
              <RailItem
                key={s.id}
                section={s}
                active={tab === s.id}
                collapsed={collapsedRail}
                pinned={pins.includes(s.id)}
                index={group.sections.indexOf(s)}
                onNavigate={() => navigate(s.id)}
                onTogglePin={() => togglePin(s.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );

  const notifCount = notifications.length;

  return (
    <div className="admin-surface flex min-h-0 flex-col gap-4 pb-32 sm:gap-5">
      {/* ── Executive top bar ─────────────────────────────────────── */}
      <header className="cmdos-panel flex flex-wrap items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
        {/* Mobile section drawer */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Open sections menu"
              className="size-9 shrink-0 rounded-xl bg-white/[0.04] xl:hidden"
            >
              <Menu className="size-4" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="cmdos-dark-scope w-72 overflow-y-auto border-white/[0.08] bg-[#12100d]/97 px-3 py-4 backdrop-blur-xl"
          >
            <SheetHeader className="p-0 pb-3 text-left">
              <SheetTitle className="text-sm font-extrabold tracking-tight">
                Learnyx Command OS
              </SheetTitle>
            </SheetHeader>
            <nav aria-label="Admin sections" className="flex flex-col gap-0.5">
              {navBody(false, true)}
            </nav>
          </SheetContent>
        </Sheet>

        {/* Breadcrumbs: Admin → Group → Section */}
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[11px]"
        >
          <Link
            to="/dashboard"
            className="shrink-0 text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            learnyx
          </Link>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
          <span className="shrink-0 text-muted-foreground/70">
            {activeGroup?.label ?? "Admin"}
          </span>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" />
          <span className="truncate font-semibold text-foreground">
            {section.label}
          </span>
        </nav>

        {/* Global actions */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette (Control or Command K)"
            className="interactive-press flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-2.5 text-muted-foreground transition-colors hover:border-white/[0.14] hover:text-foreground sm:px-3"
          >
            <Search className="size-3.5" />
            <span className="hidden text-xs sm:inline">Search</span>
            <kbd className="hidden items-center gap-0.5 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] md:inline-flex">
              <CommandIcon className="size-2.5" />K
            </kbd>
          </button>

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={
                  notifCount > 0
                    ? `${notifCount} operational signal${notifCount === 1 ? "" : "s"} need attention`
                    : "Notifications — all clear"
                }
                className="interactive-press relative flex size-9 cursor-pointer items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Bell className="size-4" />
                {notifCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-amber-400 font-mono text-[9px] font-black text-black">
                    {notifCount}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="cmdos-dark-scope w-80 border-white/[0.09] bg-[#141210]/97 p-2 backdrop-blur-xl"
            >
              <p className="cmdos-eyebrow px-2 pb-2 pt-1">Needs attention</p>
              {notifCount === 0 ? (
                <div className="flex items-center gap-2.5 rounded-xl px-3 py-4">
                  <StatusDot tone="ok" />
                  <p className="text-[13px] text-muted-foreground">
                    All clear — nothing waiting on you.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => navigate(n.tab)}
                      className="interactive-press flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
                    >
                      <StatusDot
                        tone={n.tone}
                        pulse={n.tone === "danger"}
                        className="mt-1.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-foreground">
                          {n.title}
                        </span>
                        {n.detail && (
                          <span className="block truncate font-mono text-[10px] text-muted-foreground">
                            {n.detail}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground/50" />
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          {role && (
            <Badge
              variant="outline"
              className="hidden shrink-0 border-white/10 bg-white/[0.04] font-mono text-[9px] uppercase tracking-wider text-muted-foreground sm:inline-flex"
            >
              {role.replace("_", " ")}
            </Badge>
          )}
          <LiveClock />
        </div>
      </header>

      {/* ── Body: rail + content ──────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:gap-5">
        {/* Mobile horizontal section strip */}
        <nav
          aria-label="Admin sections"
          className="glass-panel flex shrink-0 flex-row gap-1 overflow-x-auto rounded-2xl p-1.5 sm:p-2 xl:hidden"
          data-scroll-contain
        >
          {groups.flatMap((g) => g.sections).map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate(s.id)}
                aria-current={tab === s.id ? "page" : undefined}
                className={cn(
                  "interactive-press flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium transition-all",
                  tab === s.id
                    ? "bg-primary/10 text-primary shadow-[inset_0_0_0_1px_rgb(230_167_46/0.25)]"
                    : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {s.label}
              </button>
            );
          })}
        </nav>

        {/* Desktop icon rail / expanded rail (≥ xl) */}
        <nav
          aria-label="Admin sections"
          className="admin-rail glass-panel hidden shrink-0 flex-col overflow-y-auto rounded-2xl p-2.5 xl:sticky xl:top-6 xl:flex xl:self-start"
          data-scroll-contain
          style={{ width: collapsed ? "4.5rem" : "15.5rem" }}
        >
          {/* Brand lockup → back to the student app */}
          <Link
            to="/dashboard"
            title="Return to Learnyx Academy ET library"
            className={cn(
              "mb-3 flex items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] p-2.5 transition hover:border-primary/35 hover:bg-primary/[0.06]",
              collapsed ? "justify-center" : "gap-3",
            )}
          >
            <span className="admin-brand-mark relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#6d7cff] via-[#4777ff] to-[#23c8ed] text-lg font-black text-white shadow-[0_0_24px_rgb(71_119_255/0.42)]">
              N
              <span className="absolute -right-1 -top-1 size-2 rounded-full bg-[#f5c542] shadow-[0_0_10px_#f5c542]" />
            </span>
            <AnimatePresence mode="wait">
              {!collapsed && (
                <motion.span
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.18 }}
                  className="min-w-0 overflow-hidden"
                >
                  <span className="block truncate text-[13px] font-extrabold tracking-tight text-foreground">
                    Learnyx Academy ET
                  </span>
                  <span className="cmdos-eyebrow block truncate !text-[8px] !tracking-[0.14em]">
                    command os
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </Link>

          {navBody(collapsed, true)}

          {/* Collapse toggle */}
          <div className="mt-auto border-t border-white/[0.06] pt-2">
            <button
              type="button"
              onClick={() => setCollapsed((p) => !p)}
              className={cn(
                "interactive-press flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs text-muted-foreground transition-all hover:bg-white/5 hover:text-foreground",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
        </nav>

        {/* Content */}
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <div key={tab} className="cmdos-enter flex min-w-0 flex-col gap-4">
            {children}
          </div>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        role={role}
        onNavigate={navigate}
      />
    </div>
  );
}
