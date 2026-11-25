-- Single-use device challenges, fair two-strike suspension, and audited admin reset.

create table if not exists public.device_verification_nonces (
  nonce_hash text primary key,
  tracking_token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists device_verification_nonces_expiry_idx
  on public.device_verification_nonces(expires_at);

alter table public.device_verification_nonces enable row level security;

create or replace function public.record_confirmed_device_abuse(
  p_order_id uuid, p_reason text
) returns table(security_strikes integer, suspended boolean)
language plpgsql security definer set search_path = public as $$
declare v_strikes integer; v_suspended boolean;
begin
  update public.orders as target set
    security_strikes = target.security_strikes + 1,
    status = case
      when target.security_strikes + 1 >= 2 then 'suspended_security'::public.order_status
      else target.status
    end,
    updated_at = now()
  where target.id = p_order_id
  returning target.security_strikes, target.status::text = 'suspended_security'
  into v_strikes, v_suspended;

  if not found then raise exception 'order not found'; end if;

  insert into public.audit_logs(actor_type, action, entity_type, entity_id, metadata)
  values ('system', 'confirmed_device_abuse', 'order', p_order_id,
    jsonb_build_object('reason', left(p_reason, 80), 'strike', v_strikes, 'suspended', v_suspended));

  return query select v_strikes, v_suspended;
end $$;

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

  insert into public.audit_logs(actor_type, action, entity_type, entity_id, metadata)
  values ('admin', 'device_reset', 'order', p_order_id,
    jsonb_build_object('restored_free_reset', p_restore_free_reset));

  return query select true, v_remaining;
end $$;

create or replace function public.cleanup_expired_device_nonces()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  delete from public.device_verification_nonces
  where expires_at < now() - interval '5 minutes'
     or (used_at is not null and used_at < now() - interval '1 day');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on public.device_verification_nonces from public;
revoke all on function public.record_confirmed_device_abuse(uuid, text) from public;
revoke all on function public.admin_reset_order_device(uuid, boolean) from public;
revoke all on function public.cleanup_expired_device_nonces() from public;
