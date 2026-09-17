export interface TourStep {
  step: number;
  route: string;
  title: string;
  description: string;
  /** Optional emoji/icon rendered in the step card */
  icon?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    step: 1,
    route: "/dashboard",
    title: "Your Library",
    description:
      "Browse textbooks, past exams, worksheets and guides. Filtered by your grade automatically — and every count you see is real, straight from the database.",
    icon: "📚",
  },
  {
    step: 2,
    route: "/tutor",
    title: "AI Tutor",
    description:
      "Ask questions about your subjects. The tutor knows your stream and grade level, and answers with explanations grounded in the Ethiopian curriculum.",
    icon: "🤖",
  },
  {
    step: 3,
    route: "/todos",
    title: "Study Todos",
    description: "Track tasks and stay on top of your study schedule with quick-add.",
    icon: "✅",
  },
  {
    step: 4,
    route: "/focus",
    title: "Focus Timer",
    description:
      "Build study streaks with the Pomodoro timer + built-in study vibe music. Consistency beats intensity.",
    icon: "⏱️",
  },
  {
    step: 5,
    route: "/plans",
    title: "AI Study Commander",
    description:
      "AI-powered weekly study plans with exam countdown, on-track scoring, and rescue mode when you fall behind.",
    icon: "📋",
  },
  {
    step: 6,
    route: "/calendar",
    title: "Student Command Center",
    description:
      "Today's mission, exam countdowns, weekly stats, and your daily study load — all auto-scheduled from your plans.",
    icon: "📅",
  },
  {
    step: 7,
    route: "/notes",
    title: "Notes + OCR",
    description:
      "Jot down key concepts, enhance them with AI, search your notes, or snap a photo of handwritten notes to digitize them instantly.",
    icon: "📝",
  },
  {
    step: 8,
    route: "/flashcards",
    title: "Flashcards",
    description:
      "Smart Spaced Repetition, Weakness Hunter, Exam Attack Mode, textbook→flashcards, and a 'Why?' AI explanation engine. The real deal.",
    icon: "🃏",
  },
  {
    step: 9,
    route: "/exam-prep",
    title: "Digital Past Exams",
    description:
      "Every past paper is already a real digital exam before you open it — navigator, flags, highlights, instant scoring in Practice and a strict clock in Exam mode. Read-aloud is there when you want it: just tap the speaker or press R.",
    icon: "🎓",
  },
  {
    step: 10,
    route: "/study-cards",
    title: "Study Cards",
    description:
      "Bite-sized quick-reference cards for concept lookup — like a well-organized cheat sheet per topic. Browse, save, and shuffle for review.",
    icon: "📄",
  },
  {
    step: 11,
    route: "/aptitude-hub",
    title: "Aptitude Hub",
    description:
      "SAT-style reasoning practice with a brain-map showing mastery per skill. Warm up daily, drill full mocks, track your readiness.",
    icon: "🧠",
  },
  {
    step: 12,
    route: "/journey",
    title: "Your Journey",
    description: "Track your progress across subjects with stats and streaks.",
    icon: "🚀",
  },
  {
    step: 13,
    route: "/achievements",
    title: "Achievements",
    description: "Earn XP, level up, and collect badges as you study.",
    icon: "🏆",
  },
  {
    step: 14,
    route: "/groups",
    title: "Squads",
    description:
      "Private academic squads with shared challenges, AI squad tutor, quiz battles, and a shared weakness radar that connects everyone's study.",
    icon: "👥",
  },
  {
    step: 15,
    route: "/mock-exam",
    title: "Mock Exams",
    description:
      "Take a full AI-generated mock exam — 6 sections, ~340 original questions, real timing. Auto-graded per subject.",
    icon: "🎓",
  },
  {
    step: 16,
    route: "/settings",
    title: "Settings",
    description:
      "Customize your profile, theme, grade level, language, and subscription. You can replay this tour anytime from here.",
    icon: "⚙️",
  },
];

export const TOTAL_STEPS = TOUR_STEPS.length;
