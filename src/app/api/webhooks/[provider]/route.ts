import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/integrations";
import { verifySignature } from "@/lib/integrations/verify";
import { ingestNormalizedCall, processCallMedia } from "@/lib/integrations/ingest";
import type { IntegrationRow, WebhookProvider } from "@/lib/integrations/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/[provider]?token=<webhook_token>
 *
 * Receives call events from dialers/CRMs, creates the call, transcribes the
 * recording (Deepgram), and auto-scores it. The token identifies the company
 * (multi-tenant); optional per-integration HMAC signing on top.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;

  const adapter = getAdapter(provider);
  if (!adapter) {
    return NextResponse.json({ error: { code: "unknown_provider", message: `Unsupported provider '${provider}'` } }, { status: 404 });
  }

  const token = req.nextUrl.searchParams.get("token") ?? req.headers.get("x-webhook-token");
  if (!token) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Missing webhook token" } }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: integrationRow } = await admin
    .from("integrations")
    .select("id, company_id, provider, webhook_token, config_json, is_active")
    .eq("webhook_token", token)
    .maybeSingle();
  const integration = integrationRow as IntegrationRow | null;

  if (!integration || !integration.is_active) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Invalid or inactive webhook token" } }, { status: 401 });
  }
  // The token is bound to a provider family; zapier/n8n/webhook rows accept the generic contract.
  const providerFamily = ["zapier", "n8n", "webhook"].includes(integration.provider) ? "webhook" : integration.provider;
  const routeFamily = ["zapier", "n8n", "webhook"].includes(provider) ? "webhook" : provider;
  if (providerFamily !== routeFamily) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Token does not match this provider" } }, { status: 401 });
  }

  const rawBody = await req.text();

  const sig = verifySignature({
    provider: adapter.provider as WebhookProvider,
    rawBody,
    headers: req.headers,
    secret: integration.config_json?.signing_secret ?? null,
  });
  if (!sig.ok) {
    return NextResponse.json({ error: { code: "unauthorized", message: sig.reason } }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: { code: "validation_failed", message: "Body must be JSON" } }, { status: 400 });
  }

  let normalized;
  try {
    normalized = adapter.normalize(payload);
  } catch (err: any) {
    await logEvent(admin, integration, provider, "failed", payload, null, err?.message);
    return NextResponse.json({ error: { code: "validation_failed", message: err?.message ?? "Unrecognized payload" } }, { status: 400 });
  }

  if (normalized.length === 0) {
    await logEvent(admin, integration, provider, "skipped", payload, null, "No completed-call event in payload");
    return NextResponse.json({ received: true, ingested: 0, detail: "No completed-call event in payload" });
  }

  const outcomes = [];
  const toProcess: string[] = [];
  for (const norm of normalized) {
    const outcome = await ingestNormalizedCall(admin, integration, norm);
    outcomes.push(outcome);
    await logEvent(
      admin, integration, provider,
      outcome.status === "created" ? "processed" : outcome.status === "failed" ? "failed" : "skipped",
      payload, outcome.callId ?? null, outcome.detail
    );
    if (outcome.status === "created" && outcome.callId) toProcess.push(outcome.callId);
  }

  // Transcribe + score after the response is sent so the dialer gets a fast ACK.
  if (toProcess.length > 0) {
    const autoScore = integration.config_json?.auto_score ?? true;
    after(async () => {
      for (const callId of toProcess) {
        try {
          await processCallMedia(admin, callId, { autoScore });
        } catch (err) {
          console.error(`[webhooks/${provider}] processing failed for call ${callId}:`, err);
        }
      }
    });
  }

  return NextResponse.json({
    received: true,
    ingested: outcomes.filter((o) => o.status === "created").length,
    outcomes,
  });
}

async function logEvent(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  integration: IntegrationRow,
  provider: string,
  status: "received" | "processed" | "skipped" | "failed",
  payload: unknown,
  callId: string | null,
  error?: string | null
) {
  try {
    await admin.from("webhook_events").insert({
      company_id: integration.company_id,
      integration_id: integration.id,
      provider,
      status,
      error: error ?? null,
      call_id: callId,
      payload_json: payload ?? null,
    });
  } catch (e) {
    console.error("webhook_events log failed", e);
  }
}
