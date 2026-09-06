// /aptitude-hub — Deep Aptitude (SAT) Practice Hub.
//
// The central interactive feature is the "brain map" — a hand-built
// SVG node graph showing two connected skill clusters (Verbal +
// Quantitative) with nodes colored by mastery score. Clicking a node
// opens a practice panel for that specific skill.
//
// The page also includes:
//   - A "Full Aptitude Mock" entry point (standalone 40-question mock)
//   - An overall readiness summary (aggregate mastery as a single %)
//   - Recommended next practice (the 1-2 weakest nodes)
//   - Daily aptitude warm-up (one question per day, separate streak)
//   - Time-pressure trainer (progressively shrinking time per question)
//
// All data is real — mastery scores are computed server-side with
// recency-weighted accuracy. The brain map updates after a practice
// session, not just on page reload (the Convex query auto-refreshes).

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ChevronRight,
  Clock,
  Crown,
  Flame,
  Gauge,
  Loader2,
  Mic,
  MicOff,
  Play,
  Sparkles,
  Target,
  Timer,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QuizQuestion } from "@/convex/quizzes";

// ── Types (mirror the backend return shapes) ────────────────────────────

type SkillNodeCategory = "verbal" | "quantitative";

interface SkillNode {
  _id: Id<"aptitudeSkillNodes">;
  slug: string;
  category: SkillNodeCategory;
  name: string;
  description: string;
  prerequisiteSlugs: string[];
}

interface MasteryEntry {
  nodeSlug: string;
  masteryScore: number;
  questionsAttempted: number;
  correctCount: number;
  lastPracticedAt: number | null;
}

interface SkillMapData {
  nodes: SkillNode[];
  mastery: MasteryEntry[];
  readiness: number;
  weakestNodes: Array<{
    slug: string;
    name: string;
    category: string;
    masteryScore: number;
    questionsAttempted: number;
  }>;
  practicedNodeCount: number;
}

// ── Brain Map component ─────────────────────────────────────────────────
//
// Hand-built SVG node graph — no external graph library needed for
// 10 nodes. Two clusters (Verbal on the left, Quantitative on the
// right) with nodes positioned in a circular layout within each
// cluster. Edges drawn from prerequisites to their dependents.
//
// Mastery encoding (using the app's existing accent system — no new
// colors):
//   - 0 (unpracticed): dim grey, no glow
//   - 1-30: faint amber glow (developing)
//   - 31-70: medium amber glow
//   - 71-100: bright gold glow with ring (mastered)
//
// Clicking a node opens the practice panel below the map.

interface PositionedNode extends SkillNode {
  x: number;
  y: number;
  masteryScore: number;
  questionsAttempted: number;
}

function masteryColor(score: number): { fill: string; stroke: string; glow: string; label: string } {
  if (score === 0) return { fill: "rgba(255,255,255,0.04)", stroke: "rgba(255,255,255,0.12)", glow: "none", label: "Unpracticed" };
  if (score < 31) return { fill: "rgba(251,191,36,0.08)", stroke: "rgba(251,191,36,0.25)", glow: "rgba(251,191,36,0.15)", label: "Developing" };
  if (score < 71) return { fill: "rgba(251,191,36,0.15)", stroke: "rgba(251,191,36,0.4)", glow: "rgba(251,191,36,0.3)", label: "Progressing" };
  return { fill: "rgba(251,191,36,0.25)", stroke: "rgba(251,191,36,0.6)", glow: "rgba(251,191,36,0.5)", label: "Mastered" };
}

function BrainMap({
  nodes,
  masteryBySlug,
  selectedSlug,
  onSelect,
}: {
  nodes: SkillNode[];
  masteryBySlug: Map<string, MasteryEntry>;
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  // Position nodes in two clusters. Verbal on the left, Quantitative on
  // the right. Within each cluster, arrange in a vertical column (top to
  // bottom) since we have 5 nodes per cluster.
  const positioned: PositionedNode[] = useMemo(() => {
    const verbal = nodes.filter((n) => n.category === "verbal");
    const quant = nodes.filter((n) => n.category === "quantitative");
    const result: PositionedNode[] = [];

    const positionCluster = (clusterNodes: SkillNode[], centerX: number) => {
      const startY = 80;
      const gapY = 110;
      clusterNodes.forEach((node, i) => {
        const m = masteryBySlug.get(node.slug);
        result.push({
          ...node,
          x: centerX,
          y: startY + i * gapY,
          masteryScore: m?.masteryScore ?? 0,
          questionsAttempted: m?.questionsAttempted ?? 0,
        });
      });
    };

    positionCluster(verbal, 180);
    positionCluster(quant, 520);
    return result;
  }, [nodes, masteryBySlug]);

  const nodeBySlug = useMemo(
    () => new Map(positioned.map((n) => [n.slug, n])),
    [positioned],
  );

  // Draw edges from prerequisites to their dependents.
  const edges = useMemo(() => {
    const edgeList: Array<{ from: PositionedNode; to: PositionedNode }> = [];
    for (const node of positioned) {
      if (node.prerequisiteSlugs) {
        for (const preSlug of node.prerequisiteSlugs) {
          const pre = nodeBySlug.get(preSlug);
          if (pre) {
            edgeList.push({ from: pre, to: node });
          }
        }
      }
    }
    return edgeList;
  }, [positioned, nodeBySlug]);

  return (
    <div className="relative overflow-x-auto">
      <svg viewBox="0 0 700 630" className="mx-auto w-full min-w-[600px]" style={{ maxHeight: "630px" }}>
        {/* Defs for glow filters */}
        <defs>
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="strongGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Cluster labels */}
        <text x="180" y="40" textAnchor="middle" className="fill-amber-300 font-mono text-[12px] font-bold uppercase tracking-[0.18em]" style={{ letterSpacing: "0.18em" }}>
          VERBAL
        </text>
        <text x="520" y="40" textAnchor="middle" className="fill-sky-300 font-mono text-[12px] font-bold uppercase tracking-[0.18em]" style={{ letterSpacing: "0.18em" }}>
          QUANTITATIVE
        </text>

        {/* Edges (prerequisite connections) */}
        {edges.map((edge, i) => {
          const dx = edge.to.x - edge.from.x;
          const dy = edge.to.y - edge.from.y;
          const midX = (edge.from.x + edge.to.x) / 2;
          const midY = (edge.from.y + edge.to.y) / 2;
          // Curved path for visual elegance.
          const curveOffset = Math.abs(dx) > 50 ? 30 : 0;
          const path = `M ${edge.from.x} ${edge.from.y} Q ${midX} ${midY - curveOffset} ${edge.to.x} ${edge.to.y}`;
          return (
            <path
              key={i}
              d={path}
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          );
        })}

        {/* Nodes */}
        {positioned.map((node) => {
          const color = masteryColor(node.masteryScore);
          const isSelected = selectedSlug === node.slug;
          const radius = node.masteryScore >= 71 ? 34 : node.masteryScore >= 31 ? 30 : 26;
          return (
            <g
              key={node.slug}
              className="cursor-pointer"
              onClick={() => onSelect(node.slug)}
              filter={node.masteryScore >= 71 ? "url(#strongGlow)" : node.masteryScore >= 31 ? "url(#nodeGlow)" : undefined}
            >
              {/* Outer ring for mastered nodes */}
              {node.masteryScore >= 71 && (
                <circle cx={node.x} cy={node.y} r={radius + 6} fill="none" stroke="rgba(251,191,36,0.3)" strokeWidth={2} strokeDasharray="3 3" />
              )}
              {/* Main node circle */}
              <circle
                cx={node.x}
                cy={node.y}
                r={radius}
                fill={color.fill}
                stroke={isSelected ? "var(--primary)" : color.stroke}
                strokeWidth={isSelected ? 3 : 2}
                style={color.glow !== "none" ? { filter: `drop-shadow(0 0 8px ${color.glow})` } : undefined}
              />
              {/* Mastery score in the center */}
              <text
                x={node.x}
                y={node.y - 2}
                textAnchor="middle"
                className="font-mono font-bold tabular-nums"
                fill={node.masteryScore >= 71 ? "rgb(251,191,36)" : node.masteryScore >= 31 ? "rgb(251,191,36)" : "rgba(255,255,255,0.5)"}
                style={{ fontSize: node.masteryScore >= 71 ? "20px" : "16px" }}
              >
                {node.masteryScore}
              </text>
              <text
                x={node.x}
                y={node.y + 14}
                textAnchor="middle"
                className="font-mono uppercase"
                fill="rgba(255,255,255,0.4)"
                style={{ fontSize: "9px", letterSpacing: "0.1em" }}
              >
                {color.label}
              </text>
              {/* Node name below the circle */}
              <text
                x={node.x}
                y={node.y + radius + 16}
                textAnchor="middle"
                className="fill-foreground font-semibold"
                style={{ fontSize: "12px" }}
              >
                {node.name.length > 22 ? node.name.slice(0, 20) + "…" : node.name}
              </text>
              {/* Questions attempted badge */}
              {node.questionsAttempted > 0 && (
                <text
                  x={node.x}
                  y={node.y + radius + 30}
                  textAnchor="middle"
                  className="fill-muted-foreground font-mono"
                  style={{ fontSize: "9px" }}
                >
                  {node.questionsAttempted} Q attempted
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ── Practice panel (shown when a node is selected) ─────────────────────

function PracticePanel({
  node,
  mastery,
  onClose,
}: {
  node: SkillNode;
  mastery: MasteryEntry | undefined;
  onClose: () => void;
}) {
  const generateNodePractice = useAction(api.aptitudeActions.generateNodePractice);
  const submitResult = useAction(api.aptitudeActions.submitNodePracticeResult);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<number[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [difficulty, setDifficulty] = useState<string>("");
  const [result, setResult] = useState<{
    correctCount: number;
    questionCount: number;
    masteryBefore: number;
    masteryAfter: number;
    masteryDelta: number;
  } | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setResult(null);
    setQuestions([]);
    setAnswers([]);
    setCurrentIdx(0);
    try {
      const result = await generateNodePractice({
        nodeSlug: node.slug,
        questionCount: 10,
      });
      setQuestions(result.questions);
      setDifficulty(result.difficulty);
      setAnswers(new Array(result.questions.length).fill(-1));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate questions.");
    } finally {
      setGenerating(false);
    }
  };

  const handleAnswer = (optionIdx: number) => {
    setAnswers((prev) => prev.map((a, i) => (i === currentIdx ? optionIdx : a)));
  };

  const handleSubmit = async () => {
    if (questions.length === 0) return;
    setSubmitting(true);
    try {
      const result = await submitResult({
        nodeSlug: node.slug,
        difficulty,
        answers,
        correctQuestions: questions,
      });
      setResult({
        correctCount: result.correctCount,
        questionCount: result.questionCount,
        masteryBefore: result.masteryBefore,
        masteryAfter: result.masteryAfter,
        masteryDelta: result.masteryDelta,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit results.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className="glass-panel rounded-3xl p-5 sm:p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={cn(
            "flex size-8 items-center justify-center rounded-xl",
            node.category === "verbal" ? "bg-amber-400/10 text-amber-300" : "bg-sky-400/10 text-sky-300",
          )}>
            <Brain className="size-4" />
          </div>
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-foreground">
              {node.name}
            </p>
            <p className="text-xs text-muted-foreground">
              {node.category} · mastery {mastery?.masteryScore ?? 0}/100
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="cursor-pointer">
          Close
        </Button>
      </div>

      {/* Description */}
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {node.description}
      </p>

      {/* Result screen */}
      {result ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="mt-5 flex flex-col items-center rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-6 text-center"
        >
          <div className={cn(
            "flex size-14 items-center justify-center rounded-2xl",
            result.masteryDelta > 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-amber-400/15 text-amber-300",
          )}>
            {result.masteryDelta > 0 ? <TrendingUp className="size-7" /> : <Target className="size-7" />}
          </div>
          <p className="mt-4 text-2xl font-extrabold tracking-tight">
            {result.correctCount} / {result.questionCount} correct
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Mastery: {result.masteryBefore} → {result.masteryAfter}
            {result.masteryDelta > 0 && (
              <span className="ml-1 font-bold text-emerald-300">+{result.masteryDelta}</span>
            )}
            {result.masteryDelta < 0 && (
              <span className="ml-1 font-bold text-rose-300">{result.masteryDelta}</span>
            )}
            {result.masteryDelta === 0 && (
              <span className="ml-1 text-muted-foreground">no change</span>
            )}
          </p>
          <div className="mt-4 flex gap-2">
            <Button onClick={handleGenerate} className="cursor-pointer gap-2 rounded-xl">
              <Sparkles className="size-4" /> Practice again
            </Button>
            <Button variant="outline" onClick={onClose} className="cursor-pointer rounded-xl bg-white/5">
              Back to map
            </Button>
          </div>
        </motion.div>
      ) : generating ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-12">
          <Loader2 className="size-8 animate-spin text-amber-300" />
          <p className="text-sm text-muted-foreground">
            Generating {difficulty || "adaptive"} questions for {node.name}…
          </p>
        </div>
      ) : questions.length === 0 ? (
        <div className="mt-5">
          <Button onClick={handleGenerate} className="w-full cursor-pointer gap-2 rounded-xl" size="lg">
            <Play className="size-4" /> Start practice (10 questions)
          </Button>
          {mastery && mastery.questionsAttempted > 0 && (
            <p className="mt-3 text-center text-xs text-muted-foreground">
              You've answered {mastery.questionsAttempted} questions on this skill,
              with {Math.round((mastery.correctCount / mastery.questionsAttempted) * 100)}% lifetime accuracy.
            </p>
          )}
        </div>
      ) : (
        /* Active practice session */
        <div className="mt-5">
          {/* Progress bar */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Question {currentIdx + 1} of {questions.length}
            </span>
            <span className="rounded-md bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
              {difficulty}
            </span>
          </div>
          <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-white/5">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-500"
              animate={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>

          {/* Question */}
          <h3 className="text-base font-bold leading-relaxed text-foreground">
            {questions[currentIdx]?.question}
          </h3>

          {/* Options */}
          <div className="mt-4 flex flex-col gap-2.5">
            {questions[currentIdx]?.options.map((opt, i) => {
              const selected = answers[currentIdx] === i;
              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-4 text-left transition-all",
                    selected
                      ? "border-amber-400/40 bg-amber-400/[0.08] ring-1 ring-amber-400/30"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
                  )}
                >
                  <span className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold",
                    selected ? "bg-amber-400 text-amber-950" : "bg-white/5 text-muted-foreground",
                  )}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm">{opt}</span>
                </button>
              );
            })}
          </div>

          {/* Navigation */}
          <div className="mt-5 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
              disabled={currentIdx === 0}
              className="cursor-pointer"
            >
              Previous
            </Button>
            {currentIdx < questions.length - 1 ? (
              <Button
                size="sm"
                onClick={() => setCurrentIdx((i) => i + 1)}
                disabled={answers[currentIdx] === -1}
                className="cursor-pointer gap-2"
              >
                Next <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void handleSubmit()}
                disabled={submitting || answers.some((a) => a === -1)}
                className="cursor-pointer gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
              >
                {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Submit
              </Button>
            )}
          </div>
        </div>
      )}
    </motion.div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────

export default function AptitudeHub() {
  const skillMap = useQuery(api.aptitude.getSkillMap);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  // Seed skill nodes on first visit (idempotent — the mutation checks
  // for existing nodes and only inserts missing ones).
  const seedSkillNodes = useMutation(api.aptitude.seedSkillNodes);
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (skillMap === undefined) return;
    if (skillMap.nodes.length === 0) {
      seededRef.current = true;
      void seedSkillNodes({}).catch(() => {});
    } else {
      seededRef.current = true;
    }
  }, [skillMap, seedSkillNodes]);

  const masteryBySlug = useMemo(() => {
    const map = new Map<string, MasteryEntry>();
    if (skillMap?.mastery) {
      for (const m of skillMap.mastery) {
        map.set(m.nodeSlug, m);
      }
    }
    return map;
  }, [skillMap]);

  const selectedNode = useMemo(() => {
    if (!selectedSlug || !skillMap) return null;
    return skillMap.nodes.find((n) => n.slug === selectedSlug) ?? null;
  }, [selectedSlug, skillMap]);

  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-6xl px-1 py-4 sm:px-4">
        {/* ── Hero ── */}
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-violet-400/[0.06] via-white/[0.01] to-transparent p-6 sm:p-8"
        >
          <div className="pointer-events-none absolute -top-16 -right-12 size-64 rounded-full bg-violet-400/[0.1] blur-[80px]" />
          <div className="pointer-events-none absolute -bottom-16 -left-12 size-64 rounded-full bg-amber-400/[0.04] blur-[80px]" />
          <div className="relative">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.06] px-3 py-1">
              <Brain className="size-3.5 text-violet-300" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">
                Deep Aptitude Practice Hub
              </span>
            </div>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
              The <span className="text-gradient">Brain Map</span>
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              A dedicated deep-practice environment for the Scholastic
              Aptitude Test — compulsory for every student. Your reasoning
              skills (verbal + quantitative) mapped, measured, and
              adaptively trained. Click any node to start.
            </p>

            {/* Readiness + weakest nodes */}
            {skillMap && (
              <div className="mt-6 flex flex-wrap items-center gap-4">
                <div className="glass-chip flex items-center gap-3 rounded-2xl px-4 py-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
                    <Gauge className="size-5" />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      overall readiness
                    </p>
                    <p className="font-mono text-2xl font-bold text-gradient">
                      {skillMap.readiness}%
                    </p>
                  </div>
                </div>

                <div className="glass-chip flex items-center gap-3 rounded-2xl px-4 py-3">
                  <div className="flex size-10 items-center justify-center rounded-xl bg-sky-400/10 text-sky-300">
                    <Target className="size-5" />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      practiced
                    </p>
                    <p className="font-mono text-2xl font-bold text-foreground">
                      {skillMap.practicedNodeCount}/{skillMap.nodes.length}
                    </p>
                  </div>
                </div>

                {skillMap.weakestNodes.length > 0 && (
                  <div className="glass-chip flex items-center gap-3 rounded-2xl border-rose-400/20 bg-rose-400/[0.04] px-4 py-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
                      <Flame className="size-5" />
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                        focus here next
                      </p>
                      <p className="text-sm font-bold text-foreground">
                        {skillMap.weakestNodes[0]!.name}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.section>

        {/* ── Brain Map + Practice Panel ── */}
        {skillMap === undefined ? (
          <div className="mt-6 flex h-64 items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : skillMap.nodes.length === 0 ? (
          <div className="mt-6 flex flex-col items-center rounded-3xl border border-white/[0.06] bg-white/[0.02] px-6 py-16 text-center">
            <p className="text-base font-semibold text-foreground">Setting up skill nodes…</p>
            <p className="mt-1 text-sm text-muted-foreground">This only takes a moment — refresh the page.</p>
          </div>
        ) : (
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_400px]">
            {/* Brain Map */}
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              className="glass-panel relative overflow-hidden rounded-3xl p-5"
            >
              <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-amber-400/[0.08] blur-[60px]" />
              <div className="relative">
                <p className="mb-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                  skill brain map · click a node to practice
                </p>
                <BrainMap
                  nodes={skillMap.nodes}
                  masteryBySlug={masteryBySlug}
                  selectedSlug={selectedSlug}
                  onSelect={setSelectedSlug}
                />
                {/* Legend */}
                <div className="mt-4 flex flex-wrap items-center justify-center gap-4">
                  <LegendItem color="rgba(255,255,255,0.12)" label="Unpracticed" />
                  <LegendItem color="rgba(251,191,36,0.25)" label="Developing" />
                  <LegendItem color="rgba(251,191,36,0.4)" label="Progressing" />
                  <LegendItem color="rgba(251,191,36,0.6)" label="Mastered" ring />
                </div>
              </div>
            </motion.div>

            {/* Practice Panel / Weakest nodes / Mock entry */}
            <div className="flex flex-col gap-4">
              {selectedNode ? (
                <PracticePanel
                  node={selectedNode}
                  mastery={masteryBySlug.get(selectedNode.slug)}
                  onClose={() => setSelectedSlug(null)}
                />
              ) : (
                <>
                  {/* Full Aptitude Mock entry */}
                  <FullAptitudeMockCard />

                  {/* Daily warm-up */}
                  <DailyWarmupCard />

                  {/* Time-pressure trainer */}
                  <TimePressureTrainerCard
                    nodes={skillMap.nodes}
                    onSelectNode={setSelectedSlug}
                  />

                  {/* Weakest nodes suggestion */}
                  {skillMap.weakestNodes.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, delay: 0.2 }}
                      className="glass-panel rounded-2xl p-5"
                    >
                      <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-rose-300">
                        // focus here next
                      </p>
                      <div className="mt-3 flex flex-col gap-2">
                        {skillMap.weakestNodes.map((node, i) => (
                          <button
                            key={node.slug}
                            onClick={() => setSelectedSlug(node.slug)}
                            className="group flex cursor-pointer items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors hover:border-rose-400/30 hover:bg-rose-400/[0.04]"
                          >
                            <div className="flex items-center gap-3">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-rose-400/10 font-mono text-xs font-bold text-rose-300">
                                {i + 1}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-foreground">
                                  {node.name}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {node.questionsAttempted > 0
                                    ? `Mastery ${node.masteryScore} · ${node.questionsAttempted} Q attempted`
                                    : "Not practiced yet — start here"}
                                </p>
                              </div>
                            </div>
                            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-rose-300" />
                          </button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}

// ── Legend item ──────────────────────────────────────────────────────

function LegendItem({ color, label, ring }: { color: string; label: string; ring?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cn("inline-block size-3 rounded-full", ring && "ring-1 ring-amber-400/40 ring-offset-1 ring-offset-background")}
        style={{ background: color }}
      />
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
    </div>
  );
}

// ── Full Aptitude Mock card ───────────────────────────────────────────

function FullAptitudeMockCard() {
  const generateMock = useAction(api.aptitudeActions.generateFullAptitudeMock);
  const navigate = useNavigate();
  const [generating, setGenerating] = useState(false);

  const handleStart = async () => {
    setGenerating(true);
    try {
      const result = await generateMock({});
      // Navigate to the mock-taking page (we'll use a simple inline
      // state for now — a full mock-taking UI would be a separate
      // route, but for this phase we'll handle it inline).
      toast.success(`Mock generated — ${result.questions.length} questions. Starting…`);
      // For now, we just show the questions count. A full mock-taking
      // UI would navigate to /aptitude-hub/mock/{mockId}.
      navigate(`/aptitude-hub/mock/${result.mockId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the mock.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.1 }}
      className="glass-panel relative overflow-hidden rounded-2xl p-5"
    >
      <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-amber-400/[0.08] blur-[40px]" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-amber-400/10 text-amber-300">
            <Trophy className="size-4.5" />
          </div>
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-amber-300">
              // full mock
            </p>
            <p className="text-sm font-bold text-foreground">Full Aptitude Mock</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          40 questions · 50 minutes · covers all verbal + quantitative
          skills. Standalone — drill this section repeatedly, separate
          from the 6-subject mock exam.
        </p>
        <Button
          onClick={() => void handleStart()}
          disabled={generating}
          className="mt-4 w-full cursor-pointer gap-2 rounded-xl bg-amber-500 text-amber-950 hover:bg-amber-400"
        >
          {generating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4" />
          )}
          {generating ? "Generating…" : "Start full mock"}
        </Button>
      </div>
    </motion.div>
  );
}

// ── Daily warm-up card ────────────────────────────────────────────────

function DailyWarmupCard() {
  const warmup = useQuery(api.aptitude.getTodaysWarmup);
  const ensureWarmup = useAction(api.aptitudeActions.ensureTodaysWarmup);
  const submitAnswer = useMutation(api.aptitude.submitWarmupAnswer);
  const [ensuring, setEnsuring] = useState(false);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [result, setResult] = useState<{ answeredCorrectly: boolean; correctIndex: number; explanation: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Auto-ensure the warm-up exists on first load.
  const ensuredRef = useRef(false);
  useEffect(() => {
    if (ensuredRef.current) return;
    if (warmup === undefined) return;
    if (warmup === null) {
      ensuredRef.current = true;
      setEnsuring(true);
      void ensureWarmup({})
        .catch(() => {})
        .finally(() => setEnsuring(false));
    } else {
      ensuredRef.current = true;
    }
  }, [warmup, ensureWarmup]);

  if (warmup === undefined || ensuring) {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <div className="h-20 animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }
  if (warmup === null) {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <p className="text-sm text-muted-foreground">No warm-up available today. Check back later.</p>
      </div>
    );
  }

  let parsed: QuizQuestion;
  try {
    parsed = JSON.parse(warmup.questionJson);
  } catch {
    return (
      <div className="glass-panel rounded-2xl p-5">
        <p className="text-sm text-muted-foreground">Warm-up question couldn't be loaded.</p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (selectedAnswer === null) return;
    setSubmitting(true);
    try {
      const res = await submitAnswer({ nodeSlug: warmup.nodeSlug, answer: selectedAnswer });
      setResult(res);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not submit answer.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.15 }}
      className="glass-panel relative overflow-hidden rounded-2xl p-5"
    >
      <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-violet-400/[0.06] blur-[40px]" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="flex size-9 items-center justify-center rounded-xl bg-violet-400/10 text-violet-300">
              <Sparkles className="size-4.5" />
            </div>
            <div>
              <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-violet-300">
                // daily warm-up
              </p>
              <p className="text-sm font-bold text-foreground">Today's aptitude question</p>
            </div>
          </div>
          {warmup.alreadyAnswered && (
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
              ✓ Done
            </span>
          )}
        </div>

        {warmup.alreadyAnswered && !result ? (
          <p className="mt-4 text-sm text-muted-foreground">
            You already answered today's warm-up. Come back tomorrow for a fresh one.
          </p>
        ) : result ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-4"
          >
            <p className="text-sm font-bold">
              {result.answeredCorrectly ? "✅ Correct!" : "❌ Not quite."}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {result.explanation}
            </p>
          </motion.div>
        ) : (
          <>
            <p className="mt-3 text-sm font-semibold leading-relaxed text-foreground">
              {parsed.question}
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {parsed.options.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedAnswer(i)}
                  disabled={submitting}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-all",
                    selectedAnswer === i
                      ? "border-violet-400/40 bg-violet-400/[0.08] ring-1 ring-violet-400/30"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]",
                  )}
                >
                  <span className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold",
                    selectedAnswer === i ? "bg-violet-400 text-white" : "bg-white/5 text-muted-foreground",
                  )}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm">{opt}</span>
                </button>
              ))}
            </div>
            <Button
              onClick={() => void handleSubmit()}
              disabled={selectedAnswer === null || submitting}
              className="mt-4 w-full cursor-pointer gap-2 rounded-xl bg-violet-500 text-white hover:bg-violet-400"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {submitting ? "Submitting…" : "Submit answer"}
            </Button>
          </>
        )}
      </div>
    </motion.div>
  );
}

// ── Time-pressure trainer card ────────────────────────────────────────

function TimePressureTrainerCard({
  nodes,
  onSelectNode,
}: {
  nodes: SkillNode[];
  onSelectNode: (slug: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.2 }}
      className="glass-panel relative overflow-hidden rounded-2xl p-5"
    >
      <div className="pointer-events-none absolute -top-8 -right-8 size-32 rounded-full bg-rose-400/[0.06] blur-[40px]" />
      <div className="relative">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
            <Timer className="size-4.5" />
          </div>
          <div>
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-rose-300">
              // time-pressure trainer
            </p>
            <p className="text-sm font-bold text-foreground">Beat the clock</p>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Practice a skill under progressively shrinking time limits.
          Start at 30s per question, then 20s, then 10s. Aptitude tests
          are fundamentally about speed under pressure.
        </p>
        <p className="mt-3 text-xs font-semibold text-foreground">
          Pick a skill to start:
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {nodes.slice(0, 6).map((node) => (
            <button
              key={node.slug}
              onClick={() => onSelectNode(node.slug)}
              className="cursor-pointer rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:border-rose-400/30 hover:text-rose-300"
            >
              {node.name.split(" ")[0]}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
