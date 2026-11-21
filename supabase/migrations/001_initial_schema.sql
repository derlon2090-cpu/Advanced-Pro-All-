-- Crunchyroll Code Hub: initial Supabase schema
create extension if not exists pgcrypto;

create type public.order_status as enum ('received','preparing','delivered','no_security_action','security_action_required','awaiting_customer','follow_up_complete','failed');
create type public.message_status as enum ('received','classified','unmatched','ignored','failed');

create table public.stores (id uuid primary key default gen_random_uuid(), salla_merchant_id text not null unique, name text not null, created_at timestamptz not null default now());
create table public.customers (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id), salla_customer_id text not null, email text, name text, created_at timestamptz not null default now(), unique(store_id, salla_customer_id));
create table public.orders (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id), customer_id uuid references public.customers(id), salla_order_id text not null, order_number text not null, product_name text, payment_status text not null default 'pending', status public.order_status not null default 'received', access_token_hash text not null, access_token_expires_at timestamptz not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(store_id,salla_order_id), unique(store_id,order_number));
create table public.email_accounts (id uuid primary key default gen_random_uuid(), store_id uuid not null references public.stores(id), mailbox_alias text not null unique, encrypted_connection jsonb, is_active boolean not null default true, last_received_at timestamptz, created_at timestamptz not null default now());
create table public.account_assignments (id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.orders(id), email_account_id uuid not null references public.email_accounts(id), assigned_at timestamptz not null default now(), released_at timestamptz);
create table public.incoming_messages (id uuid primary key default gen_random_uuid(), provider_message_id text not null unique, email_account_id uuid references public.email_accounts(id), received_at timestamptz not null, sender_domain text, subject_hash text, classification public.message_status not null default 'received', retention_expires_at timestamptz not null, created_at timestamptz not null default now());
create table public.security_notifications (id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id), incoming_message_id uuid not null unique references public.incoming_messages(id), event_at timestamptz, device_summary text, location_summary text, customer_confirmed_at timestamptz, created_at timestamptz not null default now());
create table public.audit_logs (id bigint generated always as identity primary key, store_id uuid references public.stores(id), actor_type text not null, actor_id text, action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

alter table public.orders enable row level security;
alter table public.security_notifications enable row level security;
-- Client access must be made only through a server endpoint that validates a short-lived order token.
create index orders_store_status_idx on public.orders(store_id,status);
create index messages_account_received_idx on public.incoming_messages(email_account_id,received_at desc);
