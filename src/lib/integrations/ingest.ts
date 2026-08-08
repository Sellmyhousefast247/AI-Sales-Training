import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntegrationRow, NormalizedInboundCall } from "./types";
import { transcribeRecordingBuffer, transcriptionConfigured } from "@/lib/transcription/deepgram";
import { runScoringForCall } from "@/lib/scoring/run-scoring";

export interface IngestOutcome {
  externalId: string;
  status: "created" | "duplicate" | "skipped" | "failed";
  callId?: string;
  detail?: string;
}

const DEFAULT_MIN_DURATION_SEC = 30;

/** Resolve which rep a normalized call belongs to. */
export async function resolveRep(
  admin: SupabaseClient,
  integration: IntegrationRow,
  hints: string[]
): Promise<string | null> {
  const companyId = integration.company_id;
  const cleaned = hints.map((h) => h.trim()).filter(Boolean);

  if (cleaned.length > 0) {
    // 1) explicit alias mapping
    const { data: aliases } = await admin
      .from("rep_aliases")
      .select("alias, rep_id")
      .eq("company_id", companyId)
      .eq("provider", integration.provider)
      .in("alias", cleaned);
    if (aliases && aliases.length > 0) return aliases[0].rep_id;

    // 2) match hint against the rep's linked user email
    const emails = cleaned.filter((h) => h.includes("@")).map((e) => e.toLowerCase());
    if (emails.length > 0) {
      const { data: reps } = await admin
        .from("reps")
        .select("id, users:user_id (email)")
        .eq("company_id", companyId)
        .eq("is_active", true);
      const match = (reps ?? []).find((r: any) => {
        const email = (r.users?.email ?? "").toLowerCase();
        return email && emails.includes(email);
      });
      if (match) return match.id;
    }
  }

  // 3) integration default
  return integration.config_json?.default_rep_id ?? null;
}

/**
 * Ingest one normalized call: dedup → resolve rep → insert call (+transcript)
 * Returns quickly; transcription + scoring are done by processCallMedia which
 * the webhook route runs via `after()` (and the jobs endpoint retries).
 */
export async function ingestNormalizedCall(
  admin: SupabaseClient,
  integration: IntegrationRow,
  norm: NormalizedInboundCall
): Promise<IngestOutcome> {
  const cfg = integration.config_json ?? {};
  const minDuration = cfg.min_duration_sec ?? DEFAULT_MIN_DURATION_SEC;

  if (norm.durationSec != null && norm.durationSec < minDuration) {
    return { externalId: norm.externalId, status: "skipped", detail: `Duration ${norm.durationSec}s < min ${minDuration}s` };
  }
  if (!norm.transcript && !norm.recordingUrl) {
    return { externalId: norm.externalId, status: "skipped", detail: "No transcript or recording URL on payload" };
  }

  // Dedup on (company, imported_from, external_id) — unique index also guards this.
  const { data: existing } = await admin
    .from("calls")
    .select("id")
    .eq("company_id", integration.company_id)
    .eq("imported_from", integration.provider)
    .eq("external_id", norm.externalId)
    .maybeSingle();
  if (existing) {
    return { externalId: norm.externalId, status: "duplicate", callId: existing.id };
  }

  const repId = await resolveRep(admin, integration, norm.repHints);
  if (!repId) {
    return {
      externalId: norm.externalId,
      status: "failed",
      detail: "No matching rep and no default rep configured on the integration",
    };
  }

  const callType =
    (cfg.default_call_type as string | undefined) ??
    (norm.direction === "inbound" ? "inbound" : "outbound");

  const { data: call, error: callErr } = await admin
    .from("calls")
    .insert({
      company_id: integration.company_id,
      rep_id: repId,
      call_datetime: norm.callDatetime ?? new Date().toISOString(),
      call_type: callType,
      lead_source: norm.leadSource ?? cfg.default_lead_source ?? null,
      seller_name: norm.sellerName ?? null,
      seller_phone: norm.sellerPhone ?? null,
      property_address: norm.propertyAddress ?? null,
      recording_path: norm.recordingUrl ?? null,
      recording_duration_sec: norm.durationSec ?? null,
      imported_from: integration.provider,
      external_id: norm.externalId,
      transcript_status: norm.transcript ? "ready" : "pending",
      scoring_status: "pending",
    })
    .select("id")
    .single();

  if (callErr || !call) {
    // Unique-violation race → duplicate
    if (callErr?.code === "23505") {
      return { externalId: norm.externalId, status: "duplicate" };
    }
    return { externalId: norm.externalId, status: "failed", detail: callErr?.message ?? "insert failed" };
  }

  if (norm.transcript) {
    const wordCount = norm.transcript.trim().split(/\s+/).length;
    await admin.from("transcripts").insert({
      call_id: call.id,
      company_id: integration.company_id,
      content: norm.transcript,
      word_count: wordCount,
      source: "provider",
    });
  }

  return { externalId: norm.externalId, status: "created", callId: call.id };
}

/**
 * Post-ingest processing: transcribe the recording if needed, then auto-score.
 * Idempotent — safe to re-run on stuck calls.
 */
export async function processCallMedia(
  admin: SupabaseClient,
  callId: string,
  opts: { autoScore?: boolean } = {}
): Promise<{ transcribed: boolean; scored: boolean; error?: string }> {
  const autoScore = opts.autoScore ?? true;

  const { data: call } = await admin
    .from("calls")
    .select("id, company_id, call_type, recording_path, transcript_status, scoring_status")
    .eq("id", callId)
    .single();
  if (!call) return { transcribed: false, scored: false, error: "call not found" };

  let transcribed = false;

  const { data: existingTranscript } = await admin
    .from("transcripts")
    .select("id")
    .eq("call_id", callId)
    .maybeSingle();

  if (!existingTranscript) {
    if (!call.recording_path) {
      return { transcribed: false, scored: false, error: "no transcript and no recording" };
    }
    if (!transcriptionConfigured()) {
      await admin.from("calls").update({ transcript_status: "pending" }).eq("id", callId);
      return { transcribed: false, scored: false, error: "DEEPGRAM_API_KEY not configured" };
    }

    await admin.from("calls").update({ transcript_status: "transcribing" }).eq("id", callId);
    try {
      // Download the audio ourselves and send raw bytes — some hosts (WAVV)
      // serve chunked responses without Content-Length, which Deepgram's
      // URL fetcher rejects with a 411.
      const resp = await fetch(call.recording_path);
      if (!resp.ok) throw new Error(`recording fetch failed: ${resp.status}`);
      const bytes = await resp.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("recording is empty");
      const t = await transcribeRecordingBuffer(
        bytes,
        resp.headers.get("content-type") ?? "audio/mpeg"
      );
      const wordCount = t.formatted.trim().split(/\s+/).length;
      await admin.from("transcripts").insert({
        call_id: callId,
        company_id: call.company_id,
        content: t.formatted,
        speakers: t.speakers,
        word_count: wordCount,
        source: "deepgram",
      });
      const updates: Record<string, unknown> = { transcript_status: "ready" };
      if (t.durationSec != null) updates.recording_duration_sec = t.durationSec;
      await admin.from("calls").update(updates).eq("id", callId);
      transcribed = true;
    } catch (err: any) {
      await admin.from("calls").update({ transcript_status: "failed" }).eq("id", callId);
      return { transcribed: false, scored: false, error: err?.message ?? "transcription failed" };
    }
  }

  if (!autoScore) return { transcribed, scored: false };

  const result = await runScoringForCall(admin, callId, { actorUserId: null });
  if (!result.ok) return { transcribed, scored: false, error: result.message };
  return { transcribed, scored: true };
}
