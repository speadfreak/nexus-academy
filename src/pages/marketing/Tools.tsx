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
  TrendingUp,
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
    description: "Every textbook, past exam, and worksheet — organized by subject, grade, and unit. Search, bookmark, and read in-app with the PDF reader.",
    href: "/library",
  },
  {
    icon: Brain,
    title: "AI Tutor",
    description: "Ask any question, get an answer in seconds. Grounded in the Ethiopian curriculum. 15 free messages/day, unlimited on premium.",
    href: "/tutor",
  },
  {
    icon: Layers,
    title: "Smart Flashcards",
    description: "Generate decks from any textbook page while you read. Smart Spaced Repetition schedules each card. Weakness Hunter finds what you forget. Exam Attack tests under pressure.",
    href: "/flashcards",
  },
  {
    icon: Target,
    title: "AI Study Commander",
    description: "Tell Learnyx your exam date and study time. It builds a week-by-week roadmap, tracks if you're on track, and reorganizes if you fall behind.",
    href: "/plans",
    premium: true,
  },
  {
    icon: CalendarDays,
    title: "Calendar — Student Command Center",
    description: "Today's Mission shows what to study and for how long. Exam countdown ticks to your next test. Study blocks from your AI plan land here automatically.",
    href: "/calendar",
  },
  {
    icon: BookOpen,
    title: "Notes — AI Knowledge Vault",
    description: "Write messy notes, tap Enhance, and the AI restructures them. Ask My Notes searches everything you've written. Turn any note into flashcards.",
    href: "/notes",
  },
  {
    icon: ClipboardList,
    title: "Mock Exams",
    description: "AI generates ~340 original questions across all 6 EHEEE subjects — 50 min per section, no pausing, auto-graded per subject.",
    href: "/mock-exam",
    premium: true,
  },
  {
    icon: Compass,
    title: "Aptitude Hub",
    description: "SAT-style reasoning practice with a brain-map showing mastery. Adaptive practice nodes + full aptitude mock + vocabulary deck.",
    href: "/aptitude",
    premium: true,
  },
  {
    icon: Users,
    title: "Study Groups",
    description: "Private rooms with a shared invite code — live video rooms, group chat, and a weekly leaderboard ranking real study effort.",
    href: "/groups",
  },
  {
    icon: Focus,
    title: "Focus Mode",
    description: "Distraction-free study sessions with built-in timer. Music player syncs to your focus state — deep ambient during work, calm during breaks.",
    href: "/focus",
  },
  {
    icon: TrendingUp,
    title: "Journey",
    description: "Real progress charts, quiz trends, and topic connections across your subjects. No vanity metrics — just where you actually are.",
    href: "/journey",
  },
];

export default function ToolsPage() {
  return (
    <MarketingLayout
      eyebrow="Tools"
      eyebrowIcon={Layers}
      eyebrowColor="emerald"
      title={<>An adaptive learning <span className="text-gradient">engine.</span></>}
      subtitle="Every piece feeds the next — read a textbook, generate flashcards, track your memory, attack your weaknesses, and let the AI plan your next move."
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
