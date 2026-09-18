// UpdatePrompt — keeps long-lived tabs honest about deployments.
//
// Render deploys are atomic, but a tab that stays open for hours (the
// admin console, an exam-prep hub) keeps running the bundle it booted
// with — which is how "the Exam Engine tab doesn't exist" happens even
// though production shipped it hours ago. This component polls the
// site's index.html etag every few minutes; when it changes, a quiet
// toast offers a refresh. It NEVER auto-reloads — a refresh must never
// interrupt someone mid-exam.

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const POLL_MS = 4 * 60 * 1000;

export function UpdatePrompt() {
  // The etag of the index.html this bundle was served with.
  const etagRef = useRef<string | null>(null);
  const armedRef = useRef(false);

  useEffect(() => {
    let stopped = false;

    async function check() {
      try {
        const res = await fetch("/", { method: "GET", cache: "no-store" });
        const etag = res.headers.get("etag");
        if (!etag) return;
        if (etagRef.current === null) {
          etagRef.current = etag; // first read — baseline
          return;
        }
        if (etag !== etagRef.current && !stopped) {
          armedRef.current = true;
          toast("Learnyx was updated in the background.", {
            description: "Refresh to load the latest version.",
            duration: Infinity,
            id: "app-update-available",
            action: {
              label: "Refresh",
              onClick: () => window.location.reload(),
            },
          });
        }
      } catch {
        // Offline / network blip — try again on the next poll.
      }
    }

    void check();
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  return null;
}
