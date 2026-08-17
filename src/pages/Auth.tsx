import { api } from "@/convex/_generated/api";
import { STREAM_LABELS } from "@/convex/constants";
import { useMutation, useQuery } from "convex/react";
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
  ArrowRight,
  Atom,
  Check,
  Landmark,
  Loader2,
  Mail,
  UserX,
} from "lucide-react";
import { Suspense, useEffect, useState } from "react";
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

// There are exactly two streams a student can be on. English, Mathematics
// and the SAT are sat by EVERY candidate, so they're listed inside both
// streams below — never offered as a third "common" choice.
const SHARED_SUBJECTS = "English · Mathematics · SAT";

const STREAM_OPTIONS = [
  {
    id: "natural",
    icon: Atom,
    subjects: "Physics · Chemistry · Biology",
  },
  {
    id: "social",
    icon: Landmark,
    subjects: "History · Geography · Economics",
  },
] as const;

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
    <div className="glass-panel w-[min(92vw,440px)] rounded-2xl p-6">
      <CardHeader className="text-center">
        <div className="flex justify-center">
          <img
            src={logo}
            alt="Nexus Academy logo"
            width={64}
            height={64}
            className="mb-4 mt-4 rounded-lg"
          />
        </div>
        <CardTitle className="text-xl">Pick your stream</CardTitle>
        <CardDescription>
          Your dashboard and AI tutor are organized around the subjects you
          actually sit. English, Mathematics and the SAT are part of every
          stream. You can change this later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {STREAM_OPTIONS.map((option) => {
          const active = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setSelected(option.id)}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-colors ${
                active
                  ? "border-primary/50 bg-primary/10"
                  : "border-white/10 bg-white/4 hover:border-white/25"
              }`}
            >
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                  active ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground"
                }`}
              >
                <option.icon className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold tracking-tight">
                  {STREAM_LABELS[option.id]}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {option.subjects}
                </p>
                <p className="mt-0.5 font-mono text-[9px] leading-4 text-muted-foreground/70">
                  + {SHARED_SUBJECTS}{" "}
                  <span className="text-primary/70">(both streams)</span>
                </p>
              </div>
              {active && <Check className="size-4 shrink-0 text-primary" />}
            </button>
          );
        })}
      </CardContent>
      <CardFooter className="flex-col gap-2">
        <Button
          type="button"
          className="w-full rounded-xl"
          onClick={handleSubmit}
          disabled={!selected || saving}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <>
              Continue <ArrowRight className="size-4" />
            </>
          )}
        </Button>
      </CardFooter>
    </div>
  );
}

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
  const [step, setStep] = useState<"signIn" | { email: string } | "onboarding">(
    "signIn",
  );
  const [otp, setOtp] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Once authenticated and the profile has loaded: onboard new users (no
  // stream yet), otherwise go to the intended destination.
  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      if (profile === undefined) return; // profile still loading
      if (!profile || !profile.stream) {
        setStep("onboarding");
        return;
      }
      navigate(redirect);
    }
  }, [authLoading, isAuthenticated, profile, navigate, redirect]);

  const handleEmailSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      setStep({ email: formData.get("email") as string });
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

  const handleOtpSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const formData = new FormData(event.currentTarget);
      await signIn("email-otp", formData);
      // Navigation happens in the effect once the profile has loaded.
      setIsLoading(false);
    } catch (error) {
      console.error("OTP verification error:", error);
      setError("The verification code you entered is incorrect.");
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
      // If no redirect was returned (unexpected), the effect takes over.
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
      await signIn("anonymous");
      // Navigation happens in the effect once the profile has loaded.
    } catch (error) {
      console.error("Guest login error:", error);
      setError(`Failed to sign in as guest: ${error instanceof Error ? error.message : "Unknown error"}`);
      setIsLoading(false);
    }
  };

  const handleOnboardingComplete = async (stream: "natural" | "social") => {
    await saveStream({ stream });
    navigate(redirect);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="flex h-full flex-col items-center justify-center">
          {step === "onboarding" ? (
            <Onboarding onComplete={handleOnboardingComplete} />
          ) : (
            <div className="glass-panel w-[min(92vw,380px)] rounded-2xl pb-0">
              {step === "signIn" ? (
                <>
                  <CardHeader className="text-center">
                    <div className="flex justify-center">
                      <img
                        src={logo}
                        alt="Lock Icon"
                        width={64}
                        height={64}
                        className="mb-4 mt-4 cursor-pointer rounded-lg"
                        onClick={() => navigate("/")}
                      />
                    </div>
                    <CardTitle className="text-xl">Get Started</CardTitle>
                    <CardDescription>
                      Enter your email to log in or sign up
                    </CardDescription>
                  </CardHeader>

                  {/* Google */}
                  <CardContent>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full rounded-xl bg-white/5"
                      onClick={handleGoogle}
                      disabled={isLoading}
                    >
                      <svg className="mr-2 size-4" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z"
                        />
                      </svg>
                      Continue with Google
                    </Button>

                    <div className="my-4">
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">
                            Or
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardContent>

                  <form onSubmit={handleEmailSubmit}>
                    <CardContent className="pt-0">
                      <div className="relative flex items-center gap-2">
                        <div className="relative flex-1">
                          <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                          <Input
                            name="email"
                            placeholder="name@example.com"
                            type="email"
                            className="pl-9"
                            disabled={isLoading}
                            required
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="outline"
                          size="icon"
                          disabled={isLoading}
                        >
                          {isLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ArrowRight className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

                      <div className="mt-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={handleGuestLogin}
                          disabled={isLoading}
                        >
                          <UserX className="mr-2 h-4 w-4" />
                          Continue as Guest
                        </Button>
                      </div>
                    </CardContent>
                  </form>
                </>
              ) : (
                <>
                  <CardHeader className="mt-4 text-center">
                    <CardTitle>Check your email</CardTitle>
                    <CardDescription>
                      We&apos;ve sent a code to {step.email}
                    </CardDescription>
                  </CardHeader>
                  <form onSubmit={handleOtpSubmit}>
                    <CardContent className="pb-4">
                      <input type="hidden" name="email" value={step.email} />
                      <input type="hidden" name="code" value={otp} />

                      <div className="flex justify-center">
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
                      {error && (
                        <p className="mt-2 text-center text-sm text-red-500">
                          {error}
                        </p>
                      )}
                      <p className="mt-4 text-center text-sm text-muted-foreground">
                        Didn&apos;t receive a code?{" "}
                        <Button
                          variant="link"
                          className="h-auto p-0"
                          onClick={() => setStep("signIn")}
                        >
                          Try again
                        </Button>
                      </p>
                    </CardContent>
                    <CardFooter className="flex-col gap-2">
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={isLoading || otp.length !== 6}
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Verifying...
                          </>
                        ) : (
                          <>
                            Verify code
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStep("signIn")}
                        disabled={isLoading}
                        className="w-full"
                      >
                        Use different email
                      </Button>
                    </CardFooter>
                  </form>
                </>
              )}

              <div className="rounded-b-2xl border-t border-white/10 bg-white/[0.03] px-6 py-4 text-center text-xs text-muted-foreground">
                Secured by{" "}
                <a
                  href="https://freebuff.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline transition-colors hover:text-primary"
                >
                  freebuff.com
                </a>
              </div>
            </div>
          )}
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
