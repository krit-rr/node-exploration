-- Landing-page waitlist table (written by the browser with the anon/
-- publishable key, so unlike every other table it needs an insert policy).
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  created_at timestamptz not null default now()
);

alter table public.waitlist enable row level security;

drop policy if exists "waitlist_public_insert" on public.waitlist;
create policy "waitlist_public_insert" on public.waitlist
  for insert to anon, authenticated with check (true);

-- Deliberately no select policy: sign-ups are write-only from the public site.
