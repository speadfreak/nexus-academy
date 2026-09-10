// AccountSheet — a polished, cinematic slide-up sheet that shows the
// user profile summary + quick actions. Triggered from the sidebar's
// bottom profile area in DashboardShell.
//
// DESIGN: premium dark/gold glass-panel with smooth framer-motion
// entrance, gradient avatar ring, animated subscription badge, and
// glass-soft menu rows with hover glow. NOT a bare list.
//
// FIX: logout now uses the proper useAuth().signOut() hook + navigate("/")
// instead of the broken window.location.href = "/api/auth/signout".

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  HelpCircle,
  LogOut,
  Moon,
  Settings,
  Sun,
  SunMoon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { cn } from "@/lib/utils";

interface AccountSheetProps {
  children: React.ReactNode;
  initials?: string;
}

export function AccountSheet({ children, initials = "N" }: AccountSheetProps) {
  const profile = useQuery(api.profile.getProfile);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const updateProfile = useMutation(api.profile.updateProfile);
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const name = profile?.displayName ?? profile?.name ?? "Guest";
  const email = profile?.email ?? "Anonymous session";
  const isGuest = !profile || profile.isAnonymous;

  let subStatus: "premium" | "trial" | "free" = "free";
  if (entitlements?.premiumAccess) subStatus = "premium";
  else if (entitlements?.status === "trial") subStatus = "trial";

  const cycleTheme = async () => {
    const next = profile?.themePreference === "dark" ? "light" : "dark";
    try {
      await updateProfile({ themePreference: next });
      toast.success(`Switched to ${next} mode.`);
    } catch {
      toast.error("Could not switch theme.");
    }
  };

  const handleSignOut = async () => {
    setOpen(false);
    try {
      await signOut();
      navigate("/");
      toast.success("Signed out — see you soon!");
    } catch {
      toast.error("Could not sign out. Try again.");
    }
  };

  const computedInitials =
    initials === "N" && name !== "Guest"
      ? name.split(" ").slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "N"
      : initials;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-3xl border-b-0 p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Account</SheetTitle>
        </SheetHeader>

        {/* Drag handle */}
        <div className="mx-auto mt-3 mb-1 h-1.5 w-12 rounded-full bg-white/15" />

        {/* Profile summary — gradient ring + animated entrance */}
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative m-3 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-amber-400/[0.08] via-transparent to-transparent p-4"
        >
          {/* Ambient glow */}
          <div className="pointer-events-none absolute -right-10 -top-10 size-32 rounded-full bg-amber-400/[0.08] blur-3xl" />
          <div className="relative flex items-center gap-3.5">
            {/* Avatar with gradient ring */}
            <div className="relative shrink-0">
              <div className="absolute -inset-1 rounded-full bg-gradient-to-br from-amber-400/40 via-primary/20 to-transparent opacity-80 blur-[2px]" />
              <Avatar className="relative size-14 ring-2 ring-amber-400/20">
                {profile?.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={name}
                    className="size-full rounded-full object-cover"
                  />
                ) : null}
                <AvatarFallback className="bg-gradient-to-br from-amber-400/25 to-amber-400/5 text-base font-bold text-amber-300">
                  {computedInitials}
                </AvatarFallback>
              </Avatar>
              {/* Online indicator dot */}
              <span className="absolute -bottom-0.5 -right-0.5 flex size-4">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-4 items-center justify-center rounded-full bg-emerald-500 text-[7px] font-bold text-white">
                  ✓
                </span>
              </span>
            </div>

            {/* Name + email + badges */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-base font-bold tracking-tight">{name}</p>
                <AnimatePresence>
                  {isAdmin?.isAdmin && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-amber-300"
                    >
                      Admin
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 py-0 text-[10px] font-semibold",
                    subStatus === "premium" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                    subStatus === "trial" && "border-sky-500/30 bg-sky-500/10 text-sky-300",
                    subStatus === "free" && "border-white/10 bg-white/5 text-muted-foreground",
                  )}
                >
                  {subStatus === "premium" && "✦ Premium"}
                  {subStatus === "trial" && "⚡ Trial"}
                  {subStatus === "free" && "Free"}
                </Badge>
                {isGuest && (
                  <span className="text-[10px] text-muted-foreground/70">
                    Sign in to save progress
                  </span>
                )}
              </div>
            </div>
          </div>
        </motion.div>

        {/* Menu items — staggered entrance */}
        <div className="space-y-1.5 px-3 pb-2">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-primary/30 hover:bg-white/[0.04] hover:shadow-[0_0_20px_-8px_var(--primary)]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
                <Settings className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Settings</p>
                <p className="text-xs text-muted-foreground">Profile, stream, theme, account</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }}>
            <Link
              to="/help"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-all duration-200 hover:border-primary/30 hover:bg-white/[0.04] hover:shadow-[0_0_20px_-8px_var(--primary)]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
                <HelpCircle className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Help</p>
                <p className="text-xs text-muted-foreground">FAQ, contact, support</p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-primary" />
            </Link>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <button
              type="button"
              onClick={cycleTheme}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-all duration-200 hover:border-primary/30 hover:bg-white/[0.04] hover:shadow-[0_0_20px_-8px_var(--primary)]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary transition-transform group-hover:scale-105">
                {profile?.themePreference === "dark" ? (
                  <Moon className="size-4" />
                ) : (
                  <Sun className="size-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Appearance</p>
                <p className="text-xs text-muted-foreground">
                  {profile?.themePreference === "dark" ? "Dark mode" : "Light mode"}
                </p>
              </div>
              <SunMoon className="size-4 text-muted-foreground" />
            </button>
          </motion.div>

          {/* Language switcher — auto-gated, renders nothing when disabled */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.26 }}>
            <LanguageSwitcher variant="sheet" />
          </motion.div>

          {/* Log out — fixed: uses useAuth().signOut() + navigate("/") */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.32 }}>
            <button
              type="button"
              onClick={handleSignOut}
              className="group flex w-full items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-left text-rose-300 transition-all duration-200 hover:border-rose-400/40 hover:bg-rose-400/10 hover:shadow-[0_0_20px_-8px_rgb(244_63_94)]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-rose-400/10 transition-transform group-hover:scale-105">
                <LogOut className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Log out</p>
                <p className="text-xs text-rose-300/70">
                  Your progress is saved — see you soon.
                </p>
              </div>
              <ChevronRight className="size-4 text-rose-300/50 transition-transform group-hover:translate-x-1" />
            </button>
          </motion.div>
        </div>

        {/* Footer */}
        <div className="px-4 pb-3 pt-2 text-center">
          <p className="text-[10px] text-muted-foreground/40">
            Learnyx Academy ET 🇪🇹 · v1.0
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
