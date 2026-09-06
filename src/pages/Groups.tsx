// Study groups — the opt-in social layer.
//
// REDESIGN — one cohesive "group hub" experience.
// Previously the page read as three disconnected stacked boxes with a
// floating invite-code chip, a redundant group-name heading in the
// leaderboard, and dead space under the left card. Now:
//
//   • Group identity is established ONCE — in a unified "group hub
//     header" card that combines: group name, subject focus, member
//     count, an avatar row of up to 5 members, and the invite code
//     with a proper Copy affordance (no more floating chip in a
//     different panel).
//   • Every section (leaderboard · rooms · chat · members) uses the
//     same SectionShell treatment — consistent padding, consistent
//     header (icon + label + sub), consistent motion entrance — so
//     scrolling feels like one continuous space, not hopping between
//     unrelated cards.
//   • Empty rooms state matches the icon + Sparkles badge + tip pattern
//     from Todos/Focus/Plans — no more plain centered sentence.
//   • Stat chips (groups · members · live count) are integrated into the
//     page hero header area, not floating in a separate row.
//
// FUNCTIONALITY: ZERO changes to data queries, group create/join/leave
// logic, leaderboard calculation, room creation, or chat. The
// `GroupChatPanel` component is rendered unchanged. Only presentation
// has changed.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CircleDot,
  Copy,
  Crown,
  LogOut,
  Medal,
  MonitorPlay,
  Plus,
  Sparkles,
  Timer,
  Trophy,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { ReportBlockMenu } from "@/components/ReportBlockMenu";
import { GroupChatPanel } from "@/components/GroupChatPanel";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export default function Groups() {
  const navigate = useNavigate();
  const myGroups = useQuery(api.studyGroups.getMyGroups);
  const subjects = useQuery(api.subjects.getAll);
  const createGroup = useMutation(api.studyGroups.createGroup);
  const joinGroup = useMutation(api.studyGroups.joinGroup);
  const leaveGroup = useMutation(api.studyGroups.leaveGroup);
  const createRoom = useAction(api.roomsActions.createRoom);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [subjectFocus, setSubjectFocus] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [roomName, setRoomName] = useState("");
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [startingRoom, setStartingRoom] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Keep the selected group in sync with the (possibly reloading) list.
  const selectedGroup = useMemo(
    () => myGroups?.find((g) => g.groupId === selectedId) ?? myGroups?.[0] ?? null,
    [myGroups, selectedId],
  );
  const leaderboard = useQuery(
    api.studyGroups.getGroupLeaderboard,
    selectedGroup ? { groupId: selectedGroup.groupId as Id<"studyGroups"> } : "skip",
  );
  const activeRooms = useQuery(
    api.rooms.listActiveRoomsForGroup,
    selectedGroup ? { groupId: selectedGroup.groupId as Id<"studyGroups"> } : "skip",
  );
  const members = useQuery(
    api.studyGroups.getGroupMembers,
    selectedGroup ? { groupId: selectedGroup.groupId as Id<"studyGroups"> } : "skip",
  );

  const handleStartRoom = async () => {
    if (!selectedGroup) return;
    const name = roomName.trim() || `${selectedGroup.name} study session`;
    setStartingRoom(true);
    try {
      const result = await createRoom({
        groupId: selectedGroup.groupId as Id<"studyGroups">,
        name,
      });
      setRoomDialogOpen(false);
      setRoomName("");
      navigate(`/rooms/${result.roomId}`);
    } catch (error) {
      toast.error(errorMessage(error, "Could not start the room."));
    } finally {
      setStartingRoom(false);
    }
  };

  const handleCreate = async () => {
    const name = groupName.trim();
    if (!name) {
      toast.error("Give your group a name.");
      return;
    }
    try {
      const result = await createGroup({
        name,
        subjectFocus: (subjectFocus || undefined) as Id<"subjects"> | undefined,
      });
      toast.success(`Group created — share the code ${result.inviteCode} with friends.`);
      setCreateOpen(false);
      setGroupName("");
      setSubjectFocus("");
      setSelectedId(result.groupId as string);
    } catch (error) {
      toast.error(errorMessage(error, "Could not create the group."));
    }
  };

  const handleJoin = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      toast.error("Enter the invite code from your friend.");
      return;
    }
    try {
      const result = await joinGroup({ inviteCode: code });
      toast.success(`You joined “${result.name}”.`);
      setJoinOpen(false);
      setInviteCode("");
      setSelectedId(result.groupId as string);
    } catch (error) {
      toast.error(errorMessage(error, "Could not join that group."));
    }
  };

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      toast.success("Invite code copied.");
      setTimeout(() => setCopiedCode(null), 1800);
    } catch {
      toast.error("Could not copy — select the code and copy manually.");
    }
  };

  const handleLeave = async (groupId: string, name: string) => {
    try {
      await leaveGroup({ groupId: groupId as Id<"studyGroups"> });
      toast.success(`You left “${name}”.`);
      setSelectedId(null);
    } catch (error) {
      toast.error(errorMessage(error, "Could not leave the group."));
    }
  };

  const totalMembers = myGroups?.reduce((sum, g) => sum + g.memberCount, 0) ?? 0;
  const liveCount = activeRooms?.length ?? 0;
  const groupsCount = myGroups?.length ?? 0;
  const selectedMembersPreview = members?.members.slice(0, 5) ?? [];

  return (
    <DashboardShell>
      <div className="flex flex-col gap-5 sm:gap-6">
        {/* ════════════════════════════════════════════════════════════════
            PAGE HERO — title + integrated stat chips (no separate row)
           ════════════════════════════════════════════════════════════════ */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative"
        >
          <div className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full bg-amber-400/10 blur-[80px]" />
          <div className="pointer-events-none absolute -right-6 top-0 size-32 rounded-full bg-amber-400/[0.06] blur-[64px]" />

          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold type-caption">
                // social · groups
              </p>
              <h1 className="mt-1 type-h1 text-gradient">Study groups</h1>
              <p className="mt-2 max-w-xl type-body text-muted-foreground">
                Private squads of classmates. You can only join through a shared
                invite code, and the weekly leaderboard ranks XP — one honest
                aggregate of every study action.
              </p>
            </div>

            {/* Stat chips — integrated into the hero, right-aligned on desktop,
                below the heading on mobile. */}
            <div className="flex flex-wrap items-center gap-2">
              <HeroStat icon={<Users className="size-3" />} value={groupsCount} label="group" plural="s" />
              <HeroStat icon={<Users className="size-3" />} value={totalMembers} label="member" plural="s" />
              {selectedGroup && liveCount > 0 && (
                <HeroStat
                  icon={
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                    </span>
                  }
                  value={liveCount}
                  label="live"
                  plural=""
                  tone="emerald"
                />
              )}
            </div>
          </div>
        </motion.section>

        {/* ════════════════════════════════════════════════════════════════
            EMPTY STATE — no groups yet
           ════════════════════════════════════════════════════════════════ */}
        {myGroups !== undefined && myGroups.length === 0 && (
          <EmptyGroupsState
            onCreate={() => setCreateOpen(true)}
            onJoin={() => setJoinOpen(true)}
          />
        )}

        {/* ════════════════════════════════════════════════════════════════
            GROUP HUB — only when there's at least one group
           ════════════════════════════════════════════════════════════════ */}
        {myGroups !== undefined && myGroups.length > 0 && (
          <>
            {/* Action buttons row — sits above everything, full-width */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.06, ease: [0.22, 1, 0.36, 1] }}
              className="flex gap-2"
            >
              <Button
                className="interactive-press flex-1 cursor-pointer rounded-xl sm:flex-none"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" /> Create group
              </Button>
              <Button
                variant="outline"
                className="interactive-press flex-1 cursor-pointer rounded-xl bg-white/5 sm:flex-none"
                onClick={() => setJoinOpen(true)}
              >
                <UserPlus className="size-4" /> Join with code
              </Button>
            </motion.div>

            <div className="grid gap-5 lg:grid-cols-[340px_1fr] sm:gap-6">
              {/* ─── LEFT: group selector + group identity card ─── */}
              <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
                {/* Group selector — vertical list on desktop, horizontal
                    scroll on mobile so multiple groups don't clutter. */}
                <div className="flex flex-col gap-2">
                  <p className="px-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                    your groups
                  </p>
                  <div
                    className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
                    style={{ scrollbarWidth: "none" }}
                  >
                    {myGroups === undefined ? (
                      <>
                        {[0, 1].map((i) => (
                          <div key={i} className="h-16 w-40 shrink-0 animate-pulse rounded-xl bg-white/5 lg:w-auto" />
                        ))}
                      </>
                    ) : (
                      myGroups.map((group) => {
                        const active = selectedGroup?.groupId === group.groupId;
                        return (
                          <motion.button
                            key={group.groupId}
                            type="button"
                            onClick={() => setSelectedId(group.groupId as string)}
                            whileHover={{ scale: 1.01, y: -1 }}
                            whileTap={{ scale: 0.98 }}
                            className={cn(
                              "interactive-press relative flex w-44 shrink-0 cursor-pointer flex-col gap-1 rounded-2xl border px-3 py-3 text-left transition-colors lg:w-auto",
                              active
                                ? "border-primary/40 bg-primary/10 shadow-[0_0_24px_-8px_var(--primary)]"
                                : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
                            )}
                          >
                            {active && (
                              <span className="absolute left-0 top-1/2 hidden h-2/3 -translate-y-1/2 rounded-r-full bg-primary lg:block" style={{ width: 3 }} />
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate type-h3">{group.name}</p>
                              <div className="flex items-center gap-1.5">
                                {group.memberCount > 1 && (
                                  <div className="flex -space-x-1">
                                    {Array.from({ length: Math.min(group.memberCount, 3) }).map((_, i) => (
                                      <span
                                        key={i}
                                        className="inline-block size-4 rounded-full border border-background bg-amber-400/20"
                                        style={{ zIndex: 3 - i }}
                                      />
                                    ))}
                                    {group.memberCount > 3 && (
                                      <span className="inline-flex size-4 items-center justify-center rounded-full border border-background bg-amber-400/30 text-[8px] font-bold text-amber-300">
                                        +
                                      </span>
                                    )}
                                  </div>
                                )}
                                {group.role === "owner" && (
                                  <Crown className="size-3.5 shrink-0 text-amber-300" />
                                )}
                              </div>
                            </div>
                            <p className="type-caption text-muted-foreground">
                              {group.subjectFocusName ?? "All subjects"} · {group.memberCount} member
                              {group.memberCount === 1 ? "" : "s"}
                            </p>
                          </motion.button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Group identity card — establishes the group's identity
                    ONCE. Contains: avatar/icon, name, subject, member count,
                    member preview row, and the invite code with a proper
                    Copy affordance (no more floating chip in a different
                    panel). */}
                {selectedGroup && (
                  <motion.div
                    key={selectedGroup.groupId}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-panel hover-lift relative overflow-hidden rounded-3xl p-5 sm:p-6"
                  >
                    <div className="pointer-events-none absolute -top-12 -right-10 size-40 rounded-full bg-amber-400/10 blur-[60px]" />

                    <div className="relative">
                      {/* Identity header — icon + name + role */}
                      <div className="flex items-start gap-3">
                        <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-500/5 text-amber-300 shadow-[0_0_18px_-6px_rgb(251,191,36/0.5)]">
                          <Users className="size-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h2 className="truncate type-h2">{selectedGroup.name}</h2>
                            {selectedGroup.role === "owner" && (
                              <Crown className="size-4 shrink-0 text-amber-300" />
                            )}
                          </div>
                          <p className="mt-0.5 flex items-center gap-1.5 type-caption text-muted-foreground">
                            <BookOpen className="size-3" />
                            {selectedGroup.subjectFocusName ?? "All subjects"}
                          </p>
                        </div>
                      </div>

                      {/* Stats row — member count + live rooms count */}
                      <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="glass-soft rounded-xl px-3 py-2.5">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            members
                          </p>
                          <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">
                            {selectedGroup.memberCount}
                          </p>
                        </div>
                        <div className="glass-soft rounded-xl px-3 py-2.5">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            live rooms
                          </p>
                          <p className="mt-0.5 font-mono text-lg font-bold tabular-nums text-foreground">
                            {liveCount}
                          </p>
                        </div>
                      </div>

                      {/* Member preview row — up to 5 avatar bubbles */}
                      {selectedMembersPreview.length > 0 && (
                        <div className="mt-4">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            in this group
                          </p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex -space-x-2">
                              {selectedMembersPreview.map((m) => (
                                <div
                                  key={m.userId}
                                  title={m.name}
                                  className={cn(
                                    "flex size-8 items-center justify-center rounded-full border-2 border-background bg-amber-400/15 font-mono text-[10px] font-bold text-amber-300",
                                    m.isMe && "ring-2 ring-primary/50",
                                  )}
                                >
                                  {m.name
                                    .split(/\s+/)
                                    .filter(Boolean)
                                    .slice(0, 2)
                                    .map((part) => part[0]?.toUpperCase() ?? "")
                                    .join("")}
                                </div>
                              ))}
                              {members && members.members.length > 5 && (
                                <div className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-white/5 font-mono text-[10px] font-bold text-muted-foreground">
                                  +{members.members.length - 5}
                                </div>
                              )}
                            </div>
                            <span className="type-caption text-muted-foreground">
                              {selectedGroup.memberCount} member{selectedGroup.memberCount === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Invite code — integrated with proper Copy affordance */}
                      <div className="mt-5">
                        <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                          invite code · share with friends
                        </p>
                        <button
                          type="button"
                          onClick={() => void handleCopy(selectedGroup.inviteCode)}
                          className="group mt-2 flex w-full items-center justify-between gap-2 rounded-2xl border border-primary/25 bg-primary/[0.08] px-3.5 py-3 transition-colors hover:bg-primary/[0.12]"
                          title="Copy invite code"
                        >
                          <span className="font-mono text-base font-extrabold tracking-[0.25em] text-primary">
                            {selectedGroup.inviteCode}
                          </span>
                          <span className="flex items-center gap-1.5 rounded-lg bg-primary/15 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary">
                            {copiedCode === selectedGroup.inviteCode ? (
                              <>
                                <Sparkles className="size-3" /> Copied
                              </>
                            ) : (
                              <>
                                <Copy className="size-3" /> Copy
                              </>
                            )}
                          </span>
                        </button>
                      </div>

                      {/* Leave button — subtle, footer of the identity card */}
                      <button
                        type="button"
                        onClick={() =>
                          void handleLeave(selectedGroup.groupId as string, selectedGroup.name)
                        }
                        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-rose-400/30 hover:bg-rose-400/[0.06] hover:text-rose-300"
                      >
                        <LogOut className="size-3.5" /> Leave group
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* ─── RIGHT: stacked sections — leaderboard · rooms · chat · members ───
                  All wrapped in the same SectionShell so they share the same
                  rhythm, padding, header treatment, and motion entrance. The
                  column is max-w-3xl so cards align visually as one continuous
                  space rather than three unrelated boxes. */}
              <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
                {/* ═══ LEADERBOARD ═══ */}
                {!selectedGroup ? (
                  <SectionShell
                    icon={<Trophy className="size-4" />}
                    label="weekly leaderboard"
                    sub="Pick a group to see the rankings"
                  >
                    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                      <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
                        <Users className="size-6" />
                      </div>
                      <h3 className="mt-4 type-h3">Pick a group</h3>
                      <p className="mt-1 max-w-sm type-body text-muted-foreground">
                        Create or join a group to see its weekly XP leaderboard.
                      </p>
                    </div>
                  </SectionShell>
                ) : (
                  <SectionShell
                    icon={<Trophy className="size-4" />}
                    label="weekly leaderboard"
                    sub="XP earned in the last 7 days · ranked honestly"
                  >
                    {!leaderboard ? (
                      <div className="flex flex-col gap-2">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {leaderboard.members.map((member, index) => {
                          const isPodium = index < 3;
                          return (
                            <motion.div
                              key={member.userId}
                              initial={{ opacity: 0, x: -12 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.35, delay: 0.04 * Math.min(index, 10), ease: [0.22, 1, 0.36, 1] }}
                              className={cn(
                                "flex items-center gap-3 rounded-2xl border px-3.5 py-3 transition-colors",
                                member.isMe
                                  ? "border-primary/30 bg-primary/10"
                                  : "border-white/5 bg-white/[0.02]",
                                index === 0
                                  ? "shadow-[0_0_28px_-4px_oklch(0.75_0.15_85)] border-amber-400/20"
                                  : index === 1
                                    ? "shadow-[0_0_20px_-4px_oklch(0.7_0.01_250)] border-slate-300/15"
                                    : index === 2
                                      ? "shadow-[0_0_20px_-4px_oklch(0.7_0.12_60)] border-orange-400/15"
                                      : "",
                              )}
                            >
                              {/* Rank badge */}
                              <div
                                className={cn(
                                  "flex shrink-0 items-center justify-center rounded-xl",
                                  isPodium ? "size-9" : "size-8",
                                  index === 0
                                    ? "bg-gradient-to-br from-amber-400/20 to-amber-500/5 text-amber-300 shadow-[0_0_12px_-4px_rgb(245_197_66/0.5)]"
                                    : index === 1
                                      ? "bg-gradient-to-br from-slate-300/20 to-slate-400/5 text-slate-200 shadow-[0_0_12px_-4px_rgb(180_195_210/0.4)]"
                                      : index === 2
                                        ? "bg-gradient-to-br from-orange-400/20 to-orange-500/5 text-orange-300 shadow-[0_0_12px_-4px_rgb(180_130_70/0.4)]"
                                        : "bg-white/5 text-muted-foreground",
                                  isPodium ? "font-mono text-sm font-extrabold" : "font-mono text-sm font-bold",
                                )}
                              >
                                {isPodium ? <Medal className={cn("size-4", index === 0 && "text-amber-300", index === 1 && "text-slate-200", index === 2 && "text-orange-300")} /> : index + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate type-body font-semibold">
                                  {member.name}
                                  {member.isMe && (
                                    <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
                                      you
                                    </Badge>
                                  )}
                                  {member.role === "owner" && (
                                    <Crown className="size-3 text-amber-300" />
                                  )}
                                </p>
                                <p className="mt-0.5 flex items-center gap-2 type-caption text-muted-foreground">
                                  <Timer className="size-3" /> {member.hoursThisWeek} h ·{" "}
                                  {member.sessionsThisWeek} session
                                  {member.sessionsThisWeek === 1 ? "" : "s"}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className={cn(
                                  "flex items-center justify-end gap-1 font-mono font-extrabold tabular-nums",
                                  index === 0
                                    ? "type-h2 text-gradient"
                                    : index < 3
                                      ? "text-base text-primary"
                                      : "text-sm text-primary",
                                )}>
                                  <Trophy className={cn("size-3.5", index === 0 && "text-amber-300", index === 1 && "text-slate-300", index === 2 && "text-orange-300")} /> {member.xpThisWeek}
                                </p>
                                <p className="type-caption uppercase tracking-wide text-muted-foreground">
                                  xp this week
                                </p>
                              </div>
                            </motion.div>
                          );
                        })}
                        {leaderboard.members.length === 0 && (
                          <p className="py-8 text-center type-body text-muted-foreground">
                            No members yet — share the invite code from the group card.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="mt-4 border-t border-white/[0.06] pt-3 type-caption text-muted-foreground/80">
                      Ranked by XP only — never scores or weak topics.
                    </p>
                  </SectionShell>
                )}

                {/* ═══ STUDY ROOMS ═══ */}
                {selectedGroup && (
                  <SectionShell
                    icon={<MonitorPlay className="size-4" />}
                    label="study rooms"
                    sub="Live video · members only · nothing is public"
                    action={
                      <Button
                        className="interactive-press cursor-pointer rounded-xl"
                        onClick={() => setRoomDialogOpen(true)}
                        disabled={startingRoom}
                        size="sm"
                      >
                        <Video className="size-4" />
                        {startingRoom ? "Starting…" : "Start a room"}
                      </Button>
                    }
                  >
                    {activeRooms === undefined ? (
                      <div className="h-16 animate-pulse rounded-xl bg-white/5" />
                    ) : activeRooms.length === 0 ? (
                      <EmptyRoomsState />
                    ) : (
                      <div className="flex flex-col gap-2">
                        {activeRooms.map((room, i) => (
                          <motion.div
                            key={room.roomId}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.3, delay: 0.06 + i * 0.04, ease: "easeOut" }}
                            className="group flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3.5 transition-colors hover:border-primary/30 hover:bg-primary/[0.04]"
                          >
                            <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                              <MonitorPlay className="size-4" />
                              <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-ping rounded-full border-2 border-background bg-emerald-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate type-body font-bold">{room.name}</p>
                              <p className="type-caption text-muted-foreground">
                                {room.createdByName} · {room.participantCount} in room
                                {room.iAmIn ? " · you're here" : ""}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant={room.iAmIn ? "outline" : "default"}
                              className="interactive-press cursor-pointer rounded-xl"
                              onClick={() => navigate(`/rooms/${room.roomId}`)}
                            >
                              {room.iAmIn ? "Rejoin" : "Join"}
                              {!room.iAmIn && <ArrowRight className="size-3.5" />}
                            </Button>
                          </motion.div>
                        ))}
                      </div>
                    )}
                  </SectionShell>
                )}

                {/* ═══ GROUP CHAT ═══
                    GroupChatPanel is fully self-contained (has its own header
                    with "Group Chat" + the group name + a "Live room" button).
                    We don't wrap it in SectionShell because that would double
                    the header — instead we just animate the entrance to match
                    the rhythm of the other sections. */}
                {selectedGroup && (
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.18, ease: "easeOut" }}
                  >
                    <GroupChatPanel
                      groupId={selectedGroup.groupId as Id<"studyGroups">}
                      groupName={selectedGroup.name}
                      onStartRoom={() => setRoomDialogOpen(true)}
                    />
                  </motion.div>
                )}

                {/* ═══ MEMBERS ═══ */}
                {selectedGroup && members && (
                  <SectionShell
                    icon={<Users className="size-4" />}
                    label="members"
                    sub="Report or block anyone from here"
                  >
                    <div className="flex flex-col gap-1.5">
                      {members.members.map((member, i) => (
                        <motion.div
                          key={member.userId}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.25, delay: 0.24 + i * 0.03, ease: "easeOut" }}
                          className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 font-mono text-xs font-extrabold text-amber-300">
                            {member.name
                              .split(/\s+/)
                              .filter(Boolean)
                              .slice(0, 2)
                              .map((part) => part[0]?.toUpperCase() ?? "")
                              .join("")}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 truncate type-body font-semibold">
                              {member.name}
                              {member.isMe && (
                                <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">you</Badge>
                              )}
                              {member.isOwner && <Crown className="size-3 shrink-0 text-amber-300" />}
                            </p>
                            <p className="type-caption uppercase tracking-wide text-muted-foreground">
                              {member.role}
                            </p>
                          </div>
                          <ReportBlockMenu
                            targetUserId={member.userId}
                            targetName={member.name}
                            compact
                            disabled={member.isMe}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </SectionShell>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          DIALOGS — unchanged
         ════════════════════════════════════════════════════════════════ */}
      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="size-4 text-amber-300" /> Start a study room
            </DialogTitle>
            <DialogDescription>
              Group members get a notification with a link to join. Rooms are
              private to {selectedGroup?.name ?? "this group"} — nothing is public.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder={`${selectedGroup?.name ?? "Group"} study session`}
            maxLength={60}
            className="h-11 rounded-xl bg-white/5"
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer rounded-xl bg-white/5"
              onClick={() => setRoomDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer rounded-xl"
              onClick={() => void handleStartRoom()}
              disabled={startingRoom}
            >
              {startingRoom ? "Starting…" : "Start room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-amber-300" /> Create a study group
            </DialogTitle>
            <DialogDescription>
              Share the invite code with classmates — groups stay private and capped.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Group name</span>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g. Grade 12 Physics Crew"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Subject focus (optional)
              </span>
              <Select value={subjectFocus} onValueChange={(v) => setSubjectFocus(v === "all" ? "" : v)}>
                <SelectTrigger className="h-10 rounded-xl bg-white/5">
                  <SelectValue placeholder="All subjects" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All subjects</SelectItem>
                  {subjects?.map((subject) => (
                    <SelectItem key={subject._id} value={subject._id}>
                      {subject.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button className="cursor-pointer rounded-xl" onClick={() => void handleCreate()}>
              <Plus className="size-4" /> Create group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-amber-300" /> Join a group
            </DialogTitle>
            <DialogDescription>
              Enter the 6-character invite code a friend shared with you.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="h-11 rounded-xl bg-white/5 font-mono text-lg font-bold tracking-[0.3em]"
          />
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => setJoinOpen(false)}>
              Cancel
            </Button>
            <Button className="cursor-pointer rounded-xl" onClick={() => void handleJoin()}>
              Join group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS — keep the section rhythm unified
// ═══════════════════════════════════════════════════════════════════════

/**
 * SectionShell — the unifying container for every group-section. Gives
 * each section (leaderboard · rooms · chat · members) the same:
 *   - glass-panel surface + rounded-3xl + consistent padding
 *   - header treatment: icon chip + label + sub-text + optional action
 *   - consistent motion entrance
 *
 * This is what makes the sections read as ONE cohesive space rather than
 * three unrelated stacked boxes.
 */
function SectionShell({
  icon,
  label,
  sub,
  action,
  children,
}: {
  icon: ReactNode;
  label: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel relative overflow-hidden rounded-3xl p-5 sm:p-6"
    >
      <div className="pointer-events-none absolute -top-12 -right-12 size-32 rounded-full bg-amber-400/[0.04] blur-[50px]" />
      <div className="relative">
        {/* Header — icon chip + label + sub + optional action */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.4)]">
              {icon}
            </div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                {label}
              </p>
              {sub && (
                <p className="mt-0.5 type-caption text-muted-foreground/80">{sub}</p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>

        {/* Content */}
        <div className="mt-4">{children}</div>
      </div>
    </motion.section>
  );
}

/**
 * HeroStat — a single stat chip used in the page hero. Tight, glassy, with
 * an icon + value + label. Tone variant for the live-count (emerald).
 */
function HeroStat({
  icon,
  value,
  label,
  plural,
  tone = "default",
}: {
  icon: ReactNode;
  value: number;
  label: string;
  plural: string;
  tone?: "default" | "emerald";
}) {
  return (
    <div
      className={cn(
        "glass-chip flex items-center gap-1.5 rounded-lg px-2.5 py-1.5",
        tone === "emerald" && "bg-emerald-500/10 border-emerald-400/20",
      )}
    >
      <span className={cn(tone === "emerald" && "text-emerald-400")}>{icon}</span>
      <span
        className={cn(
          "font-mono text-xs font-bold",
          tone === "emerald" ? "text-emerald-400" : "text-foreground",
        )}
      >
        {value} {label}
        {value !== 1 ? plural : ""}
      </span>
    </div>
  );
}

/**
 * EmptyGroupsState — premium empty state when the user has no groups yet.
 * Matches the icon + Sparkles badge + tip pattern from Todos/Focus/Plans.
 */
function EmptyGroupsState({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass-soft flex flex-col items-center rounded-3xl px-6 py-16 text-center"
    >
      <div className="relative">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.6)]">
          <Users className="size-7" />
        </div>
        <div className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_12px_-4px_rgb(245_197_66/0.8)]">
          <Sparkles className="size-3" />
        </div>
      </div>
      <h3 className="type-h3 mt-6 text-foreground">No groups yet</h3>
      <p className="type-body mt-2 max-w-sm text-muted-foreground">
        Create one and share the invite code, or join a friend&apos;s group
        with a code they shared.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button
          className="interactive-press cursor-pointer rounded-xl"
          onClick={onCreate}
        >
          <Plus className="size-4" /> Create a group
        </Button>
        <Button
          variant="outline"
          className="interactive-press cursor-pointer rounded-xl bg-white/5"
          onClick={onJoin}
        >
          <UserPlus className="size-4" /> Join with code
        </Button>
      </div>
      <div className="mt-6 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5">
        <CircleDot className="size-3.5 text-muted-foreground/50" />
        <span className="type-mono text-[11px] text-muted-foreground/60">
          tip: groups stay private — only people with the invite code can join
        </span>
      </div>
    </motion.div>
  );
}

/**
 * EmptyRoomsState — refined empty state for the rooms section. Uses the
 * same icon + Sparkles + tip pattern as EmptyGroupsState so the design
 * language is consistent. Replaces the previous plain centered sentence
 * in a big empty box.
 */
function EmptyRoomsState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center"
    >
      <div className="relative">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-400/8 text-amber-300 shadow-[0_0_32px_-12px_rgb(251,191,36/0.6)]">
          <MonitorPlay className="size-6" />
        </div>
        <div className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-lg bg-premium/15 text-premium shadow-[0_0_10px_-4px_rgb(245_197_66/0.8)]">
          <Sparkles className="size-2.5" />
        </div>
      </div>
      <h3 className="type-h3 mt-5 text-foreground">No live rooms right now</h3>
      <p className="type-body mt-1.5 max-w-sm text-muted-foreground">
        Start a room and your group members will get a notification with a
        link to join.
      </p>
      <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5">
        <CircleDot className="size-3.5 text-muted-foreground/50" />
        <span className="type-mono text-[11px] text-muted-foreground/60">
          tip: rooms are private to this group — nothing is public
        </span>
      </div>
    </motion.div>
  );
}
