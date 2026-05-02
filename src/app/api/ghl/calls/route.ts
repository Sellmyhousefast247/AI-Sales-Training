import { NextResponse } from "next/server";
import { getGhlClient, type GhlContact, type GhlMessage } from "@/lib/ghl/client";
import { getCurrentProfile } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CallSummary {
  message_id: string;
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  date: string | null;
  direction: "inbound" | "outbound" | null;
  duration_seconds: number | null;
  status: string | null;
  recording_url: string | null;
  ghl_user_id: string | null;
}

/**
 * Lists recent calls with recordings from GHL. Walks the most-recent
 * conversations, fetches their messages, keeps the TYPE_CALL ones with
 * a recordingUrl, and joins on contact for human-readable labeling.
 *
 * No DB writes here — this is purely a "what's in GHL?" view. The
 * scoring pipeline (sync into our calls table + transcribe + score)
 * comes next.
 */
export async function GET(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile?.company_id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const client = getGhlClient();
  if (!client) {
    return NextResponse.json({
      ok: false,
      configured: false,
      hint: "Set GHL_PRIVATE_INTEGRATION_TOKEN and GHL_LOCATION_ID in Vercel env vars.",
    });
  }

  // ?limit=N caps how many conversations to scan. Default 25 keeps the
  // response under a few seconds for an interactive page.
  const url = new URL(req.url);
  const conversationLimit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "25", 10) || 25)
  );

  const convs = await client.listConversations({ limit: conversationLimit });
  if (!convs.ok) {
    return NextResponse.json({
      ok: false,
      configured: true,
      stage: "list_conversations",
      status: convs.status,
      error: convs.error,
    });
  }

  // Walk conversations, pull messages, keep call-with-recording ones.
  // Done sequentially to keep within rate limits — GHL throttles around
  // 100 req/10s per location. Twenty-five conversations is well under.
  const calls: CallSummary[] = [];
  const contactsCache = new Map<string, GhlContact | null>();
  let scanned = 0;

  for (const conv of convs.conversations) {
    scanned++;
    const msgs = await client.listMessages(conv.id, { limit: 50 });
    if (!msgs.ok) continue;
    for (const m of msgs.messages) {
      if (!isCallWithRecording(m)) continue;

      let contact = contactsCache.get(conv.contactId) ?? null;
      if (contact === null && !contactsCache.has(conv.contactId)) {
        const cr = await client.getContact(conv.contactId);
        contact = cr.ok ? cr.contact : null;
        contactsCache.set(conv.contactId, contact);
      }

      calls.push({
        message_id: m.id,
        conversation_id: conv.id,
        contact_id: conv.contactId,
        contact_name: contactDisplayName(contact),
        contact_phone: contact?.phone ?? null,
        date: m.dateAdded ?? null,
        direction: m.direction ?? null,
        duration_seconds: m.meta?.call?.duration ?? null,
        status: m.meta?.call?.status ?? null,
        recording_url: m.meta?.call?.recordingUrl ?? null,
        ghl_user_id: m.userId ?? null,
      });
    }
  }

  // Newest first
  calls.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return NextResponse.json({
    ok: true,
    configured: true,
    conversations_scanned: scanned,
    calls_found: calls.length,
    calls,
  });
}

function isCallWithRecording(m: GhlMessage): boolean {
  return m.type === "TYPE_CALL" && !!m.meta?.call?.recordingUrl;
}

function contactDisplayName(c: GhlContact | null): string | null {
  if (!c) return null;
  if (c.contactName) return c.contactName;
  const parts = [c.firstName, c.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : null;
}
