import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  FileText,
  MessageSquare,
  Mic,
  Paperclip,
  Send,
  Square,
  Video,
  ImageIcon,
  Download,
  Clock,
} from "lucide-react";
import { useEffect, useRef, useState, useCallback } from "react";
import { toast } from "sonner";
import { ReportBlockMenu } from "@/components/ReportBlockMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";
import { motion, AnimatePresence } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  groupId: Id<"studyGroups">;
  groupName: string;
  onStartRoom: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDuration(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `0:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* seeded colour from username so it stays consistent */
function nameToHue(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return ((hash % 360) + 360) % 360;
}

/* ------------------------------------------------------------------ */
/*  Typing indicator                                                    */
/* ------------------------------------------------------------------ */

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1.5 w-1.5 rounded-full bg-primary/60"
          style={{
            animation: `nexus-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Voice-note waveform player                                         */
/* ------------------------------------------------------------------ */

function VoicePlayer({
  storageId,
  groupId,
  name,
  durationSeconds,
}: {
  storageId: string;
  groupId: Id<"studyGroups">;
  name: string;
  durationSeconds: number;
}) {
  const url = useQuery(api.groupChat.getAttachmentUrl, {
    groupId,
    storageId,
  });
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const rafRef = useRef<number>(0);

  const BARS = 28;

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (a && !a.paused && a.duration) {
      setProgress(a.currentTime / a.duration);
      rafRef.current = requestAnimationFrame(tick);
    }
  }, []);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
      rafRef.current = requestAnimationFrame(tick);
    } else {
      a.pause();
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    }
  };

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="mt-1.5 flex items-center gap-2.5 rounded-xl bg-white/[0.04] px-3 py-2.5">
      <button
        onClick={toggle}
        className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary transition-colors hover:bg-primary/30"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <Square className="size-2.5 fill-current" />
        ) : (
          <svg className="size-3" viewBox="0 0 12 14" fill="currentColor">
            <path d="M0 0l10 7-10 7z" />
          </svg>
        )}
      </button>

      {/* wave bars */}
      <div className="flex flex-1 items-center gap-[2px]" aria-hidden="true">
        {Array.from({ length: BARS }).map((_, i) => {
          const pos = i / BARS;
          /* pseudo-random height */
          const h = 6 + Math.abs(Math.sin(i * 2.7 + 1.3)) * 14;
          const filled = pos <= progress;
          return (
            <span
              key={i}
              className="w-[3px] rounded-full transition-all duration-200"
              style={{
                height: `${h}px`,
                backgroundColor: filled
                  ? "oklch(0.75 0.15 180)"
                  : "oklch(0.35 0.04 180 / 0.5)",
              }}
            />
          );
        })}
      </div>

      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {formatDuration(durationSeconds)}
      </span>

      {url && (
        <audio
          ref={audioRef}
          src={url}
          preload="metadata"
          onEnded={() => {
            setPlaying(false);
            setProgress(0);
            cancelAnimationFrame(rafRef.current);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File attachment preview card                                       */
/* ------------------------------------------------------------------ */

function FileCard({
  storageId,
  groupId,
  name,
  isImage,
}: {
  storageId: string;
  groupId: Id<"studyGroups">;
  name: string;
  isImage: boolean;
}) {
  const url = useQuery(api.groupChat.getAttachmentUrl, {
    groupId,
    storageId,
  });

  if (!url) {
    return (
      <span className="text-[11px] text-muted-foreground">
        Attachment unavailable
      </span>
    );
  }

  if (isImage) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="group/img mt-1.5 block overflow-hidden rounded-xl border border-white/[0.06] transition-all hover:border-primary/30 hover:shadow-[0_0_20px_rgba(0,255,200,0.06)]"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name}
          className="max-h-52 w-full object-cover transition-transform duration-500 group-hover/img:scale-[1.03]"
          loading="lazy"
        />
        <div className="flex items-center gap-1.5 bg-white/[0.03] px-2.5 py-1.5">
          <ImageIcon className="size-3 text-primary/60" />
          <span className="truncate text-[11px] text-muted-foreground">
            {name}
          </span>
        </div>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1.5 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-all hover:border-primary/30 hover:bg-white/[0.05] hover:shadow-[0_0_16px_rgba(0,255,200,0.05)]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <FileText className="size-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-foreground/90">
          {name}
        </p>
      </div>
      <Download className="size-3.5 shrink-0 text-muted-foreground" />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Fallback attachment preview (for non-voice, non-image legacy)      */
/* ------------------------------------------------------------------ */

function AttachmentPreview({
  groupId,
  storageId,
  name,
  voice,
  messageType,
  voiceNoteDurationSeconds,
}: {
  groupId: Id<"studyGroups">;
  storageId: string;
  name: string;
  voice?: boolean;
  messageType?: string;
  voiceNoteDurationSeconds?: number;
}) {
  if (voice || messageType === "voice_note") {
    return (
      <VoicePlayer
        storageId={storageId}
        groupId={groupId}
        name={name}
        durationSeconds={voiceNoteDurationSeconds ?? 0}
      />
    );
  }

  const isImage =
    messageType === "image" ||
    /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name);

  return (
    <FileCard
      storageId={storageId}
      groupId={groupId}
      name={name}
      isImage={isImage}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Avatar                                                             */
/* ------------------------------------------------------------------ */

function Avatar({
  name,
  isMine,
  className = "",
}: {
  name: string;
  isMine: boolean;
  className?: string;
}) {
  const initials = getInitials(name);
  const hue = nameToHue(name);

  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full text-[11px] font-bold uppercase tracking-wide ${className}`}
      style={{
        width: 30,
        height: 30,
        background: isMine
          ? "oklch(0.45 0.12 180)"
          : `oklch(0.30 0.06 ${hue})`,
        color: isMine
          ? "oklch(0.98 0.005 180)"
          : `oklch(0.80 0.08 ${hue}`,
        boxShadow: isMine
          ? "0 0 12px oklch(0.55 0.15 180 / 0.25)"
          : "none",
      }}
      title={name}
    >
      {initials}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Message bubble                                                     */
/* ------------------------------------------------------------------ */

function MessageBubble({
  message,
  groupId,
}: {
  message: {
    _id: string;
    userName: string;
    userId: string;
    isMine: boolean;
    content?: string;
    attachmentStorageId?: string;
    attachmentName?: string;
    messageType?: string;
    voiceNoteDurationSeconds?: number;
    _creationTime: number;
  };
  groupId: Id<"studyGroups">;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        type: "spring",
        stiffness: 420,
        damping: 32,
        mass: 0.8,
      }}
      className={`flex items-end gap-2.5 ${message.isMine ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <Avatar name={message.userName} isMine={message.isMine} />

      {/* Bubble */}
      <div
        className={`relative max-w-[78%] min-w-0 ${message.isMine ? "items-end" : "items-start"} flex flex-col`}
      >
        <div
          className={`group relative rounded-2xl px-3.5 py-2.5 transition-shadow duration-300 ${
            message.isMine
              ? "rounded-tr-sm bg-gradient-to-br from-primary/25 via-primary/15 to-primary/10 shadow-[0_0_24px_oklch(0.55_0.15_180_/_0.08)] hover:shadow-[0_0_32px_oklch(0.55_0.15_180_/_0.14)]"
              : "rounded-tl-sm border border-white/[0.06] bg-white/[0.04] backdrop-blur-sm hover:bg-white/[0.06]"
          }`}
        >
          {/* Name + actions row */}
          <div
            className={`flex items-center gap-1.5 ${message.isMine ? "flex-row-reverse" : "flex-row"}`}
          >
            <span
              className={`text-[10px] font-semibold tracking-wide ${message.isMine ? "text-primary/70" : "text-muted-foreground/70"}`}
            >
              {message.isMine ? "You" : message.userName}
            </span>
            {!message.isMine && (
              <ReportBlockMenu
                targetUserId={message.userId as Id<"users">}
                targetName={message.userName}
                compact
              />
            )}
          </div>

          {/* Content */}
          {message.content && (
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
              {message.content}
            </p>
          )}

          {/* Attachment */}
          {message.attachmentStorageId && (
            <AttachmentPreview
              groupId={groupId}
              storageId={message.attachmentStorageId}
              name={message.attachmentName ?? "Attachment"}
              voice={message.messageType === "voice_note"}
              messageType={message.messageType}
              voiceNoteDurationSeconds={message.voiceNoteDurationSeconds}
            />
          )}
        </div>

        {/* Timestamp */}
        <span
          className={`mt-1 block px-1 text-[9px] tabular-nums text-muted-foreground/50 ${message.isMine ? "text-right" : "text-left"}`}
        >
          {formatTime(message._creationTime)}
        </span>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Recording timer                                                    */
/* ------------------------------------------------------------------ */

function RecordingTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <span className="tabular-nums text-xs font-medium text-destructive">
      {formatDuration(elapsed)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function GroupChatPanel({ groupId, groupName, onStartRoom }: Props) {
  const messages = useQuery(api.groupChat.getMessages, {
    groupId,
    limit: 60,
  });
  const sendMessage = useMutation(api.groupChat.sendMessage);
  const generateUploadUrl = useMutation(api.groupChat.generateUploadUrl);
  const sendAttachment = useMutation(api.groupChat.sendAttachment);
  const sendVoiceNote = useMutation(api.groupChat.sendVoiceNote);

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const recordingStartedAt = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages?.length]);

  /* ---- upload helpers ---- */

  /**
   * Convex file upload returns `{ storageId: string }` but the shape can
   * vary (nested objects, extra wrapping). This helper drills down to the
   * actual string ID no matter what.
   */
  const extractStorageId = (raw: unknown): string => {
    // 1. Direct string
    if (typeof raw === "string") return raw;
    // 2. Object with .storageId
    if (raw && typeof raw === "object") {
      let current: unknown = raw;
      // Drill up to 3 levels deep looking for a string `.storageId`
      for (let depth = 0; depth < 3; depth++) {
        if (typeof current === "string") return current;
        if (current && typeof current === "object" && "storageId" in current) {
          current = (current as Record<string, unknown>).storageId;
        } else {
          break;
        }
      }
      if (typeof current === "string") return current;
    }
    console.error("[GroupChat] Could not extract storageId from:", raw);
    throw new Error("Upload response did not contain a valid storage ID");
  };

  const upload = async (blob: Blob, name: string, type: "file" | "image") => {
    const url = await generateUploadUrl({ groupId });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (!response.ok) throw new Error("Attachment upload failed");
    const uploadResult = await response.json();
    const storageId = extractStorageId(uploadResult);
    await sendAttachment({
      groupId,
      attachmentStorageId: storageId,
      attachmentType: type,
      attachmentName: name,
    });
  };

  const chooseFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Attachments must be under 10 MB.");
      return;
    }
    setBusy(true);
    try {
      await upload(
        file,
        file.name,
        file.type.startsWith("image/") ? "image" : "file",
      );
    } catch (e) {
      toast.error(errorMessage(e, "Could not send attachment."));
    } finally {
      setBusy(false);
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder
    ) {
      toast.error("Voice notes are not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      const r = new MediaRecorder(stream);
      recorder.current = r;
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setRecording(false);
        const blob = new Blob(chunks.current, {
          type: r.mimeType || "audio/webm",
        });
        setBusy(true);
        try {
          const url = await generateUploadUrl({ groupId });
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          if (!response.ok) throw new Error("Voice note upload failed");
          const uploadResult = await response.json();
          const storageId = extractStorageId(uploadResult);
          await sendVoiceNote({
            groupId,
            attachmentStorageId: storageId,
            durationSeconds: Math.max(
              1,
              Math.round((Date.now() - recordingStartedAt.current) / 1000),
            ),
          });
        } catch (e) {
          toast.error(errorMessage(e, "Could not send voice note."));
        } finally {
          setBusy(false);
        }
      };
      recordingStartedAt.current = Date.now();
      r.start();
      setRecording(true);
    } catch {
      toast.error("Microphone permission is needed for voice notes.");
    }
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await sendMessage({ groupId, content: value });
      setText("");
    } catch (e) {
      toast.error(errorMessage(e, "Could not send message."));
    } finally {
      setBusy(false);
    }
  };

  /* ---- render ---- */

  return (
    <section className="glass-panel relative overflow-hidden rounded-2xl">
      {/* ---- Subtle top glow ---- */}
      <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-64 -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />

      {/* ---- Header ---- */}
      <div className="relative flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10">
            <MessageSquare className="size-4 text-primary" />
          </div>
          <div>
            <p className="type-h3 text-sm tracking-tight text-foreground">
              Group Chat
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {groupName}
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="interactive-press hover-lift cursor-pointer rounded-xl border-white/[0.08] bg-white/[0.04] text-xs font-medium backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-primary/10 hover:text-primary hover:shadow-[0_0_20px_oklch(0.55_0.15_180_/_0.1)]"
          onClick={onStartRoom}
        >
          <Video className="mr-1.5 size-3.5" />
          Live room
        </Button>
      </div>

      {/* ---- Messages ---- */}
      <div
        ref={scrollContainerRef}
        className="nexus-chat-scroll relative max-h-[26rem] min-h-[10rem] space-y-3 overflow-y-auto px-5 py-4"
      >
        {messages === undefined ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-12">
            <div className="flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="inline-block h-2 w-2 rounded-full bg-primary/40"
                  style={{
                    animation: `nexus-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
                  }}
                />
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/60">
              Loading conversation…
            </p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
              <MessageSquare className="size-6 text-muted-foreground/30" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground/50">
                No messages yet
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Start the study thread
              </p>
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((message, idx) => {
              /* Date separator: show if >5 min gap from prev message */
              const prev = idx > 0 ? messages[idx - 1] : null;
              const gap =
                prev &&
                message._creationTime - prev._creationTime > 5 * 60 * 1000;

              return (
                <div key={message._id}>
                  {gap && (
                    <div className="my-3 flex items-center gap-3">
                      <div className="h-px flex-1 bg-white/[0.04]" />
                      <span className="flex items-center gap-1 text-[9px] tabular-nums text-muted-foreground/40">
                        <Clock className="size-2.5" />
                        {formatTime(message._creationTime)}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.04]" />
                    </div>
                  )}
                  <MessageBubble message={message} groupId={groupId} />
                </div>
              );
            })}
          </AnimatePresence>
        )}
        <div ref={bottom} />
      </div>

      {/* ---- Input area ---- */}
      <div className="relative border-t border-white/[0.06] px-4 py-3">
        {/* Subtle glow behind input on focus */}
        <div
          className={`pointer-events-none absolute -inset-1 rounded-2xl transition-opacity duration-500 ${inputFocused ? "opacity-100" : "opacity-0"}`}
          style={{
            background:
              "radial-gradient(ellipse at center, oklch(0.55 0.15 180 / 0.06), transparent 70%)",
          }}
        />

        {/* Recording banner */}
        {recording && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2.5 flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/[0.06] px-3.5 py-2"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span
                className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive/80"
                style={{ animationDuration: "1.2s" }}
              />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-destructive" />
            </span>
            <span className="text-[11px] font-medium text-destructive/90">
              Recording
            </span>
            <RecordingTimer startedAt={recordingStartedAt.current} />
            <div className="ml-auto flex items-center gap-1">
              {[...Array(12)].map((_, i) => (
                <span
                  key={i}
                  className="w-[2px] rounded-full bg-destructive/50"
                  style={{
                    height: `${4 + Math.abs(Math.sin(i * 1.1 + Date.now() / 400)) * 10}px`,
                    animation: `nexus-wave 0.8s ease-in-out ${i * 0.05}s infinite alternate`,
                  }}
                />
              ))}
            </div>
          </motion.div>
        )}

        <div className="relative flex items-center gap-2">
          {/* Paperclip */}
          <label className="interactive-press flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] text-muted-foreground transition-all hover:border-primary/20 hover:bg-primary/10 hover:text-primary">
            <Paperclip className="size-4" />
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void chooseFile(file);
                e.currentTarget.value = "";
              }}
              disabled={busy}
            />
          </label>

          {/* Text input */}
          <div className="relative flex-1">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder="Share a question or useful note…"
              maxLength={2000}
              disabled={busy}
              className="nexus-chat-input h-10 rounded-xl border-white/[0.06] bg-white/[0.04] text-[13px] placeholder:text-muted-foreground/40 transition-all focus-visible:border-primary/30 focus-visible:bg-white/[0.06] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:opacity-50"
            />
          </div>

          {/* Mic / Stop */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => void toggleRecording()}
            disabled={busy}
            className={`interactive-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-all disabled:opacity-50 ${
              recording
                ? "border-destructive/30 bg-destructive/10 text-destructive shadow-[0_0_20px_oklch(0.55_0.2_25_/_0.15)]"
                : "border-white/[0.06] bg-white/[0.03] text-muted-foreground hover:border-primary/20 hover:bg-primary/10 hover:text-primary"
            }`}
            aria-label={recording ? "Stop recording" : "Record voice note"}
          >
            {recording ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Mic className="size-4" />
            )}
          </motion.button>

          {/* Send */}
          <motion.button
            whileTap={{ scale: 0.85 }}
            whileHover={{ scale: 1.05 }}
            onClick={() => void submit()}
            disabled={busy || !text.trim()}
            className="interactive-press flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_20px_oklch(0.55_0.15_180_/_0.2)] transition-all hover:shadow-[0_0_28px_oklch(0.55_0.15_180_/_0.35)] disabled:opacity-30 disabled:shadow-none"
            aria-label="Send message"
          >
            <Send className="size-4" />
          </motion.button>
        </div>
      </div>

      {/* ---- Keyframe styles (scoped) ---- */}
      <style>{`
        @keyframes nexus-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes nexus-wave {
          from { transform: scaleY(0.4); }
          to   { transform: scaleY(1.6); }
        }
        .nexus-chat-scroll {
          scrollbar-width: thin;
          scrollbar-color: oklch(0.35 0.04 180 / 0.3) transparent;
        }
        .nexus-chat-scroll::-webkit-scrollbar {
          width: 4px;
        }
        .nexus-chat-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .nexus-chat-scroll::-webkit-scrollbar-thumb {
          background: oklch(0.35 0.04 180 / 0.3);
          border-radius: 9999px;
        }
        .nexus-chat-scroll::-webkit-scrollbar-thumb:hover {
          background: oklch(0.45 0.08 180 / 0.5);
        }
        .nexus-chat-input::placeholder {
          opacity: 0.5;
        }
      `}</style>
    </section>
  );
}
