-- Customer-controlled renewal reminder address and durable lookup abuse limits.

alter table public.orders
  add column if not exists reminder_email text,
  add column if not exists reminder_subscribed_at timestamptz,
  add column if not exists reminder_consent_ip_hash text;

create table if not exists public.public_lookup_limits (
  ip_hash text primary key,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists public_lookup_limits_cleanup_idx
  on public.public_lookup_limits(updated_at);

alter table public.public_lookup_limits enable row level security;
revoke all on public.public_lookup_limits from public;

