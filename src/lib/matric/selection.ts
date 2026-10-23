// Learnyx Matric OS — deterministic, seeded question selection.
//
// Pure functions only. The SAME seed + pool + inputs MUST always produce the
// same selection — this is what makes an exam session reproducible and
// auditable long after creation (the seed is persisted on the session row).
//
// Design guarantees (Phase 3 of the Matric OS spec):
//   - only examEligible questions with a verified answer can ever be selected
//   - no duplicates by vaultId, and content-duplicates (same duplicateKey)
//     collapse to one occurrence
//   - topic-balanced: round-robin across topic groups so one dominant topic
//     cannot own the paper
//   - freshness: when the pool is big enough, questions from the student's
//     recent sessions are excluded — but if coverage is tight we silently
//     fall back to the full pool rather than fail (reuse beats unavailability)
//   - NO random selection outside the persisted seed → no re-shuffle on reload

import type { VaultQuestionLike } from "./types";

// ── Seeded RNG ────────────────────────────────────────────────────────────

/** FNV-1a 32-bit hash of a string → unsigned int. Deterministic everywhere. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG — tiny, fast, stable across JS engines. */
export function mulberry32(seed: string): () => number {
  let a = hashSeed(seed);
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle on a COPY — never mutates the input. */
export function seededShuffle<T>(items: readonly T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

// ── Selection ─────────────────────────────────────────────────────────────

export interface SelectionInput {
  pool: readonly VaultQuestionLike[];
  count: number;
  seed: string;
  /** Topic balance cap per selected set (0 = no cap beyond natural balance). */
  maxPerTopic?: number;
  /** vaultIds to exclude when the remaining pool still satisfies `count`. */
  recentVaultIds?: readonly string[];
}

export interface SelectionResult {
  selected: VaultQuestionLike[];
  /** Eligible, deduplicated pool size before freshness filtering. */
  poolSize: number;
  /** Pool size after freshness filtering (what selection actually drew from). */
  freshPoolSize: number;
  /** True when freshness had to be relaxed (pool too small). */
  freshnessRelaxed: boolean;
  /** Selected count per topic key (audit/debug + hub stats). */
  byTopic: Record<string, number>;
}

/** Topic grouping key — real topicId wins, else the printed topic text, else general. */
export function topicKeyOf(q: VaultQuestionLike): string {
  if (q.topicId) return `id:${q.topicId}`;
  const t = q.topicText?.trim();
  if (t) return `text:${t.toLowerCase()}`;
  return "__general";
}

/**
 * Core deterministic selector. Throws only on programming errors (bad args);
 * insufficient coverage is a CALLER concern (the engine checks coverage first
 * and fails gracefully — this function just selects what it can).
 */
export function selectQuestions(input: SelectionInput): SelectionResult {
  const { pool, count, seed } = input;
  const maxPerTopic = input.maxPerTopic ?? 0;
  const recent = new Set(input.recentVaultIds ?? []);

  // 1. Eligibility guard — a non-eligible question can never be selected,
  //    even if a caller bug feeds one in. Defense in depth.
  const eligible = pool.filter(
    (q) =>
      q.examEligible &&
      !!q.answerLabel &&
      q.choices.length >= 2 &&
      q.choices.some((c) => c.label === q.answerLabel),
  );

  // 2. Deduplicate: by vaultId, then by content duplicateKey (keep first).
  const seenIds = new Set<string>();
  const seenDupes = new Set<string>();
  const deduped: VaultQuestionLike[] = [];
  for (const q of eligible) {
    if (seenIds.has(q.vaultId)) continue;
    if (q.duplicateKey && seenDupes.has(q.duplicateKey)) continue;
    seenIds.add(q.vaultId);
    if (q.duplicateKey) seenDupes.add(q.duplicateKey);
    deduped.push(q);
  }

  const poolSize = deduped.length;

  // 3. Freshness — prefer unseen questions when coverage allows.
  const fresh = deduped.filter((q) => !recent.has(q.vaultId));
  let working = fresh;
  let freshnessRelaxed = false;
  if (fresh.length < count && recent.size > 0) {
    working = deduped;
    freshnessRelaxed = true;
  }
  const freshPoolSize = working.length;

  const rand = mulberry32(seed);

  // 4. Group by topic, seeded shuffle inside each group.
  const groups = new Map<string, VaultQuestionLike[]>();
  for (const q of seededShuffle(working, rand)) {
    const key = topicKeyOf(q);
    const list = groups.get(key);
    if (list) list.push(q);
    else groups.set(key, [q]);
  }

  // 5. Seeded group order → round-robin across topics.
  const groupKeys = seededShuffle([...groups.keys()], rand);
  const cursors = new Map<string, number>();

  // 6. Take one from each group in turn; honor maxPerTopic cap.
  const selected: VaultQuestionLike[] = [];
  const byTopic: Record<string, number> = {};
  let exhausted = false;
  while (selected.length < count && !exhausted) {
    let progressed = false;
    for (const key of groupKeys) {
      if (selected.length >= count) break;
      if (maxPerTopic > 0 && (byTopic[key] ?? 0) >= maxPerTopic) continue;
      const list = groups.get(key);
      if (!list) continue;
      const cursor = cursors.get(key) ?? 0;
      if (cursor >= list.length) continue;
      const q = list[cursor] as VaultQuestionLike;
      cursors.set(key, cursor + 1);
      selected.push(q);
      byTopic[key] = (byTopic[key] ?? 0) + 1;
      progressed = true;
    }
    if (!progressed) exhausted = true;
  }

  // 7. If a maxPerTopic cap left us short (e.g. one giant topic), top up from
  //    the leftovers ignoring the cap — coverage beats the cap, but only as a
  //    last resort. Final seeded shuffle so leftover picks aren't biased.
  if (selected.length < count) {
    const chosen = new Set(selected.map((q) => q.vaultId));
    const leftovers = deduped.filter((q) => !chosen.has(q.vaultId));
    for (const q of seededShuffle(leftovers, rand)) {
      if (selected.length >= count) break;
      selected.push(q);
    }
  }

  return {
    selected: selected.slice(0, count),
    poolSize,
    freshPoolSize,
    freshnessRelaxed,
    byTopic,
  };
}
