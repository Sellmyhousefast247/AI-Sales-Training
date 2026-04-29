import type { CompRecord, PropertyType, SubjectProperty } from "../types";
import type {
  CompDataProvider,
  PullCompsOptions,
  SubjectQuery,
} from "./types";

/**
 * RentCast (formerly RealtyMole) provider.
 * Docs: https://developers.rentcast.io/reference/introduction
 *
 * Endpoints we use:
 *   GET /properties               — subject lookup by address
 *   GET /avm/value                — comp-based AVM with comparables list
 *   GET /listings/sale            — active sale listings (for buying %)
 */

interface RentCastConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = "https://api.rentcast.io/v1";

export class RentCastProvider implements CompDataProvider {
  readonly name = "rentcast";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: RentCastConfig) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async resolveSubject(query: SubjectQuery): Promise<SubjectProperty | null> {
    const address = buildAddressString(query);
    if (!address) return null;
    const url = `${this.base}/properties?address=${encodeURIComponent(address)}`;
    const json = await this.get(url);
    const first = Array.isArray(json) ? json[0] : json;
    if (!first) return null;
    return mapRentCastProperty(first);
  }

  async pullComps(
    subject: SubjectProperty,
    opts: PullCompsOptions
  ): Promise<CompRecord[]> {
    const address = subject.address;
    if (!address) return [];
    const limit = opts.limit ?? 25;

    const valueUrl =
      `${this.base}/avm/value` +
      `?address=${encodeURIComponent(address)}` +
      `&compCount=${Math.min(25, limit)}` +
      `&radius=${opts.radiusMi}`;

    const listingsUrl =
      subject.lat != null && subject.lng != null
        ? `${this.base}/listings/sale?latitude=${subject.lat}&longitude=${subject.lng}` +
          `&radius=${opts.radiusMi}&limit=${limit}`
        : null;

    const [avm, listings] = await Promise.all([
      this.get(valueUrl).catch(() => null),
      listingsUrl ? this.get(listingsUrl).catch(() => null) : Promise.resolve(null),
    ]);

    const out: CompRecord[] = [];
    for (const c of toArray<any>(avm?.comparables)) {
      const rec = mapRentCastComp(c, subject, "sold");
      if (rec) out.push(rec);
    }
    for (const c of toArray<any>(listings)) {
      const status = mapListingStatus(c?.status);
      const rec = mapRentCastComp(c, subject, status);
      if (rec) out.push(rec);
    }
    return out;
  }

  private async get(url: string): Promise<any> {
    const res = await this.fetchImpl(url, {
      headers: { "X-Api-Key": this.config.apiKey, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`RentCast ${res.status}: ${await safeBody(res)}`);
    }
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function buildAddressString(q: SubjectQuery): string {
  const parts = [q.address, q.city, q.state, q.zip].filter(Boolean);
  return parts.join(", ");
}

function toArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function mapRentCastProperty(p: any): SubjectProperty | null {
  const beds = num(p?.bedrooms);
  const baths = num(p?.bathrooms);
  const sqft = num(p?.squareFootage);
  if (beds == null || baths == null || !sqft) return null;
  return {
    address: p?.formattedAddress ?? p?.addressLine1 ?? "",
    city: p?.city,
    state: p?.state,
    zip: p?.zipCode,
    lat: num(p?.latitude) ?? undefined,
    lng: num(p?.longitude) ?? undefined,
    beds,
    baths,
    sqft,
    lot_sqft: num(p?.lotSize) ?? undefined,
    year_built: num(p?.yearBuilt) ?? undefined,
    property_type: mapPropertyType(p?.propertyType),
    garage_stalls: num(p?.features?.garageSpaces) ?? undefined,
  };
}

function mapRentCastComp(
  c: any,
  subject: SubjectProperty,
  status: "sold" | "active" | "pending"
): CompRecord | null {
  const sqft = num(c?.squareFootage ?? c?.size);
  const beds = num(c?.bedrooms);
  const baths = num(c?.bathrooms);
  const price = num(c?.price ?? c?.lastSalePrice ?? c?.listPrice);
  if (!sqft || beds == null || baths == null || !price) return null;

  const distance =
    num(c?.distance) ??
    distanceFromLatLng(subject, num(c?.latitude), num(c?.longitude));

  return {
    source: "rentcast",
    source_id: c?.id ?? c?.formattedAddress,
    status,
    price,
    close_date: c?.lastSaleDate ?? c?.removedDate ?? undefined,
    list_date: c?.listedDate ?? undefined,
    beds,
    baths,
    sqft,
    lot_sqft: num(c?.lotSize) ?? undefined,
    year_built: num(c?.yearBuilt) ?? undefined,
    distance_mi: Number((distance ?? 0).toFixed(2)),
    condition: "average",
    garage_stalls: num(c?.features?.garageSpaces) ?? undefined,
    is_distressed: false,
    property_type: mapPropertyType(c?.propertyType),
  };
}

function mapListingStatus(s: unknown): "active" | "pending" {
  const t = String(s ?? "").toLowerCase();
  if (t.includes("pending") || t.includes("contract")) return "pending";
  return "active";
}

function mapPropertyType(raw: unknown): PropertyType {
  const s = String(raw ?? "").toLowerCase();
  if (s.includes("condo")) return "condo";
  if (s.includes("town")) return "townhouse";
  if (s.includes("multi") || s.includes("duplex") || s.includes("triplex"))
    return "multi_family";
  if (s.includes("manufactured") || s.includes("mobile")) return "manufactured";
  if (s.includes("land") || s.includes("vacant")) return "land";
  return "single_family";
}

function distanceFromLatLng(
  subject: SubjectProperty,
  lat: number | null,
  lng: number | null
): number | null {
  if (lat == null || lng == null || subject.lat == null || subject.lng == null) {
    return null;
  }
  const R = 3958.8;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat - subject.lat);
  const dLng = toRad(lng - subject.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(subject.lat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
