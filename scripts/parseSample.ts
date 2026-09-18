// Parser development harness: run the deterministic parser over real
// extracted texts and print honest numbers.
import { readFileSync } from "node:fs";
import { parseExam, extractAnswerKey } from "../src/lib/examParser";

const file = process.argv[2]!;
const raw = readFileSync(file, "utf8");
const pages = raw.split(/===== PAGE \d+ =====\n/).slice(1);

const t0 = Date.now();
const result = parseExam(pages);
const ms = Date.now() - t0;

if (result.kind === "answer_key_document") {
  console.log(`ANSWER KEY DOCUMENT — ${result.keyCount} entries (source: ${result.meta.answerKeySource}) in ${ms}ms`);
  process.exit(0);
}

const { questions, meta, confidence, reviewStatus } = result;
console.log(`Parsed in ${ms}ms — confidence ${confidence} → ${reviewStatus}`);
console.log(
  `meta: numbering=${meta.numberingStyle} options=${meta.optionStyle} Q=${meta.questionCount} (mcq=${meta.mcqCount} structured=${meta.structuredCount}) key=${meta.answerKeyCount}(${meta.answerKeySource}) diagrams=${meta.flaggedDiagrams} cont=${meta.sequenceContinuity} opt=${meta.optionConsistency} cov=${meta.textCoveragePct} shortStems=${meta.stemsFlaggedShort}`,
);

const show = Number(process.argv[3] ?? 6);
for (const q of questions.slice(0, show)) {
  console.log(`\nQ${q.number} [p${q.sourcePage}] ${q.kind}${q.answer ? ` → ${q.answer}` : ""}${q.figureHint ? " [FIG]" : ""}`);
  console.log(`  stem: ${q.text.slice(0, 110)}`);
  for (const o of q.options.slice(0, 4)) console.log(`   ${o.label}. ${o.text.slice(0, 70)}`);
}
if (questions.length > show) {
  const q = questions[questions.length - 1]!;
  console.log(`\n… last: Q${q.number} [p${q.sourcePage}] ${q.text.slice(0, 90)}`);
}
