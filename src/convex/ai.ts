// AI tutor — powered by the Grok (xAI) chat completions API.
//
// Called from a Convex action because actions are the only Convex function
// type that can make external HTTP calls. The API key is read from
// process.env (set it in the Keys / API keys tab, never hardcode it):
//   XAI_API_KEY   your xAI API key (https://console.x.ai)
//   AI_MODEL      optional — defaults to grok-4.6
//
// Endpoint: https://api.x.ai/v1/chat/completions (OpenAI-compatible).

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getPremiumAccess } from "./subscriptions";
import { FREE_TUTOR_DAILY_LIMIT } from "./constants";
import { logEventAction } from "./systemEvents";

const AI_MODEL = process.env.AI_MODEL || "grok-4.6";
const API_URL = "https://api.x.ai/v1/chat/completions";
const HISTORY_LIMIT = 15;
const MAX_TOKENS = 1024;

/** Resolve an API key: database (admin panel) first, then env var fallback. */
async function resolveKey(ctx: ActionCtx, keyName: string): Promise<string | undefined> {
  return (await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: keyName })) ?? undefined;
}

type AiErrorData = { message: string; code: string };

function asAiError(error: unknown, fallback: string): ConvexError<AiErrorData> {
  if (error instanceof ConvexError) return error;
  const message = error instanceof Error ? error.message : fallback;
  return new ConvexError({ message, code: "ai_error" });
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Internal DB helpers (actions cannot touch ctx.db directly)
// ---------------------------------------------------------------------------

export const getConversationById = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) =>
    (await ctx.db.get(conversationId)) ?? null,
});

export const getMessagesByConversation = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) =>
    await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(200),
});

/**
 * Count of user turns across ALL of a user's conversations within a window.
 * Used to enforce the free-tier daily tutor cap. Premium users skip the cap
 * entirely (checked in sendMessage before this is called).
 */
export const countUserMessagesSince = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) => {
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .take(50);
    let count = 0;
    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .take(200);
      for (const message of messages) {
        if (message.role === "user" && message.createdAt >= since) {
          count += 1;
        }
      }
    }
    return count;
  },
});

export const getFirstMessage = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) =>
    (await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .first()) ?? null,
});

export const getSubjectById = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) =>
    (await ctx.db.get(subjectId)) ?? null,
});

export const listTopicsBySubject = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) =>
    await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", subjectId))
      .collect(),
});

export const insertConversation = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    subjectId: v.optional(v.id("subjects")),
    contentId: v.optional(v.id("contentItems")),
    createdAt: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("conversations", args),
});

export const insertMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("messages", args),
});

export const patchConversation = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.optional(v.string()),
    updatedAt: v.number(),
  },
  handler: async (ctx, { conversationId, title, updatedAt }) => {
    await ctx.db.patch(conversationId, { title, updatedAt });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// System prompt — built from the actual curriculum data so the tutor teaches
// against what this platform covers, not a generic prompt.
// ---------------------------------------------------------------------------

async function buildSystemPrompt(
  ctx: ActionCtx,
  userId: Id<"users">,
  subjectId?: Id<"subjects">,
  contentId?: Id<"contentItems">,
): Promise<string> {
  const lines = [
    "You are the Nexus Academy AI tutor — a precise, encouraging study companion " +
      "for Ethiopian students in grades 9–12 preparing for the national matric " +
      "examinations (ESLCE).",
    "",
    "Teaching rules:",
    "- Be encouraging but precise. When a student is wrong, say so kindly and show the correct path.",
    "- Use examples that fit the student's grade level. Tie concepts to everyday life in Ethiopia where it helps.",
    "- Show working step by step for mathematics and the sciences — never just the answer.",
    "- If a question is out of scope, say so briefly and offer the closest relevant help.",
    "- Never invent facts, figures, dates or exam statistics. If you are unsure, say you are unsure.",
    "- Keep answers focused: use short sections and bullet lists instead of walls of text.",
    `- Today's date is ${new Date().toISOString().slice(0, 10)}.`,
    "",
  ];

  // Personalization: the student's profile (stream + display name) and their
  // self-marked difficulty tags for this subject. Keep it light — the tutor
  // should feel adaptive, not like it's reading a file.
  const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
  if (profile?.stream) {
    const streamLabel =
      profile.stream === "natural"
        ? "Natural Science"
        : profile.stream === "social"
          ? "Social Science"
          : "the shared common subjects (English, Mathematics and the SAT)";
    lines.push(
      `This student is on the ${streamLabel} track. Frame advice around that stream's exam subjects.`,
    );
  }
  if (profile?.displayName) {
    lines.push(
      `This student's name is ${profile.displayName}. Use it once or twice naturally across the conversation — never in every reply.`,
    );
  }
  lines.push("");

  if (subjectId) {
    const subject = await ctx.runQuery(internal.ai.getSubjectById, { subjectId });
    if (subject) {
      lines.push(
        `This conversation is scoped to ${subject.name} (${subject.stream} stream).`,
        `Stay within ${subject.name} unless the student explicitly asks to branch out.`,
        "",
      );
      // Difficulty-aware pacing: if the student marked this subject hard/easy
      // in their notes, adjust the teaching style to match.
      const noteSignals = await ctx.runQuery(internal.notes.getDifficultyBySubject, {
        userId,
        subjectId,
      });
      if (noteSignals.difficulties.includes("hard")) {
        lines.push(
          `This student has marked ${subject.name} as a HARD subject in their notes. ` +
            "Adjust your pacing accordingly: define terms before using them, break steps " +
            "into smaller pieces, check understanding frequently, and be extra patient and " +
            "encouraging. Prefer simpler examples before moving to harder ones.",
          "",
        );
      } else if (noteSignals.difficulties.includes("easy")) {
        lines.push(
          `This student has marked ${subject.name} as EASY in their notes. ` +
            "Keep the pace brisk: skip redundant definitions, go deeper into nuance and " +
            "exam-style application, and challenge them with harder variants.",
          "",
        );
      }
      // Give the model the topic list that exists in the library so answers
      // track the actual syllabus structure.
      const topics = await ctx.runQuery(internal.ai.listTopicsBySubject, { subjectId });
      if (topics.length > 0) {
        const byGrade = new Map<number, string[]>();
        for (const topic of topics) {
          const list = byGrade.get(topic.grade) ?? [];
          list.push(topic.name);
          byGrade.set(topic.grade, list);
        }
        lines.push("Known syllabus topics in the Nexus Academy library:");
        for (const [grade, names] of [...byGrade.entries()].sort(
          ([a], [b]) => a - b,
        )) {
          lines.push(`- Grade ${grade}: ${names.slice(0, 40).join(", ")}`);
        }
        lines.push(
          "Use these topics to anchor answers to the curriculum students actually study.",
          "",
        );
      }
    }
  }

  lines.push(
    "The student also has access to the Nexus Academy library: textbooks, past " +
      "national exam papers, worksheets and guides per grade and subject. " +
      "Where it genuinely helps, point the student to the kind of resource that " +
      "would reinforce the answer (e.g. a past paper or worksheet).",
  );

  // Content grounding — the conversation is attached to a specific document.
  if (contentId) {
    const content = await ctx.runQuery(internal.content.getContentItemById, {
      contentId,
    });
    if (content) {
      lines.push(
        "",
        "The student is discussing a specific document from the library:",
        `- Title: ${content.title}`,
        `- Type: ${content.contentType}${content.examYear ? ` · Year: ${content.examYear}` : ""}`,
        `- Grade: ${content.grade}`,
        "Reference this document directly in your answers where relevant (its topics, " +
          "structure, or the questions it contains). This is the student's frame of reference.",
      );
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// sendMessage — the tutor action
// ---------------------------------------------------------------------------

export const sendMessage = action({
  args: {
    conversationId: v.optional(v.id("conversations")),
    content: v.string(),
    subjectId: v.optional(v.id("subjects")),
    contentId: v.optional(v.id("contentItems")),
  },
  handler: async (ctx, args): Promise<{ reply: string; conversationId: Id<"conversations"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required to use the tutor.", code: "unauthorized" });
    }

    const content = args.content.trim();
    if (!content) {
      throw new ConvexError({ message: "Message cannot be empty.", code: "invalid" });
    }
    if (content.length > 4000) {
      throw new ConvexError({ message: "Message is too long (max 4,000 characters).", code: "invalid" });
    }

    // --- Free-tier daily cap ---------------------------------------------
    // Free accounts get a fair number of messages per day — enough to get
    // real help, never a teaser. Premium (trial or paid) is unlimited. The
    // cap is checked BEFORE the message is persisted, so rejected sends
    // don't consume the quota. Uses a rolling 24h window so no client
    // timezone math is needed server-side.
    const premium = await getPremiumAccess(ctx, userId);
    if (!premium) {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const used = await ctx.runQuery(internal.ai.countUserMessagesSince, {
        userId,
        since,
      });
      if (used >= FREE_TUTOR_DAILY_LIMIT) {
        await logEventAction(ctx, {
          eventType: "api_call",
          source: "ai.sendMessage.cap_hit",
          status: "error",
          userId,
          metadata: { used, limit: FREE_TUTOR_DAILY_LIMIT },
        });
        throw new ConvexError({
          message:
            `You've used your ${FREE_TUTOR_DAILY_LIMIT} free tutor messages for today. ` +
            "Come back tomorrow for a fresh set — or upgrade for unlimited tutoring.",
          code: "daily_limit_reached",
        });
      }
    }

    // --- Resolve or create the conversation -----------------------------
    let conversationId: Id<"conversations">;
    let isFirstExchange = false;
    if (args.conversationId) {
      const conversation = await ctx.runQuery(internal.ai.getConversationById, {
        conversationId: args.conversationId,
      });
      if (!conversation || conversation.userId !== userId) {
        throw new ConvexError({
          message: "Conversation not found or not yours.",
          code: "not_found",
        });
      }
      conversationId = conversation._id;
      const first = await ctx.runQuery(internal.ai.getFirstMessage, {
        conversationId,
      });
      isFirstExchange = first === null;
    } else {
      let subjectId = args.subjectId;
      if (args.contentId) {
        const content = await ctx.runQuery(internal.content.getContentItemById, {
          contentId: args.contentId,
        });
        if (!content) {
          throw new ConvexError({ message: "Content item not found.", code: "invalid" });
        }
        // Scope to the document's subject unless the client already scoped one.
        subjectId = subjectId ?? content.subjectId;
      }
      if (subjectId) {
        const subject = await ctx.runQuery(internal.ai.getSubjectById, {
          subjectId,
        });
        if (!subject) {
          throw new ConvexError({ message: "Subject not found.", code: "invalid" });
        }
      }
      const now = Date.now();
      conversationId = await ctx.runMutation(internal.ai.insertConversation, {
        userId,
        title: "New chat",
        subjectId,
        contentId: args.contentId,
        createdAt: now,
        updatedAt: now,
      });
      isFirstExchange = true;
    }

    // --- Persist the user message --------------------------------------
    const now = Date.now();
    await ctx.runMutation(internal.ai.insertMessage, {
      conversationId,
      role: "user",
      content,
      createdAt: now,
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId,
      updatedAt: now,
    });

    // --- Pull bounded history for context -------------------------------
    // ActionCtx.runQuery is deliberately untyped (any) — annotate the rows.
    const historyRows: Doc<"messages">[] = await ctx.runQuery(
      internal.ai.getMessagesByConversation,
      { conversationId },
    );
    const history = historyRows
      .slice(-HISTORY_LIMIT)
      .map((message) => ({ role: message.role, content: message.content }));

    // --- Call Grok -------------------------------------------------------
    const xaiKey = await resolveKey(ctx, "XAI_API_KEY");
    if (!xaiKey) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "ai.sendMessage.not_configured",
        status: "error",
        userId,
      });
      throw new ConvexError({
        message: "AI tutor is not configured yet. Go to Admin → Keys tab, click \"Get Key\" next to Grok (xAI), sign up at console.x.ai, copy your API key, and paste it here.",
        code: "ai_not_configured",
      });
    }

    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId,
    });
    const systemPrompt = await buildSystemPrompt(
      ctx,
      userId,
      conversation?.subjectId,
      conversation?.contentId,
    );

    let reply: string;
    const aiStart = Date.now();
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${xaiKey}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "system", content: systemPrompt }, ...history],
          max_tokens: MAX_TOKENS,
          temperature: 0.5,
        }),
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => "");
        const detail = raw.slice(0, 300);
        throw new Error(
          `Grok API error ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      reply = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!reply) {
        throw new Error("Grok returned an empty response.");
      }
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "ai.sendMessage.grok",
        status: "success",
        userId,
        metadata: { model: AI_MODEL, conversationId },
        durationMs: Date.now() - aiStart,
      });
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "ai.sendMessage.grok",
        status: "error",
        userId,
        metadata: { message: error instanceof Error ? error.message : "unknown" },
        durationMs: Date.now() - aiStart,
      });
      throw asAiError(error, "The AI tutor could not reach the Grok API. Try again.");
    }

    // --- Persist the assistant reply ------------------------------------
    await ctx.runMutation(internal.ai.insertMessage, {
      conversationId,
      role: "assistant",
      content: reply,
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId,
      updatedAt: Date.now(),
    });

    // --- Generate a title from the first exchange ------------------------
    if (isFirstExchange) {
      let title: string;
      if (conversation?.subjectId) {
        const subject = await ctx.runQuery(internal.ai.getSubjectById, {
          subjectId: conversation.subjectId,
        });
        title = subject
          ? `${subject.name}: ${truncate(content, 44)}`
          : truncate(content, 52);
      } else {
        title = truncate(content, 52);
      }
      await ctx.runMutation(internal.ai.patchConversation, {
        conversationId,
        title,
        updatedAt: Date.now(),
      });
    }

    return { reply, conversationId };
  },
});

// ---------------------------------------------------------------------------
// Read API — conversation list + thread, both ownership-checked
// ---------------------------------------------------------------------------

export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);

    const subjectCache = new Map<Id<"subjects">, Doc<"subjects">>();
    const contentCache = new Map<Id<"contentItems">, Doc<"contentItems">>();
    const result = [];
    for (const conversation of rows) {
      let subjectName: string | null = null;
      if (conversation.subjectId) {
        let subject = subjectCache.get(conversation.subjectId);
        if (!subject) {
          subject = (await ctx.db.get(conversation.subjectId)) ?? undefined;
          if (subject) subjectCache.set(conversation.subjectId, subject);
        }
        subjectName = subject?.name ?? null;
      }
      let contentTitle: string | null = null;
      if (conversation.contentId) {
        let content = contentCache.get(conversation.contentId);
        if (!content) {
          content = (await ctx.db.get(conversation.contentId)) ?? undefined;
          if (content) contentCache.set(conversation.contentId, content);
        }
        contentTitle = content?.title ?? null;
      }
      result.push({
        ...conversation,
        subjectName,
        contentTitle,
      });
    }
    return result;
  },
});

export const getMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.userId !== userId) {
      return [];
    }

    return await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(200);
  },
});
