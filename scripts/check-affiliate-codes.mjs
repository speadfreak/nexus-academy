// Unit test: RESERVED_CODES in src/lib/affiliateCodes.ts must cover EVERY
// top-level route segment registered in src/main.tsx, plus PARTNER + API.
//
// Run:  node scripts/check-affiliate-codes.mjs
// Exit 0 = pass, exit 1 = fail (with the exact missing segments).
//
// If this test fails because you added a new top-level route to main.tsx,
// add the segment to RESERVED_CODES (uppercase) — otherwise a promoter
// could claim that segment as their code and their link would be shadowed
// by the real route.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mainTsx = readFileSync(resolve(root, "src/main.tsx"), "utf8");
const libTs = readFileSync(resolve(root, "src/lib/affiliateCodes.ts"), "utf8");

// 1. Extract every top-level path segment from <Route path="..."> in main.tsx.
const routePaths = [...mainTsx.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
const segments = new Set();
for (const path of routePaths) {
  // Only top-level: no leading segment beyond the first; ignore "/x/y"
  // nested paths' second segments but keep their first.
  const first = path.split("/").filter(Boolean)[0];
  if (first && !first.startsWith(":") && !first.includes("*")) {
    segments.add(first.toUpperCase());
  }
}
// Static assets / infra routes that don't appear in the router but exist
// at the top level of the deployed domain:
segments.add("API");
segments.add("ASSETS");
segments.add("PARTNER"); // the /partner/:secretToken affiliate route itself

// 2. Parse RESERVED_CODES from the shared lib (regex parse — no TS import).
const reservedMatch = libTs.match(/export const RESERVED_CODES = \[([\s\S]*?)\] as const;/);
if (!reservedMatch) {
  console.error("✗ Could not find RESERVED_CODES in src/lib/affiliateCodes.ts");
  process.exit(1);
}
const reserved = new Set(
  [...reservedMatch[1].matchAll(/"([A-Z0-9-]+)"/g)].map((m) => m[1]),
);

// 3. Every router segment must be reserved.
const missing = [...segments].filter((s) => !reserved.has(s));
if (missing.length > 0) {
  console.error(
    `✗ RESERVED_CODES is missing top-level route segment(s): ${missing.join(", ")}` +
      `\n  Add them to src/lib/affiliateCodes.ts → RESERVED_CODES so promoters can never claim them.`,
  );
  process.exit(1);
}

// 4. Sanity: reserved entries that are neither in the router nor infra are
//    allowed (future-proofing), but flag anything that stops matching so
//    the list stays honest.
const knownInfra = new Set([
  "API", "ASSETS", "PUBLIC", "STATIC", "SITEMAP", "ROBOTS", "MANIFEST", "SW", "INDEX", "PARTNER",
]);
const stale = [...reserved].filter((s) => !segments.has(s) && !knownInfra.has(s));

console.log(`✓ RESERVED_CODES covers all ${segments.size} top-level route segments + infra.`);
if (stale.length > 0) {
  console.log(`  note: reserved but unused (kept intentionally): ${stale.join(", ")}`);
}
console.log(`  segments checked: ${[...segments].sort().join(", ")}`);
