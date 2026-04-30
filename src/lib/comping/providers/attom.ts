import type {
  CompCondition,
  CompRecord,
  PropertyType,
  SubjectProperty,
} from "../types";
import { detectPropertyTypeOrDefault } from "../property-type";
import type {
  CompDataProvider,
  PullCompsOptions,
  SubjectQuery,
} from "./types";

/**
 * ATTOM Data Solutions provider.
 * Docs: https://api.developer.attomdata.com/
 *
 * We use:
 *   - /propertyapi/v1.0.0/property/expandedprofile  — subject lookup
 *   - /propertyapi/v1.0.0/sale/snapshot              — recent sold comps
 *   - /propertyapi/v1.0.0/property/snapshot          — actives nearby
 *
 * The shapes returned by ATTOM are deeply nested; we take the safe
 * path through the response and bail to skips when fields are missing.
 */

interface AttomConfig {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_BASE = "https://api.gateway.attomdata.com/propertyapi/v1.0.0";

export class AttomProvider implements CompDataProvider {
  readonly name = "attom";
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: AttomConfig) {
    this.base = config.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async resolveSubject(query: SubjectQuery): Promise<SubjectProperty | null> {
    const { address1, address2 } = splitAddress(query);
    if (!address1 || !address2) return null;

    const url = `${this.base}/property/expandedprofile?address1=${encodeURIComponent(
      address1
    )}&address2=${encodeURIComponent(address2)}`;

    const json = await this.get(url);
    const property = pickFirst<any>(json?.property);
    if (!property) return null;

    return mapAttomToSubject(property);
  }

  async pullComps(
    subject: SubjectProperty,
    opts: PullCompsOptions
  ): Promise<CompRecord[]> {
    if (subject.lat == null || subject.lng == null) return [];
    const radius = opts.radiusMi.toFixed(2);
    const limit = opts.limit ?? 50;

    // Solds from sale snapshot.
    const soldUrl =
      `${this.base}/sale/snapshot` +
      `?latitude=${subject.lat}&longitude=${subject.lng}` +
      `&radius=${radius}&pagesize=${limit}` +
      `&minBedrooms=${Math.max(1, subject.beds - 1)}` +
      `&maxBedrooms=${subject.beds + 1}` +
      `&minBathsTotal=${Math.max(1, subject.baths - 1)}` +
      `&maxBathsTotal=${subject.baths + 1}` +
      `&minUniversalsize=${Math.round(subject.sqft * 0.8)}` +
      `&maxUniversalsize=${Math.round(subject.sqft * 1.2)}`;

    // Actives & pendings from property snapshot.
    const activeUrl =
      `${this.base}/property/snapshot` +
      `?latitude=${subject.lat}&longitude=${subject.lng}` +
      `&radius=${radius}&pagesize=${limit}`;

    const [solds, listings] = await Promise.all([
      this.get(soldUrl).catch(() => null),
      this.get(activeUrl).catch(() => null),
    ]);

    const out: CompRecord[] = [];
    for (const p of pickArray<any>(solds?.property)) {
      const rec = mapAttomToComp(p, subject, "sold");
      if (rec) out.push(rec);
    }
    for (const p of pickArray<any>(listings?.property)) {
      // ATTOM's property snapshot doesn't tell us active vs pending reliably;
      // assume active. MLS/RentCast can correct this when merged.
      const rec = mapAttomToComp(p, subject, "active");
      if (rec) out.push(rec);
    }
    return out;
  }

  async pullAvm(subject: SubjectProperty): Promise<{ source: string; arv: number } | null> {
    const { address1, address2 } = splitAddress({
      address: subject.address,
      city: subject.city,
      state: subject.state,
      zip: subject.zip,
    });
    if (!address1 || !address2) return null;
    const url =
      `${this.base}/property/avm?address1=${encodeURIComponent(address1)}` +
      `&address2=${encodeURIComponent(address2)}`;
    const json = await this.get(url).catch(() => null);
    const property = pickFirst<any>((json as any)?.property);
    const v = num(property?.avm?.amount?.value);
    if (v == null || v <= 0) return null;
    return { source: "attom", arv: v };
  }

  private async get(url: string): Promise<any> {
    const res = await this.fetchImpl(url, {
      headers: { apikey: this.config.apiKey, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`ATTOM ${res.status}: ${await safeBody(res)}`);
    }
    return res.json();
  }
}

// ─────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────

function splitAddress(q: SubjectQuery): { address1?: string; address2?: string } {
  // ATTOM wants address1 = street, address2 = "City, ST ZIP"
  if (q.city && q.state) {
    const zip = q.zip ? ` ${q.zip}` : "";
    return { address1: q.address, address2: `${q.city}, ${q.state}${zip}` };
  }
  // Best-effort split on the first comma.
  const idx = q.address.indexOf(",");
  if (idx === -1) return { address1: q.address };
  return {
    address1: q.address.slice(0, idx).trim(),
    address2: q.address.slice(idx + 1).trim(),
  };
}

function pickFirst<T>(arr: unknown): T | null {
  if (Array.isArray(arr) && arr.length > 0) return arr[0] as T;
  return null;
}

function pickArray<T>(arr: unknown): T[] {
  return Array.isArray(arr) ? (arr as T[]) : [];
}

function mapAttomToSubject(p: any): SubjectProperty | null {
  const beds = num(p?.building?.rooms?.beds);
  const baths = num(p?.building?.rooms?.bathstotal ?? p?.building?.rooms?.bathsfull);
  const sqft = num(p?.building?.size?.universalsize ?? p?.building?.size?.livingsize);
  if (beds == null || baths == null || sqft == null) return null;

  return {
    address: p?.address?.line1 ?? p?.address?.oneLine ?? "",
    city: p?.address?.locality,
    state: p?.address?.countrySubd,
    zip: p?.address?.postal1,
    lat: num(p?.location?.latitude) ?? undefined,
    lng: num(p?.location?.longitude) ?? undefined,
    beds,
    baths,
    sqft,
    lot_sqft: num(p?.lot?.lotsize2) ?? undefined,
    year_built: num(p?.summary?.yearbuilt) ?? undefined,
    property_type: mapPropertyType(p?.summary?.propclass),
    garage_stalls: num(p?.building?.parking?.prkgSpaces) ?? undefined,
  };
}

function mapAttomToComp(
  p: any,
  subject: SubjectProperty,
  status: "sold" | "active"
): CompRecord | null {
  const sqft = num(p?.building?.size?.universalsize ?? p?.building?.size?.livingsize);
  const beds = num(p?.building?.rooms?.beds);
  const baths = num(p?.building?.rooms?.bathstotal ?? p?.building?.rooms?.bathsfull);
  const price = num(p?.sale?.amount?.saleamt ?? p?.assessment?.market?.mktttlvalue);
  if (!sqft || beds == null || baths == null || !price) return null;

  const lat = num(p?.location?.latitude);
  const lng = num(p?.location?.longitude);
  const distance =
    lat != null && lng != null && subject.lat != null && subject.lng != null
      ? haversineMi(subject.lat, subject.lng, lat, lng)
      : 0;

  return {
    source: "attom",
    source_id: String(p?.identifier?.attomId ?? p?.identifier?.Id ?? ""),
    status,
    price,
    close_date: p?.sale?.salesearchdate ?? p?.sale?.saleTransDate ?? undefined,
    list_date: undefined,
    beds,
    baths,
    sqft,
    lot_sqft: num(p?.lot?.lotsize2) ?? undefined,
    year_built: num(p?.summary?.yearbuilt) ?? undefined,
    distance_mi: Number(distance.toFixed(2)),
    condition: inferCondition(p),
    garage_stalls: num(p?.building?.parking?.prkgSpaces) ?? undefined,
    is_distressed:
      String(p?.sale?.amount?.saledisclosuretype ?? "").toLowerCase().includes("foreclosure"),
    property_type: mapPropertyType(p?.summary?.propclass),
    photo_urls: extractAttomPhotos(p),
  };
}

const ATTOM_MAX_PHOTOS = 5;

/**
 * ATTOM responses sometimes include a `media` collection (e.g. via the
 * /property/detailwithphotos endpoint) or a `photos` array (legacy).
 * Both shapes are tolerated; if neither is present, photos stay undefined.
 */
function extractAttomPhotos(p: any): string[] | undefined {
  const out: string[] = [];

  const media = p?.media;
  if (Array.isArray(media)) {
    for (const m of media) {
      const url = typeof m?.PhotoURL === "string" ? m.PhotoURL :
                  typeof m?.photoURL === "string" ? m.photoURL :
                  typeof m?.url === "string" ? m.url : null;
      if (url) out.push(url);
    }
  }

  const photos = p?.photos;
  if (Array.isArray(photos)) {
    for (const ph of photos) {
      const url = typeof ph === "string" ? ph :
                  typeof ph?.url === "string" ? ph.url :
                  typeof ph?.photoUrl === "string" ? ph.photoUrl : null;
      if (url) out.push(url);
    }
  }

  if (out.length === 0) return undefined;
  return Array.from(new Set(out)).slice(0, ATTOM_MAX_PHOTOS);
}

function inferCondition(_p: any): CompCondition {
  // ATTOM doesn't expose remodel/condition reliably; default to "average".
  // Claude classifier will overwrite this at the orchestration layer when MLS
  // remarks are available.
  return "average";
}

function mapPropertyType(raw: unknown): PropertyType {
  return detectPropertyTypeOrDefault(raw);
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

async function safeBody(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
