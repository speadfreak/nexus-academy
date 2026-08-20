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
      return;
    }
    let cancelled = false;
    convex
      .query(api.users.currentUser)
      .then((result: UserDoc | null) => {
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
