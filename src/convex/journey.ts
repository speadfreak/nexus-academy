// Journey / analytics — one query that powers the /journey page:
//   - hours studied per subject (real aggregate of studySessions)
//   - quiz score trend over time (real attempts, not simulated)
//   - topic completion percentage per subject (completed plan weeks' topic
//     ids vs. topics that exist in the library for that subject)
//   - topic correlations: contentTopics links that span two different subjects

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isPremiumStatus } from "./subscriptions";

interface PlanWeek {
  week: number;
  topics: Id<"topics">[];
  focusHours: number;
}

/** Internal — fetch a single topic row by ID. Used by the weekly Telegram
 *  digest to resolve the topic name when computing the user's weakest
 *  topic. Returns null if the topic was deleted. */
export const getTopicById = internalQuery({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => (await ctx.db.get(topicId)) ?? null,
});

export const getJourney = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return {
        premiumAccess: false,
        hoursBySubject: [],
        quizTrend: [],
        topicCompletion: [],
        correlations: [],
      };
    }
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const premiumAccess = sub !== null && isPremiumStatus(sub.status);

    // --- Hours per subject ------------------------------------------------
    const sessions = await ctx.db
      .query("studySessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const perSubject = new Map<
      Id<"subjects">,
      { seconds: number; count: number }
    >();
    for (const session of sessions) {
      const entry = perSubject.get(session.subjectId) ?? { seconds: 0, count: 0 };
      entry.seconds += session.durationSeconds;
      entry.count += 1;
      perSubject.set(session.subjectId, entry);
    }

    const subjectCache = new Map<Id<"subjects">, Doc<"subjects">>();
    const getSubject = async (id: Id<"subjects">) => {
      let subject = subjectCache.get(id);
      if (!subject) {
        subject = (await ctx.db.get(id)) ?? undefined;
        if (subject) subjectCache.set(id, subject);
      }
      return subject;
    };

    const hoursBySubject = [];
    for (const [subjectId, entry] of perSubject) {
      const subject = await getSubject(subjectId);
      hoursBySubject.push({
        subjectId,
        subjectName: subject?.name ?? "Unknown",
        subjectStream: subject?.stream ?? "common",
        hours: Math.round((entry.seconds / 3600) * 100) / 100,
        sessions: entry.count,
      });
    }
    hoursBySubject.sort((a, b) => b.hours - a.hours);

    // --- Quiz trend --------------------------------------------------------
    const attempts = await ctx.db
      .query("quizAttempts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(60);

    const quizTrend = [];
    for (const attempt of attempts) {
      const quiz = await ctx.db.get(attempt.quizId);
      const subject = quiz ? await getSubject(quiz.subjectId) : undefined;
      quizTrend.push({
        id: attempt._id,
        subjectName: subject?.name ?? "Unknown",
        subjectId: quiz?.subjectId ?? null,
        score: attempt.score,
        total: attempt.totalQuestions,
        pct: attempt.totalQuestions > 0
          ? Math.round((attempt.score / attempt.totalQuestions) * 100)
          : 0,
        completedAt: attempt.completedAt,
      });
    }
    quizTrend.reverse(); // oldest first for the line chart

    // --- Topic completion per subject -------------------------------------
    // Completed topic ids come from the weeks a student checked off in their
    // study plans. Denominator is the topics that exist in the library.
    const plans = await ctx.db
      .query("studyPlans")
      .filter((q) => q.eq(q.field("userId"), userId))
      .take(100);

    const allTopics = await ctx.db.query("topics").collect();
    const topicsPerSubject = new Map<Id<"subjects">, number>();
    for (const topic of allTopics) {
      topicsPerSubject.set(
        topic.subjectId,
        (topicsPerSubject.get(topic.subjectId) ?? 0) + 1,
      );
    }

    const completedPerSubject = new Map<Id<"subjects">, Set<Id<"topics">>>();
    for (const plan of plans) {
      let weeks: PlanWeek[];
      try {
        weeks = JSON.parse(plan.planJson) as PlanWeek[];
      } catch {
        continue;
      }
      if (!Array.isArray(weeks)) continue;
      const completedWeeks = plan.completedWeeks ?? [];
      for (const week of weeks) {
        if (!completedWeeks.includes(week.week)) continue;
        if (!Array.isArray(week.topics)) continue;
        let set = completedPerSubject.get(plan.subjectId);
        if (!set) {
          set = new Set();
          completedPerSubject.set(plan.subjectId, set);
        }
        for (const topicId of week.topics) set.add(topicId);
      }
    }

    const topicCompletion = [];
    for (const [subjectId, total] of topicsPerSubject) {
      const subject = await getSubject(subjectId);
      const completed = completedPerSubject.get(subjectId)?.size ?? 0;
      topicCompletion.push({
        subjectId,
        subjectName: subject?.name ?? "Unknown",
        completed,
        total,
        pct: total > 0 ? Math.round((completed / total) * 100) : 0,
      });
    }
    topicCompletion.sort((a, b) => b.pct - a.pct);

    // --- Topic correlations across subjects --------------------------------
    // contentTopics links content to topics; when one topic is attached to
    // content in two different subjects, that's a correlation worth showing.
    const links = await ctx.db.query("contentTopics").take(400);
    const contentCache = new Map<Id<"contentItems">, Doc<"contentItems">>();
    const topicCache = new Map<Id<"topics">, Doc<"topics">>();

    const topicContent = new Map<Id<"topics">, Doc<"contentItems">[]>();
    for (const link of links) {
      let content = contentCache.get(link.contentId);
      if (!content) {
        content = (await ctx.db.get(link.contentId)) ?? undefined;
        if (content) contentCache.set(link.contentId, content);
      }
      let topic = topicCache.get(link.topicId);
      if (!topic) {
        topic = (await ctx.db.get(link.topicId)) ?? undefined;
        if (topic) topicCache.set(link.topicId, topic);
      }
      if (!content || !topic) continue;
      const list = topicContent.get(link.topicId) ?? [];
      list.push(content);
      topicContent.set(link.topicId, list);
    }

    const correlations = [];
    for (const [topicId, contents] of topicContent) {
      const topic = topicCache.get(topicId);
      if (!topic || contents.length < 2) continue;
      const subjects = new Map<Id<"subjects">, string>();
      for (const content of contents) {
        const subject = await getSubject(content.subjectId);
        if (subject) subjects.set(subject._id, subject.name);
      }
      if (subjects.size < 2) continue; // only cross-subject links are interesting
      correlations.push({
        topicId,
        topicName: topic.name,
        grade: topic.grade,
        subjects: [...subjects.values()],
        contentTitles: contents.slice(0, 3).map((c) => c.title),
      });
      if (correlations.length >= 12) break;
    }

    return { premiumAccess, hoursBySubject, quizTrend, topicCompletion, correlations };
  },
});
