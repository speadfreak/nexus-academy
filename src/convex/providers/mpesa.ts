// M-Pesa adapter — Daraja (Safaricom) STK Push / Lipa na M-Pesa Online.
//
// VERIFIED against Safaricom's public Daraja documentation
// (developer.safaricom.co.ke):
//   - OAuth:   GET {base}/oauth/v1/generate?grant_type=client_credentials
//              (Basic auth, consumer key:secret) -> access_token
//   - STK Push: POST {base}/mpesa/stkpush/v1/processrequest
//   - STK Query: POST {base}/mpesa/stkpushquery/v1/query
//   - Base URLs: sandbox https://sandbox.safaricom.co.ke,
//                production https://api.safaricom.co.ke
//   - Payment confirmation arrives as a callback POST to CallBackURL
//     (Body.stkCallback.ResultCode === 0 means success).
//
// NOTE (flagging honestly): Daraja is Safaricom Kenya. M-Pesa Ethiopia
// (Safaricom Ethiopia) has its own gateway; the flow is similar but the base
// URL and possibly some fields differ. This adapter is base-URL driven, so
// switching is a config change (MPESA_BASE_URL), not a rewrite — but the
// exact contract for M-Pesa Ethiopia must be confirmed with Safaricom
// Ethiopia's merchant team before going live.
//
// Required keys (set in the Keys / API keys tab):
//   MPESA_CONSUMER_KEY     Daraja consumer key
//   MPESA_CONSUMER_SECRET  Daraja consumer secret
//   MPESA_SHORT_CODE       business shortcode (paybill/till)
//   MPESA_PASSKEY          Lipa na M-Pesa passkey (STK push password)
//   MPESA_CALLBACK_URL     public callback URL for STK results
//   MPESA_ENVIRONMENT      "sandbox" | "production" (default sandbox)
//   MPESA_BASE_URL         optional override (for M-Pesa Ethiopia gateway)
//   MPESA_TRANSACTION_TYPE default "CustomerPayBillOnline"
"use node";

import { ConvexError } from "convex/values";

const SANDBOX_BASE = "https://sandbox.safaricom.co.ke";
const PRODUCTION_BASE = "https://api.safaricom.co.ke";

/** Env-like accessor — defaults to process.env for backward compat. */
export type EnvLike = Record<string, string | undefined>;
const DEFAULT_ENV: EnvLike = process.env as unknown as EnvLike;

function getBaseUrl(env: EnvLike = DEFAULT_ENV): string {
  if (env["MPESA_BASE_URL"]) return env["MPESA_BASE_URL"]!;
  const e = (env["MPESA_ENVIRONMENT"] ?? "sandbox").toLowerCase();
  return e === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
}

function requireConfig(env: EnvLike = DEFAULT_ENV): void {
  const required = [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_SHORT_CODE",
    "MPESA_PASSKEY",
    "MPESA_CALLBACK_URL",
  ] as const;
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new ConvexError({
      message: `M-Pesa is not configured yet. Add these keys in the Keys tab: ${missing.join(", ")}`,
      code: "provider_not_configured",
    });
  }
}

const cachedToken: { token: string; expiresAt: number } = { token: "", expiresAt: 0 };

async function getAccessToken(env: EnvLike = DEFAULT_ENV): Promise<string> {
  requireConfig(env);
  if (cachedToken.token && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const key = env["MPESA_CONSUMER_KEY"]!;
  const secret = env["MPESA_CONSUMER_SECRET"]!;
  const response = await fetch(
    `${getBaseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      },
    },
  );
  if (!response.ok) {
    throw new ConvexError({
      message: `M-Pesa OAuth failed (HTTP ${response.status}).`,
      code: "provider_error",
    });
  }
  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new ConvexError({
      message: "M-Pesa OAuth response did not include an access token.",
      code: "provider_error",
    });
  }
  cachedToken.token = data.access_token;
  cachedToken.expiresAt = Date.now() + (data.expires_in ?? 3599) * 1000;
  return data.access_token;
}

function stkPassword(timestamp: string, env: EnvLike = DEFAULT_ENV): string {
  return Buffer.from(
    `${env["MPESA_SHORT_CODE"]}${env["MPESA_PASSKEY"]}${timestamp}`,
  ).toString("base64");
}

function darajaTimestamp(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}${h}${min}${s}`;
}

export interface CheckoutResult {
  checkoutUrl: string | null; // STK push has no redirect URL — payment happens on the phone
  providerTransactionId: string; // CheckoutRequestID
  raw?: Record<string, unknown>;
}

/**
 * Initiate an STK push to the customer's phone.
 * phoneNumber: international format, e.g. "254712345678".
 */
export async function initiateCheckout(args: {
  amount: number; // in KES / ETB minor unit? — Daraja takes whole currency units
  phoneNumber: string;
  userId: string;
  env?: EnvLike;
}): Promise<CheckoutResult> {
  const env = args.env ?? DEFAULT_ENV;
  requireConfig(env);
  const token = await getAccessToken(env);
  const timestamp = darajaTimestamp();
  const shortcode = env["MPESA_SHORT_CODE"]!;

  const response = await fetch(`${getBaseUrl(env)}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: stkPassword(timestamp, env),
      Timestamp: timestamp,
      TransactionType: env["MPESA_TRANSACTION_TYPE"] ?? "CustomerPayBillOnline",
      Amount: Math.round(args.amount),
      PartyA: args.phoneNumber.replace(/\D/g, ""),
      PartyB: shortcode,
      PhoneNumber: args.phoneNumber.replace(/\D/g, ""),
      CallBackURL: env["MPESA_CALLBACK_URL"]!,
      AccountReference: "LEARNYXACADEMY".slice(0, 12),
      TransactionDesc: "Premium access".slice(0, 13),
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ResponseCode?: string;
    ResponseDescription?: string;
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
  };

  if (!response.ok || (data.ResponseCode && data.ResponseCode !== "0")) {
    throw new ConvexError({
      message: `M-Pesa STK push failed (${data.ResponseCode ?? response.status}: ${data.ResponseDescription ?? "unknown"})`,
      code: "provider_error",
    });
  }
  if (!data.CheckoutRequestID) {
    throw new ConvexError({
      message: "M-Pesa STK push response did not include a CheckoutRequestID.",
      code: "provider_error",
    });
  }
  return {
    checkoutUrl: null,
    providerTransactionId: data.CheckoutRequestID,
    raw: data as Record<string, unknown>,
  };
}

/** Query STK push status. ResultCode 0 = success. */
export async function verifyTransaction(checkoutRequestId: string, env: EnvLike = DEFAULT_ENV): Promise<{
  status: "completed" | "pending" | "failed";
  raw?: Record<string, unknown>;
}> {
  requireConfig(env);
  const token = await getAccessToken(env);
  const timestamp = darajaTimestamp();

  const response = await fetch(`${getBaseUrl(env)}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      BusinessShortCode: env["MPESA_SHORT_CODE"]!,
      Password: stkPassword(timestamp, env),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
  });

  const data = (await response.json().catch(() => ({}))) as {
    ResultCode?: string | number;
    ResultDesc?: string;
  };
  if (!response.ok) {
    throw new ConvexError({
      message: `M-Pesa STK query failed (HTTP ${response.status}).`,
      code: "provider_error",
    });
  }
  const code = Number(data.ResultCode);
  if (code === 0) return { status: "completed", raw: data as Record<string, unknown> };
  // 1032 = request cancelled by user, 1.. = various failures
  if (code !== 1032 && (data.ResultCode !== undefined)) {
    // Still possibly in-flight; Daraja returns non-zero for pending too.
    return { status: "pending", raw: data as Record<string, unknown> };
  }
  return { status: "pending", raw: data as Record<string, unknown> };
}
