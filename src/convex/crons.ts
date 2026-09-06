import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Hourly check for streak reminders. The action itself filters to the right
// hour per user (fixed Africa/Addis_Ababa zone — see reminders.ts) and only
// fires once per user per day.
crons.hourly(
  "send-streak-reminders",
  { minuteUTC: 0 },
  internal.reminders.sendStreakReminders,
);

// Once daily: generate today's motivational quote if none exists. The action
// is idempotent (checks by date) and falls back to the pool on AI failure.
crons.daily(
  "daily-quote",
  { hourUTC: 2, minuteUTC: 0 },
  internal.quotes.generateTodaysQuoteAction,
);

// Once daily: notify students whose study-plan week starts today (Addis
// calendar day) and isn't completed yet. Runs at 04:00 UTC = 07:00 Addis.
crons.daily(
  "plan-week-due",
  { hourUTC: 4, minuteUTC: 0 },
  internal.studyPlans.notifyDuePlanWeeks,
);

// Hourly: todo due-date reminders (due now or within the next 24h).
// Dedupes per todo per day, so a student gets one nudge per todo.
crons.hourly(
  "notify-due-todos",
  { minuteUTC: 30 },
  internal.todos.notifyDueTodos,
);

// Hourly: SLA breach check for pending manual payment submissions.
// Finds submissions older than SLA_HOURS (default 24h) that haven't been
// flagged yet, marks slaBreached=true, notifies the student (warm tone),
// and escalates to the admin via Telegram. NEVER auto-rejects — breach
// means apologize and compensate, never deny.
crons.hourly(
  "check-sla-breach",
  { minuteUTC: 15 },
  internal.manualPayments.checkSlaBreach,
);

// Weekly: personal Telegram digest for every linked user. Runs every
// Monday at 08:00 UTC. The action iterates every telegramLinks row,
// computes their weekly stats (XP, quiz trend, streak, weakest topic),
// and sends a personalized HTML message via the bot. Skips users who
// already received a digest in the last 6 days (idempotent re-runs
// don't spam). See src/convex/telegramDigest.ts.
crons.weekly(
  "personal-weekly-digest",
  { dayOfWeek: "monday", hourUTC: 8, minuteUTC: 0 },
  internal.telegramDigest.sendWeeklyDigests,
);

// Weekly: admin business digest. Runs every Monday at 08:05 UTC (5 min
// after the personal digest so they don't compete for the Telegram API).
// Sends a single HTML message to the already-configured
// TELEGRAM_ADMIN_CHAT_ID with real weekly numbers — revenue (approved
// payments), new signups, referral conversions, active users, paid
// subscriptions, pending reviews, SLA breaches. Honest data, no
// fabrication. See src/convex/adminDigest.ts.
crons.weekly(
  "admin-weekly-business-digest",
  { dayOfWeek: "monday", hourUTC: 8, minuteUTC: 5 },
  internal.adminDigest.sendWeeklyBusinessDigest,
);

export default crons;
