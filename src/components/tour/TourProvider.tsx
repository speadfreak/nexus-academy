"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AnimatePresence } from "framer-motion";
import { TOUR_STEPS, TOTAL_STEPS } from "./tourSteps";
import { TourOverlay, TourWelcomeCard, TourCompleteCard } from "./TourOverlay";

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

export function TourProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const tourStatus = useQuery(api.tour.getTourStatus);
  const updateTour = useMutation(api.tour.updateTourStatus);

  const [phase, setPhase] = useState<TourPhase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const hasAutoTriggered = useRef(false);

  const currentStep = useMemo(() => TOUR_STEPS[stepIndex] ?? null, [stepIndex]);

  // Auto-trigger on first sign-in (hasCompletedTour === false and not skipped)
  useEffect(() => {
    if (hasAutoTriggered.current) return;
    if (tourStatus === undefined) return; // still loading
    if (!tourStatus.hasCompletedTour && tourStatus.tourSkippedAt === undefined) {
      hasAutoTriggered.current = true;
      setPhase("welcome");
    }
  }, [tourStatus]);

  const goToStep = useCallback(
    (index: number) => {
      const targetStep = TOUR_STEPS[index];
      if (!targetStep) return;

      setPhase("transitioning");
      setStepIndex(index);

      // Navigate if needed
      if (location.pathname !== targetStep.route) {
        navigate(targetStep.route);
      }

      // After a brief delay for the page to mount, show the spotlight
      const timer = setTimeout(() => {
        setPhase("active");
      }, 400);
      return () => clearTimeout(timer);
    },
    [location.pathname, navigate],
  );

  const handleStart = useCallback(() => {
    goToStep(0);
  }, [goToStep]);

  const handleNext = useCallback(() => {
    if (stepIndex < TOTAL_STEPS - 1) {
      goToStep(stepIndex + 1);
    } else {
      // Finished all steps
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
    setPhase("idle");
    updateTour({ action: "skipped" }).catch(() => {});
    navigate("/dashboard");
  }, [updateTour, navigate]);

  const handleCompleteDone = useCallback(() => {
    setPhase("idle");
    navigate("/dashboard");
  }, [navigate]);

  // Public method to start/restart the tour (from Settings)
  const startTour = useCallback(() => {
    updateTour({ action: "reset" }).catch(() => {});
    hasAutoTriggered.current = true;
    setStepIndex(0);
    setPhase("welcome");
  }, [updateTour]);

  const resetTour = useCallback(() => {
    updateTour({ action: "reset" }).catch(() => {});
    hasAutoTriggered.current = true;
    setStepIndex(0);
    setPhase("welcome");
  }, [updateTour]);

  // If user manually navigates away during the tour, end it
  useEffect(() => {
    if (phase !== "active" && phase !== "transitioning") return;
    const expectedRoute = currentStep?.route;
    if (!expectedRoute) return;
    // Give a grace period during transitions
    if (phase === "transitioning") return;
    // Check if user navigated to a route that's not part of the tour
    const tourRoutes = TOUR_STEPS.map((s) => s.route);
    if (!tourRoutes.includes(location.pathname)) {
      setPhase("idle");
      updateTour({ action: "skipped" }).catch(() => {});
    }
  }, [location.pathname, phase, currentStep, updateTour]);

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
        {phase === "active" && currentStep && (
          <TourOverlay
            step={currentStep}
            currentIndex={stepIndex}
            isTransitioning={false}
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
