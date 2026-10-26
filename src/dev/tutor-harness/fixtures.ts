// TUTOR MOBILE HARNESS — fixtures for the stubbed Convex queries.
//
// Shapes mirror what the real backend returns (as consumed by Tutor.tsx,
// DashboardShell and AppBootstrap). The assistant fixture is deliberately
// nasty: display math, a GFM table, inline math, a >32-char unbreakable
// token and a blockquote — everything that could overflow a 320px screen.

export const FIXTURES: Record<string, unknown> = {
  "subjects.getAll": [
    { _id: "sub-math", name: "Mathematics", slug: "mathematics", stream: "natural" },
    { _id: "sub-physics", name: "Physics", slug: "physics", stream: "natural" },
    { _id: "sub-chem", name: "Chemistry", slug: "chemistry", stream: "natural" },
    { _id: "sub-bio", name: "Biology", slug: "biology", stream: "natural" },
    { _id: "sub-eng", name: "English", slug: "english", stream: "common" },
    { _id: "sub-hist", name: "History", slug: "history", stream: "social" },
    { _id: "sub-geo", name: "Geography", slug: "geography", stream: "social" },
    { _id: "sub-econ", name: "Economics", slug: "economics", stream: "social" },
  ],

  "ai.listConversations": [
    { _id: "conv-1", title: "Chain rule — worked examples", subjectName: "Mathematics", subjectId: "sub-math", updatedAt: Date.now() - 40 * 60 * 1000 },
    { _id: "conv-2", title: "Projectile motion revision", subjectName: "Physics", subjectId: "sub-physics", updatedAt: Date.now() - 26 * 3600 * 1000 },
    { _id: "conv-3", title: "Mole concept drills", subjectName: "Chemistry", subjectId: "sub-chem", updatedAt: Date.now() - 3 * 24 * 3600 * 1000 },
    { _id: "conv-4", title: "Ethiopian history — Adwa", subjectName: "History", subjectId: "sub-hist", updatedAt: Date.now() - 9 * 24 * 3600 * 1000, contentId: "content-tb-1" },
    { _id: "conv-5", title: "English: report writing", subjectName: "English", subjectId: "sub-eng", updatedAt: Date.now() - 21 * 24 * 3600 * 1000 },
  ],

  "ai.getMessages": [
    { _id: "msg-1", role: "user", content: "Explain the chain rule with a worked example please.", createdAt: Date.now() - 60 * 60 * 1000 },
    {
      _id: "msg-2",
      role: "assistant",
      createdAt: Date.now() - 59 * 60 * 1000,
      content: [
        "## Differentiating composite functions",
        "",
        "The chain rule states that if $y = f(g(x))$, then:",
        "",
        "$$\\frac{dy}{dx} = f'(g(x)) \\cdot g'(x)$$",
        "",
        "**Worked example.** Differentiate $h(x) = \\sin(3x^2 + 1)$:",
        "",
        "| Step | Operation | Result |",
        "| --- | --- | --- |",
        "| 1 | Derivative of the outer function | $\\cos(3x^2+1)$ |",
        "| 2 | Derivative of the inner function | $6x$ |",
        "| 3 | Multiply the two results | $6x\\cos(3x^2+1)$ |",
        "",
        "So $h'(x) = 6x\\cos(3x^2 + 1)$, and for a verylongunbreakableidentifierWithNoSpacesWeCheckOverflowCarefully the layout must stay inside the viewport.",
        "",
        "> Exam trap: forgetting to multiply by the inner derivative is the #1 mark-loser on Paper 1.",
      ].join("\n"),
    },
    { _id: "msg-3", role: "user", content: "Give me one more, harder.", createdAt: Date.now() - 58 * 60 * 1000 },
    {
      _id: "msg-4",
      role: "assistant",
      createdAt: Date.now() - 57 * 60 * 1000,
      content:
        "Try $h(x) = e^{\\sin x} \\cdot \\ln(x^2 + 1)$ — apply the product rule first, then the chain rule inside each factor. The derivative is:\n\n$$h'(x) = e^{\\sin x}\\cos x\\,\\ln(x^2+1) + e^{\\sin x}\\,\\frac{2x}{x^2+1}$$",
    },
  ],

  "ai.searchMessages": [],

  "subscriptions.getEntitlements": {
    premiumAccess: false,
    tutorRemainingToday: 7,
    tutorDailyLimit: 10,
  },

  "subscriptions.getSubscriptionStatus": {
    status: "active",
    trialDaysRemaining: 0,
    needsUpgrade: false,
  },

  "profile.getProfile": {
    displayName: "Abel Tesfaye",
    gradeLevel: 12,
    stream: "natural",
  },

  "studySessions.getStreak": { currentStreak: 6 },

  "xp.getMyLevel": { currentLevel: 9 },

  "examPrep.getMyExamPrepResults": [
    { subjectName: "Mathematics", scorePct: 58, status: "completed", date: Date.now() - 5 * 24 * 3600 * 1000, kind: "quiz" },
    { subjectName: "Physics", scorePct: 72, status: "completed", date: Date.now() - 4 * 24 * 3600 * 1000, kind: "quiz" },
    { subjectName: "Biology", scorePct: 81, status: "completed", date: Date.now() - 2 * 24 * 3600 * 1000, kind: "quiz" },
  ],

  "mockExam.getMyMockExams": [
    { status: "completed", totalScore: 64, completedAt: Date.now() - 8 * 24 * 3600 * 1000 },
  ],

  "admin.isCurrentUserAdmin": { isAdmin: false },

  "tour.getTourStatus": { completed: true, dismissed: true, currentStep: 0 },

  "content.getContentItemMeta": { title: "Mathematics Student Textbook — Grade 12" },

  "content.getContent": [
    { _id: "content-tb-1", title: "Mathematics Student Textbook — Grade 12", contentType: "textbook", grade: 12 },
    { _id: "content-tb-2", title: "Mathematics Past Exam Papers 2015-2024 E.C.", contentType: "past_exam", grade: 12 },
    { _id: "content-tb-3", title: "Physics Student Textbook — Grade 12", contentType: "textbook", grade: 12 },
  ],
};
