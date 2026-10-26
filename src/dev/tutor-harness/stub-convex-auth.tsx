// TUTOR MOBILE HARNESS — stub for `@convex-dev/auth/react`.

export function useAuthActions() {
  return {
    signIn: async (_provider?: string, _credentials?: unknown) => {},
    signOut: async () => {},
  };
}

export function useAuthStorage() {
  return {};
}

export const ConvexAuthProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const useConvexAuthToken = () => undefined;
