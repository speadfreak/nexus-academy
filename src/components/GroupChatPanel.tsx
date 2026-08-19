import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { FileText, MessageSquare, Mic, Paperclip, Send, Square, Video } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ReportBlockMenu } from "@/components/ReportBlockMenu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/errors";

interface Props { groupId: Id<"studyGroups">; groupName: string; onStartRoom: () => void; }

export function GroupChatPanel({ groupId, groupName, onStartRoom }: Props) {
  const messages = useQuery(api.groupChat.getMessages, { groupId, limit: 60 });
  const sendMessage = useMutation(api.groupChat.sendMessage);
  const generateUploadUrl = useMutation(api.groupChat.generateUploadUrl);
  const sendAttachment = useMutation(api.groupChat.sendAttachment);
  const sendVoiceNote = useMutation(api.groupChat.sendVoiceNote);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages?.length]);

  const upload = async (blob: Blob, name: string, type: "file" | "image") => {
    const url = await generateUploadUrl({ groupId });
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream" }, body: blob });
    if (!response.ok) throw new Error("Attachment upload failed");
    const storageId = await response.json() as string;
    await sendAttachment({ groupId, attachmentStorageId: storageId, attachmentType: type, attachmentName: name });
  };
  const chooseFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("Attachments must be under 10 MB."); return; }
    setBusy(true); try { await upload(file, file.name, file.type.startsWith("image/") ? "image" : "file"); } catch (e) { toast.error(errorMessage(e, "Could not send attachment.")); } finally { setBusy(false); }
  };
  const toggleRecording = async () => {
    if (recording) { recorder.current?.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast.error("Voice notes are not supported in this browser."); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = []; const r = new MediaRecorder(stream); recorder.current = r;
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); setRecording(false); const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" }); setBusy(true); try { const url = await generateUploadUrl({ groupId }); const response = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob }); if (!response.ok) throw new Error("Voice note upload failed"); const storageId = await response.json() as string; await sendVoiceNote({ groupId, attachmentStorageId: storageId, durationSeconds: 0 }); } catch (e) { toast.error(errorMessage(e, "Could not send voice note.")); } finally { setBusy(false); } };
      r.start(); setRecording(true);
    } catch { toast.error("Microphone permission is needed for voice notes."); }
  };
  const submit = async () => { const value = text.trim(); if (!value || busy) return; setBusy(true); try { await sendMessage({ groupId, content: value }); setText(""); } catch (e) { toast.error(errorMessage(e, "Could not send message.")); } finally { setBusy(false); } };

  return <section className="glass-panel rounded-2xl p-5">
    <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-2 text-sm font-bold"><MessageSquare className="size-4 text-primary" /> Group chat</p><p className="mt-1 text-xs text-muted-foreground">Persistent conversation for {groupName}.</p></div><Button variant="outline" size="sm" className="cursor-pointer rounded-xl bg-white/5" onClick={onStartRoom}><Video className="mr-1.5 size-3.5" /> Live room</Button></div>
    <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">{messages === undefined ? <p className="py-8 text-center text-xs text-muted-foreground">Loading conversation…</p> : messages.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">No messages yet. Start the study thread.</p> : messages.map((message) => <div key={message._id} className="group flex items-start gap-2"><div className={message.isMine ? "ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary/15 px-3 py-2" : "max-w-[85%] rounded-2xl rounded-tl-sm bg-white/5 px-3 py-2"}><div className="flex items-center gap-2"><span className="text-[10px] font-semibold text-muted-foreground">{message.userName}</span>{!message.isMine && <ReportBlockMenu targetUserId={message.userId} targetName={message.userName} compact />}</div>{message.content && <p className="mt-1 whitespace-pre-wrap text-sm leading-5">{message.content}</p>}{message.messageType === "file" && <div className="mt-1 flex items-center gap-2 text-xs text-primary"><FileText className="size-3.5" /> {message.attachmentName}</div>}{message.messageType === "voice_note" && <div className="mt-1 text-xs text-primary">Voice note · {message.voiceNoteDurationSeconds ?? 0}s</div>}</div></div>)}<div ref={bottom} /></div>
    <div className="mt-3 flex items-center gap-2"><Input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }} placeholder="Share a question or useful note…" maxLength={2000} className="h-10 rounded-xl bg-white/5" disabled={busy} /><label className="flex size-10 cursor-pointer items-center justify-center rounded-xl border border-white/10 text-muted-foreground hover:text-foreground"><Paperclip className="size-4" /><input type="file" className="hidden" accept=".pdf,.doc,.docx,image/*" onChange={(e) => { const file=e.target.files?.[0]; if(file) void chooseFile(file); e.currentTarget.value=""; }} disabled={busy} /></label><Button type="button" variant="outline" size="icon" className="size-10 cursor-pointer rounded-xl bg-white/5" onClick={() => void toggleRecording()} disabled={busy}>{recording ? <Square className="size-4 text-destructive" /> : <Mic className="size-4" />}</Button><Button type="button" size="icon" className="size-10 cursor-pointer rounded-xl" onClick={() => void submit()} disabled={busy || !text.trim()}><Send className="size-4" /></Button></div>
  </section>;
}
