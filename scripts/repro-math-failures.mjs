// Learnyx Math Renderer — FAILURE REPRODUCTION harness.
// Run: bun scripts/repro-math-failures.mjs
//
// Pushes the EXACT fixtures from the real Tutor bug report through the REAL
// production pipeline (normalizeMathDelimiters → balanceTrailingMath →
// remark-parse → remark-math → remark-gfm → remark-rehype → rehype-katex)
// and prints what the student's browser would receive.

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
} from "../src/components/math/mathText.ts";

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
  return { normalized, html: String(file) };
}

/** Visible text (strip tags + MathML annotations) — what the student READS. */
function visibleText(html) {
  return html
    .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
    .replace(/<[^>]+>/g, "");
}

const FIXTURES = {
  "1. USER FIXTURE — $$ aligned GP derivation (from bug report)":
`Deriving the sum formula:

$$
\\begin{aligned}
S_n-rS_n &= a-ar^n \\\\
S_n(1-r) &= a(1-r^n) \\\\
S_n &= \\frac{a(1-r^n)}{1-r}
\\end{aligned}
$$

This gives the sum of the first $n$ terms.`,

  "2. USER FIXTURE — \\[ aligned multiple calculations (from bug report)":
`Calculate the first three terms:

\\[
\\begin{aligned}
T_1 &= 2(1.2)^0 = 2 \\\\
T_2 &= 2(1.2)^1 = 2.4 \\\\
T_3 &= 2(1.2)^2 = 2.88
\\end{aligned}
\\]`,

  "3. SUSPECT — \\begin{align} inside $$ (align, not aligned)":
`$$
\\begin{align}
x &= 1 \\\\
y &= 2
\\end{align}
$$`,

  "4. SUSPECT — \\begin{cases} inside $$":
`$$
\\begin{cases}
x + y = 3 \\\\
x - y = 1
\\end{cases}
$$`,

  "5. SUSPECT — bare aligned, no delimiters":
`The terms are:
\\begin{aligned}
T_1 &= 2 \\\\
T_2 &= 2.4
\\end{aligned}`,

  "6. SUSPECT — currency + math in one paragraph":
`A student deposits $500 in the first month and increases the deposit by 3% each month, so the ratio is $r = 1.03$ and the total after $n$ months is $500 \\cdot 1.03^n$.`,

  "7. REAL-WORLD — truncated mid-aligned + marker appended to same stored message (sendMessage)":
`First, the common ratio is $r = 1.2$, so the series diverges. Derivation:

$$
\\begin{aligned}
S_n-rS_n &= a-ar^n \\\\
S_n(1-r) &= a(1-r^n) \\

*ⓘ The reply reached its length limit mid-answer. Say "continue" and I'll pick up exactly where I stopped.*`,

  "7b. CONTINUATION — the follow-up assistant message renders independently":
`Continuing from where we stopped:

$$
S_n &= \\frac{a(1-r^n)}{1-r}
$$

So the sum formula is $S_n = \\frac{a(1-r^n)}{1-r}$ for $r \\neq 1$.`,

  "8. SUSPECT — blank line inside $$ block":
`$$
\\begin{aligned}
a &= b \\\\

c &= d
\\end{aligned}
$$`,

  "9. SUSPECT — \\\\[4pt] spacing inside aligned":
`$$
\\begin{aligned}
a &= 1 \\\\[4pt]
b &= 2
\\end{aligned}
$$`,

  "10. SUSPECT — inline math after currency dollar ($500 ... $r$)":
`She saves $200 monthly at a rate of $r$ percent, giving $A = 200n$.`,
};

const failures = [];
for (const [name, fixture] of Object.entries(FIXTURES)) {
  const { normalized, html } = await render(fixture);
  const text = visibleText(html);

  const problems = [];
  // The user's acceptance checks, applied to the VISIBLE text:
  if (/\\begin\{|\\end\{/.test(text)) problems.push("raw \\begin/\\end in visible text");
  if (/&=/.test(text)) problems.push("raw &= in visible text");
  if (/\$\$/.test(text)) problems.push("stray $$ in visible text");
  if (/\\\\/.test(text)) problems.push("raw \\\\ in visible text");
  if (!html.includes("katex") && /\^|_|\{/.test(fixture)) problems.push("no KaTeX output at all");

  const status = problems.length ? "❌ FAIL" : "✅ PASS";
  if (problems.length) failures.push(name);

  console.log(`\n${'='.repeat(70)}\n${status} — ${name}\n${'-'.repeat(70)}`);
  console.log("NORMALIZED SOURCE:");
  console.log(normalized.split("\n").map((l) => "  | " + l).join("\n"));
  console.log("VISIBLE TEXT:");
  console.log("  " + text.replace(/\n{2,}/g, "\n  ").trim().slice(0, 600));
  if (problems.length) console.log("PROBLEMS: " + problems.join(" | "));
}

console.log(`\n${'='.repeat(70)}\nREPRODUCED FAILURES: ${failures.length}/${Object.keys(FIXTURES).length}`);
failures.forEach((f) => console.log("  ✗ " + f));
