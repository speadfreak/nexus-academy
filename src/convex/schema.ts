import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";
import { CONTENT_TYPES, STREAMS } from "./constants";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

export const streamValidator = v.union(...STREAMS.map((s) => v.literal(s)));
export const contentTypeValidator = v.union(
  ...CONTENT_TYPES.map((t) => v.literal(t)),
);

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // ------------------------------------------------------------------
    // Nexus Academy content library
    // ------------------------------------------------------------------

    // Subjects across the three streams. e.g. { name: "Physics", stream: "natural", slug: "physics" }
    subjects: defineTable({
      name: v.string(),
      stream: streamValidator,
      slug: v.string(),
    })
      .index("by_slug", ["slug"])
      .index("by_stream", ["stream"]),

    // Library content items (textbooks, past exams, worksheets, guides).
    // fileUrl points at the public Cloudflare R2 object URL.
    contentItems: defineTable({
      title: v.string(),
      contentType: contentTypeValidator,
      grade: v.number(), // 9-12
      subjectId: v.id("subjects"),
      examYear: v.optional(v.number()), // only populated when contentType = "past_exam"
      fileUrl: v.string(),
      fileSizeBytes: v.optional(v.number()),
      pageCount: v.optional(v.number()),
      uploadedBy: v.optional(v.id("users")),
      isPremium: v.boolean(),
      createdAt: v.number(), // epoch ms (mirrors a created_at timestamp column)
    })
      .index("by_subject", ["subjectId"])
      .index("by_grade", ["grade"])
      .index("by_contentType", ["contentType"])
      .index("by_subject_grade", ["subjectId", "grade"])
      .index("by_createdAt", ["createdAt"]),

    // Topics per subject/grade — built now for the future AI topic-correlation
    // feature so we don't need a migration later.
    topics: defineTable({
      name: v.string(),
      subjectId: v.id("subjects"),
      grade: v.number(),
    })
      .index("by_subject", ["subjectId"])
      .index("by_subject_grade", ["subjectId", "grade"]),

    // Junction between content items and topics.
    contentTopics: defineTable({
      contentId: v.id("contentItems"),
      topicId: v.id("topics"),
    })
      .index("by_content", ["contentId"])
      .index("by_topic", ["topicId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
