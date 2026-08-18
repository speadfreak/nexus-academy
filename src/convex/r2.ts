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
  GetObjectCommand,
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
    });
    lastUsedKey = currentKey;
  }
  return cachedClient;
}

function getBucket(overrides?: R2ConfigOverrides): string {
  return envOrOverride("R2_BUCKET_NAME", overrides);
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
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(overrides),
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
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
