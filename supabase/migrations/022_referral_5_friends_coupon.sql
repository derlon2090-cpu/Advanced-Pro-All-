-- Unlocks a configurable coupon after the referral target is reached.
alter table public.system_settings
  add column if not exists referral_coupon_enabled boolean not null default true,
  add column if not exists referral_coupon_target integer not null default 5 check (referral_coupon_target between 1 and 100),
  add column if not exists referral_coupon_code text not null default 'ADVVIP5',
  add column if not exists referral_coupon_discount_label text not null default 'خصم خاص 25% لعملائنا السفراء';

alter table public.orders
  add column if not exists referral_coupon_unlocked_at timestamptz,
  add column if not exists referral_assigned_coupon text;

create or replace function public.reward_order_referral(p_referral_code text, p_referred_order_id uuid)
returns table(rewarded boolean, referrer_order_id uuid, new_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_referrer public.orders%rowtype;
  v_referred public.orders%rowtype;
  v_expiry timestamptz;
  v_referral_count integer;
  v_settings public.system_settings%rowtype;
  v_coupon text;
begin
  select * into v_referred from public.orders where id = p_referred_order_id for update;
  select * into v_referrer from public.orders where referral_code = upper(trim(p_referral_code)) for update;
  if v_referred.id is null or v_referrer.id is null or v_referrer.id = v_referred.id
     or v_referred.referred_by_order_id is not null or v_referrer.expires_at <= now() then
    return query select false, null::uuid, null::timestamptz; return;
  end if;

  insert into public.referral_rewards(referrer_order_id, referred_order_id)
    values(v_referrer.id, v_referred.id)
    on conflict(referred_order_id) do nothing;
  if not found then return query select false, null::uuid, null::timestamptz; return; end if;

  update public.orders
    set expires_at = expires_at + interval '5 days',
        warranty_expires_at = case when has_warranty then warranty_expires_at + interval '5 days' else warranty_expires_at end,
        updated_at = now()
    where id = v_referrer.id returning expires_at into v_expiry;
  update public.orders set referred_by_order_id = v_referrer.id, referral_rewarded_at = now(), updated_at = now()
    where id = v_referred.id;

  select count(*)::integer into v_referral_count from public.referral_rewards where referrer_order_id = v_referrer.id;
  select * into v_settings from public.system_settings where singleton = true;
  if coalesce(v_settings.referral_coupon_enabled, true)
     and v_referral_count >= greatest(coalesce(v_settings.referral_coupon_target, 5), 1) then
    v_coupon := coalesce(nullif(trim(v_settings.referral_coupon_code), ''), 'ADV5-' || regexp_replace(v_referrer.order_number, '[^A-Za-z0-9]', '', 'g'));
    update public.orders
      set referral_coupon_unlocked_at = coalesce(referral_coupon_unlocked_at, now()),
          referral_assigned_coupon = coalesce(referral_assigned_coupon, v_coupon),
          updated_at = now()
      where id = v_referrer.id;
  end if;

  return query select true, v_referrer.id, v_expiry;
end $$;
revoke all on function public.reward_order_referral(text, uuid) from public;
