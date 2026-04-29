import {
  getCachedComps,
  getCachedMarketSignals,
  getCachedSubject,
  saveAnalysis,
  saveComps,
  saveMarketSignals,
  upsertSubject,
} from "./cache";
import { tagCompConditions } from "./condition-classifier";
import { tagCompsByPhotos } from "./photo-classifier";
import { analyzeDeal } from "./index";
import { imputeMissingPrices, isNonDisclosureState } from "./non-disclosure";
import { AttomProvider } from "./providers/attom";
import { BridgeProvider } from "./providers/bridge";
import { FbiCrimeProvider } from "./providers/fbi-crime";
import { GreatSchoolsProvider } from "./providers/greatschools";
import { RentCastProvider } from "./providers/rentcast";
import { ProviderRouter, type CompDataProvider } from "./providers/types";
import type {
  AnalyzeDealOutput,
  CompRecord,
  MarketSignals,
  SubjectProperty,
} from "./types";

export interface OrchestratorContext {
  companyId: string;
  userId?: string | null;
}

export interface FetchAndAnalyzeInput {
  ctx: OrchestratorContext;
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  condition_text?: string;
  /** Manually-supplied subject overrides — used in tests / when no provider key is present. */
  subject_override?: SubjectProperty;
  /** Manually-supplied comps — bypasses providers when present. */
  comps_override?: CompRecord[];
  signals_override?: MarketSignals;
  wholesale_fee?: number;
  novation_fee?: number;
  /** When true, persist subject/comps/analysis to Supabase. Default true. */
  persist?: boolean;
  /** When true, run the Claude condition classifier on comp remarks. Default true when ANTHROPIC_API_KEY is set. */
  classify_conditions?: boolean;
}

export interface FetchAndAnalyzeResult {
  output: AnalyzeDealOutput;
  subject: SubjectProperty;
  subject_id: string | null;
  analysis_id: string | null;
  comps_pulled: number;
  comps_imputed: number;
  non_disclosure_state: boolean;
}

/**
 * End-to-end: cache → providers → classify → impute → analyze → persist.
 * Falls back gracefully to manual overrides when providers are not
 * configured, which is the path most tests run through.
 */
export async function fetchAndAnalyze(
  input: FetchAndAnalyzeInput
): Promise<FetchAndAnalyzeResult> {
  const { ctx, address, city, state, zip } = input;
  const persist = input.persist ?? true;

  // 1. Subject — manual override > cache > provider lookup.
  let subject: SubjectProperty | null = input.subject_override ?? null;
  let subjectId: string | null = null;

  if (!subject && persist) {
    const cached = await getCachedSubject(ctx, address);
    if (cached) {
      subject = cached.subject;
      subjectId = cached.id;
    }
  }
  const router = buildRouter();
  if (!subject && router) {
    subject = await router.resolveSubject({ address, city, state, zip });
  }
  if (!subject) {
    throw new Error(
      "Could not resolve subject property. Provide subject_override or configure provider keys."
    );
  }

  if (persist && subjectId === null) {
    subjectId = await upsertSubject(ctx, subject, "provider");
  }

  // 2. Comps — manual override > cache > provider fan-out.
  let comps: CompRecord[] = input.comps_override ?? [];
  if (comps.length === 0 && persist && subjectId) {
    const cachedComps = await getCachedComps(ctx, subjectId);
    if (cachedComps) comps = cachedComps;
  }
  if (comps.length === 0 && router) {
    comps = await router.pullComps(subject, { radiusMi: 0.5, monthsBack: 12, limit: 50 });
  }

  // 3. Tag condition. Photo-vision is the strongest signal — when a comp
  //    has photos, prefer it over remarks. Remarks classifier picks up
  //    whatever the photo pass left untagged. Both runs are best-effort
  //    and quietly skipped when no API key is set.
  const shouldClassify = input.classify_conditions ?? !!process.env.ANTHROPIC_API_KEY;
  if (shouldClassify) {
    const hasPhotos = comps.some(
      (c) => c.source_id && c.photo_urls && c.photo_urls.length > 0 && c.condition === "average"
    );
    if (hasPhotos) {
      try {
        comps = await tagCompsByPhotos(comps);
      } catch {
        // photo classifier is best-effort
      }
    }
    const remarksById: Record<string, string> = {};
    for (const c of comps) {
      if (c.source_id && c.remarks && c.condition === "average") {
        remarksById[c.source_id] = c.remarks;
      }
    }
    if (Object.keys(remarksById).length > 0) {
      try {
        comps = await tagCompConditions(comps, remarksById);
      } catch {
        // classifier is best-effort
      }
    }
  }

  // 4. Market signals — manual override > cache > providers.
  let signals: MarketSignals = input.signals_override ?? {};
  if (Object.keys(signals).length === 0 && persist && subjectId) {
    const cachedSignals = await getCachedMarketSignals(ctx, subjectId);
    if (cachedSignals) signals = cachedSignals;
  }
  if (Object.keys(signals).length === 0 && router) {
    signals = await router.pullMarketSignals(subject);
    if (persist && subjectId && Object.keys(signals).length > 0) {
      await saveMarketSignals(ctx, subjectId, signals);
    }
  }

  // 5. Non-disclosure state imputation. Comps from non-MLS sources in NDS
  //    states often have price=0 even when sold; we impute from list_price
  //    + DOM using the market sale-to-list ratio.
  const ndsState = isNonDisclosureState(subject.state);
  const before = comps.map((c) => c.price);
  comps = imputeMissingPrices(subject, comps, signals);
  const compsImputed = comps.reduce(
    (n, c, i) => n + (c.price_imputed && c.price !== before[i] ? 1 : 0),
    0
  );

  // Persist comps after enrichment so the cache stores the resolved data.
  if (persist && subjectId && comps.length > 0) {
    await saveComps(ctx, subjectId, comps);
  }

  // 6. Analyze.
  const output = analyzeDeal({
    subject,
    condition_text: input.condition_text ?? "",
    comps,
    market_signals: signals,
    wholesale_fee: input.wholesale_fee ?? 20_000,
    novation_fee: input.novation_fee ?? 40_000,
  });
  if (ndsState && compsImputed > 0) {
    output.warnings.push(
      `Non-disclosure state: ${compsImputed} comp price(s) imputed from list price + DOM.`
    );
  }

  // 7. Persist analysis.
  let analysisId: string | null = null;
  if (persist && subjectId) {
    analysisId = await saveAnalysis(ctx, subjectId, ctx.userId ?? null, output, {
      comps,
      subject,
    });
  }

  return {
    output,
    subject,
    subject_id: subjectId,
    analysis_id: analysisId,
    comps_pulled: comps.length,
    comps_imputed: compsImputed,
    non_disclosure_state: ndsState,
  };
}

function buildRouter(): ProviderRouter | null {
  const providers: CompDataProvider[] = [];
  if (process.env.BRIDGE_ACCESS_TOKEN && process.env.BRIDGE_DATASET) {
    providers.push(
      new BridgeProvider({
        accessToken: process.env.BRIDGE_ACCESS_TOKEN,
        dataset: process.env.BRIDGE_DATASET,
      })
    );
  }
  if (process.env.ATTOM_API_KEY) {
    providers.push(new AttomProvider({ apiKey: process.env.ATTOM_API_KEY }));
  }
  if (process.env.RENTCAST_API_KEY) {
    providers.push(new RentCastProvider({ apiKey: process.env.RENTCAST_API_KEY }));
  }
  if (process.env.GREATSCHOOLS_API_KEY) {
    providers.push(new GreatSchoolsProvider({ apiKey: process.env.GREATSCHOOLS_API_KEY }));
  }
  if (process.env.FBI_CRIME_API_KEY) {
    providers.push(new FbiCrimeProvider({ apiKey: process.env.FBI_CRIME_API_KEY }));
  }
  return providers.length > 0 ? new ProviderRouter(providers) : null;
}
