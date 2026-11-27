-- Strict browser binding, geo continuity, and short-lived service re-auth windows.

alter table public.orders
  add column if not exists device_bind_token_hash text,
  add column if not exists locked_browser_fingerprint_hash text,
  add column if not exists locked_browser_family text,
  add column if not exists locked_os_name text;

create table if not exists public.service_reauth_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  email_account_id uuid references public.email_accounts(id) on delete cascade,
  service_type text not null,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists service_reauth_order_started_idx
  on public.service_reauth_sessions(order_id, started_at desc);
create index if not exists service_reauth_account_started_idx
  on public.service_reauth_sessions(email_account_id, started_at desc);

alter table public.service_reauth_sessions enable row level security;
revoke all on public.service_reauth_sessions from public;

create or replace function public.admin_reset_order_device(
  p_order_id uuid, p_restore_free_reset boolean default true
) returns table(success boolean, free_resets_remaining integer)
language plpgsql security definer set search_path = public as $$
declare v_remaining integer;
begin
  update public.orders as target set
    locked_device_fingerprint_hash = null,
    locked_device_name = null,
    device_physical_signals = null,
    trusted_browser_hashes = '[]'::jsonb,
    device_bind_token_hash = null,
    locked_browser_fingerprint_hash = null,
    locked_browser_family = null,
    locked_os_name = null,
    registered_city_hash = null,
    registered_city_name = null,
    registered_country_code = null,
    device_last_seen_at = null,
    device_transfer_locked_until = null,
    active_login_window_until = null,
    security_strikes = 0,
    free_resets_remaining = case when p_restore_free_reset then 1 else target.free_resets_remaining end,
    status = case when target.status::text = 'suspended_security' then 'delivered'::public.order_status else target.status end,
    updated_at = now()
  where target.id = p_order_id
  returning target.free_resets_remaining into v_remaining;

  if not found then return query select false, 0; return; end if;
  update public.service_reauth_sessions set closed_at = now()
  where order_id = p_order_id and closed_at is null;
  insert into public.audit_logs(actor_type, action, entity_type, entity_id, metadata)
  values ('admin', 'strict_browser_device_reset', 'order', p_order_id,
    jsonb_build_object('restored_free_reset', p_restore_free_reset));
  return query select true, v_remaining;
end $$;

revoke all on function public.admin_reset_order_device(uuid, boolean) from public;
