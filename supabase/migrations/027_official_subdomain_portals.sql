-- Canonical customer portal addresses after the official advpro.app subdomain migration.
alter table if exists public.system_settings
  alter column chatgpt_portal_url set default 'https://gpt.advpro.app';

update public.system_settings
set crunchyroll_portal_url = 'https://anime.advpro.app'
where crunchyroll_portal_url is null
   or btrim(crunchyroll_portal_url) = ''
   or crunchyroll_portal_url in ('https://advpro.app/crunchyroll', 'https://crunchyroll.advpro.app');

update public.system_settings
set chatgpt_portal_url = 'https://gpt.advpro.app'
where chatgpt_portal_url is null
   or btrim(chatgpt_portal_url) = ''
   or chatgpt_portal_url in ('/chatgpt', 'https://advpro.app/chatgpt', 'https://chatgpt.advpro.app');
