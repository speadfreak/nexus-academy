// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import Google from "@auth/core/providers/google";
import { emailOtp } from "./auth/emailOtp";

// Google OAuth — clientId/clientSecret come from the Keys / API keys tab
// (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). In the Google Cloud console,
// add the redirect URI `${CONVEX_SITE_URL}/api/auth/callback/google`.
export const googleProvider = Google({
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [googleProvider, emailOtp, Anonymous],
});