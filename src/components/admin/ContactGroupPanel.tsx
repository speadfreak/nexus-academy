// Admin "Contact-Form Group" mini-panel — lets the admin set + edit the
// Telegram group where student contact-form messages are delivered.
//
// The admin pastes:
//   - Chat ID (required) — e.g. "-1001234567890" for a supergroup. Find
//     this by adding @userinfobot to the group and asking it for the
//     chat ID, OR by inspecting the group's invite link.
//   - Invite link (optional) — e.g. "https://t.me/NexusETCommunity".
//     Shown as a "Open group" link in the admin UI for convenience.
//
// Both values are stored in the configKeys table. The chat ID is what
// the sendContactMessage action reads to deliver messages directly to
// the group (instead of scanning all configured channels).

import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function ContactGroupPanel() {
  const config = useQuery(api.telegram.getContactGroupConfig);
  const setKey = useMutation(api.configKeys.setKey);
  const deleteKey = useMutation(api.configKeys.deleteKey);

  const [chatId, setChatId] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Sync from server once on first load (and when config changes).
  useEffect(() => {
    if (config === undefined || loaded) return;
    setChatId(config.chatId);
    setInviteLink(config.inviteLink);
    setLoaded(true);
  }, [config, loaded]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const trimmedChatId = chatId.trim();
      const trimmedLink = inviteLink.trim();
      if (trimmedChatId) {
        await setKey({ key: "CONTACT_GROUP_CHAT_ID", value: trimmedChatId });
      } else {
        await deleteKey({ key: "CONTACT_GROUP_CHAT_ID" });
      }
      if (trimmedLink) {
        await setKey({ key: "CONTACT_GROUP_INVITE_LINK", value: trimmedLink });
      } else {
        await deleteKey({ key: "CONTACT_GROUP_INVITE_LINK" });
      }
      toast.success("Contact-form group updated. New messages will land there.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not save the contact group config.",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await deleteKey({ key: "CONTACT_GROUP_CHAT_ID" });
      await deleteKey({ key: "CONTACT_GROUP_INVITE_LINK" });
      setChatId("");
      setInviteLink("");
      toast.success("Contact-form group config cleared.");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not clear the config.",
      );
    } finally {
      setSaving(false);
    }
  };

  const isConfigured = Boolean(config?.configured);
  const inviteLinkIsTelegram = /^https?:\/\/t\.me\//i.test(inviteLink);

  return (
    <div className="glass-panel rounded-2xl p-5 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex size-9 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
          <MessageCircle className="size-4.5" />
        </div>
        <div className="flex-1">
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">
            // contact-form delivery
          </p>
          <h2 className="mt-0.5 text-lg font-extrabold tracking-tight">Contact Group</h2>
        </div>
        {isConfigured ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
            <span className="size-1.5 rounded-full bg-emerald-400" style={{ boxShadow: "0 0 6px currentColor" }} />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
            <span className="size-1.5 rounded-full bg-amber-400" />
            Not set
          </span>
        )}
      </div>

      <p className="mt-3 text-sm text-muted-foreground">
        Student contact-form messages go to this Telegram group. Set it once
        and you can change it anytime — when the team moves to a new group, just
        update the chat ID here. The bot must be a member of the group with
        permission to send messages.
      </p>

      {/* Form */}
      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-group-chat-id" className="text-xs font-semibold text-muted-foreground">
            Telegram group chat ID
          </Label>
          <Input
            id="contact-group-chat-id"
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="-1001234567890"
            className="h-11 font-mono text-sm"
          />
          <p className="text-[10px] text-muted-foreground/70">
            For a supergroup this starts with <code className="rounded bg-white/5 px-1">-100</code>.
            Add <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">@userinfobot</a> to
            the group and read the chat ID it reports, then remove it.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="contact-group-invite-link" className="text-xs font-semibold text-muted-foreground">
            Group invite link (optional, shown to admins)
          </Label>
          <div className="flex gap-2">
            <Input
              id="contact-group-invite-link"
              value={inviteLink}
              onChange={(e) => setInviteLink(e.target.value)}
              placeholder="https://t.me/NexusETCommunity"
              className="h-11 text-sm"
            />
            {inviteLinkIsTelegram && (
              <a
                href={inviteLink}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-sky-400/30 hover:text-sky-300"
                title="Open group"
              >
                <ExternalLink className="size-4" />
              </a>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleClear()}
            disabled={saving || (!chatId && !inviteLink)}
            className="h-9 cursor-pointer gap-1.5 rounded-lg font-mono text-[11px] text-muted-foreground hover:text-rose-300"
          >
            <X className="size-3.5" /> Clear
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            className="h-9 cursor-pointer gap-2 rounded-lg bg-sky-500 text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {saving ? "Saving…" : "Save group"}
          </Button>
        </div>
      </div>

      {/* Helper tip */}
      <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-sky-400/15 bg-sky-400/[0.04] p-3">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-sky-300" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-sky-300">How it works:</span> when a
          student sends a contact-form message from{" "}
          <code className="rounded bg-white/5 px-1">Settings → Contact the Team</code>,
          the backend sends it directly to this chat ID via the Telegram bot.
          If you clear this, the system falls back to scanning all configured
          channels and sending to GROUP chats only. Setting this is the
          recommended path — it's faster and more reliable.
        </p>
      </div>
    </div>
  );
}
