import { api } from "@/convex/_generated/api";
import { STREAM_LABELS } from "@/convex/constants";
import { useConvex, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import {
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

import { useAuth } from "@/hooks/use-auth";
import logo from "@/assets/nexus-logo.svg";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BrainCircuit,
  Check,
  GraduationCap,
  Landmark,
  Loader2,
  Mail,
  Shield,
  Trophy,
  UserX,
  Zap,
} from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirectAfterAuth(
  returnTo: string | null,
  fallback = "/dashboard",
) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) {
    return returnTo;
  }
  return fallback;
}

const SHARED_SUBJECTS = "English \u00b7 Mathematics \u00b7 SAT";

const STREAM_OPTIONS = [
  {
    id: "natural",
    icon: Atom,
    subjects: "Physics \u00b7 Chemistry \u00b7 Biology",
  },
  {
    id: "social",
    icon: Landmark,
    subjects: "History \u00b7 Geography \u00b7 Economics",
  },
] as const;

/* ═══════════════════════════════════════════════════════════════════════
   CINEMATIC BACKGROUND LAYER
   ═══════════════════════════════════════════════════════════════════════ */

function CinematicBackground() {
  return (
    <div className="auth-bg pointer-events-none fixed inset-0 overflow-hidden">
      {/* Deep base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#060b1a] via-[#0a1128] to-[#0d0a1f]" />
      
      {/* Animated aurora nebula */}
      <div className="aurora-orb aurora-orb-1" />
      <div className="aurora-orb aurora-orb-2" />
      <div className="aurora-orb aurora-orb-3" />
      <div className="aurora-orb aurora-orb-4" />
      <div className="aurora-orb aurora-orb-5" />

      {/* Subtle grid overlay */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(120,160,255,0.5) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(120,160,255,0.5) 1px, transparent 1px)`,
          backgroundSize: '60px 60px'
        }}
      />

      {/* Vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(0,0,0,0.6)_100%)]" />

      {/* Noise grain */}
      <div className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          backgroundSize: '200px 200px'
        }}
      />

      {/* Floating particles */}
      <FloatingParticles />
    </div>
  );
}

function FloatingParticles() {
  const particles = useMemo(() => 
    Array.from({ length: 40 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      duration: Math.random() * 20 + 15,
      delay: Math.random() * 10,
      opacity: Math.random() * 0.5 + 0.1,
    })), []);

  return (
    <div className="absolute inset-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full bg-blue-400/30"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
          }}
          animate={{
            y: [0, -30, 10, -20, 0],
            x: [0, 15, -10, 5, 0],
            opacity: [p.opacity, p.opacity * 1.5, p.opacity * 0.8, p.opacity * 1.3, p.opacity],
          }}
          transition={{
            duration: p.duration,
            repeat: Infinity,
            delay: p.delay,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   LEFT SHOWCASE PANEL (desktop only)
   ═══════════════════════════════════════════════════════════════════════ */

function ShowcasePanel() {
  return (
    <div className="relative hidden flex-col items-center justify-center overflow-hidden p-12 lg:flex">
      {/* Radial glow behind content */}
      <div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-[100px]" />
      
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 max-w-md space-y-8"
      >
        {/* Logo + Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 animate-pulse rounded-xl bg-primary/20 blur-lg" />
              <img
                src={logo}
                alt="Nexus Academy"
                width={52}
                height={52}
                className="relative rounded-xl"
              />
            </div>
            <span className="type-display text-gradient">Nexus Academy</span>
          </div>
          <p className="text-lg leading-relaxed text-blue-200/60">
            Your AI-powered command center for academic excellence.
          </p>
        </motion.div>

        {/* Feature cards */}
        <div className="space-y-3">
          {[
            { icon: BrainCircuit, label: "AI Tutor", desc: "Personalized learning assistant" },
            { icon: Trophy, label: "Achievements", desc: "Track your academic journey" },
            { icon: GraduationCap, label: "Smart Study", desc: "Flashcards, quizzes, and notes" },
            { icon: Zap, label: "Focus Mode", desc: "Pomodoro sessions with analytics" },
          ].map((feature, i) => (
            <motion.div
              key={feature.label}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                delay: 0.4 + i * 0.12,
                duration: 0.5,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="group flex items-center gap-4 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 backdrop-blur-sm transition-all duration-300 hover:border-primary/20 hover:bg-white/[0.06]"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                <feature.icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white/90">{feature.label}</p>
                <p className="text-xs text-white/40">{feature.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Social proof */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.6 }}
          className="flex items-center gap-3 pt-2"
        >
          <div className="flex -space-x-2">
            {['bg-blue-500', 'bg-violet-500', 'bg-cyan-500', 'bg-emerald-500'].map((bg, i) => (
              <div
                key={i}
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0a1128] ${bg} text-[10px] font-bold text-white`}
              >
                {['A', 'M', 'S', 'K'][i]}
              </div>
            ))}
          </div>
          <p className="text-xs text-white/40">
            <span className="font-semibold text-white/60">2,400+</span> students already learning
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ANIMATED GRADIENT BORDER CARD
   ═══════════════════════════════════════════════════════════════════════ */

function AnimatedBorderCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* Animated gradient border */}
      <div className="auth-card-border absolute -inset-[1px] rounded-2xl" />
      
      {/* Card content */}
      <div className="relative z-10 overflow-hidden rounded-2xl bg-[#0c1425]/95 backdrop-blur-2xl">
        {/* Inner top-edge highlight */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-400/30 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-blue-500/[0.03] to-transparent" />
        
        {/* Grain */}
        <div className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            backgroundSize: '160px 160px'
          }}
        />
        
        <div className="relative z-10">{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   SHIMMER BUTTON
   ═══════════════════════════════════════════════════════════════════════ */

function ShimmerButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      className={
        `auth-shimmer-btn relative overflow-hidden bg-primary text-primary-foreground hover:bg-primary/90 ${props.className ?? ""}`
      }
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {children}
      </span>
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent"
        style={{ animation: 'shimmer-slide 3s ease-in-out infinite' }}
      />
    </Button>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   ONBOARDING
   ═══════════════════════════════════════════════════════════════════════ */

function Onboarding({
  onComplete,
}: {
  onComplete: (stream: "natural" | "social") => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<"natural" | "social" | null>(null);

  const handleSubmit = async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await onComplete(selected);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save your stream.");
      setSaving(false);
    }
  };

  return (
    <AnimatedBorderCard className="w-[min(92vw,460px)]">
      <div className="px-8 pb-8 pt-6">
        <CardHeader className="text-center">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 20 }}
            className="flex justify-center"
          >
            <img
              src={logo}
              alt="Nexus Academy logo"
              width={64}
              height={64}
              className="mb-4 mt-2 rounded-xl"
            />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            <CardTitle className="text-xl">Choose Your Path</CardTitle>
            <CardDescription className="mt-2">
              Your dashboard and AI tutor are organized around the subjects you
              actually sit. English, Mathematics and the SAT are part of every
              stream.
            </CardDescription>
          </motion.div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {STREAM_OPTIONS.map((option, i) => {
            const active = selected === option.id;
            return (
              <motion.button
                key={option.id}
                type="button"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 + i * 0.1, duration: 0.4 }}
                onClick={() => setSelected(option.id)}
                className={`group flex w-full cursor-pointer items-center gap-4 rounded-xl border p-4 text-left transition-all duration-300 ${
                  active
                    ? "border-primary/40 bg-primary/10 shadow-[0_0_30px_-8px_rgba(99,102,241,0.3)]"
                    : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.05]"
                }`}
              >
                <div
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-all duration-300 ${
                    active
                      ? "bg-primary/20 text-primary shadow-[0_0_20px_-4px_rgba(99,102,241,0.4)]"
                      : "bg-white/[0.04] text-white/40 group-hover:bg-white/[0.08] group-hover:text-white/60"
                  }`}
                >
                  <option.icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold tracking-tight text-white/90">
                    {STREAM_LABELS[option.id]}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-white/40">
                    {option.subjects}
                  </p>
                  <p className="mt-0.5 font-mono text-[9px] leading-4 text-white/25">
                    + {SHARED_SUBJECTS}{" "}
                    <span className="text-primary/50">(both streams)</span>
                  </p>
                </div>
                {active && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5" />
                    </div>
                  </motion.div>
                )}
              </motion.button>
            );
          })}
        </CardContent>
        <CardFooter className="flex-col gap-3 pt-2">
          <ShimmerButton
            type="button"
            className="w-full rounded-xl py-5 text-sm font-semibold"
            onClick={handleSubmit}
            disabled={!selected || saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Begin Your Journey <ArrowRight className="h-4 w-4" />
              </>
            )}
          </ShimmerButton>
        </CardFooter>
      </div>
    </AnimatedBorderCard>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   AUTH PAGE
   ═══════════════════════════════════════════════════════════════════════ */

function Auth({ redirectAfterAuth }: AuthProps = {}) {
  const { isLoading: authLoading, isAuthenticated, signIn } = useAuth();
  const profile = useQuery(api.profile.getProfile);
  const saveStream = useMutation(api.profile.updateProfile);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirectAfterAuth(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );
  const [step, setStep] = useState<
    "signIn" | { email: string; username: string | null } | "onboarding"
  >("signIn");
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      if (profile === undefined) return;
      if (!profile || !profile.stream) {
        setStep("onboarding");
        return;
      }
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, profile, navigate, redirect]);

  const convex = useConvex();

  const sendCodeForIdentifier = async (identifier: string) => {
    const resolved = await convex.query(api.profile.resolveLoginIdentifier, {
      identifier,
    });
    const formData = new FormData();
    formData.set("email", resolved.email);
    await signIn("email", formData);
    return resolved;
  };

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      const identifier = (formData.get("identifier") as string) ?? "";
      const resolved = await sendCodeForIdentifier(identifier);
      setStep({ email: resolved.email, username: resolved.username });
      setIsLoading(false);
    } catch (error) {
      console.error("Email sign-in error:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to send verification code. Please try again.",
      );
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (typeof step === "object" && step !== null && "email" in step) {
      setIsLoading(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.set("email", step.email);
        await signIn("email", formData);
        toast.success("A fresh code is on its way \u2014 check your inbox.");
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not resend the code. Try again in a minute.",
        );
      } finally {
        setIsLoading(false);
      }
    }
  };

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      // Set the code at submit time as well as through the hidden input.
      // This avoids submitting a stale hidden value if React has not
      // committed the final InputOTP keystroke yet.
      formData.set("code", otp.replace(/\D/g, "").slice(0, 6));
      await signIn("email", formData);
      setIsLoading(false);
    } catch (error) {
      console.error("OTP verification error:", error);
      const msg = error instanceof Error ? error.message : String(error);
      // Check for known Convex Auth error patterns first.
      if (/rate.?limit/i.test(msg) || /too many/i.test(msg)) {
        setError("Too many failed attempts — wait a minute, then request a fresh code.");
      } else if (/expir/i.test(msg)) {
        setError("This code has expired. Please request a new one.");
      } else if (/Could not verify|Invalid verification/i.test(msg)) {
        setError("The verification code you entered is incorrect.");
      } else {
        // Unknown / server-side error — show the real message.
        setError(msg || "Could not verify code. Please try again.");
      }
      setIsLoading(false);
      setOtp("");
    }
  };

  const handleGoogle = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await signIn("google", { redirectTo: redirect });
      if (result.redirect) {
        window.location.assign(result.redirect.toString());
      }
      setIsLoading(false);
    } catch (error) {
      console.error("Google sign-in error:", error);
      setError(
        "Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the Keys tab, or use email instead.",
      );
      setIsLoading(false);
    }
  };

  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Convex Auth actions can briefly lose their websocket while the
      // browser is reconnecting. Retry only that transient case; provider
      // and configuration errors should still surface immediately.
      let lastError: unknown;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await signIn("anonymous");
          return;
        } catch (error) {
          lastError = error;
          const message = error instanceof Error ? error.message : String(error);
          if (!/connection lost|network|websocket|timed out/i.test(message) || attempt === 1) {
            throw error;
          }
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      throw lastError;
    } catch (error) {
      console.error("Guest login error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      setError(
        /connection lost|network|websocket|timed out/i.test(message)
          ? "Convex could not complete guest sign-in. The backend needs its latest auth functions deployed. Please try again after the deployment finishes."
          : `Failed to sign in as guest: ${message}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleOnboardingComplete = async (stream: "natural" | "social") => {
    await saveStream({ stream });
    navigate(redirect);
  };

  /* ─── Stagger animation helpers ───────────────────────────────── */
  const containerVariants = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.07, delayChildren: 0.1 }
    }
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20, filter: "blur(4px)" },
    show: { 
      opacity: 1, y: 0, filter: "blur(0px)",
      transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#060b1a]">
      <CinematicBackground />

      {/* Back to site link */}
      <div className="absolute left-4 top-4 z-20 sm:left-6 sm:top-6">
        <motion.button
          type="button"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          onClick={() => navigate("/")}
          className="group flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-white/50 backdrop-blur-md transition-all duration-300 hover:border-primary/30 hover:bg-white/[0.08] hover:text-white/80"
        >
          <ArrowLeft className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-x-0.5" />
          Back to site
        </motion.button>
      </div>

      {/* Main content — split layout */}
      <div className="relative z-10 flex min-h-screen flex-1">
        {/* Left showcase (desktop) */}
        <ShowcasePanel />

        {/* Right auth form */}
        <div className="flex flex-1 items-center justify-center px-4 py-12">
          <AnimatePresence mode="wait">
            {step === "onboarding" ? (
              <motion.div
                key="onboarding"
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="flex w-full justify-center"
              >
                <Onboarding onComplete={handleOnboardingComplete} />
              </motion.div>
            ) : (
              <motion.div
                key={typeof step === "string" ? "signin" : "otp"}
                initial={{ opacity: 0, y: 30, filter: "blur(6px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -20, filter: "blur(4px)" }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                className="flex w-full justify-center"
              >
                <AnimatedBorderCard className="w-[min(92vw,420px)]">
                  <div className="px-8 pb-8 pt-6">
                    <AnimatePresence mode="wait">
                      {step === "signIn" ? (
                        <motion.div
                          key="signin-form"
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                          exit="hidden"
                        >
                          {/* Logo */}
                          <motion.div variants={itemVariants} className="flex justify-center lg:hidden">
                            <div className="relative mb-2 mt-2">
                              <div className="absolute inset-0 animate-pulse rounded-2xl bg-primary/25 blur-xl" />
                              <img
                                src={logo}
                                alt="Nexus Academy"
                                width={56}
                                height={56}
                                className="relative rounded-2xl"
                              />
                            </div>
                          </motion.div>

                          {/* Title */}
                          <motion.div variants={itemVariants} className="text-center">
                            <h1 className="text-2xl font-extrabold tracking-tight text-white">
                              Welcome to{" "}
                              <span className="text-gradient">Nexus</span>
                            </h1>
                            <p className="mt-2 text-sm text-white/40">
                              Sign in to access your learning dashboard
                            </p>
                          </motion.div>

                          {/* Google Button */}
                          <motion.div variants={itemVariants} className="mt-8">
                            <Button
                              type="button"
                              variant="outline"
                              className="group relative w-full overflow-hidden rounded-xl border-white/[0.08] bg-white/[0.04] py-5 text-sm font-medium text-white/70 transition-all duration-300 hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white"
                              onClick={handleGoogle}
                              disabled={isLoading}
                            >
                              <span className="relative z-10 flex items-center">
                                <svg className="mr-2.5 h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
                                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                                  <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" />
                                </svg>
                                Continue with Google
                              </span>
                              <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.03] to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                            </Button>
                          </motion.div>

                          {/* Divider */}
                          <motion.div variants={itemVariants} className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                              <div className="w-full border-t border-white/[0.06]" />
                            </div>
                            <div className="relative flex justify-center">
                              <span className="rounded-full bg-[#0c1425] px-3 text-[10px] uppercase tracking-widest text-white/25">
                                or continue with email
                              </span>
                            </div>
                          </motion.div>

                          {/* Email Form */}
                          <motion.form variants={itemVariants} onSubmit={handleEmailSubmit} className="space-y-4">
                            <div className="relative">
                              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
                              <Input
                                name="identifier"
                                placeholder="email or username"
                                type="text"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                className="h-12 rounded-xl border-white/[0.08] bg-white/[0.04] pl-10 text-sm text-white/90 placeholder:text-white/25 transition-all duration-300 focus:border-primary/40 focus:bg-white/[0.06] focus:ring-1 focus:ring-primary/20"
                                disabled={isLoading}
                                required
                              />
                            </div>
                            <ShimmerButton
                              type="submit"
                              className="w-full rounded-xl py-5 text-sm font-semibold"
                              disabled={isLoading}
                            >
                              {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  Send Verification Code <ArrowRight className="h-4 w-4" />
                                </>
                              )}
                            </ShimmerButton>
                          </motion.form>

                          {/* Error */}
                          <AnimatePresence>
                            {error && (
                              <motion.div
                                initial={{ opacity: 0, y: -5, height: 0 }}
                                animate={{ opacity: 1, y: 0, height: "auto" }}
                                exit={{ opacity: 0, y: -5, height: 0 }}
                                className="mt-3 overflow-hidden"
                              >
                                <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-400">
                                  {error}
                                </p>
                              </motion.div>
                            )}
                          </AnimatePresence>

                          {/* Helper text */}
                          <motion.p variants={itemVariants} className="mt-4 text-center text-[11px] leading-5 text-white/25">
                            No passwords to forget — we email you a one-time code.
                          </motion.p>

                          {/* Guest login */}
                          <motion.div variants={itemVariants} className="mt-4">
                            <Button
                              type="button"
                              variant="outline"
                              className="group w-full rounded-xl border-white/[0.06] bg-white/[0.02] py-5 text-sm text-white/40 transition-all duration-300 hover:border-white/[0.15] hover:bg-white/[0.05] hover:text-white/70"
                              onClick={handleGuestLogin}
                              disabled={isLoading}
                            >
                              <UserX className="mr-2 h-4 w-4 transition-transform duration-300 group-hover:scale-110" />
                              Continue as Guest
                            </Button>
                          </motion.div>
                        </motion.div>
                      ) : (
                        /* ─── OTP VERIFICATION STEP ────────────────────────── */
                        <motion.div
                          key="otp-form"
                          variants={containerVariants}
                          initial="hidden"
                          animate="show"
                          exit="hidden"
                        >
                          {/* Animated mail icon */}
                          <motion.div variants={itemVariants} className="flex justify-center">
                            <motion.div
                              animate={{ y: [0, -6, 0] }}
                              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                              className="relative mb-4 mt-2"
                            >
                              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                                <Mail className="h-7 w-7 text-primary" />
                              </div>
                              <div className="absolute -right-1 -top-1">
                                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
                                  <Check className="h-3 w-3" />
                                </div>
                              </div>
                            </motion.div>
                          </motion.div>

                          <motion.div variants={itemVariants} className="text-center">
                            <CardTitle className="text-xl text-white">Check your email</CardTitle>
                            <CardDescription className="mt-2 text-white/40">
                              We&apos;ve sent a verification code to
                            </CardDescription>
                            <p className="mt-1 text-sm font-medium text-primary">
                              {step.email}
                            </p>
                          </motion.div>

                          <motion.form variants={itemVariants} onSubmit={handleOtpSubmit} className="mt-8 space-y-6">
                            <input type="hidden" name="email" value={step.email} />
                            <input type="hidden" name="code" value={otp} />

                            <div className="flex justify-center gap-2">
                              <InputOTP
                                value={otp}
                                onChange={setOtp}
                                maxLength={6}
                                disabled={isLoading}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && otp.length === 6 && !isLoading) {
                                    const form = (e.target as HTMLElement).closest("form");
                                    if (form) form.requestSubmit();
                                  }
                                }}
                              >
                                <InputOTPGroup>
                                  {Array.from({ length: 6 }).map((_, index) => (
                                    <InputOTPSlot key={index} index={index} />
                                  ))}
                                </InputOTPGroup>
                              </InputOTP>
                            </div>

                            {/* Error */}
                            <AnimatePresence>
                              {error && (
                                <motion.div
                                  initial={{ opacity: 0, y: -5, height: 0 }}
                                  animate={{ opacity: 1, y: 0, height: "auto" }}
                                  exit={{ opacity: 0, y: -5, height: 0 }}
                                  className="overflow-hidden"
                                >
                                  <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-center text-xs text-red-400">
                                    {error}
                                  </p>
                                </motion.div>
                              )}
                            </AnimatePresence>

                            <ShimmerButton
                              type="submit"
                              className="w-full rounded-xl py-5 text-sm font-semibold"
                              disabled={isLoading || otp.length !== 6}
                            >
                              {isLoading ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                  Verifying...
                                </>
                              ) : (
                                <>
                                  Verify Code <ArrowRight className="ml-2 h-4 w-4" />
                                </>
                              )}
                            </ShimmerButton>
                          </motion.form>

                          <motion.div variants={itemVariants} className="mt-4 text-center text-sm text-white/30">
                            Didn&apos;t get it?{" "}
                            <button
                              type="button"
                              onClick={() => void handleResendCode()}
                              disabled={isLoading}
                              className="text-primary/70 underline-offset-4 transition-colors hover:text-primary disabled:opacity-50"
                            >
                              Resend code
                            </button>{" "}
                            or{" "}
                            <button
                              type="button"
                              onClick={() => { setStep("signIn"); setError(null); }}
                              disabled={isLoading}
                              className="text-white/50 underline-offset-4 transition-colors hover:text-white/70 disabled:opacity-50"
                            >
                              try again
                            </button>
                          </motion.div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Footer */}
                    <div className="mt-8 flex items-center justify-center gap-1.5 text-center text-[10px] text-white/20">
                      <Shield className="h-3 w-3" />
                      <span>Secured by </span>
                      <a
                        href="https://freebuff.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline-offset-2 transition-colors hover:text-white/40"
                      >
                        freebuff.com
                      </a>
                    </div>
                  </div>
                </AnimatedBorderCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export default function AuthPage(props: AuthProps) {
  return (
    <Suspense>
      <Auth {...props} />
    </Suspense>
  );
}
