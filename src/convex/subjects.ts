import { mutation, query } from "./_generated/server";

/**
 * All subjects, ordered by name. Used by the library filters and the
 * admin upload form.
 */
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("subjects").order("asc").collect();
  },
});

// The fixed subject list for the Ethiopian national exam prep platform.
// Common subjects are taken by every student; natural/social students take
// their stream's subjects.
export const SEED_SUBJECTS = [
  // Common stream
  { name: "English", stream: "common" },
  { name: "Mathematics", stream: "common" },
  { name: "Scholastic Aptitude Test", stream: "common" },
  // Natural science stream
  { name: "Physics", stream: "natural" },
  { name: "Chemistry", stream: "natural" },
  { name: "Biology", stream: "natural" },
  // Social science stream
  { name: "History", stream: "social" },
  { name: "Geography", stream: "social" },
  { name: "Economics", stream: "social" },
] as const;

export function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/**
 * One-time seed of the subjects table. Idempotent: skips subjects that
 * already exist (matched by slug), so it is safe to run more than once.
 * Returns counts so callers can confirm what happened.
 */
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    let existed = 0;
    for (const subject of SEED_SUBJECTS) {
      const slug = slugify(subject.name);
      const existing = await ctx.db
        .query("subjects")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (existing) {
        existed += 1;
        continue;
      }
      await ctx.db.insert("subjects", {
        name: subject.name,
        stream: subject.stream,
        slug,
      });
      created += 1;
    }
    return { created, existed, total: created + existed };
  },
});
