-- Name rehearsal schedule: when a contact's card is due again, which
-- interval step it has reached and how many times it was rehearsed.
-- Written only by POST /api/contacts/rehearsal. Apply in the Supabase SQL
-- editor or with `supabase db push`; pre-migration databases keep working
-- and the route reports persisted: false.
alter table public.contacts
  add column if not exists rehearsal jsonb;
