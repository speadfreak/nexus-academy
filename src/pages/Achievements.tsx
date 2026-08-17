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
import { Progress } from "@/components/ui/progress";
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
  { chip: string; icon: string; label: string }
> = {
  bronze: {
    chip: "border-orange-400/25 bg-orange-400/10 text-orange-300",
    icon: "bg-orange-400/15 text-orange-300",
    label: "Bronze",
  },
  silver: {
    chip: "border-slate-300/25 bg-slate-300/10 text-slate-200",
    icon: "bg-slate-300/15 text-slate-200",
    label: "Silver",
  },
  gold: {
    chip: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    icon: "bg-amber-400/15 text-amber-300",
    label: "Gold",
  },
};

export default function Achievements() {
  const achievements = useQuery(api.achievements.getMyAchievements);
  const level = useQuery(api.xp.getMyLevel);

  const earnedCount = achievements?.filter((a) => a.earnedAt !== null).length ?? 0;
  const total = achievements?.length ?? 0;

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            gamification · progress
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Achievements
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Earned through real study — quizzes, focus, streaks, plans and daily challenges.
          </p>
        </div>

        {/* Level + XP summary */}
        <div className="grid gap-4 md:grid-cols-3">
          <div className="glass-panel rounded-2xl p-5 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Sparkles className="size-5" />
                </div>
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    level
                  </p>
                  <p className="font-mono text-3xl font-extrabold tabular-nums text-gradient">
                    {level?.currentLevel ?? 1}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  total xp
                </p>
                <p className="mt-1 font-mono text-3xl font-extrabold tabular-nums">
                  {level?.totalXp ?? 0}
                </p>
              </div>
            </div>
            <div className="mt-4">
              <Progress
                value={Math.round((level?.progressToNext ?? 0) * 100)}
                className="h-2 rounded-full bg-white/10"
              />
              <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                {level?.xpToNext ?? 0} XP to level {(level?.currentLevel ?? 1) + 1}
              </p>
            </div>
          </div>

          <div className="glass-panel rounded-2xl p-5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                collected
              </span>
              <Medal className="size-4 text-primary" />
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold tabular-nums text-gradient">
                {earnedCount}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">/ {total}</span>
            </p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">
              {total - earnedCount} still to unlock
            </p>
          </div>
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
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {achievements.map((def, index) => {
              const Icon = ICONS[def.icon] ?? Trophy;
              const earned = def.earnedAt !== null;
              const tier = TIER_STYLES[def.tier];
              return (
                <motion.div
                  key={def.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.03 }}
                  className={cn(
                    "glass-panel relative flex flex-col rounded-2xl p-5 transition-colors",
                    earned ? "border-primary/20" : "opacity-90",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn("flex size-11 items-center justify-center rounded-xl", tier.icon)}>
                      <Icon className="size-5" />
                    </div>
                    <Badge className={cn("border", tier.chip)}>{tier.label}</Badge>
                  </div>
                  <h3 className="mt-4 text-sm font-bold tracking-tight">{def.name}</h3>
                  <p className="mt-1 flex-1 text-xs leading-5 text-muted-foreground">
                    {def.description}
                  </p>
                  {earned ? (
                    <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary">
                      <Flame className="size-3" />
                      unlocked{" "}
                      {new Date(def.earnedAt ?? 0).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  ) : (
                    <p className="mt-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
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
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              recent xp · last 10 events
            </span>
            <Zap className="size-3.5 text-primary/60" />
          </div>
          <div className="mt-3 flex flex-col">
            {level?.recentXp.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
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
                    <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 font-mono text-xs font-bold text-primary">
                      +{event.amount}
                    </div>
                    <div>
                      <p className="text-xs font-semibold">
                        {XP_REASON_LABELS[event.reason] ?? event.reason}
                      </p>
                      <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
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
        </div>
      </div>
    </DashboardShell>
  );
}
