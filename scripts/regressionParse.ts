// Regression harness for the scan-tolerant parser changes: parses real
// sample texts (OCR pages from the DB, and a text-layer PDF fetched live)
// and prints the resulting confidence so nothing regresses.
import { readFileSync } from "node:fs";
import { getDocumentProxy } from "unpdf";
import { parseExam } from "../src/lib/examParser";
import { assemblePageTextLayout } from "../src/lib/examLayout";

function splitFmt(file: string): string[] {
  return readFileSync(file, "utf8")
    .split(/===== PAGE \d+ =====\n/)
    .slice(1);
}

function report(label: string, pages: string[], expect: string) {
  const r = parseExam(pages);
  if (r.kind === "answer_key_document") {
    console.log(`${label}: ANSWER KEY ${r.keyCount} (${expect})`);
    return;
  }
  console.log(
    `${label}: conf=${r.confidence} → ${r.reviewStatus} Q=${r.questions.length} mcq=${r.meta.mcqCount} opt=${r.meta.optionStyle} cont=${r.meta.sequenceContinuity} optc=${r.meta.optionConsistency} cov=${r.meta.textCoveragePct} (${expect})`,
  );
}

report("Chem 2005 OCR (was 95 auto)  ", splitFmt("/tmp/chem_fmt.txt"), "expect ≥ 90 auto");
report("Math 2005 OCR (was 63 review)", splitFmt("/tmp/math2005_fmt.txt"), "expect ≥ 70 auto");
report("Math 2010 OCR (was 65 review)", splitFmt("/tmp/math2010_fmt.txt"), "expect ≥ 70 auto");

// Text-layer regression: History 2013 (was conf 64 needs_review, Q=100)
const { execFileSync } = await import("node:child_process");
const out = execFileSync(
  "bunx",
  [
    "convex", "run",
    "examConversionEngineDispatch:getItemRow",
    JSON.stringify({ contentId: "kh77g54g1fm3mtyvwdkgrf5n9n8e2fgs" }),
  ],
  { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
    env: { ...process.env, CONVEX_DEPLOY_KEY: process.env.CONVEX_DEPLOY_KEY ?? "" } },
);
const start = out.indexOf("{");
const item = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
const res = await fetch(item.fileUrl);
const bytes = new Uint8Array(await res.arrayBuffer());
const pdf = await getDocumentProxy(bytes);
const pages: string[] = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const content = await page.getTextContent();
  pages.push(assemblePageTextLayout(content.items as never));
}
report("History 2013 text (was 64 rv)", pages, "expect ≥ 64, no drop");
