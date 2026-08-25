// ═══════════════════════════════════════════════════════════════════════
// main.tsx — Nexus Academy entry point
//
// CRITICAL: Do NOT add static imports to Vly platform tooling here.
// Any module that can fail at load-time (snapdom, vly-ai, etc.) MUST be
// imported lazily via React.lazy() so a failure cannot prevent React
// from mounting.  The previous static import of VlyToolbar caused
// @zumer/snapdom to be evaluated at module scope — if that threw,
// the entire app went blank with no recovery.
// ═══════════════════════════════════════════════════════════════════════

import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { ThemeProvider } from "@/components/theme-provider";
import { MusicProvider } from "@/components/music-player";
import { useLenis } from "@/hooks/useLenis";
import { ConvexAuthProvider, useConvexAuth } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// ─── VlyToolbar: LAZY with error recovery ────────────────────────────
// Must be lazy — it statically imports @zumer/snapdom which can throw at
// module evaluation time in some production environments.  If the import
// fails we return a no-op component so the rest of the app is unaffected.
const VlyToolbar = lazy(() =>
  import("../vly-toolbar-readonly.tsx").catch(() => ({
    default: () => null,
  })),
);

// ─── Convex client: safe construction ────────────────────────────────
// Render can retain an older build-time value after a Blueprint update.
// Normalize the former dev deployment so auth and the backend workflow always
// target the same production Convex deployment.
let convex: ConvexReactClient;
try {
  convex = new ConvexReactClient(
    (import.meta as unknown as Record<string, Record<string, string>>).env
      ?.VITE_CONVEX_URL?.replace(
      "hearty-seahorse-455.convex.cloud",
      "flexible-bloodhound-758.convex.cloud",
    ) || "https://flexible-bloodhound-758.convex.cloud",
  );
} catch (e) {
  console.error("[Nexus] Failed to create Convex client:", e);
  // Placeholder that won't crash render — auth queries will return
  // undefined and RequireAuth will redirect to /auth.
  convex = null as unknown as ConvexReactClient;
}

// Lazy load route components for better code splitting
const Landing = lazy(() => import("./pages/Landing.tsx"));
const AuthPage = lazy(() => import("./pages/Auth.tsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const Tutor = lazy(() => import("./pages/Tutor.tsx"));
const Todos = lazy(() => import("./pages/Todos.tsx"));
const Focus = lazy(() => import("./pages/Focus.tsx"));
const Plans = lazy(() => import("./pages/Plans.tsx"));
const Journey = lazy(() => import("./pages/Journey.tsx"));
const CalendarPage = lazy(() => import("./pages/Calendar.tsx"));
const Notes = lazy(() => import("./pages/Notes.tsx"));
const Flashcards = lazy(() => import("./pages/Flashcards.tsx"));
const Achievements = lazy(() => import("./pages/Achievements.tsx"));
const Groups = lazy(() => import("./pages/Groups.tsx"));
const Room = lazy(() => import("./pages/Room.tsx"));
const Reader = lazy(() => import("./pages/Reader.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));
const Upgrade = lazy(() => import("./pages/Upgrade.tsx"));
const Admin = lazy(() => import("./pages/Admin.tsx"));
const AdminContentUpload = lazy(() => import("./pages/AdminContentUpload.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 font-serif text-2xl font-black text-primary">N</div>
        <p className="mt-4 font-mono text-[10px] font-bold uppercase tracking-[0.3em] text-muted-foreground">Loading Nexus Academy</p>
      </div>
    </div>
  );
}

/** Error boundary that catches lazy-load / chunk-fetch failures and offers a
 *  retry button instead of a dead page. */
class LazyErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || "Failed to load this page.",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[LazyErrorBoundary]", err);
    // If the global recovery system exists, use it for more robust handling
    const showRecovery = (window as unknown as Record<string, (msg: string) => void>).__NEXUS_SHOW_RECOVERY;
    if (showRecovery) {
      showRecovery(this.state.message || err.message);
    }
  }
  retry = () => {
    this.setState({ hasError: false, message: "" });
    // Clear any stale session state and force a full cache-busting reload.
    try { sessionStorage.clear(); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set("_t", String(Date.now()));
    window.location.href = url.toString();
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md text-center glass-panel rounded-2xl p-8">
            <p className="text-sm font-semibold text-foreground">
              Page failed to load
            </p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            <button
              onClick={this.retry}
              className="mt-4 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing. */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the app as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Nexus] Root crash:", err);
    // Notify the global recovery system
    const showRecovery = (window as unknown as Record<string, (msg: string) => void>).__NEXUS_SHOW_RECOVERY;
    if (showRecovery) {
      showRecovery(this.state.message || err.message);
    }
  }
  retry = () => {
    this.setState({ hasError: false, message: "", stack: "" });
    try { sessionStorage.clear(); } catch { /* ignore */ }
    const url = new URL(window.location.href);
    url.searchParams.set("_t", String(Date.now()));
    window.location.href = url.toString();
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Something went wrong</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
            <button
              onClick={this.retry}
              className="mt-4 rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Smooth fade/slide between routes */
function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <motion.div
      key={location.pathname}
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}

/** Branded preloader — hides the CSS-only boot screen when React takes over. */
function AppPreloader({ ready }: { ready: boolean }) {
  useEffect(() => {
    // Signal to the inline recovery system that React has mounted
    (window as unknown as Record<string, boolean>).__NEXUS_MOUNTED = true;
    // Hide the CSS-only boot screen (visible before React)
    const boot = document.getElementById('nexus-boot-screen');
    if (boot) {
      boot.classList.add('nexus-hidden');
      // Remove from DOM after fade-out transition
      const onEnd = () => { boot.remove(); };
      boot.addEventListener('transitionend', onEnd, { once: true });
      // Safety: remove after 500ms even if transitionend doesn't fire
      setTimeout(onEnd, 500);
    }
  }, []);
  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          key="preloader"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background"
          role="status"
          aria-label="Loading Nexus Academy"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="relative flex size-20 items-center justify-center rounded-2xl border border-primary/30 bg-gradient-to-b from-primary/20 to-primary/5 shadow-[0_0_60px_-10px_var(--primary)]"
          >
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.4 }}
              className="font-serif text-3xl font-black text-primary"
            >
              N
            </motion.span>
            <motion.span
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: "easeOut" }}
              className="absolute -bottom-2 h-px w-14 origin-left bg-gradient-to-r from-transparent via-primary to-transparent"
            />
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="mt-6 font-mono text-[10px] font-bold uppercase tracking-[0.4em] text-muted-foreground"
          >
            Nexus Academy
          </motion.p>
          <span className="sr-only">Loading Nexus Academy…</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Holds the preloader until the app is genuinely ready. */
function PreloaderGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    // Signal mount immediately so the boot-screen timeout knows we're alive
    (window as unknown as Record<string, boolean>).__NEXUS_MOUNTED = true;
    // Hide the CSS-only boot screen right away
    const boot = document.getElementById('nexus-boot-screen');
    if (boot) {
      boot.classList.add('nexus-hidden');
      const onEnd = () => { boot.remove(); };
      boot.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 500);
    }
    let finished = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setReady(true));
      });
    };
    if (document.readyState === "complete") {
      finish();
    } else {
      window.addEventListener("load", finish, { once: true });
    }
    // Reduced safety timeout: 600ms instead of 800ms for faster perceived load
    const safety = window.setTimeout(() => setReady(true), 600);
    return () => {
      window.removeEventListener("load", finish);
      window.clearTimeout(safety);
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
    };
  }, []);
  return (
    <>
      <AppPreloader ready={ready} />
      {children}
    </>
  );
}

/** Auto-closes the OAuth popup once auth settles. Must live inside
 * ConvexAuthProvider so it can read the auth state. */
function OAuthPopupCloser() {
  const { isLoading } = useConvexAuth();
  useEffect(() => {
    if (window.name !== "nexus-google-auth") return;
    if (isLoading) return;
    // Auth settled — close popup so parent picks up the new session
    const t = setTimeout(() => window.close(), 500);
    return () => clearTimeout(t);
  }, [isLoading]);
  return null;
}

function RouteSyncer() {
  useLenis();
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

// ─── Mount ────────────────────────────────────────────────────────────
// Wrap in a self-executing async function so we can use top-level
// await-style patterns without blocking the module.
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <RootErrorBoundary>
        {/* VlyToolbar: lazy-loaded, wrapped in both Suspense (for chunk
            loading) and ToolbarErrorBoundary (for render crashes). If
            either fails, the app is unaffected. */}
        <Suspense fallback={null}>
          <ToolbarErrorBoundary>
            <VlyToolbar />
          </ToolbarErrorBoundary>
        </Suspense>
        <ConvexAuthProvider client={convex}>
          <OAuthPopupCloser />
          <ThemeProvider>
            <MusicProvider>
              <PreloaderGate>
                <BrowserRouter>
                  <RouteSyncer />
                  <Suspense fallback={<RouteLoading />}>
                    <LazyErrorBoundary>
                      <PageTransition>
                        <Routes>
                          <Route path="/" element={<Landing />} />
                          <Route
                            path="/auth"
                            element={<AuthPage redirectAfterAuth="/dashboard" />}
                          />
                          <Route
                            path="/dashboard"
                            element={
                              <RequireAuth>
                                <Dashboard />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/tutor"
                            element={
                              <RequireAuth>
                                <Tutor />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/todos"
                            element={
                              <RequireAuth>
                                <Todos />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/focus"
                            element={
                              <RequireAuth>
                                <Focus />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/plans"
                            element={
                              <RequireAuth>
                                <Plans />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/journey"
                            element={
                              <RequireAuth>
                                <Journey />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/calendar"
                            element={
                              <RequireAuth>
                                <CalendarPage />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/notes"
                            element={
                              <RequireAuth>
                                <Notes />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/flashcards"
                            element={
                              <RequireAuth>
                                <Flashcards />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/achievements"
                            element={
                              <RequireAuth>
                                <Achievements />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/groups"
                            element={
                              <RequireAuth>
                                <Groups />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/rooms/:roomId"
                            element={
                              <RequireAuth>
                                <Room />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/read/:contentId"
                            element={
                              <RequireAuth>
                                <Reader />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/settings"
                            element={
                              <RequireAuth>
                                <Settings />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/upgrade"
                            element={
                              <RequireAuth>
                                <Upgrade />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/admin"
                            element={
                              <RequireAuth>
                                <Admin />
                              </RequireAuth>
                            }
                          />
                          <Route
                            path="/admin/content-upload"
                            element={
                              <RequireAuth>
                                <AdminContentUpload />
                              </RequireAuth>
                            }
                          />
                          <Route path="*" element={<NotFound />} />
                        </Routes>
                      </PageTransition>
                    </LazyErrorBoundary>
                  </Suspense>
                </BrowserRouter>
              </PreloaderGate>
              <Toaster />
            </MusicProvider>
          </ThemeProvider>
        </ConvexAuthProvider>
      </RootErrorBoundary>
    </StrictMode>,
  );
} else {
  // If #root doesn't exist, something is very wrong with index.html.
  document.body.textContent =
    "Nexus Academy failed to start. Please hard-refresh the page (Ctrl+Shift+R).";
}
