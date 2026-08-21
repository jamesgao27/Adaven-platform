-- Receipt items save failure: diagnostics + targeted fixes
-- Date: 2026-04-09
-- Usage:
--   1) Run "Part A" first and inspect result sets.
--   2) If usage_count columns are missing, run "Part B".
--   3) Optional: run "Part C" to backfill usage_count values.

-- ============================================================================
-- Part A: Diagnostics
-- ============================================================================

-- A1) receipt_items columns
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'receipt_items'
order by ordinal_position;

-- A2) receipt_items constraints
select
  c.conname as constraint_name,
  pg_get_constraintdef(c.oid) as definition
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'receipt_items'
order by c.conname;

-- A3) receipt_items triggers
select
  tgname as trigger_name,
  pg_get_triggerdef(oid) as trigger_def
from pg_trigger
where tgrelid = 'public.receipt_items'::regclass
  and not tgisinternal
order by tgname;

-- A4) verify usage_count columns required by trigger function
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('categories', 'attributions')
  and column_name = 'usage_count'
order by table_name;

-- A5) search function defs for legacy purpose_id references
-- NOTE:
--   Restrict to normal functions/procedures to avoid 42809 errors when
--   pg_get_functiondef is called on aggregate/window objects.
select
  n.nspname as schema_name,
  p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind in ('f', 'p')
  and pg_get_functiondef(p.oid) ilike '%purpose_id%'
order by p.proname;

-- ============================================================================
-- Part B: Targeted fix if trigger fails due to missing usage_count columns
-- ============================================================================

alter table public.categories
  add column if not exists usage_count integer not null default 0;

alter table public.attributions
  add column if not exists usage_count integer not null default 0;

-- B2) Compatibility fix: legacy function name may still exist in some projects.
--     Keep the function name, but make it operate on attributions (not purposes).
create or replace function public.update_all_purpose_usage_counts()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.attributions a
  set usage_count = coalesce(x.cnt, 0)
  from (
    select attribution_id, count(*)::int as cnt
    from public.receipt_items
    where attribution_id is not null
    group by attribution_id
  ) x
  where a.id = x.attribution_id;

  update public.attributions
  set usage_count = 0
  where usage_count is null;
end;
$$;

-- ============================================================================
-- Part C (optional): Backfill usage_count values from existing receipt_items
-- ============================================================================

update public.categories c
set usage_count = coalesce(x.cnt, 0)
from (
  select category_id, count(*)::int as cnt
  from public.receipt_items
  where category_id is not null
  group by category_id
) x
where c.id = x.category_id;

update public.categories
set usage_count = 0
where usage_count is null;

update public.attributions a
set usage_count = coalesce(x.cnt, 0)
from (
  select attribution_id, count(*)::int as cnt
  from public.receipt_items
  where attribution_id is not null
  group by attribution_id
) x
where a.id = x.attribution_id;

update public.attributions
set usage_count = 0
where usage_count is null;
