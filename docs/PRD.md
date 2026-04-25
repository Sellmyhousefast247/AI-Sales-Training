# Product Requirements Document — Acquisitions AI OS

## 1. Problem
Real estate acquisitions teams hire reps faster than they can train them. Owners can't tell which reps are actually good on the phone. Managers don't have time to listen to every call. Reps don't know what to fix. Bonuses get paid on gut feel.

## 2. Goal
Score every seller call automatically, surface the patterns that win contracts, and tie incentives to objective performance — so owners promote the right reps, managers coach the right things, and reps know exactly what to improve.

## 3. Non-goals (MVP)
- Live in-call coaching
- Lead generation / dialer functionality
- CRM replacement
- Mobile native app (PWA in V3 is fine)
- Multi-language support (English only for MVP)

## 4. Success metrics
- **North star**: Avg rep score lift over 90 days (target +1.5 points)
- Activation: company creates ≥3 reps and scores ≥10 calls within first 7 days
- Engagement: ≥3 active reviewers/week per paying company
- Contract lift: tracked via deal_outcome, target +10% close rate among reps using coaching output
- Retention: <5% monthly churn after month 3
- Scoring quality: manager-vs-AI agreement ≥80% on calibration sample

## 5. User stories

### Company Admin
- As an admin, I create a company workspace, invite reps, and set my scorecard weights
- As an admin, I see a dashboard of weekly performance and tier distribution
- As an admin, I configure incentive rules and review monthly payout reports
- As an admin, I export raw data as CSV for my own analysis

### Manager
- As a manager, I paste a transcript and receive a scored breakdown in under 60 seconds
- As a manager, I see this week's coaching priorities ranked by impact
- As a manager, I read a Monday digest of every rep's progress

### Rep
- As a rep, I see my latest scorecard with rep-friendly feedback (not a roast)
- As a rep, I see my tier and what I need to do to reach the next one
- As a rep, I see one focused coaching item to practice this week

## 6. Functional requirements

### F1. Authentication
- Email + password (magic link option)
- Per-user role: super_admin, company_admin, manager, rep
- Session timeout: 14 days
- Password reset flow

### F2. Company onboarding
- Create company → admin user → invite reps via email
- Pick scorecard preset (default REI / wholesale / novation / creative finance)
- Pick rolling-window default

### F3. Rep management
- CRUD reps (name, email, team, role, hire date)
- Deactivate without deleting (preserves history)
- Bulk invite via CSV

### F4. Call ingestion
- Paste transcript (textarea, 50k char max)
- Upload audio (mp3, m4a, wav, max 200MB) → background transcribe → score
- Manual entry (no transcript, just outcome metadata) — for stand-up data only, no scoring
- CSV bulk import (up to 1k rows)

### F5. AI scoring
- Triggered automatically on transcript availability
- Returns within 60s P95
- Strict JSON output validated by Zod
- One automatic retry on parse failure
- Failed scoring surfaces as `status = 'failed'` with retry button

### F6. Scorecard view
- 10 category scores with justification + transcript quote
- Total / 100 + average / 10
- Tier impact (current → projected)
- Biggest mistake / best moment / missed opportunity
- "What they should have said" verbatim script
- Suggested follow-up message (SMS + email versions)
- Manager notes / rep-friendly feedback
- Deal risk + conversion probability + next action
- Buttons: re-score, override score, mark reviewed, share

### F7. Tier system
- Computed nightly + on every new score
- Window per company setting
- Min 5 calls to leave Tier 1
- `tier_history` row on every change with reason

### F8. Incentive engine
- Per-company JSON-defined rules
- Computes weekly + monthly + per-award eligibility
- Manager UI to confirm/adjust before payout
- Audit-logged

### F9. Coaching engine
- Per-call coaching auto-generated alongside score
- Weekly rep plan generated Sunday night for delivery Monday
- Manager weekly digest Monday 7am company-local
- Pattern detection across last 7 days of calls

### F10. Leaderboard
- 8 boards listed in blueprint §4.8
- Filters: company, team, date range, lead source, call type
- Updates on score commit (no nightly job needed)

### F11. Reports
- Daily manager (yesterday's calls)
- Weekly rep (Mon 7am)
- Weekly company (Mon 7am)
- Monthly incentive (1st of month)
- Quarterly improvement
- Each: HTML email + PDF download + CSV export

### F12. Settings
- Scorecard category weights (advanced)
- Tier thresholds (advanced)
- Rolling window
- Incentive rules
- Branding (logo, color) — V2
- Integrations — V2

## 7. Non-functional requirements
- **Performance**: scorecard p95 < 60s, dashboard < 2s, leaderboard < 1s
- **Availability**: 99.5% MVP, 99.9% by V2
- **Security**: RLS-enforced tenant isolation, audit logs, signed URLs for audio
- **Scalability**: 10k calls/day per Postgres instance with current schema; partition `transcripts` by month if needed
- **Cost ceiling (MVP)**: < $0.20 per scored call (transcription + LLM combined)

## 8. Out of scope (explicit)
- Voice biometrics
- Live agent assist
- Predictive dialing
- Lead enrichment
- Email/SMS sending (we generate content; the user sends it)

## 9. Open questions for the user
1. **Default scorecard weights** — are all 10 categories equal weight, or do you want Discovery and Closing weighted higher? (My default: equal weight; happy to tune.)
2. **Rolling window default** — last 10 calls, last 30 days, or all-time? (My default: last 10 calls.)
3. **Lead sources** — give me your canonical list (PPC, SMS, cold call, RVM, list pull, referral, other?)
4. **Call types** — confirm: inbound, outbound, follow-up, offer, negotiation, closing — anything missing?
5. **Default incentive structure** — share your current commission/bonus rules so I can pre-load a real preset
6. **Branding** — company name, logo, primary color for the platform itself (Acquisitions AI OS marketing site)

I'll proceed with the defaults above and you can override any of them later. Each is just a row in `company_settings` or a config JSON.
