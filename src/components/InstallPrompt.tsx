// Install prompt — appears once for new users on their first dashboard visit.
//
// Two paths:
//   1. PWA install supported (Chrome/Edge on desktop + Android): the
//      browser fires `beforeinstallprompt`. We capture it, show the modal
//      with a real "Install" button that triggers the native prompt.
//   2. No PWA support (iOS Safari, Firefox, etc.): we show platform-
//      specific manual instructions ("Add to Home Screen" / "Create
//      shortcut" / "Install app").
//
// Persistence:
//   • localStorage flag `learnyx.installPrompt.dismissed` — once the
//     user clicks Skip or completes an install, we never show again.
//   • localStorage flag `learnyx.installPrompt.installed` — set when
//     the user actually completes the install (appinstalled event).
//   • The flag persists across sessions, so we don't nag returning users.
//
// Timing:
//   • Show after a 4-second delay on first dashboard visit (lets the page
//     settle — the dashboard has a lot of motion, the modal shouldn't
//     compete with that initial cinematic entrance).
//   • Don't show if the app is already running in standalone mode (means
//     it's already installed).
//   • Don't show on Landing/Auth (only on the dashboard — when the user
//     has actually committed to using the app).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Apple,
  BookmarkPlus,
  CheckCircle2,
  Chrome,
  Download,
  Home,
  Monitor,
  Share,
  Smartphone,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DISMISS_KEY = "learnyx.installPrompt.dismissed";
const INSTALLED_KEY = "learnyx.installPrompt.installed";
const SHOW_DELAY_MS = 4000;

// `beforeinstallprompt` event shape — not in the standard TS DOM lib yet.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Platform = "pwa-supported" | "ios" | "desktop-other" | "android-other" | "already-installed";

function detectPlatform(): Platform {
  // Already installed (running in standalone mode) — never prompt.
  if (typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches) {
    return "already-installed";
  }
  // iOS Safari — no PWA support, show manual instructions.
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !(window as { MSStream?: unknown }).MSStream;
  if (isIOS) return "ios";
  // Android non-Chrome (Firefox etc.) — manual instructions.
  const isAndroid = /Android/.test(ua);
  const isChrome = /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor ?? "");
  if (isAndroid && !isChrome) return "android-other";
  // Desktop Chrome/Edge → PWA install supported (if beforeinstallprompt fires).
  // Mobile Chrome → PWA install supported.
  // We'll only know for sure when the event fires — but default to this path.
  return "pwa-supported";
}

/**
 * InstallPrompt — mounted inside DashboardShell so it appears on every
 * dashboard page. Shows once per user (localStorage dismissal). Captures
 * the `beforeinstallprompt` event for real PWA install; falls back to
 * platform-specific manual instructions otherwise.
 */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Bail if previously dismissed or already installed.
    let dismissed = false;
    let installed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "true";
      installed = localStorage.getItem(INSTALLED_KEY) === "true";
    } catch {
      // localStorage access can fail in private mode — treat as not-yet-dismissed.
    }
    if (dismissed || installed) return;

    const detected = detectPlatform();
    if (detected === "already-installed") return;
    setPlatform(detected);

    // Capture the beforeinstallprompt event (Chrome/Edge/Android-Chrome only).
    const capturePrompt = (e: Event) => {
      e.preventDefault(); // Stop the browser from showing its own mini-prompt.
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);

    // Detect actual install completion — dismiss the prompt permanently if so.
    const onAppInstalled = () => {
      try {
        localStorage.setItem(INSTALLED_KEY, "true");
      } catch {
        // ignore
      }
      setVisible(false);
    };
    window.addEventListener("appinstalled", onAppInstalled);

    // Show after a delay (lets the dashboard's cinematic entrance settle).
    const showTimer = window.setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY_MS);

    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.clearTimeout(showTimer);
    };
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "true");
    } catch {
      // ignore
    }
    setVisible(false);
  };

  const handleInstall = async () => {
    if (deferredPrompt) {
      setInstalling(true);
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          try {
            localStorage.setItem(INSTALLED_KEY, "true");
          } catch {
            // ignore
          }
          setVisible(false);
        }
        // If dismissed, we leave the modal up — the user can reconsider or skip.
      } finally {
        setInstalling(false);
        setDeferredPrompt(null);
      }
    } else {
      // No native prompt available — copy the manual instructions instead.
      dismiss();
    }
  };

  return (
    <AnimatePresence>
      {visible && platform && platform !== "already-installed" && (
        <InstallPromptModal
          platform={platform}
          hasNativePrompt={!!deferredPrompt}
          installing={installing}
          onInstall={handleInstall}
          onSkip={dismiss}
        />
      )}
    </AnimatePresence>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════════════════

function InstallPromptModal({
  platform,
  hasNativePrompt,
  installing,
  onInstall,
  onSkip,
}: {
  platform: Platform;
  hasNativePrompt: boolean;
  installing: boolean;
  onInstall: () => void | Promise<void>;
  onSkip: () => void;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="absolute inset-0 bg-black/70 backdrop-blur-md"
        onClick={onSkip}
      />

      {/* Modal card */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -16 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="glass-panel relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-400/25 p-6 shadow-[0_24px_80px_-20px_rgba(251,191,36,0.4)] sm:p-7"
      >
        {/* Ambient glow blobs */}
        <div className="pointer-events-none absolute -top-20 -right-16 size-48 rounded-full bg-amber-400/15 blur-[80px]" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 size-40 rounded-full bg-amber-400/[0.08] blur-[60px]" />

        {/* Skip X */}
        <button
          type="button"
          onClick={onSkip}
          aria-label="Skip"
          className="absolute right-3 top-3 z-10 flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="relative flex flex-col gap-5">
          {/* Hero icon + heading */}
          <div className="flex flex-col items-center gap-3 text-center">
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 220, damping: 18 }}
              className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/25 to-amber-500/5 shadow-[0_0_32px_-6px_rgb(251,191,36/0.6)]"
            >
              <Download className="size-7 text-amber-300" />
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.5, type: "spring", stiffness: 300, damping: 20 }}
                className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-extrabold text-black shadow-[0_0_10px_rgb(251,191,36/0.8)]"
              >
                <Sparkles className="size-2.5" />
              </motion.span>
            </motion.div>

            <div>
              <h2 className="type-h2 text-gradient">Install Learnyx</h2>
              <p className="mt-1 type-body text-muted-foreground">
                Add it to your device for one-tap access — offline library, faster
                startup, no browser tabs getting in the way.
              </p>
            </div>
          </div>

          {/* Feature bullets */}
          <div className="flex flex-col gap-2">
            <FeatureRow icon={<Zap className="size-3.5" />} text="Opens instantly — no browser tab hunting" />
            <FeatureRow icon={<Home className="size-3.5" />} text="Home screen icon with the Learnyx logo" />
            <FeatureRow icon={<BookmarkPlus className="size-3.5" />} text="Saved resources work even when you're offline" />
          </div>

          {/* Platform-specific instructions OR native install button */}
          <div className="flex flex-col gap-3">
            {hasNativePrompt ? (
              // PWA-supported path — real Install button triggers the native prompt.
              <Button
                className="interactive-press h-12 w-full cursor-pointer rounded-2xl text-sm font-bold shadow-[0_8px_24px_-12px_rgba(251,191,36,0.8)]"
                onClick={() => void onInstall()}
                disabled={installing}
              >
                {installing ? (
                  <>
                    <Sparkles className="size-4 animate-pulse" /> Installing…
                  </>
                ) : (
                  <>
                    <Download className="size-4" /> Install now
                  </>
                )}
              </Button>
            ) : (
              // Manual instructions — show platform-specific steps.
              <ManualInstructions platform={platform} />
            )}

            {/* Skip — subtle, bottom-right */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onSkip}
                className="cursor-pointer text-xs font-semibold text-muted-foreground/70 transition-colors hover:text-muted-foreground"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

function FeatureRow({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.025] px-3 py-2">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
        {icon}
      </span>
      <p className="type-caption text-foreground/85">{text}</p>
      <CheckCircle2 className="ml-auto size-3.5 shrink-0 text-emerald-400/70" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// MANUAL INSTRUCTIONS — for browsers without beforeinstallprompt support
// ═══════════════════════════════════════════════════════════════════════

function ManualInstructions({ platform }: { platform: Platform }) {
  // Detect more specifically for the instructions panel.
  if (platform === "ios") {
    return (
      <InstructionPanel
        icon={<Apple className="size-4" />}
        title="Add to Home Screen"
        steps={[
          { icon: <Share className="size-3.5" />, text: "Tap the Share button in Safari's toolbar" },
          { icon: <Plus className="size-3.5" />, text: 'Choose "Add to Home Screen"' },
          { icon: <CheckCircle2 className="size-3.5" />, text: "Tap Add — Learnyx appears on your home screen" },
        ]}
      />
    );
  }
  if (platform === "android-other") {
    return (
      <InstructionPanel
        icon={<Smartphone className="size-4" />}
        title="Add to Home Screen"
        steps={[
          { icon: <Menu className="size-3.5" />, text: "Tap the browser menu (⋮)" },
          { icon: <Plus className="size-3.5" />, text: 'Choose "Add to Home screen"' },
          { icon: <CheckCircle2 className="size-3.5" />, text: "Tap Add — Learnyx appears on your home screen" },
        ]}
      />
    );
  }
  // Desktop non-Chrome (Firefox/Safari on macOS, etc.)
  return (
    <InstructionPanel
      icon={<Monitor className="size-4" />}
      title="Create a Shortcut"
      steps={[
        { icon: <BookmarkPlus className="size-3.5" />, text: "Drag the URL from the address bar to your desktop" },
        { icon: <Home className="size-3.5" />, text: "Or right-click → \"Create shortcut\" / \"Save Page As\"" },
        { icon: <Chrome className="size-3.5" />, text: "For one-tap install, use Chrome/Edge — they support native PWA install" },
      ]}
    />
  );
}

function InstructionPanel({
  icon,
  title,
  steps,
}: {
  icon: ReactNode;
  title: string;
  steps: { icon: ReactNode; text: string }[];
}) {
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4">
      <p className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
        {icon} {title}
      </p>
      <ol className="mt-3 flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex items-center gap-2.5">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-400/10 font-mono text-[10px] font-bold text-amber-300">
              {i + 1}
            </span>
            <span className="flex items-center gap-1.5 type-caption text-foreground/85">
              <span className="text-muted-foreground/70">{step.icon}</span>
              {step.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Tiny inline icon imports used only inside ManualInstructions.
function Plus({ className }: { className?: string }) {
  return <BookmarkPlus className={className} />;
}
function Menu({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}
