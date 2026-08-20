import type { AuthConfig } from "convex/server";

// Freebuff-signed federated tokens (see freebuff web's
// src/lib/vly-convex-jwt.ts) let a signed-in freebuff.com user carry their
// identity into this project without going through local sign-in. customJwt
// is correct for this provider: freebuff's tokens and JWKS both carry a
// `kid` header, which the customJwt validation path requires.
const freebuffIssuer =
  process.env.VLY_CONVEX_AUTH_ISSUER ?? "https://freebuff.com";

// CONVEX_SITE_URL is auto-set by Convex to the deployment URL (e.g.
// https://flexible-bloodhound-758.convex.cloud). If for some reason it
// isn't available, the entire auth module will not work, so we log a
// clear warning.
const siteUrl =
  process.env.CONVEX_SITE_URL ??
  "https://flexible-bloodhound-758.convex.cloud";
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
    // self-issues JWTs (iss = CONVEX_SITE_URL, no `kid` header) validated
    // via OIDC discovery at `${domain}/.well-known/openid-configuration`,
    // served by auth.addHttpRoutes() in convex/http.ts. Do NOT convert this
    // entry to `type: "customJwt"` — that path rejects tokens without a
    // `kid` header, so sign-in would silently never confirm and RequireAuth
    // would loop back to /auth forever.
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
