-- ============================================================
-- Upgrade 4: comment likes + chat image attachments
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- Likes on comments (one per member per comment).
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

alter table public.comment_likes enable row level security;

create policy "read comment likes" on public.comment_likes
  for select to authenticated using (true);
create policy "insert own comment like" on public.comment_likes
  for insert to authenticated with check (user_id = auth.uid());
create policy "delete own comment like" on public.comment_likes
  for delete to authenticated using (user_id = auth.uid());

-- Chat messages can carry a photo (stored in the "photos" bucket).
alter table public.messages
  add column if not exists image_url text;
