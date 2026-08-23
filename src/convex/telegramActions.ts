// Telegram ACTIONS — the only functions that talk to the Telegram Bot API.
// This file runs in the Node.js runtime ("use node") because it makes HTTP
// calls. Database-touching helpers live in telegram.ts (default runtime).

"use node";

import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminAction } from "./admin";
import { logEventAction } from "./systemEvents";
import { CONTENT_TYPE_LABELS } from "./constants";

/** Resolve TELEGRAM_BOT_TOKEN: database first, then env fallback. */
async function resolveTelegramToken(ctx: any): Promise<string> {
  const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "TELEGRAM_BOT_TOKEN" });
  if (!token) {
    throw new ConvexError({
      message: "Telegram is not configured — add TELEGRAM_BOT_TOKEN in the Keys tab.",
      code: "not_configured",
    });
  }
  return token;
}

const API_BASE = "https://api.telegram.org";

async function callBot(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
  } | null;
  if (!response.ok || !data?.ok) {
    throw new Error(data?.description ?? `Telegram API error ${response.status}`);
  }
  return data;
}

/**
 * Send a message to one or more channels. Explicit admin action — never
 * fired automatically from the client. Every attempt lands in broadcastLog.
 */
export const sendBroadcast = action({
  args: {
    channelIds: v.array(v.id("telegramChannels")),
    message: v.string(),
  },
  handler: async (
    ctx,
    { channelIds, message },
  ): Promise<{ ok: boolean; sent: number; failed: number }> => {
    const admin = await requireAdminAction(ctx);
    const token = await resolveTelegramToken(ctx);
    if (!Array.isArray(channelIds) || channelIds.length === 0) {
      throw new ConvexError({ message: "Pick at least one channel.", code: "invalid" });
    }
    const text = message.trim();
    if (!text) {
      throw new ConvexError({ message: "Broadcast message cannot be empty.", code: "invalid" });
    }

    const channels: { chatId: string; name: string }[] = [];
    const channelNames: string[] = [];
    for (const channelId of channelIds) {
      const channel = await ctx.runQuery(internal.telegram.getChannelById, { channelId });
      if (!channel) {
        throw new ConvexError({ message: "One of the channels no longer exists.", code: "invalid" });
      }
      channels.push(channel);
      channelNames.push(channel.name);
    }

    let failed = 0;
    for (const channel of channels) {
      try {
        await callBot(token, "sendMessage", {
          chat_id: channel.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch {
        failed += 1;
      }
    }

    await ctx.runMutation(internal.telegram.insertBroadcastLog, {
      message: text,
      channels: channelNames,
      sentBy: admin._id,
      status: failed === channels.length ? "failed" : "sent",
    });

    await logEventAction(ctx, {
      eventType: "api_call",
      source: "telegram.broadcast",
      status: failed === channels.length ? "error" : "success",
      userId: admin._id,
      metadata: { channels: channelNames.length, failed },
    });

    return { ok: true, sent: channels.length - failed, failed };
  },
});

/**
 * Auto-post a new-content message to channels with the explicit toggle ON.
 * Called fire-and-forget from the upload action; if no channel has the
 * toggle on, this is a no-op. Never enabled without an explicit admin click.
 */
export const postNewContent = internalAction({
  args: {
    title: v.string(),
    contentType: v.string(),
    grade: v.number(),
    subjectName: v.string(),
    contentId: v.id("contentItems"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; reason?: string; sent?: number; failed?: number }> => {
    const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "TELEGRAM_BOT_TOKEN" });
    if (!token) return { ok: false, reason: "not_configured" };

    const channels = await ctx.runQuery(internal.telegram.listEnabledAutoPostChannels, {});
    if (channels.length === 0) return { ok: false, reason: "no_channels_enabled" };

    const label =
      CONTENT_TYPE_LABELS[args.contentType as keyof typeof CONTENT_TYPE_LABELS] ??
      args.contentType;
    const text =
      `📚 New in the library: <b>${escapeHtml(args.title)}</b>\n` +
      `${escapeHtml(args.subjectName)} · Grade ${args.grade} · ${escapeHtml(label)}\n` +
      `Open it in Nexus Academy →`;

    let failed = 0;
    for (const channel of channels) {
      try {
        await callBot(token, "sendMessage", {
          chat_id: channel.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
      } catch {
        failed += 1;
      }
    }

    await logEventAction(ctx, {
      eventType: "api_call",
      source: "telegram.autoPost",
      status: failed === channels.length ? "error" : "success",
      metadata: { contentId: args.contentId, channels: channels.length, failed },
    });
    return { ok: true, sent: channels.length - failed, failed };
  },
});

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
