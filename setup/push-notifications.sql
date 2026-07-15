-- ============================================================
-- Push notifications: store each device's push subscription.
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

create table if not exists public.push_subscriptions (
  endpoint     text primary key,          -- unique per device/browser
  user_id      uuid not null references public.profiles (id) on delete cascade,
  subscription jsonb not null,            -- the full PushSubscription object
  created_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A member manages only their own device subscriptions.
create policy "read own subscriptions" on public.push_subscriptions
  for select to authenticated using (user_id = auth.uid());
create policy "insert own subscription" on public.push_subscriptions
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own subscription" on public.push_subscriptions
  for update to authenticated using (user_id = auth.uid());
create policy "delete own subscription" on public.push_subscriptions
  for delete to authenticated using (user_id = auth.uid());
