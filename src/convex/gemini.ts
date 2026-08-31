// Shared AI helper for the Gemini provider — used only for mock exam
// generation (the one task that's genuinely too token-heavy for Groq's
// 8,000 TPM free-tier ceiling).
//
// Uses the Google Generative Language REST API (v1beta generateContent).
// The key is resolved from the configKeys database table first, then
// falls back to process.env.GEMINI_API_KEY.
//
// Required env var / config key (set it in Admin → Keys tab):
//   GEMINI_API_KEY   your Google AI Studio API key
//                    (get one free at https://aistudio.google.com/apikey)
//
// Optional env var:
//   GEMINI_MODEL     defaults to "gemini-3.6-flash"
//                    (overridable per-call via opts.model)
//
// NOTE on model names: gemini-2.5-flash is no longer available to new API
// keys as of late Aug 2026 — Google returns 404 NOT_FOUND with the message
// "This model is no longer available to new users. Please update your code
// to use models/gemini-3.6-flash for the latest features and improvements."
// If you pinned GEMINI_MODEL=gemini-2.5-flash in your Keys tab, change it
// to gemini-3.6-flash (or unset it to fall back to the new default).
//
// Free-tier rate limits (community-cited for the 3.x-flash family as of
// mid-2026): ~15 RPM  ·  ~1,000,000 TPM  ·  ~1,500 RPD
// The binding constraint for us is RPD (requests per day), since mock
// exam generation is infrequent (a handful of times per student per
// month) but each call is heavy (~7K tokens output). 1,500 RPD is plenty.
//
// 429 detection: HTTP 429 with body shape:
//   { "error": { "code": 429, "status": "RESOURCE_EXHAUSTED",
//     "details": [{ "@type": "...RetryInfo", "retryDelay": "30s" }] } }

import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

// Default to gemini-3.6-flash — the model Google's API explicitly
// recommends in the "gemini-2.5-flash is no longer available" 404 message.
// If a newer model ships in the future, the admin can override via the
// GEMINI_MODEL config key in the Keys tab without code changes.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/** Resolve an API key: database (admin panel) first, then env var fallback. */
async function resolveKey(ctx: ActionCtx, keyName: string): Promise<string | undefined> {
  return (await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: keyName })) ?? undefined;
}

/** Resolve the Gemini API key. Throws a friendly error if not configured. */
export async function resolveGeminiKey(ctx: ActionCtx): Promise<string> {
  const key = await resolveKey(ctx, "GEMINI_API_KEY");
  if (!key) {
    throw new ConvexError({
      message:
        "Gemini is not configured yet. Go to Admin → Keys tab, add your " +
        "Gemini API key (get one free at https://aistudio.google.com/apikey) " +
        "and paste it here. Mock exam generation uses Gemini because of its " +
        "higher token-per-minute ceiling; the rest of the app (tutor, " +
        "quizzes, flashcards, daily challenge) still uses Groq.",
      code: "ai_not_configured",
    });
  }
  return key;
}

// ---------------------------------------------------------------------------
// Core call function
// ---------------------------------------------------------------------------

export interface GeminiCallOptions {
  systemPrompt: string;
  userMessage: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Error class for Gemini rate-limit failures so callers can detect them. */
export class GeminiRateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "GeminiRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Error class for "Gemini is not available from this deployment" failures
 * — most commonly the FAILED_PRECONDITION "User location is not supported
 * for the API use" error returned when the API key was created from a
 * region Gemini's free tier doesn't serve (e.g. Ethiopia). Callers should
 * treat this as a signal to fall back to another provider, NOT to retry
 * Gemini — retrying won't help.
 */
export class GeminiUnavailableError extends Error {
  status: string;
  constructor(message: string, status: string) {
    super(message);
    this.name = "GeminiUnavailableError";
    this.status = status;
  }
}

/**
 * Call the Gemini generateContent API. Returns the model's text response.
 *
 * Throws `GeminiRateLimitError` on HTTP 429 / RESOURCE_EXHAUSTED so the
 * caller can branch: back off and retry, or fail a single section
 * gracefully without crashing the whole exam generation.
 */
export async function callGemini(ctx: ActionCtx, opts: GeminiCallOptions): Promise<string> {
  const apiKey = await resolveGeminiKey(ctx);
  const model = opts.model || DEFAULT_MODEL;

  const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    system_instruction: { parts: { text: opts.systemPrompt } },
    contents: [{ role: "user", parts: [{ text: opts.userMessage }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 4096,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    // Detect 429 / RESOURCE_EXHAUSTED specifically.
    if (response.status === 429) {
      let retryAfterMs = 30_000; // default 30s backoff
      try {
        const parsed = JSON.parse(raw) as {
          error?: {
            details?: Array<{ "@type"?: string; retryDelay?: string }>;
          };
        };
        const retryInfo = parsed.error?.details?.find(
          (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo",
        );
        if (retryInfo?.retryDelay) {
          // retryDelay is like "30s" — parse the number.
          const m = /^(\d+)s$/i.exec(retryInfo.retryDelay);
          if (m) retryAfterMs = Number(m[1]) * 1000;
        }
      } catch {
        // ignore — fall back to default 30s
      }
      throw new GeminiRateLimitError(
        `Gemini rate-limit (429). Retry after ${retryAfterMs}ms. Raw: ${raw.slice(0, 200)}`,
        retryAfterMs,
      );
    }
    // Detect "Gemini is not available from this deployment" — the two
    // shapes we care about:
    //   - 400 FAILED_PRECONDITION "User location is not supported for the
    //     API use" (the API key was created from an unsupported region).
    //   - 404 NOT_FOUND "This model is no longer available to new users"
    //     (the model name is deprecated; the admin needs to update
    //     GEMINI_MODEL in the Keys tab, OR we fall back to Groq).
    // In both cases, retrying Gemini won't help — the caller should fall
    // back to another provider (Groq in our case).
    try {
      const parsed = JSON.parse(raw) as {
        error?: { status?: string; message?: string; code?: number };
      };
      const status = parsed.error?.status;
      if (
        status === "FAILED_PRECONDITION" ||
        parsed.error?.code === 404 ||
        response.status === 404
      ) {
        throw new GeminiUnavailableError(
          `Gemini unavailable (${status ?? response.status}): ${parsed.error?.message ?? raw.slice(0, 200)}`,
          status ?? String(response.status),
        );
      }
    } catch (parseErr) {
      // If JSON.parse itself threw, rethrow the parse error (only if it's
      // not a GeminiUnavailableError we just threw above).
      if (parseErr instanceof GeminiUnavailableError) throw parseErr;
      // else fall through to the generic error below
    }
    throw new Error(
      `Gemini API error ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ""}`,
    );
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; thought?: boolean }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  // Check for content blocking.
  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidates.");
  }

  // Concatenate all non-thought text parts (some responses split the text).
  const parts = candidate.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text as string)
    .join("")
    .trim();

  if (!text) {
    // Could be a SAFETY / RECITATION finishReason with no text parts.
    throw new Error(
      `Gemini returned an empty response (finishReason: ${candidate.finishReason ?? "unknown"}).`,
    );
  }
  return text;
}

/** Model name for display / logging. */
export function getGeminiModelName(): string {
  return DEFAULT_MODEL;
}
