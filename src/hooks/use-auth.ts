import { useConvex, useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import { useState, useEffect } from "react";

type UserDoc = {
  _id: string;
  name?: string;
  email?: string;
  image?: string;
  isAnonymous?: boolean;
  role?: string;
};

// ── Session cache for the one-shot currentUser query ───────────────────
// useAuth() is mounted by RequireAuth on EVERY route plus the shell —
// each mount used to fire one convex.query() round-trip, so heavy
// navigation burned dozens of function calls per session for data that
// changes ~never mid-navigation. A 60s TTL keeps role/name fresh enough
// (mutations that change roles re-render via their own subscriptions)
// while collapsing the call volume ~10x.
let cachedUser: UserDoc | null | undefined = undefined;
let cachedAt = 0;
const USER_CACHE_TTL_MS = 60_000;

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const convex = useConvex();
  const { signIn, signOut } = useAuthActions();

  // ── Error-safe user query ──────────────────────────────────────────
  // useQuery(api.users.currentUser) THROWS if the function doesn't exist
  // on the deployed Convex backend (e.g. stale deployment). That crash
  // would kill the entire React tree — Landing page goes blank, sign-in
  // button disappears, etc.  We fetch imperatively and swallow errors so
  // the app stays usable even when the backend is outdated.
  const [user, setUser] = useState<UserDoc | undefined>(undefined);

  useEffect(() => {
    if (!isAuthenticated) {
      setUser(undefined);
      cachedUser = undefined;
      cachedAt = 0;
      return;
    }
    // Fresh cache hit — skip the round-trip entirely.
    const now = Date.now();
    if (cachedUser !== undefined && now - cachedAt < USER_CACHE_TTL_MS) {
      setUser(cachedUser ?? undefined);
      return;
    }
    let cancelled = false;
    convex
      .query(api.users.currentUser)
      .then((result: UserDoc | null) => {
        cachedUser = result;
        cachedAt = Date.now();
        if (!cancelled) setUser(result ?? undefined);
      })
      .catch((err: unknown) => {
        console.warn("[useAuth] currentUser query failed:", err);
        if (!cancelled) setUser(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [convex, isAuthenticated]);

  // Only treat as loading while Convex Auth is still determining the
  // session.  Once `isAuthLoading` settles, we consider loading done even
  // if the `currentUser` query hasn't returned yet (it returns null for
  // anonymous / signed-out users anyway).
  const isLoading = isAuthLoading;

  return {
    isLoading,
    isAuthenticated,
    user,
    signIn,
    signOut,
  };
}
