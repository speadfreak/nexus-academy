// ocrBacklog.mjs — THE BACKLOG GRINDER.
//
// Runs the EXACT same OCR pipeline the admin console's "OCR scans in this
// tab" button runs in a browser — but from Node, unattended: pdf rendering
// (pdftoppm, same ~200dpi legibility as the browser's 1700px canvas),
// Tesseract.js (WASM, zero cloud AI), and the same server submission path
// (submitOcrPagesInternal → finalizeOcrPaper → deterministic parser).
//
// Usage:
//   CONVEX_DEPLOY_KEY=... bun scripts/ocrBacklog.mjs   (from the repo root)
//
// Restartable: it re-reads the live scan backlog each run and skips pages
// already present, so a crash loses nothing but the current page.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorker } from "tesseract.js";

const REPO = "/home/z/my-project/nexus-academy";
const DEPLOY_KEY =
  process.env.CONVEX_DEPLOY_KEY ??
  "dev:flexible-bloodhound-758|eyJ2MiI6ImM3MDI5ZjdhYjNlOTQ3YTk5YzMwYzc3NGQ5NjY0M2ZlIn0=";
const WORK_DIR = join(tmpdir(), "ocr-backlog");
const RESULTS_FILE = "/tmp/ocr_results.jsonl";
const CONCURRENCY = 2; // papers in flight (2 cores here)
const MAX_JSON_BYTES = 90_000; // per submission call (argv limit is 128KB)
const MAX_BATCH_PAGES = 40; // server-side cap
const RENDER_DPI = 200; // ≈ the browser runner's 1700px width

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractJson(stdout) {
  const start = stdout.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in convex output: ${stdout.slice(0, 200)}`);
  return JSON.parse(stdout.slice(start));
}

function convexRun(fnName, argsJson) {
  const out = execFileSync(
    "bunx",
    ["convex", "run", fnName, argsJson],
    {
      cwd: REPO,
      env: { ...process.env, CONVEX_DEPLOY_KEY: DEPLOY_KEY },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 180_000,
    },
  );
  return extractJson(out);
}

function renderPage(pdfPath, pageNumber, outPrefix) {
  execFileSync(
    "pdftoppm",
    ["-f", String(pageNumber), "-l", String(pageNumber), "-r", String(RENDER_DPI), "-gray", "-png", pdfPath, outPrefix],
    { timeout: 60_000 },
  );
  const dir = outPrefix.slice(0, outPrefix.lastIndexOf("/"));
  const base = outPrefix.slice(outPrefix.lastIndexOf("/") + 1);
  const hit = readdirSync(dir)
    .filter((f) => f.startsWith(base) && f.endsWith(".png"))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (!hit) throw new Error(`pdftoppm produced no image for page ${pageNumber}`);
  return hit;
}

async function ocrPaper(scan, worker) {
  const t0 = Date.now();
  const { contentId, title, fileUrl, pageCount, pagesPresent } = scan;
  const missing = [];
  for (let p = 1; p <= pageCount; p++) if (!pagesPresent[p - 1]) missing.push(p);
  if (missing.length === 0) return { contentId, title, skipped: true, pages: 0, ms: 0 };

  mkdirSync(WORK_DIR, { recursive: true });
  const pdfPath = join(WORK_DIR, `${contentId}.pdf`);
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`download failed (${res.status}) for ${title}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  writeFileSync(pdfPath, bytes);

  let ocrChars = 0;
  const texts = new Map(); // pageNumber -> text
  for (const page of missing) {
    const prefix = join(WORK_DIR, `${contentId}-p${page}`);
    const png = renderPage(pdfPath, page, prefix);
    let attempt = 0;
    for (;;) {
      try {
        const { data } = await worker.recognize(png);
        let text = (data.text ?? "").replace(/\u0000/g, "").trim();
        if (text.length === 0) text = "(This page could not be read by OCR.)";
        texts.set(page, text.slice(0, 25_000));
        ocrChars += text.length;
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 2) {
          // Honest placeholder keeps presence truthful; the parser treats
          // it as a noise line. The page is never silently dropped.
          texts.set(page, "(This page could not be read by OCR.)");
          break;
        }
        await sleep(1000);
      }
    }
    rmSync(png, { force: true });
  }

  // Dynamic batches under the argv limit.
  const batches = [];
  let cur = [];
  let size = 0;
  for (const page of missing) {
    const item = { pageNumber: page, text: texts.get(page) };
    const s = JSON.stringify(item).length;
    if (cur.length > 0 && (size + s > MAX_JSON_BYTES || cur.length >= MAX_BATCH_PAGES)) {
      batches.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(item);
    size += s;
  }
  if (cur.length > 0) batches.push(cur);

  let accepted = 0;
  let done = false;
  for (const batch of batches) {
    const payload = JSON.stringify({ contentId, pageCount, pages: batch });
    const r = convexRun("examPrepDigital:submitOcrPagesInternal", payload);
    accepted += r.accepted ?? 0;
    done = done || Boolean(r.done);
    if ((r.accepted ?? 0) === 0) break; // row moved on — stop quietly
  }

  rmSync(pdfPath, { force: true });
  const ms = Date.now() - t0;
  return { contentId, title, skipped: false, pages: missing.length, accepted, done, ocrChars, ms };
}

async function main() {
  const t0 = Date.now();
  const backlog = convexRun("examPrepDigital:scanBacklogInternal", "{}");
  let pending = backlog.filter(
    (s) => s.pageCount > 0 && s.fileUrl && s.pagesPresent.some((p) => !p),
  );
  const maxPapers = Number(process.env.MAX_PAPERS ?? 0);
  if (maxPapers > 0) pending = pending.slice(0, maxPapers);
  const totalMissing = pending.reduce(
    (s, p) => s + p.pagesPresent.filter((x) => !x).length,
    0,
  );
  console.log(
    `[grind] backlog=${backlog.length} scans, pending=${pending.length}, pages=${totalMissing}`,
  );
  if (pending.length === 0) {
    console.log("[grind] nothing to do — every scan has been read.");
    return;
  }

  const queue = [...pending];
  const workers = [];
  const results = [];
  let doneCount = 0;

  async function runOne() {
    // Each concurrent lane gets its own Tesseract worker.
    const worker = await createWorker("eng");
    try {
      for (;;) {
        const scan = queue.shift();
        if (!scan) return;
        let r;
        try {
          r = await ocrPaper(scan, worker);
        } catch (err) {
          r = { contentId: scan.contentId, title: scan.title, error: String(err.message || err), ms: 0 };
        }
        doneCount += 1;
        const pages = r.pages ?? 0;
        console.log(
          `[grind] ${doneCount}/${pending.length} "${r.title}" ${r.error ? `ERROR: ${r.error}` : `pages=${pages} accepted=${r.accepted ?? "-"} done=${r.done ?? "-"} chars=${r.ocrChars ?? "-"} ${(r.ms / 1000).toFixed(1)}s`}`,
        );
        appendFileSync(
          RESULTS_FILE,
          JSON.stringify({ ...r, at: Date.now() }) + "\n",
        );
        results.push(r);
      }
    } finally {
      await worker.terminate().catch(() => {});
    }
  }

  for (let i = 0; i < Math.min(CONCURRENCY, pending.length); i++) {
    workers.push(runOne());
    await sleep(2500); // stagger model loading
  }
  await Promise.all(workers);

  const ok = results.filter((r) => !r.error && !r.skipped);
  const total = ok.reduce((s, r) => s + r.pages, 0);
  const secs = (Date.now() - t0) / 1000;
  console.log(
    `[grind] COMPLETE papers=${ok.length} pages=${total} secs=${secs.toFixed(0)} (avg ${(secs / Math.max(1, total)).toFixed(2)}s/page)`,
  );
}

main().catch((err) => {
  console.error("[grind] FATAL", err);
  process.exit(1);
});
