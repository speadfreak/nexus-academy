// MOBILE 3.0 — keyboard-viewport coordination.
//
// ONE owner of the virtual-keyboard dimension for the whole app. Publishes:
//   • `--kb-h` (px) on <html> — consumed by bottom docks via
//     calc(... + var(--kb-h, 0px)) so the Tutor composer and the Vibe
//     Player rise above the keyboard together (coordinated layout
//     ownership, not two elements fighting for the viewport bottom).
//   • the `kb-open` class on <html> — lets components react (the Vibe
//     Player miniaturizes to its pill on phones while audio keeps playing).
//
// Platform reality this hook is built around:
//   • Android Chrome with `interactive-widget=resizes-content` (set in
//     index.html): the LAYOUT viewport shrinks when the keyboard opens, so
//     `window.innerHeight` drops together with visualViewport.height → the
//     difference stays ≈ 0 and the in-flow layout already handles itself.
//     Publishing 0 here avoids DOUBLE-compensating Android.
//   • iOS Safari: the keyboard OVERLAYS the layout viewport — innerHeight
//     stays constant while visualViewport.height shrinks → the difference
//     equals the keyboard height and is exactly what docks must consume.
//   • Desktop: no virtual keyboard → diff never crosses the threshold,
//     `--kb-h` stays 0px, class never toggles. Pixel-identical.
//
// The 120px threshold filters address-bar collapses and tiny viewport
// jitters (those are 60-110px), only real keyboards exceed it.

import { useEffect } from "react";

export const KB_OPEN_CLASS = "kb-open";

export function useKeyboardViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const root = document.documentElement;
    let raf = 0;

    const update = () => {
      raf = 0;
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
      const open = kb > 120;
      root.style.setProperty("--kb-h", open ? `${kb}px` : "0px");
      root.classList.toggle(KB_OPEN_CLASS, open);
      // iOS keeps the visual viewport scrolled after the keyboard opens and
      // never scrolls it back — pin the app to the top so fixed docks stay
      // aligned with the layout viewport.
      if (open && window.scrollY > 0) window.scrollTo(0, 0);
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    vv.addEventListener("resize", schedule);
    vv.addEventListener("scroll", schedule);
    update();

    return () => {
      vv.removeEventListener("resize", schedule);
      vv.removeEventListener("scroll", schedule);
      if (raf) cancelAnimationFrame(raf);
      root.style.setProperty("--kb-h", "0px");
      root.classList.remove(KB_OPEN_CLASS);
    };
  }, []);
}
