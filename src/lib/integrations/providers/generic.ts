import type { NormalizedInboundCall, ProviderAdapter } from "../types";

/**
 * Generic webhook (Zapier / n8n / custom). Documented contract — send JSON:
 * {
 *   "external_id": "unique-id",            // required
 *   "call_datetime": "2026-08-06T14:00:00Z",
 *   "direction": "outbound",
 *   "duration_sec": 431,
 *   "rep": "closer@yourco.com",            // email, phone, or provider user id
 *   "seller_name": "Debra Jones",
 *   "seller_phone": "+18305551234",
 *   "property_address": "301 Main St, San Antonio TX",
 *   "lead_source": "ppc",
 *   "recording_url": "https://.../call.mp3",
 *   "transcript": "REP: ...\nSELLER: ..."  // either transcript or recording_url
 * }
 */
export const generic: ProviderAdapter = {
  provider: "webhook",
  normalize(payload: unknown): NormalizedInboundCall[] {
    const p = payload as any;
    if (!p || typeof p !== "object") throw new Error("Empty payload");

    const items: any[] = Array.isArray(p) ? p : Array.isArray(p.calls) ? p.calls : [p];

    return items
      .map((item): NormalizedInboundCall | null => {
        const externalId = item.external_id ?? item.externalId ?? item.id;
        if (!externalId) return null;
        const direction = String(item.direction ?? "").toLowerCase();
        const duration = item.duration_sec ?? item.durationSec ?? item.duration;
        return {
          externalId: String(externalId),
          callDatetime: item.call_datetime ?? item.callDatetime ?? item.timestamp ?? null,
          direction: direction === "inbound" ? "inbound" : direction === "outbound" ? "outbound" : null,
          durationSec: duration != null && Number.isFinite(Number(duration)) ? Number(duration) : null,
          repHints: [item.rep, item.rep_email, item.rep_phone, item.rep_id].filter(Boolean).map(String),
          sellerName: item.seller_name ?? item.sellerName ?? null,
          sellerPhone: item.seller_phone ?? item.sellerPhone ?? null,
          propertyAddress: item.property_address ?? item.propertyAddress ?? null,
          leadSource: item.lead_source ?? item.leadSource ?? null,
          recordingUrl: item.recording_url ?? item.recordingUrl ?? null,
          transcript: item.transcript ?? null,
        };
      })
      .filter((x): x is NormalizedInboundCall => x !== null);
  },
};
