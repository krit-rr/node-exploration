-- Memory: what Node has read out of the mail about one contact. A short
-- summary of what the relationship is about and what changed lately, plus
-- the promises that look unresolved (open loops), with the hash of the
-- interactions it was read from so unchanged history never costs another
-- model call. Written only by POST /api/contacts/memory. Apply in the
-- Supabase SQL editor or with `supabase db push`; pre-migration databases
-- keep working and the route reports persisted: false.
alter table public.contacts
  add column if not exists memory jsonb;
