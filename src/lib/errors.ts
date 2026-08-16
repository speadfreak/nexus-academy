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
