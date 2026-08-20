// AI flashcard generator — generates front/back pairs from content or
// conversations using Grok, validates with retry, stores deck + cards.
// Simple weighted review system surfaces cards needing attention first.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getPremiumAccess } from "./subscriptions";

const API_URL = "https://api.x.ai/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "grok-4.6";

export interface FlashcardPair {
  front: string;
  back: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export const getSubjectById = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) => (await ctx.db.get(subjectId)) ?? null,
});

export const getContentItemById = internalQuery({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, { contentId }) => (await ctx.db.get(contentId)) ?? null,
});

export const getConversationMessages = internalQuery({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) =>
    await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .take(200),
});

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/** Resolve an API key: database (admin panel) first, then env var fallback. */
async function resolveKey(ctx: ActionCtx, keyName: string): Promise<string | undefined> {
  return (await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: keyName })) ?? undefined;
}

async function requestFlashcards(
  ctx: ActionCtx,
  subjectName: string,
  stream: string,
  sourceText: string,
  count: number,
): Promise<string> {
  const xaiKey = await resolveKey(ctx, "XAI_API_KEY");
  if (!xaiKey) {
    throw new ConvexError({
      message: "Flashcard AI is not configured. Go to Admin → Keys tab, click \"Get Key\" next to Grok (xAI), sign up, copy your API key, and paste it here.",
      code: "ai_not_configured",
    });
  }

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${xaiKey}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You create flashcards for Ethiopian students (grades 9-12) studying " +
            "for national examinations (EHEEE/ESSLCE). Each flashcard has a concise " +
            "front (question, concept, or term) and a clear back (answer or definition). " +
            "Cards should test understanding, not just recall. " +
            "Respond ONLY with valid JSON — no markdown, no explanation.",
        },
        {
          role: "user",
          content:
            `Create exactly ${count} flashcards for ${subjectName} (${stream} stream).\n` +
            "Source material:\n" +
            sourceText.slice(0, 6000) +
            "\n\n" +
            "Requirements:\n" +
            "- Front: short question, term, or concept (1-2 sentences max)\n" +
            "- Back: clear, concise answer (1-3 sentences max)\n" +
            "- Cards should progress from easier to harder\n" +
            "- Ground every card in the source material\n\n" +
            "Respond with a JSON array only:\n" +
            '[{"front": "...", "back": "..."}]',
        },
      ],
      max_tokens: 4096,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Grok API error ${response.status}: ${raw.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("Grok returned an empty flashcard response.");
  return content;
}

function parseAndValidate(raw: string, expectedCount: number): FlashcardPair[] {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Flashcards must be a non-empty array.");
  }
  if (parsed.length > expectedCount + 5) {
    throw new Error(`Got ${parsed.length} cards (expected ~${expectedCount}).`);
  }
  const cards: FlashcardPair[] = [];
  for (const item of parsed) {
    const c = item as Record<string, unknown>;
    if (
      typeof c.front !== "string" || !c.front.trim() ||
      typeof c.back !== "string" || !c.back.trim()
    ) {
      throw new Error("One or more flashcards are malformed.");
    }
    cards.push({ front: c.front.trim(), back: c.back.trim() });
  }
  return cards.slice(0, expectedCount);
}

// ---------------------------------------------------------------------------
// Main actions
// ---------------------------------------------------------------------------

export const generateDeck = action({
  args: {
    subjectId: v.id("subjects"),
    contentId: v.optional(v.id("contentItems")),
    conversationId: v.optional(v.id("conversations")),
  },
  handler: async (ctx, args): Promise<{ deckId: Id<"flashcardDecks">; cardCount: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    // Premium gate — same pattern as quizzes/plans
    const premium = await getPremiumAccess(ctx, userId);
    if (!premium) {
      throw new ConvexError({
        message: "Flashcard generation requires a premium account. Start your free trial to try it.",
        code: "premium_flashcards",
      });
    }

    const subject = await ctx.runQuery(internal.flashcards.getSubjectById, {
      subjectId: args.subjectId,
    });
    if (!subject) throw new ConvexError({ message: "Subject not found.", code: "invalid" });

    // Build source text from content item or conversation
    let sourceText = "";
    let title = `${subject.name} Flashcards`;

    if (args.contentId) {
      const item = await ctx.runQuery(internal.flashcards.getContentItemById, {
        contentId: args.contentId,
      });
      if (!item) throw new ConvexError({ message: "Content item not found.", code: "invalid" });
      title = `${item.title} — Flashcards`;
      sourceText = `Title: ${item.title}\nType: ${item.contentType}\nGrade: ${item.grade}\nSubject: ${subject.name}`;
    } else if (args.conversationId) {
      const messages = await ctx.runQuery(internal.flashcards.getConversationMessages, {
        conversationId: args.conversationId,
      });
      if (messages.length === 0) {
        throw new ConvexError({ message: "No messages in this conversation.", code: "invalid" });
      }
      title = `Flashcards from Tutor Chat`;
      sourceText = messages.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 6000);
    } else {
      throw new ConvexError({
        message: "Provide a content item or conversation as source material.",
        code: "invalid",
      });
    }

    const count = 12; // target card count
    let cards: FlashcardPair[] = [];
    let lastError = "Unknown error.";

    // Generate with one retry on malformed output (same pattern as quizzes.ts)
    for (let attempt = 0; attempt < 2 && cards.length === 0; attempt++) {
      try {
        const raw = await requestFlashcards(ctx, subject.name, subject.stream, sourceText, count);
        cards = parseAndValidate(raw, count);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "AI returned invalid JSON.";
        if (attempt === 1) {
          throw new ConvexError({
            message: `Flashcard generation failed: ${lastError}`,
            code: "ai_error",
          });
        }
      }
    }

    if (cards.length === 0) {
      throw new ConvexError({ message: "No flashcards were generated.", code: "ai_error" });
    }

    // Store deck + cards via internal mutations
    const deckId = await ctx.runMutation(internal.flashcards.insertDeck, {
      userId,
      subjectId: args.subjectId,
      contentId: args.contentId,
      sourceType: args.contentId ? "content" : args.conversationId ? "conversation" : "topic",
      title,
      cardCount: cards.length,
      createdAt: Date.now(),
    });

    for (const card of cards) {
      await ctx.runMutation(internal.flashcards.insertCard, {
        deckId,
        front: card.front,
        back: card.back,
      });
    }

    return { deckId, cardCount: cards.length };
  },
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const insertDeck = internalMutation({
  args: {
    userId: v.id("users"),
    subjectId: v.id("subjects"),
    contentId: v.optional(v.id("contentItems")),
    sourceType: v.union(v.literal("content"), v.literal("conversation"), v.literal("topic")),
    title: v.string(),
    cardCount: v.number(),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("flashcardDecks", args),
});

export const insertCard = internalMutation({
  args: {
    deckId: v.id("flashcardDecks"),
    front: v.string(),
    back: v.string(),
  },
  handler: async (ctx, args) =>
    await ctx.db.insert("flashcards", {
      ...args,
      timesReviewed: 0,
      nextReviewWeight: 1,
    }),
});

export const submitCardReview = mutation({
  args: {
    cardId: v.id("flashcards"),
    result: v.union(v.literal("got_it"), v.literal("review_again")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError({ message: "Card not found.", code: "not_found" });

    const currentWeight = card.nextReviewWeight ?? 1;
    const newWeight =
      args.result === "review_again"
        ? Math.min(currentWeight + 0.5, 5) // resurface sooner, cap at 5
        : Math.max(currentWeight - 0.3, 0.2); // deprioritize, floor at 0.2

    await ctx.db.patch(args.cardId, {
      timesReviewed: (card.timesReviewed ?? 0) + 1,
      lastResult: args.result,
      nextReviewWeight: newWeight,
    });

    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getMyDecks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();

    return decks.map((deck) => ({
      ...deck,
      subjectName: "", // filled client-side or via join
    }));
  },
});

export const getDeckCards = query({
  args: { deckId: v.id("flashcardDecks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Verify deck ownership
    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== userId) return [];

    const cards = await ctx.db
      .query("flashcards")
      .withIndex("by_deck", (q) => q.eq("deckId", args.deckId))
      .collect();

    // Sort by nextReviewWeight descending (cards needing review surface first)
    return cards.sort((a, b) => (b.nextReviewWeight ?? 1) - (a.nextReviewWeight ?? 1));
  },
});
