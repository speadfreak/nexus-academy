// AI content auto-classification (admin pipeline).
//
// PDF text extraction happens in the BROWSER (pdfjs-dist runs cleanly there
// and the reader already ships it — it crashes the Convex node analyzer, so
// it never runs server-side). The admin upload form extracts the first few
// pages of text and passes the sample here, which asks the Grok API to
// classify it: likely grade, subject (matched against the REAL subjects
// table so the model can never invent a subject), content type, exam year
// when it looks like a past paper, and 3-5 topic candidates.
//
// CRITICAL: the result is a SUGGESTION, never an auto-commit. The admin
// upload form is pre-filled and clearly marked "AI suggested — review before
// confirming". Misclassified national-exam content is a trust problem, so a
// human always clicks confirm.

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireAdminAction } from "./admin";
import { logEventAction } from "./systemEvents";
import { CONTENT_TYPES } from "./constants";

const AI_MODEL = process.env.AI_MODEL || "grok-4.6";
const API_URL = "https://api.x.ai/v1/chat/completions";
const SAMPLE_CHARS = 12000;

export interface ContentAnalysisSuggestion {
  analyzed: boolean;
  sampleChars: number;
  title: string | null;
  contentType: string | null;
  grade: number | null;
  subjectId: Id<"subjects"> | null;
  subjectSlug: string | null;
  examYear: number | null;
  topics: string[];
  note: string | null;
}

function extractJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Classify a text sample extracted from a staged upload. The file is NOT
 * moved to R2 and nothing is saved — the admin reviews and confirms through
 * the normal upload action.
 */
export const classifyContentText = action({
  args: {
    sample: v.string(),
    filename: v.string(),
  },
  handler: async (ctx, args): Promise<ContentAnalysisSuggestion> => {
    await requireAdminAction(ctx);

    const start = Date.now();
    const sample = args.sample.slice(0, SAMPLE_CHARS);
    if (sample.trim().length < 60) {
      return {
        analyzed: false,
        sampleChars: sample.trim().length,
        title: null,
        contentType: null,
        grade: null,
        subjectId: null,
        subjectSlug: null,
        examYear: null,
        topics: [],
        note: "This PDF has no extractable text (it may be a scanned image). Classify it manually.",
      };
    }

    if (!process.env.XAI_API_KEY) {
      return {
        analyzed: false,
        sampleChars: sample.trim().length,
        title: null,
        contentType: null,
        grade: null,
        subjectId: null,
        subjectSlug: null,
        examYear: null,
        topics: [],
        note: "Add XAI_API_KEY in the Keys tab to enable AI classification.",
      };
    }

    // --- Classify with Grok ----------------------------------------------
    const subjects: Doc<"subjects">[] = await ctx.runQuery(
      internal.subjects.listAllSubjects,
      {},
    );
    const subjectCatalog = subjects.map((subject) => ({
      slug: subject.slug,
      name: subject.name,
      stream: subject.stream,
    }));

    const prompt = `You are classifying Ethiopian national exam prep documents for a
study platform serving grades 9-12.

The document's filename is: ${args.filename}

Here is a text sample extracted from the first few pages:

--- SAMPLE START ---
${sample}
--- SAMPLE END ---

Classify this document. The subject MUST be one of the real subjects below
(choose the closest; never invent one). Topic candidates should be 3-5 short
syllabus-style topic names for that grade and subject.

Real subjects (slug -> name):
${subjectCatalog.map((s) => `- ${s.slug} -> ${s.name} (${s.stream} stream)`).join("\n")}

Return ONLY strict JSON, no commentary, with this exact shape:
{
  "title": "a concise, human title for the library entry (no file extension)",
  "contentType": "textbook" | "past_exam" | "worksheet" | "student_guide" | "teacher_guide",
  "grade": 9 | 10 | 11 | 12,
  "subjectSlug": "<one of the real slugs>",
  "examYear": <integer year or null — only set when contentType is "past_exam">,
  "topics": ["topic one", "topic two", "topic three"]
}`;

    let parsed: Record<string, unknown> | null = null;
    let classificationError: string | null = null;
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are a precise document classifier. You only output valid JSON. Never invent subjects outside the provided catalog.",
            },
            { role: "user", content: prompt },
          ],
          max_tokens: 512,
          temperature: 0.1,
        }),
      });
      if (!response.ok) {
        classificationError = `Grok API error ${response.status}`;
      } else {
        const data = (await response.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        parsed = extractJson(data.choices?.[0]?.message?.content ?? "");
        if (!parsed) classificationError = "Grok returned unparseable JSON";
      }
    } catch (error) {
      classificationError = error instanceof Error ? error.message : "Grok call failed";
    }

    await logEventAction(ctx, {
      eventType: "api_call",
      source: "contentAI.classify.grok",
      status: classificationError ? "error" : "success",
      metadata: {
        filename: args.filename,
        sampleChars: sample.trim().length,
        message: classificationError ?? undefined,
      },
      durationMs: Date.now() - start,
    });

    if (!parsed) {
      return {
        analyzed: false,
        sampleChars: sample.trim().length,
        title: null,
        contentType: null,
        grade: null,
        subjectId: null,
        subjectSlug: null,
        examYear: null,
        topics: [],
        note: classificationError ?? "Could not classify the document.",
      };
    }

    // --- Validate every field server-side --------------------------------
    const slug = typeof parsed.subjectSlug === "string" ? parsed.subjectSlug.toLowerCase() : null;
    const matchedSubject = slug
      ? subjects.find((subject) => subject.slug === slug) ?? null
      : null;

    const contentType =
      typeof parsed.contentType === "string" &&
      (CONTENT_TYPES as readonly string[]).includes(parsed.contentType)
        ? parsed.contentType
        : null;

    const grade =
      typeof parsed.grade === "number" &&
      Number.isInteger(parsed.grade) &&
      parsed.grade >= 9 &&
      parsed.grade <= 12
        ? parsed.grade
        : null;

    const examYear =
      typeof parsed.examYear === "number" &&
      Number.isInteger(parsed.examYear) &&
      parsed.examYear >= 1990 &&
      parsed.examYear <= new Date().getFullYear() &&
      contentType === "past_exam"
        ? parsed.examYear
        : null;

    const topics = Array.isArray(parsed.topics)
      ? parsed.topics
          .filter((topic): topic is string => typeof topic === "string")
          .map((topic) => topic.trim().replace(/\s+/g, " "))
          .filter((topic) => topic.length >= 3 && topic.length <= 80)
          .slice(0, 5)
      : [];

    const title =
      typeof parsed.title === "string" && parsed.title.trim().length > 0
        ? parsed.title.trim().slice(0, 120)
        : null;

    return {
      analyzed: true,
      sampleChars: sample.trim().length,
      title,
      contentType,
      grade,
      subjectId: matchedSubject?._id ?? null,
      subjectSlug: matchedSubject?.slug ?? null,
      examYear,
      topics,
      note: null,
    };
  },
});
