// Settings — profile, avatar, theme (light/dark), stream, subscription and
// sign-out. The theme toggle writes to userProfiles.themePreference; the
// ThemeProvider picks it up and flips the .dark/.light class on <html>.

import { api } from "@/convex/_generated/api";
import { STREAM_LABELS } from "@/convex/constants";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  Atom,
  Camera,
  Check,
  Crown,
  Landmark,
  Loader2,
  LogOut,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/components/theme-provider";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

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
        method: "PUT",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!response.ok) throw new Error("Could not upload the image.");
      const { storageId } = (await response.json()) as { storageId: string };
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
        <div className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 size-52 rounded-full bg-primary/8 blur-[90px]" aria-hidden="true" />

        {/* Header */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="type-mono uppercase tracking-[0.22em] text-primary">
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
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-[0_0_16px_-4px_rgb(56_189_248/0.4)]">
              <UserRound className="size-4" />
            </div>
            <p className="type-mono uppercase tracking-[0.22em] text-primary">
              // profile
            </p>
          </div>

          <div className="mt-5 flex items-center gap-5">
            <div className="relative">
              <Avatar className="size-20">
                <AvatarImage src={profile?.avatarUrl ?? undefined} />
                <AvatarFallback className="bg-primary/10 text-xl font-bold text-primary">
                  {initials || "N"}
                </AvatarFallback>
              </Avatar>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                aria-label="Upload avatar"
                className="interactive-press absolute -bottom-1 -right-1 flex size-7 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_16px_-4px_rgb(56_189_248/0.5)] disabled:opacity-60"
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
                <Badge className="mt-1.5 glass-chip gap-1 border-0 type-mono text-[10px] text-primary">
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
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-[0_0_16px_-4px_rgb(56_189_248/0.4)]">
              <Sun className="size-4" />
            </div>
            <p className="type-mono uppercase tracking-[0.22em] text-primary">
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
                    ? "border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_rgb(112_196_255/0.14),0_8px_24px_-18px_rgb(112_196_255/0.9)]"
                    : "border-white/10 bg-white/4 hover:border-white/25",
                )}
              >
                {option === "dark" ? (
                  <Moon className="size-5 text-primary" />
                ) : (
                  <Sun className="size-5 text-primary" />
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
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-[0_0_16px_-4px_rgb(56_189_248/0.4)]">
              <Atom className="size-4" />
            </div>
            <p className="type-mono uppercase tracking-[0.22em] text-primary">
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
                      ? "border-primary/50 bg-primary/10 shadow-[inset_0_0_0_1px_rgb(112_196_255/0.14),0_8px_24px_-18px_rgb(112_196_255/0.9)]"
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
                    <span className="text-primary/70">(both streams)</span>
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
      </div>
    </DashboardShell>
  );
}
