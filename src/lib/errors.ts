// Error message helpers.
//
// Two layers:
//
//   1. errorMessage() / errorCode() — the original extractors. They pull
//      the raw message + code out of ConvexError / Error / unknown. These
//      are still used internally by the friendly/technical layers and by
//      any callers that want the raw extraction (e.g. logging).
//
//   2. friendlyErrorMessage() — maps known ConvexError patterns to sweet,
//      polite, INSANE-in-a-good-way messages for normal users. Falls back
//      to the provided context fallback when the error doesn't match a
//      known pattern.
//
//   3. technicalErrorMessage() — the OPPOSITE of friendly. Shows the full
//      error including code + type + first stack line. For ADMINS only.
//
//   4. useFriendlyError() — React hook that picks between friendly and
//      technical based on the current user's role. Admins see technical;
//      everyone else sees friendly. Use this in any component that
//      surfaces errors to the user (toast, alert, inline message).
//
// The mapping table is at the bottom — add new patterns there.

import { useCallback } from "react";
import { useAuth } from "@/hooks/use-auth";

/** Pull a user-friendly message out of ConvexError / Error / unknown. */
export function errorMessage(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (error instanceof Error) {
    // Convex wraps thrown ConvexErrors as "ConvexError: <message>".
    return error.message.replace(/^ConvexError:\s*/, "") || fallback;
  }
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { message?: string } }).data;
    if (data?.message) return data.message;
  }
  return fallback;
}

/**
 * Extract the machine-readable reason code from a thrown ConvexError
 * (e.g. "daily_limit_reached", "weekly_quiz_limit", "premium_content").
 * Returns null when the error carries no code.
 */
export function errorCode(error: unknown): string | null {
  if (error instanceof Error && (error as { code?: string }).code) {
    const c = (error as { code?: string }).code;
    if (c) return c;
  }
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { code?: string } }).data;
    if (data && typeof data.code === "string" && data.code) return data.code;
  }
  // Some thrown errors put the code on the top-level object.
  if (typeof error === "object" && error !== null && "code" in error) {
    const c = (error as { code?: unknown }).code;
    if (typeof c === "string" && c) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Friendly error mapping (for normal users)
// ---------------------------------------------------------------------------

const GENERIC_FRIENDLY_FALLBACK =
  "Something went wrong on our end. Please try again — and let us know if it keeps happening. 💜";

interface FriendlyMapping {
  /** Match by Convex error code (preferred — most specific). */
  code?: string;
  /** Match by substring(s) of the message (lowercased). Any match wins. */
  messageIncludes?: string[];
  /** The friendly message. */
  friendly: string;
}

/**
 * The mapping table. Order matters only for readability — code matches
 * always win over message-substring matches regardless of order.
 *
 * When adding a new mapping, put the error code if the backend throws
 * ConvexError({ message, code }) — that's the most reliable match.
 * Otherwise fall back to messageIncludes with the most stable substring
 * of the message.
 */
const FRIENDLY_MAPPINGS: FriendlyMapping[] = [
  // ── Auth ───────────────────────────────────────────────────────────
  {
    messageIncludes: ["sign in required", "not authenticated", "unauthorized", "you must be signed in"],
    friendly: "Please sign in to continue. 🔐",
  },

  // ── Squad / group errors ──────────────────────────────────────────
  {
    messageIncludes: [
      "already in this group",
      "already in this squad",
      "you're already in",
      "you are already in",
    ],
    friendly: "Looks like you're already part of this squad! 🎉",
  },
  {
    messageIncludes: [
      "invite code doesn't match",
      "doesn't match any group",
      "no group matches",
    ],
    friendly:
      "Hmm, that invite code doesn't match any squad. Double-check it with your friend. 🤔",
  },
  {
    messageIncludes: ["group is full", "squad is full", "this group is full"],
    friendly:
      "This squad is full right now — try another one, or ask the owner to make room. 👥",
  },
  {
    messageIncludes: [
      "not in this group",
      "not a member of this group",
      "you're not in",
      "you are not in",
    ],
    friendly:
      "You're not in this squad yet — ask the owner for an invite code. 🚪",
  },
  {
    messageIncludes: [
      "only owners",
      "only the owner",
      "only owner",
      "only owners can",
    ],
    friendly: "Only the squad owner can do this — ask them to handle it. 👑",
  },
  {
    messageIncludes: [
      "only owners, admins",
      "only owners and admins",
      "owner or admin",
      "owners and admins can",
    ],
    friendly:
      "Only squad owners or admins can do this — ask one of them. 🛡️",
  },
  {
    messageIncludes: [
      "only owners, admins, and mentors",
      "owners, admins, and mentors",
    ],
    friendly:
      "Only owners, admins, or mentors can do this — ask one of them. 🎓",
  },
  {
    messageIncludes: ["enter an invite code", "enter the invite code", "invite code is required"],
    friendly: "Pop in the invite code your friend shared with you. ✨",
  },
  {
    messageIncludes: ["group name is required", "squad name is required"],
    friendly: "Give your squad a name first. ✏️",
  },
  {
    messageIncludes: ["group name is too long", "squad name is too long"],
    friendly: "That name is a bit too long — try keeping it under 60 characters. ✂️",
  },
  {
    messageIncludes: ["enter the", "is required", "title is required", "topic is required", "goal must be"],
    friendly: "Hmm, something about your input looks off. Please double-check and try again. ✏️",
  },

  // ── AI errors ──────────────────────────────────────────────────────
  {
    code: "ai_not_configured",
    friendly:
      "Our AI is taking a quick break — please try again, or let an admin know to set it up. 🤖",
  },
  {
    code: "ai_parse_error",
    friendly:
      "The AI gave us something we couldn't quite parse — please give it another try. 🤖",
  },
  {
    code: "ai_empty",
    friendly: "The AI didn't have anything to say this time — please try again. 🤖",
  },
  {
    messageIncludes: ["ai is not configured", "groq api", "groq api error"],
    friendly:
      "Our AI is taking a quick break — please try again in a moment. 🤖",
  },

  // ── Rate limits / quotas ──────────────────────────────────────────
  {
    code: "daily_limit_reached",
    friendly: "You've hit today's limit — come back tomorrow for more! ⏰",
  },
  {
    code: "weekly_quiz_limit",
    friendly: "You've used all your weekly quizzes — they refresh next week! 📅",
  },
  {
    code: "daily_message_limit",
    friendly: "You've used all your daily AI messages — they refresh overnight. 🌙",
  },
  {
    messageIncludes: ["rate limit", "too many requests", "rate-limited"],
    friendly:
      "Slow down a sec — you're going faster than we can keep up with. Try again in a moment. 🐢",
  },

  // ── Premium ────────────────────────────────────────────────────────
  {
    code: "premium_required",
    messageIncludes: ["premium required", "premium content", "premium feature"],
    friendly: "This is a premium feature — upgrade to unlock it! ✨",
  },

  // ── Network / connection ──────────────────────────────────────────
  {
    messageIncludes: [
      "network request failed",
      "network error",
      "fetch failed",
      "failed to fetch",
      "load failed",
    ],
    friendly:
      "Your connection hiccuped — please check your internet and try again. 📡",
  },
  {
    messageIncludes: ["timeout", "timed out", "request timeout"],
    friendly:
      "That took too long — please try again. If it keeps happening, your connection might be slow. ⏱️",
  },

  // ── Not found ──────────────────────────────────────────────────────
  {
    code: "not_found",
    messageIncludes: ["not found", "couldn't find", "could not find", "no longer exists"],
    friendly:
      "We couldn't find that — it may have been moved or removed. 🔍",
  },

  // ── Forbidden ──────────────────────────────────────────────────────
  {
    code: "forbidden",
    messageIncludes: ["don't have permission", "do not have permission", "forbidden"],
    friendly: "You don't have permission to do this. 🚫",
  },

  // ── Deployment / stale backend ─────────────────────────────────────
  {
    messageIncludes: [
      "could not find public function",
      "couldn't find public function",
      "function not found",
      "no public function",
    ],
    friendly:
      "We're updating our systems — please refresh the page and try again. 🔄",
  },

  // ── Reader / PDF extraction ────────────────────────────────────────
  {
    messageIncludes: ["couldn't extract text", "could not extract text", "couldn't extract"],
    friendly:
      "We couldn't read the text from that — try a different file, or check back later. 📄",
  },

  // ── Live rooms / video ─────────────────────────────────────────────
  {
    messageIncludes: ["room not configured", "livekit", "video provider"],
    friendly:
      "Live rooms aren't quite ready yet — please ask an admin to set up the video provider. 🎥",
  },
  {
    messageIncludes: ["room is full", "room full"],
    friendly:
      "That room is full right now — try again in a moment, or start your own. 🎥",
  },

  // ── Quiz battle / squad action errors ─────────────────────────────
  {
    messageIncludes: ["battle not found", "challenge not found"],
    friendly: "That battle/challenge is gone — it may have ended. 🎮",
  },
  {
    messageIncludes: ["battle not active", "challenge is not active"],
    friendly: "That battle/challenge isn't active anymore — refresh and pick a new one. 🎮",
  },
  {
    messageIncludes: ["only the host can", "only host can"],
    friendly: "Only the host can do that — wait for them or ask to take over. 🎤",
  },
  {
    messageIncludes: ["join the battle first", "join first"],
    friendly: "Join the battle first, then you can answer. ⚔️",
  },

  // ── Generic Convex invalid ────────────────────────────────────────
  {
    code: "invalid",
    friendly:
      "Hmm, something about your input looks off. Please double-check and try again. ✏️",
  },
];

/**
 * Friendly error message for normal users. Maps known ConvexError patterns
 * to sweet, polite, helpful messages. Falls back to the provided context
 * fallback when the error doesn't match a known pattern.
 *
 * The fallback is the USER-FACING CONTEXT (e.g. "Could not create the squad."),
 * NOT a technical error message. Use it to tell the user what they were
 * trying to do — friendlyErrorMessage handles the rest.
 */
export function friendlyErrorMessage(error: unknown, fallback?: string): string {
  const rawMessage = errorMessage(error, "");
  const code = errorCode(error);
  const messageLower = rawMessage.toLowerCase();

  // Code match takes priority — most specific.
  if (code) {
    for (const mapping of FRIENDLY_MAPPINGS) {
      if (mapping.code && mapping.code === code) {
        return mapping.friendly;
      }
    }
  }
  // Then substring match.
  if (rawMessage) {
    for (const mapping of FRIENDLY_MAPPINGS) {
      if (mapping.messageIncludes?.some((s) => messageLower.includes(s))) {
        return mapping.friendly;
      }
    }
  }
  // No mapping matched — if we have a real (short, non-technical) message,
  // surface it directly. Otherwise use the context fallback or generic.
  if (rawMessage && rawMessage.length > 0 && rawMessage.length < 160) {
    // Heuristic: if the raw message looks like a user-facing sentence
    // (starts with a capital, ends with punctuation), show it.
    if (/^[A-Z]/.test(rawMessage) && /[.!?]$/.test(rawMessage)) {
      return rawMessage;
    }
  }
  return fallback ?? GENERIC_FRIENDLY_FALLBACK;
}

// ---------------------------------------------------------------------------
// Technical error message (for admins)
// ---------------------------------------------------------------------------

/**
 * Technical error message for ADMINS. Shows the full error including
 * code + type + first stack line — everything an admin needs to debug
 * without digging into browser devtools.
 *
 * Format: "<message> [code: <code>] (<ErrorType>)"
 * Plus the first "at ..." stack line if available.
 */
export function technicalErrorMessage(error: unknown, fallback = "Unknown error"): string {
  const rawMessage = errorMessage(error, fallback);
  const code = errorCode(error);
  const parts: string[] = [rawMessage];

  if (code) parts.push(`[code: ${code}]`);

  // Add the error type name (Error, ConvexError, TypeError, etc.)
  if (error instanceof Error) {
    parts.push(`(${error.name})`);
  } else if (error && typeof error === "object" && "constructor" in error) {
    const ctor = (error as { constructor: { name?: string } }).constructor;
    if (ctor?.name) parts.push(`(${ctor.name})`);
  }

  // First "at ..." line of the stack — gives the function/file context
  if (error instanceof Error && error.stack) {
    const firstLine = error.stack
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("at "));
    if (firstLine) parts.push(firstLine);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// React hook — picks friendly vs technical based on the user's role
// ---------------------------------------------------------------------------

const ADMIN_ROLES = new Set(["super_admin", "admin", "moderator"]);

/**
 * Hook that returns an error-message function. The returned function
 * behaves differently based on the current user's role:
 *
 *   - ADMINS (super_admin, admin, moderator) → technicalErrorMessage
 *     Shows the full error including code + type + first stack line.
 *     Useful for debugging — the admin can see exactly what went wrong.
 *
 *   - Normal users → friendlyErrorMessage
 *     Maps known patterns to sweet, polite, helpful messages. Falls back
 *     to the provided context fallback when the error is unknown.
 *
 * Usage:
 *   const friendlyError = useFriendlyError();
 *   try { await joinGroup({ ... }); }
 *   catch (e) { toast.error(friendlyError(e, "Could not join the squad.")); }
 *
 * The fallback is the USER-FACING CONTEXT ("Could not join the squad."),
 * NOT a technical message. For admins, the technical detail comes from
 * the error itself, not the fallback.
 */
export function useFriendlyError() {
  const { user } = useAuth();
  const isAdmin = !!user?.role && ADMIN_ROLES.has(user.role);
  return useCallback(
    (error: unknown, fallback?: string) => {
      if (isAdmin) {
        return technicalErrorMessage(error, fallback ?? "Unknown error");
      }
      return friendlyErrorMessage(error, fallback);
    },
    [isAdmin],
  );
}
