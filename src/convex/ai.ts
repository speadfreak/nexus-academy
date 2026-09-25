// AI tutor — powered by Groq (fast, free LLM API).
//
// Called from a Convex action because actions are the only Convex function
// type that can make external HTTP calls. The API key is read from
// process.env (set it in the Keys / API keys tab, never hardcode it):
//   GROQ_API_KEY     your Groq API key (https://console.groq.com/keys)
//   AI_MODEL        optional — defaults to openai/gpt-oss-120b

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getPremiumAccess } from "./subscriptions";
import { FREE_TUTOR_DAILY_LIMIT } from "./constants";
import { logEventAction } from "./systemEvents";
import { callGroq, getModelName, resolveVisionModel } from "./groq";

// ---------------------------------------------------------------------------
// Tutor modes — the student picks an explicit learning mode before/while
// chatting. The mode injects a focused behavior block into the system prompt
// so "Explain photosynthesis" teaches, drills, quizzes or coaches depending
// on what the student actually wants right now.
// ---------------------------------------------------------------------------

export const TUTOR_MODES = [
  "learn",
  "practice",
  "exam",
  "revision",
  "solve",
  "quiz",
] as const;

export const tutorModeValidator = v.union(
  ...TUTOR_MODES.map((m) => v.literal(m)),
);

export type TutorMode = (typeof TUTOR_MODES)[number];

const TUTOR_MODE_PROMPTS: Record<TutorMode, string> = {
  learn:
    "TUTOR MODE: LEARN — the student wants to deeply understand a concept. " +
    "Teach it step by step: start from what they already know, define every new " +
    "term the moment it appears, build the idea in clear ordered steps, then " +
    "walk through one worked example. End with ONE quick check question so the " +
    "student can confirm the idea stuck — then wait for their answer.",
  practice:
    "TUTOR MODE: PRACTICE — the student wants to practice, not listen. Ask ONE " +
    "exam-style question at a time at their grade's national-exam difficulty, " +
    "then STOP and wait for their answer. Never answer your own question. When " +
    "they answer: grade it honestly, show the correct working briefly, then " +
    "offer the next question. Adapt the next question to what they got wrong.",
  exam:
    "TUTOR MODE: EXAM — strict Ethiopian national exam (EHEEE/ESLCE) simulation. " +
    "Serve multiple-choice questions in exact national-exam style with A-D " +
    "options. No hints, no encouragement, no teaching mid-question — act like a " +
    "strict examiner. Only after the student commits an answer, mark it strictly " +
    "and show the model answer with brief working. If they ask for hints, refuse " +
    "politely: a real exam doesn't give hints. Keep a running score.",
  revision:
    "TUTOR MODE: QUICK REVISION — the student is revising and needs speed. Answer " +
    "in ultra-short form: key facts, formulas, definitions and the traps exams " +
    "set. Maximum ~120 words, bullets over paragraphs, no headers, no long " +
    "explanations. Bold the must-remember terms. End with a one-line memory hook " +
    "when one exists.",
  solve:
    "TUTOR MODE: SOLVE WITH ME — the student brings a problem and wants guided " +
    "reasoning, not a handed-over answer. Never reveal the final answer straight " +
    "away. Break the problem into steps, demonstrate the reasoning for the first " +
    "step, then ask the student to attempt the next step before continuing. Coach " +
    "like a patient teacher: hint, check, correct, continue. Reveal the full " +
    "solution at the end — or sooner if they've made two genuine attempts and are " +
    "still stuck.",
  quiz:
    "TUTOR MODE: QUIZ ME — adaptive quiz engine. Ask one question at a time and " +
    "wait for the answer. Track which sub-topics they miss: successful answers " +
    "unlock harder questions, missed ones drop back and get retested from a " +
    "different angle. After 5 questions, stop and give a score summary: X/5, " +
    "which sub-topics were weak, and one specific thing to review next.",
};

const HISTORY_LIMIT = 15;

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
    images: v.optional(v.array(v.string())),
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
  opts?: {
    mode?: TutorMode;
    grade?: number;
    concise?: boolean;
    hasImages?: boolean;
  },
): Promise<string> {
  const lines = [
    "You are the Learnyx Academy ET 🇪🇹 AI tutor for Ethiopian students in grades 9–12 " +
      "preparing for the national matric examinations (ESLCE). You're a sharp, " +
      "genuinely engaged tutor who's invested in the student doing well — " +
      "not a textbook, not a customer service bot.",
    "",
    "Voice and tone:",
    "- Write like a real person who's good at teaching. Direct, warm, a little energetic.",
    "- A well-placed \"here's the thing\" or \"okay so\" is fine when natural — " +
      "never forced slang, never fake hype, never emoji spam.",
    "- When a student is wrong, say so honestly but kindly, then show the right path.",
    "- When it's genuinely a good question, a quick \"nice question\" before " +
      "answering is fine — don't overdo it.",
    "",
    "Response shape — let the question decide:",
    "- A quick definition or factual question gets a quick, direct answer. Don't pad it.",
    "- A \"walk me through this\" or problem-solving question should actually walk " +
      "through it step by step, in order, with working shown.",
    "- A \"explain this deeply\" or conceptual question can go longer and more " +
      "structured — but only because the question asked for it, not by default.",
    "- NEVER use a fixed section template (statement → example → why it matters " +
      "→ resource → cross-subject link). Every response should feel shaped by " +
      "what was actually asked.",
    "",
    "Examples and grounding:",
    "- Ground abstract concepts in real, locally relevant situations (Ethiopian " +
      "context, markets, daily life) — but weave these naturally INTO your " +
      "explanation, not as a separate labeled \"Everyday example\" section.",
    "- For math and science, always show working step by step.",
    "",
    "Length and depth:",
    "- Be concise by default. Give the most useful direct answer first.",
    "- If there's more depth available, offer it briefly (one line) at the end — " +
      "don't front-load everything you could possibly say.",
    "",
    "Library resources:",
    "- The student has textbooks, past papers, worksheets and guides in the " +
      "Learnyx Academy ET 🇪🇹 library. Mention a specific resource ONLY when it's a " +
      "genuinely natural next step (e.g. they want practice problems, or ask " +
      "where to read more). Never as a default closing paragraph.",
    "",
    "Cross-subject connections:",
    "- Only draw them when they're real and relevant. If a Social Science student " +
      "asks a Physics question, just answer it well — don't add a paragraph " +
      "explaining why it's okay to ask about Physics.",
    "",
    "Accuracy and scope:",
    "- Never invent facts, figures, dates or exam statistics. If unsure, say so.",
    "- If a question is out of scope, say so briefly and offer the closest relevant help.",
    "",
    "Formatting:",
    "- Use markdown (headers, bullets, numbered steps) only when it genuinely " +
      "helps clarity — multi-part explanations, problem walkthroughs, etc. " +
      "A short answer doesn't need headers or horizontal rules.",
    "",
    `Today's date is ${new Date().toISOString().slice(0, 10)}.`,
    "",
  ];

  // ── Active tutor mode ────────────────────────────────────────────────
  // The mode block is injected RIGHT after the base voice rules so it
  // frames every reply in this turn. Default is "learn" (general teaching).
  const mode: TutorMode = opts?.mode ?? "learn";
  lines.push(TUTOR_MODE_PROMPTS[mode], "");

  // ── Academic memory — grade + conciseness preference ───────────────
  // Grade grounds difficulty (a Grade 9 photosynthesis answer differs a
  // lot from a Grade 12 one). Concise is a persisted student preference.
  if (opts?.grade) {
    lines.push(
      `The student is in Grade ${opts.grade}. Pitch explanations, vocabulary ` +
        `and question difficulty at the Ethiopian Grade ${opts.grade} syllabus level.`,
      "",
    );
  }
  if (opts?.concise) {
    lines.push(
      "This student prefers CONCISE answers: lead with the point, strip " +
        "preamble, keep worked examples but compress prose around them.",
      "",
    );
  }
  if (opts?.hasImages) {
    lines.push(
      "The student attached one or more images (a textbook page, handwritten " +
        "work, a past-paper question, a diagram or a screenshot). Read the image " +
        "carefully: if it contains a question, solve it showing every step; if " +
        "it contains notes or a diagram, explain what it shows. If the image is " +
        "unclear or cut off, say exactly what you can and cannot read.",
      "",
    );
  }

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

  // ── Latest mock exam performance ─────────────────────────────────────
  // Grounds the tutor's advice in the student's most recent simulated
  // EHEEE sitting. Lets the tutor proactively suggest reviewing weak
  // subjects, taking another mock exam, or revisiting topics that
  // dragged down their score. Skipped cleanly if they've never taken one.
  try {
    const latestMock = await ctx.runQuery(
      internal.mockExam.getLatestMockExamSummary,
      { userId },
    );
    if (latestMock) {
      const daysAgo = Math.floor(
        (Date.now() - latestMock.latestCompletedAt) / (24 * 60 * 60 * 1000),
      );
      const whenLabel =
        daysAgo <= 0
          ? "today"
          : daysAgo === 1
            ? "yesterday"
            : `${daysAgo} days ago`;
      lines.push(
        `The student completed their most recent full mock exam ${whenLabel} (${latestMock.totalAttempts} attempt${latestMock.totalAttempts === 1 ? "" : "s"} total).`,
        `Overall score: ${latestMock.latestScore}%. Weakest subject: ${latestMock.weakestSubjectName} at ${latestMock.weakestSubjectScore}%.`,
        `When the student asks for what to study or how to prepare, prioritise ${latestMock.weakestSubjectName} — it's the biggest gap in their readiness.`,
        `You can also suggest they take another mock exam at /mock-exam to track progress, especially if some time has passed since the last attempt.`,
        "",
      );
    } else {
      // Never taken one — nudge gently when the student asks about exam
      // readiness or practice, but don't push on every turn.
      lines.push(
        "The student has not yet taken a mock exam on the platform. If they ask about exam readiness, past papers, or full-length practice, suggest they try a mock exam at /mock-exam — it generates ~340 original AI questions across all 6 EHEEE subjects and grades them per section.",
        "",
      );
    }
  } catch {
    // Non-fatal: if the query fails for any reason, skip the mock-exam
    // context block. The tutor still works without it.
  }

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
        lines.push("Known syllabus topics in the Learnyx Academy ET 🇪🇹 library:");
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
    mode: v.optional(tutorModeValidator),
    grade: v.optional(v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    )),
    // Downscaled image attachments (data URLs) — routed to a vision model.
    // Max 2 per message, each capped ~450 KB of base64 (≈ 330 KB binary).
    images: v.optional(v.array(v.string())),
    // Persisted student preference (academic memory, client-side stored).
    concise: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ reply: string; conversationId: Id<"conversations"> }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required to use the tutor.", code: "unauthorized" });
    }

    const content = args.content.trim();
    if (!content && !(args.images && args.images.length > 0)) {
      throw new ConvexError({ message: "Message cannot be empty.", code: "invalid" });
    }
    if (content.length > 4000) {
      throw new ConvexError({ message: "Message is too long (max 4,000 characters).", code: "invalid" });
    }

    // --- Image attachment validation -------------------------------------
    const images = (args.images ?? []).filter((img) => typeof img === "string");
    if (images.length > 2) {
      throw new ConvexError({ message: "Attach at most 2 images per message.", code: "invalid" });
    }
    for (const img of images) {
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(img)) {
        throw new ConvexError({
          message: "Images must be JPEG, PNG or WebP.",
          code: "invalid",
        });
      }
      if (img.length > 450_000) {
        throw new ConvexError({
          message: "An attached image is too large — try a smaller crop or screenshot.",
          code: "invalid",
        });
      }
    }
    const effectiveContent = content || "Solve this and explain every step.";

    // --- Free-tier daily cap ---------------------------------------------
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
        const contentItem = await ctx.runQuery(internal.content.getContentItemById, {
          contentId: args.contentId,
        });
        if (!contentItem) {
          throw new ConvexError({ message: "Content item not found.", code: "invalid" });
        }
        subjectId = subjectId ?? contentItem.subjectId;
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
      content: effectiveContent,
      images: images.length > 0 ? images : undefined,
      createdAt: now,
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId,
      updatedAt: now,
    });

    // --- Pull bounded history for context -------------------------------
    const historyRows: Doc<"messages">[] = await ctx.runQuery(
      internal.ai.getMessagesByConversation,
      { conversationId },
    );
    const history = historyRows
      .slice(-HISTORY_LIMIT)
      .map((message) => ({
        role: message.role as "user" | "assistant",
        // Image turns replay as text markers so history tokens stay bounded.
        content: message.images?.length
          ? `${message.content}\n[image attached]`
          : message.content,
      }));

    // --- Call AI model ---------------------------------------------------
    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId,
    });
    const systemPrompt = await buildSystemPrompt(
      ctx,
      userId,
      conversation?.subjectId,
      conversation?.contentId,
      {
        mode: args.mode,
        grade: args.grade,
        concise: args.concise,
        hasImages: images.length > 0,
      },
    );

    let reply: string;
    const aiStart = Date.now();
    // Image turns need a vision-capable model (gpt-oss-120b is text-only).
    // resolveVisionModel picks a LIVE image-capable model from Groq's
    // catalog (self-healing when Groq rotates/deprecates models) and
    // callGroq retries once with a fresh model if it 404s mid-flight.
    const visionModel = images.length > 0 ? await resolveVisionModel(ctx) : undefined;
    try {
      reply = await callGroq(ctx, {
        systemPrompt,
        userMessage: effectiveContent,
        history,
        maxTokens: 1024,
        temperature: 0.5,
        model: visionModel,
      });
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "ai.sendMessage.groq",
        status: "success",
        userId,
        metadata: {
          model: visionModel ?? getModelName(),
          conversationId,
          hasImages: images.length > 0,
          mode: args.mode ?? "learn",
        },
        durationMs: Date.now() - aiStart,
      });
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "ai.sendMessage.groq",
        status: "error",
        userId,
        metadata: { message: error instanceof Error ? error.message : "unknown" },
        durationMs: Date.now() - aiStart,
      });
      throw asAiError(error, "The AI tutor could not reach Groq. Try again.");
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
          ? `${subject.name}: ${truncate(effectiveContent, 44)}`
          : truncate(effectiveContent, 52);
      } else {
        title = truncate(effectiveContent, 52);
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
// Generate follow-up suggestions + optional inline mini-check after a
// tutor response. This is a lightweight second call (256 tokens, temp 0.6)
// that generates 2-3 suggested next questions + an optional 1-question
// mini-check. The student sees these as clickable chips + a "Test yourself"
// button in the chat UI.
// ---------------------------------------------------------------------------

export const generateFollowUps = action({
  args: {
    conversationId: v.id("conversations"),
    subjectId: v.optional(v.id("subjects")),
  },
  handler: async (ctx, args): Promise<{
    followUps: string[];
    miniCheck: { question: string; options: string[]; correctIndex: number; explanation: string } | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { followUps: [], miniCheck: null };

    // Get the last assistant message in the conversation.
    const messages = await ctx.runQuery(internal.ai.getMessagesByConversation, {
      conversationId: args.conversationId,
    });
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return { followUps: [], miniCheck: null };

    // Get subject for grounding.
    let subjectName = "the subject";
    if (args.subjectId) {
      const subject = await ctx.runQuery(internal.ai.getSubjectById, { subjectId: args.subjectId });
      if (subject) subjectName = subject.name;
    }

    const systemPrompt =
      "You are a study companion generating follow-up questions and an optional " +
      "quick check for a student who just received an explanation. Generate exactly " +
      "2 short follow-up questions the student might ask next (max 12 words each), " +
      "and 1 multiple-choice mini-check question testing the concept just explained. " +
      "The mini-check must have 4 options, 1 correct answer, and a 1-sentence explanation. " +
      "Respond ONLY with valid JSON in this shape: " +
      '{"followUps": ["q1", "q2"], "miniCheck": {"question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..."}}. ' +
      "If the topic doesn't lend itself to a quick check, set miniCheck to null.";

    const userMessage = `The student just received this explanation about ${subjectName}:\n\n${lastAssistant.content.slice(0, 1500)}\n\nGenerate 2 follow-up questions and an optional mini-check.`;

    try {
      const raw = await callGroq(ctx, {
        systemPrompt,
        userMessage,
        maxTokens: 512,
        temperature: 0.6,
      });
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleaned) as {
        followUps?: string[];
        miniCheck?: { question: string; options: string[]; correctIndex: number; explanation: string } | null;
      };
      return {
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps.slice(0, 3) : [],
        miniCheck: parsed.miniCheck && Array.isArray(parsed.miniCheck.options) && parsed.miniCheck.options.length === 4
          ? parsed.miniCheck
          : null,
      };
    } catch {
      return { followUps: [], miniCheck: null };
    }
  },
});

// ---------------------------------------------------------------------------
// Make notes — compress the latest tutor answer into a saved study note.
// One answer becomes part of the student's permanent notes library, closing
// the Learn → Save loop without any copy-pasting.
// ---------------------------------------------------------------------------

export const saveNotesFromConversation = action({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<{ noteId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId,
    });
    if (!conversation || conversation.userId !== userId) {
      throw new ConvexError({ message: "Conversation not found.", code: "not_found" });
    }
    if (!conversation.subjectId) {
      throw new ConvexError({
        message: "Scope this chat to a subject first — notes are filed per subject.",
        code: "invalid",
      });
    }
    const messages = await ctx.runQuery(internal.ai.getMessagesByConversation, {
      conversationId,
    });
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) {
      throw new ConvexError({ message: "Nothing to save yet — ask a question first.", code: "not_found" });
    }

    const raw = await callGroq(ctx, {
      systemPrompt:
        "You compress a tutor explanation into concise study notes for an Ethiopian " +
        "student preparing for national exams. Output ONLY the note content: markdown " +
        "bullets, key definitions, formulas and one worked example if present. Max " +
        "200 words. No preamble, no closing remarks.",
      userMessage:
        `Compress this explanation into study notes:\n\n${lastAssistant.content.slice(0, 4000)}`,
      maxTokens: 600,
      temperature: 0.3,
    });

    // notes.create enforces the 2,000-char cap and subject existence.
    const noteId = await ctx.runMutation(api.notes.create, {
      subjectId: conversation.subjectId,
      content: raw.trim().slice(0, 2000),
      color: "amber",
    });
    return { noteId };
  },
});

// ---------------------------------------------------------------------------
// Add highlighted text support to the Reader AI companion
// ---------------------------------------------------------------------------

export const askWithHighlight = action({
  args: {
    contentId: v.id("contentItems"),
    question: v.string(),
    highlightedText: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ reply: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }

    // Reuse the readerAI flow but inject the highlighted text.
    const result = await ctx.runAction(internal.readerAI.askReaderQuestionWithHighlight, {
      contentId: args.contentId,
      question: args.question,
      highlightedText: args.highlightedText,
    });
    return { reply: result.reply };
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
        let contentItem = contentCache.get(conversation.contentId);
        if (!contentItem) {
          contentItem = (await ctx.db.get(conversation.contentId)) ?? undefined;
          if (contentItem) contentCache.set(conversation.contentId, contentItem);
        }
        contentTitle = contentItem?.title ?? null;
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
