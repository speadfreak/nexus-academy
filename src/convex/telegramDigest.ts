// Personal Telegram weekly digest — server-side computation + delivery.
//
// This module runs in the Node.js runtime ("use node") because it calls
// the Telegram Bot API via fetch. It reuses the same bot token resolution
// + callBot pattern as telegramActions.ts (admin broadcast / contact form).
//
// DIGEST CONTENT (every Monday morning for every linked user):
//   - XP earned this week vs last week (delta + honest framing)
//   - Quiz score trend: average % this week vs last week
//   - Current streak (from studyStreaks table)
//   - Weakest topic (lowest quiz performance this week, or least-studied
//     subject if no quiz data) — honest, with a tip on what to focus on
//
// HONEST FRAMING: if there's insufficient history for a comparison (e.g.
// the user has no quiz attempts this week or last), we say so explicitly
// rather than inventing a trend. "No quiz attempts in the last 7 days"
// is more useful than a fabricated number.
//
// FLOW:
//   1. Weekly cron (crons.ts) calls `sendWeeklyDigests` (internalAction).
//   2. That action iterates every telegramLinks row via listLinkedUsers.
//   3. For each user it fetches: XP this week + XP last week, quiz attempts
//      this week + last week, current streak, and the weakest topic.
//   4. It composes a personalized HTML message and sends it via callBot.
//   5. It marks the link's lastDigestSentAt timestamp.
//
// All failures are logged via logEventAction but never abort the whole
// batch — one user's failed send shouldn't stop the next user's digest.

"use node";

import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { logEventAction } from "./systemEvents";

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

async function resolveTelegramToken(ctx: any): Promise<string | null> {
  try {
    const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: "TELEGRAM_BOT_TOKEN",
    });
    return token ?? null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Helpers ────────────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Average score % across a set of quiz attempts (0 if empty). */
function averageScore(
  attempts: Array<{ score: number; totalQuestions: number }>,
): number {
  if (attempts.length === 0) return 0;
  const sum = attempts.reduce(
    (s, a) => s + (a.score / Math.max(1, a.totalQuestions)) * 100,
    0,
  );
  return Math.round(sum / attempts.length);
}

/** Find the weakest topic from a user's quiz attempts in the last 7 days.
 *  Returns null if there's no quiz data. The "weakest" is the topic with
 *  the lowest average score across attempts that have a topicId. */
async function findWeakestTopic(
  ctx: any,
  userId: Id<"users">,
  since: number,
): Promise<{ subjectName: string; topicName: string; avgScore: number; attempts: number } | null> {
  const attempts = (await ctx.runQuery(internal.recap.getRecentQuizAttempts, {
    userId,
    since,
  })) as Array<{
    _id: Id<"quizAttempts">;
    quizId: Id<"quizzes">;
    score: number;
    totalQuestions: number;
    completedAt: number;
  }>;
  if (attempts.length === 0) return null;

  // Group by topicId (joining quizzes to get the topicId + subjectId).
  const quizIds = [...new Set(attempts.map((a) => a.quizId))];
  const quizzes = new Map<Id<"quizzes">, { subjectId: Id<"subjects">; topicId?: Id<"topics"> }>();
  for (const quizId of quizIds) {
    const quiz = (await ctx.runQuery(internal.recap.getQuizById, { quizId })) as {
      subjectId: Id<"subjects">;
      topicId?: Id<"topics">;
    } | null;
    if (quiz) quizzes.set(quizId, quiz);
  }

  // Aggregate per topic.
  const perTopic = new Map<
    Id<"topics">,
    { subjectId: Id<"subjects">; total: number; count: number; sum: number }
  >();
  for (const attempt of attempts) {
    const quiz = quizzes.get(attempt.quizId);
    if (!quiz || !quiz.topicId) continue;
    const existing = perTopic.get(quiz.topicId) ?? {
      subjectId: quiz.subjectId,
      total: 0,
      count: 0,
      sum: 0,
    };
    existing.count += 1;
    existing.sum += (attempt.score / Math.max(1, attempt.totalQuestions)) * 100;
    perTopic.set(quiz.topicId, existing);
  }

  if (perTopic.size === 0) return null;

  // Find the topic with the lowest average score (must have >= 1 attempt).
  let weakest: {
    topicId: Id<"topics">;
    subjectId: Id<"subjects">;
    avgScore: number;
    attempts: number;
  } | null = null;
  for (const [topicId, stats] of perTopic) {
    const avg = Math.round(stats.sum / stats.count);
    if (!weakest || avg < weakest.avgScore) {
      weakest = {
        topicId,
        subjectId: stats.subjectId,
        avgScore: avg,
        attempts: stats.count,
      };
    }
  }
  if (!weakest) return null;

  // Resolve names via queries (ctx.db isn't available in actions).
  const subject = (await ctx.runQuery(internal.recap.getSubjectById, {
    subjectId: weakest.subjectId,
  })) as { name: string } | null;
  const topicDoc = (await ctx.runQuery(internal.journey.getTopicById, {
    topicId: weakest.topicId,
  })) as { name: string } | null;

  return {
    subjectName: subject?.name ?? "Unknown subject",
    topicName: topicDoc?.name ?? "Unknown topic",
    avgScore: weakest.avgScore,
    attempts: weakest.attempts,
  };
}

/** Find the least-studied subject (by total study hours) in the last 7 days.
 *  Returns null if there's no study-session data. */
async function findLeastStudiedSubject(
  ctx: any,
  userId: Id<"users">,
  since: number,
): Promise<{ subjectName: string; hours: number; sessions: number } | null> {
  const sessions = (await ctx.runQuery(internal.recap.getRecentSessions, {
    userId,
    since,
  })) as Array<{
    subjectId: Id<"subjects">;
    durationSeconds: number;
  }>;
  if (sessions.length === 0) return null;

  // Aggregate per subject.
  const perSubject = new Map<Id<"subjects">, { hours: number; sessions: number }>();
  for (const session of sessions) {
    const existing = perSubject.get(session.subjectId) ?? { hours: 0, sessions: 0 };
    existing.hours += session.durationSeconds / 3600;
    existing.sessions += 1;
    perSubject.set(session.subjectId, existing);
  }

  // Find the subject with the fewest hours (but at least 1 session —
  // subjects with 0 sessions aren't "least studied", they're just absent).
  let least: {
    subjectId: Id<"subjects">;
    hours: number;
    sessions: number;
  } | null = null;
  for (const [subjectId, stats] of perSubject) {
    if (!least || stats.hours < least.hours) {
      least = {
        subjectId,
        hours: stats.hours,
        sessions: stats.sessions,
      };
    }
  }
  if (!least) return null;

  const subject = (await ctx.runQuery(internal.recap.getSubjectById, {
    subjectId: least.subjectId,
  })) as { name: string } | null;

  return {
    subjectName: subject?.name ?? "Unknown subject",
    hours: Math.round(least.hours * 10) / 10,
    sessions: least.sessions,
  };
}

// ── Compose the digest message ─────────────────────────────────────────

function composeDigest({
  displayName,
  xpThisWeek,
  xpLastWeek,
  quizAvgThisWeek,
  quizAttemptsThisWeek,
  quizAvgLastWeek,
  quizAttemptsLastWeek,
  currentStreak,
  weakestTopic,
  leastStudied,
}: {
  displayName: string;
  xpThisWeek: number;
  xpLastWeek: number;
  quizAvgThisWeek: number;
  quizAttemptsThisWeek: number;
  quizAvgLastWeek: number;
  quizAttemptsLastWeek: number;
  currentStreak: number;
  weakestTopic: { subjectName: string; topicName: string; avgScore: number; attempts: number } | null;
  leastStudied: { subjectName: string; hours: number; sessions: number } | null;
}): string {
  const firstName = displayName.split(/\s+/)[0] || "there";
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const lines: string[] = [];
  lines.push(`📚 <b>Learnyx Academy — Weekly Report Card</b>`);
  lines.push(`<i>${dateStr}</i>`);
  lines.push(`Hi <b>${escapeHtml(firstName)}</b> 👋 here's how your week went.`);
  lines.push("");
  lines.push(`──────────────────────`);

  // XP section
  lines.push(`<b>⚡ XP earned</b>`);
  lines.push(`This week: <b>${xpThisWeek}</b>`);
  if (xpLastWeek > 0 || xpThisWeek > 0) {
    const delta = xpThisWeek - xpLastWeek;
    if (delta > 0) {
      lines.push(`Last week: ${xpLastWeek} · <b>+${delta} 🔥</b>`);
    } else if (delta < 0) {
      lines.push(`Last week: ${xpLastWeek} · ${delta}`);
    } else {
      lines.push(`Last week: ${xpLastWeek} · same as this week`);
    }
  } else {
    lines.push(`<i>No XP yet — log a study session to start earning.</i>`);
  }
  lines.push("");

  // Quiz trend section
  lines.push(`<b>📝 Quiz performance</b>`);
  if (quizAttemptsThisWeek > 0) {
    lines.push(`This week: <b>${quizAvgThisWeek}%</b> avg · ${quizAttemptsThisWeek} attempt${quizAttemptsThisWeek === 1 ? "" : "s"}`);
    if (quizAttemptsLastWeek > 0) {
      const delta = quizAvgThisWeek - quizAvgLastWeek;
      if (delta > 0) {
        lines.push(`Last week: ${quizAvgLastWeek}% · <b>+${delta}% 📈</b>`);
      } else if (delta < 0) {
        lines.push(`Last week: ${quizAvgLastWeek}% · ${delta}%`);
      } else {
        lines.push(`Last week: ${quizAvgLastWeek}% · steady`);
      }
    } else {
      lines.push(`<i>No quiz attempts last week — first baseline this week.</i>`);
    }
  } else {
    lines.push(`<i>No quiz attempts this week — try a quick quiz to see your trend.</i>`);
  }
  lines.push("");

  // Streak
  lines.push(`<b>🔥 Streak</b>`);
  if (currentStreak > 0) {
    lines.push(`<b>${currentStreak} day${currentStreak === 1 ? "" : "s"}</b> — keep it alive!`);
  } else {
    lines.push(`<i>No active streak — log a session today to start one.</i>`);
  }
  lines.push("");

  // Weakest topic / least-studied subject
  lines.push(`<b>🎯 Focus for next week</b>`);
  if (weakestTopic) {
    lines.push(`Weakest topic: <b>${escapeHtml(weakestTopic.topicName)}</b> (${escapeHtml(weakestTopic.subjectName)})`);
    lines.push(`Avg score: ${weakestTopic.avgScore}% across ${weakestTopic.attempts} attempt${weakestTopic.attempts === 1 ? "" : "s"}`);
    lines.push(`<i>Tip: review this topic and try a few more quiz questions on it.</i>`);
  } else if (leastStudied) {
    lines.push(`Least-studied: <b>${escapeHtml(leastStudied.subjectName)}</b> — ${leastStudied.hours}h across ${leastStudied.sessions} session${leastStudied.sessions === 1 ? "" : "s"} this week`);
    lines.push(`<i>Tip: balance your study across all subjects.</i>`);
  } else {
    lines.push(`<i>No study activity this week — log a session to get a personalized focus tip.</i>`);
  }
  lines.push("");
  lines.push(`──────────────────────`);
  lines.push(`<i>See you next Monday. You've got this 💪</i>`);
  lines.push(`<i>— Learnyx Academy ET 🇪🇹</i>`);

  return lines.join("\n");
}

// ── The weekly digest action (called by the cron) ─────────────────────

export const sendWeeklyDigests = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number; failed: number; skipped: number }> => {
    const token = await resolveTelegramToken(ctx);
    if (!token) {
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "telegramDigest.weekly",
        status: "error",
        metadata: { reason: "telegram_not_configured" },
      });
      return { sent: 0, failed: 0, skipped: 0 };
    }

    const linked = (await ctx.runQuery(internal.telegram.listLinkedUsers, {})) as Array<{
      userId: Id<"users">;
      telegramChatId: string;
    }>;
    if (linked.length === 0) {
      return { sent: 0, failed: 0, skipped: 0 };
    }

    const now = Date.now();
    const weekStart = now - WEEK_MS;
    const twoWeeksAgo = now - 2 * WEEK_MS;

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const link of linked) {
      try {
        // Skip if we already sent a digest in the last 6 days (idempotent
        // re-runs of the cron don't spam the user).
        const lastSent = (link as { lastDigestSentAt?: number }).lastDigestSentAt;
        if (lastSent && now - lastSent < 6 * DAY_MS) {
          skipped += 1;
          continue;
        }

        // Fetch the user's profile for their display name.
        const user = (await ctx.runQuery(internal.admin.getUserById, {
          userId: link.userId,
        })) as { name: string | null; email: string | null } | null;
        const displayName = user?.name ?? user?.email ?? "Student";

        // XP this week vs last week.
        const xpThisWeek = (await ctx.runQuery(internal.xp.getXpInWindow, {
          userId: link.userId,
          since: weekStart,
        })) as number;
        const xpLastWeek = (await ctx.runQuery(internal.xp.getXpInWindow, {
          userId: link.userId,
          since: twoWeeksAgo,
          until: weekStart,
        })) as number;

        // Quiz attempts this week + last week.
        const attemptsThisWeek = (await ctx.runQuery(internal.recap.getRecentQuizAttempts, {
          userId: link.userId,
          since: weekStart,
        })) as Array<{ score: number; totalQuestions: number; completedAt: number }>;
        const attemptsLastWeekRaw = (await ctx.runQuery(internal.recap.getRecentQuizAttempts, {
          userId: link.userId,
          since: twoWeeksAgo,
        })) as Array<{ score: number; totalQuestions: number; completedAt: number }>;
        const attemptsLastWeek = attemptsLastWeekRaw.filter((a) => a.completedAt < weekStart);

        const quizAvgThisWeek = averageScore(attemptsThisWeek);
        const quizAvgLastWeek = averageScore(attemptsLastWeek);

        // Current streak.
        const streak = (await ctx.runQuery(internal.recap.getStreakByUser, {
          userId: link.userId,
        })) as { currentStreak: number } | null;
        const currentStreak = streak?.currentStreak ?? 0;

        // Weakest topic (or least-studied subject if no quiz data).
        const weakestTopic = await findWeakestTopic(ctx, link.userId, weekStart);
        const leastStudied = weakestTopic
          ? null
          : await findLeastStudiedSubject(ctx, link.userId, weekStart);

        const text = composeDigest({
          displayName,
          xpThisWeek,
          xpLastWeek,
          quizAvgThisWeek,
          quizAttemptsThisWeek: attemptsThisWeek.length,
          quizAvgLastWeek,
          quizAttemptsLastWeek: attemptsLastWeek.length,
          currentStreak,
          weakestTopic,
          leastStudied,
        });

        await callBot(token, "sendMessage", {
          chat_id: link.telegramChatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        });

        await ctx.runMutation(internal.telegram.markDigestSent, {
          userId: link.userId,
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        const errMsg = err instanceof Error ? err.message : String(err);
        await logEventAction(ctx, {
          eventType: "api_call",
          source: "telegramDigest.weekly.userFailed",
          status: "error",
          metadata: { userId: link.userId, error: errMsg.slice(0, 200) },
        });
        // Continue to the next user — one failure shouldn't abort the batch.
      }
    }

    await logEventAction(ctx, {
      eventType: "api_call",
      source: "telegramDigest.weekly",
      status: failed > 0 && sent === 0 ? "error" : "success",
      metadata: { total: linked.length, sent, failed, skipped },
    });

    return { sent, failed, skipped };
  },
});
