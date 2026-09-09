// Tools page — directory of every platform capability.
//
// Each tool links to its real feature page inside the app — good for
// internal navigation and honest self-description.

import { motion } from "framer-motion";
import {
  BookOpen,
  Brain,
  CalendarDays,
  ClipboardList,
  Compass,
  Focus,
  Layers,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router";
import { MarketingLayout } from "@/components/MarketingLayout";

interface Tool {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  premium?: boolean;
}

const TOOLS: Tool[] = [
  {
    icon: BookOpen,
    title: "Textbook Library",
    description: "Every textbook, past exam, and worksheet — organized by subject, grade, and unit.",
    href: "/library",
  },
  {
    icon: Brain,
    title: "AI Tutor",
    description: "Ask any question, get an answer in seconds. 15 free messages/day, unlimited on premium.",
    href: "/tutor",
  },
  {
    icon: ClipboardList,
    title: "Mock Exams",
    description: "Full-length practice exams with real timing, instant scoring, and explanations.",
    href: "/mock-exam",
    premium: true,
  },
  {
    icon: Layers,
    title: "Flashcards",
    description: "Spaced-repetition decks that adapt to what you know.",
    href: "/flashcards",
  },
  {
    icon: Compass,
    title: "Aptitude Hub",
    description: "SAT-style reasoning practice with a brain-map showing mastery.",
    href: "/aptitude",
    premium: true,
  },
  {
    icon: Users,
    title: "Study Groups",
    description: "Private rooms for your class — chat, share notes, live video.",
    href: "/groups",
  },
  {
    icon: CalendarDays,
    title: "Calendar",
    description: "Plan study sessions, see your streaks, and track exam dates.",
    href: "/calendar",
  },
  {
    icon: Focus,
    title: "Focus Mode",
    description: "Distraction-free study sessions with built-in timer.",
    href: "/focus",
  },
  {
    icon: Target,
    title: "Journey",
    description: "Your study timeline — every session, quiz, and milestone.",
    href: "/journey",
  },
];

export default function ToolsPage() {
  return (
    <MarketingLayout
      eyebrow="Tools"
      eyebrowIcon={Layers}
      eyebrowColor="emerald"
      title={<>Every tool you need, <span className="text-gradient">in one place.</span></>}
      subtitle="Browse the full Learnyx toolkit. Each feature links to its real page inside the app."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {TOOLS.map((tool, idx) => (
          <motion.div
            key={tool.title}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.35, delay: idx * 0.04 }}
          >
            <Link
              to={tool.href}
              className="group flex h-full flex-col gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-primary/30 hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <tool.icon className="size-5 text-primary" />
                <p className="text-sm font-bold">{tool.title}</p>
                {tool.premium && (
                  <span className="ml-auto rounded-full bg-amber-400/10 px-1.5 py-0 text-[10px] font-bold text-amber-300">
                    PREMIUM
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {tool.description}
              </p>
            </Link>
          </motion.div>
        ))}
      </div>
    </MarketingLayout>
  );
}
