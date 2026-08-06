import type { NormalizedInboundCall, ProviderAdapter } from "../types";

/**
 * smrtPhone "Call Completed" webhook.
 * Typical payload:
 * {
 *   "event": "call.completed",
 *   "call": {
 *     "uuid": "...", "direction": "outbound", "duration": 315,
 *     "from": "+1210...", "to": "+1830...",
 *     "recording_url": "https://...", "started_at": "...",
 *     "user": { "id": "...", "email": "..." },
 *     "contact": { "name": "...", "address": "..." }
 *   }
 * }
 */
export const smrtphone: ProviderAdapter = {
  provider: "smrtphone",
  normalize(payload: unknown): NormalizedInboundCall[] {
    const envelope = payload as any;
    if (!envelope || typeof envelope !== "object") throw new Error("Empty payload");

    const event = String(envelope.event ?? "").toLowerCase();
    if (event && !/completed|recording|ended/.test(event)) return [];

    const c = envelope.call ?? envelope;
    const externalId = c.uuid ?? c.id ?? c.call_id;
    if (!externalId) return [];

    const direction = String(c.direction ?? "").toLowerCase();
    const duration = c.duration ?? c.duration_sec;

    return [
      {
        externalId: String(externalId),
        callDatetime: c.started_at ?? c.startedAt ?? c.timestamp ?? null,
        direction: direction === "inbound" ? "inbound" : direction === "outbound" ? "outbound" : null,
        durationSec: duration != null && Number.isFinite(Number(duration)) ? Number(duration) : null,
        repHints: [c.user?.id, c.user?.email, c.user_id, c.user_email].filter(Boolean).map(String),
        sellerName: c.contact?.name ?? null,
        sellerPhone: direction === "inbound" ? c.from : c.to,
        propertyAddress: c.contact?.address ?? null,
        leadSource: c.campaign ?? null,
        recordingUrl: c.recording_url ?? c.recordingUrl ?? null,
        transcript: c.transcript ?? null,
      },
    ];
  },
};
