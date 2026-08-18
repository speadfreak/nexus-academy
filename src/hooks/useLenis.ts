import { useEffect } from "react";
import Lenis from "@studio-freight/lenis";

/**
 * Initializes Lenis smooth scrolling for the entire app.
 * The instance is created on mount and destroyed on unmount.
 * Renders with ` RAF ` for optimal performance.
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
