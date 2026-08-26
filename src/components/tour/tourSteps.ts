export interface TourStep {
  step: number;
  route: string;
  targetSelector: string;
  title: string;
  description: string;
  spotlightPadding?: number;
}

export const TOUR_STEPS: TourStep[] = [
  {
    step: 1,
    route: "/dashboard",
    targetSelector: "[data-page=dashboard]",
    title: "Your Library",
    description: "Browse textbooks, past papers, and study guides filtered by subject and grade.",
    spotlightPadding: 8,
  },
  {
    step: 2,
    route: "/tutor",
    targetSelector: "[data-page=tutor]",
    title: "AI Tutor",
    description: "Ask questions about your subjects. The tutor knows your stream and grade level.",
    spotlightPadding: 8,
  },
  {
    step: 3,
    route: "/todos",
    targetSelector: "[data-page=todos]",
    title: "Study Todos",
    description: "Track tasks and stay on top of your study schedule with quick-add.",
    spotlightPadding: 8,
  },
  {
    step: 4,
    route: "/focus",
    targetSelector: "[data-page=focus]",
    title: "Focus Timer",
    description: "Build study streaks with the Pomodoro timer. Consistency beats intensity.",
    spotlightPadding: 8,
  },
  {
    step: 5,
    route: "/plans",
    targetSelector: "[data-page=plans]",
    title: "Study Plans",
    description: "Generate AI-powered weekly study plans tailored to your subjects.",
    spotlightPadding: 8,
  },
  {
    step: 6,
    route: "/journey",
    title: "Your Journey",
    description: "Track your progress across subjects with stats and streaks.",
    targetSelector: "[data-page=journey]",
    spotlightPadding: 8,
  },
  {
    step: 7,
    route: "/calendar",
    targetSelector: "[data-page=calendar]",
    title: "Calendar",
    description: "See your auto-scheduled study blocks and exam dates in one place.",
    spotlightPadding: 8,
  },
  {
    step: 8,
    route: "/notes",
    targetSelector: "[data-page=notes]",
    title: "Quick Notes",
    description: "Jot down key concepts and tag them by difficulty for later review.",
    spotlightPadding: 8,
  },
  {
    step: 9,
    route: "/flashcards",
    targetSelector: "[data-page=flashcards]",
    title: "Flashcards",
    description: "Create decks and flip through cards to lock in definitions and formulas.",
    spotlightPadding: 8,
  },
  {
    step: 10,
    route: "/achievements",
    targetSelector: "[data-page=achievements]",
    title: "Achievements",
    description: "Earn XP, level up, and collect badges as you study.",
    spotlightPadding: 8,
  },
  {
    step: 11,
    route: "/groups",
    targetSelector: "[data-page=groups]",
    title: "Study Groups",
    description: "Create or join groups, chat with classmates, and study together.",
    spotlightPadding: 8,
  },
  {
    step: 12,
    route: "/settings",
    targetSelector: "[data-page=settings]",
    title: "Settings",
    description: "Customize your profile, theme, and subscription. You can replay this tour anytime from here.",
    spotlightPadding: 8,
  },
];

export const TOTAL_STEPS = TOUR_STEPS.length;
