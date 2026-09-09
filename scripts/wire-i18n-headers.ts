// scripts/wire-i18n-headers.ts — adds useTranslation hook + wires the
// page eyebrow + title to the namespace for each remaining dashboard
// page. This is the minimum wiring needed to make multi-language
// actually render translated content on the page headers. Each page's
// body content can be extracted in a focused follow-up per page.
//
// This script is run ONCE during the Phase 5 bulk wiring. Each page's
// follow-up extraction is documented in the page's i18n namespace file
// (the JSON has more keys than we currently use in the JSX — the rest
// are ready for the next extraction pass).
//
// We don't run this script via `bun run` — it's reference documentation
// of what was wired in this session. The actual edits were made directly
// via the Edit tool. Keeping the script for transparency.

import { readFileSync } from "fs";

interface PageSpec {
  file: string;
  ns: string;
  defaultEyebrow: string;
  defaultTitle: string;
}

const PAGES: PageSpec[] = [
  { file: "src/pages/Focus.tsx", ns: "focus", defaultEyebrow: "focus sessions", defaultTitle: "Focus timer" },
  { file: "src/pages/Plans.tsx", ns: "plans", defaultEyebrow: "study plans", defaultTitle: "Plans" },
  { file: "src/pages/Journey.tsx", ns: "journey", defaultEyebrow: "your journey", defaultTitle: "Your journey" },
  { file: "src/pages/Calendar.tsx", ns: "calendar", defaultEyebrow: "calendar", defaultTitle: "Calendar" },
  { file: "src/pages/Notes.tsx", ns: "notes", defaultEyebrow: "study notes", defaultTitle: "Notes" },
  { file: "src/pages/Flashcards.tsx", ns: "flashcards", defaultEyebrow: "flashcards", defaultTitle: "Flashcards" },
  { file: "src/pages/Achievements.tsx", ns: "achievements", defaultEyebrow: "achievements", defaultTitle: "Achievements" },
  { file: "src/pages/Groups.tsx", ns: "groups", defaultEyebrow: "study groups", defaultTitle: "Study groups" },
  { file: "src/pages/Settings.tsx", ns: "settings", defaultEyebrow: "settings", defaultTitle: "Settings" },
];

// Note: this script is a NO-OP — it just prints what was wired.
// The actual edits are made via the Edit tool to each file.
for (const p of PAGES) {
  console.log(`Would wire: ${p.file} → ns "${p.ns}" (eyebrow="${p.defaultEyebrow}", title="${p.defaultTitle}")`);
  try {
    const content = readFileSync(p.file, "utf8");
    console.log(`  Current size: ${content.length} chars`);
  } catch (e) {
    console.log(`  (file not found)`);
  }
}
