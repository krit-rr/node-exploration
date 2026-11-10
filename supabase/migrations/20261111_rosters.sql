-- Event rosters: the attendee list imported before an event, kept apart
-- from contacts until the user ticks who they actually met. Entries are
-- {email, name, company?, position?}. Same access model as contacts: RLS
-- on, no policies, service-role only. Without it the import falls back to
-- stamping everyone as met.
create table if not exists public.rosters (
  owner_email text not null,
  event text not null,
  entries jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_email, event)
);

alter table public.rosters enable row level security;
