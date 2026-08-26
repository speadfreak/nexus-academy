"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AnimatePresence } from "framer-motion";
import { TOUR_STEPS, TOTAL_STEPS } from "./tourSteps";
import {
  TourOverlay,
  TourWelcomeCard,
  TourCompleteCard,
  TourTransitionOverlay,
} from "./TourOverlay";

type TourPhase = "welcome" | "active" | "transitioning" | "complete" | "idle";

interface TourContextValue {
  isActive: boolean;
  startTour: () => void;
  resetTour: () => void;
}

const TourContext = createContext<TourContextValue>({
  isActive: false,
  startTour: () => {},
  resetTour: () => {},
});

export function useTour() {
  return useContext(TourContext);
}

/**
 * Waits for a CSS selector to match a visible element in the DOM.
 * Uses MutationObserver + rAF polling. Resolves when found, rejects on timeout.
 */
function waitForSelector(
  selector: string,
  timeoutMs = 6000,
): { promise: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let done = false;
  let resolveFn: () => void;
  let rejectFn: () => void;

  const promise = new Promise<void>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  const check = (): boolean => {
    if (cancelled || done) return false;
    const el = document.querySelector(selector);
    if (el instanceof HTMLElement && el.offsetWidth > 0 && el.offsetHeight > 0) {
      done = true;
      resolveFn();
      return true;
    }
    return false;
  };

  // Immediate check (element might already be there, e.g. same-route step)
  if (check()) return { promise, cancel: () => {} };

  // rAF polling — catches React commits that don't trigger mutations
  let rafId: number;
  const poll = () => {
    if (cancelled || done) return;
    if (check()) return;
    rafId = requestAnimationFrame(poll);
  };
  rafId = requestAnimationFrame(poll);

  // MutationObserver for structural DOM changes
  const observer = new MutationObserver(() => {
    if (!done) check();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Hard timeout — on production CDN this should never trigger
  const timer = setTimeout(() => {
    if (!cancelled && !done) {
      done = true;
      cleanup();
      rejectFn();
    }
  }, timeoutMs);

  const cleanup = () => {
    cancelled = true;
    done = true;
    cancelAnimationFrame(rafId);
    observer.disconnect();
    clearTimeout(timer);
  };

  return { promise, cancel: cleanup };
}

/**
 * TourProvider MUST live ABOVE the route tree (in main.tsx) so that it
 * persists across navigations.  Previously it was inside DashboardShell
 * which re-mounted on every route change, destroying all tour state.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const tourStatus = useQuery(api.tour.getTourStatus);
  const updateTour = useMutation(api.tour.updateTourStatus);

  const [phase, setPhase] = useState<TourPhase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const hasAutoTriggered = useRef(false);
  const isNavigatingRef = useRef(false);
  const busyRef = useRef(false);
  const waitHandleRef = useRef<{ cancel: () => void } | null>(null);

  const currentStep = useMemo(
    () => TOUR_STEPS[stepIndex] ?? null,
    [stepIndex],
  );

  // Cancel any pending element-wait
  const cancelWait = useCallback(() => {
    if (waitHandleRef.current) {
      waitHandleRef.current.cancel();
      waitHandleRef.current = null;
    }
  }, []);

  // Auto-trigger on first sign-in (hasCompletedTour === false and not skipped)
  useEffect(() => {
    if (hasAutoTriggered.current) return;
    if (tourStatus === undefined) return;
    if (!tourStatus.hasCompletedTour && tourStatus.tourSkippedAt === undefined) {
      hasAutoTriggered.current = true;
      setPhase("welcome");
    }
  }, [tourStatus]);

  // Navigate to a specific step and wait for the target element
  const goToStep = useCallback(
    (index: number) => {
      if (busyRef.current) return;
      const targetStep = TOUR_STEPS[index];
      if (!targetStep) return;

      busyRef.current = true;
      cancelWait();
      isNavigatingRef.current = true;
      setPhase("transitioning");
      setStepIndex(index);

      // Navigate if route differs
      if (location.pathname !== targetStep.route) {
        navigate(targetStep.route);
      }

      // Wait for the target element to appear in the DOM.
      // On success: brief settle delay then go active.
      // On timeout (6s): go active anyway — the overlay has its own
      // continuous re-measurement and will find it when it eventually appears.
      const { promise, cancel } = waitForSelector(targetStep.targetSelector, 6000);
      waitHandleRef.current = { cancel };

      const activate = () => {
        // Small settle delay for layout to finish painting
        const settle = setTimeout(() => {
          isNavigatingRef.current = false;
          busyRef.current = false;
          waitHandleRef.current = null;
          setPhase("active");
        }, 150);
        // Make settle cancellable
        waitHandleRef.current = {
          cancel: () => {
            clearTimeout(settle);
            cancel();
          },
        };
      };

      promise.then(activate).catch(() => {
        // Timeout — activate anyway, overlay will handle missing element
        console.warn(`[Tour] Timeout waiting for "${targetStep.targetSelector}", activating anyway`);
        activate();
      });
    },
    [location.pathname, navigate, cancelWait],
  );

  // Cleanup on unmount
  useEffect(() => cancelWait, [cancelWait]);

  const handleStart = useCallback(() => {
    busyRef.current = false;
    goToStep(0);
  }, [goToStep]);

  const handleNext = useCallback(() => {
    if (busyRef.current) return;
    if (stepIndex < TOTAL_STEPS - 1) {
      goToStep(stepIndex + 1);
    } else {
      cancelWait();
      isNavigatingRef.current = false;
      busyRef.current = false;
      setPhase("complete");
      updateTour({ action: "completed" }).catch(() => {});
    }
  }, [stepIndex, goToStep, updateTour, cancelWait]);

  const handleBack = useCallback(() => {
    if (busyRef.current) return;
    if (stepIndex > 0) goToStep(stepIndex - 1);
  }, [stepIndex, goToStep]);

  const handleSkip = useCallback(() => {
    cancelWait();
    isNavigatingRef.current = false;
    busyRef.current = false;
    setPhase("idle");
    updateTour({ action: "skipped" }).catch(() => {});
  }, [updateTour, cancelWait]);

  const handleCompleteDone = useCallback(() => {
    setPhase("idle");
    if (location.pathname !== "/dashboard") navigate("/dashboard");
  }, [navigate, location.pathname]);

  // Public: start/restart from Settings
  const startTour = useCallback(() => {
    cancelWait();
    updateTour({ action: "reset" }).catch(() => {});
    hasAutoTriggered.current = true;
    isNavigatingRef.current = false;
    busyRef.current = false;
    setStepIndex(0);
    setPhase("welcome");
  }, [updateTour, cancelWait]);

  const resetTour = useCallback(() => startTour(), [startTour]);

  // If user manually navigates to a non-tour route, end the tour
  useEffect(() => {
    if (phase !== "active" && phase !== "transitioning") return;
    if (isNavigatingRef.current) return;
    const tourRoutes = new Set(TOUR_STEPS.map((s) => s.route));
    if (!tourRoutes.has(location.pathname)) {
      cancelWait();
      isNavigatingRef.current = false;
      busyRef.current = false;
      setPhase("idle");
      updateTour({ action: "skipped" }).catch(() => {});
    }
  }, [location.pathname, phase, updateTour, cancelWait]);

  const ctxValue = useMemo(
    () => ({ isActive: phase !== "idle", startTour, resetTour }),
    [phase, startTour, resetTour],
  );

  return (
    <TourContext.Provider value={ctxValue}>
      {children}
      <AnimatePresence>
        {phase === "welcome" && (
          <TourWelcomeCard onStart={handleStart} onSkip={handleSkip} />
        )}
        {phase === "transitioning" && <TourTransitionOverlay />}
        {phase === "active" && currentStep && (
          <TourOverlay
            step={currentStep}
            currentIndex={stepIndex}
            onNext={handleNext}
            onBack={handleBack}
            onSkip={handleSkip}
          />
        )}
        {phase === "complete" && (
          <TourCompleteCard onDone={handleCompleteDone} />
        )}
      </AnimatePresence>
    </TourContext.Provider>
  );
}
