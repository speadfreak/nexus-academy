import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  FileText,
  MessageSquarePlus,
  Sparkles,
  Layers,
  Atom,
  BookOpen,
  Globe,
  Calculator,
  Beaker,
  BrainCircuit,
  GraduationCap,
  MessageCircle,
  Mic,
  MicOff,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clockTime, relativeTime } from "@/lib/dates";
import { errorCode, errorMessage } from "@/lib/errors";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { cn } from "@/lib/utils";

type MessageDoc = {
  _id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

const STARTERS: Record<string, string[]> = {
  natural: [
    "Explain Newton's Third Law with an example from everyday life.",
    "Walk me through balancing a chemical equation step by step.",
    "What's the difference between mitosis and meiosis?",
  ],
  social: [
    "Summarise the causes of the 1974 Ethiopian revolution.",
    "Explain the difference between demand and quantity demanded.",
    "Describe Ethiopia's major climate regions in simple terms.",
  ],
  common: [
    "Walk me through solving a quadratic equation step by step.",
    "Explain when to use 'which' vs 'that', with examples.",
    "Give me a practice reasoning question like the SAT exam.",
  ],
};

const GENERAL_STARTERS = [
  "Give me a 3-day revision plan for my stream's exams.",
  "How should I approach a past national exam paper?",
  "Quiz me on anything I've studied — keep it exam-style.",
];

// Subject icon map — gives each conversation a distinctive visual anchor
const SUBJECT_ICONS: Record<string, React.ElementType> = {
  Physics: Atom,
  Chemistry: Beaker,
  Biology: BrainCircuit,
  Mathematics: Calculator,
  English: BookOpen,
  "English Language": BookOpen,
  History: Globe,
  Geography: Globe,
  Economics: GraduationCap,
  Civics: GraduationCap,
  "Civic and Ethical Education": GraduationCap,
  SAT: BrainCircuit,
  General: MessageCircle,
};

function getSubjectIcon(name: string | null): React.ElementType {
  if (!name) return MessageCircle;
  // Try exact match first
  if (SUBJECT_ICONS[name]) return SUBJECT_ICONS[name];
  // Fuzzy: check if any key is a substring of the subject name
  for (const [key, icon] of Object.entries(SUBJECT_ICONS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return icon;
  }
  return MessageCircle;
}

// Animated thinking characters that cycle through
const THINKING_CHARS = ["∼", "≈", "Δ", "∫", "λ", "π", "∑", "√", "∞", "θ"];

function ThinkingIndicator() {
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCharIndex((prev) => (prev + 1) % THINKING_CHARS.length);
    }, 180);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-start gap-1.5"
    >
      <div className="glass-soft relative overflow-hidden rounded-2xl rounded-bl-md px-5 py-4 min-w-[180px]">
        <div className="scan-line" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-400/10">
            <Bot className="size-3.5 text-amber-300" />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="type-mono text-muted-foreground/60 text-[10px] uppercase tracking-widest">
              processing
            </span>
            <div className="flex items-center gap-1.5">
              <motion.span
                key={charIndex}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="type-mono text-amber-300 text-sm"
              >
                {THINKING_CHARS[charIndex]}
              </motion.span>
              <span className="type-mono text-muted-foreground text-xs">
                AI is thinking…
              </span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Bubble({ message, index }: { message: MessageDoc; index: number }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: 0.03 * Math.min(index, 8),
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn(
        "flex flex-col gap-1.5",
        isUser ? "items-end" : "items-start"
      )}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 type-body leading-6 transition-colors duration-200",
          isUser
            ? "rounded-br-md border border-primary/25 bg-primary/10 text-foreground"
            : "glass-soft rounded-bl-md text-foreground"
        )}
      >
        {message.content}
      </div>
      <span className="px-1 type-caption text-muted-foreground/60">
        {isUser ? "you" : "AI Tutor"} · {clockTime(message.createdAt)}
      </span>
    </motion.div>
  );
}

export default function Tutor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const subjects = useQuery(api.subjects.getAll);
  const conversations = useQuery(api.ai.listConversations);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  // Mock exam history — used to show a "latest mock exam" callout in the
  // empty state + a "review weaknesses" starter chip. The AI tutor's system
  // prompt is also injected with this summary server-side (see ai.ts
  // buildSystemPrompt), so the tutor's replies will reference the student's
  // latest score + weakest subject without any client-side context being
  // sent in the message.
  const mockExamHistory = useQuery(api.mockExam.getMyMockExams, {});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capPromptOpen, setCapPromptOpen] = useState(false);
  const [scopeSubjectId, setScopeSubjectId] = useState("");
  const [contentId, setContentId] = useState<string | null>(
    searchParams.get("contentId"),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState<{ content: string } | null>(null);
  const [isAwaiting, setIsAwaiting] = useState(false);

  // Voice input — browser-native Web Speech API (no backend cost, no
  // audio uploads, no privacy concerns). Transcribed text populates the
  // input field but is NEVER auto-sent — the student reviews + edits +
  // presses send themselves.
  const speech = useSpeechRecognition({ lang: "en-US", continuous: false });
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync the speech transcript into the input field. We APPEND (with a
  // space separator) rather than replace so the student can speak
  // multiple phrases + edit between them. Clear the transcript once
  // merged so we don't double-merge on the next render.
  useEffect(() => {
    if (speech.transcript) {
      setInput((prev) => (prev ? prev + " " : "") + speech.transcript);
      speech.reset();
      // Refocus the input so the student can immediately edit + send.
      inputRef.current?.focus();
    }
  }, [speech.transcript, speech.reset]);

  // Toast on speech errors (e.g. mic permission denied).
  useEffect(() => {
    if (!speech.error) return;
    if (speech.error === "not-allowed" || speech.error === "service-not-allowed") {
      toast.error("Microphone access denied. Enable it in your browser settings to use voice input.");
    } else if (speech.error === "no-speech") {
      // Silent — the user just didn't say anything audible.
    } else {
      toast.error(`Voice input error: ${speech.error}`);
    }
  }, [speech.error]);

  // Follow-up suggestions + mini-check state
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [miniCheck, setMiniCheck] = useState<{
    question: string; options: string[]; correctIndex: number; explanation: string;
  } | null>(null);
  const [miniCheckAnswer, setMiniCheckAnswer] = useState<number | null>(null);
  const [fetchingFollowUps, setFetchingFollowUps] = useState(false);

  const contentMeta = useQuery(
    api.content.getContentItemMeta,
    contentId ? { contentId: contentId as never } : "skip",
  );

  const sendMessage = useAction(api.ai.sendMessage);
  const generateFollowUps = useAction(api.ai.generateFollowUps);
  const messages = useQuery(
    api.ai.getMessages,
    selectedId ? { conversationId: selectedId as never } : "skip",
  );

  useEffect(() => {
    if (!subjects) return;
    const slug = searchParams.get("subject");
    if (!slug) return;
    const match = subjects.find(
      (s: { slug: string; _id: string }) => s.slug === slug,
    );
    if (match) setScopeSubjectId(match._id as string);
  }, [subjects, searchParams]);

  const scopeSubject = useMemo(
    () =>
      subjects?.find((s: { _id: string }) => s._id === (scopeSubjectId as never)),
    [subjects, scopeSubjectId],
  );

  const starters = useMemo(() => {
    if (!scopeSubject) {
      return [
        ...GENERAL_STARTERS,
        ...STARTERS.natural.slice(0, 1),
        ...STARTERS.social.slice(0, 1),
      ].slice(0, 4);
    }
    return [
      ...GENERAL_STARTERS.slice(0, 1),
      ...(STARTERS[scopeSubject.stream] ?? []),
    ].slice(0, 4);
  }, [scopeSubject]);

  // The student's latest completed mock exam — drives the callout card +
  // the "review weaknesses" starter chip in the empty state.
  const latestMock = useMemo(() => {
    if (!mockExamHistory) return null;
    const completed = mockExamHistory.filter(
      (h) => h.status === "completed" && h.totalScore !== undefined,
    );
    if (completed.length === 0) return null;
    // history is most-recent-first from the backend
    return completed[0];
  }, [mockExamHistory]);

  // When a latest mock exam exists, surface a "review weaknesses" prompt
  // as the FIRST starter chip — it's the highest-value next action.
  const startersWithMock = useMemo(() => {
    if (!latestMock) return starters;
    const mockPrompt = `I scored ${latestMock.totalScore}% on my last mock exam — what should I focus on to improve?`;
    return [mockPrompt, ...starters].slice(0, 4);
  }, [starters, latestMock]);

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending, isAwaiting]);

  const handleNewChat = useCallback(() => {
    setSelectedId(null);
    setContentId(null);
    setSending(null);
    setIsAwaiting(false);
    setInput("");
  }, []);

  const handleSend = async (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || isAwaiting) return;
    setInput("");
    setSending({ content });
    setIsAwaiting(true);
    // Clear previous follow-ups when sending a new message
    setFollowUps([]);
    setMiniCheck(null);
    setMiniCheckAnswer(null);
    try {
      const result = await sendMessage({
        conversationId: (selectedId || undefined) as never,
        content,
        subjectId: (scopeSubjectId || undefined) as never,
        contentId: (contentId || undefined) as never,
      });
      if (!selectedId) setSelectedId(result.conversationId as string);

      // Fetch follow-up suggestions + mini-check (non-blocking, fire-and-forget)
      setFetchingFollowUps(true);
      try {
        const fu = await generateFollowUps({
          conversationId: result.conversationId as never,
          subjectId: (scopeSubjectId || undefined) as never,
        });
        setFollowUps(fu.followUps ?? []);
        setMiniCheck(fu.miniCheck ?? null);
      } catch {
        // Non-fatal — follow-ups are a nice-to-have, not critical
      } finally {
        setFetchingFollowUps(false);
      }
    } catch (error) {
      if (errorCode(error) === "daily_limit_reached") {
        setCapPromptOpen(true);
      } else {
        toast.error(errorMessage(error, "The tutor couldn't reply. Try again."));
      }
    } finally {
      setSending(null);
      setIsAwaiting(false);
    }
  };

  const activeConversation = conversations?.find(
    (c: { _id: string }) => c._id === (selectedId as never),
  );

  const discussing =
    activeConversation?.contentTitle ?? contentMeta?.title ?? null;

  return (
    <DashboardShell>
      <div className="grid h-[calc(100vh-7.5rem)] gap-4 lg:grid-cols-[280px_1fr]">
        {/* ───── Left rail ───── */}
        <aside className="glass-panel hidden flex-col rounded-2xl p-3 lg:flex">
          <Button
            className="w-full rounded-xl interactive-press"
            onClick={handleNewChat}
            disabled={isAwaiting}
          >
            <MessageSquarePlus className="size-4" /> New chat
          </Button>

          <div className="mt-3 flex flex-col gap-1.5">
            <span className="type-mono px-1 uppercase text-muted-foreground">
              scope
            </span>
            <Select value={scopeSubjectId} onValueChange={setScopeSubjectId}>
              <SelectTrigger className="type-caption h-9 rounded-xl bg-white/5">
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects?.map(
                  (subject: { _id: string; name: string }) => (
                    <SelectItem
                      key={subject._id}
                      value={subject._id as string}
                    >
                      {subject.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center justify-between px-1">
            <span className="type-caption font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              conversations
            </span>
            <span className="type-caption text-muted-foreground/60">
              {conversations?.length ?? "—"}
            </span>
          </div>

          <div className="mt-2 flex-1 space-y-1 overflow-y-auto pr-0.5" data-lenis-prevent-wheel>
            {conversations === undefined ? (
              <div className="flex justify-center py-6">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="size-4 rounded-full border-2 border-primary/30 border-t-primary"
                />
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 px-2 text-center">
                <div className="flex size-10 items-center justify-center rounded-xl bg-white/5">
                  <MessageCircle className="size-4 text-muted-foreground/40" />
                </div>
                <p className="type-mono text-muted-foreground/50 leading-5">
                  No conversations yet.
                  <br />
                  Start a chat to begin.
                </p>
              </div>
            ) : (
              <AnimatePresence mode="popLayout">
                {conversations.map(
                  (
                    conversation: {
                      _id: string;
                      title?: string;
                      subjectName: string | null;
                      subjectId?: string;
                      updatedAt: number;
                    },
                    i: number,
                  ) => {
                    const active =
                      conversation._id === (selectedId as never);
                    const SubjectIcon = getSubjectIcon(
                      conversation.subjectName,
                    );
                    return (
                      <motion.button
                        key={conversation._id}
                        type="button"
                        layout
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8, scale: 0.96 }}
                        transition={{
                          duration: 0.25,
                          delay: 0.015 * Math.min(i, 12),
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        onClick={() => {
                          setSelectedId(conversation._id as string);
                          setSending(null);
                          setContentId(null);
                          if (conversation.subjectId) {
                            setScopeSubjectId(
                              conversation.subjectId as string,
                            );
                          }
                        }}
                        className={cn(
                          "w-full cursor-pointer rounded-xl px-3 py-2.5 text-left interactive-press",
                          active
                            ? "bg-amber-400/12 text-amber-300 shadow-[inset_0_0_0_1px_rgb(251,191,36/0.14),0_8px_24px_-18px_rgb(251,191,36/0.9)]"
                            : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className={cn(
                              "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-180",
                              active
                                ? "bg-primary/15 text-primary"
                                : "bg-white/5 text-muted-foreground/50",
                            )}
                          >
                            <SubjectIcon className="size-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="type-caption flex items-center gap-1.5 truncate font-semibold">
                              <span className="truncate">
                                {conversation.title}
                              </span>
                            </p>
                            <p className="mt-0.5 flex items-center justify-between type-caption text-muted-foreground/60">
                              <span className="truncate">
                                {conversation.subjectName ?? "general"}
                              </span>
                              <span className="shrink-0 pl-2">
                                {relativeTime(conversation.updatedAt)}
                              </span>
                            </p>
                          </div>
                        </div>
                      </motion.button>
                    );
                  },
                )}
              </AnimatePresence>
            )}
          </div>
        </aside>

        {/* ───── Main panel ───── */}
        <section className="glass-panel relative flex min-h-0 flex-col rounded-2xl overflow-hidden">
          {/* Ambient glow in chat area — very restrained */}
          <div
            className="pointer-events-none absolute inset-0 z-0"
            aria-hidden="true"
          >
            <div className="absolute -top-20 right-0 h-48 w-48 rounded-full bg-amber-400/4 blur-3xl" />
            <div className="absolute bottom-20 -left-10 h-36 w-36 rounded-full bg-amber-400/[0.03] blur-3xl" />
          </div>

          {/* Header */}
          <div className="relative z-10 flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300 shadow-[0_0_20px_-8px_rgb(251,191,36/0.4)]">
                <Bot className="size-4.5" />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="type-h3 truncate">
                  {activeConversation?.title ?? "New chat"}
                </p>
                <p className="truncate type-mono text-[10px] text-muted-foreground">
                  {activeConversation?.subjectName
                    ? `scope: ${activeConversation.subjectName}`
                    : "scope: general tutor"}
                </p>
                {discussing && (
                  <motion.p
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-1 flex max-w-full items-center gap-1.5 truncate rounded-lg bg-amber-400/8 px-2 py-0.5 type-mono text-[10px] text-amber-300 border border-amber-400/10"
                  >
                    <FileText className="size-3 shrink-0" />
                    <span className="truncate">Discussing: {discussing}</span>
                  </motion.p>
                )}
              </div>
            </div>
            <div className="hidden items-center gap-2 sm:flex">
              {activeConversation?.subjectId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 rounded-lg font-mono text-[10px] text-muted-foreground hover:text-primary interactive-press"
                  onClick={() => {
                    const convId = selectedId;
                    const subjId = activeConversation.subjectId;
                    if (convId && subjId) {
                      navigate(
                        `/flashcards?subject=${subjId}&conversation=${convId}`,
                      );
                    }
                  }}
                >
                  <Layers className="size-3" /> Make flashcards
                </Button>
              )}
              <Badge className="gap-1.5 bg-amber-400/10 font-mono text-[10px] text-amber-300 border-amber-400/15">
                <Sparkles className="size-3" /> AI Tutor · national exam prep
              </Badge>
            </div>
          </div>

          {/* Mobile controls */}
          <div className="relative z-10 flex items-center gap-2 border-b border-white/8 px-4 py-2.5 lg:hidden">
            <Select value={scopeSubjectId} onValueChange={setScopeSubjectId}>
              <SelectTrigger className="h-9 w-32 shrink-0 rounded-lg bg-white/5 type-mono">
                <SelectValue placeholder="Scope…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects?.map(
                  (subject: { _id: string; name: string }) => (
                    <SelectItem
                      key={subject._id}
                      value={subject._id as string}
                    >
                      {subject.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Select
              value={selectedId ?? "new"}
              onValueChange={(value) => {
                if (value === "new") {
                  setSelectedId(null);
                  setContentId(null);
                  setSending(null);
                  return;
                }
                const match = conversations?.find(
                  (c: { _id: string; subjectId?: string }) =>
                    c._id === (value as never),
                );
                setSelectedId(value);
                setSending(null);
                setContentId(null);
                if (match?.subjectId)
                  setScopeSubjectId(match.subjectId as string);
              }}
            >
              <SelectTrigger className="h-9 flex-1 rounded-lg bg-white/5 type-mono">
                <SelectValue placeholder="Select a chat…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ New chat</SelectItem>
                {conversations?.map(
                  (conversation: { _id: string; title?: string }) => (
                    <SelectItem
                      key={conversation._id}
                      value={conversation._id as string}
                    >
                      {conversation.title ?? "Untitled chat"}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="size-9 shrink-0 rounded-lg bg-white/5"
              onClick={handleNewChat}
              aria-label="New chat"
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </div>

          {/* Thread */}
          <div
            ref={threadRef}
            className="relative z-10 min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5"
            data-lenis-prevent-wheel
          >
            {selectedId === null ? (
              <div className="flex h-full flex-col items-center justify-center gap-8">
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="text-center"
                >
                  <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl bg-amber-400/10 text-amber-300 shadow-[0_0_40px_-12px_rgb(251,191,36/0.7)]">
                    <Bot className="size-7" />
                  </div>
                  <p className="uppercase tracking-[0.22em] text-amber-300 font-semibold">
                    // nexus tutor
                  </p>
                  <h2 className="type-h1 mt-2">
                    {scopeSubject
                      ? `Ask about ${scopeSubject.name}`
                      : "Ask anything, exam-style"}
                  </h2>
                  <p className="type-body mt-2 max-w-md text-muted-foreground">
                    A precise tutor for the Ethiopian national exams — grades
                    9–12, grounded in your stream&apos;s syllabus.
                  </p>
                </motion.div>

                {/* ── Latest mock exam callout ─────────────────────────────
                    Shows when the student has at least one completed mock
                    exam. Mirrors the amber "Discussing:" pill style used in
                    the header. Clickable — opens the mock exam page so they
                    can review the full breakdown or take another.
                */}
                {latestMock && (
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.5,
                      delay: 0.1,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="w-full max-w-lg"
                  >
                    <button
                      type="button"
                      onClick={() => navigate("/mock-exam")}
                      className="group flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-3.5 text-left transition-all hover:border-amber-400/40 hover:bg-amber-400/[0.1]"
                    >
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300">
                        <GraduationCap className="size-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 type-mono text-[10px] uppercase tracking-[0.16em] text-amber-300">
                          <Sparkles className="size-3" />
                          Latest mock exam
                        </p>
                        <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
                          {latestMock.totalScore}% overall ·{" "}
                          <span className="text-muted-foreground">
                            tap to view breakdown
                          </span>
                        </p>
                      </div>
                      <div className="type-mono text-xs text-amber-300 opacity-60 transition-opacity group-hover:opacity-100">
                        →
                      </div>
                    </button>
                  </motion.div>
                )}

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.5,
                    delay: 0.15,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="grid w-full max-w-lg gap-2.5"
                >
                  {startersWithMock.map((prompt, i) => (
                    <motion.button
                      key={prompt}
                      type="button"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.35,
                        delay: 0.2 + 0.06 * i,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      onClick={() => handleSend(prompt)}
                      disabled={isAwaiting}
                      className={cn(
                        "cursor-pointer rounded-xl px-4 py-3.5 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground hover:border-primary/10 disabled:opacity-50 interactive-press border border-transparent",
                        // Highlight the mock-exam-review chip when present.
                        i === 0 && latestMock
                          ? "border-amber-400/20 bg-amber-400/[0.06] text-foreground hover:border-amber-400/40 hover:bg-amber-400/[0.1]"
                          : "glass-soft",
                      )}
                    >
                      <span
                        className={cn(
                          "mr-2.5 font-mono text-[10px]",
                          i === 0 && latestMock ? "text-amber-300" : "text-amber-300",
                        )}
                      >
                        $
                      </span>
                      {prompt}
                    </motion.button>
                  ))}
                </motion.div>
              </div>
            ) : messages === undefined ? (
              <div className="flex h-full items-center justify-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                  className="size-5 rounded-full border-2 border-primary/30 border-t-primary"
                />
              </div>
            ) : (
              <>
                {messages.map((message: MessageDoc, i: number) => (
                  <Bubble key={message._id} message={message as MessageDoc} index={i} />
                ))}
              </>
            )}

            {/* Optimistic user message */}
            <AnimatePresence>
              {sending && (
                <motion.div
                  initial={{ opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-end gap-1.5"
                >
                  <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 px-4 py-3 type-body leading-6">
                    {sending.content}
                  </div>
                  <span className="px-1 type-caption text-muted-foreground/60">
                    you · sending…
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Thinking indicator */}
            <AnimatePresence>
              {isAwaiting && <ThinkingIndicator />}
            </AnimatePresence>

            {/* Follow-up suggestions + mini-check */}
            {selectedId && !isAwaiting && !sending && (followUps.length > 0 || miniCheck) && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-3 px-1"
              >
                {/* Follow-up question chips */}
                {followUps.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {followUps.map((q, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSend(q)}
                        className="cursor-pointer rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-foreground interactive-press"
                      >
                        <span className="mr-1.5 font-mono text-[9px] text-primary/60">→</span>
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {/* Inline mini-check */}
                {miniCheck && (
                  <div className="rounded-2xl border border-primary/15 bg-primary/[0.03] p-3">
                    {miniCheckAnswer === null ? (
                      <>
                        <p className="flex items-center gap-2 text-xs font-semibold text-primary">
                          <Sparkles className="size-3.5" />
                          Test yourself — quick check
                        </p>
                        <p className="mt-2 text-sm text-foreground/90">{miniCheck.question}</p>
                        <div className="mt-3 flex flex-col gap-1.5">
                          {miniCheck.options.map((opt, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setMiniCheckAnswer(idx)}
                              className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
                            >
                              <span className="mr-2 font-mono text-[10px] text-muted-foreground">
                                {String.fromCharCode(65 + idx)}
                              </span>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className={cn(
                        "rounded-xl border px-3 py-2.5",
                        miniCheckAnswer === miniCheck.correctIndex
                          ? "border-emerald-400/25 bg-emerald-400/5"
                          : "border-rose-400/25 bg-rose-400/5",
                      )}>
                        <p className="flex items-center gap-2 text-xs font-bold">
                          {miniCheckAnswer === miniCheck.correctIndex ? (
                            <><CheckCircle2 className="size-4 text-emerald-300" /> Correct!</>
                          ) : (
                            <><XCircle className="size-4 text-rose-300" /> Not quite.</>
                          )}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{miniCheck.explanation}</p>
                        <button
                          type="button"
                          onClick={() => { setMiniCheckAnswer(null); }}
                          className="mt-2 cursor-pointer text-[10px] text-primary hover:underline"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </div>

          {/* Input */}
          <div className="relative z-10 border-t border-white/8 p-4">
            <div className="flex items-center gap-2.5">
              {entitlements && !entitlements.premiumAccess && (
                <span
                  title={
                    entitlements.tutorRemainingToday > 0
                      ? `${entitlements.tutorRemainingToday} of ${entitlements.tutorDailyLimit} free messages left today`
                      : "Daily free messages used — they reset tomorrow"
                  }
                  className="hidden shrink-0 rounded-lg border border-premium/30 bg-premium/8 px-2.5 py-1.5 font-mono text-[10px] text-premium sm:block"
                >
                  free · {entitlements.tutorRemainingToday}/{entitlements.tutorDailyLimit} today
                </span>
              )}
              <span className="hidden shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground sm:block">
                {scopeSubject ? scopeSubject.name : "general"}
              </span>
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={
                  speech.listening
                    ? "Listening… speak now"
                    : "Ask the tutor anything about your exams…"
                }
                disabled={isAwaiting}
                className={cn(
                  "type-body h-10 flex-1 rounded-xl bg-white/5 font-mono",
                  speech.listening && "border-rose-400/40 bg-rose-400/[0.04] ring-1 ring-rose-400/30",
                )}
              />
              {/* Voice input button — uses the browser's native Web Speech
                  API. Hidden entirely on unsupported browsers (older
                  Safari, Firefox without the flag) so there's no broken
                  UX. While listening, the button turns red + pulses so
                  it's visually obvious the mic is hot. Transcribed text
                  populates the input above but is NEVER auto-sent — the
                  student reviews + edits first. */}
              {speech.supported && (
                <Button
                  size="icon"
                  variant={speech.listening ? "default" : "outline"}
                  className={cn(
                    "size-10 shrink-0 cursor-pointer rounded-xl interactive-press",
                    speech.listening
                      ? "bg-rose-500 text-white hover:bg-rose-600"
                      : "bg-white/5 text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => (speech.listening ? speech.stop() : speech.start())}
                  disabled={isAwaiting}
                  aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
                  title={
                    speech.listening
                      ? "Stop listening"
                      : "Speak your question — transcribed text appears in the input, never auto-sent"
                  }
                >
                  {speech.listening ? (
                    <motion.span
                      animate={{ scale: [1, 1.15, 1] }}
                      transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <MicOff className="size-4" />
                    </motion.span>
                  ) : (
                    <Mic className="size-4" />
                  )}
                </Button>
              )}
              <Button
                size="icon"
                className="size-10 shrink-0 rounded-xl interactive-press"
                onClick={() => handleSend()}
                disabled={!input.trim() || isAwaiting}
                aria-label="Send message"
              >
                {isAwaiting ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 1,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                    className="size-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground"
                  />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <PremiumPrompt
        open={capPromptOpen}
        onOpenChange={setCapPromptOpen}
        reason="daily_limit_reached"
      />
    </DashboardShell>
  );
}
