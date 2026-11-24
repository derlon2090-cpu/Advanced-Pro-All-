-- Operational capacity and post-expiry access-review metadata.
-- Credentials are never stored in, or surfaced by, these fields.

alter table public.email_accounts
  add column if not exists max_slots integer not null default 3 check (max_slots > 0),
  add column if not exists access_reviewed_at timestamptz;

create index if not exists account_assignments_active_account_idx
  on public.account_assignments(email_account_id)
  where released_at is null;

-- A provider account's active seat count is the number of assignments with
-- released_at IS NULL. Keep this calculation server-side for admin-only views.
