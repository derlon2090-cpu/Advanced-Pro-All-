alter table public.order_reviews
  add column if not exists salla_feedback_id text,
  add column if not exists salla_publish_state text
    check (salla_publish_state in ('sending', 'published', 'failed', 'check_required')),
  add column if not exists salla_publish_started_at timestamptz,
  add column if not exists salla_publish_note text;

create unique index if not exists order_reviews_salla_feedback_unique
  on public.order_reviews(salla_feedback_id) where salla_feedback_id is not null;
