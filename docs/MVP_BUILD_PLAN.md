# MVP Build Plan

Three milestones. Each milestone is shippable.

## Milestone 1 — MVP (week 1–3)

**Goal**: a manager can paste a transcript and get a real scorecard. Reps appear on a leaderboard. Tier is computed.

### Scope
1. Auth — email/password, magic link backup
2. Company onboarding — create company, pick rolling-window default
3. Reps — CRUD, bulk CSV invite
4. Calls — paste transcript form (audio upload deferred)
5. AI scoring — Claude Sonnet 4.6 via tool-use, validation, persistence
6. Scorecard view — full UI with all output fields
7. Rep profile — header, score trend chart (recharts), recent calls
8. Dashboard — all blueprint §4.1 cards
9. Leaderboard — best avg, most improved, most calls (3 boards for MVP)
10. Tier calculation — on every score commit + nightly cron
11. Coaching panel — per-call coaching displayed on scorecard
12. CSV export — calls, scorecards, reps

### Out of scope for MVP
- Audio upload + transcription (V2)
- Weekly digest emails (V2)
- Incentive engine UI (V2)
- Pattern detector job (V2)
- Stripe (V2)
- Integrations (V2)

### Definition of done
- [ ] A manager from a fresh company can sign up, add a rep, paste a transcript, see a full scorecard inside 5 minutes
- [ ] 10 transcripts scored end-to-end without manual fix-up
- [ ] Rep profile shows trend chart over those 10 calls
- [ ] Leaderboard ranks reps correctly
- [ ] Tier badge updates correctly when a rep's rolling avg crosses a threshold
- [ ] CSV export downloads cleanly in Excel
- [ ] Deployed to Vercel + Supabase, HTTPS, branded login

## Milestone 2 — V2 (month 2–3)

**Goal**: this becomes a *product* you can charge for.

### Scope
- Audio upload → Deepgram transcription → auto-score
- Weekly coaching plan generator (Sunday job)
- Manager weekly digest email (Resend)
- Pattern detector (Haiku weekly batch)
- Incentive engine: rules editor UI + projected vs approved vs paid statuses
- Monthly incentive report (PDF + CSV)
- CSV bulk import for back-fill
- Stripe Billing — Starter / Growth / Scale plans
- Role-based UI (rep sees only their stuff, manager sees team, admin sees company)
- 5 more leaderboards (best discovery, best closing, most contracts, most appointments, best conversion likelihood)
- GoHighLevel + smrtPhone webhook ingest
- Audit log viewer for admins

### Definition of done
- [ ] First paying customer onboarded end-to-end without code changes
- [ ] 95% of calls auto-scored from audio (Deepgram + Claude) with no manual paste
- [ ] Monday 7am company-local digest lands in admin's inbox
- [ ] Stripe webhook keeps `subscriptions` table in sync
- [ ] Permission matrix enforced — rep cannot see another rep's calls

## Milestone 3 — V3 (month 4–6)

### Scope
- WAVV, Dialpad, Aircall integrations
- Generic webhook + Zapier / n8n public app
- Google Sheets two-way sync (read leads, push scorecards)
- White-label theming (logo, color, custom domain)
- Custom scorecard categories per company (not just preset)
- AI-assisted script editor — paste current script, AI suggests improvements
- Mobile companion (PWA) for reps — view-only scorecards + coaching
- SOC 2 Type 1 audit kicked off
- API + webhooks for customers (so they can pipe scorecards into their own BI)

## V4+ (month 6–12)

- Real-time call coaching — whisper agent during live call
- Calibration mode — managers compare their score vs AI on the same call, AI learns
- Per-company fine-tuned scoring model
- Team competitions (weekly tournaments)
- Coach marketplace — top-tier coaches publish scripts/drills, reps unlock with points

## Sequencing inside MVP (file-by-file order)

This is the order I'm building files now:

1. `package.json` + tooling configs
2. `supabase/migrations/0001_initial_schema.sql`
3. `src/lib/types.ts` — domain types
4. `src/lib/supabase/{server,client,middleware}.ts`
5. `src/lib/ai/{prompts.ts, score-call.ts}` — Claude scoring engine
6. `src/lib/{tier,incentive}.ts` — pure functions
7. `middleware.ts` — auth + tenancy guard
8. `src/app/(auth)/{login,signup}/page.tsx`
9. `src/app/(app)/layout.tsx` — sidebar shell
10. `src/app/(app)/dashboard/page.tsx`
11. `src/app/(app)/calls/{page.tsx, new/page.tsx, [id]/page.tsx}`
12. `src/app/(app)/reps/{page.tsx, [id]/page.tsx}`
13. `src/app/(app)/leaderboard/page.tsx`
14. `src/app/(app)/settings/page.tsx`
15. `src/app/api/calls/score/route.ts`
16. `src/app/api/calls/route.ts`
17. `src/app/api/reps/route.ts`
18. Components: `ScorecardView`, `Leaderboard`, `TierBadge`, `ScoreTrendChart`, `StatCard`
19. Seed script — demo company + reps + sample transcripts
