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

export default crons;
