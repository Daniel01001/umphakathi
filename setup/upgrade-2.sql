-- ============================================================
-- Upgrade 2: chat replies + chat emoji reactions
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- A chat message may reply to another chat message (WhatsApp-style).
alter table public.messages
  add column if not exists parent_id uuid references public.messages (id) on delete set null;

-- Emoji reactions on chat messages (one per member per message).
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reaction   text not null default '👍',
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reactions enable row level security;

create policy "read message reactions" on public.message_reactions
  for select to authenticated using (true);
create policy "insert own message reaction" on public.message_reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own message reaction" on public.message_reactions
  for update to authenticated using (user_id = auth.uid());
create policy "delete own message reaction" on public.message_reactions
  for delete to authenticated using (user_id = auth.uid());

-- Live updates for reactions (messages are already realtime).
alter publication supabase_realtime add table public.message_reactions;
