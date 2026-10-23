// MATRIC OS — Exam Hub (/mock-exam).
//
// Replaces the AI-dependent mock exam front-end. Four deterministic modes:
//   1. Full Matric Simulation  2. Subject Mock
//   3. Weakness Challenge      4. Past Paper Simulation
//
// Every mode is backed by the verified question vault — starting an exam
// makes ZERO AI requests. Coverage meters show exactly what the bank can
// support, and insufficient coverage fails gracefully with actionable
// reasons instead of a spinner of doom.

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  BookOpenCheck,
  Crown,
  Database,
  FileStack,
  History,
  Loader2,
  Lock,
  Play,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Zap,
} from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AuthRequiredPrompt } from "@/components/AuthRequiredPrompt";
import { PremiumPrompt } from "@/components/PremiumPrompt";
import { CbtPlayer } from "@/components/matric/CbtPlayer";
import { ResultsView } from "@/components/matric/ResultsView";
import type { GateReason } from "@/lib/premium";
import { cn } from "@/lib/utils";

const AdminMatricPanel = lazy(() =>
  import("@/components/matric/AdminMatricPanel").then((m) => ({ default: m.AdminMatricPanel })),
);

type View =
  | { kind: "hub" }
  | { kind: "player"; sessionId: Id<"matricSessions"> }
  | { kind: "results"; sessionId: Id<"matricSessions"> };

interface StartErrorDetails {
  subjectSlug?: string;
  subjectName?: string;
  available: number;
  requested?: number;
}

type PendingMode =
  | { mode: "full_simulation" }
  | { mode: "subject_mock"; subjectId: Id<"subjects"> }
  | { mode: "weakness_challenge" }
  | { mode: "past_paper"; contentId: Id<"contentItems"> };

/** Mirrors matricEngine.getModes' return shape. */
interface ModesData {
  stream: "natural" | "social";
  isPremium: boolean;
  bankVersion: number;
  totalVerified: number;
  vaultUpdatedAt: number;
  subjects: Array<{ id: Id<"subjects">; slug: string; name: string; stream: string; available: number }>;
  modes: {
    full_simulation: {
      available: boolean;
      kind: "full" | "reduced" | "insufficient";
      sections: Array<{
        subjectSlug: string;
        subjectName: string;
        requested: number;
        minutes: number;
        available: number;
        ok: boolean;
      }>;
    };
    subject_mock: { available: boolean };
    weakness_challenge: { available: boolean; weakTopicCount: number };
    past_paper: {
      available: boolean;
      papers: Array<{
        contentId: Id<"contentItems">;
        title: string;
        subjectId: Id<"subjects">;
        subjectSlug: string;
        examYear?: number;
        gradableCount: number;
        premium: boolean;
        durationMinutes?: number;
        verificationStatus: "verified" | "unverified";
        locked: boolean;
      }>;
    };
  };
}

export default function MatricExam() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: "hub" });
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [premiumReason, setPremiumReason] = useState<GateReason | null>(null);
  const [startError, setStartError] = useState<{
    code: string;
    message: string;
    details?: StartErrorDetails[];
  } | null>(null);
  const [pendingMode, setPendingMode] = useState<PendingMode | null>(null);

  const activeSession = useQuery(api.matricEngine.getActiveSession, {});
  const modes = useQuery(api.matricEngine.getModes, {});
  const history = useQuery(api.matricEngine.getHistory, { limit: 8 });
  const adminInfo = useQuery(api.admin.isCurrentUserAdmin, {});
  const startSession = useMutation(api.matricEngine.startSession);

  if (isLoading) {
    return (
      <DashboardShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <DashboardShell>
        <AuthRequiredPrompt
          title="Sign in to sit Matric OS exams"
          description="Create a free account to take deterministic, zero-AI mock exams built from verified questions."
          returnTo="/mock-exam"
        />
      </DashboardShell>
    );
  }

  const handleStartError = (e: unknown) => {
    const data = (e as { data?: { code?: string; message?: string; details?: unknown } })?.data;
    const code = data?.code ?? "unknown";
    const message = data?.message ?? (e instanceof Error ? e.message : "Could not start the exam.");
    if (code === "premium_mock_exams") {
      setPremiumReason("premium_mock_exams");
    } else if (code === "auth_required") {
      setAuthPromptOpen(true);
    } else if (code === "session_in_progress") {
      toast.error("You already have an exam in progress — resume it from the banner above.");
    } else {
      const details = Array.isArray(data?.details)
        ? (data?.details as StartErrorDetails[])
        : undefined;
      setStartError({ code, message, details });
      toast.error(message);
    }
  };

  const begin = async (mode: PendingMode) => {
    setPendingMode(mode);
    setStartError(null);
    try {
      const res = await startSession({
        mode: mode.mode,
        subjectId: mode.mode === "subject_mock" ? mode.subjectId : undefined,
        contentId: mode.mode === "past_paper" ? mode.contentId : undefined,
      });
      toast.success(`Exam ready — ${res.questionCount} verified questions.`);
      setView({ kind: "player", sessionId: res.sessionId });
    } catch (e) {
      handleStartError(e);
    } finally {
      setPendingMode(null);
    }
  };

  if (view.kind === "player") {
    return (
      <DashboardShell>
        <CbtPlayer
          sessionId={view.sessionId}
          onFinished={() => setView({ kind: "results", sessionId: view.sessionId })}
          onAbandoned={() => setView({ kind: "hub" })}
        />
      </DashboardShell>
    );
  }

  if (view.kind === "results") {
    return (
      <DashboardShell>
        <ResultsView sessionId={view.sessionId} onBack={() => setView({ kind: "hub" })} />
      </DashboardShell>
    );
  }

  const modeData = modes as ModesData | null | undefined;
  const bankTotal = modeData?.totalVerified ?? 0;

  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
              Matric OS
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <ShieldCheck className="size-3" />
                Zero-AI engine
              </Badge>
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Deterministic mock exams assembled from verified questions. No generation, no rate limits,
              no lost answers — start, refresh, resume, submit, get graded.
            </p>
          </div>
          <Badge variant="outline" className="gap-1 font-mono text-[10px]">
            <Database className="size-3" />
            bank v{modeData?.bankVersion ?? 0} · {bankTotal} verified
          </Badge>
        </div>

        {/* Resume banner */}
        {activeSession && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/10 p-4">
            <div className="flex items-center gap-3">
              <Timer className="size-5 text-primary" />
              <div>
                <p className="text-sm font-semibold">{activeSession.title} is in progress</p>
                <p className="text-xs text-muted-foreground">
                  {activeSession.questionCount} questions · server deadline enforced · your answers are saved
                </p>
              </div>
            </div>
            <Button className="cursor-pointer" onClick={() => setView({ kind: "player", sessionId: activeSession.sessionId })}>
              <Play className="size-4" />
              Resume exam
            </Button>
          </div>
        )}

        {/* Modes */}
        {modeData === undefined ? (
          <div className="flex justify-center py-10">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : modeData === null ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            Sign in with a real account to see your exam modes.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <FullSimulationCard modeData={modeData} pending={pendingMode?.mode === "full_simulation"} onStart={() => begin({ mode: "full_simulation" })} />
            <SubjectMockCard modeData={modeData} pending={pendingMode?.mode === "subject_mock"} onStart={(subjectId) => begin({ mode: "subject_mock", subjectId })} />
            <WeaknessCard modeData={modeData} pending={pendingMode?.mode === "weakness_challenge"} onStart={() => begin({ mode: "weakness_challenge" })} />
            <PastPaperCard modeData={modeData} pending={pendingMode?.mode === "past_paper"} onStart={(contentId) => begin({ mode: "past_paper", contentId })} />
          </div>
        )}

        {/* Start error details */}
        {startError && (
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">{startError.message}</p>
            {startError.details && startError.details.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {startError.details.map((d, i) => (
                  <li key={i}>
                    {d.subjectName ?? d.subjectSlug}: {d.available} verified available
                    {d.requested ? ` (blueprint asks ${d.requested})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* History */}
        {history && history.length > 0 && (
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
              <History className="size-4 text-muted-foreground" />
              Recent sittings
            </h2>
            <div className="mt-3 space-y-1.5">
              {history.map((h) => (
                <button
                  key={h.sessionId}
                  disabled={h.status !== "GRADED"}
                  onClick={() => setView({ kind: "results", sessionId: h.sessionId })}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors",
                    h.status === "GRADED"
                      ? "cursor-pointer hover:border-primary/40 hover:bg-muted/40"
                      : "opacity-70",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {h.title}
                    {h.reducedPractice && <span className="ml-1 text-[10px] text-muted-foreground">· reduced</span>}
                  </span>
                  <StatusChip status={h.status} />
                  {h.totalScore !== undefined && (
                    <span className="font-mono text-xs font-bold tabular-nums">{h.totalScore}%</span>
                  )}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Admin panel */}
        {adminInfo?.isAdmin && (
          <Suspense fallback={null}>
            <AdminMatricPanel />
          </Suspense>
        )}
      </div>

      {/* Premium gate */}
      <PremiumPrompt
        open={premiumReason !== null}
        onOpenChange={(o) => {
          if (!o) setPremiumReason(null);
        }}
        reason={premiumReason ?? "premium_mock_exams"}
      />

      {/* Auth prompt */}
      {authPromptOpen && (
        <AuthRequiredPrompt
          title="Mock exams need a real account"
          description="Create a free account to sit Matric OS exams — sign in with email or Google."
          returnTo="/mock-exam"
        />
      )}
    </DashboardShell>
  );
}

// ── Mode cards ────────────────────────────────────────────────────────

function CoverageBar({ available, requested }: { available: number; requested: number }) {
  const pct = requested > 0 ? Math.min(100, Math.round((available / requested) * 100)) : 0;
  const ok = available >= requested;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", ok ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-destructive")}
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>
      <span className="w-16 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
        {available}/{requested}
      </span>
    </div>
  );
}

function FullSimulationCard({
  modeData,
  pending,
  onStart,
}: {
  modeData: ModesData;
  pending: boolean;
  onStart: () => void;
}) {
  const full = (modeData as any).modes.full_simulation;
  const disabled = !full?.available;
  return (
    <ModeCard
      icon={<Crown className="size-5" />}
      title="Full Matric Simulation"
      subtitle="English · Maths · SAT + your stream subjects"
      badge={modeData.isPremium ? undefined : { label: "Premium", icon: <Lock className="size-3" /> }}
      body={
        <div className="space-y-1.5">
          {(full?.sections ?? []).map((s: any) => (
            <div key={s.subjectSlug}>
              <div className="mb-0.5 flex justify-between text-[11px] text-muted-foreground">
                <span>{s.subjectName}</span>
                <span className="font-mono">{s.minutes}m</span>
              </div>
              <CoverageBar available={s.available} requested={s.requested} />
            </div>
          ))}
        </div>
      }
      footer={
        disabled ? (
          <Button variant="outline" disabled className="w-full cursor-not-allowed">
            <Lock className="size-4" />
            Insufficient verified coverage
          </Button>
        ) : (
          <Button className="w-full cursor-pointer" onClick={onStart} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            {full?.kind === "reduced" ? "Start reduced practice" : "Start full simulation"}
          </Button>
        )
      }
    />
  );
}

function SubjectMockCard({
  modeData,
  pending,
  onStart,
}: {
  modeData: ModesData;
  pending: boolean;
  onStart: (subjectId: Id<"subjects">) => void;
}) {
  const subjects = (modeData as any).subjects as Array<{
    id: Id<"subjects">;
    name: string;
    available: number;
  }>;
  const usable = subjects.filter((s) => s.available >= 10);
  return (
    <ModeCard
      icon={<BookOpenCheck className="size-5" />}
      title="Subject Mock"
      subtitle="One subject · 40 questions · 40 minutes"
      badge={modeData.isPremium ? undefined : { label: "Premium", icon: <Lock className="size-3" /> }}
      body={
        usable.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {usable.slice(0, 8).map((s) => (
              <button
                key={s.id}
                disabled={pending}
                onClick={() => onStart(s.id)}
                className="cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:cursor-wait"
              >
                {s.name}
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{s.available}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No subject has 10+ verified questions yet. Admins can sync past papers from the Matric panel below.
          </p>
        )
      }
      footer={
        <p className="text-[11px] text-muted-foreground">
          Pick a subject to start instantly — assembly takes under a second, no AI involved.
        </p>
      }
    />
  );
}

function WeaknessCard({
  modeData,
  pending,
  onStart,
}: {
  modeData: ModesData;
  pending: boolean;
  onStart: () => void;
}) {
  const weak = (modeData as any).modes.weakness_challenge;
  return (
    <ModeCard
      icon={<Target className="size-5" />}
      title="Weakness Challenge"
      subtitle="Strikes your weakest topics from real results"
      badge={{ label: "Free", icon: <Sparkles className="size-3" /> }}
      body={
        <p className="text-xs leading-relaxed text-muted-foreground">
          {weak?.available
            ? `${weak.weakTopicCount} weak topic${weak.weakTopicCount === 1 ? "" : "s"} detected from your results evidence. A short 20-question drill targets exactly those concepts.`
            : "Take a Subject Mock or practice past papers first — this mode is powered by the results they generate."}
        </p>
      }
      footer={
        <Button className="w-full cursor-pointer" onClick={onStart} disabled={!weak?.available || pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
          {weak?.available ? "Start weakness drill" : "Needs result evidence"}
        </Button>
      }
    />
  );
}

function PastPaperCard({
  modeData,
  pending,
  onStart,
}: {
  modeData: ModesData;
  pending: boolean;
  onStart: (contentId: Id<"contentItems">) => void;
}) {
  const papers = ((modeData as any).modes.past_paper ?? []) as Array<{
    contentId: Id<"contentItems">;
    title: string;
    examYear?: number;
    gradableCount: number;
    premium: boolean;
    locked: boolean;
    durationMinutes?: number;
  }>;
  return (
    <ModeCard
      icon={<FileStack className="size-5" />}
      title="Past Paper Simulation"
      subtitle="Sit a real digitized paper end-to-end"
      badge={modeData.isPremium ? undefined : { label: "Premium", icon: <Lock className="size-3" /> }}
      body={
        papers.length > 0 ? (
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {papers.map((p) => (
              <button
                key={p.contentId}
                disabled={pending}
                onClick={() => onStart(p.contentId)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/10 disabled:cursor-wait"
              >
                <span className="min-w-0 flex-1 truncate">
                  {p.title}
                  {p.examYear ? <span className="ml-1 text-muted-foreground">· {p.examYear}</span> : null}
                </span>
                {p.locked ? (
                  <Lock className="size-3 shrink-0 text-amber-500" />
                ) : (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{p.gradableCount}Q</span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No verified past papers in the vault yet. Admins: run Seed starter bank + Sync vault below.
          </p>
        )
      }
      footer={<p className="text-[11px] text-muted-foreground">Timed like the real sitting using the paper's own duration.</p>}
    />
  );
}

function ModeCard({
  icon,
  title,
  subtitle,
  badge,
  body,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge?: { label: string; icon: React.ReactNode };
  body: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <h3 className="text-sm font-bold tracking-tight">{title}</h3>
            <p className="text-[11px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {badge && (
          <Badge variant="outline" className="shrink-0 gap-1 text-[10px]">
            {badge.icon}
            {badge.label}
          </Badge>
        )}
      </div>
      <div className="my-4 flex-1">{body}</div>
      {footer}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    GRADED: { label: "graded", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
    ACTIVE: { label: "in progress", className: "border-primary/40 bg-primary/10 text-primary" },
    EXPIRED: { label: "expired", className: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400" },
    INVALIDATED: { label: "abandoned", className: "border-muted bg-muted text-muted-foreground" },
    SUBMITTED: { label: "grading…", className: "border-primary/40 bg-primary/10 text-primary" },
    CREATED: { label: "starting…", className: "border-muted bg-muted text-muted-foreground" },
  };
  const chip =
    map[status] ?? { label: status.toLowerCase(), className: "border-muted bg-muted text-muted-foreground" };
  return (
    <Badge variant="outline" className={cn("shrink-0 text-[10px]", chip.className)}>
      {chip.label}
    </Badge>
  );
}
