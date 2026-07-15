-- ============================================================
-- Upgrade 5: edited posts + voice replies
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- Remember when a post was edited (null = never edited).
alter table public.posts
  add column if not exists edited_at timestamptz;

-- Voice notes: a comment or a chat message may carry an audio clip
-- (stored in the "photos" bucket, under the member's own folder).
alter table public.comments
  add column if not exists audio_url text;
alter table public.messages
  add column if not exists audio_url text;
