import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

const Body = z.object({
  company_name: z.string().min(1),
  full_name: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required" } }, { status: 401 });

  const body = Body.parse(await req.json());
  const admin = createSupabaseAdminClient();

  // Check if user already has a company (idempotent)
  const { data: existing } = await admin.from("users").select("company_id").eq("id", user.id).maybeSingle();
  if (existing?.company_id) {
    return NextResponse.json({ company_id: existing.company_id, already: true });
  }

  // Create company
  const slugBase = body.company_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`;
  const { data: company, error: cErr } = await admin
    .from("companies")
    .insert({ name: body.company_name, slug, owner_user_id: user.id })
    .select("id")
    .single();
  if (cErr) return NextResponse.json({ error: { code: "internal", message: cErr.message } }, { status: 500 });

  // Create user profile linked to company
  const { error: uErr } = await admin.from("users").upsert({
    id: user.id,
    email: user.email!,
    full_name: body.full_name,
    company_id: company.id,
    role: "company_admin",
  });
  if (uErr) return NextResponse.json({ error: { code: "internal", message: uErr.message } }, { status: 500 });

  // Default settings
  await admin.from("company_settings").upsert({ company_id: company.id });

  // Default incentive rule (DEFAULT_RULES from lib/incentive)
  await admin.from("incentive_rules").insert({
    company_id: company.id,
    name: "Default",
    rules_json: {
      weekly_bonus: [
        { tier: 2, amount: 100, min_calls: 30 },
        { tier: 3, amount: 200, min_calls: 30 },
        { tier: 4, amount: 350, min_calls: 25 },
        { tier: 5, amount: 500, min_calls: 20 },
      ],
      monthly_bonus: [
        { tier: 4, amount: 1000 },
        { tier: 5, amount: 2500 },
      ],
      awards: {
        most_improved: 250,
        highest_avg: 250,
        most_contracts: 500,
        best_discovery: 100,
        best_closing: 100,
        coaching_completion: 100,
      },
    },
    effective_from: new Date().toISOString().slice(0, 10),
    created_by_user_id: user.id,
  });

  // First rep tied to the founding admin
  await admin.from("reps").insert({
    company_id: company.id,
    user_id: user.id,
    full_name: body.full_name,
    role_title: "Acquisitions Manager",
  });

  return NextResponse.json({ company_id: company.id });
}
