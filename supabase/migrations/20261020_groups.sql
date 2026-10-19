-- Server-side groups so they follow the account across devices.
-- Same access model as contacts: RLS on, no policies, service-role only.
create table if not exists public.groups (
  owner_email text not null,
  id text not null,          -- client-generated id, stable across devices
  name text not null,
  members jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_email, id)
);

create index if not exists groups_owner_idx on public.groups (owner_email);

alter table public.groups enable row level security;
