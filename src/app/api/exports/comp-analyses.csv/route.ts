import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";

export const runtime = "nodejs";

function isManager(role: string | null | undefined): boolean {
  return ["manager", "company_admin", "super_admin"].includes(role ?? "");
}

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Not signed in" } },
      { status: 401 }
    );
  }
  if (!isManager(profile.role)) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "Manager role required" } },
      { status: 403 }
    );
  }

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const repFilter = url.searchParams.get("rep");
  const teamFilter = url.searchParams.get("team");

  const supabase = await createSupabaseServerClient();

  // Resolve a team filter into a list of user ids on that team — same
  // approach the list page uses so the CSV mirrors what's on screen.
  let teamMemberIds: string[] | null = null;
  if (teamFilter) {
    const { data: members } = await supabase
      .from("users")
      .select("id")
      .eq("company_id", profile.company_id)
      .eq("team_id", teamFilter);
    teamMemberIds = (members ?? []).map((m: { id: string }) => m.id);
  }

  let q = supabase
    .from("deal_analyses")
    .select(
      `
      id, created_at,
      arv, arv_low, arv_high, as_is_value,
      repair_estimate, repair_level, buying_pct,
      wholesale_mao, novation_mao, market_adjusted_mao,
      confidence_score, comps_used, warnings,
      created_by,
      comp_subjects:subject_id (address, city, state, zip, beds, baths, sqft, year_built, property_type),
      users:created_by (full_name, email)
    `
    )
    .eq("company_id", profile.company_id)
    .order("created_at", { ascending: false });

  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to);
  if (repFilter) q = q.eq("created_by", repFilter);
  if (teamMemberIds) {
    if (teamMemberIds.length === 0) {
      q = q.eq("created_by", "00000000-0000-0000-0000-000000000000");
    } else {
      q = q.in("created_by", teamMemberIds);
    }
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: error.message } },
      { status: 500 }
    );
  }

  const headers = [
    "analysis_id",
    "created_at",
    "address",
    "city",
    "state",
    "zip",
    "beds",
    "baths",
    "sqft",
    "year_built",
    "property_type",
    "arv",
    "arv_low",
    "arv_high",
    "as_is_value",
    "repair_estimate",
    "repair_level",
    "buying_pct",
    "wholesale_mao",
    "novation_mao",
    "market_adjusted_mao",
    "confidence",
    "comps_used",
    "warnings_count",
    "created_by",
  ];

  const rows = (data ?? []).map((r: any) => {
    const subj = r.comp_subjects ?? {};
    const creator = r.users ?? {};
    const warningCount = Array.isArray(r.warnings) ? r.warnings.length : 0;
    return [
      r.id,
      r.created_at,
      subj.address ?? "",
      subj.city ?? "",
      subj.state ?? "",
      subj.zip ?? "",
      subj.beds ?? "",
      subj.baths ?? "",
      subj.sqft ?? "",
      subj.year_built ?? "",
      subj.property_type ?? "",
      r.arv,
      r.arv_low ?? "",
      r.arv_high ?? "",
      r.as_is_value,
      r.repair_estimate,
      r.repair_level,
      r.buying_pct,
      r.wholesale_mao,
      r.novation_mao,
      r.market_adjusted_mao,
      r.confidence_score,
      r.comps_used,
      warningCount,
      creator.full_name ?? creator.email ?? "",
    ];
  });

  const csv = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="deal-analyses-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
