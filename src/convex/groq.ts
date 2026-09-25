// Shared AI helper — single place for all model-calling logic.
//
// Uses the Groq REST API (OpenAI-compatible format). The key is resolved
// from the configKeys database table first, then falls back to process.env.
//
// Required env var (set it in the Keys / API keys tab):
//   GROQ_API_KEY     your Groq API key (https://console.groq.com/keys)
//   AI_MODEL         optional — defaults to openai/gpt-oss-120b
//   AI_VISION_MODEL  optional — pins the vision model; when unset the app
//                    auto-picks an image-capable model from Groq's LIVE
//                    /models catalog (Groq rotates its catalog — llama-4
//                    scout was removed in 2026, which hard-broke image
//                    uploads; this system self-heals instead of hardcoding).

import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";

// ---------------------------------------------------------------------------
// Vision model resolution — SELF-HEALING
// ---------------------------------------------------------------------------
// Groq deprecates models regularly. A hardcoded vision model eventually 404s
// ("model_not_found") and every image upload in the Tutor dies. So instead:
//   1. AI_VISION_MODEL override (configKeys table or env) — used as-is.
//   2. Otherwise fetch Groq's /models catalog (cached 10 min) and pick the
//      best image-capable model by preference order.
//   3. If the catalog itself is unreachable, fall back to the last known
//      good candidate blindly.
//   4. If a chat completion STILL fails with model_not_found, callGroq
//      invalidates the cache, re-resolves, and retries once automatically.

const GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models";
const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";
const MODELS_CACHE_TTL_MS = 10 * 60 * 1000;

/** Preference-ordered vision candidates — best teaching quality first. */
const VISION_CANDIDATES = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "gemma-3-27b-it",
  "gemma-3-12b-it",
];

/** Blind fallback when the catalog can't be fetched at all. */
const VISION_LAST_RESORT = "meta-llama/llama-4-maverick-17b-128e-instruct";

interface GroqCatalog {
  at: number;
  imageCapable: string[];
}

let catalogCache: GroqCatalog | null = null;
let resolvedVisionModel: { at: number; model: string } | null = null;

/** Rank an image-capable model id — higher score wins. */
function scoreVisionCandidate(id: string): number {
  const lower = id.toLowerCase();
  let score = 0;
  const prefIndex = VISION_CANDIDATES.indexOf(lower);
  if (prefIndex >= 0) score += 100 - prefIndex * 10; // known good, in order
  if (lower.includes("llama-4-scout")) score += 20; // fast + strong OCR
  if (lower.includes("llama-4")) score += 10;
  if (lower.includes("gemma-3")) score += 8;
  if (lower.includes("vision") || lower.includes("vl")) score += 5;
  if (lower.includes("-preview") || lower.includes("deprecated")) score -= 15;
  return score;
}

/** Fetch Groq's model catalog and keep only image-capable models. */
async function fetchImageCapableModels(apiKey: string): Promise<string[]> {
  const res = await fetch(GROQ_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Groq models list failed ${res.status}`);
  }
  const data = (await res.json()) as {
    data?: {
      id?: string;
      input_modalities?: string[];
      active_input_modalities?: string[];
    }[];
  };
  const models = data.data ?? [];
  const imageCapable = models
    .filter((m) => {
      const modalities = m.input_modalities ?? m.active_input_modalities ?? [];
      return modalities.includes("image");
    })
    .map((m) => m.id)
    .filter((id): id is string => Boolean(id));
  return imageCapable;
}

/**
 * Resolve a vision-capable model name. Cached for 10 minutes; invalidated by
 * callGroq when Groq reports the model is gone. Admin override wins outright.
 */
export async function resolveVisionModel(ctx: ActionCtx): Promise<string> {
  // 1. Explicit admin override — never second-guessed.
  const override =
    (await resolveKey(ctx, "AI_VISION_MODEL")) || process.env.AI_VISION_MODEL;
  if (override) return override;

  // 2. Fresh cached resolution.
  if (resolvedVisionModel && Date.now() - resolvedVisionModel.at < MODELS_CACHE_TTL_MS) {
    return resolvedVisionModel.model;
  }

  // 3. Live catalog — pick the best image-capable model Groq has today.
  try {
    const apiKey = await resolveGroqKey(ctx);
    if (!catalogCache || Date.now() - catalogCache.at > MODELS_CACHE_TTL_MS) {
      catalogCache = { at: Date.now(), imageCapable: await fetchImageCapableModels(apiKey) };
    }
    const pool = catalogCache.imageCapable;
    if (pool.length > 0) {
      const pick = [...pool].sort((a, b) => scoreVisionCandidate(b) - scoreVisionCandidate(a))[0]!;
      resolvedVisionModel = { at: Date.now(), model: pick };
      return pick;
    }
  } catch {
    // Catalog unreachable — fall through to the blind fallback.
  }

  // 4. Blind fallback — last known good vision model.
  return VISION_LAST_RESORT;
}

/** Invalidate cached vision resolution (used by the self-heal retry). */
function invalidateVisionResolution(): void {
  resolvedVisionModel = null;
  catalogCache = null;
}

/**
 * Legacy sync accessor — returns the last resolved vision model, or the
 * last-resort candidate. Only for display/logging; real calls should use
 * resolveVisionModel().
 */
export function getVisionModelName(): string {
  return resolvedVisionModel?.model ?? VISION_LAST_RESORT;
}

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/** Resolve an API key: database (admin panel) first, then env var fallback. */
export async function resolveKey(ctx: ActionCtx, keyName: string): Promise<string | undefined> {
  return (await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: keyName })) ?? undefined;
}

/** Resolve the Groq API key. */
export async function resolveGroqKey(ctx: ActionCtx): Promise<string> {
  const key = await resolveKey(ctx, "GROQ_API_KEY");
  if (!key) {
    throw new ConvexError({
      message:
        "AI is not configured yet. Go to Admin → Keys tab, add your Groq API key " +
        "(get one free at console.groq.com/keys) and paste it here.",
      code: "ai_not_configured",
    });
  }
  return key;
}

// ---------------------------------------------------------------------------
// Core call function
// ---------------------------------------------------------------------------

export interface GroqCallOptions {
  systemPrompt: string;
  userMessage: string;
  /** Multi-turn conversation history (newest last). "user" or "assistant". */
  history?: { role: "user" | "assistant"; content: string }[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Vision input — base64 data URLs ("data:image/jpeg;base64,…") sent as
   * image_url content parts BEFORE the text part. Only vision models
   * (auto-resolved via resolveVisionModel) accept these.
   */
  images?: string[];
}

/**
 * Call the Groq API (OpenAI-compatible). Returns the model's text response.
 * Throws on non-OK status or empty response.
 */
export async function callGroq(ctx: ActionCtx, opts: GroqCallOptions): Promise<string> {
  const apiKey = await resolveGroqKey(ctx);
  let model = opts.model || DEFAULT_MODEL;

  // Build OpenAI-compatible messages array
  const messages: { role: string; content: unknown }[] = [];
  messages.push({ role: "system", content: opts.systemPrompt });

  if (opts.history) {
    for (const msg of opts.history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  if (opts.images && opts.images.length > 0) {
    // Multimodal turn: image parts first, then the text part.
    const parts: { type: string; image_url?: { url: string }; text?: string }[] = [];
    for (const url of opts.images) parts.push({ type: "image_url", image_url: { url } });
    parts.push({ type: "text", text: opts.userMessage });
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: opts.userMessage });
  }

  let response = await postChatCompletion(apiKey, model, messages, opts);

  if (!response.ok) {
    const raw = await response.text().catch(() => "");

    // ── SELF-HEAL: the vision model vanished mid-flight ────────────────
    // Groq rotates its catalog (llama-4-scout was pulled and every image
    // upload started 404ing). If an image turn fails with model_not_found,
    // invalidate the cached resolution, re-resolve a live image-capable
    // model, and retry ONCE with the same messages.
    const notFound =
      response.status === 404 ||
      raw.includes("model_not_found") ||
      raw.includes("does not exist");
    if (opts.images && opts.images.length > 0 && notFound) {
      invalidateVisionResolution();
      const healed = await resolveVisionModel(ctx);
      if (healed && healed !== model) {
        response = await postChatCompletion(apiKey, healed, messages, opts);
        if (response.ok) model = healed; // healed call won — parse it below
      }
    }

    if (!response.ok) {
      throw new Error(`Groq API error ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ""}`);
    }
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new Error("Groq returned an empty response.");
  }
  return text;
}

/** Fire a chat-completion request at Groq. */
function postChatCompletion(
  apiKey: string,
  model: string,
  messages: { role: string; content: unknown }[],
  opts: GroqCallOptions,
): Promise<Response> {
  return fetch(GROQ_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.5,
    }),
  });
}

/** Model name for display / logging. */
export function getModelName(): string {
  return DEFAULT_MODEL;
}
