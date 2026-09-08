// AuthRequiredPrompt — a reusable, polished prompt shown when an
// anonymous (guest) user attempts a gated action. Styled consistently
// with the existing GuestLockOverlay + PremiumPrompt patterns.
//
// Usage:
//   {isAnonymous && (
//     <AuthRequiredPrompt
//       title="Mock exams need a real account"
//       description="Create a free account to generate full mock exams — sign in with email or Google, no cost, starts your free trial instantly."
//       returnTo="/mock-exam"
//     />
//   )}
//
// The prompt preserves the intended destination via `returnTo` so
// after completing sign-in, the user lands back on what they tried to do.

import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Lock,
  Mail,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AuthRequiredPrompt({
  title,
  description,
  returnTo,
}: {
  title: string;
  description: string;
  returnTo?: string;
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
    const params = new URLSearchParams({ email: trimmed });
    if (returnTo) params.set("returnTo", returnTo);
    navigate(`/auth?${params.toString()}`);
  };

  const handleGoogle = () => {
    const params = new URLSearchParams();
    if (returnTo) params.set("returnTo", returnTo);
    navigate(`/auth?${params.toString()}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#080c14]/95 backdrop-blur-xl"
    >
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
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-amber-400/10 blur-2xl" />
              <div className="relative flex size-16 items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.06]">
                <Lock className="size-7 text-amber-300" />
              </div>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-amber-300">
              // create a free account
            </p>
            <h2 className="mt-2 text-xl font-extrabold tracking-tight">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          </div>

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
                  Create free account
                  <ArrowRight className="size-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-3 text-center">
            <button
              onClick={handleGoogle}
              disabled={submitting}
              className="cursor-pointer text-xs font-semibold text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
            >
              or sign in with Google
            </button>
          </div>

          <div className="mt-6 space-y-2 border-t border-white/[0.06] pt-4">
            {[
              "No cost — starts your free trial instantly",
              "Access all textbooks, past exams & worksheets",
              "AI tutor, mock exams, flashcards & more",
            ].map((benefit) => (
              <div
                key={benefit}
                className="flex items-start gap-2 text-xs text-muted-foreground"
              >
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-300" />
                {benefit}
              </div>
            ))}
          </div>

          <p className="mt-4 text-center text-[10px] text-muted-foreground/60">
            We'll send a 6-digit verification code to your email.
            <br />
            No password — just enter the code and you're in.
          </p>
        </div>

        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/40">
          <Sparkles className="size-3" />
          Learnyx Academy ET 🇪🇹 · Ethiopian exam prep
        </div>
      </motion.div>
    </motion.div>
  );
}
