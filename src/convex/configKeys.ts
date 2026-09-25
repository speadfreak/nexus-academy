// Admin key management — server-side CRUD for API key configuration.
//
// Values are NEVER sent to the browser in plain text. The query returns only
// the key name and whether a value is configured. Setting a key overwrites
// any previous value for that key name.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { isAdminDoc } from "./admin";

// ── Known integrations registry ──────────────────────────────────────

export const INTEGRATION_KEYS = [
  { key: "GROQ_API_KEY", label: "Groq AI (Primary AI)", category: "ai", description: "AI tutor, quizzes, plans, flashcards, content classification, recaps, quotes. Also the final fallback for mock exams if Gemini + OpenRouter + Cerebras all fail.", helpUrl: "https://console.groq.com/keys", helpLabel: "console.groq.com" },
  { key: "AI_VISION_MODEL", label: "AI Vision Model (optional)", category: "ai", description: "Optional vision model override for image uploads in the Tutor. Leave EMPTY to auto-pick the best image-capable model from Groq's live catalog (self-healing — recommended). Only set this if auto-detection picks something wrong." },
  { key: "GEMINI_API_KEY", label: "Gemini AI (Mock Exams)", category: "ai", description: "Primary provider for mock exam generation. If it fails (rate limit, region block, etc.), the system cascades to OpenRouter → Cerebras → Groq.", helpUrl: "https://aistudio.google.com/apikey", helpLabel: "aistudio.google.com/apikey" },
  { key: "GEMINI_MODEL", label: "Gemini Model (optional)", category: "ai", description: "Optional model override. Defaults to gemini-3.6-flash." },
  { key: "OPENROUTER_API_KEY", label: "OpenRouter (Mock Exams fallback 1)", category: "ai", description: "First fallback for mock exam generation when Gemini fails. Free tier: 50-200 requests/day (1000/day with $10 deposit). Get a free key at openrouter.ai/keys.", helpUrl: "https://openrouter.ai/keys", helpLabel: "openrouter.ai/keys" },
  { key: "OPENROUTER_MODEL", label: "OpenRouter Model (optional)", category: "ai", description: "Optional model override. Defaults to openrouter/free (confirmed working Sep 2026). Other working free models: nvidia/nemotron-3.5-lightning:free, openrouter/free (auto-router). NOTE: meta-llama/llama-3.3-70b-instruct:free was deprecated and returns 404." },
  { key: "CEREBRAS_API_KEY", label: "Cerebras (Mock Exams fallback 2)", category: "ai", description: "Second fallback for mock exam generation when Gemini + OpenRouter both fail. Free tier requires billing details to be added (even for $0 usage). Get a key at cerebras.ai. Available models: gpt-oss-120b, gemma-4-31b." },
  { key: "CEREBRAS_MODEL", label: "Cerebras Model (optional)", category: "ai", description: "Optional model override. Defaults to gpt-oss-120b. Also available: gemma-4-31b." },
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
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", category: "comms", description: "Broadcast to channels + contact-form delivery", helpUrl: "https://t.me/BotFather", helpLabel: "@BotFather" },
  { key: "CONTACT_GROUP_CHAT_ID", label: "Contact-Form Group Chat ID", category: "comms", description: "The Telegram chat ID of the team's discussion GROUP where student contact-form messages are delivered. Must be a group/supergroup the bot is a member of. Use @userinfobot in the group to find this ID (starts with -100... for supergroups). When set, contact messages bypass the 'all channels' scan and go straight to this group." },
  { key: "CONTACT_GROUP_INVITE_LINK", label: "Contact-Form Group Invite Link", category: "comms", description: "Public t.me/... invite link to the team's discussion group. Shown to admins in the Contact-Form Inbox tab so they can jump to the group quickly. Optional but recommended." },
  { key: "GOOGLE_CLIENT_ID", label: "Google OAuth Client ID", category: "auth", description: "Google sign-in (requires Convex env var — see notice below)", helpUrl: "https://console.cloud.google.com/apis/credentials", helpLabel: "Google Cloud Console", isEnvOnly: true },
  { key: "GOOGLE_CLIENT_SECRET", label: "Google OAuth Client Secret", category: "auth", description: "Google sign-in (requires Convex env var — see notice below)", helpUrl: "https://console.cloud.google.com/apis/credentials", helpLabel: "Google Cloud Console", isEnvOnly: true },
  { key: "LIVEKIT_URL", label: "LiveKit Server URL", category: "video", description: "WebSocket URL, e.g. wss://your-project.livekit.cloud" },
  { key: "LIVEKIT_API_KEY", label: "LiveKit API Key", category: "video", description: "From LiveKit Cloud project settings" },
  { key: "LIVEKIT_API_SECRET", label: "LiveKit API Secret", category: "video", description: "From LiveKit Cloud project settings" },
  { key: "GITHUB_TOKEN", label: "GitHub Token", category: "integrations", description: "Personal access token with repo scope", helpUrl: "https://github.com/settings/tokens", helpLabel: "github.com/settings/tokens" },
  // ── Manual payment system ──────────────────────────────────────────
  { key: "PREMIUM_PRICE_ETB", label: "Premium Price (ETB)", category: "payments", description: "Price in ETB for a premium subscription period (30 days). Snapshotted into each submission at submission time — changing this doesn't affect pending submissions." },
  { key: "PREMIUM_PRICE_3MO", label: "Premium Price 3 Months (ETB)", category: "payments", description: "Price for a 3-month bundle. Admin sets independently — not auto-calculated. Default: 0 (falls back to monthly × 3)." },
  { key: "PREMIUM_PRICE_6MO", label: "Premium Price 6 Months (ETB)", category: "payments", description: "Price for a 6-month bundle. Admin sets independently. Default: 0 (falls back to monthly × 6)." },
  { key: "PREMIUM_PRICE_12MO", label: "Premium Price 12 Months (ETB)", category: "payments", description: "Price for a 12-month bundle. Admin sets independently. Default: 0 (falls back to monthly × 12)." },
  { key: "SLA_HOURS", label: "Review SLA (hours)", category: "payments", description: "Hours within which an admin should review a payment submission. Overdue submissions trigger goodwill compensation. Default: 24." },
  { key: "GOODWILL_BONUS_HOURS", label: "Goodwill Bonus (hours)", category: "payments", description: "Extra premium hours granted on top of the normal period when a submission's SLA is breached — an apology for the delay. Default: 24." },
  { key: "MANUAL_PAYMENT_TELEBIRR_NUMBER", label: "TeleBirr Receiver Number", category: "payments", description: "The personal TeleBirr phone number students send their payment to. Shown on the /upgrade page." },
  { key: "MANUAL_PAYMENT_TELEBIRR_NAME", label: "TeleBirr Account Holder Name", category: "payments", description: "Name shown on the receiving TeleBirr account (so students can verify they're sending to the right person)." },
  { key: "SMS_WEBHOOK_SECRET", label: "SMS Webhook HMAC Secret", category: "payments", description: "Shared secret for HMAC-SHA-256 signature verification on the /webhooks/sms endpoint. Must match the secret configured in the SMS-to-URL-Forwarder Android app. Sensitive — never expose to the client." },
  { key: "TELEGRAM_ADMIN_CHAT_ID", label: "Telegram Admin Chat ID", category: "comms", description: "Chat ID where payment-submission notifications are sent. Use @userinfobot to find your personal chat ID, or use a channel ID (starts with -100...)." },
  // ── Referral + discount program ────────────────────────────────────
  { key: "REFERRAL_PROGRAM_ENABLED", label: "Referral Program Enabled", category: "payments", description: "When true, students can generate and share referral links. When false, the referral section is hidden." },
  { key: "REFERRER_REWARD_DAYS", label: "Referrer Reward (days)", category: "payments", description: "Premium days granted to the referrer when their referral's first payment is approved. Default: 7." },
  { key: "REFEREE_REWARD_DAYS", label: "Referee Reward (days)", category: "payments", description: "Bonus premium days granted to the referred user on top of their first payment. Default: 3." },
  // ── Trial / subscription program ───────────────────────────────────
  { key: "FREE_TRIAL_DAYS", label: "Free Trial Days (active days)", category: "payments", description: "Number of ACTIVE-usage days new users get as a free premium trial. The trial counts days the student actually opens the app, not calendar days since signup. Default: 14. Changing this does NOT retroactively affect users whose trial already expired — use the Subscriptions tab → 'Bulk extend all trials' for that." },
  // ── Multi-language system ──────────────────────────────────────────
  // When "true", the language switcher UI is shown on the landing page + in
  // the dashboard account sheet, and signed-in users' preferredLanguage is
  // honoured. When unset/false, the frontend forces English everywhere and
  // hides all language UI (no visible trace the system exists).
  // Useful for keeping the UI clean while translations are still being
  // generated/reviewed — the platform owner can flip the switch the moment
  // they're happy with the Amharic/Afaan Oromo/Tigrigna translations.
  { key: "MULTI_LANGUAGE_ENABLED", label: "Multi-Language Enabled", category: "system", description: "Master switch for the 4-language UI (English / አማርኛ / Afaan Oromoo / ትግርኛ). When 'true', language switchers appear on the landing page and dashboard. When unset/false, the entire UI forces English and no language UI is visible. Default: false (English-only)." },
  // ── Schools feature ───────────────────────────────────────────────
  // Master toggle for the entire schools feature. When OFF, every public
  // surface (Landing section, footer link, /for-schools route, /school-admin
  // route) is entirely absent from the DOM. The admin's /admin → Schools
  // management tab stays visible regardless (so the admin can prepare a
  // school's setup before going live).
  { key: "SCHOOL_FEATURE_ENABLED", label: "Schools Feature Enabled", category: "system", description: "Master switch for the entire schools feature (bulk class onboarding, tiered seat pricing, director dashboard). When 'true', the Landing Schools section, footer link, /for-schools page, and /school-admin dashboard are all live. When unset/false, every public surface is entirely absent from the DOM (not just hidden) — but the admin's /admin → Schools management tab stays visible so you can prepare a school's setup before going live. Default: false." },
  // Tiered bulk-seat pricing — 4 independently admin-editable per-seat/month
  // rates (ETB). Same "admin sets explicit price per tier" pattern as the
  // personal 1/3/6/12-month plans. The director's purchase flow + the
  // /for-schools pricing calculator pull from these values.
  { key: "SCHOOL_SEAT_PRICE_TIER_1", label: "School Seat Price — Tier 1 (1-19 seats)", category: "payments", description: "Per-seat/month rate in ETB for 1-19 seats. Highest per-seat rate (smallest bulk discount). Default: 0 (admin must set before the pricing calculator shows real numbers)." },
  { key: "SCHOOL_SEAT_PRICE_TIER_2", label: "School Seat Price — Tier 2 (20-49 seats)", category: "payments", description: "Per-seat/month rate in ETB for 20-49 seats. Should be lower than Tier 1." },
  { key: "SCHOOL_SEAT_PRICE_TIER_3", label: "School Seat Price — Tier 3 (50-99 seats)", category: "payments", description: "Per-seat/month rate in ETB for 50-99 seats. Should be lower than Tier 2." },
  { key: "SCHOOL_SEAT_PRICE_TIER_4", label: "School Seat Price — Tier 4 (100+ seats)", category: "payments", description: "Per-seat/month rate in ETB for 100+ seats. Lowest per-seat rate (largest bulk discount)." },
] as const;

/**
 * Default values for config keys that have sensible defaults. When
 * resolveConfigValue returns undefined (no DB row, no env var), the
 * caller can fall back to these. This keeps the manual-payment system
 * working out-of-the-box without requiring the admin to set every key
 * before the first submission.
 */
export const CONFIG_DEFAULTS: Record<string, string> = {
  PREMIUM_PRICE_ETB: "500",
  PREMIUM_PRICE_3MO: "0",
  PREMIUM_PRICE_6MO: "0",
  PREMIUM_PRICE_12MO: "0",
  SLA_HOURS: "24",
  GOODWILL_BONUS_HOURS: "24",
  MANUAL_PAYMENT_TELEBIRR_NUMBER: "",
  MANUAL_PAYMENT_TELEBIRR_NAME: "",
  SMS_WEBHOOK_SECRET: "",
  TELEGRAM_ADMIN_CHAT_ID: "",
  CONTACT_GROUP_CHAT_ID: "",
  CONTACT_GROUP_INVITE_LINK: "",
  REFERRAL_PROGRAM_ENABLED: "true",
  REFERRER_REWARD_DAYS: "7",
  REFEREE_REWARD_DAYS: "3",
  FREE_TRIAL_DAYS: "14",
  // School seat pricing defaults — sensible bulk-discount tiers the admin
  // can override anytime from the Keys tab. These are starting points, not
  // hard requirements: the admin can set any value (including 0 for a
  // free pilot). The defaults give a real discount curve: 50 → 40 → 30 → 20
  // ETB/seat/month across the 4 tiers.
  SCHOOL_SEAT_PRICE_TIER_1: "50",
  SCHOOL_SEAT_PRICE_TIER_2: "40",
  SCHOOL_SEAT_PRICE_TIER_3: "30",
  SCHOOL_SEAT_PRICE_TIER_4: "20",
};

const CATEGORIES: Record<string, { label: string; icon: string }> = {
  ai: { label: "AI Providers", icon: "brain" },
  storage: { label: "Storage (R2)", icon: "hard-drive" },
  payments: { label: "Payments", icon: "credit-card" },
  comms: { label: "Communication", icon: "message-circle" },
  auth: { label: "Authentication", icon: "shield" },
  video: { label: "Video (Rooms)", icon: "video" },
  integrations: { label: "Integrations", icon: "git-branch" },
  system: { label: "System", icon: "settings" },
  custom: { label: "Custom Keys", icon: "key-round" },
};

export const CATEGORIES_META = CATEGORIES;

// Admin check consistent with the rest of the admin system (moderator+).
// Uses isAdminDoc from admin.ts so the same role-level threshold (>= 60)
// applies everywhere — no more "Super admin access required" crashes
// for admin/moderator users who can see the Admin page.
async function requireAdmin(ctx: { db: { get: (id: any) => Promise<any> }; auth: any }) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  const user = await ctx.db.get(userId);
  if (!user || !isAdminDoc(user)) {
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
    version: 4,
    features: ["db_key_resolution", "configKeys_table", "resolveConfigValue", "all_keys_db_backed", "custom_keys", "livekit_db", "github_db", "telegram_db", "payment_providers_db", "contact_group_config"],
  }),
});

/**
 * Public query (no auth required) — returns true if the multi-language UI
 * is enabled. The landing page + dashboard call this to decide whether to
 * render the language switcher. Honours the MULTI_LANGUAGE_ENABLED
 * configKey: "true" → on, anything else (or unset) → off.
 *
 * Default is OFF — admin must explicitly enable it via the Keys tab →
 * System category once translations are ready. This keeps the UI clean
 * while the platform owner is still reviewing translations.
 */
export const getMultiLanguageEnabled = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", "MULTI_LANGUAGE_ENABLED"))
      .first();
    return row?.value === "true";
  },
});

/**
 * SCHOOL_FEATURE_ENABLED — master toggle for the entire schools feature.
 *
 * When OFF (default), every public surface of the schools feature is
 * entirely absent from the DOM (not just hidden via CSS):
 *   • Landing page Schools section — not rendered
 *   • Footer /for-schools link — not rendered
 *   • /for-schools route — redirects to /
 *   • Onboarding "Have a class code?" field — not rendered
 *   • Settings class-code redemption + "share progress with school" — not rendered
 *   • /school-admin route — redirects to /dashboard
 *
 * EXCEPTION: the platform admin's /admin → Schools management tab stays
 * visible regardless of the toggle. The admin can prepare a school's
 * setup (create schools, assign directors, configure classes) in the
 * background before flipping the switch to go live.
 *
 * Same pattern as getMultiLanguageEnabled — admin edits via the Keys tab.
 */
export const getSchoolFeatureEnabled = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const row = await ctx.db
      .query("configKeys")
      .withIndex("by_key", (q) => q.eq("key", "SCHOOL_FEATURE_ENABLED"))
      .first();
    return row?.value === "true";
  },
});

/**
 * School bulk-seat pricing tiers — 4 independently admin-editable per-
 * seat/month rates. Same "admin sets explicit price per tier" pattern as
 * the personal 1/3/6/12-month plans (independent configurable values,
 * not auto-calculated percentages).
 *
 *   TIER 1: 1-19 seats    → SCHOOL_SEAT_PRICE_TIER_1 (highest per-seat rate)
 *   TIER 2: 20-49 seats   → SCHOOL_SEAT_PRICE_TIER_2
 *   TIER 3: 50-99 seats   → SCHOOL_SEAT_PRICE_TIER_3
 *   TIER 4: 100+ seats    → SCHOOL_SEAT_PRICE_TIER_4 (lowest per-seat rate)
 *
 * Returns all 4 values as numbers (ETB). Unset keys default to 0 — the
 * admin must set them before the pricing calculator / purchase flow
 * shows real numbers.
 */
export const getSchoolSeatPricing = query({
  args: {},
  handler: async (ctx): Promise<{
    tier1: number; // 1-19 seats
    tier2: number; // 20-49 seats
    tier3: number; // 50-99 seats
    tier4: number; // 100+ seats
  }> => {
    const keys = [
      "SCHOOL_SEAT_PRICE_TIER_1",
      "SCHOOL_SEAT_PRICE_TIER_2",
      "SCHOOL_SEAT_PRICE_TIER_3",
      "SCHOOL_SEAT_PRICE_TIER_4",
    ];
    const vals: number[] = [];
    for (const k of keys) {
      const row = await ctx.db
        .query("configKeys")
        .withIndex("by_key", (q) => q.eq("key", k))
        .first();
      // Fall back to CONFIG_DEFAULTS when no DB row exists — so the
      // pricing calculator shows real numbers even before the admin
      // configures the Keys tab. The admin can override anytime.
      if (row?.value) {
        vals.push(parseInt(row.value, 10) || 0);
      } else {
        const def = CONFIG_DEFAULTS[k];
        vals.push(def ? parseInt(def, 10) || 0 : 0);
      }
    }
    return {
      tier1: vals[0]!,
      tier2: vals[1]!,
      tier3: vals[2]!,
      tier4: vals[3]!,
    };
  },
});

/**
 * Resolve the correct per-seat/month rate for a given seat count.
 * Used by the school bulk purchase flow + the pricing calculator.
 */
export function getTierRateForSeatCount(
  seatCount: number,
  pricing: { tier1: number; tier2: number; tier3: number; tier4: number },
): number {
  if (seatCount >= 100) return pricing.tier4;
  if (seatCount >= 50) return pricing.tier3;
  if (seatCount >= 20) return pricing.tier2;
  return pricing.tier1;
}

/**
 * Internal version of getSchoolSeatPricing — callable from mutations
 * (e.g. schools.ts directorSubmitSeatPurchase snapshots the tier rate
 * at submit time so a later price change doesn't affect the submission).
 */
export const getSchoolSeatPricingInternal = internalQuery({
  args: {},
  handler: async (ctx): Promise<{
    tier1: number;
    tier2: number;
    tier3: number;
    tier4: number;
  }> => {
    const keys = [
      "SCHOOL_SEAT_PRICE_TIER_1",
      "SCHOOL_SEAT_PRICE_TIER_2",
      "SCHOOL_SEAT_PRICE_TIER_3",
      "SCHOOL_SEAT_PRICE_TIER_4",
    ];
    const vals: number[] = [];
    for (const k of keys) {
      const row = await ctx.db
        .query("configKeys")
        .withIndex("by_key", (q) => q.eq("key", k))
        .first();
      if (row?.value) {
        vals.push(parseInt(row.value, 10) || 0);
      } else {
        const def = CONFIG_DEFAULTS[k];
        vals.push(def ? parseInt(def, 10) || 0 : 0);
      }
    }
    return {
      tier1: vals[0]!,
      tier2: vals[1]!,
      tier3: vals[2]!,
      tier4: vals[3]!,
    };
  },
});
