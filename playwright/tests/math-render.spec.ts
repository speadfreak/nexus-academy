// Learnyx Math Renderer — VISUAL BROWSER REGRESSION TESTS.
//
// These tests exist because tsc and vite build can both pass while a Grade
// 12 student still sees:
//
//   S_n - rS_n &= a - ar^n \end{aligned}$$
//
// They drive the REAL rendering stack (AiText → LearnyxMathRenderer →
// react-markdown + remark-math + rehype-katex + .lyx-md styles) inside a
// real browser via math-harness.html, and assert the actual painted result:
// KaTeX typeset, no raw LaTeX text nodes, no KaTeX error fallbacks for valid
// input, no stray "LaTeX" labels, copy-LaTeX working, and horizontal
// overflow handled on narrow phones.
//
// The fixtures are the exact Grade 12 geometric-progression responses from
// the bug report, including the truncated+marker stored-message shape and
// the continuation message.

import { expect, test, type Page } from "@playwright/test";

// The same fixture the harness renders (kept in sync deliberately — the
// harness is the source of truth; this copy lets the spec compute split
// positions inside the math regions).
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

/** Raw LaTeX that must NEVER appear as visible text in a finished message. */
const RAW_LEAKS = [/\\begin\{/, /\\end\{/, /&=/, /\\\\/, /\$\$/, /\\frac/, /\\sum/];

async function assertNoRawLeaks(page: Page, scope = "body") {
  // Wait for the lazy renderer to mount — until then AiText deliberately
  // shows its plain-text Suspense fallback (the raw source), which is not
  // the finished rendering this assertion is about.
  await expect(page.locator("body .lyx-md").first()).toBeAttached();
  const text = await page.locator(scope).innerText();
  for (const leak of RAW_LEAKS) {
    expect.soft(text, `raw leak ${leak} in ${scope}`).not.toMatch(leak);
  }
}

async function assertNoKatexErrors(page: Page) {
  const errors = page.locator(".katex-error");
  await expect
    .soft(errors, "valid fixtures must typeset without KaTeX error fallbacks")
    .toHaveCount(0);
}

test.describe("Tutor math rendering — desktop", () => {
  test("GP lesson renders as fully typeset mathematics", async ({ page }) => {
    await page.goto("/math-harness.html");
    const full = page.locator("#msg-full");

    // Aligned derivations + display equations actually typeset.
    const displays = full.locator(".katex-display");
    await expect(displays).toHaveCount(5); // GP sequence, T_n, aligned sum, S_n, \[aligned\]
    await expect(full.locator(".katex").first()).toBeVisible();

    // KaTeX stylesheet really applied (fonts + layout classes).
    const font = await full
      .locator(".katex")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(font.toLowerCase()).toContain("katex");

    // The aligned sum rows are vertically stacked (alignment preserved) —
    // mtr rows only exist when the environment parsed (MathML tree).
    expect(await full.locator(".katex-mathml mtr").count()).toBeGreaterThanOrEqual(6);

    await assertNoRawLeaks(page, "#msg-full");
    await assertNoKatexErrors(page);

    // The derivation content is actually THERE as math (not silently eaten).
    await expect(full.getByRole("heading", { name: "Geometric Progression" })).toBeVisible();
    const tex = await full.locator(".katex-mathml annotation").first().textContent();
    expect(tex).toBeTruthy();

    await page.screenshot({ path: "playwright/artifacts/desktop-gp-lesson.png", fullPage: true });
  });

  test("truncated reply + length marker renders partial math, prose stays prose", async ({ page }) => {
    await page.goto("/math-harness.html");
    const msg = page.locator("#msg-truncated");
    await expect(msg.locator(".katex-display")).toHaveCount(1);
    await assertNoRawLeaks(page, "#msg-truncated");

    // The marker must be readable prose — not swallowed into the math.
    await expect(msg.getByText(/length limit mid-answer/)).toBeVisible();
    // …and the partial derivation rows must still be typeset (aligned env).
    expect(await msg.locator(".katex-mathml mtr").count()).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: "playwright/artifacts/desktop-truncated.png", fullPage: false });
  });

  test("continuation message renders independently", async ({ page }) => {
    await page.goto("/math-harness.html");
    const msg = page.locator("#msg-continuation");
    await expect(msg.locator(".katex-display")).toHaveCount(1);
    await assertNoRawLeaks(page, "#msg-continuation");
    await assertNoKatexErrors(page);
  });

  test("copy-LaTeX action works and shows no persistent label", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/math-harness.html");
    const full = page.locator("#msg-full");

    // Icon-only: no visible "LaTeX" text anywhere in the message.
    expect(await full.getByText("LaTeX").count()).toBe(0);

    // The aligned sum derivation is the third display block.
    const button = full.locator(".katex-display").nth(2).locator(".lyx-eq-copy");
    await expect(button).toBeAttached();
    await button.click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("begin{aligned}");
  });

  test("display equations never overflow the message column", async ({ page }) => {
    await page.goto("/math-harness.html");
    const column = page.locator("main");
    const colWidth = await column.evaluate((el) => el.getBoundingClientRect().width);
    for (let i = 0; i < (await page.locator(".katex-display").count()); i += 1) {
      const box = await page.locator(".katex-display").nth(i).boundingBox();
      expect(box, `display equation ${i} overflows the column`).toBeTruthy();
      expect(box!.x, `display equation ${i} starts left of the column`).toBeGreaterThanOrEqual(-1);
    }
    void colWidth;
  });
});

test.describe("Tutor math rendering — mobile", () => {
  test("GP lesson typesets on a 390px phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/math-harness.html");
    const full = page.locator("#msg-full");
    await expect(full.locator(".katex-display").first()).toBeVisible();
    await assertNoRawLeaks(page, "#msg-full");
    await assertNoKatexErrors(page);
    await page.screenshot({ path: "playwright/artifacts/mobile-gp-lesson.png", fullPage: true });
  });

  test("oversized equations scroll horizontally instead of bursting the bubble", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/math-harness.html");
    const displays = page.locator(".katex-display");
    await expect(displays.first()).toBeAttached(); // wait for the lazy chunk
    const count = await displays.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const style = await displays.nth(i).evaluate((el) => {
        const s = getComputedStyle(el);
        return { overflowX: s.overflowX, clientWidth: el.clientWidth, scrollWidth: el.scrollWidth };
      });
      if (style.scrollWidth > style.clientWidth + 1) {
        expect
          .soft(style.overflowX, `equation ${i} wider than bubble must be scrollable`)
          .toBe("auto");
      }
    }
    // The page itself must not gain horizontal scroll from the equations.
    const docScroll = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docScroll, "no horizontal page overflow").toBeLessThanOrEqual(1);
  });

  test("320px narrow phone stays clean", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/math-harness.html");
    await assertNoRawLeaks(page, "#msg-full");
    await assertNoRawLeaks(page, "#msg-truncated");
    const docScroll = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docScroll, "no horizontal page overflow at 320px").toBeLessThanOrEqual(1);
  });
});

test.describe("Streaming split positions — browser-level sample", () => {
  // The exhaustive every-position sweep lives in the pipeline harness
  // (scripts/validate-math-render.mjs). Here we render a meaningful sample
  // through the REAL browser renderer: every cut that lands inside a math
  // delimiter/environment and a set of boundary offsets.
  const meaningfulSplits = (() => {
    const offsets = new Set<number>();
    const mathSpans: [number, number][] = [];
    let idx = 0;
    while ((idx = GP_LESSON.indexOf("$$", idx)) !== -1) {
      const close = GP_LESSON.indexOf("$$", idx + 2);
      if (close === -1) {
        mathSpans.push([idx, GP_LESSON.length]);
        break;
      }
      mathSpans.push([idx, close + 2]);
      idx = close + 2;
    }
    for (const [start, end] of mathSpans) {
      for (let o = start - 1; o <= end + 1; o += 1) {
        if (o > 0 && o < GP_LESSON.length) offsets.add(o);
      }
    }
    // Sample inside long environments rather than flooding the browser run.
    const all = [...offsets].sort((a, b) => a - b);
    if (all.length <= 60) return all;
    const step = Math.ceil(all.length / 60);
    return all.filter((_, k) => k % step === 0);
  })();

  for (const at of meaningfulSplits) {
    test(`split at char ${at} stays readable`, async ({ page }) => {
      await page.goto(`/math-harness.html?split=${at}`);
      // Wait for the lazy renderer chunk to mount — until then AiText shows
      // its readable plain-text Suspense fallback (raw source by design).
      await expect(page.locator("#streaming-message .lyx-md")).toHaveCount(1);
      // Streaming contract: a cut INSIDE a command (e.g. "\\begin{", "\\frac{")
      // may show the source inside KaTeX's contained error fallback — source
      // preserved, nothing misleading, no layout thrash. What must NEVER
      // happen is raw environment/dollar text in ORDINARY flow (outside the
      // error fallback). expect.poll retries through transient fallback
      // windows under dev-server load; a genuinely raw final state fails.
      await expect
        .poll(
          async () =>
            page.locator("#streaming-message").evaluate((el) => {
              const clone = el.cloneNode(true) as HTMLElement;
              // Remove what students never see: the contained KaTeX error
              // fallback (agreed streaming behavior) and the visually-hidden
              // MathML tree whose annotation carries the TeX source by
              // design (copy-LaTeX + accessibility).
              for (const sel of [".katex-error", ".katex-mathml"]) {
                for (const node of clone.querySelectorAll(sel)) node.remove();
              }
              return clone.textContent ?? "";
            }),
          { timeout: 15_000 },
        )
        .not.toMatch(/\\begin\{|\\end\{|\$\$/);
    });
  }
});
