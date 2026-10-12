// Learnyx Math Renderer — text pipeline (pure functions, no React).
//
// Everything here operates on AI-produced strings BEFORE markdown/KaTeX
// parsing. Design rules (non-negotiable):
//   1. NEVER transform anything inside fenced code blocks or inline code.
//   2. NEVER turn a plain "$" (currency) into math — only convert explicit
//      LaTeX delimiters \( \) and \[ \] into remark-math's $ / $$ dialect.
//   3. Be idempotent — running the normalizer twice must equal running once
//      (saved conversations render through the same path repeatedly).
//   4. Incomplete math (truncated streams / max-token cut-offs) must degrade
//      gracefully: close the open delimiter so KaTeX renders a partial
//      expression instead of leaking raw LaTeX across the rest of the reply.

// ---------------------------------------------------------------------------
// Segment scanning — split a string into "protected" (code) and "open" spans
// ---------------------------------------------------------------------------

interface TextSegment {
  text: string;
  /** true when the span is code and must never be modified */
  protectedSpan: boolean;
}

/**
 * Split into code-fenced / inline-code / normal segments.
 * Handles ``` fences (with optional language), ~~~ fences and `inline` code.
 * Unterminated fences (mid-stream) keep everything to the end protected —
 * the safest possible assumption while a stream is still arriving.
 */
export function splitCodeSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  // Fence: ``` or ~~~ (3+) with optional trailing info-string on same line.
  const fenceRegex = /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n?/g;
  // Inline code: `…` (non-greedy, no newline across).
  const inlineCodeRegex = /`[^`\n]*`/g;

  const protectedRegions: { start: number; end: number }[] = [];

  // 1. Fenced blocks first.
  const fenceSpans: { start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = fenceRegex.exec(text)) !== null) {
    const fenceToken = m[3];
    const fenceStart = m.index + m[1].length;
    const bodyStart = m.index + m[0].length;
    // Find the matching closer: a line that is only the same fence token.
    const closeRegex = new RegExp(
      `(^|\\n)[ \\t]*${fenceToken[0]}{${fenceToken.length},}[ \\t]*(?=\\n|$)`,
      "g",
    );
    closeRegex.lastIndex = bodyStart;
    const close = closeRegex.exec(text);
    const end = close ? close.index + close[0].length : text.length;
    fenceSpans.push({ start: fenceStart, end });
    protectedRegions.push({ start: fenceStart, end });
    fenceRegex.lastIndex = end; // continue scanning after this block
  }

  // 2. Inline code outside fences.
  inlineCodeRegex.lastIndex = 0;
  while ((m = inlineCodeRegex.exec(text)) !== null) {
    const insideFence = fenceSpans.some(
      (f) => m!.index >= f.start && m!.index < f.end,
    );
    if (!insideFence) {
      protectedRegions.push({ start: m.index, end: m.index + m[0].length });
    }
  }

  protectedRegions.sort((a, b) => a.start - b.start);

  // 3. Walk regions, emitting normal spans between protected ones.
  let cursor = 0;
  for (const region of protectedRegions) {
    if (region.start < cursor) continue; // overlapping (shouldn't happen)
    if (region.start > cursor) {
      segments.push({ text: text.slice(cursor, region.start), protectedSpan: false });
    }
    segments.push({ text: text.slice(region.start, region.end), protectedSpan: true });
    cursor = region.end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), protectedSpan: false });
  }
  return segments;
}

/** Map a transformation over the open (non-code) spans only. */
function mapOpenSegments(
  text: string,
  transform: (chunk: string) => string,
): string {
  return splitCodeSegments(text)
    .map((seg) => (seg.protectedSpan ? seg.text : transform(seg.text)))
    .join("");
}

// ---------------------------------------------------------------------------
// Currency guard — remark-math has NO currency rule: "$100 to $200" parses
// as math. Escape dollar signs of currency-like pairs to \$ (micromark
// renders that as a literal $).
// ---------------------------------------------------------------------------

const CURRENCY_CONTENT =
  /^[0-9][0-9,.]*(\s*(and|to|or|per|birr|each|-)(\s*[0-9][0-9,.]*)?)?$/i;

function escapeCurrencyDollars(chunk: string): string {
  // Collect positions of UNESCAPED dollar signs (skip \\ and \$).
  const dollars: number[] = [];
  for (let i = 0; i < chunk.length; i += 1) {
    if (chunk[i] === "\\") {
      i += 1; // skip escaped char
      continue;
    }
    if (chunk[i] === "$") dollars.push(i);
  }
  if (dollars.length < 2) return chunk;

  const escapeAt = new Set<number>();
  for (let k = 0; k < dollars.length - 1; k += 1) {
    const start = dollars[k];
    const end = dollars[k + 1];
    const content = chunk.slice(start + 1, end);
    if (content.includes("\n")) continue; // multiline → real math
    if (content.length > 40) continue;
    if (CURRENCY_CONTENT.test(content.trim())) {
      escapeAt.add(start);
      escapeAt.add(end);
      k += 1; // pair consumed
    }
  }
  if (escapeAt.size === 0) return chunk;

  let out = "";
  for (let i = 0; i < chunk.length; i += 1) {
    if (escapeAt.has(i) && chunk[i] === "$") out += "\\$";
    else out += chunk[i];
  }
  return out;
}

/** Re-flow a single-line $$ … $$ into a real display block. */
function reflowDisplayMath(chunk: string): string {
  return chunk
    .split("\n")
    .map((line) => {
      const m = /^\s*\$\$(.+?)\$\$\s*$/.exec(line);
      if (!m) return line;
      return `\n$$\n${m[1].trim()}\n$$\n`;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// Delimiter normalization — \( \) and \[ \] → $ / $$
// ---------------------------------------------------------------------------

/**
 * Convert LaTeX bracket delimiters to remark-math dollar delimiters.
 *  - \( … \)  → $ … $      (inline)
 *  - \[ … \]  → $$ … $$    (display; may span multiple lines)
 *  - \begin{equation}/\begin{equation*} … \end{…} → $$ … $$
 *  - Standalone \begin{align|align*|gather|gather*|cases} blocks (opening
 *    line carries no $) get wrapped in $$ … $$.
 *
 * Code blocks and inline code are never touched. Currency like "$5 and $10"
 * is never created here — we only ever *consume* \( \) pairs.
 */
export function normalizeMathDelimiters(text: string): string {
  return mapOpenSegments(text, (chunk) => {
    let out = chunk;

    // \[ … \] → $$ … $$  (non-greedy, multiline)
    out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_all, body: string) => `$$${body.trim()}$$`);

    // \( … \) → $ … $
    out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_all, body: string) => `$${body.trim()}$`);

    // \begin{equation} … \end{equation} (and starred) → $$ … $$
    out = out.replace(
      /\\begin\{(equation\*?)\}([\s\S]*?)\\end\{\1\}/g,
      (_all, _env: string, body: string) => `$$${body.trim()}$$`,
    );

    // Standalone align/gather/cases blocks without a $ on the opening line
    // → wrap in $$ … $$ so remark-math treats them as display math.
    const envNames = "align\\*?|gather\\*?|cases";
    const envRegex = new RegExp(
      `(^|\\n)[ \\t]*\\\\begin\\{(${envNames})\\}[\\s\\S]*?\\\\end\\{\\2\\}`,
      "g",
    );
    let rebuilt = "";
    let envCursor = 0;
    let envMatch: RegExpExecArray | null;
    while ((envMatch = envRegex.exec(out)) !== null) {
      const matchText = envMatch[0];
      const openingLine = (matchText.split("\n")[0] ?? "").trim();
      rebuilt += out.slice(envCursor, envMatch.index);
      if (openingLine.includes("$")) {
        rebuilt += matchText; // already inside math — leave untouched
      } else {
        const lead = matchText.startsWith("\n") ? "\n" : "";
        rebuilt += `${lead}$$\n${matchText.trim()}\n$$`;
      }
      envCursor = envMatch.index + matchText.length;
    }
    rebuilt += out.slice(envCursor);
    out = rebuilt;

    // Currency guard — escape "$5 and $10" style pairs so remark-math never
    // typesets money. Runs AFTER delimiter conversion (\( \) pairs are real
    // math and never look like prices).
    out = escapeCurrencyDollars(out);

    // Single-line $$ … $$ → real display block (remark only produces
    // katex-display when the $$ fences stand on their own lines).
    out = reflowDisplayMath(out);

    return out;
  });
}

// ---------------------------------------------------------------------------
// Incomplete-math guard — stream/truncation safety
// ---------------------------------------------------------------------------

/**
 * If the text ends inside an unterminated math region (odd $$, odd single $,
 * or an unclosed \begin{env}), close it so KaTeX renders a *partial but
 * styled* expression instead of leaking raw LaTeX into the prose below.
 *
 * Returns the original string untouched when everything is balanced — so it
 * is safe to always run before rendering. Idempotent by construction.
 */
export function balanceTrailingMath(text: string): string {
  const segments = splitCodeSegments(text);

  // Track delimiter balance across open segments only.
  let displayDepth = 0; // $$ pairs
  let inlineDepth = 0; // single $ pairs (outside $$)
  let lastUnclosed: { kind: "display" | "inline" } | null = null;

  let unclosedInlineAt = -1;

  segments.forEach((seg) => {
    if (seg.protectedSpan) return;
    let j = 0;
    while (j < seg.text.length) {
      const ch = seg.text[j];
      if (ch === "\\") {
        j += 2; // escaped char (\$ and friends) — never a delimiter
        continue;
      }
      if (seg.text.startsWith("$$", j)) {
        displayDepth = displayDepth === 0 ? 1 : 0;
        lastUnclosed = displayDepth === 1 ? { kind: "display" } : null;
        unclosedInlineAt = -1;
        j += 2;
        continue;
      }
      if (ch === "$") {
        const prevChar = j > 0 ? seg.text[j - 1] : null;
        const nextChar = seg.text[j + 1] ?? null;
        // Mirror micromark-extension-math: opener must not be followed by
        // whitespace; closer must not be preceded by whitespace.
        const canOpen = nextChar !== null && !/\s/.test(nextChar);
        const canClose = inlineDepth === 1 && prevChar !== null && !/\s/.test(prevChar);
        if (canClose) {
          inlineDepth = 0;
          lastUnclosed = null;
          unclosedInlineAt = -1;
        } else if (inlineDepth === 0 && canOpen) {
          inlineDepth = 1;
          lastUnclosed = { kind: "inline" };
          unclosedInlineAt = j;
        }
        j += 1;
        continue;
      }
      j += 1;
    }
  });

  if (!lastUnclosed) return text;
  // TS can't narrow closure-mutated captures — the guard above is definitive.
  const unclosed = lastUnclosed as { kind: "display" | "inline" };
  if (unclosed.kind === "display") return `${text.replace(/\s*$/, "")}\n$$`;
  // Unclosed inline $: only close it when the tail actually looks like
  // LaTeX (currency "$5" at EOF would otherwise gain a stray $).
  const tail = unclosedInlineAt >= 0 ? text.slice(unclosedInlineAt + 1) : "";
  if (/[\\^_{}]/.test(tail)) return `${text}$`;
  return text;
}

/**
 * True when the trailing content sits inside an unterminated math region.
 * Guards truncated (max-token) replies; also ready for a future stream.
 */
export function endsInsideMath(text: string): boolean {
  return balanceTrailingMath(text) !== text;
}

// ---------------------------------------------------------------------------
// LaTeX → speakable text (text-to-speech) and → readable plain text (share)
// ---------------------------------------------------------------------------

const GREEK_SPEECH: Record<string, string> = {
  alpha: "alpha", beta: "beta", gamma: "gamma", delta: "delta", epsilon: "epsilon",
  zeta: "zeta", eta: "eta", theta: "theta", iota: "iota", kappa: "kappa",
  lambda: "lambda", mu: "mu", nu: "nu", xi: "xi", pi: "pi", rho: "rho",
  sigma: "sigma", tau: "tau", upsilon: "upsilon", phi: "phi", chi: "chi",
  psi: "psi", omega: "omega", Omega: "Omega", Delta: "Delta", Pi: "Pi",
  Sigma: "Sigma", Theta: "Theta", Lambda: "Lambda", Gamma: "Gamma", Phi: "Phi",
};

const COMMAND_SPEECH: Record<string, string> = {
  times: " times ", cdot: " times ", div: " divided by ", pm: " plus or minus ",
  le: " is less than or equal to ", ge: " is greater than or equal to ",
  ne: " is not equal to ", approx: " is approximately ", infty: " infinity ",
  sum: " the sum of ", prod: " the product of ", int: " the integral of ",
  lim: " the limit of ", to: " to ", rightarrow: " to ", Rightarrow: " so ",
  sin: " sine ", cos: " cosine ", tan: " tan ", log: " log ", ln: " natural log ",
  in: " in ", notin: " not in ", subset: " subset of ", cup: " union ", cap: " intersect ",
  angle: " angle ", triangle: " triangle ", degree: " degrees ", circ: " degrees ",
};

/** Convert one LaTeX span into something a speech engine can read aloud. */
function speakableLatex(latex: string): string {
  let out = latex;
  // \left( … \right) → plain parens; \left. / \right. removed.
  out = out.replace(/\\left\s*/g, "").replace(/\\right\s*/g, "");
  // \frac{a}{b} → "a over b" (single level — good enough for speech).
  for (let i = 0; i < 3; i += 1) {
    out = out.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 over $2");
  }
  // \sqrt[n]{x} → "the nth root of x"; \sqrt{x} → "the square root of x".
  out = out.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, "the $1th root of $2");
  for (let i = 0; i < 3; i += 1) {
    out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, "the square root of $1");
  }
  // Superscripts / subscripts.
  out = out.replace(/\^\{([^{}]*)\}/g, " to the power of $1");
  out = out.replace(/\^(\w)/g, " to the power of $1");
  out = out.replace(/_\{([^{}]*)\}/g, " sub $1");
  out = out.replace(/_(\w)/g, " sub $1");
  // Greek letters + known commands.
  out = out.replace(/\\([A-Za-z]+)/g, (_all, name: string) =>
    GREEK_SPEECH[name] ?? COMMAND_SPEECH[name] ?? ` ${name} `,
  );
  // Remainder noise.
  out = out.replace(/[{}]/g, " ").replace(/\\\\/g, " ").replace(/&/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

const GREEK_UNICODE: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε",
  theta: "θ", Theta: "Θ", lambda: "λ", Lambda: "Λ", mu: "μ", pi: "π", Pi: "Π",
  rho: "ρ", sigma: "σ", Sigma: "Σ", tau: "τ", phi: "φ", Phi: "Φ", chi: "χ",
  psi: "ψ", omega: "ω", Omega: "Ω",
};

const OP_UNICODE: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤",
  ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", infty: "∞",
  sum: "Σ", prod: "Π", int: "∫", to: "→", rightarrow: "→", Rightarrow: "⇒",
  leftrightarrow: "↔", in: "∈", notin: "∉", subset: "⊂", subseteq: "⊆",
  cup: "∪", cap: "∩", emptyset: "∅", forall: "∀", exists: "∃", angle: "∠",
  triangle: "△", degree: "°", circ: "°", cdots: "⋯", ldots: "…", dots: "…",
  partial: "∂", nabla: "∇", propto: "∝", perp: "⊥", parallel: "∥",
};

/**
 * Convert AI text (markdown + $/$$ math) into readable plain text — used by
 * Share and anywhere LaTeX source would confuse a human reading prose
 * outside the app.
 */
export function mathToPlainText(text: string): string {
  // Convert delimiters first so every math region is in $ dialect.
  const normalized = normalizeMathDelimiters(text);

  const convertSpan = (span: string): string => {
    let out = span;
    out = out.replace(/\\left\s*/g, "").replace(/\\right\s*/g, "");
    // \frac{a}{b} → (a)/(b).
    for (let i = 0; i < 3; i += 1) {
      out = out.replace(/\\(?:d|t)?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
    }
    out = out.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, "($1)√($2)");
    for (let i = 0; i < 3; i += 1) {
      out = out.replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)");
    }
    // Superscripts: map simple bodies to unicode, else keep ^(...).
    const SUP: Record<string, string> = {
      "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
      "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", n: "ⁿ",
    };
    out = out.replace(/\^\{([^{}]+)\}/g, (_a, body: string) => {
      const sup = [...body].map((ch) => SUP[ch] ?? "").join("");
      return sup.length === body.length && body.length > 0 ? sup : `^(${body})`;
    });
    out = out.replace(/\^(\w)/g, (_a, ch: string) => SUP[ch] ?? `^${ch}`);
    // Subscripts similar.
    const SUB: Record<string, string> = {
      "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄",
      "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", n: "ₙ", i: "ᵢ",
    };
    out = out.replace(/_\{([^{}]+)\}/g, (_a, body: string) => {
      const sub = [...body].map((ch) => SUB[ch] ?? "").join("");
      return sub.length === body.length && body.length > 0 ? sub : `_(${body})`;
    });
    out = out.replace(/_(\w)/g, (_a, ch: string) => SUB[ch] ?? `_${ch}`);
    // Known operators / greek → unicode; unknown commands keep their name.
    out = out.replace(/\\([A-Za-z]+)/g, (_all, name: string) =>
      OP_UNICODE[name] ?? GREEK_UNICODE[name] ?? (COMMAND_SPEECH[name] ? COMMAND_SPEECH[name].trim() : name),
    );
    // Braces, row separators.
    out = out.replace(/[{}]/g, "").replace(/\\\\/g, "; ").replace(/&/g, " ");
    return out.trim();
  };

  return mapOpenSegments(normalized, (chunk) => {
    // Hide escaped currency dollars so span regexes never touch them.
    const guarded = chunk.replace(/\\\$/g, "\u0001");
    const converted = guarded
      .replace(/\$\$([\s\S]+?)\$\$/g, (_a, body: string) => convertSpan(body))
      .replace(/\$([^$\n]+?)\$/g, (_a, body: string) => convertSpan(body));
    return converted.replace(/\u0001/g, "$");
  })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** TTS pipeline: math → speakable, markdown → clean prose. */
export function mathToSpeech(text: string): string {
  const normalized = normalizeMathDelimiters(text);
  const spoken = mapOpenSegments(normalized, (chunk) => {
    const guarded = chunk.replace(/\\\$/g, "\u0001");
    const result = guarded
      .replace(/\$\$([\s\S]+?)\$\$/g, (_a, body: string) => ` ${speakableLatex(body)}. `)
      .replace(/\$([^$\n]+?)\$/g, (_a, body: string) => ` ${speakableLatex(body)} `);
    return result.replace(/\u0001/g, "$");
  });
  // Markdown decorations (same intent as the legacy stripMarkdown).
  return spoken
    .replace(/```[\s\S]*?```/g, " code block. ")
    .replace(/```\n?/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
