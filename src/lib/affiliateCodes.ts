// Affiliate promoter-code helpers — PURE functions, no Convex / React
// imports. Shared by:
//   • src/convex/affiliates.ts          (server-side validation + generation)
//   • src/components/admin/AdminAffiliatesSection.tsx (live code preview)
//   • scripts/check-affiliate-codes.mjs (unit test vs the router)
//
// CODE RULES (from the affiliate program spec):
//   • uppercase A–Z0–9 only, 3–20 chars
//   • derived from the promoter's name: uppercase, strip spaces / symbols /
//     non A–Z0–9, truncate to 20
//   • if empty after cleaning (e.g. Amharic-only names) the admin MUST type
//     a code manually
//   • if the natural code is taken, append a number (MELODY → MELODY2)
//   • reserved words can never be codes: every existing top-level route
//     segment in main.tsx (ABOUT, FAQ, PRICING, DASHBOARD, …) plus PARTNER
//     and API. `check-affiliate-codes.mjs` verifies this constant against
//     the actual <Route path> list in src/main.tsx so the two can't drift.

export const CODE_MIN_LEN = 3;
export const CODE_MAX_LEN = 20;
export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

/**
 * Every top-level route segment currently registered in src/main.tsx
 * (paths are lowercase in the router; reserved codes are uppercase).
 * A promoter code that equals any of these (case-insensitively) would be
 * shadowed by the real route — `/:code` is registered LAST, so the real
 * route always wins — which would silently break the promoter's link.
 *
 * VERIFIED by scripts/check-affiliate-codes.mjs against src/main.tsx.
 * When you add a top-level route to main.tsx, add it here too (the check
 * script will fail loudly otherwise).
 */
export const RESERVED_CODES = [
  // Real top-level route segments from main.tsx (verbatim list)
  "COVERAGE",
  "PRIVACY",
  "TERMS",
  "ABOUT",
  "FAQ",
  "HELP",
  "TOOLS",
  "CONTACT",
  "PRICING",
  "FOR-STUDENTS",
  "FOR-TEACHERS",
  "FOR-PARENTS",
  "FOR-SCHOOLS",
  "SCHOOL-ADMIN",
  "SCHOOL-SETUP",
  "LIBRARY",
  "DASHBOARD",
  "EXAM-PREP",
  "TUTOR",
  "TODOS",
  "FOCUS",
  "PLANS",
  "JOURNEY",
  "CALENDAR",
  "NOTES",
  "MISTAKES",
  "FLASHCARDS",
  "STUDY-CARDS",
  "ACHIEVEMENTS",
  "GROUPS",
  "ROOMS",
  "READ",
  "MOCK-EXAM",
  "APTITUDE-HUB",
  "SETTINGS",
  "NOTIFICATIONS",
  "UPGRADE",
  "ADMIN",
  "AUTH",
  // Infrastructure / future-proofing (not in the router, always reserved)
  "PARTNER",
  "API",
  "ASSETS",
  "PUBLIC",
  "STATIC",
  "SITEMAP",
  "ROBOTS",
  "MANIFEST",
  "SW",
  "INDEX",
] as const;

/** Uppercase-set lookup for fast membership tests. */
export const RESERVED_CODE_SET = new Set<string>(RESERVED_CODES);

/** True when `code` collides with a router path or an infrastructure segment. */
export function isReservedCode(code: string): boolean {
  return RESERVED_CODE_SET.has(code.trim().toUpperCase());
}

/**
 * Clean a promoter name into a candidate code: uppercase, strip everything
 * that isn't A–Z0–9, truncate to CODE_MAX_LEN. Returns "" when nothing
 * usable remains (e.g. Amharic-only names) — the caller must then require
 * a manually typed code.
 */
export function cleanPromoterCode(name: string): string {
  return (name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, CODE_MAX_LEN);
}

/** Cheap shape validation — does NOT check reserved words or collisions. */
export function isValidCodeShape(code: string): boolean {
  return CODE_PATTERN.test((code || "").trim().toUpperCase());
}

/**
 * Full server-side validation for a code the admin typed / accepted:
 * shape + not reserved. Uniqueness needs DB access, so the caller checks
 * that separately. Returns an error message or null when valid.
 */
export function validatePromoterCode(code: string): string | null {
  const c = (code || "").trim().toUpperCase();
  if (c.length < CODE_MIN_LEN) return `Code must be at least ${CODE_MIN_LEN} characters.`;
  if (c.length > CODE_MAX_LEN) return `Code must be at most ${CODE_MAX_LEN} characters.`;
  if (!CODE_PATTERN.test(c)) return "Code can only contain uppercase letters and numbers (A–Z, 0–9).";
  if (isReservedCode(c)) {
    return `"${c}" is reserved — it collides with an app route. Pick another code.`;
  }
  return null;
}

/**
 * Generate a unique code from a name, given an async existence checker.
 * Tries the cleaned name first, then MELODY2, MELODY3, … up to 50.
 * Returns "" when the name cleans to nothing (manual entry required).
 */
export async function generateUniquePromoterCode(
  name: string,
  exists: (code: string) => Promise<boolean>,
): Promise<string> {
  const base = cleanPromoterCode(name);
  if (!base || base.length < CODE_MIN_LEN || isReservedCode(base)) return "";
  if (!(await exists(base))) return base;
  for (let n = 2; n <= 50; n++) {
    // Keep the numeric suffix inside the 20-char budget.
    const suffix = String(n);
    const candidate = base.slice(0, CODE_MAX_LEN - suffix.length) + suffix;
    if (isReservedCode(candidate)) continue;
    if (!(await exists(candidate))) return candidate;
  }
  return "";
}

/**
 * Normalize a URL path segment that arrived at /:code before validation:
 * uppercase it (links are case-insensitive) and strip whitespace.
 * Returns null for anything that can't be a plausible code (empty, too
 * long, contains separators beyond a single hyphen-free token) so the
 * caller can fall through to the normal NotFound page.
 */
export function normalizeCodeParam(raw: string | undefined): string | null {
  const c = (raw || "").trim().toUpperCase();
  if (!c) return null;
  if (c.length > CODE_MAX_LEN) return null;
  if (!/^[A-Z0-9]+$/.test(c)) return null;
  return c;
}
