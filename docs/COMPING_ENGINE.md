# Comping & Deal Analysis Engine

Foundation of the nationwide ARV / As-Is / Repairs / MAO engine used by the
acquisitions team. Beginner-safe: takes a property + condition text and
returns a defensible offer range without the user knowing how to comp.

This doc covers the **engine and logic only**. UI is out of scope.

---

## 1. System Architecture

```
                ┌────────────────────────────────────────┐
                │  POST /api/comp  (Next.js route)       │
                └──────────────┬─────────────────────────┘
                               │ subject + condition
                               ▼
                ┌────────────────────────────────────────┐
                │  analyzeDeal()  src/lib/comping        │
                │  ────────────────────────────────────  │
                │  1. resolveSubject()   provider router │
                │  2. pullComps()        sold + active   │
                │  3. compPipeline()     filter+adjust   │
                │  4. estimateRepairs()  text → $        │
                │  5. computeMarket()    pending %       │
                │  6. computeMAO()       formulas        │
                └──────────────┬─────────────────────────┘
                               │
       ┌───────────────────────┼─────────────────────────┐
       ▼                       ▼                         ▼
 ┌───────────┐          ┌─────────────┐           ┌────────────┐
 │ Provider  │          │ Provider    │           │ Provider   │
 │  ATTOM    │          │  Bridge MLS │           │  Zillow/   │
 │           │          │             │           │  Redfin    │
 └───────────┘          └─────────────┘           └────────────┘
       └───────────────────────┬─────────────────────────┘
                               ▼
                    ┌────────────────────┐
                    │  Supabase cache    │
                    │  comps, subjects,  │
                    │  market_stats      │
                    └────────────────────┘
```

- **Stateless engine** — all functions are pure where possible. Side effects
  (DB cache, provider HTTP) live behind interfaces.
- **Provider-agnostic** — every external data source implements the
  `CompDataProvider` interface in `src/lib/comping/providers/types.ts`.
- **Multi-source aggregation** — we pull from 2+ providers per request and
  merge by address+APN. Disagreements lower the confidence score.

---

## 2. Data Sources

| Source                        | What it gives                                  | Cost (rough)         | Accuracy | Use as                       |
| ----------------------------- | ---------------------------------------------- | -------------------- | -------- | ---------------------------- |
| **MLS via Bridge Interactive**| Closed sales, active listings, pendings, DOM   | Free for licensed brokers; broker sponsorship needed | Highest | Primary ARV/As-Is comps      |
| **ATTOM Data**                | Tax, deed, AVM, property characteristics, sales history | $$$ enterprise; ~$0.05–$0.15/lookup | High     | Subject record + national fallback |
| **Zillow / Redfin scrape**    | Estimates, recent sales, photos                | Free–scrape risk; ToS violation risk | Medium   | Sanity check + photo signals only |
| **Mashvisor / Realty Mole / RentCast** | AVM + comps API                       | $50–$500/mo          | Medium   | Backup AVM + rural fallback  |
| **County public records**     | Authoritative deed + tax                       | Free–varies          | High but slow | Title-stage verification     |
| **PropStream / BatchLeads**   | Off-market lists + AVM                         | $99–$500/mo          | Medium   | Lead-gen, not comping        |

### Cost vs accuracy

- **Cheap-only stack** (ATTOM + RentCast): good enough for instant ballpark.
  ARV typically within ±8%. Use for "first look" mode.
- **Pro stack** (Bridge MLS + ATTOM + RentCast): MLS gives true sold prices
  with full condition photos. ARV typically within ±3%. Use when the lead
  is qualified.
- **Rural / no-MLS** counties: fall back to ATTOM + RentCast + county
  records. Confidence drops to "Medium" max.

### Combining sources for accuracy

1. Resolve subject from ATTOM (most complete characteristics).
2. Pull sold comps from MLS first; if <5 valid comps, supplement with ATTOM
   recorded sales and RentCast comps.
3. Pull active + pending counts from MLS for the buying-% calculation.
4. Cross-check the resulting ARV against Zillow/Redfin Zestimate. If the
   delta is >15%, drop confidence one tier and flag for manual review.

---

## 3. Comping Algorithm (step-by-step)

Implemented in `src/lib/comping/comp-pipeline.ts`. Run twice — once on
**solds** (→ ARV / As-Is) and once on **actives** (→ buying %).

### Step 1 — Pull
- Solds: closed in last **6 months** (fall back to 12 if <5 results).
- Actives + pendings: currently on market, same radius.
- Initial radius **0.25 mi**, expand to 0.5 → 1.0 mi only if <5 valid comps.

### Step 2 — Filter
- Same property type (SFR vs condo vs MH).
- Beds: subject ± 1.
- Baths: subject ± 1.
- Sqft: within ±20% of subject.
- Year built: within ±15 years.
- Exclude: foreclosure, REO, distressed sales, non-arm's-length transfers.

### Step 3 — Normalize
- Convert all prices to `price_per_sqft`.
- Tag each comp's condition as `as_is | average | renovated` from MLS
  remarks/photos via Claude classifier (cached).

### Step 4 — Outlier removal
- IQR method on `price_per_sqft`. Drop anything outside Q1−1.5·IQR or
  Q3+1.5·IQR.
- Require at least 3 surviving comps. Otherwise expand radius and retry.

### Step 5 — Adjustments (per comp, additive $/sqft)
- **Condition** — comp `renovated` and subject `as_is`: subtract 8–15%.
- **Lot size** — ±$0.5–$2 per extra sqft of lot beyond 10% delta.
- **Garage** — ±$5,000 per stall delta.
- **View / waterfront / busy road** — ±5–15% of comp price.
- **Layout / ceiling height** — manual override hook (per the playbook,
  open + tall ceiling → higher ARV).

### Step 6 — Aggregate
- ARV = trimmed mean of adjusted comp prices on **renovated** subset.
- As-Is = trimmed mean of adjusted comp prices on **as_is** subset.
- ARV range = ±1 stdev around the mean.

### Step 7 — Confidence score
- High: ≥5 comps, all within 0.5 mi, IQR width <15% of median, agree with
  Zestimate within 10%.
- Medium: 3–4 comps OR radius >0.5 mi OR IQR 15–25%.
- Low: <3 comps OR radius >1 mi OR IQR >25% OR Zestimate delta >15%.

---

## 4. Buying % from Pending Ratio

Per the playbook (`src/lib/comping/formulas.ts → buyingPctFromPending`):

| Pending % of active+pending | Base buying % |
| --------------------------- | ------------- |
| <15%                        | 66%           |
| 15–24%                      | 68%           |
| 25–34%                      | 70%           |
| 35–44%                      | 73%           |
| ≥45%                        | 75%           |

Then adjust by qualitative signals (each ±1–3%):
- Schools (GreatSchools rating)
- Crime index
- Lot defects (slope, easement, flood, train, power lines)
- Street view / curb appeal
- Required rehab level (Heavy or Full Gut → push down)
- Appreciation trend (12-month)
- Tourism / rural

Net cap: −10% (rough market) to +5% (strong market) from base.

---

## 5. Repair Estimation Engine

`src/lib/comping/repair-estimator.ts` — text → category → $/sqft.

### Categories

| Level     | $/sqft  | Typical signals (any of)                                                        |
| --------- | ------- | ------------------------------------------------------------------------------- |
| Light     | 10–20   | "paint", "carpet", "minor", "cosmetic", "clean out"                             |
| Moderate  | 20–35   | "kitchen update", "bath update", "flooring", "HVAC service", "minor roof"       |
| Heavy     | 35–55   | "full kitchen", "full bath", "roof replacement", "HVAC replace", "windows", "siding" |
| Full Gut  | 55–85   | "gut", "foundation", "structural", "fire damage", "down to studs", "addition"   |

Always overrides:
- Foundation/structural keyword → at minimum Heavy, often Full Gut.
- Roof damage + HVAC + kitchen + bath all called out → Heavy minimum.
- Mold / fire / water damage → Full Gut floor.

### Algorithm
1. Lowercase + tokenize input.
2. Score against each category's keyword list.
3. Apply overrides (foundation, mold, fire, structural).
4. Pick category with highest weighted score.
5. `repair_estimate = sqft × midpoint($/sqft)`.
6. Return `{ level, low, high, point, drivers[] }`.

For higher accuracy V2: pass the text + photos to Claude with a fixed
schema and merge with the keyword score.

---

## 6. JSON Output

```json
{
  "arv": 250000,
  "arv_range": { "low": 240000, "high": 260000 },
  "as_is_value": 180000,
  "repair_estimate": 45000,
  "repair_breakdown": {
    "level": "Heavy",
    "low": 39000,
    "high": 51000,
    "drivers": ["roof damage", "outdated kitchen", "foundation cracks"]
  },
  "buying_pct": 0.70,
  "wholesale_mao": 110000,
  "novation_mao": 122000,
  "confidence_score": "High",
  "comps_used": 7,
  "warnings": []
}
```

`wholesale_mao = round(arv × 0.7 − repairs − 20000)`
`novation_mao  = round(as_is_value × 0.9 − 40000)`

When `buying_pct` differs from 0.7 (per pending-%), we also emit
`market_adjusted_mao = arv × buying_pct − repairs − 20000` so the user can
see the playbook-tuned number.

---

## 7. APIs / Services to Plug In

Phase 1 (MVP — what we wire first):
- **ATTOM Data** — subject lookup + national fallback comps. Single contract.
- **RentCast** (formerly RealtyMole) — cheap AVM + comps backup.
- **GreatSchools** — school ratings for the buying-% adjustment.
- **Anthropic Claude (existing)** — condition classifier from MLS remarks +
  user-pasted condition text.

Phase 2:
- **Bridge Interactive MLS** — only after broker sponsorship is secured.
- **FBI / city open-data crime feeds**.
- **Mapbox / Google Places** — busy-road, train-track, water proximity.
- **Zillow public Zestimate fetch** — sanity check only.

Phase 3:
- **County records scrapers** per state (DataTree / Title Pro fallback).
- **Photos → condition** vision pipeline (Claude vision on listing photos).

---

## 8. Tech Stack

- **Backend**: Next.js 15 route handlers (`src/app/api/comp/route.ts`).
- **Engine**: pure TypeScript in `src/lib/comping/`.
- **Cache / persistence**: Supabase Postgres tables `comp_subjects`,
  `comp_records`, `comp_market_stats`, `deal_analyses` (migration in a
  follow-up phase — schema sketched in section 9).
- **AI**: Anthropic SDK already in deps for the condition classifier.
- **Validation**: Zod schemas in `src/lib/comping/types.ts`.
- **Tests**: Vitest, colocated `*.test.ts`.

Scales nationwide because:
- Engine is stateless and provider-pluggable.
- Comp queries are geo-keyed and cacheable per-zip.
- Heavy work (provider fan-out, photo classification) is async-ready.

---

## 9. Database Schema (next phase, sketch)

```sql
create table comp_subjects (
  id uuid primary key,
  address text, lat numeric, lng numeric,
  beds int, baths numeric, sqft int, year_built int,
  property_type text,
  source text, source_id text, fetched_at timestamptz
);

create table comp_records (
  id uuid primary key,
  subject_id uuid references comp_subjects(id),
  status text check (status in ('sold','active','pending')),
  close_date date, list_date date,
  price numeric, price_per_sqft numeric,
  beds int, baths numeric, sqft int, year_built int,
  distance_mi numeric, condition text,
  source text, source_id text, raw jsonb
);

create table deal_analyses (
  id uuid primary key,
  subject_id uuid references comp_subjects(id),
  arv numeric, as_is_value numeric,
  repair_estimate numeric, repair_level text,
  buying_pct numeric,
  wholesale_mao numeric, novation_mao numeric,
  confidence text, payload jsonb,
  created_at timestamptz default now()
);
```

---

## 10. What's shipped

Phase 1 (foundation):
- Engine: `src/lib/comping/{types,formulas,repair-estimator,comp-pipeline,index}.ts`
- Provider interface: `src/lib/comping/providers/types.ts`
- API: `src/app/api/comp/route.ts` (POST)
- Tests: formulas + repair estimator

Phase 2 (providers + cache + persistence):
- ATTOM provider — `src/lib/comping/providers/attom.ts`
- RentCast provider — `src/lib/comping/providers/rentcast.ts`
- Claude condition classifier — `src/lib/comping/condition-classifier.ts`
- Supabase cache layer — `src/lib/comping/cache.ts`
- End-to-end orchestrator (cache → provider → analyze → persist) —
  `src/lib/comping/orchestrator.ts`
- Migration for `comp_subjects`, `comp_records`, `comp_market_signals`,
  `deal_analyses` with the same RLS pattern as 0001 — `supabase/migrations/0004_comping_engine.sql`
- API now supports two body shapes:
  - `manual` — caller supplies subject + comps; pure function, no auth
  - `lookup` — caller supplies just an address; engine resolves via cache +
    providers, persists, and returns the full result
- Provider unit tests with mocked fetch + an end-to-end `analyzeDeal` test.

What's **still not** here:
- Bridge MLS provider (needs broker sponsorship).
- GreatSchools / crime feed providers.
- Photo-vision condition pipeline.
- UI.
