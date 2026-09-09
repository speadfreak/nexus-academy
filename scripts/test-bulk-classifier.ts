// Smoke test for the bulkClassifier — runs against realistic Ethiopian
// exam filenames and a mock subject catalog. Run with:
//   bun run scripts/test-bulk-classifier.ts

import { classifyDocument, type ClassificationResult } from "@/lib/bulkClassifier";

// Mock subject catalog — mirrors convex/subjects.ts SEED_SUBJECTS
const SUBJECTS = [
  { _id: "subj_en", name: "English", stream: "common", slug: "english" },
  { _id: "subj_math", name: "Mathematics", stream: "common", slug: "mathematics" },
  { _id: "subj_sat", name: "Scholastic Aptitude Test", stream: "common", slug: "scholastic-aptitude-test" },
  { _id: "subj_amh", name: "Amharic", stream: "common", slug: "amharic" },
  { _id: "subj_it", name: "IT", stream: "common", slug: "it" },
  { _id: "subj_cit", name: "Citizenship", stream: "common", slug: "citizenship" },
  { _id: "subj_phy", name: "Physics", stream: "natural", slug: "physics" },
  { _id: "subj_chem", name: "Chemistry", stream: "natural", slug: "chemistry" },
  { _id: "subj_bio", name: "Biology", stream: "natural", slug: "biology" },
  { _id: "subj_agri", name: "Agriculture", stream: "natural", slug: "agriculture" },
  { _id: "subj_hist", name: "History", stream: "social", slug: "history" },
  { _id: "subj_geo", name: "Geography", stream: "social", slug: "geography" },
  { _id: "subj_econ", name: "Economics", stream: "social", slug: "economics" },
] as const;

interface TestCase {
  label: string;
  filename: string;
  contentText: string; // simulated PDF extracted text
  expect: {
    subjectSlug?: string | null;
    grade?: string | null;
    contentType?: string | null;
    examYear?: string | null;
    minConfidence?: number;
  };
}

const TEST_CASES: TestCase[] = [
  // 1. Perfect filename: clear subject + grade + year + past exam
  {
    label: "Biology Grade 12 2015 past exam",
    filename: "Biology_Grade_12_2015_National_Exam.pdf",
    contentText: "Read each question carefully. Choose the best answer. Question 1. Which organelle is responsible for photosynthesis? A) Mitochondria B) Chloroplast C) Nucleus D) Ribosome",
    expect: { subjectSlug: "biology", grade: "12", contentType: "past_exam", examYear: "2015", minConfidence: 70 },
  },
  // 2. Physics textbook with unit
  {
    label: "Physics textbook unit 4 grade 10",
    filename: "Physics_G10_Textbook_Unit4.pdf",
    contentText: "Unit 4: Waves and Optics. Learning objectives. After studying this chapter you should be able to: explain the nature of waves, calculate wavelength, frequency, and amplitude. Key terms: wave, frequency, wavelength, amplitude, vibration, oscillation, period.",
    expect: { subjectSlug: "physics", grade: "10", contentType: "textbook", minConfidence: 60 },
  },
  // 3. Chemistry past exam, no year in filename but year in content
  {
    label: "Chemistry matric exam 2016 in content",
    filename: "chemistry-matric-exam.pdf",
    contentText: "Ethiopian University Entrance Examination 2016. Chemistry. Time: 2 hours. Choose the best answer. 1. Which of the following is an acid? A) NaOH B) HCl C) NaCl D) H2O. 2. The mole concept: 1 mole = 6.022 x 10^23 particles.",
    expect: { subjectSlug: "chemistry", contentType: "past_exam", examYear: "2016", minConfidence: 60 },
  },
  // 4. Mathematics worksheet
  {
    label: "Math worksheet G11",
    filename: "Math_Worksheet_Grade11_Algebra.pdf",
    contentText: "Worksheet 1: Algebra. Exercise 1. Solve for x: 2x + 5 = 15. Exercise 2. Factor the polynomial x^2 + 5x + 6. Activity: Work in pairs to solve the equation.",
    expect: { subjectSlug: "mathematics", grade: "11", contentType: "worksheet", minConfidence: 50 },
  },
  // 5. English student guide
  {
    label: "English study guide grade 9",
    filename: "English_Study_Guide_Grade9.pdf",
    contentText: "Study Guide English Grade 9. Key concepts: Grammar — Tenses, Active and Passive Voice. Important points: Read the passage carefully. Review notes.",
    expect: { subjectSlug: "english", grade: "9", contentType: "student_guide", minConfidence: 50 },
  },
  // 6. Teacher guide physics grade 11
  {
    label: "Physics teacher guide TG11",
    filename: "TG11_Physics_Teacher_Guide.pdf",
    contentText: "Teacher's Guide Physics Grade 11. Unit 1: Mechanics. Lesson plan: 1. Learning objectives for teachers. 2. Instructional strategies. 3. Time allocation: 45 minutes per lesson.",
    expect: { subjectSlug: "physics", grade: "11", contentType: "teacher_guide", minConfidence: 50 },
  },
  // 7. History past exam
  {
    label: "History EHEEE 2014",
    filename: "History_EHEEE_2014.pdf",
    contentText: "Ethiopian Higher Education Entrance Examination 2014. History. Directions: Choose the best answer. Question 1. The Battle of Adwa was fought in which year? A) 1896 B) 1888 C) 1900 D) 1875",
    expect: { subjectSlug: "history", contentType: "past_exam", examYear: "2014", minConfidence: 60 },
  },
  // 8. Geography textbook, no grade
  {
    label: "Geography textbook no grade",
    filename: "Geography_Student_Textbook.pdf",
    contentText: "Geography Student Textbook. Unit 1: Climate and Weather. Learning outcomes. Key terms: climate, weather, temperature, rainfall, humidity, latitude, longitude, equator. Introduction to physical geography.",
    expect: { subjectSlug: "geography", contentType: "textbook", minConfidence: 50 },
  },
  // 9. Economics past exam with year in filename
  {
    label: "Economics 2015 matric",
    filename: "Economics_2015_Matric.pdf",
    contentText: "Matriculation Exam Economics 2015. Choose the best answer. 1. The law of demand states that: A) price increases with demand B) demand decreases as price increases C) demand is constant D) none. Time: 2 hours.",
    expect: { subjectSlug: "economics", contentType: "past_exam", examYear: "2015", minConfidence: 60 },
  },
  // 10. Amharic content with Amharic script
  {
    label: "Amharic content",
    filename: "amharic-textbook.pdf",
    contentText: "የአማርኛ ቋንቋ ተማሪ መጽሐፍ። ሰዋስው፣ ግሥ፣ ስም፣ ቀጥሎ ተናጥሎ። አረፍተነገር ግርጌ።",
    expect: { subjectSlug: "amharic", contentType: "textbook", minConfidence: 30 },
  },
  // 11. IT past exam, grade unclear
  {
    label: "IT national exam 2017",
    filename: "IT_National_Exam_2017.pdf",
    contentText: "National Exam IT 2017. Choose the best answer. 1. Which of the following is hardware? A) Operating System B) Microsoft Word C) CPU D) Browser. 2. TCP/IP is a: A) protocol B) hardware C) language D) database.",
    expect: { subjectSlug: "it", contentType: "past_exam", examYear: "2017", minConfidence: 60 },
  },
  // 12. Agriculture worksheet
  {
    label: "Agriculture worksheet grade 10",
    filename: "Agriculture_Worksheet_G10.pdf",
    contentText: "Worksheet 1: Soil Science. Activity 1: Identify soil types. Exercise 1: List three methods of irrigation. Match the following: crop - season - harvest time.",
    expect: { subjectSlug: "agriculture", grade: "10", contentType: "worksheet", minConfidence: 50 },
  },
  // 13. Citizenship past exam
  {
    label: "Citizenship 2016 matric",
    filename: "Citizenship_2016.pdf",
    contentText: "Matriculation Exam 2016 Citizenship. Choose the best answer. 1. The Ethiopian constitution was adopted in: A) 1987 B) 1995 C) 2000 D) 2010. 2. The rights of citizens include: A) voting B) paying taxes C) both A and B D) none.",
    expect: { subjectSlug: "citizenship", contentType: "past_exam", examYear: "2016", minConfidence: 50 },
  },
  // 14. SAT practice
  {
    label: "SAT practice verbal",
    filename: "SAT_Practice_Verbal.pdf",
    contentText: "Scholastic Aptitude Test — Verbal Practice. Analogies: choose the best answer. 1. Hot is to cold as up is to __? A) down B) high C) low D) above. Antonym questions. Synonym questions.",
    expect: { subjectSlug: "scholastic-aptitude-test", contentType: "past_exam", minConfidence: 30 },
  },
  // 15. Cryptic filename, all signals in content
  {
    label: "Cryptic filename, content only",
    filename: "doc_001_2018.pdf",
    contentText: "Biology Grade 12 National Exam 2018. Choose the best answer. 1. Which of the following describes mitosis? A) cell division producing 2 identical daughter cells B) cell division producing 4 genetically different cells C) ...",
    expect: { subjectSlug: "biology", contentType: "past_exam", examYear: "2018", minConfidence: 50 },
  },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const tc of TEST_CASES) {
  const result = classifyDocument({
    filename: tc.filename,
    contentText: tc.contentText,
    subjects: SUBJECTS as never,
  });
  const checks: string[] = [];
  if (tc.expect.subjectSlug !== undefined) {
    if (result.subjectSlug !== tc.expect.subjectSlug) {
      checks.push(`subject: expected "${tc.expect.subjectSlug}", got "${result.subjectSlug}"`);
    }
  }
  if (tc.expect.grade !== undefined) {
    if (result.grade !== tc.expect.grade) {
      checks.push(`grade: expected "${tc.expect.grade}", got "${result.grade}"`);
    }
  }
  if (tc.expect.contentType !== undefined) {
    if (result.contentType !== tc.expect.contentType) {
      checks.push(`contentType: expected "${tc.expect.contentType}", got "${result.contentType}"`);
    }
  }
  if (tc.expect.examYear !== undefined) {
    if (result.examYear !== tc.expect.examYear) {
      checks.push(`examYear: expected "${tc.expect.examYear}", got "${result.examYear}"`);
    }
  }
  if (tc.expect.minConfidence !== undefined) {
    if (result.confidence < tc.expect.minConfidence) {
      checks.push(`confidence: expected >= ${tc.expect.minConfidence}, got ${result.confidence}`);
    }
  }

  const status = checks.length === 0 ? "PASS" : "FAIL";
  if (checks.length === 0) {
    passed++;
    console.log(`\n✓ ${status} — ${tc.label}`);
    console.log(`  → "${result.title}" (conf: ${result.confidence}/${result.confidenceLevel})`);
  } else {
    failed++;
    failures.push(tc.label);
    console.log(`\n✗ ${status} — ${tc.label}`);
    console.log(`  → "${result.title}" (conf: ${result.confidence}/${result.confidenceLevel})`);
    console.log(`  → subject=${result.subjectSlug}, grade=${result.grade}, type=${result.contentType}, year=${result.examYear}`);
    for (const c of checks) console.log(`  ✗ ${c}`);
    console.log(`  signals:`);
    for (const s of result.signals) console.log(`    • ${s}`);
  }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed (${Math.round((passed / (passed + failed)) * 100)}% pass rate)`);
if (failures.length > 0) {
  console.log(`\nFailed cases:`);
  for (const f of failures) console.log(`  ✗ ${f}`);
  process.exit(1);
}
process.exit(0);
