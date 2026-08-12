import { NextRequest, NextResponse, after } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/queries";
import { transcribeRecordingBuffer, transcriptionConfigured } from "@/lib/transcription/deepgram";
import { runScoringForCall } from "@/lib/scoring/run-scoring";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * POST /api/calls/upload-recording  (multipart/form-data)
 *   file:    the recording audio (mp3/wav/m4a) — e.g. downloaded from WAVV
 *   call_id: the existing call to attach it to (from the import page)
 *
 * Recovery path for WAVV calls created "awaiting audio": the recording lives
 * behind WAVV's authenticated widget (no server-reachable URL), so the user
 * downloads it from the dialer and drops it here.
 *
 * Transcription and scoring are DECOUPLED: a long call (e.g. 30-40 min) can take
 * a large chunk of the 300s function budget, and then scoring the long transcript
 * would blow past the limit — the whole request would time out and the upload
 * would appear to "fail" even though the audio was fine. So we transcribe
 * synchronously (Deepgram is much faster than real time) and return as soon as the
 * transcript is saved, then run scoring in the background via `after()`. The client
 * polls for the score to land. Scoring is idempotent, so if the background pass is
 * interrupted the call can be re-scored without re-uploading.
 */
export async function POST(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: { message: "Not signed in" } }, { status: 401 });
  }
  if (!transcriptionConfigured()) {
    return NextResponse.json({ error: { message: "DEEPGRAM_API_KEY not configured" } }, { status: 500 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const callId = form?.get("call_id");
  if (!(file instanceof File) || typeof callId !== "string") {
    return NextResponse.json({ error: { message: "file and call_id are required" } }, { status: 400 });
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
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error("uploaded file is empty");
    const contentType = file.type || "audio/mpeg";

    await admin.from("calls").update({ transcript_status: "transcribing" }).eq("id", callId);
    const t = await transcribeRecordingBuffer(bytes, contentType);
    const wordCount = t.formatted.trim().split(/\s+/).length;

    // Replace any prior transcript for this call, then mark ready.
    await admin.from("transcripts").delete().eq("call_id", callId);
    await admin.from("transcripts").insert({
      call_id: callId,
      company_id: call.company_id,
      content: t.formatted,
      speakers: t.speakers,
      word_count: wordCount,
      source: "deepgram",
    });
    const updates: Record<string, unknown> = {
      transcript_status: "ready",
      // Mark scoring in-flight so the UI shows "Scoring in progress" immediately.
      scoring_status: "scoring",
    };
    if (t.durationSec != null) updates.recording_duration_sec = t.durationSec;
    await admin.from("calls").update(updates).eq("id", callId);
  } catch (err: any) {
    await admin.from("calls").update({ transcript_status: "failed" }).eq("id", callId);
    return NextResponse.json({ error: { message: err?.message ?? "transcription failed" } }, { status: 502 });
  }

  // Score in the background so a long transcript gets a fresh time budget without
  // the upload request timing out. The client polls the calls list for the result.
  const actorUserId = profile.id;
  after(async () => {
    try {
      await runScoringForCall(admin, callId, { actorUserId });
    } catch {
      await admin.from("calls").update({ scoring_status: "failed" }).eq("id", callId);
    }
  });

  return NextResponse.json({ ok: true, call_id: callId, transcribed: true, scoring: "in_progress" });
}
