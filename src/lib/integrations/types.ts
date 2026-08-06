/** Providers that can push calls into the platform via webhook. */
export const WEBHOOK_PROVIDERS = [
  "gohighlevel",
  "smrtphone",
  "wavv",
  "dialpad",
  "aircall",
  "webhook", // generic / Zapier / n8n
] as const;

export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];

/** A provider payload normalized into our domain shape. */
export interface NormalizedInboundCall {
  /** Provider-side unique id for dedup (call id, message id, …). */
  externalId: string;
  /** ISO datetime of the call. Falls back to "now" upstream if absent. */
  callDatetime?: string | null;
  direction?: "inbound" | "outbound" | null;
  durationSec?: number | null;
  /** Identity hints used to match the rep: provider user id, email, phone. */
  repHints: string[];
  sellerName?: string | null;
  sellerPhone?: string | null;
  propertyAddress?: string | null;
  leadSource?: string | null;
  /** Publicly fetchable recording URL, if the provider exposes one. */
  recordingUrl?: string | null;
  /** Transcript text if the provider already transcribed the call. */
  transcript?: string | null;
}

export interface ProviderAdapter {
  provider: WebhookProvider;
  /**
   * Extract zero or more calls from a webhook payload.
   * Return [] for events that aren't completed calls (e.g. ringing updates).
   * Throw only on malformed payloads.
   */
  normalize(payload: unknown): NormalizedInboundCall[];
}

export interface IntegrationRow {
  id: string;
  company_id: string;
  provider: string;
  webhook_token: string | null;
  config_json: {
    default_rep_id?: string | null;
    signing_secret?: string | null;
    /** Skip calls shorter than this many seconds (default 30). */
    min_duration_sec?: number | null;
    /** Auto-score after ingest (default true). */
    auto_score?: boolean | null;
    default_call_type?: string | null;
    default_lead_source?: string | null;
  } | null;
  is_active: boolean;
}
