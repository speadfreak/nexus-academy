// FAQ page — real, honest answers to genuine questions.
//
// Reuses language consistent with the existing Terms/Privacy pages.
// Each Q&A is a real, substantial answer — not a stub.

import { motion } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { MarketingLayout } from "@/components/MarketingLayout";

const FAQS = [
  {
    q: "Is Learnyx really free?",
    a: "Yes — there's a free forever tier. You get 15 AI tutor messages per day, weekly quizzes, the full library (textbooks, past exams, worksheets), flashcards, and access to study groups. The premium tier adds unlimited AI, full-length mock exams, the Aptitude Hub, and longer AI tutor responses. You can use the free tier as long as you want — it's not a trial.",
  },
  {
    q: "How does payment work?",
    a: "Premium subscriptions are manual — you pay via TeleBirr or M-Pesa to a phone number we show on the /upgrade page, then upload your payment proof. An admin reviews it (usually within 24 hours) and your premium access is activated. No card required, no auto-renewal — you only pay for the period you choose (1, 3, 6, or 12 months).",
  },
  {
    q: "Is my data safe?",
    a: "We store your account (email, display name, study progress) on Convex — a serverless database built by ex-Firebase engineers. Files (PDFs) are stored on Cloudflare R2. We never sell your data, never run third-party tracking on the study pages, and never share your reading history with anyone. Read the full Privacy Policy for what we collect and why.",
  },
  {
    q: "What if the AI tutor gives a wrong answer?",
    a: "The AI can make mistakes — it's a tool, not an oracle. Always cross-check important answers against your textbook or ask your teacher. We use the best available models (Groq + Gemini) and tune prompts for accuracy, but no AI is 100% correct. If you notice a wrong answer, you can report it via the Help menu and we'll look into the underlying prompt.",
  },
  {
    q: "What if I'm not happy with premium?",
    a: "If you report an issue within 7 days of premium activation and we can't resolve it, we'll extend your access as goodwill. We don't auto-refund (since payments are manual and reviewed case-by-case), but we treat unfair situations seriously. Reach out via the Contact page.",
  },
  {
    q: "Which grades and subjects do you cover?",
    a: "Grades 9–12, both Natural Science and Social Science streams. Subjects include English, Mathematics, Amharic, IT, Citizenship, SAT, Physics, Chemistry, Biology, Agriculture, History, Geography, and Economics. Every subject has the full textbook library, past exams, and worksheets. AI tutor, quizzes, and flashcards work for every subject.",
  },
  {
    q: "Is the platform available in Amharic / Afaan Oromoo / Tigrigna?",
    a: "We're rolling out multi-language support. English is fully available now. Amharic translations are in review. Afaan Oromoo and Tigrigna are preview translations — usable, but we recommend native-speaker review before relying on them for exams. Use the language switcher in the top nav (when enabled by the admin) to switch.",
  },
  {
    q: "Can I use Learnyx offline?",
    a: "PDFs in the library are streamed from Cloudflare R2 — they need an internet connection to load the first time. Once a PDF is open in the reader, you can keep reading without a connection as long as you don't reload. AI features (tutor, mock exams, quizzes) require a live connection.",
  },
];

export default function FaqPage() {
  return (
    <MarketingLayout
      eyebrow="FAQ"
      eyebrowIcon={HelpCircle}
      eyebrowColor="sky"
      title={<>Frequently asked <span className="text-gradient">questions</span></>}
      subtitle="Real answers to the questions students actually ask."
    >
      <div className="flex flex-col gap-3">
        {FAQS.map((item, idx) => (
          <motion.details
            key={item.q}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.4, delay: idx * 0.03 }}
            className="glass-panel rounded-xl p-4 sm:p-5"
          >
            <summary className="cursor-pointer text-base font-semibold transition-colors hover:text-amber-300">
              {item.q}
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {item.a}
            </p>
          </motion.details>
        ))}
      </div>
    </MarketingLayout>
  );
}
