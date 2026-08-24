import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { runScoringForCall } from "@/lib/scoring/run-scoring";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/calls/paste-transcript  (JSON: { call_id, transcript })
 *
 * Manual recovery path when the audio itself can't be uploaded (corrupt file,
 * WAVV export that won't download, etc.): the user copies the transcript text
 * from wherever they can see it and pastes it here. We attach it to the call
 * and score it — no Deepgram involved.
 *
 * Mirrors upload-recording's decoupling: the transcript is saved synchronously
 * and scoring runs in the background via after(), so a long transcript never
 * times out the request. The client polls until the scorecard lands.
 */
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { message: "Not signed in" } }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const callId = body?.call_id;
  const raw = body?.transcript;
  if (typeof callId !== "string" || typeof raw !== "string") {
    return NextResponse.json({ error: { message: "call_id and transcript are required" } }, { status: 400 });
  }

  // Light normalization only — keep the speaker labels/timestamps the user pasted.
  const transcript = raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  const wordCount = transcript ? transcript.split(/\s+/).length : 0;
  if (wordCount < 100) {
    return NextResponse.json(
      { error: { message: `Transcript looks too short to score (${wordCount} words). Paste the full call transcript.` } },
      { status: 400 }
    );
  }
  if (transcript.length > 1_500_000) {
    return NextResponse.json({ error: { message: "Transcript is too large" } }, { status: 400 });
  }

  // Ownership check via RLS-scoped client before switching to admin.
  const userClient = await createSupabaseServerClient();
  const { data: call, error: callErr } = await userClient
    .from("calls")
    .select("id, company_id")
    .eq("id", callId)
    .single();
  if (callErr || !call) {
    return NextResponse.json({ error: { message: "Call not found" } }, { status: 404 });
  }
  if (call.company_id !== profile.company_id && profile.role !== "super_admin") {
    return NextResponse.json({ error: { message: "Cross-company access denied" } }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  try {
    // Replace any prior transcript for this call, then mark ready + scoring.
    await admin.from("transcripts").delete().eq("call_id", callId);
    await admin.from("transcripts").insert({
      call_id: callId,
      company_id: call.company_id,
      content: transcript,
      word_count: wordCount,
      source: "manual",
    });
    await admin
      .from("calls")
      .update({ transcript_status: "ready", scoring_status: "scoring" })
      .eq("id", callId);
  } catch (err: any) {
    return NextResponse.json(
      { error: { message: err?.message ?? "failed to save transcript" } },
      { status: 502 }
    );
  }

  const actorUserId = profile.id;
  after(async () => {
    try {
      await runScoringForCall(admin, callId, { actorUserId });
    } catch {
      await admin.from("calls").update({ scoring_status: "failed" }).eq("id", callId);
    }
  });

  return NextResponse.json({ ok: true, call_id: callId, word_count: wordCount, scoring: "in_progress" });
}
