// Learnyx Math Renderer — text pipeline (pure functions, no React).
//
// Everything here operates on AI-produced strings BEFORE markdown/KaTeX
// parsing. Design rules (non-negotiable):
//   1. NEVER transform anything inside fenced code blocks or inline code.
//   2. NEVER turn a plain "$" (currency) into math — and never let a prose
//      dollar pair with a real math dollar (that once typeset whole English
//      sentences as italic math soup).
//   3. Be idempotent — running the normalizer twice must equal running once
//      (saved conversations render through the same path repeatedly).
//   4. Incomplete math (truncated streams / max-token cut-offs) must degrade
//      gracefully: close the open delimiter/environment so KaTeX renders a
//      partial expression instead of leaking raw LaTeX across the reply.
//   5. Math bodies captured from $$…$$ / \[…\] / environments are preserved
//      VERBATIM — no currency logic, no delimiter conversion, no wrapping
//      ever runs inside an already-open math region (this is what killed the
//      double-wrap bug that produced raw \begin{aligned} + stray $$).
//   6. Emitted display math is CANONICAL: $$ / $$ on their own lines.
//      remark-math treats content on the opener line as fence meta and
//      drops it, so $$\begin{aligned}… used to leak half-rendered text.

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
// The scanner — one pass, stateless re-entry, canonical emission.
//
// The previous implementation chained regex passes (\[…\] → $$, then an
// env-wrapper, then a currency escaper, then a reflower). Each pass could
// see — and corrupt — text produced by the previous one:
//   • $$\n\begin{align}… was "wrapped again" (its opening-line check read
//     the empty string before a leading \n) → empty math block, raw
//     environment, stray $$.
//   • $$content$$ emission put content on the opener line, which remark-math
//     treats as fence meta → dropped content + unclosed math.
//   • The currency guard capped at 40 chars, so longer prose spans paired
//     with a real math dollar and got typeset as math.
// The scanner below never re-enters a math body, so none of these can
// recur by construction.
// ---------------------------------------------------------------------------

/** LaTeX environments KaTeX supports and models commonly emit. */
const MATH_ENVS = new Set([
  "aligned", "alignedat", "align", "align*", "gather", "gather*", "gathered",
  "cases", "dcases", "equation", "equation*", "split", "multline", "multline*",
  "array", "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
  "smallmatrix",
]);

const ENV_TOKEN_RE = /\\(begin|end)\{([a-zA-Z*]+)\}/g;

/** A LaTeX marker anywhere means a $…$ span is intended as math. */
const LATEX_MARKER = /[\\^_{}]/;

/** "$5 and $10" / "$100 to $200" / "$100 to" — a number joined by a
 *  commerce connector, with the second amount optional (it may live in the
 *  next dollar pair). A bare "$2.4$" (no connector) stays math. */
const CURRENCY_PAIR =
  /^[0-9][0-9,.]*\s*(?:and|to|or|per|birr|each|-|only)\b(?:\s*[0-9][0-9,.]*)?\s*$/i;

/**
 * Decide whether the body between two single dollars is meant as math.
 * Anything with LaTeX markers is math; a numeric commerce pair is currency;
 * otherwise any English word (≥3 letters) makes it prose. Pure symbols,
 * digits and single-letter variables stay math.
 */
function isInlineMathBody(body: string): boolean {
  const t = body.trim();
  if (t === "") return false; // "$ $" / "$$" residue → literal dollars
  if (LATEX_MARKER.test(t)) return true;
  if (CURRENCY_PAIR.test(t)) return false;
  return !/[a-zA-Z]{3,}/.test(t);
}

/**
 * Offset of the first prose-like line in an UNCLOSED math body, or -1.
 *
 * Real math is symbol-dense (\\ ^ _ { } & =) with short lines; a prose
 * paragraph — e.g. the length-limit marker or the next answer's text once
 * swallowed by a stray opener — is an English line without LaTeX symbols.
 * Math lines like "S_n(1-r) &= a(1-r^n)" or "\\text{if } r>1" are guarded
 * by the symbol checks; three-plus alphabetic tokens without any LaTeX
 * marker is prose by construction.
 */
function firstProseLineOffset(body: string): number {
  let offset = 0;
  for (const raw of body.split("\n")) {
    const t = raw.trim();
    if (
      t.length >= 10 &&
      !LATEX_MARKER.test(t) &&
      !/[&=]/.test(t) &&
      (t.match(/[a-zA-Z]{2,}/g) ?? []).length >= 3
    ) {
      return offset;
    }
    offset += raw.length + 1;
  }
  return -1;
}

/** Append the \end{…} tokens for any environments left open in `body`. */
function closeOpenEnvironments(body: string): string {
  const stack: string[] = [];
  ENV_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENV_TOKEN_RE.exec(body)) !== null) {
    if (m[1] === "begin") stack.push(m[2]);
    else stack.pop();
  }
  if (stack.length === 0) return body;
  let closers = "";
  for (let k = stack.length - 1; k >= 0; k -= 1) {
    closers += `\n\\end{${stack[k]}}`;
  }
  return `${body.replace(/\s*$/, "")}${closers}`;
}

/**
 * KaTeX (like real LaTeX) rejects a bare & outside an environment —
 * "ParseError: Expected 'EOF', got '&'" — and with throwOnError:false that
 * surfaces the raw source as text. Models constantly write aligned-style
 * derivations using only $$ delimiters:
 *
 *   $$
 *   S_n - rS_n &= a - ar^n \\
 *   S_n(1-r) &= a(1-r^n)
 *   $$
 *
 * Give such bodies the aligned environment they obviously mean to have.
 * Bodies that already contain \begin{…} are left untouched — their &
 * belongs to that environment. \-only row breaks render fine and are not
 * wrapped.
 */
function alignWrap(body: string): string {
  if (!/(?<!\\)&/.test(body) || /\\begin\{/.test(body)) return body;
  return `\\begin{aligned}\n${body}\n\\end{aligned}`;
}

function normalizeChunk(chunk: string): string {
  let out = "";
  let i = 0;
  const n = chunk.length;

  /** Emit a display block in canonical own-line form. Idempotent: the
   *  separating newline is only added when the output does not already end
   *  with one, so re-running the scanner never accumulates blank lines. */
  const emitDisplay = (rawBody: string) => {
    let body = rawBody.trim();
    if (!body) return; // empty math renders nothing — drop silently
    // A row separator cut in half by truncation ("…a \") is a KaTeX parse
    // error — repair a lone trailing backslash into a row break.
    body = body.replace(/(?<!\\)\\$/, "\\\\");
    body = alignWrap(body);
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out += `$$\n${body}\n$$`;
  };

  /**
   * Close an UNCLOSED math capture (a $$ / \[ / bare \begin{env} whose
   * terminator never arrived before end-of-text).
   *
   * Two failure shapes reach this point and both must stay readable:
   *   1. Pure math so far (truncation mid-derivation) → close the open
   *      environments and emit a partial display block.
   *   2. Math first, PROSE later — the historical killer: the backend once
   *      appended its length-limit marker to a reply cut mid-$$, and
   *      remark-math's flow math (blank lines included) typeset the marker
   *      and everything after it as italic math soup. Split at the first
   *      prose line: the leading math renders as a balanced partial block,
   *      the prose (and any further math inside it) is re-scanned normally.
   */
  const balanceUnclosed = (rawBody: string) => {
    const splitAt = firstProseLineOffset(rawBody);
    if (splitAt === -1) {
      emitDisplay(closeOpenEnvironments(rawBody));
      return;
    }
    emitDisplay(closeOpenEnvironments(rawBody.slice(0, splitAt)));
    if (out.length > 0 && !out.endsWith("\n\n")) {
      out += out.endsWith("\n") ? "\n" : "\n\n";
    }
    out += normalizeChunk(rawBody.slice(splitAt).replace(/^\n+/, ""));
  };

  while (i < n) {
    const ch = chunk[i];

    if (ch === "\\") {
      const next = chunk[i + 1] ?? "";

      // Escaped dollar or row-break: literal, never a delimiter.
      if (next === "$" || next === "\\") {
        out += ch + next;
        i += 2;
        continue;
      }

      // \( … \) → inline math. Must close; unclosed \( at end-of-text only
      // balances when the tail is LaTeX-marked.
      if (next === "(") {
        const close = chunk.indexOf("\\)", i + 2);
        if (close !== -1) {
          out += `$${alignWrap(chunk.slice(i + 2, close).trim())}$`;
          i = close + 2;
        } else {
          const tail = chunk
            .slice(i + 2)
            .replace(/\n/g, " ")
            .trim();
          if (LATEX_MARKER.test(tail)) {
            out += `$${alignWrap(tail)}$`;
          } else {
            out += "\\(";
          }
          i = n;
        }
        continue;
      }

      // \[ … \] → display block.
      if (next === "[") {
        const close = chunk.indexOf("\\]", i + 2);
        if (close !== -1) {
          emitDisplay(chunk.slice(i + 2, close));
          i = close + 2;
          if (i < n && chunk[i] !== "\n") out += "\n";
        } else {
          balanceUnclosed(chunk.slice(i + 2));
          i = n;
        }
        continue;
      }

      // Bare \begin{env} outside any math → wrap in a display block.
      // Stack-balanced so nested environments (align containing aligned)
      // capture correctly. Math bodies are never scanned, so an
      // environment already inside $$…$$ can never be double-wrapped.
      const envOpen = /^\\begin\{([a-zA-Z*]+)\}/.exec(chunk.slice(i));
      if (envOpen && MATH_ENVS.has(envOpen[1])) {
        const env = envOpen[1];
        let j = i + envOpen[0].length;
        // \begin{array} takes a column-spec argument: {cclr}
        if (env === "array") {
          const arg = /^\s*\{[^{}]*\}/.exec(chunk.slice(j));
          if (arg) j += arg[0].length;
        }
        const rest = chunk.slice(j);
        ENV_TOKEN_RE.lastIndex = 0;
        const depthStack: string[] = [env];
        let endIdx = -1;
        let tm: RegExpExecArray | null;
        while ((tm = ENV_TOKEN_RE.exec(rest)) !== null) {
          if (tm[1] === "begin") {
            depthStack.push(tm[2]);
          } else {
            depthStack.pop();
            if (depthStack.length === 0) {
              endIdx = j + tm.index + tm[0].length;
              break;
            }
          }
        }
        if (endIdx !== -1) {
          emitDisplay(chunk.slice(i, endIdx));
          i = endIdx;
          if (i < n && chunk[i] !== "\n") out += "\n";
        } else {
          // Environment truncated before its \end — balance it.
          balanceUnclosed(chunk.slice(i));
          i = n;
        }
        continue;
      }

      // Any other backslash sequence in prose: emit the backslash and let
      // the next character be processed normally (renders literally).
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "$") {
      // ---- display ----
      if (chunk.startsWith("$$", i)) {
        const close = chunk.indexOf("$$", i + 2);
        if (close !== -1) {
          emitDisplay(chunk.slice(i + 2, close));
          i = close + 2;
          // Keep the closing fence on its own line (remark-math requires
          // it) without accumulating blank lines across re-runs.
          if (i < n && chunk[i] !== "\n") out += "\n";
        } else {
          // Unclosed $$ (truncated stream / stray opener) — see below.
          balanceUnclosed(chunk.slice(i + 2));
          i = n;
        }
        continue;
      }

      // ---- inline ----
      // remark-math only pairs single $ within one line — mirror that, or
      // prose dollars would pair across paragraphs.
      const lineEndIdx = chunk.indexOf("\n", i);
      let close = chunk.indexOf("$", i + 1);
      if (close === -1 || (lineEndIdx !== -1 && close > lineEndIdx)) close = -1;

      if (close === -1) {
        const body = chunk.slice(i + 1, lineEndIdx === -1 ? n : lineEndIdx);
        if (LATEX_MARKER.test(body)) {
          out += `$${alignWrap(body.trim())}$`; // truncated inline math → close it
          i = lineEndIdx === -1 ? n : lineEndIdx;
        } else {
          out += "\\$"; // "$5 with no pair" → literal dollar
          i += 1;
        }
        continue;
      }

      const body = chunk.slice(i + 1, close);
      if (isInlineMathBody(body)) {
        out += `$${alignWrap(body.trim())}$`;
        i = close + 1;
      } else {
        // Currency/prose span: escape the OPENER as a literal dollar and
        // re-scan from the closing dollar, which then pairs with the next
        // real math expression (greedy re-pairing).
        out += `\\$${body}`;
        i = close;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  return out.replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// Delimiter normalization — public entry point
// ---------------------------------------------------------------------------

/**
 * Normalize AI-produced mathematics into remark-math's $ / $$ dialect.
 *
 *  - \( … \)   → $ … $          (inline)
 *  - \[ … \]   → display block  ($$ / $$ on their own lines)
 *  - $$ … $$   → display block  (canonical own-line form)
 *  - bare \begin{aligned|align|cases|matrix|…} → display block
 *
 * Math bodies are preserved verbatim (alignment &, row separators \\,
 * spacing \\[4pt] all survive untouched). Code fences and inline code are
 * never touched. Currency like "$5 and $10" and prose dollars can never
 * pair with real math dollars. Truncated math is balanced; a stray $$
 * opener that would swallow prose is demoted to literal text.
 *
 * Deterministic, context-aware and idempotent — running it twice equals
 * running it once.
 */
export function normalizeMathDelimiters(text: string): string {
  const eol = text.replace(/\r\n?/g, "\n");
  return mapOpenSegments(eol, normalizeChunk);
}

// ---------------------------------------------------------------------------
// Incomplete-math guard — stream/truncation safety
// ---------------------------------------------------------------------------

/** Odd number of fence lines → the text ends inside an unterminated fence. */
function closeUnterminatedFence(text: string): string {
  const openers = text.match(/^[ \t]*(`{3,}|~{3,})[^\n]*$/gm) ?? [];
  if (openers.length % 2 === 1) return `${text.replace(/\s*$/, "")}\n\`\`\``;
  return text;
}

/**
 * Return text with every dangling construct closed so the renderer shows a
 * partial-but-styled result instead of leaking raw LaTeX:
 *   - unterminated code fence → closed
 *   - unclosed $$ / $ / \( / \[ / bare \begin{env} → balanced
 *   - stray $$ opener that would swallow prose → demoted to literal text
 *
 * Idempotent; a fully balanced message passes through structurally
 * unchanged (only delimiter dialect is canonicalized).
 */
export function balanceTrailingMath(text: string): string {
  return normalizeMathDelimiters(closeUnterminatedFence(text));
}

/**
 * True when the text ends inside an unterminated math region (open $$,
 * open single-$, or an unclosed \begin{env}) — i.e. a stream that stops
 * here is still mid-expression. Guards truncated replies.
 */
export function endsInsideMath(text: string): boolean {
  const segments = splitCodeSegments(text.replace(/\r\n?/g, "\n"));
  let displayDepth = 0;
  let inlineOpen = false;
  const envStack: string[] = [];

  segments.forEach((seg) => {
    if (seg.protectedSpan) return;
    let j = 0;
    while (j < seg.text.length) {
      const ch = seg.text[j];
      if (ch === "\\") {
        const next = seg.text[j + 1] ?? "";
        if (next === "$" || next === "\\") {
          j += 2;
          continue;
        }
        const envOpen = /^\\(begin|end)\{([a-zA-Z*]+)\}/.exec(seg.text.slice(j));
        if (envOpen && MATH_ENVS.has(envOpen[2])) {
          if (envOpen[1] === "begin") envStack.push(envOpen[2]);
          else envStack.pop();
          j += envOpen[0].length;
          continue;
        }
        const bracketOpen = next === "(" || next === "[";
        const bracketClose = next === ")" || next === "]";
        if (bracketOpen || bracketClose) {
          j += 2;
          continue;
        }
        j += 2;
        continue;
      }
      if (ch === "$") {
        if (seg.text.startsWith("$$", j)) {
          displayDepth = displayDepth === 0 ? 1 : 0;
          inlineOpen = false;
          j += 2;
          continue;
        }
        if (!inlineOpen) {
          const nextChar = seg.text[j + 1] ?? "";
          if (nextChar && !/\s/.test(nextChar)) inlineOpen = true;
        } else {
          const prevChar = seg.text[j - 1] ?? "";
          if (!/\s/.test(prevChar)) inlineOpen = false;
        }
        j += 1;
        continue;
      }
      j += 1;
    }
  });

  return displayDepth > 0 || inlineOpen || envStack.length > 0;
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
