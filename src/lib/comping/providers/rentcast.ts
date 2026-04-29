import type {
  CompRecord,
  MarketSignals,
  PropertyType,
  SubjectProperty,
} from "../types";
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

  async pullMarketSignals(subject: SubjectProperty): Promise<MarketSignals> {
    if (!subject.zip) return {};
    const url =
      `${this.base}/markets?zipCode=${encodeURIComponent(subject.zip)}` +
      `&dataType=Sale&historyRange=12`;
    const json = await this.get(url).catch(() => null);
    if (!json) return {};
    const appreciation = computeAppreciation12mo(json?.saleData ?? json?.SaleData);
    return appreciation == null ? {} : { appreciation_12mo: appreciation };
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
    photo_urls: extractRentCastPhotos(c),
  };
}

const RENTCAST_MAX_PHOTOS = 5;

/**
 * RentCast packs photos under different keys depending on the endpoint:
 * `images` on listings, `photos` on AVM comparables, `propertyImages`
 * on property detail. Items can be plain string URLs or objects with
 * a `url` field. We dedupe and cap at 5.
 */
function extractRentCastPhotos(c: any): string[] | undefined {
  const candidates = [c?.images, c?.photos, c?.propertyImages];
  const out: string[] = [];
  for (const arr of candidates) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const url =
        typeof item === "string" ? item :
        typeof item?.url === "string" ? item.url :
        typeof item?.photoUrl === "string" ? item.photoUrl :
        typeof item?.imageUrl === "string" ? item.imageUrl : null;
      if (url) out.push(url);
    }
  }
  if (out.length === 0) return undefined;
  return Array.from(new Set(out)).slice(0, RENTCAST_MAX_PHOTOS);
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

/**
 * RentCast's /markets `saleData.history` is a record keyed by `YYYY-MM`.
 * We compute 12-month appreciation as
 *   (latestMedian − ~12moAgoMedian) / ~12moAgoMedian
 * preferring the median over the average (less skewed by outliers). When
 * the history has fewer than ~6 months we return null — the signal is
 * too weak to act on.
 */
export function computeAppreciation12mo(saleData: unknown): number | null {
  if (!saleData || typeof saleData !== "object") return null;
  const history = (saleData as any).history ?? (saleData as any).History;
  if (!history || typeof history !== "object") return null;

  const keys = Object.keys(history)
    .filter((k) => /^\d{4}-\d{2}/.test(k))
    .sort();
  if (keys.length < 6) return null;

  const latestKey = keys[keys.length - 1];
  // Try to find a key that is exactly 12 months before latest. Otherwise
  // use the earliest available point.
  const earlierTarget = subtractYearKey(latestKey);
  const earlierKey =
    keys.find((k) => k === earlierTarget) ??
    closestKeyAtLeast(keys, earlierTarget) ??
    keys[0];

  const latestPrice = pickPrice(history[latestKey]);
  const earlierPrice = pickPrice(history[earlierKey]);
  if (latestPrice == null || earlierPrice == null) return null;
  if (earlierPrice <= 0) return null;

  return Number(((latestPrice - earlierPrice) / earlierPrice).toFixed(4));
}

function subtractYearKey(yyyymm: string): string {
  const [y, m] = yyyymm.split("-");
  return `${(parseInt(y, 10) - 1).toString().padStart(4, "0")}-${m}`;
}

function closestKeyAtLeast(sortedKeys: string[], target: string): string | null {
  for (const k of sortedKeys) if (k >= target) return k;
  return null;
}

function pickPrice(point: unknown): number | null {
  if (!point || typeof point !== "object") return null;
  const p = point as any;
  return num(p.medianPrice ?? p.MedianPrice ?? p.averagePrice ?? p.AveragePrice);
}
