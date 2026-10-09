// AffiliateWelcomeStrip — small, dismissible, honest welcome strip on the
// landing page when the visitor arrived via a promoter link.
//
//   "[displayName] invited you to Learnyx"
//
// Reads the SAME stored visit the /:code redirect wrote (`lx_aff`) and the
// SAME public resolver query (one indexed lookup; never email/phone/ids).
// Dismissed state is per-code so a different promoter's link shows their
// own strip later. Renders NOTHING when there's no stored visit, the code
// no longer resolves, or the visitor dismissed it — the landing page's
// existing structure is untouched.

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { X, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { getStoredAffiliateVisit } from "@/pages/AffiliateRedirect";

const DISMISS_PREFIX = "lx_aff_welcome_dismissed_";

export default function AffiliateWelcomeStrip() {
  const [visit, setVisit] = useState<ReturnType<typeof getStoredAffiliateVisit>>(null);
  const [dismissed, setDismissed] = useState(true); // default hidden → no flash

  useEffect(() => {
    const v = getStoredAffiliateVisit();
    setVisit(v);
    if (!v) return;
    try {
      setDismissed(localStorage.getItem(DISMISS_PREFIX + v.code) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const resolution = useQuery(
    api.affiliates.resolveAffiliateCode,
    visit ? { code: visit.code } : "skip",
  );

  const show =
    visit &&
    !dismissed &&
    resolution !== undefined &&
    resolution.valid &&
    Boolean(resolution.displayName);

  if (!show) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_PREFIX + visit!.code, "1");
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.25 }}
        className="relative z-20 mx-auto mt-3 w-[min(94%,42rem)] overflow-hidden rounded-xl border border-amber-300/25 bg-gradient-to-r from-amber-400/[0.10] via-amber-300/[0.06] to-transparent px-4 py-2.5 shadow-[0_8px_28px_-18px_rgba(245,197,66,0.45)]"
        role="status"
      >
        <div className="flex items-center gap-2.5">
          <Sparkles className="size-4 shrink-0 text-amber-300" />
          <p className="min-w-0 flex-1 text-xs leading-5 text-foreground/90 sm:text-[13px]">
            <span className="font-semibold text-amber-200">
              {resolution!.displayName}
            </span>{" "}
            invited you to Learnyx
            {resolution!.welcomeMessage ? (
              <span className="text-muted-foreground"> — {resolution!.welcomeMessage}</span>
            ) : null}
          </p>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground/70 transition hover:bg-white/10 hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
