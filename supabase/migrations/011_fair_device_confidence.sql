-- Privacy-preserving, confidence-based device continuity.
-- Only irreversible component hashes are stored; raw GPU, canvas, audio,
-- user-agent and IP addresses are never persisted. City is retained only as
-- coarse server-derived audit metadata for the authenticated admin report.

alter table public.orders
  add column if not exists free_resets_remaining integer not null default 1,
  add column if not exists device_physical_signals jsonb,
  add column if not exists trusted_browser_hashes jsonb not null default '[]'::jsonb,
  add column if not exists registered_city_hash text,
  add column if not exists registered_city_name text,
  add column if not exists registered_country_code text,
  add column if not exists device_last_seen_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_free_resets_remaining_check') then
    alter table public.orders add constraint orders_free_resets_remaining_check
      check (free_resets_remaining between 0 and 1);
  end if;
end $$;

create table if not exists public.device_access_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  physical_core_hash text not null,
  browser_dna_hash text,
  device_name text,
  city_hash text,
  city_name text,
  country_code text,
  decision text not null,
  confidence numeric(4,3),
  occurred_at timestamptz not null default now()
);

create index if not exists device_access_events_order_time_idx
  on public.device_access_events(order_id, occurred_at desc);

alter table public.device_access_events enable row level security;

create or replace function public.claim_free_device_reset(
  p_order_id uuid, p_new_core_hash text, p_new_browser_hash text,
  p_new_device_name text, p_new_signals jsonb, p_city_hash text, p_city_name text, p_country_code text
) returns table(success boolean, remaining integer)
language plpgsql security definer set search_path = public as $$
declare v_old_name text; v_remaining integer;
begin
  select locked_device_name into v_old_name from public.orders where id = p_order_id for update;
  update public.orders set
    locked_device_fingerprint_hash = p_new_core_hash,
    locked_device_name = left(p_new_device_name, 80),
    device_physical_signals = p_new_signals,
    trusted_browser_hashes = jsonb_build_array(p_new_browser_hash),
    registered_city_hash = p_city_hash,
    registered_city_name = left(p_city_name, 100),
    registered_country_code = left(p_country_code, 8),
    device_last_seen_at = now(),
    free_resets_remaining = free_resets_remaining - 1,
    device_transfer_count = device_transfer_count + 1,
    updated_at = now()
  where id = p_order_id and free_resets_remaining > 0
  returning free_resets_remaining into v_remaining;
  if not found then return query select false, 0; return; end if;
  insert into public.device_transfer_requests(order_id, old_device_name, status, requested_at, reviewed_at)
  values (p_order_id, v_old_name, 'completed', now(), now());
  return query select true, v_remaining;
end $$;

create or replace function public.record_confirmed_device_abuse(
  p_order_id uuid, p_reason text
) returns table(security_strikes integer, suspended boolean)
language plpgsql security definer set search_path = public as $$
declare v_strikes integer;
begin
  update public.orders as target set
    security_strikes = case when target.status::text = 'suspended_security' then target.security_strikes else target.security_strikes + 1 end,
    status = 'suspended_security',
    updated_at = now()
  where target.id = p_order_id returning target.security_strikes into v_strikes;
  insert into public.audit_logs(actor_type, action, entity_type, entity_id, metadata)
  values ('system', 'confirmed_device_abuse', 'order', p_order_id,
    jsonb_build_object('reason', left(p_reason, 80), 'strike', v_strikes));
  return query select v_strikes, true;
end $$;

revoke all on function public.claim_free_device_reset(uuid, text, text, text, jsonb, text, text, text) from public;
revoke all on function public.record_confirmed_device_abuse(uuid, text) from public;
revoke all on public.device_access_events from public;

