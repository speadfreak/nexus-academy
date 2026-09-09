// AccountSheet — a polished, cinematic slide-up sheet that shows the
// user profile summary + quick actions (Settings, Help, Appearance,
// Language, Log out). Triggered from the sidebar's bottom profile area
// in DashboardShell.
//
// DESIGN: matches the app's premium dark/gold design system — glass-panel
// treatment, smooth entrance animation, proper hierarchy. NOT a bare list.
//
// CONTENTS (top to bottom):
//   1. Profile summary — avatar, name, email, subscription status badge
//   2. Settings — link to /settings (full account settings)
//   3. Help — link to /help (Phase 6 FAQ + Contact)
//   4. Appearance — light/dark/system theme toggle (relocated here)
//   5. Language — only when MULTI_LANGUAGE_ENABLED is true (renders the
//      LanguageSwitcher in "sheet" variant, which itself renders null
//      when the gate is off, so the row collapses cleanly)
//   6. Log out — destructive button at the bottom
//
// ADMIN-ONLY NOTE: when the user is an admin, a small "Admin" badge
// appears next to their name (purely cosmetic — doesn't gate any action
// in this sheet; the sidebar already has the admin link separately).

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  ChevronRight,
  HelpCircle,
  LogOut,
  Moon,
  Settings,
  Sun,
  SunMoon,
  User as UserIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { cn } from "@/lib/utils";

interface AccountSheetProps {
  /** The trigger element — usually the sidebar's profile card. Wrapped
      in a SheetTrigger so clicking it opens the sheet. */
  children: React.ReactNode;
  /** Initials for the avatar fallback (when no avatar URL). */
  initials?: string;
}

export function AccountSheet({ children, initials = "N" }: AccountSheetProps) {
  const profile = useQuery(api.profile.getProfile);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const updateProfile = useMutation(api.profile.updateProfile);
  const isAdmin = useQuery(api.admin.isCurrentUserAdmin);
  const [open, setOpen] = useState(false);

  // Profile data
  const name = profile?.displayName ?? profile?.name ?? "Guest";
  const email = profile?.email ?? "Anonymous session";
  const isGuest = !profile || profile.isAnonymous;
  // Subscription status — for the badge in the profile summary.
  let subStatus: "premium" | "trial" | "free" = "free";
  if (entitlements?.premiumAccess) subStatus = "premium";
  else if (entitlements?.status === "trial") subStatus = "trial";

  // Theme cycling — light → dark → system (via next-themes' setTheme when
  // available, otherwise the existing profile-based toggle).
  // We use the existing themePreference on the profile (dark/light).
  // The "system" option is future-compat — for now it cycles light/dark.
  const cycleTheme = async () => {
    const next = profile?.themePreference === "dark" ? "light" : "dark";
    try {
      await updateProfile({ themePreference: next });
      // The theme-provider reacts to the profile change automatically.
      toast.success(`Switched to ${next} mode.`);
    } catch {
      toast.error("Could not switch theme.");
    }
  };

  // Build the initials from the name when not provided.
  const computedInitials = initials === "N" && name !== "Guest"
    ? name.split(" ").slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "N"
    : initials;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent
        side="bottom"
        className="mx-auto max-w-md rounded-t-3xl border-b-0 p-0"
      >
        {/* Top grabber + profile summary */}
        <SheetHeader className="sr-only">
          <SheetTitle>Account</SheetTitle>
        </SheetHeader>
        <div className="visible">
          {/* Drag handle */}
          <div className="mx-auto mt-3 mb-1 h-1 w-12 rounded-full bg-white/15" />

          {/* Profile summary card */}
          <div className="glass-panel m-3 rounded-2xl border border-white/10 p-4">
            <div className="flex items-center gap-3">
              <Avatar className="size-14">
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
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-base font-bold">{name}</p>
                  {isAdmin?.isAdmin && (
                    <Badge
                      variant="outline"
                      className="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] font-semibold text-amber-300"
                    >
                      Admin
                    </Badge>
                  )}
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
                    {subStatus === "premium" && "Premium"}
                    {subStatus === "trial" && "Trial"}
                    {subStatus === "free" && "Free"}
                  </Badge>
                  {isGuest && (
                    <span className="text-[10px] text-muted-foreground">
                      Sign in to save progress
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Menu items */}
          <div className="space-y-1.5 px-3 pb-2">
            {/* Settings */}
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Settings className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Settings</p>
                <p className="text-xs text-muted-foreground">
                  Profile, stream, theme, account
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>

            {/* Help — links to /help (Phase 6 FAQ + Contact) */}
            <Link
              to="/help"
              onClick={() => setOpen(false)}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <HelpCircle className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Help</p>
                <p className="text-xs text-muted-foreground">
                  FAQ, contact, support
                </p>
              </div>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>

            {/* Appearance — light/dark toggle, inline */}
            <button
              type="button"
              onClick={cycleTheme}
              className="group flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
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

            {/* Language — only renders when MULTI_LANGUAGE_ENABLED.
                When the gate is off, the LanguageSwitcher returns null
                and this row collapses to nothing (the conditional wraps
                the whole row). */}
            <LanguageSwitcher variant="sheet" />

            {/* Log out */}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                // Trigger the sign-out — we use the same flow as the
                // sidebar's sign-out button. The redirect happens via
                // the auth hook.
                window.location.href = "/api/auth/signout";
              }}
              className="group mt-2 flex w-full items-center gap-3 rounded-xl border border-rose-400/20 bg-rose-400/5 p-3 text-left text-rose-300 transition-colors hover:border-rose-400/40 hover:bg-rose-400/10"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-rose-400/10">
                <LogOut className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Log out</p>
                <p className="text-xs text-rose-300/70">
                  See you soon — your progress is saved.
                </p>
              </div>
            </Button>
          </div>

          {/* Footer */}
          <div className="px-4 pb-3 pt-2 text-center">
            <p className="text-[10px] text-muted-foreground/50">
              Learnyx Academy ET 🇪🇹 · v1.0
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
