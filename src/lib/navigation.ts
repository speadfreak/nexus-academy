// ═══════════════════════════════════════════════════════════════════════
// navigation.ts — route-level performance utilities
//
// 1. ScrollManager — deterministic scroll restoration.
//    Library → Textbook → Back must land back at the Library position;
//    opening a NEW page must start at the top with no visible flash.
//    Positions are keyed by pathname in sessionStorage (survives refresh,
//    cleared per tab) and saved passively via a rAF-throttled listener.
//    Restoration happens in useLayoutEffect (before paint) and is retried
//    on the next frame so Suspense-resolved content settles correctly.
//
// 2. prefetchRoute — warms a route's JS chunk on pointer/focus intent.
//    Hovering a sidebar link downloads that page's chunk ~200-400ms
//    before the click lands, so SPA navigation renders instantly instead
//    of flashing the loading fallback. Deliberately limited to user
//    intent — we never preload every page's JS (performance budget).
// ═══════════════════════════════════════════════════════════════════════

import { useEffect } from "react";
import { useLocation } from "react-router";

const STORE_KEY = "learnyx.scrollpos.v1";
const MAX_ENTRIES = 40;

function readStore(): Record<string, number> {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeStore(map: Record<string, number>) {
  try {
    // Trim oldest entries beyond the cap to keep sessionStorage tiny.
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete map[k];
    }
    sessionStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    // sessionStorage unavailable (private mode) — restoration is best-effort.
  }
}

let activePath = typeof location !== "undefined" ? location.pathname : "/";
let pendingY = 0;
let rafPending = false;

function onScrollPassive() {
  pendingY = window.scrollY;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const map = readStore();
    map[activePath] = pendingY;
    writeStore(map);
  });
}

/**
 * Mount ONCE, inside the Router. Saves the page scroll position per
 * pathname (rAF-throttled, passive) and restores it — or resets to the
 * top for a fresh visit — before the destination page paints.
 */
export function ScrollManager() {
  const { pathname } = useLocation();

  // Save the outgoing page's final position on every path change and on
  // pagehide (covers browser-back away from the app tab).
  useEffect(() => {
    const save = () => {
      const map = readStore();
      map[activePath] = window.scrollY;
      writeStore(map);
    };
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
      save();
    };
  }, []);

  useEffect(() => {
    activePath = pathname;
    const saved = readStore()[pathname];

    if (saved && saved > 1) {
      // Restore before paint, then re-assert once the frame settles —
      // lazy content that resolved in the same commit can change height
      // after layout effects run.
      window.scrollTo({ top: saved, behavior: "instant" as ScrollBehavior });
      let retries = 0;
      const reassert = () => {
        retries += 1;
        if (Math.abs(window.scrollY - saved) > 1 && retries <= 3) {
          window.scrollTo({ top: saved, behavior: "instant" as ScrollBehavior });
          requestAnimationFrame(reassert);
        }
      };
      requestAnimationFrame(reassert);
    } else {
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    }

    // Start tracking the new path's scroll passively.
    window.addEventListener("scroll", onScrollPassive, { passive: true });
    return () => window.removeEventListener("scroll", onScrollPassive);
  }, [pathname]);

  return null;
}

// ─── Route chunk intent prefetch ────────────────────────────────────────
// One loader per top-level route. Keep in sync with the lazy() imports in
// main.tsx — importing the SAME module specifier lets the browser reuse
// the identical chunk, so prefetching is pure cache warm-up.
type Loader = () => Promise<unknown>;

const ROUTE_CHUNKS: Record<string, Loader> = {
  "/dashboard": () => import("../pages/Dashboard.tsx"),
  "/tutor": () => import("../pages/Tutor.tsx"),
  "/todos": () => import("../pages/Todos.tsx"),
  "/focus": () => import("../pages/Focus.tsx"),
  "/plans": () => import("../pages/Plans.tsx"),
  "/mock-exam": () => import("../pages/MockExam.tsx"),
  "/exam-prep": () => import("../pages/ExamPrep.tsx"),
  "/aptitude-hub": () => import("../pages/AptitudeHub.tsx"),
  "/journey": () => import("../pages/Journey.tsx"),
  "/calendar": () => import("../pages/Calendar.tsx"),
  "/notes": () => import("../pages/Notes.tsx"),
  "/mistakes": () => import("../pages/Mistakes.tsx"),
  "/flashcards": () => import("../pages/Flashcards.tsx"),
  "/study-cards": () => import("../pages/StudyCards.tsx"),
  "/achievements": () => import("../pages/Achievements.tsx"),
  "/groups": () => import("../pages/Groups.tsx"),
  "/settings": () => import("../pages/Settings.tsx"),
  "/notifications": () => import("../pages/Notifications.tsx"),
  "/upgrade": () => import("../pages/Upgrade.tsx"),
  "/admin": () => import("../pages/Admin.tsx"),
};

const prefetched = new Set<string>();

/** Warm a route's chunk. Safe to call repeatedly — deduped per session. */
export function prefetchRoute(path: string) {
  const loader = ROUTE_CHUNKS[path];
  if (!loader || prefetched.has(path)) return;
  prefetched.add(path);
  loader().catch(() => {
    // Prefetch is best-effort; the real navigation will retry properly.
    prefetched.delete(path);
  });
}
