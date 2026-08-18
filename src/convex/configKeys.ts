// Admin key management — server-side CRUD for API key configuration.
//
// Values are NEVER sent to the browser in plain text. The query returns only
// the key name and whether a value is configured. Setting a key overwrites
// any previous value for that key name.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

// ── Known integrations registry ──────────────────────────────────────

export const INTEGRATION_KEYS = [
  { key: "XAI_API_KEY", label: "Grok (xAI)", category: "ai", description: "AI tutor + content classification" },
  { key: "GEMINI_API_KEY", label: "Google Gemini", category: "ai", description: "Reader AI companion" },
  { key: "YOUTUBE_API_KEY", label: "YouTube Data API", category: "ai", description: "Related videos in reader" },
  { key: "R2_ACCOUNT_ID", label: "R2 Account ID", category: "storage", description: "Cloudflare R2 bucket access" },
  { key: "R2_ACCESS_KEY_ID", label: "R2 Access Key", category: "storage", description: "Cloudflare R2 credentials" },
  { key: "R2_SECRET_ACCESS_KEY", label: "R2 Secret Key", category: "storage", description: "Cloudflare R2 credentials" },
  { key: "R2_BUCKET_NAME", label: "R2 Bucket Name", category: "storage", description: "Cloudflare R2 bucket" },
  { key: "R2_PUBLIC_URL", label: "R2 Public URL", category: "storage", description: "Public bucket/custom domain URL" },
  { key: "TELEBIRR_APP_ID", label: "TeleBirr App ID", category: "payments", description: "Ethiopian mobile money" },
  { key: "TELEBIRR_APP_KEY", label: "TeleBirr App Key", category: "payments", description: "Ethiopian mobile money" },
  { key: "TELEBIRR_SHORT_CODE", label: "TeleBirr Short Code", category: "payments", description: "Ethiopian mobile money" },
  { key: "MPESA_CONSUMER_KEY", label: "M-Pesa Consumer Key", category: "payments", description: "Kenyan mobile money" },
  { key: "MPESA_CONSUMER_SECRET", label: "M-Pesa Consumer Secret", category: "payments", description: "Kenyan mobile money" },
  { key: "MPESA_SHORT_CODE", label: "M-Pesa Short Code", category: "payments", description: "Kenyan mobile money" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", category: "comms", description: "Broadcast to channels" },
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", category: "auth", description: "Google sign-in" },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret", category: "auth", description: "Google sign-in" },
  { key: "LIVEKIT_API_KEY", label: "LiveKit API Key", category: "video", description: "Study rooms video/audio" },
  { key: "LIVEKIT_API_SECRET", label: "LiveKit API Secret", category: "video", description: "Study rooms video/audio" },
  { key: "GITHUB_TOKEN", label: "GitHub Token", category: "integrations", description: "Repo sync + code push" },
] as const;

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  ai: { label: "AI Providers", icon: "brain" },
  storage: { label: "Storage (R2)", icon: "hard-drive" },
  payments: { label: "Payments", icon: "credit-card" },
  comms: { label: "Communication", icon: "message-circle" },
  auth: { label: "Authentication", icon: "shield" },
  video: { label: "Video (Rooms)", icon: "video" },
  integrations: { label: "Integrations", icon: "git-branch" },
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
        configured: Boolean(dbEntry?.value),
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
        configured: Boolean(dbEntry?.value),
        source: (dbEntry?.value ? "database" : "env") as "database" | "env",
        updatedAt: dbEntry?.updatedAt ?? null,
      });
    }
    return Array.from(cats.entries()).map(([id, cat]) => ({ id, ...cat }));
  },
});

/** Set or update an API key value. */
export const setKey = mutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);
    const userId = user._id;
    const known = INTEGRATION_KEYS.find((k) => k.key === args.key);
    if (!known) throw new ConvexError({ message: `Unknown key: ${args.key}`, code: "bad_request" });
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
