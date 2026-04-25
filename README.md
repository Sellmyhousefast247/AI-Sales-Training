# Acquisitions AI OS

AI-powered call scoring, coaching, leaderboard, tier, and incentive platform for real estate acquisitions teams. Multi-tenant SaaS designed to ship as an internal tool first, then sell to other investing companies.

## What it does

Feed in seller call transcripts (or recordings → transcripts). The system scores the rep across 10 acquisitions categories, generates coaching feedback, places the rep in a skill tier based on rolling averages, calculates incentive eligibility, and rolls everything into manager dashboards, leaderboards, and reports.

## Status

MVP scaffolding in progress on `claude/acquisitions-ai-os-M2avq`.

## Documents

- [`docs/PRODUCT_BLUEPRINT.md`](docs/PRODUCT_BLUEPRINT.md) — full architecture & feature blueprint
- [`docs/PRD.md`](docs/PRD.md) — product requirements
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) — schema reference + ERD
- [`docs/AI_SCORING_PROMPT.md`](docs/AI_SCORING_PROMPT.md) — production scoring prompt
- [`docs/MVP_BUILD_PLAN.md`](docs/MVP_BUILD_PLAN.md) — phased build plan (MVP → V2 → V3)
- [`docs/API_SPEC.md`](docs/API_SPEC.md) — API surface
- [`docs/WIREFRAMES.md`](docs/WIREFRAMES.md) — page-by-page UX
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — deploy + ops
- [`docs/TESTING_PLAN.md`](docs/TESTING_PLAN.md) — test strategy

## Tech stack (MVP)

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- **Backend**: Next.js Route Handlers + Supabase (Postgres + Auth + Storage + Row-Level Security)
- **AI**: Anthropic Claude Sonnet 4.6 (scoring) + Haiku 4.5 (lightweight rewrites)
- **Transcription**: Deepgram (primary) or OpenAI Whisper (fallback)
- **Deploy**: Vercel + Supabase Cloud
- **Payments (V2)**: Stripe Billing

## Quick start

```bash
pnpm install
cp .env.example .env.local      # fill in keys
pnpm supabase db push           # apply migrations
pnpm dev
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full setup.
