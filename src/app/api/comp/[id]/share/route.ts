import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getCurrentProfile } from "@/lib/queries";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isManager(role: string | null | undefined): boolean {
  return ["manager", "company_admin", "super_admin"].includes(role ?? "");
}

/**
 * Generate (or reuse) a public share token for the analysis. Returns
 * the token + a fully-qualified share URL the caller can copy.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!isManager(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const supabase = await createSupabaseServerClient();

  // If a token already exists, reuse it so the URL stays stable.
  const { data: existing } = await supabase
    .from("deal_analyses")
    .select("share_token")
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .maybeSingle();
  if (!existing) {
    return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  }

  let token: string | null = existing.share_token ?? null;
  if (!token) {
    token = randomUUID();
    const { error } = await supabase
      .from("deal_analyses")
      .update({ share_token: token, shared_at: new Date().toISOString() })
      .eq("id", id)
      .eq("company_id", profile.company_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ token, share_path: `/share/comp/${token}` });
}

/**
 * Revoke the share link.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!isManager(profile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("deal_analyses")
    .update({ share_token: null, shared_at: null })
    .eq("id", id)
    .eq("company_id", profile.company_id)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
  return NextResponse.json({ revoked: true });
}
