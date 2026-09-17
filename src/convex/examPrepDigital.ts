// Digital exam engine backend — auto-converts every past-exam PDF into a
// fully digital, question-by-question paper.
//
// PIPELINE (who does what):
//   1. beginDigitization  (mutation, client)  — claim/dedupe the conversion
//      job. Ready papers short-circuit (instant replay). Fresh processing
//      rows block (another student is already converting). Stale or failed
//      rows are replaced.
//   2. Client extracts the PDF text locally (pdf.js — same engine the
//      Reader uses) and streams page-aligned chunks to:
//   3. parsePaperChunk    (action, client)    — Groq transcription with a
//      strict "transcribe, never invent" prompt; each chunk appends through
//      the internal sequence-guarded appendParsedChunk; the last chunk
//      completes the job (renumber 1..N, flip ready).
//   4. getDigitalPaper / getDigitalPaperStatuses (queries) — the player and
//      the hub badges read from here.
//
// HONESTY RULES baked into the backend:
//   - The AI is told to transcribe ONLY questions that literally appear in
//     the text. It may attach an answer/explanation only when the paper
//     itself states one (answer-key page); otherwise the fields stay empty
//     and the UI labels anything shown as AI-suggested.
//   - A "ready" row with zero extracted questions is recorded as failed —
//     the UI then offers the original PDF instead of an empty exam.
//   - Question text is stored verbatim (trimmed) — no rewriting.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { isPremiumStatus } from "./subscriptions";
import { callGroq } from "./groq";

// How long a "processing" claim stays fresh before another student may
// replace it. The client pipeline is sequential Groq calls — a 30-page
// paper is ~4 chunks × ~30s worst case; 15 minutes is generous headroom.
const PROCESSING_FRESH_MS = 15 * 60 * 1000;

const rawQuestionValidator = v.object({
  number: v.number(),
  text: v.string(),
  passage: v.optional(v.string()),
  options: v.array(v.object({ label: v.string(), text: v.string() })),
  answer: v.optional(v.string()),
  explanation: v.optional(v.string()),
  topic: v.optional(v.string()),
});

// ─── Claim / dedupe the conversion job ──────────────────────────────────

/**
 * Claim a conversion slot for this paper. Returns the current state so the
 * client knows what to do:
 *   { kind: "ready" }         — a digitized version already exists; play it
 *   { kind: "processing" }    — someone (possibly you) is converting now
 *   { kind: "claimed", digitalPaperId } — you own the job; start extracting
 */
export const beginDigitization = mutation({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args): Promise<{ kind: string; digitalPaperId?: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const item = await ctx.db.get(args.contentId);
    if (!item) throw new ConvexError({ message: "Paper not found.", code: "not_found" });

    const existing = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();

    const now = Date.now();

    if (existing) {
      if (existing.status === "ready") {
        return { kind: "ready", digitalPaperId: existing._id };
      }
      if (existing.status === "processing" && now - existing.updatedAt < PROCESSING_FRESH_MS) {
        return { kind: "processing", digitalPaperId: existing._id };
      }
      // Failed, or a stale interrupted conversion — replace it wholesale.
      // (Questions may have been partially appended; a clean row keeps the
      // sequence guard honest.)
      await ctx.db.delete(existing._id);
    }

    const id = await ctx.db.insert("digitalPapers", {
      contentId: args.contentId,
      status: "processing",
      questions: [],
      questionCount: 0,
      chunksParsed: 0,
      startedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: "claimed", digitalPaperId: id };
  },
});

/**
 * Action-side status peek (actions have no direct db access).
 */
export const getDigitizationRowStatus = internalQuery({
  args: { digitalPaperId: v.id("digitalPapers") },
  handler: async (ctx, args): Promise<{ status: string } | null> => {
    const row = await ctx.db.get(args.digitalPaperId);
    return row ? { status: row.status } : null;
  },
});

// ─── Chunk append / complete / fail (internal pipeline steps) ────────────

/**
 * Append one chunk's questions. STRICT SEQUENCE GUARD: chunk N is only
 * accepted when exactly N chunks have already been parsed — a client
 * retrying a timed-out call can never double-append, and out-of-order
 * arrival is rejected instead of silently producing a broken paper.
 */
export const appendParsedChunk = internalMutation({
  args: {
    digitalPaperId: v.id("digitalPapers"),
    chunkIndex: v.number(),
    chunkCount: v.number(),
    pageCount: v.number(),
    questions: v.array(rawQuestionValidator),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row) throw new ConvexError("Digital paper row vanished mid-conversion.");
    if (row.status !== "processing") return { ok: false as const };
    const parsed = row.chunksParsed ?? 0;
    if (args.chunkIndex !== parsed) {
      throw new ConvexError(
        `Chunk ${args.chunkIndex} out of sequence (expected ${parsed}) — retry.`,
      );
    }
    await ctx.db.patch(args.digitalPaperId, {
      questions: [...row.questions, ...args.questions],
      chunksParsed: parsed + 1,
      chunkCount: args.chunkCount,
      pageCount: args.pageCount,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Finalize a conversion: renumber questions 1..N and flip to ready — or,
 * if the AI could not find any questions at all, record an honest failure.
 */
export const completeDigitization = internalMutation({
  args: { digitalPaperId: v.id("digitalPapers") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row) return;
    if (row.questions.length === 0) {
      await ctx.db.patch(args.digitalPaperId, {
        status: "failed",
        error:
          "No multiple-choice questions could be detected in this paper. It may be a " +
          "scanned image without a text layer, or a free-response paper. Open the " +
          "original PDF instead.",
        updatedAt: Date.now(),
      });
      return;
    }
    const renumbered = row.questions.map((q, i) => ({ ...q, number: i + 1 }));
    await ctx.db.patch(args.digitalPaperId, {
      status: "ready",
      questions: renumbered,
      questionCount: renumbered.length,
      updatedAt: Date.now(),
    });
  },
});

export const failDigitization = internalMutation({
  args: { digitalPaperId: v.id("digitalPapers"), error: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row || row.status !== "processing") return;
    await ctx.db.patch(args.digitalPaperId, {
      status: "failed",
      error: args.error.slice(0, 500),
      updatedAt: Date.now(),
    });
  },
});

// ─── AI transcription (the action the client streams chunks into) ────────

const SYSTEM_PROMPT = `You are an exam-paper transcription engine for Learnyx Academy ET. You receive plain text extracted from an Ethiopian national exam past paper (may include headers, instructions, formatting noise, and possibly an answer-key section).

TASK: transcribe the MULTIPLE-CHOICE questions that literally appear in the text.

STRICT RULES:
1. TRANSCRIBE, NEVER INVENT. Only output questions whose wording appears in the text. Copy the question text and option texts verbatim (trim surrounding whitespace, join lines that one sentence was split across). Never paraphrase, never complete a half-visible question, never add questions from your own knowledge.
2. Ignore instructions, cover pages, codes, and anything that is not a multiple-choice question.
3. If the text contains an ANSWER KEY (e.g. "1. B   2. D" or a key table), attach the matching letter to each question's "answer". If there is no key, omit "answer" entirely — do NOT guess.
4. If a question references a shared stimulus (a reading passage, a table, a graph description) that is present in the text, put that stimulus text in "passage". Omit when there is none.
5. "explanation": ONLY if the paper itself provides an explanation/solution. Otherwise omit.
6. Options: label letters exactly as printed (A/B/C/D, or ሀ/ሁ etc. mapped to A-D in order printed). Every question must have between 2 and 6 options with non-empty text.
7. Output ONLY a JSON array — no prose, no markdown fences.

JSON shape:
[{"number": 1, "text": "...", "passage": "optional", "options": [{"label":"A","text":"..."},...], "answer": "B", "explanation": "optional", "topic": "optional short topic"}]

If the chunk contains no complete multiple-choice questions, output []`;

interface RawQuestion {
  number?: unknown;
  text?: unknown;
  passage?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
  topic?: unknown;
}

const LABELS = "ABCDEFGH";

/** Validate + normalize one AI-returned question. Returns null to drop. */
function sanitizeQuestion(raw: RawQuestion): SanitizedQuestion | null {
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (text.length < 3 || text.length > 2000) return null;

  if (!Array.isArray(raw.options)) return null;
  const options: { label: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const opt of raw.options as { label?: unknown; text?: unknown }[]) {
    const optText = typeof opt?.text === "string" ? opt.text.trim() : "";
    if (optText.length === 0 || optText.length > 500) return null;
    // Re-label A, B, C… in printed order — papers with non-Latin option
    // markers get normalized here, and duplicate/missing labels can't happen.
    const label = LABELS[options.length];
    if (!label) return null; // more than 8 options — malformed
    if (!seen.has(optText)) {
      seen.add(optText);
      options.push({ label, text: optText });
    }
  }
  if (options.length < 2) return null;

  const answer =
    typeof raw.answer === "string" && /^[A-H]$/.test(raw.answer.trim().toUpperCase())
      ? raw.answer.trim().toUpperCase()
      : undefined;

  const passage = typeof raw.passage === "string" && raw.passage.trim().length > 0
    ? raw.passage.trim().slice(0, 4000)
    : undefined;
  const explanation = typeof raw.explanation === "string" && raw.explanation.trim().length > 0
    ? raw.explanation.trim().slice(0, 1200)
    : undefined;
  const topic = typeof raw.topic === "string" && raw.topic.trim().length > 0
    ? raw.topic.trim().slice(0, 60)
    : undefined;

  return {
    number: 0, // renumbered 1..N on completion
    text: text.slice(0, 2000),
    passage,
    options,
    answer: answer && options.some((o) => o.label === answer) ? answer : undefined,
    explanation,
    topic,
  };
}

type SanitizedQuestion = {
  number: number;
  text: string;
  passage?: string;
  options: { label: string; text: string }[];
  answer?: string;
  explanation?: string;
  topic?: string;
};

/** Pull the JSON array out of a model response (tolerates fences/prose). */
function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Groq call with 429-aware backoff. Free-tier TPM limits (e.g. 8k TPM on
 * gpt-oss-120b) make chunk-3-of-N failures routine without this. Groq's
 * error message includes the exact cooldown ("Please try again in 16.62s")
 * — we honor it, capped so the action never approaches its timeout budget.
 */
async function callGroqWithRetry(
  ctx: Parameters<typeof callGroq>[0],
  opts: Parameters<typeof callGroq>[1],
  maxRetries = 2,
): Promise<string> {
  let attempt = 0;
  for (;;) {
    try {
      return await callGroq(ctx, opts);
    } catch (err) {
      const message = (err as Error).message ?? "";
      const is429 = message.includes("429") || message.toLowerCase().includes("rate limit");
      if (!is429 || attempt >= maxRetries) throw err;
      const match = message.match(/try again in\s*([\d.]+)\s*s/i);
      const cooldownS = match ? parseFloat(match[1]!) : 20;
      const waitMs = Math.min(28_000, Math.max(3_000, Math.ceil(cooldownS * 1000) + 2_500));
      await new Promise((r) => setTimeout(r, waitMs));
      attempt += 1;
    }
  }
}

/**
 * Transcribe one chunk of PDF text into questions. Called sequentially by
 * the client (sequence guard in appendParsedChunk enforces order). The
 * action itself appends and, on the final chunk, completes the job — so a
 * client crash mid-pipeline still leaves a consistent (stale) row that a
 * later beginDigitization can replace.
 *
 * This is an ACTION (not a mutation) because it calls the Groq HTTP API.
 */
export const parsePaperChunk = action({
  args: {
    contentId: v.id("contentItems"),
    digitalPaperId: v.id("digitalPapers"),
    chunkIndex: v.number(),
    chunkCount: v.number(),
    pageCount: v.number(),
    text: v.string(),
  },
  handler: async (ctx, args): Promise<{ questionsFound: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const row = await ctx.runQuery(internal.examPrepDigital.getDigitizationRowStatus, {
      digitalPaperId: args.digitalPaperId,
    });
    if (!row || row.status !== "processing") {
      // Someone else's job finished/restarted between our calls — tell the
      // client to stop pushing chunks rather than fail loudly.
      return { questionsFound: 0 };
    }
    if (args.text.trim().length === 0) {
      // Nothing to transcribe in this chunk — still count it as parsed so
      // the sequence guard advances.
      await ctx.runMutation(internal.examPrepDigital.appendParsedChunk, {
        digitalPaperId: args.digitalPaperId,
        chunkIndex: args.chunkIndex,
        chunkCount: args.chunkCount,
        pageCount: args.pageCount,
        questions: [],
      });
      if (args.chunkIndex === args.chunkCount - 1) {
        await ctx.runMutation(internal.examPrepDigital.completeDigitization, {
          digitalPaperId: args.digitalPaperId,
        });
      }
      return { questionsFound: 0 };
    }

    const userMessage = `PAPER CHUNK ${args.chunkIndex + 1} OF ${args.chunkCount} (pages of an Ethiopian national exam past paper):\n\n${args.text.slice(0, 14000)}`;

    let raw: string;
    let parsed: unknown[] | null;
    try {
      raw = await callGroqWithRetry(ctx, {
        systemPrompt: SYSTEM_PROMPT,
        userMessage,
        maxTokens: 12288,
        temperature: 0.1,
      });
    } catch (err) {
      await ctx.runMutation(internal.examPrepDigital.failDigitization, {
        digitalPaperId: args.digitalPaperId,
        error: `AI transcription failed on chunk ${args.chunkIndex + 1}: ${(err as Error).message}`,
      });
      throw err;
    }

    parsed = extractJsonArray(raw);
    if (parsed === null) {
      // One honest retry — models occasionally wrap the array in prose.
      try {
        raw = await callGroqWithRetry(ctx, {
          systemPrompt: SYSTEM_PROMPT,
          userMessage: `${userMessage}\n\nYour previous reply was not a parseable JSON array. Return ONLY the JSON array.`,
          maxTokens: 12288,
          temperature: 0,
        });
        parsed = extractJsonArray(raw);
      } catch (err) {
        await ctx.runMutation(internal.examPrepDigital.failDigitization, {
          digitalPaperId: args.digitalPaperId,
          error: `AI transcription failed on chunk ${args.chunkIndex + 1}: ${(err as Error).message}`,
        });
        throw err;
      }
    }
    if (parsed === null) {
      await ctx.runMutation(internal.examPrepDigital.failDigitization, {
        digitalPaperId: args.digitalPaperId,
        error: `The AI response for chunk ${args.chunkIndex + 1} was not valid JSON. Try again.`,
      });
      throw new ConvexError("AI response was not valid JSON.");
    }

    const questions: SanitizedQuestion[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object") {
        const q = sanitizeQuestion(item as RawQuestion);
        if (q) questions.push(q);
      }
    }

    await ctx.runMutation(internal.examPrepDigital.appendParsedChunk, {
      digitalPaperId: args.digitalPaperId,
      chunkIndex: args.chunkIndex,
      chunkCount: args.chunkCount,
      pageCount: args.pageCount,
      questions,
    });

    if (args.chunkIndex === args.chunkCount - 1) {
      await ctx.runMutation(internal.examPrepDigital.completeDigitization, {
        digitalPaperId: args.digitalPaperId,
      });
    }

    return { questionsFound: questions.length };
  },
});

// ─── Reads ───────────────────────────────────────────────────────────────

/**
 * The digitized paper. Metadata is available to any signed-in user (the hub
 * badges use it); the questions themselves are premium-gated when the
 * source paper is premium — matching the Reader's download gating exactly.
 */
export const getDigitalPaper = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const row = await ctx.db
      .query("digitalPapers")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!row) return null;

    const item: Doc<"contentItems"> | null = await ctx.db.get(args.contentId);
    const needsPremium = Boolean(item?.isPremium);
    let hasPremium = false;
    if (needsPremium) {
      const sub = await ctx.db
        .query("subscriptions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      hasPremium = isPremiumStatus(sub?.status);
    }

    return {
      _id: row._id,
      contentId: row.contentId,
      status: row.status,
      questionCount: row.questionCount,
      pageCount: row.pageCount ?? null,
      chunkCount: row.chunkCount ?? null,
      chunksParsed: row.chunksParsed ?? null,
      error: row.error ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      startedByMe: row.startedBy === userId,
      // Questions only when the caller may see them.
      questions: needsPremium && !hasPremium ? null : row.questions,
      premiumLocked: needsPremium && !hasPremium,
    };
  },
});

/**
 * Statuses for the hub's paper cards. Pass the ids already loaded by
 * getExamPrepPapers — value-stable args keep this from re-subscribing.
 */
export const getDigitalPaperStatuses = query({
  args: { contentIds: v.array(v.id("contentItems")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const out: { contentId: string; status: string; questionCount: number }[] = [];
    // Chunk the lookups — a .filter() over a bounded take avoids a full
    // table scan when the library is small, and by_content lookups stay
    // index-driven per id.
    for (const contentId of args.contentIds.slice(0, 1000)) {
      const row = await ctx.db
        .query("digitalPapers")
        .withIndex("by_content", (q) => q.eq("contentId", contentId))
        .unique();
      if (row) {
        out.push({
          contentId,
          status: row.status,
          questionCount: row.questionCount,
        });
      }
    }
    return out;
  },
});

// ─── Attempt persistence ─────────────────────────────────────────────────

/**
 * Persist one digital attempt (Practice OR Exam) into examPrepAttempts —
 * the same table the legacy PDF Exam Mode writes, so My Results and the
 * readiness signal see one continuous history. Best-effort from the client:
 * a logging failure must never block the results screen.
 */
export const logDigitalAttempt = mutation({
  args: {
    contentId: v.id("contentItems"),
    mode: v.union(v.literal("exam"), v.literal("practice")),
    startedAt: v.number(),
    endedAt: v.number(),
    durationSeconds: v.number(),
    completed: v.boolean(),
    autoScorePct: v.optional(v.number()),
    questionsTotal: v.optional(v.number()),
    questionsCorrect: v.optional(v.number()),
    questionsAnswered: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const item = await ctx.db.get(args.contentId);
    if (!item) throw new ConvexError({ message: "Paper not found.", code: "not_found" });

    const durationSeconds = Math.max(0, Math.min(args.durationSeconds, 24 * 3600));
    const clampPct = (n?: number) =>
      n === undefined ? undefined : Math.max(0, Math.min(100, Math.round(n)));

    const attemptId = await ctx.db.insert("examPrepAttempts", {
      userId,
      contentId: args.contentId,
      startedAt: args.startedAt,
      endedAt: args.endedAt,
      durationSeconds,
      completed: args.completed,
      mode: args.mode,
      autoScorePct: clampPct(args.autoScorePct),
      questionsTotal: args.questionsTotal,
      questionsCorrect: args.questionsCorrect,
      questionsAnswered: args.questionsAnswered,
    });
    return { attemptId };
  },
});
