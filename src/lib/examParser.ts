// examParser — DETERMINISTIC exam-paper parser. Zero AI. Zero API calls.
//
// Real past-exam papers are highly structured (numbered questions, lettered
// options, an optional answer key) — parsing them is a pattern-matching
// problem, not an AI interpretation problem. This module turns
// reading-order text (from examLayout.ts for text-layer PDFs, or from
// Tesseract.js OCR for scans) into the exact question shape the digital
// player already renders.
//
// ── How it works ────────────────────────────────────────────────────────
//   1. NOISE STRIP   page numbers, "N | Page", branding footers, markers.
//   2. ANSWER-KEY PASS (before question segmentation) — keys live in dense
//      runs of "1. B  2. A  3. D" pairs or in number-row/letter-row tables
//      ("1 21 41" over "D B B"). Key lines are consumed so they can never
//      pollute question parsing.
//   3. NUMBERING-STYLE DETECTION — candidate regexes ("12." / "12)" /
//      "Q1." / "Q. 12:") are each scored by the total length of STRICTLY
//      SEQUENTIAL runs of matched numbers (restarts at 1 between sections
//      are fine — each run must simply climb +1). The best style wins.
//   4. OPTION-STYLE DETECTION — "A." / "A)" / "(A)" / bare "A " matchers,
//      most-explicit-first; a style is confirmed when it yields valid
//      option sets (a permutation of a prefix of A..H) for the majority of
//      question blocks. Mid-line options ("A. xx C. yy" grid layouts) and
//      the printed A/C-then-B/D two-per-line arrangement are both handled.
//   5. STRUCTURED QUESTIONS — a block with no valid option set is a
//      free-response question (options: []).
//   6. DIAGRAM HONESTY — a question whose stem is empty (or tiny) relative
//      to its options is flagged figureHint=true with an honest placeholder
//      pointing at the original page; never silently incomplete.
//   7. CONFIDENCE — a real, computed signal: sequential continuity, option
//      consistency, share of document text captured inside parsed blocks,
//      and stem quality. High → auto-live; low → admin review queue.
//
// PURE FUNCTIONS ONLY — runs server-side (Convex action/mutation), in the
// browser, and in this repo's test scripts, all on the same code.

// ─── Public shapes ──────────────────────────────────────────────────────

export interface ParsedQuestion {
  number: number; // printed number in the paper (renumbered 1..N at completion)
  kind: "mcq" | "structured";
  text: string;
  passage?: string;
  options: { label: string; text: string }[];
  answer?: string;
  suggestedAnswer?: string;
  explanation?: string;
  topic?: string;
  sourcePage?: number;
  figureHint?: boolean;
}

export interface ParserMeta {
  numberingStyle: string; // "N." | "N)" | "QN" | "none"
  optionStyle: string; // "A." | "A)" | "(A)" | "A " | "none"
  questionCount: number;
  mcqCount: number;
  structuredCount: number;
  answerKeyCount: number; // answers mapped onto questions
  answerKeySource: "inline" | "table" | "linked_pdf" | "none";
  flaggedDiagrams: number;
  sequenceContinuity: number; // 0..1
  optionConsistency: number; // 0..1
  textCoveragePct: number; // 0..1
  stemsFlaggedShort: number;
}

export type ParseConfidence = { confidence: number; reviewStatus: "auto" | "needs_review" };

export type ParseResult =
  | ({ kind: "questions" } & ParseConfidence & {
      questions: ParsedQuestion[];
      meta: ParserMeta;
    })
  | { kind: "answer_key_document"; keyCount: number; meta: Pick<ParserMeta, "answerKeySource"> };

// ─── Noise stripping ────────────────────────────────────────────────────

const PAGE_MARKER_RE = /^=+\s*PAGE\s+\d+\s*=+$/i;
const BARE_NUMBER_RE = /^\d{1,4}$/;
const PAGE_N_RE = /^page\s*\d+(\s*(of|\/)\s*\d+)?$/i;
const PIPE_PAGE_RE = /^\d{1,3}\s*\|\s*p\s*a\s?g\s?e\b/i;
const BRAND_RE = /learnyx|academy\s*et\b|vercel\.app/i;

function isNoiseLine(raw: string): boolean {
  const line = raw.trim();
  if (!line) return true;
  if (PAGE_MARKER_RE.test(line)) return true;
  if (BARE_NUMBER_RE.test(line)) return true;
  if (PAGE_N_RE.test(line)) return true;
  if (PIPE_PAGE_RE.test(line)) return true;
  if (BRAND_RE.test(line)) return true;
  // Punctuation-only / single stray glyph lines (equation fragments land here).
  if (line.replace(/[^A-Za-z0-9]/g, "").length <= 1) return true;
  return false;
}

/**
 * OCR scans of answer-sheet-style papers carry radio-button bubbles that
 * recognize as "(O", "(OO", "O)" etc. Strip them before parsing — they are
 * never legitimate text (bare "O" at a line end is not chemistry here).
 */
function stripOcrBubbles(line: string): string {
  return line
    .replace(/\(\s*[O〇©]\s*\)(?=\s|$)/g, " ")
    .replace(/\(\s*[O〇©]{1,4}(?=\s)/g, " ")
    .replace(/(?<=\s)[O〇©](?=\s*$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface LineInfo {
  text: string;
  page: number;
  consumed: boolean; // eaten by the answer-key pass
}

function flatten(pages: string[]): LineInfo[] {
  const lines: LineInfo[] = [];
  pages.forEach((pageText, i) => {
    for (const raw of pageText.split("\n")) {
      let text = raw.replace(/\s+/g, " ").trim();
      if (isNoiseLine(text)) continue;
      if (/[(〇©]|[O〇©]\)/.test(text)) text = stripOcrBubbles(text);
      if (!text) continue;
      lines.push({ text, page: i + 1, consumed: false });
    }
  });
  return lines;
}

// ─── Answer-key extraction ──────────────────────────────────────────────

export interface ExtractedKey {
  map: Map<number, string>;
  source: "inline" | "table";
  /** Line indexes consumed by the key (inline style only). */
  consumedLines: Set<number>;
}

const PAIR_RE = /(?:^|[\s(])(\d{1,3})\s*[.):\]\-]?\s*\(?([A-H])(?=[\s.,;)\]]|$)/g;
const BARE_NUMS_RE = /^(?:\d{1,3}[\s,;|]+)+\d{1,3}[\s,;|]*$/;
const BARE_LETTERS_RE = /^(?:[A-H][\s,;|]+)*[A-H][\s,;|]*$/;

function splitList(line: string, isNums: boolean): string[] {
  return line
    .split(/[\s,;|]+/)
    .filter(Boolean)
    .filter((tok) => (isNums ? /^\d{1,3}$/.test(tok) : /^[A-H]$/.test(tok)));
}

/**
 * Pull a question-number → letter key out of raw page text. Handles both
 * the "1. B  2. A  3. D" run style (anywhere in the document, dense-window
 * guarded so ordinary questions never false-positive) and the answer-sheet
 * table style (a row of bare numbers above a row of bare letters).
 */
export function extractAnswerKey(pages: string[]): ExtractedKey | null {
  const lines = flatten(pages);

  // ── Style A: number-row / letter-row tables ──
  const tableMap = new Map<number, string>();
  let tableHits = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i]!;
    const b = lines[i + 1]!;
    if (a.consumed || b.consumed) continue;
    if (!BARE_NUMS_RE.test(a.text) || !BARE_LETTERS_RE.test(b.text)) continue;
    const nums = splitList(a.text, true);
    const letters = splitList(b.text, false);
    if (nums.length < 3 || nums.length !== letters.length) continue;
    for (let k = 0; k < nums.length; k++) {
      const n = Number(nums[k]);
      const letter = letters[k]!;
      if (!tableMap.has(n)) tableMap.set(n, letter);
    }
    tableHits += nums.length;
  }

  // ── Style B: dense inline pairs "1. B  2. A" ──
  interface Pair {
    lineIdx: number;
    num: number;
    letter: string;
  }
  const pairs: Pair[] = [];
  lines.forEach((line, lineIdx) => {
    if (!line.text) return;
    for (const m of line.text.matchAll(PAIR_RE)) {
      pairs.push({ lineIdx, num: Number(m[1]), letter: m[2]! });
    }
  });

  // Group into dense windows: consecutive pairs within 10 lines of each other.
  const regions: Pair[][] = [];
  let current: Pair[] = [];
  for (const p of pairs) {
    if (
      current.length === 0 ||
      p.lineIdx - current[current.length - 1]!.lineIdx <= 10
    ) {
      current.push(p);
    } else {
      regions.push(current);
      current = [p];
    }
  }
  if (current.length > 0) regions.push(current);

  // A real key region: ≥8 pairs, ≥6 distinct numbers, mostly distinct.
  let best: Pair[] | null = null;
  for (const region of regions) {
    const distinct = new Set(region.map((p) => p.num));
    if (region.length < 8 || distinct.size < 6) continue;
    if (distinct.size / region.length < 0.55) continue;
    if (!best || region.length > best.length) best = region;
  }

  const inlineMap = new Map<number, string>();
  const consumed = new Set<number>();
  if (best) {
    for (const p of best) {
      if (!inlineMap.has(p.num)) inlineMap.set(p.num, p.letter);
      consumed.add(p.lineIdx);
    }
  }

  // Whichever extractor recovered more entries wins.
  if (tableMap.size >= inlineMap.size && tableMap.size >= 15) {
    return { map: tableMap, source: "table", consumedLines: new Set() };
  }
  if (inlineMap.size > 0) {
    return { map: inlineMap, source: "inline", consumedLines: consumed };
  }
  if (tableMap.size > 0) {
    return { map: tableMap, source: "table", consumedLines: new Set() };
  }
  return null;
}

// ─── Numbering styles ───────────────────────────────────────────────────

interface NumMatch {
  lineIdx: number;
  num: number;
}

const NUMBERING_STYLES: { id: string; re: RegExp }[] = [
  { id: "N.", re: /^\s*(\d{1,3})\s*[.)]\s*/ },
  { id: "QN", re: /^\s*[Qq]\s*[.)]?\s*(\d{1,3})\s*[.):]?\s*/ },
];

/**
 * Find strictly-sequential runs (+1 climbs; restarts between sections are
 * separate runs). Runs shorter than MIN_RUN are dropped as false positives.
 */
function sequentialRuns(matches: NumMatch[]): NumMatch[][] {
  const runs: NumMatch[][] = [];
  let run: NumMatch[] = [];
  for (const m of matches) {
    if (run.length === 0 || m.num === run[run.length - 1]!.num + 1) {
      run.push(m);
    } else {
      if (run.length > 0) runs.push(run);
      run = [m];
    }
  }
  if (run.length > 0) runs.push(run);
  return runs;
}

const MIN_RUN = 3;

// ─── Option styles ──────────────────────────────────────────────────────

interface OptMatch {
  letter: string;
  start: number; // index into the flattened block text
  textStart: number; // where the option's own text begins
}

const OPTION_STYLES: { id: string; re: RegExp }[] = [
  { id: "A.", re: /(?:^|[\s(])([A-H])[.)]\s*/g },
  { id: "(A)", re: /(?:^|[\s])\(([A-H])\)\s*/g },
  { id: "A ", re: /(?:^|[\s])([A-H])\s+(?=[^\s])/g },
];

/**
 * From a block's flattened text, extract the option match set for a style:
 * keep the FIRST occurrence of each letter, require the letters to form a
 * prefix of A..H (in any printed order — grid layouts print A/C then B/D),
 * and require every option to have some text before the next one.
 */
function extractOptionRun(
  text: string,
  re: RegExp,
): { opts: { letter: string; text: string; textStart: number }[]; matches: OptMatch[] } | null {
  const found: OptMatch[] = [];
  for (const m of text.matchAll(re)) {
    const letter = m[1]!;
    if (m.index === undefined) continue;
    found.push({ letter, start: m.index, textStart: m.index + m[0].length });
  }
  if (found.length < 2) return null;

  const byLetter = new Map<string, OptMatch>();
  for (const f of found) if (!byLetter.has(f.letter)) byLetter.set(f.letter, f);
  const letters = [...byLetter.keys()].sort();
  // Must be exactly a prefix of A..H of size 2..8.
  const expected = "ABCDEFGH".slice(0, letters.length);
  if (letters.join("") !== expected || letters.length > 8) return null;

  // Text boundaries: each option runs to the next match's text start (in
  // printed order, not letter order).
  const ordered = [...byLetter.values()].sort((a, b) => a.start - b.start);
  const opts: { letter: string; text: string; textStart: number }[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i]!;
    const next = ordered[i + 1];
    const raw = text.slice(cur.textStart, next ? next.start : undefined);
    const clean = raw.replace(/\s+/g, " ").trim();
    if (!clean) return null; // an option with no text is a false run
    opts.push({ letter: cur.letter, text: clean, textStart: cur.textStart });
  }
  return { opts, matches: found };
}

// ─── Figure / diagram detection ─────────────────────────────────────────

const FIGURE_RE =
  /\b(figure|fig\.|diagram|graph|map|chart|table|illustration|circuit|picture|image|drawing|plot)\b/i;

const DIAGRAM_PLACEHOLDER =
  "(This question's text is inside a diagram or image — open the original page to read it.)";

// ─── The parser ─────────────────────────────────────────────────────────

export const AUTO_CONFIDENCE_THRESHOLD = 70;
const MIN_QUESTIONS_FOR_AUTO = 5;

/**
 * Parse reading-order page texts into structured questions. See the module
 * header for the full pipeline. Never throws — a paper that doesn't match
 * returns zero questions with an honest confidence score.
 */
export function parseExam(pages: string[]): ParseResult {
  const key = extractAnswerKey(pages);
  const lines = flatten(pages);
  if (key) for (const idx of key.consumedLines) lines[idx]!.consumed = true;

  const bodyChars = lines.reduce((s, l) => s + l.text.length, 0);

  // ── Numbering style ──
  let bestStyle: { id: string; runs: NumMatch[][]; matches: NumMatch[] } | null = null;
  for (const style of NUMBERING_STYLES) {
    const matches: NumMatch[] = [];
    lines.forEach((line, lineIdx) => {
      if (line.consumed) return;
      const m = line.text.match(style.re);
      if (m) matches.push({ lineIdx, num: Number(m[1]!) });
    });
    const runs = sequentialRuns(matches).filter((r) => r.length >= MIN_RUN);
    const score = runs.reduce((s, r) => s + r.length, 0);
    const bestScore = bestStyle
      ? bestStyle.runs.reduce((s, r) => s + r.length, 0)
      : 0;
    if (score > bestScore) bestStyle = { id: style.id, runs, matches };
  }

  if (!bestStyle || bestStyle.runs.length === 0) {
    // No questions at all — an answer-key-only document is a REAL, useful
    // result (admins link it to its questions paper via answerKeyContentId).
    if (key && key.map.size >= 15) {
      return {
        kind: "answer_key_document",
        keyCount: key.map.size,
        meta: { answerKeySource: key.source },
      };
    }
    const meta: ParserMeta = emptyMeta();
    return {
      kind: "questions",
      questions: [],
      meta,
      confidence: 0,
      reviewStatus: "needs_review",
    };
  }

  const runMatches = bestStyle.runs.flat();
  const runSet = new Set(runMatches.map((m) => m.lineIdx));

  // ── Question blocks ──
  interface Block {
    start: NumMatch;
    endLine: number; // exclusive
    page: number;
  }
  const blocks: Block[] = [];
  for (let i = 0; i < runMatches.length; i++) {
    const start = runMatches[i]!;
    const next = runMatches[i + 1];
    const endLine = next ? next.lineIdx : lines.length;
    blocks.push({ start, endLine, page: lines[start.lineIdx]!.page });
  }

  // ── Option style: most explicit style that validates the most blocks ──
  const blockTexts = blocks.map((b) =>
    lines
      .slice(b.start.lineIdx, b.endLine)
      .map((l) => l.text)
      .join("\n"),
  );

  let chosenOptionStyle = "none";
  let chosenResults: ({ opts: { letter: string; text: string; textStart: number }[] } | null)[] =
    new Array(blocks.length).fill(null);
  let bestValidCount = 0;

  for (const style of OPTION_STYLES) {
    const results = blockTexts.map((text) => {
      const re = new RegExp(style.re.source, style.re.flags);
      return extractOptionRun(text, re);
    });
    const valid = results.filter((r) => r !== null).length;
    // Bare "A " is the wildcard matcher — only allowed when the explicit
    // styles both failed AND it validates a clear majority.
    const required =
      style.id === "A " ? Math.ceil(blocks.length * 0.7) : Math.ceil(blocks.length * 0.4);
    if (valid >= required && valid > bestValidCount) {
      bestValidCount = valid;
      chosenOptionStyle = style.id;
      chosenResults = results;
    }
  }

  // ── Assemble questions ──
  const questions: ParsedQuestion[] = [];
  let mcqCount = 0;
  let structuredCount = 0;
  let flaggedDiagrams = 0;
  let stemsFlaggedShort = 0;
  let blockChars = 0;

  blocks.forEach((block, i) => {
    const blockText = blockTexts[i]!;
    blockChars += blockText.length;
    const printed = block.start.num;
    const res = chosenResults[i];

    // Stem = block text after the numbering marker and before the first
    // option match. Both anchors are computed on the SAME flattened text.
    let stem = blockText;
    const numRe = NUMBERING_STYLES.find((s) => s.id === bestStyle!.id)!.re;
    const numM = stem.match(numRe);
    if (numM && numM.index !== undefined) stem = stem.slice(numM.index + numM[0].length);
    if (res && res.opts.length > 0) {
      const firstRe = new RegExp(
        OPTION_STYLES.find((s) => s.id === chosenOptionStyle)!.re.source,
        "g",
      );
      const m = firstRe.exec(blockText);
      if (m && m.index !== undefined) {
        // Cut relative to the post-numbering offset: keep only the head.
        const cut = m.index - (blockText.length - stem.length);
        stem = cut > 0 ? stem.slice(0, cut) : "";
      }
    }
    stem = stem.replace(/\s+/g, " ").trim();

    const hasOptions = !!res && res.opts.length >= 2;
    if (hasOptions) mcqCount += 1;
    else structuredCount += 1;

    const figureWords = FIGURE_RE.test(stem);
    const shortStem = hasOptions && stem.length < 40;
    const emptyStem = stem.length === 0;
    if (shortStem || emptyStem) stemsFlaggedShort += 1;

    const text = emptyStem ? DIAGRAM_PLACEHOLDER : stem;
    const figureHint = figureWords || (shortStem && hasOptions) || emptyStem;
    if (figureHint && (shortStem || emptyStem || figureWords) && (emptyStem || shortStem)) {
      flaggedDiagrams += 1;
    }

    const q: ParsedQuestion = {
      number: printed,
      kind: hasOptions ? "mcq" : "structured",
      text: text.slice(0, 2000) || DIAGRAM_PLACEHOLDER,
      options: [],
      sourcePage: block.page,
      figureHint,
    };
    if (hasOptions) {
      // Use the letters the paper actually printed (grid layouts print
      // A/C then B/D — labels come from the text, sorted A..H for display).
      const withRealLetters = res!.opts
        .map((o) => ({ label: o.letter, text: o.text.slice(0, 500) }))
        .sort((a, b) => a.label.localeCompare(b.label));
      q.options = withRealLetters;
      const ans = key?.map.get(printed);
      if (ans && q.options.some((o) => o.label === ans.toUpperCase())) {
        q.answer = ans.toUpperCase();
      }
    }
    questions.push(q);
  });

  // ── Confidence ──
  const sequenceContinuity =
    bestStyle.matches.length > 0 ? runMatches.length / bestStyle.matches.length : 0;
  const optionConsistency =
    blocks.length > 0 ? (mcqCount + 0) / blocks.length : 0;
  const textCoveragePct = bodyChars > 0 ? Math.min(1, blockChars / bodyChars) : 0;
  const stemQuality =
    questions.length > 0 ? 1 - stemsFlaggedShort / questions.length : 0;

  const confidence = Math.round(
    100 *
      (0.3 * sequenceContinuity +
        0.35 * optionConsistency +
        0.25 * textCoveragePct +
        0.1 * stemQuality),
  );

  const meta: ParserMeta = {
    numberingStyle: bestStyle.id,
    optionStyle: chosenOptionStyle,
    questionCount: questions.length,
    mcqCount,
    structuredCount,
    answerKeyCount: questions.filter((q) => q.answer).length,
    answerKeySource: key && questions.some((q) => q.answer) ? key.source : "none",
    flaggedDiagrams,
    sequenceContinuity: Math.round(sequenceContinuity * 100) / 100,
    optionConsistency: Math.round(optionConsistency * 100) / 100,
    textCoveragePct: Math.round(textCoveragePct * 100) / 100,
    stemsFlaggedShort,
  };

  const reviewStatus: "auto" | "needs_review" =
    confidence >= AUTO_CONFIDENCE_THRESHOLD && questions.length >= MIN_QUESTIONS_FOR_AUTO
      ? "auto"
      : "needs_review";

  return { kind: "questions", questions, meta, confidence, reviewStatus };
}

function emptyMeta(): ParserMeta {
  return {
    numberingStyle: "none",
    optionStyle: "none",
    questionCount: 0,
    mcqCount: 0,
    structuredCount: 0,
    answerKeyCount: 0,
    answerKeySource: "none",
    flaggedDiagrams: 0,
    sequenceContinuity: 0,
    optionConsistency: 0,
    textCoveragePct: 0,
    stemsFlaggedShort: 0,
  };
}

/** Merge answers from a linked answer-key PDF's text (by printed number). */
export function mergeAnswerKey(questions: ParsedQuestion[], key: Map<number, string>): number {
  let merged = 0;
  for (const q of questions) {
    if (q.answer || q.kind !== "mcq") continue;
    const letter = key.get(q.number);
    if (letter && q.options.some((o) => o.label === letter.toUpperCase())) {
      q.answer = letter.toUpperCase();
      merged += 1;
    }
  }
  return merged;
}
