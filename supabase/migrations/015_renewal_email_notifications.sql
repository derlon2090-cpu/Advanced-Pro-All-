-- Customer renewal email delivery and per-stage idempotency.

alter table public.orders
  add column if not exists customer_email text,
  add column if not exists renewal_reminder_3d_sent_at timestamptz,
  add column if not exists renewal_reminder_1d_sent_at timestamptz,
  add column if not exists renewal_reminder_manual_sent_at timestamptz;

alter table public.system_settings
  add column if not exists renewal_reminders_enabled boolean not null default false,
  add column if not exists renewal_reminder_days jsonb not null default '[3,1]'::jsonb;

update public.orders as o
set customer_email = c.email
from public.customers as c
where o.customer_id = c.id
  and o.customer_email is null
  and c.email is not null;

create index if not exists orders_renewal_reminders_idx
  on public.orders(expires_at)
  where status = 'delivered' and customer_email is not null;

