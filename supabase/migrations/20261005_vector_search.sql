-- Vector search for ntwrk: contact and interaction embeddings.
-- Apply in the Supabase SQL editor (paste and run) or with `supabase db push`.
-- Requires the pgvector extension, available on all Supabase plans.

create extension if not exists vector;

-- One row per (user, contact). content is the exact text that was embedded;
-- content_hash lets the sync endpoint skip contacts that have not changed.
create table if not exists public.contact_embeddings (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  contact_email text not null,
  content text not null,
  content_hash text not null,
  embedding vector(1536) not null,
  updated_at timestamptz not null default now(),
  unique (owner_email, contact_email)
);

-- Many rows per (user, contact): one per distinct email subject/snippet.
-- The content_hash in the unique constraint deduplicates re-synced messages.
create table if not exists public.interaction_embeddings (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  contact_email text not null,
  interaction_date timestamptz,
  channel text,
  content text not null,
  content_hash text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  unique (owner_email, contact_email, content_hash)
);

create index if not exists contact_embeddings_owner_idx
  on public.contact_embeddings (owner_email);
create index if not exists interaction_embeddings_owner_idx
  on public.interaction_embeddings (owner_email, contact_email);

create index if not exists contact_embeddings_vec_idx
  on public.contact_embeddings using hnsw (embedding vector_cosine_ops);
create index if not exists interaction_embeddings_vec_idx
  on public.interaction_embeddings using hnsw (embedding vector_cosine_ops);

-- RLS on with no policies: the anon key (used client-side by the waitlist
-- form) can never read or write these tables. Only the service role key,
-- used exclusively by server-side API routes, bypasses RLS.
alter table public.contact_embeddings enable row level security;
alter table public.interaction_embeddings enable row level security;

create or replace function public.match_contacts(
  p_owner text,
  p_query vector(1536),
  p_count int default 20,
  p_min_similarity float default 0.0
)
returns table (contact_email text, content text, similarity float)
language sql stable
as $$
  select ce.contact_email,
         ce.content,
         1 - (ce.embedding <=> p_query) as similarity
  from public.contact_embeddings ce
  where ce.owner_email = p_owner
    and 1 - (ce.embedding <=> p_query) >= p_min_similarity
  order by ce.embedding <=> p_query
  limit p_count;
$$;

create or replace function public.match_interactions(
  p_owner text,
  p_query vector(1536),
  p_contact text default null,
  p_count int default 20,
  p_min_similarity float default 0.0
)
returns table (
  contact_email text,
  content text,
  interaction_date timestamptz,
  channel text,
  similarity float
)
language sql stable
as $$
  select ie.contact_email,
         ie.content,
         ie.interaction_date,
         ie.channel,
         1 - (ie.embedding <=> p_query) as similarity
  from public.interaction_embeddings ie
  where ie.owner_email = p_owner
    and (p_contact is null or ie.contact_email = p_contact)
    and 1 - (ie.embedding <=> p_query) >= p_min_similarity
  order by ie.embedding <=> p_query
  limit p_count;
$$;

-- Nearest neighbors of an existing contact's embedding: no model call needed.
create or replace function public.similar_contacts(
  p_owner text,
  p_contact text,
  p_count int default 10
)
returns table (contact_email text, content text, similarity float)
language sql stable
as $$
  select o.contact_email,
         o.content,
         1 - (o.embedding <=> s.embedding) as similarity
  from public.contact_embeddings s
  join lateral (
    select ce.contact_email, ce.content, ce.embedding
    from public.contact_embeddings ce
    where ce.owner_email = p_owner
      and ce.contact_email <> s.contact_email
    order by ce.embedding <=> s.embedding
    limit p_count
  ) o on true
  where s.owner_email = p_owner
    and s.contact_email = p_contact;
$$;
