// Feature-flag gate for /mock-exam (Phase 12 — safe rollout).
//
// Reads the MATRIC_OS_ENABLED config key (admin-controlled):
//   ON  (default) → Matric OS deterministic engine
//   OFF           → legacy AI-generated engine (preserved for rollback)
// Also exposes /mock-exam/legacy to reach the old engine directly.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import { lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { DashboardShell } from "@/components/DashboardShell";

const MatricExam = lazy(() => import("@/pages/MatricExam"));
const MockExam = lazy(() => import("@/pages/MockExam"));

export default function MockExamGate() {
  const enabled = useQuery(api.matricVault.getOsEnabled, {});

  if (enabled === undefined) {
    return (
      <DashboardShell>
        <div className="flex min-h-[50vh] items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </DashboardShell>
    );
  }

  return (
    <Suspense
      fallback={
        <DashboardShell>
          <div className="flex min-h-[50vh] items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        </DashboardShell>
      }
    >
      {enabled ? <MatricExam /> : <MockExam />}
    </Suspense>
  );
}
