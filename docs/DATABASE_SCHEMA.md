# Database Schema

Postgres on Supabase. All tenant tables carry `company_id uuid not null`. RLS policies enforce isolation against `auth.jwt() ->> 'company_id'`.

## Conventions
- Primary keys: `uuid` defaulting to `gen_random_uuid()`
- Timestamps: `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger-maintained)
- Soft delete: `deleted_at timestamptz` on tenant tables
- Money: `numeric(12,2)` (cents handled by app where needed)
- Score values: `numeric(4,2)` (allows 0.00–10.00 with 2 decimals)

## ERD (logical)

```
companies ─┬─< users
           ├─< teams
           ├─< reps ─< calls ─┬─< transcripts
           │                  └─< scorecards ─< step_scores
           │                                  └─< coaching_notes
           ├─< tier_history (rep_id)
           ├─< incentive_rules
           ├─< incentives (rep_id, period)
           ├─< scripts
           ├─< objections
           ├─< coaching_patterns
           ├─< company_settings (1:1)
           ├─< integrations
           ├─< reports
           ├─< subscriptions
           └─< audit_logs
```

> Migration `0003_road_to_a_deal.sql` (V3.8 / Road to a Deal refactor):
> - Renamed `category_scores` → `step_scores`; new step enum (`rapport`,
>   `motivation`, `asking_price`, `trial_close_1`, `first_hold`, `anchor`,
>   `negotiation`, `trial_close_2`, `second_hold`, `approval_close`)
> - Step `score` constrained to `{0, 5, 10}`
> - Dropped `discovery_checks` (replaced by structured `areas_for_improvement`
>   and Motivation step scoring)
> - Added to `scorecards`: `final_score`, `critical_breakpoint_json`,
>   `what_was_done_well`, `areas_for_improvement_json`,
>   `missed_opportunities_json`, `improved_call_flow_summary`
> - Added to `company_settings`: `script_name`, `script_version`,
>   `script_content` — the master script (e.g. "2026 ACQ Closer Manual
>   V3.8") that gets injected into every scoring prompt.

## Tables

### companies
The tenant root.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | |
| slug | text unique not null | URL slug |
| owner_user_id | uuid | references users(id) — nullable on bootstrap |
| logo_url | text | |
| primary_color | text | hex, default #0F172A |
| timezone | text not null default 'America/New_York' | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz | |

### users
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | matches Supabase auth.users.id |
| company_id | uuid | nullable for super_admin |
| email | text unique not null | |
| full_name | text | |
| role | text check in ('super_admin','company_admin','manager','rep') | |
| team_id | uuid | references teams(id) |
| is_active | bool default true | |
| last_login_at | timestamptz | |
| created_at, updated_at, deleted_at | | |

### teams
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| name | text not null | |
| manager_user_id | uuid | |
| created_at, updated_at, deleted_at | | |

### reps
A rep is the *performer* identity. Usually 1:1 with a user, but reps can exist without a login (e.g. shared seat) and be retired without losing history.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| user_id | uuid | nullable; links to users(id) |
| full_name | text not null | |
| team_id | uuid | |
| role_title | text | e.g. "Acquisitions Manager" |
| hire_date | date | |
| current_tier | int | 1–5, computed cache |
| current_avg_score | numeric(4,2) | computed cache |
| is_active | bool default true | |
| created_at, updated_at, deleted_at | | |

Index: `(company_id, is_active)`.

### calls
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| rep_id | uuid not null | |
| call_datetime | timestamptz not null | |
| seller_name | text | |
| seller_phone | text | |
| property_address | text | |
| lead_source | text | |
| call_type | text check in ('inbound','outbound','follow_up','offer','negotiation','closing') | |
| recording_path | text | Supabase Storage path |
| recording_duration_sec | int | |
| transcript_status | text check in ('pending','transcribing','ready','failed') default 'pending' | |
| scoring_status | text check in ('pending','scoring','scored','failed','manual') default 'pending' | |
| deal_outcome | text check in ('contract','appointment','offer_made','follow_up','dead','unknown') default 'unknown' | |
| next_step | text | |
| imported_from | text | provider name if from integration |
| external_id | text | provider's id |
| created_by_user_id | uuid | |
| created_at, updated_at, deleted_at | | |

Indexes: `(company_id, call_datetime desc)`, `(company_id, rep_id, call_datetime desc)`, unique `(company_id, imported_from, external_id)`.

### transcripts
Split from `calls` so we can lazy-load and partition by month if volume grows.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| call_id | uuid unique not null | |
| company_id | uuid not null | denormalized for RLS |
| content | text not null | full transcript |
| speakers | jsonb | diarization output: `[{speaker:'rep'|'seller', start, end, text}]` |
| word_count | int | |
| rep_word_share | numeric(4,3) | 0.000–1.000, computed |
| source | text check in ('paste','deepgram','whisper','provider') | |
| created_at, updated_at | | |

### scorecards
1:1 with calls but separate row so re-scoring keeps history (mark old `is_current=false`).
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| call_id | uuid not null | |
| company_id | uuid not null | |
| rep_id | uuid not null | |
| model | text not null | e.g. 'claude-sonnet-4-6' |
| prompt_version | text not null | semver of prompt |
| total_score | numeric(5,2) | 0–100 |
| average_score | numeric(4,2) | 0–10 |
| tier_before | int | |
| tier_after_projection | int | |
| biggest_mistake | text | |
| best_moment | text | |
| missed_opportunity | text | |
| should_have_said | text | |
| suggested_followup_sms | text | |
| suggested_followup_email | text | |
| coaching_notes_manager | text | |
| coaching_notes_rep | text | rep-friendly voice |
| deal_risk | text check in ('low','medium','high') | |
| conversion_probability | int check between 0 and 100 | |
| recommended_next_action | text | |
| raw_response | jsonb | full LLM response for audit |
| input_tokens | int | |
| output_tokens | int | |
| cost_usd | numeric(8,4) | |
| is_current | bool default true | |
| scored_by_user_id | uuid | null = AI; set if manually overridden |
| created_at, updated_at | | |

Index: `(company_id, rep_id, created_at desc) where is_current`.

### category_scores
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| scorecard_id | uuid not null | |
| company_id | uuid not null | |
| category | text check in ('opening_tone','rapport_building','discovery','question_quality','call_control','objection_handling','value_positioning','offer_delivery','closing_ability','conversion_likelihood') | |
| score | numeric(4,2) not null | 0–10 |
| justification | text | |
| supporting_quote | text | |
| created_at | | |

Unique `(scorecard_id, category)`.

### discovery_checks
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| scorecard_id | uuid not null | |
| company_id | uuid not null | |
| check_key | text check in ('motivation','timeline','condition','price_expectation','equity_mortgage','decision_makers','urgency','pain_points','preferred_outcome') | |
| was_uncovered | bool not null | |
| evidence_quote | text | |
| created_at | | |

Unique `(scorecard_id, check_key)`.

### coaching_notes
Free-form notes — both AI-generated and manager-written. Per-call coaching lives on `scorecards`; this table is for ad-hoc and weekly notes attached to a rep.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| rep_id | uuid not null | |
| scorecard_id | uuid | nullable |
| author_user_id | uuid | null = AI |
| kind | text check in ('per_call','weekly_plan','manager_note','pattern') | |
| body | text not null | |
| pattern_key | text | e.g. 'avoids_price', 'no_close_ask' |
| is_acknowledged | bool default false | rep checks off |
| created_at, updated_at | | |

### tier_history
Append-only.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| rep_id | uuid not null | |
| old_tier | int | |
| new_tier | int | |
| avg_score_at_change | numeric(4,2) | |
| window_used | text | 'last_10' / 'last_30d' / 'all_time' |
| reason | text | |
| created_at | | |

### incentive_rules
Per-company JSON config.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| name | text not null | |
| rules_json | jsonb not null | see below |
| effective_from | date not null | |
| effective_to | date | nullable = current |
| created_by_user_id | uuid | |
| created_at, updated_at | | |

`rules_json` shape:
```json
{
  "weekly_bonus": [
    {"tier": 2, "amount": 100, "min_calls": 30},
    {"tier": 3, "amount": 200, "min_calls": 30},
    {"tier": 4, "amount": 350, "min_calls": 25},
    {"tier": 5, "amount": 500, "min_calls": 20}
  ],
  "monthly_bonus": [
    {"tier": 4, "amount": 1000},
    {"tier": 5, "amount": 2500}
  ],
  "awards": {
    "most_improved": 250,
    "highest_avg": 250,
    "most_contracts": 500,
    "best_discovery": 100,
    "best_closing": 100,
    "coaching_completion": 100
  }
}
```

### incentives
Materialized eligibility per rep per period.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| rep_id | uuid not null | |
| period_kind | text check in ('week','month') | |
| period_start | date not null | |
| period_end | date not null | |
| weekly_bonus_amount | numeric(12,2) default 0 | |
| monthly_bonus_amount | numeric(12,2) default 0 | |
| awards_json | jsonb default '[]' | list of `{key, amount}` |
| total_amount | numeric(12,2) default 0 | |
| status | text check in ('projected','approved','paid','withheld') default 'projected' | |
| approved_by_user_id | uuid | |
| approved_at | timestamptz | |
| created_at, updated_at | | |

Unique `(rep_id, period_kind, period_start)`.

### scripts
Library — by call_type and lead_source.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| name | text not null | |
| call_type | text | |
| lead_source | text | |
| body | text not null | |
| version | int default 1 | |
| is_active | bool default true | |
| created_at, updated_at | | |

### objections
Library of common objections with golden responses.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| key | text not null | e.g. 'need_to_think_about_it' |
| label | text not null | |
| ideal_response | text not null | |
| created_at, updated_at | | |
Unique `(company_id, key)`.

### coaching_patterns
Catalog of detectable rep patterns (seeded by us, customizable per company).
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid | null = global default |
| key | text not null | |
| label | text not null | |
| detector_prompt | text | description fed to detector LLM |
| recommended_drill | text | |
| created_at, updated_at | | |

### company_settings
1:1 with companies.
| Column | Type | Notes |
|---|---|---|
| company_id | uuid PK | |
| rolling_window | text check in ('last_10','last_30d','all_time') default 'last_10' | |
| min_calls_to_leave_tier1 | int default 5 | |
| tier_thresholds_json | jsonb | overrides defaults |
| category_weights_json | jsonb | overrides equal weighting |
| scorecard_preset | text default 'rei_default' | |
| monthly_token_budget | int | nullable = unlimited |
| pii_redact_on_export | bool default false | |
| updated_at | | |

### integrations
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| provider | text check in ('gohighlevel','wavv','smrtphone','dialpad','aircall','zapier','n8n','webhook','google_sheets') | |
| credentials_encrypted | bytea | encrypted with platform KMS |
| config_json | jsonb | |
| is_active | bool default true | |
| last_sync_at | timestamptz | |
| created_at, updated_at | | |

### reports
Generated artifacts.
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid not null | |
| kind | text check in ('daily_manager','weekly_rep','weekly_company','monthly_incentive','quarterly_improvement') | |
| target_user_id | uuid | rep or manager the report is for |
| period_start | date | |
| period_end | date | |
| html_path | text | |
| pdf_path | text | |
| csv_path | text | |
| sent_at | timestamptz | |
| created_at | | |

### subscriptions (V2)
| Column | Type | Notes |
|---|---|---|
| company_id | uuid PK | |
| stripe_customer_id | text | |
| stripe_subscription_id | text | |
| plan | text | starter / growth / scale / enterprise |
| status | text | |
| current_period_end | timestamptz | |
| seats | int | |
| call_quota | int | |
| created_at, updated_at | | |

### audit_logs
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid | |
| actor_user_id | uuid | |
| action | text not null | e.g. 'scorecard.created' |
| target_table | text | |
| target_id | uuid | |
| metadata_json | jsonb | |
| ip_address | inet | |
| created_at | | |

Index: `(company_id, created_at desc)`.

## RLS policy template

Every tenant table:

```sql
alter table <t> enable row level security;

create policy "tenant_read" on <t>
  for select using (
    company_id = (auth.jwt() ->> 'company_id')::uuid
    or (auth.jwt() ->> 'role') = 'super_admin'
  );

create policy "tenant_write" on <t>
  for all using (
    company_id = (auth.jwt() ->> 'company_id')::uuid
    or (auth.jwt() ->> 'role') = 'super_admin'
  ) with check (
    company_id = (auth.jwt() ->> 'company_id')::uuid
    or (auth.jwt() ->> 'role') = 'super_admin'
  );
```

Role-specific policies layer on top — e.g. reps can only `select` calls where `rep_id` matches their own `rep_id` (joined via `users.id` → `reps.user_id`).

## Indexes worth calling out
- `calls (company_id, call_datetime desc)` — dashboard recency lookups
- `scorecards (company_id, rep_id, created_at desc) where is_current` — rep profile trend
- `category_scores (scorecard_id, category)` — aggregate by category
- `tier_history (rep_id, created_at desc)` — tier timeline
- `audit_logs (company_id, created_at desc)` — admin audit page

## Migration files
- `0001_initial_schema.sql` — tables, RLS, triggers, defaults
- `0002_seed.sql` — seed coaching_patterns + objections + scripts (global defaults)
- `0003_demo_company.sql` — optional demo data, not run in production
