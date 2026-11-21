do $$ begin
  create type public.service_category_enum as enum ('crunchyroll','chatgpt','general_subscription');
exception when duplicate_object then null; end $$;

alter table public.orders
  add column if not exists service_type public.service_category_enum not null default 'general_subscription',
  add column if not exists customer_phone varchar(50),
  add column if not exists duration_days integer not null default 30,
  add column if not exists warranty_days integer not null default 30,
  add column if not exists starts_at timestamptz not null default now(),
  add column if not exists expires_at timestamptz,
  add column if not exists warranty_expires_at timestamptz;

alter table public.email_accounts add column if not exists service_type public.service_category_enum not null default 'crunchyroll';
create index if not exists orders_customer_phone_idx on public.orders(customer_phone);
create index if not exists orders_service_type_idx on public.orders(service_type);

-- Never store raw OTP values, credentials, or approval URLs.
