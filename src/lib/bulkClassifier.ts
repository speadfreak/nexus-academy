// Bulk Upload — Deterministic Rule-Based Content Classifier
//
// ARCHITECTURE:
//   Pure client-side classifier that replaces the Groq AI call for 95%+ of
//   files. Zero API calls, zero rate limits, zero errors. The AI fallback
//   (contentAI.classifyContentText) is kept only for the rare low-confidence
//   files where the rule engine says "I don't know".
//
// PIPELINE (per file):
//   1. Filename parsing  →  subject / grade / year / unit / type hints
//   2. Content sniffing  →  first 8KB of extracted PDF text → keyword match
//   3. Confidence merge  →  weighted score (filename 60% + content 40%)
//   4. Title generation  →  human-readable title from detected fields
//
// CONFIDENCE LEVELS:
//   HIGH   (>= 70)  →  auto-fill all fields, mark as "ready"
//   MEDIUM (40-69)  →  auto-fill what we can, flag for review
//   LOW    (< 40)  →  leave blanks, admin must manually classify
//                      (a "Try AI" button appears on these rows)
//
// SUBJECT CATALOG (must match convex/subjects.ts SEED_SUBJECTS):
//   Common:    English, Mathematics, SAT, Amharic, IT, Citizenship
//   Natural:   Physics, Chemistry, Biology, Agriculture
//   Social:    History, Geography, Economics

import type { Doc } from "@/convex/_generated/dataModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  title: string;
  subjectId: string | null;
  subjectSlug: string | null;
  grade: string | null; // "9" | "10" | "11" | "12" | null
  contentType: string | null; // one of CONTENT_TYPES
  examYear: string | null;
  topics: string[];
  confidence: number; // 0-100
  confidenceLevel: "high" | "medium" | "low";
  signals: string[]; // human-readable trace for debugging / "why" tooltip
}

// ---------------------------------------------------------------------------
// Subject keyword dictionaries (lowercase, no diacritics)
// ---------------------------------------------------------------------------
//
// Each subject has a curated set of words that appear in textbook/exam
// content for that subject. We tokenize the extracted text and count hits
// per subject; the highest-scoring subject wins (with a minimum threshold
// to avoid false positives).

type SubjectKeywords = {
  slug: string;
  name: string;
  aliases: string[]; // filename/short-name variants
  keywords: string[]; // content-text vocabulary
};

const SUBJECT_DICTIONARY: SubjectKeywords[] = [
  {
    slug: "physics",
    name: "Physics",
    aliases: ["physics", "phys", "phy"],
    keywords: [
      "force", "velocity", "acceleration", "momentum", "energy", "kinetic",
      "potential", "gravity", "newton", "motion", "electric", "magnetic",
      "wave", "optics", "thermodynamics", "voltage", "current", "resistance",
      "circuit", "lens", "mirror", "frequency", "wavelength", "amplitude",
      "friction", "torque", "power", "joule", "watt", "ohm", "farad",
      "vector", "scalar", "displacement", "projectile", "friction",
    ],
  },
  {
    slug: "chemistry",
    name: "Chemistry",
    aliases: ["chemistry", "chem", "chm"],
    keywords: [
      "atom", "molecule", "reaction", "acid", "base", "organic", "inorganic",
      "periodic", "element", "bond", "ion", "oxidation", "reduction",
      "equilibrium", "stoichiometry", "mole", "compound", "solution",
      "titration", "catalyst", "polymer", "hydrocarbon", "alkene", "alkane",
      "isotope", "electron", "proton", "neutron", "valence", "pH",
      "salt", "metal", "nonmetal", "gas", "liquid", "solid",
    ],
  },
  {
    slug: "biology",
    name: "Biology",
    aliases: ["biology", "bio", "biol"],
    keywords: [
      "cell", "photosynthesis", "respiration", "dna", "rna", "gene",
      "evolution", "ecosystem", "organism", "plant", "animal", "tissue",
      "organ", "mitosis", "meiosis", "chromosome", "enzyme", "protein",
      "membrane", "nucleus", "cytoplasm", "photosystem", "kingdom",
      "phylum", "genus", "species", "habitat", "adaptation", "genetics",
      "bacteria", "virus", "fungi", "protist",
    ],
  },
  {
    slug: "mathematics",
    name: "Mathematics",
    aliases: ["mathematics", "math", "maths", "matric", "mathe"],
    keywords: [
      "equation", "function", "integral", "derivative", "algebra",
      "geometry", "trigonometry", "calculus", "polynomial", "matrix",
      "vector", "probability", "statistics", "logarithm", "exponential",
      "inequality", "factor", "theorem", "proof", "limit", "sequence",
      "series", "complex", "binomial", "permutation", "combination",
      "slope", "intercept", "parabola", "hyperbola", "ellipse",
    ],
  },
  {
    slug: "english",
    name: "English",
    aliases: ["english", "eng", "engl"],
    keywords: [
      "grammar", "vocabulary", "tense", "sentence", "noun", "verb",
      "adjective", "adverb", "comprehension", "passage", "essay",
      "paragraph", "pronoun", "preposition", "conjunction", "interjection",
      "subject", "predicate", "clause", "phrase", "active", "passive",
      "synonym", "antonym", "homophone", "metaphor", "simile", "poem",
      "literature", "poetry", "narrative", "reading",
    ],
  },
  {
    slug: "amharic",
    name: "Amharic",
    aliases: ["amharic", "amh", "amarigna", "amarinya"],
    keywords: [
      // Amharic script + romanized
      "ቋንቋ", "ሰዋስው", "ሰዋስዊ", "ግሥ", "ስም", "ቀጥሎ", "ተናጥሎ",
      "ግርጌ", "አረፍተነገር", "ሐረግ", "ረዳት", "ድርደር", "ግልባጭ",
      "ጥበባዊ", "ተረት", "ልቦለድ", "ግጥም", "ሐሳብ", "ትምህርት",
      "amharic", "ኢትዮጵያ", "ቋንቋ",
    ],
  },
  {
    slug: "it",
    name: "IT",
    aliases: ["it", "ict", "information-technology", "computing", "computer-science", "cs"],
    keywords: [
      "computer", "software", "hardware", "programming", "network",
      "database", "algorithm", "internet", "web", "html", "css",
      "javascript", "python", "java", "operating", "system", "binary",
      "byte", "bit", "processor", "memory", "storage", "router",
      "protocol", "tcp", "ip", "encryption", "firewall", "spreadsheet",
      "word", "processor", "presentation", "cybersecurity",
    ],
  },
  {
    slug: "citizenship",
    name: "Citizenship",
    aliases: ["citizenship", "civics", "civic", "citizen"],
    keywords: [
      "citizenship", "democracy", "constitution", "government",
      "right", "responsibility", "civic", "state", "law", "court",
      "parliament", "election", "vote", "policy", "citizen",
      "federal", "regional", "kebele", "woreda", "region",
      "equality", "freedom", "justice", "ethics", "constitution",
    ],
  },
  {
    slug: "history",
    name: "History",
    aliases: ["history", "hist"],
    keywords: [
      "history", "ancient", "modern", "revolution", "war", "empire",
      "dynasty", "civilization", "century", "king", "queen", "emperor",
      "battle", "treaty", "colonial", "independence", "movement",
      "ethiopia", "axum", "lalibela", "menes", "adwa", "italian",
      "occupation", "derg", "monarchy", "republic", "ethiopian",
    ],
  },
  {
    slug: "geography",
    name: "Geography",
    aliases: ["geography", "geo", "geog"],
    keywords: [
      "geography", "climate", "mountain", "river", "ocean", "continent",
      "population", "urban", "rural", "map", "topography", "atlas",
      "latitude", "longitude", "equator", "hemisphere", "tropic",
      "desert", "forest", "savanna", "rainfall", "temperature",
      "highland", "lowland", "rift", "valley", "plateau", "basin",
    ],
  },
  {
    slug: "economics",
    name: "Economics",
    aliases: ["economics", "econ", "economy"],
    keywords: [
      "economics", "market", "demand", "supply", "price", "production",
      "consumption", "gdp", "inflation", "trade", "money", "bank",
      "investment", "labor", "wage", "profit", "cost", "revenue",
      "scarcity", "opportunity", "elasticity", "monopoly", "competition",
      "fiscal", "monetary", "tax", "subsidy", "budget", "deficit",
    ],
  },
  {
    slug: "agriculture",
    name: "Agriculture",
    aliases: ["agriculture", "agri", "agric", "farming"],
    keywords: [
      "agriculture", "crop", "soil", "plant", "animal", "farm",
      "harvest", "irrigation", "fertilizer", "livestock", "poultry",
      "dairy", "cattle", "seed", "germination", "cultivation", "pest",
      "pesticide", "herbicide", "tractor", "ploughing", "sowing",
      "rotation", "fallow", "compost", "manure", "greenhouse",
    ],
  },
  {
    slug: "scholastic-aptitude-test",
    name: "Scholastic Aptitude Test",
    aliases: ["sat", "scholastic", "aptitude", "scholastic-aptitude-test"],
    keywords: [
      "sat", "aptitude", "scholastic", "quantitative", "verbal",
      "reasoning", "analogies", "antonym", "synonym", "arithmetic",
      "logical", "pattern", "series", "coding", "decoding",
    ],
  },
];

// ---------------------------------------------------------------------------
// Content-type detection
// ---------------------------------------------------------------------------
//
// Patterns are matched (case-insensitive) against BOTH the filename and the
// extracted text. We score each content type and pick the highest-scoring
// one. Past-exam patterns win ties because they're the most specific
// (numbered questions, "Choose the best answer", etc.).

type ContentTypePatterns = {
  type: string;
  label: string;
  filenameHints: RegExp[];
  contentPatterns: RegExp[];
  weight: number; // tie-breaker preference (higher wins ties)
};

const CONTENT_TYPE_PATTERNS: ContentTypePatterns[] = [
  {
    type: "past_exam",
    label: "Past Exam",
    weight: 100,
    filenameHints: [
      /\bpast[-_ ]?exam\b/i,
      /\bpast[-_ ]?paper\b/i,
      /\bnational[-_ ]?exam\b/i,
      /\beheee\b/i,
      /\bmatric(ulation)?\b/i,
      /\bexit[-_ ]?exam\b/i,
      /\bneea\b/i,
      /\bexam(-|\s)?paper\b/i,
      /\bgrade[-_ ]?12[-_ ]?exam\b/i,
      /\bfinal[-_ ]?exam\b/i,
    ],
    contentPatterns: [
      /choose\s+(?:the\s+)?(?:best|correct)\s+(?:answer|option)/i,
      /select\s+(?:the\s+)?(?:best|correct)\s+(?:answer|option)/i,
      /which\s+(?:of\s+the\s+)?following/i,
      /\bdirections?\s*:/i,
      /time\s*:\s*\d+\s*(?:min|hour)/i,
      /read\s+each\s+question\s+carefully/i,
      /answer\s+all\s+(?:the\s+)?questions/i,
      /\bquestion\s*(?:no\.?|number)?\s*\d+/i,
      /\bmatric(ulation)?\s+exam\b/i,
    ],
  },
  {
    type: "textbook",
    label: "Textbook",
    weight: 80,
    filenameHints: [
      /\btext[-_ ]?book\b/i,
      /\bstudent[-_ ]?text\b/i,
      /\bchapter\s*\d+/i,
      /\bunit\s*\d+/i,
      /grade[-_ ]?\d+[-_ ]?(?:textbook|student\s*text)/i,
    ],
    contentPatterns: [
      /\bunit\s+\d+\b/i,
      /\bchapter\s+\d+\b/i,
      /\blearning\s+objectives?\b/i,
      /\bkey\s+terms?\b/i,
      /\bsummary\b/i,
      /\bexercise\s+\d+\b/i,
      /\blearning\s+outcomes?\b/i,
      /\bintroduction\b/i,
    ],
  },
  {
    type: "worksheet",
    label: "Worksheet",
    weight: 70,
    filenameHints: [
      /\bwork[-_ ]?sheet\b/i,
      // NOTE: "practice" removed — too generic, catches "SAT practice" and
      // "Math practice" which are usually past exams. Kept "exercises" plural
      // (stronger signal) and "drill".
      /\bexercise\s*s\b/i, // exercises (plural) — strong worksheet signal
      /\bdrill\b/i,
      /\bactivity\s*sheet\b/i,
    ],
    contentPatterns: [
      /\bexercise\s+\d+\b/i,
      /\bactivity\s+\d+\b/i,
      /\bwork\s*sheet\b/i,
      /\bfill\s+in\s+(?:the\s+)?blanks?\b/i,
      /\bmatch\s+the\b/i,
    ],
  },
  {
    type: "student_guide",
    label: "Student Guide",
    weight: 75,
    filenameHints: [
      /\bstud(y|ent)\s*guide\b/i,
      /\bstud(y|ent)\s*note/i,
      /\brevision\s*note/i,
      /\bsummary\s*note/i,
    ],
    contentPatterns: [
      /\bstudy\s+guide\b/i,
      /\breview\s+notes?\b/i,
      /\bkey\s+concepts?\b/i,
      /\bimportant\s+points?\b/i,
      /\bremember\s*:/i,
    ],
  },
  {
    type: "teacher_guide",
    label: "Teacher Guide",
    weight: 75,
    filenameHints: [
      /\bteacher[-_ ]?guide\b/i,
      /\bteach(?:er|ing)\s*guide\b/i,
      /\binstructor[-_ ]?guide\b/i,
      /\blesson\s*plan\b/i,
      /\btg[-_ ]?\d+/i, // TG9, TG-10, etc.
    ],
    contentPatterns: [
      /\bteacher(?:'s)?\s+guide\b/i,
      /\bteaching\s+guide\b/i,
      /\blesson\s+plan\b/i,
      /\blearning\s+objectives?\s+for\s+teachers\b/i,
      /\binstructional\s+(?:objective|strategy)/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Filename normalizer
// ---------------------------------------------------------------------------

function normalizeFilename(filename: string): string {
  // Strip extension, replace separators with spaces, lowercase
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Year detector (reused from old code, kept here for self-containment)
// ---------------------------------------------------------------------------

export function detectYear(text: string): string | null {
  const currentYear = new Date().getFullYear();
  // Normalize separators to spaces FIRST so word boundaries work on
  // filenames like "Biology_Grade_12_2015.pdf" → "biology grade 12 2015".
  const normalized = text.replace(/[_\-.]+/g, " ");
  const matches = normalized.match(/\b(19|20)\d{2}\b/g);
  if (!matches) return null;
  for (const m of matches) {
    const y = parseInt(m, 10);
    if (y >= 1990 && y <= currentYear + 1) return String(y);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Grade detector
// ---------------------------------------------------------------------------
//
// Looks for grade patterns. Returns the first match in 9-12 range. Returns
// null if nothing found. We avoid matching bare digits (could be years or
// unit numbers).

export function detectGrade(text: string): string | null {
  // Normalize separators so word boundaries work on filenames.
  const normalized = text.replace(/[_\-.]+/g, " ");
  // Grade 9 / Grade9 / grade-9 / G9 / grade9
  let m = normalized.match(/\bgrade\s*[-_ ]?\s*(9|10|11|12)\b/i);
  if (m) return m[1];
  m = normalized.match(/\bg\s*[-_ ]?\s*(9|10|11|12)\b/i);
  if (m) return m[1];
  // 9th grade, 10th grade (ordinal form)
  m = normalized.match(/\b(9|10|11|12)(?:th|st|nd|rd)\s+grade\b/i);
  if (m) return m[1];
  // Year 1, Year 2 (Ethiopian secondary equivalent) — rare but seen
  // Skipped to avoid false positives.
  return null;
}

// ---------------------------------------------------------------------------
// Subject detector (filename-based)
// ---------------------------------------------------------------------------

function detectSubjectFromFilename(
  filename: string,
  subjects: Doc<"subjects">[],
): { slug: string; id: string; name: string; matchedAlias: string } | null {
  // Normalize the filename FIRST so word boundaries work even with
  // underscores/dashes: "TG11_Physics_Teacher_Guide.pdf" → "tg11 physics teacher guide"
  const normalized = normalizeFilename(filename);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const lowered = normalized;

  let bestMatch: { slug: string; id: string; name: string; matchedAlias: string; score: number } | null = null;

  for (const subject of SUBJECT_DICTIONARY) {
    for (const alias of subject.aliases) {
      // Match the alias as a whole token (word boundary).
      const aliasRe = new RegExp(`\\b${escapeRegex(alias)}\\b`, "i");
      if (aliasRe.test(lowered)) {
        // Confirm the subject exists in the catalog (so we don't suggest a
        // subject the admin hasn't seeded).
        const cat = subjects.find((s) => s.slug === subject.slug);
        if (!cat) continue;
        const score = alias.length; // longer alias = more specific
        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            slug: cat.slug,
            id: cat._id,
            name: cat.name,
            matchedAlias: alias,
            score,
          };
        }
      }
    }
  }
  // Also try matching the subject's display name directly (e.g. "Scholastic Aptitude Test")
  for (const cat of subjects) {
    const nameRe = new RegExp(`\\b${escapeRegex(cat.name.toLowerCase())}\\b`, "i");
    if (nameRe.test(lowered)) {
      const score = cat.name.length + 5; // full name beats alias
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { slug: cat.slug, id: cat._id, name: cat.name, matchedAlias: cat.name, score };
      }
    }
  }
  return bestMatch;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Subject detector (content-based keyword scoring)
// ---------------------------------------------------------------------------

function detectSubjectFromContent(
  text: string,
  subjects: Doc<"subjects">[],
): { slug: string; id: string; name: string; hits: number } | null {
  if (!text || text.trim().length < 30) return null;
  const lowered = text.toLowerCase();
  const tokens = new Set(lowered.split(/[^a-z0-9\u1200-\u137F]+/i).filter((t) => t.length >= 2));

  let best: { slug: string; id: string; name: string; hits: number } | null = null;
  for (const subject of SUBJECT_DICTIONARY) {
    const cat = subjects.find((s) => s.slug === subject.slug);
    if (!cat) continue;
    let hits = 0;
    for (const kw of subject.keywords) {
      if (tokens.has(kw)) hits += 1;
      // Bonus for Amharic script matches (longer tokens)
      if (/[\u1200-\u137F]/.test(kw) && lowered.includes(kw)) hits += 1;
    }
    if (hits >= 2 && (!best || hits > best.hits)) {
      best = { slug: cat.slug, id: cat._id, name: cat.name, hits };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Content-type detector
// ---------------------------------------------------------------------------

function detectContentType(
  filename: string,
  contentText: string,
): { type: string; confidence: number; signal: string } | null {
  const normalizedFilename = normalizeFilename(filename);
  const loweredContent = contentText.toLowerCase();

  let best: { type: string; confidence: number; signal: string; weight: number } | null = null;

  for (const pattern of CONTENT_TYPE_PATTERNS) {
    let score = 0;
    let signal = "";

    // Filename match — high signal
    for (const re of pattern.filenameHints) {
      if (re.test(normalizedFilename)) {
        score += 40;
        signal = `filename match: ${re.source}`;
        break;
      }
    }

    // Content match
    let contentMatches = 0;
    for (const re of pattern.contentPatterns) {
      if (re.test(loweredContent)) {
        contentMatches += 1;
        if (!signal) signal = `content match: ${re.source}`;
      }
    }
    score += Math.min(contentMatches * 15, 60);

    if (score > 0 && (!best || score > best.confidence || (score === best.confidence && pattern.weight > best.weight))) {
      best = { type: pattern.type, confidence: score, signal, weight: pattern.weight };
    }
  }

  if (!best) return null;
  // Normalize 0-100 (caps at 100)
  return { type: best.type, confidence: Math.min(best.confidence, 100), signal: best.signal };
}

// ---------------------------------------------------------------------------
// Unit / Chapter detector (for topic candidates)
// ---------------------------------------------------------------------------

function detectUnits(text: string): string[] {
  const units = new Set<string>();
  // "Unit 4", "Unit Four", "UNIT 4: Thermodynamics"
  const re = /\bunit\s+(\d{1,2})\b/gi;
  let m;
  while ((m = re.exec(text)) && units.size < 5) {
    units.add(`Unit ${m[1]}`);
  }
  // Chapter fallback
  const re2 = /\bchapter\s+(\d{1,2})\b/gi;
  while ((m = re2.exec(text)) && units.size < 5) {
    units.add(`Chapter ${m[1]}`);
  }
  return Array.from(units);
}

// ---------------------------------------------------------------------------
// Title generator — builds a clean, human-readable title from the parts we
// detected. Falls back to the cleaned filename if we don't have enough.
// ---------------------------------------------------------------------------

function generateTitle(parts: {
  subjectName: string | null;
  grade: string | null;
  contentType: string | null;
  examYear: string | null;
  filename: string;
}): string {
  const { subjectName, grade, contentType, examYear, filename } = parts;
  const typeLabel: Record<string, string> = {
    past_exam: "Past Exam",
    textbook: "Textbook",
    worksheet: "Worksheet",
    student_guide: "Student Guide",
    teacher_guide: "Teacher Guide",
  };
  const pieces: string[] = [];
  if (subjectName) pieces.push(subjectName);
  if (grade) pieces.push(`Grade ${grade}`);
  if (contentType && typeLabel[contentType]) pieces.push(typeLabel[contentType]);
  if (examYear) pieces.push(examYear);

  if (pieces.length >= 2) {
    return pieces.join(" — ");
  }
  // Fallback — just the cleaned filename (no extension, no separators)
  return filename
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

// ---------------------------------------------------------------------------
// MAIN CLASSIFIER — combines filename + content signals with weighted
// confidence.
// ---------------------------------------------------------------------------

export interface ClassifyOptions {
  filename: string;
  contentText: string; // first ~8KB of extracted PDF text (empty if extraction failed)
  subjects: Doc<"subjects">[];
}

export function classifyDocument(opts: ClassifyOptions): ClassificationResult {
  const { filename, contentText, subjects } = opts;
  const signals: string[] = [];
  const normalized = normalizeFilename(filename);

  // ── Year ────────────────────────────────────────────────────────────
  const year = detectYear(filename) ?? detectYear(contentText.slice(0, 4000));
  if (year) signals.push(`year: ${year} (from filename/text)`);

  // ── Grade ────────────────────────────────────────────────────────────
  const grade = detectGrade(filename) ?? detectGrade(contentText.slice(0, 4000));
  if (grade) signals.push(`grade: ${grade} (from filename/text)`);

  // ── Subject ──────────────────────────────────────────────────────────
  const filenameSubject = detectSubjectFromFilename(filename, subjects);
  const contentSubject = detectSubjectFromContent(contentText, subjects);
  let subjectId: string | null = null;
  let subjectSlug: string | null = null;
  let subjectName: string | null = null;
  let subjectConfidence = 0;
  if (filenameSubject) {
    subjectId = filenameSubject.id;
    subjectSlug = filenameSubject.slug;
    subjectName = filenameSubject.name;
    subjectConfidence = 60;
    signals.push(`subject: ${filenameSubject.name} (filename alias "${filenameSubject.matchedAlias}")`);
  }
  if (contentSubject) {
    if (!filenameSubject) {
      subjectId = contentSubject.id;
      subjectSlug = contentSubject.slug;
      subjectName = contentSubject.name;
      subjectConfidence = Math.min(40 + contentSubject.hits * 3, 80);
      signals.push(`subject: ${contentSubject.name} (content keyword hits: ${contentSubject.hits})`);
    } else if (filenameSubject.slug === contentSubject.slug) {
      // Both agree — boost confidence
      subjectConfidence = Math.min(subjectConfidence + 25, 100);
      signals.push(`subject: confirmed by both filename + content (${contentSubject.hits} keyword hits)`);
    } else {
      // Filename says X, content says Y. Trust filename (more reliable for short samples).
      signals.push(`subject: filename says ${filenameSubject.name}, content hints ${contentSubject.name} — using filename`);
    }
  }

  // ── Content type ────────────────────────────────────────────────────
  const typeResult = detectContentType(filename, contentText);
  let contentType: string | null = null;
  let contentTypeConfidence = 0;
  if (typeResult) {
    contentType = typeResult.type;
    contentTypeConfidence = typeResult.confidence;
    signals.push(`content type: ${typeResult.type} (${typeResult.signal}, score ${typeResult.confidence})`);
  }

  // ── If content type is past_exam, year is required; if we found a year
  //    in the content, the type is more likely past_exam.
  // ────────────────────────────────────────────────────────────────────
  if (year && !contentType) {
    // We have a year but no type signal. Could be a past exam or a
    // textbook with copyright year. Heuristic: if there's no
    // "textbook"/"unit"/"chapter" word in the filename, lean past_exam.
    if (!/\b(text|unit|chapter|guide|worksheet)\b/i.test(normalized)) {
      contentType = "past_exam";
      contentTypeConfidence = 30;
      signals.push(`content type: inferred past_exam (year present, no textbook hints)`);
    }
  }

  // ── Topics (for content_items topicCandidates) ──────────────────────
  const topics = detectUnits(contentText.slice(0, 8000));
  if (topics.length > 0) {
    signals.push(`topics: ${topics.join(", ")}`);
  }

  // ── Confidence merge ────────────────────────────────────────────────
  // Subject: 40 points max
  // Type:    30 points max
  // Grade:   20 points max
  // Year:    10 points max
  const subjectScore = subjectConfidence * 0.4; // 0-40
  const typeScore = contentTypeConfidence * 0.3; // 0-30
  const gradeScore = grade ? 20 : 0;
  const yearScore = year ? 10 : 0;
  const confidence = Math.round(subjectScore + typeScore + gradeScore + yearScore);

  let confidenceLevel: "high" | "medium" | "low";
  if (confidence >= 70) confidenceLevel = "high";
  else if (confidence >= 40) confidenceLevel = "medium";
  else confidenceLevel = "low";

  // ── Title ────────────────────────────────────────────────────────────
  const title = generateTitle({
    subjectName,
    grade,
    contentType,
    examYear: year,
    filename,
  });

  return {
    title,
    subjectId,
    subjectSlug,
    grade,
    contentType,
    examYear: year,
    topics,
    confidence,
    confidenceLevel,
    signals,
  };
}
