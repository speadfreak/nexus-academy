// AI tutor — the conversation orchestration layer.
//
// Provider calls go through aiRouter.ts: a capacity-aware multi-provider
// router (Groq, Gemini, Cerebras, OpenRouter — all free tiers) that skips
// exhausted models BEFORE calling them, falls through on 429/5xx/timeout,
// queues the turn in Convex when everything is busy, and answers cached
// questions instantly. See the "AI Tutor reliability layer" section in
// README.md for the provider keys this needs.
//
// TOKEN DIET (why prompts here look lean): Groq's free tier allows only
// 8,000 tokens-per-minute per model, so every character in a turn is
// budgeted: 6-message history + a rolling Convex-stored summary of older
// turns, a compact system prompt, relevance-scored file chunks instead of
// whole documents, 2,048-token completions that the router auto-continues
// and stitches when they hit the cap, and reasoning_effort "low" for
// reasoning models — all enforced against a hard per-request input budget.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { getPremiumAccess } from "./subscriptions";
import { FREE_TUTOR_DAILY_LIMIT } from "./constants";
import { logEventAction } from "./systemEvents";
import {
  routeChat,
  estimateTokens,
  HARD_INPUT_BUDGET_TOKENS,
} from "./aiRouter";
import { RateLimiter, HOUR } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
// Pure text pipeline (no browser/Node APIs) — shared with the renderer so the
// stored message is balanced BEFORE the length-limit marker is appended.
// Without this, a reply cut mid-$$ stores the marker INSIDE an unterminated
// math region and remark-math typesets the marker as math.
import { balanceTrailingMath } from "../components/math/mathText";

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

// Compressed one-liners — full behavior in two sentences, not paragraphs.
// Every token here rides on every request (see the token diet note above).
const TUTOR_MODE_PROMPTS: Record<TutorMode, string> = {
  learn:
    "TUTOR MODE: LEARN — teach step by step from what they know; define every " +
    "new term; one worked example; end with ONE quick check question, then wait.",
  practice:
    "TUTOR MODE: PRACTICE — ask ONE exam-style question at their grade's " +
    "difficulty and wait. Grade their answer honestly, show correct working " +
    "briefly, adapt the next question to what they missed. Never answer your own question.",
  exam:
    "TUTOR MODE: EXAM — strict Ethiopian national-exam simulation. Serve " +
    "multiple-choice A-D questions with no hints; after they answer, mark " +
    "strictly, show the model answer and keep a running score.",
  revision:
    "TUTOR MODE: QUICK REVISION — ultra-short: key facts, formulas, definitions " +
    "and exam traps. Max ~120 words, bullets, bold the must-remember terms, one-line memory hook.",
  solve:
    "TUTOR MODE: SOLVE WITH ME — guided reasoning, never the answer first. Break " +
    "it into steps, demonstrate the first, have them attempt the next. Reveal the " +
    "full solution at the end or after two genuine stuck attempts.",
  quiz:
    "TUTOR MODE: QUIZ ME — one adaptive question at a time; harder when right, " +
    "retested from a new angle when wrong. After 5: score X/5, weak sub-topics, one review next-step.",
};

// ---------------------------------------------------------------------------
// Token-diet budgets. The client extraction lib (lib/tutorFiles.ts) and the
// server agree on storage caps; the TURN injection caps here are what keep a
// request inside the router's hard input budget (HARD_INPUT_BUDGET_TOKENS).
// ---------------------------------------------------------------------------

/** History window sent to the model (was 15 — now 6 + rolling summary). */
const HISTORY_LIMIT = 6;
/** Start rolling summaries once a thread exceeds this many messages. */
const SUMMARY_TRIGGER_COUNT = 10;
/** Summarize only when at least this many NEW turns fell out of the window. */
const SUMMARY_MIN_NEW_TURNS = 4;
/** Hard cap on the stored rolling summary. */
const MAX_SUMMARY_CHARS = 1_100;
/** Budget (estimated tokens) for each attached file's relevant chunk. */
const FILE_CHUNK_TOKEN_BUDGET = 1_800;
/** Re-grounding head on later turns (was 8,000 chars). */
const MAX_FOLLOWUP_FILE_CHARS = 4_000;
/**
 * Max completion tokens per model call for tutor replies (was 720 — the #1
 * cause of "The reply reached its length limit mid-answer"). Replies that
 * fill this are auto-continued and stitched by the router, so a single
 * answer can reach ~3x this before the fallback marker ever appears.
 */
export const MAX_COMPLETION_TOKENS = 2048;
/** Per-message cap in the trimmed history window (chars). */
const HISTORY_MESSAGE_CHAR_CAP = 500;
/** Token reserve for chat-template overhead + safety margin. */
const TOKEN_OVERHEAD_RESERVE = 350;

// Storage caps for file memory (unchanged from the file-intelligence build).
const MAX_FILES_PER_MESSAGE = 2;
const MAX_FILE_TEXT_CHARS = 60_000; // per file, stored in tutor file memory
const MAX_MEMORY_EXCERPT_CHARS = 400;

interface TutorFileInput {
  name: string;
  mime: string;
  size: number;
  chars: number;
  pages?: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Fairness + abuse protection
// ---------------------------------------------------------------------------
// Per-user hourly caps via the @convex-dev/rate-limiter component so a few
// heavy users can't drain the shared free-tier quota (20/h free tier, 45/h
// premium), plus a one-in-flight-request guard (aiUserBudget) so a client
// firing concurrent sends can't multiply its share.

const tutorLimiter = new RateLimiter(components.rateLimiter, {
  tutorHourlyFree: { kind: "fixed window", rate: 20, period: HOUR },
  tutorHourlyPremium: { kind: "fixed window", rate: 45, period: HOUR },
});

/** One in-flight tutor request per user; stale markers self-heal after 90s. */
export const markTutorInflight = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const row = await ctx.db
      .query("aiUserBudget")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (row?.inflightSince && now - row.inflightSince < 90_000) {
      return false;
    }
    if (row) {
      await ctx.db.patch(row._id, {
        inflightSince: now,
        inflightKind: "tutor",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("aiUserBudget", {
        userId,
        inflightSince: now,
        inflightKind: "tutor",
        updatedAt: now,
      });
    }
    return true;
  },
});

export const clearTutorInflight = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const row = await ctx.db
      .query("aiUserBudget")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (row) {
      await ctx.db.patch(row._id, {
        inflightSince: undefined,
        inflightKind: undefined,
        updatedAt: Date.now(),
      });
    }
  },
});

// ---------------------------------------------------------------------------
// Errors — asAiError is the LAST LINE of defense between internals and the
// UI. Only human-written messages with known-safe codes reach a student;
// anything else (provider strings, stack traces, infra noise) collapses to
// the friendly fallback. The router itself never throws — exhausted capacity
// degrades to queue + graceful mode — so reaching here at all is exceptional.
// ---------------------------------------------------------------------------

type AiErrorData = { message: string; code: string };

const USER_SAFE_ERROR_CODES = new Set([
  "unauthorized",
  "invalid",
  "not_found",
  "daily_limit_reached",
  "hourly_limit_reached",
  "busy",
  "ai_not_configured",
  "tutor_busy",
]);

function asAiError(error: unknown, fallback: string): ConvexError<AiErrorData> {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string } | undefined;
    if (data && typeof data.code === "string" && USER_SAFE_ERROR_CODES.has(data.code)) {
      return error;
    }
  }
  return new ConvexError({ message: fallback, code: "ai_error" });
}

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Answer cache — identical/near-identical questions in the same lesson
// context are served instantly without touching any provider.
// ---------------------------------------------------------------------------

const ANSWER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Modes where the SAME question must give a FRESH answer — never cached. */
const NON_CACHEABLE_MODES = new Set<TutorMode>(["practice", "exam", "quiz"]);

/** FNV-1a (two lanes) — deterministic, dependency-free, non-cryptographic. */
function fnv1a64(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 ^ ((c + i) & 0xff)) >>> 0;
    h2 = Math.imul(h2, 2246822519) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

/** Normalize for near-identical matching: case/punctuation/whitespace-free. */
function normalizeForCache(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cacheKey(parts: {
  question: string;
  mode: TutorMode;
  grade?: number;
  subjectId?: Id<"subjects">;
  contentId?: Id<"contentItems">;
  contextHash: string;
}): string {
  return fnv1a64(
    `${normalizeForCache(parts.question)}|${parts.mode}|${parts.grade ?? ""}|` +
      `${parts.subjectId ?? ""}|${parts.contentId ?? ""}|${parts.contextHash}`,
  );
}

export const lookupAnswerCache = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const row = await ctx.db
      .query("aiAnswerCache")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .first();
    if (!row || row.expiresAt <= Date.now()) return null;
    // Read-only by design — hit-rate analytics come from aiCallLog rows.
    return row.answer;
  },
});

export const storeAnswerCache = internalMutation({
  args: {
    hash: v.string(),
    answer: v.string(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { hash, answer, provider, model }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("aiAnswerCache")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        answer,
        provider,
        model,
        createdAt: now,
        expiresAt: now + ANSWER_CACHE_TTL_MS,
      });
      return;
    }
    await ctx.db.insert("aiAnswerCache", {
      hash,
      answer,
      provider,
      model,
      hits: 0,
      createdAt: now,
      expiresAt: now + ANSWER_CACHE_TTL_MS,
    });
  },
});

// ---------------------------------------------------------------------------
// Relevant-chunk selection — "send only the relevant chunk of the lesson,
// never the whole thing". Scores file paragraphs against the question and
// keeps the best-scoring ones within a token budget, in document order.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was",
  "one", "our", "out", "day", "get", "has", "him", "his", "how", "man", "new",
  "now", "old", "see", "two", "way", "who", "did", "its", "let", "she", "too",
  "use", "that", "with", "this", "what", "when", "where", "which", "will",
  "from", "they", "have", "explain", "please", "about", "into", "than", "then",
]);

function questionKeywords(question: string): Set<string> {
  const words = normalizeForCache(question)
    .split(" ")
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

function chunkParagraphs(text: string): string[] {
  const byBlank = text.split(/\n{2,}/);
  if (byBlank.length >= 3) return byBlank;
  const byLine = text.split(/\n/);
  if (byLine.length >= 3) return byLine;
  // One giant blob — fixed windows so scoring has something to rank.
  const windows: string[] = [];
  for (let i = 0; i < text.length; i += 800) {
    windows.push(text.slice(i, i + 900));
  }
  return windows;
}

/**
 * Pick the most question-relevant chunk of a document within maxTokens
 * (estimated). Always keeps the document's opening paragraph for orientation
 * and the highest-scoring passages around the question's keywords.
 */
export function relevantFileChunk(
  question: string,
  text: string,
  maxTokens: number,
): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const paragraphs = chunkParagraphs(text).filter((p) => p.trim().length > 0);
  if (paragraphs.length === 0) return "";
  const keywords = questionKeywords(question);

  const scored = paragraphs.map((p, index) => {
    const words = normalizeForCache(p).split(" ");
    const unique = new Set(words);
    let hits = 0;
    for (const k of keywords) {
      if (unique.has(k)) hits += 1;
      else {
        // partial match keeps morphology variants ("ionization" ~ "ionize")
        for (const w of unique) {
          if (w.length > 4 && (w.startsWith(k.slice(0, 4)) || k.startsWith(w.slice(0, 4)))) {
            hits += 0.5;
            break;
          }
        }
      }
    }
    // Orientation bonus: the first paragraph frames the document.
    if (index === 0) hits += 1.5;
    return { p, index, score: hits };
  });

  const kept: typeof scored = [];
  let budget = maxTokens;
  // The opening paragraph first (orientation), then by score.
  const first = scored[0];
  budget -= estimateTokens(first.p);
  kept.push(first);
  const rest = scored
    .slice(1)
    .sort((a, b) => b.score - a.score)
    .filter((s) => s.score > 0);
  for (const s of rest) {
    const cost = estimateTokens(s.p);
    if (cost > budget) continue;
    budget -= cost;
    kept.push(s);
    if (budget <= 0) break;
  }
  kept.sort((a, b) => a.index - b.index);
  return kept
    .map((s, i) =>
      i > 0 && kept[i - 1].index !== s.index - 1 ? `[…]\n${s.p}` : s.p,
    )
    .join("\n\n");
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
    // Newest-first walk with an early stop: a conversation's updatedAt
    // always reflects its latest message, so the first conversation older
    // than the window marks the end of relevant data. Keeps the cap check
    // to a couple of indexed reads instead of a 50×200 crawl.
    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    let count = 0;
    for (const conversation of conversations) {
      if (conversation.updatedAt < since) break;
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (q) =>
          q.eq("conversationId", conversation._id),
        )
        .order("desc")
        .take(200);
      for (const message of messages) {
        if (message.createdAt < since) break;
        if (message.role === "user") {
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

// ---------------------------------------------------------------------------
// Tutor file memory — what the student has uploaded, remembered across
// conversations so the tutor always knows what they're studying.
// ---------------------------------------------------------------------------

/** Recent uploads (metadata + short excerpt) for the system prompt. */
export const getRecentTutorFiles = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    const take = Math.min(Math.max(limit ?? 6, 1), 10);
    return await ctx.db
      .query("tutorFileMemory")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(take);
  },
});

/** Full stored text for one named file (re-grounding on follow-up turns). */
export const getTutorFileTextByName = internalQuery({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, { userId, name }) => {
    const rows = await ctx.db
      .query("tutorFileMemory")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return rows.find((row) => row.name === name) ?? null;
  },
});

/**
 * Upsert one uploaded file into memory. Deduped on (userId, name, size):
 * re-uploading the same document refreshes it instead of duplicating rows.
 */
export const upsertTutorFileMemory = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    mime: v.string(),
    size: v.number(),
    chars: v.number(),
    pages: v.optional(v.number()),
    excerpt: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("tutorFileMemory")
      .withIndex("by_user_updatedAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
    const existing = rows.find(
      (row) => row.name === args.name && row.size === args.size,
    );
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        mime: args.mime,
        chars: args.chars,
        pages: args.pages,
        excerpt: args.excerpt,
        text: args.text,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("tutorFileMemory", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
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
    files: v.optional(
      v.array(
        v.object({
          name: v.string(),
          mime: v.string(),
          size: v.number(),
          chars: v.number(),
          pages: v.optional(v.number()),
        }),
      ),
    ),
    // Graceful-mode marker — see messages.degraded in schema.ts.
    degraded: v.optional(v.boolean()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => await ctx.db.insert("messages", args),
});

export const patchConversation = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    title: v.optional(v.string()),
    // Rolling summary of older turns + how many messages it covers.
    summary: v.optional(v.string()),
    summarizedUpTo: v.optional(v.number()),
    updatedAt: v.number(),
  },
  handler: async (ctx, { conversationId, title, summary, summarizedUpTo, updatedAt }) => {
    await ctx.db.patch(conversationId, {
      ...(title !== undefined ? { title } : {}),
      ...(summary !== undefined ? { summary } : {}),
      ...(summarizedUpTo !== undefined ? { summarizedUpTo } : {}),
      updatedAt,
    });
    return { ok: true };
  },
});


// ---------------------------------------------------------------------------
// System prompt — compact dieted builder. The base prompt is ~450 estimated
// tokens (the old one was ~2,300); every dynamic block earns its place.
// ---------------------------------------------------------------------------

interface PromptOpts {
  mode?: TutorMode;
  grade?: number;
  concise?: boolean;
  hasImages?: boolean;
  hasFiles?: boolean;
  includeTopics?: boolean;
  /** Rolling summary of turns outside the 6-message window. */
  summary?: string | null;
  /** Head of a previously-uploaded file, re-injected on follow-up turns. */
  recentFileContext?: { name: string; textHead: string } | null;
}

const TUTOR_BASE_PROMPT = [
  "You are the Learnyx Academy AI tutor for Ethiopian students in grades 9-12 preparing for the national matric (ESLCE) exams. Warm, direct, energetic — a real tutor invested in the student doing well, not a textbook or a service bot.",
  "VOICE: write like a person who's good at teaching. When the student is wrong, say so honestly but kindly, then show the right path. No fake hype, no emoji spam.",
  "SHAPE: let the question decide. Quick question → quick direct answer, no padding. \"Walk me through\" → true step-by-step with working shown. Conceptual → longer and structured, because the question asked for it. NEVER use a fixed section template.",
  "GROUNDED: use real, locally relevant Ethiopian examples woven naturally into explanations. For math and science, always show working step by step.",
  // Math typesetting is the #1 student-visible failure mode — keep it tight.
  "MATH TYPESETTING (critical — the app renders LaTeX): ALL math is LaTeX inside delimiters — inline $x^2 + 1$, display $$…$$ with $$ on their own lines. NEVER leave \\frac, \\sqrt or \\sum outside delimiters; delimiters BALANCED in pairs; never split a formula across $$ blocks; every \\begin{…} needs its matching \\end{…} (one relation per row, rows end with \\\\). Prose/Markdown stays OUTSIDE math. Currency ($5) stays plain text.",
  "ACCURACY: verify every computation line by line before writing it; recheck signs and arithmetic. Never invent facts, figures, dates or exam statistics — if unsure, say so. Out of scope → say so briefly and offer the closest relevant help.",
  "LENGTH: concise by default; the most useful answer first. Offer deeper material in one line at the end. Markdown (headers, numbered steps, bold key terms) only when it genuinely helps.",
].join("\n");

async function buildSystemPrompt(
  ctx: ActionCtx,
  userId: Id<"users">,
  subjectId?: Id<"subjects">,
  contentId?: Id<"contentItems">,
  opts?: PromptOpts,
): Promise<string> {
  const parts: string[] = [TUTOR_BASE_PROMPT];

  // ── Active tutor mode ────────────────────────────────────────────────
  const mode: TutorMode = opts?.mode ?? "learn";
  parts.push(TUTOR_MODE_PROMPTS[mode]);

  // ── Academic memory — grade + conciseness preference ───────────────
  if (opts?.grade) {
    parts.push(
      `The student is in Grade ${opts.grade}. Pitch explanations, vocabulary and question difficulty at the Ethiopian Grade ${opts.grade} syllabus level.`,
    );
  }
  if (opts?.concise) {
    parts.push(
      "This student prefers CONCISE answers: lead with the point, strip preamble, keep worked examples but compress prose around them.",
    );
  }
  if (opts?.hasImages) {
    parts.push(
      "The student attached image(s) (a textbook page, handwritten work, a past-paper question or a diagram). Read them carefully: solve questions showing every step; explain notes/diagrams. If unclear or cut off, say exactly what you can and cannot read.",
    );
  }
  if (opts?.hasFiles) {
    parts.push(
      "FILE GROUNDING: the student's extracted document text is in this message between ATTACHED FILE markers. Answer from the REAL text — quote passages and name the file; cite [Page 3]/[Slide 2] labels the same way. NEVER invent content that isn't in the extracted text; if the answer isn't there, say so plainly and label any general knowledge as such. Math in files is often flattened (x^2, 1/2) — re-typeset it into proper $…$/$$…$$ LaTeX. If extraction looks garbled or truncated, say what you received and ask for the missing part.",
    );
  }

  // Personalization: stream + display name (light — adaptive, not a dossier).
  try {
    const profile = await ctx.runQuery(internal.profile.getProfileByUser, { userId });
    if (profile?.stream) {
      const streamLabel =
        profile.stream === "natural"
          ? "Natural Science"
          : profile.stream === "social"
            ? "Social Science"
            : "the shared common subjects";
      parts.push(
        `This student is on the ${streamLabel} track. Frame advice around that stream's exam subjects.`,
      );
    }
    if (profile?.displayName) {
      parts.push(
        `The student's name is ${profile.displayName}. Use it once or twice naturally across the conversation — never in every reply.`,
      );
    }
  } catch {
    // Profile is optional flavor — never let it break the tutor.
  }

  // ── Latest mock exam performance (one line, not a paragraph) ────────
  try {
    const latestMock = await ctx.runQuery(
      internal.mockExam.getLatestMockExamSummary,
      { userId },
    );
    if (latestMock) {
      const daysAgo = Math.floor(
        (Date.now() - latestMock.latestCompletedAt) / (24 * 60 * 60 * 1000),
      );
      parts.push(
        `Latest mock exam (${daysAgo <= 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`}): ${latestMock.latestScore}% overall, weakest ${latestMock.weakestSubjectName} ${latestMock.weakestSubjectScore}%. When asked what to study, prioritise that gap.`,
      );
    }
  } catch {
    // Non-fatal.
  }

  // ── Subject scope + difficulty pacing + capped topic list ───────────
  if (subjectId) {
    try {
      const subject = await ctx.runQuery(internal.ai.getSubjectById, { subjectId });
      if (subject) {
        parts.push(
          `Conversation scoped to ${subject.name} (${subject.stream} stream); stay within it unless the student asks to branch out.`,
        );
        const noteSignals = await ctx.runQuery(internal.notes.getDifficultyBySubject, {
          userId,
          subjectId,
        });
        if (noteSignals.difficulties.includes("hard")) {
          parts.push(
            `The student marked ${subject.name} as HARD: define terms first, smaller steps, frequent checks, extra patience.`,
          );
        } else if (noteSignals.difficulties.includes("easy")) {
          parts.push(
            `The student marked ${subject.name} as EASY: brisk pace, deeper nuance, harder variants.`,
          );
        }
        if (opts?.includeTopics !== false) {
          const topics = await ctx.runQuery(internal.ai.listTopicsBySubject, { subjectId });
          if (topics.length > 0) {
            const byGrade = new Map<number, string[]>();
            for (const topic of topics) {
              const list = byGrade.get(topic.grade) ?? [];
              list.push(topic.name);
              byGrade.set(topic.grade, list);
            }
            // Diet: 12 topics per grade, at most 2 grades (nearest the
            // student's), instead of 40×4. The list anchors answers to the
            // syllabus; it doesn't need to BE the syllabus.
            const grades = [...byGrade.keys()].sort((a, b) => {
              if (!opts?.grade) return a - b;
              return Math.abs(a - opts.grade) - Math.abs(b - opts.grade);
            });
            const chosen = grades.slice(0, 2);
            const topicLines = chosen
              .sort((a, b) => a - b)
              .map(
                (grade) =>
                  `- Grade ${grade}: ${byGrade.get(grade)!.slice(0, 12).join(", ")}`,
              );
            parts.push(
              `Known syllabus topics in the Learnyx library:\n${topicLines.join("\n")}\nUse these to anchor answers to the curriculum students actually study.`,
            );
          }
        }
      }
    } catch {
      // Subject flavor is non-critical.
    }
  }

  // ── Content document grounding ────────────────────────────────────────
  if (contentId) {
    try {
      const content = await ctx.runQuery(internal.content.getContentItemById, {
        contentId,
      });
      if (content) {
        parts.push(
          `The student is discussing the library document "${content.title}" (${content.contentType}${content.examYear ? `, year ${content.examYear}` : ""}, Grade ${content.grade}). Reference it only by that exact title/type/year/grade. NEVER invent page numbers, section numbers or exercise numbers — you cannot see its internal pages; when you go beyond its metadata, say it's a general explanation. Label tutor-created examples as such. Keep quoted notation faithful.`,
        );
      }
    } catch {
      // Non-critical.
    }
  }

  // ── Tutor file memory (excerpts only — full text only on re-grounding) ──
  try {
    const recentFiles = await ctx.runQuery(internal.ai.getRecentTutorFiles, {
      userId,
      limit: 5,
    });
    if (recentFiles.length > 0) {
      const list = recentFiles
        .map((file) => {
          const excerpt = file.excerpt.replace(/\s+/g, " ").slice(0, MAX_MEMORY_EXCERPT_CHARS);
          const pagesLabel = file.pages ? `, ${file.pages}p` : "";
          return `- "${file.name}" (${Math.round(file.chars / 1000)}k chars${pagesLabel}): ${excerpt}${file.excerpt.length > MAX_MEMORY_EXCERPT_CHARS ? "…" : ""}`;
        })
        .join("\n");
      parts.push(
        `Files the student has uploaded to the tutor (newest first):\n${list}\nTreat these as the student's active study materials; if a question targets a part an excerpt doesn't show, ask them to re-attach or paste it.`,
      );
    }
  } catch {
    // Memory listing is non-critical.
  }

  // ── Rolling summary of the conversation's older turns ────────────────
  if (opts?.summary) {
    parts.push(
      `Earlier in this conversation (beyond the recent turns shown below):\n${opts.summary}`,
    );
  }

  // ── Follow-up re-grounding head ───────────────────────────────────────
  if (opts?.recentFileContext?.textHead) {
    parts.push(
      `=== PREVIOUSLY UPLOADED FILE (head): ${opts.recentFileContext.name} ===\n${opts.recentFileContext.textHead}\n=== END (first ~4,000 characters — if the question targets a later part, ask the student to re-attach or paste it) ===`,
    );
  }

  parts.push(`Today's date is ${new Date().toISOString().slice(0, 10)}.`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Turn context — one dieted build used by sendMessage, the queue worker and
// regenerate. Enforces the hard per-request input budget by trimming, in
// order: history message length → rolling summary → file chunk budget →
// topic list.
// ---------------------------------------------------------------------------

export interface BuiltTurn {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userTurn: string;
  images: string[];
  estInputTokens: number;
  contextHash: string;
}

async function buildTurnContext(
  ctx: ActionCtx,
  userId: Id<"users">,
  conversationId: Id<"conversations">,
  opts?: {
    mode?: TutorMode;
    grade?: number;
    concise?: boolean;
    /** Fresh attachment text for THIS turn (sendMessage); the worker re-grounds from memory. */
    freshFiles?: TutorFileInput[];
  },
): Promise<BuiltTurn | null> {
  const conversation = await ctx.runQuery(internal.ai.getConversationById, {
    conversationId,
  });
  if (!conversation) return null;

  const historyRows: Doc<"messages">[] = await ctx.runQuery(
    internal.ai.getMessagesByConversation,
    { conversationId },
  );
  const lastUser = [...historyRows].reverse().find((m) => m.role === "user");
  if (!lastUser) return null;

  const question = lastUser.content;

  // File grounding: fresh attachment text for this turn, or the stored head
  // of the most recently attached file from the student's memory.
  let fileChunks: { name: string; text: string; pages?: number }[] = [];
  if (opts?.freshFiles && opts.freshFiles.length > 0) {
    fileChunks = opts.freshFiles.map((f) => ({
      name: f.name,
      text: relevantFileChunk(question, f.text, FILE_CHUNK_TOKEN_BUDGET),
      ...(f.pages !== undefined ? { pages: f.pages } : {}),
    }));
  } else if (!lastUser.files?.length && !lastUser.images?.length) {
    const lastFileMessage = [...historyRows]
      .reverse()
      .find((m) => m.role === "user" && m.files && m.files.length > 0);
    const targetName = lastFileMessage?.files?.[0]?.name;
    if (targetName) {
      try {
        const memoryRow = (await ctx.runQuery(internal.ai.getTutorFileTextByName, {
          userId,
          name: targetName,
        })) as Doc<"tutorFileMemory"> | null;
        if (memoryRow && memoryRow.text.trim()) {
          fileChunks = [
            {
              name: memoryRow.name,
              text: memoryRow.text
                .slice(0, MAX_FOLLOWUP_FILE_CHARS)
                .replace(/\s+\[Text truncated[^\]]*\]$/, ""),
            },
          ];
        }
      } catch {
        // Non-critical — proceed without re-grounding.
      }
    }
  }

  // History window: last 6 turns before the current one, with attachment
  // markers replaying as bounded text.
  const priorRows = historyRows.filter((m) => m._id !== lastUser._id);
  const history = priorRows.slice(-HISTORY_LIMIT).map((message) => {
    const markers: string[] = [];
    if (message.images?.length) markers.push("[image attached]");
    if (message.files?.length) {
      markers.push(`[file attached: ${message.files.map((f) => f.name).join(", ")}]`);
    }
    return {
      role: message.role as "user" | "assistant",
      content: markers.length
        ? `${message.content}\n${markers.join(" ")}`
        : message.content,
    };
  });

  const recentFileContext =
    opts?.freshFiles?.length || lastUser.files?.length
      ? null
      : fileChunks.length > 0
        ? { name: fileChunks[0].name, textHead: fileChunks[0].text }
        : null;

  const buildSystem = (includeTopics: boolean) =>
    buildSystemPrompt(ctx, userId, conversation.subjectId, conversation.contentId, {
      mode: opts?.mode,
      grade: opts?.grade,
      concise: opts?.concise,
      hasImages: (lastUser.images?.length ?? 0) > 0,
      hasFiles: fileChunks.length > 0,
      includeTopics,
      summary: conversation.summary ?? null,
      ...(recentFileContext ? { recentFileContext } : {}),
    });

  let system = await buildSystem(true);
  let fileTexts = fileChunks;
  let historyFinal = history;

  // Budget enforcement — trim until the whole turn fits, in a fixed order so
  // the LEAST valuable context goes first.
  const currentTurn = fileTexts.length
    ? `${question}\n\n` +
      fileTexts
        .map(
          (f) =>
            `=== ATTACHED FILE: ${f.name} ===\n${f.text}\n=== END FILE: ${f.name} ===`,
        )
        .join("\n\n")
    : question;
  const imageTokens = (lastUser.images?.length ?? 0) * 600;
  const spent = () =>
    estimateTokens(system) +
    estimateTokens(historyFinal.map((h) => h.content).join("\n")) +
    estimateTokens(currentTurn) +
    imageTokens +
    TOKEN_OVERHEAD_RESERVE;
  const budget = HARD_INPUT_BUDGET_TOKENS - MAX_COMPLETION_TOKENS;

  // 1. Trim per-message history length.
  if (spent() > budget) {
    historyFinal = historyFinal.map((h) => ({
      role: h.role,
      content:
        h.content.length > HISTORY_MESSAGE_CHAR_CAP
          ? `${h.content.slice(0, HISTORY_MESSAGE_CHAR_CAP).trimEnd()}…`
          : h.content,
    }));
    system = await buildSystem(true);
  }
  // 2. Halve the file chunk budget (re-chunk fresh files; trim stored heads).
  if (spent() > budget && fileTexts.length > 0) {
    fileTexts = fileTexts.map((f) => ({
      ...f,
      text:
        opts?.freshFiles?.length && opts.freshFiles[0]
          ? relevantFileChunk(
              question,
              (opts.freshFiles.find((x) => x.name === f.name) ?? opts.freshFiles[0]).text,
              Math.floor(FILE_CHUNK_TOKEN_BUDGET / 3),
            )
          : f.text.slice(0, Math.floor((MAX_FOLLOWUP_FILE_CHARS * 2) / 3)),
    }));
    system = await buildSystem(true);
  }
  // 3. Drop the topic list from the system prompt.
  if (spent() > budget) {
    system = await buildSystem(false);
  }
  // 4. Last resort: drop the rolling summary.
  if (spent() > budget) {
    system = await buildSystem(false);
    const summaryStart = system.indexOf("Earlier in this conversation");
    if (summaryStart !== -1) {
      system = system.slice(0, summaryStart).trimEnd();
    }
  }

  const finalTurn = fileTexts.length
    ? `${question}\n\n` +
      fileTexts
        .map(
          (f) =>
            `=== ATTACHED FILE: ${f.name} ===\n${f.text}\n=== END FILE: ${f.name} ===`,
        )
        .join("\n\n")
    : question;

  const historyText = historyFinal.map((h) => h.content).join("\n");
  const contextHash = fnv1a64(
    normalizeForCache(system).slice(0, 600) + "|" + normalizeForCache(historyText).slice(0, 600),
  );

  return {
    system,
    history: historyFinal,
    userTurn: finalTurn,
    images: lastUser.images ?? [],
    estInputTokens: spent(),
    contextHash,
  };
}

// ---------------------------------------------------------------------------
// Graceful last-resort mode — helpful offline-style answer, NEVER a raw
// error. Searches the student's own materials for a relevant snippet, then
// honestly says the tutor is busy and that the question is saved.
// ---------------------------------------------------------------------------

/** The student's recent notes for one subject (graceful-mode snippet search). */
export const getRecentNotesForSubject = internalQuery({
  args: { userId: v.id("users"), subjectId: v.id("subjects") },
  handler: async (ctx, { userId, subjectId }) =>
    await ctx.db
      .query("notes")
      .withIndex("by_user_subject", (q) =>
        q.eq("userId", userId).eq("subjectId", subjectId),
      )
      .order("desc")
      .take(10),
});

async function composeGracefulReply(
  ctx: ActionCtx,
  userId: Id<"users">,
  conversationId: Id<"conversations">,
): Promise<string> {
  const snippets: string[] = [];
  const question = await (async () => {
    const rows = await ctx.runQuery(internal.ai.getMessagesByConversation, {
      conversationId,
    });
    const lastUser = [...rows].reverse().find((m) => m.role === "user");
    return lastUser?.content ?? "";
  })();

  // 1. The student's saved notes for this subject (highest signal).
  try {
    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId,
    });
    if (conversation?.subjectId) {
      const notes = await ctx.runQuery(internal.ai.getRecentNotesForSubject, {
        userId,
        subjectId: conversation.subjectId,
      });
      const keywords = [...questionKeywords(question)];
      const ranked = notes
        .map((n) => {
          const words = normalizeForCache(n.content).split(" ");
          let hits = 0;
          for (const k of keywords) if (words.some((w) => w.startsWith(k.slice(0, 4)))) hits += 1;
          return { n, hits };
        })
        .filter((r) => r.hits > 0)
        .sort((a, b) => b.hits - a.hits);
      for (const r of ranked.slice(0, 2)) {
        snippets.push(truncate(r.n.content, 260));
      }
    }
  } catch {
    // Notes are optional.
  }

  // 2. Uploaded-file excerpts (what they've been studying).
  if (snippets.length === 0) {
    try {
      const files = await ctx.runQuery(internal.ai.getRecentTutorFiles, { userId, limit: 3 });
      for (const f of files.slice(0, 1)) {
        snippets.push(truncate(f.excerpt, 220));
      }
    } catch {
      // Memory is optional.
    }
  }

  const studyBlock = snippets.length
    ? `From your study materials:\n> ${snippets.join("\n> ")}\n\n`
    : "";
  return (
    "🎓 **The tutor is swamped right now** — every AI provider is at capacity " +
    "from heavy demand across the platform.\n\n" +
    studyBlock +
    "**Your question is saved.** I'll answer it automatically the moment a " +
    "slot frees up — keep this chat open (or come back to it) and the reply " +
    "will appear here. Meanwhile, the library has textbooks and past papers " +
    "you can keep working through."
  );
}

// ---------------------------------------------------------------------------
// Queue — Convex-backed short queue for turns fired while EVERY provider is
// exhausted. Scheduled retries (exponential backoff + jitter for ~40s, then
// a slower capacity-return cadence) survive page refresh because the queue
// row lives in the database, and the frontend watches it live.
// ---------------------------------------------------------------------------

const QUEUE_FAST_WINDOW_MS = 40_000;
const QUEUE_MAX_ATTEMPTS = 10;

export const enqueueTutorTurn = internalMutation({
  args: {
    userId: v.id("users"),
    conversationId: v.id("conversations"),
    kind: v.union(v.literal("send"), v.literal("regenerate")),
    mode: v.optional(v.string()),
    grade: v.optional(v.number()),
    concise: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(80);
    const position = pending.filter((p) => p.createdAt <= now).length + 1;
    const requestId = await ctx.db.insert("aiRequestQueue", {
      ...args,
      status: "pending",
      attempts: 0,
      maxAttempts: QUEUE_MAX_ATTEMPTS,
      createdAt: now,
      updatedAt: now,
    });
    return { requestId, position };
  },
});

export const patchQueueRequest = internalMutation({
  args: {
    requestId: v.id("aiRequestQueue"),
    attempts: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("delivered"),
        v.literal("graceful"),
        v.literal("abandoned"),
      ),
    ),
    nextAttemptAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    gracefulReplied: v.optional(v.boolean()),
  },
  handler: async (ctx, { requestId, ...patch }) => {
    await ctx.db.patch(requestId, { ...patch, updatedAt: Date.now() });
    return { ok: true };
  },
});

export const getQueueRow = internalQuery({
  args: { requestId: v.id("aiRequestQueue") },
  handler: async (ctx, { requestId }) => (await ctx.db.get(requestId)) ?? null,
});

/**
 * The retry worker. Runs as an internal action scheduled with exponential
 * backoff + jitter: fast retries for the first ~40s (backoff 2.5s → 12s),
 * then a slower ~3-minute cadence so the answer still lands "when capacity
 * returns". Rebuilds the turn context from the database, so it stays correct
 * even if the student kept chatting while the request waited.
 */
export const processQueuedRequest = internalAction({
  args: { requestId: v.id("aiRequestQueue") },
  handler: async (ctx, { requestId }): Promise<{ done: boolean; retriedInMs?: number }> => {
    const row = await ctx.runQuery(internal.ai.getQueueRow, { requestId });
    if (!row || row.status !== "pending") return { done: false };

    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId: row.conversationId,
    });
    if (!conversation) {
      await ctx.runMutation(internal.ai.patchQueueRequest, {
        requestId,
        status: "abandoned",
      });
      return { done: false };
    }

    const attempts = (row.attempts ?? 0) + 1;
    await ctx.runMutation(internal.ai.patchQueueRequest, {
      requestId,
      attempts,
      nextAttemptAt: undefined,
    });

    if (attempts > QUEUE_MAX_ATTEMPTS) {
      await ctx.runMutation(internal.ai.patchQueueRequest, {
        requestId,
        status: "abandoned",
      });
      return { done: false };
    }

    const mode = (row.mode as TutorMode | undefined) ?? undefined;
    const turn = await buildTurnContext(ctx, row.userId, row.conversationId, {
      ...(mode ? { mode } : {}),
      ...(row.grade !== undefined
        ? { grade: row.grade as 9 | 10 | 11 | 12 }
        : {}),
      ...(row.concise !== undefined ? { concise: row.concise } : {}),
    });
    if (!turn) {
      await ctx.runMutation(internal.ai.patchQueueRequest, {
        requestId,
        status: "abandoned",
      });
      return { done: false };
    }

    const result = await routeChat(ctx, {
      system: turn.system,
      history: turn.history,
      userTurn: turn.userTurn,
      ...(turn.images.length > 0 ? { images: turn.images } : {}),
      maxOutputTokens: MAX_COMPLETION_TOKENS,
      temperature: row.kind === "regenerate" ? 0.55 : 0.5,
      purpose: row.kind === "regenerate" ? "regenerate" : "chat",
      userId: row.userId,
      conversationId: row.conversationId,
    });

    if (result.ok) {
      let reply = result.text;
      if (result.finishReason === "length") {
        reply =
          balanceTrailingMath(reply) +
          "\n\n*ⓘ The reply reached its length limit mid-answer. Say \"continue\" and I'll pick up exactly where I stopped.*";
      }
      const now = Date.now();
      await ctx.runMutation(internal.ai.insertMessage, {
        conversationId: row.conversationId,
        role: "assistant",
        content: reply,
        ...(row.gracefulReplied ? { degraded: false } : {}),
        createdAt: now,
      });
      await ctx.runMutation(internal.ai.patchConversation, {
        conversationId: row.conversationId,
        updatedAt: now,
      });
      await ctx.runMutation(internal.ai.patchQueueRequest, {
        requestId,
        status: "delivered",
      });
      await scheduleSummary(ctx, row.conversationId);
      return { done: true };
    }

    // Still exhausted. Fast retries inside the ~40s window, then slow ones.
    const elapsed = Date.now() - row.createdAt;
    if (!row.gracefulReplied && elapsed >= QUEUE_FAST_WINDOW_MS) {
      const graceful = await composeGracefulReply(
        ctx,
        row.userId,
        row.conversationId,
      );
      await ctx.runMutation(internal.ai.insertMessage, {
        conversationId: row.conversationId,
        role: "assistant",
        content: graceful,
        degraded: true,
        createdAt: Date.now(),
      });
      await ctx.runMutation(internal.ai.patchConversation, {
        conversationId: row.conversationId,
        updatedAt: Date.now(),
      });
      await ctx.runMutation(internal.ai.patchQueueRequest, {
        requestId,
        gracefulReplied: true,
        status: "graceful",
      });
    }

    const delay =
      elapsed < QUEUE_FAST_WINDOW_MS
        ? Math.min(2_500 * Math.pow(2, attempts - 1), 12_000) +
          Math.floor(Math.random() * 1_200)
        : 180_000 + Math.floor(Math.random() * 20_000);
    await ctx.runMutation(internal.ai.patchQueueRequest, {
      requestId,
      nextAttemptAt: Date.now() + delay,
      lastError: `exhausted (attempt ${attempts}, ${result.hops.length} hops)`,
    });
    await ctx.scheduler.runAfter(delay, internal.ai.processQueuedRequest, {
      requestId,
    });
    return { done: false, retriedInMs: delay };
  },
});

/**
 * Sweeper for queue rows whose scheduler chain was lost (e.g. the backend
 * was redeployed between retries). Bounded, indexed, idempotent — rows
 * still being processed are protected by nextAttemptAt.
 */
export const sweepStaleQueueRequests = internalAction({
  args: {},
  handler: async (ctx): Promise<{ rescheduled: number }> => {
    const now = Date.now();
    const rows = await ctx.runQuery(internal.ai.listStalePendingQueueRows, {
      now,
    });
    for (const requestId of rows) {
      await ctx.scheduler.runAfter(
        Math.floor(Math.random() * 5_000),
        internal.ai.processQueuedRequest,
        { requestId },
      );
    }
    return { rescheduled: rows.length };
  },
});

export const listStalePendingQueueRows = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
      .order("asc")
      .take(20);
    return rows
      .filter((r) => (r.nextAttemptAt ?? r.updatedAt) < now - 60_000)
      .map((r) => r._id);
  },
});

// ---------------------------------------------------------------------------
// Rolling summary — the dieted history window is 6 messages; older turns
// collapse into a short rolling summary stored on the conversation. Runs
// asynchronously after replies (never in the reply's critical path) with a
// tiny model, and merges into the previous summary so it stays rolling.
// ---------------------------------------------------------------------------

async function scheduleSummary(
  ctx: ActionCtx,
  conversationId: Id<"conversations">,
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(
      3_000,
      internal.ai.maybeUpdateConversationSummary,
      { conversationId },
    );
  } catch {
    // Scheduling is best-effort.
  }
}

export const maybeUpdateConversationSummary = internalAction({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId,
    });
    if (!conversation) return { updated: false };

    const rows = await ctx.runQuery(internal.ai.getMessagesByConversation, {
      conversationId,
    });
    if (rows.length <= SUMMARY_TRIGGER_COUNT) return { updated: false };

    const covered = conversation.summarizedUpTo ?? 0;
    const older = rows.slice(covered, rows.length - HISTORY_LIMIT);
    if (older.length < SUMMARY_MIN_NEW_TURNS) return { updated: false };

    const transcript = older
      .map(
        (m) =>
          `${m.role === "user" ? "Student" : "Tutor"}: ${truncate(m.content, 260)}`,
      )
      .join("\n");

    const result = await routeChat(ctx, {
      system:
        "Compress a tutoring conversation into a running summary for the tutor's own context. Keep: subject/topics covered, key formulas or facts, mistakes the student made, where the discussion left off. Max 120 words, plain text, no preamble. Merge with the existing summary if provided — drop resolved detail, keep standing context.",
      history: [],
      userTurn:
        (conversation.summary
          ? `Existing summary to update:\n${conversation.summary.slice(0, MAX_SUMMARY_CHARS)}\n\n`
          : "") +
        `New turns to fold in:\n${transcript.slice(0, 6_000)}`,
      maxOutputTokens: 200,
      temperature: 0.2,
      preference: "tiny",
      purpose: "summary",
      userId: conversation.userId,
      conversationId,
    });
    if (!result.ok) return { updated: false };

    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId,
      summary: truncate(result.text.replace(/\s+/g, " ").trim(), MAX_SUMMARY_CHARS),
      updatedAt: Date.now(),
    });
    await ctx.runMutation(internal.ai.setSummarizedUpTo, {
      conversationId,
      count: rows.length - HISTORY_LIMIT,
    });
    return { updated: true };
  },
});

export const setSummarizedUpTo = internalMutation({
  args: { conversationId: v.id("conversations"), count: v.number() },
  handler: async (ctx, { conversationId, count }) => {
    await ctx.db.patch(conversationId, { summarizedUpTo: count });
    return { ok: true };
  },
});

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
    // Max 3 per message, each capped ~450 KB of base64 (≈ 330 KB binary).
    images: v.optional(v.array(v.string())),
    // Document attachments with CLIENT-EXTRACTED text (see lib/tutorFiles.ts).
    // The text is re-validated and capped server-side before use; the full
    // text is stored in tutorFileMemory, and up to 24k chars per file is
    // injected into this turn.
    files: v.optional(
      v.array(
        v.object({
          name: v.string(),
          mime: v.string(),
          size: v.number(),
          chars: v.number(),
          pages: v.optional(v.number()),
          text: v.string(),
        }),
      ),
    ),
    // Persisted student preference (academic memory, client-side stored).
    concise: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    reply: string;
    conversationId: Id<"conversations">;
    /** Present when every provider was busy — the turn is queued in Convex. */
    queued?: { requestId: Id<"aiRequestQueue">; position: number; etaSeconds: number };
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required to use the tutor.", code: "unauthorized" });
    }

    const content = args.content.trim();
    const rawFiles = args.files ?? [];
    if (!content && !(args.images && args.images.length > 0) && rawFiles.length === 0) {
      throw new ConvexError({ message: "Message cannot be empty.", code: "invalid" });
    }
    if (content.length > 4000) {
      throw new ConvexError({ message: "Message is too long (max 4,000 characters).", code: "invalid" });
    }

    // --- Image attachment validation -------------------------------------
    const images = (args.images ?? []).filter((img) => typeof img === "string");
    if (images.length > 3) {
      throw new ConvexError({ message: "Attach at most 3 images per message.", code: "invalid" });
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

    // --- Document attachment validation + memory-ready copies ------------
    // The client extracted the text (lib/tutorFiles.ts) — the server never
    // trusts client payloads blindly: names are sanitized, text is bounded,
    // and the caps here mirror the client's extraction limits.
    const files: TutorFileInput[] = [];
    for (const file of rawFiles.slice(0, MAX_FILES_PER_MESSAGE)) {
      const safeName = String(file.name ?? "")
        .replace(/[\u0000-\u001f]/g, "")
        .slice(0, 140);
      if (!safeName) continue;
      const safeText = String(file.text ?? "").slice(0, MAX_FILE_TEXT_CHARS);
      if (!safeText.trim()) continue;
      files.push({
        name: safeName,
        mime: String(file.mime ?? "application/octet-stream").slice(0, 100),
        size: Math.max(0, Math.min(Number(file.size) || 0, 25_000_000)),
        chars: safeText.length,
        pages:
          typeof file.pages === "number" && Number.isFinite(file.pages)
            ? Math.max(1, Math.min(Math.round(file.pages), 5_000))
            : undefined,
        text: safeText,
      });
    }
    if (rawFiles.length > MAX_FILES_PER_MESSAGE) {
      throw new ConvexError({
        message: `Attach at most ${MAX_FILES_PER_MESSAGE} documents per message.`,
        code: "invalid",
      });
    }

    const effectiveContent =
      content ||
      (images.length > 0
        ? "Solve this and explain every step."
        : files.length > 0
          ? `Study "${files[0].name}" and teach me the key points, then check my understanding.`
          : "");

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
    // The message row keeps METADATA ONLY for files (text lives in tutor
    // file memory below) — chat history stays lean for every future load.
    const now = Date.now();
    await ctx.runMutation(internal.ai.insertMessage, {
      conversationId,
      role: "user",
      content: effectiveContent,
      images: images.length > 0 ? images : undefined,
      files:
        files.length > 0
          ? files.map(({ name, mime, size, chars, pages }) => ({
              name,
              mime,
              size,
              chars,
              ...(pages !== undefined ? { pages } : {}),
            }))
          : undefined,
      createdAt: now,
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId,
      updatedAt: now,
    });

    // --- Save uploads into the student's tutor file memory --------------
    // Exactly one row per unique (name, size); re-uploads refresh. Wrapped
    // per-file: one weird file must never block the message itself.
    for (const file of files) {
      try {
        await ctx.runMutation(internal.ai.upsertTutorFileMemory, {
          userId,
          name: file.name,
          mime: file.mime,
          size: file.size,
          chars: file.chars,
          ...(file.pages !== undefined ? { pages: file.pages } : {}),
          excerpt: file.text.replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_EXCERPT_CHARS),
          text: file.text,
        });
      } catch {
        // Memory persistence is best-effort; the turn proceeds regardless.
      }
    }

    // --- Fairness: hourly per-user cap ------------------------------------
    // The free-tier daily cap above still applies; this hourly ceiling (via
    // the rate-limiter component) protects the SHARED provider quota from a
    // few heavy users burning everyone's tokens.
    const mode: TutorMode = args.mode ?? "learn";
    const conversation = await ctx.runQuery(internal.ai.getConversationById, {
      conversationId,
    });
    const hourly = await tutorLimiter.limit(
      ctx,
      premium ? "tutorHourlyPremium" : "tutorHourlyFree",
      { key: userId, throws: false },
    );
    if (!hourly.ok) {
      const waitMin = Math.max(1, Math.ceil((hourly.retryAfter ?? 60_000) / 60_000));
      throw new ConvexError({
        message:
          `You're sending messages really fast — the tutor allows ${premium ? 45 : 20} messages per hour ` +
          `so everyone gets a fair share. Try again in about ${waitMin} minute${waitMin === 1 ? "" : "s"}.`,
        code: "hourly_limit_reached",
      });
    }

    // --- Title the thread immediately on first exchange -------------------
    // Set BEFORE the AI call so a queued turn still gets a proper sidebar
    // title even if the answer lands seconds later via the retry worker.
    if (isFirstExchange && conversation) {
      let title: string;
      if (conversation.subjectId) {
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

    // --- One in-flight request per user -------------------------------------
    const inflightOk = await ctx.runMutation(internal.ai.markTutorInflight, { userId });
    if (!inflightOk) {
      throw new ConvexError({
        message:
          "You're already waiting on an answer — give the tutor a few seconds to finish, then send the next one.",
        code: "busy",
      });
    }

    try {
      // --- Build the dieted turn context ---------------------------------
      // 6-message window + rolling summary + relevance-scored file chunks,
      // all enforced against the hard input budget inside buildTurnContext.
      const turn = await buildTurnContext(ctx, userId, conversationId, {
        mode,
        ...(args.grade !== undefined ? { grade: args.grade } : {}),
        ...(args.concise !== undefined ? { concise: args.concise } : {}),
        ...(files.length > 0 ? { freshFiles: files } : {}),
      });
      if (!turn) {
        throw new ConvexError({ message: "Nothing to answer yet.", code: "invalid" });
      }

      // --- Answer cache ----------------------------------------------------
      // Identical/near-identical questions in the same lesson context are
      // served instantly. Stateful modes (practice/exam/quiz) and image
      // turns are never cached — the same question must give a fresh result.
      const cacheable = !NON_CACHEABLE_MODES.has(mode) && images.length === 0;
      const key = cacheable
        ? cacheKey({
            question: effectiveContent,
            mode,
            ...(args.grade !== undefined ? { grade: args.grade } : {}),
            ...(conversation?.subjectId ? { subjectId: conversation.subjectId } : {}),
            ...(conversation?.contentId ? { contentId: conversation.contentId } : {}),
            contextHash: turn.contextHash,
          })
        : null;
      if (key) {
        const cached = await ctx.runQuery(internal.ai.lookupAnswerCache, { hash: key });
        if (cached) {
          const now = Date.now();
          await ctx.runMutation(internal.ai.insertMessage, {
            conversationId,
            role: "assistant",
            content: cached,
            createdAt: now,
          });
          await ctx.runMutation(internal.ai.patchConversation, {
            conversationId,
            updatedAt: now,
          });
          await ctx.runMutation(internal.aiRouter.insertCallLog, {
            userId,
            conversationId,
            purpose: "chat",
            cacheHit: true,
            provider: "cache",
            model: "cache",
            latencyMs: 0,
            estInputTokens: turn.estInputTokens,
          });
          return { reply: cached, conversationId };
        }
      }

      // --- Route across providers (capacity-aware, never throws) ----------
      const result = await routeChat(ctx, {
        system: turn.system,
        history: turn.history,
        userTurn: turn.userTurn,
        ...(turn.images.length > 0 ? { images: turn.images } : {}),
        maxOutputTokens: MAX_COMPLETION_TOKENS,
        temperature: 0.5,
        purpose: "chat",
        userId,
        conversationId,
      });

      if (result.ok) {
        let reply = result.text;
        // Truncated reply — say so honestly instead of letting a formula die
        // mid-stream. Balance FIRST (close dangling $$ / $ / environments)
        // so the marker lands outside any math region and the partial
        // derivation still renders as typeset mathematics.
        if (result.finishReason === "length") {
          reply =
            balanceTrailingMath(reply) +
            "\n\n*ⓘ The reply reached its length limit mid-answer. Say \"continue\" and I'll pick up exactly where I stopped.*";
        }
        if (key) {
          await ctx.runMutation(internal.ai.storeAnswerCache, {
            hash: key,
            answer: reply,
            provider: result.provider,
            model: result.model,
          });
        }
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
        await scheduleSummary(ctx, conversationId);
        await logEventAction(ctx, {
          eventType: "api_call",
          source: "ai.sendMessage.router",
          status: "success",
          userId,
          metadata: {
            provider: result.provider,
            model: result.model,
            hops: result.hops.length,
            conversationId,
            hasImages: images.length > 0,
            hasFiles: files.length > 0,
            mode,
            truncated: result.finishReason === "length",
          },
          durationMs: result.latencyMs,
        });
        return { reply, conversationId };
      }

      // --- Every provider busy → Convex-backed queue -----------------------
      // The user message is already persisted; the scheduled retry worker
      // rebuilds the turn from the database and answers it as capacity
      // returns. The frontend switches to a friendly "high demand" status
      // with a live queue position and keeps watching this conversation.
      const { requestId, position } = await ctx.runMutation(internal.ai.enqueueTutorTurn, {
        userId,
        conversationId,
        kind: "send",
        mode,
        ...(args.grade !== undefined ? { grade: args.grade } : {}),
        ...(args.concise !== undefined ? { concise: args.concise } : {}),
      });
      await ctx.scheduler.runAfter(
        4_000 + Math.floor(Math.random() * 2_000),
        internal.ai.processQueuedRequest,
        { requestId },
      );
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "ai.sendMessage.queued",
        status: "success",
        userId,
        metadata: { requestId, position, hops: result.hops.length },
      });
      return {
        reply: "",
        conversationId,
        queued: {
          requestId,
          position,
          etaSeconds: Math.min(40, 8 + position * 4),
        },
      };
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: "ai.sendMessage",
        status: "error",
        userId,
        metadata: { message: error instanceof Error ? error.message : "unknown" },
      });
      throw asAiError(error, "The tutor hit a temporary snag. Please try again in a moment.");
    } finally {
      await ctx.runMutation(internal.ai.clearTutorInflight, { userId });
    }
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
      "Notation rules: follow-up questions are PLAIN TEXT (no LaTeX — they render as " +
      "chips); the mini-check question, options and explanation may use math as " +
      "$…$ or $$…$$ (e.g. $x^2 + 1$) — never raw LaTeX outside delimiters. " +
      "Verify any computation in the mini-check. " +
      "Respond ONLY with valid JSON in this shape: " +
      '{"followUps": ["q1", "q2"], "miniCheck": {"question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "..."}}. ' +
      "If the topic doesn't lend itself to a quick check, set miniCheck to null.";

    const userMessage = `The student just received this explanation about ${subjectName}:\n\n${lastAssistant.content.slice(0, 1200)}\n\nGenerate 2 follow-up questions and an optional mini-check.`;

    // Fire-and-forget helper turn — routed with a tiny model and a small
    // budget; when every provider is busy the chips just don't render (the
    // existing UI already treats this as non-fatal), never an error.
    try {
      const result = await routeChat(ctx, {
        system: systemPrompt,
        history: [],
        userTurn: userMessage,
        maxOutputTokens: 320,
        temperature: 0.6,
        preference: "tiny",
        purpose: "followups",
        userId,
        conversationId: args.conversationId,
      });
      if (!result.ok) return { followUps: [], miniCheck: null };
      const cleaned = result.text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
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

    // Routed with a tiny model + small budget; on total exhaustion the
    // student gets an honest, friendly hold message instead of provider noise.
    const result = await routeChat(ctx, {
      system:
        "You compress a tutor explanation into concise study notes for an Ethiopian " +
        "student preparing for national exams. Output ONLY the note content: markdown " +
        "bullets, key definitions, formulas and one worked example if present. Max " +
        "200 words. No preamble, no closing remarks. All mathematics must be LaTeX " +
        "inside $…$ (inline) or $$…$$ (display) — never raw LaTeX commands outside " +
        "delimiters, never plain-text approximations like x^2 when $x^2$ is meant.",
      history: [],
      userTurn: `Compress this explanation into study notes:\n\n${lastAssistant.content.slice(0, 3200)}`,
      maxOutputTokens: 600,
      temperature: 0.3,
      preference: "tiny",
      purpose: "notes",
      userId,
      conversationId,
    });
    if (!result.ok) {
      throw new ConvexError({
        message:
          "The tutor is very busy right now — try saving notes again in a minute.",
        code: "tutor_busy",
      });
    }
    const raw = result.text;

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

// ---------------------------------------------------------------------------
// STUDY ROOM engine — thread surgery behind the Tutor's edit / branch /
// regenerate / search / delete interactions. Every function re-verifies
// ownership server-side; nothing trusts the client.
// ---------------------------------------------------------------------------

/** Drop an owned conversation's trailing assistant message(s) — used by
 * regenerate so the fresh reply replaces the old one instead of appending. */
export const deleteTrailingAssistant = internalMutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
    let deleted = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role !== "assistant") break;
      await ctx.db.delete(messages[i]._id);
      deleted += 1;
    }
    return { deleted };
  },
});

/** Delete a message and every message after it — the blade behind
 * "Edit & resend" and "Retry from here". The client then re-sends the
 * (possibly edited) content through ai.sendMessage. */
export const truncateFromMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, { conversationId, messageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new ConvexError({
        message: "Conversation not found or not yours.",
        code: "not_found",
      });
    }
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
    const index = messages.findIndex((m) => m._id === messageId);
    if (index === -1) {
      throw new ConvexError({ message: "Message not found.", code: "not_found" });
    }
    let deleted = 0;
    for (let i = index; i < messages.length; i++) {
      await ctx.db.delete(messages[i]._id);
      deleted += 1;
    }
    await ctx.db.patch(conversationId, { updatedAt: Date.now() });
    return { deleted };
  },
});

/** Regenerate the last assistant reply — deletes the trailing assistant
 * message(s), then answers the SAME conversation context again with the
 * current mode / grade / concise preferences applied. No new user turn is
 * inserted, so the free-tier counter is untouched (it replaces a reply,
 * it doesn't add one). */
export const regenerateReply = action({
  args: {
    conversationId: v.id("conversations"),
    mode: v.optional(tutorModeValidator),
    grade: v.optional(v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    )),
    concise: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ reply: string; queued?: { requestId: Id<"aiRequestQueue"> } }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required to use the tutor.", code: "unauthorized" });
    }
    const conversation: Doc<"conversations"> | null = await ctx.runQuery(
      internal.ai.getConversationById,
      { conversationId: args.conversationId },
    );
    if (!conversation || conversation.userId !== userId) {
      throw new ConvexError({
        message: "Conversation not found or not yours.",
        code: "not_found",
      });
    }

    // Replace, don't append: drop trailing assistant message(s) first.
    await ctx.runMutation(internal.ai.deleteTrailingAssistant, {
      conversationId: args.conversationId,
    });

    const historyRows: Doc<"messages">[] = await ctx.runQuery(
      internal.ai.getMessagesByConversation,
      { conversationId: args.conversationId },
    );
    const lastUser = [...historyRows].reverse().find((m) => m.role === "user");
    if (!lastUser) {
      throw new ConvexError({
        message: "Nothing to regenerate yet.",
        code: "invalid",
      });
    }

    // Dieted rebuild via buildTurnContext: 6-message window, rolling
    // summary, re-grounding on the attached file's stored memory head —
    // the regenerated answer keeps the REAL content grounding.
    const turn = await buildTurnContext(ctx, userId, args.conversationId, {
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.grade !== undefined ? { grade: args.grade } : {}),
      ...(args.concise !== undefined ? { concise: args.concise } : {}),
    });
    if (!turn) {
      throw new ConvexError({
        message: "Nothing to regenerate yet.",
        code: "invalid",
      });
    }

    const result = await routeChat(ctx, {
      system: turn.system,
      history: turn.history,
      userTurn: turn.userTurn,
      ...(turn.images.length > 0 ? { images: turn.images } : {}),
      maxOutputTokens: MAX_COMPLETION_TOKENS,
      temperature: 0.55, // a touch more variance than the first pass
      purpose: "regenerate",
      userId,
      conversationId: args.conversationId,
    });

    if (!result.ok) {
      // Every provider busy — enqueue the regeneration. The trailing
      // assistant message is already deleted, so the retry worker's reply
      // simply appears in its place; survives a page refresh.
      const { requestId } = await ctx.runMutation(internal.ai.enqueueTutorTurn, {
        userId,
        conversationId: args.conversationId,
        kind: "regenerate",
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.grade !== undefined ? { grade: args.grade } : {}),
        ...(args.concise !== undefined ? { concise: args.concise } : {}),
      });
      await ctx.scheduler.runAfter(
        4_000 + Math.floor(Math.random() * 2_000),
        internal.ai.processQueuedRequest,
        { requestId },
      );
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "ai.regenerateReply.queued",
        status: "success",
        userId,
        metadata: { requestId, conversationId: args.conversationId },
      });
      return { reply: "", queued: { requestId } };
    }

    let reply = result.text;
    if (result.finishReason === "length") {
      reply =
        balanceTrailingMath(reply) +
        "\n\n*ⓘ The reply reached its length limit mid-answer. Say \"continue\" and I'll pick up exactly where I stopped.*";
    }
    await logEventAction(ctx, {
      eventType: "api_call",
      source: "ai.regenerateReply.router",
      status: "success",
      userId,
      metadata: {
        provider: result.provider,
        model: result.model,
        hops: result.hops.length,
        conversationId: args.conversationId,
      },
      durationMs: result.latencyMs,
    });

    const now = Date.now();
    await ctx.runMutation(internal.ai.insertMessage, {
      conversationId: args.conversationId,
      role: "assistant",
      content: reply,
      createdAt: now,
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId: args.conversationId,
      updatedAt: now,
    });
    await scheduleSummary(ctx, args.conversationId);
    return { reply };
  },
});

/** "Edit & branch" — never destroys the original thread. Copies everything
 * before the edited message into a NEW conversation (↳ titled), writes the
 * edited user message there, and answers it. The original conversation
 * stays exactly as it was. */
export const branchConversation = action({
  args: {
    conversationId: v.id("conversations"),
    messageId: v.id("messages"),
    content: v.string(),
    mode: v.optional(tutorModeValidator),
    grade: v.optional(v.union(
      v.literal(9),
      v.literal(10),
      v.literal(11),
      v.literal(12),
    )),
    concise: v.optional(v.boolean()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    reply: string;
    conversationId: Id<"conversations">;
    queued?: { requestId: Id<"aiRequestQueue"> };
  }> => {
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

    // Free-tier parity with sendMessage — a branch consumes a daily message.
    const premium = await getPremiumAccess(ctx, userId);
    if (!premium) {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      const used = await ctx.runQuery(internal.ai.countUserMessagesSince, {
        userId,
        since,
      });
      if (used >= FREE_TUTOR_DAILY_LIMIT) {
        throw new ConvexError({
          message:
            `You've used your ${FREE_TUTOR_DAILY_LIMIT} free tutor messages for today. ` +
            "Come back tomorrow for a fresh set — or upgrade for unlimited tutoring.",
          code: "daily_limit_reached",
        });
      }
    }

    const original: Doc<"conversations"> | null = await ctx.runQuery(
      internal.ai.getConversationById,
      { conversationId: args.conversationId },
    );
    if (!original || original.userId !== userId) {
      throw new ConvexError({
        message: "Conversation not found or not yours.",
        code: "not_found",
      });
    }
    const messages: Doc<"messages">[] = await ctx.runQuery(
      internal.ai.getMessagesByConversation,
      { conversationId: args.conversationId },
    );
    const index = messages.findIndex((m) => m._id === args.messageId);
    if (index === -1) {
      throw new ConvexError({ message: "Message not found.", code: "not_found" });
    }

    // The new branch: copy of the prefix + the edited user message.
    const now = Date.now();
    const branchId = await ctx.runMutation(internal.ai.insertConversation, {
      userId,
      title: `↳ ${original.title ?? "Branched chat"}`,
      subjectId: original.subjectId,
      contentId: original.contentId,
      createdAt: now,
      updatedAt: now,
    });

    // Copy the prefix. To bound the write burst, keep image payloads only on
    // the last 4 copied turns — older turns replay as text anyway.
    const prefix = messages.slice(0, index);
    const imageFloor = Math.max(0, prefix.length - 4);
    for (let i = 0; i < prefix.length; i++) {
      const m = prefix[i];
      await ctx.runMutation(internal.ai.insertMessage, {
        conversationId: branchId,
        role: m.role,
        content: m.content,
        images: i >= imageFloor ? m.images : undefined,
        createdAt: m.createdAt,
      });
    }
    await ctx.runMutation(internal.ai.insertMessage, {
      conversationId: branchId,
      role: "user",
      content,
      createdAt: now,
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId: branchId,
      updatedAt: now,
    });

    // Answer the edited turn inside the branch — dieted rebuild via
    // buildTurnContext (6-message window + rolling summary; the fresh
    // branch has no summary yet, so it degrades to just the window).
    const turn = await buildTurnContext(ctx, userId, branchId, {
      ...(args.mode ? { mode: args.mode } : {}),
      ...(args.grade !== undefined ? { grade: args.grade } : {}),
      ...(args.concise !== undefined ? { concise: args.concise } : {}),
    });
    if (!turn) {
      throw new ConvexError({ message: "Couldn't build the branched turn.", code: "invalid" });
    }

    const result = await routeChat(ctx, {
      system: turn.system,
      history: turn.history,
      userTurn: turn.userTurn,
      ...(turn.images.length > 0 ? { images: turn.images } : {}),
      maxOutputTokens: MAX_COMPLETION_TOKENS,
      temperature: 0.5,
      purpose: "branch",
      userId,
      conversationId: branchId,
    });

    if (!result.ok) {
      // Every provider busy — the branch + edited message already exist, so
      // the retry worker can answer it from the database alone.
      const { requestId } = await ctx.runMutation(internal.ai.enqueueTutorTurn, {
        userId,
        conversationId: branchId,
        kind: "send",
        ...(args.mode ? { mode: args.mode } : {}),
        ...(args.grade !== undefined ? { grade: args.grade } : {}),
        ...(args.concise !== undefined ? { concise: args.concise } : {}),
      });
      await ctx.scheduler.runAfter(
        4_000 + Math.floor(Math.random() * 2_000),
        internal.ai.processQueuedRequest,
        { requestId },
      );
      return { reply: "", conversationId: branchId, queued: { requestId } };
    }

    let reply = result.text;
    if (result.finishReason === "length") {
      reply =
        balanceTrailingMath(reply) +
        "\n\n*ⓘ The reply reached its length limit mid-answer. Say \"continue\" and I'll pick up exactly where I stopped.*";
    }

    await ctx.runMutation(internal.ai.insertMessage, {
      conversationId: branchId,
      role: "assistant",
      content: reply,
      createdAt: Date.now(),
    });
    await ctx.runMutation(internal.ai.patchConversation, {
      conversationId: branchId,
      updatedAt: Date.now(),
    });
    await scheduleSummary(ctx, branchId);
    return { reply, conversationId: branchId };
  },
});

/** Full-text search over the student's tutor history — bounded scan of the
 * 30 most recent conversations × their last 80 messages. Powers the sidebar
 * "Search conversations" knowledge-archive feature. */
export const searchMessages = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit = 12 }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];

    const conversations = await ctx.db
      .query("conversations")
      .withIndex("by_user_updatedAt", (x) => x.eq("userId", userId))
      .order("desc")
      .take(30);

    const results: {
      messageId: Id<"messages">;
      conversationId: Id<"conversations">;
      title: string;
      role: "user" | "assistant";
      snippet: string;
      createdAt: number;
    }[] = [];

    for (const conversation of conversations) {
      const messages = await ctx.db
        .query("messages")
        .withIndex("by_conversation", (x) => x.eq("conversationId", conversation._id))
        .order("desc")
        .take(80);
      for (const m of messages) {
        const at = m.content.toLowerCase().indexOf(needle);
        if (at === -1) continue;
        const start = Math.max(0, at - 42);
        results.push({
          messageId: m._id,
          conversationId: conversation._id,
          title: conversation.title ?? "Untitled chat",
          role: m.role,
          snippet:
            (start > 0 ? "…" : "") +
            m.content.slice(start, Math.min(m.content.length, at + 90)).trim() +
            (at + 90 < m.content.length ? "…" : ""),
          createdAt: m.createdAt,
        });
        if (results.length >= limit) return results;
      }
    }
    return results;
  },
});

/** Delete a whole conversation and every message in it — sidebar-level
 * thread management. */
export const deleteConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.userId !== userId) {
      throw new ConvexError({
        message: "Conversation not found or not yours.",
        code: "not_found",
      });
    }
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .collect();
    for (const m of messages) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(conversationId);
    return { ok: true };
  },
});
