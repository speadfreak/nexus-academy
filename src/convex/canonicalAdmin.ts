// Canonical platform ownership — single source of truth for who owns the
// admin surface.
//
// WHY THIS EXISTS: the admin model used to bootstrap the FIRST non-anonymous
// user into super_admin, which is wrong for a platform with exactly one
// owner. This module pins ownership to an explicit email allowlist:
//
//   1. Any signed-in user whose email is on this list IS the super admin —
//      even before their role is persisted (queries check this cheaply).
//   2. `enforceCanonicalAdmins` (admin.ts) demotes every other elevated
//      account and promotes the canonical owner in one idempotent sweep.
//   3. The old "first user becomes admin" bootstrap is gone — nobody can
//      claim the admin surface by being first anymore.
//
// This module is deliberately dependency-free (no Convex imports) so the
// engine test suite can exercise the exact same logic the backend runs.

/** The platform owner(s). Case-insensitive match on the users.email field. */
export const SUPER_ADMIN_EMAILS: readonly string[] = [
  "jossyman783@gmail.com",
];

/** Normalize an email for comparison (trim + lowercase). */
export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Pure check: does this email belong to the canonical platform owner?
 * Tolerates null/undefined (anonymous users) — returns false.
 */
export function isCanonicalSuperAdminEmail(
  email: string | null | undefined,
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return SUPER_ADMIN_EMAILS.some((canonical) => canonical === normalized);
}
