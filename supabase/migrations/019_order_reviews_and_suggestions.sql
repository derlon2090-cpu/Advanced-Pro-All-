-- Customer service reviews and categorized suggestions, attached to one order.
-- Numbered 019 because 018_subscription_starts_on_fulfillment.sql already exists.
create table if not exists public.order_reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  order_number text not null,
  customer_name text,
  product_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text,
  suggestion_category text check (suggestion_category is null or suggestion_category in ('activation_speed', 'portal_ux', 'new_feature', 'support', 'other')),
  suggestion_text text,
  status text not null default 'pending' check (status in ('pending', 'published', 'hidden')),
  is_negative boolean not null default false,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  constraint order_reviews_one_per_order unique (order_id),
  constraint order_reviews_suggestion_pair check (
    (suggestion_category is null and suggestion_text is null)
    or (suggestion_category is not null and nullif(btrim(suggestion_text), '') is not null)
  )
);

create or replace function public.set_order_review_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.is_negative := new.rating <= 3;
  new.comment := nullif(btrim(new.comment), '');
  new.suggestion_text := nullif(btrim(new.suggestion_text), '');
  if new.status = 'pending' then
    new.reviewed_at := null;
  elsif new.reviewed_at is null then
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists order_reviews_set_flags on public.order_reviews;
create trigger order_reviews_set_flags
before insert or update on public.order_reviews
for each row execute function public.set_order_review_flags();

create index if not exists order_reviews_status_created_idx
  on public.order_reviews (status, created_at desc);
create index if not exists order_reviews_negative_created_idx
  on public.order_reviews (is_negative, created_at desc);
create index if not exists order_reviews_suggestion_created_idx
  on public.order_reviews (suggestion_category, created_at desc)
  where suggestion_category is not null;

alter table public.order_reviews enable row level security;
revoke all on table public.order_reviews from anon, authenticated;

