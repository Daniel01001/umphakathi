-- ============================================================
-- Upgrade 8: reactions, replies, and edit/delete for 1-on-1 chats
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- Reply to a direct message + track edits.
alter table public.direct_messages
  add column if not exists parent_id uuid references public.direct_messages (id) on delete set null;
alter table public.direct_messages
  add column if not exists edited_at timestamptz;

-- Let the sender edit their own DM (there is already an update policy for the
-- recipient, used to mark messages read).
create policy "update own dm sent" on public.direct_messages
  for update to authenticated using (sender_id = auth.uid());

-- Emoji reactions on direct messages.
create table if not exists public.direct_message_reactions (
  message_id uuid not null references public.direct_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  reaction   text not null default '👍',
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.direct_message_reactions enable row level security;

-- You may read/act on reactions only for DMs you're part of.
create policy "read dm reactions" on public.direct_message_reactions
  for select to authenticated
  using (exists (
    select 1 from public.direct_messages d
    where d.id = message_id and (d.sender_id = auth.uid() or d.recipient_id = auth.uid())
  ));
create policy "insert own dm reaction" on public.direct_message_reactions
  for insert to authenticated with check (user_id = auth.uid());
create policy "update own dm reaction" on public.direct_message_reactions
  for update to authenticated using (user_id = auth.uid());
create policy "delete own dm reaction" on public.direct_message_reactions
  for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.direct_message_reactions;
