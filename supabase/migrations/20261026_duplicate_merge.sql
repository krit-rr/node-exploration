-- Duplicate merge: one person who exists under two addresses.
-- Apply in the Supabase SQL editor (paste and run) or with `supabase db push`.
--
-- A merged contact keeps its duplicate's address(es) in alt_emails so later
-- provider syncs and CSV imports route activity on either address to the
-- surviving row instead of resurrecting the deleted duplicate.
alter table public.contacts
  add column if not exists alt_emails jsonb not null default '[]';
