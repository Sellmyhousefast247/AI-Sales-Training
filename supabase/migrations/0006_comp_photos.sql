-- Comp_records gains the rich fields we now persist:
--   list_price + original_list_price + dom_days  → non-disclosure-state
--                                                  imputation
--   remarks                                      → Claude text classifier
--   photo_urls                                   → Claude vision classifier

alter table public.comp_records
  add column if not exists list_price            numeric(12,2),
  add column if not exists original_list_price   numeric(12,2),
  add column if not exists dom_days              int,
  add column if not exists remarks               text,
  add column if not exists photo_urls            jsonb;
