import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/calls/[id] — permanently remove a call and everything attached
 * to it (scorecards, step scores, transcripts). ADMIN ONLY (company_admin /
 * super_admin): for junk or duplicate calls that would otherwise skew the
 * team's scoring stats. Managers and reps never see the control and are
 * rejected here regardless.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { message: "Not signed in" } }, { status: 401 });
  }
  if (profile.role !== "company_admin" && profile.role !== "super_admin") {
    return NextResponse.json({ error: { message: "Only an admin can delete calls" } }, { status: 403 });
  }

  // Ownership check through the RLS-scoped client before using admin.
  const userClient = await createSupabaseServerClient();
  const { data: call } = await userClient
    .from("calls")
    .select("id, company_id, seller_name")
    .eq("id", id)
    .single();
  if (!call) return NextResponse.json({ error: { message: "Call not found" } }, { status: 404 });
  if (call.company_id !== profile.company_id && profile.role !== "super_admin") {
    return NextResponse.json({ error: { message: "Cross-company access denied" } }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  // Children first: step_scores -> scorecards -> transcripts -> the call.
  const { data: scs } = await admin.from("scorecards").select("id").eq("call_id", id);
  const scIds = (scs ?? []).map((s: any) => s.id);
  if (scIds.length > 0) {
    await admin.from("step_scores").delete().in("scorecard_id", scIds);
  }
  await admin.from("scorecards").delete().eq("call_id", id);
  await admin.from("transcripts").delete().eq("call_id", id);
  const { error } = await admin.from("calls").delete().eq("id", id);
  if (error) return NextResponse.json({ error: { message: error.message } }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: id });
}
