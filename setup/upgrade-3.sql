-- ============================================================
-- Upgrade 3: profile pictures
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- A member can have an avatar photo (stored in the "photos" bucket).
alter table public.profiles
  add column if not exists avatar_url text;

-- Photos bucket already allows members to upload into their own folder
-- (see schema.sql). Avatars live under avatars/<user-id>.jpg — same rule.
