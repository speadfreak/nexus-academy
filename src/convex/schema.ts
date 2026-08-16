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

    // ------------------------------------------------------------------
    // AI study companion
    // ------------------------------------------------------------------

    // Tutor chat threads, scoped optionally to a subject and/or a content item.
    conversations: defineTable({
      userId: v.id("users"),
      title: v.string(),
      subjectId: v.optional(v.id("subjects")),
      contentId: v.optional(v.id("contentItems")),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_user_updatedAt", ["userId", "updatedAt"]),

    // Individual turns inside a conversation thread. contentId optionally
    // grounds a turn in a specific library document.
    messages: defineTable({
      conversationId: v.id("conversations"),
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      contentId: v.optional(v.id("contentItems")),
      createdAt: v.number(),
    }).index("by_conversation", ["conversationId", "createdAt"]),

    // Student task list. priority: low | medium | high.
    todos: defineTable({
      userId: v.id("users"),
      text: v.string(),
      subjectId: v.optional(v.id("subjects")),
      isDone: v.boolean(),
      priority: v.union(
        v.literal("low"),
        v.literal("medium"),
        v.literal("high"),
      ),
      dueDate: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_done", ["userId", "isDone"]),

    // Completed focus sessions — powers streaks, hours and history.
    studySessions: defineTable({
      userId: v.id("users"),
      subjectId: v.id("subjects"),
      topicId: v.optional(v.id("topics")),
      durationSeconds: v.number(),
      startedAt: v.number(),
      endedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_startedAt", ["userId", "startedAt"]),

    // Denormalized streak state — one row per user for fast dashboard reads.
    studyStreaks: defineTable({
      userId: v.id("users"),
      currentStreak: v.number(),
      longestStreak: v.number(),
      lastStudyDate: v.string(), // "YYYY-MM-DD"
      totalHoursStudied: v.number(),
    }).index("by_user", ["userId"]),

    // ------------------------------------------------------------------
    // Monetization, plans and reminders
    // ------------------------------------------------------------------

    // One subscription per user. Trial counts ACTIVE days (days the student
    // actually uses the app), not calendar days since signup.
    subscriptions: defineTable({
      userId: v.id("users"),
      status: v.union(
        v.literal("trial"),
        v.literal("active"),
        v.literal("expired"),
        v.literal("canceled"),
      ),
      trialStartedAt: v.optional(v.number()),
      trialActiveDays: v.number(),
      lastActiveDate: v.optional(v.string()), // "YYYY-MM-DD" — guards double-counting
      trialEndsAt: v.optional(v.number()),
      currentPeriodEnd: v.optional(v.number()),
      planTier: v.string(),
    }).index("by_user", ["userId"]),

    // Payment attempts, one row per initiation.
    payments: defineTable({
      userId: v.id("users"),
      provider: v.union(v.literal("telebirr"), v.literal("mpesa")),
      amount: v.number(),
      currency: v.string(),
      providerTransactionId: v.optional(v.string()),
      status: v.union(
        v.literal("pending"),
        v.literal("completed"),
        v.literal("failed"),
      ),
      createdAt: v.number(),
      completedAt: v.optional(v.number()),
    })
      .index("by_user", ["userId"])
      .index("by_status", ["status"])
      .index("by_providerTransactionId", ["providerTransactionId"]),

    // AI-generated study plans, stored as validated JSON strings.
    studyPlans: defineTable({
      userId: v.id("users"),
      subjectId: v.id("subjects"),
      generatedAt: v.number(),
      targetExamDate: v.optional(v.number()),
      planJson: v.string(),
      isActive: v.boolean(),
      completedWeeks: v.array(v.number()),
    }).index("by_user_subject", ["userId", "subjectId"]),

    // Per-user reminder preferences + in-app reminder flag.
    reminderSettings: defineTable({
      userId: v.id("users"),
      streakRemindersEnabled: v.boolean(),
      reminderHour: v.number(),
      lastReminderSentDate: v.optional(v.string()), // "YYYY-MM-DD"
      pendingReminder: v.boolean(),
    }).index("by_user", ["userId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
