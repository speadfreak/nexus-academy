// Sample library seeder — a one-shot admin action that fills an EMPTY library
// with clearly-labeled demo content so the bookshelf, reader, topic
// correlation and admin analytics are usable before real national-exam files
// are uploaded.
//
// SAFETY / HONESTY: every item is prefixed "Sample ·" and the PDF body text
// explicitly says it is NOT an official Ministry of Education document. The
// seeder refuses to run when ANY content already exists (idempotent, never
// pollutes a real library), and it only runs on an explicit admin click.
//
// PDFs are generated as minimal valid PDFs (correct xref offsets) and stored
// in Convex file storage, so every seeded item actually opens in the in-app
// reader and downloads — no dead links.

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdminAction } from "./admin";
import { logEventAction } from "./systemEvents";

type SeedType =
  | "textbook"
  | "past_exam"
  | "worksheet"
  | "student_guide"
  | "teacher_guide";

interface SeedItem {
  title: string;
  contentType: SeedType;
  grade: number;
  subjectSlug: string;
  examYear?: number;
  isPremium?: boolean;
  topicNames: string[];
  body: string[];
}

// ---------------------------------------------------------------------------
// Minimal PDF generator (hand-written, valid xref)
// ---------------------------------------------------------------------------

function escapePdfText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function makeSamplePdf(title: string, lines: string[]): ArrayBuffer {
  const contentLines = [
    `BT /F1 20 Tf 72 740 Td (${escapePdfText(title)}) Tj ET`,
    "BT /F1 11 Tf 72 700 Td (NexET 🇪🇹 - sample preview document) Tj ET",
    "BT /F1 11 Tf 72 682 Td (NOT an official Ministry of Education document.) Tj ET",
    ...lines.map((line, index) => {
      const y = 640 - index * 22;
      return y >= 60
        ? `BT /F1 11 Tf 72 ${y} Td (${escapePdfText(line)}) Tj ET`
        : "";
    }),
    "BT /F1 11 Tf 72 48 Td (Generated for preview only - replace with official materials.) Tj ET",
  ].filter(Boolean);
  const content = contentLines.join("\n");
  const contentBytes = Buffer.byteLength(content, "utf8");

  const objects: string[] = [];
  objects.push(
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj",
    `4 0 obj\n<< /Length ${contentBytes} >>\nstream\n${content}\nendstream\nendobj`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj",
  );

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += obj + "\n";
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  // Copy into a fresh typed array so `.buffer` is a plain ArrayBuffer
  // (BlobPart-compatible) rather than Buffer's ArrayBufferLike.
  const buf = Buffer.from(pdf, "utf8");
  const copy = new Uint8Array(buf.length);
  copy.set(buf);
  return copy.buffer;
}

// ---------------------------------------------------------------------------
// Catalog — one entry per subject covers streams natural/social + shared
// ---------------------------------------------------------------------------

const CATALOG: SeedItem[] = [
  {
    title: "Sample · Grade 9 English — Student Textbook (Units 1–5)",
    contentType: "textbook",
    grade: 9,
    subjectSlug: "english",
    topicNames: ["Reading comprehension", "Grammar and usage", "Vocabulary building"],
    body: [
      "Unit 1: Reading for meaning",
      "Unit 2: Grammar in context",
      "Unit 3: Writing paragraphs",
      "Unit 4: Listening and speaking",
      "Unit 5: Vocabulary in use",
    ],
  },
  {
    title: "Sample · 2023 Grade 12 English National Exam — Demo Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "english",
    examYear: 2023,
    isPremium: true,
    topicNames: ["Reading comprehension", "Grammar and usage"],
    body: [
      "Section A: Reading comprehension (40%)",
      "Section B: Grammar and usage (30%)",
      "Section C: Composition (30%)",
      "Time allowed: 2 hours 30 minutes",
    ],
  },
  {
    title: "Sample · Grade 10 English Worksheet — Comprehension",
    contentType: "worksheet",
    grade: 10,
    subjectSlug: "english",
    topicNames: ["Reading comprehension", "Vocabulary building"],
    body: [
      "Passage 1: Read and answer 5 questions",
      "Passage 2: True / False statements",
      "Vocabulary match exercise",
      "Short answer questions",
    ],
  },
  {
    title: "Sample · Grade 9 Mathematics — Student Textbook",
    contentType: "textbook",
    grade: 9,
    subjectSlug: "mathematics",
    topicNames: ["Algebra", "Geometry", "Statistics and probability"],
    body: [
      "Unit 1: Number systems",
      "Unit 2: Algebra",
      "Unit 3: Geometry",
      "Unit 4: Statistics and probability",
    ],
  },
  {
    title: "Sample · 2022 Grade 12 Mathematics National Exam — Demo Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "mathematics",
    examYear: 2022,
    isPremium: true,
    topicNames: ["Algebra", "Calculus", "Vectors"],
    body: [
      "Section A: Multiple choice (40 items)",
      "Section B: Short answer",
      "Section C: Worked problems",
      "Time allowed: 3 hours",
    ],
  },
  {
    title: "Sample · Grade 12 Mathematics — Exam Season Guide",
    contentType: "student_guide",
    grade: 12,
    subjectSlug: "mathematics",
    topicNames: ["Algebra", "Calculus", "Vectors"],
    body: [
      "Week 1-2: Functions and algebra revision",
      "Week 3-4: Calculus fundamentals",
      "Week 5: Vectors and matrices",
      "Week 6: Past paper practice",
    ],
  },
  {
    title: "Sample · Grade 11 Physics — Student Textbook",
    contentType: "textbook",
    grade: 11,
    subjectSlug: "physics",
    topicNames: ["Kinematics", "Dynamics", "Waves and optics"],
    body: [
      "Unit 1: Kinematics",
      "Unit 2: Dynamics",
      "Unit 3: Waves and optics",
      "Unit 4: Electricity and magnetism",
    ],
  },
  {
    title: "Sample · 2024 Grade 12 Physics National Exam — Demo Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "physics",
    examYear: 2024,
    isPremium: true,
    topicNames: ["Kinematics", "Electricity and magnetism"],
    body: [
      "Section A: Objective questions",
      "Section B: Structured questions",
      "Practical context problems",
      "Time allowed: 3 hours",
    ],
  },
  {
    title: "Sample · Grade 9 Physics Worksheet — Motion",
    contentType: "worksheet",
    grade: 9,
    subjectSlug: "physics",
    topicNames: ["Kinematics", "Dynamics"],
    body: [
      "Speed and velocity problems",
      "Acceleration calculations",
      "Distance-time graph practice",
      "Velocity-time graph practice",
    ],
  },
  {
    title: "Sample · Grade 11 Chemistry — Student Textbook",
    contentType: "textbook",
    grade: 11,
    subjectSlug: "chemistry",
    topicNames: ["Atomic structure", "Chemical bonding", "Acids and bases"],
    body: [
      "Unit 1: Atomic structure",
      "Unit 2: Chemical bonding",
      "Unit 3: Acids, bases and salts",
      "Unit 4: Organic chemistry introduction",
    ],
  },
  {
    title: "Sample · 2023 Grade 12 Chemistry National Exam — Demo Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "chemistry",
    examYear: 2023,
    isPremium: true,
    topicNames: ["Atomic structure", "Chemical bonding"],
    body: [
      "Section A: Multiple choice",
      "Section B: Equations and balancing",
      "Section C: Organic chemistry",
    ],
  },
  {
    title: "Sample · Grade 10 Biology — Student Textbook",
    contentType: "textbook",
    grade: 10,
    subjectSlug: "biology",
    topicNames: ["Cell biology", "Genetics", "Human body systems"],
    body: [
      "Unit 1: Cell biology",
      "Unit 2: Genetics",
      "Unit 3: Human body systems",
      "Unit 4: Ecology",
    ],
  },
  {
    title: "Sample · 2022 Grade 12 Biology National Exam — Demo Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "biology",
    examYear: 2022,
    isPremium: true,
    topicNames: ["Cell biology", "Genetics", "Human body systems"],
    body: [
      "Section A: Objective questions",
      "Section B: Genetics problems",
      "Section C: System diagrams and essays",
    ],
  },
  {
    title: "Sample · Grade 9 History — Student Textbook",
    contentType: "textbook",
    grade: 9,
    subjectSlug: "history",
    topicNames: ["Ancient civilizations", "Ethiopian history", "World wars"],
    body: [
      "Unit 1: Ancient civilizations of Africa",
      "Unit 2: Ethiopian history to 1900",
      "Unit 3: The world wars",
      "Unit 4: Post-war world",
    ],
  },
  {
    title: "Sample · 2023 Grade 12 History National Exam — Demo Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "history",
    examYear: 2023,
    isPremium: true,
    topicNames: ["Ethiopian history", "World wars"],
    body: [
      "Section A: Multiple choice",
      "Section B: Source analysis",
      "Section C: Essay questions",
    ],
  },
  {
    title: "Sample · Grade 10 Geography — Student Textbook",
    contentType: "textbook",
    grade: 10,
    subjectSlug: "geography",
    topicNames: ["Map reading", "Climate", "Population geography"],
    body: [
      "Unit 1: Map reading and interpretation",
      "Unit 2: Climate and weather",
      "Unit 3: Population geography",
      "Unit 4: Natural resources of Ethiopia",
    ],
  },
  {
    title: "Sample · Grade 11 Economics — Student Textbook",
    contentType: "textbook",
    grade: 11,
    subjectSlug: "economics",
    topicNames: ["Microeconomics", "Macroeconomics", "Development economics"],
    body: [
      "Unit 1: Introduction to economics",
      "Unit 2: Microeconomics",
      "Unit 3: Macroeconomics",
      "Unit 4: Development economics",
    ],
  },
  {
    title: "Sample · Grade 12 Economics — Exam Season Guide",
    contentType: "student_guide",
    grade: 12,
    subjectSlug: "economics",
    topicNames: ["Microeconomics", "Macroeconomics", "Development economics"],
    body: [
      "Demand and supply revision",
      "National income accounting",
      "Development indicators",
      "Ethiopian economic policy",
    ],
  },
  {
    title: "Sample · Scholastic Aptitude Test — Practice Paper",
    contentType: "past_exam",
    grade: 12,
    subjectSlug: "scholastic-aptitude-test",
    examYear: 2024,
    isPremium: true,
    topicNames: ["Verbal reasoning", "Quantitative reasoning", "Abstract reasoning"],
    body: [
      "Section 1: Verbal reasoning",
      "Section 2: Quantitative reasoning",
      "Section 3: Abstract reasoning",
      "Time allowed: 2 hours",
    ],
  },
  {
    title: "Sample · Scholastic Aptitude Test — Preparation Guide",
    contentType: "student_guide",
    grade: 12,
    subjectSlug: "scholastic-aptitude-test",
    topicNames: ["Verbal reasoning", "Quantitative reasoning"],
    body: [
      "How the SAT is structured",
      "Verbal reasoning strategies",
      "Quantitative reasoning strategies",
      "Practice schedule for 8 weeks",
    ],
  },
];

// ---------------------------------------------------------------------------
// Seed action
// ---------------------------------------------------------------------------

export const seedSampleLibrary = action({
  args: {},
  handler: async (ctx): Promise<{ seeded: number; skipped: boolean }> => {
    const { user: adminUser } = await requireAdminAction(ctx);

    const existingCount = await ctx.runQuery(
      internal.content.countContentItems,
      {},
    );
    if (existingCount > 0) {
      return { seeded: 0, skipped: true };
    }

    const storageBase =
      process.env.CONVEX_URL ??
      process.env.CONVEX_SITE_URL ??
      "https://hearty-seahorse-455.convex.cloud";

    let seeded = 0;
    for (const item of CATALOG) {
      const subject = await ctx.runQuery(internal.content.getSubjectBySlug, {
        slug: item.subjectSlug,
      });
      if (!subject) continue;

      const pdfBytes = makeSamplePdf(item.title, item.body);
      const storageId = await ctx.storage.store(
        new Blob([pdfBytes], { type: "application/pdf" }),
      );
      const fileUrl = `${storageBase}/api/storage/${storageId}`;

      const contentId = await ctx.runMutation(
        internal.content.insertContentItem,
        {
          title: item.title,
          contentType: item.contentType,
          grade: item.grade,
          subjectId: subject._id,
          examYear: item.examYear,
          fileUrl,
          fileSizeBytes: pdfBytes.byteLength,
          uploadedBy: adminUser._id,
          isPremium: Boolean(item.isPremium),
        },
      );

      await ctx.runMutation(internal.content.linkContentTopics, {
        contentId,
        subjectId: subject._id,
        grade: item.grade,
        topicNames: item.topicNames,
      });

      seeded += 1;
    }

    await logEventAction(ctx, {
      eventType: "content_event",
      source: "sampleContent.seed",
      status: "success",
      userId: adminUser._id,
      metadata: { seeded, storageBase },
      durationMs: 0,
    });

    return { seeded, skipped: false };
  },
});

// ---------------------------------------------------------------------------
// Read helper — is the library empty? (drives the admin "Load sample content"
// button visibility)
// ---------------------------------------------------------------------------

export const isLibraryEmpty = action({
  args: {},
  handler: async (ctx): Promise<{ empty: boolean; count: number }> => {
    await requireAdminAction(ctx);
    const count = await ctx.runQuery(internal.content.countContentItems, {});
    return { empty: count === 0, count };
  },
});
