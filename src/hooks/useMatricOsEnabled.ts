// useMatricOsEnabled — reads the MATRIC_OS_ENABLED master switch from the
// shared AppBootstrap subscription (one query for the whole app, same
// pattern as useSchoolFeatureEnabled).
//
// When true, /mock-exam serves the deterministic Matric OS engine (verified
// vault questions, instant start, zero AI dependency). When false/unset,
// the legacy AI-generated mock exam page is served unchanged — instant
// rollback path for the admin.

import { useAppBootstrap } from "@/components/AppBootstrap";

interface UseMatricOsResult {
  /** True when MATRIC_OS_ENABLED is not explicitly "false" (default ON). */
  enabled: boolean;
  /** True while the configKey query is still loading. Defaults to ON once
      resolved; while loading the router serves the legacy page and swaps
      the moment the flag resolves (no flicker for students, flag is
      default-true so this window is rare). */
  loading: boolean;
}

export function useMatricOsEnabled(): UseMatricOsResult {
  const { matricOsEnabled } = useAppBootstrap();
  return {
    enabled: matricOsEnabled !== false,
    loading: matricOsEnabled === undefined,
  };
}
