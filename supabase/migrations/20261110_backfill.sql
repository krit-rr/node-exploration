-- Incremental backfill: how far back each mailbox has been read. The first
-- sync sees only the newest hundred sent emails; each visit then walks a few
-- pages further into the past and merges what it finds, and this row says
-- where to continue from. Same access model as contacts: RLS on, no
-- policies, service-role only. Without it the backfill route reports
-- persisted: false and nothing walks back.
create table if not exists public.sync_cursors (
  owner_email text not null,
  provider text not null,
  -- The oldest message read so far; the next page is everything older.
  before_time timestamptz,
  pages integer not null default 0,
  messages integer not null default 0,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_email, provider)
);

alter table public.sync_cursors enable row level security;
