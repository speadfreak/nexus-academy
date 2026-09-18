// examLayout — LAYOUT-AWARE PDF text extraction (pure, zero imports).
//
// THE FOUNDATION of the deterministic exam parser: pattern-matching only
// works when text arrives in true reading order. pdf.js hands us positioned
// text items, not lines — and academic PDFs are frequently TWO-COLUMN,
// where naive top-to-bottom ordering interleaves the columns into garbage.
//
// What this module does per page:
//   1. Bucket text items into visual lines by baseline Y (2pt bands).
//   2. Classify every line as LEFT / RIGHT / SPANNING relative to the page
//      midpoint (weighted by where the text actually sits).
//   3. Detect a genuine two-column layout: both sides carry substantial
//      text AND only a small fraction of lines cross the gutter.
//   4. Emit reading order:
//        • single column  → top-to-bottom (descending Y), x-sorted in line.
//        • two columns    → headers (spanning lines above the body), full
//          LEFT column top-to-bottom, mid-page spanning lines, then full
//          RIGHT column top-to-bottom, then footers.
//
// ZERO runtime imports — importable from a Convex "use node" action, the
// browser bundle, and tests alike.

import type { TextItemLike } from "./pdfTextShared";

interface Seg {
  x: number;
  endX: number;
  str: string;
}

interface Line {
  y: number;
  segs: Seg[];
  text: string;
  chars: number;
  x0: number;
  x1: number;
}

function buildLines(items: TextItemLike[]): Line[] {
  const buckets = new Map<number, Seg[]>();
  for (const item of items) {
    const str = typeof item.str === "string" ? item.str : "";
    if (!str.trim()) continue;
    const t = item.transform;
    if (!t || t.length < 6) continue;
    const x = t[4]!;
    const y = Math.round(t[5]! / 2) * 2; // 2pt bands — one visual line
    const width =
      typeof item.width === "number" && item.width > 0 ? item.width : str.length * 4;
    const seg: Seg = { x, endX: x + width, str };
    const bucket = buckets.get(y);
    if (bucket) bucket.push(seg);
    else buckets.set(y, [seg]);
  }

  const lines: Line[] = [];
  for (const [y, segs] of buckets) {
    segs.sort((a, b) => a.x - b.x);
    let text = "";
    let prevEnd = -Infinity;
    for (const seg of segs) {
      const gap = seg.x - prevEnd;
      if (text.length > 0 && gap > 6) text += " ";
      text += seg.str;
      prevEnd = seg.endX;
    }
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) continue;
    lines.push({
      y,
      segs,
      text: clean,
      chars: clean.length,
      x0: segs[0]!.x,
      x1: segs[segs.length - 1]!.endX,
    });
  }
  lines.sort((a, b) => b.y - a.y); // top-to-bottom in pdf.js coords
  return lines;
}

/**
 * Assemble one page's positioned text items into reading-order text.
 * Falls back to plain top-to-bottom assembly when no two-column structure
 * is detected (identical output to the historic assemblePageText then).
 */
export function assemblePageTextLayout(items: TextItemLike[]): string {
  const lines = buildLines(items);
  if (lines.length === 0) return "";

  // ── Column analysis ─────────────────────────────────────────────────
  const x0 = Math.min(...lines.map((l) => l.x0));
  const x1 = Math.max(...lines.map((l) => l.x1));
  const midX = (x0 + x1) / 2;

  let leftChars = 0;
  let rightChars = 0;
  let spanChars = 0;
  let leftLines = 0;
  let rightLines = 0;
  let spanLines = 0;
  type Kind = "L" | "R" | "S";
  const kinds: Kind[] = [];

  for (const line of lines) {
    // A line is "left" when at least 85% of its text sits left of midX.
    let leftWeight = 0;
    let total = 0;
    for (const seg of line.segs) {
      const w = seg.str.trim().length || 1;
      total += w;
      const overlapLeft = Math.max(0, Math.min(seg.endX, midX) - seg.x);
      leftWeight += (overlapLeft / Math.max(1, seg.endX - seg.x)) * w;
    }
    const kind: Kind =
      leftWeight / total >= 0.85 ? "L" : leftWeight / total <= 0.15 ? "R" : "S";
    kinds.push(kind);
    if (kind === "L") {
      leftChars += line.chars;
      leftLines += 1;
    } else if (kind === "R") {
      rightChars += line.chars;
      rightLines += 1;
    } else {
      spanChars += line.chars;
      spanLines += 1;
    }
  }

  const totalChars = leftChars + rightChars + spanChars;
  const twoColumn =
    totalChars > 400 &&
    spanChars / totalChars < 0.22 &&
    leftChars / totalChars > 0.18 &&
    rightChars / totalChars > 0.18 &&
    leftLines >= 4 &&
    rightLines >= 4;

  if (!twoColumn) {
    return lines.map((l) => l.text).join("\n");
  }

  // ── Two-column reading order ────────────────────────────────────────
  const bodyTop = Math.max(...lines.filter((_, i) => kinds[i] !== "S").map((l) => l.y));
  const bodyBottom = Math.min(...lines.filter((_, i) => kinds[i] !== "S").map((l) => l.y));
  const above: string[] = [];
  const left: string[] = [];
  const middle: string[] = [];
  const right: string[] = [];
  const below: string[] = [];
  lines.forEach((line, i) => {
    const kind = kinds[i]!;
    if (kind === "L") left.push(line.text);
    else if (kind === "R") right.push(line.text);
    else if (line.y > bodyTop) above.push(line.text);
    else if (line.y < bodyBottom) below.push(line.text);
    else middle.push(line.text);
  });
  return [...above, ...left, ...middle, ...right, ...below].join("\n");
}
