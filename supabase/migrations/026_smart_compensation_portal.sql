-- Standalone smart compensation portal: verification-code reason and audited rejection strikes.
alter table public.compensation_requests
  add column if not exists decision_reason text;
alter table public.compensation_requests
  drop constraint if exists compensation_requests_reason_check;
alter table public.compensation_requests
  add constraint compensation_requests_reason_check
  check (reason in ('password_changed', 'account_not_working', 'signed_out', 'verification_code', 'other'));

create or replace function public.admin_resolve_compensation(p_request_id uuid, p_approve boolean)
returns table(success boolean, replacement_email_account_id uuid, reason text)
language plpgsql security definer set search_path = public as $$
declare v_request public.compensation_requests%rowtype; v_order public.orders%rowtype; v_old uuid; v_new uuid;
begin
  select * into v_request from public.compensation_requests where id=p_request_id and status='submitted' for update;
  if not found then return query select false,null::uuid,'request_not_found'::text; return; end if;
  select * into v_order from public.orders where id=v_request.order_id for update;
  if not p_approve then
    update public.compensation_requests set status='rejected',reviewed_at=now() where id=p_request_id;
    update public.orders set security_strikes=coalesce(security_strikes,0)+1,updated_at=now() where id=v_request.order_id;
    insert into public.audit_logs(actor_type,action,entity_type,entity_id,metadata)
      values('admin','compensation_rejected_with_strike','order',v_request.order_id,jsonb_build_object('request_id',p_request_id));
    return query select true,null::uuid,'rejected_with_strike'::text; return;
  end if;
  select email_account_id into v_old from public.account_assignments where order_id=v_order.id for update;
  select ea.id into v_new from public.email_accounts ea where ea.store_id=v_order.store_id and ea.service_type=v_order.service_type
    and ea.is_active and ea.archived_at is null and coalesce(ea.integrity_status,'healthy')='healthy' and ea.id is distinct from v_old
    and (select count(*) from public.account_assignments aa where aa.email_account_id=ea.id and aa.released_at is null)<ea.max_slots
    order by ea.created_at for update of ea skip locked limit 1;
  if v_new is null then return query select false,null::uuid,'no_healthy_capacity'::text; return; end if;
  update public.email_accounts set integrity_status='review_required',integrity_alerted_at=now() where id=v_old;
  update public.account_assignments set email_account_id=v_new,assigned_at=now(),released_at=null where order_id=v_order.id;
  update public.compensation_requests set status='approved',old_email_account_id=v_old,replacement_email_account_id=v_new,reviewed_at=now() where id=p_request_id;
  insert into public.audit_logs(actor_type,action,entity_type,entity_id,metadata)
    values('admin','compensation_approved','order',v_request.order_id,jsonb_build_object('request_id',p_request_id,'replacement_account',v_new));
  return query select true,v_new,'approved'::text;
end $$;
revoke all on function public.admin_resolve_compensation(uuid, boolean) from public;
