-- Add independent user/space logo URL fields

alter table public.spaces
  add column if not exists logo_url text;

alter table public.users
  add column if not exists logo_url text;

