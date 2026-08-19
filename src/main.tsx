import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { ThemeProvider } from "@/components/theme-provider";
import { MusicProvider } from "@/components/music-player";
import { useLenis } from "@/hooks/useLenis";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

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
 *  retry button instead of a dead page.  Without this, a transient CDN hiccup
 *  on Render/Cloudflare makes the entire route unusable until a hard refresh. */
class LazyErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error?.message || 'Failed to load this page.',
    };
  }
  componentDidCatch(err: Error) {
    console.error('[LazyErrorBoundary]', err);
  }
  retry = () => {
    this.setState({ hasError: false, message: '' });
    // Bypass browser cache so we get the latest index.html with current
    // chunk hashes — a plain reload may re-fetch the stale cached HTML.
    const params = new URLSearchParams(window.location.search);
    params.set("__nexus_retry", String(Date.now()));
    window.location.replace(`${window.location.pathname}?${params.toString()}${window.location.hash}`);
  };
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background p-6">
          <div className="max-w-md text-center glass-panel rounded-2xl p-8">
            <p className="text-sm font-semibold text-foreground">Page failed to load</p>
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

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in WebContainer environment). */
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

/** Hard guard so runtime errors never leave the preview as a blank page. */
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
    console.error("[WebContainer preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);



/** Smooth fade/slide between routes — keyed by pathname, respects reduced motion. */
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

/** Branded preloader — a quick, intentional moment tied to real load
 *  completion (window load + first painted frame), with a hard safety cap so
 *  a slow asset can never trap the user. Not an artificial timer. */
function AppPreloader({ ready }: { ready: boolean }) {
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

/** Holds the preloader until the app is genuinely ready: window load fired
 *  AND the first content has painted. Falls back to a 2.5s safety cap. */
function PreloaderGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let finished = false;
    let firstFrame = 0;
    let secondFrame = 0;
    const finish = () => {
      if (finished) return;
      finished = true;
      // Let the first real frame paint before fading the overlay.
      firstFrame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => setReady(true));
      });
    };
    if (document.readyState === "complete") {
      finish();
    } else {
      window.addEventListener("load", finish, { once: true });
    }
    // Never leave the full-screen loader covering the app if requestAnimationFrame
    // is paused during a background-tab refresh or a browser restore.
    const safety = window.setTimeout(() => setReady(true), 2500);
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


createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
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
