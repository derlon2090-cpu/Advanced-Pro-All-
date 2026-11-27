-- Start subscription and warranty clocks only when fulfillment succeeds.
create or replace function public.assign_order_to_available_account(p_order_id uuid)
returns table (assigned boolean, email_account_id uuid, tracking_token text)
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_account_id uuid;
  v_token text;
  v_started_at timestamptz := now();
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
    update public.orders
      set status = 'pending_assignment', assignment_pending_at = coalesce(assignment_pending_at, now()), updated_at = now()
      where id = p_order_id;
    return query select false, null::uuid, null::text;
    return;
  end if;

  insert into public.account_assignments (order_id, email_account_id)
  values (p_order_id, v_account_id)
  on conflict (order_id) do nothing;

  select coalesce(o.tracking_token, encode(gen_random_bytes(24), 'hex')) into v_token
  from public.orders o where o.id = p_order_id;

  update public.orders
    set tracking_token = v_token,
        status = 'delivered',
        starts_at = v_started_at,
        expires_at = v_started_at + make_interval(days => greatest(coalesce(duration_days, 30), 1)),
        warranty_expires_at = case when has_warranty
          then v_started_at + make_interval(days => greatest(coalesce(warranty_days, duration_days, 30), 1))
          else null end,
        assignment_pending_at = null,
        updated_at = v_started_at
    where id = p_order_id;

  return query select true, v_account_id, v_token;
end $$;

revoke all on function public.assign_order_to_available_account(uuid) from public;
