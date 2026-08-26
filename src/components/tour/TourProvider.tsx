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
  TourStepCard,
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
 * TourProvider MUST live ABOVE the route tree (in main.tsx).
 *
 * Architecture: card-based walkthrough. Each step navigates to the
 * target page and shows a centered card over a dim overlay — no
 * spotlight element targeting, no DOM measurement, no positioning bugs.
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

  const currentStep = useMemo(
    () => TOUR_STEPS[stepIndex] ?? null,
    [stepIndex],
  );

  // Auto-trigger for first-time users after sign-in.
  // Only fires when the user is on the dashboard (not on login/auth).
  useEffect(() => {
    if (hasAutoTriggered.current) return;
    if (tourStatus === undefined) return; // Convex still loading
    if (location.pathname !== "/dashboard") return; // Only trigger on dashboard
    if (!tourStatus.hasCompletedTour && tourStatus.tourSkippedAt === undefined) {
      hasAutoTriggered.current = true;
      // Small delay so the dashboard page is fully rendered first
      const t = setTimeout(() => setPhase("welcome"), 800);
      return () => clearTimeout(t);
    }
  }, [tourStatus, location.pathname]);

  // Navigate to a step and show the card once the page is ready
  const goToStep = useCallback(
    (index: number) => {
      if (busyRef.current) return;
      const targetStep = TOUR_STEPS[index];
      if (!targetStep) return;

      busyRef.current = true;
      isNavigatingRef.current = true;
      setPhase("transitioning");
      setStepIndex(index);

      // Navigate if route differs
      if (location.pathname !== targetStep.route) {
        navigate(targetStep.route);
      }

      // Wait for the route to settle (lazy chunks + React mount), then show card.
      // We poll for the data-page attribute which proves the page rendered.
      const selector = `[data-page="${targetStep.route.replace(/^\//, "")}"]`;
      const MAX_WAIT = 6000;
      let attempts = 0;
      let cancelled = false;

      const check = () => {
        if (cancelled) return;
        const el = document.querySelector(selector);
        if (el instanceof HTMLElement && el.offsetWidth > 0) {
          // Page is mounted and visible — show the card after a brief settle
          setTimeout(() => {
            if (cancelled) return;
            isNavigatingRef.current = false;
            busyRef.current = false;
            setPhase("active");
          }, 200);
          return;
        }
        attempts++;
        if (attempts * 50 > MAX_WAIT) {
          // Timeout — show card anyway (better than being stuck)
          isNavigatingRef.current = false;
          busyRef.current = false;
          setPhase("active");
          return;
        }
        setTimeout(check, 50);
      };
      // If same route, the element already exists
      if (location.pathname === targetStep.route) {
        setTimeout(() => {
          if (cancelled) return;
          isNavigatingRef.current = false;
          busyRef.current = false;
          setPhase("active");
        }, 200);
      } else {
        check();
      }
    },
    [location.pathname, navigate],
  );

  const handleStart = useCallback(() => {
    busyRef.current = false;
    goToStep(0);
  }, [goToStep]);

  const handleNext = useCallback(() => {
    if (busyRef.current) return;
    if (stepIndex < TOTAL_STEPS - 1) {
      goToStep(stepIndex + 1);
    } else {
      isNavigatingRef.current = false;
      busyRef.current = false;
      setPhase("complete");
      updateTour({ action: "completed" }).catch(() => {});
    }
  }, [stepIndex, goToStep, updateTour]);

  const handleBack = useCallback(() => {
    if (busyRef.current) return;
    if (stepIndex > 0) goToStep(stepIndex - 1);
  }, [stepIndex, goToStep]);

  const handleSkip = useCallback(() => {
    isNavigatingRef.current = false;
    busyRef.current = false;
    setPhase("idle");
    updateTour({ action: "skipped" }).catch(() => {});
  }, [updateTour]);

  const handleCompleteDone = useCallback(() => {
    setPhase("idle");
    if (location.pathname !== "/dashboard") navigate("/dashboard");
  }, [navigate, location.pathname]);

  // Public: start/restart from Settings
  const startTour = useCallback(() => {
    updateTour({ action: "reset" }).catch(() => {});
    hasAutoTriggered.current = true;
    isNavigatingRef.current = false;
    busyRef.current = false;
    setStepIndex(0);
    setPhase("welcome");
  }, [updateTour]);

  const resetTour = useCallback(() => startTour(), [startTour]);

  // If user manually navigates to a non-tour route, end the tour
  const tourRouteSet = useMemo(
    () => new Set(TOUR_STEPS.map((s) => s.route)),
    [],
  );
  useEffect(() => {
    if (phase !== "active" && phase !== "transitioning") return;
    if (isNavigatingRef.current) return;
    if (!tourRouteSet.has(location.pathname)) {
      isNavigatingRef.current = false;
      busyRef.current = false;
      setPhase("idle");
      updateTour({ action: "skipped" }).catch(() => {});
    }
  }, [location.pathname, phase, updateTour, tourRouteSet]);

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
          <TourStepCard
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
