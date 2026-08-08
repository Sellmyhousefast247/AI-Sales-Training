import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { processCallMedia } from "@/lib/integrations/ingest";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/process — retry stuck webhook-ingested calls:
 *  - transcript pending/failed with a recording → transcribe
 *  - transcript ready but scoring pending/failed → score
 * Protected by CRON_SECRET. Processes a small batch per invocation.
 */
export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const batchSize = Math.min(Number(req.nextUrl.searchParams.get("batch") ?? 5), 20);
  const admin = createSupabaseAdminClient();

  // Any call with a recording awaiting transcription, or a transcript
  // awaiting scoring — imported or manually created alike.
  const { data: stuck } = await admin
    .from("calls")
    .select("id, transcript_status, scoring_status")
    .or(
      "and(transcript_status.in.(pending,failed),recording_path.not.is.null),and(transcript_status.eq.ready,scoring_status.in.(pending,failed))"
    )
    .order("created_at", { ascending: true })
    .limit(batchSize);

  const results = [];
  for (const call of stuck ?? []) {
    try {
      const r = await processCallMedia(admin, call.id);
      results.push({ call_id: call.id, ...r });
    } catch (err: any) {
      results.push({ call_id: call.id, transcribed: false, scored: false, error: err?.message });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
