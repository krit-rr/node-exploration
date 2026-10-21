-- Power-networker fields: where you met someone, and reconnect-queue snooze.
alter table public.contacts add column if not exists met_at text;
alter table public.contacts add column if not exists snoozed_until timestamptz;
