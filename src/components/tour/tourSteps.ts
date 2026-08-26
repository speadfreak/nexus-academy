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
    description: "Browse textbooks, past papers, and study guides filtered by subject and grade.",
    icon: "📚",
  },
  {
    step: 2,
    route: "/tutor",
    title: "AI Tutor",
    description: "Ask questions about your subjects. The tutor knows your stream and grade level.",
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
    description: "Build study streaks with the Pomodoro timer. Consistency beats intensity.",
    icon: "⏱️",
  },
  {
    step: 5,
    route: "/plans",
    title: "Study Plans",
    description: "Generate AI-powered weekly study plans tailored to your subjects.",
    icon: "📋",
  },
  {
    step: 6,
    route: "/journey",
    title: "Your Journey",
    description: "Track your progress across subjects with stats and streaks.",
    icon: "🚀",
  },
  {
    step: 7,
    route: "/calendar",
    title: "Calendar",
    description: "See your auto-scheduled study blocks and exam dates in one place.",
    icon: "📅",
  },
  {
    step: 8,
    route: "/notes",
    title: "Quick Notes",
    description: "Jot down key concepts and tag them by difficulty for later review.",
    icon: "📝",
  },
  {
    step: 9,
    route: "/flashcards",
    title: "Flashcards",
    description: "Create decks and flip through cards to lock in definitions and formulas.",
    icon: "🃏",
  },
  {
    step: 10,
    route: "/achievements",
    title: "Achievements",
    description: "Earn XP, level up, and collect badges as you study.",
    icon: "🏆",
  },
  {
    step: 11,
    route: "/groups",
    title: "Study Groups",
    description: "Create or join groups, chat with classmates, and study together.",
    icon: "👥",
  },
  {
    step: 12,
    route: "/settings",
    title: "Settings",
    description: "Customize your profile, theme, and subscription. You can replay this tour anytime from here.",
    icon: "⚙️",
  },
];

export const TOTAL_STEPS = TOUR_STEPS.length;
