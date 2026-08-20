// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";
import { emailOtp } from "./auth/emailOtp";

// ── Provider list ────────────────────────────────────────────────────
// Google OAuth requires credentials as Convex env vars (set via
// `npx convex env set` or the Convex dashboard). Unlike API keys for
// AI providers, OAuth provider config is consumed at module-init time
// and CANNOT be read from the database at runtime.
//
// If the env vars are missing the provider is simply omitted so that
// email-otp and anonymous (guest) sign-in are never affected.

const providers = [
  ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        }),
      ]
    : []),
  emailOtp,
  Anonymous,
];

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
});
