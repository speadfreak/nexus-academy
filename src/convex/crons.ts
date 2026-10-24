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

// Hourly: affiliate commission hold-window flip. Indexed by
// status+payableAt with an earliest-first read — exits immediately (one
// indexed query) when nothing is due. Flips due "pending" commissions to
// "payable" and pings the admin when a promoter's payable balance crosses
// the minimum payout (throttled to once per 7 days per promoter).
crons.hourly(
  "affiliate-flip-payable",
  { minuteUTC: 45 },
  internal.affiliates.flipDueCommissions,
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

// Every 1 minute: the DETERMINISTIC conversion engine. This is the heart
// of "students never wait": the tick enqueues any past exam without a job
// (new uploads included), requeues dead claims (bounded retries + a daily
// self-heal so no paper is ever stuck), then CLAIMS the next papers and
// runs engineConvert — layout-aware text extraction + a pure pattern-
// matching parser. NO AI, NO rate limits, NO token budgets: text-layer
// papers complete in seconds. Scanned papers wait for a browser tab to
// OCR them with Tesseract.js (also zero cloud AI). See
// src/convex/examConversionEngine.ts + examConversionEngineDispatch.ts +
// src/lib/examParser.ts.
crons.interval(
  "exam-conversion-engine-dispatch",
  { minutes: 1 },
  internal.examConversionEngineDispatch.dispatchTick,
);

// Every 1 minute: Matric OS session sweeper. Two idempotent jobs:
//  1. EXPIRY — active sessions whose server deadline + grace have passed are
//     auto-submitted with whatever answers were saved and graded. The exam
//     timer is server-authoritative; a closed browser or dead battery
//     changes nothing.
//  2. INGESTION RETRIES — graded sessions whose learning-loop ingestion is
//     still pending/failed are retried (bounded, max 8 attempts) so Mistake
//     Lab + Exam Twin eventually see every sitting exactly once.
crons.interval(
  "matric-session-sweeper",
  { minutes: 1 },
  internal.matricEngine.sweepMatricSessions,
);

// Every 5 minutes: FLOWSTATE focus-session sweeper. The focus timer is
// server-aware (startedAt/endsAt on the server clock), so a session whose
// planned time has passed — browser closed, battery died, tab never
// returned — is auto-completed from server truth: status completed, real
// elapsed seconds (pause-adjusted) written to studySessions exactly once
// (dedupeKey), completion XP only if the session genuinely finished. Nothing
// is lost and nothing is ever double-counted.
crons.interval(
  "focus-session-sweeper",
  { minutes: 5 },
  internal.focusSessions.expireStale,
);

// Daily: incremental Matric OS vault sync — materializes any digitized
// papers updated in the last ~26h into the question vault (idempotent,
// bounded to one run's page cap; the next run picks up any remainder).
// Keeps blueprint coverage and student-facing eligibility counts honest
// without admin intervention. Full rebuilds stay admin-triggered.
crons.daily(
  "matric-vault-sync",
  { hourUTC: 3, minuteUTC: 30 },
  internal.matricVault.autoVaultSync,
);

export default crons;
