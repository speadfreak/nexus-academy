// Reader AI companion — the "ask about what you're reading" assistant on the
// /read/:contentId page.
//
// PROVIDER STRATEGY (Priority B1): the requested guided-learning behavior is
// Google Gemini, so this action prefers GEMINI_API_KEY (Google AI Studio —
// free tier). Until that key is added, it falls back to the existing Grok
// key (XAI_API_KEY) so the feature works today and switches providers the
// moment the Gemini key lands — zero code changes, config-away.
//
// Required env vars (Keys / API keys tab):
//   GEMINI_API_KEY   optional — Google AI Studio key (free tier at aistudio.google.com)
//   GEMINI_MODEL     optional — defaults to gemini-2.0-flash
//   XAI_API_KEY      fallback provider when GEMINI_API_KEY is absent
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

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const GROK_MODEL = process.env.AI_MODEL || "grok-4.6";
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

    // Same fair daily cap as the tutor — free students get real help, never
    // a teaser; premium is unlimited.
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

    // --- Ground the assistant in this specific document ------------------
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
    const geminiKey = process.env.GEMINI_API_KEY;
    const grokKey = process.env.XAI_API_KEY;

    if (!geminiKey && !grokKey) {
      throw new ConvexError({
        message:
          "The reading companion is not configured yet — add GEMINI_API_KEY (preferred) or XAI_API_KEY in the Keys tab.",
        code: "ai_not_configured",
      });
    }

    let reply: string;
    let provider: string;
    try {
      if (geminiKey) {
        provider = "gemini";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              generationConfig: { maxOutputTokens: MAX_ANSWER_TOKENS, temperature: 0.5 },
            }),
          },
        );
        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(`Gemini API error ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`);
        }
        const data = (await response.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
        if (!reply) throw new Error("Gemini returned an empty response.");
      } else {
        provider = "grok";
        const response = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${grokKey}`,
          },
          body: JSON.stringify({
            model: GROK_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            max_tokens: MAX_ANSWER_TOKENS,
            temperature: 0.5,
          }),
        });
        if (!response.ok) {
          const raw = await response.text().catch(() => "");
          throw new Error(`Grok API error ${response.status}${raw ? `: ${raw.slice(0, 200)}` : ""}`);
        }
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        reply = data.choices?.[0]?.message?.content?.trim() ?? "";
        if (!reply) throw new Error("Grok returned an empty response.");
      }

      await logEventAction(ctx, {
        eventType: "api_call",
        source: "geminiReader.ask",
        status: "success",
        userId,
        metadata: { provider, contentId, model: geminiKey ? GEMINI_MODEL : GROK_MODEL },
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "geminiReader.ask",
        status: "error",
        userId,
        metadata: { provider: geminiKey ? "gemini" : "grok", message: error instanceof Error ? error.message : "unknown" },
        durationMs: Date.now() - startedAt,
      });
      throw asReaderError(error, "The reading companion could not reach the AI provider. Try again.");
    }

    return { reply, provider };
  },
});
