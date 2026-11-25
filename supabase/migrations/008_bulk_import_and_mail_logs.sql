-- High-volume account lifecycle and inbound-mail diagnostics.
-- Passwords, OTPs, raw email bodies, and approval links are intentionally excluded.

alter table public.email_accounts
  add column if not exists archived_at timestamptz,
  add column if not exists archive_reason text;

create table if not exists public.mail_delivery_logs (
  id bigint generated always as identity primary key,
  provider_message_id text not null unique,
  recipient_address text not null,
  email_account_id uuid references public.email_accounts(id) on delete set null,
  sender_domain text,
  category text not null check (category in ('approved_login', 'verification_code', 'critical_blocked', 'unmatched_email')),
  received_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);
create index if not exists mail_delivery_logs_received_idx on public.mail_delivery_logs(received_at desc);
create index if not exists email_accounts_active_search_idx on public.email_accounts(mailbox_alias) where is_active and archived_at is null;

alter table public.mail_delivery_logs enable row level security;

-- Import aliases only. Credentials deliberately never enter the database.
create or replace function public.bulk_import_email_accounts(
  p_store_id uuid, p_service_type public.service_category_enum, p_max_slots integer, p_aliases text[]
) returns table(inserted_count integer, duplicate_count integer)
language plpgsql security definer set search_path = public as $$
declare v_inserted integer;
begin
  if p_max_slots < 1 then raise exception 'max_slots must be positive'; end if;
  with normalized as (
    select distinct lower(trim(alias)) as mailbox_alias from unnest(p_aliases) alias
    where trim(alias) ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
  ), inserted as (
    insert into public.email_accounts(store_id, mailbox_alias, service_type, max_slots, is_active)
    select p_store_id, mailbox_alias, p_service_type, p_max_slots, true from normalized
    on conflict(mailbox_alias) do nothing returning id
  ) select count(*)::integer into v_inserted from inserted;
  return query select v_inserted, greatest(cardinality(p_aliases) - v_inserted, 0);
end $$;

create or replace function public.archive_expired_email_accounts()
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  update public.email_accounts ea set is_active = false, archived_at = now(), archive_reason = 'all_subscriptions_expired'
  where ea.is_active and ea.archived_at is null
    and exists (select 1 from public.account_assignments aa where aa.email_account_id = ea.id)
    and not exists (
      select 1 from public.account_assignments aa join public.orders o on o.id = aa.order_id
      where aa.email_account_id = ea.id and aa.released_at is null
        and (o.expires_at is null or o.expires_at > now())
    );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.cleanup_expired_mail_metadata()
returns table(deleted_mail_logs integer, deleted_messages integer)
language plpgsql security definer set search_path = public as $$
declare v_logs integer; v_messages integer;
begin
  delete from public.mail_delivery_logs where expires_at <= now(); get diagnostics v_logs = row_count;
  delete from public.incoming_messages where retention_expires_at <= now(); get diagnostics v_messages = row_count;
  return query select v_logs, v_messages;
end $$;

revoke all on public.mail_delivery_logs from public;
revoke all on function public.bulk_import_email_accounts(uuid, public.service_category_enum, integer, text[]) from public;
revoke all on function public.archive_expired_email_accounts() from public;
revoke all on function public.cleanup_expired_mail_metadata() from public;
