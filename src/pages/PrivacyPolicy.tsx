// Privacy Policy — public, no auth required.
//
// Cinematic, professional, honest. Matches the app's dark/gold visual
// identity. Written for a platform serving Ethiopian students (including
// minors) — privacy-first, no device fingerprinting, no IP tracking,
// no invasive identification.

import { motion } from "framer-motion";
import { ArrowLeft, Shield, Sparkles } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";

const SECTIONS = [
  {
    title: "What we collect",
    body: [
      "When you create an account, we store your email address (used for sign-in and communication), an optional display name, an optional username handle, and an optional avatar image you upload. If you sign in with Google, we receive the email and name from your Google profile — we do not access or store your Google contacts, files, or any other Google data.",
      "If you choose 'Continue as Guest', we create an anonymous session with no email or personal identifier. Guest sessions can browse the library but cannot open resources, generate quizzes, or use premium features. Your guest activity (page views, bookmarks) is stored temporarily but is not linked to a personal identity.",
      "We store your study activity — focus sessions, quiz answers, XP, streaks, notes, flashcards, and study plan progress — because these features require persistence to work. This data is linked to your account and is never shared with other students or third parties.",
    ],
  },
  {
    title: "What we do NOT collect",
    body: [
      "We do not track your IP address, device fingerprint, browser fingerprint, or location. We do not use cookies for advertising. We do not run analytics services that profile your behavior across other websites. We do not sell, rent, or trade your data to anyone — ever.",
      "We do not store your payment card details. TeleBirr and M-Pesa payments are processed entirely by the carrier's own secure checkout — we only receive a confirmation reference number. Your PIN, card number, and financial credentials never touch our servers.",
      "We do not record audio, video, or screen activity. Study room video calls run on LiveKit Cloud and are never recorded — ending a room terminates all connections immediately.",
    ],
  },
  {
    title: "How we use your data",
    body: [
      "Your study data is used to power the features you see: your dashboard shows your streak, your tutor remembers your stream, your quiz scores trend on your journey page, your flashcards resurface what you're shaky on. The AI tutor uses your subject and grade to ground its answers in the right curriculum — never to profile or advertise to you.",
      "Your email is used to send you a one-time verification code when you sign in, and optionally to send you weekly progress digests if you link your Telegram account. We do not send marketing emails, promotional offers, or third-party newsletters.",
      "Payment submissions (transaction references + screenshots) are reviewed by our admin team to confirm your premium access. The screenshot is stored in encrypted cloud storage and is only visible to admins — never to other students.",
    ],
  },
  {
    title: "Data retention",
    body: [
      "Your account and all associated study data persist as long as your account is active. If you stop using the platform, your data remains until you request deletion. You can request account deletion at any time by contacting us through the Settings → Contact the Team form — we will permanently erase your account, study history, notes, flashcards, and all personal data within 7 days.",
      "Anonymous (guest) sessions are automatically cleaned up after 30 days of inactivity. Guest data is not recoverable once cleaned up.",
      "Payment screenshots are retained for 90 days after the submission is resolved (approved or rejected), then permanently deleted from cloud storage.",
    ],
  },
  {
    title: "Your rights",
    body: [
      "You have the right to access, export, correct, or delete your personal data at any time. You can export your notes and flashcard decks from within the app. You can correct your display name and stream in Settings. You can request full data export or deletion by contacting us.",
      "You can unlink your Telegram account at any time from Settings → Link Telegram. Unlinking stops all weekly digests immediately and removes your Telegram chat ID from our database.",
      "You can sign out and delete your account without any penalty — your free tier features (library browsing, focus timer, streaks) remain available as a guest.",
    ],
  },
  {
    title: "Children's privacy",
    body: [
      "Learnyx Academy ET serves Ethiopian students in grades 9-12, many of whom are under 18. We take this responsibility seriously. We do not collect more data than is necessary to provide the educational service. We do not use the platform to advertise to minors. We do not share student data with schools, parents, or third parties without explicit consent.",
      "If you are a parent or guardian and believe your child's data has been collected improperly, contact us immediately and we will investigate and take corrective action within 48 hours.",
    ],
  },
  {
    title: "Security",
    body: [
      "All data is stored in encrypted cloud databases (Convex) and encrypted object storage (Cloudflare R2). API keys and secrets are stored server-side and are never exposed to the browser. Authentication uses email OTP (one-time passwords) or Google OAuth — no passwords are stored on our servers.",
      "Study room video connections are encrypted end-to-end via LiveKit Cloud's managed WebRTC infrastructure. We never have access to the video stream content.",
      "While we follow industry best practices, no system is 100% secure. If you discover a vulnerability, please report it responsibly through the Contact the Team form and we will investigate immediately.",
    ],
  },
  {
    title: "Changes to this policy",
    body: [
      "We may update this privacy policy as we add new features. Any material changes will be announced in the app and via our Telegram channel. The 'Last updated' date below reflects the most recent revision. Continued use of the platform after changes constitutes acceptance of the updated policy.",
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-20 -right-20 size-96 rounded-full bg-sky-400/[0.04] blur-[120px]" />
        <div className="absolute -bottom-20 -left-20 size-96 rounded-full bg-amber-400/[0.04] blur-[120px]" />
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
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-400/20 bg-sky-400/[0.06] px-3 py-1">
            <Shield className="size-3.5 text-sky-300" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">
              Privacy Policy
            </span>
          </div>
          <h1 className="mt-5 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Your <span className="text-gradient">privacy</span> is not optional
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Learnyx Academy ET serves students — many of them under 18. We built
            this platform with privacy as a first principle, not an afterthought.
            This page explains exactly what we collect, what we don't, and the
            controls you have.
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
                <div className="flex size-8 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
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
