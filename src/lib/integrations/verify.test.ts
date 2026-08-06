import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifySignature } from "./verify";

function sign(body: string, secret: string, encoding: "hex" | "base64" = "hex") {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest(encoding);
}

describe("verifySignature", () => {
  const body = JSON.stringify({ hello: "world" });
  const secret = "shh";

  it("accepts when no secret is configured", () => {
    expect(verifySignature({ provider: "webhook", rawBody: body, headers: new Headers(), secret: null }).ok).toBe(true);
  });

  it("accepts a valid hex signature", () => {
    const headers = new Headers({ "x-webhook-signature": sign(body, secret) });
    expect(verifySignature({ provider: "webhook", rawBody: body, headers, secret }).ok).toBe(true);
  });

  it("accepts a valid base64 signature on a provider header", () => {
    const headers = new Headers({ "x-aircall-signature": sign(body, secret, "base64") });
    expect(verifySignature({ provider: "aircall", rawBody: body, headers, secret }).ok).toBe(true);
  });

  it("accepts GitHub-style sha256= prefixed header", () => {
    const headers = new Headers({ "x-hub-signature-256": `sha256=${sign(body, secret)}` });
    expect(verifySignature({ provider: "webhook", rawBody: body, headers, secret }).ok).toBe(true);
  });

  it("rejects a missing signature when a secret is set", () => {
    const r = verifySignature({ provider: "webhook", rawBody: body, headers: new Headers(), secret });
    expect(r.ok).toBe(false);
  });

  it("rejects a tampered body", () => {
    const headers = new Headers({ "x-webhook-signature": sign(body, secret) });
    const r = verifySignature({ provider: "webhook", rawBody: body + "x", headers, secret });
    expect(r.ok).toBe(false);
  });
});
