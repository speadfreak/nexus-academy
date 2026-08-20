import { api } from "@/convex/_generated/api";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";

export function useAuth() {
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.currentUser);
  const { signIn, signOut } = useAuthActions();

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
