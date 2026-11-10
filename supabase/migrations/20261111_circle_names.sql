-- Names for semantic circles, one model call each and never twice for the
-- same people: the cache is keyed by a hash of the sorted member list. Same
-- access model as contacts: RLS on, no policies, service-role only. Without
-- it circles are named by the heuristic (shared company, domain or event)
-- and the model is not called.
create table if not exists public.circle_names (
  owner_email text not null,
  members_hash text not null,
  name text not null,
  created_at timestamptz not null default now(),
  primary key (owner_email, members_hash)
);

alter table public.circle_names enable row level security;
