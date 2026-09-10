// AI flashcard generator — generates front/back pairs from content or
// conversations using the AI, validates with retry, stores deck + cards.
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
import { callGroq } from "./groq";

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

async function requestFlashcards(
  ctx: ActionCtx,
  subjectName: string,
  stream: string,
  sourceText: string,
  count: number,
): Promise<string> {
  return await callGroq(ctx, {
    systemPrompt:
      "You create flashcards for Ethiopian students (grades 9-12) studying " +
      "for national examinations (EHEEE/ESSLCE). Each flashcard has a concise " +
      "front (question, concept, or term) and a clear back (answer or definition). " +
      "Cards should test understanding, not just recall. " +
      "Respond ONLY with valid JSON — no markdown, no explanation.",
    userMessage:
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
    maxTokens: 4096,
    temperature: 0.4,
  });
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
    difficulty: v.optional(v.union(
      v.literal("basic"),
      v.literal("exam_level"),
      v.literal("hard"),
      v.literal("eheee_focus"),
    )),
  },
  handler: async (ctx, args): Promise<{ deckId: Id<"flashcardDecks">; cardCount: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

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
      title = "Flashcards from Tutor Chat";
      sourceText = messages.map((m) => `${m.role}: ${m.content}`).join("\n").slice(0, 6000);
    } else {
      // Topic mode: generate from subject metadata (name, stream, grade).
      // The AI knows the Ethiopian curriculum and can produce relevant cards.
      title = `${subject.name} Flashcards`;
      sourceText =
        `Subject: ${subject.name}\n` +
        `Stream: ${subject.stream}\n` +
        `Generate flashcards covering key topics, definitions, and concepts typically\n` +
        `found in the Ethiopian national curriculum (EHEEE/ESSLCE) for this subject.`;
    }

    const count = 12;
    let cards: FlashcardPair[] = [];
    let lastError = "Unknown error.";

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

    const deckId = await ctx.runMutation(internal.flashcards.insertDeck, {
      userId,
      subjectId: args.subjectId,
      contentId: args.contentId,
      sourceType: args.contentId ? "content" : args.conversationId ? "conversation" : "topic",
      title,
      cardCount: cards.length,
      createdAt: Date.now(),
      difficulty: args.difficulty,
      deckCategory: args.difficulty,
      colorTag: args.difficulty === "basic" ? "green" : args.difficulty === "exam_level" ? "amber" : args.difficulty === "hard" ? "red" : "violet",
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
// Textbook → Flashcards — generate from extracted page text
// Called from the Reader when a student clicks "✨ Make Flashcards".
// The `pageText` is the actual text extracted from the PDF pages the
// student is currently reading — NOT metadata. This produces cards
// that are specific to the content they're studying right now.
// ---------------------------------------------------------------------------

export const generateFromContent = action({
  args: {
    contentId: v.id("contentItems"),
    subjectId: v.id("subjects"),
    pageText: v.string(), // extracted text from the PDF the student is reading
    pageRange: v.optional(v.string()), // e.g. "pages 12-18" for context
    difficulty: v.optional(v.union(
      v.literal("basic"),
      v.literal("exam_level"),
      v.literal("hard"),
      v.literal("eheee_focus"),
    )),
  },
  handler: async (ctx, args): Promise<{ deckId: Id<"flashcardDecks">; cardCount: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

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

    const contentItem = await ctx.runQuery(internal.flashcards.getContentItemById, {
      contentId: args.contentId,
    });
    if (!contentItem) throw new ConvexError({ message: "Content item not found.", code: "invalid" });

    // Use the actual page text — this is what makes Textbook → Flashcards
    // powerful: the AI creates cards from the REAL content, not just the
    // title/metadata. Capped at 6000 chars to stay within AI token limits.
    const sourceText = args.pageText.slice(0, 6000);
    const title = `${contentItem.title} — Flashcards${args.pageRange ? ` (${args.pageRange})` : ""}`;

    // Adjust the AI prompt based on difficulty
    const difficultyInstruction = args.difficulty === "hard"
      ? "Create challenging, exam-style questions that require deep understanding, not just recall."
      : args.difficulty === "exam_level"
        ? "Create exam-level questions matching EHEEE difficulty and style."
        : args.difficulty === "eheee_focus"
          ? "Create EHEEE-focused questions targeting the most commonly tested concepts in this material."
          : "Create clear, basic questions suitable for initial learning.";

    const count = 15;
    const fullSourceText = `Content: ${contentItem.title}\nSubject: ${subject.name}\nGrade: ${contentItem.grade}\n\n--- EXTRACTED PAGE TEXT ---\n${sourceText}\n--- END ---\n\n${difficultyInstruction}`;

    let cards: FlashcardPair[] = [];
    let lastError = "Unknown error.";

    for (let attempt = 0; attempt < 2 && cards.length === 0; attempt++) {
      try {
        const raw = await requestFlashcards(ctx, subject.name, subject.stream, fullSourceText, count);
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

    const deckId = await ctx.runMutation(internal.flashcards.insertDeck, {
      userId,
      subjectId: args.subjectId,
      contentId: args.contentId,
      sourceType: "content" as const,
      title,
      cardCount: cards.length,
      createdAt: Date.now(),
      difficulty: args.difficulty,
      deckCategory: args.difficulty,
      colorTag: args.difficulty === "basic" ? "green" : args.difficulty === "exam_level" ? "amber" : args.difficulty === "hard" ? "red" : "violet",
    });

    for (const card of cards) {
      await ctx.runMutation(internal.flashcards.insertCard, {
        deckId,
        front: card.front,
        back: card.back,
      });
    }

    // Award XP for generating flashcards
    await ctx.runMutation(internal.xp.awardXp, {
      userId,
      amount: 15,
      reason: "flashcard_generate",
    }).catch(() => {});

    return { deckId, cardCount: cards.length };
  },
});

// ---------------------------------------------------------------------------
// "Why?" AI Explanation Engine — gives the student a contextual
// explanation of WHY the answer is correct, with three levels:
//   1. Concise "why"
//   2. Simple version (explain like they're learning it for the first time)
//   3. Go Deeper (detailed syllabus-level explanation)
// Plus an EHEEE exam tip + related concepts.
//
// Also: "Learn From Your Mistake" — when the student presses "I forgot",
// generates a mini-learning-loop: simple explanation, why their answer
// was wrong, correct concept, quick example, and a follow-up question.
// ---------------------------------------------------------------------------

export const explainCard = action({
  args: {
    cardId: v.id("flashcards"),
    mode: v.union(
      v.literal("why"),          // concise "why is this the answer"
      v.literal("simple"),       // explain like I'm learning it for the first time
      v.literal("deeper"),       // go deeper — detailed syllabus-level
      v.literal("exam_tip"),     // EHEEE-specific exam tip
      v.literal("related"),      // related concepts chain
    ),
  },
  handler: async (ctx, args): Promise<{ explanation: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    // Get the card + its deck + subject for context
    const card = await ctx.runQuery(internal.flashcards.getCardById, { cardId: args.cardId });
    if (!card) throw new ConvexError({ message: "Card not found.", code: "not_found" });

    const deck = await ctx.runQuery(internal.flashcards.getDeckById, { deckId: card.deckId });
    const subject = deck?.subjectId
      ? await ctx.runQuery(internal.flashcards.getSubjectById, { subjectId: deck.subjectId })
      : null;

    const subjectName = subject?.name ?? "General";
    const subjectStream = subject?.stream ?? "common";

    const modePrompts: Record<string, string> = {
      why: "Give a concise, 2-3 sentence explanation of WHY the answer is correct. Be direct and clear.",
      simple: "Explain this concept as if the student is learning it for the very first time. Use simple language, an analogy, and avoid jargon.",
      deeper: "Give a detailed, syllabus-level explanation. Cover the underlying mechanism, the key relationships, and how it connects to broader topics. This should help a grade 9-12 Ethiopian student deeply understand.",
      exam_tip: "Give a specific EHEEE exam tip for this concept. What should the student remember for the exam? What commonly connects to this? What traps do students fall into?",
      related: "List 4-5 related concepts that connect to this one, in a chain format: Concept A → Concept B → Concept C. Explain briefly how each connects.",
    };

    const prompt = `You are an expert tutor for the Ethiopian national exam (EHEEE).
Subject: ${subjectName} (${subjectStream} stream)

Flashcard question: ${card.front}
Flashcard answer: ${card.back}

${modePrompts[args.mode] ?? modePrompts.why}

Keep your response under 150 words. Write in clear, encouraging English.`;

    try {
      const raw = await callGroq(ctx, {
        systemPrompt: "You are a precise, encouraging tutor. Explain concepts clearly and concisely for Ethiopian students preparing for the EHEEE. Never use emojis. Always be accurate.",
        userMessage: prompt,
        maxTokens: 256,
        temperature: 0.3,
      });
      return { explanation: raw.trim() };
    } catch (error) {
      throw new ConvexError({
        message: `Could not generate explanation: ${error instanceof Error ? error.message : "AI error"}`,
        code: "ai_error",
      });
    }
  },
});

// ── "Learn From Your Mistake" — the mini learning loop ─────────────────

export const learnFromMistake = action({
  args: {
    cardId: v.id("flashcards"),
    studentAnswer: v.optional(v.string()), // what the student typed (if type mode)
  },
  handler: async (ctx, args): Promise<{
    simpleExplanation: string;
    whyWrong: string;
    correctConcept: string;
    quickExample: string;
    followUpQuestion: string;
    followUpAnswer: string;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const card = await ctx.runQuery(internal.flashcards.getCardById, { cardId: args.cardId });
    if (!card) throw new ConvexError({ message: "Card not found.", code: "not_found" });

    const deck = await ctx.runQuery(internal.flashcards.getDeckById, { deckId: card.deckId });
    const subject = deck?.subjectId
      ? await ctx.runQuery(internal.flashcards.getSubjectById, { subjectId: deck.subjectId })
      : null;

    const subjectName = subject?.name ?? "General";
    const studentPart = args.studentAnswer
      ? `\nThe student's wrong answer was: "${args.studentAnswer}"\nExplain why this is wrong and what the misconception is.`
      : `\nThe student forgot the answer. Help them understand and remember it.`;

    const prompt = `You are an expert tutor for the Ethiopian national exam (EHEEE).
Subject: ${subjectName}

Flashcard question: ${card.front}
Flashcard answer: ${card.back}
${studentPart}

Generate a mini-learning-loop to help the student fix this mistake. Return STRICT JSON with this exact shape:
{
  "simpleExplanation": "A simple, 1-2 sentence explanation of the concept.",
  "whyWrong": "Why the student's answer/thinking was wrong, in 1-2 sentences.",
  "correctConcept": "The correct concept stated clearly, 1-2 sentences.",
  "quickExample": "A quick, concrete example that makes it memorable.",
  "followUpQuestion": "A new follow-up question that tests the same concept differently.",
  "followUpAnswer": "The answer to the follow-up question."
}

Keep each field concise (1-2 sentences max). Write in clear English.`;

    try {
      const raw = await callGroq(ctx, {
        systemPrompt: "You are a precise tutor. You only output valid JSON. Never use emojis. Be accurate and encouraging.",
        userMessage: prompt,
        maxTokens: 512,
        temperature: 0.3,
      });

      // Parse the JSON response
      const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      const start = trimmed.indexOf("{");
      const end = trimmed.lastIndexOf("}");
      if (start === -1 || end === -1) throw new Error("AI returned invalid JSON");
      const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
        simpleExplanation: string;
        whyWrong: string;
        correctConcept: string;
        quickExample: string;
        followUpQuestion: string;
        followUpAnswer: string;
      };

      return parsed;
    } catch (error) {
      throw new ConvexError({
        message: `Could not generate mistake explanation: ${error instanceof Error ? error.message : "AI error"}`,
        code: "ai_error",
      });
    }
  },
});

// ── Internal queries for the explanation engine ─────────────────────────

export const getCardById = internalQuery({
  args: { cardId: v.id("flashcards") },
  handler: async (ctx, { cardId }) => (await ctx.db.get(cardId)) ?? null,
});

export const getDeckById = internalQuery({
  args: { deckId: v.id("flashcardDecks") },
  handler: async (ctx, { deckId }) => (await ctx.db.get(deckId)) ?? null,
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const insertDeck = internalMutation({
  args: {
    userId: v.id("users"),
    subjectId: v.optional(v.id("subjects")),
    contentId: v.optional(v.id("contentItems")),
    sourceType: v.union(v.literal("content"), v.literal("conversation"), v.literal("topic"), v.literal("aptitude"), v.literal("eheee"), v.literal("weakness")),
    title: v.string(),
    cardCount: v.number(),
    createdAt: v.number(),
    difficulty: v.optional(v.union(
      v.literal("basic"),
      v.literal("exam_level"),
      v.literal("hard"),
      v.literal("eheee_focus"),
    )),
    deckCategory: v.optional(v.string()),
    colorTag: v.optional(v.string()),
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
    result: v.union(
      v.literal("got_it"),
      v.literal("review_again"),
      v.literal("easy"),
      v.literal("good"),
      v.literal("hard"),
      v.literal("forgot"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const card = await ctx.db.get(args.cardId);
    if (!card) throw new ConvexError({ message: "Card not found.", code: "not_found" });

    const now = Date.now();
    const currentWeight = card.nextReviewWeight ?? 1;

    // ── Smart Spaced Repetition (inspired by FSRS principles) ──────────
    // This is NOT the full FSRS algorithm — it's a lightweight scheduler
    // that uses the same concepts (memory strength, stability, retrievability)
    // with simplified fixed multipliers for each rating level. For a full
    // FSRS implementation, we'd need the actual FSRS library computing
    // stability/difficulty/retrievability from the full review history with
    // the FSRS optimizer. This is the honest version — it works well, but
    // it's "Smart Spaced Repetition" not "FSRS" per se.
    // Rating: easy(5) > good(4) > hard(3) > got_it(4) > review_again(2) > forgot(1)
    // For simplicity we map: easy→5, good→4, got_it→4, hard→3, review_again→2, forgot→1
    const ratingMap: Record<string, number> = {
      easy: 5, good: 4, got_it: 4, hard: 3, review_again: 2, forgot: 1,
    };
    const rating = ratingMap[args.result] ?? 3;

    // Update memory strength (0-1) based on rating
    // Rating 5 → +0.1, 4 → +0.05, 3 → no change, 2 → -0.1, 1 → -0.2
    const currentStrength = card.memoryStrength ?? 0.5;
    const strengthDelta = rating >= 5 ? 0.1 : rating >= 4 ? 0.05 : rating >= 3 ? 0 : rating >= 2 ? -0.1 : -0.2;
    const newStrength = Math.max(0, Math.min(1, currentStrength + strengthDelta));

    // Update stability (how long the memory lasts, in days)
    // Higher rating + higher strength = longer stability
    const currentStability = card.stability ?? 1;
    const stabilityFactor = rating >= 4 ? 1.3 : rating >= 3 ? 1.0 : 0.7;
    const newStability = Math.max(0.1, currentStability * stabilityFactor * (0.5 + newStrength));

    // Compute retrievability (probability of recalling now)
    // R = exp(-elapsedDays / stability)
    const elapsedDays = card.lastReviewedAt
      ? (now - card.lastReviewedAt) / (24 * 60 * 60 * 1000)
      : 0;
    const retrievability = Math.exp(-elapsedDays / Math.max(newStability, 0.1));

    // Compute next review time based on stability + retrievability
    // If retrievability drops below 0.9 (90%), schedule review
    // Otherwise, schedule based on stability
    const daysUntilReview = rating <= 2 ? 0 : // forgot/review_again → review today
      rating === 3 ? Math.max(1, newStability * 0.5) : // hard → half stability
      rating === 4 ? newStability : // good → full stability
      newStability * 2.5; // easy → 2.5x stability
    const nextReviewAt = now + daysUntilReview * 24 * 60 * 60 * 1000;

    // New weight (for backwards compat with the old sorting)
    const newWeight =
      args.result === "review_again" || args.result === "forgot"
        ? Math.min(currentWeight + 0.5, 5)
        : Math.max(currentWeight - 0.3, 0.2);

    // Build review history entry
    const historyEntry = {
      time: now,
      rating: args.result,
      elapsedDays,
    };
    const currentHistory = card.reviewHistory ?? [];
    const newHistory = [...currentHistory, historyEntry].slice(-50); // cap at 50 entries

    // Mastered = memory strength >= 0.9
    const mastered = newStrength >= 0.9;

    await ctx.db.patch(args.cardId, {
      timesReviewed: (card.timesReviewed ?? 0) + 1,
      lastResult: args.result,
      nextReviewWeight: newWeight,
      memoryStrength: newStrength,
      stability: newStability,
      retrievability,
      lastReviewedAt: now,
      nextReviewAt,
      reviewHistory: newHistory,
      mastered,
    });

    return { ok: true as const, memoryStrength: newStrength, mastered };
  },
});

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

// ── Memory Analytics — the "Memory Lab" dashboard ──────────────────────

export const getMemoryStats = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    let allCards: Doc<"flashcards">[] = [];
    for (const deck of decks) {
      const cards = await ctx.db
        .query("flashcards")
        .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
        .collect();
      allCards = allCards.concat(cards);
    }

    const totalCards = allCards.length;
    const studied = allCards.filter((c) => (c.timesReviewed ?? 0) > 0);
    const mastered = allCards.filter((c) => c.mastered === true);
    const weak = allCards.filter((c) => (c.memoryStrength ?? 0.5) < 0.4);
    const learning = studied.filter((c) => !c.mastered && (c.memoryStrength ?? 0.5) >= 0.4);

    const avgStrength = totalCards > 0
      ? allCards.reduce((sum, c) => sum + (c.memoryStrength ?? 0.5), 0) / totalCards
      : 0;
    const accuracy = studied.length > 0
      ? studied.filter((c) => c.lastResult === "got_it" || c.lastResult === "easy" || c.lastResult === "good").length / studied.length
      : 0;

    // 7-day consistency: how many of the last 7 days did the student review cards?
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const reviewedDays = new Set<string>();
    for (const card of studied) {
      if ((card.lastReviewedAt ?? 0) >= sevenDaysAgo) {
        reviewedDays.add(new Date(card.lastReviewedAt!).toDateString());
      }
    }
    const consistency = reviewedDays.size / 7;

    // Due cards (cards whose nextReviewAt is in the past)
    const dueCards = allCards.filter((c) => (c.nextReviewAt ?? 0) > 0 && c.nextReviewAt! <= now);

    return {
      totalCards,
      studied: studied.length,
      mastered: mastered.length,
      learning: learning.length,
      weak: weak.length,
      retention: Math.round(avgStrength * 100),
      accuracy: Math.round(accuracy * 100),
      consistency: Math.round(consistency * 100),
      dueCards: dueCards.length,
    };
  },
});

// ── Weakness Hunter — find the student's weakest topics ────────────────

export const getWeaknessReport = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const decks = await ctx.db
      .query("flashcardDecks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const weaknessData: Array<{ deckId: string; title: string; subjectId?: string; weakness: number; cardCount: number; masteredCount: number }> = [];

    for (const deck of decks) {
      const cards = await ctx.db
        .query("flashcards")
        .withIndex("by_deck", (q) => q.eq("deckId", deck._id))
        .collect();

      if (cards.length === 0) continue;

      const avgStrength = cards.reduce((sum, c) => sum + (c.memoryStrength ?? 0.5), 0) / cards.length;
      const masteredCount = cards.filter((c) => c.mastered === true).length;

      weaknessData.push({
        deckId: deck._id,
        title: deck.title,
        subjectId: deck.subjectId ?? undefined,
        weakness: Math.round((1 - avgStrength) * 100),
        cardCount: cards.length,
        masteredCount,
      });
    }

    // Sort by weakness (highest first = weakest)
    return weaknessData.sort((a, b) => b.weakness - a.weakness);
  },
});

// ── Get cards due for review (spaced repetition) ────────────────────────

export const getDueCards = query({
  args: { deckId: v.id("flashcardDecks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const now = Date.now();
    const cards = await ctx.db
      .query("flashcards")
      .withIndex("by_deck", (q) => q.eq("deckId", args.deckId))
      .collect();

    // Cards are "due" if:
    // 1. They have nextReviewAt in the past, OR
    // 2. They've never been reviewed (timesReviewed = 0)
    return cards.filter((c) =>
      (c.nextReviewAt && c.nextReviewAt <= now) ||
      (c.timesReviewed ?? 0) === 0
    );
  },
});
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
      subjectName: "",
    }));
  },
});

export const getDeckCards = query({
  args: { deckId: v.id("flashcardDecks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const deck = await ctx.db.get(args.deckId);
    if (!deck || deck.userId !== userId) return [];

    const cards = await ctx.db
      .query("flashcards")
      .withIndex("by_deck", (q) => q.eq("deckId", args.deckId))
      .collect();

    return cards.sort((a, b) => (b.nextReviewWeight ?? 1) - (a.nextReviewWeight ?? 1));
  },
});
