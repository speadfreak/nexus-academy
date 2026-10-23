// MATRIC OS — Deterministic Assembly Engine (pure, dependency-free).
//
// This module is the heart of the non-AI exam rebuild. It turns a blueprint
// (section plan) plus a pool of vault candidates into a concrete, seeded,
// reproducible exam plan. It contains ZERO I/O and ZERO Convex imports so it
// can be unit-tested in isolation (scripts/matric-assembler.test.ts) and
// imported by both the browser (coverage preview) and the backend
// (matricEngine.startSession).
//
// Guarantees:
//   1. Same (seed, pool, blueprint)  ->  byte-identical assembly. The seed is
//      persisted on the session, so the plan is auditable/reproducible.
//   2. No duplicate questions within a session (fingerprint-checked).
//   3. Never invents content — shortfalls are reported, never papered over.
//   4. Topic-aware stratified selection: questions are spread across topics
//      instead of dumping five near-identical items from one chapter.
//   5. Optional recency exclusion (reuse policy) via excludeFingerprints.
//
// Determinism contract: candidates MUST be pre-sorted (sortCandidates does
// this by fingerprint) before the seeded shuffle, so pool iteration order
// from the database can never influence the outcome.

// ── Types ─────────────────────────────────────────────────────────────

/** Minimal shape of a vault row the assembler needs. No answers here —
 *  assembly only selects; scoring happens later against the snapshot. */
export interface VaultCandidate {
  questionId: string;
  fingerprint: string;
  subjectSlug: string;
  topicText?: string;
  examYear?: number;
  accessPolicy: "free" | "premium";
  sourceType: "past_paper" | "seed_practice";
  verificationStatus: "verified" | "unverified";
}

/** One section request from a blueprint (already resolved for the stream). */
export interface SectionRequest {
  subjectSlug: string;
  subjectId: string;
  subjectName: string;
  title?: string;
  count: number;
  timeAllottedSeconds: number;
  /** Optional topic weighting (normalized topicText -> weight >= 0). Used
   *  by the Weakness Challenge to oversample weak topics. Absent = uniform. */
  topicWeights?: Record<string, number>;
}

export interface AssembledSection {
  request: SectionRequest;
  picked: VaultCandidate[];
  /** request.count - picked.length. > 0 means the bank ran short. */
  shortfall: number;
}

export interface AssemblyPlan {
  seed: string;
  sections: AssembledSection[];
  totalQuestions: number;
  totalShortfall: number;
}

export interface AssembleOptions {
  seed: string;
  sections: SectionRequest[];
  /** subjectSlug -> candidate pool (already filtered by access policy and
   *  active status upstream). Order does not matter; the assembler sorts. */
  candidatesBySubject: Record<string, VaultCandidate[]>;
  /** Fingerprints used in the student's very recent sessions — excluded
   *  first; only reused if the pool cannot satisfy the count without them. */
  excludeFingerprints?: ReadonlySet<string>;
  /** Allow unverified questions (defaults to false — scored exams require
   *  verified keys; Phase 1 rule). Only explicit practice modes may enable. */
  allowUnverified?: boolean;
  /** Hard cap on questions drawn from any single past paper within one
   *  section (variety guard). 0 = unlimited. Default 0. */
  maxPerSourcePaper?: number;
}

// ── Seeded RNG (mulberry32 + xmur3 string hash) ────────────────────────

/** xmur3 string hash → 32-bit seed. Deterministic across JS engines for
 *  integer ops (no floats, no Math.random anywhere in the pipeline). */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG — tiny, fast, high-quality for shuffling. */
export function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Canonical ordering — makes assembly independent of DB iteration order. */
export function sortCandidates<T extends { fingerprint: string }>(pool: T[]): T[] {
  return [...pool].sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
}

/** Fisher–Yates shuffle driven by the seeded RNG (returns a new array). */
export function seededShuffle<T>(arr: readonly T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Normalize a free-text topic for grouping (case/spacing/punctuation). */
export function normalizeTopic(topic: string | undefined | null): string {
  if (!topic) return "";
  return topic
    .toLowerCase()
    .replace(/[\u2018\u2019\u201c\u201d'"`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ── Core assembly ──────────────────────────────────────────────────────

interface PickOutcome {
  picked: VaultCandidate[];
  shortfall: number;
}

/** Select `count` candidates for one section using stratified topic rounds. */
function pickForSection(
  request: SectionRequest,
  rng: () => number,
  opts: AssembleOptions,
): PickOutcome {
  const poolRaw = opts.candidatesBySubject[request.subjectSlug] ?? [];
  const pool = sortCandidates(poolRaw).filter((c) => {
    if (!opts.allowUnverified && c.verificationStatus !== "verified") return false;
    return true;
  });

  // Split into "fresh" (not used recently) and "recycled" pools.
  const excluded = opts.excludeFingerprints;
  const fresh: VaultCandidate[] = [];
  const recycled: VaultCandidate[] = [];
  for (const c of pool) {
    if (excluded && excluded.has(c.fingerprint)) recycled.push(c);
    else fresh.push(c);
  }

  const wanted = Math.max(0, Math.floor(request.count));
  const picked = takeStratified(fresh, request, rng, wanted, opts);
  let shortfall = wanted - picked.length;

  // Graceful degradation: if the fresh pool ran short, top up from recently
  // used questions rather than failing an otherwise viable exam. The session
  // stays honest — reuse is preferable to an unstartable subject.
  if (shortfall > 0 && recycled.length > 0) {
    const topUp = takeStratified(recycled, request, rng, shortfall, opts);
    picked.push(...topUp);
    shortfall = wanted - picked.length;
  }

  return { picked, shortfall };
}

/** Stratified topic-aware take. Groups the pool by normalized topic, shuffles
 *  groups + members with the seeded RNG, then allocates proportionally:
 *  weighted mode targets `count * w_i / Σw` per topic (weight-0 topics only
 *  fill leftovers); unweighted mode round-robins evenly across topics.
 *  maxPerPaper throttles any single past paper dominating a section. */
function takeStratified(
  pool: VaultCandidate[],
  request: SectionRequest,
  rng: () => number,
  count: number,
  opts: AssembleOptions,
): VaultCandidate[] {
  if (count <= 0 || pool.length === 0) return [];

  // Group by normalized topic.
  const groups = new Map<string, VaultCandidate[]>();
  for (const c of pool) {
    const key = normalizeTopic(c.topicText) || "__untagged__";
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  const weights = request.topicWeights;
  const groupKeys = seededShuffle([...groups.keys()], rng);
  const perPaper = new Map<string, number>();
  const maxPerPaper = opts.maxPerSourcePaper ?? 0;

  // Shuffle members inside each group once.
  for (const key of groupKeys) {
    groups.set(key, seededShuffle(groups.get(key)!, rng));
  }

  const picked: VaultCandidate[] = [];

  const tryPick = (key: string, want: number): number => {
    // Pull up to `want` items from a group, honoring the per-paper cap.
    const list = groups.get(key)!;
    let taken = 0;
    while (taken < want && list.length > 0) {
      let placed = false;
      for (let idx = 0; idx < list.length && taken < want; idx++) {
        const cand = list[idx]!;
        const paperKey = cand.fingerprint.split(":").slice(0, 2).join(":");
        if (maxPerPaper > 0 && (perPaper.get(paperKey) ?? 0) >= maxPerPaper) continue;
        picked.push(cand);
        perPaper.set(paperKey, (perPaper.get(paperKey) ?? 0) + 1);
        list.splice(idx, 1);
        taken++;
        placed = true;
        break;
      }
      if (!placed) break; // every remaining item hits the paper cap
    }
    return taken;
  };

  if (weights) {
    const totalWeight = groupKeys.reduce((n, k) => n + (weights[k] ?? 0), 0);
    if (totalWeight > 0) {
      // Pass 1: proportional allocation for weighted topics (desc weight).
      const ordered = [...groupKeys].sort((a, b) => (weights[b] ?? 0) - (weights[a] ?? 0));
      let allocated = 0;
      for (const key of ordered) {
        const w = weights[key] ?? 0;
        if (w <= 0) continue;
        const target = Math.min(groups.get(key)!.length, Math.round((count * w) / totalWeight));
        allocated += tryPick(key, target);
      }
      // Pass 2: fill the remainder round-robin (weight-0 topics included).
      let progressed = true;
      while (picked.length < count && progressed) {
        progressed = false;
        for (const key of groupKeys) {
          if (picked.length >= count) break;
          if (groups.get(key)!.length === 0) continue;
          picked.push(...takeFromGroup(groups, key, perPaper, maxPerPaper, 1));
          progressed = true;
        }
      }
      void allocated;
      return picked.slice(0, count);
    }
  }

  // Unweighted round-robin across topics.
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (const key of groupKeys) {
      if (picked.length >= count) break;
      if (groups.get(key)!.length === 0) continue;
      picked.push(...takeFromGroup(groups, key, perPaper, maxPerPaper, 1));
      progressed = true;
    }
  }
  return picked.slice(0, count);
}

function takeFromGroup(
  groups: Map<string, VaultCandidate[]>,
  key: string,
  perPaper: Map<string, number>,
  maxPerPaper: number,
  want: number,
): VaultCandidate[] {
  const list = groups.get(key)!;
  const out: VaultCandidate[] = [];
  while (out.length < want && list.length > 0) {
    let placed = false;
    for (let idx = 0; idx < list.length; idx++) {
      const cand = list[idx]!;
      const paperKey = cand.fingerprint.split(":").slice(0, 2).join(":");
      if (maxPerPaper > 0 && (perPaper.get(paperKey) ?? 0) >= maxPerPaper) continue;
      out.push(cand);
      perPaper.set(paperKey, (perPaper.get(paperKey) ?? 0) + 1);
      list.splice(idx, 1);
      placed = true;
      break;
    }
    if (!placed) break;
  }
  return out;
}

/** Assemble a full exam plan. Deterministic: same inputs → same plan. */
export function assembleExam(opts: AssembleOptions): AssemblyPlan {
  const rng = mulberry32(hashSeed(opts.seed));
  const sections: AssembledSection[] = opts.sections.map((request) => {
    const { picked, shortfall } = pickForSection(request, rng, opts);
    return { request, picked, shortfall };
  });
  const totalQuestions = sections.reduce((n, s) => n + s.picked.length, 0);
  const totalShortfall = sections.reduce((n, s) => n + s.shortfall, 0);
  return { seed: opts.seed, sections, totalQuestions, totalShortfall };
}

// ── Eligibility evaluation (pure — shared by engine + UI) ─────────────

export interface SectionCoverage {
  subjectSlug: string;
  available: number;
  requested: number;
  ok: boolean;
}

/** Evaluate whether the current bank can satisfy a blueprint. Pure so the
 *  UI can preview eligibility from the same stats the engine enforces. */
export function evaluateCoverage(
  sections: SectionRequest[],
  candidatesBySubject: Record<string, number>,
  minPerSection: number,
): { ok: boolean; perSection: SectionCoverage[]; totalAvailable: number; totalRequested: number } {
  const perSection = sections.map((s) => {
    const available = candidatesBySubject[s.subjectSlug] ?? 0;
    return { subjectSlug: s.subjectSlug, available, requested: s.count, ok: available >= s.count };
  });
  const allFull = perSection.every((s) => s.ok);
  const anyViable = perSection.every((s) => s.available >= minPerSection);
  return {
    ok: allFull || anyViable,
    perSection,
    totalAvailable: perSection.reduce((n, s) => n + s.available, 0),
    totalRequested: perSection.reduce((n, s) => n + s.requested, 0),
  };
}

/** Build reduced-but-honest section requests when the bank can't fill the
 *  blueprint (explicitly labeled — never silently trimmed). */
export function reduceSections(
  sections: SectionRequest[],
  candidatesBySubject: Record<string, number>,
  minPerSection: number,
): { sections: SectionRequest[]; reduced: boolean } | null {
  const reducedSections = sections.map((s) => {
    const available = candidatesBySubject[s.subjectSlug] ?? 0;
    const count = Math.min(s.count, Math.max(0, available));
    return { ...s, count };
  });
  const viable = reducedSections.every((s) => s.count >= minPerSection);
  if (!viable) return null;
  const reduced = reducedSections.some((s, i) => s.count !== sections[i]!.count);
  return { sections: reducedSections, reduced };
}
