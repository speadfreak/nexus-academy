import type { AuthConfig } from "convex/server";

// Freebuff-signed federated tokens (see freebuff web's
// src/lib/vly-convex-jwt.ts) let a signed-in freebuff.com user carry their
// identity into this project without going through local sign-in. customJwt
// is correct for this provider: freebuff's tokens and JWKS both carry a
// `kid` header, which the customJwt validation path requires.
const freebuffIssuer =
  process.env.VLY_CONVEX_AUTH_ISSUER ?? "https://freebuff.com";

// ── Site URL for auth ──────────────────────────────────────────────────
// Convex deployments serve custom HTTP routes on TWO domains:
//   - <deployment>.convex.cloud — requires the /http/ prefix for custom
//     routes (e.g. https://flexible-bloodhound-758.convex.cloud/http/...)
//   - <deployment>.convex.site — serves custom routes WITHOUT the /http/
//     prefix (e.g. https://flexible-bloodhound-758.convex.site/...)
//
// Convex Auth's HTTP routes (/.well-known/openid-configuration,
// /api/auth/signin/*, /api/auth/callback/*) construct their URLs from
// CONVEX_SITE_URL, which Convex auto-sets to the .convex.cloud deployment
// URL. But on the .cloud domain, the auth routes 404 because they need
// the /http/ prefix. The .site domain serves them at the root, which is
// what Convex Auth expects.
//
// To fix this, we set CUSTOM_AUTH_SITE_URL=https://<deployment>.convex.site
// as a Convex env var. Both auth.config.ts and the signIn action (in
// @convex-dev/auth) read it preferentially:
//   process.env.CUSTOM_AUTH_SITE_URL ?? requireEnv("CONVEX_SITE_URL")
// We mirror that exact fallback here for the `domain` field, which is
// used as the JWT issuer AND as the base for OIDC discovery
// (`${domain}/.well-known/openid-configuration`).
//
// IMPORTANT for Google OAuth: the redirect_uri sent to Google is
// `${CUSTOM_AUTH_SITE_URL}/api/auth/callback/google` — i.e.
// https://flexible-bloodhound-758.convex.site/api/auth/callback/google.
// This URL MUST be in the Google OAuth client's "Authorized redirect URIs"
// list in the Google Cloud Console. Without it, Google returns
// redirect_uri_mismatch after the user picks their account.
const siteUrl =
  process.env.CUSTOM_AUTH_SITE_URL ??
  process.env.CONVEX_SITE_URL ??
  "https://flexible-bloodhound-758.convex.site";
if (!siteUrl) {
  console.error(
    "[auth.config] CONVEX_SITE_URL is not set. Convex Auth requires it. " +
      "Set it in your Convex deployment env vars.",
  );
}

export default {
  providers: [
    // Standard Convex Auth provider for this project's own sign-in (email-otp
    // and anonymous/guest — see src/convex/auth.ts). The deployment
    // self-issues JWTs (iss = siteUrl, no `kid` header) validated via OIDC
    // discovery at `${siteUrl}/.well-known/openid-configuration`, served by
    // auth.addHttpRoutes() in convex/http.ts. Do NOT convert this entry to
    // `type: "customJwt"` — that path rejects tokens without a `kid` header,
    // so sign-in would silently never confirm and RequireAuth would loop
    // back to /auth forever.
    {
      domain: siteUrl!,
      applicationID: "convex",
    },
    {
      type: "customJwt",
      issuer: freebuffIssuer,
      jwks: `${freebuffIssuer}/api/web/.well-known/jwks.json`,
      applicationID: "vly-convex",
      algorithm: "RS256",
    },
  ],
} satisfies AuthConfig;
