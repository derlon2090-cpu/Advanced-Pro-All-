-- Stable Salla product identity, public maintenance banner, and duration-aware ingestion.
-- Product matching is based on Salla's immutable product ID/SKU, never title text.

create table if not exists public.salla_product_mappings (
  id uuid primary key default gen_random_uuid(),
  salla_product_id text not null unique,
  product_title text,
  service_type public.service_category_enum not null,
  duration_days integer not null default 30 check (duration_days > 0 and duration_days <= 3660),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  singleton boolean primary key default true check (singleton),
  banner_active boolean not null default false,
  banner_message text,
  auto_assignment_paused boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.system_settings (singleton) values (true) on conflict (singleton) do nothing;

alter table public.salla_product_mappings enable row level security;
alter table public.system_settings enable row level security;

create or replace function public.ingest_salla_paid_order(
  p_event_id text, p_merchant_id text, p_store_name text, p_order_id text,
  p_order_number text, p_customer_id text, p_customer_name text, p_customer_phone text,
  p_product_name text, p_service_type public.service_category_enum, p_duration_days integer default 30
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_customer_id uuid; v_order_id uuid; v_duration integer := greatest(coalesce(p_duration_days, 30), 1);
begin
  insert into public.webhook_receipts(source, event_id) values ('salla', p_event_id)
  on conflict(source, event_id) do nothing;
  if not found then
    select o.id into v_order_id from public.orders o where o.salla_event_id = p_event_id;
    return v_order_id;
  end if;
  insert into public.stores(salla_merchant_id, name) values (p_merchant_id, coalesce(p_store_name, 'Salla'))
  on conflict(salla_merchant_id) do update set name = excluded.name returning id into v_store_id;
  insert into public.customers(store_id, salla_customer_id, name) values (v_store_id, p_customer_id, p_customer_name)
  on conflict(store_id, salla_customer_id) do update set name = excluded.name returning id into v_customer_id;
  insert into public.orders(store_id, customer_id, salla_order_id, order_number, product_name, payment_status, status,
    access_token_hash, access_token_expires_at, salla_reference_id, salla_event_id, service_type, customer_phone,
    duration_days, starts_at, expires_at, warranty_expires_at)
  values (v_store_id, v_customer_id, p_order_id, p_order_number, p_product_name, 'paid', 'received',
    encode(digest(gen_random_bytes(32), 'sha256'), 'hex'), now() + interval '30 days', p_order_id, p_event_id,
    p_service_type, p_customer_phone, v_duration, now(), now() + make_interval(days => v_duration), now() + make_interval(days => v_duration))
  on conflict(store_id, salla_order_id) do update set updated_at = now()
  returning id into v_order_id;
  return v_order_id;
end $$;

revoke all on public.salla_product_mappings from public;
revoke all on public.system_settings from public;
revoke all on function public.ingest_salla_paid_order(text, text, text, text, text, text, text, text, text, public.service_category_enum, integer) from public;
