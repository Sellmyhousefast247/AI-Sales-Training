import type { NormalizedInboundCall, ProviderAdapter } from "../types";

/**
 * GoHighLevel workflow webhook (Call Status / Call Recording events).
 *
 * GHL webhook payloads vary by workflow configuration; we read the common
 * fields defensively. Typical shape (workflow "Custom Webhook" action with
 * call trigger):
 * {
 *   "contact_id": "...", "first_name": "Debra", "last_name": "Jones",
 *   "phone": "+12105551234", "full_address": "…",
 *   "user": { "id": "...", "email": "closer@x.com", "phone": "..." },
 *   "call": { "id": "...", "direction": "outbound", "duration": 512,
 *             "recordingUrl": "https://...", "startTime": "2026-08-06T14:00:00Z" },
 *   "customData": { ... }
 * }
 * Also tolerates flat variants: callId / call_id, call_recording_url, etc.
 */
function pick(obj: any, ...keys: string[]): any {
  for (const k of keys) {
    const v = k.split(".").reduce((o, part) => (o == null ? undefined : o[part]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export const gohighlevel: ProviderAdapter = {
  provider: "gohighlevel",
  normalize(payload: unknown): NormalizedInboundCall[] {
    const p = payload as any;
    if (!p || typeof p !== "object") throw new Error("Empty payload");

    // Values sourced from workflow Custom Data may arrive as unresolved
    // merge tags (e.g. "{{message.transcript}}") — treat those as absent.
    const clean = (v: unknown): string | null => {
      if (v == null) return null;
      const s = String(v).trim();
      if (!s || s.includes("{{")) return null;
      return s;
    };

    const customCallId = clean(pick(p, "customData.call_id", "customData.callId"));
    const contactId = pick(p, "contact_id", "contact.id");
    const baseId =
      customCallId ??
      pick(p, "call.id", "callId", "call_id", "message_id", "messageId", "id");
    const transcriptRaw = clean(
      pick(p, "customData.transcript", "call.transcript", "transcript", "call_transcript")
    );

    // Fallback id: contact id alone would collide across repeat calls to the
    // same contact, so salt it with a transcript fingerprint when available.
    let externalId = baseId;
    if (!externalId && contactId) {
      const fp = transcriptRaw
        ? `-${transcriptRaw.length}-${fingerprint(transcriptRaw)}`
        : "";
      externalId = `${contactId}${fp}`;
    }
    if (!externalId) return [];

    const status = String(pick(p, "call.status", "call_status", "status") ?? "").toLowerCase();
    // Ignore non-terminal events when a status is present.
    if (status && !["completed", "answered", "ended", "finished", "voicemail", ""].includes(status)) {
      return [];
    }

    const durationRaw = pick(p, "call.duration", "call_duration", "duration");
    const durationSec = durationRaw != null ? Number(durationRaw) : null;

    const direction = String(pick(p, "call.direction", "direction") ?? "").toLowerCase();

    const first = pick(p, "first_name", "firstName", "contact.first_name", "contact.firstName");
    const last = pick(p, "last_name", "lastName", "contact.last_name", "contact.lastName");
    const fullName = pick(p, "full_name", "contact.name") ?? [first, last].filter(Boolean).join(" ");

    const repHints = [
      pick(p, "user.id", "userId", "user_id", "assigned_user_id", "assignedTo"),
      pick(p, "user.email", "user_email"),
      pick(p, "user.phone", "user_phone"),
    ]
      .filter(Boolean)
      .map(String);

    return [
      {
        externalId: String(externalId),
        callDatetime:
          pick(p, "call.startTime", "call.start_time", "call_start_time", "timestamp", "date_created", "createdAt") ?? null,
        direction: direction === "inbound" ? "inbound" : direction === "outbound" ? "outbound" : null,
        durationSec: Number.isFinite(durationSec as number) ? (durationSec as number) : null,
        repHints,
        sellerName: fullName || null,
        sellerPhone: pick(p, "phone", "contact.phone", "from", "to") ?? null,
        propertyAddress: pick(p, "full_address", "address1", "contact.address1") ?? null,
        leadSource: pick(p, "contact_source", "source", "contact.source") ?? null,
        recordingUrl:
          clean(
            pick(p, "customData.recording_url", "call.recordingUrl", "call.recording_url", "call_recording_url", "recordingUrl", "recording_url")
          ),
        transcript: transcriptRaw,
      },
    ];
  },
};

/** Small stable non-crypto fingerprint for dedup salting. */
function fingerprint(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
