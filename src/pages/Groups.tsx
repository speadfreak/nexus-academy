// LEARNYX SQUADS — collaborative adaptive learning layer.
//
// The Groups page is now SQUADS: a tabbed hub that turns the existing
// private-group foundation (chat, leaderboard, rooms, members) into a
// shared academic mission. Tabs:
//
//   Overview      — squad mission, streak, accuracy, hours, today's todo
//   Leaderboard   — multi-metric (XP primary, streak/recall/study-time/
//                   quiz-accuracy as secondary context)
//   Challenges    — squad goals with end dates, per-member contributions
//   Weakness Radar — anonymous aggregate per subject, never per-member
//   Squad AI      — generates explanation + practice Qs + flashcards + mini
//                   quiz on a topic; spawn a quiz battle from the mini quiz
//   Quiz Battles  — host creates battle on a topic, AI writes 10
//                   questions, members join lobby, host advances, server
//                   scores, top-3 XP awarded
//   Squad Board   — pinned 4-slot board (goal, next session, announcement,
//                   resource) managed by owner/admin
//   Exam Prep     — squad-wide EHEEE readiness per subject (aggregated
//                   memory strength + quiz accuracy) + AI-generated
//                   today's actions
//   Members       — roster with role assignment (owner/admin/mentor/member)
//   Rooms         — existing live video rooms
//   Chat          — existing group chat (with slash-command widgets feed
//                   above the input)
//
// PRIVACY: Squad weakness radar shows COUNTS only ("4 members struggling
// with Genetics") — never who. Quiz battle scores ARE shown (it's opt-in
// competitive). AI tutor thread is shared across the squad but the
// underlying prompt only sees aggregated weakness topics, not individual
// study history.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  Brain,
  Calendar as CalendarIcon,
  CheckCircle2,
  CircleDot,
  Clock,
  Copy,
  Crown,
  Flame,
  Gamepad2,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Medal,
  MonitorPlay,
  PieChart,
  Pin,
  Plus,
  Radio,
  Rocket,
  Shield,
  Sparkles,
  Sword,
  Target,
  Timer,
  Trophy,
  UserPlus,
  Users,
  Video,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
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
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { useFriendlyError, errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

// Tab keys
type TabKey =
  | "overview"
  | "leaderboard"
  | "challenges"
  | "radar"
  | "tutor"
  | "battles"
  | "board"
  | "exam"
  | "members"
  | "rooms"
  | "chat";

export default function Groups() {
  const friendlyError = useFriendlyError();
  const { t } = useTranslation(["groups", "common"]);
  const navigate = useNavigate();
  const myGroups = useQuery(api.studyGroups.getMyGroups);
  const subjects = useQuery(api.subjects.getAll);
  const createGroup = useMutation(api.studyGroups.createGroup);
  const joinGroup = useMutation(api.studyGroups.joinGroup);
  const leaveGroup = useMutation(api.studyGroups.leaveGroup);
  const createRoom = useAction(api.roomsActions.createRoom);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
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

  const dashboard = useQuery(
    api.squads.getSquadDashboard,
    selectedGroup ? { groupId: selectedGroup.groupId as Id<"studyGroups"> } : "skip",
  );
  const ensureMission = useMutation(api.squads.ensureTodayMission);

  // Idempotently ensure today's mission row exists when the dashboard opens.
  useEffect(() => {
    if (selectedGroup && dashboard === undefined) return;
    if (selectedGroup && dashboard?.todayMission === null) {
      void ensureMission({ groupId: selectedGroup.groupId as Id<"studyGroups"> });
    }
  }, [selectedGroup, dashboard, ensureMission]);

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
      toast.error(friendlyError(error, "Could not start the room."));
    } finally {
      setStartingRoom(false);
    }
  };

  const handleCreate = async () => {
    const name = groupName.trim();
    if (!name) {
      toast.error("Give your squad a name.");
      return;
    }
    try {
      const result = await createGroup({
        name,
        subjectFocus: (subjectFocus || undefined) as Id<"subjects"> | undefined,
      });
      toast.success(`Squad created — share the code ${result.inviteCode} with friends.`);
      setCreateOpen(false);
      setGroupName("");
      setSubjectFocus("");
      setSelectedId(result.groupId as string);
    } catch (error) {
      toast.error(friendlyError(error, "Could not create the squad."));
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
      toast.error(friendlyError(error, "Could not join that squad."));
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
      toast.error(friendlyError(error, "Could not leave the squad."));
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
            PAGE HERO
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
                // {t("groups:eyebrow", { defaultValue: "study groups" })}
              </p>
              <h1 className="mt-1 type-h1 text-gradient">
                {t("groups:title", { defaultValue: "Squads" })}
              </h1>
              <p className="mt-2 max-w-2xl type-body text-muted-foreground">
                {t("groups:subtitle", {
                  defaultValue:
                    "Private crews of classmates on a shared academic mission. Studying together actually helps everyone study better — squad challenges, AI tutor, quiz battles, shared weakness radar.",
                })}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <HeroStat icon={<Users className="size-3" />} value={groupsCount} label="squad" plural="s" />
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
          <EmptyGroupsState onCreate={() => setCreateOpen(true)} onJoin={() => setJoinOpen(true)} />
        )}

        {/* ════════════════════════════════════════════════════════════════
            SQUAD HUB — only when there's at least one group
           ════════════════════════════════════════════════════════════════ */}
        {myGroups !== undefined && myGroups.length > 0 && (
          <>
            {/* Action buttons row */}
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
                <Plus className="size-4" /> Create squad
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
              {/* ─── LEFT: group selector + identity card ─── */}
              <div className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
                {/* Squad selector */}
                <div className="flex flex-col gap-2">
                  <p className="px-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/70">
                    your squads
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

                {/* Squad identity card */}
                {selectedGroup && (
                  <motion.div
                    key={selectedGroup.groupId}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="glass-panel hover-lift relative overflow-hidden rounded-3xl p-5 sm:p-6"
                  >
                    <div className="pointer-events-none absolute -top-12 -right-10 size-40 rounded-full bg-amber-400/10 blur-[60px]" />
                    <div className="pointer-events-none absolute -bottom-12 -left-10 size-32 rounded-full bg-amber-400/[0.06] blur-[50px]" />

                    <div className="relative">
                      {/* Identity header — icon + name + role badge */}
                      <div className="flex items-start gap-3">
                        <div className="relative flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400/20 to-amber-500/5 text-amber-300 shadow-[0_0_18px_-6px_rgb(251,191,36/0.5)]">
                          <Users className="size-5" />
                          {liveCount > 0 && (
                            <span className="absolute -right-0.5 -top-0.5 flex size-2.5">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                              <span className="relative inline-flex size-2.5 rounded-full border-2 border-background bg-emerald-400" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <h2 className="truncate type-h2">{selectedGroup.name}</h2>
                            <RoleBadge role={selectedGroup.role} />
                          </div>
                          <p className="mt-0.5 flex items-center gap-1.5 type-caption text-muted-foreground">
                            <BookOpen className="size-3" />
                            {selectedGroup.subjectFocusName ?? "All subjects"}
                          </p>
                        </div>
                      </div>

                      {/* Stats row — member count + live rooms count + active challenges */}
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        <SquadStat label="members" value={selectedGroup.memberCount} icon={<Users className="size-3" />} />
                        <SquadStat label="live rooms" value={liveCount} icon={<MonitorPlay className="size-3" />} tone={liveCount > 0 ? "emerald" : "default"} />
                        <SquadStat label="challenges" value={dashboard?.activeChallengesCount ?? 0} icon={<Target className="size-3" />} tone="amber" />
                      </div>

                      {/* Member preview row */}
                      {selectedMembersPreview.length > 0 && (
                        <div className="mt-4">
                          <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
                            in this squad
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

                      {/* Invite code */}
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

                      {/* Leave button */}
                      <button
                        type="button"
                        onClick={() => void handleLeave(selectedGroup.groupId as string, selectedGroup.name)}
                        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-rose-400/30 hover:bg-rose-400/[0.06] hover:text-rose-300"
                      >
                        <LogOut className="size-3.5" /> Leave squad
                      </button>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* ─── RIGHT: tabbed squad content ─── */}
              <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
                {selectedGroup && (
                  <Tabs
                    value={activeTab}
                    onValueChange={(v) => setActiveTab(v as TabKey)}
                    className="w-full"
                  >
                    <SquadTabBar
                      activeTab={activeTab}
                      onTabChange={(v) => setActiveTab(v)}
                      hasLiveBattle={!!dashboard?.liveBattleId || !!dashboard?.lobbyBattleId}
                    />

                    <TabsContent value="overview" className="mt-5 focus-visible:outline-none">
                      <SquadOverview groupId={selectedGroup.groupId as Id<"studyGroups">} dashboard={dashboard} />
                    </TabsContent>
                    <TabsContent value="leaderboard" className="mt-5 focus-visible:outline-none">
                      <SquadLeaderboard groupId={selectedGroup.groupId as Id<"studyGroups">} />
                    </TabsContent>
                    <TabsContent value="challenges" className="mt-5 focus-visible:outline-none">
                      <SquadChallenges groupId={selectedGroup.groupId as Id<"studyGroups">} subjects={subjects ?? []} myRole={selectedGroup.role} />
                    </TabsContent>
                    <TabsContent value="radar" className="mt-5 focus-visible:outline-none">
                      <SquadRadar groupId={selectedGroup.groupId as Id<"studyGroups">} />
                    </TabsContent>
                    <TabsContent value="tutor" className="mt-5 focus-visible:outline-none">
                      <SquadTutor groupId={selectedGroup.groupId as Id<"studyGroups">} subjects={subjects ?? []} myRole={selectedGroup.role} />
                    </TabsContent>
                    <TabsContent value="battles" className="mt-5 focus-visible:outline-none">
                      <SquadBattles groupId={selectedGroup.groupId as Id<"studyGroups">} subjects={subjects ?? []} myRole={selectedGroup.role} />
                    </TabsContent>
                    <TabsContent value="board" className="mt-5 focus-visible:outline-none">
                      <SquadBoard groupId={selectedGroup.groupId as Id<"studyGroups">} myRole={selectedGroup.role} />
                    </TabsContent>
                    <TabsContent value="exam" className="mt-5 focus-visible:outline-none">
                      <SquadExamPrep groupId={selectedGroup.groupId as Id<"studyGroups">} myRole={selectedGroup.role} />
                    </TabsContent>
                    <TabsContent value="members" className="mt-5 focus-visible:outline-none">
                      <SquadMembers groupId={selectedGroup.groupId as Id<"studyGroups">} members={members} myRole={selectedGroup.role} />
                    </TabsContent>
                    <TabsContent value="rooms" className="mt-5 focus-visible:outline-none">
                      <SquadRooms
                        activeRooms={activeRooms}
                        liveCount={liveCount}
                        onStartRoom={() => setRoomDialogOpen(true)}
                        startingRoom={startingRoom}
                        navigate={navigate}
                      />
                    </TabsContent>
                    <TabsContent value="chat" className="mt-5 focus-visible:outline-none">
                      <motion.div
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: "easeOut" }}
                      >
                        <GroupChatPanel
                          groupId={selectedGroup.groupId as Id<"studyGroups">}
                          groupName={selectedGroup.name}
                          onStartRoom={() => setRoomDialogOpen(true)}
                        />
                      </motion.div>
                    </TabsContent>
                  </Tabs>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          DIALOGS — unchanged from the original Groups page
         ════════════════════════════════════════════════════════════════ */}
      <Dialog open={roomDialogOpen} onOpenChange={setRoomDialogOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="size-4 text-amber-300" /> Start a study room
            </DialogTitle>
            <DialogDescription>
              Group members get a notification with a link to join. Rooms are
              private to {selectedGroup?.name ?? "this squad"} — nothing is public.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder={`${selectedGroup?.name ?? "Squad"} study session`}
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
              <Sparkles className="size-4 text-amber-300" /> Create a squad
            </DialogTitle>
            <DialogDescription>
              Share the invite code with classmates — squads stay private and capped.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Squad name</span>
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
              <Plus className="size-4" /> Create squad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="size-4 text-amber-300" /> Join a squad
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
              Join squad
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * SquadTabBar — premium horizontally-scrollable chip rail.
 *
 * The 11 squad tabs never wrap (which caused the previous collision issue
 * — wrapping put Members/Rooms/Chat on a second row that overlapped with
 * the first row's last items). Instead they live on ONE row that scrolls
 * horizontally on overflow, with:
 *   • Always-visible icons + labels (no more icon-only mobile mode that
 *     made 11 chips indistinguishable)
 *   • A right-edge fade gradient that hints "scroll →" when there's more
 *   • Strong active state: filled background + primary glow + bottom edge
 *   • Subtle hover lift
 *   • Live-battle pulse on the Battles tab when there's a live or lobby
 *     quiz battle (calls attention to time-sensitive content)
 */
function SquadTabBar({
  activeTab,
  onTabChange,
  hasLiveBattle,
}: {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  hasLiveBattle: boolean;
}) {
  // Detect horizontal overflow to show the right-edge fade hint.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
      setCanScrollLeft(el.scrollLeft > 4);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Re-check on resize.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  const tabs: { tab: TabKey; icon: ReactNode; label: string }[] = [
    { tab: "overview", icon: <LayoutDashboard className="size-3.5" />, label: "Overview" },
    { tab: "leaderboard", icon: <Trophy className="size-3.5" />, label: "Leaderboard" },
    { tab: "challenges", icon: <Target className="size-3.5" />, label: "Challenges" },
    { tab: "radar", icon: <Radio className="size-3.5" />, label: "Radar" },
    { tab: "tutor", icon: <Brain className="size-3.5" />, label: "Squad AI" },
    { tab: "battles", icon: <Sword className="size-3.5" />, label: "Battles" },
    { tab: "board", icon: <Pin className="size-3.5" />, label: "Board" },
    { tab: "exam", icon: <GraduationCap className="size-3.5" />, label: "Exam Prep" },
    { tab: "members", icon: <Users className="size-3.5" />, label: "Members" },
    { tab: "rooms", icon: <MonitorPlay className="size-3.5" />, label: "Rooms" },
    { tab: "chat", icon: <Sparkles className="size-3.5" />, label: "Chat" },
  ];

  return (
    <div className="relative">
      {/* Left-edge fade hint (only when scrolled) */}
      <div
        className={cn(
          "pointer-events-none absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r from-background/90 to-transparent transition-opacity duration-300",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
      />
      {/* Right-edge fade hint (only when there's more to scroll) */}
      <div
        className={cn(
          "pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-background/90 to-transparent transition-opacity duration-300",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        ref={scrollRef}
        className="glass-soft flex h-auto w-full gap-1 overflow-x-auto rounded-2xl p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        aria-label="Squad tabs"
        style={{ scrollbarWidth: "none" }}
      >
        {tabs.map(({ tab, icon, label }) => {
          const active = activeTab === tab;
          const showLiveIndicator = tab === "battles" && hasLiveBattle;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
              className={cn(
                "interactive-press group relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[10px] font-bold uppercase tracking-wider transition-all duration-200",
                active
                  ? "bg-primary/15 text-primary shadow-[0_0_22px_-6px_var(--primary)]"
                  : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
              )}
            >
              <span className={cn("transition-transform", active ? "scale-110" : "group-hover:scale-110")}>
                {icon}
              </span>
              <span>{label}</span>
              {/* Active bottom edge indicator */}
              {active && (
                <span className="absolute -bottom-px left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-full bg-primary" />
              )}
              {/* Live-battle pulse on Battles tab */}
              {showLiveIndicator && (
                <span className="absolute -right-0.5 -top-0.5 flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-rose-400" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300 shadow-[0_0_16px_-4px_rgb(251,191,36/0.4)]">
              {icon}
            </div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
                {label}
              </p>
              {sub && <p className="mt-0.5 type-caption text-muted-foreground/80">{sub}</p>}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </motion.section>
  );
}

/**
 * RoleBadge — color-coded role chip used in the identity card + member list.
 * Color encodes hierarchy at a glance:
 *   owner  → amber/gold  (crown icon)
 *   admin  → blue        (shield icon)
 *   mentor → purple      (graduation icon)
 *   member → slate       (user icon, default)
 */
function RoleBadge({ role, compact = false }: { role: string; compact?: boolean }) {
  const meta: Record<string, { icon: ReactNode; className: string; label: string }> = {
    owner: {
      icon: <Crown className="size-2.5" />,
      className: "border-amber-400/30 bg-amber-400/10 text-amber-300",
      label: "Owner",
    },
    admin: {
      icon: <Shield className="size-2.5" />,
      className: "border-blue-400/30 bg-blue-400/10 text-blue-300",
      label: "Admin",
    },
    mentor: {
      icon: <GraduationCap className="size-2.5" />,
      className: "border-purple-400/30 bg-purple-400/10 text-purple-300",
      label: "Mentor",
    },
    member: {
      icon: <Users className="size-2.5" />,
      className: "border-white/10 bg-white/5 text-muted-foreground",
      label: "Member",
    },
  };
  const m = meta[role] ?? meta.member;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
        m.className,
      )}
    >
      {!compact && m.icon}
      {m.label}
    </span>
  );
}

/**
 * SquadStat — a single stat tile used in the identity card. Tighter and
 * more premium than the original plain divs.
 */
function SquadStat({
  icon,
  label,
  value,
  tone = "default",
}: {
  icon?: ReactNode;
  label: string;
  value: number | string;
  tone?: "default" | "emerald" | "amber";
}) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-300"
        : "text-foreground";
  return (
    <div className="glass-soft rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.05]">
      <p className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/70">
        {icon}
        {label}
      </p>
      <p className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums", toneClass)}>
        {value}
      </p>
    </div>
  );
}

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

function EmptyGroupsState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
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
      <h3 className="type-h3 mt-6 text-foreground">No squads yet</h3>
      <p className="type-body mt-2 max-w-sm text-muted-foreground">
        Create one and share the invite code, or join a friend&apos;s squad
        with a code they shared.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <Button className="interactive-press cursor-pointer rounded-xl" onClick={onCreate}>
          <Plus className="size-4" /> Create a squad
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
          tip: squads stay private — only people with the invite code can join
        </span>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: OVERVIEW — squad mission, streak, accuracy, hours, today's todo
// ═══════════════════════════════════════════════════════════════════════

function SquadOverview({
  groupId,
  dashboard,
}: {
  groupId: Id<"studyGroups">;
  dashboard:
    | {
        groupName: string;
        subjectFocusName: string | null;
        memberCount: number;
        myRole: string;
        todayMission: { target: number; achieved: number; completed: boolean } | null;
        squadStreakDays: number;
        avgAccuracy: number;
        weekHours: number;
        weekXp: number;
        activeChallengesCount: number;
        liveBattleId: string | null;
        lobbyBattleId: string | null;
        membersRemaining: number;
        membersStudied: number;
        todaysTodo: { dueFlashcards: number; calendarEvents: number; calendarTitles: string[] };
        memberStatus: { userId: Id<"users">; name: string; role: string; studiedToday: boolean; xpThisWeek: number }[];
      }
    | undefined
    | null;
}) {
  if (dashboard === undefined || dashboard === null) {
    return (
      <SectionShell icon={<LayoutDashboard className="size-4" />} label="squad overview">
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      </SectionShell>
    );
  }

  const missionPct =
    dashboard.todayMission && dashboard.todayMission.target > 0
      ? Math.min(100, Math.round((dashboard.todayMission.achieved / dashboard.todayMission.target) * 100))
      : 0;

  return (
    <SectionShell
      icon={<LayoutDashboard className="size-4" />}
      label="squad dashboard"
      sub={`${dashboard.groupName} · ${dashboard.memberCount} member${dashboard.memberCount === 1 ? "" : "s"}`}
    >
      <div className="flex flex-col gap-5">
        {/* Squad mission card */}
        <div className="glass-soft rounded-2xl border border-amber-400/15 bg-amber-400/[0.04] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                <Target className="size-3.5" /> Today's Squad Mission
              </p>
              <p className="mt-1 type-h2 text-foreground">
                {dashboard.todayMission
                  ? `${dashboard.todayMission.achieved} / ${dashboard.todayMission.target} study actions`
                  : "Mission loading…"}
              </p>
            </div>
            {dashboard.todayMission?.completed && (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="size-3" /> Complete
              </Badge>
            )}
          </div>
          <div className="mt-4">
            <Progress value={missionPct} className="h-2.5 rounded-full bg-white/10" />
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              {missionPct}% — {dashboard.todayMission?.completed ? "Squad hit today's target! 🎉" : "Keep studying together."}
            </p>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile icon={<Flame className="size-4" />} label="squad streak" value={dashboard.squadStreakDays} suffix="days" tone="orange" />
          <StatTile icon={<Brain className="size-4" />} label="avg accuracy" value={dashboard.avgAccuracy} suffix="%" tone="purple" />
          <StatTile icon={<Clock className="size-4" />} label="studied this week" value={dashboard.weekHours} suffix="h" tone="blue" />
          <StatTile icon={<Trophy className="size-4" />} label="XP this week" value={dashboard.weekXp} suffix="xp" tone="amber" />
        </div>

        {/* Live battle banner */}
        {(dashboard.liveBattleId || dashboard.lobbyBattleId) && (
          <div className="glass-soft flex items-center justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-4">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-rose-400/15 text-rose-300">
                <Sword className="size-4" />
              </div>
              <div>
                <p className="type-body font-bold text-foreground">
                  {dashboard.liveBattleId ? "Quiz battle live now!" : "Quiz battle in lobby"}
                </p>
                <p className="type-caption text-muted-foreground">
                  {dashboard.liveBattleId ? "Join before it ends." : "Join the lobby before it starts."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Today's squad todo */}
        <div className="glass-soft rounded-2xl p-4">
          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            today's squad todo
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-1.5 type-caption">
              <Brain className="size-3.5 text-purple-300" /> {dashboard.todaysTodo.dueFlashcards} flashcards due
            </span>
            <span className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-1.5 type-caption">
              <CalendarIcon className="size-3.5 text-blue-300" /> {dashboard.todaysTodo.calendarEvents} calendar event
              {dashboard.todaysTodo.calendarEvents === 1 ? "" : "s"}
            </span>
          </div>
          {dashboard.todaysTodo.calendarTitles.length > 0 && (
            <div className="mt-3 flex flex-col gap-1">
              {dashboard.todaysTodo.calendarTitles.map((title, i) => (
                <p key={i} className="type-caption text-muted-foreground">
                  • {title}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Members progress today */}
        <div className="glass-soft rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              today's squad status
            </p>
            <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
              {dashboard.membersStudied} / {dashboard.memberCount} studied
            </Badge>
          </div>
          <p className="mt-2 type-caption text-muted-foreground">
            {dashboard.membersRemaining > 0
              ? `${dashboard.membersRemaining} member${dashboard.membersRemaining === 1 ? "" : "s"} need${dashboard.membersRemaining === 1 ? "s" : ""} to complete today's mission.`
              : "Every member studied today — elite squad! 🏆"}
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {dashboard.memberStatus.slice(0, 6).map((m, i) => (
              <div
                key={m.userId}
                className="flex items-center gap-2.5 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <div className="font-mono text-[10px] font-bold text-muted-foreground">
                  #{i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate type-caption font-semibold">
                    {m.name}
                    {m.role === "owner" && <Crown className="size-3 text-amber-300" />}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {m.xpThisWeek} XP
                  </span>
                  {m.studiedToday ? (
                    <span className="flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="size-3.5" />
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">
                      <CircleDot className="size-3" />
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function StatTile({
  icon,
  label,
  value,
  suffix,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  suffix?: string;
  tone: "amber" | "orange" | "purple" | "blue";
}) {
  const toneClasses: Record<typeof tone, string> = {
    amber: "bg-amber-400/10 text-amber-300 border-amber-400/20 shadow-[0_0_12px_-4px_rgb(251,191,36/0.4)]",
    orange: "bg-orange-400/10 text-orange-300 border-orange-400/20 shadow-[0_0_12px_-4px_rgb(251,146,60/0.4)]",
    purple: "bg-purple-400/10 text-purple-300 border-purple-400/20 shadow-[0_0_12px_-4px_rgb(168,85,247/0.4)]",
    blue: "bg-blue-400/10 text-blue-300 border-blue-400/20 shadow-[0_0_12px_-4px_rgb(59,130,246/0.4)]",
  };
  return (
    <motion.div
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-soft relative flex flex-col gap-1 overflow-hidden rounded-2xl border border-white/5 p-3.5"
    >
      <div className="pointer-events-none absolute -top-8 -right-8 size-16 rounded-full bg-white/[0.02] blur-[20px]" />
      <div className={cn("relative flex size-7 items-center justify-center rounded-lg border", toneClasses[tone])}>
        {icon}
      </div>
      <p className="relative mt-1 font-mono text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">
        {label}
      </p>
      <p className="relative font-mono text-xl font-extrabold tabular-nums text-foreground">
        {value}
        {suffix && <span className="ml-0.5 text-xs font-normal text-muted-foreground">{suffix}</span>}
      </p>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: LEADERBOARD — multi-metric, XP-primary
// ═══════════════════════════════════════════════════════════════════════

type MetricKey = "xp" | "streak" | "recall" | "study_time" | "quiz_accuracy";

function SquadLeaderboard({ groupId }: { groupId: Id<"studyGroups"> }) {
  const [metric, setMetric] = useState<MetricKey>("xp");
  const leaderboard = useQuery(api.squads.getSquadLeaderboard, { groupId, metric });

  const metricMeta: Record<MetricKey, { icon: ReactNode; label: string }> = {
    xp: { icon: <Trophy className="size-3.5" />, label: "Weekly XP" },
    streak: { icon: <Flame className="size-3.5" />, label: "Streak" },
    recall: { icon: <Brain className="size-3.5" />, label: "Recall" },
    study_time: { icon: <Clock className="size-3.5" />, label: "Study Time" },
    quiz_accuracy: { icon: <Target className="size-3.5" />, label: "Quiz Accuracy" },
  };

  return (
    <SectionShell
      icon={<Trophy className="size-4" />}
      label="squad leaderboard"
      sub="XP is primary — secondary metrics are context only"
    >
      <div className="flex flex-col gap-4">
        {/* Metric picker */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(metricMeta) as MetricKey[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={cn(
                "interactive-press flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors",
                metric === m
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/8 bg-white/[0.02] text-muted-foreground hover:bg-white/[0.05]",
              )}
            >
              {metricMeta[m].icon}
              {metricMeta[m].label}
            </button>
          ))}
        </div>

        {/* Rows */}
        {!leaderboard ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
            ))}
          </div>
        ) : leaderboard.rows.length === 0 ? (
          <p className="py-8 text-center type-body text-muted-foreground">No members yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {leaderboard.rows.map((row, i) => {
              const isPodium = i < 3;
              return (
                <motion.div
                  key={row.userId}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: 0.04 * Math.min(i, 10), ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border px-3.5 py-3 transition-colors",
                    row.isMe
                      ? "border-primary/30 bg-primary/10"
                      : "border-white/5 bg-white/[0.02]",
                    i === 0
                      ? "shadow-[0_0_28px_-4px_oklch(0.75_0.15_85)] border-amber-400/20"
                      : i === 1
                        ? "shadow-[0_0_20px_-4px_oklch(0.7_0.01_250)] border-slate-300/15"
                        : i === 2
                          ? "shadow-[0_0_20px_-4px_oklch(0.7_0.12_60)] border-orange-400/15"
                          : "",
                  )}
                >
                  {/* Rank badge */}
                  <div
                    className={cn(
                      "flex shrink-0 items-center justify-center rounded-xl",
                      isPodium ? "size-9" : "size-8",
                      i === 0
                        ? "bg-gradient-to-br from-amber-400/20 to-amber-500/5 text-amber-300 shadow-[0_0_12px_-4px_rgb(245_197_66/0.5)]"
                        : i === 1
                          ? "bg-gradient-to-br from-slate-300/20 to-slate-400/5 text-slate-200 shadow-[0_0_12px_-4px_rgb(180_195_210/0.4)]"
                          : i === 2
                            ? "bg-gradient-to-br from-orange-400/20 to-orange-500/5 text-orange-300 shadow-[0_0_12px_-4px_rgb(180_130_70/0.4)]"
                            : "bg-white/5 text-muted-foreground",
                      isPodium ? "font-mono text-sm font-extrabold" : "font-mono text-sm font-bold",
                    )}
                  >
                    {isPodium ? <Medal className={cn("size-4", i === 0 && "text-amber-300", i === 1 && "text-slate-200", i === 2 && "text-orange-300")} /> : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate type-body font-semibold">
                      {row.name}
                      {row.isMe && (
                        <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">you</Badge>
                      )}
                      {row.role === "owner" && <Crown className="size-3 text-amber-300" />}
                    </p>
                    <p className="mt-0.5 flex items-center gap-2 type-caption text-muted-foreground">
                      <MetricValue metric={metric} row={row} />
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "flex items-center justify-end gap-1 font-mono font-extrabold tabular-nums",
                      i === 0
                        ? "type-h2 text-gradient"
                        : i < 3
                          ? "text-base text-primary"
                          : "text-sm text-primary",
                    )}>
                      <Trophy className={cn("size-3.5", i === 0 && "text-amber-300", i === 1 && "text-slate-300", i === 2 && "text-orange-300")} /> {row.xpThisWeek}
                    </p>
                    <p className="type-caption uppercase tracking-wide text-muted-foreground">
                      xp this week
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
        <p className="border-t border-white/[0.06] pt-3 type-caption text-muted-foreground/80">
          Primary rank is always XP — secondary metrics are context, never the official order.
        </p>
      </div>
    </SectionShell>
  );
}

function MetricValue({
  metric,
  row,
}: {
  metric: MetricKey;
  row: { streak: number; hoursThisWeek: number; quizAccuracy: number; recall: number; quizAttempts: number };
}) {
  switch (metric) {
    case "xp":
      return (
        <>
          <Clock className="size-3" /> {row.hoursThisWeek} h · {row.quizAttempts} quiz
          {row.quizAttempts === 1 ? "" : "zes"}
        </>
      );
    case "streak":
      return (
        <>
          <Flame className="size-3" /> {row.streak} day streak
        </>
      );
    case "recall":
      return (
        <>
          <Brain className="size-3" /> {row.recall}% memory strength
        </>
      );
    case "study_time":
      return (
        <>
          <Clock className="size-3" /> {row.hoursThisWeek} h studied
        </>
      );
    case "quiz_accuracy":
      return (
        <>
          <Target className="size-3" /> {row.quizAccuracy}% accuracy
        </>
      );
  }
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: CHALLENGES
// ═══════════════════════════════════════════════════════════════════════

function SquadChallenges({
  groupId,
  subjects,
  myRole,
}: {
  groupId: Id<"studyGroups">;
  subjects: { _id: Id<"subjects">; name: string }[];
  myRole: string;
}) {
  const friendlyError = useFriendlyError();
  const challenges = useQuery(api.squads.listSquadChallenges, { groupId });
  const createChallenge = useMutation(api.squads.createSquadChallenge);
  const bumpChallenge = useMutation(api.squads.bumpChallengeProgress);
  const abandonChallenge = useMutation(api.squads.abandonSquadChallenge);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"flashcards" | "quizzes" | "study_time" | "chapters_read" | "streak">("flashcards");
  const [goal, setGoal] = useState("500");
  const [unit, setUnit] = useState("cards");
  const [subjectId, setSubjectId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [topic, setTopic] = useState("");
  const [duration, setDuration] = useState("7");
  const [rewardXp, setRewardXp] = useState("200");
  const [creating, setCreating] = useState(false);

  const canCreate = myRole === "owner" || myRole === "admin" || myRole === "mentor";

  const typeUnitMap: Record<typeof type, string> = {
    flashcards: "cards",
    quizzes: "quizzes",
    study_time: "hours",
    chapters_read: "chapters",
    streak: "days",
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }
    const goalNum = parseInt(goal, 10);
    const durNum = parseInt(duration, 10);
    const xpNum = parseInt(rewardXp, 10);
    if (isNaN(goalNum) || goalNum <= 0) {
      toast.error("Goal must be a positive number.");
      return;
    }
    setCreating(true);
    try {
      await createChallenge({
        groupId,
        title: title.trim(),
        type,
        goal: goalNum,
        unit,
        subjectId: (subjectId || undefined) as Id<"subjects"> | undefined,
        subjectName: subjectName || "All subjects",
        topicName: topic.trim() || undefined,
        endsInDays: durNum,
        rewardXp: isNaN(xpNum) ? undefined : xpNum,
      });
      toast.success("Challenge started — your squad can contribute now.");
      setCreateOpen(false);
      setTitle("");
      setGoal("500");
      setTopic("");
      setSubjectId("");
      setSubjectName("");
    } catch (error) {
      toast.error(friendlyError(error, "Could not start the challenge."));
    } finally {
      setCreating(false);
    }
  };

  return (
    <SectionShell
      icon={<Target className="size-4" />}
      label="squad challenges"
      sub="Group goals with end dates and rewards"
      action={
        canCreate ? (
          <Button size="sm" className="interactive-press cursor-pointer rounded-xl" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Start a challenge
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        {!challenges ? (
          <div className="flex flex-col gap-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : challenges.length === 0 ? (
          <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
            <Target className="size-8 text-muted-foreground/40" />
            <p className="mt-3 type-body text-muted-foreground">No active challenges.</p>
            <p className="type-caption text-muted-foreground/70">
              Start one to get the squad moving.
            </p>
          </div>
        ) : (
          challenges.map((c, i) => {
            const endsInMs = c.endsAt - Date.now();
            const endsInDays = Math.floor(endsInMs / (24 * 60 * 60 * 1000));
            const endsInHours = Math.floor((endsInMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
            const ended = endsInMs <= 0 || c.status !== "active";
            return (
              <motion.div
                key={c.challengeId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.06, ease: "easeOut" }}
                className={cn(
                  "glass-soft rounded-2xl border p-4",
                  c.achieved
                    ? "border-emerald-400/25 bg-emerald-400/[0.04]"
                    : ended
                      ? "border-white/5 opacity-60"
                      : "border-amber-400/15 bg-amber-400/[0.02]",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 type-body font-bold">
                      {c.achieved && <CheckCircle2 className="size-4 text-emerald-300" />}
                      {c.title}
                    </p>
                    <p className="mt-0.5 type-caption text-muted-foreground">
                      {c.subjectName}
                      {c.topicName ? ` · ${c.topicName}` : ""}
                    </p>
                  </div>
                  <Badge className={cn(
                    "border-white/8",
                    c.achieved
                      ? "bg-emerald-400/10 text-emerald-300 border-emerald-400/30"
                      : ended
                        ? "bg-white/5 text-muted-foreground"
                        : "bg-amber-400/10 text-amber-300 border-amber-400/30",
                  )}>
                    {c.achieved ? "Achieved 🎉" : ended ? "Ended" : `Ends in ${endsInDays}d ${endsInHours}h`}
                  </Badge>
                </div>

                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      Progress
                    </span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {c.totalProgress} / {c.goal} {c.unit}
                    </span>
                  </div>
                  <Progress
                    value={c.progressPct}
                    className="mt-1.5 h-2 rounded-full bg-white/10"
                  />
                </div>

                {c.perMember.length > 0 && (
                  <div className="mt-3">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      per-member breakdown
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {c.perMember.map((m) => (
                        <span
                          key={m.userId}
                          className="rounded-lg border border-white/8 bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                        >
                          {m.name.split(/\s+/)[0]}: <span className="font-bold text-foreground">{m.count}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] text-muted-foreground">
                    Reward: <span className="font-bold text-amber-300">+{c.rewardXp} XP</span> each
                  </p>
                  {!ended && !c.achieved && (
                    <div className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="interactive-press cursor-pointer rounded-lg bg-white/5"
                        onClick={() => void bumpChallenge({ challengeId: c.challengeId, delta: 1 })}
                      >
                        <Plus className="size-3" /> Contribute +1
                      </Button>
                      {(myRole === "owner" || myRole === "admin") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="cursor-pointer rounded-lg text-rose-300 hover:bg-rose-400/10"
                          onClick={() => {
                            if (window.confirm("Abandon this challenge? Progress will be lost.")) {
                              void abandonChallenge({ challengeId: c.challengeId })
                                .then(() => toast.success("Challenge abandoned."))
                                .catch((e) => toast.error(friendlyError(e, "Could not abandon.")));
                            }
                          }}
                        >
                          Abandon
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="size-4 text-amber-300" /> Start a squad challenge
            </DialogTitle>
            <DialogDescription>
              Pick a goal, set a deadline, and your squad works together to hit it.
              When complete, every member gets XP.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Title</span>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Genetics Grind 🧬"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Type</span>
                <Select
                  value={type}
                  onValueChange={(v) => {
                    setType(v as typeof type);
                    setUnit(typeUnitMap[v as typeof type] ?? unit);
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl bg-white/5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flashcards">Flashcards reviewed</SelectItem>
                    <SelectItem value="quizzes">Quizzes completed</SelectItem>
                    <SelectItem value="study_time">Study time (hours)</SelectItem>
                    <SelectItem value="chapters_read">Chapters read</SelectItem>
                    <SelectItem value="streak">Squad streak (days)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Goal</span>
                <Input
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  inputMode="numeric"
                  className="h-10 rounded-xl bg-white/5"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Unit</span>
                <Input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="h-10 rounded-xl bg-white/5"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Subject (optional)</span>
                <Select
                  value={subjectId || "all"}
                  onValueChange={(v) => {
                    if (v === "all") {
                      setSubjectId("");
                      setSubjectName("");
                    } else {
                      setSubjectId(v);
                      const subj = subjects.find((s) => s._id === v);
                      setSubjectName(subj?.name ?? "");
                    }
                  }}
                >
                  <SelectTrigger className="h-10 rounded-xl bg-white/5">
                    <SelectValue placeholder="All subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subjects</SelectItem>
                    {subjects.map((s) => (
                      <SelectItem key={s._id} value={s._id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Topic (optional)</span>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Genetics, Integration"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Duration (days)</span>
                <Input
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  inputMode="numeric"
                  className="h-10 rounded-xl bg-white/5"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Reward XP / member</span>
                <Input
                  value={rewardXp}
                  onChange={(e) => setRewardXp(e.target.value)}
                  inputMode="numeric"
                  className="h-10 rounded-xl bg-white/5"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="cursor-pointer rounded-xl bg-white/5" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button className="cursor-pointer rounded-xl" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Starting…" : "Start challenge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: WEAKNESS RADAR
// ═══════════════════════════════════════════════════════════════════════

function SquadRadar({ groupId }: { groupId: Id<"studyGroups"> }) {
  const radar = useQuery(api.squads.getSquadWeaknessRadar, { groupId });

  const severityMeta: Record<"red" | "amber" | "yellow" | "green", { label: string; color: string }> = {
    red: { label: "🔴", color: "border-rose-400/30 bg-rose-400/[0.06] text-rose-300" },
    amber: { label: "🟠", color: "border-orange-400/30 bg-orange-400/[0.06] text-orange-300" },
    yellow: { label: "🟡", color: "border-yellow-400/30 bg-yellow-400/[0.06] text-yellow-300" },
    green: { label: "🟢", color: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300" },
  };

  return (
    <SectionShell
      icon={<Radio className="size-4" />}
      label="shared weakness radar"
      sub="Aggregated anonymous — never per-member"
    >
      <div className="flex flex-col gap-3">
        {!radar ? (
          <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        ) : radar.length === 0 ? (
          <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
            <Radio className="size-8 text-muted-foreground/40" />
            <p className="mt-3 type-body text-muted-foreground">Not enough flashcard data yet.</p>
            <p className="type-caption text-muted-foreground/70">
              Study more to populate the radar.
            </p>
          </div>
        ) : (
          radar.map((r, i) => {
            const meta = severityMeta[r.severity];
            return (
              <motion.div
                key={r.subjectId}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.06, ease: "easeOut" }}
                className={cn("rounded-2xl border p-4", meta.color)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="type-body font-bold">{meta.label} {r.subjectName}</p>
                    <p className="mt-0.5 type-caption">
                      {r.strugglingCount} member{r.strugglingCount === 1 ? "" : "s"} struggling · avg strength {r.avgStrengthPct}%
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-2xl font-extrabold tabular-nums">
                      {r.avgStrengthPct}%
                    </p>
                  </div>
                </div>
                <div className="mt-2">
                  <Progress
                    value={r.avgStrengthPct}
                    className="h-2 rounded-full bg-white/10"
                  />
                </div>
              </motion.div>
            );
          })
        )}
        <div className="glass-soft mt-1 rounded-2xl border border-purple-400/20 bg-purple-400/[0.04] p-4">
          <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-purple-300">
            <Brain className="size-3.5" /> AI Recommendation
          </p>
          {radar && radar.length > 0 ? (
            <p className="mt-1.5 type-body text-foreground">
              Generate a squad AI tutor session on <span className="font-bold text-purple-300">{radar[0].subjectName}</span> — it&apos;s where your squad struggles most. Then start a quiz battle to drill it together.
            </p>
          ) : (
            <p className="mt-1.5 type-caption text-muted-foreground">
              Study more flashcards — the radar will populate.
            </p>
          )}
        </div>
      </div>
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: SQUAD AI TUTOR
// ═══════════════════════════════════════════════════════════════════════

function SquadTutor({
  groupId,
  subjects,
  myRole,
}: {
  groupId: Id<"studyGroups">;
  subjects: { _id: Id<"subjects">; name: string }[];
  myRole: string;
}) {
  const friendlyError = useFriendlyError();
  const threads = useQuery(api.squads.listSquadAIThreads, { groupId });
  const askSquadAI = useAction(api.squads.askSquadAI);

  const [topic, setTopic] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [generating, setGenerating] = useState(false);
  const [selectedThreadId, setSelectedThreadId] = useState<Id<"squadAIThreads"> | null>(null);
  const selectedThread = useQuery(
    api.squads.getSquadAIThread,
    selectedThreadId ? { threadId: selectedThreadId } : "skip",
  );

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error("Enter a topic.");
      return;
    }
    setGenerating(true);
    try {
      const result = await askSquadAI({
        groupId,
        topicName: topic.trim(),
        subjectName: subjectName || "General",
      });
      toast.success("Squad AI material ready!");
      setSelectedThreadId(result.threadId);
      setTopic("");
    } catch (error) {
      toast.error(friendlyError(error, "Could not generate. Try again."));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <SectionShell
      icon={<Brain className="size-4" />}
      label="squad AI tutor"
      sub="Generate a full learning session for the squad"
    >
      <div className="flex flex-col gap-4">
        {/* Generate form */}
        <div className="glass-soft rounded-2xl border border-purple-400/15 bg-purple-400/[0.03] p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Topic</span>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Integration — substitution"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Subject (optional)</span>
              <Select
                value={subjectId || "all"}
                onValueChange={(v) => {
                  if (v === "all") {
                    setSubjectId("");
                    setSubjectName("");
                  } else {
                    setSubjectId(v);
                    const subj = subjects.find((s) => s._id === v);
                    setSubjectName(subj?.name ?? "");
                  }
                }}
              >
                <SelectTrigger className="h-10 rounded-xl bg-white/5">
                  <SelectValue placeholder="General" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">General</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            className="mt-3 interactive-press w-full cursor-pointer rounded-xl"
            onClick={() => void handleGenerate()}
            disabled={generating}
          >
            <Sparkles className="size-4" /> {generating ? "Generating squad material…" : "Generate squad material"}
          </Button>
        </div>

        {/* Selected thread (full view) */}
        {selectedThread && (
          <div className="glass-soft rounded-2xl border border-purple-400/20 bg-purple-400/[0.04] p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  AI tutor session
                </p>
                <p className="mt-1 type-h3 text-foreground">{selectedThread.topicName}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="cursor-pointer rounded-lg text-muted-foreground"
                onClick={() => setSelectedThreadId(null)}
              >
                Close
              </Button>
            </div>
            <div className="mt-3">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Explanation
              </p>
              <p className="mt-1 whitespace-pre-line type-body text-foreground/90">
                {selectedThread.explanation}
              </p>
            </div>
            {selectedThread.miniQuiz && (
              <div className="mt-4 rounded-xl border border-purple-400/20 bg-purple-400/[0.05] p-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  Mini quiz — start a battle from this!
                </p>
                <p className="mt-1 type-caption text-muted-foreground">
                  Head to the Quiz Battles tab and pick this topic — the AI will generate fresh questions for the squad.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Recent threads */}
        <div>
          <p className="px-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            recent squad AI sessions
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {!threads ? (
              <div className="h-16 animate-pulse rounded-xl bg-white/5" />
            ) : threads.length === 0 ? (
              <p className="py-4 text-center type-caption text-muted-foreground">
                No AI sessions yet.
              </p>
            ) : (
              threads.map((th) => (
                <button
                  key={th.threadId}
                  type="button"
                  onClick={() => setSelectedThreadId(th.threadId)}
                  className={cn(
                    "glass-soft flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:border-purple-400/30 hover:bg-purple-400/[0.04]",
                    selectedThreadId === th.threadId && "border-purple-400/40 bg-purple-400/[0.06]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate type-body font-semibold">{th.topicName}</p>
                    <p className="mt-0.5 line-clamp-2 type-caption text-muted-foreground">
                      {th.explanationPreview}…
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {th.hasMiniQuiz && (
                      <Badge className="border-purple-400/30 bg-purple-400/10 text-purple-300">
                        <Sword className="size-2.5" /> quiz
                      </Badge>
                    )}
                    {th.hasFlashcards && (
                      <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">
                        <Brain className="size-2.5" /> cards
                      </Badge>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: QUIZ BATTLES
// ═══════════════════════════════════════════════════════════════════════

function SquadBattles({
  groupId,
  subjects,
  myRole,
}: {
  groupId: Id<"studyGroups">;
  subjects: { _id: Id<"subjects">; name: string }[];
  myRole: string;
}) {
  const friendlyError = useFriendlyError();
  const battle = useQuery(api.squads.getActiveSquadBattle, { groupId });
  const completed = useQuery(api.squads.getLatestCompletedBattle, { groupId });
  const createBattle = useAction(api.squads.createSquadQuizBattle);
  const joinBattle = useMutation(api.squads.joinSquadBattle);
  const startBattle = useMutation(api.squads.startSquadBattle);
  const advanceBattle = useMutation(api.squads.advanceSquadBattle);
  const submitAnswer = useMutation(api.squads.submitSquadBattleAnswer);

  const [topic, setTopic] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const canHost = myRole === "owner" || myRole === "admin" || myRole === "mentor";

  // Active battle view (lobby or live)
  const showActiveBattle = battle && battle.status !== "completed";
  // Completed view
  const showCompleted = !showActiveBattle && completed && completed.status === "completed";

  const handleCreate = async () => {
    if (!topic.trim()) {
      toast.error("Enter a topic.");
      return;
    }
    setCreating(true);
    try {
      await createBattle({
        groupId,
        subjectName: subjectName || "General",
        topicName: topic.trim(),
        subjectId: (subjectId || undefined) as Id<"subjects"> | undefined,
      });
      toast.success("Quiz battle lobby open — your squad can join now.");
      setCreateOpen(false);
      setTopic("");
    } catch (error) {
      toast.error(friendlyError(error, "Could not create the battle."));
    } finally {
      setCreating(false);
    }
  };

  const handleAnswer = async (optionIndex: number) => {
    if (!battle || battle.status !== "active") return;
    try {
      await submitAnswer({
        battleId: battle.battleId,
        questionIndex: battle.questionIndex,
        optionIndex,
      });
    } catch (error) {
      toast.error(friendlyError(error, "Could not submit your answer."));
    }
  };

  const handleJoin = async () => {
    if (!battle) return;
    try {
      await joinBattle({ battleId: battle.battleId });
      toast.success("Joined the battle.");
    } catch (error) {
      toast.error(friendlyError(error, "Could not join."));
    }
  };

  const handleStart = async () => {
    if (!battle) return;
    try {
      await startBattle({ battleId: battle.battleId });
    } catch (error) {
      toast.error(friendlyError(error, "Could not start."));
    }
  };

  const handleAdvance = async () => {
    if (!battle) return;
    try {
      const result = await advanceBattle({ battleId: battle.battleId });
      if (result.completed) {
        toast.success("Battle complete! 🎉");
      }
    } catch (error) {
      toast.error(friendlyError(error, "Could not advance."));
    }
  };

  return (
    <SectionShell
      icon={<Sword className="size-4" />}
      label="quiz battles"
      sub="Real-time squad quiz competitions"
      action={
        canHost && !showActiveBattle ? (
          <Button size="sm" className="interactive-press cursor-pointer rounded-xl" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Host a battle
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {!battle && !completed ? (
          <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        ) : showActiveBattle && battle ? (
          <BattleLiveView
            battle={battle}
            onJoin={handleJoin}
            onStart={handleStart}
            onAdvance={handleAdvance}
            onAnswer={handleAnswer}
          />
        ) : showCompleted && completed ? (
          <BattleCompletedView battle={completed} />
        ) : (
          <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
            <Sword className="size-8 text-muted-foreground/40" />
            <p className="mt-3 type-body text-muted-foreground">No live or lobby battles.</p>
            <p className="type-caption text-muted-foreground/70">
              {canHost ? "Start one as the host." : "Wait for an owner/admin/mentor to start one."}
            </p>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sword className="size-4 text-amber-300" /> Host a squad quiz battle
            </DialogTitle>
            <DialogDescription>
              AI writes 10 questions on your topic. Members join the lobby, you start — everyone answers in real-time.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Topic</span>
              <Input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. Genetics, Integration"
                className="h-10 rounded-xl bg-white/5"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">Subject (optional)</span>
              <Select
                value={subjectId || "all"}
                onValueChange={(v) => {
                  if (v === "all") {
                    setSubjectId("");
                    setSubjectName("");
                  } else {
                    setSubjectId(v);
                    const subj = subjects.find((s) => s._id === v);
                    setSubjectName(subj?.name ?? "");
                  }
                }}
              >
                <SelectTrigger className="h-10 rounded-xl bg-white/5">
                  <SelectValue placeholder="General" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">General</SelectItem>
                  {subjects.map((s) => (
                    <SelectItem key={s._id} value={s._id}>
                      {s.name}
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
            <Button className="cursor-pointer rounded-xl" onClick={() => void handleCreate()} disabled={creating}>
              {creating ? "Generating questions…" : "Generate & open lobby"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionShell>
  );
}

function BattleLiveView({
  battle,
  onJoin,
  onStart,
  onAdvance,
  onAnswer,
}: {
  battle: NonNullable<ReturnType<typeof useQuery<typeof api.squads.getActiveSquadBattle>>>;
  onJoin: () => void;
  onStart: () => void;
  onAdvance: () => Promise<void>;
  onAnswer: (optionIndex: number) => void;
}) {
  // Compute time left
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const timeLeftMs = battle.questionEndsAt ? Math.max(0, battle.questionEndsAt - now) : 0;
  const timeLeftSec = Math.ceil(timeLeftMs / 1000);

  // Already answered this question?
  const myAnswer = battle.myAnswers[battle.questionIndex] ?? -1;
  const alreadyAnswered = myAnswer !== -1;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="glass-soft rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-rose-300">
              ⚔ {battle.status === "lobby" ? "lobby" : "live battle"}
            </p>
            <p className="mt-0.5 type-h3">{battle.topicName}</p>
            <p className="type-caption text-muted-foreground">{battle.subjectName}</p>
          </div>
          {battle.status === "active" && (
            <div className="text-right">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                question
              </p>
              <p className="font-mono text-2xl font-extrabold tabular-nums">
                {battle.questionIndex + 1} <span className="text-base text-muted-foreground">/ {battle.totalQuestions}</span>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Lobby state */}
      {battle.status === "lobby" && (
        <div className="glass-soft flex flex-col items-center rounded-2xl p-6 text-center">
          <p className="type-body">
            {battle.participants.length} member{battle.participants.length === 1 ? "" : "s"} in the lobby.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {battle.participants.map((p) => (
              <Badge key={p.userId} className="border-white/8 bg-white/5 text-muted-foreground">
                {p.name}
              </Badge>
            ))}
          </div>
          <div className="mt-5 flex gap-2">
            {!battle.isParticipant ? (
              <Button className="interactive-press cursor-pointer rounded-xl" onClick={onJoin}>
                <UserPlus className="size-4" /> Join battle
              </Button>
            ) : (
              <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="size-3" /> Joined
              </Badge>
            )}
            {battle.isHost && (
              <Button
                className="interactive-press cursor-pointer rounded-xl"
                onClick={onStart}
                disabled={battle.participants.length < 1}
              >
                <Zap className="size-4" /> Start now
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Active state — current question */}
      {battle.status === "active" && battle.currentQuestion && (
        <div className="flex flex-col gap-3">
          <div className="glass-soft rounded-2xl border border-white/8 p-5">
            {/* Timer */}
            <div className="flex items-center justify-between">
              <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                question {battle.questionIndex + 1} / {battle.totalQuestions}
              </p>
              <p className={cn(
                "flex items-center gap-1 font-mono text-sm font-bold tabular-nums",
                timeLeftSec <= 5 ? "text-rose-300" : "text-amber-300",
              )}>
                <Timer className="size-3.5" /> {timeLeftSec}s
              </p>
            </div>
            {/* Question */}
            <p className="mt-3 type-body text-foreground">{battle.currentQuestion.question}</p>
            {/* Options */}
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {battle.currentQuestion.options.map((opt, idx) => {
                const isMy = myAnswer === idx;
                const showCorrect = battle.isQuestionDone;
                const isCorrect = showCorrect && idx === battle.currentQuestion!.correctIndex;
                const isMineAndWrong = showCorrect && isMy && idx !== battle.currentQuestion!.correctIndex;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={alreadyAnswered || battle.isQuestionDone}
                    onClick={() => onAnswer(idx)}
                    className={cn(
                      "interactive-press flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed",
                      isCorrect
                        ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                        : isMineAndWrong
                          ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
                          : isMy
                            ? "border-primary/40 bg-primary/10"
                            : "border-white/8 bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <span className="font-mono text-xs font-bold text-muted-foreground">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="type-body">{opt}</span>
                    {isCorrect && <CheckCircle2 className="ml-auto size-4" />}
                  </button>
                );
              })}
            </div>
            {alreadyAnswered && !battle.isQuestionDone && (
              <p className="mt-3 flex items-center gap-1.5 text-emerald-300 type-caption">
                <CheckCircle2 className="size-3" /> Answered — waiting for the timer or host to advance.
              </p>
            )}
            {battle.isQuestionDone && battle.currentQuestion.explanation && (
              <p className="mt-3 rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 type-caption text-muted-foreground">
                <span className="font-bold text-foreground">Explanation: </span>{battle.currentQuestion.explanation}
              </p>
            )}
          </div>

          {/* Host controls */}
          {battle.isHost && (
            <div className="flex justify-center">
              <Button className="interactive-press cursor-pointer rounded-xl" onClick={() => void onAdvance()}>
                {battle.questionIndex + 1 >= battle.totalQuestions ? "Finish battle" : "Next question →"}
              </Button>
            </div>
          )}

          {/* Live leaderboard */}
          {battle.participants.length > 0 && (
            <div className="glass-soft rounded-2xl p-4">
              <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                battle leaderboard
              </p>
              <div className="mt-2 flex flex-col gap-1">
                {battle.participants.map((p, i) => (
                  <div
                    key={p.userId}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2.5 py-1.5",
                      i === 0 && "bg-amber-400/10",
                    )}
                  >
                    <span className="font-mono text-[10px] font-bold text-muted-foreground">
                      #{i + 1}
                    </span>
                    <span className="flex-1 truncate type-caption">{p.name}</span>
                    <span className="font-mono text-xs font-bold text-foreground">
                      {p.correctCount}/{battle.totalQuestions}
                    </span>
                    <span className="font-mono text-xs text-amber-300">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BattleCompletedView({
  battle,
}: {
  battle: NonNullable<ReturnType<typeof useQuery<typeof api.squads.getLatestCompletedBattle>>>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="glass-soft rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.04] p-5 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-300" />
        <p className="mt-2 type-h2">Battle complete 🎉</p>
        <p className="type-caption text-muted-foreground">
          {battle.topicName} · {battle.subjectName}
        </p>
      </div>
      <div className="glass-soft rounded-2xl p-4">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          final leaderboard
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {battle.participants.map((p, i) => (
            <div
              key={p.userId}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5",
                i === 0
                  ? "border-amber-400/30 bg-amber-400/10"
                  : "border-white/5 bg-white/[0.02]",
              )}
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-extrabold",
                  i === 0
                    ? "bg-gradient-to-br from-amber-400/20 to-amber-500/5 text-amber-300"
                    : "bg-white/5 text-muted-foreground",
                )}
              >
                {i === 0 ? <Medal className="size-4 text-amber-300" /> : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate type-body font-semibold">{p.name}</p>
                <p className="type-caption text-muted-foreground">
                  {p.correctCount}/{battle.totalQuestions} correct
                </p>
              </div>
              <p className="font-mono text-base font-extrabold tabular-nums text-amber-300">
                {p.score}
              </p>
            </div>
          ))}
        </div>
      </div>
      {battle.allQuestions && battle.allQuestions.length > 0 && (
        <details className="glass-soft rounded-2xl p-4">
          <summary className="cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
            review all questions
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {battle.allQuestions.map((q, i) => (
              <div key={i} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <p className="type-caption font-bold text-foreground">
                  Q{i + 1}. {q.question}
                </p>
                <div className="mt-1.5 flex flex-col gap-1">
                  {q.options.map((opt, idx) => (
                    <p
                      key={idx}
                      className={cn(
                        "type-caption",
                        idx === q.correctIndex ? "text-emerald-300" : "text-muted-foreground",
                      )}
                    >
                      {String.fromCharCode(65 + idx)}. {opt}
                      {idx === q.correctIndex && " ✓"}
                    </p>
                  ))}
                </div>
                {q.explanation && (
                  <p className="mt-1.5 type-caption text-muted-foreground">
                    <span className="font-bold text-foreground">Explanation: </span>{q.explanation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: SQUAD BOARD
// ═══════════════════════════════════════════════════════════════════════

function SquadBoard({
  groupId,
  myRole,
}: {
  groupId: Id<"studyGroups">;
  myRole: string;
}) {
  const friendlyError = useFriendlyError();
  const board = useQuery(api.squads.getSquadBoard, { groupId });
  const upsert = useMutation(api.squads.upsertBoardSlot);

  const canEdit = myRole === "owner" || myRole === "admin";

  if (!board) {
    return (
      <SectionShell icon={<Pin className="size-4" />} label="squad board">
        <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
      </SectionShell>
    );
  }

  return (
    <SectionShell
      icon={<Pin className="size-4" />}
      label="squad board"
      sub="Pinned content — managed by owner/admin"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <BoardSlotCard
          slot="current_goal"
          icon={<Target className="size-4" />}
          label="Current goal"
          item={board.currentGoal}
          canEdit={canEdit}
          onSave={async (content) => {
            try {
              await upsert({ groupId, slot: "current_goal", content });
              toast.success("Goal updated.");
            } catch (e) {
              toast.error(friendlyError(e, "Could not save."));
            }
          }}
        />
        <BoardSlotCard
          slot="next_session"
          icon={<CalendarIcon className="size-4" />}
          label="Next session"
          item={board.nextSession}
          canEdit={canEdit}
          onSave={async (content) => {
            try {
              await upsert({
                groupId,
                slot: "next_session",
                content,
                sessionAt: Date.now() + 24 * 60 * 60 * 1000, // default +1d; user can edit text freely
              });
              toast.success("Next session updated.");
            } catch (e) {
              toast.error(friendlyError(e, "Could not save."));
            }
          }}
        />
        <BoardSlotCard
          slot="announcement"
          icon={<Sparkles className="size-4" />}
          label="Announcement"
          item={board.announcement}
          canEdit={canEdit}
          onSave={async (content) => {
            try {
              await upsert({ groupId, slot: "announcement", content });
              toast.success("Announcement posted.");
            } catch (e) {
              toast.error(friendlyError(e, "Could not save."));
            }
          }}
        />
        <BoardSlotCard
          slot="resource"
          icon={<BookOpen className="size-4" />}
          label="Shared resource"
          item={board.resource}
          canEdit={canEdit}
          onSave={async (content) => {
            try {
              await upsert({ groupId, slot: "resource", content });
              toast.success("Resource linked.");
            } catch (e) {
              toast.error(friendlyError(e, "Could not save."));
            }
          }}
        />
      </div>
    </SectionShell>
  );
}

function BoardSlotCard({
  icon,
  label,
  item,
  canEdit,
  onSave,
}: {
  slot: "current_goal" | "next_session" | "announcement" | "resource";
  icon: ReactNode;
  label: string;
  item: { content: string; updatedAt: number } | null;
  canEdit: boolean;
  onSave: (content: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item?.content ?? "");

  useEffect(() => {
    setDraft(item?.content ?? "");
  }, [item?.content]);

  const handleSave = async () => {
    await onSave(draft);
    setEditing(false);
  };

  return (
    <div className="glass-soft rounded-2xl border border-white/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
          {icon} {label}
        </p>
        {canEdit && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300 hover:underline"
          >
            Edit
          </button>
        )}
      </div>
      {!editing ? (
        <p className="mt-2 type-body text-foreground/90">
          {item?.content || <span className="text-muted-foreground/50">—</span>}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={`Set ${label.toLowerCase()}…`}
            className="rounded-xl bg-white/5"
          />
          <div className="flex gap-1.5">
            <Button size="sm" className="cursor-pointer rounded-lg" onClick={() => void handleSave()}>
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="cursor-pointer rounded-lg bg-white/5"
              onClick={() => {
                setDraft(item?.content ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: EXAM PREP
// ═══════════════════════════════════════════════════════════════════════

function SquadExamPrep({
  groupId,
  myRole,
}: {
  groupId: Id<"studyGroups">;
  myRole: string;
}) {
  const friendlyError = useFriendlyError();
  const prep = useQuery(api.squads.getSquadExamPrep, { groupId });
  const generate = useAction(api.squads.generateSquadExamPrep);

  const [examDate, setExamDate] = useState("");
  const [generating, setGenerating] = useState(false);

  const canRegenerate = myRole === "owner" || myRole === "admin";

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const dateMs = examDate ? new Date(examDate).getTime() : undefined;
      await generate({
        groupId,
        examName: "EHEEE",
        examDate: dateMs,
      });
      toast.success("Squad exam prep generated!");
    } catch (error) {
      toast.error(friendlyError(error, "Could not generate."));
    } finally {
      setGenerating(false);
    }
  };

  let readiness: {
    subjectId: string;
    subjectName: string;
    readinessScore: number;
    status: "red" | "amber" | "yellow" | "green";
    memberCoverage: number;
  }[] = [];
  let plan: { todaysActions?: { subject: string; type: string; count: number; rationale: string }[]; focusTopic?: string; rationale?: string } | null = null;
  if (prep?.readinessJson) {
    try {
      readiness = JSON.parse(prep.readinessJson);
    } catch {
      // ignore parse errors
    }
  }
  if (prep?.todaysActionsJson) {
    try {
      plan = JSON.parse(prep.todaysActionsJson);
    } catch {
      // ignore
    }
  }

  const severityMeta: Record<string, { label: string; color: string }> = {
    red: { label: "🔴", color: "border-rose-400/30 bg-rose-400/[0.06] text-rose-300" },
    amber: { label: "🟠", color: "border-orange-400/30 bg-orange-400/[0.06] text-orange-300" },
    yellow: { label: "🟡", color: "border-yellow-400/30 bg-yellow-400/[0.06] text-yellow-300" },
    green: { label: "🟢", color: "border-emerald-400/30 bg-emerald-400/[0.06] text-emerald-300" },
  };

  return (
    <SectionShell
      icon={<GraduationCap className="size-4" />}
      label="squad exam prep"
      sub="EHEEE readiness + AI-generated today's actions"
      action={
        canRegenerate ? (
          <Button size="sm" className="interactive-press cursor-pointer rounded-xl" onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? "Generating…" : prep ? "Refresh plan" : "Generate plan"}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {canRegenerate && (
          <div className="glass-soft rounded-2xl p-4">
            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
              exam date (optional)
            </p>
            <Input
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="mt-1.5 h-10 rounded-xl bg-white/5"
            />
          </div>
        )}

        {!prep ? (
          <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
            <GraduationCap className="size-8 text-muted-foreground/40" />
            <p className="mt-3 type-body text-muted-foreground">No prep plan yet.</p>
            <p className="type-caption text-muted-foreground/70">
              {canRegenerate ? "Generate one to see readiness per subject." : "Ask the owner/admin to generate one."}
            </p>
          </div>
        ) : (
          <>
            {/* Readiness per subject */}
            {readiness.length > 0 && (
              <div>
                <p className="px-1 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  group readiness per subject
                </p>
                <div className="mt-2 flex flex-col gap-2">
                  {readiness.map((r) => {
                    const meta = severityMeta[r.status] ?? severityMeta.green;
                    return (
                      <div key={r.subjectId} className={cn("rounded-xl border p-3", meta.color)}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="type-body font-bold">
                            {meta.label} {r.subjectName}
                          </p>
                          <p className="font-mono text-lg font-extrabold tabular-nums">
                            {r.readinessScore}%
                          </p>
                        </div>
                        <Progress
                          value={r.readinessScore}
                          className="mt-1.5 h-1.5 rounded-full bg-white/10"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI plan */}
            {plan && (
              <div className="glass-soft rounded-2xl border border-purple-400/15 bg-purple-400/[0.03] p-4">
                <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-purple-300">
                  <Sparkles className="size-3" /> AI plan for today
                </p>
                {plan.focusTopic && (
                  <p className="mt-2 type-body text-foreground">
                    <span className="font-bold">Focus tonight:</span> {plan.focusTopic}
                  </p>
                )}
                {plan.todaysActions && plan.todaysActions.length > 0 && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {plan.todaysActions.map((a, i) => (
                      <div
                        key={i}
                        className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2"
                      >
                        <p className="type-caption font-bold text-foreground">
                          • {a.count}× {a.type.replace("_", " ")} · {a.subject}
                        </p>
                        <p className="mt-0.5 type-caption text-muted-foreground">
                          {a.rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
                {plan.rationale && (
                  <p className="mt-3 text-xs italic text-muted-foreground/80">
                    {plan.rationale}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </SectionShell>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: MEMBERS — with role assignment
// ═══════════════════════════════════════════════════════════════════════

function SquadMembers({
  groupId,
  members,
  myRole,
}: {
  groupId: Id<"studyGroups">;
  members:
    | {
        members: {
          userId: Id<"users">;
          name: string;
          role: "owner" | "admin" | "mentor" | "member";
          joinedAt: number;
          isMe: boolean;
          isOwner: boolean;
        }[];
        myRole: "owner" | "admin" | "mentor" | "member";
      }
    | undefined
    | null;
  myRole: string;
}) {
  const friendlyError = useFriendlyError();
  const setRole = useMutation(api.squads.setMemberRole);
  const transferOwnership = useMutation(api.squads.transferOwnership);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  if (!members) {
    return (
      <SectionShell icon={<Users className="size-4" />} label="members">
        <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
      </SectionShell>
    );
  }

  const canManageRoles = myRole === "owner" || myRole === "admin";

  return (
    <SectionShell
      icon={<Users className="size-4" />}
      label="members"
      sub="Roles: owner · admin · mentor · member"
    >
      <div className="flex flex-col gap-1.5">
        {members.members.map((m, i) => (
          <motion.div
            key={m.userId}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.25, delay: i * 0.03, ease: "easeOut" }}
            className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/15 font-mono text-xs font-extrabold text-amber-300">
              {m.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0]?.toUpperCase() ?? "")
                .join("")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate type-body font-semibold">
                {m.name}
                {m.isMe && (
                  <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300">you</Badge>
                )}
                {m.isOwner && <Crown className="size-3 shrink-0 text-amber-300" />}
                <RoleBadge role={m.role} compact />
              </p>
            </div>
            {/* Role assignment menu — visible to owner/admin */}
            {canManageRoles && !m.isOwner && (
              <Select
                value={m.role}
                onValueChange={async (v) => {
                  try {
                    if (v === "owner") {
                      if (window.confirm(`Transfer ownership to ${m.name}? You will become an admin.`)) {
                        await transferOwnership({ groupId, newOwnerId: m.userId });
                        toast.success("Ownership transferred.");
                      }
                    } else {
                      await setRole({
                        groupId,
                        userId: m.userId,
                        newRole: v as "admin" | "mentor" | "member",
                      });
                      toast.success(`Role updated to ${v}.`);
                    }
                  } catch (e) {
                    toast.error(friendlyError(e, "Could not update role."));
                  }
                }}
              >
                <SelectTrigger className="h-7 w-28 rounded-lg bg-white/5 text-[11px] font-bold uppercase">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Transfer ownership</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="mentor">Mentor</SelectItem>
                  <SelectItem value="member">Member</SelectItem>
                </SelectContent>
              </Select>
            )}
            <ReportBlockMenu
              targetUserId={m.userId}
              targetName={m.name}
              compact
              disabled={m.isMe}
            />
          </motion.div>
        ))}
      </div>

      {/* Roles explainer */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <RoleExplainer icon={<Crown className="size-3" />} name="Owner" desc="Full control" />
        <RoleExplainer icon={<Shield className="size-3" />} name="Admin" desc="Manage board + roles" />
        <RoleExplainer icon={<GraduationCap className="size-3" />} name="Mentor" desc="Create challenges, host battles" />
        <RoleExplainer icon={<Users className="size-3" />} name="Member" desc="Study, chat, contribute" />
      </div>
    </SectionShell>
  );
}

function RoleExplainer({ icon, name, desc }: { icon: ReactNode; name: string; desc: string }) {
  return (
    <div className="glass-soft rounded-lg border border-white/5 p-2.5">
      <p className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
        {icon} {name}
      </p>
      <p className="mt-0.5 type-caption text-muted-foreground">{desc}</p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// TAB: ROOMS — existing live video rooms
// ═══════════════════════════════════════════════════════════════════════

function SquadRooms({
  activeRooms,
  liveCount,
  onStartRoom,
  startingRoom,
  navigate,
}: {
  activeRooms:
    | {
        roomId: Id<"studyRooms">;
        name: string;
        createdByName: string;
        participantCount: number;
        iAmIn: boolean;
      }[]
    | undefined;
  liveCount: number;
  onStartRoom: () => void;
  startingRoom: boolean;
  navigate: (path: string) => void;
}) {
  return (
    <SectionShell
      icon={<MonitorPlay className="size-4" />}
      label="study rooms"
      sub="Live video · members only · nothing is public"
      action={
        <Button
          className="interactive-press cursor-pointer rounded-xl"
          onClick={onStartRoom}
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
        <div className="glass-soft flex flex-col items-center rounded-2xl px-6 py-12 text-center">
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
            Start a room and your squad members will get a notification with a
            link to join.
          </p>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5">
            <CircleDot className="size-3.5 text-muted-foreground/50" />
            <span className="type-mono text-[11px] text-muted-foreground/60">
              tip: rooms are private to this squad — nothing is public
            </span>
          </div>
        </div>
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
  );
}
