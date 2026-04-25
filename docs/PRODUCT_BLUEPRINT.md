# Acquisitions AI OS — Product Blueprint

## 1. Vision

A multi-tenant SaaS that turns every seller call into structured coaching. It ingests call transcripts (or recordings → transcripts), scores the acquisitions rep across 10 categories using a Claude-powered judge prompt, classifies the rep into a 5-tier skill ladder based on rolling averages, generates per-call and weekly coaching, calculates incentive eligibility, and surfaces team-level dashboards, leaderboards, and reports.

Internal tool first. Sellable SaaS second. Built so the same codebase serves both — every row carries a `company_id`, every API call is scoped, every UI is brandable.

## 2. Personas & jobs-to-be-done

| Persona | JTBD |
|---|---|
| **Super Admin** (platform owner) | Onboard companies, monitor platform health, set defaults, manage billing |
| **Company Admin / Owner** | "Tell me which reps are actually good on the phone, and pay them accordingly" |
| **Sales Manager** | "Show me what to coach this week, who's slipping, who's ready for promotion" |
| **Acquisitions Rep** | "Show me my last call's grade, what I missed, and how I move up a tier" |

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Next.js 15 App Router (Vercel)                             │
│  ─────────────────────────────────────────────              │
│  Marketing site │ Auth pages │ App pages │ API routes       │
└────────────┬───────────────────────────────┬────────────────┘
             │                               │
   ┌─────────▼──────────┐         ┌──────────▼──────────┐
   │ Supabase           │         │ External providers   │
   │ ─────────────      │         │ ────────────────     │
   │ • Postgres + RLS   │         │ • Anthropic (Claude) │
   │ • Auth (JWT)       │         │ • Deepgram (STT)     │
   │ • Storage (audio)  │         │ • Stripe (billing)   │
   │ • Edge Functions   │         │ • Resend (email)     │
   └────────────────────┘         └──────────────────────┘
             │
             │ webhooks / polling
   ┌─────────▼──────────────────────────────────────────┐
   │ Integration layer (V2)                              │
   │ GoHighLevel · WAVV · smrtPhone · Dialpad · Aircall │
   │ Zapier · n8n · Generic webhooks · CSV import       │
   └─────────────────────────────────────────────────────┘
```

**Multi-tenancy model**: shared schema, `company_id` on every tenant table, enforced by Supabase Row-Level Security (RLS). One Postgres database. Tenant isolation comes from policies, not separate DBs — easier to operate, cheaper, and battle-tested at SaaS scale.

## 4. Core features

### 4.1 Company dashboard
Cards: total calls reviewed (period), avg score, top rep, most-improved rep, weakest rep, contracts generated, appointments set, offer attempts, follow-up compliance %, tier distribution chart, coaching priorities (top 3 patterns), leaderboard widget.

Filters: date range, team, lead source, call type.

### 4.2 Rep profile
Header: name, role, team, current tier badge, avg score, calls reviewed.
Tabs:
- **Overview** — score trend chart, strongest/weakest categories, recent calls
- **Calls** — table of scored calls
- **Coaching** — auto-generated weekly plan, manager notes, library links
- **Tier history** — promotions/demotions timeline
- **Incentive** — current eligibility, history, what's needed for next bonus

### 4.3 Call upload / input
Three input modes:
1. **Paste transcript** (MVP day 1) — textarea + metadata form
2. **Upload audio** (MP3/M4A/WAV) → background transcription → scoring
3. **CSV bulk import** — for back-filling history
4. **Webhook ingest (V2)** — generic endpoint plus per-provider adapters
5. **Manual entry** — for in-person/whiteboard reviews

Per-call metadata: company_id, rep_id, datetime, seller name, lead source, call type (inbound, outbound, follow-up, offer, negotiation, closing), transcript, recording URL, deal outcome, next step.

### 4.4 AI scoring engine
**Model**: Claude Sonnet 4.6 (`claude-sonnet-4-6`) for full scoring. Haiku 4.5 (`claude-haiku-4-5-20251001`) for cheap rewrites and quick patterns.

**10 categories, 1–10 each**:
1. Opening & Tone
2. Rapport Building
3. Discovery
4. Question Quality
5. Call Control
6. Objection Handling
7. Value Positioning
8. Offer Delivery
9. Closing Ability
10. Conversion Likelihood

**Discovery sub-checks** (boolean each, surfaced separately): motivation, timeline, condition, price expectation, equity/mortgage, decision makers, urgency, pain points, preferred outcome.

**Output (strict JSON)**:
- per-category score + 1-sentence justification + supporting transcript quote
- total / 100 and average / 10
- tier impact (current vs projected)
- biggest mistake
- best moment
- missed opportunity
- "what they should have said" (verbatim coaching script)
- suggested follow-up SMS/email
- coaching notes (manager voice)
- rep-friendly feedback (encouraging voice)
- deal risk: low | medium | high
- conversion probability (0–100)
- recommended next action

Full prompt in [`AI_SCORING_PROMPT.md`](AI_SCORING_PROMPT.md). Output is validated against a Zod schema; on parse failure we retry once at temperature 0.

**Cost control**: prompt caching on the static system prompt + scorecard rules. Caps per-company monthly token budget configurable in `company_settings`.

### 4.5 Tier system
Five tiers, calculated from a rolling window:

| Tier | Avg score | Status |
|---|---|---|
| 1 — Trainee | 0.0–4.9 | Heavy coaching |
| 2 — Developing | 5.0–6.4 | Improving but inconsistent |
| 3 — Competent | 6.5–7.9 | Reliable rep |
| 4 — Advanced | 8.0–8.9 | High performer |
| 5 — Elite | 9.0–10.0 | Top closer / leadership |

Window options (per-company setting): **last 10 calls**, **last 30 days**, **all-time**. Default = last 10 calls (hot signal, dampens cold-streak noise). A rep needs ≥5 scored calls to leave Tier 1. Tier changes are written to `tier_history` with reason ("promoted from rolling avg 7.3 → 8.1").

### 4.6 Incentive engine
Per-company configurable rules. Default schema:

| Tier | Bonus eligibility |
|---|---|
| 1 | None — required coaching only |
| 2 | Small fixed weekly bonus on hitting activity floor |
| 3 | Standard commission % |
| 4 | Higher commission + weekly performance bonus |
| 5 | Highest commission + monthly bonus + leadership track |

Tracked separately from tier (because some bonuses are based on activity, not tier):
- Weekly bonus eligibility
- Monthly bonus eligibility
- Most-improved-rep award (largest avg-score delta over period)
- Highest avg score
- Most contracts
- Best discovery score
- Best closing score
- Coaching completion (assigned items checked off)

### 4.7 Coaching engine
Three layers:

1. **Per-call** — generated alongside the scorecard
2. **Weekly rep plan** — aggregates patterns from the week's calls, picks top 3 focus areas, links to scripts/objection handlers
3. **Manager summary** — weekly digest across all reps with coaching priorities

**Pattern detectors** (run as a second-pass prompt on the week's scorecards):
- Doesn't ask enough open-ended questions
- Skips timeline question
- Avoids talking about price
- Doesn't ask for the close
- Talks too much (rep word share > 60%)
- Lets seller control the call
- Fumbles "I need to think about it"
- Doesn't set a next step

Detected patterns push into `coaching_notes` and feed the weekly plan.

### 4.8 Leaderboard
Boards:
- Best overall avg
- Most improved (delta vs prior period)
- Best discovery
- Best closing
- Most calls reviewed
- Most contracts closed
- Most appointments set
- Best conversion-likelihood score

Filters: company, team, date range, lead source, call type. Each row links to the rep profile.

### 4.9 Reports
Generated by scheduled jobs (Supabase cron / Vercel cron):
- **Daily manager report** — yesterday's calls, scores, flagged calls, action items
- **Weekly rep report** — sent Monday, covers prior week
- **Weekly company report** — sent Monday to admins
- **Monthly incentive report** — eligibility + payout calculation
- **Rep improvement report** — quarterly trend per rep

All reports are HTML email + PDF download + CSV export.

### 4.10 Multi-tenant SaaS structure
- One Supabase project for the platform
- `companies` is the tenant root
- Every tenant table has `company_id uuid not null`
- RLS policies: `using (company_id = (auth.jwt() ->> 'company_id')::uuid)`
- Users belong to one company via `users.company_id`. Super admins bypass RLS via service role
- Roles: `super_admin`, `company_admin`, `manager`, `rep`
- Custom claims set on JWT at login via Supabase Auth Hook (Edge Function)

### 4.11 Integrations (V2+)
Adapter pattern. Each provider implements:
```ts
interface CallProviderAdapter {
  name: string
  parseWebhook(req): NormalizedCallEvent
  fetchRecording(callId): Promise<AudioBlob>
  pollNew?(since: Date): Promise<NormalizedCallEvent[]>
}
```

MVP: paste + audio upload + CSV.
V2: GoHighLevel, smrtPhone, WAVV (most common in REI dialer stacks).
V3: Dialpad, Aircall, Zapier/n8n/generic webhook, Google Sheets sync.

### 4.12 Audit & compliance
`audit_logs` table records every score, tier change, incentive calculation, role change, integration connect/disconnect. Retain 1 year. PII flagged for redaction on export.

## 5. Tech stack

### MVP (fastest to first production user)
| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 15 + TS + Tailwind + shadcn/ui | One repo, fast iteration, great Vercel deploy |
| Backend | Next.js Route Handlers | Same repo, same deploy, no extra infra |
| DB | Supabase Postgres | Managed, RLS for multi-tenancy |
| Auth | Supabase Auth | Email + magic link, JWT with custom claims |
| Storage | Supabase Storage | Audio files, signed URLs |
| AI | Anthropic Claude Sonnet 4.6 + Haiku 4.5 | Best long-context judgment; prompt caching |
| Transcription | Deepgram (Nova-3) | Cheap, fast, speaker diarization out-of-box |
| Background jobs | Vercel Cron + Supabase Edge Functions | Serverless, no worker infra |
| Email | Resend | Simple API, good deliverability |
| Hosting | Vercel | Zero-config Next.js |
| Analytics | PostHog | Self-host later if needed |

### Scale path (when revenue justifies it)
- Move heavy/long jobs (scoring, transcription) to **Inngest** or **Trigger.dev** for retries + observability
- Keep Postgres on Supabase but add **read replica** + **PgBouncer**
- Add **Redis** (Upstash) for rate limits + caching
- Move analytics events to **ClickHouse** if PostHog gets pricey
- **Stripe Billing** with Supabase webhook → `subscriptions` table
- Optional: dedicated **Python service** for any custom ML (e.g. fine-tuned objection classifier) — call it from Next.js via internal API

### Why not Bubble/Airtable
Fine for prototyping, but: (a) RLS-grade multi-tenancy is awkward, (b) AI prompt orchestration is fragile, (c) you can't sell a Bubble app to a $100M wholesale operation that wants SSO + audit logs. Skip the rebuild — start on Next.js.

## 6. Database schema (summary)

Full DDL in [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md). Tables:

```
companies            users               teams
reps                 calls               transcripts
scorecards           category_scores     discovery_checks
coaching_notes       tier_history        incentives
incentive_rules      reports             scripts
objections           company_settings    integrations
audit_logs           subscriptions       coaching_patterns
```

Key decisions:
- `calls` and `scorecards` are 1:1 (one scorecard per call), but split for clarity and to allow re-scoring
- `category_scores` is a child table not JSONB so we can index/query/aggregate per category
- Audio files: `calls.recording_path` references Supabase Storage; signed URL on read
- Soft delete via `deleted_at` on tenant tables

## 7. Security model

- All tenant tables: RLS on, default deny, policies keyed to `auth.jwt() ->> 'company_id'` and `role`
- Service role key only on server (never bundled to client)
- Audio bucket: private, signed URLs only, max 1-hour TTL
- Anthropic + Deepgram keys in Vercel encrypted env vars
- Rate limits per-company on scoring endpoint (Upstash sliding window)
- PII redaction option for transcripts on export (regex pass for phones/SSNs/emails)
- SOC 2 readiness: audit logs, access reviews, key rotation, vendor list — track from day 1, formalize at $500k ARR

## 8. Pricing model (planning, not building yet)

- **Starter** — $199/mo — up to 100 calls/month, 5 reps, 1 company
- **Growth** — $499/mo — 500 calls/mo, 25 reps, leaderboards, weekly reports
- **Scale** — $1,499/mo — 2,000 calls/mo, unlimited reps, integrations, custom scorecards
- **Enterprise** — custom — SSO, on-prem option, custom incentive rules, white-label

Overage: $0.50 per scored call. Audio transcription billed at cost + 30%.

## 9. Roadmap

### MVP (week 1–3)
Login, company setup, rep CRUD, paste transcript, AI scoring, scorecard view, rep profile with trend chart, dashboard, leaderboard, tier calculation, coaching output per call, CSV export.

### V2 (month 2–3)
Audio upload + transcription, weekly coaching plans, manager weekly digest, incentive engine + payout reports, CSV bulk import, Stripe billing, GoHighLevel + smrtPhone webhooks, role-based UI permissions polish.

### V3 (month 4–6)
WAVV + Dialpad + Aircall, Zapier/n8n public app, white-label theming, custom scorecard categories, AI-assisted script editor, mobile companion app for reps (PWA first), SOC 2 Type 1 audit.

### V4 (month 6–12)
Real-time call coaching (whisper agent during live calls), team competitions, calibration mode (managers compare AI score vs their own), fine-tuned scoring model per company.

## 10. Build order (start here)

1. Repo + Next.js + Supabase scaffold ✅
2. DB schema + RLS migrations
3. Auth + company onboarding flow
4. Paste-transcript form → AI scoring API → scorecard view
5. Rep profile + trend chart
6. Dashboard + leaderboard
7. Tier calculation + history
8. Coaching output panel
9. CSV export
10. Polish, seed data, demo
