import { api } from "@/convex/_generated/api";
import { useAction, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowUp,
  Bot,
  FileText,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
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

function Bubble({ message }: { message: MessageDoc }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-3 type-body leading-6",
          isUser
            ? "rounded-br-md border border-primary/25 bg-primary/10 text-foreground"
            : "glass-soft rounded-bl-md text-foreground",
        )}
      >
        {message.content}
      </div>
      <span className="px-1 type-caption text-muted-foreground/70">
        {isUser ? "you" : "grok-4.6"} · {clockTime(message.createdAt)}
      </span>
    </motion.div>
  );
}

export default function Tutor() {
  const [searchParams] = useSearchParams();
  const subjects = useQuery(api.subjects.getAll);
  const conversations = useQuery(api.ai.listConversations);
  const entitlements = useQuery(api.subscriptions.getEntitlements);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [capPromptOpen, setCapPromptOpen] = useState(false);
  const [scopeSubjectId, setScopeSubjectId] = useState("");
  const [contentId, setContentId] = useState<string | null>(
    searchParams.get("contentId"),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState<{ content: string } | null>(null);
  const [isAwaiting, setIsAwaiting] = useState(false);

  const contentMeta = useQuery(
    api.content.getContentItemMeta,
    contentId ? { contentId: contentId as never } : "skip",
  );

  const sendMessage = useAction(api.ai.sendMessage);
  const messages = useQuery(
    api.ai.getMessages,
    selectedId ? { conversationId: selectedId as never } : "skip",
  );

  // Subject preselect via ?subject=<slug> (e.g. "Ask the tutor" from a card).
  useEffect(() => {
    if (!subjects) return;
    const slug = searchParams.get("subject");
    if (!slug) return;
    const match = subjects.find((s: { slug: string; _id: string }) => s.slug === slug);
    if (match) setScopeSubjectId(match._id as string);
  }, [subjects, searchParams]);

  const scopeSubject = useMemo(
    () => subjects?.find((s: { _id: string }) => s._id === (scopeSubjectId as never)),
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
    return [...GENERAL_STARTERS.slice(0, 1), ...(STARTERS[scopeSubject.stream] ?? [])].slice(0, 4);
  }, [scopeSubject]);

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, sending, isAwaiting]);

  const handleNewChat = () => {
    setSelectedId(null);
    setContentId(null);
    setSending(null);
    setIsAwaiting(false);
    setInput("");
  };

  const handleSend = async (raw?: string) => {
    const content = (raw ?? input).trim();
    if (!content || isAwaiting) return;
    setInput("");
    setSending({ content });
    setIsAwaiting(true);
    try {
      const result = await sendMessage({
        conversationId: (selectedId || undefined) as never,
        content,
        subjectId: (scopeSubjectId || undefined) as never,
        contentId: (contentId || undefined) as never,
      });
      if (!selectedId) setSelectedId(result.conversationId as string);
    } catch (error) {
      if (errorCode(error) === "daily_limit_reached") {
        // A real, earned moment: the student used today's free messages.
        // Offer upgrade, never lock them out of the rest of the app.
        setCapPromptOpen(true);
      } else {
        toast.error(errorMessage(error, "The tutor couldn't reply. Try again."));
      }
    } finally {
      setSending(null);
      setIsAwaiting(false);
    }
  };

  const activeConversation = conversations?.find((c: { _id: string }) => c._id === (selectedId as never));

  // The document this chat is grounded in — either the active conversation's
  // stored link, or the contentId carried in from a library card for a new chat.
  const discussing =
    activeConversation?.contentTitle ?? contentMeta?.title ?? null;

  return (
    <DashboardShell>
      <div className="grid h-[calc(100vh-7.5rem)] gap-4 lg:grid-cols-[270px_1fr]">
        {/* ------- Left rail ------- */}
        <aside className="glass-panel hidden flex-col rounded-2xl p-3 lg:flex">
          <Button
            className="w-full rounded-xl"
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
                {subjects?.map((subject: { _id: string; name: string }) => (
                  <SelectItem key={subject._id} value={subject._id as string}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="mt-4 flex items-center justify-between px-1">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              conversations
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {conversations?.length ?? "—"}
            </span>
          </div>

          <div className="mt-2 flex-1 space-y-1 overflow-y-auto">
            {conversations === undefined ? (
              <div className="flex justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="type-mono px-1 py-6 text-center leading-5 text-muted-foreground">
                No conversations yet.
                <br />
                Start a chat to begin.
              </p>
            ) : (
              conversations.map((conversation: { _id: string; title: string; subjectName: string | null; subjectId?: string; updatedAt: number }) => {
                const active = conversation._id === (selectedId as never);
                return (
                  <button
                    key={conversation._id}
                    type="button"
                    onClick={() => {
                      setSelectedId(conversation._id as string);
                      setSending(null);
                      setContentId(null);
                      if (conversation.subjectId) {
                        setScopeSubjectId(conversation.subjectId as string);
                      }
                    }}
                    className={cn(
                      "w-full cursor-pointer rounded-xl px-3 py-2.5 text-left transition-colors",
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground",
                    )}
                  >
                    <p className="type-caption flex items-center gap-2 truncate font-semibold">
                      <MessageSquareText className="size-3.5 shrink-0" />
                      <span className="truncate">{conversation.title}</span>
                    </p>
                    <p className="mt-0.5 flex items-center justify-between type-caption text-muted-foreground/70">
                      <span className="truncate">
                        {conversation.subjectName ?? "general"}
                      </span>
                      <span className="shrink-0 pl-2">
                        {relativeTime(conversation.updatedAt)}
                      </span>
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ------- Main panel ------- */}
        <section className="glass-panel flex min-h-0 flex-col rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-3.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Bot className="size-4" />
              </div>
              <div className="min-w-0 leading-tight">
                <p className="type-h3 truncate">
                  {activeConversation?.title ?? "New chat"}
                </p>
                <p className="truncate font-mono text-[10px] text-muted-foreground">
                  {activeConversation?.subjectName
                    ? `scope: ${activeConversation.subjectName}`
                    : "scope: general tutor"}
                </p>
                {discussing && (
                  <p className="mt-0.5 flex max-w-full items-center gap-1.5 truncate rounded-md bg-primary/8 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                    <FileText className="size-3 shrink-0" />
                    <span className="truncate">Discussing: {discussing}</span>
                  </p>
                )}
              </div>
            </div>
            <Badge className="hidden shrink-0 gap-1.5 bg-primary/10 font-mono text-[10px] text-primary sm:flex">
              <Sparkles className="size-3" /> grok-4.6 · national exam tutor
            </Badge>
          </div>

          {/* Mobile controls (rail is desktop-only) */}
          <div className="flex items-center gap-2 border-b border-white/8 px-4 py-2.5 lg:hidden">
            <Select value={scopeSubjectId} onValueChange={setScopeSubjectId}>
              <SelectTrigger className="h-9 w-32 shrink-0 rounded-lg bg-white/5 type-mono">
                <SelectValue placeholder="Scope…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects?.map((subject: { _id: string; name: string }) => (
                  <SelectItem key={subject._id} value={subject._id as string}>
                    {subject.name}
                  </SelectItem>
                ))}
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
                const match = conversations?.find((c: { _id: string; subjectId?: string }) => c._id === (value as never));
                setSelectedId(value);
                setSending(null);
                setContentId(null);
                if (match?.subjectId) setScopeSubjectId(match.subjectId as string);
              }}
            >
              <SelectTrigger className="h-9 flex-1 rounded-lg bg-white/5 type-mono">
                <SelectValue placeholder="Select a chat…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">+ New chat</SelectItem>
                {conversations?.map((conversation: { _id: string; title: string }) => (
                  <SelectItem key={conversation._id} value={conversation._id as string}>
                    {conversation.title}
                  </SelectItem>
                ))}
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
          <div ref={threadRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {selectedId === null ? (
              <div className="flex h-full flex-col items-center justify-center gap-6">
                <div className="text-center">
                  <p className="type-mono uppercase tracking-[0.2em] text-primary">
                    // nexus tutor
                  </p>
                  <h2 className="type-h1 mt-2">
                    {scopeSubject ? `Ask about ${scopeSubject.name}` : "Ask anything, exam-style"}
                  </h2>
                  <p className="type-body mt-1 max-w-md text-muted-foreground">
                    A precise tutor for the Ethiopian national exams — grades 9–12,
                    grounded in your stream&apos;s syllabus.
                  </p>
                </div>
                <div className="grid w-full max-w-lg gap-2">
                  {starters.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSend(prompt)}
                      disabled={isAwaiting}
                      className="glass-soft cursor-pointer rounded-xl px-4 py-3 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground disabled:opacity-50"
                    >
                      <span className="mr-2 font-mono text-[10px] text-primary">$</span>
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : messages === undefined ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {messages.map((message: MessageDoc) => (
                  <Bubble key={message._id} message={message as MessageDoc} />
                ))}
              </>
            )}

            {/* Optimistic user message */}
            {sending && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-end gap-1"
              >
                <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-primary/25 bg-primary/10 px-4 py-3 text-sm leading-6">
                  {sending.content}
                </div>
                <span className="px-1 type-caption text-muted-foreground/70">
                  you · sending…
                </span>
              </motion.div>
            )}

            {/* Thinking indicator — scan-line, not a typing bubble */}
            {isAwaiting && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-start gap-1"
              >
                <div className="glass-soft relative overflow-hidden rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="scan-line" aria-hidden="true" />
                  <span className="type-mono text-muted-foreground">
                    <span className="text-primary">▌</span> grok-4.6 is thinking…
                  </span>
                </div>
              </motion.div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-white/8 p-4">
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
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask the tutor anything about your exams…"
                disabled={isAwaiting}
                className="type-body h-10 flex-1 rounded-xl bg-white/5 font-mono"
              />
              <Button
                size="icon"
                className="size-10 shrink-0 rounded-xl"
                onClick={() => handleSend()}
                disabled={!input.trim() || isAwaiting}
                aria-label="Send message"
              >
                {isAwaiting ? (
                  <Loader2 className="size-4 animate-spin" />
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
