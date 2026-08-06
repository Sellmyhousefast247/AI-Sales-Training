import type { NormalizedInboundCall, ProviderAdapter } from "../types";

/**
 * Dialpad call event webhook (call state "hangup" with recording details).
 * https://developers.dialpad.com — payloads are flat call objects:
 * {
 *   "call_id": 123, "state": "hangup", "direction": "outbound",
 *   "date_started": 1670000000000, "duration": 315000 (ms),
 *   "external_number": "+1830...", "internal_number": "+1210...",
 *   "contact": { "name": "...", "phone": "..." },
 *   "target": { "id": 456, "email": "closer@x.com", "type": "user" },
 *   "recording_url": ["https://..."]
 * }
 */
export const dialpad: ProviderAdapter = {
  provider: "dialpad",
  normalize(payload: unknown): NormalizedInboundCall[] {
    const p = payload as any;
    if (!p || typeof p !== "object") throw new Error("Empty payload");

    const state = String(p.state ?? "").toLowerCase();
    if (state && !["hangup", "recording", "voicemail"].includes(state)) return [];

    const externalId = p.call_id ?? p.id;
    if (externalId == null) return [];

    const durationMs = p.duration != null ? Number(p.duration) : null;
    const started = p.date_started != null ? new Date(Number(p.date_started)).toISOString() : null;
    const direction = String(p.direction ?? "").toLowerCase();
    const recording = Array.isArray(p.recording_url) ? p.recording_url[0] : p.recording_url;

    return [
      {
        externalId: String(externalId),
        callDatetime: started,
        direction: direction === "inbound" ? "inbound" : direction === "outbound" ? "outbound" : null,
        durationSec: durationMs != null && Number.isFinite(durationMs) ? Math.round(durationMs / 1000) : null,
        repHints: [p.target?.id, p.target?.email, p.user_id, p.user_email].filter(Boolean).map(String),
        sellerName: p.contact?.name ?? null,
        sellerPhone: p.contact?.phone ?? p.external_number ?? null,
        propertyAddress: null,
        leadSource: null,
        recordingUrl: recording ?? null,
        transcript: null,
      },
    ];
  },
};
