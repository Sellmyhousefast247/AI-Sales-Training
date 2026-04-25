# API Specification

All endpoints are Next.js Route Handlers under `/api`. Server-side they use Supabase service role with explicit `company_id` checks; client-side use the browser Supabase client which respects RLS.

## Auth
Sessions handled by Supabase Auth. JWT carries `company_id` and `role` as custom claims via auth hook. Middleware enforces session for every `/app` route.

## Endpoints

### POST `/api/calls`
Create a call (without scoring yet — scoring is a separate trigger).
```ts
body: {
  rep_id: string
  call_datetime: string  // ISO
  call_type: 'inbound'|'outbound'|'follow_up'|'offer'|'negotiation'|'closing'
  lead_source?: string
  seller_name?: string
  seller_phone?: string
  property_address?: string
  transcript?: string    // if pasted
  recording_path?: string // if pre-uploaded to Storage
  deal_outcome?: 'contract'|'appointment'|'offer_made'|'follow_up'|'dead'|'unknown'
  next_step?: string
}
returns: { call_id: string, transcript_id?: string }
```

### POST `/api/calls/score`
Trigger AI scoring for an existing call. Idempotent — re-scoring marks previous scorecard `is_current=false`.
```ts
body: { call_id: string, force?: boolean }
returns: { scorecard_id: string, status: 'scored'|'failed' }
```

### GET `/api/calls?rep_id=&from=&to=&type=&source=&page=&limit=`
List calls with filters. Returns paginated rows with joined rep + scorecard summary.

### GET `/api/calls/[id]`
Full detail: call, transcript, current scorecard, category scores, discovery checks, coaching notes.

### POST `/api/calls/[id]/audio`
Upload audio. Returns Storage path + queues transcription.

### POST `/api/calls/[id]/override`
Manager overrides AI score.
```ts
body: {
  category: string
  score: number
  justification: string
}
```

### GET `/api/reps`
List reps for current company.

### POST `/api/reps`
Create rep.
```ts
body: { full_name, team_id?, role_title?, hire_date?, user_id? }
```

### GET `/api/reps/[id]`
Rep profile payload — header stats, last 30 days, trend series, top/bottom categories, tier history, recent calls.

### GET `/api/dashboard?from=&to=&team_id=`
All dashboard cards in one call.

### GET `/api/leaderboard?board=&from=&to=&team_id=&lead_source=&call_type=`
`board` ∈ best_avg | most_improved | best_discovery | best_closing | most_calls | most_contracts | most_appointments | best_conversion

### POST `/api/companies`
Super-admin only. Provision a new company.

### POST `/api/companies/[id]/invite`
Email an invite to a new user. Body: `{ email, role, full_name }`.

### GET `/api/exports/calls.csv?from=&to=`
Streams CSV.

### GET `/api/exports/scorecards.csv?from=&to=`

### GET `/api/exports/reps.csv`

### POST `/api/webhooks/[provider]`
Generic webhook receiver. `provider` ∈ gohighlevel | smrtphone | wavv | dialpad | aircall | webhook. Validates signature → normalizes payload → creates call → queues transcription/scoring.

### POST `/api/cron/tier-recompute` (Vercel Cron, daily 3am UTC)
Recalculates rolling-window tiers for all reps. Writes `tier_history` on changes.

### POST `/api/cron/weekly-reports` (Mondays 6am company-local)
Generates and sends weekly rep + company digests.

### POST `/api/cron/incentive-rollup` (1st of month, 4am UTC)
Materializes monthly incentive eligibility per rep.

## Errors
All endpoints return `{ error: { code, message, details? } }` with appropriate HTTP status. Codes: `unauthorized`, `forbidden`, `not_found`, `validation_failed`, `quota_exceeded`, `scoring_failed`, `internal`.

## Rate limits (Upstash sliding window)
- `/api/calls/score`: 60/hour/company on Starter, 300/hour on Growth, custom on Scale
- All others: 600/min/IP

## Idempotency
- `POST /api/calls`: idempotency-key header recommended for retried imports
- `POST /api/calls/score`: idempotent by `call_id` — won't double-score a call that already has `is_current` scorecard unless `force: true`
