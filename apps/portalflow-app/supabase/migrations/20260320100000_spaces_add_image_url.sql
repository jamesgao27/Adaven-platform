-- Space custom icon image URL
-- Stored as a public Storage URL (e.g. receipts bucket)

alter table public.spaces
  add column if not exists image_url text;

