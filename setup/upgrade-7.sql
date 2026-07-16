-- ============================================================
-- Upgrade 7: hide/block members + stories (statuses)
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- Safe to run on the existing database — no data is lost.
-- ============================================================

-- ---- Hide / block another member ----
create table if not exists public.member_flags (
  user_id    uuid not null references public.profiles (id) on delete cascade, -- me
  target_id  uuid not null references public.profiles (id) on delete cascade, -- them
  hidden     boolean not null default false,
  blocked    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, target_id)
);

alter table public.member_flags enable row level security;

-- I can read my own flags. A BLOCKED person may also read the row that blocks
-- them (so their app can say "you're blocked") — but HIDDEN stays invisible
-- because that access requires blocked = true.
create policy "read my flags" on public.member_flags
  for select to authenticated
  using (user_id = auth.uid() or (target_id = auth.uid() and blocked = true));

create policy "insert my flags" on public.member_flags
  for insert to authenticated with check (user_id = auth.uid());
create policy "update my flags" on public.member_flags
  for update to authenticated using (user_id = auth.uid());
create policy "delete my flags" on public.member_flags
  for delete to authenticated using (user_id = auth.uid());

-- Enforce block on direct messages: you cannot send to someone who blocked you.
drop policy if exists "send dm" on public.direct_messages;
create policy "send dm unless blocked" on public.direct_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and not exists (
      select 1 from public.member_flags f
      where f.user_id = recipient_id and f.target_id = auth.uid() and f.blocked
    )
  );

-- ---- Stories / statuses (auto-expire after 1 hour) ----
create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'text',   -- 'text' | 'image'
  body       text,                           -- caption or text content
  image_url  text,
  bg         text,                           -- background colour for text stories
  created_at timestamptz not null default now()
);

create index if not exists stories_recent_idx on public.stories (created_at desc);

alter table public.stories enable row level security;

create policy "read stories" on public.stories
  for select to authenticated using (true);
create policy "insert own story" on public.stories
  for insert to authenticated with check (user_id = auth.uid());
create policy "delete own story" on public.stories
  for delete to authenticated using (user_id = auth.uid());

alter publication supabase_realtime add table public.stories;

-- Optional housekeeping: delete stories older than 1 hour. The app already
-- hides them on read, but you can also schedule this (Database → Cron) to run
-- every few minutes to actually remove the rows:
--   delete from public.stories where created_at < now() - interval '1 hour';
