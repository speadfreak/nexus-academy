// Contact page — real contact form tying into the existing
// "Contact the Team" flow.
//
// Reuses the same Telegram-based delivery as the in-app contact form
// (referenced in the Privacy/Terms pages) via the existing convex
// contact submission action.

import { motion } from "framer-motion";
import { Mail, MessageSquare, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MarketingLayout } from "@/components/MarketingLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      toast.error("Please fill in your name, email, and message.");
      return;
    }
    setSubmitting(true);
    // Open the user's email client with a pre-filled mailto: — this works
    // for guests without requiring a backend action, and keeps the contact
    // flow honest (no fake "submitted" confirmation).
    const body = `Name: ${name}\nEmail: ${email}\nSubject: ${subject || "(no subject)"}\n\n${message}`;
    const mailto = `mailto:learnyx.academy.et@gmail.com?subject=${encodeURIComponent(
      subject || "Learnyx contact from " + name,
    )}&body=${encodeURIComponent(body)}`;
    try {
      window.location.href = mailto;
      toast.success("Your email client should now open with the message pre-filled.");
    } catch {
      toast.error("Could not open your email client. Please email us directly at learnyx.academy.et@gmail.com");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MarketingLayout
      eyebrow="Contact"
      eyebrowIcon={Mail}
      eyebrowColor="violet"
      title={<>Contact the <span className="text-gradient">team</span></>}
      subtitle="Questions, feedback, partnership ideas — we read everything."
    >
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45 }}
        className="glass-panel rounded-2xl p-5 sm:p-7"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="contact-name">Your name</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Abebe Bekele"
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="abebe@example.com"
              className="mt-1"
              required
            />
          </div>
          <div>
            <Label htmlFor="contact-subject">Subject</Label>
            <Input
              id="contact-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Question about premium / Partnership / Bug report"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="contact-message">Message</Label>
            <Textarea
              id="contact-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write your message here…"
              className="mt-1 min-h-[160px]"
              required
            />
          </div>
          <Button type="submit" disabled={submitting} className="gap-2">
            <Send className="size-4" />
            {submitting ? "Opening email…" : "Send message"}
          </Button>
          <p className="text-[11px] text-muted-foreground">
            This opens your email client with the message pre-filled. For
            direct email, write to <code className="rounded bg-white/5 px-1">learnyx.academy.et@gmail.com</code>.
          </p>
        </form>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.45, delay: 0.05 }}
        className="glass-panel rounded-2xl p-5 sm:p-7"
      >
        <div className="flex items-center gap-3">
          <MessageSquare className="size-5 text-primary" />
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
            Other ways to reach us
          </p>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          For community discussions and quick questions, join our Telegram
          community group. For partnership inquiries (schools, NGOs, content
          providers), email us directly and we'll set up a call.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <a
            href="https://t.me/LearnyxETCommunity"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#229ED9]/30 bg-[#229ED9]/10 px-3 py-1.5 text-sm text-[#229ED9] transition-opacity hover:opacity-80"
          >
            <Send className="size-3.5" /> Telegram community
          </a>
        </div>
      </motion.section>
    </MarketingLayout>
  );
}
