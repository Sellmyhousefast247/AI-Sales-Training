import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/ghl-transcript?contact_id=<id>[&location_id=<loc>]
 * CRON_SECRET-protected read-only probe.
 *
 * Investigates WHERE a call transcript now lives in GHL for a contact:
 *  (a) in the contact's NOTES (WAVV posting transcript text into a note), and/or
 *  (b) behind GHL's native transcription endpoint on a call message.
 * Reports both so the ingestion path can be wired to whichever is populated.
 * Names/bodies are truncated; nothing is mutated.
 */
const API_BASE = "https://services.leadconnectorhq.com";
const CONTACTS_VERSION = "2021-07-28";
const CONV_VERSION = "2021-04-15";

async function ghl(path: string, token: string, version: string) {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" },
  });
  const text = await resp.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* leave raw */ }
  return { status: resp.status, ok: resp.ok, json, raw: text.slice(0, 400) };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = process.env.GHL_API_TOKEN;
  if (!token) return NextResponse.json({ error: "GHL_API_TOKEN not set" }, { status: 500 });

  const contactId = req.nextUrl.searchParams.get("contact_id");
  const locationId = req.nextUrl.searchParams.get("location_id") ?? "47v58a5xVmpgOdpajnj7";
  if (!contactId) return NextResponse.json({ error: "contact_id required" }, { status: 400 });

  const out: any = { contactId, locationId };

  // (a) NOTES — do any carry transcript text?
  const notesRes = await ghl(`/contacts/${contactId}/notes`, token, CONTACTS_VERSION);
  const notes = notesRes.json?.notes ?? [];
  out.notes = {
    status: notesRes.status,
    count: notes.length,
    sample: notes.slice(0, 8).map((n: any) => ({
      id: n.id,
      dateAdded: n.dateAdded,
      bodyLen: (n.body ?? "").length,
      bodyPreview: (n.body ?? "").slice(0, 500),
    })),
  };

  // (b) CONVERSATION MESSAGES + native transcription endpoint
  const convRes = await ghl(
    `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}`,
    token,
    CONV_VERSION
  );
  const convs = convRes.json?.conversations ?? [];
  out.conversations = { status: convRes.status, count: convs.length, ids: convs.slice(0, 3).map((c: any) => c.id) };

  const transcriptions: any[] = [];
  const messagesDump: any[] = [];
  for (const conv of convs.slice(0, 2)) {
    const msgRes = await ghl(`/conversations/${conv.id}/messages?limit=50`, token, CONV_VERSION);
    const msgs = msgRes.json?.messages?.messages ?? msgRes.json?.messages ?? [];
    for (const m of msgs) {
      const isCall = String(m.type ?? "").includes("CALL") || String(m.messageType ?? "").includes("CALL") || m.type === 3 || m.callDuration != null || m.attachments?.some?.((a: string) => /\.mp3/i.test(a));
      messagesDump.push({ id: m.id, type: m.type, messageType: m.messageType, isCall, dateAdded: m.dateAdded, hasAttach: !!m.attachments?.length });
      if (isCall) {
        const tr = await ghl(`/conversations/locations/${locationId}/messages/${m.id}/transcription`, token, CONV_VERSION);
        transcriptions.push({
          messageId: m.id,
          status: tr.status,
          shape: Array.isArray(tr.json) ? "array" : typeof tr.json,
          keys: tr.json && !Array.isArray(tr.json) ? Object.keys(tr.json) : undefined,
          preview: JSON.stringify(tr.json ?? tr.raw).slice(0, 800),
        });
      }
    }
  }
  out.messages = { count: messagesDump.length, sample: messagesDump.slice(0, 20) };
  out.transcriptions = transcriptions.slice(0, 6);

  return NextResponse.json(out);
}
