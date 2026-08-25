// Internal observability — the admin "Terminal".
//
// Critical paths write one systemEvents row per significant operation (AI
// provider calls, payments, auth events, room lifecycle, content uploads).
// This is deliberately NOT per-request instrumentation: the goal is signal —
// cost/latency visibility on AI calls, payment failures, auth problems —
// not noise. The admin feed is a reactive Convex query, so the Terminal tab
// updates live with no polling.

import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import {
  action,
  internalMutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isAdmin } from "./admin";

type DbCtx = QueryCtx | MutationCtx;
type SystemEventType =
  | "api_call"
  | "error"
  | "auth_event"
  | "payment_event"
  | "room_event"
  | "content_event";

async function requireAdmin(ctx: DbCtx): Promise<void> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
  }
  const user = await ctx.db.get(userId);
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({
      message: "Admin access required.",
      code: "unauthorized",
    });
  }
}

// ---------------------------------------------------------------------------
// Logging (internal only — never callable from the client)
// ---------------------------------------------------------------------------

/**
 * Write one observability row. `metadata` is a plain object that gets
 * stringified — never log secrets; log identifiers, counts and latencies.
 */
export const logEvent = internalMutation({
  args: {
    eventType: v.union(
      v.literal("api_call"),
      v.literal("error"),
      v.literal("auth_event"),
      v.literal("payment_event"),
      v.literal("room_event"),
      v.literal("content_event"),
    ),
    source: v.string(),
    status: v.union(v.literal("success"), v.literal("error")),
    userId: v.optional(v.id("users")),
    metadata: v.optional(v.string()),
    durationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("systemEvents", {
      eventType: args.eventType,
      source: args.source,
      status: args.status,
      userId: args.userId,
      metadata: args.metadata,
      durationMs: args.durationMs,
      createdAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Action-side logging helper — the common way to log from actions that
 * already have an ActionCtx (AI calls, payments, rooms).
 */
export async function logEventAction(
  ctx: ActionCtx,
  args: {
    eventType: SystemEventType;
    source: string;
    status: "success" | "error";
    userId?: Id<"users"> | null;
    metadata?: Record<string, unknown>;
    durationMs?: number;
  },
): Promise<void> {
  try {
    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: args.eventType,
      source: args.source,
      status: args.status,
      userId: args.userId ?? undefined,
      metadata: args.metadata ? JSON.stringify(args.metadata) : undefined,
      durationMs: args.durationMs,
    });
  } catch {
    // Observability must never break the flow it observes.
  }
}

// ---------------------------------------------------------------------------
// Admin read API — live feed + health summary
// ---------------------------------------------------------------------------

export interface SystemEventRow {
  _id: Id<"systemEvents">;
  eventType: string;
  source: string;
  status: string;
  userId: Id<"users"> | null;
  metadata: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: number;
}

export interface SystemEventPage {
  events: SystemEventRow[];
  nextCursor: string | null;
}

/**
 * Paginated, filterable event feed for the Terminal tab.
 *
 * - Filters: eventType, status, and a `since` floor (date range).
 * - Pagination: opaque keyset cursor over (createdAt desc, _id) — the
 *   terminal scrolls backwards through history with a "load older" button;
 *   the latest events always arrive via Convex reactivity.
 * - `nextCursor` is null when the end of history is reached.
 */
export const getSystemEvents = query({
  args: {
    eventType: v.optional(v.string()),
    status: v.optional(v.union(v.literal("success"), v.literal("error"))),
    since: v.optional(v.number()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SystemEventPage> => {
    await requireAdmin(ctx);
    const limit = Math.min(Math.max(args.limit ?? 80, 10), 300);

    // Parse the opaque cursor: { createdAt, id } — the last row of the
    // previous page, used as a keyset boundary.
    let cursorBoundary: { createdAt: number; id: string } | null = null;
    if (args.cursor) {
      try {
        const parsed = JSON.parse(args.cursor) as { createdAt?: number; id?: string };
        if (
          typeof parsed.createdAt === "number" &&
          typeof parsed.id === "string"
        ) {
          cursorBoundary = { createdAt: parsed.createdAt, id: parsed.id };
        }
      } catch {
        // invalid cursor -> start from the top
      }
    }

    const since = args.since && Number.isFinite(args.since) ? args.since : 0;
    const upper =
      cursorBoundary === null ? Number.MAX_SAFE_INTEGER : cursorBoundary.createdAt;

    let rows = await ctx.db
      .query("systemEvents")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", since).lte("createdAt", upper),
      )
      .order("desc")
      .take(limit + 1);

    // Keyset tiebreak: exclude rows at the exact boundary timestamp that were
    // already returned (Convex ids are unique within a timestamp bucket).
    if (cursorBoundary) {
      rows = rows.filter(
        (row) =>
          row.createdAt < cursorBoundary!.createdAt ||
          (row.createdAt === cursorBoundary!.createdAt &&
            row._id < cursorBoundary!.id),
      );
    }

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Event-type/status filters applied after the index scan (the index only
    // covers createdAt; the catalog is small enough that this stays cheap).
    let filtered = page.filter((row) => {
      if (args.eventType && row.eventType !== args.eventType) return false;
      if (args.status && row.status !== args.status) return false;
      return true;
    });

    let nextCursor: string | null = null;
    if (hasMore && filtered.length > 0) {
      const last = filtered[filtered.length - 1]!;
      nextCursor = JSON.stringify({ createdAt: last.createdAt, id: last._id });
    }

    // If filters ate the whole page, keep scanning older rows so the "load
    // older" button always makes progress (bounded to a few extra fetches).
    if (hasMore && filtered.length === 0) {
      const cursorArg = JSON.stringify({
        createdAt: page[page.length - 1]!.createdAt,
        id: page[page.length - 1]!._id,
      });
      const deeper = await ctx.db
        .query("systemEvents")
        .withIndex("by_createdAt", (q) =>
          q.gte("createdAt", since).lte("createdAt", page[page.length - 1]!.createdAt),
        )
        .order("desc")
        .take(limit);
      filtered = deeper.filter((row) => {
        if (args.eventType && row.eventType !== args.eventType) return false;
        if (args.status && row.status !== args.status) return false;
        return true;
      });
      nextCursor =
        filtered.length > 0
          ? JSON.stringify({
              createdAt: filtered[filtered.length - 1]!.createdAt,
              id: filtered[filtered.length - 1]!._id,
            })
          : null;
      void cursorArg;
    }

    return {
      events: filtered.map((row) => ({
        _id: row._id,
        eventType: row.eventType,
        source: row.source,
        status: row.status,
        userId: row.userId ?? null,
        metadata: row.metadata ? safeParseJson(row.metadata) : null,
        durationMs: row.durationMs ?? null,
        createdAt: row.createdAt,
      })),
      nextCursor,
    };
  },
});

function safeParseJson(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // fall through
  }
  return { raw };
}

export interface SystemHealthSummary {
  last24hCount: number;
  byType: { eventType: string; count: number; errors: number }[];
  errorRate: number;
  avgAiLatencyMs: number;
  aiCallsLast24h: number;
  activeUsersRightNow: number;
  lastEventAt: number | null;
}

/** 24h health summary for the Terminal tab's stat strip. */
export const getSystemHealthSummary = query({
  args: {},
  handler: async (ctx): Promise<SystemHealthSummary> => {
    await requireAdmin(ctx);
    const since = Date.now() - 24 * 60 * 60 * 1000;
    const rows = await ctx.db
      .query("systemEvents")
      .withIndex("by_createdAt", (q) => q.gte("createdAt", since))
      .take(2000);

    const byType = new Map<string, { count: number; errors: number }>();
    let errors = 0;
    let aiDurationTotal = 0;
    let aiCalls = 0;
    const seenUsers = new Set<string>();
    for (const row of rows) {
      const entry = byType.get(row.eventType) ?? { count: 0, errors: 0 };
      entry.count += 1;
      if (row.status === "error") {
        entry.errors += 1;
        errors += 1;
      }
      byType.set(row.eventType, entry);
      if (row.eventType === "api_call" && row.source.startsWith("ai.")) {
        aiCalls += 1;
        if (row.durationMs) aiDurationTotal += row.durationMs;
      }
      if (row.userId) seenUsers.add(row.userId);
    }

    // "Active right now": distinct users with any event in the last 15 min
    // (systemEvents carries userId on user-scoped calls). Also fold in
    // recent study sessions for students who studied without triggering a
    // system event.
    const activeNow = new Set(seenUsers);
    const recentSessions = await ctx.db
      .query("studySessions")
      .filter((q) => q.gte(q.field("startedAt"), Date.now() - 15 * 60 * 1000))
      .take(300);
    for (const session of recentSessions) activeNow.add(session.userId);

    return {
      last24hCount: rows.length,
      byType: [...byType.entries()].map(([eventType, value]) => ({
        eventType,
        count: value.count,
        errors: value.errors,
      })),
      errorRate: rows.length > 0 ? errors / rows.length : 0,
      avgAiLatencyMs: aiCalls > 0 ? Math.round(aiDurationTotal / aiCalls) : 0,
      aiCallsLast24h: aiCalls,
      activeUsersRightNow: activeNow.size,
      lastEventAt: rows.length > 0 ? Math.max(...rows.map((row) => row.createdAt)) : null,
    };
  },
});

// ---------------------------------------------------------------------------
// Integration connection tests (A3) — lightweight pings, never expose values
// ---------------------------------------------------------------------------

/**
 * Test an integration's configured key with a real, read-only API call.
 * Never returns the key itself — only whether it authenticates and a hint.
 */
export const testIntegrationConnection = action({
  args: {
    integration: v.union(
      v.literal("groq"),
      v.literal("telegram"),
      v.literal("github"),
    ),
  },
  handler: async (ctx, { integration }): Promise<{
    configured: boolean;
    ok: boolean;
    detail: string | null;
  }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new ConvexError({ message: "Sign in required.", code: "unauthorized" });
    }
    const user = await ctx.runQuery(internal.admin.getUserById, { userId });
    if (!(await isAdmin(ctx, user))) {
      throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
    }

    const start = Date.now();
    if (integration === "github") {
      const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "GITHUB_TOKEN" });
      if (!token) {
        return { configured: false, ok: false, detail: "GITHUB_TOKEN missing" };
      }
      const response = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "nexus-academy",
        },
      });
      if (!response.ok) {
        return {
          configured: true,
          ok: false,
          detail: `GitHub rejected the token (HTTP ${response.status})`,
        };
      }
      const data = (await response.json()) as { login?: string };
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "admin.testIntegration.github",
        status: "success",
        userId,
        durationMs: Date.now() - start,
      });
      return {
        configured: true,
        ok: true,
        detail: `Authenticated as @${data.login ?? "unknown"}`,
      };
    }

    try {
      if (integration === "groq") {
        const key = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "GROQ_API_KEY" }) ?? process.env.GROQ_API_KEY;
        if (!key) return { configured: false, ok: false, detail: "GROQ_API_KEY not set — add it in the Keys tab" };
        const response = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (!response.ok) {
          return {
            configured: true,
            ok: false,
            detail: `Groq rejected the key (HTTP ${response.status})`,
          };
        }
        const data = (await response.json()) as { data?: { id: string }[] };
        const names = (data.data ?? []).map((model) => model.id).slice(0, 3);
        await logEventAction(ctx, {
          eventType: "api_call",
          source: "admin.testIntegration.groq",
          status: "success",
          userId,
          durationMs: Date.now() - start,
        });
        return {
          configured: true,
          ok: true,
          detail: `Key authenticates — models include ${names.join(", ")}`,
        };
      }

      // telegram
      const token = await ctx.runQuery(internal.configKeys.resolveConfigValue, { key: "TELEGRAM_BOT_TOKEN" });
      if (!token) {
        return { configured: false, ok: false, detail: "TELEGRAM_BOT_TOKEN missing" };
      }
      const response = await fetch(
        `https://api.telegram.org/bot${token}/getMe`,
      );
      if (!response.ok) {
        return {
          configured: true,
          ok: false,
          detail: `Telegram rejected the token (HTTP ${response.status})`,
        };
      }
      const data = (await response.json()) as {
        result?: { username?: string; first_name?: string };
      };
      await logEventAction(ctx, {
        eventType: "api_call",
        source: "admin.testIntegration.telegram",
        status: "success",
        userId,
        durationMs: Date.now() - start,
      });
      return {
        configured: true,
        ok: true,
        detail: `Bot @${data.result?.username ?? "unknown"} is live`,
      };
    } catch (error) {
      await logEventAction(ctx, {
        eventType: "error",
        source: `admin.testIntegration.${integration}`,
        status: "error",
        userId,
        durationMs: Date.now() - start,
      });
      return {
        configured: true,
        ok: false,
        detail: error instanceof Error ? error.message : "Connection test failed",
      };
    }
  },
});

// ---------------------------------------------------------------------------
// Client-side error logging (public action — callable from the browser)
// ---------------------------------------------------------------------------

/**
 * Log a client-side error (React error boundary, unhandled rejection, etc.)
 * to the systemEvents table so it's visible in the admin Terminal.
 *
 * No auth required — we want to capture errors even for unauthenticated
 * users (landing page, auth page).  The metadata is capped at 4 KB to
 * prevent abuse.
 */
export const logClientError = action({
  args: {
    message: v.string(),
    source: v.string(),
    stack: v.optional(v.string()),
    url: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      await ctx.runMutation(internal.systemEvents.logEvent, {
        eventType: "error",
        source: args.source,
        status: "error",
        metadata: JSON.stringify({
          message: args.message.slice(0, 1000),
          stack: args.stack?.slice(0, 3000),
          url: args.url?.slice(0, 500),
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent?.slice(0, 300) : null,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch {
      // Observability must never break the flow it observes.
    }
    return { ok: true };
  },
});
