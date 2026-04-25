// Server-side queries used by app pages. All are RLS-scoped via the user's JWT.

import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getCurrentProfile() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id, full_name, email, role, company_id, team_id")
    .eq("id", user.id)
    .single();
  return data;
}

export async function getCompany(companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("companies")
    .select("id, name, slug, primary_color, timezone")
    .eq("id", companyId)
    .single();
  return data;
}

export interface DashboardStats {
  callsReviewed: number;
  callsReviewedPrior: number;
  avgScore: number | null;
  avgScorePrior: number | null;
  topRepId: string | null;
  weakestRepId: string | null;
  mostImprovedRepId: string | null;
  contracts: number;
  contractsPrior: number;
  appointments: number;
  offers: number;
  conversionRate: number | null;
  conversionRatePrior: number | null;
  repAverages: { rep_id: string; avg: number; n: number }[];
  trendPoints: { date: string; score: number; calls: number }[];
  riskDistribution: { low: number; medium: number; high: number };
  topRepsByImprovement: { rep_id: string; delta: number }[];
}

export async function getDashboardStats(companyId: string, days = 30): Promise<DashboardStats> {
  const supabase = await createSupabaseServerClient();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const priorSince = new Date();
  priorSince.setDate(priorSince.getDate() - days * 2);
  const priorEnd = since;

  const score = (r: { final_score: number | null; average_score: number | null }) =>
    Number(r.final_score ?? r.average_score ?? 0);

  const [
    { count: callsReviewed },
    { count: callsReviewedPrior },
    { data: scoreRows },
    { data: scoreRowsPrior },
    { data: outcomeRows },
    { data: outcomesPrior },
  ] = await Promise.all([
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("call_datetime", since.toISOString()),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("call_datetime", priorSince.toISOString())
      .lt("call_datetime", priorEnd.toISOString()),
    supabase
      .from("scorecards")
      .select("final_score, average_score, rep_id, deal_risk, created_at")
      .eq("company_id", companyId)
      .eq("is_current", true)
      .gte("created_at", since.toISOString())
      .order("created_at"),
    supabase
      .from("scorecards")
      .select("final_score, average_score, rep_id, created_at")
      .eq("company_id", companyId)
      .eq("is_current", true)
      .gte("created_at", priorSince.toISOString())
      .lt("created_at", priorEnd.toISOString()),
    supabase
      .from("calls")
      .select("deal_outcome")
      .eq("company_id", companyId)
      .gte("call_datetime", since.toISOString()),
    supabase
      .from("calls")
      .select("deal_outcome")
      .eq("company_id", companyId)
      .gte("call_datetime", priorSince.toISOString())
      .lt("call_datetime", priorEnd.toISOString()),
  ]);

  const avgScore =
    scoreRows && scoreRows.length
      ? scoreRows.reduce((a, r) => a + score(r as any), 0) / scoreRows.length
      : null;
  const avgScorePrior =
    scoreRowsPrior && scoreRowsPrior.length
      ? scoreRowsPrior.reduce((a, r) => a + score(r as any), 0) / scoreRowsPrior.length
      : null;

  const repAggregate = new Map<string, { sum: number; n: number }>();
  for (const r of scoreRows ?? []) {
    const cur = repAggregate.get(r.rep_id) ?? { sum: 0, n: 0 };
    cur.sum += score(r as any);
    cur.n += 1;
    repAggregate.set(r.rep_id, cur);
  }
  const repAverages = [...repAggregate.entries()].map(([id, v]) => ({
    rep_id: id,
    avg: v.sum / v.n,
    n: v.n,
  }));

  const repPriorAggregate = new Map<string, { sum: number; n: number }>();
  for (const r of scoreRowsPrior ?? []) {
    const cur = repPriorAggregate.get(r.rep_id) ?? { sum: 0, n: 0 };
    cur.sum += score(r as any);
    cur.n += 1;
    repPriorAggregate.set(r.rep_id, cur);
  }
  const topRepsByImprovement = repAverages
    .map((r) => {
      const prior = repPriorAggregate.get(r.rep_id);
      const priorAvg = prior && prior.n ? prior.sum / prior.n : null;
      return { rep_id: r.rep_id, delta: priorAvg != null ? r.avg - priorAvg : 0 };
    })
    .sort((a, b) => b.delta - a.delta);

  let topRepId: string | null = null;
  let weakestRepId: string | null = null;
  if (repAverages.length) {
    const sorted = [...repAverages].sort((a, b) => b.avg - a.avg);
    topRepId = sorted[0].rep_id;
    weakestRepId = sorted[sorted.length - 1].rep_id;
  }
  const mostImprovedRepId =
    topRepsByImprovement.find((r) => r.delta > 0)?.rep_id ?? null;

  const outcomes = outcomeRows ?? [];
  const contracts = outcomes.filter((o) => o.deal_outcome === "contract").length;
  const appointments = outcomes.filter((o) => o.deal_outcome === "appointment").length;
  const offers = outcomes.filter((o) => o.deal_outcome === "offer_made").length;

  const outcomesPriorArr = outcomesPrior ?? [];
  const contractsPrior = outcomesPriorArr.filter((o) => o.deal_outcome === "contract").length;

  const conversionRate =
    callsReviewed && callsReviewed > 0 ? contracts / callsReviewed : null;
  const conversionRatePrior =
    callsReviewedPrior && callsReviewedPrior > 0
      ? contractsPrior / callsReviewedPrior
      : null;

  // Trend: bucket scorecards by day
  const dayBuckets = new Map<string, { sum: number; n: number; calls: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const key = d.toISOString().slice(0, 10);
    dayBuckets.set(key, { sum: 0, n: 0, calls: 0 });
  }
  for (const r of scoreRows ?? []) {
    const key = String(r.created_at).slice(0, 10);
    const cur = dayBuckets.get(key);
    if (!cur) continue;
    cur.sum += score(r as any);
    cur.n += 1;
    cur.calls += 1;
  }
  const trendPoints = [...dayBuckets.entries()].map(([date, v]) => ({
    date,
    score: v.n ? Number((v.sum / v.n).toFixed(2)) : 0,
    calls: v.calls,
  }));

  const riskDistribution = { low: 0, medium: 0, high: 0 };
  for (const r of scoreRows ?? []) {
    const k = (r as any).deal_risk as "low" | "medium" | "high" | null;
    if (k && k in riskDistribution) riskDistribution[k] += 1;
  }

  return {
    callsReviewed: callsReviewed ?? 0,
    callsReviewedPrior: callsReviewedPrior ?? 0,
    avgScore,
    avgScorePrior,
    topRepId,
    weakestRepId,
    mostImprovedRepId,
    contracts,
    contractsPrior,
    appointments,
    offers,
    conversionRate,
    conversionRatePrior,
    repAverages,
    trendPoints,
    riskDistribution,
    topRepsByImprovement,
  };
}

export async function getRepsBasic(companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("reps")
    .select("id, full_name, current_tier, current_avg_score, is_active, role_title")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("full_name");
  return data ?? [];
}

export async function getCoachingPriorities(companyId: string, limit = 5) {
  const supabase = await createSupabaseServerClient();
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const { data } = await supabase
    .from("coaching_notes")
    .select(`
      id, kind, body, pattern_key, created_at,
      reps:rep_id (id, full_name)
    `)
    .eq("company_id", companyId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
