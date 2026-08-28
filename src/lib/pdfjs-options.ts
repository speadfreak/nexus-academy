// PDF.js options — shared between the Reader and the Reader Exam Mode.
//
// Configured once here so both <Document> instances in the app inherit the
// same cMapUrl / standardFontDataUrl / streaming settings.
//
// Why this matters:
//   - cMapUrl + cMapPacked: pdf.js fetches CMaps on demand for any PDF
//     that uses non-Latin fonts or custom ToUnicode maps. Without this,
//     pdf.js falls back to a slower text-extraction path that re-reads
//     the entire document. The CMap files are bundled in public/cmaps/
//     (copied from pdfjs-dist/cmaps/ at build time). This is the single
//     biggest text-layer perf win for Ethiopian Amharic / any non-Latin
//     textbook.
//   - standardFontDataUrl: pdf.js needs the standard 14 PostScript font
//     metrics to render text that doesn't have an embedded font. Bundled
//     in public/standard_fonts/ (copied from pdfjs-dist/standard_fonts/
//     at build time). Without this, pdf.js silently fetches them from
//     unpkg.com — a 3rd-party CDN with no SLA.
//   - disableRange: false + disableStream: false — explicit (matches
//     pdf.js defaults). Range requests are what make streaming page 1
//     fast: pdf.js fetches only the bytes it needs for the current page
//     instead of downloading the whole file.
//
// IMPORTANT — what we DON'T set:
//   - disableAutoFetch: we deliberately DO NOT set this to true. With
//     non-linearized PDFs (most of our past exams aren't linearized
//     because they're scans), pdf.js needs to fetch the cross-reference
//     table to find page 1. Setting disableAutoFetch:true prevents
//     those follow-up range requests and pdf.js silently fails to
//     render the page — the loading skeleton stays forever.
//     The bandwidth savings aren't worth the broken-render risk.
//   - disableRange / disableStream: we explicitly set them to false to
//     prevent future regressions from someone "optimizing" them to true.

export const PDFJS_OPTIONS = {
  cMapUrl: "/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/standard_fonts/",
  // Explicit (matches pdf.js defaults — kept for clarity + future safety).
  disableRange: false,
  disableStream: false,
} as const;
