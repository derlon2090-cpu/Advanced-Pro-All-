-- Security-first device continuity and transfer review.
-- This schema intentionally does not store credentials, OTPs, approval links,
-- raw email content, or screenshots.

alter table public.orders
  add column if not exists locked_device_fingerprint_hash text,
  add column if not exists locked_device_name text,
  add column if not exists device_transfer_count integer not null default 0,
  add column if not exists device_transfer_locked_until timestamptz,
  add column if not exists active_login_window_until timestamptz;

create type public.device_transfer_status as enum ('pending', 'approved', 'rejected', 'completed');

create table if not exists public.device_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  old_device_name text,
  status public.device_transfer_status not null default 'pending',
  admin_note text,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);

create index if not exists device_transfer_requests_order_status_idx
  on public.device_transfer_requests(order_id, status, requested_at desc);

alter table public.device_transfer_requests enable row level security;

-- Access is intentionally server-mediated. Do not add public policies that
-- reveal other customers' requests or device metadata.
