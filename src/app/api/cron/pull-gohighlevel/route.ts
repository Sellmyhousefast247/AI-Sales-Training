import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { pullGoHighLevelCalls } from "@/lib/integrations/ghl-pull";
import { processCallMedia } from "@/lib/integrations/ingest";
import type { IntegrationRow } from "@/lib/integrations/types";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * GET|POST /api/cron/pull-gohighlevel — poll GHL/XLeads for new dialer calls
 * (WAVV power-dialer calls never fire GHL workflow triggers, so the push
 * webhook misses them). Transcribes + scores whatever it finds.
 *
 * Protected by CRON_SECRET. Scheduled externally (Supabase pg_cron) because
 * Vercel Hobby crons are daily-only.
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

  const admin = createSupabaseAdminClient();

  // ?lookback_hours=N runs a deep sweep over the last N hours (nightly
  // safety net for calls WAVV synced into GHL late with backdated times).
  const lookbackRaw = Number(req.nextUrl.searchParams.get("lookback_hours"));
  const lookbackHours =
    Number.isFinite(lookbackRaw) && lookbackRaw > 0 ? Math.min(lookbackRaw, 168) : null;
  // ?contact_id=X processes just that contact's WAVV call notes (targeted
  // catch-up for a specific seller without waiting on the backlog queue).
  const contactId = req.nextUrl.searchParams.get("contact_id");

  const { data: integrations } = await admin
    .from("integrations")
    .select("id, company_id, provider, webhook_token, config_json, is_active")
    .eq("provider", "gohighlevel")
    .eq("is_active", true);

  const started = Date.now();
  const results = [];
  for (const row of (integrations ?? []) as IntegrationRow[]) {
    try {
      const summary = await pullGoHighLevelCalls(admin, row, {}, { lookbackHours, contactId });
      results.push({ integration_id: row.id, ...summary });
    } catch (err: any) {
      results.push({ integration_id: row.id, ok: false, error: err?.message?.slice(0, 300) });
    }
  }

  // Piggyback stuck-call retries on the cron (e.g. calls created "awaiting
  // WAVV audio" transcribe + score here once the WAVV API works). One call
  // per run, and only when the pull left enough of the 300s window.
  const retries = [];
  if (Date.now() - started < 120_000) {
    // Priority 1: transcript is READY but scoring never completed. A run killed
    // at the 300s cap mid-scoring used to strand calls as "scoring" forever —
    // nothing retried them (Sep 1: two note-transcribed calls sat unscored all
    // afternoon). Includes "scoring": a genuinely in-flight scorer overlaps at
    // most once and re-scoring is idempotent.
    let { data: stuck } = await admin
      .from("calls")
      .select("id")
      .eq("transcript_status", "ready")
      .in("scoring_status", ["pending", "failed", "scoring"])
      .order("created_at", { ascending: true })
      .limit(1);
    // Priority 2: audio not yet transcribed (e.g. "awaiting WAVV audio").
    // Only when nothing needs scoring — this arm mostly fails while the WAVV
    // key is dead, and it must never starve the scoring rescue above.
    if (!stuck || stuck.length === 0) {
      stuck = (
        await admin
          .from("calls")
          .select("id")
          .in("transcript_status", ["pending", "failed"])
          .not("recording_path", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
      ).data;
    }
    for (const c of stuck ?? []) {
      try {
        retries.push({ call_id: c.id, ...(await processCallMedia(admin, c.id)) });
      } catch (err: any) {
        retries.push({ call_id: c.id, error: err?.message?.slice(0, 200) });
      }
    }
  }

  return NextResponse.json({ integrations: results.length, results, retries });
}
