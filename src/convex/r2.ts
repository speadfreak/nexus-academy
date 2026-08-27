// Cloudflare R2 storage service (S3-compatible).
// Runs in the Convex Node.js runtime ("use node") so it can read process.env.
//
// Required env vars (set them in the project's Keys / API keys tab — never
// hardcode them):
//   R2_ACCOUNT_ID          e.g. "2f5c..." from the R2 dashboard
//   R2_ACCESS_KEY_ID       API token access key id (edit permissions)
//   R2_SECRET_ACCESS_KEY   API token secret
//   R2_BUCKET_NAME         the bucket created in the R2 dashboard
//   R2_PUBLIC_URL          public bucket URL (r2.dev subdomain or custom domain)
"use node";

import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  GetObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface R2Config {
  configured: boolean;
  missing: string[];
}

// Allow callers to supply values from the configKeys DB table, so
// keys saved in the admin Keys tab work without Convex env vars.
export type R2ConfigOverrides = Record<string, string | undefined>;

/** Reads R2 configuration from env vars + optional overrides. Never logs secrets. */
export function getR2Config(overrides?: R2ConfigOverrides): R2Config {
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
  ] as const;
  const missing = required.filter((key) => !overrides?.[key] && !process.env[key]);
  return { configured: missing.length === 0, missing };
}

let cachedClient: S3Client | null = null;
let lastUsedKey = "";
let corsEnsuredFor = new Set<string>(); // Track which override keys had CORS set

function envOrOverride(key: string, overrides?: R2ConfigOverrides): string {
  return overrides?.[key] || process.env[key] || "";
}

function getClient(overrides?: R2ConfigOverrides): S3Client {
  const config = getR2Config(overrides);
  if (!config.configured) {
    throw new Error(
      `R2 storage is not configured. Add the missing keys in the project's Keys tab: ${config.missing.join(", ")}`,
    );
  }
  // Invalidate cache if overrides change (different admin keys)
  const currentKey = JSON.stringify(overrides ?? {});
  if (cachedClient && lastUsedKey !== currentKey) {
    cachedClient = null;
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${envOrOverride("R2_ACCOUNT_ID", overrides)}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: envOrOverride("R2_ACCESS_KEY_ID", overrides),
        secretAccessKey: envOrOverride("R2_SECRET_ACCESS_KEY", overrides),
      },
      // CRITICAL: force path-style addressing for R2.
      // Without this, the SDK uses virtual-hosted-style and puts the bucket
      // name as a subdomain: <bucket>.<accountId>.r2.cloudflarestorage.com.
      // That hostname has TWO subdomain levels, and R2's SSL cert
      // (*.r2.cloudflarestorage.com) only covers ONE. The browser rejects
      // the SSL handshake and masks it as a "CORS error" — even when the
      // bucket's CORS policy is correct. With path-style, the URL becomes
      // <accountId>.r2.cloudflarestorage.com/<bucket>/... which is one
      // subdomain level and matches the cert cleanly.
      forcePathStyle: true,
      // CRITICAL: disable automatic checksum headers added by AWS SDK v3.679+.
      // Newer SDK versions add x-amz-checksum-crc32 and x-amz-sdk-checksum-algorithm
      // to every PutObject by default. R2's S3-compatible API doesn't support
      // these checksum headers and returns 403 Forbidden, which the browser
      // masks as a "CORS error" because R2 doesn't add CORS headers to error
      // responses. Setting this to "WHEN_REQUIRED" tells the SDK to only
      // compute/send checksums when the operation explicitly requires it.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    lastUsedKey = currentKey;
  }
  return cachedClient;
}

function getBucket(overrides?: R2ConfigOverrides): string {
  return envOrOverride("R2_BUCKET_NAME", overrides);
}

// R2 CORS rules come back from the SDK in a slightly different shape than the
// SDK expects for PUT. We normalise both directions.
type CorsRule = {
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders?: string[];
  MaxAgeSeconds?: number;
};

/** Read the current bucket CORS rules. Returns [] if no CORS configured. */
export async function getBucketCorsRules(
  overrides?: R2ConfigOverrides,
): Promise<CorsRule[]> {
  const client = getClient(overrides);
  const bucket = getBucket(overrides);
  try {
    const result = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    return (result.CORSRules ?? []) as CorsRule[];
  } catch {
    // NoCORSConfiguration — expected for new buckets
    return [];
  }
}

/** Returns true if `origin` is allowed for `method` (PUT/GET/HEAD) in any
 * existing CORS rule. Wildcard `*` matches any origin. */
export function isOriginAllowedForMethod(
  rules: CorsRule[],
  origin: string,
  method: string,
): boolean {
  if (!origin) return false;
  for (const rule of rules) {
    if (!rule.AllowedMethods?.includes(method)) continue;
    for (const allowed of rule.AllowedOrigins ?? []) {
      if (allowed === "*") return true;
      if (allowed === origin) return true;
      // R2 supports a single wildcard at the start (e.g. "https://*.example.com")
      if (allowed.startsWith("*.")) {
        const suffix = allowed.slice(1); // ".example.com"
        if (origin.endsWith(suffix)) return true;
      }
    }
  }
  return false;
}

/**
 * Ensure the R2 bucket has CORS configured so browsers can make cross-origin
 * range requests (HTTP 206) for PDF.js streaming. Without this, PDF.js falls
 * back to downloading the ENTIRE file as an ArrayBuffer — catastrophic for
 * large textbooks (50+ MB → 10+ seconds).
 *
 * Idempotent: checks first, only writes if needed. Cached per override key
 * so subsequent calls are no-ops within the same Convex isolate.
 *
 * NOTE: This NEVER overwrites an existing CORS policy. If the user has set
 * CORS rules manually in the Cloudflare dashboard, those are preserved.
 */
export async function ensureBucketCors(overrides?: R2ConfigOverrides): Promise<void> {
  const cacheKey = JSON.stringify(overrides ?? {});
  if (corsEnsuredFor.has(cacheKey)) return;
  const client = getClient(overrides);
  const bucket = getBucket(overrides);
  try {
    const existing = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    if (existing.CORSRules && existing.CORSRules.length > 0) {
      corsEnsuredFor.add(cacheKey);
      return; // Already configured — never overwrite user's manual setup
    }
  } catch {
    // NoCORSConfiguration — expected for new buckets
  }
  // Default for brand-new buckets: permissive so uploads work without manual config.
  // The user can tighten this in the Cloudflare dashboard if they want.
  const corsConfig = {
    CORSRules: [{
      AllowedOrigins: ["*"],
      AllowedMethods: ["PUT", "GET", "HEAD"],
      AllowedHeaders: ["*"],
      MaxAgeSeconds: 86400,
    }],
  };
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: corsConfig }));
  corsEnsuredFor.add(cacheKey);
}

/**
 * Ensure `origin` is allowed to make PUT requests to the bucket. If the
 * existing CORS rules don't already cover this origin, MERGE a new rule into
 * the policy without removing the user's existing rules.
 *
 * This is the self-healing fix for "Upload to R2 failed — CORS issue":
 * every time an admin uploads from a new deployment URL (e.g. a preview
 * deploy or a new production domain), the bucket CORS auto-updates to
 * include that origin — no manual Cloudflare dashboard edits needed.
 *
 * Idempotent: if the origin is already covered by `*` or an exact match,
 * no write happens.
 *
 * Error handling: throws a typed error with `code: "access_denied"` when
 * the R2 API token doesn't have permission to manage bucket CORS. Callers
 * can detect this and show a helpful message to the admin (e.g. "recreate
 * your R2 token with broader permissions" or "set CORS manually in the
 * Cloudflare dashboard").
 *
 * NOTE: We intentionally do NOT cache the result here. Convex isolates are
 * reused across requests, and a stale "cached" state would prevent admins
 * from re-syncing after they manually fix CORS in the dashboard. The
 * underlying R2 calls are fast and idempotent.
 */
export async function ensureCorsForOrigin(
  origin: string,
  overrides?: R2ConfigOverrides,
): Promise<{ updated: boolean; reason: string }> {
  if (!origin) return { updated: false, reason: "no_origin" };

  const bucket = getBucket(overrides);
  const existing = await getBucketCorsRules(overrides);

  if (isOriginAllowedForMethod(existing, origin, "PUT")) {
    return { updated: false, reason: "already_allowed" };
  }

  // Merge: keep all existing rules + add a dedicated rule for this origin.
  // We put it BEFORE any wildcard-GET-only rule so it takes precedence for PUT.
  const newRule: CorsRule = {
    AllowedOrigins: [origin],
    AllowedMethods: ["PUT", "GET", "HEAD"],
    AllowedHeaders: ["*"],
    MaxAgeSeconds: 86400,
  };
  const mergedRules = [newRule, ...existing];

  try {
    await getClient(overrides).send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: { CORSRules: mergedRules },
      }),
    );
  } catch (err) {
    // Detect AccessDenied and rethrow with a typed code so the UI can show
    // a more helpful message (the user needs to widen their R2 token scope
    // or set CORS manually in the Cloudflare dashboard).
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("accessdenied") || msg.includes("access denied")) {
      throw new Error(
        "AccessDenied: your R2 API token can write objects but cannot manage bucket CORS. " +
          "Open your Cloudflare R2 bucket → Settings → CORS Policy and add this rule manually:\n" +
          JSON.stringify(
            {
              AllowedOrigins: [origin],
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 86400,
            },
            null,
            2,
          ) +
          "\n\nOr recreate your R2 API token with the 'Admin Read & Write' bucket permission (which includes CORS management) and update it in the Keys tab.",
      );
    }
    throw err;
  }
  return { updated: true, reason: "merged" };
}

/** Build the public URL for an object key, normalizing a trailing slash. */
export function publicUrlForKey(key: string, overrides?: R2ConfigOverrides): string {
  const base = (envOrOverride("R2_PUBLIC_URL", overrides) ?? "").replace(/\/+$/, "");
  return `${base}/${key}`;
}

/** Upload raw bytes to R2. Returns the public URL for the object. */
export async function uploadFile(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
  overrides?: R2ConfigOverrides,
): Promise<string> {
  const client = getClient(overrides);
  await ensureBucketCors(overrides).catch(() => {}); // Fire-and-forget, don't block uploads
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(overrides),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
      ContentDisposition: "inline",
    }),
  );
  return publicUrlForKey(key, overrides);
}

/** Time-limited signed URL (used later to gate premium content). 15 min expiry. */
export async function getSignedDownloadUrl(key: string, overrides?: R2ConfigOverrides): Promise<string> {
  const client = getClient(overrides);
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: getBucket(overrides), Key: key }),
    { expiresIn: 60 * 15 },
  );
}

/** Generate a presigned PUT URL for direct browser→R2 upload. The browser
 * uploads the file bytes straight to R2, bypassing Convex temp storage.
 * Returns { uploadUrl, key, fileUrl } where fileUrl is the final public URL.
 *
 * If `origin` is provided (the browser's window.location.origin), we also
 * ensure the bucket CORS allows PUT from that origin — auto-merging a rule
 * if needed. This self-heals the common "CORS issue" error when an admin
 * uploads from a new deployment URL.
 *
 * The presigned URL is signed to include 'content-type' and 'content-disposition'
 * in SignedHeaders, so the browser MUST send those exact header values. If
 * the browser sends a Content-Type that doesn't match the one we signed
 * with, R2 will reject the PUT with 403 SignatureDoesNotMatch. The admin
 * UI is responsible for sending the same Content-Type it asked us to sign. */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  overrides?: R2ConfigOverrides,
  origin?: string,
): Promise<{ uploadUrl: string; key: string; fileUrl: string }> {
  const client = getClient(overrides);
  await ensureBucketCors(overrides).catch(() => {}); // Ensure CORS for future reads
  if (origin) {
    await ensureCorsForOrigin(origin, overrides).catch(() => {}); // Auto-merge origin
  }
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: getBucket(overrides),
      Key: key,
      ContentType: contentType,
      // Immutable cache: textbooks never change at the same URL.
      // A new upload gets a new key, so this is safe and maximises CDN hit rate.
      CacheControl: "public, max-age=31536000, immutable",
      ContentDisposition: "inline",
    }),
    {
      expiresIn: 60 * 10, // 10 minutes
      // Sign content-type so the browser MUST send the same value. Without
      // this, some R2 deployments reject unsigned Content-Type as 403.
      signableHeaders: new Set(["content-type"]),
    },
  );
  return { uploadUrl, key, fileUrl: publicUrlForKey(key, overrides) };
}

/** Delete an object from R2 (admin content management). */
export async function deleteFile(key: string, overrides?: R2ConfigOverrides): Promise<void> {
  const client = getClient(overrides);
  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(overrides), Key: key }),
  );
}

/**
 * Recover the R2 object key from a stored fileUrl by stripping the public
 * bucket base URL. Returns null when the URL isn't under R2_PUBLIC_URL
 * (e.g. custom domain mismatch) so callers can decide how to handle it.
 */
export function keyFromUrl(fileUrl: string, overrides?: R2ConfigOverrides): string | null {
  const base = (envOrOverride("R2_PUBLIC_URL", overrides) ?? "").replace(/\/+$/, "");
  if (!base || !fileUrl.startsWith(base)) return null;
  const key = fileUrl.slice(base.length).replace(/^\/+/, "");
  return key.length > 0 ? key : null;
}
