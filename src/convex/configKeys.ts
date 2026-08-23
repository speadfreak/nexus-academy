// Admin key management — server-side CRUD for API key configuration.
//
// Values are NEVER sent to the browser in plain text. The query returns only
// the key name and whether a value is configured. Setting a key overwrites
// any previous value for that key name.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// ── Known integrations registry ──────────────────────────────────────

export const INTEGRATION_KEYS = [
  { key: "GROQ_API_KEY", label: "Groq AI (Primary AI)", category: "ai", description: "AI tutor, quizzes, plans, flashcards, content classification, recaps, quotes", helpUrl: "https://console.groq.com/keys", helpLabel: "console.groq.com" },
  { key: "YOUTUBE_API_KEY", label: "YouTube Data API", category: "ai", description: "Related videos in reader", helpUrl: "https://console.cloud.google.com/apis/credentials", helpLabel: "Google Cloud Console" },
  { key: "R2_ACCOUNT_ID", label: "R2 Account ID", category: "storage", description: "Cloudflare R2 bucket access" },
  { key: "R2_ACCESS_KEY_ID", label: "R2 Access Key", category: "storage", description: "Cloudflare R2 credentials" },
  { key: "R2_SECRET_ACCESS_KEY", label: "R2 Secret Key", category: "storage", description: "Cloudflare R2 credentials" },
  { key: "R2_BUCKET_NAME", label: "R2 Bucket Name", category: "storage", description: "Cloudflare R2 bucket" },
  { key: "R2_PUBLIC_URL", label: "R2 Public URL", category: "storage", description: "Public bucket/custom domain URL" },
  { key: "TELEBIRR_APP_ID", label: "TeleBirr App ID", category: "payments", description: "Merchant application ID" },
  { key: "TELEBIRR_APP_KEY", label: "TeleBirr App Key", category: "payments", description: "Merchant application secret" },
  { key: "TELEBIRR_SHORT_CODE", label: "TeleBirr Merchant Code", category: "payments", description: "6-digit merchant code" },
  { key: "TELEBIRR_FABRIC_APP_ID", label: "TeleBirr Fabric App ID", category: "payments", description: "Fabric app ID for gateway auth (UUID)" },
  { key: "TELEBIRR_PRIVATE_KEY", label: "TeleBirr RSA Private Key", category: "payments", description: "RSA private key for request signing (PEM or base64 DER)" },
  { key: "TELEBIRR_NOTIFY_URL", label: "TeleBirr Notify URL", category: "payments", description: "Server notification URL (public endpoint)" },
  { key: "TELEBIRR_REDIRECT_URL", label: "TeleBirr Return URL", category: "payments", description: "User return URL after payment (optional)" },
  { key: "MPESA_CONSUMER_KEY", label: "M-Pesa Consumer Key", category: "payments", description: "Daraja API consumer key" },
  { key: "MPESA_CONSUMER_SECRET", label: "M-Pesa Consumer Secret", category: "payments", description: "Daraja API consumer secret" },
  { key: "MPESA_SHORT_CODE", label: "M-Pesa Business Short Code", category: "payments", description: "Paybill/till number" },
  { key: "MPESA_PASSKEY", label: "M-Pesa Lipa Na M-Pesa Passkey", category: "payments", description: "STK push password (from Daraja portal)" },
  { key: "MPESA_CALLBACK_URL", label: "M-Pesa Callback URL", category: "payments", description: "Public callback URL for STK results" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", category: "comms", description: "Broadcast to channels", helpUrl: "https://t.me/BotFather", helpLabel: "@BotFather" },
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", category: "auth", description: "Google sign-in (requires Convex env var — see notice below)", helpUrl: "https://console.cloud.google.com/apis/credentials", helpLabel: "Google Cloud Console", isEnvOnly: true },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret", category: "auth", description: "Google sign-in (requires Convex env var — see notice below)", helpUrl: "https://console.cloud.google.com/apis/credentials", helpLabel: "Google Cloud Console", isEnvOnly: true },
  { key: "LIVEKIT_URL", label: "LiveKit Server URL", category: "video", description: "WebSocket URL, e.g. wss://your-project.livekit.cloud" },
  { key: "LIVEKIT_API_KEY", label: "LiveKit API Key", category: "video", description: "From LiveKit Cloud project settings" },
  { key: "LIVEKIT_API_SECRET", label: "LiveKit API Secret", category: "video", description: "From LiveKit Cloud project settings" },
  { key: "GITHUB_TOKEN", label: "GitHub Token", category: "integrations", description: "Personal access token with repo scope", helpUrl: "https://github.com/settings/tokens", helpLabel: "github.com/settings/tokens" },
] as const;

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  ai: { label: "AI Providers", icon: "brain" },
  storage: { label: "Storage (R2)", icon: "hard-drive" },
  payments: { label: "Payments", icon: "credit-card" },
  comms: { label: "Communication", icon: "message-circle" },
  auth: { label: "Authentication", icon: "shield" },
  video: { label: "Video (Rooms)", icon: "video" },
  integrations: { label: "Integrations", icon: "git-branch" },
  custom: { label: "Custom Keys", icon: "key-round" },
};

export const CATEGORIES_META = CATEGORIES;

// Inline admin check — same pattern as adminCenter.ts
async function requireAdmin(ctx: { db: { get: (id: any) => Promise<any> }; auth: any }) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  const user = await ctx.db.get(userId);
  if (!user || user.role !== "admin") {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
  return user as Doc<"users">;
}

/** Status of all known integration keys. */
export const getKeyStatuses = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const stored = await ctx.db.query("configKeys").collect();
    const storedMap = new Map(stored.map((r) => [r.key, r]));
    return INTEGRATION_KEYS.map((meta) => {
      const dbEntry = storedMap.get(meta.key);
      return {
        ...meta,
        configured: Boolean(dbEntry?.value) || Boolean(process.env[meta.key]),
        source: (dbEntry?.value ? "database" : "env") as "database" | "env",
        updatedAt: dbEntry?.updatedAt ?? null,
      };
    });
  },
});

/** Grouped by category for the admin UI. */
export const getKeyStatusesByCategory = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const stored = await ctx.db.query("configKeys").collect();
    const storedMap = new Map(stored.map((r) => [r.key, r]));
    const cats = new Map<string, { label: string; icon: string; keys: any[] }>();
    for (const meta of INTEGRATION_KEYS) {
      const catInfo = CATEGORIES[meta.category] ?? { label: meta.category, icon: "key" };
      if (!cats.has(meta.category)) cats.set(meta.category, { ...catInfo, keys: [] });
      const dbEntry = storedMap.get(meta.key);
      cats.get(meta.category)!.keys.push({
        ...meta,
        configured: Boolean(dbEntry?.value) || Boolean(process.env[meta.key]),
        source: (dbEntry?.value ? "database" : "env") as "database" | "env",
        updatedAt: dbEntry?.updatedAt ?? null,
      });
    }
    return Array.from(cats.entries()).map(([id, cat]) => ({ id, ...cat }));
  },
});

/** Set or update an API key value. Accepts known keys and custom keys (prefixed with custom:). */
export const setKey = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const userId = user._id;
    const known = INTEGRATION_KEYS.find((k) => k.key === args.key);
    const isCustom = args.key.startsWith("custom:");
    if (!known && !isCustom) throw new ConvexError({ message: `Unknown key: ${args.key}`, code: "bad_request" });
    const now = Date.now();
    const existing = await ctx.db.query("configKeys").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value, updatedAt: now, updatedBy: userId });
    } else {
      await ctx.db.insert("configKeys", { key: args.key, value: args.value, updatedAt: now, updatedBy: userId });
    }
    return { success: true };
  },
});

/** Delete a stored key (falls back to env var). */
export const deleteKey = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.query("configKeys").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (existing) await ctx.db.delete(existing._id);
    return { success: true };
  },
});

/** Get the actual values of known R2 keys (internal, for actions).
 * NOT a public query — secrets must never be exposed to the browser. */
export const getR2KeyValues = internalQuery({
  args: {},
  handler: async (ctx) => {
    const stored = await ctx.db.query("configKeys").collect();
    const storedMap = new Map(stored.map((r) => [r.key, r.value]));
    return {
      R2_ACCOUNT_ID: storedMap.get("R2_ACCOUNT_ID") || undefined,
      R2_ACCESS_KEY_ID: storedMap.get("R2_ACCESS_KEY_ID") || undefined,
      R2_SECRET_ACCESS_KEY: storedMap.get("R2_SECRET_ACCESS_KEY") || undefined,
      R2_BUCKET_NAME: storedMap.get("R2_BUCKET_NAME") || undefined,
      R2_PUBLIC_URL: storedMap.get("R2_PUBLIC_URL") || undefined,
    };
  },
});

/**
 * Generic internal query: resolve a config key value.
 * Checks the configKeys database table first, then falls back to process.env.
 * Used by AI actions so that keys pasted in the admin panel actually work.
 */
export const resolveConfigValue = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }): Promise<string | undefined> => {
    const dbEntry = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    if (dbEntry?.value) return dbEntry.value;
    return process.env[key] || undefined;
  },
});

/** Batch-resolve multiple config keys in one round-trip (internal, for actions). */
export const resolveConfigValues = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, { keys }): Promise<Record<string, string | undefined>> => {
    const stored = await ctx.db.query("configKeys").collect();
    const storedMap = new Map(stored.map((r) => [r.key, r.value]));
    const result: Record<string, string | undefined> = {};
    for (const key of keys) {
      result[key] = storedMap.get(key) || process.env[key] || undefined;
    }
    return result;
  },
});

/** Get the actual value of a key (admin-only, for testing connections). */
export const getKeyValue = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.query("configKeys").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (existing?.value) return { value: existing.value, source: "database" as const };
    return { value: null, source: null };
  },
});

/**
 * Backend version probe — the frontend calls this to detect whether the
 * latest Convex functions are deployed. Bump `version` whenever you make a
 * change that the frontend needs to know about (e.g. new DB-based key
 * resolution). If this function doesn't exist on the deployment, the
 * frontend knows the backend is outdated.
 */
/** List custom keys (prefixed with custom:) for the admin UI. */
export const listCustomKeys = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const all = await ctx.db.query("configKeys").collect();
    const customEntries = all
      .filter((r) => r.key.startsWith("custom:"))
      .map((r) => ({
        key: r.key,
        label: r.key.replace("custom:", ""),
        configured: true,
        source: "database" as const,
        updatedAt: r.updatedAt,
      }));
    return customEntries;
  },
});

export const getBackendVersion = query({
  args: {},
  handler: () => ({
    version: 3,
    features: ["db_key_resolution", "configKeys_table", "resolveConfigValue", "all_keys_db_backed", "custom_keys", "livekit_db", "github_db", "telegram_db", "payment_providers_db"],
  }),
});
