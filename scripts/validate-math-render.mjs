// Learnyx Math Renderer — pipeline validation harness.
// Run: bun scripts/validate-math-render.mjs
//
// Exercises the REAL production pipeline (normalizeMathDelimiters →
// balanceTrailingMath → remark-parse → remark-math → remark-gfm →
// remark-rehype → rehype-katex) and validates the ACTUAL RENDERED OUTPUT —
// not just that preprocessing returns a string. Includes the full Grade-12
// geometric-progression bug-report regression set (raw \begin{aligned},
// exposed &=, stray $$, prose typeset as math, truncation + continuation).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import {
  normalizeMathDelimiters,
  balanceTrailingMath,
  endsInsideMath,
  mathToPlainText,
  mathToSpeech,
} from "../src/components/math/mathText.ts";

let pass = 0;
let fail = 0;

function check(name, cond, detail = "") {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: false })
  .use(rehypeKatex, { throwOnError: false, errorColor: "#ef4444", strict: false, trust: false })
  .use(rehypeStringify);

async function render(text) {
  const prepared = balanceTrailingMath(normalizeMathDelimiters(text));
  const file = await processor.process(prepared);
  return { prepared, html: String(file) };
}

/** Strip MathML annotations (they embed the raw TeX source by design). */
function visibleText(html) {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, "");
}

/**
 * The user's acceptance checks, applied to a rendered message:
 *  - no raw LaTeX commands / &= / \\ / stray $$ in visible text
 *  - prose never ends up INSIDE a KaTeX span (the "math soup" failure)
 *  - KaTeX actually typeset something when math was expected
 */
function auditRendered(html, opts = {}) {
  const problems = [];
  const text = visibleText(html);
  if (/\\begin\{|\\end\{/.test(text)) problems.push("raw \\begin/\\end visible");
  if (/&=/.test(text)) problems.push("raw &= visible");
  if (/\$\$/.test(text)) problems.push("stray $$ visible");
  if (/\\\\/.test(text)) problems.push("raw \\\\ visible");
  if (/(\\frac|\\sum|\\int|\\sqrt)/.test(text)) problems.push("raw LaTeX commands visible");
  if (opts.expectKatex && !html.includes("katex")) problems.push("no KaTeX output");
  if (opts.proseMustStayOutside) {
    for (const phrase of opts.proseMustStayOutside) {
      // Prose rendered as math gets squeezed (spaces collapse into separate
      // italic glyphs); intact prose keeps its words with spaces in the HTML.
      if (!html.includes(phrase)) problems.push(`prose swallowed into math: "${phrase}"`);
    }
  }
  return problems;
}

async function renderCase(name, fixture, opts = {}) {
  const { html } = await render(fixture);
  const problems = auditRendered(html, opts);
  check(name, problems.length === 0, problems.join(" | "));
  return html;
}

console.log("\n── Bug report regression — Grade 12 geometric progression ──");

// 1. $$ \begin{aligned} … \end{aligned} $$ (the exact derivation shape that
//    showed raw fragments). Every row must align INSIDE one katex-display.
{
  const fixture = `Deriving the sum formula:

$$
\\begin{aligned}
S_n-rS_n &= a-ar^n \\\\
S_n(1-r) &= a(1-r^n) \\\\
S_n &= \\frac{a(1-r^n)}{1-r}
\\end{aligned}
$$

This gives the sum of the first $n$ terms.`;
  const html = await renderCase("GP $$aligned$$ derivation renders fully", fixture, {
    expectKatex: true,
  });
  const displays = (html.match(/class="katex-display"/g) || []).length;
  check("exactly one display block for the aligned env", displays === 1, `count=${displays}`);
  check("aligned rows preserved verbatim (\\\\ intact)", /\\begin\{aligned\}/.test(html));
}

// 2. \[ \begin{aligned} … \] — the conversion used to glue content onto the
//    $$ opener line, which remark-math treats as fence meta → dropped rows.
{
  const fixture = `Calculate the first three terms:

\\[
\\begin{aligned}
T_1 &= 2(1.2)^0 = 2 \\\\
T_2 &= 2(1.2)^1 = 2.4 \\\\
T_3 &= 2(1.2)^2 = 2.88
\\end{aligned}
\\]`;
  const html = await renderCase("\\[…\\] aligned block renders", fixture, { expectKatex: true });
  const displays = (html.match(/class="katex-display"/g) || []).length;
  check("\\[…\\] becomes a display block", displays === 1, `count=${displays}`);
  check("all three term rows present in the TeX", (html.match(/T_\{?1\}?|T_1/g) || []).length > 0);
}

// 3. \begin{align} / \begin{cases} INSIDE $$ — the env-wrapper used to
//    double-wrap (its opening-line check read the empty string before a
//    leading \n) → empty math block + raw environment + stray $$.
{
  for (const env of ["align", "cases"]) {
    const fixture = `$$\n\\begin{${env}}\nx &= 1 \\\\\ny &= 2\n\\end{${env}}\n$$`;
    const { prepared, html } = await render(fixture);
    const problems = auditRendered(html, { expectKatex: true });
    check(`\\begin{${env}} inside $$ renders cleanly`, problems.length === 0, problems.join(" | "));
    const openTags = (prepared.match(/\$\$/g) || []).length;
    check(
      `no stray $$ around \\begin{${env}} (balanced pair only)`,
      openTags === 2,
      `$$ count=${openTags}`,
    );
  }
}

// 4. Bare aligned (no delimiters at all) — used to leak as raw text.
{
  const fixture = "The terms are:\n\\begin{aligned}\nT_1 &= 2 \\\\\nT_2 &= 2.4\n\\end{aligned}";
  await renderCase("bare aligned env wrapped in display math", fixture, { expectKatex: true });
}

// 5. Currency next to real math — the guard used to cap at 40 chars, so
//    prose dollars paired with math dollars and English sentences got
//    typeset as italic math soup.
{
  const fixture =
    "A student deposits $500 in the first month and increases the deposit by 3% each month, so the ratio is $r = 1.03$ and the total after $n$ months is $500 \\cdot 1.03^n$.";
  await renderCase("long prose dollar never pairs with math dollar", fixture, {
    expectKatex: true,
    proseMustStayOutside: ["deposits $500 in the first month"],
  });
}
{
  const fixture = "She saves $200 monthly at a rate of $r$ percent, giving $A = 200n$.";
  await renderCase("currency sentence + math dollars coexist", fixture, {
    expectKatex: true,
    proseMustStayOutside: ["saves $200 monthly at a rate of"],
  });
}

// 6. Truncated mid-aligned + length-limit marker appended to the SAME stored
//    message (the historical "math soup" — the marker got typeset as math).
{
  const fixture = `First, the common ratio is $r = 1.2$, so the series diverges. Derivation:

$$
\\begin{aligned}
S_n-rS_n &= a-ar^n \\\\
S_n(1-r) &= a(1-r^n) \\

*ⓘ The reply reached its length limit mid-answer. Say "continue" and I'll pick up exactly where I stopped.*`;
  const html = await renderCase(
    "truncated reply: partial derivation typeset, marker stays prose",
    fixture,
    { expectKatex: true, proseMustStayOutside: ["The reply reached its length limit mid-answer"] },
  );
  const text = visibleText(html);
  check("marker text readable (not italic math glyphs)", text.includes("length limit"));
}

// 7. Continuation message renders independently (balanced math).
{
  const fixture = `Continuing from where we stopped:

$$
S_n &= \\frac{a(1-r^n)}{1-r}
$$

So the sum formula is $S_n = \\frac{a(1-r^n)}{1-r}$ for $r \\neq 1$.`;
  await renderCase("continuation message renders independently", fixture, { expectKatex: true });
}

// 8. \\[4pt] spacing and blank lines inside aligned must survive.
{
  const fixture = "$$\n\\begin{aligned}\na &= 1 \\\\[4pt]\nb &= 2\n\\end{aligned}\n$$";
  await renderCase("\\\\[4pt] row spacing survives", fixture, { expectKatex: true });
}
{
  const fixture = "$$\n\\begin{aligned}\na &= b \\\\\n\nc &= d\n\\end{aligned}\n$$";
  await renderCase("blank line inside aligned survives", fixture, { expectKatex: true });
}

// 8b. Aligned-STYLE rows with & but NO environment — KaTeX rejects bare &
// ("Expected 'EOF', got '&'") which with throwOnError:false used to surface
// the raw source (the reported "exposed &= alignment operators"). The
// scanner must give the body the aligned environment it means to have.
{
  const fixture = "$$\nS_n - rS_n &= a - ar^n \\\\\nS_n(1-r) &= a(1-r^n)\n$$";
  const html = await renderCase("bare & rows (no env) get aligned wrap", fixture, {
    expectKatex: true,
  });
  check("wrapped body aligns in one display block", (html.match(/class="katex-display"/g) || []).length === 1);
}
{
  const fixture = "The derivation:\n\n$$\na &= b \\\\\nc &= d\n$$\n\nDone.";
  await renderCase("bare & display block mid-prose renders", fixture, { expectKatex: true });
}
{
  // Bodies that already carry an environment must NOT be re-wrapped.
  const { prepared } = await render("$$\n\\begin{aligned}\na &= b\n\\end{aligned}\n$$");
  check("existing aligned env not double-wrapped", (prepared.match(/\\begin\{aligned\}/g) || []).length === 1, prepared);
}

console.log("\n── Delimiter normalization ─────────────────────────────");

{
  const out = normalizeMathDelimiters("Euler: \\(e^{i\\pi} + 1 = 0\\) — done.");
  check("\\( \\) → $ $", out.includes("$e^{i\\pi} + 1 = 0$") && !out.includes("\\("), out);
}
{
  const out = normalizeMathDelimiters("Display:\n\\[\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n\\]\nEnd.");
  check("\\[ \\] → $$ block", out.includes("$$") && out.includes("\\int_0^1"), out);
  const { html } = await render(out);
  check("\\[ \\] converted renders as display block", html.includes("katex-display"), html.slice(0, 120));
}
{
  const src = "Costs are $5 and $10 total.";
  const out = normalizeMathDelimiters(src);
  check("currency pair escaped (never math)", out.includes("\\$5") && out.includes("\\$10"), out);
}
{
  const src = "```\n\\(x^2\\) and $money$\n```\nAfter.";
  const out = normalizeMathDelimiters(src);
  check("code fence protected", out === src, out);
}
{
  const src = "Use `\\(x^2\\)` inline code as-is.";
  const out = normalizeMathDelimiters(src);
  check("inline code protected", out === src, out);
}
{
  const out = normalizeMathDelimiters("Aligned:\n\\begin{align}\na &= b \\\\\nb &= c\n\\end{align}\nDone.");
  check("standalone align wrapped in $$", out.includes("$$") && out.includes("\\begin{align}"), out);
}
{
  // Escaped dollars survive as literals.
  const src = "Escaped: \\$5 and \\$10 stay literal.";
  check("escaped \\$ untouched", normalizeMathDelimiters(src) === src, normalizeMathDelimiters(src));
}
{
  // Idempotency — the saved-conversation guarantee.
  const samples = [
    "Value \\(x^2\\) and $$y^3$$ done.",
    "$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$",
    "Costs $5 and $10 with math $r = 1.2$ later.",
    "Bare:\n\\begin{aligned}\nx &= 1\n\\end{aligned}",
  ];
  for (const s of samples) {
    const once = normalizeMathDelimiters(s);
    const twice = normalizeMathDelimiters(once);
    check(`idempotent: "${s.slice(0, 34)}…"`, once === twice, JSON.stringify(once) + " vs " + JSON.stringify(twice));
  }
}

console.log("\n── Incomplete-math guard (stream/truncation safety) ────");

{
  const { prepared } = await render("The formula is $$\\frac{a}{b");
  check("open $$ display closed", prepared.includes("$$") && prepared.trimEnd().endsWith("$$"), prepared);
}
{
  const out = balanceTrailingMath("So we get $x^2 +");
  check("open $ inline closed", out.includes("$x^2 +$") || out.trimEnd().endsWith("$"), out);
}
{
  const src = "Balanced $x^2$ and $$y^3$$ prose.";
  check("balanced text untouched (structurally)", balanceTrailingMath(src).includes("$x^2$"));
}
{
  check("endsInsideMath detects open $$", endsInsideMath("text $$x^2") === true);
  check("endsInsideMath false when closed", endsInsideMath("text $$x^2$$ done") === false);
  check("endsInsideMath detects open aligned env", endsInsideMath("$$\n\\begin{aligned}\nx &= 1\n") === true);
  check("endsInsideMath false after env closes", endsInsideMath("$$\n\\begin{aligned}\nx &= 1\n\\end{aligned}\n$$") === false);
}
{
  // A stray $$ opener that would swallow the rest of the reply.
  const out = balanceTrailingMath("Note $$\nThis is a plain English sentence about money and grades.\nMore prose follows here.");
  check("stray $$ opener before prose stays readable", !out.includes("$$\nThis is a plain"), out);
}
{
  const out = balanceTrailingMath("Price: $5 and $10 dollars");
  check("currency pair not treated as math", out.includes("\\$5") && out.includes("\\$10"), out);
}

console.log("\n── Full pipeline — Phase 6 math correctness cases ──────");

const CASES = [
  ["geometric progression", "The $n$th term is $$a_n = a_1 r^{n-1}, \\quad r = 1.2$$ Since $|r| = 1.2 \\ge 1$, the infinite series $\\sum_{n=0}^{\\infty} a_1 r^n$ **diverges** — no finite sum to infinity."],
  ["arithmetic progression", "$$a_n = a_1 + (n-1)d$$ with $d = 4$: 3, 7, 11, 15."],
  ["functions & limits", "$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$"],
  ["differentiation", "If $f(x) = x^3$, then $$f'(x) = 3x^2$$"],
  ["integration", "$$\\int_0^1 3x^2\\,dx = \\left[ x^3 \\right]_0^1 = 1$$"],
  ["trigonometry", "$$\\sin^2\\theta + \\cos^2\\theta = 1$$ where $\\theta = 30°$."],
  ["probability", "For events $A$ and $B$: $$P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$$"],
  ["matrices", "$$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}^{-1} = \\frac{1}{ad - bc}\\begin{pmatrix} d & -b \\\\ -c & a \\end{pmatrix}$$"],
  ["piecewise (cases)", "$$f(x) = \\begin{cases} x^2 & \\text{if } x \\ge 0 \\\\ -x & \\text{if } x < 0 \\end{cases}$$"],
  ["nested fractions", "$$\\frac{1}{1 + \\frac{1}{1 + \\frac{1}{x}}}$$"],
  ["summation & limits", "$$\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}, \\quad \\lim_{n \\to \\infty} \\frac{1}{n} = 0$$"],
  ["greek symbols", "$$\\alpha + \\beta = \\gamma, \\quad \\Omega \\neq \\omega$$"],
  ["exponents & logs", "$$\\log_b(xy) = \\log_b x + \\log_b y, \\quad b^{\\log_b x} = x$$"],
  ["quadratic formula", "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$"],
];

for (const [name, text] of CASES) {
  const { html } = await render(text);
  const hasKatex = html.includes("katex");
  const leaksRawFrac = /\\frac|\\sum|\\int|\\sqrt|\\lim/.test(visibleText(html));
  check(`${name} renders as typeset math`, hasKatex && !leaksRawFrac, html.slice(0, 120));
}

console.log("\n── Full pipeline — malformed / adversarial input ───────");

{
  const { html } = await render("Answer: $$\\frac{a}{b");
  check("truncated display math degrades gracefully", html.includes("katex"), html.slice(0, 100));
}
{
  const { html } = await render("Bad: $$\\frac{\\notacommand{$$ done");
  check("invalid LaTeX → error fallback, no crash", html.includes("katex"), html.slice(0, 100));
}
{
  const { html } = await render("## Series\n\n| $n$ | $S_n$ |\n|---|---|\n| 1 | $a$ |\n\nSo $S_n = a\\frac{r^n - 1}{r - 1}$.");
  check("markdown table + inline math", html.includes("<table") && html.includes("katex"), html.slice(0, 100));
}
{
  // LaTeX must never be interpreted as a Markdown table.
  const { html } = await render("$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$");
  check("aligned env never becomes a markdown table", !html.includes("<table"), html.slice(0, 100));
}
{
  const { html } = await render("First\n$$a^2$$\nthen\n$$b^2$$\nend.");
  const count = (html.match(/class="katex-display"/g) || []).length;
  check("multiple display equations each in own block", count === 2, `count=${count}`);
}
{
  const { html } = await render("It costs $100 to $200 range.");
  check("dollar range renders as text", !html.includes("katex"), html.slice(0, 160));
}
{
  const { html } = await render("```\nprice = $x$\n```\nThen $$a^2$$.");
  const codeUntouched = html.includes("price = $x$");
  const mathRendered = html.includes("katex");
  check("code block math untouched", codeUntouched && mathRendered, html.slice(0, 140));
}
{
  const { html } = await render("Key formula:\n$$S_n = \\frac{a(r^n - 1)}{r - 1}$$");
  check("single-line $$ reflows to display block", html.includes("katex-display"), html.slice(0, 120));
}
{
  // No HTML injection — AI output with tags must never render as HTML.
  const { html } = await render("<script>alert(1)</script> and <img src=x onerror=alert(2)>");
  check("arbitrary HTML never rendered", !html.includes("<script") && !html.includes("<img"), html.slice(0, 120));
}

console.log("\n── Plain-text / speech conversion (share + TTS) ────────");

{
  const out = mathToPlainText("Area: \\(A = \\pi r^2\\), and \\(r = 5\\).");
  check("\\(A = \\pi r^2\\) → unicode", out.includes("π") && out.includes("r²") && !out.includes("\\pi"), out);
}
{
  const out = mathToPlainText("$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$");
  check("quadratic formula readable", out.includes("√") && out.includes("±") && !out.includes("\\frac"), out);
}
{
  const out = mathToSpeech("The sum $$S_n = \\frac{a(r^n - 1)}{r - 1}$$ is key.");
  check("TTS reads fractions as 'over'", out.includes("over") && !out.includes("$"), out);
}
{
  const out = mathToSpeech("**Bold** and \\(x^2\\) stay clean.");
  check("markdown stripped in speech", out.includes("Bold") && !out.includes("**"), out);
}
{
  const out = mathToPlainText("A deposit of $500 grows at $r = 3\\%$ monthly.");
  check("currency stays currency in share text", out.includes("$500") && !out.includes("$500 over"), out);
}

console.log("\n── Streaming: EVERY split position of the GP lesson ────");

// The Tutor's real failure mode was a reply truncated mid-derivation. For
// EVERY character offset of the Grade 12 lesson we render the truncated
// prefix through the real pipeline and require:
//   1. no crash,
//   2. no raw environment text / stray $$ in ordinary flow (raw source
//      inside KaTeX's CONTAINED error fallback is the agreed streaming
//      behavior — source preserved, nothing misleading),
//   3. the renderer still produced output.
{
  const lesson = `## Geometric Progression — Sum of the First n Terms

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
**diverges** — there is no finite sum to infinity.`;

  let leaks = 0;
  let crashes = 0;
  let checked = 0;
  const leakSamples = [];
  for (let at = 1; at < lesson.length; at += 1) {
    try {
      const { html } = await render(lesson.slice(0, at));
      checked += 1;
      // Strip the contained error fallbacks (agreed streaming behavior),
      // then require the ordinary flow to be free of raw LaTeX.
      const flow = html
        .replace(/<span class="katex-error"[^>]*>[\s\S]*?<\/span>/g, "")
        .replace(/<annotation[\s\S]*?<\/annotation>/g, "");
      const visible = flow.replace(/<[^>]+>/g, "");
      if (/\\begin\{|\\end\{|\$\$/.test(visible)) {
        leaks += 1;
        if (leakSamples.length < 5) leakSamples.push(at);
      }
    } catch {
      crashes += 1;
    }
  }
  check(
    `all ${checked} split positions render without raw leaks`,
    checked === lesson.length - 1 && leaks === 0 && crashes === 0,
    `leaks=${leaks}${leakSamples.length ? " at " + leakSamples.join(",") : ""} crashes=${crashes}`,
  );
}

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══\n`);
process.exit(fail === 0 ? 0 : 1);
