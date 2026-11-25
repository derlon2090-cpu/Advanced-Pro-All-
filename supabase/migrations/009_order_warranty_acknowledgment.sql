-- Product-level warranty policy and customer acknowledgment snapshots.
-- Orders keep their own copy so later mapping edits never rewrite an old sale's terms.

alter table public.salla_product_mappings
  add column if not exists has_warranty boolean not null default true,
  add column if not exists warranty_days integer not null default 30,
  add column if not exists acknowledgment_text text;

alter table public.orders
  add column if not exists has_warranty boolean not null default true,
  add column if not exists acknowledgment_text text,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_ip text,
  add column if not exists acknowledged_user_agent text;

alter table public.salla_product_mappings
  drop constraint if exists salla_product_mappings_warranty_days_check;
alter table public.salla_product_mappings
  add constraint salla_product_mappings_warranty_days_check
  check (warranty_days >= 0 and warranty_days <= 3660);

update public.salla_product_mappings
set acknowledgment_text = case when has_warranty then
  E'يشمل الضمان التوقف المفاجئ طوال المدة المحددة.\nيُلغى الضمان عند تغيير البريد أو كلمة المرور أو مشاركة الحساب.\nيتم التعويض بعد التحقق من الالتزام بشروط الاستخدام.'
else
  E'يُسلّم المنتج بحالة سليمة وقت الشراء.\nهذا المنتج تسليم لمرة واحدة ولا يشمله التعويض بعد التسليم.\nيتحمل العميل مسؤولية حفظ بيانات المنتج بعد استلامه.'
end
where acknowledgment_text is null or btrim(acknowledgment_text) = '';

update public.orders
set acknowledgment_text = case when has_warranty then
  E'يشمل الضمان التوقف المفاجئ طوال المدة المحددة.\nيُلغى الضمان عند تغيير البريد أو كلمة المرور أو مشاركة الحساب.\nيتم التعويض بعد التحقق من الالتزام بشروط الاستخدام.'
else
  E'يُسلّم المنتج بحالة سليمة وقت الشراء.\nهذا المنتج تسليم لمرة واحدة ولا يشمله التعويض بعد التسليم.\nيتحمل العميل مسؤولية حفظ بيانات المنتج بعد استلامه.'
end
where acknowledgment_text is null or btrim(acknowledgment_text) = '';

drop function if exists public.ingest_salla_paid_order(text, text, text, text, text, text, text, text, text, public.service_category_enum);
drop function if exists public.ingest_salla_paid_order(text, text, text, text, text, text, text, text, text, public.service_category_enum, integer);

create or replace function public.ingest_salla_paid_order(
  p_event_id text, p_merchant_id text, p_store_name text, p_order_id text,
  p_order_number text, p_customer_id text, p_customer_name text, p_customer_phone text,
  p_product_name text, p_service_type public.service_category_enum, p_duration_days integer default 30,
  p_has_warranty boolean default true, p_warranty_days integer default 30,
  p_acknowledgment_text text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_store_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_duration integer := greatest(coalesce(p_duration_days, 30), 1);
  v_has_warranty boolean := coalesce(p_has_warranty, true);
  v_warranty_days integer := case when coalesce(p_has_warranty, true) then greatest(coalesce(p_warranty_days, 30), 1) else 0 end;
  v_acknowledgment text := coalesce(nullif(btrim(p_acknowledgment_text), ''), case when coalesce(p_has_warranty, true) then
    E'يشمل الضمان التوقف المفاجئ طوال المدة المحددة.\nيُلغى الضمان عند تغيير البريد أو كلمة المرور أو مشاركة الحساب.\nيتم التعويض بعد التحقق من الالتزام بشروط الاستخدام.'
  else
    E'يُسلّم المنتج بحالة سليمة وقت الشراء.\nهذا المنتج تسليم لمرة واحدة ولا يشمله التعويض بعد التسليم.\nيتحمل العميل مسؤولية حفظ بيانات المنتج بعد استلامه.'
  end);
begin
  insert into public.webhook_receipts(source, event_id) values ('salla', p_event_id)
  on conflict(source, event_id) do nothing;
  if not found then
    select o.id into v_order_id from public.orders o where o.salla_event_id = p_event_id;
    return v_order_id;
  end if;

  insert into public.stores(salla_merchant_id, name) values (p_merchant_id, coalesce(p_store_name, 'Salla'))
  on conflict(salla_merchant_id) do update set name = excluded.name returning id into v_store_id;
  insert into public.customers(store_id, salla_customer_id, name) values (v_store_id, p_customer_id, p_customer_name)
  on conflict(store_id, salla_customer_id) do update set name = excluded.name returning id into v_customer_id;

  insert into public.orders(
    store_id, customer_id, salla_order_id, order_number, product_name, payment_status, status,
    access_token_hash, access_token_expires_at, salla_reference_id, salla_event_id, service_type, customer_phone,
    duration_days, starts_at, expires_at, has_warranty, warranty_days, warranty_expires_at, acknowledgment_text
  ) values (
    v_store_id, v_customer_id, p_order_id, p_order_number, p_product_name, 'paid', 'received',
    encode(digest(gen_random_bytes(32), 'sha256'), 'hex'), now() + interval '30 days', p_order_id, p_event_id,
    p_service_type, p_customer_phone, v_duration, now(), now() + make_interval(days => v_duration),
    v_has_warranty, v_warranty_days,
    case when v_has_warranty then now() + make_interval(days => v_warranty_days) else null end,
    v_acknowledgment
  )
  on conflict(store_id, salla_order_id) do update set updated_at = now()
  returning id into v_order_id;
  return v_order_id;
end $$;

revoke all on function public.ingest_salla_paid_order(text, text, text, text, text, text, text, text, text, public.service_category_enum, integer, boolean, integer, text) from public;

