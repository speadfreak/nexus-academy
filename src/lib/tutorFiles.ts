// tutorFiles — client-side document intelligence for the AI Tutor.
//
// Extracts real text from student uploads BEFORE anything is sent to the
// model, so the tutor answers from the actual content instead of guessing:
//   • PDF  → pdf.js text layer (same worker the Reader uses)
//   • DOCX → word/document.xml out of the OOXML zip (native
//            DecompressionStream — no extra dependency)
//   • PPTX → slide XML text runs
//   • XLSX → sharedStrings + sheet cells
//   • TXT/MD/CSV/JSON → plain text
// Images are handled separately by the composer's downscale-to-JPEG path.
//
// PDF hardening (the "grade-9-amharic-new-curriculum--student-textbook.pdf"
// class of failures):
//   1. workerSrc — the Tutor page is a lazy chunk that NEVER loads the
//      Reader bundle, so react-pdf's pdf.js had no worker configured there:
//      getDocument threw "No GlobalWorkerOptions.workerSrc specified" and
//      every tutor PDF upload died with the generic "scanned or
//      password-protected" toast. We configure it here, unconditionally.
//   2. CMaps — Amharic/Ge'ez, CJK and many curriculum fonts are CID-keyed
//      (Identity-H encoding); decoding their text REQUIRES pdf.js CMap
//      data, which ships in public/cmaps + public/standard_fonts (synced
//      by scripts/sync-pdfjs.mjs). Without them getTextContent() throws
//      or returns garbage for exactly the textbooks students upload most.
//   3. Password/corrupt distinction — PasswordException and
//      InvalidPDFException get their own actionable messages instead of
//      the blanket "scanned or password-protected".
//   4. Scanned fallback — a PDF with (almost) no text layer is not a dead
//      end: the first pages are rendered to vision-quality JPEGs and
//      attached as images, so the model reads them visually.
//
// Everything runs in the browser: nothing is uploaded anywhere except the
// extracted text (capped) inside the chat message itself. Extraction
// failures degrade honestly — the chip shows what went wrong instead of
// the tutor hallucinating over an empty attachment.

import { pdfjs } from "react-pdf";

// The Tutor page never loads PdfStage/pdfText, so react-pdf's pdf.js would
// run without a usable worker here. Assign UNCONDITIONALLY: pdf.js v5.4+
// self-defaults `GlobalWorkerOptions.workerSrc ||= "./pdf.worker.mjs"` at
// module load — a bare specifier that can never load — so any truthiness
// guard sees a value and skips, and getDocument dies with "Setting up fake
// worker failed: Failed to resolve module specifier 'pdf.worker.mjs'".
// Same local worker file the Reader uses, version-synced into public/ by
// scripts/sync-pdfjs.mjs postinstall.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

// Local, same-origin CMap + font data for CID-keyed and standard fonts.
// NOTE: react-pdf@10 resolves its OWN nested pdfjs-dist (v5.4.296) — that
// copy is what actually runs for both the Reader and this extraction, and
// it accepts these options. cMapUrl/cMapPacked are REQUIRED for CID-keyed
// fonts (the Identity-H encodings Amharic/Ge'ez curriculum textbooks use).
const PDF_DOC_OPTIONS = {
  cMapUrl: "/cmaps/",
  cMapPacked: true as const,
  standardFontDataUrl: "/standard_fonts/",
};

// Types derived from react-pdf's pdfjs re-export so they match the ACTUAL
// runtime copy (its nested v5.4.296), not the top-level v6 package.
type PdfDocumentProxy = Awaited<
  ReturnType<typeof pdfjs.getDocument>["promise"]
>;
type PdfPageProxy = Awaited<ReturnType<PdfDocumentProxy["getPage"]>>;

export const MAX_DOCS_PER_MESSAGE = 2;
export const MAX_FILE_TEXT_CHARS = 60_000; // stored in tutor file memory
export const MAX_TURN_INJECT_CHARS = 24_000; // injected into the model turn
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB safety ceiling

export interface TutorFileExtraction {
  name: string;
  mime: string;
  size: number;
  /** Cleaned, extracted text (already capped at MAX_FILE_TEXT_CHARS). */
  text: string;
  /** True text length BEFORE capping — shown honestly in the UI. */
  chars: number;
  /** Page/slide count when the format reports one. */
  pages?: number;
  /** True when the PDF had no usable text layer (scanned/image-based). */
  scanned?: boolean;
  /** Vision-fallback JPEG data URLs for the first pages (scanned PDFs). */
  renderedPages?: { pageNumber: number; dataUrl: string }[];
}

/** An Error the caller should surface verbatim (it is already actionable). */
function userFacingError(message: string): Error {
  const error = new Error(message);
  (error as Error & { userFacing?: boolean }).userFacing = true;
  return error;
}

function isUserFacingError(error: unknown): boolean {
  return Boolean(
    error instanceof Error && (error as Error & { userFacing?: boolean }).userFacing,
  );
}

function errorName(error: unknown): string {
  return (error as { name?: string } | null)?.name ?? "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPasswordError(error: unknown): boolean {
  return (
    errorName(error) === "PasswordException" ||
    /password/i.test(errorMessage(error))
  );
}

function isInvalidPdfError(error: unknown): boolean {
  return (
    errorName(error) === "InvalidPDFException" ||
    /Invalid PDF|invalid pdf/i.test(errorMessage(error))
  );
}

const SUPPORTED_DOC_EXTENSIONS = [
  "pdf", "docx", "pptx", "xlsx", "txt", "md", "csv", "json", "rtf",
];

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function isSupportedDocFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_DOC_EXTENSIONS.includes(ext);
}

/** Human-readable size for chips and toasts. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Shared cleanup ───────────────────────────────────────────────────────

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Collapse whitespace noise while preserving paragraph structure. */
function cleanExtractedText(raw: string): string {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length <= MAX_FILE_TEXT_CHARS) return cleaned;
  return `${cleaned.slice(0, MAX_FILE_TEXT_CHARS)}\n\n[Text truncated at ${MAX_FILE_TEXT_CHARS.toLocaleString()} characters]`;
}

// ─── Minimal ZIP reader (OOXML containers) ────────────────────────────────
// Reads the central directory and inflates entries with the browser-native
// DecompressionStream. DOCX/PPTX/XLSX are plain zip archives — this avoids
// adding a JSZip/fflate dependency for a few hundred KB of bundle.

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const buffer = data.slice().buffer;
  const stream = new Blob([buffer]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out;
}

async function readZipEntries(
  buffer: ArrayBuffer,
): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // Locate the End Of Central Directory record (scan the last 64 KB —
  // tolerant of a zip comment after it).
  const eocdSig = 0x06054b50;
  let eocdOffset = -1;
  const scanStart = Math.max(0, bytes.length - 65_573);
  for (let i = bytes.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === eocdSig) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("not a zip archive");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map<string, Uint8Array>();

  let ptr = cdOffset;
  for (let e = 0; e < entryCount && ptr + 46 <= bytes.length; e++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break; // corrupt — stop
    const method = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = new TextDecoder().decode(
      bytes.subarray(ptr + 46, ptr + 46 + nameLen),
    );

    // Skip directories.
    if (!name.endsWith("/") && compressedSize >= 0) {
      // Parse the LOCAL header to find the true data start (its name/extra
      // lengths can differ from the central directory's).
      if (view.getUint32(localOffset, true) === 0x04034b50) {
        const lNameLen = view.getUint16(localOffset + 26, true);
        const lExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + lNameLen + lExtraLen;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd <= bytes.length) {
          const raw = bytes.subarray(dataStart, dataEnd);
          try {
            entries.set(
              name,
              method === 0 ? raw.slice() : await inflateRaw(raw),
            );
            // Sanity: decompressed length must roughly match the directory
            // claim (guards against truncated archives).
            if (uncompressedSize > 0) {
              const got = entries.get(name)!;
              if (got.length !== uncompressedSize) {
                entries.delete(name);
              }
            }
          } catch {
            // Undecompressable entry — skip it, keep the rest.
          }
        }
      }
    }

    ptr += 46 + nameLen + extraLen + commentLen;
  }

  if (entries.size === 0) throw new Error("zip archive has no readable entries");
  return entries;
}

function xmlTextBody(xml: string): string {
  return decodeXmlEntities(xml.replace(/<[^>]+>/g, ""));
}

// ─── Format extractors ────────────────────────────────────────────────────

// A text layer that yields almost nothing per sampled page means the PDF
// is image-based (scanned/photographed) — no word extractor can help; the
// pages must be READ visually. Threshold is page-count-aware: a sparse
// 1-page text sheet (e.g. 180 chars) is a REAL text document, while a
// 60-page scanned textbook yields ~0 chars total. 10 chars/page average
// across the sampled pages, floored at 50 for very short documents.
const SCANNED_MIN_CHARS_PER_PAGE = 10;
const SCANNED_ABSOLUTE_FLOOR_CHARS = 50;
/** How many pages to render as images for the vision fallback. */
const SCANNED_RENDER_PAGE_COUNT = 2;
/** Target width (px) for rendered fallback pages — matches the vision
 * upload quality band used by the composer's image downscaler. */
const SCANNED_RENDER_TARGET_WIDTH = 1600;

/** Render one pdf.js page to a vision-quality JPEG data URL. */
async function renderPageToDataUrl(
  page: PdfPageProxy,
  targetWidth = SCANNED_RENDER_TARGET_WIDTH,
): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  // Clamp: tiny pages upscale a little, huge pages downscale — never blow
  // up memory with a 10,000px canvas.
  const scale = Math.min(2.5, Math.max(0.5, targetWidth / base.width));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function extractPdf(file: File): Promise<TutorFileExtraction> {
  const data = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data, ...PDF_DOC_OPTIONS });
  let doc: PdfDocumentProxy | null = null;
  try {
    doc = await loadingTask.promise;
    const pages = doc.numPages;
    // Cap reading at 60 pages — exam papers are ≤40; anything longer gets an
    // honest truncation note so the tutor knows the text is partial.
    const pageCap = Math.min(pages, 60);
    const parts: string[] = [];
    let contentChars = 0;
    for (let p = 1; p <= pageCap; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const y = (item as { transform?: number[] }).transform?.[5] ?? null;
        // New line when the text baseline moves — pdf.js items are fragments,
        // and joining them blind glues whole columns into one word.
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
          pageText += "\n";
        } else if (pageText && !pageText.endsWith(" ")) {
          pageText += " ";
        }
        pageText += item.str;
        if (y !== null) lastY = y;
      }
      contentChars += pageText.replace(/\s+/g, "").length;
      parts.push(`[Page ${p}]\n${pageText.trim()}`);
    }

    // ── Scanned-PDF vision fallback ──
    // Almost no selectable text across 60 pages = scanned/image-based
    // document (typical for photographed textbooks). Instead of a dead-end
    // error, render the first pages as JPEGs and let the model READ them
    // visually — it answers from the actual page pixels, including Amharic
    // script where text-layer extraction never applied anyway.
    let scanned = false;
    let renderedPages: { pageNumber: number; dataUrl: string }[] | undefined;
    const scannedThreshold = Math.max(
      SCANNED_ABSOLUTE_FLOOR_CHARS,
      SCANNED_MIN_CHARS_PER_PAGE * pageCap,
    );
    if (contentChars < scannedThreshold) {
      scanned = true;
      renderedPages = [];
      const renderCount = Math.min(pages, SCANNED_RENDER_PAGE_COUNT);
      for (let p = 1; p <= renderCount; p++) {
        try {
          const page = await doc.getPage(p);
          const dataUrl = await renderPageToDataUrl(page);
          renderedPages.push({ pageNumber: p, dataUrl });
        } catch {
          // Rendering one page must not kill the whole fallback — skip it.
        }
      }
      parts.push(
        `[NOTE] This PDF has no selectable text layer — it is scanned or image-based (${pages} pages). ` +
          (renderedPages.length > 0
            ? `Page ${renderedPages.map((p) => p.pageNumber).join(" and ")} ${renderedPages.length === 1 ? "is" : "are"} attached below as image(s) for visual reading. `
            : "") +
          `For deeper pages, the student can attach screenshots of the specific pages they need.`,
      );
    }

    let text = parts.join("\n\n");
    if (pages > pageCap) {
      text += `\n\n[Document has ${pages} pages — text extracted for the first ${pageCap}.]`;
    }
    const cleaned = cleanExtractedText(text);
    return {
      name: file.name,
      mime: file.type || "application/pdf",
      size: file.size,
      text: cleaned,
      chars: cleaned.length,
      pages,
      ...(scanned ? { scanned: true } : {}),
      ...(renderedPages && renderedPages.length > 0 ? { renderedPages } : {}),
    };
  } catch (error) {
    // Real, actionable failure classes get their own message instead of
    // the generic "scanned or password-protected" blanket.
    if (isPasswordError(error)) {
      throw userFacingError(
        `"${file.name}" is password-protected. Remove the password (open it → Print → Save as PDF) and attach it again.`,
      );
    }
    if (isInvalidPdfError(error)) {
      throw userFacingError(
        `"${file.name}" isn't a readable PDF — it may be corrupted or renamed from another file type.`,
      );
    }
    throw error;
  } finally {
    // Never leak the document/worker between uploads.
    try {
      await doc?.destroy();
    } catch {
      // Already destroyed
    }
    try {
      await loadingTask.destroy();
    } catch {
      // Already destroyed
    }
  }
}

async function extractDocx(file: File): Promise<TutorFileExtraction> {
  const entries = await readZipEntries(await file.arrayBuffer());
  const documentXml = entries.get("word/document.xml");
  if (!documentXml) throw new Error("not a valid .docx (missing document.xml)");
  const xml = new TextDecoder().decode(documentXml);
  // Paragraphs → blank lines; tabs/breaks → whitespace; then strip all tags.
  const body = xmlTextBody(
    xml
      .replace(/<w:tab\b[^>]*\/?>/g, "\t")
      .replace(/<w:br\b[^>]*\/?>/g, "\n")
      .replace(/<\/w:p>/g, "\n\n"),
  );
  const cleaned = cleanExtractedText(body);
  return {
    name: file.name,
    mime: file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    size: file.size,
    text: cleaned,
    chars: cleaned.length,
  };
}

async function extractPptx(file: File): Promise<TutorFileExtraction> {
  const entries = await readZipEntries(await file.arrayBuffer());
  const slideNames = [...entries.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort(
      (a, b) =>
        parseInt(a.replace(/\D+/g, ""), 10) - parseInt(b.replace(/\D+/g, ""), 10),
    );
  if (slideNames.length === 0) throw new Error("not a valid .pptx (no slides)");
  const parts: string[] = [];
  slideNames.forEach((name, i) => {
    const xml = new TextDecoder().decode(entries.get(name)!);
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) =>
      decodeXmlEntities(m[1]),
    );
    if (runs.length > 0) parts.push(`[Slide ${i + 1}]\n${runs.join("\n")}`);
  });
  const cleaned = cleanExtractedText(parts.join("\n\n"));
  return {
    name: file.name,
    mime: file.type || "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    size: file.size,
    text: cleaned,
    chars: cleaned.length,
    pages: slideNames.length,
  };
}

async function extractXlsx(file: File): Promise<TutorFileExtraction> {
  const entries = await readZipEntries(await file.arrayBuffer());
  const shared = entries.get("xl/sharedStrings.xml");
  let rows: string[] = [];
  if (shared) {
    const xml = new TextDecoder().decode(shared);
    // Each <si> is one shared string; <t> children may repeat inside it.
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const text = [...si[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)]
        .map((m) => decodeXmlEntities(m[1]))
        .join("");
      if (text.trim()) rows.push(text.trim());
    }
  }
  // Sheets beyond sharedStrings: pull inline numbers/strings as fallback.
  for (const name of entries.keys()) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue;
    const xml = new TextDecoder().decode(entries.get(name)!);
    const cells = [...xml.matchAll(/<v>([^<]*)<\/v>/g)].map((m) => m[1]);
    if (cells.length > 0 && rows.length === 0) rows = cells;
    break; // first sheet is enough for a study-memory excerpt
  }
  const cleaned = cleanExtractedText(rows.join("\n"));
  return {
    name: file.name,
    mime: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size: file.size,
    text: cleaned || "(spreadsheet contained no extractable text)",
    chars: cleaned.length,
  };
}

async function extractPlainText(file: File): Promise<TutorFileExtraction> {
  const raw = await file.text();
  const cleaned = cleanExtractedText(raw);
  return {
    name: file.name,
    mime: file.type || "text/plain",
    size: file.size,
    text: cleaned || "(empty file)",
    chars: cleaned.length,
  };
}

// Legacy .doc/.ppt/.xls are binary OLE containers — text extraction would
// produce garbage, and pretending otherwise would feed the tutor junk.
export function isLegacyOfficeFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return ["doc", "ppt", "xls"].includes(ext);
}

/**
 * Extract text from a document upload. Throws with a USER-FACING message —
 * callers show it directly in a toast.
 */
export async function extractTutorFile(file: File): Promise<TutorFileExtraction> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}. Split it or upload the pages you need.`,
    );
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (isLegacyOfficeFile(file)) {
    throw new Error(
      `"${file.name}" is a legacy Office format (.${ext}). Save it as .docx / .pptx / .xlsx and attach again.`,
    );
  }
  try {
    switch (ext) {
      case "pdf":
        return await extractPdf(file);
      case "docx":
        return await extractDocx(file);
      case "pptx":
        return await extractPptx(file);
      case "xlsx":
        return await extractXlsx(file);
      case "txt":
      case "md":
      case "csv":
      case "json":
      case "rtf":
        return await extractPlainText(file);
      default:
        throw new Error(`Unsupported file type: .${ext || "unknown"}`);
    }
  } catch (error) {
    // Size / legacy / unsupported / password / corrupt messages are already
    // actionable — surface them verbatim. Everything else (unexpected
    // extraction failures) degrades to the honest generic message.
    if (
      error instanceof Error &&
      (isUserFacingError(error) ||
        error.message.includes("limit is") ||
        error.message.includes("legacy Office") ||
        error.message.startsWith("Unsupported file type"))
    ) {
      throw error;
    }
    throw new Error(
      `Couldn't read "${file.name}" — the file may be scanned or password-protected. Try a text-based version.`,
    );
  }
}
