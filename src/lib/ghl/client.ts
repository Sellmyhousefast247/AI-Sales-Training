/**
 * GoHighLevel API client.
 *
 * Auth: per-location Private Integration token (Bearer).
 * Base: https://services.leadconnectorhq.com (LeadConnector v2 API).
 *
 * Construct with `getGhlClient()` (reads env vars). The constructor is
 * exported for tests / multi-tenant later.
 */

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";

export interface GhlLocation {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phone?: string;
  email?: string;
  timezone?: string;
}

export interface GhlConversation {
  id: string;
  contactId: string;
  locationId: string;
  lastMessageDate?: string;
  type?: string;
  unreadCount?: number;
}

export interface GhlMessage {
  id: string;
  type: string; // 'TYPE_CALL', 'TYPE_VOICEMAIL', 'TYPE_SMS', etc.
  body?: string;
  direction?: "inbound" | "outbound";
  dateAdded?: string;
  contactId?: string;
  conversationId?: string;
  /** Twilio recording URL when type === 'TYPE_CALL'. */
  meta?: {
    call?: {
      duration?: number;
      status?: string;
      recordingUrl?: string;
    };
  };
}

export class GhlClient {
  constructor(
    private readonly token: string,
    public readonly locationId: string
  ) {}

  private async request<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
    const url = path.startsWith("http") ? path : `${GHL_BASE}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Version: GHL_API_VERSION,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: text || res.statusText };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  }

  /** Smoke-test the token: fetch the location record. */
  async getLocation(): Promise<
    { ok: true; location: GhlLocation } | { ok: false; status: number; error: string }
  > {
    const r = await this.request<{ location: GhlLocation }>(
      `/locations/${this.locationId}`
    );
    if (!r.ok) return r;
    return { ok: true, location: r.data.location };
  }
}

/**
 * Build a client from env vars. Returns null when either var is unset
 * so callers can render a "not configured" state instead of crashing.
 */
export function getGhlClient(): GhlClient | null {
  const token = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) return null;
  return new GhlClient(token, locationId);
}
