"use client";

import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  PartyPopper,
  Compass,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { TourStep } from "./tourSteps";
import { TOTAL_STEPS } from "./tourSteps";

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const EASE = [0.22, 1, 0.36, 1] as [number, number, number, number];

// ── Helpers ─────────────────────────────────────────────────────────────

function measureElement(selector: string): DOMRect | null {
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement && el.offsetWidth > 0 && el.offsetHeight > 0) {
    return el.getBoundingClientRect();
  }
  return null;
}

/** Check if two rects are effectively the same (avoid unnecessary re-renders). */
function rectsEqual(a: DOMRect | null, b: DOMRect | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height &&
    a.bottom === b.bottom &&
    a.right === b.right
  );
}

/** Centered fallback rect used when the target element can't be found. */
function centeredFallback(): DOMRect {
  return new DOMRect(
    window.innerWidth / 2 - 120,
    window.innerHeight / 2 - 60,
    240,
    120,
  );
}

// ── TourOverlay ─────────────────────────────────────────────────────────

interface TourOverlayProps {
  step: TourStep;
  currentIndex: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function TourOverlay({
  step,
  currentIndex,
  onNext,
  onBack,
  onSkip,
}: TourOverlayProps) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);
  const aliveRef = useRef(true);
  const attemptsRef = useRef(0);

  // Re-measure the target, only setState if the rect actually changed
  const remeasure = useCallback(() => {
    if (!aliveRef.current) return;
    const r = measureElement(step.targetSelector);
    attemptsRef.current++;
    if (r) {
      setRect((prev) => (rectsEqual(prev, r) ? prev : r));
    } else if (attemptsRef.current > 120) {
      // After ~2 seconds of polling without finding the element,
      // use a centered fallback so the tooltip is at least visible
      setRect((prev) => (prev === null ? centeredFallback() : prev));
    }
    // Continue polling to track position changes
    rafRef.current = requestAnimationFrame(remeasure);
  }, [step.targetSelector]);

  useEffect(() => {
    aliveRef.current = true;
    attemptsRef.current = 0;
    setRect(null);

    // Initial measurement after a brief paint delay
    const t = setTimeout(remeasure, 60);

    // Re-measure on resize and scroll
    const onLayoutChange = () => {
      const r = measureElement(step.targetSelector);
      if (r) setRect((prev) => (rectsEqual(prev, r) ? prev : r));
    };

    window.addEventListener("resize", onLayoutChange, { passive: true });
    window.addEventListener("scroll", onLayoutChange, { passive: true, capture: true });

    return () => {
      aliveRef.current = false;
      clearTimeout(t);
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", onLayoutChange);
      window.removeEventListener("scroll", onLayoutChange, true);
    };
  }, [step.targetSelector, remeasure]);

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

  const isLast = currentIndex === TOTAL_STEPS - 1;
  const isFirst = currentIndex === 0;

  if (!rect) {
    // Target not yet found — show a centered loading spinner
    return createPortal(
      <div className="fixed inset-0 z-[10000] flex items-center justify-center">
        <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 backdrop-blur-sm">
          <div className="size-3 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
          <span className="text-xs font-medium text-amber-300">Loading…</span>
        </div>
      </div>,
      document.body,
    );
  }

  const pad = step.spotlightPadding ?? 8;

  // Decide tooltip position based on available space
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const tooltipPos = spaceBelow > 300 ? "bottom" : spaceAbove > 300 ? "top" : "bottom";

  const tooltipStyle: React.CSSProperties =
    tooltipPos === "bottom"
      ? { top: rect.bottom + pad + 16, left: rect.left + rect.width / 2 }
      : { bottom: window.innerHeight - rect.top + pad + 16, left: rect.left + rect.width / 2 };

  return createPortal(
    <div className="fixed inset-0 z-[10000]" style={{ pointerEvents: "none" }}>
      {/* Spotlight cutout via massive box-shadow */}
      <motion.div
        initial={REDUCED_MOTION ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: REDUCED_MOTION ? 0 : 0.3 }}
        className="absolute"
        style={{
          top: rect.top - pad,
          left: rect.left - pad,
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.78)",
          borderRadius: 16,
          pointerEvents: "none",
        }}
      >
        {/* Glow ring */}
        <div
          className="absolute inset-0 rounded-2xl ring-2 ring-amber-400/70"
          style={{
            boxShadow: "0 0 30px 4px rgba(251, 191, 36, 0.2), inset 0 0 30px 4px rgba(251, 191, 36, 0.05)",
            borderRadius: 16,
          }}
        />
      </motion.div>

      {/* Tooltip card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.step}
          initial={REDUCED_MOTION ? false : { opacity: 0, y: tooltipPos === "bottom" ? 8 : -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={REDUCED_MOTION ? undefined : { opacity: 0, y: tooltipPos === "bottom" ? 8 : -8, scale: 0.97 }}
          transition={{ duration: REDUCED_MOTION ? 0 : 0.25, ease: EASE }}
          className="absolute z-[10001] w-80"
          style={{
            ...tooltipStyle,
            transform: "translateX(-50%)",
            pointerEvents: "auto",
          }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-amber-400/20 bg-[#0e1117]/95 backdrop-blur-2xl shadow-[0_25px_80px_-20px_rgba(0,0,0,0.8),0_0_0_1px_rgba(251,191,36,0.1)]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

            <div className="p-5">
              {/* Step counter + progress dots */}
              <div className="mb-3 flex items-center justify-between">
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
              <div className="mb-4 h-0.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400/80 to-amber-300"
                  initial={false}
                  animate={{ width: `${((currentIndex + 1) / TOTAL_STEPS) * 100}%` }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                />
              </div>

              <h3 className="text-base font-bold text-foreground">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.description}</p>

              {/* Controls */}
              <div className="mt-5 flex items-center justify-between gap-2">
                <button
                  onClick={onSkip}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground/60 transition-colors hover:text-muted-foreground cursor-pointer"
                  style={{ pointerEvents: "auto" }}
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
                    style={{ pointerEvents: "auto" }}
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
                    style={{ pointerEvents: "auto" }}
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
      </AnimatePresence>
    </div>,
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
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(2px)",
        pointerEvents: "none",
      }}
    >
      <div className="flex items-center gap-2.5 rounded-full bg-black/80 px-5 py-2.5 backdrop-blur-sm">
        <div className="size-3 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
        <span className="text-xs font-medium text-amber-300">Navigating…</span>
      </div>
    </motion.div>,
    document.body,
  );
}

// ── TourWelcomeCard ─────────────────────────────────────────────────────

export function TourWelcomeCard({ onStart, onSkip }: { onStart: () => void; onSkip: () => void }) {
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
      style={{ backgroundColor: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(8px)" }}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-400/20 bg-[#0e1117]/95 backdrop-blur-2xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 size-60 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
        <div className="relative p-8 text-center">
          <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/5">
            <Compass className="size-7 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Let&apos;s take a look around</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            A quick tour of your study toolkit — 12 features, about a minute.
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
      </div>
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
      style={{ backgroundColor: "rgba(0, 0, 0, 0.7)", backdropFilter: "blur(8px)" }}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-amber-400/20 bg-[#0e1117]/95 backdrop-blur-2xl shadow-[0_40px_100px_-30px_rgba(0,0,0,0.9)]">
        <div className="absolute -top-20 left-1/2 -translate-x-1/2 size-60 rounded-full bg-amber-400/10 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
        <div className="relative p-8 text-center">
          <motion.div
            initial={REDUCED_MOTION ? false : { scale: 0, rotate: -30 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ delay: REDUCED_MOTION ? 0 : 0.2, duration: REDUCED_MOTION ? 0 : 0.5, type: "spring", stiffness: 200 }}
            className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10"
          >
            <PartyPopper className="size-7 text-amber-400" />
          </motion.div>
          <h2 className="text-xl font-bold text-foreground">You&apos;re all set!</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            You&apos;ve seen everything. Now start studying — your journey begins now.
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
      </div>
    </motion.div>,
    document.body,
  );
}
