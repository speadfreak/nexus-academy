// Shared pdf.js setup for the frontend.
//
// pdf.js is used in TWO places: the in-app reader (via react-pdf) and the
// admin upload form's AI classification (text extraction happens HERE in the
// browser — pdf.js crashes the Convex node analyzer, so it never runs
// server-side). The worker is served as a static asset by Vite.

import * as pdfjs from "pdfjs-dist";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

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
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
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
    await doc.destroy();
  }
}

export { pdfjs };
