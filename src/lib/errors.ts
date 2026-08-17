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
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = (error as { data?: { code?: string } }).data;
    if (data && typeof data.code === "string" && data.code) return data.code;
  }
  return null;
}
