import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/**
 * GET /api/debug/ghl-transcript?contact_id=<id> — CRON_SECRET-protected probe.
 * Dumps the CALL message object(s) for a contact's conversation so we can find
 * which field holds the transcript the UI shows on the call.
 */
const API_BASE = "https://services.leadconnectorhq.com";
const CONV_VERSION = "2021-04-15";

async function ghl(path: string, token: string, version: string) {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Version: version, Accept: "application/json" },
  });
  const text = await resp.text().catch(() => "");
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: resp.status, json, raw: text };
}

function sanitize(s: string): string {
  return (s ?? "")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[A-Za-z0-9_-]{28,}/g, "<token>");
}

/** Describe a value structurally: type, length, and a sanitized preview. */
function describe(v: any): any {
  if (v == null) return v;
  if (typeof v === "string") return { t: "string", len: v.length, preview: sanitize(v).slice(0, 400) };
  if (Array.isArray(v)) return { t: "array", len: v.length, sample: v.slice(0, 2).map(describe) };
  if (typeof v === "object") {
    const o: any = {};
    for (const k of Object.keys(v)) o[k] = describe(v[k]);
    return o;
  }
  return v;
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

  const convRes = await ghl(
    `/conversations/search?locationId=${encodeURIComponent(locationId)}&contactId=${encodeURIComponent(contactId)}`,
    token, CONV_VERSION
  );
  const convs = convRes.json?.conversations ?? [];
  const out: any = { contactId, convCount: convs.length, calls: [] };

  for (const conv of convs.slice(0, 1)) {
    const msgRes = await ghl(`/conversations/${conv.id}/messages?limit=100`, token, CONV_VERSION);
    const msgs = msgRes.json?.messages?.messages ?? msgRes.json?.messages ?? [];
    const callMsgs = msgs.filter((m: any) => m.type === 1 || String(m.messageType || "").includes("CALL"));
    for (const m of callMsgs.slice(0, 3)) {
      const entry: any = { messageId: m.id, messageType: m.messageType, structure: describe(m) };
      // Try GHL native transcription across a couple of versions.
      entry.transcriptionEndpoint = {};
      for (const ver of ["2021-04-15", "2021-07-28"]) {
        const tr = await ghl(`/conversations/locations/${locationId}/messages/${m.id}/transcription`, token, ver);
        entry.transcriptionEndpoint[ver] = { status: tr.status, preview: sanitize(tr.raw).slice(0, 300) };
      }
      out.calls.push(entry);
    }
    if (callMsgs.length === 0) out.note = "no call-type messages in first conversation";
  }
  return NextResponse.json(out);
}
