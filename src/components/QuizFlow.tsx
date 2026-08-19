// Quiz flow — a full-screen dialog used from the library cards and the focus
// completion prompt. One question at a time with immediate feedback (a single
// consistent mode), then a results screen with explanations for misses.
// Generation is gated behind the subscription server-side (premium_required
// surfaces as a toast for expired trials).

import { api } from "@/convex/_generated/api";
import type { QuizQuestion } from "@/convex/quizzes";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { errorCode, errorMessage } from "@/lib/errors";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuizFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSubjectId?: string;
  title?: string;
}

type Phase =
  | { name: "setup" }
  | { name: "generating" }
  | { name: "questions"; questions: QuizQuestion[]; quizId: string }
  | { name: "results"; results: QuizResult[]; score: number; total: number; xpAwarded: number };

interface QuizResult {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  selected: number;
  correct: boolean;
}

const QUESTION_COUNTS = [5, 10, 15];

export function QuizFlow({
  open,
  onOpenChange,
  initialSubjectId,
  title = "Quick check",
}: QuizFlowProps) {
  const subjects = useQuery(api.subjects.getAll);
  const entitlements = useQuery(api.subscriptions.getEntitlements);
  const generateQuiz = useAction(api.quizzes.generateQuiz);
  const submitAttempt = useMutation(api.quizzes.submitAttempt);

  const [limitPromptOpen, setLimitPromptOpen] = useState(false);

  const [phase, setPhase] = useState<Phase>({ name: "setup" });
  const [subjectId, setSubjectId] = useState(initialSubjectId ?? "");
  const [count, setCount] = useState(10);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [answered, setAnswered] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recapText, setRecapText] = useState<string | null>(null);
  const generateRecap = useAction(api.recap.generateRecap);

  const selectedSubject = useMemo(
    () => subjects?.find((s) => s._id === (subjectId as never)),
    [subjects, subjectId],
  );

  const handleGenerate = async () => {
    if (!subjectId) {
      toast.error("Pick a subject first.");
      return;
    }
    setPhase({ name: "generating" });
    try {
      const result = await generateQuiz({
        subjectId: subjectId as never,
        questionCount: count,
      });
      setCurrent(0);
      setAnswers([]);
      setAnswered(false);
      setPhase({
        name: "questions",
        questions: result.questions,
        quizId: result.quizId as string,
      });
    } catch (error) {
      const code = errorCode(error);
      if (code === "weekly_quiz_limit") {
        // A real, earned moment: the student saw the quiz value, then hit
        // the free weekly allowance for this subject. Honest prompt, no pressure.
        setLimitPromptOpen(true);
        setPhase({ name: "setup" });
        return;
      }
      toast.error(
        errorMessage(
          error,
          "Could not generate the quiz. Your free trial may have ended — upgrade to continue.",
        ),
      );
      setPhase({ name: "setup" });
    }
  };

  const handlePick = (optionIndex: number) => {
    if (phase.name !== "questions" || answered) return;
    const next = [...answers];
    next[current] = optionIndex;
    setAnswers(next);
    setAnswered(true);
  };

  const handleNext = () => {
    if (phase.name !== "questions") return;
    if (current + 1 < phase.questions.length) {
      setCurrent(current + 1);
      setAnswered(false);
    } else {
      void finishQuiz();
    }
  };

  const finishQuiz = async () => {
    if (phase.name !== "questions" || submitting) return;
    setSubmitting(true);
    try {
      const result = await submitAttempt({
        quizId: phase.quizId as never,
        answers,
      });
      setPhase({
        name: "results",
        results: result.results,
        score: result.score,
        total: result.total,
        xpAwarded: result.xpAwarded,
      });
      // Celebratory but non-intrusive: a toast for the level-up and any
      // achievements earned, never a full-screen interruption.
      if (result.xpAwarded > 0) {
        toast.success(`Quiz complete — +${result.xpAwarded} XP.`);
      }
      if (result.levelUp) {
        toast.success(`Level up — you're now level ${result.newLevel}.`);
      }
      for (const achievement of result.newAchievements) {
        toast.success(`Achievement unlocked: ${achievement.name}`);
      }
      // Generate a quiz recap from real data
      generateRecap({ type: "quiz" })
        .then((r) => { if (r.text) setRecapText(r.text); })
        .catch(() => {});
    } catch (error) {
      toast.error(errorMessage(error, "Could not submit your answers."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    onOpenChange(false);
    // Reset after the dialog finishes closing so the next open starts clean.
    setTimeout(() => {
      setPhase({ name: "setup" });
      setSubjectId(initialSubjectId ?? "");
      setCurrent(0);
      setAnswers([]);
      setAnswered(false);
      setRecapText(null);
    }, 250);
  };

  const question = phase.name === "questions" ? phase.questions[current] : null;

  return (
    <>
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : handleClose())}>
      <DialogContent className="glass-panel max-h-[88vh] w-[min(94vw,620px)] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            {phase.name === "questions" && question
              ? `${selectedSubject?.name ?? "Quiz"} · question ${current + 1} of ${phase.questions.length}`
              : phase.name === "results"
                ? "Scored and saved to your journey."
                : "AI-generated from the real syllabus topics."}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {phase.name === "setup" && (
            <motion.div
              key="setup"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Subject
                </span>
                <Select value={subjectId} onValueChange={setSubjectId}>
                  <SelectTrigger className="h-10 rounded-xl bg-white/5 font-mono text-sm">
                    <SelectValue placeholder="Pick a subject…" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects?.map((subject) => (
                      <SelectItem key={subject._id} value={subject._id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Questions
                </span>
                <div className="flex gap-2">
                  {QUESTION_COUNTS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setCount(option)}
                      className={cn(
                        "flex-1 cursor-pointer rounded-xl border px-3 py-2.5 font-mono text-sm font-semibold transition-colors",
                        count === option
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-white/10 bg-white/5 text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <Button className="mt-1 h-11 rounded-xl" onClick={handleGenerate}>
                {entitlements && !entitlements.premiumAccess ? (
                  <Lock className="size-4 text-premium" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Generate quiz
              </Button>
              <p className="font-mono text-[10px] leading-4 text-muted-foreground">
                {entitlements && !entitlements.premiumAccess
                  ? `Free accounts get ${entitlements.quizWeeklyLimit} quiz per subject per week — your score still saves to your journey.`
                  : "Available during your trial, and free accounts get a weekly allowance. The AI writes questions grounded in the subject's actual syllabus topics."}
              </p>
            </motion.div>
          )}

          {phase.name === "generating" && (
            <motion.div
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center gap-3 py-12"
            >
              <Loader2 className="size-6 animate-spin text-primary" />
              <p className="font-mono text-xs text-muted-foreground">
                {selectedSubject?.name ?? "The AI"} is writing questions…
              </p>
            </motion.div>
          )}

          {phase.name === "questions" && question && (
            <motion.div
              key={`q-${current}`}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="flex flex-col gap-4"
            >
              <p className="text-base font-bold leading-7 tracking-tight">
                {question.question}
              </p>

              <div className="flex flex-col gap-2">
                {question.options.map((option, index) => {
                  const selected = answered && answers[current] === index;
                  const isCorrect = answered && index === question.correctIndex;
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handlePick(index)}
                      disabled={answered}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors disabled:cursor-default",
                        answered && isCorrect
                          ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                          : answered && selected
                            ? "border-rose-400/50 bg-rose-400/10 text-rose-300"
                            : answered
                              ? "border-white/5 bg-white/[0.02] text-muted-foreground"
                              : "border-white/10 bg-white/5 hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {String.fromCharCode(65 + index)}
                      </span>
                      <span className="flex-1">{option}</span>
                      {answered && isCorrect && (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-300" />
                      )}
                      {answered && selected && !isCorrect && (
                        <XCircle className="size-4 shrink-0 text-rose-300" />
                      )}
                    </button>
                  );
                })}
              </div>

              {answered && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-6 text-muted-foreground"
                >
                  <span className="font-semibold text-foreground">Why: </span>
                  {question.explanation}
                </motion.div>
              )}

              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] text-muted-foreground">
                  {answered ? "Answered" : "Pick an answer"}
                </span>
                <Button
                  onClick={handleNext}
                  disabled={!answered || submitting}
                  className="rounded-xl"
                >
                  {submitting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : current + 1 < phase.questions.length ? (
                    <>
                      Next question <ArrowRight className="size-4" />
                    </>
                  ) : (
                    <>
                      See results <Check className="size-4" />
                    </>
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {phase.name === "results" && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-4"
            >
              <div className="glass-soft flex items-center justify-between rounded-2xl px-5 py-4">
                <div>
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    score
                  </p>
                  <p className="mt-1 font-mono text-4xl font-extrabold tabular-nums text-gradient">
                    {phase.score}
                    <span className="text-lg text-muted-foreground">/{phase.total}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    accuracy
                  </p>
                  <p className="mt-1 font-mono text-4xl font-extrabold tabular-nums">
                    {phase.total > 0 ? Math.round((phase.score / phase.total) * 100) : 0}%
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5">
                <Sparkles className="size-3.5 text-primary" />
                <p className="font-mono text-[11px] font-semibold text-primary">
                  +{phase.xpAwarded} XP · saved to your journey
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {phase.results.map((result, index) => (
                  <div
                    key={index}
                    className={cn(
                      "rounded-xl border px-4 py-3",
                      result.correct
                        ? "border-emerald-400/20 bg-emerald-400/5"
                        : "border-rose-400/20 bg-rose-400/5",
                    )}
                  >
                    <p className="flex items-start gap-2 text-sm font-semibold leading-6">
                      {result.correct ? (
                        <CheckCircle2 className="mt-1 size-4 shrink-0 text-emerald-300" />
                      ) : (
                        <XCircle className="mt-1 size-4 shrink-0 text-rose-300" />
                      )}
                      {result.question}
                    </p>
                    {!result.correct && (
                      <p className="mt-1.5 pl-6 text-xs leading-5 text-muted-foreground">
                        Correct:{" "}
                        <span className="font-semibold text-emerald-300">
                          {result.options[result.correctIndex]}
                        </span>
                      </p>
                    )}
                    <p className="mt-1 pl-6 text-xs leading-5 text-muted-foreground">
                      {result.explanation}
                    </p>
                  </div>
                ))}
              </div>

              {recapText && (
                <div className="glass-soft flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <Sparkles className="size-4 shrink-0 text-primary mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary mb-1">
                      // recap
                    </p>
                    <p className="type-body leading-relaxed text-muted-foreground">{recapText}</p>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 rounded-xl bg-white/5"
                  onClick={() => setPhase({ name: "setup" })}
                >
                  <RotateCcw className="size-4" /> Practice again
                </Button>
                <Button className="flex-1 rounded-xl" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>

    <PremiumPrompt
      open={limitPromptOpen}
      onOpenChange={setLimitPromptOpen}
      reason="weekly_quiz_limit"
      subjectName={selectedSubject?.name}
    />
    </>
  );
}
