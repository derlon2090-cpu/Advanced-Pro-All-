-- Self-service compensation records used by cross-order customer reputation.
create table if not exists public.compensation_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (reason in ('password_changed', 'account_not_working', 'signed_out', 'other')),
  customer_note text,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  review_mode text not null default 'manual_review' check (review_mode in ('auto_approved', 'manual_review')),
  strikes_at_request integer not null default 0,
  cumulative_strikes integer not null default 0,
  cumulative_orders integer not null default 1,
  cumulative_compensations integer not null default 0,
  reputation_badge text not null default 'none',
  old_email_account_id uuid references public.email_accounts(id) on delete set null,
  replacement_email_account_id uuid references public.email_accounts(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists compensation_requests_order_time_idx
  on public.compensation_requests(order_id, created_at desc);
create index if not exists compensation_requests_review_queue_idx
  on public.compensation_requests(review_mode, status, created_at desc);
alter table public.compensation_requests enable row level security;
revoke all on public.compensation_requests from anon, authenticated;

-- Atomically moves an eligible order to a different healthy seat. The caller
-- performs the cross-order identity check; this function re-checks the local
-- safety limits and capacity while holding row locks.
create or replace function public.auto_replace_order_account(p_request_id uuid)
returns table(approved boolean, replacement_email_account_id uuid, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_request public.compensation_requests%rowtype;
  v_order public.orders%rowtype;
  v_old_account uuid;
  v_new_account uuid;
  v_previous_auto integer;
begin
  select * into v_request from public.compensation_requests where id = p_request_id for update;
  if not found then return query select false, null::uuid, 'request_not_found'::text; return; end if;
  select * into v_order from public.orders where id = v_request.order_id for update;
  select aa.email_account_id into v_old_account from public.account_assignments aa where aa.order_id = v_order.id for update;
  select count(*) into v_previous_auto from public.compensation_requests cr
    where cr.order_id = v_order.id and cr.review_mode = 'auto_approved' and cr.status = 'approved' and cr.id <> p_request_id;
  if v_request.review_mode <> 'auto_approved' or v_order.security_strikes > 0 or v_request.cumulative_strikes > 0 or v_previous_auto >= 2 then
    update public.compensation_requests set review_mode = 'manual_review', status = 'submitted' where id = p_request_id;
    return query select false, null::uuid, 'manual_review_required'::text; return;
  end if;
  select ea.id into v_new_account
  from public.email_accounts ea
  where ea.store_id = v_order.store_id
    and ea.service_type = v_order.service_type
    and ea.is_active and ea.archived_at is null
    and coalesce(ea.integrity_status, 'healthy') = 'healthy'
    and ea.id is distinct from v_old_account
    and (select count(*) from public.account_assignments aa where aa.email_account_id = ea.id and aa.released_at is null) < ea.max_slots
  order by ea.created_at asc for update of ea skip locked limit 1;
  if v_new_account is null then
    update public.compensation_requests set review_mode = 'manual_review', status = 'submitted' where id = p_request_id;
    return query select false, null::uuid, 'no_healthy_capacity'::text; return;
  end if;
  update public.email_accounts set integrity_status = 'review_required', integrity_alerted_at = now() where id = v_old_account;
  update public.account_assignments set email_account_id = v_new_account, assigned_at = now(), released_at = null where order_id = v_order.id;
  update public.compensation_requests set status = 'approved', old_email_account_id = v_old_account,
    replacement_email_account_id = v_new_account, reviewed_at = now() where id = p_request_id;
  insert into public.audit_logs(actor_type, action, entity_type, entity_id, metadata)
  values ('system', 'automatic_compensation', 'order', v_order.id,
    jsonb_build_object('request_id', p_request_id, 'old_account', v_old_account, 'replacement_account', v_new_account));
  return query select true, v_new_account, 'approved'::text;
end $$;

revoke all on function public.auto_replace_order_account(uuid) from public;
