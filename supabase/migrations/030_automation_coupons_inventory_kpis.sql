-- Complete the automation loop: instant fulfillment metrics, recurring Salla coupons,
-- anti-self-referral, inventory quarantine and executive KPIs.

alter table public.orders
  add column if not exists auto_provisioned_at timestamptz,
  add column if not exists provisioning_source text,
  add column if not exists onboarding_sent_at timestamptz,
  add column if not exists last_lookup_ip_hash text;

alter table public.email_accounts
  add column if not exists operational_status text not null default 'available',
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists health_checked_at timestamptz,
  add column if not exists health_failure_reason text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_accounts_operational_status_check') then
    alter table public.email_accounts add constraint email_accounts_operational_status_check
      check (operational_status in ('available','quarantined'));
  end if;
end $$;

alter table public.system_settings
  add column if not exists referral_coupon_type text not null default 'percentage',
  add column if not exists referral_coupon_amount numeric(10,2) not null default 25,
  add column if not exists referral_coupon_expiry_days integer not null default 14;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'system_settings_referral_coupon_type_check') then
    alter table public.system_settings add constraint system_settings_referral_coupon_type_check check (referral_coupon_type in ('percentage','fixed'));
  end if;
end $$;

create table if not exists public.referral_coupons (
  id uuid primary key default gen_random_uuid(),
  referrer_order_id uuid not null references public.orders(id) on delete cascade,
  milestone integer not null check (milestone > 0),
  code text not null unique,
  salla_coupon_id text,
  status text not null default 'pending' check (status in ('pending','active','used','expired','failed')),
  expiry_date timestamptz,
  issued_at timestamptz,
  used_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique(referrer_order_id, milestone)
);
create index if not exists referral_coupons_created_idx on public.referral_coupons(created_at desc);
alter table public.referral_coupons enable row level security;
revoke all on public.referral_coupons from public;

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

create or replace function public.reward_order_referral_secure(p_referral_code text, p_referred_order_id uuid, p_claim_ip_hash text default null)
returns table(rewarded boolean, referrer_order_id uuid, new_expires_at timestamptz, referral_count integer, milestone_due integer)
language plpgsql security definer set search_path = public as $$
declare
  v_referrer public.orders%rowtype;
  v_referred public.orders%rowtype;
  v_count integer;
  v_target integer;
  v_milestone integer;
  v_self boolean;
begin
  select * into v_referred from public.orders where id = p_referred_order_id for update;
  select * into v_referrer from public.orders where referral_code = upper(trim(p_referral_code)) for update;
  if v_referred.id is null or v_referrer.id is null or v_referrer.id = v_referred.id
     or v_referred.referred_by_order_id is not null or v_referrer.expires_at <= now() then
    return query select false, null::uuid, null::timestamptz, 0, null::integer; return;
  end if;
  v_self :=
    (nullif(regexp_replace(coalesce(v_referrer.customer_phone,''),'[^0-9]','','g'),'') is not null and regexp_replace(coalesce(v_referrer.customer_phone,''),'[^0-9]','','g') = regexp_replace(coalesce(v_referred.customer_phone,''),'[^0-9]','','g'))
    or (nullif(lower(trim(coalesce(v_referrer.customer_email,''))),'') is not null and lower(trim(v_referrer.customer_email)) = lower(trim(v_referred.customer_email)))
    or (v_referrer.locked_device_fingerprint_hash is not null and v_referrer.locked_device_fingerprint_hash = v_referred.locked_device_fingerprint_hash)
    or (v_referrer.last_lookup_ip_hash is not null and v_referrer.last_lookup_ip_hash = coalesce(p_claim_ip_hash, v_referred.last_lookup_ip_hash));
  if v_self then
    insert into public.audit_logs(actor_type, action, entity_type, entity_id, metadata)
    values ('system','self_referral_blocked','order',v_referred.id,jsonb_build_object('referrer_order_id',v_referrer.id));
    return query select false, v_referrer.id, v_referrer.expires_at, 0, null::integer; return;
  end if;
  insert into public.referral_rewards(referrer_order_id, referred_order_id)
  values(v_referrer.id, v_referred.id) on conflict(referred_order_id) do nothing;
  if not found then return query select false, v_referrer.id, v_referrer.expires_at, 0, null::integer; return; end if;
  update public.orders set referred_by_order_id=v_referrer.id, referral_rewarded_at=now(), last_lookup_ip_hash=coalesce(p_claim_ip_hash,last_lookup_ip_hash), updated_at=now() where id=v_referred.id;
  select count(*)::integer into v_count from public.referral_rewards where referrer_order_id=v_referrer.id;
  select greatest(coalesce(referral_coupon_target,5),1) into v_target from public.system_settings where singleton=true;
  v_target := coalesce(v_target,5);
  v_milestone := case when mod(v_count,v_target)=0 then v_count/v_target else null end;
  return query select true, v_referrer.id, v_referrer.expires_at, v_count, v_milestone;
end $$;
revoke all on function public.reward_order_referral_secure(text,uuid,text) from public;

create or replace function public.assign_order_to_available_account(p_order_id uuid)
returns table (assigned boolean, email_account_id uuid, tracking_token text)
language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype; v_account_id uuid; v_token text; v_started_at timestamptz:=now();
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  select ea.id into v_account_id from public.email_accounts ea
  where ea.store_id=v_order.store_id and ea.service_type=v_order.service_type and ea.is_active
    and ea.archived_at is null and coalesce(ea.integrity_status,'healthy')='healthy'
    and coalesce(ea.operational_status,'available')='available'
    and (ea.subscription_expires_at is null or ea.subscription_expires_at>now())
    and (select count(*) from public.account_assignments aa where aa.email_account_id=ea.id and aa.released_at is null)<ea.max_slots
  order by ea.created_at asc for update of ea skip locked limit 1;
  if v_account_id is null then
    update public.orders set status='pending_assignment',assignment_pending_at=coalesce(assignment_pending_at,now()),updated_at=now() where id=p_order_id;
    return query select false,null::uuid,null::text; return;
  end if;
  insert into public.account_assignments(order_id,email_account_id) values(p_order_id,v_account_id) on conflict(order_id) do nothing;
  select coalesce(o.tracking_token,encode(gen_random_bytes(24),'hex')) into v_token from public.orders o where o.id=p_order_id;
  update public.orders set tracking_token=v_token,status='delivered',starts_at=v_started_at,
    expires_at=v_started_at+make_interval(days=>greatest(coalesce(duration_days,30),1)),
    warranty_expires_at=case when has_warranty then v_started_at+make_interval(days=>greatest(coalesce(warranty_days,duration_days,30),1)) else null end,
    assignment_pending_at=null,updated_at=v_started_at where id=p_order_id;
  return query select true,v_account_id,v_token;
end $$;
revoke all on function public.assign_order_to_available_account(uuid) from public;
