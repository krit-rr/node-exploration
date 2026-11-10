-- Tie strength that learns. Every action that says who matters (a logged
-- touch, a key-contact tag, an inner-ring intent) or does not (a snooze, a
-- spam flag) is a label, kept with the features of the relationship at
-- that moment; a per-user logistic model takes one gradient step per label
-- and is read back wherever closeness is computed. Same access model as
-- contacts: RLS on, no policies, service-role only. Without these tables
-- nothing is recorded and the built-in rule stands.
create table if not exists public.relationship_labels (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  contact_email text not null,
  label smallint not null,
  source text not null,
  features jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists relationship_labels_owner_idx
  on public.relationship_labels (owner_email, created_at desc);

create table if not exists public.tie_models (
  owner_email text primary key,
  weights jsonb not null default '{}',
  bias double precision not null default 0,
  labels integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.relationship_labels enable row level security;
alter table public.tie_models enable row level security;
