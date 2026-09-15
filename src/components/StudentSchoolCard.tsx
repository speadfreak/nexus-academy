// StudentSchoolCard — the student-facing school experience on the Dashboard.
//
// FEATURE-GATED: renders null (fully absent from the DOM — not just hidden)
// unless SCHOOL_FEATURE_ENABLED is explicitly "true" in the admin Keys tab.
// When the admin flips the switch off, this card vanishes from every
// student dashboard instantly — code, classes, premium banner, everything.
//
// THREE STATES:
//   1. Not in any class → cinematic "join with code" invite card
//   2. In classes → school roster card (class chips, code copy, share toggle)
//   3. School seat active → premium banner with license countdown
//
// Joining pre-configures the student's grade + stream from the class
// (backend handles that), and shareProgressWithSchool controls whether
// detailed study progress is shared with the school.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Copy,
  Crown,
  GraduationCap,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Switch } from "@/components/ui/switch";
import { useSchoolFeatureEnabled } from "@/hooks/useSchoolFeature";

interface JoinedClass {
  classId: Id<"schoolClasses">;
  className: string;
  schoolName: string;
  gradeLevel: number;
  stream: string;
  classCode: string;
  shareProgressWithSchool: boolean;
  joinedAt: number;
}

const STREAM_LABELS: Record<string, string> = {
  natural: "Natural",
  social: "Social",
  common: "General",
};

const CODE_LENGTH = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

export function StudentSchoolCard() {
  // ── Feature gate: absent from the DOM unless the admin enables it ──
  const { enabled, loading } = useSchoolFeatureEnabled();

  const myClasses = useQuery(api.schools.studentGetMyClasses);
  const seatStatus = useQuery(api.schools.studentGetSchoolSeatStatus);
  const joinClass = useMutation(api.schools.studentJoinClass);
  const toggleShare = useMutation(api.schools.studentToggleShareProgress);

  // ── Join flow state ──
  const [code, setCode] = useState("");
  const [shareProgress, setShareProgress] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinedCelebration, setJoinedCelebration] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [showJoinForm, setShowJoinForm] = useState(false);

  if (loading || !enabled) return null;

  const classes: JoinedClass[] = myClasses ?? [];
  const hasClasses = classes.length > 0;

  const handleJoin = async () => {
    if (code.length !== CODE_LENGTH || joining) return;
    setJoining(true);
    try {
      const result = await joinClass({ classCode: code, shareProgress });
      if (result.alreadyMember) {
        toast.info("You're already a member of that class.");
      } else {
        toast.success("Welcome aboard — you've joined the class!", {
          icon: "🎓",
        });
        setJoinedCelebration(code);
        window.setTimeout(() => setJoinedCelebration(null), 4200);
      }
      setCode("");
      setShareProgress(false);
      setShowJoinForm(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  const handleCopy = async (classCode: string) => {
    try {
      await navigator.clipboard.writeText(classCode);
      setCopiedCode(classCode);
      window.setTimeout(() => setCopiedCode(null), 1800);
    } catch {
      toast.error("Couldn't copy — long-press the code instead.");
    }
  };

  const handleToggleShare = async (classId: Id<"schoolClasses">, share: boolean) => {
    try {
      await toggleShare({ classId, share });
      toast.success(
        share
          ? "Your school can now see your study progress."
          : "Progress sharing paused — your school only sees your membership.",
      );
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // Seat banner countdown
  const daysLeft = seatStatus?.seatsExpireAt
    ? Math.max(0, Math.ceil((seatStatus.seatsExpireAt - Date.now()) / DAY_MS))
    : null;

  return (
    <motion.section
      className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent p-4 sm:p-6"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.18 }}
    >
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -left-20 -top-24 size-56 rounded-full bg-primary/10 blur-3xl" />

      {/* ═══ SCHOOL SEAT PREMIUM BANNER ═══ */}
      <AnimatePresence>
        {seatStatus?.hasSchoolSeat && daysLeft !== null && (
          <motion.div
            key="seat-banner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              "relative mb-4 overflow-hidden rounded-2xl border p-4",
              daysLeft <= 14
                ? "border-amber-400/30 bg-amber-400/[0.07]"
                : "border-primary/25 bg-primary/[0.08]",
            )}
          >
            <div className="flex flex-wrap items-center gap-3">
              <div
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl",
                  daysLeft <= 14 ? "bg-amber-400/15 text-amber-300" : "bg-primary/15 text-primary",
                )}
              >
                <Crown className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="type-body font-bold">
                  School premium active
                  {seatStatus.schoolName ? (
                    <span className="text-muted-foreground"> · {seatStatus.schoolName}</span>
                  ) : null}
                </p>
                <p className="mt-0.5 type-caption text-muted-foreground">
                  Every resource is unlocked through your school&apos;s seat license
                  {daysLeft <= 14 && daysLeft > 0
                    ? ` — license expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
                    : ""}
                  .
                </p>
              </div>
              <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <ShieldCheck
                  className={cn(
                    "size-3.5",
                    daysLeft <= 14 ? "text-amber-300" : "text-primary",
                  )}
                />
                <span className="type-caption font-bold tabular-nums">
                  {daysLeft}d left
                </span>
              </div>
            </div>
            {/* License countdown bar */}
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  daysLeft <= 14
                    ? "bg-gradient-to-r from-amber-400 to-amber-300"
                    : "bg-gradient-to-r from-primary to-primary/70",
                )}
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.min(100, Math.max(4, (daysLeft / 365) * 100))}%`,
                }}
                transition={{ duration: 1, delay: 0.4 }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ JOIN SUCCESS CELEBRATION ═══ */}
      <AnimatePresence>
        {joinedCelebration && (
          <motion.div
            key="celebration"
            initial={{ opacity: 0, scale: 0.94, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94 }}
            className="relative mb-4 flex items-center gap-3 overflow-hidden rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.08] p-4"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full bg-emerald-400/15 blur-2xl" />
            <motion.div
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"
              initial={{ rotate: -20, scale: 0 }}
              animate={{ rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.1 }}
            >
              <CheckCircle2 className="size-5" />
            </motion.div>
            <div className="min-w-0">
              <p className="type-body font-bold text-emerald-200">
                You&apos;re in! Code {joinedCelebration} linked successfully.
              </p>
              <p className="mt-0.5 type-caption text-muted-foreground">
                Your grade and stream were synced from the class automatically.
              </p>
            </div>
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="pointer-events-none absolute text-emerald-300/60"
                style={{ right: `${14 + i * 9}%`, top: `${18 + i * 22}%` }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: [0, 1, 0], y: -18 }}
                transition={{ duration: 1.4, delay: 0.3 + i * 0.22 }}
              >
                <Sparkles className="size-3.5" />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative">
        {myClasses === undefined ? (
          /* ── LOADING SKELETON ── */
          <div className="flex items-center gap-3">
            <div className="size-10 animate-pulse rounded-xl bg-white/10" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 animate-pulse rounded bg-white/10" />
              <div className="h-3 w-64 max-w-full animate-pulse rounded bg-white/5" />
            </div>
          </div>
        ) : !hasClasses ? (
          /* ═══ STATE 1 — NOT IN ANY CLASS: THE INVITE ═══ */
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="type-caption font-semibold text-primary/70">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="size-3.5" /> Your school, on Learnyx
                </span>
              </p>
              <h2 className="type-h2 mt-1.5">
                Learning is better{" "}
                <span className="text-gradient">together</span>
              </h2>
              <p className="type-body mt-2 max-w-lg text-muted-foreground">
                Your class director has a 6-character join code. Enter it once
                and your grade, stream and school seat sync automatically — no
                setup, no forms.
              </p>
              <ul className="mt-3 space-y-1.5">
                {[
                  "Unlock every resource through your school's seat",
                  "Your director sees your membership instantly",
                  "Optionally share your study streaks and progress",
                ].map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2 type-caption text-muted-foreground"
                  >
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>

            {/* Code entry */}
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.04] p-5 lg:w-auto">
              <p className="type-caption font-semibold text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="size-3.5 text-primary" /> Class join code
                </span>
              </p>
              <div className="mt-3 flex justify-center">
                <InputOTP
                  maxLength={CODE_LENGTH}
                  value={code}
                  onChange={(v) => setCode(v.toUpperCase())}
                  disabled={joining}
                  onComplete={() => void handleJoin()}
                  containerClassName="justify-center"
                >
                  <InputOTPGroup className="gap-2">
                    {Array.from({ length: CODE_LENGTH }, (_, i) => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        className="h-12 w-9 rounded-lg border-white/15 bg-white/[0.06] text-base font-black uppercase tracking-widest text-foreground first:rounded-lg last:rounded-lg data-[active=true]:border-primary/60 data-[active=true]:ring-primary/25 sm:w-11"
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              <div className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <div className="min-w-0">
                  <p className="type-caption font-semibold">Share study progress</p>
                  <p className="mt-0.5 type-caption text-muted-foreground">
                    Streaks, XP and activity for your teachers
                  </p>
                </div>
                <Switch
                  checked={shareProgress}
                  onCheckedChange={setShareProgress}
                  className="mt-0.5 shrink-0"
                  aria-label="Share study progress with school"
                />
              </div>

              <Button
                type="button"
                onClick={() => void handleJoin()}
                disabled={code.length !== CODE_LENGTH || joining}
                className="interactive-press mt-4 w-full gap-2 font-bold"
              >
                {joining ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Joining…
                  </>
                ) : (
                  <>
                    <GraduationCap className="size-4" /> Join class
                  </>
                )}
              </Button>
              <p className="mt-2.5 text-center type-caption text-muted-foreground/60">
                Codes don&apos;t include 0, O, 1 or I
              </p>
            </div>
          </div>
        ) : (
          /* ═══ STATE 2 — IN CLASSES: THE ROSTER ═══ */
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="type-caption font-semibold text-primary/70">
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-3.5" /> My school
                  </span>
                </p>
                <h2 className="type-h3 mt-0.5">
                  {classes.length === 1
                    ? "You're part of a class"
                    : `${classes.length} classes joined`}
                </h2>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowJoinForm((v) => !v)}
                className="interactive-press gap-1.5"
              >
                <Plus className="size-3.5" /> Join another class
              </Button>
            </div>

            {/* Expandable inline join form */}
            <AnimatePresence>
              {showJoinForm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <InputOTP
                      maxLength={CODE_LENGTH}
                      value={code}
                      onChange={(v) => setCode(v.toUpperCase())}
                      disabled={joining}
                      onComplete={() => void handleJoin()}
                    >
                      <InputOTPGroup className="gap-1.5">
                        {Array.from({ length: CODE_LENGTH }, (_, i) => (
                          <InputOTPSlot
                            key={i}
                            index={i}
                            className="h-10 w-8 rounded-lg border-white/15 bg-white/[0.06] font-black uppercase text-foreground first:rounded-lg last:rounded-lg data-[active=true]:border-primary/60 data-[active=true]:ring-primary/25"
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void handleJoin()}
                      disabled={code.length !== CODE_LENGTH || joining}
                      className="interactive-press gap-1.5 font-bold"
                    >
                      {joining ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                      Join
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Class chips */}
            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {classes.map((c, i) => (
                <motion.div
                  key={c.classId}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.08 * i }}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-primary/25"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="type-body truncate font-bold">{c.className}</p>
                      <p className="mt-0.5 truncate type-caption text-muted-foreground">
                        {c.schoolName}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopy(c.classCode)}
                      title="Copy class code"
                      className="interactive-press flex shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs font-bold tracking-widest text-primary transition hover:border-primary/40"
                    >
                      {c.classCode}
                      {copiedCode === c.classCode ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                    </button>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 type-caption font-semibold text-primary">
                      Grade {c.gradeLevel}
                    </span>
                    <span className="rounded-md bg-white/5 px-2 py-0.5 type-caption text-muted-foreground">
                      {STREAM_LABELS[c.stream] ?? c.stream}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                    <div className="min-w-0">
                      <p className="type-caption font-semibold">
                        Share study progress
                      </p>
                      <p className="truncate type-caption text-muted-foreground">
                        {c.shareProgressWithSchool
                          ? "Your school sees your activity"
                          : "Membership only — activity private"}
                      </p>
                    </div>
                    <Switch
                      checked={c.shareProgressWithSchool}
                      onCheckedChange={(share) =>
                        void handleToggleShare(c.classId, share)
                      }
                      className="shrink-0"
                      aria-label={`Share progress for ${c.className}`}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
