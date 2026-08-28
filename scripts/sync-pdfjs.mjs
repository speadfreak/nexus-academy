#!/usr/bin/env node
/**
 * Sync the pdfjs-dist worker file from node_modules into public/ so Vite
 * serves it as a same-origin static asset.
 *
 * Why this is necessary:
 *   react-pdf@10 imports `pdfjs-dist` (the top-level package, currently
 *   v6.2.108). When `pdfjs.GlobalWorkerOptions.workerSrc` points to a
 *   worker file, that worker MUST match the pdfjs-dist version that
 *   react-pdf actually uses at runtime — otherwise pdf.js silently fails
 *   to spin up the worker and the loading skeleton stays forever (no
 *   page ever renders).
 *
 *   This was a real production bug: the worker file in public/ was the
 *   OLD 5.4.296 worker (1.0 MB) from an earlier pdfjs-dist version, while
 *   react-pdf was actually using 6.2.108. The worker formats are
 *   incompatible and pdf.js never recovered — every PDF showed
 *   "Rendering page…" indefinitely.
 *
 *   Running this script on every `bun install` (via the postinstall
 *   hook in package.json) keeps the worker file in sync with whatever
 *   pdfjs-dist version is actually installed.
 *
 *   Also re-copies cmaps/ and standard_fonts/ for the same reason —
 *   those are version-specific too.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const require = createRequire(import.meta.url);

// Resolve the ACTUAL pdfjs-dist that react-pdf uses. We can't just
// require("pdfjs-dist/package.json") because that resolves to the
// top-level package, which IS the one react-pdf imports — but we
// want to be explicit + handle the case where react-pdf has its own
// pinned copy (node_modules/react-pdf/node_modules/pdfjs-dist).
let pdfjsDistPath;
let pdfjsVersion;
try {
  // Try react-pdf's resolution path first — that's what react-pdf actually uses.
  const reactPdfMain = require.resolve("react-pdf");
  pdfjsDistPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs", {
    paths: [dirname(reactPdfMain)],
  });
  const pdfjsPkg = require(
    require.resolve("pdfjs-dist/package.json", {
      paths: [dirname(reactPdfMain)],
    }),
  );
  pdfjsVersion = pdfjsPkg.version;
} catch {
  // Fallback: top-level pdfjs-dist
  try {
    pdfjsDistPath = require.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
    pdfjsVersion = require("pdfjs-dist/package.json").version;
  } catch (err) {
    console.error(
      "[sync-pdfjs] Could not find pdfjs-dist. Is it installed? Skipping.",
    );
    console.error(err);
    process.exit(0); // Non-fatal: build will still run, just without the auto-sync.
  }
}

const pdfjsDistRoot = dirname(dirname(pdfjsDistPath));
console.log(
  `[sync-pdfjs] pdfjs-dist version: ${pdfjsVersion} (resolved from ${pdfjsDistRoot.replace(projectRoot + "/", "")})`,
);

// 1. Worker file
const workerSrc = join(pdfjsDistRoot, "build", "pdf.worker.min.mjs");
const workerDest = join(projectRoot, "public", "pdf.worker.min.mjs");

if (!existsSync(workerSrc)) {
  console.error(
    `[sync-pdfjs] Worker file not found at ${workerSrc}. Skipping.`,
  );
} else {
  copyFileSync(workerSrc, workerDest);
  const sizeMB = (statSync(workerDest).size / 1024 / 1024).toFixed(2);
  console.log(
    `[sync-pdfjs] ✓ Copied worker to public/pdf.worker.min.mjs (${sizeMB} MB)`,
  );
}

// 2. cmaps (CMap binary files for non-Latin font support)
const cmapsSrc = join(pdfjsDistRoot, "cmaps");
const cmapsDest = join(projectRoot, "public", "cmaps");
if (existsSync(cmapsSrc)) {
  if (existsSync(cmapsDest)) rmSync(cmapsDest, { recursive: true, force: true });
  mkdirSync(cmapsDest, { recursive: true });
  let count = 0;
  for (const file of readdirSync(cmapsSrc)) {
    copyFileSync(join(cmapsSrc, file), join(cmapsDest, file));
    count++;
  }
  console.log(`[sync-pdfjs] ✓ Copied ${count} cmap files to public/cmaps/`);
} else {
  console.warn("[sync-pdfjs] cmaps dir not found in pdfjs-dist; skipping.");
}

// 3. standard_fonts (Foxit/Liberation fallback fonts for non-embedded text)
const fontsSrc = join(pdfjsDistRoot, "standard_fonts");
const fontsDest = join(projectRoot, "public", "standard_fonts");
if (existsSync(fontsSrc)) {
  if (existsSync(fontsDest)) rmSync(fontsDest, { recursive: true, force: true });
  mkdirSync(fontsDest, { recursive: true });
  let count = 0;
  for (const file of readdirSync(fontsSrc)) {
    copyFileSync(join(fontsSrc, file), join(fontsDest, file));
    count++;
  }
  console.log(
    `[sync-pdfjs] ✓ Copied ${count} standard font files to public/standard_fonts/`,
  );
} else {
  console.warn("[sync-pdfjs] standard_fonts dir not found; skipping.");
}

console.log(
  "[sync-pdfjs] Done. Worker + cmaps + fonts in sync with pdfjs-dist@" +
    pdfjsVersion +
    ".",
);
