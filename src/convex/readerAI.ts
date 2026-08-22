// Reader AI companion — the "ask about what you're reading" assistant on the
// /read/:contentId page.
//
// Uses Groq (same provider as the rest of the platform).
//
// Required env vars (Keys / API keys tab):
//   GROQ_API_KEY     Groq API key (free at console.groq.com/keys)
//   AI_MODEL        optional — defaults to openai/gpt-oss-120b
//
// Daily cap: shares the same free-tier tutor limit (15 messages / rolling
// 24h) so free students get a fair amount of reading help and premium is
// unlimited — consistent with the rest of the platform's gating.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { getPremiumAccess } from "./subscriptions";
import { FREE_TUTOR_DAILY_LIMIT } from "./constants";
import { logEventAction } from "./systemEvents";
import { callGroq, getModelName } from "./groq";

const MAX_ANSWER_TOKENS = 900;

function asReaderError(error: unknown, fallback: string): ConvexError<{ message: string; code: string }> {
  if (error instanceof ConvexError) return error;
  const message = error instanceof Error ? error.message : fallback;
  return new ConvexError({ message, code: "reader_ai_error" });
}

export const askReaderQuestion = action({
  args: {
    contentId: v.id("contentItems"),
    question: v.string(),
  },
  handler: async (ctx, { contentId, question }): Promise<{ reply: string; provider: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const trimmed = question.trim();
    if (!trimmed) {
      throw new ConvexError({ message: "Question cannot be empty.", code: "invalid" });
    }
    if (trimmed.length > 2000) {
      throw new ConvexError({ message: "Question is too long (max 2,000 characters).", code: "invalid" });
    }

    const premium = await getPremiumAccess(ctx, userId);
    if (!premium) {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const used = await ctx.runQuery(internal.ai.countUserMessagesSince, { userId, since });
      if (used >= FREE_TUTOR_DAILY_LIMIT) {
        throw new ConvexError({
          message:
            `You've used your ${FREE_TUTOR_DAILY_LIMIT} free reading-companion messages for today. ` +
            "Come back tomorrow for a fresh set — or upgrade for unlimited.",
          code: "daily_limit_reached",
        });
      }
    }

    const content = await ctx.runQuery(internal.content.getContentItemById, { contentId });
    if (!content) {
      throw new ConvexError({ message: "Content item not found.", code: "not_found" });
    }
    const subject = content.subjectId
      ? await ctx.runQuery(internal.content.getSubjectById, { subjectId: content.subjectId })
      : null;
    const topicRows: { name: string }[] = await ctx.runQuery(
      internal.content.getContentTopics,
      { contentId },
    );

    const topicLine =
      topicRows.length > 0 ? `Linked topics: ${topicRows.map((topic) => topic.name).join(", ")}.` : "";

    const systemPrompt =
      "You are the Nexus Academy reading companion — an expert guide for Ethiopian " +
      "students in grades 9-12 studying for the national matric exams. The student is " +
      "reading a document RIGHT NOW and is asking about it. Answer directly, warmly and " +
      "precisely. Tie explanations to the document when you can. Show step-by-step working " +
      "for math and sciences. Never invent facts or exam statistics. Keep answers focused " +
      "(short sections, bullets), around 150-300 words unless the question demands more.";

    const userPrompt = `The student is reading:
- Title: ${content.title}
- Type: ${content.contentType}${content.examYear ? ` · Year: ${content.examYear}` : ""}
- Grade: ${content.grade}
- Subject: ${subject?.name ?? "Unknown"}
${topicLine}

Their question about what they're reading:
${trimmed}`;

    const startedAt = Date.now();
    let reply: string;
    try {
      reply = await callGroq(ctx, {
        systemPrompt,
        userMessage: userPrompt,
        maxTokens: MAX_ANSWER_TOKENS,
        temperature: 0.5,
      });

      await logEventAction(ctx, {
        eventType: "api_call",
        source: "reader.ask",
        status: "success",
        userId,
        metadata: { provider: "groq", contentId, model: getModelName() },
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "reader.ask",
        status: "error",
        userId,
        metadata: { provider: "groq", message: error instanceof Error ? error.message : "unknown" },
        durationMs: Date.now() - startedAt,
      });
      throw asReaderError(error, "The reading companion could not reach Groq. Try again.");
    }

    return { reply, provider: "groq" };
  },
});
