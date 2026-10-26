// TUTOR MOBILE HARNESS — stub for `convex/react`.
//
// useQuery serves the fixture table (see fixtures.ts) synchronously;
// useMutation/useAction resolve with flexible canned results so the send
// pipeline, follow-ups and regeneration all light up in the harness.

import { useMemo } from "react";
import { FIXTURES } from "./fixtures";

export function useQuery(ref: { __path?: string } | null, args?: unknown) {
  const path = ref?.__path;
  // Hooks run UNCONDITIONALLY (Rules of Hooks) — the skip sentinel only
  // decides whether a fixture value is exposed. useMemo re-evaluates when
  // the query or its skip state changes (mirrors Convex re-subscription).
  const skipped = args === "skip";
  const value = useMemo(
    () => (!skipped && path && path in FIXTURES ? FIXTURES[path] : undefined),
    [skipped, path],
  );
  return skipped ? undefined : value;
}

export function useMutation(_ref?: unknown) {
  return async (_args?: unknown) => ({ success: true });
}

export function useAction(_ref?: unknown) {
  return async (_args?: unknown) => ({
    conversationId: "conv-1",
    reply: "Stubbed reply — the harness verifies layout, not the AI.",
    followUps: [
      "Can you give me one more example?",
      "Why does this matter for the exam?",
    ],
    miniCheck: null,
  });
}

// Pass-throughs so any component in the graph that touches these still
// mounts. Nothing in the Tutor graph opens a real Convex connection.
export class ConvexReactClient {
  constructor(_address?: string) {}
  setAuth(_auth?: unknown) {}
  clearAuth() {}
  close() {}
}
export const ConvexProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const ConvexAuthProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const Authenticated = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const Unauthenticated = () => null;
export const AuthLoading = () => null;
export function useConvexAuth() {
  return { isLoading: false, isAuthenticated: true };
}
export function useConvex() {
  return {};
}
export function useQueries() {
  return {};
}
