// GuestLockOverlay — shown when a guest user tries to open a resource.
//
// DESIGN:
//   Guest users can browse the library and see all the resources, but
//   they can't OPEN any resource. When they click a resource, instead
//   of loading the PDF, they see this overlay:
//
//   ┌─────────────────────────────────────────┐
//   │              🔒                          │
//   │      This resource is locked            │
//   │                                         │
//   │   Sign in with your email to unlock     │
//   │   the full library + 14-day free trial  │
//   │                                         │
//   │   [________________@____________  ]     │
//   │   [  Unlock with email  ]               │
//   │                                         │
//   │   or [ Sign in with Google ]            │
//   │                                         │
//   │   ✓ Access all textbooks & past exams   │
//   │   ✓ 14-day free trial (no card needed)  │
//   │   ✓ AI tutor, mock exams, flashcards    │
//   └─────────────────────────────────────────┘
//
//   When the user submits their email, we redirect to /auth with the
//   email pre-filled. Convex Auth sends an OTP code, the user enters it,
//   and they're signed in with a real account — which triggers the
//   trial and unlocks all resources.
//
//   This is the simplest secure flow: we can't just "attach" an email
//   to an anonymous session without verification (that would be a
//   security hole — anyone could claim any email). The OTP code is the
//   verification step, but it's fast (6 digits, arrives in seconds).

import { motion } from "framer-motion";
import { Lock, Mail, CheckCircle2, ArrowRight, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GuestLockOverlay({
  resourceTitle,
}: {
  resourceTitle?: string;
}) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    // Redirect to /auth with the email pre-filled via URL param.
    // The Auth page picks up ?email=... and auto-starts the OTP flow.
    navigate(`/auth?email=${encodeURIComponent(trimmed)}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#080c14]/95 backdrop-blur-xl"
    >
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-1/4 top-1/4 size-96 rounded-full bg-amber-400/5 blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 size-96 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative w-full max-w-md px-6"
      >
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.02] p-8 shadow-[0_25px_80px_-20px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          {/* Lock icon */}
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-amber-400/10 blur-2xl" />
              <div className="relative flex size-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.06]">
                <Lock className="size-7 text-amber-300" />
              </div>
            </div>
          </div>

          {/* Title */}
          <div className="mt-6 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">
              // locked · guest mode
            </p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">
              {resourceTitle ? "This resource is locked" : "Resources are locked"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {resourceTitle
                ? `"${resourceTitle}" is available to signed-in students.`
                : "Sign in with your email to unlock the full library."}
            </p>
          </div>

          {/* Email form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="h-12 rounded-xl bg-white/5 pl-10 text-sm"
                disabled={submitting}
                autoFocus
              />
            </div>
            <Button
              type="submit"
              className="h-12 w-full cursor-pointer gap-2 rounded-xl text-sm font-semibold"
              disabled={submitting}
            >
              {submitting ? (
                "Redirecting…"
              ) : (
                <>
                  Unlock with email
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          {/* Benefits list */}
          <div className="mt-6 space-y-2 border-t border-white/[0.06] pt-4">
            {[
              "Access all textbooks, past exams & worksheets",
              "14-day free trial — no card needed",
              "AI tutor, mock exams, flashcards & more",
            ].map((benefit) => (
              <div key={benefit} className="flex items-start gap-2 text-xs text-muted-foreground">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                {benefit}
              </div>
            ))}
          </div>

          {/* Trust note */}
          <p className="mt-4 text-center text-[10px] text-muted-foreground/60">
            We'll send a 6-digit verification code to your email.
            <br />
            No password to remember — just enter the code and you're in.
          </p>
        </div>

        {/* Sparkle accent */}
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40">
          <Sparkles className="size-3" />
          Learnyx Academy ET 🇪🇹 · Ethiopian exam prep
        </div>
      </motion.div>
    </motion.div>
  );
}
