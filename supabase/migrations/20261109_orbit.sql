-- Orbit: where the user wants a contact to sit, 1 (the closest five) to 4
-- (the 150). Null means "wherever activity puts them". Set from the orbit
-- map by dragging a dot inward or outward; the reconnect queue treats 1
-- and 2 as priority. Apply in the Supabase SQL editor or with
-- `supabase db push`. Pre-migration databases keep working: the store
-- strips the column and retries, and the route reports persisted: false.
alter table public.contacts
  add column if not exists intended_layer smallint
  check (intended_layer is null or intended_layer between 1 and 4);
