-- Customer-facing default delivery estimate for orders awaiting fulfillment.

alter table public.system_settings
  add column if not exists default_delivery_estimate text
  default 'فوري خلال 5 – 18 ساعة';

update public.system_settings
set default_delivery_estimate = 'فوري خلال 5 – 18 ساعة'
where nullif(trim(default_delivery_estimate), '') is null;
