-- High-load indexes and durable webhook idempotency.
-- These statements use the existing normalized schema rather than adding
-- denormalized account/category fields to unrelated tables.

alter table public.orders
  add column if not exists tracking_token text,
  add column if not exists salla_reference_id text,
  add column if not exists salla_event_id text;

create unique index if not exists orders_tracking_token_key
  on public.orders(tracking_token) where tracking_token is not null;
create unique index if not exists orders_salla_reference_id_key
  on public.orders(salla_reference_id) where salla_reference_id is not null;
create unique index if not exists orders_salla_event_id_key
  on public.orders(salla_event_id) where salla_event_id is not null;
create index if not exists orders_tracking_token_lookup_idx
  on public.orders(tracking_token, created_at desc) where tracking_token is not null;
create index if not exists assignments_account_active_idx
  on public.account_assignments(email_account_id, assigned_at desc)
  where released_at is null;
create index if not exists security_notifications_order_created_idx
  on public.security_notifications(order_id, created_at desc);
create index if not exists incoming_messages_account_category_created_idx
  on public.incoming_messages(email_account_id, classification, created_at desc);

create table if not exists public.webhook_receipts (
  id bigint generated always as identity primary key,
  source text not null check (source in ('email', 'salla')),
  event_id text not null,
  received_at timestamptz not null default now(),
  unique(source, event_id)
);

alter table public.webhook_receipts enable row level security;
-- Webhook receipt writes must use a server-side service credential only.
