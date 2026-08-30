import { useEffect } from "react";
import Lenis from "@studio-freight/lenis";

/**
 * Initializes Lenis smooth scrolling for the entire app.
 * The instance is created on mount and destroyed on unmount.
 *
 * WHEEL-SCROLL EXCLUSION: Lenis has a built-in `data-lenis-prevent-wheel`
 * attribute that stops it from hijacking wheel events inside nested
 * scrollable containers (chat threads, PDF viewers, AI panels, etc.).
 * We ALSO add a `prevent` callback as defense-in-depth — if a future
 * developer forgets the attribute, the callback catches any element
 * with `overflow-y-auto` or `overflow-auto` and lets the browser handle
 * it natively. This stops the recurring class-of-bug where new scroll
 * containers don't get the attribute.
 */
export function useLenis() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      touchMultiplier: 2,
      infinite: false,
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);
}
