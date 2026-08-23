// Achievements + level page.
//
// Every achievement shows its exact requirement even when locked — no mystery
// boxes, so students always know what to aim for. The level card shows the
// XP curve and a feed of recent XP events (the "here's what you just earned"
// satisfaction moment).

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  CalendarCheck,
  Flame,
  Footprints,
  HelpCircle,
  Layers,
  Lock,
  Map,
  Medal,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { XP_REASON_LABELS } from "@/convex/constants";
import { cn } from "@/lib/utils";

// Icon name -> component map (matches the icon strings stored in
// ACHIEVEMENT_DEFINITIONS).
const ICONS: Record<string, typeof Trophy> = {
  Footprints,
  HelpCircle,
  CalendarCheck,
  Users,
  Flame,
  Target,
  Layers,
  Timer,
  Map,
  Zap,
};

const TIER_STYLES: Record<
  "bronze" | "silver" | "gold",
  { chip: string; icon: string; label: string; depth: string }
> = {
  bronze: {
    chip: "border-orange-400/25 bg-orange-400/10 text-orange-300",
    icon: "bg-orange-400/15 text-orange-300",
    label: "Bronze",
    depth: "shadow-[0_0_12px_-4px_rgb(180_130_70/0.4)] border-amber-700/30",
  },
  silver: {
    chip: "border-slate-300/25 bg-slate-300/10 text-slate-200",
    icon: "bg-slate-300/15 text-slate-200",
    label: "Silver",
    depth: "shadow-[0_0_12px_-4px_rgb(180_195_210/0.4)] border-slate-300/30",
  },
  gold: {
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    icon: "bg-amber-400/15 text-amber-300",
    label: "Gold",
    depth: "shadow-[0_0_16px_-4px_rgb(245_197_66/0.5)] border-premium/40",
  },
};

export default function Achievements() {
  const achievements = useQuery(api.achievements.getMyAchievements);
  const level = useQuery(api.xp.getMyLevel);

  const earnedCount = achievements?.filter((a) => a.earnedAt !== null).length ?? 0;
  const total = achievements?.length ?? 0;

  return (
    <DashboardShell>
      <div className="relative flex flex-col gap-6">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute -top-12 -right-6 size-48 rounded-full bg-amber-400/8 blur-[80px]" aria-hidden="true" />
        <div className="pointer-events-none absolute top-20 -left-10 size-36 rounded-full bg-amber-400/[0.05] blur-[64px]" aria-hidden="true" />

        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // gamification · progress
          </p>
          <h1 className="mt-1 type-h1">
            Achievements
          </h1>
          <p className="mt-1 type-body text-muted-foreground">
            Earned through real study — quizzes, focus, streaks, plans and daily challenges.
          </p>
        </motion.div>

        {/* Level + XP summary */}
        <div className="grid gap-4 md:grid-cols-3">
          <motion.div
            className="glass-panel relative overflow-hidden rounded-2xl p-5 md:col-span-2"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-amber-400/10 blur-[40px]" />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-[0_0_24px_-8px_rgb(251,191,36/0.4)]">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="type-caption font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    level
                  </p>
                  <p className="type-h2 tabular-nums text-gradient">
                    {level?.currentLevel ?? 1}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="type-caption font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  total xp
                </p>
                <p className="mt-1 type-h2 tabular-nums">
                  {level?.totalXp ?? 0}
                </p>
              </div>
            </div>
            <div className="mt-5">
              <div className="relative h-5 w-full overflow-hidden rounded-full bg-white/10">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary via-cyan-300 to-[oklch(0.82_0.13_85)]"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${Math.round((level?.progressToNext ?? 0) * 100)}%`,
                  }}
                  transition={{ duration: 1.2, ease: "easeOut", delay: 0.3 }}
                />
              </div>
              <p className="mt-2 type-mono text-muted-foreground">
                {level?.xpToNext ?? 0} XP to level {(level?.currentLevel ?? 1) + 1}
              </p>
            </div>
          </motion.div>

          <motion.div
            className="glass-panel rounded-2xl p-5"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between">
              <span className="type-caption font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                collected
              </span>
              <Medal className="size-4 text-amber-300" />
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-gradient">
                {earnedCount}
              </span>
              <span className="type-caption text-muted-foreground">/ {total}</span>
            </p>
            <p className="mt-1 type-caption text-muted-foreground">
              {total - earnedCount} still to unlock
            </p>
          </motion.div>
        </div>

        {/* Achievements grid */}
        {achievements === undefined ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="glass-panel rounded-2xl p-5">
                <div className="size-11 animate-pulse rounded-xl bg-white/5" />
                <div className="mt-4 h-4 w-3/4 animate-pulse rounded bg-white/5" />
                <div className="mt-2 h-3 w-full animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : achievements.length === 0 ? (
          <div className="glass-panel rounded-2xl p-16 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-amber-400/10">
              <Trophy className="size-8 text-amber-300/30" />
            </div>
            <h3 className="mt-6 type-h3 text-muted-foreground">
              No achievements yet
            </h3>
            <p className="mt-2 type-body text-muted-foreground/70">
              Start studying to unlock your first badge.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {achievements.map((def, index) => {
              const Icon = ICONS[def.icon] ?? Trophy;
              const earned = def.earnedAt !== null;
              const tier = TIER_STYLES[def.tier];
              return (
                <motion.div
                  key={def.id}
                  initial={{ opacity: 0, y: 20, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{
                    duration: 0.4,
                    delay: 0.04 * Math.min(index, 12),
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={cn(
                    "glass-panel relative flex flex-col rounded-2xl p-5 transition-all",
                    "hover-lift",
                    tier.depth,
                    earned
                      ? "shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]"
                      : "opacity-40",
                  )}
                >
                  {!earned && (
                    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-black/20">
                      <Lock className="size-6 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn("flex size-11 items-center justify-center rounded-xl", tier.icon)}>
                      <Icon className="size-5" />
                    </div>
                    <Badge className={cn("border", tier.chip)}>{tier.label}</Badge>
                  </div>
                  <h3 className="mt-4 type-body font-semibold tracking-tight">{def.name}</h3>
                  <p className="mt-1 flex-1 type-body text-muted-foreground">
                    {def.description}
                  </p>
                  {earned ? (
                    <p className="mt-3 flex items-center gap-1.5 type-caption font-semibold uppercase tracking-wide text-amber-300">
                      <Flame className="size-3" />
                      unlocked{" "}
                      {new Date(def.earnedAt ?? 0).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  ) : (
                    <p className="mt-3 flex items-center gap-1.5 type-caption uppercase tracking-wide text-muted-foreground/70">
                      <Lock className="size-3" />
                      locked
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Recent XP feed */}
        <motion.div
          className="glass-panel rounded-2xl p-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.35)]">
              <Zap className="size-4" />
            </div>
            <p className="type-body font-semibold">Recent XP · last 10 events</p>
            <span className="ml-auto type-mono text-[10px] text-muted-foreground">
              +{level?.totalXp ?? 0} total
            </span>
          </div>
          <div className="mt-3 flex flex-col">
            {level?.recentXp.length === 0 ? (
              <p className="py-4 text-center type-body text-muted-foreground">
                Nothing yet — your first quiz, focus session or daily challenge will
                show up here.
              </p>
            ) : (
              level?.recentXp.map((event, index) => (
                <div
                  key={`${event.createdAt}-${index}`}
                  className={cn(
                    "flex items-center justify-between gap-3 py-2.5",
                    index > 0 && "border-t border-white/5",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-amber-400/10 type-mono font-bold text-amber-300">
                      +{event.amount}
                    </div>
                    <div>
                      <p className="type-body font-semibold">
                        {XP_REASON_LABELS[event.reason] ?? event.reason}
                      </p>
                      <p className="type-caption uppercase tracking-wide text-muted-foreground">
                        {new Date(event.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                  <Map className="size-3.5 text-muted-foreground/40" />
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </DashboardShell>
  );
}
