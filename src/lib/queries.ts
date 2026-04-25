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

export async function getDashboardStats(companyId: string, days = 30) {
  const supabase = await createSupabaseServerClient();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [{ count: callsReviewed }, { data: scoreRows }, { data: outcomeRows }] = await Promise.all([
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .gte("call_datetime", since.toISOString()),
    supabase
      .from("scorecards")
      .select("final_score, average_score, rep_id, created_at")
      .eq("company_id", companyId)
      .eq("is_current", true)
      .gte("created_at", since.toISOString()),
    supabase
      .from("calls")
      .select("deal_outcome")
      .eq("company_id", companyId)
      .gte("call_datetime", since.toISOString()),
  ]);

  const score = (r: { final_score: number | null; average_score: number | null }) =>
    Number(r.final_score ?? r.average_score ?? 0);

  const avgScore =
    scoreRows && scoreRows.length
      ? scoreRows.reduce((a, r) => a + score(r as any), 0) / scoreRows.length
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

  let topRepId: string | null = null;
  let weakestRepId: string | null = null;
  if (repAverages.length) {
    const sorted = [...repAverages].sort((a, b) => b.avg - a.avg);
    topRepId = sorted[0].rep_id;
    weakestRepId = sorted[sorted.length - 1].rep_id;
  }

  const outcomes = outcomeRows ?? [];
  const contracts = outcomes.filter((o) => o.deal_outcome === "contract").length;
  const appointments = outcomes.filter((o) => o.deal_outcome === "appointment").length;
  const offers = outcomes.filter((o) => o.deal_outcome === "offer_made").length;

  return {
    callsReviewed: callsReviewed ?? 0,
    avgScore,
    topRepId,
    weakestRepId,
    contracts,
    appointments,
    offers,
    repAverages,
  };
}

export async function getRepsBasic(companyId: string) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("reps")
    .select("id, full_name, current_tier, current_avg_score, is_active")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("full_name");
  return data ?? [];
}
