import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/webhook-events[?limit=20] — CRON_SECRET-protected, read-only.
 *
 * Structural view of recent inbound webhook payloads so we can see exactly
 * what the GHL workflow sends — in particular whether a transcript field is
 * present, resolved, or still an unresolved "{{...}}" merge tag. No raw
 * payload bodies are returned, only shapes/lengths/flags.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 20), 50);

  const admin = createSupabaseAdminClient();
  const { data: events, error } = await admin
    .from("webhook_events")
    .select("id, provider, status, error, call_id, created_at, payload_json")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const analyzed = (events ?? []).map((e: any) => {
    const p = e.payload_json ?? {};
    const custom = p.customData ?? p.custom_data ?? null;
    const findTranscript = (obj: any): { where: string; state: string; len: number } | null => {
      if (!obj || typeof obj !== "object") return null;
      for (const key of ["transcript", "call_transcript", "callTranscript"]) {
        for (const [where, o] of [["root", obj], ["customData", custom]] as const) {
          const v = o?.[key];
          if (v != null && String(v).trim() !== "") {
            const s = String(v);
            return { where: `${where}.${key}`, state: s.includes("{{") ? "UNRESOLVED_MERGE_TAG" : "RESOLVED_TEXT", len: s.length };
          }
        }
      }
      return null;
    };
    return {
      created_at: e.created_at,
      provider: e.provider,
      status: e.status,
      error: e.error,
      call_id: e.call_id,
      topLevelKeys: Object.keys(p).slice(0, 25),
      customDataKeys: custom ? Object.keys(custom).slice(0, 25) : null,
      transcript: findTranscript(p),
      hasRecordingUrl: !!(p.customData?.recording_url ?? p.call?.recordingUrl ?? p.recordingUrl ?? p.recording_url),
      contactName: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || null,
      callDuration: p.call?.duration ?? p.call_duration ?? p.duration ?? null,
    };
  });

  return NextResponse.json({ count: analyzed.length, events: analyzed });
}
