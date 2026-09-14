// useSchoolFeatureEnabled — mirrors the useLanguage / MULTI_LANGUAGE_ENABLED
// gate hook pattern exactly.
//
// USAGE (in any component):
//   const { enabled, loading } = useSchoolFeatureEnabled();
//
// WHEN SCHOOL_FEATURE_ENABLED is false (default):
//   - enabled === false
//   - Every public schools-feature surface should conditionally render
//     ONLY when enabled === true (so it's entirely absent from the DOM
//     when off, not just visually hidden).
//
// WHEN SCHOOL_FEATURE_ENABLED is true:
//   - enabled === true — render the schools feature surfaces.
//
// EXCEPTION: the platform admin's /admin → Schools management tab stays
// visible regardless of this flag. The admin can prepare a school's
// setup in the background before flipping the switch.

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";

interface UseSchoolFeatureResult {
  /** True when SCHOOL_FEATURE_ENABLED is "true". Schools-feature UI should
      only render when this is true. */
  enabled: boolean;
  /** True while the configKey query is still loading (undefined). UI
      should assume OFF during this window to avoid flashing hidden
      content. */
  loading: boolean;
}

export function useSchoolFeatureEnabled(): UseSchoolFeatureResult {
  const enabledQuery = useQuery(api.configKeys.getSchoolFeatureEnabled);
  const enabled = enabledQuery === true;
  const loading = enabledQuery === undefined;
  return { enabled, loading };
}
