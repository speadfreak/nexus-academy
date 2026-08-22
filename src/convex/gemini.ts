// Shared AI helper — single place for all model-calling logic.
//
// Uses the Groq REST API (OpenAI-compatible format). The key is resolved
// from the configKeys database table first, then falls back to process.env.
//
// Required env var (set it in the Keys / API keys tab):
//   GROQ_API_KEY     your Groq API key (https://console.groq.com/keys)
//   AI_MODEL         optional — defaults to llama3-70b-8192

import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_MODEL = process.env.AI_MODEL || "llama3-70b-8192";
const GROQ_BASE = "https://api.groq.com/openai/v1/chat/completions";

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

export interface GeminiCallOptions {
  systemPrompt: string;
  userMessage: string;
  /** Multi-turn conversation history (newest last). "user" or "assistant". */
  history?: { role: "user" | "assistant"; content: string }[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Call the Groq API (OpenAI-compatible). Returns the model's text response.
 * Throws on non-OK status or empty response.
 */
export async function callGemini(ctx: ActionCtx, opts: GeminiCallOptions): Promise<string> {
  const apiKey = await resolveGroqKey(ctx);
  const model = opts.model || DEFAULT_MODEL;

  // Build OpenAI-compatible messages array
  const messages: { role: string; content: string }[] = [];
  messages.push({ role: "system", content: opts.systemPrompt });

  if (opts.history) {
    for (const msg of opts.history) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }

  messages.push({ role: "user", content: opts.userMessage });

  const response = await fetch(GROQ_BASE, {
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

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Groq API error ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ""}`);
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

/** Model name for display / logging. */
export function getModelName(): string {
  return DEFAULT_MODEL;
}
