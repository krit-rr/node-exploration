-- Server-side contact persistence for ntwrk.
-- Apply in the Supabase SQL editor (paste and run) or with `supabase db push`.
-- Until this migration is applied, the app runs in the old stateless mode
-- (API routes detect the missing table and fall back gracefully).

-- One row per (user, contact email). The row id is the contact's stable
-- identity; the email is the provider-facing key used for merge/upsert.
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  email text not null,
  name text not null default '',
  company text,
  industry text,
  last_contacted timestamptz,
  interactions jsonb not null default '[]',
  custom_fields jsonb not null default '[]',
  tags jsonb not null default '[]',
  notes text not null default '',
  is_spam boolean not null default false,
  source text,          -- 'google' | 'microsoft-entra-id' | 'csv_import'
  enriched_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_email, email)
);

create index if not exists contacts_owner_idx
  on public.contacts (owner_email);
create index if not exists contacts_owner_last_contacted_idx
  on public.contacts (owner_email, last_contacted desc);

-- RLS on with no policies: only the service-role key (server API routes)
-- can touch the table, same model as the embeddings tables.
alter table public.contacts enable row level security;
