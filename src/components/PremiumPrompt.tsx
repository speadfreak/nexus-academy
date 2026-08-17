// PremiumPrompt — the single contextual upgrade surface.
//
// Shown ONLY at the moment a free-tier user touches a genuinely premium
// value (tutor cap reached, weekly quiz used, premium content clicked, plan
// generation). Always dismissible, always honest: no countdowns, no fake
// scarcity, no streak-loss threats. Every open surfaces a real action the
// student just took.

import { PREMIUM_PROMPT_COPY, type GateReason } from "@/lib/premium";
import { Lock, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PremiumPromptProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason: GateReason;
  /** Optional subject name to make the copy feel specific, not generic. */
  subjectName?: string;
}

export function PremiumPrompt({
  open,
  onOpenChange,
  reason,
  subjectName,
}: PremiumPromptProps) {
  const copy = PREMIUM_PROMPT_COPY[reason] ?? PREMIUM_PROMPT_COPY.trial_expired;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-panel w-[min(94vw,460px)] rounded-2xl">
        <DialogHeader>
          <div className="flex size-10 items-center justify-center rounded-xl bg-premium/10 text-premium">
            <Lock className="size-5" />
          </div>
          <DialogTitle className="mt-3 flex items-center gap-2 text-lg">
            {copy.title}
            {subjectName && (
              <span className="font-mono text-[10px] font-medium text-premium">
                · {subjectName}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-sm leading-6">
            {copy.body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1 rounded-xl bg-white/5"
            onClick={() => onOpenChange(false)}
          >
            Maybe later
          </Button>
          <Button asChild className="flex-1 rounded-xl">
            <Link to="/upgrade" onClick={() => onOpenChange(false)}>
              <Sparkles className="size-4" /> {copy.cta}
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
