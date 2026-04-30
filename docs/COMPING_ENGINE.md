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
- API supports two body shapes:
  - `manual` — caller supplies subject + comps; pure function, no auth
  - `lookup` — caller supplies just an address; engine resolves via cache +
    providers, persists, and returns the full result
- Provider unit tests with mocked fetch + an end-to-end `analyzeDeal` test.

Phase 3 (MLS + non-disclosure handling):
- Bridge Interactive MLS provider (RESO Web API v2) —
  `src/lib/comping/providers/bridge.ts`. Captures ListPrice,
  OriginalListPrice, ClosePrice, DaysOnMarket, PublicRemarks. Auth via
  Bearer header, per-dataset (per-MLS) at construction.
- Non-disclosure state handling — `src/lib/comping/non-disclosure.ts`.
  When the subject is in a NDS (TX, ID, KS, MS, MO, MT, NM, ND, UT, WY,
  partial AK/LA), county-records solds frequently come back with
  `price=0`. We:
  1. Find the most similar comps via `rankBySimilarity()` (sqft, beds,
     baths, year, distance, property type).
  2. Reference price-listing history (`list_price`,
     `original_list_price`, `dom_days`) instead of close price.
  3. Impute the sale price with `list_price × sale-to-list-ratio`,
     where SLR is derived from the active/pending market temperature
     (1.02 hot → 0.94 soft).
  4. Apply a DOM penalty (½% per 30 days beyond the first 30, capped
     at 6%) for slow movers.
  5. Skip imputation entirely for any comp that came from Bridge MLS
     with a real ClosePrice — that's authoritative.
- Orchestrator now: pulls comps → runs Claude classifier on remarks →
  imputes missing prices for NDS subjects → analyzes → persists. The
  output includes `non_disclosure_state` + `comps_imputed` counters and
  emits a warning when imputation was used.
- Tests: Bridge provider with mocked RESO fetch (sold + active + NDS
  fallback path), non-disclosure imputation + similarity ranking.

Phase 4 (UI + manual comp editing):
- Comping list page (`/comping`), calculator (`/comping/new`), and detail
  page (`/comping/[id]`) with three big MAO cards, repair breakdown,
  warnings, and subject specs.
- `CompsEditor` lets users override any per-row field (price, list_price,
  DOM, condition, status, distance) or exclude a comp entirely.
  PATCH `/api/comp/comps/[id]` + soft-delete via `excluded=true`.
- POST `/api/comp/[id]/recompute` reloads non-excluded comps from DB,
  re-imputes for non-disclosure states, re-runs `analyzeDeal`, and
  saves a new `deal_analyses` row so history is preserved.
- Migration 0005: `excluded`, `notes`, `overridden_by`, `overridden_at`.

Phase 5 (photo-vision condition pipeline):
- `src/lib/comping/photo-classifier.ts` — Claude Haiku vision call
  (per-comp, parallelized) classifies each comp's photos as
  `as_is | average | renovated`. Caps at 5 photos per comp; bypasses
  cleanly when no `ANTHROPIC_API_KEY` is set.
- Bridge provider now captures the RESO `Media` array, ordered by
  `Order`, with floor plans / documents filtered out. Up to 5 photo
  URLs per comp.
- Orchestrator runs photos first (strongest signal) and falls back to
  the remarks classifier for any comp the photo pass left untagged.
- Migration 0006: `photo_urls jsonb` plus the previously-missing
  `list_price`, `original_list_price`, `dom_days`, `remarks` columns.
- Cache layer persists every enrichment field round-trip.

Phase 6 (per-analysis snapshots):
- `src/lib/comping/snapshot.ts` — `buildCompsSnapshot()` and
  `buildSubjectSnapshot()` flatten engine inputs into JSONB-friendly
  rows, normalizing optional fields to `null` so the DB write is
  predictable.
- Migration 0007: `comps_snapshot jsonb` + `subject_snapshot jsonb` on
  `deal_analyses`.
- `saveAnalysis(ctx, subjectId, userId, output, { comps, subject })` —
  optional snapshots persisted alongside the row. Orchestrator and
  recompute endpoint both populate them.
- Detail page renders a read-only "Comps used in this analysis"
  section from the snapshot when present, so historical analyses keep
  showing the comp values that fed them even after the live
  comp_records get edited. Subject specs prefer the snapshot too.
- Live `CompsEditor` still operates on current comp_records; Save &
  Recompute creates a new analysis row with a fresh snapshot.

Phase 7 (market signal providers):
- `src/lib/comping/providers/greatschools.ts` — pulls nearby schools by
  lat/lng, averages `gsRating` across school types so a single bad
  elementary doesn't drag the rating down. Tolerates `{schools:[]}`,
  `{data:[]}`, and bare-array response shapes. Signals-only — no comps.
- `src/lib/comping/providers/fbi-crime.ts` — hits the FBI Crime Data
  Explorer summarized state endpoints (violent + property), normalizes
  rates per 100k against U.S. averages so 50 = national mean. Caps
  the index at [0, 100]. Falls back to the baseline when one series
  is missing.
- ProviderRouter activates each automatically when `GREATSCHOOLS_API_KEY`
  / `FBI_CRIME_API_KEY` is set. The buying-pct adjuster in
  `formulas.ts` already consumes `schools_rating` and `crime_index`,
  so once a key is present every analysis picks up the signal with no
  other code changes.

Phase 8 (background cache pre-warm by zip):
- Migration 0008: `comp_warm_queue` table with one row per
  (company, zip), tracking `last_warmed_at` and `priority`. RLS
  follows the standard tenant pattern.
- `src/lib/comping/warmer.ts` — `warmZip(ctx, zip, state, city)` builds
  a synthetic subject pinned to the zip, fan-outs across every
  configured signal provider, and persists merged signals to
  `comp_market_signals` (with `subject_id=null`, `zip` set). `warmDueQueue(limit)`
  walks the oldest queue rows and stamps `last_warmed_at`.
  `enqueueZip()` upserts queue entries idempotently.
- `POST /api/comp/warm` lets managers/admins enqueue a specific zip;
  `run_now: true` warms immediately.
- `GET/POST /api/cron/warm-cache` — Vercel cron (`*/30 * * * *`)
  processes up to 25 due zips per run. Auth via the existing
  `CRON_SECRET` Bearer header.
- `vercel.json` registers the cron schedule alongside the existing jobs.
- `warmZip` accepts an injectable `router` for tests so the suite
  doesn't need API keys or a DB.

Phase 9 (subject-photo vision pre-fill):
- `src/lib/comping/subject-photo-analyzer.ts` — Claude Haiku vision call
  with a system prompt that pins the model to the project's repair
  vocabulary (Light/Moderate/Heavy/Full Gut keywords). Returns
  `condition`, `condition_text` (already in the format the keyword-
  based estimator wants), `drivers[]`, and a short `summary`.
- `POST /api/comp/analyze-photos` — auth-gated, accepts up to 20 URLs,
  proxies to the analyzer.
- Calculator form (`/comping/new`) gains a "Listing photos (optional)"
  section: paste URLs one per line, click "Analyze photos", and the
  condition box is appended with the AI's drivers. The user reviews
  and edits before submitting, so vision is a head-start, not a
  black box.
- Tests cover the empty-input, fully-empty-strings, and no-API-key
  paths.

Phase 10 (ATTOM + RentCast photo capture):
- ATTOM provider's `mapAttomToComp` now extracts `photo_urls` from
  either a `media[]` collection (the
  /property/detailwithphotos shape) or a legacy `photos[]` array.
  Tolerates `PhotoURL` / `photoURL` / `url` casings, dedupes, caps at 5.
- RentCast provider's `mapRentCastComp` reads `images`, `photos`, and
  `propertyImages` collections, accepting either string URLs or
  objects with `url` / `imageUrl` / `photoUrl`. Same dedupe + cap.
- Photos from these providers automatically flow into the orchestrator's
  photo-classifier pass — no other code changes needed.

Phase 11 (lot-defect signals via free public APIs):
- `src/lib/comping/providers/lot-signals.ts` — `LotSignalsProvider`
  combines three free upstreams in parallel (`Promise.allSettled` so
  one slow source can't tank the lookup):
  - FEMA NFHL flood-hazard layer 28 → flags has_lot_defects when the
    point falls in a high-risk zone (A, AE, AH, AO, AR, A99, V, VE).
  - USGS EPQS elevation queried at 4 cardinal points ~50 m around the
    subject → computes slope %; flags has_lot_defects when slope ≥ 12%
    (configurable).
  - OSM Overpass `out count` for railway lines within 200 m and
    motorway/trunk/primary roads within 80 m → flags
    near_train_or_busy_road when count > 0.
- Activated via `LOT_SIGNALS_ENABLED=1` in both the orchestrator and
  the warm-cache pre-fetch. Opt-in because Overpass is rate-limited
  and we don't want to surprise ops.
- 9 mocked-fetch tests cover each upstream, the merge path, the
  flat-lot/low-risk negatives, and the no-lat/lng short-circuit.

Phase 12 (condition-source provenance + badges):
- Migration 0009: `comp_records.condition_source` (`photos` | `remarks` |
  `manual` | `provider` | NULL).
- `tagCompsByPhotos` stamps `condition_source: "photos"`,
  `tagCompConditions` stamps `"remarks"`, and PATCH
  `/api/comp/comps/[id]` stamps `"manual"` whenever a user changes
  `condition`.
- `cache.saveComps` + `rowToComp` round-trip the field; `buildCompsSnapshot`
  captures it so historical analyses keep their provenance.
- Detail page renders a small colored badge next to each comp's
  condition — vision (blue), text (amber), edited (emerald), provider
  (gray) — both in the live `CompsEditor` and the read-only
  `CompsSnapshotSection`. Hover tooltip explains the source.
- Two new tests: photo classifier stamps the source field, snapshot
  round-trips it.

Phase 13 (per-zip appreciation trend):
- `RentCastProvider.pullMarketSignals` — when the subject has a zip,
  hits `/markets?zipCode=...&dataType=Sale&historyRange=12` and
  computes 12-mo appreciation as
  `(latestMedian − ~12moAgoMedian) / ~12moAgoMedian`. Prefers
  median over average; falls back to averagePrice when median is
  absent. Requires ≥6 history points; returns null below that.
- The signal flows automatically into `buyingPctAdjustment`'s
  appreciation tier (≥7% → +2%, ≤−2% → −2%) and gets persisted by
  the warmer when running on a zip.
- 7 new tests cover the computation (exact 12-mo, fallback to
  average, divide-by-zero guard, short-history null) plus the
  provider entry points (no-zip short-circuit, happy path, fetch
  failure).

Phase 14 (PDF export + shareable link):
- Migration 0010: `share_token uuid` + `shared_at timestamptz` on
  `deal_analyses`. Unique partial index keeps tokens collision-free
  while permitting the common NULL case.
- `POST /api/comp/[id]/share` generates (or reuses) a UUID token
  and returns the share URL. Manager+ only. `DELETE` revokes by
  setting the token back to NULL.
- `/share/comp/[token]` is a public page outside the `(app)` layout
  group — no auth, no sidebar. Reads via the admin client filtered
  by token, so RLS isn't bypassed in any meaningful sense (the
  token *is* the credential). Renders the same MAO + repair
  breakdown + comp snapshot the owner sees, minus the live editor.
- Detail page header gets a `ShareControls` client component:
  - **Print / Save PDF** — `window.print()`. Print CSS in
    `globals.css` hides the sidebar, the editor, and the share
    controls themselves so the PDF is clean.
  - **Create share link** / **Copy link** / **Revoke** — manager+ only.
    Reps see Print only.
- 120 tests still pass; typecheck clean on every new file.

Phase 18 (multi-source AVM cross-check):
- `src/lib/comping/avm-cross-check.ts` — pure helper that takes our
  derived ARV and a list of external AVMs (RentCast, ATTOM) and
  returns max-spread + a 0/1/2-tier confidence drop. Thresholds:
  ≥15% spread → drop one tier, ≥25% → drop two. Below the threshold
  the cross-check stays silent.
- `CompDataProvider` gains an optional `pullAvm(subject)` method.
  `ProviderRouter.pullAvms` fans out via `Promise.allSettled` so a
  slow upstream can't tank the rest.
- `RentCastProvider.pullAvm` hits `/avm/value`, `AttomProvider.pullAvm`
  hits `/property/avm` and reads `property[0].avm.amount.value`.
- Orchestrator runs the cross-check after `analyzeDeal`, applies the
  confidence drop, pushes a warning, and stores the AVMs +
  max-spread on `AnalyzeDealOutput.external_avms` /
  `avm_max_spread_pct`. Best-effort — never blocks analysis.
- Detail page renders an "External AVM cross-check" section showing
  Engine ARV vs each external AVM with %-deltas; the panel turns
  emerald / amber / red based on the spread.
- 10 unit tests cover empty, sub-threshold, 1-tier, 2-tier, ARV=0,
  and the confidence-drop clamping at "Low".

Phase 17 (analysis history timeline):
- Detail page loads up to 50 prior analyses for the same `subject_id`
  (newest first) and renders a compact `HistoryTimeline` section below
  the editor: timestamp, ARV, Wholesale MAO, Novation MAO, comps_used,
  confidence pill. The currently-viewed row gets an emerald background
  + a "viewing" badge. Each row links to that analysis. Hidden when
  fewer than 2 analyses exist (no value in showing a single row), and
  hidden in the print view.

Phase 16 (recompute trend deltas):
- `src/lib/comping/deltas.ts` — pure `computeDeltas(current, prev)`
  returns a sparse record (only changed keys). `deltaIsImprovement(key,
  diff)` knows that lower repairs are good but higher ARV / MAOs / As-Is
  / buying-pct are good. 9 unit tests covering null/missing prev,
  divide-by-zero, negative, no-change, NaN.
- Detail page loads the most recent prior `deal_analyses` row for the
  same `subject_id` (via `created_at < currentCreatedAt`) and renders
  small ↑/↓ pills next to ARV, As-Is, Repairs, Wholesale MAO, Novation
  MAO, Market-Adjusted MAO. Green when the delta improves the deal,
  red when it doesn't, gray when zero. Tooltip says "Change vs previous
  analysis for this subject". First-run analyses show no pills.

Phase 15 (file upload + bulk zip import):
- Migration 0011: a public `comp-photos` Supabase Storage bucket.
  Public so Claude vision can fetch URLs server-side and shared
  links display photos without auth. Server-side admin uploads
  bypass storage RLS; the API constructs paths as
  `<company_id>/<uuid>.<ext>` so each tenant lands in its own prefix.
- `POST /api/comp/upload-photo`: multipart upload, 5MB cap, image/*
  MIME allow-list (JPG / PNG / WebP / HEIC). Returns the public URL.
- Calculator form: "Upload photos" button alongside the URL textarea.
  Multi-file, accepts image/*, uploads each in turn, appends the
  resulting URLs into the same textarea so "Analyze photos" still
  works the same way.
- `POST /api/comp/warm/bulk`: accepts `{ rows: [{zip, state?, city?,
  priority?}] }`, up to 500 per call. Manager+ only. Per-row error
  reporting in the response.
- Warm queue page: collapsible "Bulk import zips" section. CSV paste
  with `zip,state,city,priority` per line, header row auto-skipped,
  zip validation, state UPPER-cased, priority clamped to [0,100].
  Result line shows added vs total + any per-row errors.
