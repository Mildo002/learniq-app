-- LearnIQ 0006: upozornenia (web push) pre tím školiteľa
-- lq_push_subs  = zariadenia, na ktorých si člen tímu zapol upozornenia (každý vidí a mení iba svoje)
-- lq_notifications = odoslané upozornenia; neprečítané = číslo na ikone aplikácie. Zapisuje iba server.
-- Kľúče VAPID sú v lq_secrets (iba server), verejný kľúč vydáva edge funkcia.

create table if not exists lq_push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) < 1000),
  p256dh text not null check (length(p256dh) < 200),
  auth text not null check (length(auth) < 100),
  device text check (length(device) < 100),
  created_at timestamptz not null default now()
);
create index if not exists lq_push_subs_user on lq_push_subs (user_id);
alter table lq_push_subs enable row level security;
create policy lq_push_own on lq_push_subs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists lq_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid references lq_tenants(id) on delete cascade,
  title text not null,
  body text,
  url text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists lq_notifications_unread on lq_notifications (user_id) where read_at is null;
alter table lq_notifications enable row level security;
create policy lq_notif_read on lq_notifications for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on lq_notifications from anon, authenticated;

-- označenie upozornení za prečítané (otvorenie aplikácie) – iba vlastné, iba stĺpec read_at
create or replace function lq_mark_seen() returns integer
language sql security definer set search_path = public as $$
  with u as (update lq_notifications set read_at = now() where user_id = auth.uid() and read_at is null returning 1)
  select count(*)::int from u;
$$;
revoke all on function lq_mark_seen() from public, anon;
grant execute on function lq_mark_seen() to authenticated;
create index if not exists lq_notifications_tenant on lq_notifications (tenant_id);
