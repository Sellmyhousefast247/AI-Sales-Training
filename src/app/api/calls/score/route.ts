import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { runScoringForCall } from "@/lib/scoring/run-scoring";

export const maxDuration = 300;

const Body = z.object({
  call_id: z.string().uuid(),
  force: z.boolean().optional().default(false),
});

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation_failed", message: parsed.error.message } }, { status: 400 });
  }
  const { call_id, force } = parsed.data;

  // RLS-scoped ownership check before switching to the admin pipeline.
  const userClient = await createSupabaseServerClient();
  const { data: call, error: callErr } = await userClient
    .from("calls")
    .select("id, company_id")
    .eq("id", call_id)
    .single();

  if (callErr || !call) {
    return NextResponse.json({ error: { code: "not_found", message: "Call not found" } }, { status: 404 });
  }
  if (call.company_id !== profile.company_id && profile.role !== "super_admin") {
    return NextResponse.json({ error: { code: "forbidden", message: "Cross-company access denied" } }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  const result = await runScoringForCall(admin, call_id, { force, actorUserId: profile.id });

  if (!result.ok) {
    const status =
      result.code === "not_found" ? 404 :
      result.code === "no_transcript" ? 400 :
      result.code === "scoring_failed" ? 502 : 500;
    const code = result.code === "no_transcript" ? "validation_failed" : result.code;
    return NextResponse.json({ error: { code, message: result.message } }, { status });
  }

  const { ok: _ok, ...payload } = result;
  return NextResponse.json(payload);
}
