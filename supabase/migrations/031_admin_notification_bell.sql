-- In-dashboard operational alerts; no external messaging service is required.
create table if not exists public.admin_notifications (
  id bigint generated always as identity primary key,
  dedupe_key text not null unique,
  severity text not null default 'info' check (severity in ('info','warning','critical','success')),
  title text not null,
  message text not null,
  source text not null default 'system',
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists admin_notifications_unread_idx on public.admin_notifications(created_at desc) where read_at is null;
alter table public.admin_notifications enable row level security;
revoke all on public.admin_notifications from public;
