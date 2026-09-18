// OCR leg validation: run Tesseract.js on one scanned page locally and
// feed the result through the parser, to see what scan-parsed output
// looks like before wiring the client OCR runner.
import { readFileSync } from "node:fs";
import { createWorker } from "tesseract.js";
import { getDocumentProxy } from "unpdf";
import { parseExam } from "../src/lib/examParser";

const file = process.argv[2]!;
const wantPage = Number(process.argv[3] ?? 3);
const bytes = new Uint8Array(readFileSync(file));

// Render page via pdf.js — Node has no canvas, so use pdf.js's internal
// OPS to grab the page's embedded image instead: simpler for scans, which
// are one full-page image per page. Fallback: pdftoppm if available.
// For THIS harness we use pdftoppm (poppler) — the browser uses pdf.js.
const { execSync } = await import("node:child_process");
const out = `/tmp/ocrpage-${wantPage}`;
execSync(`pdftoppm -f ${wantPage} -l ${wantPage} -r 200 -png ${file} ${out}`);
const png = readFileSync(`${out}-${String(wantPage).padStart(2, "0")}.png`);

const t0 = Date.now();
const worker = await createWorker("eng");
const { data } = await worker.recognize(png);
await worker.terminate();
const ocrText = data.text ?? "";
console.log(`OCR took ${Date.now() - t0}ms, ${ocrText.length} chars`);
console.log("--- first 500 chars ---");
console.log(ocrText.slice(0, 500));

const result = parseExam([ocrText]);
if (result.kind === "answer_key_document") {
  console.log(`KEY DOC: ${result.keyCount}`);
} else {
  console.log(`--- parsed: conf=${result.confidence} → ${result.reviewStatus}; Q=${result.questions.length} (mcq=${result.meta.mcqCount})`);
  for (const q of result.questions.slice(0, 3)) {
    console.log(`Q${q.number}: ${q.text.slice(0, 90)}`);
    for (const o of q.options) console.log(`   ${o.label}. ${o.text.slice(0, 60)}`);
  }
}
