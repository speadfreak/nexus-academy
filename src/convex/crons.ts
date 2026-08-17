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

export default crons;
