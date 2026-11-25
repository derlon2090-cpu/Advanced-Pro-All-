-- Product-specific renewal offer snapshots.
-- Existing orders remain stable even when an admin edits the product mapping later.

alter table public.salla_product_mappings
  add column if not exists renewal_url text,
  add column if not exists renewal_discount_code text;

alter table public.orders
  add column if not exists renewal_url text,
  add column if not exists renewal_discount_code text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'salla_product_mappings_renewal_url_check') then
    alter table public.salla_product_mappings
      add constraint salla_product_mappings_renewal_url_check
      check (renewal_url is null or renewal_url ~ '^https://');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_renewal_url_check') then
    alter table public.orders
      add constraint orders_renewal_url_check
      check (renewal_url is null or renewal_url ~ '^https://');
  end if;
end $$;

