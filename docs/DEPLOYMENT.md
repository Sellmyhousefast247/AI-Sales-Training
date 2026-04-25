# Deployment & Operations

## Prerequisites
- Vercel account (or Cloudflare Pages as alternative)
- Supabase project (free tier ok for MVP, Pro at $25/mo when launching paying customers)
- Anthropic API key
- Deepgram API key (V2)
- Resend API key (V2)
- Stripe account (V2)

## Environment variables (`.env.local` / Vercel)

```
# Public
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_APP_NAME=Acquisitions AI OS

# Server-only
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL_PRIMARY=claude-sonnet-4-6
ANTHROPIC_MODEL_LIGHT=claude-haiku-4-5-20251001
DEEPGRAM_API_KEY=                   # V2
RESEND_API_KEY=                     # V2
STRIPE_SECRET_KEY=                  # V2
STRIPE_WEBHOOK_SECRET=              # V2
CRON_SECRET=                        # shared secret for /api/cron/*
PROMPT_VERSION=1.0.0
```

## First-time Supabase setup

```bash
# CLI
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ref>

# Apply migrations
supabase db push

# Seed defaults (objections, coaching patterns, scripts)
psql "$DATABASE_URL" -f supabase/seeds/0001_defaults.sql
```

In the Supabase dashboard:
1. **Auth → URL Config** — set site URL + redirect URLs to your Vercel domain
2. **Auth → Email Templates** — brand the magic link / confirm emails
3. **Storage** — create `recordings` bucket, **private**
4. **Auth → Hooks → Custom Access Token** — enable the hook and select `public.custom_access_token_hook` (function ships in migration `0002_auth_hook.sql`). This injects `company_id`, `role`, and `rep_id` into the JWT so RLS policies work. The app will not function correctly until this hook is enabled.
5. **Edge Functions** — none needed for MVP (cron lives on Vercel)

## Vercel deploy

```bash
vercel link
vercel env pull .env.local
vercel --prod
```

Vercel Cron config (`vercel.json`):

```json
{
  "crons": [
    { "path": "/api/cron/tier-recompute",   "schedule": "0 3 * * *"  },
    { "path": "/api/cron/weekly-reports",   "schedule": "0 11 * * 1" },
    { "path": "/api/cron/incentive-rollup", "schedule": "0 4 1 * *"  }
  ]
}
```

All cron endpoints check `Authorization: Bearer ${CRON_SECRET}`.

## Storage bucket policies

`recordings` bucket — private. Access only via signed URLs generated server-side after RLS-enforced authorization check.

## Observability
- **Vercel logs** — function errors
- **Supabase logs** — Postgres + auth
- **PostHog** — product analytics
- **Sentry** — JS errors (V2)
- Custom `audit_logs` table for compliance trail

## Backups
- Supabase Pro daily automatic backups (7-day retention)
- Weekly manual `pg_dump` to S3 for paying-customer data

## Rollback
- Vercel: click previous deployment → "Promote to production"
- DB migration regret: each migration ships with a `down` script; apply via `supabase db reset --linked` only on staging

## Cost ceilings (MVP, 1 customer, 500 calls/mo)
- Vercel Pro: $20/mo
- Supabase Pro: $25/mo
- Anthropic (Claude): ~$50/mo @ ~$0.10/call × 500
- Deepgram (V2): ~$13/mo @ 50hr × $4.30/hr
- **Total**: ~$110/mo for 1 customer

Sell at $499/mo Growth → ~78% gross margin.

## Health checks
- `/api/health` returns DB ping + Anthropic ping. Wire to Better Uptime or similar.

## Incident response (lightweight)
1. Vercel function 5xx alert → check logs
2. If scoring fails broadly: roll back prompt version (env var) or model id
3. If DB fails: Supabase status page; failover is auto on Pro
