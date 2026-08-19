// pdf.js setup for ADMIN text extraction only.
//
// ⚠ IMPORTANT: The in-app reader (react-pdf) has its OWN pdfjs-dist (v5.x)
//    bundled internally. Its worker is configured in Reader.tsx using the
//    pdfjs instance exported BY react-pdf — NOT this file.
//
// This file configures the TOP-LEVEL pdfjs-dist (v6.x) used only by the
// admin upload form's AI classification (text extraction in browser).
// pdf.js crashes the Convex node analyzer, so it never runs server-side.

import * as pdfjs from "pdfjs-dist";

// Use cdnjs CDN — always available, no bundling issues.
// The version is pinned to match package.json.
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

/**
 * Extract a plain-text sample from the first pages of a PDF file.
 * Used by the admin "Analyze with AI" flow before the Grok classifier.
 */
export async function extractPdfText(
  file: File,
  maxPages = 5,
  maxChars = 12000,
): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const doc = await loadingTask.promise;
  try {
    let text = "";
    const pages = Math.min(doc.numPages, maxPages);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        const str = (item as { str?: string }).str;
        if (typeof str === "string") pageText += str + " ";
      }
      text += pageText.replace(/\s+/g, " ").trim() + "\n";
      if (text.length >= maxChars) break;
    }
    return text.slice(0, maxChars);
  } finally {
    await loadingTask.destroy();
  }
}

export { pdfjs };
