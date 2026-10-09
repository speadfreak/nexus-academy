// AffiliateRedirect — handles /:code (registered as the LAST top-level
// route, right before the NotFound catch-all).
//
// BEHAVIOR CONTRACT (promoter bio links must never look broken):
//   • Valid code + program enabled → store {code, campaign, ts} in
//     localStorage (`lx_aff`), fire ONE throttled visit ping (at most
//     once per browser per day per code — localStorage guard, and the
//     backend itself is a daily-aggregate increment, never a per-click
//     row), then redirect to `/` cleanly.
//   • Unknown code OR program disabled → silent redirect to `/`. No
//     error page, no hint the program exists, no attribution, no
//     commission accrual.
//   • Anything that isn't a plausible code (not 3–20 chars of A–Z0–9
//     after uppercasing) → falls through to the normal NotFound page,
//     exactly like a random typo'd path.
//   • Optional `?c=<campaign>` is captured as the campaign label
//     (e.g. /MELODY?c=video3).

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { normalizeCodeParam } from "@/lib/affiliateCodes";
import NotFound from "@/pages/NotFound";

const LX_AFF_KEY = "lx_aff";
const PING_GUARD_PREFIX = "lx_aff_ping_";

/** Shape of the stored attribution candidate in localStorage. */
export interface StoredAffiliateVisit {
  code: string;
  campaign: string;
  ts: number;
}

/** Read the stored affiliate visit (exported for the landing strip). */
export function getStoredAffiliateVisit(): StoredAffiliateVisit | null {
  try {
    const raw = localStorage.getItem(LX_AFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAffiliateVisit;
    if (!parsed?.code || typeof parsed.ts !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Clear the stored visit (used after successful attribution). */
export function clearStoredAffiliateVisit() {
  try {
    localStorage.removeItem(LX_AFF_KEY);
  } catch {
    // ignore
  }
}

export default function AffiliateRedirect() {
  const { code: rawCode } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const doneRef = useRef(false);
  const [isPlausible] = useState(() => normalizeCodeParam(rawCode) !== null);

  const code = normalizeCodeParam(rawCode) ?? "";
  const campaign = (searchParams.get("c") ?? "").trim().slice(0, 40);

  // One single query — resolves only { valid, displayName, welcomeMessage }.
  const resolution = useQuery(
    api.affiliates.resolveAffiliateCode,
    isPlausible ? { code } : "skip",
  );
  const recordVisit = useMutation(api.affiliates.recordAffiliateVisit);

  useEffect(() => {
    if (doneRef.current) return;
    if (!isPlausible) return; // render NotFound — random path, not a code
    if (resolution === undefined) return; // still resolving
    doneRef.current = true;

    if (resolution?.valid) {
      try {
        localStorage.setItem(
          LX_AFF_KEY,
          JSON.stringify({ code, campaign, ts: Date.now() } satisfies StoredAffiliateVisit),
        );
      } catch {
        // localStorage unavailable (private mode) — attribution just won't
        // survive the signup flow; never break the redirect.
      }
      // Throttled visit ping: at most once per browser per day per code.
      const today = new Date().toISOString().slice(0, 10);
      const guardKey = `${PING_GUARD_PREFIX}${code}_${today}`;
      let alreadyPinged = false;
      try {
        if (localStorage.getItem(guardKey) === "1") {
          alreadyPinged = true;
        }
      } catch {
        // ignore
      }
      if (!alreadyPinged) {
        try {
          localStorage.setItem(guardKey, "1");
        } catch {
          // ignore
        }
        recordVisit({ code, campaign: campaign || undefined }).catch(() => {
          // Non-fatal — a lost visit ping must never break the redirect.
        });
      }
    }
    // Valid or not — land on the home page silently. Unknown codes and
    // paused programs look exactly like a normal visit to the landing page.
    navigate("/", { replace: true });
  }, [resolution, isPlausible, code, campaign, navigate, recordVisit]);

  // Random non-code paths (too long, symbols, etc.) → the normal NotFound.
  if (!isPlausible) return <NotFound />;

  // Plausible code while resolving → a quiet blank beat (max one query
  // round-trip), then the redirect fires. Never an error screen.
  return <div className="min-h-dvh bg-background" aria-hidden="true" />;
}
