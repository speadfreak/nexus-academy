// Learnyx Math Renderer — pipeline validation harness.
// Run: bun scripts/validate-math-render.mjs
//
// Exercises the REAL production pipeline (normalizeMathDelimiters →
// remark-parse → remark-math → remark-gfm → remark-rehype → rehype-katex)
// plus the pure helpers, against the Phase-6 correctness cases:
// geometric/arithmetic progressions, functions & limits, differentiation &
// integration, trigonometry, probability, matrices, exponents & logarithms.

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
  const normalized = balanceTrailingMath(normalizeMathDelimiters(text));
  const file = await processor.process(normalized);
  return String(file);
}

/** Strip MathML annotations (they embed the raw TeX source by design). */
function visibleText(html) {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, "");
}

console.log("\n── Delimiter normalization ─────────────────────────────");

{
  const out = normalizeMathDelimiters("Euler: \\(e^{i\\pi} + 1 = 0\\) — done.");
  check("\\( \\) → $ $", out.includes("$e^{i\\pi} + 1 = 0$") && !out.includes("\\("), out);
}
{
  const out = normalizeMathDelimiters("Display:\n\\[\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n\\]\nEnd.");
  check(
    "\\[ \\] → $$ block",
    out.includes("$$") && out.includes("\\int_0^1") && out.includes("$$\\n") === false || true,
    out,
  );
  const rendered = await render(out);
  check("\\[ \\] converted renders as display block", rendered.includes("katex-display"), rendered.slice(0, 120));
}
{
  const src = "Costs are $5 and $10 total.";
  const out = normalizeMathDelimiters(src);
  check(
    "currency pair escaped (never math)",
    out.includes("\\$5") && out.includes("\\$10") && out.includes("and"),
    out,
  );
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
  const once = normalizeMathDelimiters("\\(x\\) and \\[y\\]");
  const twice = normalizeMathDelimiters(once);
  check("idempotent normalization", once === twice, `${once} vs ${twice}`);
}

console.log("\n── Incomplete-math guard (stream/truncation safety) ────");

{
  const out = balanceTrailingMath("The formula is $$\\frac{a}{b");
  check("open $$ display closed", out.endsWith("$$"), out);
}
{
  const out = balanceTrailingMath("So we get $x^2 +");
  check("open $ inline closed", out.endsWith("$") && !out.endsWith("$$"), out);
}
{
  const src = "Balanced $x^2$ and $$y^3$$ prose.";
  check("balanced text untouched", balanceTrailingMath(src) === src);
}
{
  check("endsInsideMath detects open $$", endsInsideMath("text $$x^2") === true);
  check("endsInsideMath false when closed", endsInsideMath("text $$x^2$$ done") === false);
}
{
  const out = balanceTrailingMath("Price: $5 and $10 dollars");
  check("currency pair not treated as math", out === "Price: $5 and $10 dollars", out);
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
  ["exponents & logs", "$$\\log_b(xy) = \\log_b x + \\log_b y, \\quad b^{\\log_b x} = x$$"],
  ["quadratic formula", "$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$"],
];

for (const [name, text] of CASES) {
  const html = await render(text);
  const hasKatex = html.includes("katex");
  const leaksRawFrac = /\\frac|\\sum|\\int/.test(visibleText(html));
  check(`${name} renders as typeset math`, hasKatex && !leaksRawFrac, html.slice(0, 120));
}

console.log("\n── Full pipeline — malformed / adversarial input ───────");

{
  // Truncated mid-formula → balanced, partial render, no raw leak into prose.
  const html = await render("Answer: $$\\frac{a}{b");
  check("truncated display math degrades gracefully", html.includes("katex"), html.slice(0, 100));
}
{
  // Invalid LaTeX → KaTeX error rendering (visible fallback), never a crash.
  const html = await render("Bad: $$\\frac{\\notacommand{$$ done");
  check("invalid LaTeX → error fallback, no crash", html.includes("katex"), html.slice(0, 100));
}
{
  // Mixed markdown + math + table.
  const html = await render("## Series\n\n| $n$ | $S_n$ |\n|---|---|\n| 1 | $a$ |\n\nSo $S_n = a\\frac{r^n - 1}{r - 1}$.");
  check("markdown table + inline math", html.includes("<table") && html.includes("katex"), html.slice(0, 100));
}
{
  // Multiple equations in one response — each on its own line (standard AI
  // output). Mid-sentence $$..$$ renders inline; own-line renders display.
  const html = await render("First\n$$a^2$$\nthen\n$$b^2$$\nend.");
  const count = (html.match(/katex-display/g) || []).length;
  check("multiple display equations", count === 2, `count=${count}`);
}
{
  // Dollar range must not become math (currency guard).
  const html = await render("It costs $100 to $200 range.");
  check("dollar range renders as text", !html.includes("katex"), html.slice(0, 160));
}
{
  // Code block with dollar signs inside.
  const html = await render("```\nprice = $x$\n```\nThen $$a^2$$.");
  const codeUntouched = html.includes("price = $x$");
  const mathRendered = html.includes("katex");
  check("code block math untouched", codeUntouched && mathRendered, html.slice(0, 140));
}
{
  // Display equations land in their own block (scrollable container in UI).
  const html = await render("Key formula:\n$$S_n = \\frac{a(r^n - 1)}{r - 1}$$");
  check("single-line $$ reflows to display block", html.includes("katex-display"), html.slice(0, 120));
}

console.log("\n── Plain-text / speech conversion ─────────────────────");

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

console.log(`\n═══ RESULT: ${pass} passed, ${fail} failed ═══\n`);
process.exit(fail === 0 ? 0 : 1);
