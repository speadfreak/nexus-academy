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

export default crons;
