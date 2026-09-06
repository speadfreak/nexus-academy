// Settings — profile, avatar, theme (light/dark), stream, subscription and
// sign-out. The theme toggle writes to userProfiles.themePreference; the
// ThemeProvider picks it up and flips the .dark/.light class on <html>.

import { api } from "@/convex/_generated/api";
import { STREAM_LABELS } from "@/convex/constants";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Atom,
  Camera,
  Check,
  Clock,
  Compass,
  Crown,
  Landmark,
  Link2,
  Loader2,
  LogOut,
  MessageSquareText,
  Moon,
  RefreshCw,
  Send,
  Send as TelegramIcon,
  Sun,
  Unlink,
  Copy,
  Share2,
  UserRound,
  LifeBuoy,
} from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { useTour } from "@/components/tour";

// Two streams only. English, Mathematics and the SAT are sat by every
// candidate, so they're shown inside both tracks — never as a third choice.
const SHARED_SUBJECTS = "English · Mathematics · SAT";

const STREAM_OPTIONS = [
  { id: "natural", icon: Atom, label: "Natural Science", subjects: "Physics · Chemistry · Biology" },
  { id: "social", icon: Landmark, label: "Social Science", subjects: "History · Geography · Economics" },
] as const;

export default function Settings() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const profile = useQuery(api.profile.getProfile);
  const subscription = useQuery(api.subscriptions.getSubscriptionStatus);
  const updateProfile = useMutation(api.profile.updateProfile);
  const generateAvatarUploadUrl = useMutation(api.profile.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profile.setAvatar);
  const setUsername = useMutation(api.profile.setUsername);
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [nameDirty, setNameDirty] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [username, setUsernameValue] = useState("");
  const [usernameDirty, setUsernameDirty] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { startTour } = useTour();

  const handleSaveName = async () => {
    setSavingName(true);
    try {
      await updateProfile({ displayName: displayName.trim() || undefined });
      setNameDirty(false);
      toast.success("Display name updated.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not save your display name."));
    } finally {
      setSavingName(false);
    }
  };

  const handleAvatar = async (file: File | null) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Avatar must be under 2 MB.");
      return;
    }
    setUploadingAvatar(true);
    try {
      const uploadUrl = await generateAvatarUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!response.ok) throw new Error("Could not upload the image.");
      const raw = await response.json();
      const storageId: string = raw?.storageId ?? raw?.fileId ?? Object.values(raw)[0] as string;
      if (!storageId) throw new Error("Upload response missing storage ID.");
      await setAvatar({ storageId });
      toast.success("Avatar updated.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not upload the avatar."));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveUsername = async () => {
    const value = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(value)) {
      setUsernameError("3–20 characters: lowercase letters, numbers and underscores only.");
      return;
    }
    setSavingUsername(true);
    setUsernameError(null);
    try {
      const result = await setUsername({ username: value });
      setUsernameDirty(false);
      setUsernameValue(result.username);
      toast.success(`Username set — you can now sign in with "${result.username}".`);
    } catch (error) {
      setUsernameError(errorMessage(error, "Could not save your username."));
    } finally {
      setSavingUsername(false);
    }
  };

  const handleStream = async (stream: "natural" | "social") => {
    try {
      await updateProfile({ stream });
      toast.success(`Stream set to ${STREAM_LABELS[stream]}.`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not save your stream."));
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const initials = (user?.name || user?.email || "N")
    .split(/[\s@]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part: string) => part[0]?.toUpperCase())
    .join("");

  return (
    <DashboardShell>
      <div className="relative mx-auto flex w-full max-w-3xl flex-col gap-6">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 size-52 rounded-full bg-amber-400/8 blur-[90px]" aria-hidden="true" />

        {/* Header */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // configuration · settings
          </p>
          <h1 className="type-h1 mt-1">Settings</h1>
          <p className="type-body mt-1 text-muted-foreground">
            Your profile, appearance and study track.
          </p>
        </motion.div>

        {/* ------- Profile ------- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel hover-lift rounded-2xl p-6"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <UserRound className="size-4" />
            </div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // profile
            </p>
          </div>

          <div className="mt-5 flex items-center gap-5">
            <div className="relative">
              <Avatar className="size-20">
                <AvatarImage src={profile?.avatarUrl ?? undefined} />
                <AvatarFallback className="bg-amber-400/10 text-xl font-bold text-amber-300">
                  {initials || "N"}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                aria-label="Upload avatar"
                className="interactive-press absolute -bottom-1 -right-1 flex size-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_16px_-4px_rgb(251,191,36/0.5)] disabled:opacity-60"
              >
                {uploadingAvatar ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Camera className="size-3.5" />
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleAvatar(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="min-w-0 flex-1">
              <p className="type-body font-semibold">
                {profile?.displayName ?? user?.name ?? "Guest"}
              </p>
              <p className="type-mono truncate text-muted-foreground">
                {profile?.email ?? user?.email ?? "Anonymous session"}
              </p>
              {profile?.stream && (
                <Badge className="mt-1.5 glass-chip gap-1 border-0 type-mono text-[10px] text-amber-300">
                  <UserRound className="size-3" /> {STREAM_LABELS[profile.stream as keyof typeof STREAM_LABELS]} stream
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <Label className="type-caption font-semibold text-muted-foreground">Display name</Label>
            <div className="flex gap-2">
              <Input
                value={
                  nameDirty ? displayName : (displayName || (profile?.displayName ?? user?.name ?? ""))
                }
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setNameDirty(true);
                }}
                placeholder="How the tutor should call you"
                className="type-body h-10 rounded-xl bg-white/5 font-mono"
              />
              <Button
                className="interactive-press h-10 rounded-xl"
                onClick={handleSaveName}
                disabled={savingName || !nameDirty}
              >
                {savingName ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <Label className="type-caption font-semibold text-muted-foreground">Username (login handle)</Label>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={
                    usernameDirty ? username : (username || (profile?.username ?? ""))
                  }
                  onChange={(e) => {
                    setUsernameValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                    setUsernameDirty(true);
                    setUsernameError(null);
                  }}
                  placeholder="e.g. abebe_12"
                  className="type-body h-10 rounded-xl bg-white/5 font-mono"
                />
                {usernameError ? (
                  <p className="mt-1 type-caption text-destructive">{usernameError}</p>
                ) : (
                  <p className="mt-1 type-caption text-muted-foreground">
                    {profile?.username
                      ? `Sign in with your username or email — "${profile.username}".`
                      : "Optional: pick one so you can sign in with your username instead of your email."}
                  </p>
                )}
              </div>
              <Button
                className="interactive-press h-10 rounded-xl"
                onClick={() => void handleSaveUsername()}
                disabled={savingUsername || !usernameDirty}
              >
                {savingUsername ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Save
              </Button>
            </div>
          </div>
        </motion.div>

        {/* ------- Appearance ------- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel hover-lift rounded-2xl p-6"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <Sun className="size-4" />
            </div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // appearance
            </p>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {(["dark", "light"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setTheme(option);
                  void updateProfile({ themePreference: option }).catch(() => {});
                }}
                className={cn(
                  "interactive-press flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-left",
                  theme === option
                    ? "border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_rgb(251,191,36/0.14),0_8px_24px_-18px_rgb(251,191,36/0.9)]"
                    : "border-white/10 bg-white/4 hover:border-white/25",
                )}
              >
                {option === "dark" ? (
                  <Moon className="size-5 text-amber-300" />
                ) : (
                  <Sun className="size-5 text-amber-300" />
                )}
                <div>
                  <p className="type-body font-semibold">
                    {option === "dark" ? "Dark" : "Light"}
                  </p>
                  <p className="type-caption text-muted-foreground">
                    {option === "dark" ? "deep navy technical" : "cool paper blueprint"}
                  </p>
                </div>
                {theme === option && <Check className="ml-auto size-4 text-primary" />}
              </button>
            ))}
          </div>
        </motion.div>

        {/* ------- Stream ------- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel hover-lift rounded-2xl p-6"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <Atom className="size-4" />
            </div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // study track
            </p>
          </div>
          <p className="mt-1 type-caption text-muted-foreground">
            The AI tutor and dashboard organize around your stream&apos;s exam subjects.
            English, Mathematics and the SAT are part of both streams.
          </p>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {STREAM_OPTIONS.map((option) => {
              const active = profile?.stream === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleStream(option.id)}
                  className={cn(
                    "interactive-press flex cursor-pointer flex-col gap-2 rounded-xl border p-4 text-left",
                    active
                      ? "border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_rgb(251,191,36/0.14),0_8px_24px_-18px_rgb(251,191,36/0.9)]"
                      : "border-white/10 bg-white/4 hover:border-white/25",
                  )}
                >
                  <option.icon className={cn("size-5", active ? "text-primary" : "text-muted-foreground")} />
                  <p className="type-body font-semibold">{option.label}</p>
                  <p className="type-mono text-[10px] text-muted-foreground">
                    {option.subjects}
                  </p>
                  <p className="type-mono text-[10px] text-muted-foreground/70">
                    + {SHARED_SUBJECTS}{" "}
                    <span className="text-amber-300/70">(both streams)</span>
                  </p>
                </button>
              );
            })}
          </div>
        </motion.div>

        {/* ------- Subscription ------- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel hover-lift relative overflow-hidden flex flex-wrap items-center justify-between gap-3 rounded-2xl p-6"
        >
          <div className="pointer-events-none absolute -top-6 -right-6 size-24 rounded-full bg-premium/10 blur-[40px]" />
          <div className="relative flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-premium/10 text-premium shadow-[0_0_20px_-8px_rgb(245_197_66/0.5)]">
              <Crown className="size-5" />
            </div>
            <div>
              <p className="type-body font-semibold">
                {subscription?.status === "active"
                  ? "Premium is active"
                  : subscription?.status === "trial"
                    ? `Free trial · ${subscription.trialDaysRemaining} active day${subscription.trialDaysRemaining === 1 ? "" : "s"} left`
                    : subscription?.needsUpgrade
                      ? "Trial ended — premium paused"
                      : "No active subscription"}
              </p>
              <p className="type-mono text-muted-foreground">
                status: {subscription?.status ?? "checking…"} · tier: {subscription?.planTier ?? "premium"}
              </p>
            </div>
          </div>
          {subscription?.needsUpgrade ? (
            <Button asChild className="interactive-press rounded-xl">
              <a href="/upgrade">Upgrade now</a>
            </Button>
          ) : (
            <Badge className="glass-chip border-0 gap-1 type-mono text-[10px] text-emerald-400">
              <Check className="size-3" /> access granted
            </Badge>
          )}
        </motion.div>

        {/* ------- Onboarding ------- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.27, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel hover-lift rounded-2xl p-6"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <Compass className="size-4" />
            </div>
            <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
              // onboarding
            </p>
          </div>
          <p className="mt-1 type-caption text-muted-foreground">
            Replay the feature walkthrough to refresh your memory.
          </p>
          <div className="mt-4">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 rounded-xl border-white/10 hover:border-amber-400/30 hover:bg-amber-400/5"
              onClick={() => startTour()}
            >
              <Compass className="size-4 text-amber-400" />
              Replay onboarding tour
            </Button>
          </div>
        </motion.div>

        {/* ------- Contact the team ------- */}
        <ContactSection userEmail={profile?.email ?? user?.email ?? ""} displayName={profile?.displayName ?? user?.name ?? ""} />

        {/* ------- Link Telegram for weekly updates ------- */}
        <TelegramLinkSection />

        {/* ------- Danger zone ------- */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel flex flex-wrap items-center justify-between gap-3 rounded-2xl p-6"
        >
          <div>
            <p className="type-body font-semibold">Sign out</p>
            <p className="type-caption text-muted-foreground">
              Your streak, notes and progress stay saved to your account.
            </p>
          </div>
          <Button
            variant="outline"
            className="interactive-press cursor-pointer rounded-xl bg-white/5 text-muted-foreground hover:text-destructive"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" /> Sign out
          </Button>
        </motion.div>

        {/* ═══ REFER FRIENDS ═══ */}
        <ReferralSection />
      </div>
    </DashboardShell>
  );
}

// ─── Referral section ──────────────────────────────────────────────────
function ReferralSection() {
  const referralInfo = useQuery(api.marketing.getMyReferralCode, {});
  const getOrCreate = useMutation(api.marketing.getOrCreateReferralCode);
  const referralStats = useQuery(api.marketing.getMyReferralStats, {});
  const [copied, setCopied] = useState(false);

  // If enabled but no code yet, auto-generate
  useEffect(() => {
    if (referralInfo?.enabled && !referralInfo.code) {
      void getOrCreate({});
    }
  }, [referralInfo, getOrCreate]);

  if (!referralInfo || !referralInfo.enabled) return null;
  if (!referralInfo.code) return null;

  const referralLink = `https://nexus-academy-5nfg.onrender.com/?ref=${referralInfo.code}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    toast.success("Referral link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Learnyx Academy ET 🇪🇹 — Ethiopian Exam Prep",
          text: "Join me on Learnyx Academy ET 🇪🇹 for the best EHEEE exam prep. Use my referral link!",
          url: referralLink,
        });
      } catch {
        // User cancelled — non-fatal
      }
    } else {
      handleCopy();
    }
  };

  const stats = referralStats ?? { signedUp: 0, converted: 0, rewarded: 0, totalRewardDays: 0 };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      className="glass-panel relative overflow-hidden rounded-2xl p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-primary/5 blur-3xl" />
      <div className="relative">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
          // refer friends
        </p>
        <h2 className="mt-2 text-lg font-extrabold tracking-tight">Refer friends, earn premium</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Share your link. When a friend upgrades to premium, you both get bonus days — free premium time, no cost.
        </p>

        {/* Referral link */}
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
          <span className="flex-1 truncate font-mono text-xs text-foreground/80">{referralLink}</span>
          <Button
            size="sm"
            variant="outline"
            className="cursor-pointer gap-1.5 rounded-lg bg-white/5"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            size="sm"
            className="cursor-pointer gap-1.5 rounded-lg"
            onClick={handleShare}
          >
            <Share2 className="size-3.5" />
            Share
          </Button>
        </div>

        {/* Stats */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <p className="font-mono text-2xl font-bold text-gradient">{stats.signedUp}</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Signed up</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <p className="font-mono text-2xl font-bold text-emerald-300">{stats.converted}</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Converted</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-center">
            <p className="font-mono text-2xl font-bold text-amber-300">{stats.totalRewardDays}</p>
            <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted-foreground">Days earned</p>
          </div>
        </div>

        <p className="mt-3 text-[10px] text-muted-foreground/60">
          How it works: your friend must sign up via your link AND upgrade to premium. When their payment is confirmed, you both get bonus days. Self-referrals are blocked.
        </p>
      </div>
    </motion.div>
  );
}

// ─── Contact the team ──────────────────────────────────────────────────
// Users can write a message (question, advice, complaint, bug report)
// and the message is delivered straight to the team's Telegram group(s)
// via the `telegramActions.sendContactMessage` action. Falls back
// gracefully — if Telegram isn't configured, the message is persisted
// in the `contactMessages` table for the admin to read from the
// dashboard.
function ContactSection({
  userEmail,
  displayName,
}: {
  userEmail: string;
  displayName: string;
}) {
  const sendContactMessage = useAction(api.telegramActions.sendContactMessage);
  const [name, setName] = useState(displayName ?? "");
  const [email, setEmail] = useState(userEmail ?? "");
  const [category, setCategory] = useState("question");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !message.trim()) {
      toast.error("Please enter your email and a message.");
      return;
    }
    if (message.trim().length < 5) {
      toast.error("Please describe your concern in at least a few words.");
      return;
    }
    setSending(true);
    try {
      const result = await sendContactMessage({
        name: name.trim() || undefined,
        email: email.trim(),
        category,
        message: message.trim(),
      });
      if (result.sent > 0) {
        toast.success("Message sent — our team will reply soon.");
      } else {
        toast.success("Message saved — our team will get back to you.");
      }
      setMessage("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not send your message. Please try again."));
    } finally {
      setSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel relative overflow-hidden rounded-2xl p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-sky-400/5 blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-sky-400/10 text-sky-300 shadow-[0_0_16px_-4px_rgb(56,189,248/0.35)]">
            <LifeBuoy className="size-4" />
          </div>
          <p className="uppercase tracking-[0.22em] text-sky-300 font-semibold">
            // contact the team
          </p>
        </div>
        <h2 className="mt-4 text-lg font-extrabold tracking-tight">
          We&apos;re here to help.
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Questions, advice, complaints, bug reports — anything. Your message
          goes straight to our Telegram group where the team will reply
          quickly. You&apos;ll hear back via email or directly in the app.
        </p>

        {/* Form grid */}
        <div className="mt-5 flex flex-col gap-4">
          {/* Name + email row */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                Your name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Abebe Bekele"
                className="h-11 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">
                Email (we&apos;ll reply here)
              </Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                type="email"
                className="h-11 rounded-xl bg-white/5"
              />
            </div>
          </div>

          {/* Category picker */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              What is this about?
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-11 rounded-xl bg-white/5 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="question">❓ Question</SelectItem>
                <SelectItem value="advice">💡 Advice</SelectItem>
                <SelectItem value="complaint">⚠️ Complaint</SelectItem>
                <SelectItem value="bug">🐞 Bug report</SelectItem>
                <SelectItem value="other">📝 Something else</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Message */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-semibold text-muted-foreground">
              Your message
            </Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's on your mind. The more detail, the faster we can help."
              rows={5}
              className="resize-none rounded-xl bg-white/5 text-sm"
              maxLength={5000}
            />
            <p className="text-[10px] text-muted-foreground/60">
              {message.length} / 5000 characters
            </p>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <MessageSquareText className="size-3.5" />
              Delivered to the team&apos;s Telegram group
            </p>
            <Button
              onClick={handleSubmit}
              disabled={sending || !message.trim() || !email.trim()}
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-50"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              {sending ? "Sending…" : "Send message"}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Telegram weekly digest linking ───────────────────────────────────
// Students link their OWN Telegram account (separate from the admin
// broadcast bot) to receive a personalized progress digest every Monday
// morning — XP, quiz trends, streak, and a focus tip.
//
// Flow: student clicks "Get linking code" → we generate a 6-char code
// (valid for 10 minutes) → student sends `/start CODE` to the bot → the
// webhook matches the code + creates the link → student gets a
// confirmation reply in Telegram. The Settings UI polls `getMyTelegramLink`
// so the "linked" state appears within a few seconds of the bot reply.
function TelegramLinkSection() {
  const link = useQuery(api.telegram.getMyTelegramLink);
  const startLink = useMutation(api.telegram.startTelegramLink);
  const unlink = useMutation(api.telegram.unlinkMyTelegram);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [unLinking, setUnLinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  // Tick every second so the countdown updates live.
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await startLink({});
      setCode({ code: result.code, expiresAt: result.expiresAt });
      setCopied(false);
      toast.success("Linking code generated — send it to the bot within 10 minutes.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not generate a linking code."));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      toast.success("Code copied.");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy — type the code manually.");
    }
  };

  const handleUnlink = async () => {
    setUnLinking(true);
    try {
      await unlink({});
      toast.success("Telegram unlinked. You won't receive weekly digests anymore.");
    } catch (error) {
      toast.error(errorMessage(error, "Could not unlink Telegram."));
    } finally {
      setUnLinking(false);
    }
  };

  const isLinked = Boolean(link);
  const secondsLeft = code ? Math.max(0, Math.ceil((code.expiresAt - nowTick) / 1000)) : 0;
  const codeExpired = code && secondsLeft === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel relative overflow-hidden rounded-2xl p-6"
    >
      <div className="pointer-events-none absolute -right-16 -top-16 size-48 rounded-full bg-[#229ED9]/[0.08] blur-3xl" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-[#229ED9]/10 text-[#229ED9] shadow-[0_0_16px_-4px_rgb(34,158,217/0.45)]">
            <TelegramIcon className="size-4" />
          </div>
          <p className="uppercase tracking-[0.22em] text-[#229ED9] font-semibold">
            // weekly digest
          </p>
        </div>
        <h2 className="mt-4 text-lg font-extrabold tracking-tight">
          Link Telegram for weekly updates
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Get a personalized progress report every Monday morning — XP earned,
          quiz trends, your streak, and a focus tip. Honest numbers, no spam,
          cancel anytime.
        </p>

        {/* Linked state */}
        {isLinked ? (
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300">
                <Check className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  Telegram linked
                </p>
                <p className="text-xs text-muted-foreground">
                  Chat ID <span className="font-mono">{link?.telegramChatId}</span> · linked{" "}
                  {link?.linkedAt
                    ? new Date(link.linkedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "—"}
                  {link?.lastDigestSentAt
                    ? ` · last digest ${new Date(link.lastDigestSentAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                    : " · no digest sent yet (first one lands next Monday)"}
                </p>
              </div>
            </div>
            <Button
              onClick={() => void handleUnlink()}
              disabled={unLinking}
              variant="outline"
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-white/5 text-muted-foreground hover:text-rose-300 disabled:opacity-50"
            >
              {unLinking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlink className="size-4" />
              )}
              {unLinking ? "Unlinking…" : "Unlink Telegram"}
            </Button>
          </div>
        ) : code && !codeExpired ? (
          /* Code generated — show the code + countdown + instructions */
          <div className="mt-5 flex flex-col gap-4">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#229ED9]/20 bg-[#229ED9]/[0.04] p-5 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                your linking code · expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
              </p>
              <button
                onClick={() => void handleCopy()}
                className="group flex cursor-pointer items-center gap-3 rounded-2xl border border-[#229ED9]/30 bg-[#229ED9]/[0.08] px-6 py-4 transition-colors hover:bg-[#229ED9]/[0.12]"
                title="Click to copy"
              >
                <span className="font-mono text-3xl font-extrabold tracking-[0.3em] text-[#229ED9]">
                  {code.code}
                </span>
                <span className="flex items-center gap-1 rounded-lg bg-[#229ED9]/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-[#229ED9]">
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied ? "Copied" : "Copy"}
                </span>
              </button>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <TelegramIcon className="size-3.5 text-[#229ED9]" />
                How to link
              </p>
              <ol className="mt-2 flex flex-col gap-1.5 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-mono font-bold text-[#229ED9]">1.</span>
                  Open Telegram and search for our bot (the admin adds it via BotFather, then shares the bot username with you).
                </li>
                <li className="flex gap-2">
                  <span className="font-mono font-bold text-[#229ED9]">2.</span>
                  Send the message <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-foreground">/start {code.code}</code> to the bot.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono font-bold text-[#229ED9]">3.</span>
                  The bot replies with a confirmation. This page will update automatically within a few seconds.
                </li>
              </ol>
            </div>

            <Button
              onClick={() => void handleGenerate()}
              disabled={generating}
              variant="outline"
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-white/5 disabled:opacity-50"
            >
              <RefreshCw className="size-4" />
              Generate a new code
            </Button>
          </div>
        ) : (
          /* Not linked, no code yet (or code expired) — CTA */
          <div className="mt-5 flex flex-col gap-4">
            {codeExpired && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-200">
                <Clock className="size-3.5" />
                Your previous code expired. Generate a new one to continue.
              </div>
            )}
            <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#229ED9]/10 text-[#229ED9]">
                <Link2 className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  How it works
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click "Get linking code" → send the code to our bot in
                  Telegram → you're linked. Codes expire after 10 minutes.
                  You'll get one digest every Monday morning — that's it, no
                  other messages.
                </p>
              </div>
            </div>
            <Button
              onClick={() => void handleGenerate()}
              disabled={generating}
              className="interactive-press cursor-pointer gap-2 rounded-xl bg-[#229ED9] text-white hover:bg-[#1b8dc7] disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              {generating ? "Generating…" : "Get linking code"}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
