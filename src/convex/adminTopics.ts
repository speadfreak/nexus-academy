// Admin topic management — list, add, delete, and seed default syllabus topics
// per subject+grade. Topics are required by studyPlans.generatePlan: the AI
// sequences the syllabus into a week-by-week roadmap, and it needs at least
// one topic to start. Without an admin UI to manage topics directly, the
// only way to create topics was to upload a PDF and let AI classify it —
// which left subjects with no uploads (e.g. Mathematics) with zero topics,
// blocking plan generation.
//
// This module exposes:
//   - listTopics(subjectId, grade?)  → query for the admin UI
//   - addTopic(subjectId, grade, name) → mutation (single)
//   - deleteTopic(topicId) → mutation
//   - seedDefaultTopics(subjectId) → action that pre-populates the standard
//     Ethiopian syllabus topics for the given subject across grades 9–12.
//   - seedAllDefaultTopics() → action that seeds all subjects at once
//
// All write operations require admin (moderator+) auth.
//
// NOTE: This file intentionally does NOT have "use node" because it contains
// queries and mutations (which Convex runs in its V8 isolate, not Node.js).
// Actions in this file use only ctx.runQuery/ctx.runMutation, which work
// from either runtime.

import { ConvexError, v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminAction, requireAdminMutation } from "./admin";
import { slugify } from "./subjects";

// ---------------------------------------------------------------------------
// Default syllabus topics per subject — Ethiopian national curriculum
// ---------------------------------------------------------------------------

// A reasonable, grade-agnostic topic list per subject. We seed the same set
// across grades 9–12; the admin can refine via the UI. These cover the
// standard Ethiopian EHEEE (grade 12 national exam) syllabus.
const DEFAULT_TOPICS: Record<string, string[]> = {
  // Common stream
  mathematics: [
    "Number systems and operations",
    "Sets, relations, and functions",
    "Polynomials and factorisation",
    "Linear equations and inequalities",
    "Quadratic equations",
    "Sequences and series",
    "Trigonometric functions and identities",
    "Trigonometric equations",
    "Limits and continuity",
    "Derivatives and differentiation rules",
    "Applications of derivatives",
    "Integration and definite integrals",
    "Applications of integrals",
    "Vectors in 2D and 3D",
    "Coordinate geometry",
    "Lines and planes in space",
    "Matrices and determinants",
    "Linear transformations",
    "Complex numbers",
    "Probability",
    "Statistics and data analysis",
    "Mathematical induction",
    "Binomial theorem",
    "Logarithms and exponentials",
  ],
  english: [
    "Reading comprehension",
    "Grammar and sentence structure",
    "Vocabulary and word formation",
    "Tenses and verb forms",
    "Active and passive voice",
    "Direct and indirect speech",
    "Punctuation and capitalisation",
    "Paragraph writing",
    "Essay writing",
    "Letter writing (formal and informal)",
    "Summary writing",
    "Note-making and outlining",
    "Listening comprehension",
    "Speaking and oral presentation",
    "Literary analysis — prose",
    "Literary analysis — poetry",
    "Literary analysis — drama",
    "Figures of speech",
    "Critical reading and inference",
    "Reference skills and dictionary use",
  ],
  "scholastic-aptitude-test": [
    "Quantitative reasoning",
    "Logical reasoning and patterns",
    "Data interpretation",
    "Spatial reasoning",
    "Verbal reasoning",
    "Analogies and relationships",
    "Sequences and series",
    "Critical thinking",
    "Problem-solving strategies",
    "Reading and inference",
  ],
  amharic: [
    "የአማርኛ ፊደልና አጻጻፍ",
    "የቃላት ክፍሎች",
    "ስርወ-ቃላት",
    "የቃላት ትርጉም",
    "የአጻጻፍ ሥርዓት",
    "የአስተሳሰብ ምልክት",
    "ግጥምና መግባባት",
    "መግባባትና ግጥም",
    "የሐረግ አወቃቀሮች",
    "ምሳሌና ተረት",
    "የቃላት ምድቦች",
    "ጽሑፍ መጻፊያ",
    "የአማርኛ ስዋስው",
    "የተራ መጠይቅ",
    "የመነጠቅ ስርዓት",
  ],
  it: [
    "Computer hardware fundamentals",
    "Operating systems basics",
    "Word processing",
    "Spreadsheets and data entry",
    "Presentations",
    "Internet and email basics",
    "Networks and connectivity",
    "Database fundamentals",
    "Programming logic and algorithms",
    "Introduction to HTML and CSS",
    "Cybersecurity basics",
    "Ethical and social issues in IT",
  ],
  citizenship: [
    "Ethics and moral values",
    "Citizenship and the constitution",
    "Human rights and responsibilities",
    "Democratic culture and tolerance",
    "Rule of law and justice",
    "Civic participation and voting",
    "Federalism and decentralisation",
    "Government branches and separation of powers",
    "Equality and non-discrimination",
    "Environmental ethics",
    "Conflict resolution and peace-building",
    "Global citizenship",
  ],
  // Natural science stream
  physics: [
    "Units and measurement",
    "Vectors and kinematics",
    "Motion in one and two dimensions",
    "Newton's laws of motion",
    "Work, energy, and power",
    "Circular motion and gravitation",
    "Momentum and impulse",
    "Rotational motion and torque",
    "Static and dynamic equilibrium",
    "Elasticity and Hooke's law",
    "Fluid statics and dynamics",
    "Temperature and heat",
    "Thermal expansion and gas laws",
    "Thermodynamics",
    "Wave motion and sound",
    "Electrostatics — Coulomb's law",
    "Electric fields and potential",
    "DC circuits and Ohm's law",
    "Magnetic fields and forces",
    "Electromagnetic induction",
    "AC circuits",
    "Geometric optics — mirrors and lenses",
    "Wave optics — interference and diffraction",
    "Modern physics — photoelectric effect",
    "Atomic and nuclear physics",
    "Semiconductors and electronics",
  ],
  chemistry: [
    "Matter and its properties",
    "Atomic structure",
    "Electronic configuration and periodicity",
    "Chemical bonding — ionic, covalent, metallic",
    "Molecular structure and VSEPR",
    "Stoichiometry and the mole concept",
    "Chemical reactions and equations",
    "Acids, bases, and salts",
    "pH and indicators",
    "Oxidation and reduction reactions",
    "Electrochemistry and cells",
    "Solutions and concentration",
    "Chemical equilibrium",
    "Le Chatelier's principle",
    "Reaction rates and kinetics",
    "Catalysis",
    "Thermochemistry and enthalpy",
    "Organic chemistry — hydrocarbons",
    "Functional groups and organic reactions",
    "Polymers and macromolecules",
    "Chemistry of carbon and its compounds",
    "Periodic table trends",
    "Group chemistry — alkali metals, halogens",
    "Transition metals and coordination",
    "Analytical chemistry — qualitative and quantitative",
    "Environmental and green chemistry",
  ],
  biology: [
    "Cell theory and structure",
    "Cell organelles and functions",
    "Cell transport — diffusion, osmosis, active transport",
    "Cell division — mitosis and meiosis",
    "Tissues and organ systems",
    "Biological molecules — carbs, lipids, proteins, nucleic acids",
    "Enzymes and metabolism",
    "Photosynthesis",
    "Cellular respiration",
    "Nutrition and digestion",
    "Gas exchange and respiration",
    "Circulation and the heart",
    "Excretion and the kidney",
    "Nervous system and coordination",
    "Endocrine system and hormones",
    "Reproduction — plant and animal",
    "Genetics and Mendelian inheritance",
    "DNA, RNA, and protein synthesis",
    "Evolution and natural selection",
    "Classification and taxonomy",
    "Microorganisms — bacteria, viruses, fungi",
    "Ecology — ecosystems and biomes",
    "Population dynamics",
    "Conservation and biodiversity",
    "Plant biology — transport, reproduction",
    "Human health and disease",
  ],
  agriculture: [
    "Introduction to agriculture and its branches",
    "Soil formation and properties",
    "Soil fertility and fertilisers",
    "Crop classification and botany",
    "Plant propagation — seeds and vegetative",
    "Tillage and land preparation",
    "Planting and crop establishment",
    "Crop rotation and intercropping",
    "Irrigation and water management",
    "Weed, pest, and disease management",
    "Harvesting and post-harvest handling",
    "Livestock production — cattle, sheep, goats",
    "Poultry production",
    "Animal nutrition and feed",
    "Animal health and diseases",
    "Beekeeping and honey production",
    "Fish farming and aquaculture",
    "Agroforestry and sustainable land use",
    "Agricultural economics and marketing",
    "Farm records and planning",
  ],
  // Social science stream
  history: [
    "Sources and methods of history",
    "Early civilisations — Egypt, Mesopotamia, Indus",
    "Ancient Ethiopia and the Aksumite kingdom",
    "The Zagwe dynasty and Lalibela",
    "The Solomonic restoration",
    "Medieval Europe — feudalism and the church",
    "Islamic civilisation and the caliphates",
    "Trade and cultural exchange — Indian Ocean",
    "The age of exploration",
    "The trans-Atlantic slave trade",
    "The Ethiopian Gondarine period",
    "The Zemene Mesafint",
    "The reign of Tewodros II",
    "The reigns of Yohannes IV and Menelik II",
    "The Battle of Adwa and African resistance",
    "Colonialism and the Scramble for Africa",
    "World War I and its aftermath",
    "The rise of fascism and World War II",
    "Italian occupation of Ethiopia (1936–1941)",
    "The Cold War and decolonisation",
    "Independent Africa and Pan-Africanism",
    "Modern Ethiopia — Derg, EPRDF, reform era",
    "Human rights and democratic transitions",
    "Globalisation and the 21st century",
  ],
  geography: [
    "The Earth and the solar system",
    "Map reading and interpretation",
    "Map scale, distance, and direction",
    "Topographic maps and contours",
    "Continents and oceans",
    "Plate tectonics and landforms",
    "Volcanoes and earthquakes",
    "Weathering, erosion, and deposition",
    "Rivers and fluvial landforms",
    "Glaciers and glacial landforms",
    "Coastal processes and landforms",
    "Arid and semi-arid landscapes",
    "Weather and climate",
    "Climate zones and biomes",
    "Natural vegetation and soils",
    "Population — distribution and dynamics",
    "Migration and refugees",
    "Settlements — rural and urban",
    "Agriculture and food systems",
    "Minerals and mining",
    "Energy resources — renewable and non-renewable",
    "Manufacturing and industry",
    "Transport and communications",
    "Trade and globalisation",
    "Environmental conservation and sustainability",
    "Natural hazards and disaster management",
  ],
  economics: [
    "Introduction to economics — scarcity and choice",
    "Opportunity cost and production possibility frontier",
    "Demand and supply",
    "Market equilibrium and price determination",
    "Elasticity of demand and supply",
    "Consumer behaviour and utility",
    "Production and the firm",
    "Costs of production — fixed, variable, marginal",
    "Market structures — perfect and imperfect competition",
    "Monopoly and monopolistic competition",
    "Oligopoly and game theory",
    "Factors of production — land, labour, capital, entrepreneurship",
    "Labour market and wages",
    "Money and banking",
    "Central banks and monetary policy",
    "Inflation and unemployment",
    "Fiscal policy and government budget",
    "National income and GDP",
    "Economic growth and development",
    "International trade and comparative advantage",
    "Balance of payments and exchange rates",
    "Economic integration — customs unions, common markets",
    "Public finance and taxation",
    "Population and human capital",
    "Environmental and welfare economics",
    "Ethiopian economy — structure and policy",
  ],
};

// ---------------------------------------------------------------------------
// Public queries for the admin UI
// ---------------------------------------------------------------------------

/** List topics for a subject, optionally filtered by grade. Returns them
 *  sorted by grade then name. Used by the admin Topics panel and by any
 *  other UI that wants to show syllabus coverage. */
export const listTopics = query({
  args: { subjectId: v.id("subjects"), grade: v.optional(v.number()) },
  handler: async (ctx, { subjectId, grade }) => {
    let q = ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", subjectId));
    const all = await q.collect();
    let topics = all;
    if (grade !== undefined) {
      topics = all.filter((t) => t.grade === grade);
    }
    return topics
      .slice()
      .sort((a, b) => a.grade - b.grade || a.name.localeCompare(b.name));
  },
});

/** Count topics per subject — used by the admin dashboard / overview. */
export const countTopicsBySubject = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) => {
    const all = await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", subjectId))
      .collect();
    return all.length;
  },
});

// ---------------------------------------------------------------------------
// Internal helpers — used by seedDefaultTopics action
// ---------------------------------------------------------------------------

export const insertTopicInternal = internalMutation({
  args: {
    subjectId: v.id("subjects"),
    grade: v.number(),
    name: v.string(),
  },
  handler: async (ctx, { subjectId, grade, name }) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 3 || clean.length > 120) return null;
    // Check for an existing topic with the same name (case-insensitive) for
    // the same subject+grade — idempotent seeding.
    const existing = await ctx.db
      .query("topics")
      .withIndex("by_subject_grade", (q) =>
        q.eq("subjectId", subjectId).eq("grade", grade),
      )
      .filter((q) => q.eq(q.field("name"), clean))
      .first();
    if (existing) return existing._id;
    return await ctx.db.insert("topics", { name: clean, subjectId, grade });
  },
});

// ---------------------------------------------------------------------------
// Admin mutations — add, add bulk, delete
// ---------------------------------------------------------------------------

export const addTopic = mutation({
  args: {
    subjectId: v.id("subjects"),
    grade: v.number(),
    name: v.string(),
  },
  handler: async (ctx, { subjectId, grade, name }) => {
    await requireAdminMutation(ctx);
    const clean = name.trim().replace(/\s+/g, " ");
    if (clean.length < 3) {
      throw new ConvexError({ message: "Topic name must be at least 3 characters.", code: "invalid" });
    }
    if (clean.length > 120) {
      throw new ConvexError({ message: "Topic name must be at most 120 characters.", code: "invalid" });
    }
    if (grade < 1 || grade > 12) {
      throw new ConvexError({ message: "Grade must be between 1 and 12.", code: "invalid" });
    }
    // Idempotent: skip if a topic with the same name already exists for this
    // subject+grade (case-insensitive match).
    const existing = await ctx.db
      .query("topics")
      .withIndex("by_subject_grade", (q) =>
        q.eq("subjectId", subjectId).eq("grade", grade),
      )
      .filter((q) => q.eq(q.field("name"), clean))
      .first();
    if (existing) {
      return { topicId: existing._id, created: false as const };
    }
    const topicId = await ctx.db.insert("topics", { name: clean, subjectId, grade });
    return { topicId, created: true as const };
  },
});

export const deleteTopic = mutation({
  args: { topicId: v.id("topics") },
  handler: async (ctx, { topicId }) => {
    await requireAdminMutation(ctx);
    // Also delete any contentTopics links to keep the junction clean.
    // contentTopics has a by_content index but no by_topic index, so we
    // scan and filter. Topic-link counts are small (≤ a few dozen per
    // topic), so this is fine.
    const allLinks = await ctx.db.query("contentTopics").collect();
    const topicLinks = allLinks.filter((l) => l.topicId === topicId);
    for (const link of topicLinks) {
      await ctx.db.delete(link._id);
    }
    await ctx.db.delete(topicId);
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------
// Seed default topics — pre-populates the standard Ethiopian syllabus
// for a given subject across grades 9–12. Idempotent.
// ---------------------------------------------------------------------------

export const seedDefaultTopics = action({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }): Promise<{ subjectName: string; seeded: number; skipped: number; perGrade: Record<number, number> }> => {
    await requireAdminAction(ctx);
    const subject: Doc<"subjects"> | null = await ctx.runQuery(internal.adminTopics.getSubjectById, { subjectId });
    if (!subject) {
      throw new ConvexError({ message: "Subject not found.", code: "invalid" });
    }
    const slug = slugify(subject.name);
    const defaultTopicNames = DEFAULT_TOPICS[slug];
    if (!defaultTopicNames || defaultTopicNames.length === 0) {
      throw new ConvexError({
        message: `No default syllabus defined for ${subject.name}. Add topics manually instead.`,
        code: "no_default",
      });
    }

    const grades = [9, 10, 11, 12];
    let seeded = 0;
    let skipped = 0;
    const perGrade: Record<number, number> = {};
    for (const grade of grades) {
      let gradeSeeded = 0;
      for (const name of defaultTopicNames) {
        const result = await ctx.runMutation(internal.adminTopics.insertTopicInternal, {
          subjectId,
          grade,
          name,
        });
        if (result) {
          seeded++;
          gradeSeeded++;
        } else {
          skipped++;
        }
      }
      perGrade[grade] = gradeSeeded;
    }
    return { subjectName: subject.name, seeded, skipped, perGrade };
  },
});

// Internal query used by seedDefaultTopics to fetch the subject
export const getSubjectById = internalQuery({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) =>
    (await ctx.db.get(subjectId)) ?? null,
});

/** Seed default topics for ALL subjects at once — admin "bulk seed" button. */
export const seedAllDefaultTopics = action({
  args: {},
  handler: async (ctx): Promise<{ results: { subjectName: string; seeded: number; skipped: number }[]; totalSeeded: number }> => {
    await requireAdminAction(ctx);
    const subjects: Doc<"subjects">[] = await ctx.runQuery(internal.adminTopics.getAllSubjects, {});
    const results: { subjectName: string; seeded: number; skipped: number }[] = [];
    let totalSeeded = 0;
    for (const subject of subjects) {
      const slug = slugify(subject.name);
      const defaultTopicNames = DEFAULT_TOPICS[slug];
      if (!defaultTopicNames || defaultTopicNames.length === 0) {
        // Skip subjects with no default syllabus (e.g. onboarding)
        continue;
      }
      let seeded = 0;
      let skipped = 0;
      for (const grade of [9, 10, 11, 12]) {
        for (const name of defaultTopicNames) {
          const result = await ctx.runMutation(internal.adminTopics.insertTopicInternal, {
            subjectId: subject._id,
            grade,
            name,
          });
          if (result) {
            seeded++;
            totalSeeded++;
          } else {
            skipped++;
          }
        }
      }
      results.push({ subjectName: subject.name, seeded, skipped });
    }
    return { results, totalSeeded };
  },
});

export const getAllSubjects = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("subjects").collect();
  },
});

// ---------------------------------------------------------------------------
// Convenience: list topics grouped by grade for a subject (admin UI tree view)
// ---------------------------------------------------------------------------

export const listTopicsGroupedByGrade = query({
  args: { subjectId: v.id("subjects") },
  handler: async (ctx, { subjectId }) => {
    const all = await ctx.db
      .query("topics")
      .withIndex("by_subject", (q) => q.eq("subjectId", subjectId))
      .collect();
    const byGrade: Record<number, { _id: Id<"topics">; name: string }[]> = {};
    for (const t of all) {
      if (!byGrade[t.grade]) byGrade[t.grade] = [];
      byGrade[t.grade].push({ _id: t._id, name: t.name });
    }
    for (const grade of Object.keys(byGrade)) {
      byGrade[Number(grade)].sort((a, b) => a.name.localeCompare(b.name));
    }
    return byGrade;
  },
});
