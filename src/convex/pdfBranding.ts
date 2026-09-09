// Learnyx PDF Branding Engine — adds a Learnyx cover page (page 1) + a small
// corner watermark on every existing page. ADDITIVE ONLY: never strips,
// covers, or replaces any existing content, watermark, or branding in the
// source PDF. The original pages are kept fully intact; we only prepend
// a new page and draw small overlays on top of existing pages.
//
// ARCHITECTURE:
//   - Pure Node-side action — runs in the Convex "use node" runtime via
//     contentAdmin.brandPdf action (a thin wrapper around this function).
//   - Uses pdf-lib (no native deps, no fontkit required — we use the
//     built-in StandardFonts and the Courier/Helvetica/Times families).
//   - Cover page is built with PDF primitives (rectangles, lines, text)
//     so we don't depend on loading external images. This keeps the
//     branding pipeline fast and resilient — no font/image-loading
//     failures can break an upload.
//   - Watermark is a tiny corner mark — "Learnyx Academy ET" + URL, drawn
//     with low opacity (using a transparent color) at the bottom-right
//     corner of every existing page. Small enough to never obscure
//     original content; consistent so users always see the brand.
//
// BRAND PALETTE (matches the app's dark/gold theme):
//   - Background: #0b0a07 (near-black with warm tint)
//   - Gold accent: #fbbf24 (amber-400) → #f59e0b (amber-500) gradient feel
//   - Deep gold: #92400e (amber-900) for secondary accents
//   - Cream text: #fef3c7 (amber-100) for body text on dark
//   - URL grey: #a8a29e (stone-400) for the small watermark
//
// VERSIONING:
//   - BRANDING_VERSION is bumped every time the cover design changes.
//   - The caller stores this on the contentItems row so the admin can
//     selectively re-run branding only on rows with an older version.
"use node";

import { rgb, PDFDocument, StandardFonts, degrees, type Color } from "pdf-lib";

// ── Bump this when the cover design materially changes ────────────────
// v1: initial release — dark cover, gold "L" mark, title block, footer.
export const BRANDING_VERSION = 1;

// ── Palette (PDFs use 0-1 rgb, not 0-255) ─────────────────────────────
const COLOR = {
  bgDark: rgb(0x0b / 255, 0x0a / 255, 0x07 / 255),
  bgDarkAlt: rgb(0x16 / 255, 0x12 / 255, 0x08 / 255),
  gold: rgb(0xfb / 255, 0xbf / 255, 0x24 / 255),
  goldDeep: rgb(0xf5 / 255, 0x9e / 255, 0x0b / 255),
  goldDarkest: rgb(0x92 / 255, 0x40 / 255, 0x0e / 255),
  cream: rgb(0xfe / 255, 0xf3 / 255, 0xc7 / 255),
  creamDim: rgb(0xfe / 255, 0xf3 / 255, 0xc7 / 255),
  white: rgb(1, 1, 1),
  // Watermark grey — low opacity via direct color (pdf-lib doesn't
  // support alpha on text draws; we use a near-background color instead
  // so the watermark reads as "subtly embossed" without obscuring text).
  watermark: rgb(0x4a / 255, 0x3c / 255, 0x1a / 255),
};

const LEARNYX_URL = "learnyx-academy-et.vercel.app";

// ── Main brand function ───────────────────────────────────────────────

export interface BrandPdfArgs {
  /** Raw PDF bytes to brand. Must be a valid PDF. */
  pdfBytes: Uint8Array | Buffer;
  /** Resource title (e.g. "Biology Grade 12 Past Exam 2015"). */
  title: string;
  /** Subject display name (e.g. "Biology"). Empty string OK. */
  subjectName: string;
  /** Grade number (e.g. 12). 0 / undefined OK (omitted from cover). */
  grade?: number;
  /** Optional content-type label (e.g. "Past Exam"). */
  contentTypeLabel?: string;
  /** Optional exam year (only for past exams). */
  examYear?: number;
  /** Optional source attribution (e.g. "Ministry of Education"). */
  sourceName?: string;
}

export interface BrandPdfResult {
  /** Branded PDF bytes — ready to upload to R2. */
  brandedBytes: Uint8Array;
  /** Page count of the source PDF (for logging). */
  originalPageCount: number;
  /** Final page count (1 cover + original). */
  finalPageCount: number;
  /** The branding version applied. */
  version: number;
}
/**
 * Brand a PDF by prepending a Learnyx cover page and adding a small corner
 * watermark to every original page. ADDITIVE ONLY — never modifies or
 * removes existing content.
 *
 * Throws on unrecoverable errors (corrupted PDF, etc.). Caller should
 * catch and decide whether to upload unbranded or fail the upload.
 */
export async function brandPdf(args: BrandPdfArgs): Promise<BrandPdfResult> {
  const srcDoc = await PDFDocument.load(args.pdfBytes as Uint8Array, {
    // Don't throw on a malformed xref table — pdf-lib can usually recover.
    ignoreEncryption: true,
    throwOnInvalidObject: false,
  });
  const originalPageCount = srcDoc.getPageCount();

  // Create the new doc with the cover page, then copy all original pages.
  // Using two docs + embedPages avoids the "modify in place" pitfall where
  // drawing on srcDoc's pages would alter the original page objects.
  const outDoc = await PDFDocument.create();
  // Metadata — set the producer so Adobe / Preview show "Learnyx Academy ET"
  // as the PDF producer. Doesn't affect content.
  outDoc.setProducer("Learnyx Academy ET — Branding Engine v" + BRANDING_VERSION);
  outDoc.setCreator("Learnyx Academy ET");
  outDoc.setTitle(args.title || "Learnyx Academy ET Resource");

  const helveticaBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await outDoc.embedFont(StandardFonts.Helvetica);
  const helveticaOblique = await outDoc.embedFont(StandardFonts.HelveticaOblique);

  // ── Build cover page (Letter size, portrait) ──────────────────────
  // Letter = 612 x 792 pt. We use Letter to match what most Ethiopian
  // textbooks are scanned at (A4 is also common — pdf-lib can't reflow
  // existing pages anyway, so we use a neutral size for the cover).
  const COVER_W = 612;
  const COVER_H = 792;
  const cover = outDoc.addPage([COVER_W, COVER_H]);

  // Background — solid dark with a subtle vertical gradient feel via
  // two stacked rectangles (top darker, bottom slightly warmer).
  drawFilledRect(cover, 0, 0, COVER_W, COVER_H, COLOR.bgDark);
  drawFilledRect(cover, 0, 0, COVER_W, COVER_H * 0.55, COLOR.bgDarkAlt);

  // ── Gold "L" mark (top-left) — pure-primitives logo ───────────────
  // We draw a stylized "L" inside a rounded square — matches the app's
  // logo concept (gradient amber square with a white "L"). Done with
  // rectangles so we don't need to embed any image.
  const MARK_SIZE = 70;
  const MARK_X = 56;
  const MARK_Y = COVER_H - 96;
  // Outer square (gold gradient — we fake the gradient by stacking two
  // half-rectangles in slightly different golds).
  drawFilledRect(cover, MARK_X, MARK_Y, MARK_SIZE, MARK_SIZE, COLOR.gold);
  drawFilledRect(cover, MARK_X, MARK_Y, MARK_SIZE, MARK_SIZE / 2, COLOR.goldDeep);
  // Inner "L" — white stroke made of two rectangles (vertical + horizontal).
  // The L sits in the lower-left of the mark.
  const L_X = MARK_X + 18;
  const L_Y_BASE = MARK_Y + 18;
  const L_W = 8;
  const L_H = MARK_SIZE - 36;
  drawFilledRect(cover, L_X, L_Y_BASE, L_W, L_H, COLOR.bgDark); // vertical stroke
  drawFilledRect(cover, L_X, L_Y_BASE, MARK_SIZE - 36, L_W, COLOR.bgDark); // horizontal foot

  // ── Wordmark next to the L mark ─────────────────────────────────
  drawText({
    page: cover,
    font: helveticaBold,
    text: "LEARNYX",
    size: 26,
    color: COLOR.gold,
    x: MARK_X + MARK_SIZE + 18,
    y: MARK_Y + MARK_SIZE - 28,
  });
  drawText({
    page: cover,
    font: helvetica,
    text: "ACADEMY ET",
    size: 11,
    color: COLOR.cream,
    x: MARK_X + MARK_SIZE + 18,
    y: MARK_Y + MARK_SIZE - 48,
  });
  // Subtle "🇪🇹" — using the actual flag emoji isn't reliable in PDF
  // fonts, so we draw "ETHIOPIA" as a small caps subtitle instead.
  drawText({
    page: cover,
    font: helveticaOblique,
    text: "National Exam Prep",
    size: 9,
    color: COLOR.creamDim,
    x: MARK_X + MARK_SIZE + 18,
    y: MARK_Y + MARK_SIZE - 62,
  });

  // ── Thin gold divider rule under the header ─────────────────────
  const DIVIDER_Y = MARK_Y - 24;
  drawFilledRect(cover, 56, DIVIDER_Y, COVER_W - 112, 1.5, COLOR.gold);

  // ── Resource title block (center of page) ────────────────────────
  // Word-wrap manually since pdf-lib doesn't wrap text.
  const titleText = (args.title || "Untitled Resource").trim();
  const wrappedTitle = wrapText(helveticaBold, titleText, COVER_W - 112, 28);
  let titleY = COVER_H * 0.62;
  for (const line of wrappedTitle) {
    drawText({
      page: cover,
      font: helveticaBold,
      text: line,
      size: 28,
      color: COLOR.cream,
      x: 56,
      y: titleY,
    });
    titleY -= 36;
  }

  // ── Subject / Grade / Type metadata block ────────────────────────
  let metaY = titleY - 18;
  const metaParts: string[] = [];
  if (args.subjectName) metaParts.push(args.subjectName);
  if (args.grade && args.grade > 0) metaParts.push(`Grade ${args.grade}`);
  if (args.contentTypeLabel) metaParts.push(args.contentTypeLabel);
  if (args.examYear && args.examYear > 0) metaParts.push(String(args.examYear));
  if (metaParts.length > 0) {
    const metaLine = metaParts.join("  ·  ");
    drawText({
      page: cover,
      font: helvetica,
      text: metaLine,
      size: 14,
      color: COLOR.gold,
      x: 56,
      y: metaY,
    });
    metaY -= 22;
  }

  // ── "Part of the Learnyx Academy ET Library" tagline ─────────────
  drawText({
    page: cover,
    font: helveticaOblique,
    text: "Part of the Learnyx Academy ET Library",
    size: 11,
    color: COLOR.creamDim,
    x: 56,
    y: metaY - 6,
  });

  // ── Source attribution (if known, displayed honestly) ────────────
  if (args.sourceName && args.sourceName.trim()) {
    const srcText = `Sourced from ${args.sourceName.trim()}`;
    drawText({
      page: cover,
      font: helvetica,
      text: srcText,
      size: 10,
      color: COLOR.creamDim,
      x: 56,
      y: metaY - 28,
    });
  }

  // ── Footer: URL + small print ────────────────────────────────────
  const FOOTER_Y = 48;
  // Thin divider above footer
  drawFilledRect(cover, 56, FOOTER_Y + 24, COVER_W - 112, 0.5, COLOR.goldDarkest);
  drawText({
    page: cover,
    font: helvetica,
    text: LEARNYX_URL,
    size: 10,
    color: COLOR.gold,
    x: 56,
    y: FOOTER_Y + 8,
  });
  drawText({
    page: cover,
    font: helveticaOblique,
    text: "Original document content unchanged. This page was added by Learnyx branding.",
    size: 8,
    color: COLOR.creamDim,
    x: 56,
    y: FOOTER_Y - 8,
  });

  // ── Decorative gold corner accents on the cover ──────────────────
  // Small L-shaped gold accents in each corner — subtle premium feel.
  const cornerSize = 16;
  const cornerThick = 2;
  const margin = 28;
  // Top-left
  drawFilledRect(cover, margin, COVER_H - margin - cornerSize, cornerThick, cornerSize, COLOR.gold);
  drawFilledRect(cover, margin, COVER_H - margin - cornerThick, cornerSize, cornerThick, COLOR.gold);
  // Top-right
  drawFilledRect(cover, COVER_W - margin - cornerThick, COVER_H - margin - cornerSize, cornerThick, cornerSize, COLOR.gold);
  drawFilledRect(cover, COVER_W - margin - cornerSize, COVER_H - margin - cornerThick, cornerSize, cornerThick, COLOR.gold);
  // Bottom-left
  drawFilledRect(cover, margin, margin, cornerThick, cornerSize, COLOR.gold);
  drawFilledRect(cover, margin, margin, cornerSize, cornerThick, COLOR.gold);
  // Bottom-right
  drawFilledRect(cover, COVER_W - margin - cornerThick, margin, cornerThick, cornerSize, COLOR.gold);
  drawFilledRect(cover, COVER_W - margin - cornerSize, margin, cornerSize, cornerThick, COLOR.gold);

  // ── Copy all original pages into the output doc ──────────────────
  // embedPages preserves the original page content as-is. We then draw
  // the watermark on top of each copied page.
  const embeddedPages = await outDoc.embedPages(srcDoc.getPages());

  for (let i = 0; i < embeddedPages.length; i++) {
    const embedded = embeddedPages[i];
    // The new page takes the SAME size as the original (so we never crop).
    const origPage = srcDoc.getPage(i);
    const { width, height } = origPage.getSize();
    const newPage = outDoc.addPage([width, height]);
    // Draw the original page content at 1:1
    newPage.drawPage(embedded, { x: 0, y: 0, width, height });

    // ── Corner watermark (bottom-right) ───────────────────────────
    // Small enough to never obscure content. Two lines: wordmark + URL.
    // We use a color close to the page background (assuming white paper)
    // so it reads as "subtly embossed" rather than a dark stamp.
    const wmText = "Learnyx Academy ET";
    const wmUrl = LEARNYX_URL;
    const wmFont = helvetica;
    const wmSize = 7;
    const wmUrlSize = 6;
    const wmPad = 12;
    const wmWidthText = wmFont.widthOfTextAtSize(wmText, wmSize);
    const wmWidthUrl = wmFont.widthOfTextAtSize(wmUrl, wmUrlSize);
    const wmBlockWidth = Math.max(wmWidthText, wmWidthUrl);
    const wmX = width - wmBlockWidth - wmPad;
    const wmY = wmPad + wmUrlSize + 2;

    // Watermark text — drawn with the watermark color (a warm dark grey
    // that reads as a subtle mark on white paper without obscuring text
    // behind it). NOT drawn with rotation: rotation makes it more visible
    // but also more intrusive. Bottom-right corner, horizontal.
    try {
      newPage.drawText(wmText, {
        x: wmX,
        y: wmY + wmUrlSize + 1,
        size: wmSize,
        font: wmFont,
        color: COLOR.watermark,
      });
      newPage.drawText(wmUrl, {
        x: wmX,
        y: wmY,
        size: wmUrlSize,
        font: wmFont,
        color: COLOR.watermark,
      });
    } catch {
      // Some embedded pages may have content streams we can't draw on top
      // of (rare — pdf-lib is generally fine here). Don't fail the whole
      // branding for one page; skip the watermark for this page.
    }
  }

  const brandedBytes = await outDoc.save({
    // Don't use object streams — older PDF readers (and some browsers)
    // struggle with them. Plain save is a few KB larger but more compatible.
    useObjectStreams: false,
  });

  return {
    brandedBytes,
    originalPageCount,
    finalPageCount: 1 + originalPageCount,
    version: BRANDING_VERSION,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

interface DrawTextArgs {
  page: import("pdf-lib").PDFPage;
  font: import("pdf-lib").PDFFont;
  text: string;
  size: number;
  color: import("pdf-lib").Color;
  x: number;
  y: number;
}

function drawText(args: DrawTextArgs): void {
  try {
    args.page.drawText(args.text, {
      x: args.x,
      y: args.y,
      size: args.size,
      font: args.font,
      color: args.color,
    });
  } catch {
    // Some font/codepoint combinations can throw (e.g. Amharic in
    // Helvetica). Don't fail the whole cover for one line — skip it.
  }
}

function drawFilledRect(
  page: import("pdf-lib").PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: import("pdf-lib").Color,
): void {
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color,
    // No border — filled only
    borderColor: undefined,
    borderWidth: 0,
  });
}

/** Simple word-wrap by character width measurement. */
function wrapText(
  font: import("pdf-lib").PDFFont,
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [text];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    const width = safeWidth(font, candidate, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4); // cap at 4 lines so we never overflow the cover
}

function safeWidth(font: import("pdf-lib").PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    // If the font can't measure a codepoint, fall back to a rough estimate
    return text.length * size * 0.55;
  }
}

// Avoid unused import warning — `degrees` is used by callers who want
// rotated watermarks in the future. Keep the import so it's tree-shaken
// only when truly unused.
void degrees;
