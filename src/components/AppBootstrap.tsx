// AppBootstrap — ONE subscription per app-shell query, shared everywhere.
//
// WHY THIS EXISTS (the Convex free-plan usage spike, Sept 2026):
//
// Convex usage data showed ~1,000,000+ query calls in 19 days — 80.6% of
// total usage — dominated by seven tiny shell queries repeating every
// ~15 seconds from a single open tab. Investigation found the queries
// themselves were fine (reactive, indexed, no polling); the volume came
// from DUPLICATION + CONNECTION CHURN:
//
//   1. `profile.getProfile` was subscribed independently by ThemeProvider,
//      useLanguage, AccountSheet, Dashboard, Reader, MockExam, StudyCards,
//      AptitudeHub, Auth, ExamPrep and Settings — up to 3-4 concurrent
//      subscriptions on one screen.
//   2. `admin.isCurrentUserAdmin` was subscribed independently by
//      DashboardShell, AccountSheet, LanguageSwitcher, Dashboard and Admin.
//   3. Every WebSocket reconnect (Convex free-plan throttling produced a
//      ~15s reconnect cycle) re-runs EVERY active subscription. A tab
//      holding 10-14 duplicate shell subscriptions burned 10-14 query
//      calls per reconnect, forever, day and night — the death spiral
//      that ate the free quota.
//
// THE FIX: fetch each shell query EXACTLY ONCE here, at the root, via a
// normal reactive useQuery (Convex pushes changes automatically — no
// polling, ever) and share the values through context. Every consumer
// below reads from `useAppBootstrap()` instead of subscribing itself.
// A reconnect now re-runs 5 shell queries, not 14.

import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useQuery } from "convex/react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type BootstrapProfile = FunctionReturnType<typeof api.profile.getProfile>;
export type BootstrapAdminInfo = FunctionReturnType<typeof api.admin.isCurrentUserAdmin>;
export type BootstrapTourStatus = FunctionReturnType<typeof api.tour.getTourStatus>;

interface AppBootstrapValue {
  /** Signed-in user's profile (null when signed out, undefined while loading). */
  profile: BootstrapProfile | undefined;
  /** { isAdmin, role } for the current user (undefined while loading). */
  adminInfo: BootstrapAdminInfo | undefined;
  /** MULTI_LANGUAGE_ENABLED config flag (undefined while loading). */
  multiLanguageEnabled: boolean | undefined;
  /** SCHOOL_FEATURE_ENABLED config flag (undefined while loading). */
  schoolFeatureEnabled: boolean | undefined;
  /** First-time tour status (undefined while loading). */
  tourStatus: BootstrapTourStatus | undefined;
}

const AppBootstrapContext = createContext<AppBootstrapValue | null>(null);

export function AppBootstrapProvider({ children }: { children: ReactNode }) {
  // Exactly ONE subscription per query for the whole app.
  const profile = useQuery(api.profile.getProfile);
  const adminInfo = useQuery(api.admin.isCurrentUserAdmin);
  const multiLanguageEnabled = useQuery(api.configKeys.getMultiLanguageEnabled);
  const schoolFeatureEnabled = useQuery(api.configKeys.getSchoolFeatureEnabled);
  const tourStatus = useQuery(api.tour.getTourStatus);

  const value = useMemo(
    () => ({ profile, adminInfo, multiLanguageEnabled, schoolFeatureEnabled, tourStatus }),
    [profile, adminInfo, multiLanguageEnabled, schoolFeatureEnabled, tourStatus],
  );

  return (
    <AppBootstrapContext.Provider value={value}>
      {children}
    </AppBootstrapContext.Provider>
  );
}

/** Shared app-shell data. Must be used below <AppBootstrapProvider>. */
export function useAppBootstrap(): AppBootstrapValue {
  const ctx = useContext(AppBootstrapContext);
  if (!ctx) {
    throw new Error(
      "useAppBootstrap must be used inside <AppBootstrapProvider> (mounted in main.tsx).",
    );
  }
  return ctx;
}
