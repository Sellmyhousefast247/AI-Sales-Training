import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { pullGoHighLevelCalls } from "@/lib/integrations/ghl-pull";
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

  const { data: integrations } = await admin
    .from("integrations")
    .select("id, company_id, provider, webhook_token, config_json, is_active")
    .eq("provider", "gohighlevel")
    .eq("is_active", true);

  const results = [];
  for (const row of (integrations ?? []) as IntegrationRow[]) {
    try {
      const summary = await pullGoHighLevelCalls(admin, row);
      results.push({ integration_id: row.id, ...summary });
    } catch (err: any) {
      results.push({ integration_id: row.id, ok: false, error: err?.message?.slice(0, 300) });
    }
  }

  return NextResponse.json({ integrations: results.length, results });
}
