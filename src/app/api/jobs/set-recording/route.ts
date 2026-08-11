import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { processCallMedia } from "@/lib/integrations/ingest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const Body = z.object({
  call_id: z.string().uuid(),
  recording_url: z.string().url(),
  process: z.boolean().optional().default(true),
});

/**
 * GET /api/jobs/set-recording — list calls still awaiting audio
 * (recording_path "wavv:…" or transcript not ready), with the phone/time/uuid
 * needed to match them against captured recording URLs. Protected by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from("calls")
    .select("id, call_datetime, seller_name, seller_phone, recording_path, transcript_status, scoring_status, external_id, rep_id")
    .neq("transcript_status", "ready")
    .order("call_datetime", { ascending: false })
    .limit(50);
  return NextResponse.json({ pending: data ?? [] });
}

/**
 * POST /api/jobs/set-recording — attach a recording URL to an existing call
 * and (by default) immediately transcribe + score it.
 *
 * Recovery tool for WAVV calls created "awaiting audio" while the WAVV API
 * is unavailable: the dialer widget in the browser can still reach the
 * public MP3 URLs (file.wavv.com/recordings/…), so captured URLs are fed
 * back into the pipeline here. Protected by CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { call_id, recording_url, process: runNow } = parsed.data;

  const admin = createSupabaseAdminClient();
  const { data: call } = await admin
    .from("calls")
    .select("id, transcript_status")
    .eq("id", call_id)
    .single();
  if (!call) return NextResponse.json({ error: "call not found" }, { status: 404 });

  const { error } = await admin
    .from("calls")
    .update({ recording_path: recording_url, transcript_status: "pending" })
    .eq("id", call_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!runNow) return NextResponse.json({ ok: true, call_id, processed: false });

  const result = await processCallMedia(admin, call_id);
  return NextResponse.json({ ok: true, call_id, ...result });
}
