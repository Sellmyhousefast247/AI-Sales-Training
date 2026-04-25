import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";

const Body = z.object({
  rep_id: z.string().uuid(),
  call_datetime: z.string(),
  call_type: z.enum(["inbound", "outbound", "follow_up", "offer", "negotiation", "closing"]),
  lead_source: z.string().nullable().optional(),
  seller_name: z.string().nullable().optional(),
  seller_phone: z.string().nullable().optional(),
  property_address: z.string().nullable().optional(),
  recording_path: z.string().nullable().optional(),
  deal_outcome: z
    .enum(["contract", "appointment", "offer_made", "follow_up", "dead", "unknown"])
    .optional()
    .default("unknown"),
  next_step: z.string().nullable().optional(),
  transcript: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) return NextResponse.json({ error: { code: "unauthorized", message: "Not signed in" } }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "validation_failed", message: parsed.error.message } }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = await createSupabaseServerClient();

  // Verify the rep belongs to this company
  const { data: rep, error: repErr } = await supabase
    .from("reps")
    .select("id, company_id")
    .eq("id", body.rep_id)
    .single();
  if (repErr || !rep) return NextResponse.json({ error: { code: "not_found", message: "Rep not found" } }, { status: 404 });
  if (rep.company_id !== profile.company_id) {
    return NextResponse.json({ error: { code: "forbidden", message: "Rep belongs to another company" } }, { status: 403 });
  }

  const { data: call, error: callErr } = await supabase
    .from("calls")
    .insert({
      company_id: profile.company_id,
      rep_id: body.rep_id,
      call_datetime: body.call_datetime,
      call_type: body.call_type,
      lead_source: body.lead_source ?? null,
      seller_name: body.seller_name ?? null,
      seller_phone: body.seller_phone ?? null,
      property_address: body.property_address ?? null,
      recording_path: body.recording_path ?? null,
      deal_outcome: body.deal_outcome ?? "unknown",
      next_step: body.next_step ?? null,
      transcript_status: body.transcript ? "ready" : "pending",
      created_by_user_id: profile.id,
    })
    .select("id")
    .single();

  if (callErr) return NextResponse.json({ error: { code: "internal", message: callErr.message } }, { status: 500 });

  let transcript_id: string | null = null;
  if (body.transcript) {
    const wordCount = body.transcript.trim().split(/\s+/).length;
    const repWordShare = computeRepWordShare(body.transcript);
    const { data: t, error: tErr } = await supabase
      .from("transcripts")
      .insert({
        call_id: call.id,
        company_id: profile.company_id,
        content: body.transcript,
        word_count: wordCount,
        rep_word_share: repWordShare,
        source: "paste",
      })
      .select("id")
      .single();
    if (tErr) return NextResponse.json({ error: { code: "internal", message: tErr.message } }, { status: 500 });
    transcript_id = t.id;
  }

  return NextResponse.json({ call_id: call.id, transcript_id });
}

function computeRepWordShare(text: string): number | null {
  const lines = text.split(/\r?\n/);
  let repWords = 0;
  let sellerWords = 0;
  let any = false;
  for (const line of lines) {
    const m = line.match(/^\s*(rep|seller|agent|caller|investor|s|r)\s*:\s*(.*)$/i);
    if (!m) continue;
    any = true;
    const speaker = m[1].toLowerCase();
    const words = m[2].trim().split(/\s+/).filter(Boolean).length;
    if (speaker.startsWith("r") || speaker === "agent" || speaker === "investor") repWords += words;
    else sellerWords += words;
  }
  if (!any || repWords + sellerWords === 0) return null;
  return Number((repWords / (repWords + sellerWords)).toFixed(3));
}
