import {
  getCachedComps,
  getCachedMarketSignals,
  getCachedSubject,
  saveAnalysis,
  saveComps,
  saveMarketSignals,
  upsertSubject,
} from "./cache";
import { analyzeDeal } from "./index";
import { AttomProvider } from "./providers/attom";
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
}

export interface FetchAndAnalyzeResult {
  output: AnalyzeDealOutput;
  subject: SubjectProperty;
  subject_id: string | null;
  analysis_id: string | null;
  comps_pulled: number;
}

/**
 * End-to-end: cache → providers → analyze → persist. Falls back gracefully
 * to manual overrides when providers are not configured (no API keys), which
 * is the path most tests run through.
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
      "Could not resolve subject property. Provide subject_override or configure ATTOM/RentCast keys."
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
    if (persist && subjectId) await saveComps(ctx, subjectId, comps);
  }

  // 3. Market signals — manual override > cache > providers.
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

  // 4. Analyze.
  const output = analyzeDeal({
    subject,
    condition_text: input.condition_text ?? "",
    comps,
    market_signals: signals,
    wholesale_fee: input.wholesale_fee ?? 20_000,
    novation_fee: input.novation_fee ?? 40_000,
  });

  // 5. Persist analysis.
  let analysisId: string | null = null;
  if (persist && subjectId) {
    analysisId = await saveAnalysis(ctx, subjectId, ctx.userId ?? null, output);
  }

  return {
    output,
    subject,
    subject_id: subjectId,
    analysis_id: analysisId,
    comps_pulled: comps.length,
  };
}

function buildRouter(): ProviderRouter | null {
  const providers: CompDataProvider[] = [];
  if (process.env.ATTOM_API_KEY) {
    providers.push(new AttomProvider({ apiKey: process.env.ATTOM_API_KEY }));
  }
  if (process.env.RENTCAST_API_KEY) {
    providers.push(new RentCastProvider({ apiKey: process.env.RENTCAST_API_KEY }));
  }
  return providers.length > 0 ? new ProviderRouter(providers) : null;
}
