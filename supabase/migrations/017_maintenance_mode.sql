-- Full maintenance mode and Salla product catalog metadata.
alter table public.system_settings
  add column if not exists maintenance_enabled boolean not null default false,
  add column if not exists maintenance_message text not null default 'نقوم حاليًا بإجراء تحديثات تقنية لتحسين جودة الخدمة في بوابة أدفانسد برو، سنعود للعمل خلال دقائق معدودة.';

alter table public.salla_product_mappings
  add column if not exists salla_product_url text;

alter table public.salla_product_mappings
  drop constraint if exists salla_product_mappings_product_url_check;
alter table public.salla_product_mappings
  add constraint salla_product_mappings_product_url_check
  check (salla_product_url is null or salla_product_url ~ '^https://');

