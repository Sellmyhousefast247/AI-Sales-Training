import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const supabase = await createSupabaseServerClient();
  let q = supabase
    .from("calls")
    .select(`
      id, call_datetime, call_type, lead_source, seller_name, deal_outcome,
      reps:rep_id (full_name),
      scorecards!scorecards_call_id_fkey (final_score, average_score, total_score, deal_risk, conversion_probability, is_current)
    `)
    .eq("company_id", profile.company_id)
    .order("call_datetime", { ascending: false });

  if (from) q = q.gte("call_datetime", from);
  if (to) q = q.lte("call_datetime", to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: { code: "internal", message: error.message } }, { status: 500 });

  const headers = [
    "call_id", "call_datetime", "rep", "call_type", "lead_source", "seller",
    "outcome", "final_score", "total_score", "deal_risk", "conversion_probability",
  ];
  const rows = (data ?? []).map((r: any) => {
    const sc = (r.scorecards ?? []).find((s: any) => s.is_current);
    return [
      r.id,
      r.call_datetime,
      r.reps?.full_name ?? "",
      r.call_type,
      r.lead_source ?? "",
      r.seller_name ?? "",
      r.deal_outcome,
      sc?.final_score ?? sc?.average_score ?? "",
      sc?.total_score ?? "",
      sc?.deal_risk ?? "",
      sc?.conversion_probability ?? "",
    ];
  });

  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
