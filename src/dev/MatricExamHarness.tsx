// Learnyx Matric OS — BROWSER TEST HARNESS (dev/test only).
//
// Mounted by matric-harness.html and driven by playwright/tests/matric-exam
// .spec.ts. It renders the REAL MatricPlayer and MatricResults components —
// the exact ones students use — with rich fixtures, so the tests assert what
// is actually painted (math typesetting, palette states, keyboard CBT
// controls, mobile layout) on desktop and mobile viewports.
//
// The Convex client points at an unroutable port: the player's autosave
// gracefully degrades to its "Offline — saved on this device" state, which
// is itself part of the verified behavior. Nothing here is reachable from
// the production bundle (no importers; matric-harness.html is not a build
// entry).

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { MatricPlayer } from "@/components/matric/MatricPlayer";
import { MatricResults } from "@/components/matric/MatricResults";
import type { ActiveSessionPayload } from "@/convex/matricEngine";
import type { MatricResultsPayload } from "@/convex/matricEngine";
import "@/index.css";

// ─── Player fixture — Grade 12 math with real LaTeX ───────────────────────

const STEM_ALIGNED = `Solve for $x$, showing every step:

$$
\\begin{aligned}
2x^2 - 8 &= 0 \\\\
2x^2 &= 8 \\\\
x^2 &= 4 \\\\
x &= \\pm 2
\\end{aligned}
$$`;

const STEM_FRACTION = `Simplify $\\frac{x^2 - 1}{x - 1}$ for $x \\neq 1$.`;

const STEM_PLAIN = `A geometric progression has first term $a = 3$ and common ratio $r = 2$. What is the 5th term?`;

const STEM_QUADRATIC = `Which of the following is a root of $x^2 - 5x + 6 = 0$?`;

function choice(label: string, text: string) {
  return { label, text };
}

const PLAYER_FIXTURE: ActiveSessionPayload = {
  sessionId: "harness-session-000000000000" as never,
  title: "Mathematics Subject Mock · v1",
  mode: "subject_mock",
  blueprintKey: "subject-mock:selftest",
  questionCount: 5,
  timeLimitSeconds: 45 * 60,
  startedAt: Date.now() - 5 * 60 * 1000,
  deadlineAt: Date.now() + 40 * 60 * 1000,
  serverNow: Date.now(),
  remainingSeconds: 40 * 60,
  sections: [
    {
      subjectId: "subj-harness" as never,
      subjectName: "Mathematics",
      startIndex: 0,
      endIndex: 5,
      questionCount: 5,
    },
  ],
  questions: [
    {
      i: 0,
      vaultId: "v1",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 3,
      subjectId: "subj-harness" as never,
      subjectName: "Mathematics",
      stem: STEM_ALIGNED,
      choices: [
        choice("A", "$x = 2$ only"),
        choice("B", "$x = \\pm 2$"),
        choice("C", "$x = -2$ only"),
        choice("D", "No real solution"),
      ],
      topicId: "topic-1" as never,
      topicText: "Quadratic Equations",
      examYear: 2015,
      sourcePage: 3,
    },
    {
      i: 1,
      vaultId: "v2",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 7,
      subjectId: "subj-harness" as never,
      subjectName: "Mathematics",
      stem: STEM_FRACTION,
      passage: `Read the definition first: a rational expression is a quotient of two polynomials. Simplify the expression below.`,
      choices: [
        choice("A", "$x + 1$"),
        choice("B", "$x - 1$"),
        choice("C", "$\\frac{1}{x-1}$"),
        choice("D", "$1 - x$"),
      ],
      topicText: "Algebraic Fractions",
      examYear: 2015,
      sourcePage: 5,
    },
    {
      i: 2,
      vaultId: "v3",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 12,
      subjectId: "subj-harness" as never,
      subjectName: "Mathematics",
      stem: STEM_PLAIN,
      choices: [
        choice("A", "$48$"),
        choice("B", "$24$"),
        choice("C", "$96$"),
        choice("D", "$81$"),
      ],
      topicText: "Sequences and Series",
      examYear: 2016,
      sourcePage: 9,
      figureHint: true,
    },
    {
      i: 3,
      vaultId: "v4",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 15,
      subjectId: "subj-harness" as never,
      subjectName: "Mathematics",
      stem: STEM_QUADRATIC,
      choices: [
        choice("A", "$x = 1$"),
        choice("B", "$x = 2$"),
        choice("C", "$x = 3$"),
        choice("D", "$x = 6$"),
      ],
      topicText: "Quadratic Equations",
      examYear: 2017,
      sourcePage: 11,
    },
    {
      i: 4,
      vaultId: "v5",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 18,
      subjectId: "subj-harness" as never,
      subjectName: "Mathematics",
      stem: `If $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$, what is $\\sum_{k=1}^{10} k$?`,
      choices: [
        choice("A", "$50$"),
        choice("B", "$55$"),
        choice("C", "$100$"),
        choice("D", "$110$"),
      ],
      topicText: "Series",
      examYear: 2018,
      sourcePage: 14,
    },
  ],
  answers: ["", "", "", "", ""],
  flags: [false, false, false, false, false],
  timeMs: [0, 0, 0, 0, 0],
};

// ─── Results fixture — the full Learnyx loop ──────────────────────────────

const RESULTS_FIXTURE: MatricResultsPayload = {
  sessionId: "harness-session-000000000000" as never,
  title: "Mathematics Subject Mock · v1",
  mode: "subject_mock",
  blueprintKey: "subject-mock:selftest",
  status: "graded",
  submissionSource: "student",
  stream: "common",
  exploredOtherStream: false,
  scorePct: 60,
  correctCount: 3,
  incorrectCount: 1,
  unansweredCount: 1,
  totalQuestions: 5,
  timeSpentSeconds: 1320,
  timeLimitSeconds: 2700,
  gradedAt: Date.now() - 60 * 1000,
  perQuestion: [
    {
      index: 0,
      vaultId: "v1",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 3,
      answered: true,
      correct: true,
      studentAnswerLabel: "B",
      studentAnswerText: "$x = \\pm 2$",
      correctAnswerLabel: "B",
      correctAnswerText: "$x = \\pm 2$",
      stem: STEM_ALIGNED,
      choices: PLAYER_FIXTURE.questions[0]!.choices,
      explanation:
        "Factor and divide by 2: $x^2 = 4$, so $x = \\pm 2$. Both roots satisfy the original equation $2x^2 - 8 = 0$.",
      topicId: "topic-1" as never,
      topicText: "Quadratic Equations",
      sourcePage: 3,
      examYear: 2015,
    },
    {
      index: 1,
      vaultId: "v2",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 7,
      answered: true,
      correct: false,
      studentAnswerLabel: "B",
      studentAnswerText: "$x - 1$",
      correctAnswerLabel: "A",
      correctAnswerText: "$x + 1$",
      stem: STEM_FRACTION,
      choices: PLAYER_FIXTURE.questions[1]!.choices,
      explanation:
        "$x^2 - 1 = (x-1)(x+1)$, so $\\frac{x^2-1}{x-1} = x + 1$ for $x \\neq 1$. The common factor is $(x - 1)$, not $(x + 1)$.",
      topicText: "Algebraic Fractions",
      sourcePage: 5,
      examYear: 2015,
    },
    {
      index: 2,
      vaultId: "v3",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 12,
      answered: true,
      correct: true,
      studentAnswerLabel: "A",
      studentAnswerText: "$48$",
      correctAnswerLabel: "A",
      correctAnswerText: "$48$",
      stem: STEM_PLAIN,
      choices: PLAYER_FIXTURE.questions[2]!.choices,
      explanation: "$T_5 = ar^{4} = 3 \\cdot 2^4 = 48$.",
      topicText: "Sequences and Series",
      sourcePage: 9,
      examYear: 2016,
    },
    {
      index: 3,
      vaultId: "v4",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 15,
      answered: true,
      correct: true,
      studentAnswerLabel: "C",
      studentAnswerText: "$x = 3$",
      correctAnswerLabel: "C",
      correctAnswerText: "$x = 3$",
      stem: STEM_QUADRATIC,
      choices: PLAYER_FIXTURE.questions[3]!.choices,
      explanation: "$(x-2)(x-3) = 0$ gives $x = 2$ or $x = 3$ — both appear, and $x = 3$ is option C.",
      topicText: "Quadratic Equations",
      sourcePage: 11,
      examYear: 2017,
    },
    {
      index: 4,
      vaultId: "v5",
      contentId: "paper-1" as never,
      paperTitle: "ESSLCE Mathematics 2015",
      questionNumber: 18,
      answered: false,
      correct: false,
      studentAnswerLabel: null,
      correctAnswerLabel: "B",
      correctAnswerText: "$55$",
      stem: `If $\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}$, what is $\\sum_{k=1}^{10} k$?`,
      choices: PLAYER_FIXTURE.questions[4]!.choices,
      explanation: "$\\frac{10 \\cdot 11}{2} = 55$.",
      topicText: "Series",
      sourcePage: 14,
      examYear: 2018,
    },
  ],
  subjectBreakdown: [
    { subjectId: "subj-harness" as never, subjectName: "Mathematics", correct: 3, total: 5, scorePct: 60 },
  ],
  topicBreakdown: [
    { key: "text:quadratic equations", topicText: "Quadratic Equations", subjectId: "subj-harness" as never, correct: 2, total: 2, scorePct: 100 },
    { key: "text:sequences and series", topicText: "Sequences and Series", subjectId: "subj-harness" as never, correct: 1, total: 2, scorePct: 50 },
    { key: "text:algebraic fractions", topicText: "Algebraic Fractions", subjectId: "subj-harness" as never, correct: 0, total: 1, scorePct: 0 },
  ],
  timeStats: { avgSeconds: 44, slowestSeconds: 120, fastestSeconds: 12 },
  comparison: {
    previousSessions: [
      { sessionId: "prev-1" as never, scorePct: 50, startedAt: Date.now() - 7 * 86400_000, title: "Mathematics Subject Mock · v1" },
      { sessionId: "prev-2" as never, scorePct: 40, startedAt: Date.now() - 14 * 86400_000, title: "Mathematics Subject Mock · v1" },
    ],
    deltaVsPrevious: 10,
  },
  nextActions: { dueMistakes: 4, weakestTopics: [{ topicText: "Algebraic Fractions", scorePct: 0 }] },
  xpAwarded: 56,
};

// ─── Hub fixture — stream-aware hub (MATRIC OS 2.1) ──────────────────────
// `?view=hub&stream=social|natural|none` renders the REAL MatricHub with
// fixtures for a Social Science / Natural Science / unselected student.

import { MatricHub } from "@/components/matric/MatricHub";
import type { CatalogPayload, MatricJourneyPayload, MatricHistoryRow, PastPaperOption } from "@/convex/matricEngine";

function hubFixtures(streamParam: string): {
  catalog: CatalogPayload;
  journey?: MatricJourneyPayload;
  history: MatricHistoryRow[];
  pastPaperOptions: PastPaperOption[];
} {
  const stream = streamParam === "natural" ? "natural" : streamParam === "social" ? "social" : null;
  const premium = streamParam !== "none"; // "none" also demos the premium state? keep premium on
  const mock = (
    id: number,
    subjectName: string,
    slug: string,
    streamTag: "natural" | "social" | "common",
    eligible: number,
    offered: boolean,
  ) => ({
    blueprintId: `bp-${id}` as never,
    key: `subject-mock:${slug}`,
    subjectName,
    slug,
    stream: streamTag,
    questionCount: eligible >= 40 ? 40 : eligible >= 20 ? 20 : 10,
    timeLimitSeconds: (eligible >= 40 ? 40 : eligible >= 20 ? 20 : 10) * 90,
    eligibleCount: eligible,
    adminVerifiedCount: Math.max(0, eligible - 2),
    paperCount: eligible > 0 ? Math.max(1, Math.round(eligible / 30)) : 0,
    offered,
  });

  const catalog: CatalogPayload = {
    subjectMocks: [
      mock(1, "English", "english", "common", 120, true),
      mock(2, "Mathematics", "mathematics", "common", 96, true),
      mock(3, "Scholastic Aptitude Test", "scholastic-aptitude-test", "common", 54, true),
      mock(4, "Geography", "geography", "social", 46, true),
      mock(5, "History", "history", "social", 45, true),
      mock(6, "Economics", "economics", "social", 45, true),
      mock(7, "Physics", "physics", "natural", 64, true),
      mock(8, "Chemistry", "chemistry", "natural", 51, true),
      mock(9, "Biology", "biology", "natural", 12, true),
    ],
    fullSimulations: [
      {
        blueprintId: "bp-sim-natural" as never,
        key: "full-simulation:natural",
        stream: "natural",
        title: "Full Matric Simulation — Natural Science",
        totalQuestions: 150,
        timeLimitSeconds: 150 * 90,
        subjects: [
          { subjectName: "English", questionCount: 30, eligibleCount: 120 },
          { subjectName: "Mathematics", questionCount: 30, eligibleCount: 96 },
          { subjectName: "Physics", questionCount: 30, eligibleCount: 64 },
          { subjectName: "Chemistry", questionCount: 30, eligibleCount: 51 },
          { subjectName: "Biology", questionCount: 30, eligibleCount: 12 },
        ],
        offered: false, // Biology is short → honest unavailability
      },
      {
        blueprintId: "bp-sim-social" as never,
        key: "full-simulation:social",
        stream: "social",
        title: "Full Matric Simulation — Social Science",
        totalQuestions: 150,
        timeLimitSeconds: 150 * 90,
        subjects: [
          { subjectName: "English", questionCount: 30, eligibleCount: 120 },
          { subjectName: "Mathematics", questionCount: 30, eligibleCount: 96 },
          { subjectName: "Geography", questionCount: 30, eligibleCount: 46 },
          { subjectName: "History", questionCount: 30, eligibleCount: 45 },
          { subjectName: "Economics", questionCount: 30, eligibleCount: 45 },
        ],
        offered: true,
      },
    ],
    weakness: {
      blueprintId: "bp-weakness" as never,
      title: "Weakness Challenge",
      description:
        "A 15-question challenge built from YOUR weakest topics (real evidence from your mistakes and mastery). Learnyx practice configuration.",
    },
    pastPaper: { blueprintId: "bp-pastpaper" as never },
    premium,
    hasActiveSession: false,
    activeSessionId: null,
    activeSessionTitle: null,
    studentStream: stream,
    studentStreamLabel:
      stream === "natural" ? "Natural Science" : stream === "social" ? "Social Science" : null,
    gradeLevel: streamParam === "none" ? null : 12,
  };

  const journey: MatricJourneyPayload =
    stream === null
      ? {
          kind: "start",
          sessionId: null,
          blueprintId: "bp-1" as never,
          title: "English Subject Mock",
          subjectName: "English",
          mode: "subject_mock",
          questionCount: 40,
          timeLimitSeconds: 40 * 90,
          stream: null,
          streamLabel: null,
          reason:
            "Based on available verified questions. Set your stream in Settings to get stream-tailored recommendations.",
          review: { dueMistakes: 3, weakestSubjectName: null, weakestScorePct: null },
        }
      : {
          kind: "start",
          sessionId: null,
          blueprintId: "bp-4" as never,
          title: "Geography Subject Mock",
          subjectName: "Geography",
          mode: "subject_mock",
          questionCount: 20,
          timeLimitSeconds: 20 * 90,
          stream,
          streamLabel: stream === "natural" ? "Natural Science" : "Social Science",
          reason:
            "Your lowest recent average is 48% in Geography — this mock targets exactly that, based on your graded sittings.",
          review: { dueMistakes: 4, weakestSubjectName: "Geography", weakestScorePct: 48 },
        };

  const history: MatricHistoryRow[] = [
    {
      sessionId: "hs-1" as never,
      title: "Geography Subject Mock",
      mode: "subject_mock",
      status: "graded",
      scorePct: 48,
      questionCount: 20,
      startedAt: Date.now() - 2 * 86400_000,
      timeSpentSeconds: 1620,
      submissionSource: "student",
      stream: "social",
      exploredOtherStream: false,
      primarySubjectName: "Geography",
    },
    {
      sessionId: "hs-2" as never,
      title: "Mathematics Subject Mock",
      mode: "subject_mock",
      status: "graded",
      scorePct: 66,
      questionCount: 20,
      startedAt: Date.now() - 5 * 86400_000,
      timeSpentSeconds: 1500,
      submissionSource: "student",
      stream: "common",
      exploredOtherStream: false,
      primarySubjectName: "Mathematics",
    },
    {
      sessionId: "hs-3" as never,
      title: "Physics Subject Mock",
      mode: "subject_mock",
      status: "graded",
      scorePct: 55,
      questionCount: 20,
      startedAt: Date.now() - 7 * 86400_000,
      timeSpentSeconds: 1700,
      submissionSource: "student",
      stream: "natural",
      exploredOtherStream: true,
      primarySubjectName: "Physics",
    },
    {
      sessionId: "hs-4" as never,
      title: "Full Matric Simulation — Social Science",
      mode: "full_simulation",
      status: "expired",
      scorePct: null,
      questionCount: 120,
      startedAt: Date.now() - 9 * 86400_000,
      timeSpentSeconds: null,
      submissionSource: "auto_expiry",
      stream: "social",
      exploredOtherStream: false,
      primarySubjectName: "English",
    },
  ];

  const pastPaperOptions: PastPaperOption[] = [
    {
      contentId: "pp-1" as never,
      title: "ESSLCE Geography 2018",
      subjectName: "Geography",
      stream: "social",
      examYear: 2018,
      durationMinutes: 45,
      isPremium: true,
      eligibleCount: 32,
    },
    {
      contentId: "pp-2" as never,
      title: "ESSLCE History 2017",
      subjectName: "History",
      stream: "social",
      examYear: 2017,
      durationMinutes: 45,
      isPremium: true,
      eligibleCount: 24,
    },
    {
      contentId: "pp-3" as never,
      title: "ESSLCE Physics 2018",
      subjectName: "Physics",
      stream: "natural",
      examYear: 2018,
      durationMinutes: 60,
      isPremium: true,
      eligibleCount: 40,
    },
  ];

  return { catalog, journey, history, pastPaperOptions };
}

// ─── Mount ────────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const view = params.get("view") ?? "player";
const hubStream = params.get("stream") ?? "social";
// Unroutable port — the player's autosave fails → honest "offline" state.
const client = new ConvexReactClient("http://127.0.0.1:65535");

const HUB_FIXTURES = hubFixtures(hubStream);

const app = (
  <StrictMode>
    <ConvexProvider client={client}>
      <MemoryRouter initialEntries={["/mock-exam"]}>
        {/* Same shell padding as the real page (MatricExam.tsx) — the
            player's sticky header uses negative margins matched to it. */}
        <div className="min-h-screen w-full bg-background px-4 py-6 sm:px-6 sm:py-8">
          <div className="mx-auto max-w-5xl">
            {view === "player" ? (
              <MatricPlayer
                payload={PLAYER_FIXTURE}
                onSubmitted={() => {
                  const el = document.createElement("div");
                  el.id = "submitted";
                  document.body.appendChild(el);
                }}
                onExit={() => {
                  const el = document.createElement("div");
                  el.id = "exited";
                  document.body.appendChild(el);
                }}
              />
            ) : view === "hub" ? (
              <MatricHub
                catalog={HUB_FIXTURES.catalog}
                history={HUB_FIXTURES.history}
                pastPaperOptions={HUB_FIXTURES.pastPaperOptions}
                journey={HUB_FIXTURES.journey}
                starting={false}
                onStart={(blueprintId, pastPaperContentId, exploreOtherStream) => {
                  const el = document.createElement("div");
                  el.id = "hub-started";
                  el.dataset.blueprintId = String(blueprintId);
                  el.dataset.pastPaperContentId = pastPaperContentId ?? "";
                  el.dataset.exploreOtherStream = exploreOtherStream ? "1" : "0";
                  document.body.appendChild(el);
                }}
                onResume={() => {
                  const el = document.createElement("div");
                  el.id = "hub-resumed";
                  document.body.appendChild(el);
                }}
                onOpenResults={() => {
                  const el = document.createElement("div");
                  el.id = "hub-results";
                  document.body.appendChild(el);
                }}
              />
            ) : (
              <MatricResults
                results={RESULTS_FIXTURE}
                onBackToHub={() => {
                  const el = document.createElement("div");
                  el.id = "back-to-hub";
                  document.body.appendChild(el);
                }}
                onViewHistory={() => {
                  const el = document.createElement("div");
                  el.id = "view-history";
                  document.body.appendChild(el);
                }}
              />
            )}
          </div>
        </div>
      </MemoryRouter>
    </ConvexProvider>
  </StrictMode>
);

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(app);
}
