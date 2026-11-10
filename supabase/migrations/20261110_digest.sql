-- Weekly digest subscribers: who asked for the Monday email. Opt-in only;
-- the send route mails these rows and nobody else. Same access model as
-- contacts: RLS on, no policies, service-role only. Apply in the Supabase
-- SQL editor or with `supabase db push`; without it the toggle reports
-- persisted: false and nothing is sent.
create table if not exists public.digest_subscribers (
  owner_email text primary key,
  enabled boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.digest_subscribers enable row level security;
