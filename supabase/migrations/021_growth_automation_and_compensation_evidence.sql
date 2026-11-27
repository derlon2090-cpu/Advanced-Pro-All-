-- Completes evidence-based compensation, referral rewards, upsells and digest settings.
alter table public.compensation_requests
  add column if not exists evidence_image_url text,
  add column if not exists evidence_image_hash text,
  add column if not exists device_mismatch_blocked boolean not null default false,
  add column if not exists customer_email text;
alter table public.order_reviews add column if not exists salla_shared_at timestamptz;

create unique index if not exists compensation_evidence_hash_unique_idx
  on public.compensation_requests(evidence_image_hash) where evidence_image_hash is not null;

alter table public.system_settings
  add column if not exists upsell_enabled boolean not null default false,
  add column if not exists upsell_title text,
  add column if not exists upsell_description text,
  add column if not exists upsell_url text,
  add column if not exists upsell_duration_minutes integer not null default 30,
  add column if not exists digest_email text;

alter table public.orders
  add column if not exists referral_code text,
  add column if not exists referred_by_order_id uuid references public.orders(id) on delete set null,
  add column if not exists referral_rewarded_at timestamptz;

update public.orders set referral_code = upper(substr(replace(id::text, '-', ''), 1, 12)) where referral_code is null;
create unique index if not exists orders_referral_code_unique_idx on public.orders(referral_code);
create or replace function public.set_order_referral_code() returns trigger language plpgsql set search_path=public as $$
begin if new.referral_code is null then new.referral_code=upper(substr(replace(new.id::text,'-',''),1,12)); end if; return new; end $$;
drop trigger if exists orders_set_referral_code on public.orders;
create trigger orders_set_referral_code before insert on public.orders for each row execute function public.set_order_referral_code();

create table if not exists public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_order_id uuid not null references public.orders(id) on delete cascade,
  referred_order_id uuid not null unique references public.orders(id) on delete cascade,
  reward_days integer not null default 5 check (reward_days between 1 and 30),
  created_at timestamptz not null default now()
);
alter table public.referral_rewards enable row level security;
revoke all on public.referral_rewards from anon, authenticated;

create or replace function public.reward_order_referral(p_referral_code text, p_referred_order_id uuid)
returns table(rewarded boolean, referrer_order_id uuid, new_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_referrer public.orders%rowtype; v_referred public.orders%rowtype; v_expiry timestamptz;
begin
  select * into v_referred from public.orders where id = p_referred_order_id for update;
  select * into v_referrer from public.orders where referral_code = upper(trim(p_referral_code)) for update;
  if v_referred.id is null or v_referrer.id is null or v_referrer.id = v_referred.id
     or v_referred.referred_by_order_id is not null or v_referrer.expires_at <= now() then
    return query select false, null::uuid, null::timestamptz; return;
  end if;
  insert into public.referral_rewards(referrer_order_id, referred_order_id) values(v_referrer.id, v_referred.id)
  on conflict(referred_order_id) do nothing;
  if not found then return query select false, null::uuid, null::timestamptz; return; end if;
  update public.orders set expires_at = expires_at + interval '5 days', warranty_expires_at = case when has_warranty then warranty_expires_at + interval '5 days' else warranty_expires_at end, updated_at = now()
    where id = v_referrer.id returning expires_at into v_expiry;
  update public.orders set referred_by_order_id = v_referrer.id, referral_rewarded_at = now(), updated_at = now() where id = v_referred.id;
  return query select true, v_referrer.id, v_expiry;
end $$;
revoke all on function public.reward_order_referral(text, uuid) from public;

create or replace function public.admin_resolve_compensation(p_request_id uuid, p_approve boolean)
returns table(success boolean, replacement_email_account_id uuid, reason text)
language plpgsql security definer set search_path = public as $$
declare v_request public.compensation_requests%rowtype; v_order public.orders%rowtype; v_old uuid; v_new uuid;
begin
  select * into v_request from public.compensation_requests where id=p_request_id and status='submitted' for update;
  if not found then return query select false,null::uuid,'request_not_found'::text; return; end if;
  if not p_approve then
    update public.compensation_requests set status='rejected',reviewed_at=now() where id=p_request_id;
    return query select true,null::uuid,'rejected'::text; return;
  end if;
  select * into v_order from public.orders where id=v_request.order_id for update;
  select email_account_id into v_old from public.account_assignments where order_id=v_order.id for update;
  select ea.id into v_new from public.email_accounts ea where ea.store_id=v_order.store_id and ea.service_type=v_order.service_type
    and ea.is_active and ea.archived_at is null and coalesce(ea.integrity_status,'healthy')='healthy' and ea.id is distinct from v_old
    and (select count(*) from public.account_assignments aa where aa.email_account_id=ea.id and aa.released_at is null)<ea.max_slots
    order by ea.created_at for update of ea skip locked limit 1;
  if v_new is null then return query select false,null::uuid,'no_healthy_capacity'::text; return; end if;
  update public.email_accounts set integrity_status='review_required',integrity_alerted_at=now() where id=v_old;
  update public.account_assignments set email_account_id=v_new,assigned_at=now(),released_at=null where order_id=v_order.id;
  update public.compensation_requests set status='approved',old_email_account_id=v_old,replacement_email_account_id=v_new,reviewed_at=now() where id=p_request_id;
  return query select true,v_new,'approved'::text;
end $$;
revoke all on function public.admin_resolve_compensation(uuid, boolean) from public;
