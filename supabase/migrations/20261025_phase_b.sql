-- Phase B: saved views and intro tracking.

-- Who made the introduction: the social-graph currency networkers trade in.
alter table public.contacts add column if not exists introduced_by text;

-- Named filter combinations, account-synced like groups.
create table if not exists public.views (
  owner_email text not null,
  id text not null,
  name text not null,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_email, id)
);

create index if not exists views_owner_idx on public.views (owner_email);

alter table public.views enable row level security;
