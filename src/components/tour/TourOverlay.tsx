"use client";

import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PartyPopper,
  Compass,
} from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import type { TourStep } from "./tourSteps";
import { TOTAL_STEPS } from "./tourSteps";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

// ── TourStepCard ───────────────────────────────────────────────────────
// Centered card shown over a dim overlay. The actual page is visible
// behind the overlay so the user can see what feature they're on.

interface TourStepCardProps {
  step: TourStep;
  currentIndex: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TourStepCard({
  step,
  currentIndex,
  onNext,
  onBack,
  onSkip,
}: TourStepCardProps) {
  const isLast = currentIndex === TOTAL_STEPS - 1;
  const isFirst = currentIndex === 0;

  // Keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      else if (e.key === "ArrowRight" || e.key === "Enter") onNext();
      else if (e.key === "ArrowLeft") onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onBack, onSkip]);

  return createPortal(
    <motion.div
      initial={REDUCED_MOTION ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={REDUCED_MOTION ? undefined : { opacity: 0 }}
      transition={{ duration: REDUCED_MOTION ? 0 : 0.25 }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.55)",
        backdropFilter: "blur(4px)",
      }}
    >
      <motion.div
        key={step.step}
        initial={REDUCED_MOTION ? false : { opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: REDUCED_MOTION ? 0 : 0.35, ease: EASE }}
        className="relative w-full max-w-sm"
      >
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0e1117]/95 backdrop-blur-2xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
          {/* Top glow line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
          {/* Background glow */}
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 size-48 rounded-full bg-amber-400/8 blur-3xl" />

          <div className="relative p-7">
            {/* Emoji icon */}
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl">
                {step.icon}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold text-foreground leading-tight">
                  {step.title}
                </h3>
              </div>
            </div>

            {/* Description */}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {step.description}
            </p>

            {/* Step counter + progress dots */}
            <div className="mt-5 flex items-center justify-between">
              <span className="font-mono text-[10px] font-bold tracking-[0.15em] text-amber-400/70 uppercase">
                Step {currentIndex + 1} of {TOTAL_STEPS}
              </span>
              <div className="flex gap-1">
                {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1 rounded-full transition-all duration-300",
                      i <= currentIndex
                        ? "w-3 bg-amber-400"
                        : i === currentIndex + 1
                          ? "w-1.5 bg-amber-400/30"
                          : "w-1 bg-white/10",
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-amber-400/80 to-amber-300"
                initial={false}
                animate={{
                  width: `${((currentIndex + 1) / TOTAL_STEPS) * 100}%`,
                }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>

            {/* Controls */}
            <div className="mt-5 flex items-center justify-between gap-2">
              <button
                onClick={onSkip}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground cursor-pointer"
              >
                Skip tour
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onBack}
                  disabled={isFirst}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-lg border transition-all cursor-pointer",
                    isFirst
                      ? "border-white/[0.04] text-white/10 cursor-default"
                      : "border-white/10 text-muted-foreground hover:border-amber-400/30 hover:text-amber-300 hover:bg-amber-400/5",
                  )}
                  aria-label="Previous step"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  onClick={onNext}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all cursor-pointer",
                    isLast
                      ? "bg-amber-400/15 text-amber-300 border border-amber-400/25 hover:bg-amber-400/25"
                      : "bg-amber-400 text-black hover:bg-amber-300",
                  )}
                  aria-label={isLast ? "Finish tour" : "Next step"}
                >
                  {isLast ? "Finish" : "Next"}
                  {!isLast && <ChevronRight className="size-3.5" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ── TourTransitionOverlay ──────────────────────────────────────────────

export function TourTransitionOverlay() {
  return createPortal(
    <motion.div
      initial={REDUCED_MOTION ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={REDUCED_MOTION ? undefined : { opacity: 0 }}
      transition={{ duration: REDUCED_MOTION ? 0 : 0.15 }}
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.35)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div className="flex items-center gap-2.5 rounded-full bg-black/80 px-5 py-2.5 backdrop-blur-sm">
        <div className="size-3 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
        <span className="text-xs font-medium text-amber-300">
          Navigating…
        </span>
      </div>
    </motion.div>,
    document.body,
  );
}

// ── TourWelcomeCard ─────────────────────────────────────────────────────

export function TourWelcomeCard({
  onStart,
  onSkip,
}: {
  onStart: () => void;
  onSkip: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      if (e.key === "Enter") onStart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart, onSkip]);

  return createPortal(
    <motion.div
      initial={REDUCED_MOTION ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={REDUCED_MOTION ? undefined : { opacity: 0, scale: 0.95 }}
      transition={{ duration: REDUCED_MOTION ? 0 : 0.4, ease: EASE }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
      }}
    >
      <motion.div
        initial={REDUCED_MOTION ? false : { opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: REDUCED_MOTION ? 0 : 0.5, ease: EASE, delay: REDUCED_MOTION ? 0 : 0.1 }}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#0e1117]/95 backdrop-blur-2xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 size-60 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

        <div className="relative p-8 text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/5">
            <Compass className="size-7 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-foreground">
            Let&apos;s take a look around
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A quick tour of your study toolkit — 12 features, about a
            minute.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              onClick={onSkip}
              className="rounded-xl px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground cursor-pointer"
            >
              Skip
            </button>
            <button
              onClick={onStart}
              className="flex items-center gap-2 rounded-xl bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition-all hover:bg-amber-300 active:scale-95 cursor-pointer"
            >
              <Sparkles className="size-4" />
              Start tour
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// ── TourCompleteCard ────────────────────────────────────────────────────

export function TourCompleteCard({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") onDone();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDone]);

  return createPortal(
    <motion.div
      initial={REDUCED_MOTION ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={REDUCED_MOTION ? undefined : { opacity: 0 }}
      transition={{ duration: REDUCED_MOTION ? 0 : 0.4 }}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-6"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
      }}
    >
      <motion.div
        initial={REDUCED_MOTION ? false : { opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: REDUCED_MOTION ? 0 : 0.5, ease: EASE, delay: REDUCED_MOTION ? 0 : 0.1 }}
        className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#0e1117]/95 backdrop-blur-2xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]"
      >
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 size-60 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

        <div className="relative p-8 text-center">
          <motion.div
            initial={REDUCED_MOTION ? false : { scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              delay: REDUCED_MOTION ? 0 : 0.2,
              duration: REDUCED_MOTION ? 0 : 0.5,
              type: "spring",
              stiffness: 200,
            }}
            className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10"
          >
            <PartyPopper className="size-7 text-amber-400" />
          </motion.div>
          <h2 className="text-xl font-bold text-foreground">
            You&apos;re all set!
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            You&apos;ve seen everything. Now start studying — your
            journey begins now.
          </p>
          <button
            onClick={onDone}
            className="mt-6 w-full rounded-xl bg-amber-400 px-6 py-3 text-sm font-bold text-black transition-all hover:bg-amber-300 active:scale-[0.97] cursor-pointer"
          >
            Start studying
          </button>
          <p className="mt-3 text-[11px] text-muted-foreground/40">
            Replay this tour anytime from Settings
          </p>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
