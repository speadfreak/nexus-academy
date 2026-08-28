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
//     (copied from pdfjs-dist/cmaps/ at build time).
//   - standardFontDataUrl: pdf.js needs the standard 14 PostScript font
//     metrics to render text that doesn't have an embedded font. Bundled
//     in public/standard_fonts/ (copied from pdfjs-dist/standard_fonts/
//     at build time). Without this, pdf.js silently fetches them from
//     unpkg.com — a 3rd-party CDN with no SLA.
//   - disableRange: false + disableStream: false — explicit (matches
//     pdf.js defaults). Range requests are what make streaming page 1
//     fast: pdf.js fetches only the bytes it needs for the current page
//     instead of downloading the whole file.
//   - disableAutoFetch: true — pdf.js by default may eagerly fetch the
//     whole document in the background even after page 1 has rendered.
//     For our use case (user reads one page at a time, jumps between
//     pages), eager fetching wastes bandwidth and slows first-page.

export const PDFJS_OPTIONS = {
  cMapUrl: "/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/standard_fonts/",
  disableRange: false,
  disableStream: false,
  disableAutoFetch: true,
} as const;
