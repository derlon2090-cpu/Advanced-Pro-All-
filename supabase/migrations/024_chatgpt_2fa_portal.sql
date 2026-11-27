-- Secure ChatGPT portal and server-side TOTP support.
alter table public.email_accounts
  add column if not exists totp_secret text;

alter table public.email_accounts
  drop constraint if exists email_accounts_totp_secret_base32;

alter table public.email_accounts
  add constraint email_accounts_totp_secret_base32
  check (totp_secret is null or totp_secret ~ '^[A-Z2-7]{16,128}$');

comment on column public.email_accounts.totp_secret is
  'Base32 TOTP seed. Service-role/server access only; never expose through public APIs.';

alter table public.system_settings
  add column if not exists chatgpt_portal_url text not null default '/chatgpt';

update public.system_settings
set chatgpt_portal_url = coalesce(nullif(chatgpt_portal_url, ''), '/chatgpt')
where singleton = true;

