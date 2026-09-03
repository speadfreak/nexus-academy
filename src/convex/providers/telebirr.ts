// TeleBirr (Ethio telecom) H5 C2B web payment adapter.
//
// VERIFIED against public sources (Ethio telecom developer portal +
// community implementations of the "Telebirr H5 C2B Web Payment Integration
// Guide"):
//   - Gateway:  POST {base}/apiaccess/payment/gateway
//   - Web checkout redirect: {base}/payment/web/paygate
//   - Credential model: fabricAppId (UUID), appSecret, merchantAppId,
//     merchantCode (6-digit), RSA private key, notifyUrl, redirectUrl.
//   - Flow: fabric token -> create order (returns checkout URL) -> customer
//     pays on TeleBirr -> server notification to notifyUrl + return redirect
//     -> verify server-side by querying order status (never trust the
//     callback params alone). Success word on notify: "Completed"; on the
//     return/query leg: "PAY_SUCCESS".
//
// NOT VERIFIED (flagged honestly, do not take live without confirming):
//   - The exact createOrder request body field names. The official guide PDF
//     is behind the Ethio telecom developer portal (merchant account
//     required). The payload below follows the documented contract from
//     community integrations; confirm field-for-field against the official
//     guide with your merchant account before going live. Endpoints and
//     credential names are config-driven, so this is a config/field fix,
//     not a rewrite.
//
// Required env vars (Keys / API keys tab — never hardcode):
//   TELEBIRR_APP_ID          merchant app id
//   TELEBIRR_APP_KEY         app secret
//   TELEBIRR_SHORT_CODE      merchant code (6 digits)
//   TELEBIRR_FABRIC_APP_ID   fabric app id (UUID) — used for the fabric token
//   TELEBIRR_PRIVATE_KEY     RSA private key (PEM or bare base64 DER)
//   TELEBIRR_NOTIFY_URL      server notification URL (public)
//   TELEBIRR_REDIRECT_URL    user return URL (optional)
//   TELEBIRR_ENVIRONMENT     "sandbox" | "production" (default sandbox)
//   TELEBIRR_PUBLIC_KEY      optional — TeleBirr public key for signature
//                            verification of callbacks
"use node";

import { ConvexError } from "convex/values";

const SANDBOX_BASE = "https://developerportal.ethiotelebirr.et:38443";
const PRODUCTION_BASE = "https://superapp.ethiomobilemoney.et:38443";

interface TelebirrConfig {
  configured: boolean;
  missing: string[];
  baseUrl: string;
}

/** Env-like accessor — defaults to process.env for backward compat. */
export type EnvLike = Record<string, string | undefined>;

const DEFAULT_ENV: EnvLike = process.env as unknown as EnvLike;

export function getTelebirrConfig(env: EnvLike = DEFAULT_ENV): TelebirrConfig {
  const required = [
    "TELEBIRR_APP_ID",
    "TELEBIRR_APP_KEY",
    "TELEBIRR_SHORT_CODE",
    "TELEBIRR_FABRIC_APP_ID",
    "TELEBIRR_PRIVATE_KEY",
    "TELEBIRR_NOTIFY_URL",
  ] as const;
  const missing = required.filter((key) => !env[key]);
  const environment = (env["TELEBIRR_ENVIRONMENT"] ?? "sandbox").toLowerCase();
  const baseUrl = environment === "production" ? PRODUCTION_BASE : SANDBOX_BASE;
  return { configured: missing.length === 0, missing, baseUrl };
}

function requireConfig(env: EnvLike = DEFAULT_ENV): { baseUrl: string } {
  const config = getTelebirrConfig(env);
  if (!config.configured) {
    throw new ConvexError({
      message: `TeleBirr is not configured yet. Add these keys in the Keys tab: ${config.missing.join(", ")}`,
      code: "provider_not_configured",
    });
  }
  return { baseUrl: config.baseUrl };
}

function signPayload(_payload: unknown): string {
  // TODO(merchant): sign the request payload with the merchant RSA private
  // key (TELEBIRR_PRIVATE_KEY) per the official integration guide (RSA-PSS).
  // Signature algorithm + exact signed-field set must be confirmed against
  // the official guide before going live.
  void _payload;
  return "unverified-signature";
}

/** Fetch a fabric (gateway) access token for app-level auth. */
export async function getFabricToken(env: EnvLike = DEFAULT_ENV): Promise<string> {
  const { baseUrl } = requireConfig(env);
  // Wire contract (token request) must be confirmed against the official
  // guide; this follows the documented appId/appKey model.
  const response = await fetch(`${baseUrl}/apiaccess/payment/gateway`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appId: env["TELEBIRR_FABRIC_APP_ID"],
      appKey: env["TELEBIRR_APP_KEY"],
      method: "fabric.token.get",
      sign: signPayload({}),
    }),
  });
  if (!response.ok) {
    throw new ConvexError({
      message: `TeleBirr token request failed (HTTP ${response.status}).`,
      code: "provider_error",
    });
  }
  const data = (await response.json()) as { token?: string; access_token?: string };
  const token = data.token ?? data.access_token;
  if (!token) {
    throw new ConvexError({
      message: "TeleBirr token response did not include a token.",
      code: "provider_error",
    });
  }
  return token;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerTransactionId: string; // our merchant order id — echoed back by TeleBirr
  raw?: Record<string, unknown>;
}

/**
 * Create a web checkout for an order and return the redirect URL.
 * merchOrderId must match ^[A-Za-z0-9]+$ (Telebirr requirement).
 */
export async function initiateCheckout(args: {
  amount: number; // in ETB (birr)
  merchOrderId: string;
  userId: string;
  env?: EnvLike;
}): Promise<CheckoutResult> {
  const env = args.env ?? DEFAULT_ENV;
  const { baseUrl } = requireConfig(env);
  const token = await getFabricToken(env);

  const payload = {
    // NOTE: field names below follow the documented contract from community
    // integrations of the official guide. Confirm against the official
    // "Telebirr H5 C2B Web Payment Integration Guide" (portal-gated) with
    // your merchant credentials before enabling live payments.
    appId: env["TELEBIRR_APP_ID"],
    method: "payment.web.createOrder",
    charset: "utf-8",
    signType: "RSA2",
    sign: signPayload({}),
    timestamp: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14),
    version: "1.0",
    notifyUrl: env["TELEBIRR_NOTIFY_URL"],
    returnUrl: env["TELEBIRR_REDIRECT_URL"],
    bizContent: {
      subject: "NexET 🇪🇹 Premium",
      outTradeNo: args.merchOrderId,
      totalAmount: args.amount.toFixed(2),
      merchCode: env["TELEBIRR_SHORT_CODE"],
      appid: env["TELEBIRR_APP_ID"],
      timeoutExpress: "30m",
    },
  };

  const response = await fetch(`${baseUrl}/apiaccess/payment/gateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new ConvexError({
      message: `TeleBirr order creation failed (HTTP ${response.status}).`,
      code: "provider_error",
    });
  }
  const data = (await response.json()) as {
    bizContent?: Record<string, unknown>;
    payUrl?: string;
    prepayId?: string;
    code?: string;
    msg?: string;
  };

  const checkoutUrl =
    data.payUrl ?? (typeof data.bizContent?.payUrl === "string" ? (data.bizContent.payUrl as string) : "");
  if (!checkoutUrl) {
    throw new ConvexError({
      message: `TeleBirr did not return a checkout URL (${data.code ?? "?"} ${data.msg ?? ""}).`,
      code: "provider_error",
    });
  }
  return {
    checkoutUrl,
    providerTransactionId: args.merchOrderId,
    raw: data as Record<string, unknown>,
  };
}

/**
 * Server-to-server order status check. Success is "PAY_SUCCESS" (query leg)
 * or "Completed" (notify leg). Never trust callback params alone.
 */
export async function verifyTransaction(merchOrderId: string, env: EnvLike = DEFAULT_ENV): Promise<{
  status: "completed" | "pending" | "failed";
  raw?: Record<string, unknown>;
}> {
  const { baseUrl } = requireConfig(env);
  const token = await getFabricToken(env);

  const response = await fetch(`${baseUrl}/apiaccess/payment/gateway`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      appId: env["TELEBIRR_APP_ID"],
      method: "payment.web.queryOrder",
      charset: "utf-8",
      signType: "RSA2",
      sign: signPayload({}),
      timestamp: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14),
      version: "1.0",
      bizContent: { merchOrderId },
    }),
  });
  if (!response.ok) {
    throw new ConvexError({
      message: `TeleBirr order query failed (HTTP ${response.status}).`,
      code: "provider_error",
    });
  }
  const data = (await response.json()) as {
    tradeStatus?: string;
    trade_status?: string;
    code?: string;
  };
  const tradeStatus = (data.tradeStatus ?? data.trade_status ?? "").toUpperCase();
  if (tradeStatus === "PAY_SUCCESS" || tradeStatus === "COMPLETED" || tradeStatus === "TRADE_SUCCESS") {
    return { status: "completed", raw: data as Record<string, unknown> };
  }
  if (tradeStatus === "PAY_FAILED" || tradeStatus === "PAY_CANCEL" || tradeStatus === "CLOSED") {
    return { status: "failed", raw: data as Record<string, unknown> };
  }
  return { status: "pending", raw: data as Record<string, unknown> };
}
