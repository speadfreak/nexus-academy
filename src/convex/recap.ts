// Study session recap — generates encouraging, data-grounded summaries
// from real user activity. No premium gate — available to all users.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { callGroq } from "./groq";

// ---------------------------------------------------------------------------
// Internal data queries
// ---------------------------------------------------------------------------

export const getStreakByUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) =>
    await ctx.db
      .query("studyStreaks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique(),
});

export const getRecentSessions = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) =>
    await ctx.db
      .query("studySessions")
      .withIndex("by_user_startedAt", (q) =>
        q.eq("userId", userId).gte("startedAt", since),
      )
      .order("desc")
      .take(20),
});

export const getRecentQuizAttempts = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) =>
    await ctx.db
      .query("quizAttempts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((attempts) => attempts.filter((a) => a.completedAt >= since)),
});

export const getQuizById = internalQuery({
  args: { quizId: v.id("quizzes") },
  handler: async (ctx, { quizId }) => (await ctx.db.get(quizId)) ?? null,
});

export const getSubjectById = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) => (await ctx.db.get(subjectId)) ?? null,
});

// ---------------------------------------------------------------------------
// AI recap generation
// ---------------------------------------------------------------------------

export const generateRecap = action({
  args: {
    type: v.union(
      v.literal("focus_session"),
      v.literal("quiz"),
      v.literal("weekly"),
    ),
  },
  handler: async (ctx, args): Promise<{ text: string; recapId?: Id<"recaps"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const now = Date.now();
    const streak = await ctx.runQuery(internal.recap.getStreakByUser, { userId });

    let dataSummary = "";
    let recapText = "";

    if (args.type === "focus_session") {
      const sessions = await ctx.runQuery(internal.recap.getRecentSessions, {
        userId,
        since: now - 2 * 60 * 60 * 1000,
      });
      const last = sessions[0];
      if (last) {
        const subject = await ctx.runQuery(internal.recap.getSubjectById, {
          subjectId: last.subjectId,
        });
        const mins = Math.round(last.durationSeconds / 60);
        dataSummary =
          `Most recent focus session:\n` +
          `- Subject: ${subject?.name ?? "Unknown"}\n` +
          `- Duration: ${mins} minutes\n` +
          `- Total hours studied (all time): ${streak?.totalHoursStudied ?? 0}\n` +
          `- Current streak: ${streak?.currentStreak ?? 0} days\n` +
          `- Longest streak: ${streak?.longestStreak ?? 0} days`;
      } else {
        dataSummary =
          `This is the student's first focus session!\n` +
          `- Current streak: 0 days\n` +
          `- They just started using Learnyx Academy ET 🇪🇹`;
      }
    } else if (args.type === "quiz") {
      const attempts = await ctx.runQuery(internal.recap.getRecentQuizAttempts, {
        userId,
        since: now - 24 * 60 * 60 * 1000,
      });
      const last = attempts[0];
      if (last) {
        const quiz = await ctx.runQuery(internal.recap.getQuizById, { quizId: last.quizId });
        const subject = quiz ? await ctx.runQuery(internal.recap.getSubjectById, {
          subjectId: quiz.subjectId,
        }) : null;
        const score = Math.round((last.score / last.totalQuestions) * 100);
        dataSummary =
          `Most recent quiz:\n` +
          `- Subject: ${subject?.name ?? "Unknown"}\n` +
          `- Score: ${score}% (${last.score}/${last.totalQuestions})\n` +
          `- Total quizzes taken: ${attempts.length}\n` +
          `- Current streak: ${streak?.currentStreak ?? 0} days`;
      } else {
        dataSummary =
          `First quiz attempt!\n` +
          `- Current streak: ${streak?.currentStreak ?? 0} days`;
      }
    } else {
      const sessions = await ctx.runQuery(internal.recap.getRecentSessions, {
        userId,
        since: now - 7 * 24 * 60 * 60 * 1000,
      });
      const totalMinutes = sessions.reduce((sum, s) => sum + s.durationSeconds, 0) / 60;
      const hours = (totalMinutes / 60).toFixed(1);
      const attempts = await ctx.runQuery(internal.recap.getRecentQuizAttempts, {
        userId,
        since: now - 7 * 24 * 60 * 60 * 1000,
      });
      const avgScore =
        attempts.length > 0
          ? Math.round(
              attempts.reduce(
                (sum, a) => sum + (a.score / a.totalQuestions) * 100,
                0,
              ) / attempts.length,
            )
          : 0;

      dataSummary =
        `Weekly summary (last 7 days):\n` +
        `- Focus sessions: ${sessions.length}\n` +
        `- Total study time: ${hours} hours\n` +
        `- Quizzes completed: ${attempts.length}\n` +
        `- Average quiz score: ${avgScore}%\n` +
        `- Current streak: ${streak?.currentStreak ?? 0} days\n` +
        `- Longest streak: ${streak?.longestStreak ?? 0} days`;
    }

    recapText = await callGroq(ctx, {
      systemPrompt:
        "You write short, encouraging study recaps for Ethiopian students (grades 9-12). " +
        "Use real numbers from their activity. Never fabricate data — if there's no comparison " +
        "data, say something honest and encouraging about starting out. " +
        "Keep it to 2-3 sentences. Be specific but concise. " +
        "Use a warm, motivating tone — like a good tutor checking in.",
      userMessage: `Generate a ${args.type.replace("_", " ")} study recap:\n\n${dataSummary}`,
      maxTokens: 256,
      temperature: 0.6,
    });

    const recapId = await ctx.runMutation(internal.recap.insertRecap, {
      userId,
      type: args.type,
      text: recapText,
      createdAt: now,
    });

    return { text: recapText, recapId };
  },
});

export const insertRecap = internalMutation({
  args: {
    userId: v.id("users"),
    type: v.union(
      v.literal("focus_session"),
      v.literal("quiz"),
      v.literal("weekly"),
    ),
    text: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("recaps", args),
});
