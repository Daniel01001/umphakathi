-- ============================================================
-- Upgrade 1: comment replies + emoji reactions
-- Run ONCE in Supabase: Dashboard → SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- Replies: a comment may point at the comment it replies to.
alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;

-- Reactions: a like now carries which emoji was chosen.
-- Existing likes become 👍 automatically.
alter table public.likes
  add column if not exists reaction text not null default '👍';
