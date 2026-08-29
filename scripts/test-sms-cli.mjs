// Test the SMS parser via Convex CLI.
// Run: node scripts/test-sms-cli.mjs
import { execSync } from "child_process";

const DEPLOY_KEY = "dev:flexible-bloodhound-758|eyJ2MiI6IjA5NjZjYWYwZmU1NDQ5NDU4MGYzNzRkYTBkODgzY2YwIn0=";

// Use actual newlines (not escaped \n) so the parser's split("\n") works.
const SAMPLE_1 = `ውድ Joseph James
ከ Abebe Bekele(2519****2511) 1,100.00 ብር በ 28/08/2026 14:30:00 ተቀብለዋል፡፡
የሂሳብ እንቅስቃሴ ቁጥርዎ DHA1O2T6RN ነዉ፡፡
አሁን ያለዎት ቀሪ ሂሳብ 5,300.00 ብር ነዉ፡፡
በቴሌብር ስለተገለገሉ እናመሰግናለን
ኢትዮ ቴሌኮም`;

const SAMPLE_2 = `ውድ Joseph James
ከ Selam Tesfaye(251****89072) 100.00 ብር በ 15/08/2026 09:15:30 ተቀብለዋል፡፡
የሂሳብ እንቅስቃሴ ቁጥርዎ DF48LMJJKW ነዉ፡፡
አሁን ያለዎት ቀሪ ሂሳብ 750.50 ብር ነዉ፡፡
በቴሌብር ስለተገለገሉ እናመሰግናለን
ኢትዮ ቴሌኮም`;

const NOT_TELEBIRR = "Hello, your OTP is 123456.";

function runTest(smsText) {
  // Build JSON args — JSON.stringify will escape newlines as \n automatically.
  const args = JSON.stringify({ sms: smsText });
  // Use single quotes around the JSON and escape any single quotes inside.
  const escapedArgs = args.replace(/'/g, "'\\''");
  const cmd = `CONVEX_DEPLOY_KEY="${DEPLOY_KEY}" npx convex run manualPayments:testSmsParser '${escapedArgs}'`;
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 60000, cwd: "/home/z/my-project/nexus-academy" });
    return JSON.parse(output.trim());
  } catch (e) {
    return { error: e.stderr || e.message };
  }
}

console.log("═══ Test 1: Sample 1 (masked phone: 2519****2511) ═══");
const r1 = runTest(SAMPLE_1);
console.log(JSON.stringify(r1, null, 2));

console.log("\n═══ Test 2: Sample 2 (masked phone: 251****89072) ═══");
const r2 = runTest(SAMPLE_2);
console.log(JSON.stringify(r2, null, 2));

console.log("\n═══ Test 3: Non-TeleBirr SMS (should be null) ═══");
const r3 = runTest(NOT_TELEBIRR);
console.log(JSON.stringify(r3, null, 2));

// Assertions
let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { console.log(`  ✅ ${name}`); passed++; }
  else { console.log(`  ❌ ${name}`); failed++; }
}

console.log("\n═══ Assertions ═══");
if (r1.parsed) {
  check("S1: accountHolder = 'Joseph James'", r1.parsed.accountHolder === "Joseph James");
  check("S1: senderName = 'Abebe Bekele'", r1.parsed.senderName === "Abebe Bekele");
  check("S1: maskedPhone = '(2519****2511)'", r1.parsed.maskedPhone === "(2519****2511)");
  check("S1: amount = 1100", r1.parsed.amount === 1100);
  check("S1: transactionRef = 'DHA1O2T6RN'", r1.parsed.transactionRef === "DHA1O2T6RN");
  check("S1: dateImplausible = false (month=08 ≤ 12)", r1.parsed.dateImplausible === false);
} else {
  check("S1: parsed (not null)", false);
}

if (r2.parsed) {
  check("S2: maskedPhone = '(251****89072)' — different digit grouping", r2.parsed.maskedPhone === "(251****89072)");
  check("S2: amount = 100", r2.parsed.amount === 100);
  check("S2: transactionRef = 'DF48LMJJKW'", r2.parsed.transactionRef === "DF48LMJJKW");
  check("S2: dateImplausible = false (month=08 ≤ 12)", r2.parsed.dateImplausible === false);
} else {
  check("S2: parsed (not null)", false);
}

check("S3: null for non-TeleBirr SMS", r3.parsed === null);

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
