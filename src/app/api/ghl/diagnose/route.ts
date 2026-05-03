import { NextResponse } from "next/server";
import { getGhlClient, type GhlMessage } from "@/lib/ghl/client";
import { getCurrentProfile } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TypeStats {
  count: number;
  with_recording_url: number;
  with_meta_call: number;
  sample: {
    id: string;
    type: string;
    direction?: string;
    dateAdded?: string;
    body_excerpt?: string;
    has_recording: boolean;
    has_meta_call: boolean;
    keys: string[]; // top-level keys on the message
    meta_keys?: string[]; // keys under .meta if present
  } | null;
}

/**
 * Diagnostic: scan recent GHL conversations and report a histogram of
 * message types so we can see what's actually in there. Helps when our
 * TYPE_CALL/recordingUrl filter returns 0 but the user knows calls exist.
 *
 * For each message type we encounter, capture one sample with its
 * top-level keys + a body excerpt so we can spot Wavv-specific shapes.
 */
export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const client = getGhlClient();
  if (!client) {
    return NextResponse.json({ ok: false, configured: false });
  }

  const url = new URL(req.url);
  const conversationLimit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50)
  );

  const convs = await client.listConversations({ limit: conversationLimit });
  if (!convs.ok) {
    return NextResponse.json({
      ok: false,
      stage: "list_conversations",
      status: convs.status,
      error: convs.error,
    });
  }

  const stats = new Map<string, TypeStats>();
  let messages_scanned = 0;

  for (const conv of convs.conversations) {
    const msgs = await client.listMessages(conv.id, { limit: 50 });
    if (!msgs.ok) continue;
    for (const m of msgs.messages) {
      messages_scanned++;
      const type = m.type ?? "(no type)";
      let s = stats.get(type);
      if (!s) {
        s = {
          count: 0,
          with_recording_url: 0,
          with_meta_call: 0,
          sample: null,
        };
        stats.set(type, s);
      }
      s.count++;
      const hasRecording = !!(m as any).meta?.call?.recordingUrl;
      const hasMetaCall = !!(m as any).meta?.call;
      if (hasRecording) s.with_recording_url++;
      if (hasMetaCall) s.with_meta_call++;

      if (!s.sample) {
        s.sample = {
          id: m.id,
          type,
          direction: m.direction,
          dateAdded: m.dateAdded,
          body_excerpt: m.body
            ? String(m.body).slice(0, 200)
            : undefined,
          has_recording: hasRecording,
          has_meta_call: hasMetaCall,
          keys: Object.keys(m as object),
          meta_keys: (m as any).meta
            ? Object.keys((m as any).meta as object)
            : undefined,
        };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    conversations_scanned: convs.conversations.length,
    messages_scanned,
    types: Array.from(stats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .map(([type, s]) => ({ type, ...s })),
  });
}
