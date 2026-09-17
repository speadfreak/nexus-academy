// Digital exam engine backend — auto-converts every past-exam PDF into a
// fully digital, question-by-question paper. V2.
//
// PIPELINE (who does what):
//   1. beginDigitization  (mutation, client)  — the RATE GUARD + claim.
//      Every conversion on the platform passes through a queue row
//      (examConversionJobs). At most MAX_CONCURRENT_CONVERSIONS fresh
//      claims platform-wide — free-tier AI providers stay alive even when
//      a whole class opens papers at once. Students waiting for a slot see
//      their live queue position; student-demanded jobs always dequeue
//      ahead of admin batch jobs.
//   2. Client extracts the PDF text locally (pdf.js — same engine the
//      Reader uses) and streams page-aligned chunks to:
//   3. parsePaperChunk    (action, client)    — Groq transcription with a
//      strict "transcribe, never invent" prompt. Scanned papers (no text
//      layer) take the VISION path instead: the client renders each page
//      to a JPEG and streams it to parsePaperPageImage (Groq vision model
//      = honest OCR). Each chunk/page appends through the internal
//      sequence-guarded appendParsedChunk; the last one completes the job
//      (renumber 1..N, flip ready, mark the row "ai_unverified").
//   4. getDigitalPaper / getDigitalPaperStatuses (queries) — the player and
//      the hub badges read from here.
//
// QUESTION KINDS (v2 — fixes the old "Conversion didn't make it" dead end):
//   • "mcq"        — lettered options; what v1 handled exclusively.
//   • "structured" — numbered free-response / show-that / workout
//     questions with NO options. Practice mode reveals a suggested
//     answer (only when the paper itself provides one) for self-grading.
//   A paper that previously failed because it had zero MCQs now converts
//   as a structured paper. A paper that failed because it is a pure
//   image scan now converts through the vision path.
//
// HONESTY RULES baked into the backend:
//   - The AI is told to transcribe ONLY questions that literally appear
//     in the text/image. It may attach an answer/solution only when the
//     paper itself states one (answer-key page); otherwise the fields
//     stay empty and the UI labels anything shown as AI-suggested.
//   - Every ready row starts "ai_unverified": the player shows an honest
//     badge until an admin verifies it in the Exam Engine console.
//   - figureHint is DETECTED BY REGEX, not by the AI — a question that
//     references a figure/diagram/table always offers "View original
//     page" so no diagram is silently lost.
//   - Question text is stored verbatim (trimmed) — no rewriting.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import type { GenericActionCtx } from "convex/server";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isPremiumStatus } from "./subscriptions";
import { callGroq, getVisionModelName } from "./groq";
import { MAX_CONCURRENT_CONVERSIONS, PROCESSING_MS_HINT } from "./examPrepDigitalConstants";

// Platform-wide conversion concurrency + claim freshness live in
// examPrepDigitalConstants.ts (shared with the admin console).

const rawQuestionValidator = v.object({
  number: v.number(),
  kind: v.optional(v.union(v.literal("mcq"), v.literal("structured"))),
  text: v.string(),
  passage: v.optional(v.string()),
  options: v.array(v.object({ label: v.string(), text: v.string() })),
  answer: v.optional(v.string()),
  suggestedAnswer: v.optional(v.string()),
  explanation: v.optional(v.string()),
  topic: v.optional(v.string()),
  sourcePage: v.optional(v.number()),
});

// ─── Queue helpers (internal) ────────────────────────────────────────────

/** Count fresh running claims + the waiting line ahead of `contentId`. */
async function queueSnapshot(
  ctx: { db: any },
  contentId: Id<"examConversionJobs"> | null,
): Promise<{ running: number; ahead: number }> {
  const freshCutoff = Date.now() - PROCESSING_MS_HINT;
  const runningRows = await ctx.db
    .query("examConversionJobs")
    .withIndex("by_status", (q: any) => q.eq("status", "running"))
    .collect();
  const running = runningRows.filter(
    (j: Doc<"examConversionJobs">) => (j.claimedAt ?? 0) >= freshCutoff,
  ).length;

  let ahead = 0;
  if (contentId) {
    const me = await ctx.db.get(contentId);
    if (me && me.status === "queued") {
      const queuedRows = await ctx.db
        .query("examConversionJobs")
        .withIndex("by_status", (q: any) => q.eq("status", "queued"))
        .collect();
      // Students first, then FIFO within each priority.
      const rank = (j: Doc<"examConversionJobs">) =>
        (j.priority === "student" ? 0 : 1) * 1e15 + j.createdAt;
      const myRank = rank(me);
      ahead = queuedRows.filter((j: Doc<"examConversionJobs">) => rank(j) < myRank).length;
    }
  }
  return { running, ahead };
}

/**
 * Find (or create) the queue row for a paper and reset it to a claimable
 * state. Returns the row id.
 */
async function ensureJobQueued(
  ctx: { db: any },
  contentId: Id<"contentItems">,
  userId: Id<"users">,
  demand: "student" | "batch",
): Promise<Id<"examConversionJobs">> {
  const existing = await ctx.db
    .query("examConversionJobs")
    .withIndex("by_content", (q: any) => q.eq("contentId", contentId))
    .unique();
  const now = Date.now();
  if (existing) {
    if (existing.status === "queued") {
      // A student waiting right now outranks any batch enqueue.
      if (demand === "student" && existing.priority !== "student") {
        await ctx.db.patch(existing._id, { priority: "student", updatedAt: now });
      }
      return existing._id;
    }
    if (existing.status === "running" && now - existing.updatedAt < PROCESSING_MS_HINT) {
      return existing._id; // someone is actively converting — keep it
    }
    // done/failed/stale-running → back into the line for a fresh run.
    await ctx.db.patch(existing._id, {
      status: "queued",
      priority: demand,
      claimedBy: undefined,
      claimedAt: undefined,
      lastError: undefined,
      updatedAt: now,
    });
    return existing._id;
  }
  return ctx.db.insert("examConversionJobs", {
    contentId,
    priority: demand,
    status: "queued",
    attempts: 0,
    enqueuedBy: userId,
    createdAt: now,
    updatedAt: now,
  });
}

// ─── Claim / dedupe the conversion job ──────────────────────────────────

export type BeginDigitizationResult =
  | { kind: "ready"; digitalPaperId: string }
  | { kind: "processing"; digitalPaperId: string }
  | { kind: "queued"; ahead: number; jobId: string }
  | { kind: "claimed"; digitalPaperId: string };

/**
 * Claim a conversion slot for this paper. Returns the current state so the
 * client knows what to do:
 *   { kind: "ready" }         — a digitized version already exists; play it
 *   { kind: "processing" }    — someone (possibly you) is converting now
 *   { kind: "queued", ahead } — the platform is at capacity; poll again
 *   { kind: "claimed", digitalPaperId } — you own the job; start extracting
 *
 * `forceVision` pre-declares the page-image OCR path (used by the
 * "Retry with page-image OCR" affordance after a no-text-layer failure).
 *
 * `asBatch` marks the claim as AUTOPILot capacity (admin worker / crowd
 * worker converting the library ahead of demand). Batch claims never bump
 * a queued job's priority — a student who opens the paper still outranks
 * every pre-conversion. Only an explicit student open (asBatch absent)
 * upgrades the job to "student" priority.
 */
export const beginDigitization = mutation({
  args: {
    contentId: v.id("contentItems"),
    forceVision: v.optional(v.boolean()),
    asBatch: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<BeginDigitizationResult> => {
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
      if (existing.status === "ready" && existing.verification !== "rejected") {
        return { kind: "ready", digitalPaperId: existing._id };
      }
      if (
        existing.status === "processing" &&
        now - existing.updatedAt < PROCESSING_MS_HINT
      ) {
        return { kind: "processing", digitalPaperId: existing._id };
      }
      // Failed, rejected by an admin, or a stale interrupted conversion —
      // replace it wholesale. (Questions may have been partially appended;
      // a clean row keeps the sequence guard honest.)
      await ctx.db.delete(existing._id);
    }

    // ── The rate guard: queue row + platform concurrency cap ──
    const demand: "student" | "batch" = args.asBatch ? "batch" : "student";
    const jobId = await ensureJobQueued(ctx, args.contentId, userId, demand);
    const job = await ctx.db.get(jobId);
    if (job && job.status === "running" && now - job.updatedAt < PROCESSING_MS_HINT) {
      return { kind: "processing", digitalPaperId: existing?._id ?? "" };
    }
    const { running, ahead } = await queueSnapshot(ctx, jobId);
    if (running >= MAX_CONCURRENT_CONVERSIONS && job?.status === "queued") {
      return { kind: "queued", ahead, jobId };
    }

    // Claim the slot.
    await ctx.db.patch(jobId, {
      status: "running",
      claimedAt: now,
      updatedAt: now,
      attempts: (job?.attempts ?? 0) + 1,
    });

    const id = await ctx.db.insert("digitalPapers", {
      contentId: args.contentId,
      status: "processing",
      questions: [],
      questionCount: 0,
      chunksParsed: 0,
      sourceMode: args.forceVision ? "vision" : "text",
      startedBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: "claimed", digitalPaperId: id };
  },
});

/**
 * Live queue position for a waiting student. Reactive — the waiting
 * screen re-renders as the line moves. `ahead: -1` means "claimable now".
 */
export const getQueuePosition = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args): Promise<{ status: string; ahead: number } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const job = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .unique();
    if (!job) return null;
    if (job.status === "queued") {
      const { ahead } = await queueSnapshot(ctx, job._id);
      return { status: "queued", ahead };
    }
    return { status: job.status, ahead: -1 };
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
    // 1-based page the chunk starts on — backfills sourcePage for any
    // question where the AI omitted (or garbled) its page attribution.
    fallbackPage: v.optional(v.number()),
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
    const clampedQuestions = args.questions.map((q) => ({
      ...q,
      sourcePage:
        q.sourcePage && q.sourcePage >= 1 && q.sourcePage <= args.pageCount
          ? q.sourcePage
          : args.fallbackPage,
    }));
    await ctx.db.patch(args.digitalPaperId, {
      questions: [...row.questions, ...clampedQuestions],
      chunksParsed: parsed + 1,
      chunkCount: args.chunkCount,
      pageCount: args.pageCount,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Finalize a conversion: renumber questions 1..N, stamp the row
 * "ai_unverified", and mark the queue job done. A zero-question result is
 * an honest failure with guidance that matches WHY (text layer present?).
 */
export const completeDigitization = internalMutation({
  args: { digitalPaperId: v.id("digitalPapers") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.digitalPaperId);
    if (!row) return;
    const now = Date.now();
    if (row.questions.length === 0) {
      await ctx.db.patch(args.digitalPaperId, {
        status: "failed",
        error:
          row.sourceMode === "vision"
            ? "Page-image OCR could not find any questions in this paper. An admin can retry it from the Exam Engine console, or you can open the original PDF."
            : "No questions could be detected in the text layer. If this paper is a scan, use 'Try page-image OCR' — Learnyx will read the pages as pictures instead.",
        updatedAt: now,
      });
      await markJobByContent(ctx, row.contentId, "failed", row.error);
      return;
    }
    const renumbered = row.questions.map((q, i) => ({ ...q, number: i + 1 }));
    await ctx.db.patch(args.digitalPaperId, {
      status: "ready",
      questions: renumbered,
      questionCount: renumbered.length,
      verification: row.verification ?? "ai_unverified",
      updatedAt: now,
    });
    await markJobByContent(ctx, row.contentId, "done");
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
    await markJobByContent(ctx, row.contentId, "failed", args.error);
  },
});

/** Keep the queue job row in step with the digitalPapers row. */
async function markJobByContent(
  ctx: { db: any },
  contentId: Id<"contentItems">,
  status: "done" | "failed",
  error?: string,
) {
  const job = await ctx.db
    .query("examConversionJobs")
    .withIndex("by_content", (q: any) => q.eq("contentId", contentId))
    .unique();
  if (!job) return;
  await ctx.db.patch(job._id, {
    status,
    lastError: error ? String(error).slice(0, 500) : undefined,
    updatedAt: Date.now(),
    doneAt: status === "done" ? Date.now() : job.doneAt,
  });
}

// ─── AI transcription — TEXT path (text-layer PDFs) ──────────────────────

const SYSTEM_PROMPT = `You are an exam-paper transcription engine for Learnyx Academy ET. You receive plain text extracted from an Ethiopian national exam past paper (may include headers, instructions, formatting noise, and possibly an answer-key section). Page boundaries are marked with lines like "=== PAGE 3 ===".

TASK: transcribe the questions that literally appear in the text. Two kinds exist:

1. kind "mcq" — questions with lettered options (A/B/C/D, a) (a), ሀ/ሁ/ለ… mapped to A-D in printed order). Every mcq must have between 2 and 8 options with non-empty text.
2. kind "structured" — numbered questions WITHOUT options: definitions, "show that", "calculate/workout", short-answer, essay prompts. Output options: [] for these. Do NOT force option letters onto a question that has none.

STRICT RULES:
1. TRANSCRIBE, NEVER INVENT. Only output questions whose wording appears in the text. Copy the question text and option texts verbatim (trim surrounding whitespace, join lines that one sentence was split across). Never paraphrase, never complete a half-visible question, never add questions from your own knowledge.
2. Ignore instructions, cover pages, codes, and anything that is not a question.
3. If the text contains an ANSWER KEY (e.g. "1. B   2. D" or a key table), attach the matching letter to each mcq's "answer". For a structured question, if the paper provides its full solution/marking scheme, put it in "suggestedAnswer". If there is no key, omit both — do NOT guess.
4. If a question references a shared stimulus (a reading passage, a table, a graph description) that is present in the text, put that stimulus text in "passage". Omit when there is none.
5. "sourcePage": the integer page number (from the === PAGE N === markers) the question was printed on.
6. "explanation": ONLY if the paper itself provides an explanation/solution. Otherwise omit.
7. Output ONLY a JSON array — no prose, no markdown fences.

JSON shape:
[{"number": 1, "kind": "mcq", "text": "...", "passage": "optional", "options": [{"label":"A","text":"..."},...], "answer": "B", "explanation": "optional", "topic": "optional short topic", "sourcePage": 3}]

structured questions use the same shape with "kind":"structured", "options":[] and optionally "suggestedAnswer".

If the chunk contains no complete questions, output []`;

interface RawQuestion {
  number?: unknown;
  kind?: unknown;
  text?: unknown;
  passage?: unknown;
  options?: unknown;
  answer?: unknown;
  suggestedAnswer?: unknown;
  explanation?: unknown;
  topic?: unknown;
  sourcePage?: unknown;
}

const LABELS = "ABCDEFGH";

/** Deterministic figure/diagram/table reference detection (never the AI). */
const FIGURE_RE =
  /\b(figure|fig\.|diagram|graph|map|chart|table|illustration|circuit|picture|image|drawing|plot)\b/i;

/** Validate + normalize one AI-returned question. Returns null to drop. */
function sanitizeQuestion(raw: RawQuestion): SanitizedQuestion | null {
  const text = typeof raw.text === "string" ? raw.text.trim() : "";
  if (text.length < 3 || text.length > 2000) return null;

  const kind = raw.kind === "structured" ? "structured" : "mcq";

  const passage = typeof raw.passage === "string" && raw.passage.trim().length > 0
    ? raw.passage.trim().slice(0, 4000)
    : undefined;
  const explanation = typeof raw.explanation === "string" && raw.explanation.trim().length > 0
    ? raw.explanation.trim().slice(0, 1200)
    : undefined;
  const topic = typeof raw.topic === "string" && raw.topic.trim().length > 0
    ? raw.topic.trim().slice(0, 60)
    : undefined;

  const sourcePage =
    typeof raw.sourcePage === "number" && Number.isFinite(raw.sourcePage) &&
    raw.sourcePage >= 1 && raw.sourcePage <= 999
      ? Math.round(raw.sourcePage)
      : undefined;

  const figureHint = FIGURE_RE.test(text) || (passage ? FIGURE_RE.test(passage) : false);

  if (kind === "structured") {
    // Free-response: no options. suggestedAnswer ONLY from the paper itself.
    const suggested =
      typeof raw.suggestedAnswer === "string" && raw.suggestedAnswer.trim().length > 0
        ? raw.suggestedAnswer.trim().slice(0, 4000)
        : undefined;
    return {
      number: 0, // renumbered 1..N on completion
      kind,
      text: text.slice(0, 2000),
      passage,
      options: [],
      suggestedAnswer: suggested,
      explanation,
      topic,
      sourcePage,
      figureHint,
    };
  }

  // ── mcq path ──
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

  return {
    number: 0,
    kind,
    text: text.slice(0, 2000),
    passage,
    options,
    answer: answer && options.some((o) => o.label === answer) ? answer : undefined,
    explanation,
    topic,
    sourcePage,
    figureHint,
  };
}

type SanitizedQuestion = {
  number: number;
  kind: "mcq" | "structured";
  text: string;
  passage?: string;
  options: { label: string; text: string }[];
  answer?: string;
  suggestedAnswer?: string;
  explanation?: string;
  topic?: string;
  sourcePage?: number;
  figureHint?: boolean;
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
  ctx: GenericActionCtx<any>,
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
 * Shared completion step for both paths: append the chunk (sequence
 * guarded) and, on the final chunk, complete the job.
 */
async function appendAndMaybeComplete(
  ctx: GenericActionCtx<any>,
  args: {
    digitalPaperId: string;
    chunkIndex: number;
    chunkCount: number;
    pageCount: number;
    fallbackPage?: number;
    questions: SanitizedQuestion[];
  },
) {
  await ctx.runMutation(internal.examPrepDigital.appendParsedChunk, {
    digitalPaperId: args.digitalPaperId as never,
    chunkIndex: args.chunkIndex,
    chunkCount: args.chunkCount,
    pageCount: args.pageCount,
    fallbackPage: args.fallbackPage,
    questions: args.questions as never,
  });
  if (args.chunkIndex === args.chunkCount - 1) {
    await ctx.runMutation(internal.examPrepDigital.completeDigitization, {
      digitalPaperId: args.digitalPaperId as never,
    });
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
    fallbackPage: v.optional(v.number()),
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
      await appendAndMaybeComplete(ctx, {
        digitalPaperId: args.digitalPaperId,
        chunkIndex: args.chunkIndex,
        chunkCount: args.chunkCount,
        pageCount: args.pageCount,
        fallbackPage: args.fallbackPage,
        questions: [],
      });
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

    await appendAndMaybeComplete(ctx, {
      digitalPaperId: args.digitalPaperId,
      chunkIndex: args.chunkIndex,
      chunkCount: args.chunkCount,
      pageCount: args.pageCount,
      fallbackPage: args.fallbackPage,
      questions,
    });

    return { questionsFound: questions.length };
  },
});

// ─── AI transcription — VISION path (scanned papers, no text layer) ─────

const VISION_SYSTEM_PROMPT = `You are an exam-paper OCR transcription engine for Learnyx Academy ET. You receive ONE photographed/scanned page image of an Ethiopian national exam past paper (may include headers, instructions, figures, and possibly an answer-key section).

TASK: transcribe the questions that are legible in the image. Two kinds exist:

1. kind "mcq" — questions with lettered options (A/B/C/D, a) (a), ሀ/ሁ/ለ… mapped to A-D in printed order). Every mcq must have between 2 and 8 options with non-empty text.
2. kind "structured" — numbered questions WITHOUT options: definitions, "show that", "calculate/workout", short-answer, essay prompts. Output options: [] for these.

STRICT RULES:
1. TRANSCRIBE, NEVER INVENT. Only output questions you can actually read in the image. Copy wording verbatim. If part of a question is cut off at the page edge or too illegible to read, SKIP that question entirely — do not guess or complete it.
2. Ignore instructions, cover pages, codes, and anything that is not a question.
3. Figures/diagrams/graphs: transcribe the question text around them. Never try to describe a figure in the question text — the app shows the real page image to the student.
4. If the page contains an ANSWER KEY, attach the matching letter to each mcq's "answer"; for structured questions put the provided solution in "suggestedAnswer". Omit when there is no key — do NOT guess.
5. "sourcePage": always the integer page number given in the user message.
6. Output ONLY a JSON array — no prose, no markdown fences.

JSON shape:
[{"number": 1, "kind": "mcq", "text": "...", "passage": "optional", "options": [{"label":"A","text":"..."},...], "answer": "B", "sourcePage": 3}]

If the page contains no complete legible questions, output []`;

/**
 * Transcribe ONE scanned page image (JPEG base64 data URL) into questions
 * via a Groq vision model. The client renders pages with pdf.js at a
 * readable scale and streams them sequentially — chunkIndex = pageNumber-1
 * keeps the same sequence guard as the text path.
 */
export const parsePaperPageImage = action({
  args: {
    contentId: v.id("contentItems"),
    digitalPaperId: v.id("digitalPapers"),
    pageNumber: v.number(),
    pageCount: v.number(),
    imageBase64: v.string(), // "data:image/jpeg;base64,..."
  },
  handler: async (ctx, args): Promise<{ questionsFound: number }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    if (!args.imageBase64.startsWith("data:image/")) {
      throw new ConvexError("Page image payload must be a base64 image data URL.");
    }

    const row = await ctx.runQuery(internal.examPrepDigital.getDigitizationRowStatus, {
      digitalPaperId: args.digitalPaperId,
    });
    if (!row || row.status !== "processing") return { questionsFound: 0 };

    const chunkIndex = args.pageNumber - 1;
    const userMessage = `SCAN PAGE ${args.pageNumber} OF ${args.pageCount} of an Ethiopian national exam past paper. sourcePage for every question on this page is ${args.pageNumber}.`;

    let raw: string;
    let parsed: unknown[] | null;
    try {
      raw = await callGroqWithRetry(
        ctx,
        {
          systemPrompt: VISION_SYSTEM_PROMPT,
          userMessage,
          images: [args.imageBase64],
          model: getVisionModelName(),
          maxTokens: 8192,
          temperature: 0.1,
        },
        3, // vision free-tier RPM is tight — one extra retry is worth it
      );
    } catch (err) {
      await ctx.runMutation(internal.examPrepDigital.failDigitization, {
        digitalPaperId: args.digitalPaperId,
        error: `Page-image OCR failed on page ${args.pageNumber}: ${(err as Error).message}`,
      });
      throw err;
    }

    parsed = extractJsonArray(raw);
    if (parsed === null) {
      // One honest retry — vision models sometimes wrap the array.
      try {
        raw = await callGroqWithRetry(ctx, {
          systemPrompt: VISION_SYSTEM_PROMPT,
          userMessage: `${userMessage}\n\nYour previous reply was not a parseable JSON array. Return ONLY the JSON array.`,
          images: [args.imageBase64],
          model: getVisionModelName(),
          maxTokens: 8192,
          temperature: 0,
        });
        parsed = extractJsonArray(raw);
      } catch (err) {
        await ctx.runMutation(internal.examPrepDigital.failDigitization, {
          digitalPaperId: args.digitalPaperId,
          error: `Page-image OCR failed on page ${args.pageNumber}: ${(err as Error).message}`,
        });
        throw err;
      }
    }
    if (parsed === null) {
      // A single unreadable page must not kill the whole paper — record
      // the page as parsed-but-empty and keep going.
      await appendAndMaybeComplete(ctx, {
        digitalPaperId: args.digitalPaperId,
        chunkIndex,
        chunkCount: args.pageCount,
        pageCount: args.pageCount,
        fallbackPage: args.pageNumber,
        questions: [],
      });
      return { questionsFound: 0 };
    }

    const questions: SanitizedQuestion[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object") {
        const q = sanitizeQuestion(item as RawQuestion);
        if (q) questions.push(q);
      }
    }

    await appendAndMaybeComplete(ctx, {
      digitalPaperId: args.digitalPaperId,
      chunkIndex,
      chunkCount: args.pageCount,
      pageCount: args.pageCount,
      fallbackPage: args.pageNumber,
      questions,
    });

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
      // Trust surface: "ai_unverified" until an admin verifies the paper.
      verification: row.verification ?? (row.status === "ready" ? "ai_unverified" : null),
      adminEdited: row.adminEdited ?? false,
      sourceMode: row.sourceMode ?? "text",
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
    const out: {
      contentId: string;
      status: string;
      questionCount: number;
      verification: string | null;
    }[] = [];
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
          verification:
            row.status === "ready" ? row.verification ?? "ai_unverified" : null,
        });
      }
    }
    return out;
  },
});

// ─── Autopilot crowd-worker peek ─────────────────────────────────────────

/**
 * IDLE-CAPACITY PEEK for the crowd autopilot. Every signed-in Learnyx tab
 * (Exam Prep hub, admin console) polls this: when the platform's conversion
 * capacity is COMPLETELY idle — zero fresh running jobs, student-demanded
 * or otherwise — the oldest queued BATCH job is offered to this tab.
 *
 * The tab then runs the standard conversion pipeline (runPaperConversion
 * with asBatch) in the background. The moment ANY student-demanded
 * conversion is running, the peek returns null and every crowd worker
 * stands down — students who are actively waiting always own the free
 * tier. This is what makes "every paper already digital before a student
 * arrives" happen without a server-side browser.
 */
export const peekCrowdJob = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ contentId: string; title: string } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const freshCutoff = Date.now() - PROCESSING_MS_HINT;
    const running = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
    // Idle means idle: any fresh claim (student OR batch) silences the
    // whole crowd. Stale running rows older than the freshness window are
    // treated as dead and ignored.
    if (running.some((j) => (j.claimedAt ?? 0) >= freshCutoff)) return null;

    const queued = await ctx.db
      .query("examConversionJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    const next = queued
      .filter((j) => j.priority === "batch")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return null;

    const item = await ctx.db.get(next.contentId);
    if (!item) return null;
    return { contentId: next.contentId, title: item.title };
  },
});

// ─── Student question reports ("Report an issue with this question") ────

export const submitQuestionReport = mutation({
  args: {
    contentId: v.id("contentItems"),
    questionNumber: v.number(),
    category: v.union(
      v.literal("wrong_answer"),
      v.literal("garbled_text"),
      v.literal("missing_options"),
      v.literal("missing_figure"),
      v.literal("not_in_paper"),
      v.literal("other"),
    ),
    details: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });

    const details = args.details.trim().slice(0, 1000);
    if (details.length < 3) {
      throw new ConvexError({ message: "Tell us a little more so we can fix it.", code: "invalid" });
    }

    const existing = await ctx.db
      .query("examQuestionReports")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .filter((q) =>
        q.eq(q.field("questionNumber"), args.questionNumber)
        && q.eq(q.field("reportedBy"), userId)
        && q.eq(q.field("status"), "open"),
      )
      .first();

    const now = Date.now();
    if (existing) {
      // One live report per question per student — update it in place.
      await ctx.db.patch(existing._id, {
        category: args.category,
        details,
        updatedAt: now,
      });
      return { reportId: existing._id, updated: true as const };
    }
    const reportId = await ctx.db.insert("examQuestionReports", {
      contentId: args.contentId,
      questionNumber: args.questionNumber,
      category: args.category,
      details,
      reportedBy: userId,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });
    return { reportId, updated: false as const };
  },
});

/**
 * The signed-in student's own reports for one paper — the player marks
 * already-reported questions so the affordance stays honest.
 */
export const getMyQuestionReports = query({
  args: { contentId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return ctx.db
      .query("examQuestionReports")
      .withIndex("by_content", (q) => q.eq("contentId", args.contentId))
      .filter((q) => q.eq(q.field("reportedBy"), userId))
      .collect()
      .then((rows) =>
        rows.map((r) => ({
          questionNumber: r.questionNumber,
          status: r.status,
          category: r.category,
        })),
      );
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
