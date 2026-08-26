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
import { TourProvider } from "@/components/tour";
import AppPreloader from "@/components/AppPreloader";
import { RequireAuth } from "@/components/RequireAuth";
import { ThemeProvider } from "@/components/theme-provider";
import { MusicProvider } from "@/components/music-player";
import { useLenis } from "@/hooks/useLenis";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { ConvexReactClient } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import React, { StrictMode, useEffect, useRef, lazy, Suspense, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import { api } from "@/convex/_generated/api";
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

// ─── Client-side error logger (fire-and-forget to systemEvents) ─────
// Sends errors to the admin Terminal tab.  Never throws — if Convex is
// down or the action fails, we silently keep the app running.
function logErrorToServer(source: string, err: unknown) {
  try {
    const message = err instanceof Error ? err.message : String(err ?? "unknown");
    const stack = err instanceof Error ? err.stack : undefined;
    convex?.action(api.systemEvents.logClientError, {
      message,
      source,
      stack,
      url: typeof location !== "undefined" ? location.href : undefined,
    }).catch(() => { /* observability must never break the flow */ });
  } catch {
    // If even constructing the action call fails, just console.error.
  }
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
    <div className="flex min-h-screen items-center justify-center bg-[#050510] px-6">
      <div className="text-center">
        {/* Spinning ring */}
        <div className="relative mx-auto flex size-14 items-center justify-center">
          <div className="absolute inset-0 rounded-full border border-primary/20" style={{ animation: 'preloader-orbit-1 2.5s linear infinite' }} />
          <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
          <div className="flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 font-serif text-xl font-black text-primary">
            N
          </div>
        </div>
        <p className="mt-4 font-mono text-[9px] font-bold uppercase tracking-[0.35em] text-white/30">Loading</p>
      </div>
    </div>
  );
}

/** Error boundary that catches lazy-load / chunk-fetch failures and offers a
 *  retry button instead of a dead page.  Logs to admin Terminal. */
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
    logErrorToServer("LazyErrorBoundary", err);
    const showRecovery = (window as unknown as Record<string, (msg: string) => void>).__NEXUS_SHOW_RECOVERY;
    if (showRecovery) {
      showRecovery(this.state.message || err.message);
    }
  }
  retry = () => {
    this.setState({ hasError: false, message: "" });
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
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-destructive/10">
              <svg className="size-6 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-foreground">
              Something went wrong loading this page
            </p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            <button
              onClick={this.retry}
              className="mt-5 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            >
              Reload Page
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

/** Hard guard so runtime errors never leave the app as a blank page.
 *  Logs to admin Terminal for full visibility. */
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
    logErrorToServer("RootErrorBoundary", err);
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
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10">
              <svg className="size-7 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <p className="text-base font-semibold">Something went wrong</p>
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
              className="mt-5 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
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

// ═══════════════════════════════════════════════════════════════════════
// PAGE TRANSITION — THE KEY FIX
// ═══════════════════════════════════════════════════════════════════════
// ROOT CAUSE of blank-page-on-refresh: this component used
// `initial={{ opacity: 0 }}` on EVERY mount — including the initial page
// load / hard refresh.  When framer-motion's animation didn't fire
// (StrictMode double-mount race, Convex reconnect causing Suspense
// re-suspend, or edge cases with the key prop), the page stayed
// permanently at opacity: 0 — invisible.
//
// FIX: Skip the initial animation on the FIRST mount (page load / refresh)
// so content is immediately visible.  Only animate on subsequent SPA
// navigations (route changes within the app).
// ═══════════════════════════════════════════════════════════════════════

/** Smooth fade/slide between routes — BUT NOT on first page load. */
function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isFirstMount = useRef(true);

  // After the first mount completes, enable animations for future navigations
  useEffect(() => {
    const t = setTimeout(() => {
      isFirstMount.current = false;
    }, 100); // Small delay to ensure first render is fully committed
    return () => clearTimeout(t);
  }, []);

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <motion.div
      key={location.pathname}
      // On first mount: `initial={false}` means framer-motion applies the
      // `animate` values directly with NO entry animation → content is
      // immediately visible at opacity: 1.
      // On SPA navigation: the ref is false, so the nice fade/slide plays.
      initial={
        prefersReduced || isFirstMount.current
          ? false
          : { opacity: 0, y: 8 }
      }
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CONTENT SAFETY NET
// ═══════════════════════════════════════════════════════════════════════
// Nuclear option: if 5 seconds pass and the root element still has no
// visible content (everything stuck at opacity: 0, or Suspense never
// resolved), we force-inject CSS that overrides ALL framer-motion
// opacity values to 1.  This guarantees the user NEVER sees a blank
// page, even if every other mechanism fails.
// ═══════════════════════════════════════════════════════════════════════

function ContentSafetyNet() {
  const fired = useRef(false);

  useEffect(() => {
    const SAFETY_MS = 5000;
    const timer = setTimeout(() => {
      if (fired.current) return;
      fired.current = true;

      const root = document.getElementById("root");
      if (!root) return;

      // Check if root has any visible children with actual content
      const allEls = root.querySelectorAll("*");
      let hasVisibleContent = false;
      for (const el of allEls) {
        const html = el as HTMLElement;
        if (html.offsetHeight === 0 && html.offsetWidth === 0) continue;
        const style = window.getComputedStyle(html);
        const opacity = parseFloat(style.opacity);
        if (isNaN(opacity) || opacity < 0.05) continue;
        // Has non-zero size and visible opacity → content is showing
        hasVisibleContent = true;
        break;
      }

      if (hasVisibleContent) return; // All good, nothing to do

      // EMERGENCY: Force all elements visible
      console.warn("[Nexus] ContentSafetyNet triggered — forcing all content visible");
      logErrorToServer("ContentSafetyNet", new Error("Content invisible after 5s — forced opacity override"));

      const id = "nexus-safety-net-override";
      if (document.getElementById(id)) return; // Already injected
      const style = document.createElement("style");
      style.id = id;
      style.textContent = `
        #root * { opacity: 1 !important; transform: none !important; }
        #root .nexus-safety-net-hidden { display: none !important; }
      `;
      document.head.appendChild(style);

      // Remove the override after 2s — by then framer-motion should have caught up
      setTimeout(() => {
        style.remove();
      }, 2000);
    }, SAFETY_MS);

    return () => clearTimeout(timer);
  }, []);

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// GLOBAL ERROR CAPTOR
// ═══════════════════════════════════════════════════════════════════════
// Captures window.onerror and unhandledrejection AFTER React mounts.
// Logs to admin Terminal.  The index.html already handles pre-mount
// errors (script failures, dynamic import failures), this covers
// post-mount runtime errors that slip through error boundaries.
// ═══════════════════════════════════════════════════════════════════════

function GlobalErrorCaptor() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      // Skip errors already handled by error boundaries or the index.html script
      if (event.message.includes("Loading chunk") ||
          event.message.includes("dynamically imported")) return;
      console.error("[Nexus] Uncaught error:", event.error);
      logErrorToServer("window.onerror", event.error || event.message);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      console.error("[Nexus] Unhandled rejection:", event.reason);
      logErrorToServer("window.unhandledrejection", event.reason);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}

/** Holds the preloader until the app is genuinely ready.
 *  First visit in a tab: cinematic preloader plays once.
 *  Every refresh after that: preloader skipped, content renders instantly. */
function PreloaderGate({ children }: { children: React.ReactNode }) {
  const booted = useRef(false);
  const [ready, setReady] = React.useState(() => {
    try {
      const already = sessionStorage.getItem("nexus-booted") === "true";
      if (already) {
        const boot = document.getElementById("nexus-boot-screen");
        if (boot) boot.remove();
      }
      return already;
    } catch { return false; }
  });

  React.useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (window as unknown as Record<string, boolean>).__NEXUS_MOUNTED = true;
    const boot = document.getElementById('nexus-boot-screen');
    if (boot) {
      boot.classList.add('nexus-hidden');
      const onEnd = () => boot.remove();
      boot.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 500);
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setReady(true);
          try { sessionStorage.setItem("nexus-booted", "true"); } catch {}
        });
      });
    };
    if (document.readyState === "complete") {
      finish();
    } else {
      window.addEventListener("load", finish, { once: true });
    }
    const safety = window.setTimeout(finish, 1500);
    return () => {
      window.removeEventListener("load", finish);
      window.clearTimeout(safety);
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
                  <TourProvider>
                  <RouteSyncer />
                  <ContentSafetyNet />
                  <GlobalErrorCaptor />
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
                  </TourProvider>
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
