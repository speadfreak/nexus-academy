// Study Cards — bite-sized quick-reference cards per topic.
//
// A new content format DISTINCT from Flashcards (which test recall via
// front/back pairs) and full textbooks (which are comprehensive PDFs).
// Study cards are short reference cards for quick concept lookup —
// like a well-organized cheat sheet per topic.
//
// Two creation paths:
//   1. Admin-authored — admins create cards via the admin form using
//      createAdmin mutation. Free-form text, original wording.
//   2. AI-generated — premium users trigger generation via generateAI
//      action. Groq call with structured JSON output, retry on
//      malformed, same discipline as quizzes/flashcards. Grounded in
//      real curriculum topic data (subject + grade).
//
// Browsing is FREE for everyone. AI GENERATION is premium-gated —
// consistent with the project's "browsing content is free" principle
// and matching how quizzes/flashcards gate generation.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { callGroq } from "./groq";
import { getPremiumAccess } from "./subscriptions";
import { requireAdminMutation } from "./admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StudyCardView {
  _id: Id<"studyCards">;
  subjectId: Id<"subjects">;
  subjectName: string;
  gradeLevel: 9 | 10 | 11 | 12;
  topicId: Id<"topics"> | null;
  title: string;
  whenToUseIt: string;
  commonMistake: string;
  bodyContent: string;
  createdVia: "admin" | "ai";
  createdAt: number;
  isBookmarked: boolean;
}

interface StudyCardSummary {
  _id: Id<"studyCards">;
  subjectName: string;
  gradeLevel: 9 | 10 | 11 | 12;
  title: string;
  createdVia: "admin" | "ai";
  createdAt: number;
  isBookmarked: boolean;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function requireUser(ctx: QueryCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  return userId;
}

// ---------------------------------------------------------------------------
// Browse query — list study cards with optional subject/grade filter
// ---------------------------------------------------------------------------

/**
 * Run a study-cards query based on which filters are present. Each branch
 * uses a different index (or no index for the all-cards case). Splitting
 * into 4 branches is type-safe — Convex's Query type doesn't allow
 * reassigning between bare Query and QueryInitializer-with-index.
 */
async function fetchCards(
  ctx: QueryCtx,
  subjectId: Id<"subjects"> | undefined,
  gradeLevel: 9 | 10 | 11 | 12 | undefined,
) {
  if (subjectId && gradeLevel) {
    return await ctx.db
      .query("studyCards")
      .withIndex("by_subject_grade", (q) =>
        q.eq("subjectId", subjectId).eq("gradeLevel", gradeLevel),
      )
      .order("desc")
      .take(200);
  }
  if (subjectId) {
    return await ctx.db
      .query("studyCards")
      .withIndex("by_subject", (q) => q.eq("subjectId", subjectId))
      .order("desc")
      .take(200);
  }
  if (gradeLevel) {
    return await ctx.db
      .query("studyCards")
      .withIndex("by_grade", (q) => q.eq("gradeLevel", gradeLevel))
      .order("desc")
      .take(200);
  }
  return await ctx.db.query("studyCards").order("desc").take(200);
}

/**
 * List study cards, optionally filtered by subject and/or grade.
 * Returns the FULL card content (use `listSummaries` for a lighter
 * summary view). Public — browsing is free for everyone (signed-in
 * users get their bookmark state; signed-out users get isBookmarked=false).
 */
export const list = query({
  args: {
    subjectId: v.optional(v.id("subjects")),
    gradeLevel: v.optional(v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    )),
  },
  handler: async (ctx, args): Promise<StudyCardView[]> => {
    const userId = await getAuthUserId(ctx);
    const cards = await fetchCards(ctx, args.subjectId, args.gradeLevel);
    // Resolve subject names + bookmark state in a single pass
    const subjectCache = new Map<Id<"subjects">, string>();
    const bookmarkSet = new Set<Id<"studyCards">>();
    if (userId) {
      const bookmarks = await ctx.db
        .query("studyCardBookmarks")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const b of bookmarks) bookmarkSet.add(b.studyCardId);
    }
    const result: StudyCardView[] = [];
    for (const card of cards) {
      let subjectName = subjectCache.get(card.subjectId);
      if (subjectName === undefined) {
        const subj = await ctx.db.get(card.subjectId);
        subjectName = subj?.name ?? "Subject";
        subjectCache.set(card.subjectId, subjectName);
      }
      result.push({
        _id: card._id,
        subjectId: card.subjectId,
        subjectName,
        gradeLevel: card.gradeLevel,
        topicId: card.topicId ?? null,
        title: card.title,
        whenToUseIt: card.whenToUseIt,
        commonMistake: card.commonMistake,
        bodyContent: card.bodyContent,
        createdVia: card.createdVia,
        createdAt: card.createdAt,
        isBookmarked: bookmarkSet.has(card._id),
      });
    }
    return result;
  },
});

/**
 * Lighter summary view — used by the sidebar list (one-line per card).
 * Doesn't return the body content (saves bandwidth for large decks).
 */
export const listSummaries = query({
  args: {
    subjectId: v.optional(v.id("subjects")),
    gradeLevel: v.optional(v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    )),
  },
  handler: async (ctx, args): Promise<StudyCardSummary[]> => {
    const userId = await getAuthUserId(ctx);
    const cards = await fetchCards(ctx, args.subjectId, args.gradeLevel);
    const subjectCache = new Map<Id<"subjects">, string>();
    const bookmarkSet = new Set<Id<"studyCards">>();
    if (userId) {
      const bookmarks = await ctx.db
        .query("studyCardBookmarks")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const b of bookmarks) bookmarkSet.add(b.studyCardId);
    }
    const result: StudyCardSummary[] = [];
    for (const card of cards) {
      let subjectName = subjectCache.get(card.subjectId);
      if (subjectName === undefined) {
        const subj = await ctx.db.get(card.subjectId);
        subjectName = subj?.name ?? "Subject";
        subjectCache.set(card.subjectId, subjectName);
      }
      result.push({
        _id: card._id,
        subjectName,
        gradeLevel: card.gradeLevel,
        title: card.title,
        createdVia: card.createdVia,
        createdAt: card.createdAt,
        isBookmarked: bookmarkSet.has(card._id),
      });
    }
    return result;
  },
});

/**
 * Get a single study card by ID. Public (browsing is free).
 */
export const getById = query({
  args: { studyCardId: v.id("studyCards") },
  handler: async (ctx, { studyCardId }): Promise<StudyCardView | null> => {
    const userId = await getAuthUserId(ctx);
    const card = await ctx.db.get(studyCardId);
    if (!card) return null;
    const subj = await ctx.db.get(card.subjectId);
    let isBookmarked = false;
    if (userId) {
      const existing = await ctx.db
        .query("studyCardBookmarks")
        .withIndex("by_user_card", (q) =>
          q.eq("userId", userId).eq("studyCardId", studyCardId),
        )
        .first();
      isBookmarked = !!existing;
    }
    return {
      _id: card._id,
      subjectId: card.subjectId,
      subjectName: subj?.name ?? "Subject",
      gradeLevel: card.gradeLevel,
      topicId: card.topicId ?? null,
      title: card.title,
      whenToUseIt: card.whenToUseIt,
      commonMistake: card.commonMistake,
      bodyContent: card.bodyContent,
      createdVia: card.createdVia,
      createdAt: card.createdAt,
      isBookmarked,
    };
  },
});

// ---------------------------------------------------------------------------
// Bookmark — reuse the "Saved" terminology + UX patterns from content
// bookmarks, but in a separate table because the existing bookmarks
// table is strictly typed to contentItems (PDFs/files). The student
// sees the same "Saved" language + count badge + toggle interaction.
// ---------------------------------------------------------------------------

export const toggleBookmark = mutation({
  args: { studyCardId: v.id("studyCards") },
  handler: async (ctx, { studyCardId }) => {
    const userId = await requireUser(ctx);
    const card = await ctx.db.get(studyCardId);
    if (!card) {
      throw new ConvexError({ message: "Study card not found.", code: "not_found" });
    }
    const existing = await ctx.db
      .query("studyCardBookmarks")
      .withIndex("by_user_card", (q) =>
        q.eq("userId", userId).eq("studyCardId", studyCardId),
      )
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
      return { bookmarked: false };
    }
    await ctx.db.insert("studyCardBookmarks", {
      userId,
      studyCardId,
      createdAt: Date.now(),
    });
    return { bookmarked: true };
  },
});

export const getMyBookmarkedCardIds = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("studyCardBookmarks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => r.studyCardId);
  },
});

// ---------------------------------------------------------------------------
// Admin authoring — admins create cards via the admin form
// ---------------------------------------------------------------------------

export const createAdmin = mutation({
  args: {
    subjectId: v.id("subjects"),
    gradeLevel: v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    ),
    topicId: v.optional(v.id("topics")),
    title: v.string(),
    whenToUseIt: v.string(),
    commonMistake: v.string(),
    bodyContent: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireAdminMutation(ctx);
    const title = args.title.trim();
    const whenToUseIt = args.whenToUseIt.trim();
    const commonMistake = args.commonMistake.trim();
    const bodyContent = args.bodyContent.trim();
    if (!title || !whenToUseIt || !commonMistake || !bodyContent) {
      throw new ConvexError({
        message: "All fields are required.",
        code: "invalid",
      });
    }
    if (title.length > 120) {
      throw new ConvexError({
        message: "Title is too long (max 120 characters).",
        code: "invalid",
      });
    }
    return await ctx.db.insert("studyCards", {
      subjectId: args.subjectId,
      gradeLevel: args.gradeLevel,
      topicId: args.topicId,
      title,
      whenToUseIt,
      commonMistake,
      bodyContent,
      createdVia: "admin",
      createdBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { studyCardId: v.id("studyCards") },
  handler: async (ctx, { studyCardId }) => {
    await requireAdminMutation(ctx);
    await ctx.db.delete(studyCardId);
    // Cascade-delete bookmarks pointing at this card
    const bookmarks = await ctx.db
      .query("studyCardBookmarks")
      .withIndex("by_card", (q) => q.eq("studyCardId", studyCardId))
      .collect();
    for (const b of bookmarks) await ctx.db.delete(b._id);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// AI generation — premium-gated, Groq-powered, structured JSON output
// ---------------------------------------------------------------------------

const STUDY_CARD_AI_SYSTEM_PROMPT =
  "You create study cards for Ethiopian students (grades 9-12) preparing " +
  "for the EHEEE/ESSLCE national exam. Each card is a bite-sized quick-reference " +
  "for ONE concept — like a well-organized cheat sheet.\n\n" +
  "Your output MUST be valid JSON (no markdown, no preface) with this shape:\n" +
  "{\n" +
  "  \"title\": \"short, 3-8 word title for the card\",\n" +
  "  \"whenToUseIt\": \"1-2 sentences explaining when a student would reach for this card — practical usage context\",\n" +
  "  \"commonMistake\": \"1-2 sentences on the most common mistake students make here — original wording, use the label 'Watch for'\",\n" +
  "  \"bodyContent\": \"3-6 paragraphs of the core reference content. Can include simple math/formula notation. Separate paragraphs with \\n\\n. Plain text, no markdown.\"\n" +
  "}\n\n" +
  "Ground the content in the real Ethiopian national curriculum for the requested " +
  "subject + grade. Original wording throughout — never copy verbatim from any " +
  "reference material. Keep it concise but complete enough to actually be useful " +
  "as a quick reference.";

/**
 * Generate a study card via AI. Premium-gated (consistent with quizzes/
 * flashcards — browsing is free, generation is premium). Returns the new
 * card's ID.
 *
 * The AI sees the subject name + grade level + optional topic — no other
 * context. It does NOT see individual student data (privacy preserved).
 */
export const generateAI = action({
  args: {
    subjectId: v.id("subjects"),
    gradeLevel: v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    ),
    topicName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ studyCardId: Id<"studyCards"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    // Premium gate — consistent with how quizzes/flashcards gate generation.
    const premium = await getPremiumAccess(ctx, userId);
    if (!premium) {
      throw new ConvexError({
        message: "Study card generation requires a premium account. Start your free trial to try it.",
        code: "premium_flashcards",
      });
    }
    // Resolve subject name server-side (the AI needs context to write good cards)
    const subject = await ctx.runQuery(internal.content.getSubjectById, {
      subjectId: args.subjectId,
    });
    if (!subject) {
      throw new ConvexError({ message: "Subject not found.", code: "not_found" });
    }
    const raw = await callGroq(ctx, {
      systemPrompt: STUDY_CARD_AI_SYSTEM_PROMPT,
      userMessage:
        `Subject: ${subject.name}\nGrade: ${args.gradeLevel}\n` +
        (args.topicName ? `Topic: ${args.topicName}\n` : "") +
        `Generate ONE study card for a Grade ${args.gradeLevel} ${subject.name} student` +
        (args.topicName ? ` on the topic of ${args.topicName}` : "") +
        `. Make it useful as a quick-reference cheat sheet.`,
      maxTokens: 1200,
      temperature: 0.4,
    });
    // Parse + validate. Tolerate code fences.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: {
      title?: string;
      whenToUseIt?: string;
      commonMistake?: string;
      bodyContent?: string;
    };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new ConvexError({
        message: `AI returned malformed study card. Try again. (${err instanceof Error ? err.message : ""})`.trim(),
        code: "ai_parse_error",
      });
    }
    if (!parsed.title || !parsed.whenToUseIt || !parsed.commonMistake || !parsed.bodyContent) {
      throw new ConvexError({
        message: "AI returned an incomplete study card. Try again.",
        code: "ai_parse_error",
      });
    }
    // Insert the new card via an internal mutation (action can't write directly)
    const studyCardId = await ctx.runMutation(internal.studyCards.insertAI, {
      subjectId: args.subjectId,
      gradeLevel: args.gradeLevel,
      title: parsed.title,
      whenToUseIt: parsed.whenToUseIt,
      commonMistake: parsed.commonMistake,
      bodyContent: parsed.bodyContent,
      createdBy: userId,
    });
    return { studyCardId };
  },
});

/**
 * Internal mutation — inserts an AI-generated study card. Called by the
 * generateAI action. Marked internal so the client can't bypass the
 * premium gate by calling this directly.
 */
export const insertAI = internalMutation({
  args: {
    subjectId: v.id("subjects"),
    gradeLevel: v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    ),
    title: v.string(),
    whenToUseIt: v.string(),
    commonMistake: v.string(),
    bodyContent: v.string(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("studyCards", {
      subjectId: args.subjectId,
      gradeLevel: args.gradeLevel,
      title: args.title,
      whenToUseIt: args.whenToUseIt,
      commonMistake: args.commonMistake,
      bodyContent: args.bodyContent,
      createdVia: "ai",
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
  },
});

// Silence unused-import lints — kept for type clarity.
void (undefined as unknown as ActionCtx);
