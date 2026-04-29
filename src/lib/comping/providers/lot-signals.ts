import type { CompRecord, MarketSignals, SubjectProperty } from "../types";
import type {
  CompDataProvider,
  PullCompsOptions,
  SubjectQuery,
} from "./types";

/**
 * Lot-defect signals provider — populates `has_lot_defects` and
 * `near_train_or_busy_road` from three free public APIs:
 *
 *   - FEMA NFHL    (flood hazard zone)
 *   - USGS EPQS    (elevation → slope)
 *   - OSM Overpass (nearby railways + primary/trunk roads)
 *
 * Each subcheck is best-effort and isolated; one slow or rate-limited
 * upstream never tanks the whole lookup. Activated via
 * LOT_SIGNALS_ENABLED=1 because Overpass is rate-limited and we want
 * ops to opt in rather than auto-call it on every analysis.
 *
 * Signals-only — resolveSubject and pullComps are stubbed.
 */

interface LotSignalsConfig {
  fetchImpl?: typeof fetch;
  /** FEMA NFHL flood-hazard query base. Layer 28 = "Flood Hazard Zones". */
  femaUrl?: string;
  /** USGS EPQS elevation point query base. */
  usgsUrl?: string;
  /** Overpass API endpoint. */
  overpassUrl?: string;
  /** Slope threshold (%) above which the lot is flagged. Default 12. */
  slopeThresholdPct?: number;
  /** Railway search radius in meters. Default 200. */
  railRadiusM?: number;
  /** Busy-road search radius in meters. Default 80. */
  roadRadiusM?: number;
  /** Per-call timeout ms. Default 8000. */
  timeoutMs?: number;
}

const DEFAULT_FEMA =
  "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query";
const DEFAULT_USGS = "https://epqs.nationalmap.gov/v1/json";
const DEFAULT_OVERPASS = "https://overpass-api.de/api/interpreter";

const HIGH_RISK_FLOOD_ZONES = new Set([
  "A", "AE", "AH", "AO", "AR", "A99", "V", "VE",
]);

export class LotSignalsProvider implements CompDataProvider {
  readonly name = "lot_signals";
  private readonly fetchImpl: typeof fetch;
  private readonly femaUrl: string;
  private readonly usgsUrl: string;
  private readonly overpassUrl: string;
  private readonly slopeThresholdPct: number;
  private readonly railRadiusM: number;
  private readonly roadRadiusM: number;
  private readonly timeoutMs: number;

  constructor(config: LotSignalsConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.femaUrl = config.femaUrl ?? DEFAULT_FEMA;
    this.usgsUrl = config.usgsUrl ?? DEFAULT_USGS;
    this.overpassUrl = config.overpassUrl ?? DEFAULT_OVERPASS;
    this.slopeThresholdPct = config.slopeThresholdPct ?? 12;
    this.railRadiusM = config.railRadiusM ?? 200;
    this.roadRadiusM = config.roadRadiusM ?? 80;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  async resolveSubject(_q: SubjectQuery): Promise<SubjectProperty | null> {
    return null;
  }
  async pullComps(_s: SubjectProperty, _o: PullCompsOptions): Promise<CompRecord[]> {
    return [];
  }

  async pullMarketSignals(subject: SubjectProperty): Promise<MarketSignals> {
    if (subject.lat == null || subject.lng == null) return {};
    const lat = subject.lat;
    const lng = subject.lng;

    const [floodResult, slopeResult, proximityResult] = await Promise.allSettled([
      this.checkFlood(lat, lng),
      this.checkSlope(lat, lng),
      this.checkProximity(lat, lng),
    ]);

    const floodFlag = floodResult.status === "fulfilled" && floodResult.value;
    const slopeFlag = slopeResult.status === "fulfilled" && slopeResult.value;
    const proximityFlag = proximityResult.status === "fulfilled" && proximityResult.value;

    const out: MarketSignals = {};
    if (floodFlag || slopeFlag) out.has_lot_defects = true;
    if (proximityFlag) out.near_train_or_busy_road = true;
    return out;
  }

  // ─── FEMA flood hazard ──────────────────────────────────────────
  private async checkFlood(lat: number, lng: number): Promise<boolean> {
    const url =
      `${this.femaUrl}?geometry=${lng},${lat}&geometryType=esriGeometryPoint` +
      `&inSR=4326&outFields=FLD_ZONE&returnGeometry=false&f=json`;
    const json = await this.get(url);
    const features = (json as any)?.features;
    if (!Array.isArray(features) || features.length === 0) return false;
    for (const f of features) {
      const zone = String(f?.attributes?.FLD_ZONE ?? "").trim().toUpperCase();
      if (HIGH_RISK_FLOOD_ZONES.has(zone)) return true;
    }
    return false;
  }

  // ─── USGS elevation → slope ─────────────────────────────────────
  private async checkSlope(lat: number, lng: number): Promise<boolean> {
    // Sample 4 cardinal points ~50 m around the subject. Convert that to
    // degrees: 1° lat ≈ 111_320 m; longitude shrinks by cos(lat).
    const dLat = 50 / 111_320;
    const dLng = 50 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const points = [
      { lat: lat + dLat, lng },
      { lat: lat - dLat, lng },
      { lat, lng: lng + dLng },
      { lat, lng: lng - dLng },
    ];
    const elevations = await Promise.all(points.map((p) => this.elevation(p.lat, p.lng)));
    const valid = elevations.filter((e): e is number => typeof e === "number");
    if (valid.length < 2) return false;

    const min = Math.min(...valid);
    const max = Math.max(...valid);
    const dropFt = max - min;
    // Diagonal of the sample box ≈ 100 m × 3.281 ft/m
    const runFt = 100 * 3.281;
    const slopePct = (dropFt / runFt) * 100;
    return slopePct >= this.slopeThresholdPct;
  }

  private async elevation(lat: number, lng: number): Promise<number | null> {
    const url = `${this.usgsUrl}?x=${lng}&y=${lat}&units=Feet&wkid=4326`;
    const json = await this.get(url).catch(() => null);
    const v = (json as any)?.value;
    const n = typeof v === "number" ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  }

  // ─── OSM Overpass — rail + busy roads ────────────────────────────
  private async checkProximity(lat: number, lng: number): Promise<boolean> {
    const query =
      `[out:json][timeout:8];` +
      `(` +
      `way["railway"~"rail|light_rail|subway"](around:${this.railRadiusM},${lat},${lng});` +
      `way["highway"~"motorway|trunk|primary"](around:${this.roadRadiusM},${lat},${lng});` +
      `);` +
      `out count;`;
    const res = await this.fetchWithTimeout(this.overpassUrl, {
      method: "POST",
      headers: { "content-type": "text/plain", accept: "application/json" },
      body: query,
    });
    if (!res.ok) return false;
    const json = await res.json().catch(() => null);
    const elements = (json as any)?.elements;
    if (!Array.isArray(elements) || elements.length === 0) return false;
    // Overpass `out count;` returns one element with tags.ways = "N".
    for (const el of elements) {
      const ways = parseInt(String(el?.tags?.ways ?? el?.tags?.total ?? "0"), 10);
      if (Number.isFinite(ways) && ways > 0) return true;
    }
    return false;
  }

  // ─── infra ──────────────────────────────────────────────────────
  private async get(url: string): Promise<unknown> {
    const res = await this.fetchWithTimeout(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(id);
    }
  }
}
