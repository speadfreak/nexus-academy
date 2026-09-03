// OpenRouter + Cerebras providers for mock exam generation.
//
// Both are OpenAI-compatible REST APIs — same request/response shape as
// Groq. We co-locate them in one file because they share the same calling
// pattern, only the base URL + model name + env key differ.
//
// OPENROUTER (https://openrouter.ai):
//   - Aggregates hundreds of models (Llama 3.3 70B, DeepSeek R1, Qwen, Gemma)
//   - Free tier: 50-200 requests/day (1000/day with $10 deposit)
//   - Endpoint: https://openrouter.ai/api/v1/chat/completions
//   - Key: OPENROUTER_API_KEY (set in Admin → Keys tab)
//   - Default model: meta-llama/llama-3.3-70b-instruct:free
//
// CEREBRAS (https://cerebras.ai):
//   - Ultra-fast inference on specialized AI chips
//   - Free tier: 30 RPM, 1M tokens/day
//   - Endpoint: https://api.cerebras.ai/v1/chat/completions
//   - Key: CEREBRAS_API_KEY (set in Admin → Keys tab)
//   - Default model: llama3.1-8b
//
// Both providers throw `ProviderUnavailableError` when:
//   - The API key is not configured (so the cascade can skip to the next)
//   - The API returns 401/403 (invalid key)
//   - The API returns 429 (rate limit — try next provider)
//   - The API returns 5xx (server error — try next provider)
//
// This lets the mock exam cascade try Gemini → OpenRouter → Cerebras → Groq
// and use whichever one works, without any single provider's rate limit
// blocking the entire exam generation.

import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// Shared types + error class
// ---------------------------------------------------------------------------

export interface ProviderCallOptions {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Thrown when a provider is unavailable (no key, 401, 403, 429, 5xx).
 * The cascade catches this and tries the next provider.
 */
export class ProviderUnavailableError extends Error {
  provider: string;
  constructor(provider: string, message: string) {
    super(`[${provider}] ${message}`);
    this.name = "ProviderUnavailableError";
    this.provider = provider;
  }
}

// ---------------------------------------------------------------------------
// Key resolution (shared)
// ---------------------------------------------------------------------------

async function resolveKey(
  ctx: ActionCtx,
  keyName: string,
  providerLabel: string,
): Promise<string | undefined> {
  return (
    (await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: keyName,
    })) ?? undefined
  );
}

// ---------------------------------------------------------------------------
// Shared OpenAI-compatible call function
// ---------------------------------------------------------------------------

async function callOpenAICompatible(
  ctx: ActionCtx,
  provider: string,
  baseUrl: string,
  apiKey: string | undefined,
  keyName: string,
  model: string,
  opts: ProviderCallOptions,
): Promise<string> {
  if (!apiKey) {
    throw new ProviderUnavailableError(
      provider,
      `API key not configured. Set ${keyName} in Admin → Keys tab.`,
    );
  }

  const messages = [
    { role: "system", content: opts.systemPrompt },
    { role: "user", content: opts.userMessage },
  ];

  let response: Response;
  try {
    response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        // OpenRouter recommends these headers for analytics + routing
        ...(provider === "openrouter"
          ? {
              "HTTP-Referer": "https://nexus-academy-et.vercel.app",
              "X-Title": "Nexus Academy",
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens ?? 4096,
        temperature: opts.temperature ?? 0.4,
      }),
    });
  } catch (err) {
    throw new ProviderUnavailableError(
      provider,
      `Network error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    // 429 = rate limit → try next provider
    // 401/403 = invalid key → try next provider
    // 5xx = server error → try next provider
    if (
      response.status === 429 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status >= 500
    ) {
      throw new ProviderUnavailableError(
        provider,
        `HTTP ${response.status}: ${raw.slice(0, 200)}`,
      );
    }
    throw new Error(
      `${provider} API error ${response.status}: ${raw.slice(0, 300)}`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) {
    throw new ProviderUnavailableError(provider, "Empty response");
  }
  return text;
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
// Default model: nvidia/nemotron-3-super-120b-a12b:free — confirmed working
// as of Sep 2026. The old default (meta-llama/llama-3.3-70b-instruct:free)
// was deprecated and returns 404 "This model is unavailable for free".
// Other confirmed-working free models: nvidia/nemotron-3.5-lightning:free,
// openrouter/free (auto-router that picks the best available free model).
const OPENROUTER_DEFAULT_MODEL =
  process.env.OPENROUTER_MODEL || "nvidia/nemotron-3-super-120b-a12b:free";

export async function callOpenRouter(
  ctx: ActionCtx,
  opts: ProviderCallOptions,
): Promise<string> {
  const apiKey = await resolveKey(ctx, "OPENROUTER_API_KEY", "OpenRouter");
  const model =
    (await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: "OPENROUTER_MODEL",
    })) || OPENROUTER_DEFAULT_MODEL;
  return callOpenAICompatible(
    ctx,
    "openrouter",
    OPENROUTER_BASE,
    apiKey,
    "OPENROUTER_API_KEY",
    model,
    opts,
  );
}

// ---------------------------------------------------------------------------
// Cerebras
// ---------------------------------------------------------------------------

const CEREBRAS_BASE = "https://api.cerebras.ai/v1/chat/completions";
// Cerebras currently offers 2 models: "gpt-oss-120b" and "gemma-4-31b".
// Both require payment setup (the free tier needs billing details added).
// Default to gpt-oss-120b (same model family as Groq's default).
const CEREBRAS_DEFAULT_MODEL =
  process.env.CEREBRAS_MODEL || "gpt-oss-120b";

export async function callCerebras(
  ctx: ActionCtx,
  opts: ProviderCallOptions,
): Promise<string> {
  const apiKey = await resolveKey(ctx, "CEREBRAS_API_KEY", "Cerebras");
  const model =
    (await ctx.runQuery(internal.configKeys.resolveConfigValue, {
      key: "CEREBRAS_MODEL",
    })) || CEREBRAS_DEFAULT_MODEL;
  return callOpenAICompatible(
    ctx,
    "cerebras",
    CEREBRAS_BASE,
    apiKey,
    "CEREBRAS_API_KEY",
    model,
    opts,
  );
}
