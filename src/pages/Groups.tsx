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
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            social · opt-in
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
            Study groups
          </h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Private squads of classmates. You can only join through a shared
            invite code, and the weekly leaderboard ranks XP — one honest
            aggregate of every study action.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
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
                <div className="flex flex-col items-center px-4 py-10 text-center">
                  <div className="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Users className="size-5" />
                  </div>
                  <p className="mt-3 text-sm font-bold tracking-tight">No groups yet</p>
                  <p className="mt-1 max-w-[220px] text-xs leading-5 text-muted-foreground">
                    Create one and share the invite code, or join a friend&apos;s group.
                  </p>
                </div>
              ) : (
                myGroups.map((group) => (
                  <button
                    key={group.groupId}
                    type="button"
                    onClick={() => setSelectedId(group.groupId as string)}
                    className={cn(
                      "flex cursor-pointer flex-col gap-1 rounded-xl px-3 py-3 text-left transition-colors",
                      selectedGroup?.groupId === group.groupId
                        ? "bg-primary/10"
                        : "hover:bg-white/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-bold tracking-tight">{group.name}</p>
                      {group.role === "owner" && (
                        <Crown className="size-3.5 shrink-0 text-amber-300" />
                      )}
                    </div>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {group.subjectFocusName ?? "All subjects"} · {group.memberCount} member
                      {group.memberCount === 1 ? "" : "s"}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Right: leaderboard */}
          <div className="glass-panel rounded-2xl p-5">
            {!selectedGroup ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Users className="size-6" />
                </div>
                <h3 className="mt-4 font-bold tracking-tight">Pick a group</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Create or join a group to see its weekly XP leaderboard.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                      weekly leaderboard · last 7 days
                    </p>
                    <h2 className="mt-1 text-lg font-extrabold tracking-tight">
                      {selectedGroup.name}
                    </h2>
                    {selectedGroup.subjectFocusName && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <BookOpen className="size-3" /> {selectedGroup.subjectFocusName}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopy(selectedGroup.inviteCode)}
                    className="glass-chip flex cursor-pointer items-center gap-2 rounded-xl border-primary/25 bg-primary/10 px-3 py-2 font-mono text-sm font-bold tracking-[0.15em] text-primary transition-colors hover:bg-primary/15"
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
                    {leaderboard.members.map((member, index) => (
                      <motion.div
                        key={member.userId}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: index * 0.04 }}
                        className={cn(
                          "flex items-center gap-3 rounded-xl border px-3 py-3",
                          member.isMe
                            ? "border-primary/30 bg-primary/10"
                            : "border-white/5 bg-white/[0.02]",
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-extrabold",
                            index === 0
                              ? "bg-amber-400/15 text-amber-300"
                              : index === 1
                                ? "bg-slate-300/15 text-slate-200"
                                : index === 2
                                  ? "bg-orange-400/15 text-orange-300"
                                  : "bg-white/5 text-muted-foreground",
                          )}
                        >
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                            {member.name}
                            {member.isMe && (
                              <Badge className="border-primary/30 bg-primary/10 text-primary">
                                you
                              </Badge>
                            )}
                            {member.role === "owner" && (
                              <Crown className="size-3 text-amber-300" />
                            )}
                          </p>
                          <p className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                            <Timer className="size-3" /> {member.hoursThisWeek} h ·{" "}
                            {member.sessionsThisWeek} session
                            {member.sessionsThisWeek === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="flex items-center justify-end gap-1 font-mono text-sm font-extrabold tabular-nums text-primary">
                            <Trophy className="size-3.5" /> {member.xpThisWeek}
                          </p>
                          <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                            xp this week
                          </p>
                        </div>
                      </motion.div>
                    ))}
                    {leaderboard.members.length === 0 && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        No members yet — share the invite code.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4">
                  <p className="font-mono text-[10px] text-muted-foreground">
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
        </div>
      </div>

      {/* Rooms section (group-scoped — no global directory) */}
      {selectedGroup && (
        <div className="glass-panel rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                study rooms · live video + chat · members only
              </p>
              <h2 className="mt-1 text-lg font-extrabold tracking-tight">
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
            <p className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-6 text-center text-sm text-muted-foreground">
              No live rooms right now — start one and your group members will get a notification.
            </p>
          ) : (
            <div className="mt-4 flex flex-col gap-2">
              {activeRooms.map((room) => (
                <div
                  key={room.roomId}
                  className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-4 py-3"
                >
                  <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <MonitorPlay className="size-4" />
                    <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{room.name}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
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
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Member roster with per-person safety actions */}
      {selectedGroup && members && (
        <div className="glass-panel rounded-2xl p-5">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            members · report or block anyone from here
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {members.members.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 font-mono text-xs font-extrabold text-primary">
                  {member.name
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase() ?? "")
                    .join("")}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                    {member.name}
                    {member.isMe && (
                      <Badge className="border-primary/30 bg-primary/10 text-primary">you</Badge>
                    )}
                    {member.isOwner && <Crown className="size-3 shrink-0 text-amber-300" />}
                  </p>
                  <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                    {member.role}
                  </p>
                </div>
                <ReportBlockMenu
                  targetUserId={member.userId}
                  targetName={member.name}
                  compact
                  disabled={member.isMe}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Start room dialog */}
      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="size-4 text-primary" /> Start a study room
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
              <Sparkles className="size-4 text-primary" /> Create a study group
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
              <UserPlus className="size-4 text-primary" /> Join a group
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
