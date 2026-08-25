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
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
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

/** ═══════════════════════════════════════════════════════════════════════
 *  NEXUS CINEMATIC PRELOADER — "Protocol Activation" sequence
 *  ═══════════════════════════════════════════════════════════════════════
 *  Visual layers (bottom → top):
 *    1. Deep-space background with subtle radial pulse
 *    2. Horizontal scan beam sweeping top → bottom
 *    3. HUD corner brackets (targeting reticle)
 *    4. Pulsing ambient glow ring
 *    5. 3 orbital rings with glowing tracker dots
 *    6. Central glassmorphic logo frame with breathing glow
 *    7. "N" letter with glow pulse
 *    8. Staggered character-by-character text reveal
 *    9. Expanding progress line
 *    10. Cinematic exit: scale + blur + fade (hyperspace feel)
 */
function AppPreloader({ ready }: { ready: boolean }) {
  useEffect(() => {
    (window as unknown as Record<string, boolean>).__NEXUS_MOUNTED = true;
    const boot = document.getElementById('nexus-boot-screen');
    if (boot) {
      boot.classList.add('nexus-hidden');
      const onEnd = () => { boot.remove(); };
      boot.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(onEnd, 500);
    }
  }, []);

  // Pre-compute the staggered letter animation for "NEXUS ACADEMY"
  const letters = "NEXUS ACADEMY".split("");

  return (
    <AnimatePresence>
      {!ready && (
        <motion.div
          key="nexus-preloader"
          exit={{ opacity: 0, scale: 1.04, filter: 'blur(12px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden bg-[#050510]"
          role="status"
          aria-label="Loading Nexus Academy"
        >
          {/* ── Layer 1: Background radial pulse ── */}
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse 60% 50% at 50% 50%, oklch(0.25 0.08 232 / 0.15) 0%, transparent 70%)',
              animation: 'preloader-glow-breathe 2.4s ease-in-out infinite',
            }}
          />

          {/* ── Layer 2: Scan beam ── */}
          <div
            className="absolute left-0 right-0 h-px"
            style={{
              background: 'linear-gradient(90deg, transparent 5%, oklch(0.74 0.15 232 / 0.4) 50%, transparent 95%)',
              animation: 'preloader-scan-beam 1.4s ease-in-out 0.2s 1',
            }}
          />

          {/* ── Layer 3: HUD corner brackets ── */}
          {/* Top-left */}
          <div
            className="absolute top-10 left-10 border-t border-l border-primary/30"
            style={{ animation: 'preloader-corner-in-tl 0.5s ease-out 0.1s both', width: 32, height: 32 }}
          />
          {/* Top-right */}
          <div
            className="absolute top-10 right-10 border-t border-r border-primary/30"
            style={{ animation: 'preloader-corner-in-tr 0.5s ease-out 0.15s both', width: 32, height: 32 }}
          />
          {/* Bottom-left */}
          <div
            className="absolute bottom-10 left-10 border-b border-l border-primary/30"
            style={{ animation: 'preloader-corner-in-bl 0.5s ease-out 0.2s both', width: 32, height: 32 }}
          />
          {/* Bottom-right */}
          <div
            className="absolute bottom-10 right-10 border-b border-r border-primary/30"
            style={{ animation: 'preloader-corner-in-br 0.5s ease-out 0.25s both', width: 32, height: 32 }}
          />

          {/* ── Layer 4: Pulsing ambient ring ── */}
          <div
            className="absolute rounded-full border border-primary/10"
            style={{
              width: 200, height: 200,
              animation: 'preloader-pulse-ring 2s ease-in-out infinite',
            }}
          />

          {/* ── Layer 5: Orbital rings with tracker dots ── */}
          {/* Ring 1 — fast, close */}
          <div
            className="absolute"
            style={{
              width: 160, height: 160,
              animation: 'preloader-orbit-1 3s linear infinite',
            }}
          >
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            <div className="absolute -top-[2px] left-1/2 -translate-x-1/2 size-2 rounded-full bg-primary shadow-[0_0_10px_oklch(0.74_0.15_232),0_0_20px_oklch(0.74_0.15_232/0.3)]" />
          </div>
          {/* Ring 2 — medium, tilted */}
          <div
            className="absolute"
            style={{
              width: 220, height: 220,
              animation: 'preloader-orbit-2 5s linear infinite',
            }}
          >
            <div className="absolute inset-0 rounded-full border border-primary/10" />
            <div className="absolute -top-[1.5px] left-1/2 -translate-x-1/2 size-1.5 rounded-full bg-primary/70 shadow-[0_0_8px_oklch(0.74_0.15_232/0.5)]" />
          </div>
          {/* Ring 3 — slow, wide */}
          <div
            className="absolute"
            style={{
              width: 280, height: 280,
              animation: 'preloader-orbit-3 7s linear infinite',
            }}
          >
            <div className="absolute inset-0 rounded-full border border-[oklch(0.74_0.15_232/0.06)]" />
            <div className="absolute -top-[1px] left-1/2 -translate-x-1/2 size-1 rounded-full bg-primary/40 shadow-[0_0_6px_oklch(0.74_0.15_232/0.3)]" />
          </div>

          {/* ── Layer 6+7: Central logo with glow ── */}
          <motion.div
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10"
          >
            {/* Breathing glow behind the logo */}
            <div
              className="absolute inset-0 -m-10 rounded-full bg-primary/8 blur-2xl"
              style={{ animation: 'preloader-glow-breathe 2s ease-in-out infinite' }}
            />

            {/* Glassmorphic frame */}
            <div className="relative flex size-[76px] items-center justify-center rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/15 via-[oklch(0.2_0.05_232/0.4)] to-primary/5 shadow-[0_0_40px_-8px_oklch(0.74_0.15_232/0.3),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-sm">
              {/* Inner subtle border highlight */}
              <div className="absolute inset-[1px] rounded-[14px] border border-white/[0.03]" />

              {/* The "N" with glow pulse */}
              <span
                className="relative font-serif text-4xl font-black text-gradient"
                style={{ animation: 'preloader-n-glow 2s ease-in-out infinite' }}
              >
                N
              </span>
            </div>
          </motion.div>

          {/* ── Layer 8: Staggered text reveal ── */}
          <div className="relative z-10 mt-8 flex items-center justify-center overflow-hidden" style={{ height: 16 }}>
            <div className="flex">
              {letters.map((char, i) => (
                <span
                  key={i}
                  className="inline-block font-mono text-[11px] font-bold uppercase tracking-[0.12em]"
                  style={{
                    color: char === ' ' ? 'transparent' : 'oklch(0.7 0.08 232 / 0.5)',
                    width: char === ' ' ? '0.4em' : 'auto',
                    animation: `preloader-shimmer-letter 0.4s ease-out ${0.25 + i * 0.04}s both`,
                  }}
                >
                  {char === ' ' ? '\u00A0' : char}
                </span>
              ))}
            </div>
          </div>

          {/* ── Layer 9: Progress line ── */}
          <div className="relative z-10 mt-5 h-px w-36 overflow-hidden rounded-full bg-white/[0.04]">
            <div
              className="h-full w-full origin-left"
              style={{
                background: 'linear-gradient(90deg, transparent, oklch(0.74 0.15 232 / 0.6) 40%, oklch(0.74 0.15 232) 50%, oklch(0.74 0.15 232 / 0.6) 60%, transparent)',
                animation: 'preloader-bar-fill 1.4s ease-out 0.15s both',
              }}
            />
          </div>

          {/* ── Floating ambient dots ── */}
          {[
            { top: '18%', left: '15%', delay: '0s' },
            { top: '25%', right: '18%', delay: '0.6s' },
            { bottom: '22%', left: '22%', delay: '1.2s' },
            { bottom: '30%', right: '12%', delay: '0.3s' },
            { top: '40%', left: '8%', delay: '0.9s' },
            { top: '35%', right: '8%', delay: '1.5s' },
          ].map((pos, i) => (
            <div
              key={i}
              className="absolute size-1 rounded-full bg-primary/40"
              style={{
                ...pos,
                animation: `preloader-dot-float ${2 + i * 0.3}s ease-in-out ${pos.delay} infinite`,
              }}
            />
          ))}

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
