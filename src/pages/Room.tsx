// Study room — video + screen share + persistent chat + shared workspace,
// scoped to a study group. Entry points are ONLY the group's room section on
// /groups; there is no global room directory.
//
// Video runs on LiveKit Cloud (@livekit/components-react): the participant
// grid, mute/camera/screen-share controls and audio renderer come from the
// provider SDK — we never hand-roll WebRTC. The join token is minted
// server-side (roomsActions.getJoinToken) AFTER group membership + block
// checks, and is short-lived. Chat uses Convex roomMessages (reactive, no
// extra websocket layer) and persists after the room ends.
//
// SAFETY: report + block are one tap away from every participant tile. No
// recording exists anywhere in this build.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  ControlBar,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Loader2,
  MessageSquare,
  MicOff,
  Paperclip,
  PhoneOff,
  Share2,
  ShieldAlert,
  Square,
  Users,
  VideoOff,
} from "lucide-react";
import { Track } from "livekit-client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { ReportBlockMenu } from "@/components/ReportBlockMenu";
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
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function timeAgo(ms: number): string {
  const seconds = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomIdRef = useRef(roomId ?? null);
  roomIdRef.current = roomId ?? null;

  const room = useQuery(
    api.rooms.getRoomById,
    roomId ? { roomId: roomId as Id<"studyRooms"> } : "skip",
  );
  const messages = useQuery(
    api.rooms.getRoomMessages,
    roomId ? { roomId: roomId as Id<"studyRooms"> } : "skip",
  );
  const sharedItems = useQuery(
    api.rooms.getRoomSharedItems,
    roomId ? { roomId: roomId as Id<"studyRooms"> } : "skip",
  );

  const getJoinToken = useAction(api.roomsActions.getJoinToken);
  const endRoom = useAction(api.roomsActions.endRoom);
  const joinPresence = useMutation(api.rooms.joinRoomPresence);
  const leavePresence = useMutation(api.rooms.leaveRoom);
  const sendMessage = useMutation(api.rooms.sendRoomMessage);
  const shareItem = useMutation(api.rooms.shareItem);

  const [token, setToken] = useState<string | null>(null);
  const [liveKitUrl, setLiveKitUrl] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [roomEndedByHost, setRoomEndedByHost] = useState(false);
  const [leftRoom, setLeftRoom] = useState(false);
  const [endedForEveryone, setEndedForEveryone] = useState(false);

  const [chatText, setChatText] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [shareDialog, setShareDialog] = useState<null | "content" | "note">(null);
  const [contentSearch, setContentSearch] = useState("");
  const [shareTarget, setShareTarget] = useState<{ itemType: "content" | "note"; itemId: string; title: string } | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const contentOptions = useQuery(
    api.content.getContent,
    { searchQuery: contentSearch.trim() || undefined },
  );
  const myNotes = useQuery(api.notes.list, {});

  const joinedRef = useRef(false);

  // ---- Join: mint token (server-side safety checks), mark presence ----
  useEffect(() => {
    if (!room || room.status !== "active" || token) return;
    let cancelled = false;
    void (async () => {
      try {
        const { url, token: liveToken } = await getJoinToken({ roomId: room.roomId });
        if (cancelled) return;
        setLiveKitUrl(url);
        setToken(liveToken);
        joinedRef.current = true;
        await joinPresence({ roomId: room.roomId });
      } catch (error) {
        if (!cancelled) {
          setJoinError(errorMessage(error, "Could not join the room."));
        }
      } finally {
        // The room query remains the source of truth for join readiness.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [room, token, getJoinToken, joinPresence]);

  // ---- Leave presence when the page unmounts (or room ends) ----
  useEffect(() => {
    return () => {
      if (joinedRef.current && roomIdRef.current) {
        void leavePresence({ roomId: roomIdRef.current as Id<"studyRooms"> });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Room ended (host ended or provider auto-closed): stop showing video ----
  useEffect(() => {
    if (room && room.status === "ended") {
      setRoomEndedByHost(true);
    }
  }, [room]);

  // ---- Chat autoscroll ----
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages?.length]);

  const handleSend = async () => {
    const text = chatText.trim();
    if (!text || !roomId) return;
    setSending(true);
    try {
      await sendMessage({ roomId: roomId as Id<"studyRooms">, content: text });
      setChatText("");
    } catch (error) {
      toast.error(errorMessage(error, "Could not send the message."));
    } finally {
      setSending(false);
    }
  };

  const handleShare = async () => {
    if (!shareTarget || !roomId) return;
    try {
      await shareItem({
        roomId: roomId as Id<"studyRooms">,
        itemType: shareTarget.itemType,
        itemId: shareTarget.itemId,
      });
      toast.success(`Shared “${shareTarget.title}” with the room.`);
      setShareDialog(null);
      setShareTarget(null);
      setWorkspaceOpen(true);
    } catch (error) {
      toast.error(errorMessage(error, "Could not share that item."));
    }
  };

  const handleLeave = async () => {
    if (roomId) {
      joinedRef.current = false;
      try {
        await leavePresence({ roomId: roomId as Id<"studyRooms"> });
      } catch {
        // best-effort — we're leaving the page anyway
      }
    }
    setLeftRoom(true);
    navigate("/groups");
  };

  const handleEndForEveryone = async () => {
    if (!roomId) return;
    setEnding(true);
    try {
      await endRoom({ roomId: roomId as Id<"studyRooms"> });
      joinedRef.current = false;
      setEndedForEveryone(true);
      toast.success("Room ended — everyone's video was disconnected.");
      navigate("/groups");
    } catch (error) {
      toast.error(errorMessage(error, "Could not end the room."));
    } finally {
      setEnding(false);
    }
  };

  const visibleSharedItems = useMemo(() => sharedItems ?? [], [sharedItems]);
  const visibleMessages = useMemo(() => messages ?? [], [messages]);

  if (!roomId) {
    return <EmptyState icon={<ShieldAlert className="size-6" />} title="Room not found" body="This room link is invalid." />;
  }

  // ----- Loading -----
  if (!room) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="size-6 animate-spin text-amber-300" />
          <p className="font-mono text-xs uppercase tracking-[0.2em]">Entering room…</p>
        </div>
      </div>
    );
  }

  // ----- Ended -----
  if (room.status === "ended" || roomEndedByHost) {
    return (
      <EmptyState
        icon={<Square className="size-6 text-muted-foreground" />}
        title={roomEndedByHost ? "This room has ended" : "Room closed"}
        body={
          endedForEveryone
            ? "You ended the room for everyone — video was disconnected."
            : "The host ended the session. Chat stays available for review in the group."
        }
        action={
          <Button className="cursor-pointer rounded-xl" onClick={() => navigate("/groups")}>
            <ArrowLeft className="size-4" /> Back to groups
          </Button>
        }
      />
    );
  }

  // ----- Could not join (blocked / not member / not configured) -----
  if (joinError) {
    return (
      <EmptyState
        icon={<ShieldAlert className="size-6 text-destructive" />}
        title="Can't join this room"
        body={joinError}
        action={
          <Button className="cursor-pointer rounded-xl" onClick={() => navigate("/groups")}>
            <ArrowLeft className="size-4" /> Back to groups
          </Button>
        }
      />
    );
  }

  if (leftRoom) return null;

  // ----- Live room -----
  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void handleLeave()}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label="Leave room"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-extrabold tracking-tight">{room.name}</h1>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <Users className="size-3" /> {room.groupName} · {room.participants.length} in room
              {room.iAmIn ? " · you're here" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setChatOpen((v) => !v)}
            className={cn(
              "flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors",
              chatOpen
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : "border-white/10 text-muted-foreground hover:bg-white/5",
            )}
          >
            <MessageSquare className="size-3.5" /> Chat
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceOpen((v) => !v)}
            className={cn(
              "flex h-9 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition-colors",
              workspaceOpen
                ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
                : "border-white/10 text-muted-foreground hover:bg-white/5",
            )}
          >
            <Share2 className="size-3.5" /> Workspace
          </button>
          {room.canEndRoom && (
            <Button
              variant="destructive"
              size="sm"
              className="cursor-pointer rounded-xl"
              onClick={() => setConfirmingEnd(true)}
            >
              <Square className="size-3.5" /> End for everyone
            </Button>
          )}
        </div>
      </header>

      {deviceError && (
        <div className="flex items-center gap-2 border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
          <MicOff className="size-3.5 shrink-0" />
          <span>{deviceError}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_320px]">
        {/* Video area */}
        <div className="flex min-h-0 flex-col">
          <div className="relative min-h-0 flex-1 overflow-hidden p-3">
            {!token ? (
              <div className="flex h-full items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                  <Loader2 className="size-6 animate-spin text-amber-300" />
                  <p className="font-mono text-xs uppercase tracking-[0.2em]">Connecting…</p>
                </div>
              </div>
            ) : (
              <LiveKitRoom
                token={token}
                serverUrl={liveKitUrl ?? undefined}
                connect={true}
                onError={(error) => {
                  if (error?.message?.toLowerCase().includes("permission")) {
                    setDeviceError("Camera or microphone permission was denied — allow access in your browser and try again.");
                  } else {
                    setDeviceError(error?.message ?? "Connection problem.");
                  }
                }}
                className="h-full"
              >
                <RoomAudioRenderer />
                <LiveVideo />
              </LiveKitRoom>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center gap-3 border-t border-white/5 px-4 py-3">
            {token ? (
              <>
                <ControlBar
                  variation="minimal"
                  controls={{ microphone: true, camera: true, screenShare: true, chat: false, leave: false, settings: false }}
                  onDeviceError={({ error }) => {
                    setDeviceError(
                      error?.message?.toLowerCase().includes("permission")
                        ? "Camera or microphone permission was denied — allow access in your browser and try again."
                        : error?.message ?? "A media device error occurred.",
                    );
                  }}
                  className="!bg-transparent !p-0 [&>button]:rounded-xl [&>button]:border [&>button]:border-white/10 [&>button]:bg-white/5 [&>button]:text-foreground [&>button]:hover:bg-white/10"
                />
                <Button
                  variant="outline"
                  className="cursor-pointer rounded-xl border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
                  onClick={() => setConfirmingLeave(true)}
                >
                  <PhoneOff className="size-4" /> Leave
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Joining…
              </div>
            )}
          </div>
        </div>

        {/* Right panels */}
        <AnimatePresence>
          {(chatOpen || workspaceOpen) && (
            <motion.aside
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.2 }}
              className="flex min-h-0 flex-col border-l border-white/5 bg-black/20"
            >
              {chatOpen && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
                      <MessageSquare className="size-3.5 text-amber-300" /> Room chat
                    </p>
                    <button
                      type="button"
                      onClick={() => setChatOpen(false)}
                      className="cursor-pointer text-muted-foreground hover:text-foreground"
                      aria-label="Close chat"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3" data-lenis-prevent-wheel>
                    {visibleMessages.length === 0 ? (
                      <p className="pt-10 text-center text-xs text-muted-foreground">
                        No messages yet — say hi and share what you're studying.
                      </p>
                    ) : (
                      visibleMessages.map((message: { _id: string; isMine: boolean; content: string; name: string; userId: string; createdAt: number }) => (
                        <div key={message._id} className={cn("flex flex-col", message.isMine ? "items-end" : "items-start")}>
                          <div
                            className={cn(
                              "max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                              message.isMine
                                ? "rounded-br-sm bg-amber-400/20 text-foreground"
                                : "rounded-bl-sm bg-white/5 text-foreground",
                            )}
                          >
                            {!message.isMine && (
                              <p className="mb-0.5 text-[10px] font-bold text-amber-300">{message.name}</p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{message.content}</p>
                          </div>
                          <p className="mt-1 font-mono text-[9px] text-muted-foreground">
                            {message.isMine ? "you" : ""} · {timeAgo(message.createdAt)}
                          </p>
                        </div>
                      ))
                    )}
                    <div ref={chatBottomRef} />
                  </div>
                  <div className="flex gap-2 border-t border-white/5 p-3">
                    <Input
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleSend();
                        }
                      }}
                      placeholder="Message the room…"
                      className="h-9 rounded-xl bg-white/5 text-sm"
                    />
                    <Button
                      size="sm"
                      className="h-9 cursor-pointer rounded-xl px-3"
                      onClick={() => void handleSend()}
                      disabled={sending || !chatText.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </div>
              )}

              {workspaceOpen && (
                <div className="flex min-h-0 flex-1 flex-col border-t border-white/5 lg:border-t-0">
                  <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">
                      <Share2 className="size-3.5 text-amber-300" /> Shared workspace
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setShareDialog("content")}
                        className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                        title="Share a content item"
                      >
                        <BookOpen className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShareDialog("note")}
                        className="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                        title="Share one of your notes"
                      >
                        <FileText className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setWorkspaceOpen(false)}
                        className="cursor-pointer p-1.5 text-muted-foreground hover:text-foreground"
                        aria-label="Close workspace"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" data-lenis-prevent-wheel>
                    {visibleSharedItems.length === 0 ? (
                      <p className="pt-10 text-center text-xs leading-5 text-muted-foreground">
                        Nothing shared yet.
                        <br />
                        Link a textbook, past exam or note so the group can study the same page while talking.
                      </p>
                    ) : (
                      visibleSharedItems.map((item: { _id: string; title: string; itemType: string; sharedAt: number; contentType?: string; subjectName?: string | null; grade?: number; fileUrl?: string; content?: string }) => (
                        <div key={item._id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold">{item.title}</p>
                              <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                                {item.itemType === "content" ? `${item.contentType ?? "content"} · ${item.subjectName ?? ""} · grade ${item.grade ?? "—"}` : "your note"}
                              </p>
                            </div>
                            {item.itemType === "content" && item.fileUrl && (
                              <a
                                href={item.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 cursor-pointer rounded-lg border border-white/10 px-2 py-1 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/10"
                              >
                                Open
                              </a>
                            )}
                          </div>
                          {item.itemType === "note" && item.content && (
                            <p className="mt-2 line-clamp-4 whitespace-pre-wrap rounded-lg bg-white/[0.03] p-2 text-[11px] leading-relaxed text-muted-foreground">
                              {item.content}
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {/* Participant strip overlay (bottom-left) */}
      {room.participants.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 flex max-w-[60vw] gap-2 overflow-x-auto rounded-2xl border border-white/5 bg-black/50 p-2 backdrop-blur">
          {room.participants.map((participant) => (
            <div
              key={participant.userId}
              className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-xl bg-white/5 py-1.5 pl-1.5 pr-1"
            >
              <div className="flex size-7 items-center justify-center rounded-lg bg-amber-400/15 font-mono text-[10px] font-extrabold text-amber-300">
                {initialsOf(participant.name)}
              </div>
              <div className="flex flex-col">
                <p className="max-w-[100px] truncate text-[10px] font-bold leading-tight">
                  {participant.name}
                  {participant.isMe ? " (you)" : ""}
                </p>
                <p className="text-[8px] uppercase tracking-wide text-muted-foreground">
                  {participant.isCreator ? "host" : "member"}
                </p>
              </div>
              <ReportBlockMenu
                targetUserId={participant.userId as Id<"users">}
                targetName={participant.name}
                roomId={room.roomId}
                compact
                disabled={participant.isMe}
              />
            </div>
          ))}
        </div>
      )}

      {/* End-for-everyone confirm */}
      <Dialog open={confirmingEnd} onOpenChange={setConfirmingEnd}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Square className="size-4 text-destructive" /> End room for everyone?
            </DialogTitle>
            <DialogDescription>
              This disconnects every participant&apos;s video and closes the room.
              Chat history stays saved for the group.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer rounded-xl bg-white/5"
              onClick={() => setConfirmingEnd(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="cursor-pointer rounded-xl"
              onClick={() => void handleEndForEveryone()}
              disabled={ending}
            >
              {ending ? "Ending…" : "End for everyone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Leave confirm */}
      <Dialog open={confirmingLeave} onOpenChange={setConfirmingLeave}>
        <DialogContent className="glass-panel max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneOff className="size-4" /> Leave the room?
            </DialogTitle>
            <DialogDescription>
              You can rejoin from the group&apos;s room section while it&apos;s active.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer rounded-xl bg-white/5"
              onClick={() => setConfirmingLeave(false)}
            >
              Stay
            </Button>
            <Button className="cursor-pointer rounded-xl" onClick={() => void handleLeave()}>
              Leave room
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Share picker */}
      <Dialog open={shareDialog !== null} onOpenChange={(open) => !open && setShareDialog(null)}>
        <DialogContent className="glass-panel max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="size-4 text-amber-300" />
              {shareDialog === "content" ? "Share a content item" : "Share one of your notes"}
            </DialogTitle>
            <DialogDescription>
              Everyone in the room will see it in the shared workspace.
            </DialogDescription>
          </DialogHeader>
          {shareDialog === "content" ? (
            <div className="flex flex-col gap-3">
              <Input
                value={contentSearch}
                onChange={(e) => setContentSearch(e.target.value)}
                placeholder="Search textbooks, past exams, guides…"
                className="h-10 rounded-xl bg-white/5"
              />
              <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto" data-lenis-prevent-wheel>
                {contentOptions === undefined ? (
                  <div className="h-24 animate-pulse rounded-xl bg-white/5" />
                ) : contentOptions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No content matches.</p>
                ) : (
                  contentOptions.slice(0, 30).map((item: { _id: string; title: string; contentType: string; subjectName?: string | null; grade?: number }) => (
                    <button
                      key={item._id}
                      type="button"
                      onClick={() =>
                        setShareTarget({ itemType: "content", itemId: item._id, title: item.title })
                      }
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                        shareTarget?.itemId === item._id
                          ? "border-primary/40 bg-primary/10"
                          : "border-white/5 bg-white/[0.02] hover:bg-white/5",
                      )}
                    >
                      <BookOpen className="size-4 shrink-0 text-amber-300" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{item.title}</p>
                        <p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                          {item.subjectName} · grade {item.grade} · {item.contentType}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto" data-lenis-prevent-wheel>
              {myNotes === undefined ? (
                <div className="h-24 animate-pulse rounded-xl bg-white/5" />
              ) : myNotes.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  You don&apos;t have any notes yet — create one on the Notes page.
                </p>
              ) : (
                myNotes.slice(0, 30).map((note: { _id: string; content: string; color: string; subjectName?: string }) => (
                  <button
                    key={note._id}
                    type="button"
                    onClick={() =>
                      setShareTarget({
                        itemType: "note",
                        itemId: note._id,
                        title: `Note · ${note.subjectName}`,
                      })
                    }
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      shareTarget?.itemId === note._id
                        ? "border-primary/40 bg-primary/10"
                        : "border-white/5 bg-white/[0.02] hover:bg-white/5",
                    )}
                  >
                    <FileText className="size-4 shrink-0 text-amber-300" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        Note · {note.subjectName}
                      </p>
                      <p className="truncate font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
                        {note.content.slice(0, 60)}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              className="cursor-pointer rounded-xl bg-white/5"
              onClick={() => {
                setShareDialog(null);
                setShareTarget(null);
              }}
            >
              Cancel
            </Button>
            <Button
              className="cursor-pointer rounded-xl"
              onClick={() => void handleShare()}
              disabled={!shareTarget}
            >
              <Share2 className="size-4" /> Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Video grid — rendered INSIDE LiveKitRoom so it has access to the room
 *  context (useTracks subscribes to the LiveKit connection). */
function LiveVideo() {
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <VideoOff className="size-6" />
          <p className="font-mono text-xs uppercase tracking-[0.2em]">Waiting for participants…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "grid h-full gap-2",
        tracks.length === 1
          ? "grid-cols-1"
          : tracks.length === 2
            ? "grid-cols-1 sm:grid-cols-2"
            : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {tracks.map((track) => (
        <ParticipantTile
          key={`${track.participant.identity}-${track.source}`}
          trackRef={track}
          className="overflow-hidden rounded-2xl border border-white/5 bg-black/40"
        />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glass-panel flex max-w-md flex-col items-center rounded-2xl px-8 py-12 text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-white/5">{icon}</div>
        <h1 className="mt-4 text-lg font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
  );
}
