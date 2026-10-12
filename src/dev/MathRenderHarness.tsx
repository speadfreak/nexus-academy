// Learnyx Math Renderer — BROWSER TEST HARNESS (dev/test only).
//
// Mounted by math-harness.html (a standalone Vite entry) and driven by
// playwright/tests/math-render.spec.ts. It renders the EXACT components the
// Tutor uses — AiText → LearnyxMathRenderer (react-markdown + remark-math +
// rehype-katex) with the real .lyx-md stylesheet — so the tests assert what
// a student's browser actually paints, on desktop and mobile, without
// needing a live Convex/Groq backend.
//
// Not reachable from the production bundle: nothing imports this module and
// math-harness.html is not a build entry. tsconfig still typechecks it.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AiText } from "@/components/math";
import "@/index.css";

// ─── Fixtures — the real Grade 12 bug report ────────────────────────────

/** The full GP lesson: aligned derivations, inline math, currency, table. */
const GP_LESSON = `## Geometric Progression — Sum of the First n Terms

A **geometric progression** has the form

$$
a,\\ ar,\\ ar^2,\\ ar^3,\\ \\ldots
$$

with first term $a$ and common ratio $r$. The $n$th term is

$$
T_n = ar^{n-1}
$$

Deriving the sum formula:

$$
\\begin{aligned}
S_n - rS_n &= a - ar^n \\\\
S_n(1-r) &= a(1-r^n) \\\\
S_n &= \\frac{a(1-r^n)}{1-r}
\\end{aligned}
$$

So for $r \\neq 1$,

$$
S_n = \\frac{a(1-r^n)}{1-r}
$$

The first three terms for $a = 2$, $r = 1.2$:

\\[
\\begin{aligned}
T_1 &= 2(1.2)^0 = 2 \\\\
T_2 &= 2(1.2)^1 = 2.4 \\\\
T_3 &= 2(1.2)^2 = 2.88
\\end{aligned}
\\]

Because $|r| = 1.2 \\ge 1$, the infinite series $\\sum_{n=0}^{\\infty} ar^n$
**diverges** — there is no finite sum to infinity.

| $n$ | $T_n$ |
|-----|-------|
| 1 | $2$ |
| 2 | $2.4$ |
| 3 | $2.88$ |

A student deposits $500 in the first month and increases the deposit by 3%
each month, so the ratio is $r = 1.03$.`;

/** Stored-message shape: reply truncated mid-aligned, marker appended. */
const TRUNCATED = `First, the common ratio is $r = 1.2$, so the series diverges. Derivation:

$$
\\begin{aligned}
S_n - rS_n &= a - ar^n \\\\
S_n(1-r) &= a(1-r^n) \\

*ⓘ The reply reached its length limit mid-answer. Say "continue" and I'll pick up exactly where I stopped.*`;

/** The continuation message that follows it. */
const CONTINUATION = `Continuing from where we stopped:

$$
S_n = \\frac{a(1-r^n)}{1-r}
$$

So the sum formula is $S_n = \\frac{a(1-r^n)}{1-r}$ for $r \\neq 1$, and the
series **diverges** when $|r| \\ge 1$.`;

// ─── Harness ────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const splitParam = params.get("split");
const splitAt = splitParam === null ? null : Number.parseInt(splitParam, 10);

function App() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "1.5rem" }}>
      <h1 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
        Learnyx Math Renderer — browser regression harness
      </h1>
      {splitAt !== null ? (
        // Streaming simulation: the lesson cut at an arbitrary character —
        // the renderer must stay readable at EVERY split position.
        <article
          id="streaming-message"
          className="lyx-message"
          data-testid="assistant-message"
        >
          <AiText text={GP_LESSON.slice(0, splitAt)} />
        </article>
      ) : (
        <>
          <section data-testid="assistant-message" id="msg-full">
            <AiText text={GP_LESSON} />
          </section>
          <section data-testid="assistant-message" id="msg-truncated">
            <AiText text={TRUNCATED} />
          </section>
          <section data-testid="assistant-message" id="msg-continuation">
            <AiText text={CONTINUATION} />
          </section>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
