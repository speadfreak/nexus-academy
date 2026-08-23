// Study groups — the opt-in social layer.
//
// Groups are only reachable via a shared invite code (no public discovery),
// capped at GROUP_MAX_SIZE, and the weekly leaderboard is members-only,
// ranking a single honest aggregate: XP earned this week. Weak topics and
// quiz answers are never exposed.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  BookOpen,
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
import { useMemo, useState } from "react";
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
      toast.success("Invite code copied.");
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

  return (
    <DashboardShell>
      <div className="flex flex-col gap-6">
        {/* ── Header ── */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="pointer-events-none absolute -top-10 -left-10 size-40 rounded-full bg-amber-400/10 blur-[80px]" />
          <div className="pointer-events-none absolute -right-6 top-0 size-32 rounded-full bg-amber-400/[0.06] blur-[64px]" />
          <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
            // social · groups
          </p>
          <h1 className="mt-1 text-gradient type-h1">
            Study groups
          </h1>
          <p className="mt-1 max-w-xl type-body text-muted-foreground">
            Private squads of classmates. You can only join through a shared
            invite code, and the weekly leaderboard ranks XP — one honest
            aggregate of every study action.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="glass-chip flex items-center gap-1.5 rounded-lg px-2.5 py-1">
              <Users className="size-3 text-amber-300" />
              <span className="type-mono font-bold">{myGroups?.length ?? 0} groups</span>
            </div>
            <div className="glass-chip flex items-center gap-1.5 rounded-lg px-2.5 py-1">
              <span className="type-mono font-bold">{myGroups?.reduce((sum, g) => sum + g.memberCount, 0) ?? 0} members</span>
            </div>
            {selectedGroup && (activeRooms?.length ?? 0) > 0 && (
              <div className="glass-chip flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2.5 py-1">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
                </span>
                <span className="type-mono font-bold text-emerald-400">{activeRooms?.length ?? 0} live</span>
              </div>
            )}
          </div>
        </motion.div>

        <motion.div
          className="grid gap-4 lg:grid-cols-[320px_1fr]"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Left: my groups + actions */}
          <div className="flex flex-col gap-4">
            <div className="flex gap-2">
              <Button
                className="flex-1 cursor-pointer rounded-xl"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" /> Create
              </Button>
              <Button
                variant="outline"
                className="flex-1 cursor-pointer rounded-xl bg-white/5"
                onClick={() => setJoinOpen(true)}
              >
                <UserPlus className="size-4" /> Join
              </Button>
            </div>

            <div className="glass-panel flex flex-col gap-1.5 rounded-2xl p-2.5">
              {myGroups === undefined ? (
                <>
                  {[0, 1].map((i) => (
                    <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
                  ))}
                </>
              ) : myGroups.length === 0 ? (
                <div className="relative flex flex-col items-center px-4 py-10 text-center overflow-hidden">
                  <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 size-28 rounded-full bg-amber-400/10 blur-[40px]" />
                  <div className="relative flex size-11 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-[0_0_24px_-8px_rgb(251,191,36/0.4)]">
                    <Users className="size-5" />
                  </div>
                  <p className="relative mt-3 type-h3">No groups yet</p>
                  <p className="relative mt-1 max-w-[220px] type-caption leading-5 text-muted-foreground">
                    Create one and share the invite code, or join a friend&apos;s group.
                  </p>
                </div>
              ) : (
                myGroups.map((group) => (
                  <motion.button
                    key={group.groupId}
                    type="button"
                    onClick={() => setSelectedId(group.groupId as string)}
                    whileHover={{ scale: 1.01, y: -1 }}
                    whileTap={{ scale: 0.98 }}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-xl px-3 py-3 text-left transition-colors",
                      selectedGroup?.groupId === group.groupId
                        ? "border-l-2 border-l-primary bg-primary/10 shadow-[0_0_20px_-4px_var(--primary)]"
                        : "hover:bg-white/5",
                    )}
                  >
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
                ))
              )}
            </div>
          </div>

          {/* Right: leaderboard */}
          <div className="glass-panel rounded-2xl p-5">
            {!selectedGroup ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300">
                  <Users className="size-6" />
                </div>
                <h3 className="mt-4 type-h3">Pick a group</h3>
                <p className="mt-1 max-w-sm type-body text-muted-foreground">
                  Create or join a group to see its weekly XP leaderboard.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="type-caption font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      weekly leaderboard · last 7 days
                    </p>
                    <h2 className="mt-1 type-h2">
                      {selectedGroup.name}
                    </h2>
                    {selectedGroup.subjectFocusName && (
                      <p className="mt-0.5 flex items-center gap-1.5 type-caption text-muted-foreground">
                        <BookOpen className="size-3" /> {selectedGroup.subjectFocusName}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy(selectedGroup.inviteCode)}
                    className="glass-chip flex cursor-pointer items-center gap-2 rounded-xl border-primary/25 bg-primary/10 px-3 py-2 type-mono font-bold tracking-[0.15em] text-primary transition-colors hover:bg-primary/15"
                    title="Copy invite code"
                  >
                    {selectedGroup.inviteCode}
                    <Copy className="size-3.5" />
                  </button>
                </div>

                {!leaderboard ? (
                  <div className="mt-4 flex flex-col gap-3">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    {leaderboard.members.map((member, index) => {
                      const isPodium = index < 3;
                      return (
                        <motion.div
                          key={member.userId}
                          initial={{ opacity: 0, x: -12 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.35, delay: 0.04 * Math.min(index, 10), ease: [0.22, 1, 0.36, 1] }}
                          className={cn(
                            "flex items-center gap-3 rounded-xl border px-3 py-3 transition-colors",
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
                        No members yet — share the invite code.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                  <p className="type-caption text-muted-foreground">
                    {selectedGroup.memberCount} member{selectedGroup.memberCount === 1 ? "" : "s"}{" "}
                    · ranked by XP only — never scores or weak topics
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer rounded-xl text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      void handleLeave(selectedGroup.groupId as string, selectedGroup.name)
                    }
                  >
                    <LogOut className="size-3.5" /> Leave group
                  </Button>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>

      {/* Rooms section (group-scoped — no global directory) */}
      {selectedGroup && (
        <motion.div
          className="glass-panel rounded-2xl p-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12, ease: "easeOut" }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="type-caption font-bold uppercase tracking-[0.18em] text-muted-foreground">
                study rooms · live video + chat · members only
              </p>
              <h2 className="mt-1 type-h2">
                {selectedGroup.name} rooms
              </h2>
            </div>
            <Button
              className="cursor-pointer rounded-xl"
              onClick={() => setRoomDialogOpen(true)}
              disabled={startingRoom}
            >
              <Video className="size-4" />
              {startingRoom ? "Starting…" : "Start a room"}
            </Button>
          </div>

          {activeRooms === undefined ? (
            <div className="mt-4 h-16 animate-pulse rounded-xl bg-white/5" />
          ) : activeRooms.length === 0 ? (
            <p className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-6 text-center type-body text-muted-foreground">
              No live rooms right now — start one and your group members will get a notification.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {activeRooms.map((room, i) => (
                <motion.div
                  key={room.roomId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: 0.16 + i * 0.04, ease: "easeOut" }}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3"
                >
                  <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
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
                    className="cursor-pointer rounded-xl"
                    onClick={() => navigate(`/rooms/${room.roomId}`)}
                  >
                    {room.iAmIn ? "Rejoin" : "Join"}
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* Chat panel — consistent motion entrance */}
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

      {/* Member roster with per-person safety actions */}
      {selectedGroup && members && (
        <motion.div
          className="glass-panel rounded-2xl p-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.22, ease: "easeOut" }}
        >
          <p className="type-caption font-bold uppercase tracking-[0.18em] text-muted-foreground">
            members · report or block anyone from here
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
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
        </motion.div>
      )}

      {/* Start room dialog */}
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

      {/* Create dialog */}
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

      {/* Join dialog */}
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
