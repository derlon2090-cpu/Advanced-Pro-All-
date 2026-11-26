-- Editable customer-facing links used by the unified administration dashboard.

alter table public.system_settings
  add column if not exists support_whatsapp text,
  add column if not exists salla_review_url text,
  add column if not exists renewal_store_url text,
  add column if not exists crunchyroll_portal_url text;
