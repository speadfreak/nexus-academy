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
      title: v.optional(v.string()),
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
      contentId: v.optional(v.id("contentItems")), // optional link to a library item being studied
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

    // ------------------------------------------------------------------
    // Study experience deepening
    // ------------------------------------------------------------------

    // Student sticky notes. difficulty is the STUDENT's own tagging of how
    // hard the subject/topic feels — fed back into the tutor's system prompt
    // so it adjusts pacing for subjects marked "hard".
    notes: defineTable({
      userId: v.id("users"),
      subjectId: v.id("subjects"),
      content: v.string(),
      difficulty: v.optional(
        v.union(v.literal("easy"), v.literal("medium"), v.literal("hard")),
      ),
      topicId: v.optional(v.id("topics")),
      color: v.string(), // visual variety for the sticky-note metaphor
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_subject", ["userId", "subjectId"]),

    // One row per user with display/settings preferences. `stream` lives here
    // (it does not exist on the users table) — set during signup onboarding
    // and used to personalize the dashboard and the AI tutor.
    userProfiles: defineTable({
      userId: v.id("users"),
      displayName: v.optional(v.string()),
      username: v.optional(v.string()), // lowercase handle — allows login by
      // username in addition to email (resolved server-side, uniqueness
      // enforced in the setter mutation, never assumed at the DB level).
      avatarStorageId: v.optional(v.string()),
      themePreference: v.union(v.literal("dark"), v.literal("light")),
      stream: v.optional(streamValidator),
    })
      .index("by_user", ["userId"])
      .index("by_username", ["username"]),

    // One motivational quote per day, deterministic so every student sees
    // the same quote on the same day.
    dailyQuotes: defineTable({
      text: v.string(),
      author: v.optional(v.string()),
      dateAssigned: v.string(), // "YYYY-MM-DD"
    }).index("by_date", ["dateAssigned"]),

    // AI-generated personalized quizzes. generatedForUserId means a quiz is
    // owned by the student it was generated for — not a shared static bank.
    quizzes: defineTable({
      subjectId: v.id("subjects"),
      topicId: v.optional(v.id("topics")),
      generatedForUserId: v.id("users"),
      questionsJson: v.string(),
      createdAt: v.number(),
    })
      .index("by_user", ["generatedForUserId"])
      .index("by_subject", ["subjectId"]),

    // Attempts on quizzes. answers are the selected option indices;
    // score/totalQuestions are computed server-side, never client-sent.
    quizAttempts: defineTable({
      quizId: v.id("quizzes"),
      userId: v.id("users"),
      answers: v.array(v.number()),
      score: v.number(),
      totalQuestions: v.number(),
      completedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_quiz", ["userId", "quizId"]),

    // Calendar events — study blocks (auto-created from study plans), exam
    // dates, reminders and custom events.
    calendarEvents: defineTable({
      userId: v.id("users"),
      title: v.string(),
      subjectId: v.optional(v.id("subjects")),
      startAt: v.number(),
      endAt: v.optional(v.number()),
      type: v.union(
        v.literal("study_block"),
        v.literal("exam"),
        v.literal("reminder"),
        v.literal("custom"),
      ),
      sourceStudyPlanId: v.optional(v.id("studyPlans")),
    })
      .index("by_user_startAt", ["userId", "startAt"])
      .index("by_user", ["userId"]),

    // ------------------------------------------------------------------
    // Gamification + social layer
    // ------------------------------------------------------------------

    // Static achievement definitions, seeded once from achievements.ts.
    achievements: defineTable({
      id: v.string(), // stable key, e.g. "first_streak_7"
      name: v.string(),
      description: v.string(),
      icon: v.string(), // lucide-react icon name
      tier: v.union(v.literal("bronze"), v.literal("silver"), v.literal("gold")),
    }).index("by_achievement", ["id"]),

    // Earned achievements. checkAndAward is idempotent — a user can never
    // earn the same achievement twice.
    userAchievements: defineTable({
      userId: v.id("users"),
      achievementId: v.string(),
      earnedAt: v.number(),
    }).index("by_user", ["userId"]),

    // Append-only XP ledger. Sum this for total XP (auditable, rebalanceable
    // without a migration). XP is only ever written through internal.awardXp
    // from real study actions — never directly by a client call.
    xpLedger: defineTable({
      userId: v.id("users"),
      amount: v.number(),
      reason: v.string(), // quiz_complete | streak_day | focus_session | plan_week_complete | daily_challenge
      createdAt: v.number(),
    }).index("by_user_createdAt", ["userId", "createdAt"]),

    // Denormalized level row, kept in sync with xpLedger writes.
    userLevels: defineTable({
      userId: v.id("users"),
      totalXp: v.number(),
      currentLevel: v.number(),
    }).index("by_user", ["userId"]),

    // Opt-in study groups. Everything here is private: groups are only
    // reachable via a shared invite code, capped at GROUP_MAX_SIZE members.
    studyGroups: defineTable({
      name: v.string(),
      createdBy: v.id("users"),
      inviteCode: v.string(),
      subjectFocus: v.optional(v.id("subjects")),
      createdAt: v.number(),
    })
      .index("by_inviteCode", ["inviteCode"])
      .index("by_createdBy", ["createdBy"]),

    studyGroupMembers: defineTable({
      groupId: v.id("studyGroups"),
      userId: v.id("users"),
      joinedAt: v.number(),
      role: v.union(v.literal("owner"), v.literal("member")),
    })
      .index("by_group", ["groupId"])
      .index("by_user", ["userId"]),

    // In-app notifications (no push infra — visible when the app is open).
    notifications: defineTable({
      userId: v.id("users"),
      type: v.string(),
      title: v.string(),
      body: v.string(),
      readAt: v.optional(v.number()),
      createdAt: v.number(),
      actionUrl: v.optional(v.string()),
    }).index("by_user_createdAt", ["userId", "createdAt"]),

    // ------------------------------------------------------------------
    // Study rooms (video) + safety
    // ------------------------------------------------------------------

    // A video room always belongs to a study group — never a standalone open
    // space. status drives the join gate; videoProviderRoomId is the room
    // name the video provider (LiveKit Cloud) knows it by.
    studyRooms: defineTable({
      groupId: v.id("studyGroups"),
      name: v.string(),
      createdBy: v.id("users"),
      status: v.union(v.literal("active"), v.literal("ended")),
      videoProviderRoomId: v.string(),
      createdAt: v.number(),
      endedAt: v.optional(v.number()),
    })
      .index("by_group_status", ["groupId", "status"])
      .index("by_createdBy", ["createdBy"]),

    // Presence is derived, not a separate system: a row with leftAt null IS
    // currently in the room; leftAt set means they left.
    roomParticipants: defineTable({
      roomId: v.id("studyRooms"),
      userId: v.id("users"),
      joinedAt: v.number(),
      leftAt: v.optional(v.number()),
    })
      .index("by_room", ["roomId"])
      .index("by_user", ["userId"])
      .index("by_room_user", ["roomId", "userId"]),

    // Persistent group chat — the group's "home base" conversation, separate
    // from ephemeral room messages. Supports text, file attachments, and
    // async voice notes. Blocked users' messages are filtered server-side.
    groupChatMessages: defineTable({
      groupId: v.id("studyGroups"),
      userId: v.id("users"),
      content: v.optional(v.string()),
      attachmentStorageId: v.optional(v.string()),
      attachmentType: v.optional(v.union(v.literal("file"), v.literal("image"))),
      attachmentName: v.optional(v.string()),
      messageType: v.union(v.literal("text"), v.literal("file"), v.literal("voice_note")),
      voiceNoteDurationSeconds: v.optional(v.number()),
      createdAt: v.number(),
    })
      .index("by_group_createdAt", ["groupId", "createdAt"])
      .index("by_group", ["groupId"]),

    // Group chat inside a room. Persists after the room ends so the group
    // can review what was discussed. Convex reactivity handles delivery.
    roomMessages: defineTable({
      roomId: v.id("studyRooms"),
      userId: v.id("users"),
      content: v.string(),
      createdAt: v.number(),
    }).index("by_room_createdAt", ["roomId", "createdAt"]),

    // Collaborative workspace: library content or a note linked into a room
    // so everyone references the same document while talking.
    roomSharedItems: defineTable({
      roomId: v.id("studyRooms"),
      itemType: v.union(v.literal("content"), v.literal("note")),
      itemId: v.string(),
      sharedBy: v.id("users"),
      sharedAt: v.number(),
    }).index("by_room", ["roomId"]),

    // Student safety: reports. Fixed reason categories, admin triaged.
    userReports: defineTable({
      reporterId: v.id("users"),
      reportedUserId: v.id("users"),
      roomId: v.optional(v.id("studyRooms")), // context when reported in a room
      reason: v.union(
        v.literal("harassment"),
        v.literal("inappropriate_content"),
        v.literal("spam"),
        v.literal("other"),
      ),
      details: v.optional(v.string()),
      status: v.union(v.literal("open"), v.literal("reviewed"), v.literal("resolved")),
      createdAt: v.number(),
    })
      .index("by_status", ["status"])
      .index("by_reported", ["reportedUserId"])
      .index("by_reporter", ["reporterId"]),

    // A blocked user cannot join any room the blocker is in, cannot message
    // them, and is hidden from the blocker in shared group contexts.
    userBlocks: defineTable({
      blockerId: v.id("users"),
      blockedUserId: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_blocker", ["blockerId"])
      .index("by_blocked", ["blockedUserId"])
      .index("by_pair", ["blockerId", "blockedUserId"]),

    // Daily challenge cache — one question per (date, subject), generated
    // once and shared by every student, deterministic by Addis calendar day.
    dailyChallenges: defineTable({
      challengeDate: v.string(), // "YYYY-MM-DD" in Africa/Addis_Ababa
      subjectId: v.id("subjects"),
      questionJson: v.string(),
      createdAt: v.number(),
    }).index("by_date_subject", ["challengeDate", "subjectId"]),

    // Per-user daily challenge completions (one per subject per day).
    dailyChallengeAttempts: defineTable({
      userId: v.id("users"),
      challengeDate: v.string(),
      subjectId: v.id("subjects"),
      answeredCorrectly: v.boolean(),
      completedAt: v.number(),
    }).index("by_user", ["userId"]),

    // ------------------------------------------------------------------
    // Admin command center: observability + broadcasts
    // ------------------------------------------------------------------

    // Internal observability feed. Written from critical paths only (AI
    // provider calls, payments, auth events, rooms, content uploads) — never
    // instrumented per-request noise. metadata is a JSON string so the feed
    // stays schema-stable as call sites evolve.
    systemEvents: defineTable({
      eventType: v.union(
        v.literal("api_call"),
        v.literal("error"),
        v.literal("auth_event"),
        v.literal("payment_event"),
        v.literal("room_event"),
        v.literal("content_event"),
      ),
      source: v.string(), // module/function that logged it
      userId: v.optional(v.id("users")),
      metadata: v.optional(v.string()), // JSON string
      durationMs: v.optional(v.number()),
      status: v.union(v.literal("success"), v.literal("error")),
      createdAt: v.number(),
    })
      .index("by_createdAt", ["createdAt"])
      .index("by_type_createdAt", ["eventType", "createdAt"]),

    // Telegram broadcast channels (group/channel chat ids the admin can
    // message). Auto-post-on-upload is an explicit per-channel toggle that
    // defaults to OFF — never on by default.
    telegramChannels: defineTable({
      name: v.string(), // admin-facing label
      chatId: v.string(), // numeric channel/group id
      addedAt: v.number(),
    }).index("by_chatId", ["chatId"]),

    telegramAutoPosts: defineTable({
      channelId: v.id("telegramChannels"),
      enabled: v.boolean(),
      updatedAt: v.number(),
    }).index("by_channel", ["channelId"]),

    // History of what was broadcast and when (admin audit trail).
    broadcastLog: defineTable({
      message: v.string(),
      channels: v.array(v.string()), // channel names targeted
      sentAt: v.number(),
      sentBy: v.id("users"),
      status: v.union(v.literal("sent"), v.literal("failed")),
    }).index("by_sentAt", ["sentAt"]),

    // ------------------------------------------------------------------
    // Cinematic library: bookmarks + reader scratchpads
    // ------------------------------------------------------------------

    // Student reading list. One row per (user, content).
    bookmarks: defineTable({
      userId: v.id("users"),
      contentId: v.id("contentItems"),
      createdAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_content", ["userId", "contentId"]),

    // Per (user, content) scratchpad content, persisted so returning to a
    // book keeps the student's working notes.
    scratchpads: defineTable({
      userId: v.id("users"),
      contentId: v.id("contentItems"),
      content: v.string(),
      updatedAt: v.number(),
    }).index("by_user_content", ["userId", "contentId"]),

    // ------------------------------------------------------------------
    // Flashcards
    // ------------------------------------------------------------------

    flashcardDecks: defineTable({
      userId: v.id("users"),
      subjectId: v.id("subjects"),
      contentId: v.optional(v.id("contentItems")),
      sourceType: v.union(v.literal("content"), v.literal("conversation"), v.literal("topic")),
      title: v.string(),
      cardCount: v.number(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    flashcards: defineTable({
      deckId: v.id("flashcardDecks"),
      front: v.string(),
      back: v.string(),
      timesReviewed: v.number(),
      lastResult: v.optional(v.union(v.literal("got_it"), v.literal("review_again"))),
      nextReviewWeight: v.number(),
    }).index("by_deck", ["deckId"]),

    // ------------------------------------------------------------------
    // Study session recaps
    // ------------------------------------------------------------------

    recaps: defineTable({
      userId: v.id("users"),
      type: v.union(v.literal("focus_session"), v.literal("quiz"), v.literal("weekly")),
      text: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // ------------------------------------------------------------------
    // Admin key management
    // ------------------------------------------------------------------

    // Encrypted/stored API key values that admins manage through the UI.
    // Reads fall through to process.env first; values here override.
        configKeys: defineTable({
      key: v.string(),
      value: v.string(),
      updatedAt: v.number(),
      updatedBy: v.id("users"),
    }).index("by_key", ["key"]),
  },
);

export default schema;
