import { NextRequest, NextResponse } from "next/server";
import { htmlNoteToText, looksLikeTranscriptNote, noteToTranscript } from "@/lib/integrations/ghl-pull";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/ghl-transcript?contact_id=<id> — CRON_SECRET-protected.
 * Runs the PRODUCTION transcript-note detector over a contact's notes and
 * reports, per note, exactly which detection signal passed/failed — so a
 * mismatch with WAVV's real transcript format can be diagnosed directly.
 */
const API_BASE = "https://services.leadconnectorhq.com";
const CONTACTS_VERSION = "2021-07-28";

const NON_TRANSCRIPT_MARKERS =
  /-{3,}\s*Summary\s*-{3,}|Motivation \(Go Deep!\)|QC UNDERWRITING|Lead assignment processed|Owner assigned to/i;

function sanitize(s: string, n: number): string {
  return (s ?? "")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<tok>")
    .replace(/\s+/g, " ")
    .slice(0, n);
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.GHL_API_TOKEN;
  if (!token) return NextResponse.json({ error: "GHL_API_TOKEN not set" }, { status: 500 });
  const contactId = req.nextUrl.searchParams.get("contact_id");
  if (!contactId) return NextResponse.json({ error: "contact_id required" }, { status: 400 });

  const resp = await fetch(`${API_BASE}/contacts/${contactId}/notes`, {
    headers: { Authorization: `Bearer ${token}`, Version: CONTACTS_VERSION, Accept: "application/json" },
  });
  const data: any = await resp.json().catch(() => ({}));
  const notes: any[] = data?.notes ?? [];

  const analyzed = notes.map((n: any) => {
    const raw = String(n.body ?? "");
    const text = htmlNoteToText(raw);
    // Re-derive each detection signal for visibility.
    const labelCounts = new Map<string, number>();
    const labelRe = /(?:^|\n)\s*([A-Za-z][A-Za-z0-9 .'-]{0,24}):\s+\S/g;
    let m: RegExpExecArray | null;
    while ((m = labelRe.exec(text)) !== null) {
      const label = m[1].trim().toLowerCase();
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    const maxRepeat = Math.max(0, ...labelCounts.values());
    const topLabels = [...labelCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const timestamps = (text.match(/\[?\b\d{1,2}:\d{2}(?::\d{2})?\b\]?/g) ?? []).length;
    const tn = noteToTranscript(contactId, n);
    return {
      dateAdded: n.dateAdded,
      rawLen: raw.length,
      textLen: text.length,
      wordCount: text.split(/\s+/).length,
      isWavvMarker: /\[\s*WAVV:/i.test(raw),
      durationSec: (() => { const d = raw.match(/Duration:\s*(\d+)\s*seconds/i); return d ? Number(d[1]) : null; })(),
      rejectedByMarker: NON_TRANSCRIPT_MARKERS.test(text),
      maxLabelRepeat: maxRepeat,
      topLabels,
      timestampCount: timestamps,
      passesDetector: looksLikeTranscriptNote(text),
      noteToTranscriptResult: tn ? { wordCount: tn.wordCount, wavvUuid: !!tn.wavvUuid } : null,
      head: sanitize(text, 220),
      tail: sanitize(text.slice(-400), 160),
    };
  });

  return NextResponse.json({ contactId, notesCount: notes.length, analyzed });
}
