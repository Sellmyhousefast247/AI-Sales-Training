import crypto from "crypto";
import type { WebhookProvider } from "./types";

/**
 * Verify a webhook signature when the integration has a signing secret
 * configured. Providers sign differently; all of the ones we support use an
 * HMAC-SHA256 over the raw body (hex or base64), sent in a header:
 *   - dialpad:   JWT-style or `X-Dialpad-Signature` (HMAC hex)
 *   - aircall:   `X-Aircall-Signature` (HMAC base64)
 *   - wavv:      `X-Wavv-Signature` (HMAC hex)
 *   - generic:   `X-Webhook-Signature` (HMAC hex)
 * GoHighLevel workflow webhooks don't sign; tenant isolation relies on the
 * secret webhook token in the URL. If no secret is configured we accept.
 */
export function verifySignature(opts: {
  provider: WebhookProvider;
  rawBody: string;
  headers: Headers;
  secret?: string | null;
}): { ok: boolean; reason?: string } {
  const { rawBody, headers, secret } = opts;
  if (!secret) return { ok: true };

  const candidates = [
    headers.get("x-webhook-signature"),
    headers.get("x-wavv-signature"),
    headers.get("x-aircall-signature"),
    headers.get("x-dialpad-signature"),
    headers.get("x-smrtphone-signature"),
    headers.get("x-signature"),
    headers.get("x-hub-signature-256")?.replace(/^sha256=/, ""),
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    return { ok: false, reason: "Signature header missing" };
  }

  const hmac = crypto.createHmac("sha256", secret).update(rawBody, "utf8");
  const digestHex = hmac.digest();
  const expectedHex = digestHex.toString("hex");
  const expectedB64 = digestHex.toString("base64");

  for (const sig of candidates) {
    const normalized = sig.trim();
    if (
      timingSafeEqualStr(normalized, expectedHex) ||
      timingSafeEqualStr(normalized, expectedB64)
    ) {
      return { ok: true };
    }
  }
  return { ok: false, reason: "Signature mismatch" };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
