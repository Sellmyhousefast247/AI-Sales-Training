import type {
  CompRecord,
  CompStatus,
  PropertyType,
  SubjectProperty,
} from "../types";
import type {
  CompDataProvider,
  PullCompsOptions,
  SubjectQuery,
} from "./types";

/**
 * Bridge Interactive MLS provider (RESO Web API v2).
 * Docs: https://bridgedataoutput.com/docs/explorer/reso-web-api
 *
 * Bridge is per-dataset (per-MLS). Caller supplies the dataset slug at
 * construction time — e.g. "actris_ref" (Austin), "mlspin" (Mass.),
 * "test" for the public sandbox.
 *
 * Auth: server-side token, sent as a Bearer header so it doesn't appear
 * in access logs.
 *
 * Critically for non-disclosure states: we capture both ListPrice and
 * ClosePrice plus DaysOnMarket, so the orchestrator can fall back to
 * list-price imputation when ClosePrice is unavailable.
 */

interface BridgeConfig {
  accessToken: string;
  dataset: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = "https://api.bridgedataoutput.com/api/v2";

const FIELDS = [
  "ListingId",
  "UnparsedAddress",
  "City",
  "StateOrProvince",
  "PostalCode",
  "Latitude",
  "Longitude",
  "BedroomsTotal",
  "BathroomsTotalInteger",
  "BathroomsFull",
  "BathroomsHalf",
  "LivingArea",
  "LotSizeSquareFeet",
  "YearBuilt",
  "PropertyType",
  "PropertySubType",
  "StandardStatus",
  "MlsStatus",
  "ListPrice",
  "OriginalListPrice",
  "ClosePrice",
  "CloseDate",
  "ListDate",
  "OnMarketDate",
  "DaysOnMarket",
  "PublicRemarks",
  "GarageSpaces",
  "SpecialListingConditions",
  "Media",
].join(",");

const MAX_PHOTOS = 5;

export class BridgeProvider implements CompDataProvider {
  readonly name = "bridge";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: BridgeConfig) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async resolveSubject(query: SubjectQuery): Promise<SubjectProperty | null> {
    const filters = [
      `UnparsedAddress eq '${escapeOData(buildFullAddress(query))}'`,
      `UnparsedAddress eq '${escapeOData(query.address)}'`,
    ];
    for (const filter of filters) {
      const url =
        `${this.base}/${encodeURIComponent(this.config.dataset)}/listings` +
        `?filter=${encodeURIComponent(filter)}&fields=${FIELDS}&limit=1`;
      const json = await this.get(url).catch(() => null);
      const first = pickArray<any>(json?.bundle)[0];
      if (first) return mapSubject(first);
    }
    return null;
  }

  async pullComps(
    subject: SubjectProperty,
    opts: PullCompsOptions
  ): Promise<CompRecord[]> {
    if (subject.lat == null || subject.lng == null) return [];
    const limit = opts.limit ?? 50;
    const cutoff = monthsAgoIso(opts.monthsBack);

    const baseConstraints =
      `BedroomsTotal ge ${Math.max(1, subject.beds - 1)} and ` +
      `BedroomsTotal le ${subject.beds + 1} and ` +
      `LivingArea ge ${Math.round(subject.sqft * 0.8)} and ` +
      `LivingArea le ${Math.round(subject.sqft * 1.2)}`;

    const soldFilter =
      `StandardStatus eq 'Closed' and CloseDate gt ${cutoff} and ${baseConstraints}`;

    const liveFilter =
      `(StandardStatus eq 'Active' or StandardStatus eq 'Pending' or ` +
      `StandardStatus eq 'Active Under Contract') and ${baseConstraints}`;

    const near = `${subject.lat},${subject.lng}`;
    const radius = opts.radiusMi.toFixed(2);

    const buildUrl = (filter: string) =>
      `${this.base}/${encodeURIComponent(this.config.dataset)}/listings` +
      `?filter=${encodeURIComponent(filter)}` +
      `&near=${near}&radius=${radius}mi&limit=${limit}&fields=${FIELDS}`;

    const [solds, lives] = await Promise.all([
      this.get(buildUrl(soldFilter)).catch(() => null),
      this.get(buildUrl(liveFilter)).catch(() => null),
    ]);

    const out: CompRecord[] = [];
    for (const r of pickArray<any>(solds?.bundle)) {
      const rec = mapComp(r, subject);
      if (rec) out.push(rec);
    }
    for (const r of pickArray<any>(lives?.bundle)) {
      const rec = mapComp(r, subject);
      if (rec) out.push(rec);
    }
    return out;
  }

  private async get(url: string): Promise<any> {
    const res = await this.fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`Bridge ${res.status}: ${await safeBody(res)}`);
    }
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function buildFullAddress(q: SubjectQuery): string {
  return [q.address, q.city, q.state, q.zip].filter(Boolean).join(", ");
}

function escapeOData(s: string): string {
  return s.replace(/'/g, "''");
}

function pickArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function mapSubject(r: any): SubjectProperty | null {
  const beds = num(r?.BedroomsTotal);
  const baths = combinedBaths(r);
  const sqft = num(r?.LivingArea);
  if (beds == null || baths == null || !sqft) return null;
  return {
    address: r?.UnparsedAddress ?? "",
    city: r?.City,
    state: r?.StateOrProvince,
    zip: r?.PostalCode,
    lat: num(r?.Latitude) ?? undefined,
    lng: num(r?.Longitude) ?? undefined,
    beds,
    baths,
    sqft,
    lot_sqft: num(r?.LotSizeSquareFeet) ?? undefined,
    year_built: num(r?.YearBuilt) ?? undefined,
    property_type: mapPropertyType(r?.PropertyType, r?.PropertySubType),
    garage_stalls: num(r?.GarageSpaces) ?? undefined,
  };
}

function mapComp(r: any, subject: SubjectProperty): CompRecord | null {
  const beds = num(r?.BedroomsTotal);
  const baths = combinedBaths(r);
  const sqft = num(r?.LivingArea);
  const status = mapStatus(r?.StandardStatus);
  if (beds == null || baths == null || !sqft || !status) return null;

  const closePrice = num(r?.ClosePrice);
  const listPrice = num(r?.ListPrice);
  const originalListPrice = num(r?.OriginalListPrice);

  // Bridge gives us the true close price when sold. If the MLS feed
  // doesn't carry close price (rare but happens in NDS jurisdictions),
  // we leave price=0 so the NDS imputer can fill it in.
  const price =
    status === "sold" ? closePrice ?? 0 : listPrice ?? closePrice ?? 0;

  const lat = num(r?.Latitude);
  const lng = num(r?.Longitude);
  const distance =
    lat != null && lng != null && subject.lat != null && subject.lng != null
      ? haversineMi(subject.lat, subject.lng, lat, lng)
      : 0;

  return {
    source: "bridge",
    source_id: String(r?.ListingId ?? ""),
    status,
    price,
    list_price: listPrice ?? undefined,
    original_list_price: originalListPrice ?? undefined,
    dom_days: num(r?.DaysOnMarket) ?? undefined,
    close_date: r?.CloseDate ?? undefined,
    list_date: r?.ListDate ?? r?.OnMarketDate ?? undefined,
    beds,
    baths,
    sqft,
    lot_sqft: num(r?.LotSizeSquareFeet) ?? undefined,
    year_built: num(r?.YearBuilt) ?? undefined,
    distance_mi: Number(distance.toFixed(2)),
    condition: "average",
    garage_stalls: num(r?.GarageSpaces) ?? undefined,
    is_distressed: isDistressed(r?.SpecialListingConditions),
    property_type: mapPropertyType(r?.PropertyType, r?.PropertySubType),
    remarks: typeof r?.PublicRemarks === "string" ? r.PublicRemarks : undefined,
    photo_urls: extractMediaUrls(r?.Media),
  };
}

function extractMediaUrls(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .filter((m: any) => {
      const cat = String(m?.MediaCategory ?? "").toLowerCase();
      // Many feeds set MediaCategory to "Photo" / "Photos"; some leave it
      // blank. Accept anything that isn't explicitly Document/Floorplan.
      return !cat.includes("document") && !cat.includes("floor plan");
    })
    .map((m: any) => ({
      url: typeof m?.MediaURL === "string" ? m.MediaURL : null,
      order: typeof m?.Order === "number" ? m.Order : 999,
    }))
    .filter((m: { url: string | null }) => !!m.url) as Array<{ url: string; order: number }>;
  if (items.length === 0) return undefined;
  items.sort((a, b) => a.order - b.order);
  return items.slice(0, MAX_PHOTOS).map((m) => m.url);
}

function combinedBaths(r: any): number | null {
  const total = num(r?.BathroomsTotalInteger);
  if (total != null) return total;
  const full = num(r?.BathroomsFull);
  const half = num(r?.BathroomsHalf);
  if (full != null) return full + (half ?? 0) * 0.5;
  return null;
}

function mapStatus(s: unknown): CompStatus | null {
  const t = String(s ?? "").toLowerCase();
  if (t === "closed") return "sold";
  if (t.includes("pending") || t.includes("under contract")) return "pending";
  if (t === "active") return "active";
  return null;
}

function mapPropertyType(type: unknown, subType: unknown): PropertyType {
  const blob = `${String(type ?? "")} ${String(subType ?? "")}`.toLowerCase();
  if (blob.includes("condo")) return "condo";
  if (blob.includes("town")) return "townhouse";
  if (blob.includes("multi") || blob.includes("duplex") || blob.includes("triplex")) {
    return "multi_family";
  }
  if (blob.includes("manufactured") || blob.includes("mobile")) return "manufactured";
  if (blob.includes("land") || blob.includes("vacant")) return "land";
  return "single_family";
}

function isDistressed(raw: unknown): boolean {
  const t = String(raw ?? "").toLowerCase();
  return (
    t.includes("foreclosure") ||
    t.includes("reo") ||
    t.includes("short sale") ||
    t.includes("auction")
  );
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
