// Matric OS — Premium Navigation Shell.
//
// The Matric OS landing (hub) and results views previously floated inside
// the app with no route home: no breadcrumb, no shortcut to the Exam Prep
// Hub, Library or Dashboard — students felt trapped. This shell fixes that
// with a compact, sticky, Obsidian-Academic-Luxury navigation bar:
//
//   Desktop  — one elegant row: breadcrumb trail (Dashboard / Exam Prep /
//              Matric OS) + Library · Recent sittings · Help + the PRIMARY
//              "Exam Prep Hub" back action.
//   Tablet   — same row, secondary destinations collapse to icon buttons.
//   Mobile   — prominent back button left, compact "Matric OS" identity,
//              overflow menu for secondary destinations, safe-area insets.
//
// Rules:
//   - React Router <Link> only — zero full-page reloads, zero external URLs.
//   - NEVER mounted during a timed examination (the player owns the screen
//     with its own focused header — see MatricPlayer).
//   - Keyboard accessible (focus-ring, aria-current, labelled icon buttons)
//     and motion-safe: only color/opacity transitions, no entry animations.

import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  CircleHelp,
  GraduationCap,
  History,
  LayoutDashboard,
  LibraryBig,
  ShieldCheck,
  Timer,
  Flag,
  ListChecks,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { prefetchRoute } from "@/lib/navigation";

// Intent-prefetch the destination chunks so SPA navigation renders without
// the loading fallback (same convention as the student sidebar).
const linkProps = (to: string) => ({
  onPointerEnter: () => prefetchRoute(to),
  onFocus: () => prefetchRoute(to),
});

function CrumbLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to}
      {...linkProps(to)}
      className="focus-ring rounded-sm text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

export function MatricNav({
  view,
  onRecentClick,
}: {
  view: "hub" | "results";
  onRecentClick: () => void;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const recentLabel = view === "hub" ? "Recent sittings" : "Exam history";

  const recentAction = (
    <>
      <History className="size-4 text-muted-foreground transition-colors group-hover:text-amber-300" />
      <span className="hidden lg:inline">{recentLabel}</span>
      <span className="sr-only lg:hidden">{recentLabel}</span>
    </>
  );

  return (
    <>
      <nav
        aria-label="Matric OS navigation"
        className="sticky top-0 z-40 -mx-4 border-b border-border/60 bg-background/85 backdrop-blur-md sm:-mx-6 sm:px-6"
        style={{
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
          paddingTop: "max(0.625rem, env(safe-area-inset-top))",
          paddingBottom: "0.625rem",
        }}
      >
        {/* ── MOBILE ROW (<md): prominent back · identity · overflow ── */}
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 md:hidden">
          <Button
            asChild
            size="sm"
            className="focus-ring gap-1.5 bg-amber-400/15 text-amber-200 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)] hover:bg-amber-400/25 hover:text-amber-100"
          >
            <Link to="/exam-prep" {...linkProps("/exam-prep")}>
              <ArrowLeft className="size-4" />
              <span>Exam Prep</span>
            </Link>
          </Button>

          <Link
            to="/mock-exam"
            className="focus-ring flex min-w-0 items-center gap-1.5 rounded-md"
            aria-label="Matric OS home"
          >
            <GraduationCap className="size-4 shrink-0 text-amber-300" />
            <span className="truncate font-serif text-sm font-bold tracking-tight text-foreground">
              Matric <span className="text-gradient">OS</span>
            </span>
          </Link>

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={onRecentClick}
              aria-label={recentLabel}
              className="focus-ring group inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
            >
              <History className="size-4.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="More destinations"
                  className="focus-ring size-9 rounded-xl text-muted-foreground hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" className="size-4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="5" cy="12" r="0.5" fill="currentColor" />
                    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
                    <circle cx="19" cy="12" r="0.5" fill="currentColor" />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Go to
                </DropdownMenuLabel>
                <DropdownMenuItem asChild>
                  <Link to="/exam-prep" {...linkProps("/exam-prep")} className="focus-ring cursor-pointer">
                    <ArrowLeft className="size-4 text-amber-300" /> Exam Prep Hub
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/library" {...linkProps("/library")} className="focus-ring cursor-pointer">
                    <LibraryBig className="size-4 text-teal-300" /> Library
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/dashboard" {...linkProps("/dashboard")} className="focus-ring cursor-pointer">
                    <LayoutDashboard className="size-4 text-violet-300" /> Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    onRecentClick();
                  }}
                  className="cursor-pointer"
                >
                  <History className="size-4 text-muted-foreground" /> {recentLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setHelpOpen(true);
                  }}
                  className="cursor-pointer"
                >
                  <CircleHelp className="size-4 text-amber-300" /> How Matric OS works
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ── DESKTOP / TABLET ROW (md+): breadcrumb + shortcuts + primary back ── */}
        <div className="mx-auto hidden max-w-5xl items-center justify-between gap-3 md:flex">
          <ol
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-1.5"
          >
            <li className="flex items-center gap-1.5">
              <LayoutDashboard className="size-3.5 text-muted-foreground/70" aria-hidden />
              <CrumbLink to="/dashboard">Dashboard</CrumbLink>
            </li>
            <li aria-hidden className="text-muted-foreground/50">
              <ChevronRight className="size-3.5" />
            </li>
            <li className="flex items-center gap-1.5">
              <BookOpen className="size-3.5 text-muted-foreground/70" aria-hidden />
              <CrumbLink to="/exam-prep">Exam Prep</CrumbLink>
            </li>
            <li aria-hidden className="text-muted-foreground/50">
              <ChevronRight className="size-3.5" />
            </li>
            <li className="flex min-w-0 items-center gap-1.5">
              <GraduationCap className="size-3.5 shrink-0 text-amber-300" aria-hidden />
              <span
                aria-current="page"
                className="truncate rounded-sm text-[13px] font-bold text-foreground"
              >
                Matric OS
                <span className="ml-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                  {view === "results" ? "results" : "exam hub"}
                </span>
              </span>
            </li>
          </ol>

          <div className="flex shrink-0 items-center gap-1">
            <Link
              to="/library"
              {...linkProps("/library")}
              className="focus-ring group inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
            >
              <LibraryBig className="size-4 text-muted-foreground transition-colors group-hover:text-teal-300" />
              <span className="hidden lg:inline">Library</span>
              <span className="sr-only lg:hidden">Library</span>
            </Link>
            <button
              type="button"
              onClick={onRecentClick}
              className="focus-ring group inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
            >
              {recentAction}
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              aria-label="How Matric OS works"
              className="focus-ring group inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card/60 hover:text-foreground"
            >
              <CircleHelp className="size-4.5" />
            </button>
            <div aria-hidden className="mx-1.5 h-5 w-px bg-border/70" />
            <Button
              asChild
              size="sm"
              className="focus-ring gap-1.5 bg-amber-400/15 text-amber-200 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)] hover:bg-amber-400/25 hover:text-amber-100"
            >
              <Link to="/exam-prep" {...linkProps("/exam-prep")}>
                <ArrowLeft className="size-4" />
                <span>Exam Prep Hub</span>
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <MatricHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
    </>
  );
}

// ── Contextual help: concise, honest, jargon-free instructions ─────────
export function MatricHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-4 text-amber-300" /> How Matric OS works
          </DialogTitle>
          <DialogDescription>
            Real ESSLCE past-paper questions, zero AI. Everything here runs on
            Learnyx servers.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2.5 text-sm leading-relaxed text-muted-foreground">
          <li className="flex gap-2.5">
            <Timer className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <span>
              <strong className="text-foreground">The timer is server-side.</strong>{" "}
              Refreshing, closing the tab or losing connection never pauses it —
              and when time is up, your saved answers are submitted automatically.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-300" />
            <span>
              <strong className="text-foreground">Answers autosave</strong> to the
              server as you work. If anything interrupts you, resume from the hub —
              your answers and remaining time are exactly where you left them.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Flag className="mt-0.5 size-4 shrink-0 text-rose-300" />
            <span>
              <strong className="text-foreground">Flag anything uncertain</strong>{" "}
              (press F) and jump freely with the question palette. Flags never
              affect your score.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ListChecks className="mt-0.5 size-4 shrink-0 text-teal-300" />
            <span>
              <strong className="text-foreground">Scoring is instant and honest</strong>{" "}
              — graded against each paper's verified answer key, no negative
              marking, unanswered questions score zero.
            </span>
          </li>
          <li className="flex gap-2.5">
            <Wrench className="mt-0.5 size-4 shrink-0 text-violet-300" />
            <span>
              <strong className="text-foreground">Every mistake feeds your loop</strong>{" "}
              — results flow into Mistake Lab and your Exam Twin, so your next
              study session targets exactly what cost you marks.
            </span>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
