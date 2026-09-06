// Coverage matrix — public, no auth required.
//
// Cross-references the real subjects × grades × content types against the
// actual uploaded contentItems, returning a count for each combination.
// Used by the /coverage marketing page ("See exactly what's inside") and
// by the Admin Content Gap Dashboard (Priority 4).
//
// This is HONEST data — empty cells stay empty (count: 0), no inflating
// numbers. The whole point is trust: a prospective student can see
// exactly what's in the library before signing up.
//
// Performance: contentItems is bounded (admin caps at 50 / public at 200
// per query, but the underlying table is realistically < 10k rows), so a
// single .collect() + reduce is fine. No need for a native aggregation
// (which Convex doesn't have anyway).

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CONTENT_TYPES, CONTENT_TYPE_LABELS, GRADES, STREAM_LABELS, type ContentType } from "./constants";
import { isAdmin } from "./admin";

// ── Public return shape ────────────────────────────────────────────────

export interface CoverageCell {
  subjectId: Id<"subjects">;
  subjectName: string;
  subjectSlug: string;
  subjectStream: string; // "natural" | "social" | "common"
  grade: number; // 9 | 10 | 11 | 12
  contentType: ContentType;
  count: number;
}

export interface CoverageMatrix {
  subjects: Array<{
    _id: Id<"subjects">;
    name: string;
    slug: string;
    stream: string;
  }>;
  grades: number[]; // [9, 10, 11, 12]
  contentTypes: ContentType[]; // CONTENT_TYPES
  cells: CoverageCell[];
  totals: {
    bySubject: Record<string, number>; // subjectId -> total count
    byGrade: Record<number, number>; // grade -> total count
    byContentType: Record<ContentType, number>;
    grandTotal: number;
  };
}

// ── Query ──────────────────────────────────────────────────────────────

/**
 * Public coverage matrix. Returns:
 *   - subjects: every row in the subjects table (so the frontend can
 *     render complete rows even where there's no content — a "gap" cell)
 *   - grades: [9, 10, 11, 12]
 *   - contentTypes: CONTENT_TYPES
 *   - cells: one per (subject × grade × contentType) with the actual
 *     count of contentItems matching that combination
 *   - totals: pre-computed marginal totals for quick UI badges
 *
 * No args — the whole matrix is returned in one round trip. The frontend
 * can then filter by stream / contentType client-side without another
 * call (the data set is small enough to ship whole).
 */
export const getCoverageMatrix = query({
  args: {},
  handler: async (ctx): Promise<CoverageMatrix> => {
    const [subjects, contentItems] = await Promise.all([
      ctx.db.query("subjects").order("asc").collect(),
      ctx.db.query("contentItems").collect(),
    ]);

    // Build a lookup map: `${subjectId}:${grade}:${contentType}` -> count.
    // Iterating contentItems once is O(n); lookups are then O(1).
    const countMap = new Map<string, number>();
    for (const item of contentItems) {
      const key = `${item.subjectId}:${item.grade}:${item.contentType}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    // Build the full matrix: every subject × every grade × every content
    // type. Empty cells stay at count: 0 — that's the honest "gap" signal.
    const subjectById = new Map(subjects.map((s) => [s._id, s]));
    const cells: CoverageCell[] = [];
    for (const subject of subjects) {
      for (const grade of GRADES) {
        for (const contentType of CONTENT_TYPES) {
          const key = `${subject._id}:${grade}:${contentType}`;
          cells.push({
            subjectId: subject._id,
            subjectName: subject.name,
            subjectSlug: subject.slug,
            subjectStream: subject.stream,
            grade,
            contentType: contentType as ContentType,
            count: countMap.get(key) ?? 0,
          });
        }
      }
    }

    // Marginal totals — for quick UI badges (e.g. "Grade 11: 23 items",
    // "Textbooks: 45 items", "Physics: 12 items", grand total).
    const bySubject: Record<string, number> = {};
    const byGrade: Record<number, number> = {};
    const byContentType: Record<ContentType, number> = {} as Record<ContentType, number>;
    let grandTotal = 0;
    for (const contentType of CONTENT_TYPES) byContentType[contentType] = 0;
    for (const grade of GRADES) byGrade[grade] = 0;
    for (const subject of subjects) bySubject[subject._id] = 0;

    for (const item of contentItems) {
      grandTotal += 1;
      bySubject[item.subjectId] = (bySubject[item.subjectId] ?? 0) + 1;
      byGrade[item.grade] = (byGrade[item.grade] ?? 0) + 1;
      byContentType[item.contentType] = (byContentType[item.contentType] ?? 0) + 1;
    }

    return {
      subjects: subjects.map((s) => ({
        _id: s._id,
        name: s.name,
        slug: s.slug,
        stream: s.stream,
      })),
      grades: [...GRADES],
      contentTypes: [...CONTENT_TYPES] as ContentType[],
      cells,
      totals: {
        bySubject,
        byGrade,
        byContentType,
        grandTotal,
      },
    };
  },
});

// ── Admin Content Gap Dashboard ─────────────────────────────────────────
//
// Reuses the same underlying cross-reference logic as the public
// getCoverageMatrix, but adds admin-relevant detail:
//   - A pre-computed "biggest gaps" list: every (subject × grade ×
//     contentType) combination where count === 0, sorted by a sensible
//     priority (stream-relevance + grade relevance). This turns
//     sourcing work into a clear checklist rather than guesswork.
//   - Per-stream gap counts so the admin can see which stream needs
//     the most attention.
//
// Admin-gated: non-admins get an empty result.

export interface ContentGapRow {
  subjectId: Id<"subjects">;
  subjectName: string;
  subjectSlug: string;
  subjectStream: string;
  grade: number;
  contentType: ContentType;
  contentTypeLabel: string;
  // Priority 0 = highest (most urgent to fill), 10 = lowest.
  // Computed from stream relevance (natural/social first, common last)
  // + grade relevance (12 first, then 11, 10, 9) + content type
  // weight (textbook/past_exam first, then worksheet, then guides).
  priority: number;
}

export interface AdminGapDashboard {
  matrix: CoverageMatrix;
  gaps: ContentGapRow[];
  gapCount: number;
  gapsByStream: Record<string, number>;
  gapsByContentType: Record<ContentType, number>;
  gapsByGrade: Record<number, number>;
}

// Priority weights — lower = more urgent. Used to sort the gap list so
// the admin sees the highest-leverage gaps first.
const STREAM_PRIORITY: Record<string, number> = {
  natural: 0,
  social: 1,
  common: 2,
};
const GRADE_PRIORITY: Record<number, number> = {
  12: 0, // Grade 12 is exam year — most urgent.
  11: 1,
  10: 2,
  9: 3,
};
const CONTENT_TYPE_PRIORITY: Record<ContentType, number> = {
  textbook: 0,
  past_exam: 1,
  worksheet: 2,
  student_guide: 3,
  teacher_guide: 4,
};

export const getAdminGapDashboard = query({
  args: {},
  handler: async (ctx): Promise<AdminGapDashboard | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!(await isAdmin(ctx, user))) return null;

    // Reuse the public matrix builder's data.
    const [subjects, contentItems] = await Promise.all([
      ctx.db.query("subjects").order("asc").collect(),
      ctx.db.query("contentItems").collect(),
    ]);

    const countMap = new Map<string, number>();
    for (const item of contentItems) {
      const key = `${item.subjectId}:${item.grade}:${item.contentType}`;
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    // Build the matrix (same as the public query).
    const cells: CoverageCell[] = [];
    const bySubject: Record<string, number> = {};
    const byGrade: Record<number, number> = {};
    const byContentType: Record<ContentType, number> = {} as Record<ContentType, number>;
    let grandTotal = 0;
    for (const contentType of CONTENT_TYPES) byContentType[contentType] = 0;
    for (const grade of GRADES) byGrade[grade] = 0;
    for (const subject of subjects) bySubject[subject._id] = 0;

    for (const subject of subjects) {
      for (const grade of GRADES) {
        for (const contentType of CONTENT_TYPES) {
          const key = `${subject._id}:${grade}:${contentType}`;
          const count = countMap.get(key) ?? 0;
          cells.push({
            subjectId: subject._id,
            subjectName: subject.name,
            subjectSlug: subject.slug,
            subjectStream: subject.stream,
            grade,
            contentType: contentType as ContentType,
            count,
          });
        }
      }
    }
    for (const item of contentItems) {
      grandTotal += 1;
      bySubject[item.subjectId] = (bySubject[item.subjectId] ?? 0) + 1;
      byGrade[item.grade] = (byGrade[item.grade] ?? 0) + 1;
      byContentType[item.contentType] = (byContentType[item.contentType] ?? 0) + 1;
    }

    const matrix: CoverageMatrix = {
      subjects: subjects.map((s) => ({
        _id: s._id,
        name: s.name,
        slug: s.slug,
        stream: s.stream,
      })),
      grades: [...GRADES],
      contentTypes: [...CONTENT_TYPES] as ContentType[],
      cells,
      totals: { bySubject, byGrade, byContentType, grandTotal },
    };

    // Build the gaps list — every cell with count === 0.
    const gaps: ContentGapRow[] = [];
    const gapsByStream: Record<string, number> = {
      natural: 0,
      social: 0,
      common: 0,
    };
    const gapsByContentType: Record<ContentType, number> = {} as Record<ContentType, number>;
    for (const ct of CONTENT_TYPES) gapsByContentType[ct] = 0;
    const gapsByGrade: Record<number, number> = {};
    for (const g of GRADES) gapsByGrade[g] = 0;

    for (const subject of subjects) {
      for (const grade of GRADES) {
        for (const contentType of CONTENT_TYPES) {
          const key = `${subject._id}:${grade}:${contentType}`;
          const count = countMap.get(key) ?? 0;
          if (count === 0) {
            const streamP = STREAM_PRIORITY[subject.stream] ?? 5;
            const gradeP = GRADE_PRIORITY[grade] ?? 5;
            const ctP = CONTENT_TYPE_PRIORITY[contentType as ContentType] ?? 5;
            // Combined priority — stream is the most significant, then
            // grade, then content type. Multiply stream by 100 so it
            // dominates.
            const priority = streamP * 100 + gradeP * 10 + ctP;
            gaps.push({
              subjectId: subject._id,
              subjectName: subject.name,
              subjectSlug: subject.slug,
              subjectStream: subject.stream,
              grade,
              contentType: contentType as ContentType,
              contentTypeLabel: CONTENT_TYPE_LABELS[contentType as ContentType] ?? contentType,
              priority,
            });
            gapsByStream[subject.stream] = (gapsByStream[subject.stream] ?? 0) + 1;
            gapsByContentType[contentType as ContentType] =
              (gapsByContentType[contentType as ContentType] ?? 0) + 1;
            gapsByGrade[grade] = (gapsByGrade[grade] ?? 0) + 1;
          }
        }
      }
    }

    // Sort gaps by priority (most urgent first), then by subject name for
    // a stable alphabetical order within the same priority.
    gaps.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.subjectName !== b.subjectName) return a.subjectName.localeCompare(b.subjectName);
      return a.grade - b.grade;
    });

    return {
      matrix,
      gaps,
      gapCount: gaps.length,
      gapsByStream,
      gapsByContentType,
      gapsByGrade,
    };
  },
});
