// Streak reminders.
//
// Reminders surface as an in-app banner (no email/SMS provider is wired up
// yet — flagging: if you want real push/email reminders later, a service like
// a transactional email API would need to be added; nothing is stubbed here).
//
// TIMEZONE LIMITATION (flagged, not guessed): there is no per-user timezone
// data on accounts, so the cron evaluates hours in a fixed zone —
// Africa/Addis_Ababa (UTC+3), which matches the student base. Per-user
// timezones would require storing one on the user/reminderSettings row.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_REMINDER_HOUR = 19; // 7 PM Addis time
const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3, no DST

// ---------------------------------------------------------------------------
// Addis-time helpers (fixed zone — see limitation note above)
// ---------------------------------------------------------------------------

export function addisDateKey(now = Date.now()): string {
  return new Date(now + ADDIS_OFFSET_MS).toISOString().slice(0, 10);
}

function addisHour(now = Date.now()): number {
  return new Date(now + ADDIS_OFFSET_MS).getUTCHours();
}

function addisTodayStartMs(now = Date.now()): number {
  const shifted = new Date(now + ADDIS_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return shifted.getTime() - ADDIS_OFFSET_MS;
}

// ---------------------------------------------------------------------------
// Internal helpers for the cron action
// ---------------------------------------------------------------------------

export const listAllReminderSettings = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db.query("reminderSettings").collect(),
});

export const countSessionsSince = internalQuery({
  args: { userId: v.id("users"), startMs: v.number() },
  handler: async (ctx, { userId, startMs }) => {
    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.gte(q.field("startedAt"), startMs))
      .take(1);
    return sessions.length;
  },
});

export const setPendingReminder = internalMutation({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, { userId, date }) => {
    const row = await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row) return { ok: false };
    await ctx.db.patch(row._id, {
      pendingReminder: true,
      lastReminderSentDate: date,
    });
    return { ok: true };
  },
});

export const ensureReminderSettingsRow = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const existing = await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("reminderSettings", {
      userId,
      streakRemindersEnabled: true,
      reminderHour: DEFAULT_REMINDER_HOUR,
      pendingReminder: false,
    });
  },
});

// ---------------------------------------------------------------------------
// Cron — runs hourly, fires the reminder once per user per day at their hour.
// ---------------------------------------------------------------------------

export const sendStreakReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; reminded: number }> => {
    const rows = await ctx.runQuery(internal.reminders.listAllReminderSettings, {});
    if (rows.length === 0) return { checked: 0, reminded: 0 };

    const now = Date.now();
    const today = addisDateKey(now);
    const hour = addisHour(now);
    const todayStartMs = addisTodayStartMs(now);

    let reminded = 0;
    for (const row of rows) {
      if (!row.streakRemindersEnabled) continue;
      if (row.lastReminderSentDate === today) continue; // already reminded today
      if (row.reminderHour !== hour) continue; // not this user's hour yet

      const studiedToday = await ctx.runQuery(internal.reminders.countSessionsSince, {
        userId: row.userId,
        startMs: todayStartMs,
      });
      if (studiedToday > 0) continue;

      await ctx.runMutation(internal.reminders.setPendingReminder, {
        userId: row.userId,
        date: today,
      });
      reminded += 1;
    }
    return { checked: rows.length, reminded };
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Creates the default reminder row on first use (called on dashboard load). */
export const syncReminderSettings = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    await ctx.runMutation(internal.reminders.ensureReminderSettingsRow, { userId });
    return { ok: true };
  },
});

export const updateReminderSettings = mutation({
  args: {
    enabled: v.optional(v.boolean()),
    hour: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    await ctx.runMutation(internal.reminders.ensureReminderSettingsRow, { userId });
    const row = await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row) return { ok: false };
    if (args.hour !== undefined && (args.hour < 0 || args.hour > 23 || !Number.isInteger(args.hour))) {
      throw new ConvexError({ message: "Reminder hour must be an integer 0-23.", code: "invalid" });
    }
    await ctx.db.patch(row._id, {
      streakRemindersEnabled: args.enabled ?? row.streakRemindersEnabled,
      reminderHour: args.hour ?? row.reminderHour,
    });
    return { ok: true };
  },
});

export const dismissReminder = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const row = await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row) return { ok: true };
    await ctx.db.patch(row._id, { pendingReminder: false });
    return { ok: true };
  },
});

/**
 * The dashboard checks this on load. The banner shows only when a reminder is
 * pending AND the student hasn't logged a session today — so logging a study
 * session makes it disappear on its own.
 */
export const getReminderBanner = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { show: false, hour: DEFAULT_REMINDER_HOUR, studiedToday: false };
    }
    const row = await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    const studiedToday =
      (await ctx.db
        .query("studySessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .filter((q) => q.gte(q.field("startedAt"), addisTodayStartMs()))
        .take(1)).length > 0;

    return {
      show: (row?.pendingReminder ?? false) && !studiedToday,
      studiedToday,
      hour: row?.reminderHour ?? DEFAULT_REMINDER_HOUR,
      enabled: row?.streakRemindersEnabled ?? true,
    };
  },
});

export const getReminderSettings = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { enabled: true, hour: DEFAULT_REMINDER_HOUR, pendingReminder: false };
    }
    const row = await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return {
      enabled: row?.streakRemindersEnabled ?? true,
      hour: row?.reminderHour ?? DEFAULT_REMINDER_HOUR,
      pendingReminder: row?.pendingReminder ?? false,
    };
  },
});

/** Action wrapper so client polling (e.g. after a session) can refresh. */
export const getReminderBannerAction = action({
  args: {},
  handler: async (
    ctx: ActionCtx,
  ): Promise<{ show: boolean; studiedToday: boolean; hour: number; enabled: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { show: false, hour: DEFAULT_REMINDER_HOUR, studiedToday: false, enabled: true };
    }
    const row = await ctx.runQuery(internal.reminders.getReminderSettingsRowByUser, {
      userId,
    });
    const studiedToday =
      (await ctx.runQuery(internal.reminders.countSessionsSince, {
        userId,
        startMs: addisTodayStartMs(),
      })) > 0;
    return {
      show: (row?.pendingReminder ?? false) && !studiedToday,
      studiedToday,
      hour: row?.reminderHour ?? DEFAULT_REMINDER_HOUR,
      enabled: row?.streakRemindersEnabled ?? true,
    };
  },
});

export const getReminderSettingsRowByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    (await ctx.db
      .query("reminderSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique()) ?? null,
});
