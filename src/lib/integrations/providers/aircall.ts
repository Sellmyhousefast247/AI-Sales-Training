import type { NormalizedInboundCall, ProviderAdapter } from "../types";

/**
 * Aircall webhook ("call.ended" / "call.hungup" events).
 * https://developer.aircall.io — envelope:
 * {
 *   "event": "call.ended",
 *   "data": {
 *     "id": 123, "direction": "outbound", "duration": 315,
 *     "started_at": 1670000000, "raw_digits": "+1830...",
 *     "user": { "id": 456, "email": "closer@x.com" },
 *     "contact": { "first_name": "...", "last_name": "..." },
 *     "recording": "https://..." | { "url": "https://..." }
 *   }
 * }
 */
export const aircall: ProviderAdapter = {
  provider: "aircall",
  normalize(payload: unknown): NormalizedInboundCall[] {
    const envelope = payload as any;
    if (!envelope || typeof envelope !== "object") throw new Error("Empty payload");

    const event = String(envelope.event ?? "").toLowerCase();
    if (event && !/ended|hungup|recording/.test(event)) return [];

    const d = envelope.data ?? envelope;
    const externalId = d.id ?? d.call_id;
    if (externalId == null) return [];

    const direction = String(d.direction ?? "").toLowerCase();
    const started =
      d.started_at != null ? new Date(Number(d.started_at) * 1000).toISOString() : null;
    const recording = typeof d.recording === "object" ? d.recording?.url : d.recording;
    const contactName = [d.contact?.first_name, d.contact?.last_name].filter(Boolean).join(" ");

    return [
      {
        externalId: String(externalId),
        callDatetime: started,
        direction: direction === "inbound" ? "inbound" : direction === "outbound" ? "outbound" : null,
        durationSec: d.duration != null && Number.isFinite(Number(d.duration)) ? Number(d.duration) : null,
        repHints: [d.user?.id, d.user?.email].filter(Boolean).map(String),
        sellerName: contactName || null,
        sellerPhone: d.raw_digits ?? d.contact?.phone_numbers?.[0]?.value ?? null,
        propertyAddress: null,
        leadSource: null,
        recordingUrl: recording ?? null,
        transcript: null,
      },
    ];
  },
};
