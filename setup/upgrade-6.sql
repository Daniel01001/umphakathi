-- ============================================================
-- Upgrade 6: editable/deletable chat messages + 1-on-1 direct messages
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- Let members edit and delete their own community-chat messages.
alter table public.messages
  add column if not exists edited_at timestamptz;

create policy "update own message" on public.messages
  for update to authenticated using (user_id = auth.uid());
create policy "delete own message" on public.messages
  for delete to authenticated using (user_id = auth.uid());

-- ------------------------------------------------------------
-- Direct (1-on-1) messages between two members.
-- ------------------------------------------------------------
create table if not exists public.direct_messages (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references public.profiles (id) on delete cascade,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  body         text,
  image_url    text,
  audio_url    text,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);

create index if not exists dm_pair_idx on public.direct_messages (sender_id, recipient_id, created_at);
create index if not exists dm_recipient_idx on public.direct_messages (recipient_id, created_at);

alter table public.direct_messages enable row level security;

-- You can only ever see DMs you sent or received.
create policy "read my dms" on public.direct_messages
  for select to authenticated
  using (sender_id = auth.uid() or recipient_id = auth.uid());

-- You can only send as yourself.
create policy "send dm" on public.direct_messages
  for insert to authenticated
  with check (sender_id = auth.uid());

-- The recipient may update a message (used to mark it read).
create policy "update received dm" on public.direct_messages
  for update to authenticated
  using (recipient_id = auth.uid());

-- You may delete your own sent DMs.
create policy "delete sent dm" on public.direct_messages
  for delete to authenticated
  using (sender_id = auth.uid());

alter publication supabase_realtime add table public.direct_messages;
