import type { NormalizedInboundCall, ProviderAdapter } from "../types";

/**
 * WAVV dialer webhook (call.completed / recording.available events).
 *
 * Docs shape (defensive — WAVV sends both "event/data" envelopes and flat
 * payloads depending on webhook version):
 * {
 *   "event": "call.completed",
 *   "data": {
 *     "callId": "...", "userId": "...", "userEmail": "...",
 *     "direction": "outbound", "duration": 431,
 *     "from": "+1210...", "to": "+1830...",
 *     "contact": { "name": "...", "phone": "..." },
 *     "recordingUrl": "https://...", "startedAt": "..."
 *   }
 * }
 */
export const wavv: ProviderAdapter = {
  provider: "wavv",
  normalize(payload: unknown): NormalizedInboundCall[] {
    const envelope = payload as any;
    if (!envelope || typeof envelope !== "object") throw new Error("Empty payload");

    const event = String(envelope.event ?? envelope.type ?? "").toLowerCase();
    if (event && !/call|recording/.test(event)) return [];
    if (event && /started|ringing|queued/.test(event)) return [];

    const d = envelope.data ?? envelope;
    const externalId = d.callId ?? d.call_id ?? d.id;
    if (!externalId) return [];

    const duration = d.duration ?? d.durationSec ?? d.duration_seconds;
    const direction = String(d.direction ?? "").toLowerCase();

    const repHints = [d.userId ?? d.user_id, d.userEmail ?? d.user_email, d.agent?.id, d.agent?.email]
      .filter(Boolean)
      .map(String);

    return [
      {
        externalId: String(externalId),
        callDatetime: d.startedAt ?? d.started_at ?? d.timestamp ?? null,
        direction: direction === "inbound" ? "inbound" : direction === "outbound" ? "outbound" : null,
        durationSec: duration != null && Number.isFinite(Number(duration)) ? Number(duration) : null,
        repHints,
        sellerName: d.contact?.name ?? d.contactName ?? null,
        sellerPhone: d.contact?.phone ?? (direction === "inbound" ? d.from : d.to) ?? null,
        propertyAddress: d.contact?.address ?? null,
        leadSource: d.campaign?.name ?? d.campaignName ?? null,
        recordingUrl: d.recordingUrl ?? d.recording_url ?? null,
        transcript: d.transcript ?? null,
      },
    ];
  },
};
