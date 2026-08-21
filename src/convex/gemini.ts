// Shared Gemini AI helper — single place for all model-calling logic.
//
// Uses the REST API directly (no SDK dependency) — same proven pattern that
// geminiReader.ts already uses in production. The key is resolved from the
// configKeys database table first, then falls back to process.env.
//
// Required env var (set it in the Keys / API keys tab):
//   GEMINI_API_KEY   your Google AI Studio key (https://aistudio.google.com/apikey)
//   AI_MODEL        optional — defaults to gemini-2.5-flash

import { ConvexError } from "convex/values";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_MODEL = process.env.AI_MODEL || "gemini-2.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ---------------------------------------------------------------------------
// Key resolution
// ---------------------------------------------------------------------------

/** Resolve an API key: database (admin panel) first, then env var fallback. */
export async function resolveKey(ctx: ActionCtx, keyName: string): Promise<string | undefined> {
  return (await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: keyName })) ?? undefined;
}

/** Resolve the Gemini API key. */
export async function resolveGeminiKey(ctx: ActionCtx): Promise<string> {
  const key = await resolveKey(ctx, "GEMINI_API_KEY");
  if (!key) {
    throw new ConvexError({
      message:
        "AI is not configured yet. Go to Admin → Keys tab, click \"Get Key\" next to Google Gemini, " +
        "sign up at aistudio.google.com, copy your API key, and paste it here.",
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
 * Call the Gemini API. Returns the model's text response.
 * Throws on non-OK status or empty response.
 */
export async function callGemini(ctx: ActionCtx, opts: GeminiCallOptions): Promise<string> {
  const apiKey = await resolveGeminiKey(ctx);
  const model = opts.model || DEFAULT_MODEL;

  // Build Gemini contents from history
  const contents: { role: string; parts: { text: string }[] }[] = [];

  if (opts.history) {
    for (const msg of opts.history) {
      contents.push({
        role: msg.role === "assistant" ? "model" : "user",
        parts: [{ text: msg.content }],
      });
    }
  }

  // Append the current user message
  contents.push({ role: "user", parts: [{ text: opts.userMessage }] });

  const response = await fetch(
    `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens: opts.maxTokens ?? 1024,
          temperature: opts.temperature ?? 0.5,
        },
      }),
    },
  );

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    throw new Error(`Gemini API error ${response.status}${raw ? `: ${raw.slice(0, 300)}` : ""}`);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }
  return text;
}

/** Model name for display / logging. */
export function getModelName(): string {
  return DEFAULT_MODEL;
}
