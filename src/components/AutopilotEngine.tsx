// AutopilotEngine — app-root host for the crowd conversion worker.
//
// Mounting the autopilot HERE (instead of only on the Exam Prep hub)
// turns every signed-in Learnyx tab into a conversion worker: a student
// browsing the library, reading notes or checking their dashboard is
// silently pre-digitizing the past-exam backlog in the background.
//
// Safe by construction: the backend peek only offers batch-priority jobs
// (never student-demanded ones), only while platform-wide headroom
// exists, and it returns null for signed-out visitors. All AI pacing is
// enforced server-side by the global rate orchestrator, so any number of
// tabs stays under the free AI tier. Silent — zero UI.

import { useExamAutopilotWorker } from "@/hooks/useExamAutopilotWorker";

export function AutopilotEngine(): null {
  useExamAutopilotWorker();
  return null;
}
