# Wireframes

Low-fi page-by-page UX. Layout is a left sidebar app shell with role-aware nav.

## Sidebar nav (role-aware)

```
[ Logo ]
─────────
Dashboard
Calls
Reps
Leaderboard
Coaching         (manager + admin)
Reports          (manager + admin)
Incentives       (manager + admin) [V2]
Settings         (admin)
─────────
[ user avatar ]
Sign out
```

Reps see: Dashboard (their own), My Calls, My Profile, Leaderboard.

## Dashboard `/dashboard`

```
┌──────────────────────────────────────────────────────────────────────┐
│ Header: Acme Wholesale  ·  Last 30 days ▾  ·  All teams ▾            │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─Calls reviewed─┐  ┌─Avg score─┐  ┌─Top rep────┐  ┌─Most improved─┐ │
│ │     142        │  │   7.3     │  │ J. Diaz    │  │  M. Stone     │ │
│ └────────────────┘  └───────────┘  └────────────┘  └───────────────┘ │
│ ┌─Contracts──────┐  ┌─Apptmts───┐  ┌─Offers─────┐  ┌─Follow-up %──┐ │
│ │      11        │  │   29      │  │    47      │  │     78%      │ │
│ └────────────────┘  └───────────┘  └────────────┘  └──────────────┘ │
├──────────────────────────────────────────────────────────────────────┤
│ Tier distribution                  Coaching priorities                │
│ ┌──────────────────────────────┐   1. 6 reps avoid price (last wk)   │
│ │ T1▓▓ T2▓▓▓▓ T3▓▓▓▓▓▓ T4▓▓ T5▓│   2. 4 reps skip timeline q          │
│ └──────────────────────────────┘   3. 3 reps don't ask for close      │
├──────────────────────────────────────────────────────────────────────┤
│ Leaderboard (Top 5 — best avg)                                        │
│ 1. J. Diaz       8.7  ──── Tier 4                                     │
│ 2. K. Patel      8.4  ──── Tier 4                                     │
│ 3. R. Adams      7.9  ──── Tier 3                                     │
│ 4. M. Stone      7.6  ──── Tier 3                                     │
│ 5. S. Cole       7.2  ──── Tier 3                                     │
└──────────────────────────────────────────────────────────────────────┘
```

## Calls list `/calls`

Filters at top: date range, rep, type, source, status. Table:

```
| Date          | Rep      | Type      | Source | Score | Tier | Outcome     |
| Apr 23, 2:14p | J. Diaz  | Inbound   | PPC    | 8.5   | T4   | Contract    |
| Apr 23, 1:02p | K. Patel | Outbound  | SMS    | 6.0   | T2   | Follow-up   |
```

Row click → `/calls/[id]`.

Top-right: `[ + New call ]` (paste/audio modal).

## Call detail `/calls/[id]`

```
┌──────────────────────────────────────────────────────────────────────┐
│ ← Back · Apr 23 2:14pm · J. Diaz · Inbound · PPC · Apex 614-555-1234 │
├──────────────────────────────────────────────────────────────────────┤
│ TOTAL  85/100      AVG  8.5      TIER  T4 → T4      RISK  low        │
│ Conversion probability: 72%      Recommended next: send the offer    │
├──────────┬───────────────────────────────────────────────────────────┤
│Categories│ Coaching                                                   │
│Open  9.0 │ Biggest mistake: Skipped over the timeline question        │
│Rapp  8.5 │   when seller said "we have a few weeks"                   │
│Disc  7.0 │ Best moment: Reframed price objection at 04:32             │
│Ques  8.0 │ Missed opportunity: Seller mentioned divorce — didn't dig  │
│Ctrl  9.0 │ Should have said: "...verbatim coaching script..."          │
│Obj   9.0 │ Follow-up SMS: "Hey Karen, thinking about what you said..."│
│Val   8.5 │ Manager note: drill timeline question, run scenario X      │
│Off   8.0 │ Rep note (you crushed the objection — let's tighten disc.) │
│Close 9.0 │                                                            │
│Conv  8.0 │ [ Re-score ]  [ Override ]  [ Mark reviewed ]              │
├──────────┴───────────────────────────────────────────────────────────┤
│ Discovery checks (✓ uncovered, ✗ missed)                              │
│ ✓ motivation  ✓ price  ✗ timeline  ✓ condition  ✗ urgency  ✓ DM     │
├──────────────────────────────────────────────────────────────────────┤
│ Transcript                                            [ Show audio ▾ ]│
│ ──────────────────────────────────────────────────────────────────── │
│  REP:    Hey Karen, this is Jordan with Apex...                       │
│  SELLER: Yeah, I got your text. Tell me again how this works.         │
│  ...                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

## New call `/calls/new`

```
Tabs:  [ Paste transcript ] [ Upload audio ] [ Manual entry ]

Form:
  Rep ▾                         Call type ▾
  Date/time picker              Lead source ▾
  Seller name                   Property address (optional)
  Outcome ▾                     Next step

Transcript textarea (50k chars)

[ Cancel ]   [ Save & Score ]
```

## Reps list `/reps`

Table of reps with current avg, tier badge, calls reviewed, last 7-day delta. `[ + Add rep ]`.

## Rep profile `/reps/[id]`

```
┌──────────────────────────────────────────────────────────────────────┐
│ Avatar  Jordan Diaz    Acquisitions Manager · Team Alpha             │
│         T4 ADVANCED    Avg 8.5 (last 10) · 47 calls · joined Jan '25 │
├─Overview─Calls─Coaching─Tier history─Incentive──────────────────────┤
│                                                                      │
│  Score trend (last 30 days)                                          │
│  ┌─────────────────────────────────────────┐                         │
│  │  ▁▃▅█▇▆█▇█▇                              │                         │
│  └─────────────────────────────────────────┘                         │
│                                                                      │
│  Strongest: Objection Handling (9.0)                                 │
│  Weakest:   Discovery (7.0)                                          │
│                                                                      │
│  Recent calls                                                        │
│  Apr 23 · Inbound · 8.5 · Contract                                   │
│  Apr 22 · Follow-up · 7.5 · Appointment                              │
│  ...                                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

## Leaderboard `/leaderboard`

```
Tabs: [ Best avg ] [ Most improved ] [ Best discovery ] [ Best closing ]
       [ Most calls ] [ Most contracts ] [ Most appts ] [ Best conv ]

Filters: range, team, lead source, call type.

Ranked table with rep name, score (or count), trend arrow, tier badge.
```

## Coaching `/coaching` (manager+)

Two columns:
- **This week's priorities** — top patterns detected, rep counts, drill suggestions
- **Per-rep coaching plans** — collapsible cards, one per rep

## Settings `/settings` (admin)

Tabs:
- Company (name, logo, color, timezone)
- Scorecard (rolling window, category weights, tier thresholds)
- Reps (manage, invite)
- Incentive rules
- Integrations (V2)
- Billing (V2)
- Members + roles
- Audit log
