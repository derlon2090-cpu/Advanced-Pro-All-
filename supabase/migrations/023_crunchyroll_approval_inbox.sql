-- Encrypted, short-lived Crunchyroll approval inbox. The application decrypts
-- these rows only after validating the order, acknowledgment, and device cookie.

create table if not exists public.crunchyroll_mailbox_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  email_account_id uuid not null references public.email_accounts(id) on delete cascade,
  received_at timestamptz not null default now(),
  encrypted_payload jsonb not null,
  expires_at timestamptz not null default now() + interval '24 hours',
  created_at timestamptz not null default now()
);

create index if not exists crunchyroll_mailbox_account_received_idx
  on public.crunchyroll_mailbox_messages(email_account_id, received_at desc);
create index if not exists crunchyroll_mailbox_expiry_idx
  on public.crunchyroll_mailbox_messages(expires_at);

alter table public.crunchyroll_mailbox_messages enable row level security;
revoke all on public.crunchyroll_mailbox_messages from public;

create or replace function public.cleanup_expired_mail_metadata()
returns table(deleted_mail_logs integer, deleted_messages integer)
language plpgsql security definer set search_path = public as $$
declare v_logs integer; v_messages integer; v_crunchyroll integer;
begin
  delete from public.mail_delivery_logs where expires_at <= now(); get diagnostics v_logs = row_count;
  delete from public.incoming_messages where retention_expires_at <= now(); get diagnostics v_messages = row_count;
  delete from public.crunchyroll_mailbox_messages where expires_at <= now(); get diagnostics v_crunchyroll = row_count;
  return query select v_logs, v_messages + v_crunchyroll;
end $$;

revoke all on function public.cleanup_expired_mail_metadata() from public;

update public.system_settings
set crunchyroll_portal_url = 'https://advpro.app/crunchyroll'
where singleton = true
  and (crunchyroll_portal_url is null or btrim(crunchyroll_portal_url) = '');
