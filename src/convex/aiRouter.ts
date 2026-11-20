// AI provider routing layer — the rate-limit-proof brain behind the tutor.
//
// WHY THIS EXISTS: the tutor used to call Groq's free tier directly. Groq's
// free tier allows just 8,000 tokens-per-minute PER MODEL (org-wide), so a
// handful of students chatting at once exhausted the window and everyone
// saw "Groq API error 429 ... TPM Limit 8000, Requested 5848".
//
// THE FIX is a capacity-aware router across FOUR free-tier providers and
// nine models. For every tutor turn it:
//   1. Reads per-model capacity state from Convex (aiProviderState) —
//      cooldowns learned from real 429 responses ("try again in 5.6s"),
//      rolling RPM/TPM estimates, and RPD counters — and skips any model
//      that would hit a 429 BEFORE calling it.
//   2. Walks the remaining candidates best-quality-first and falls through
//      instantly on 429 / 5xx / 401 / timeout / dead model. The same
//      exhausted model is never retried within the same turn.
//   3. Writes what it learned back (cooldown until X, tokens used) so the
//      NEXT request routes around exhaustion before it happens.
//   4. Logs every hop into aiCallLog for the super-admin AI Health panel.
//
// PROVIDER FREE-TIER LIMITS (verified against official docs, Nov 2026 —
// these change often; they are PRE-ROUTE ESTIMATES here, the authoritative
// signal is always the provider's own 429 response):
//   Groq free (per model, org-wide): 30 RPM · 8,000 TPM · 1,000 RPD
//   Gemini free (3.x-flash family):  ~15-200 RPM · 250K+ TPM · ~1,400 RPD
//   Cerebras free:                   ~8 RPM · ~30K TPM · ~1M tokens/day
//   OpenRouter :free models:         20 RPM · 50-1,000 RPD
//
// KEYS (all optional — a provider without its key is simply skipped):
//   GROQ_API_KEY, GEMINI_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY
// Resolved from the configKeys table (Admin → Keys tab) first, then
// process.env. All four are registered in INTEGRATION_KEYS (configKeys.ts).

import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { resolveVisionModel } from "./groq";

// ---------------------------------------------------------------------------
// Token estimation + budgets (task 1: the token diet's enforcement arm)
// ---------------------------------------------------------------------------

/**
 * Rough token estimate. English/Latin prose ≈ 4 chars/token; Ge'ez, CJK and
 * other non-ASCII scripts run ≈ 1 token per character. Good enough for
 * budget enforcement — never used as a billing number.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4) + Math.ceil(nonAscii * 0.9);
}

/** Hard per-request INPUT budget — the diet the prompt builder must fit. */
export const HARD_INPUT_BUDGET_TOKENS = 6200;

// ---------------------------------------------------------------------------
// Model catalog — free-tier providers, best-quality-first for tutor turns
// ---------------------------------------------------------------------------

export type ProviderId = "groq" | "gemini" | "cerebras" | "openrouter";

export interface ModelSpec {
  key: string; // "<provider>/<model>" — the aiProviderState row key
  provider: ProviderId;
  model: string;
  quality: number; // route preference — higher is better
  vision: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
  rpm: number;
  tpm: number;
  rpd?: number;
  tokenParam: "max_tokens" | "max_completion_tokens";
  reasoningEffort?: boolean;
  /** Groq/OpenRouter rotate catalogs — a 404 disables the model for 6h. */
  unstable?: boolean;
}

const GROQ_LIMITS = { rpm: 30, tpm: 8000, rpd: 1000 };

export const QUALITY_ORDER: ModelSpec[] = [
  {
    key: "groq/openai/gpt-oss-120b",
    provider: "groq",
    model: "openai/gpt-oss-120b",
    quality: 95,
    vision: false,
    maxInputTokens: 6200,
    maxOutputTokens: 720,
    ...GROQ_LIMITS,
    tokenParam: "max_completion_tokens",
    reasoningEffort: true,
  },
  {
    key: "gemini/gemini-3.6-flash",
    provider: "gemini",
    model: "gemini-3.6-flash",
    quality: 90,
    vision: true,
    maxInputTokens: 10000,
    maxOutputTokens: 720,
    rpm: 30,
    tpm: 250000,
    rpd: 1400,
    tokenParam: "max_tokens",
  },
  {
    key: "groq/llama-3.3-70b-versatile",
    provider: "groq",
    model: "llama-3.3-70b-versatile",
    quality: 88,
    vision: false,
    maxInputTokens: 6200,
    maxOutputTokens: 720,
    ...GROQ_LIMITS,
    tokenParam: "max_tokens",
    unstable: true,
  },
  {
    key: "cerebras/gpt-oss-120b",
    provider: "cerebras",
    model: "gpt-oss-120b",
    quality: 86,
    vision: false,
    maxInputTokens: 6000,
    maxOutputTokens: 720,
    rpm: 8,
    tpm: 30000,
    tokenParam: "max_tokens",
    reasoningEffort: true,
  },
  {
    key: "groq/openai/gpt-oss-20b",
    provider: "groq",
    model: "openai/gpt-oss-20b",
    quality: 82,
    vision: false,
    maxInputTokens: 6200,
    maxOutputTokens: 720,
    ...GROQ_LIMITS,
    tokenParam: "max_completion_tokens",
    reasoningEffort: true,
  },
  {
    key: "openrouter/openrouter/free",
    provider: "openrouter",
    model: "openrouter/free",
    quality: 72,
    vision: false,
    maxInputTokens: 6000,
    maxOutputTokens: 720,
    rpm: 18,
    tpm: 60000,
    rpd: 48,
    tokenParam: "max_tokens",
  },
  {
    key: "cerebras/gemma-4-31b",
    provider: "cerebras",
    model: "gemma-4-31b",
    quality: 74,
    vision: false,
    maxInputTokens: 6000,
    maxOutputTokens: 720,
    rpm: 8,
    tpm: 30000,
    tokenParam: "max_tokens",
    unstable: true,
  },
  {
    key: "groq/llama-3.1-8b-instant",
    provider: "groq",
    model: "llama-3.1-8b-instant",
    quality: 62,
    vision: false,
    maxInputTokens: 6200,
    maxOutputTokens: 720,
    ...GROQ_LIMITS,
    tokenParam: "max_tokens",
    unstable: true,
  },
  {
    key: "openrouter/nvidia/nemotron-3.5-lightning:free",
    provider: "openrouter",
    model: "nvidia/nemotron-3.5-lightning:free",
    quality: 68,
    vision: false,
    maxInputTokens: 6000,
    maxOutputTokens: 720,
    rpm: 18,
    tpm: 60000,
    rpd: 48,
    tokenParam: "max_tokens",
    unstable: true,
  },
];

/** Preference order for lightweight helper turns (summaries, follow-ups). */
const TINY_ORDER: ModelSpec[] = [
  QUALITY_ORDER[7], // groq/llama-3.1-8b-instant — cheapest useful model
  QUALITY_ORDER[4], // groq/openai/gpt-oss-20b
  QUALITY_ORDER[1], // gemini-3.6-flash
  QUALITY_ORDER[5], // openrouter/free
];

export const PROVIDER_KEY_NAMES = [
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "CEREBRAS_API_KEY",
  "OPENROUTER_API_KEY",
] as const;

// ---------------------------------------------------------------------------
// Router-internal error type — adapters throw this to mean "skip me"
// ---------------------------------------------------------------------------

export type SkipKind =
  | "no_key"
  | "rate_limited"
  | "server_error"
  | "auth_error"
  | "model_missing"
  | "timeout"
  | "network"
  | "error";

export class RouterSkip extends Error {
  kind: SkipKind;
  provider: string;
  model: string;
  retryAfterMs?: number;
  constructor(kind: SkipKind, provider: string, model: string, detail: string, retryAfterMs?: number) {
    super(`[${provider}/${model}] ${kind}: ${detail}`);
    this.name = "RouterSkip";
    this.kind = kind;
    this.provider = provider;
    this.model = model;
    this.retryAfterMs = retryAfterMs;
  }
}

// ---------------------------------------------------------------------------
// Key resolution — one indexed read per provider key (cache within the turn)
// ---------------------------------------------------------------------------

async function hasKey(ctx: ActionCtx, keyName: string): Promise<boolean> {
  const v1 = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: keyName });
  if (v1) return true;
  // process.env fallback happens inside resolveConfigValue already; but for
  // env-only setups the config query returns it too. Double-check env here
  // for belt-and-braces (deployments where configKeys hasn't been written).
  return Boolean(process.env[keyName]);
}

async function resolveProviderKeys(ctx: ActionCtx): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>();
  for (const name of PROVIDER_KEY_NAMES) {
    map.set(name, await hasKey(ctx, name));
  }
  return map;
}

function apiKeyForProvider(map: Map<string, boolean>, provider: ProviderId): boolean {
  switch (provider) {
    case "groq": return map.get("GROQ_API_KEY") === true;
    case "gemini": return map.get("GEMINI_API_KEY") === true;
    case "cerebras": return map.get("CEREBRAS_API_KEY") === true;
    case "openrouter": return map.get("OPENROUTER_API_KEY") === true;
  }
}

// ---------------------------------------------------------------------------
// Rate-limit response parsing — headers + body patterns per provider
// ---------------------------------------------------------------------------

interface ParsedLimit {
  retryAfterMs?: number;
  kind: SkipKind;
}

/**
 * Extract "try again in X" from every shape providers use:
 *  - headers: retry-after, x-ratelimit-*
 *  - Groq body: "Please try again in 5.66s"
 *  - Gemini body: {"error":{"details":[{"retryDelay":"30s"}]}}
 *  - generic: "rate limit ... retry after 12s"
 */
export function parseRateLimitHints(
  status: number,
  headers: Headers,
  body: string,
): ParsedLimit {
  // --- classification first ---
  let kind: SkipKind = "error";
  if (status === 429) kind = "rate_limited";
  else if (status === 401 || status === 403) kind = "auth_error";
  else if (status === 404) kind = "model_missing";
  else if (status >= 500) kind = "server_error";

  if (status !== 429) {
    // Non-429 paths don't need a delay hint (auth/404 get fixed cooldowns,
    // 5xx gets a short default — decided by the caller).
    return { kind };
  }

  // 1. retry-after header (seconds, possibly fractional)
  const ra = headers.get("retry-after");
  if (ra) {
    const s = Number(ra);
    if (Number.isFinite(s) && s >= 0) return { kind, retryAfterMs: Math.ceil(s * 1000) };
  }

  // 2. Groq/Gemini body prose
  const bodySlice = body.slice(0, 4000);
  const patterns = [
    /try again in ([\d.]+)(ms|s|m)/i,
    /retry[- ]?(?:after|in)\s+([\d.]+)(ms|s|m)/i,
    /"retryDelay":\s*"([\d.]+)(ms|s|m)"/i,
  ];
  for (const re of patterns) {
    const m = bodySlice.match(re);
    if (m) {
      const value = Number(m[1]);
      const unit = m[2].toLowerCase();
      const ms = unit === "ms" ? value : unit === "s" ? value * 1000 : value * 60_000;
      if (Number.isFinite(ms) && ms > 0) {
        return { kind, retryAfterMs: Math.ceil(Math.min(ms, 120_000)) };
      }
    }
  }

  // 3. Groq-style "TPM: 8000 ... Requested 5848" — the request won't fit in
  //    the current window; the window is per-minute, so wait ~a minute.
  if (/TPM|tokens per minute/i.test(bodySlice)) {
    return { kind, retryAfterMs: 20_000 };
  }
  if (/RPM|requests per minute/i.test(bodySlice)) {
    return { kind, retryAfterMs: 15_000 };
  }
  if (/RPD|requests per day|daily/i.test(bodySlice)) {
    return { kind, retryAfterMs: 120_000 };
  }

  return { kind, retryAfterMs: undefined };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible adapter core (Groq / Cerebras / OpenRouter / Gemini-compat)
// ---------------------------------------------------------------------------

const PROVIDER_BASES: Record<Exclude<ProviderId, never>, string> = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
  cerebras: "https://api.cerebras.ai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

interface AdapterCallInput {
  provider: ProviderId;
  apiKey: string;
  model: string;
  messages: { role: string; content: unknown }[];
  spec: ModelSpec;
  temperature: number;
  timeoutMs: number;
}

interface AdapterOk {
  text: string;
  finishReason: string | null;
  promptTokens?: number;
  completionTokens?: number;
}

async function callOpenAiCompatible(input: AdapterCallInput): Promise<AdapterOk> {
  const { provider, apiKey, model, messages, spec, temperature, timeoutMs } = input;

  const body: Record<string, unknown> = {
    model,
    messages,
    [spec.tokenParam]: spec.maxOutputTokens,
    temperature,
  };
  // gpt-oss reasoning models on Groq/Cerebras: low effort keeps the visible
  // answer inside the 720-token completion budget instead of burning tokens
  // in hidden chain-of-thought.
  if (spec.reasoningEffort) body.reasoning_effort = "low";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(PROVIDER_BASES[provider], {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(provider === "openrouter"
          ? {
              "HTTP-Referer": "https://learnyx-academy-et.vercel.app",
              "X-Title": "Learnyx Academy ET",
            }
          : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "AbortError" || controller.signal.aborted);
    throw new RouterSkip(
      aborted ? "timeout" : "network",
      provider,
      model,
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    const parsed = parseRateLimitHints(response.status, response.headers, raw);
    // Distinguish a dead model from other errors — Groq/OpenRouter rotate
    // catalogs and 404s must disable the model instead of retrying it.
    if (
      response.status === 404 ||
      raw.includes("model_not_found") ||
      raw.includes("does not exist") ||
      raw.includes("is not a valid model")
    ) {
      throw new RouterSkip("model_missing", provider, model, raw.slice(0, 200));
    }
    throw new RouterSkip(
      parsed.kind,
      provider,
      model,
      `${response.status}: ${raw.slice(0, 220)}`,
      parsed.retryAfterMs,
    );
  }

  const data = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  } | null;
  const text = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new RouterSkip("error", provider, model, "empty response body");
  }
  return {
    text,
    finishReason: data?.choices?.[0]?.finish_reason ?? null,
    promptTokens: data?.usage?.prompt_tokens,
    completionTokens: data?.usage?.completion_tokens,
  };
}

/** Groq key resolution + the dynamic vision model (self-healing catalog). */
async function groqVisionSpec(ctx: ActionCtx): Promise<ModelSpec | null> {
  try {
    const model = await resolveVisionModel(ctx);
    return {
      key: `groq/${model}`,
      provider: "groq",
      model,
      quality: 92,
      vision: true,
      maxInputTokens: 6200,
      maxOutputTokens: 900,
      rpm: GROQ_LIMITS.rpm,
      tpm: GROQ_LIMITS.tpm,
      rpd: GROQ_LIMITS.rpd,
      tokenParam: "max_tokens",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Capacity state — read + write
// ---------------------------------------------------------------------------

export const getProviderStates = internalQuery({
  args: {},
  handler: async (ctx) =>
    await ctx.db
      .query("aiProviderState")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(60),
});

type AttemptKind = SkipKind | "success";

export const recordAttempt = internalMutation({
  args: {
    key: v.string(),
    provider: v.string(),
    model: v.string(),
    kind: v.string(),
    retryAfterMs: v.optional(v.number()),
    detail: v.optional(v.string()),
    estTokens: v.optional(v.number()),
    rpmLimit: v.optional(v.number()),
    tpmLimit: v.optional(v.number()),
    rpdLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("aiProviderState")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    const rpmWindowStart =
      existing?.rpmWindowStart !== undefined && now - existing.rpmWindowStart < 60_000
        ? existing.rpmWindowStart
        : now;
    const rpmUsed = (rpmWindowStart === existing?.rpmWindowStart ? (existing?.rpmUsed ?? 0) : 0) + 1;
    const tpmWindowStart =
      existing?.tpmWindowStart !== undefined && now - existing.tpmWindowStart < 60_000
        ? existing.tpmWindowStart
        : now;
    const tpmUsedEst =
      (tpmWindowStart === existing?.tpmWindowStart ? (existing?.tpmUsedEst ?? 0) : 0) +
      (args.estTokens ?? 0);

    const day = new Date(now).toISOString().slice(0, 10);
    const rpdUsed = existing?.rpdDay === day ? (existing?.rpdUsed ?? 0) + 1 : 1;

    const patch: Partial<Doc<"aiProviderState">> = {
      rpmWindowStart,
      rpmUsed,
      tpmWindowStart,
      tpmUsedEst,
      rpdDay: day,
      rpdUsed,
      updatedAt: now,
      lastErrorDetail: args.kind === "success" ? undefined : (args.detail ?? existing?.lastErrorDetail),
    };

    if (args.kind === "success") {
      patch.consecutiveFailures = 0;
      patch.cooldownUntil = undefined;
      patch.cooldownReason = undefined;
    } else {
      patch.lastErrorAt = now;
      const failures = (existing?.consecutiveFailures ?? 0) + 1;
      patch.consecutiveFailures = failures;

      switch (args.kind) {
        case "rate_limited": {
          // Trust the provider's own "try again in Xs" when present; widen
          // slightly with failures and jitter so a herd of requests doesn't
          // all stampede the model at the exact same instant.
          const base = args.retryAfterMs ?? 15_000;
          const escalation = Math.min(failures - 1, 3) * 5_000;
          const jitter = Math.floor(Math.random() * 3_000);
          patch.cooldownUntil = now + Math.min(base + escalation + jitter, 120_000);
          patch.cooldownReason = "rate_limited";
          break;
        }
        case "server_error":
          patch.cooldownUntil = now + 20_000 + Math.floor(Math.random() * 10_000);
          patch.cooldownReason = "server_error";
          break;
        case "timeout":
        case "network":
          patch.cooldownUntil = now + 30_000;
          patch.cooldownReason = args.kind;
          break;
        case "auth_error":
          // A bad key won't fix itself in a minute — back off hard so every
          // turn isn't paying one wasted round-trip to discover it again.
          patch.cooldownUntil = now + 15 * 60_000;
          patch.cooldownReason = "auth_error";
          break;
        case "model_missing":
          patch.cooldownUntil = now + 6 * 60 * 60_000;
          patch.cooldownReason = "model_missing";
          patch.disabledUntil404 = now + 6 * 60 * 60_000;
          break;
        default:
          patch.cooldownUntil = now + 10_000;
          patch.cooldownReason = args.kind;
      }
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("aiProviderState", {
        key: args.key,
        provider: args.provider,
        model: args.model,
        ...patch,
      } as Doc<"aiProviderState">);
    }
  },
});

export const insertCallLog = internalMutation({
  args: {
    userId: v.optional(v.id("users")),
    conversationId: v.optional(v.id("conversations")),
    purpose: v.union(
      v.literal("chat"),
      v.literal("regenerate"),
      v.literal("branch"),
      v.literal("followups"),
      v.literal("notes"),
      v.literal("summary"),
    ),
    cacheHit: v.boolean(),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    hops: v.optional(
      v.array(
        v.object({
          provider: v.string(),
          model: v.string(),
          status: v.string(),
          latencyMs: v.number(),
          detail: v.optional(v.string()),
        }),
      ),
    ),
    latencyMs: v.optional(v.number()),
    estInputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    queueWaitMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiCallLog", { ...args, createdAt: Date.now() });
  },
});

// ---------------------------------------------------------------------------
// routeChat — the capacity-aware provider walk
// ---------------------------------------------------------------------------

export interface RouteTurnRequest {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  userTurn: string;
  images?: string[];
  maxOutputTokens: number;
  temperature: number;
  /** "tiny" prefers small fast models (summaries/follow-ups). Default quality. */
  preference?: "quality" | "tiny";
  purpose: "chat" | "regenerate" | "branch" | "followups" | "notes" | "summary";
  userId?: Id<"users">;
  conversationId?: Id<"conversations">;
}

export interface HopRecord {
  provider: string;
  model: string;
  status: string;
  latencyMs: number;
  detail?: string;
}

export type RouteTurnResult =
  | {
      ok: true;
      text: string;
      finishReason: string | null;
      provider: string;
      model: string;
      hops: HopRecord[];
      estInputTokens: number;
      outputTokens?: number;
      latencyMs: number;
    }
  | {
      ok: false;
      hops: HopRecord[];
      shortestRetryMs: number;
      estInputTokens: number;
    };

/** Whole-walk budget — a turn that can't complete inside this enqueues. */
const WALK_BUDGET_MS = 30_000;
const CALL_TIMEOUT_MS = 22_000;
const CALL_TIMEOUT_VISION_MS = 30_000;
/** Rough token cost of one attached image (vision turns only). */
const EST_TOKENS_PER_IMAGE = 600;

function buildMessages(
  req: RouteTurnRequest,
): { role: string; content: unknown }[] {
  const messages: { role: string; content: unknown }[] = [];
  messages.push({ role: "system", content: req.system });
  for (const m of req.history) {
    messages.push({ role: m.role, content: m.content });
  }
  if (req.images && req.images.length > 0) {
    const parts: { type: string; image_url?: { url: string }; text?: string }[] = [];
    for (const url of req.images) parts.push({ type: "image_url", image_url: { url } });
    parts.push({ type: "text", text: req.userTurn });
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: req.userTurn });
  }
  return messages;
}

interface EligibleModel {
  spec: ModelSpec;
  estInputTokens: number;
}

/**
 * Pick the candidate order for this turn and pre-filter by estimated input
 * size (models whose per-request budget can't hold the turn are skipped —
 * never sent, so they never 429 on input size).
 */
function buildCandidates(
  req: RouteTurnRequest,
  visionSpec: ModelSpec | null,
): EligibleModel[] {
  const estInputTokens =
    estimateTokens(req.system) +
    estimateTokens(req.history.map((h) => h.content).join("\n")) +
    estimateTokens(req.userTurn) +
    80 + // per-message chat-template overhead
    (req.images?.length ?? 0) * EST_TOKENS_PER_IMAGE;

  let specs: ModelSpec[];
  if (req.images && req.images.length > 0) {
    specs = [visionSpec, QUALITY_ORDER[1]].filter((s): s is ModelSpec => s !== null);
  } else if (req.preference === "tiny") {
    specs = TINY_ORDER;
  } else {
    specs = QUALITY_ORDER;
  }

  return specs
    .filter((s) => (req.images && req.images.length > 0 ? s.vision : true))
    .filter((s) => estInputTokens <= s.maxInputTokens)
    .map((spec) => ({ spec, estInputTokens }));
}

/**
 * Walk the candidates. Every decision is capacity-aware: cooldowns, rolling
 * RPM/TPM/RPD counters, per-request input fit, and key presence are all
 * checked BEFORE a network byte is sent, so exhausted models cost zero
 * latency. Returns the first successful answer, or why everything failed.
 */
export async function routeChat(
  ctx: ActionCtx,
  req: RouteTurnRequest,
): Promise<RouteTurnResult> {
  const startedAt = Date.now();
  const hops: HopRecord[] = [];
  const estOf = new Map<string, number>();
  let shortestRetryMs = Number.POSITIVE_INFINITY;

  // Non-fatal setup failures degrade to "exhausted", never to a thrown error.
  let states: Doc<"aiProviderState">[];
  let keys: Map<string, boolean>;
  let visionSpec: ModelSpec | null = null;
  try {
    [states, keys] = await Promise.all([
      ctx.runQuery(internal.aiRouter.getProviderStates, {}),
      resolveProviderKeys(ctx),
    ]);
    if (req.images && req.images.length > 0) {
      visionSpec = await groqVisionSpec(ctx);
      if (visionSpec && !keys.get("GROQ_API_KEY")) {
        // groqVisionSpec resolved a model but there's no key — drop it.
        visionSpec = null;
      }
    }
  } catch {
    return { ok: false, hops, shortestRetryMs: 10_000, estInputTokens: 0 };
  }

  const candidates = buildCandidates(req, visionSpec);
  const stateByKey = new Map(states.map((s) => [s.key, s]));

  for (const { spec, estInputTokens } of candidates) {
    estOf.set(spec.key, estInputTokens);

    // -- pre-route capacity checks (zero network cost) ----------------------
    if (!apiKeyForProvider(keys, spec.provider)) {
      hops.push({ provider: spec.provider, model: spec.model, status: "no_key", latencyMs: 0 });
      continue;
    }
    const state = stateByKey.get(spec.key);
    const now = Date.now();
    if (state?.disabledUntil404 && now < state.disabledUntil404) {
      hops.push({ provider: spec.provider, model: spec.model, status: "skipped", latencyMs: 0, detail: "model 404-disabled" });
      continue;
    }
    if (state?.cooldownUntil && now < state.cooldownUntil) {
      hops.push({
        provider: spec.provider,
        model: spec.model,
        status: "skipped",
        latencyMs: 0,
        detail: `cooldown ${Math.ceil((state.cooldownUntil - now) / 1000)}s (${state.cooldownReason ?? "unknown"})`,
      });
      shortestRetryMs = Math.min(shortestRetryMs, state.cooldownUntil - now);
      continue;
    }
    if (
      state?.rpmWindowStart &&
      now - state.rpmWindowStart < 60_000 &&
      (state.rpmUsed ?? 0) >= spec.rpm
    ) {
      const wait = 60_000 - (now - state.rpmWindowStart);
      hops.push({ provider: spec.provider, model: spec.model, status: "skipped", latencyMs: 0, detail: `rpm window (${Math.ceil(wait / 1000)}s)` });
      shortestRetryMs = Math.min(shortestRetryMs, wait);
      continue;
    }
    const projectedTokens =
      (state?.tpmWindowStart && now - state.tpmWindowStart < 60_000 ? (state.tpmUsedEst ?? 0) : 0) +
      estInputTokens +
      spec.maxOutputTokens;
    if (projectedTokens > spec.tpm) {
      const wait = state?.tpmWindowStart && now - state.tpmWindowStart < 60_000
        ? 60_000 - (now - state.tpmWindowStart)
        : 0;
      hops.push({ provider: spec.provider, model: spec.model, status: "skipped", latencyMs: 0, detail: `tpm headroom (${spec.tpm})` });
      if (wait > 0) shortestRetryMs = Math.min(shortestRetryMs, wait);
      continue;
    }
    if (spec.rpd && state?.rpdDay === new Date(now).toISOString().slice(0, 10) && (state.rpdUsed ?? 0) >= spec.rpd) {
      hops.push({ provider: spec.provider, model: spec.model, status: "skipped", latencyMs: 0, detail: "rpd exhausted" });
      continue;
    }
    // -- deadline guard ------------------------------------------------------
    if (Date.now() - startedAt > WALK_BUDGET_MS - 6_000) {
      hops.push({ provider: spec.provider, model: spec.model, status: "skipped", latencyMs: 0, detail: "walk budget exhausted" });
      continue;
    }

    // -- attempt -------------------------------------------------------------
    const hopStart = Date.now();
    try {
      const apiKey = await resolveProviderApiKey(ctx, spec.provider);
      const result = await callOpenAiCompatible({
        provider: spec.provider,
        apiKey,
        model: spec.model,
        messages: buildMessages(req),
        spec,
        temperature: req.temperature,
        timeoutMs: req.images && req.images.length > 0 ? CALL_TIMEOUT_VISION_MS : CALL_TIMEOUT_MS,
      });
      const latencyMs = Date.now() - hopStart;
      hops.push({
        provider: spec.provider,
        model: spec.model,
        status: "ok",
        latencyMs,
      });
      await ctx.runMutation(internal.aiRouter.recordAttempt, {
        key: spec.key,
        provider: spec.provider,
        model: spec.model,
        kind: "success",
        estTokens: result.promptTokens ?? estInputTokens + (result.completionTokens ?? 0),
        rpmLimit: spec.rpm,
        tpmLimit: spec.tpm,
        rpdLimit: spec.rpd,
      });
      await logTurn(ctx, req, {
        cacheHit: false,
        provider: spec.provider,
        model: spec.model,
        hops,
        latencyMs: Date.now() - startedAt,
        estInputTokens,
        outputTokens: result.completionTokens,
      });
      return {
        ok: true,
        text: result.text,
        finishReason: result.finishReason,
        provider: spec.provider,
        model: spec.model,
        hops,
        estInputTokens,
        outputTokens: result.completionTokens,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      const latencyMs = Date.now() - hopStart;
      const skip =
        error instanceof RouterSkip
          ? error
          : new RouterSkip("error", spec.provider, spec.model, error instanceof Error ? error.message : String(error));
      hops.push({
        provider: spec.provider,
        model: spec.model,
        status: skip.kind,
        latencyMs,
        detail: skip.message.slice(0, 240),
      });
      if (skip.retryAfterMs) {
        shortestRetryMs = Math.min(shortestRetryMs, skip.retryAfterMs);
      }
      if (skip.kind === "rate_limited" || skip.kind === "server_error" || skip.kind === "auth_error" || skip.kind === "model_missing") {
        shortestRetryMs = Math.min(shortestRetryMs, skip.retryAfterMs ?? defaultCooldownFor(skip.kind));
      }
      await ctx.runMutation(internal.aiRouter.recordAttempt, {
        key: spec.key,
        provider: spec.provider,
        model: spec.model,
        kind: skip.kind,
        retryAfterMs: skip.retryAfterMs,
        detail: skip.message.slice(0, 300),
        estTokens: skip.kind === "rate_limited" ? estInputTokens : undefined,
        rpmLimit: spec.rpm,
        tpmLimit: spec.tpm,
        rpdLimit: spec.rpd,
      }).catch(() => undefined);
    }
  }

  await logTurn(ctx, req, {
    cacheHit: false,
    hops,
    latencyMs: Date.now() - startedAt,
    estInputTokens: [...estOf.values()][0] ?? 0,
  });
  return {
    ok: false,
    hops,
    shortestRetryMs: Number.isFinite(shortestRetryMs)
      ? Math.max(shortestRetryMs, 2_000)
      : 10_000,
    estInputTokens: [...estOf.values()][0] ?? 0,
  };
}

function defaultCooldownFor(kind: SkipKind): number {
  switch (kind) {
    case "rate_limited": return 20_000;
    case "server_error": return 25_000;
    case "auth_error": return 15 * 60_000;
    case "model_missing": return 6 * 60 * 60_000;
    default: return 10_000;
  }
}

async function resolveProviderApiKey(ctx: ActionCtx, provider: ProviderId): Promise<string> {
  // configKeys DB value first, env fallback — mirrors groq.ts's contract.
  const name =
    provider === "groq" ? "GROQ_API_KEY"
      : provider === "gemini" ? "GEMINI_API_KEY"
        : provider === "cerebras" ? "CEREBRAS_API_KEY"
          : "OPENROUTER_API_KEY";
  const fromDb = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: name });
  const key = fromDb ?? process.env[name];
  if (!key) throw new RouterSkip("no_key", provider, "", `${name} not configured`);
  return key;
}

async function logTurn(
  ctx: ActionCtx,
  req: RouteTurnRequest,
  data: {
    cacheHit: boolean;
    provider?: string;
    model?: string;
    hops: HopRecord[];
    latencyMs: number;
    estInputTokens: number;
    outputTokens?: number;
    queueWaitMs?: number;
  },
): Promise<void> {
  try {
    await ctx.runMutation(internal.aiRouter.insertCallLog, {
      userId: req.userId,
      conversationId: req.conversationId,
      purpose: req.purpose,
      cacheHit: data.cacheHit,
      provider: data.provider,
      model: data.model,
      hops: data.hops.map((h) => ({
        provider: h.provider,
        model: h.model,
        status: h.status,
        latencyMs: h.latencyMs,
        ...(h.detail !== undefined ? { detail: h.detail } : {}),
      })),
      latencyMs: data.latencyMs,
      estInputTokens: data.estInputTokens,
      ...(data.outputTokens !== undefined ? { outputTokens: data.outputTokens } : {}),
      ...(data.queueWaitMs !== undefined ? { queueWaitMs: data.queueWaitMs } : {}),
    });
  } catch {
    // Observability must never break the tutor.
  }
}

export async function logCachedHit(
  ctx: ActionCtx,
  req: RouteTurnRequest,
  estInputTokens: number,
): Promise<void> {
  await logTurn(ctx, req, {
    cacheHit: true,
    provider: "cache",
    model: "cache",
    hops: [],
    latencyMs: 0,
    estInputTokens,
  });
}

// ---------------------------------------------------------------------------
// Queue visibility — live position + status for the frontend and admin
// ---------------------------------------------------------------------------

export const getQueueRequest = query({
  args: { requestId: v.id("aiRequestQueue") },
  handler: async (ctx, { requestId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.get(requestId);
    if (!row || row.userId !== userId) return null;

    let position = 0;
    if (row.status === "pending") {
      const pending = await ctx.db
        .query("aiRequestQueue")
        .withIndex("by_status_createdAt", (q) => q.eq("status", "pending"))
        .order("asc")
        .take(60);
      position = Math.max(
        1,
        pending.filter((p) => p.createdAt <= row.createdAt).length,
      );
    }
    const waitedMs = Date.now() - row.createdAt;
    const etaSeconds = row.status === "pending"
      ? Math.max(4, Math.min(40, Math.ceil((40_000 - Math.min(waitedMs, 40_000)) / 1000 / Math.max(1, position))))
      : 0;
    return {
      status: row.status,
      position,
      etaSeconds,
      attempts: row.attempts ?? 0,
      createdAt: row.createdAt,
    };
  },
});

export const getMyPendingQueueRequest = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(12);
    return rows.find((r) => r.status === "pending") ?? null;
  },
});

export const countPendingForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(12);
    return rows.filter((r) => r.status === "pending").length;
  },
});

// ---------------------------------------------------------------------------
// Maintenance — bounded pruning so the reliability tables stay small
// ---------------------------------------------------------------------------

export const maintenance = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const pruned = { callLog: 0, cache: 0, queue: 0, providerState: 0 };

    // aiCallLog — keep 7 days (batched; the cron runs daily so one pass of
    // 500 per table is always enough).
    const oldLogs = await ctx.runQuery(internal.aiRouter.listOldCallLogs, { before: now - 7 * day });
    for (const id of oldLogs) {
      await ctx.runMutation(internal.aiRouter.deleteById, { table: "aiCallLog", id });
      pruned.callLog += 1;
    }

    // aiAnswerCache — expired answers.
    const expired = await ctx.runQuery(internal.aiRouter.listExpiredCache, { now });
    for (const id of expired) {
      await ctx.runMutation(internal.aiRouter.deleteById, { table: "aiAnswerCache", id });
      pruned.cache += 1;
    }

    // aiRequestQueue — terminal rows older than 24h.
    const staleQueue = await ctx.runQuery(internal.aiRouter.listStaleQueueRows, { before: now - day });
    for (const id of staleQueue) {
      await ctx.runMutation(internal.aiRouter.deleteById, { table: "aiRequestQueue", id });
      pruned.queue += 1;
    }

    // aiProviderState — rows untouched for a week (dead models, renamed specs).
    const staleStates = await ctx.runQuery(internal.aiRouter.listStaleProviderStates, { before: now - 7 * day });
    for (const id of staleStates) {
      await ctx.runMutation(internal.aiRouter.deleteById, { table: "aiProviderState", id });
      pruned.providerState += 1;
    }

    return pruned;
  },
});

export const listOldCallLogs = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const rows = await ctx.db
      .query("aiCallLog")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", before))
      .order("asc")
      .take(500);
    return rows.map((r) => r._id);
  },
});

export const listExpiredCache = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const rows = await ctx.db
      .query("aiAnswerCache")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .order("asc")
      .take(500);
    return rows.map((r) => r._id);
  },
});

export const listStaleQueueRows = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const rows = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "delivered"))
      .order("asc")
      .take(120);
    const delivered = rows.filter((r) => r.updatedAt < before).map((r) => r._id);
    const graceful = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "graceful"))
      .order("asc")
      .take(120);
    const abandoned = await ctx.db
      .query("aiRequestQueue")
      .withIndex("by_status_createdAt", (q) => q.eq("status", "abandoned"))
      .order("asc")
      .take(120);
    return [
      ...delivered,
      ...graceful.map((r) => r._id),
      ...abandoned.map((r) => r._id),
    ];
  },
});

export const listStaleProviderStates = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, { before }) => {
    const rows = await ctx.db
      .query("aiProviderState")
      .withIndex("by_updatedAt", (q) => q.lt("updatedAt", before))
      .order("asc")
      .take(100);
    return rows.map((r) => r._id);
  },
});

/**
 * Delete one row from any of the reliability tables. The four Convex tables
 * share the same id format, so one delete handler serves the maintenance
 * batch; the table literal in the args keeps call sites explicit.
 */
export const deleteById = internalMutation({
  args: {
    table: v.union(
      v.literal("aiCallLog"),
      v.literal("aiAnswerCache"),
      v.literal("aiRequestQueue"),
      v.literal("aiProviderState"),
    ),
    id: v.string(),
  },
  handler: async (ctx, { table, id }) => {
    void table;
    await ctx.db.delete(id as never);
  },
});
