// LEARNYX MATRIC OS — Phase 2: Versioned Exam Blueprints.
//
// A blueprint is a versioned, admin-visible specification of an exam mode:
// which subjects, how many questions, how long, how topics are balanced.
//
// HONESTY RULE (spec §2): blueprints are ALWAYS specType "learnyx_practice".
// Learnyx does NOT invent official Ethiopian examination formats and does
// NOT claim ESA equivalence — question counts and durations are Learnyx-
// designed practice configurations, sized from REAL verified coverage and
// labeled as such everywhere the student sees them.
//
// Seeding is idempotent (upsert by key) and coverage-aware: modes whose
// subjects lack enough verified questions are seeded DISABLED rather than
// pretending to exist.

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import type { GenericQueryCtx } from "convex/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { isAdmin, requireAdminMutation } from "./admin";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Read-only admin gate for QUERIES (mirrors examQuality.requireAdminRead):
 * bootstrap promotion needs a MutationCtx — queries must never write.
 */
async function requireAdminRead(ctx: GenericQueryCtx<any>): Promise<void> {
  const userId = await getAuthUserId(ctx);
  const user = userId ? await ctx.db.get(userId) : null;
  if (!user || !(await isAdmin(ctx, user))) {
    throw new ConvexError({ message: "Admin access required.", code: "unauthorized" });
  }
}

// Sizing policy for Learnyx practice configurations (deliberately NOT
// dressed up as official formats):
const SUBJECT_MOCK_TARGET = 40; // questions in a full subject mock
const SUBJECT_MOCK_FALLBACK = 20; // smaller verified tier when coverage is tight
const SUBJECT_MOCK_MIN = 10; // below this the mode stays disabled
const SECONDS_PER_QUESTION = 90; // generous practice pacing
const FULL_SIM_PER_SUBJECT = 30; // per-subject count in the full simulation
const WEAKNESS_CHALLENGE_COUNT = 15;
const WEAKNESS_CHALLENGE_SECONDS = 25 * 60;

// Subjects every stream sits (mirrors mockExam.ts COMPULSORY_SUBJECT_SLUGS).
const COMPULSORY_SLUGS = ["english", "mathematics", "scholastic-aptitude-test"];

interface SubjectRow {
  _id: Id<"subjects">;
  name: string;
  slug: string;
  stream: string;
}

export const subjectsWithCoverage = internalQuery({
  args: {},
  handler: async (ctx): Promise<(SubjectRow & { eligibleCount: number })[]> => {
    const subjects = await ctx.db.query("subjects").collect();
    const stats = await ctx.db.query("matricCoverageStats").collect();
    const bySubject = new Map(stats.map((s) => [s.subjectId, s]));
    return subjects.map((s) => ({
      _id: s._id,
      name: s.name,
      slug: s.slug,
      stream: s.stream,
      eligibleCount: bySubject.get(s._id)?.eligibleCount ?? 0,
    }));
  },
});

function planCountFor(eligible: number): number {
  if (eligible >= SUBJECT_MOCK_TARGET) return SUBJECT_MOCK_TARGET;
  if (eligible >= SUBJECT_MOCK_FALLBACK) return SUBJECT_MOCK_FALLBACK;
  if (eligible >= SUBJECT_MOCK_MIN) return SUBJECT_MOCK_MIN;
  return 0; // not eligible for a subject mock
}

/** Seed/upsert a blueprint row by key, preserving admin status decisions. */
async function upsertBlueprint(
  ctx: MutationCtx,
  doc: {
    key: string;
    mode: "full_simulation" | "subject_mock" | "weakness_challenge" | "past_paper";
    title: string;
    description: string;
    stream?: "natural" | "social";
    subjects: { subjectId: Id<"subjects">; subjectSlug: string; subjectName: string; questionCount: number }[];
    timeLimitSeconds: number;
    perSubjectTimeSeconds?: number;
    minCoverage: number;
    maxPerTopic: number;
    preferFreshCount: number;
    status: "active" | "disabled";
  },
) {
  const now = Date.now();
  const existing = (await ctx.db
    .query("matricBlueprints")
    .withIndex("by_key", (q) => q.eq("key", doc.key))
    .order("asc").take(1))[0];
  if (existing) {
    // Version bump on content change; admin's status decision is preserved
    // (an admin-disabled blueprint is never silently re-enabled by seeding).
    await ctx.db.patch(existing._id, {
      version: existing.version + 1,
      mode: doc.mode,
      title: doc.title,
      description: doc.description,
      ...(doc.stream !== undefined ? { stream: doc.stream } : {}),
      subjects: doc.subjects,
      timeLimitSeconds: doc.timeLimitSeconds,
      ...(doc.perSubjectTimeSeconds !== undefined
        ? { perSubjectTimeSeconds: doc.perSubjectTimeSeconds }
        : {}),
      minCoverage: doc.minCoverage,
      maxPerTopic: doc.maxPerTopic,
      preferFreshCount: doc.preferFreshCount,
      updatedAt: now,
    });
    return existing._id;
  }
  return await ctx.db.insert("matricBlueprints", {
    key: doc.key,
    version: 1,
    mode: doc.mode,
    title: doc.title,
    description: doc.description,
    ...(doc.stream !== undefined ? { stream: doc.stream } : {}),
    subjects: doc.subjects,
    timeLimitSeconds: doc.timeLimitSeconds,
    ...(doc.perSubjectTimeSeconds !== undefined
      ? { perSubjectTimeSeconds: doc.perSubjectTimeSeconds }
      : {}),
    status: doc.status,
    minCoverage: doc.minCoverage,
    maxPerTopic: doc.maxPerTopic,
    preferFreshCount: doc.preferFreshCount,
    specType: "learnyx_practice" as const,
    createdAt: now,
    updatedAt: now,
  });
}

export const seedBlueprints = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ created: number; updated: number }> => {
    const subjects = (await ctx.runQuery(
      internal.matricBlueprints.subjectsWithCoverage,
      {},
    )) as (SubjectRow & { eligibleCount: number })[];
    const now = Date.now();
    let created = 0;
    let updated = 0;

    const streamSubjects = (stream: "natural" | "social") =>
      subjects.filter((s) => s.stream === stream);
    const commonBySlug = (slug: string) =>
      subjects.find((s) => s.slug === slug && s.stream === "common");

    // ── Subject mocks ──
    for (const s of subjects) {
      const count = planCountFor(s.eligibleCount);
      if (count === 0) continue;
      const before = (await ctx.db
        .query("matricBlueprints")
        .withIndex("by_key", (q) => q.eq("key", `subject-mock:${s.slug}`))
        .order("asc").take(1))[0];
      await upsertBlueprint(ctx, {
        key: `subject-mock:${s.slug}`,
        mode: "subject_mock",
        title: `${s.name} Subject Mock`,
        description: `A ${count}-question ${s.name} practice mock assembled from verified ESSLCE past-paper questions. Learnyx practice configuration — not an official ESA paper.`,
        subjects: [
          {
            subjectId: s._id,
            subjectSlug: s.slug,
            subjectName: s.name,
            questionCount: count,
          },
        ],
        timeLimitSeconds: count * SECONDS_PER_QUESTION,
        minCoverage: SUBJECT_MOCK_MIN,
        maxPerTopic: 0,
        preferFreshCount: 2,
        status: "active",
      });
      if (before) updated++;
      else created++;
    }

    // ── Full simulations (one per stream) ──
    for (const stream of ["natural", "social"] as const) {
      const plans: { subjectId: Id<"subjects">; subjectSlug: string; subjectName: string; questionCount: number }[] = [];
      const slugs = [...COMPULSORY_SLUGS, ...streamSubjects(stream).map((s) => s.slug)];
      const seen = new Set<string>();
      for (const slug of slugs) {
        if (seen.has(slug)) continue;
        seen.add(slug);
        const s = subjects.find((x) => x.slug === slug);
        if (!s) continue;
        const count =
          s.eligibleCount >= FULL_SIM_PER_SUBJECT
            ? FULL_SIM_PER_SUBJECT
            : s.eligibleCount >= 20
              ? 20
              : s.eligibleCount >= SUBJECT_MOCK_MIN
                ? SUBJECT_MOCK_MIN
                : 0;
        if (count === 0) continue; // subject not covered enough → excluded honestly
        plans.push({
          subjectId: s._id,
          subjectSlug: s.slug,
          subjectName: s.name,
          questionCount: count,
        });
      }
      if (plans.length >= 2) {
        // A "full simulation" needs at least two covered subjects to be honest.
        const before = (await ctx.db
          .query("matricBlueprints")
          .withIndex("by_key", (q) => q.eq("key", `full-simulation:${stream}`))
          .order("asc").take(1))[0];
        const totalQ = plans.reduce((acc, p) => acc + p.questionCount, 0);
        await upsertBlueprint(ctx, {
          key: `full-simulation:${stream}`,
          mode: "full_simulation",
          title: `Full Matric Simulation — ${stream === "natural" ? "Natural Science" : "Social Science"}`,
          description: `A ${totalQ}-question multi-subject simulation across ${plans.length} covered subjects, assembled from verified ESSLCE past-paper questions. Learnyx practice configuration — not an official ESA paper.`,
          stream,
          subjects: plans,
          timeLimitSeconds: totalQ * SECONDS_PER_QUESTION,
          perSubjectTimeSeconds: FULL_SIM_PER_SUBJECT * SECONDS_PER_QUESTION,
          minCoverage: SUBJECT_MOCK_MIN,
          maxPerTopic: 0,
          preferFreshCount: 1,
          status: "active",
        });
        if (before) updated++;
        else created++;
      }
    }

    // ── Weakness Challenge (single dynamic blueprint) ──
    const beforeW = (await ctx.db
      .query("matricBlueprints")
      .withIndex("by_key", (q) => q.eq("key", "weakness-challenge"))
      .order("asc").take(1))[0];
    await upsertBlueprint(ctx, {
      key: "weakness-challenge",
      mode: "weakness_challenge",
      title: "Weakness Challenge",
      description: `A ${WEAKNESS_CHALLENGE_COUNT}-question challenge built from YOUR weakest topics (real evidence from your mistakes and mastery). Learnyx practice configuration.`,
      subjects: [], // resolved per-student at creation from real evidence
      timeLimitSeconds: WEAKNESS_CHALLENGE_SECONDS,
      minCoverage: 5,
      maxPerTopic: 6,
      preferFreshCount: 1,
      status: "active",
    });
    if (beforeW) updated++;
    else created++;

    // ── Past Paper Simulation (single template blueprint) ──
    const beforeP = (await ctx.db
      .query("matricBlueprints")
      .withIndex("by_key", (q) => q.eq("key", "past-paper-simulation"))
      .order("asc").take(1))[0];
    await upsertBlueprint(ctx, {
      key: "past-paper-simulation",
      mode: "past_paper",
      title: "Past Paper Simulation",
      description:
        "A timed run of one real digitized ESSLCE paper's multiple-choice section, scored against its own verified answer key.",
      subjects: [], // resolved per-paper at creation
      timeLimitSeconds: 60 * SECONDS_PER_QUESTION, // overridden per paper duration
      minCoverage: 5,
      maxPerTopic: 0,
      preferFreshCount: 0,
      status: "active",
    });
    if (beforeP) updated++;
    else created++;

    await ctx.runMutation(internal.systemEvents.logEvent, {
      eventType: "content_event",
      source: "matricBlueprints.seed",
      status: "success",
      metadata: JSON.stringify({ created, updated, at: now }),
    });
    return { created, updated };
  },
});

// ── Admin CRUD ─────────────────────────────────────────────────────────────

/** Admin list — all blueprints with live coverage join (moderator+ view). */
export interface AdminBlueprintSubject {
  subjectId: Id<"subjects">;
  subjectName: string;
  questionCount: number;
  eligibleCount: number;
}

export interface AdminBlueprintRow {
  _id: Id<"matricBlueprints">;
  key: string;
  version: number;
  mode: "full_simulation" | "subject_mock" | "weakness_challenge" | "past_paper";
  title: string;
  status: "active" | "disabled";
  timeLimitSeconds: number;
  minCoverage: number;
  subjects: AdminBlueprintSubject[];
}

export const adminListBlueprints = query({
  args: {},
  handler: async (ctx): Promise<AdminBlueprintRow[]> => {
    await requireAdminRead(ctx);
    const blueprints = await ctx.db.query("matricBlueprints").collect();
    const stats = await ctx.db.query("matricCoverageStats").collect();
    const bySubject = new Map(stats.map((s) => [s.subjectId, s]));
    return blueprints
      .map((b): AdminBlueprintRow => ({
        _id: b._id,
        key: b.key,
        version: b.version,
        mode: b.mode,
        title: b.title,
        status: b.status,
        timeLimitSeconds: b.timeLimitSeconds,
        minCoverage: b.minCoverage,
        subjects: b.subjects.map((sp) => ({
          subjectId: sp.subjectId,
          subjectName: sp.subjectName,
          questionCount: sp.questionCount,
          eligibleCount: bySubject.get(sp.subjectId)?.eligibleCount ?? 0,
        })),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));
  },
});

/** Admin toggle — enable/disable a blueprint (availability management). */
export const adminSetBlueprintStatus = mutation({
  args: { blueprintId: v.id("matricBlueprints"), status: v.union(v.literal("active"), v.literal("disabled")) },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    await requireAdminMutation(ctx);
    const b = await ctx.db.get(args.blueprintId);
    if (!b) throw new ConvexError({ message: "Blueprint not found.", code: "not_found" });
    await ctx.db.patch(args.blueprintId, { status: args.status, updatedAt: Date.now() });
    return { ok: true as const };
  },
});

/** Recompute blueprint question counts from live coverage (admin action button). */
export const adminReseedBlueprints = mutation({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean }> => {
    await requireAdminMutation(ctx);
    // Reuse the internal seeding — it is idempotent and coverage-aware.
    await ctx.runMutation(internal.matricBlueprints.seedBlueprints, {});
    return { ok: true as const };
  },
});
