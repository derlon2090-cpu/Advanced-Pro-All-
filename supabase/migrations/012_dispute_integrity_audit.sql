-- Account-integrity events and conservative attribution for dispute review.
-- A recent portal visit is recorded as a review lead, never as proof that the
-- customer changed an external provider password.

alter table public.email_accounts
  add column if not exists integrity_status text not null default 'healthy',
  add column if not exists integrity_alerted_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'email_accounts_integrity_status_check') then
    alter table public.email_accounts add constraint email_accounts_integrity_status_check
      check (integrity_status in ('healthy', 'review_required', 'rotation_required'));
  end if;
end $$;

create table if not exists public.mail_security_events (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  email_account_id uuid references public.email_accounts(id) on delete set null,
  event_type text not null,
  received_at timestamptz not null default now(),
  suspected_order_id uuid references public.orders(id) on delete set null,
  attribution_basis text,
  sender_domain text,
  subject_hash text,
  created_at timestamptz not null default now()
);

create index if not exists mail_security_events_account_time_idx
  on public.mail_security_events(email_account_id, received_at desc);
create index if not exists mail_security_events_suspected_order_idx
  on public.mail_security_events(suspected_order_id, received_at desc);

alter table public.mail_security_events enable row level security;

create table if not exists public.portal_activity_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  activity_type text not null,
  physical_core_hash text,
  occurred_at timestamptz not null default now()
);

create index if not exists portal_activity_events_order_time_idx
  on public.portal_activity_events(order_id, occurred_at desc);

alter table public.portal_activity_events enable row level security;

create or replace function public.record_mail_security_event(
  p_provider_message_id text, p_email_account_id uuid, p_event_type text,
  p_sender_domain text default null, p_subject_hash text default null
) returns table(event_id uuid, suspected_order_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_order_id uuid; v_event_id uuid;
begin
  select pae.order_id into v_order_id
  from public.portal_activity_events pae
  join public.account_assignments aa on aa.order_id = pae.order_id
  where aa.email_account_id = p_email_account_id
    and aa.released_at is null
    and pae.occurred_at >= now() - interval '30 minutes'
    and pae.activity_type in ('account_details_viewed', 'account_email_copied')
  order by pae.occurred_at desc limit 1;

  insert into public.mail_security_events(
    provider_message_id, email_account_id, event_type, suspected_order_id,
    attribution_basis, sender_domain, subject_hash
  ) values (
    p_provider_message_id, p_email_account_id, left(p_event_type, 60), v_order_id,
    case when v_order_id is null then 'no_recent_portal_activity'
         else 'latest_verified_portal_activity_within_30_minutes_review_only' end,
    left(p_sender_domain, 255), p_subject_hash
  ) on conflict(provider_message_id) do update set provider_message_id = excluded.provider_message_id
  returning id into v_event_id;

  update public.email_accounts set
    integrity_status = case when p_event_type in ('password_changed', 'email_changed', 'logout_all') then 'rotation_required' else 'review_required' end,
    integrity_alerted_at = now()
  where id = p_email_account_id;

  return query select v_event_id, v_order_id;
end $$;

revoke all on function public.record_mail_security_event(text, uuid, text, text, text) from public;
revoke all on public.mail_security_events from public;
revoke all on public.portal_activity_events from public;

