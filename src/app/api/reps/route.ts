import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";

const Body = z.object({
  full_name: z.string().min(1),
  team_id: z.string().uuid().optional().nullable(),
  role_title: z.string().optional().nullable(),
  hire_date: z.string().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
});

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) return NextResponse.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reps")
    .select("id, full_name, role_title, current_tier, current_avg_score, is_active")
    .eq("company_id", profile.company_id)
    .order("full_name");

  if (error) return NextResponse.json({ error: { code: "internal", message: error.message } }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) return NextResponse.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });
  if (!["company_admin", "manager", "super_admin"].includes(profile.role)) {
    return NextResponse.json({ error: { code: "forbidden", message: "Manager+ required" } }, { status: 403 });
  }

  const body = Body.parse(await req.json());
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("reps")
    .insert({ ...body, company_id: profile.company_id })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: { code: "internal", message: error.message } }, { status: 500 });
  return NextResponse.json({ rep_id: data.id });
}
