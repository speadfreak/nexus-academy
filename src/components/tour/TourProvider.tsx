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
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isNavigatingRef = useRef(false);

  const currentStep = useMemo(
    () => TOUR_STEPS[stepIndex] ?? null,
    [stepIndex],
  );

  // Clear any pending transition timer
  const clearTransitionTimer = useCallback(() => {
    if (transitionTimerRef.current !== undefined) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = undefined;
    }
  }, []);

  // Auto-trigger on first sign-in (hasCompletedTour === false and not skipped)
  useEffect(() => {
    if (hasAutoTriggered.current) return;
    if (tourStatus === undefined) return; // still loading
    if (!tourStatus.hasCompletedTour && tourStatus.tourSkippedAt === undefined) {
      hasAutoTriggered.current = true;
      setPhase("welcome");
    }
  }, [tourStatus]);

  // Navigate to a specific step, handling route changes properly
  const goToStep = useCallback(
    (index: number) => {
      const targetStep = TOUR_STEPS[index];
      if (!targetStep) return;

      clearTransitionTimer();
      isNavigatingRef.current = true;
      setPhase("transitioning");
      setStepIndex(index);

      // Navigate if needed
      if (location.pathname !== targetStep.route) {
        navigate(targetStep.route);
      }

      // After the page mounts, show the spotlight
      transitionTimerRef.current = setTimeout(() => {
        isNavigatingRef.current = false;
        setPhase("active");
        transitionTimerRef.current = undefined;
      }, 500);
    },
    [location.pathname, navigate, clearTransitionTimer],
  );

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearTransitionTimer();
  }, [clearTransitionTimer]);

  const handleStart = useCallback(() => {
    goToStep(0);
  }, [goToStep]);

  const handleNext = useCallback(() => {
    if (stepIndex < TOTAL_STEPS - 1) {
      goToStep(stepIndex + 1);
    } else {
      // Last step completed
      setPhase("complete");
      updateTour({ action: "completed" }).catch(() => {});
    }
  }, [stepIndex, goToStep, updateTour]);

  const handleBack = useCallback(() => {
    if (stepIndex > 0) {
      goToStep(stepIndex - 1);
    }
  }, [stepIndex, goToStep]);

  const handleSkip = useCallback(() => {
    clearTransitionTimer();
    isNavigatingRef.current = false;
    setPhase("idle");
    updateTour({ action: "skipped" }).catch(() => {});
  }, [updateTour, clearTransitionTimer]);

  const handleCompleteDone = useCallback(() => {
    setPhase("idle");
    // Navigate to dashboard if not already there
    if (location.pathname !== "/dashboard") {
      navigate("/dashboard");
    }
  }, [navigate, location.pathname]);

  // Public method to start/restart the tour (from Settings)
  const startTour = useCallback(() => {
    clearTransitionTimer();
    updateTour({ action: "reset" }).catch(() => {});
    hasAutoTriggered.current = true;
    isNavigatingRef.current = false;
    setStepIndex(0);
    setPhase("welcome");
  }, [updateTour, clearTransitionTimer]);

  const resetTour = useCallback(() => {
    startTour();
  }, [startTour]);

  // If user manually navigates away during an active tour (not programmatic), end it
  useEffect(() => {
    if (phase !== "active" && phase !== "transitioning") return;
    if (isNavigatingRef.current) return; // We caused this navigation

    const expectedRoute = currentStep?.route;
    if (!expectedRoute) return;

    // Check if user navigated to a route that's not part of the tour
    const tourRoutes = new Set(TOUR_STEPS.map((s) => s.route));
    if (!tourRoutes.has(location.pathname)) {
      clearTransitionTimer();
      setPhase("idle");
      updateTour({ action: "skipped" }).catch(() => {});
    }
  }, [location.pathname, phase, currentStep, updateTour, clearTransitionTimer]);

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
