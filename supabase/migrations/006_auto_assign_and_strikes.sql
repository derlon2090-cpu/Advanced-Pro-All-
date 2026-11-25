-- Automated order assignment, security strikes, and operational capacity.
-- This migration deliberately stores no provider credentials, OTPs, or email bodies.

alter type public.order_status add value if not exists 'pending_assignment';
alter type public.order_status add value if not exists 'suspended_security';

alter table public.orders
  add column if not exists security_strikes integer not null default 0 check (security_strikes >= 0),
  add column if not exists assignment_pending_at timestamptz;

alter table public.email_accounts
  add column if not exists password_updated_at timestamptz;

-- Assigns exactly one open seat. The account row is locked with SKIP LOCKED,
-- so concurrent webhook deliveries cannot consume the same final seat.
create or replace function public.assign_order_to_available_account(p_order_id uuid)
returns table (assigned boolean, email_account_id uuid, tracking_token text)
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_account_id uuid;
  v_token text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;

  select ea.id into v_account_id
  from public.email_accounts ea
  where ea.store_id = v_order.store_id
    and ea.service_type = v_order.service_type
    and ea.is_active
    and (select count(*) from public.account_assignments aa
         where aa.email_account_id = ea.id and aa.released_at is null) < ea.max_slots
  order by ea.created_at asc
  for update of ea skip locked
  limit 1;

  if v_account_id is null then
    -- Dynamic SQL delays resolving the new enum label until this migration has
    -- committed (PostgreSQL does not permit using a freshly added enum label
    -- inside the same migration transaction).
    execute 'update public.orders set status = ''pending_assignment'', assignment_pending_at = now(), updated_at = now() where id = $1'
      using p_order_id;
    return query select false, null::uuid, null::text;
    return;
  end if;

  insert into public.account_assignments (order_id, email_account_id)
  values (p_order_id, v_account_id)
  on conflict (order_id) do nothing;

  select coalesce(o.tracking_token, encode(gen_random_bytes(24), 'hex')) into v_token
  from public.orders o where o.id = p_order_id;
  update public.orders
    set tracking_token = v_token, status = 'delivered', assignment_pending_at = null, updated_at = now()
    where id = p_order_id;
  return query select true, v_account_id, v_token;
end $$;

-- Capacity data for the administrative radar. Keep this server/admin-only.
create or replace view public.admin_capacity_radar as
select ea.store_id, ea.service_type,
       coalesce(sum(ea.max_slots), 0)::integer as total_slots,
       coalesce(sum(ea.max_slots - used.used_slots), 0)::integer as available_slots,
       coalesce(sum(used.used_slots), 0)::integer as occupied_slots,
       coalesce(sum(ea.max_slots - used.used_slots), 0) <= 2 as low_capacity
from public.email_accounts ea
left join lateral (
  select count(*)::integer as used_slots from public.account_assignments aa
  where aa.email_account_id = ea.id and aa.released_at is null
) used on true
where ea.is_active
group by ea.store_id, ea.service_type;

-- A password rotation is due if an account has an expired assignment newer
-- than its last admin-confirmed password update.
create or replace view public.admin_password_rotation_queue as
select ea.id, ea.store_id, ea.mailbox_alias, ea.service_type,
       max(o.expires_at) as latest_expired_subscription_at, ea.password_updated_at
from public.email_accounts ea
join public.account_assignments aa on aa.email_account_id = ea.id
join public.orders o on o.id = aa.order_id
where o.expires_at <= now()
group by ea.id
having ea.password_updated_at is null or ea.password_updated_at < max(o.expires_at);

create or replace function public.confirm_password_rotation(p_email_account_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.email_accounts set password_updated_at = now() where id = p_email_account_id;
  if not found then raise exception 'email account not found'; end if;
end $$;

-- Applies a strike only to the active order for the affected mailbox during a
-- login window. It records classification metadata, never the source email.
create or replace function public.record_critical_blocked(
  p_provider_message_id text, p_mailbox_alias text, p_sender_domain text default null, p_subject_hash text default null
) returns table(order_id uuid, security_strikes integer, suspended boolean)
language plpgsql security definer set search_path = public as $$
declare v_order_id uuid; v_strikes integer;
begin
  insert into public.incoming_messages (provider_message_id, email_account_id, received_at, sender_domain, subject_hash, classification, retention_expires_at)
  select p_provider_message_id, ea.id, now(), p_sender_domain, p_subject_hash, 'classified', now() + interval '30 days'
  from public.email_accounts ea where ea.mailbox_alias = p_mailbox_alias
  on conflict (provider_message_id) do nothing;

  select o.id into v_order_id
  from public.orders o join public.account_assignments aa on aa.order_id = o.id
  join public.email_accounts ea on ea.id = aa.email_account_id
  where ea.mailbox_alias = p_mailbox_alias and aa.released_at is null
    and o.active_login_window_until > now()
  order by o.active_login_window_until desc for update of o limit 1;
  if v_order_id is null then return; end if;

  execute 'update public.orders set security_strikes = security_strikes + 1,
      status = case when security_strikes + 1 >= 2 then ''suspended_security'' else status end,
      updated_at = now() where id = $1 returning security_strikes'
    into v_strikes using v_order_id;
  insert into public.audit_logs (actor_type, action, entity_type, entity_id, metadata)
  values ('system', 'critical_blocked_strike', 'order', v_order_id, jsonb_build_object('strike', v_strikes));
  return query select v_order_id, v_strikes, v_strikes >= 2;
end $$;

-- Idempotent Salla ingestion. The webhook handler calls this function and then
-- assign_order_to_available_account; both operations are safe to retry.
create or replace function public.ingest_salla_paid_order(
  p_event_id text, p_merchant_id text, p_store_name text, p_order_id text,
  p_order_number text, p_customer_id text, p_customer_name text, p_customer_phone text,
  p_product_name text, p_service_type public.service_category_enum
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_store_id uuid; v_customer_id uuid; v_order_id uuid;
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
    access_token_hash, access_token_expires_at, salla_reference_id, salla_event_id, service_type, customer_phone)
  values (v_store_id, v_customer_id, p_order_id, p_order_number, p_product_name, 'paid', 'received',
    encode(digest(gen_random_bytes(32), 'sha256'), 'hex'), now() + interval '30 days', p_order_id, p_event_id, p_service_type, p_customer_phone)
  on conflict(store_id, salla_order_id) do update set updated_at = now()
  returning id into v_order_id;
  return v_order_id;
end $$;

revoke all on function public.assign_order_to_available_account(uuid) from public;
revoke all on function public.confirm_password_rotation(uuid) from public;
revoke all on function public.record_critical_blocked(text, text, text, text) from public;
revoke all on function public.ingest_salla_paid_order(text, text, text, text, text, text, text, text, text, public.service_category_enum) from public;
revoke all on public.admin_capacity_radar from public;
revoke all on public.admin_password_rotation_queue from public;
