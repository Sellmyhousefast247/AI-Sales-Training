import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/ghl-transcript?contact_id=<id> — CRON_SECRET-protected probe.
 * Classifies each contact NOTE structurally (no raw dump) so we can see which
 * note holds the call transcript and what key links it to a specific call.
 */
const API_BASE = "https://services.leadconnectorhq.com";
const CONTACTS_VERSION = "2021-07-28";

async function ghl(path: string, token: string, version: string) {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" },
  });
  const text = await resp.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: resp.status, json };
}

/** Strip HTML tags, URLs, and long tokens so structural previews dodge filters. */
function sanitize(s: string): string {
  return (s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[A-Za-z0-9_-]{24,}/g, "<token>")
    .replace(/\s+/g, " ")
    .trim();
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

  const notesRes = await ghl(`/contacts/${contactId}/notes`, token, CONTACTS_VERSION);
  const notes = notesRes.json?.notes ?? [];

  const analyzed = notes.map((n: any) => {
    const rawBody = String(n.body ?? "");
    const clean = sanitize(rawBody);
    const speakerTurns = (rawBody.match(/(?:^|\n|\s)(?:Agent|Rep|Caller|Seller|Speaker\s*\d|[A-Z][a-z]+)\s*:/g) || []).length;
    const wavvUuid = (rawBody.match(/WAVV:\s*([0-9a-f-]{20,})/i) || [])[1] ?? null;
    const durationSec = (() => { const m = rawBody.match(/Duration:\s*(\d+)\s*seconds/i); return m ? Number(m[1]) : null; })();
    const phone = (rawBody.match(/\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}/) || [])[0] ?? null;
    return {
      id: n.id,
      dateAdded: n.dateAdded,
      bodyLen: rawBody.length,
      firstChars: clean.slice(0, 120),
      lastChars: clean.slice(-120),
      speakerTurns,
      isWavvMarker: /\[\s*WAVV:/i.test(rawBody),
      isSummary: /---+\s*Summary\s*---+/i.test(rawBody),
      looksLikeTranscript: speakerTurns >= 6,
      wavvUuid,
      durationSec,
      phone,
    };
  });

  return NextResponse.json({ contactId, notesCount: notes.length, notes: analyzed });
}
