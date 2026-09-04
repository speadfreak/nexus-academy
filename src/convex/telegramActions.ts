// Telegram ACTIONS — the only functions that talk to the Telegram Bot API.
// This file runs in the Node.js runtime ("use node") because it makes HTTP
// calls. Database-touching helpers live in telegram.ts (default runtime).

"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
    const { user: admin } = await requireAdminAction(ctx);
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
      `Open it in Nexus Academy ET 🇪🇹 →`;

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

// ---------------------------------------------------------------------------
// Public contact form — students send a message that lands in the team's
// Telegram group(s). No admin gate; any signed-in user can submit. Rate
// limited by a per-user cooldown tracked in the contactMessages table.
// ---------------------------------------------------------------------------

/**
 * Send a contact message from a student to the team's Telegram channels.
 * Falls back gracefully if Telegram isn't configured — the message is still
 * persisted in `contactMessages` so admins can read it from the dashboard.
 *
 * Args:
 *   - name: optional display name (defaults to the user's profile name)
 *   - email: required reply-to email
 *   - category: question | advice | complaint | bug | other
 *   - message: free-form text body
 *
 * Returns `{ ok, sent, persistedId, reason }` — `sent` counts Telegram
 * deliveries; if 0, the message is still persisted for the admin to read.
 */
export const sendContactMessage = action({
  args: {
    name: v.optional(v.string()),
    email: v.string(),
    category: v.string(),
    message: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    sent: number;
    persistedId: string | null;
    reason?: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    const email = args.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ConvexError({ message: "Please enter a valid email.", code: "invalid" });
    }
    const name = (args.name ?? "").trim().slice(0, 80);
    const message = args.message.trim();
    if (message.length < 5) {
      throw new ConvexError({
        message: "Message is too short — please describe your concern.",
        code: "invalid",
      });
    }
    if (message.length > 5000) {
      throw new ConvexError({
        message: "Message is too long (max 5000 characters).",
        code: "invalid",
      });
    }
    const category = (args.category ?? "other").trim().toLowerCase();
    const validCategories = ["question", "advice", "complaint", "bug", "other"];
    if (!validCategories.includes(category)) {
      throw new ConvexError({ message: "Invalid category.", code: "invalid" });
    }

    // Persist first — the admin can always read this even if Telegram fails.
    const persistedId: string = await ctx.runMutation(
      internal.telegram.insertContactMessage,
      {
        userId,
        name: name || undefined,
        email,
        category,
        message,
      },
    );

    // Resolve token + channels. If Telegram isn't configured, we still
    // succeed (return ok with sent=0) so the user sees a success toast and
    // the admin gets the message in the dashboard.
    let token: string | null = null;
    try {
      token = await ctx.runQuery(internal.configKeys.resolveConfigValue, {
        key: "TELEGRAM_BOT_TOKEN",
      });
    } catch {
      token = null;
    }
    if (!token) {
      return {
        ok: true,
        sent: 0,
        persistedId,
        reason: "telegram_not_configured",
      };
    }

    const channels = await ctx.runQuery(
      internal.telegram.listAllChannels,
      {},
    );
    if (channels.length === 0) {
      return {
        ok: true,
        sent: 0,
        persistedId,
        reason: "no_channels_configured",
      };
    }

    const categoryLabel: Record<string, string> = {
      question: "❓ Question",
      advice: "💡 Advice",
      complaint: "⚠️ Complaint",
      bug: "🐞 Bug report",
      other: "📝 Message",
    };
    const header =
      `${categoryLabel[category] ?? "📝 Message"} — Nexus Academy contact form\n` +
      `──────────────────────\n` +
      `<b>From:</b> ${escapeHtml(name || "Anonymous user")}\n` +
      `<b>Email:</b> ${escapeHtml(email)}\n`;
    const body = `<b>Message:</b>\n${escapeHtml(message)}`;
    const footer = `\n──────────────────────\n<i>Reply via Telegram or email the student directly.</i>`;
    const text = `${header}${body}${footer}`;

    let sent = 0;
    for (const channel of channels) {
      try {
        await callBot(token, "sendMessage", {
          chat_id: channel.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });
        sent += 1;
      } catch {
        // ignore — try the next channel
      }
    }

    if (sent > 0) {
      try {
        await ctx.runMutation(internal.telegram.markContactMessageSent, {
          id: persistedId as unknown as Id<"contactMessages">,
        });
      } catch {
        // Non-fatal — the persisted row is still there.
      }
    }

    await logEventAction(ctx, {
      eventType: "api_call",
      source: "telegram.contactForm",
      status: sent > 0 ? "success" : "error",
      userId,
      metadata: { category, channels: channels.length, sent },
    });

    return {
      ok: true,
      sent,
      persistedId,
      reason: sent > 0 ? undefined : "all_channels_failed",
    };
  },
});
