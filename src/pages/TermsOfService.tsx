// Terms of Service — public, no auth required.
//
// Cinematic, professional, honest. Matches the app's dark/gold visual
// identity. Written for a platform serving Ethiopian students (including
// minors) — fair, clear, no predatory clauses, no hidden terms.

import { motion } from "framer-motion";
import { ArrowLeft, FileText, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const SECTIONS = [
  {
    title: "What this platform is",
    body: [
      "Learnyx Academy ET is an educational platform built for Ethiopian students preparing for the Ethiopian Higher Education Entrance Examination (EHEEE/ESSLCE). It provides a content library, AI tutoring, mock exams, study plans, flashcards, and social study groups — all designed to help students prepare effectively for their national exams.",
      "The platform is developed and maintained by Joseph James, an 18-year-old Ethiopian developer based in Addis Ababa. It is not affiliated with the Ethiopian Ministry of Education or any government institution. All exam preparation content is independently created or curated.",
    ],
  },
  {
    title: "Using the platform",
    body: [
      "By creating an account, you agree to use the platform for its intended purpose: studying and preparing for your exams. You agree not to use the platform to harass other students, share inappropriate content in study groups, attempt to access other users' data, or interfere with the platform's infrastructure.",
      "You are responsible for keeping your sign-in credentials secure. If you use email OTP, your email is your identity — do not share access to it. If you suspect unauthorized access to your account, contact us immediately through Settings → Contact the Team.",
      "Study group features (video rooms, chat) are community spaces. Be respectful. Report any harassment or inappropriate behavior using the Report/Block menu on any participant's tile. Our team reviews all reports and takes action when needed.",
    ],
  },
  {
    title: "Content and intellectual property",
    body: [
      "The content library contains textbooks, past exams, worksheets, and guides. Some content is sourced from official Ethiopian Ministry of Education publications; other content is created by our team. All content is provided for your personal study use only — you may not redistribute, sell, or publish it.",
      "AI-generated content (tutor answers, quiz questions, mock exam questions, study plans, flashcards) is original to Learnyx Academy ET. Our AI models write fresh questions grounded in the Ethiopian curriculum — we do not extract or reproduce questions from real past papers.",
      "You retain ownership of your notes, flashcard decks, and any content you create on the platform. We store it to provide the service — we do not claim any rights to your intellectual work.",
    ],
  },
  {
    title: "Free tier and premium access",
    body: [
      "A free account gives you: library browsing, 15 AI tutor messages per day, 1 quiz per subject per week, todos, focus timer, streaks, study groups, and the daily challenge. No payment is required for these features — they are available to every student, forever. We believe a student who cannot pay should never lose all access to AI help.",
      "Premium access unlocks: unlimited tutor messages, unlimited quizzes, full mock exams, AI study plans, premium content (curated past exams and teacher guides), full journey analytics, AI flashcards, and the Aptitude Hub with adaptive practice and vocabulary decks. Premium is purchased via manual TeleBirr or M-Pesa payment — there is no automatic renewal and no subscription trap.",
      "Your free trial gives you full premium access for a configurable number of active study days (default 14, set by the admin). The trial counts days you actually open the app, not calendar days — so if you sign up and don't study for a week, that week doesn't count against your trial. The Aptitude Hub's practice and mock features are available to all signed-in users, including those in their free trial.",
    ],
  },
  {
    title: "Payments and refunds",
    body: [
      "Premium payments are made via personal transfer to a designated TeleBirr or M-Pesa account. After sending the payment, you submit a screenshot and transaction reference through the /upgrade page. Our admin team reviews it (typically within 24 hours) and activates your premium access.",
      "If your payment is auto-verified via SMS webhook, activation may be near-instant. If there's a delay beyond the SLA (default 24 hours), you receive bonus premium hours as goodwill compensation — we don't make you wait for free.",
      "If your payment is rejected (e.g., the transaction reference doesn't match a real transfer), no charge is applied and your account is unaffected. If you experience an issue with your premium access after activation, contact us through the Settings → Contact the Team form and we will work with you to resolve it — whether that means fixing a technical issue, extending your access, or arranging a refund where appropriate. We handle each case individually and fairly.",
    ],
  },
  {
    title: "AI features and accuracy",
    body: [
      "The platform uses artificial intelligence to generate study content — including tutor answers, quiz questions, mock exam questions, study plans, and flashcards. Our AI systems are carefully prompted and grounded in the Ethiopian national curriculum, but AI can make mistakes. Always cross-reference AI-generated answers with your textbooks and your teacher's guidance.",
      "We do not guarantee that AI-generated content is 100% correct or complete. The platform is a study aid, not a substitute for your teacher, your textbook, or your own judgment. If you find an error in AI-generated content, please report it through the Contact the Team form so we can investigate and improve.",
      "The specific AI technologies and providers we use may change over time as we improve the platform. We select providers based on accuracy, cost-efficiency, and data privacy standards. Your conversations with the AI tutor and any content you generate are stored on our servers to provide the service — they are not shared with third parties for training or advertising.",
    ],
  },
  {
    title: "Acceptable use in study groups",
    body: [
      "Study groups are private (invite-code only, capped at 20 members). Video rooms are live and never recorded. Group chat messages are visible to group members only — not to the public, not to other groups.",
      "You must not use study groups to: share exam answers during a real exam, distribute copyrighted material, harass or bully other members, or engage in any activity that violates Ethiopian law. Violations result in immediate removal from the group and may result in account suspension.",
      "The Report and Block feature is available on every participant's tile in video rooms and in the member roster. Reports are reviewed by admins and action is taken when warranted — we never auto-ban without human review.",
    ],
  },
  {
    title: "Limitation of liability",
    body: [
      "Learnyx Academy ET is provided 'as is.' We do not guarantee that the platform will be available 100% of the time, that all content is error-free, or that AI answers will always be correct. We are not liable for academic outcomes — your exam results depend on your own effort and preparation.",
      "We are not liable for any indirect or consequential damages arising from the use of the platform. Our maximum liability is limited to the amount you have paid for premium access in the 30 days preceding any claim.",
    ],
  },
  {
    title: "Changes to these terms",
    body: [
      "We may update these terms as the platform evolves. Material changes will be announced in the app and via our Telegram channel. The 'Last updated' date below reflects the most recent revision. Continued use of the platform after changes constitutes acceptance of the updated terms.",
    ],
  },
];

export default function TermsOfService() {
  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 size-96 rounded-full bg-amber-400/[0.04] blur-[120px]" />
        <div className="absolute -bottom-20 -left-20 size-96 rounded-full bg-primary/[0.04] blur-[120px]" />
      </div>

      <div className="relative mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        {/* Back link */}
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" /> Back to home
        </Link>

        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="mt-8"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1">
            <FileText className="size-3.5 text-amber-300" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              Terms of Service
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Fair terms, <span className="text-gradient">simply stated</span>
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            No hidden clauses, no predatory auto-renewals, no lock-in traps.
            These terms describe how Learnyx Academy ET works, what you agree to
            when you use it, and what we commit to in return. Written in plain
            language — because you deserve to understand what you're signing.
          </p>
        </motion.div>

        {/* Sections */}
        <div className="mt-10 flex flex-col gap-6">
          {SECTIONS.map((section, idx) => (
            <motion.section
              key={section.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.45, delay: idx * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="glass-panel rounded-2xl p-5 sm:p-7"
            >
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                  <span className="font-mono text-xs font-bold">{String(idx + 1).padStart(2, "0")}</span>
                </div>
                <h2 className="text-lg font-extrabold tracking-tight">{section.title}</h2>
              </div>
              <div className="mt-4 flex flex-col gap-3">
                {section.body.map((para, i) => (
                  <p key={i} className="text-sm leading-relaxed text-muted-foreground">
                    {para}
                  </p>
                ))}
              </div>
            </motion.section>
          ))}
        </div>

        {/* Last updated */}
        <div className="mt-10 flex items-center justify-center gap-2 text-xs text-muted-foreground/60">
          <Sparkles className="size-3" />
          Last updated: {new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          {" · "}
          Learnyx Academy ET 🇪🇹
        </div>

        {/* CTA */}
        <div className="mt-8 flex justify-center">
          <Button asChild variant="outline" className="rounded-xl bg-white/5">
            <Link to="/">
              <ArrowLeft className="size-4" /> Back to Learnyx Academy ET 🇪🇹
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
