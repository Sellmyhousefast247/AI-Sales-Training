# Dialer & CRM Integrations

Calls flow in automatically: **dialer webhook → call created → recording transcribed (Deepgram) → AI-scored → dashboards update**. No manual pasting.

## One-time setup

1. **Run migration** `supabase/migrations/0012_webhook_ingest.sql` (adds `rep_aliases`, `webhook_events`, and webhook tokens).
2. **Add `DEEPGRAM_API_KEY`** in Vercel → Settings → Environment Variables (sign up free at deepgram.com — generous free credits). Without it, calls that arrive with only a recording URL wait in `transcript_status: pending`; calls that arrive with a provider transcript still score fine.
3. In the app: **Settings → Dialer & CRM integrations** → pick a provider + a default rep → **Connect**. Copy the webhook URL it gives you (it contains your secret token).

## Rep matching

Each inbound call is assigned to a rep in this order:

1. **rep_aliases** table — maps a provider identity (user id, email, phone) to a rep. Insert rows via Supabase for precise mapping:
   `insert into rep_aliases (company_id, provider, alias, rep_id) values ('<company>', 'wavv', 'closer@yourco.com', '<rep>');`
2. **Email match** — if the payload carries the rep's email and a rep's linked user has that email.
3. **Default rep** — the fallback rep you chose on the integration.

If none match, the event is logged in `webhook_events` with status `failed` so nothing is silently lost.

## Provider setup

### GoHighLevel
1. Automation → Workflows → new workflow, trigger **Call Status** (filter: status = Completed).
2. Add action **Custom Webhook** (Webhook / "Send outbound webhook"), method POST, URL = your GoHighLevel webhook URL from Settings.
3. Include contact fields and the call recording URL in the payload (the default "all fields" payload works — the adapter reads nested `call.*` and flat variants).

### WAVV
Team Settings → Integrations / API → Webhooks → add your WAVV webhook URL for **call.completed** (and **recording.available** if separate). If WAVV lets you set a signing secret, save the same value on the integration via `POST /api/integrations` with `signing_secret`.

### smrtPhone
Settings → Integrations → Webhooks → new webhook on **Call Completed** → paste your smrtPhone webhook URL.

### Dialpad
Admin → Integrations → Webhooks (or via API) → subscribe to **call events**; the adapter ingests `state: "hangup"` events with `recording_url`.

### Aircall
Aircall Dashboard → Integrations → Webhooks → subscribe to **call.ended** → paste your Aircall webhook URL.

### Zapier / n8n / anything else (generic)
Create a `webhook` integration and POST JSON:

```json
{
  "external_id": "unique-call-id",
  "call_datetime": "2026-08-06T14:00:00Z",
  "direction": "outbound",
  "duration_sec": 431,
  "rep": "closer@yourco.com",
  "seller_name": "Debra Jones",
  "seller_phone": "+18305551234",
  "property_address": "301 Main St, San Antonio TX",
  "lead_source": "ppc",
  "recording_url": "https://…/call.mp3",
  "transcript": "REP: …\nSELLER: …"
}
```

Send either `transcript` (scored immediately) or `recording_url` (transcribed first). Batch by sending `{ "calls": [ … ] }`.

## Behavior details

- **Dedup**: `(company, provider, external_id)` — a provider re-sending the same event never creates duplicates.
- **Short calls skipped**: under 30s by default (`min_duration_sec` in the integration config).
- **Auto-score**: on by default; set `auto_score: false` on the integration to only ingest+transcribe.
- **Retries**: transcription/scoring failures can be retried by calling `POST /api/jobs/process` with `Authorization: Bearer $CRON_SECRET`.
- **Audit trail**: every webhook hit is recorded in `webhook_events` with payload, status, and error.
- **Security**: the webhook URL contains a per-company secret token; rotate it any time via `POST /api/integrations` with `rotate_token: true`. Providers that support HMAC signing can additionally set `signing_secret`.
