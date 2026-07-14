-- ============================================================
-- Umphakathi – Community Hub database setup
-- Run this ONCE in your Supabase project:
--   Dashboard → SQL Editor → New query → paste → Run
-- Then create a public storage bucket named "photos"
--   (Dashboard → Storage → New bucket → name: photos → Public).
-- ============================================================

-- Member profiles (linked to Supabase auth accounts)
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  area         text,
  created_at   timestamptz not null default now()
);

-- Feed posts
create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  category   text not null default 'general',
  body       text not null,
  image_url  text,
  created_at timestamptz not null default now()
);

-- Likes (one per member per post)
create table public.likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Comments
create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

-- Community chat messages
create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

-- Business directory
create table public.businesses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  name        text not null,
  category    text,
  area        text,
  description text,
  phone       text,
  whatsapp    text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Security (Row Level Security):
-- members can read everything, write their own content only.
-- ------------------------------------------------------------

alter table public.profiles   enable row level security;
alter table public.posts      enable row level security;
alter table public.likes      enable row level security;
alter table public.comments   enable row level security;
alter table public.messages   enable row level security;
alter table public.businesses enable row level security;

create policy "read profiles"   on public.profiles   for select to authenticated using (true);
create policy "read posts"      on public.posts      for select to authenticated using (true);
create policy "read likes"      on public.likes      for select to authenticated using (true);
create policy "read comments"   on public.comments   for select to authenticated using (true);
create policy "read messages"   on public.messages   for select to authenticated using (true);
create policy "read businesses" on public.businesses for select to authenticated using (true);

create policy "insert own profile" on public.profiles for insert to authenticated
  with check (id = auth.uid());
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid());

create policy "insert own post" on public.posts for insert to authenticated
  with check (user_id = auth.uid());
create policy "delete own post" on public.posts for delete to authenticated
  using (user_id = auth.uid());

create policy "insert own like" on public.likes for insert to authenticated
  with check (user_id = auth.uid());
create policy "delete own like" on public.likes for delete to authenticated
  using (user_id = auth.uid());

create policy "insert own comment" on public.comments for insert to authenticated
  with check (user_id = auth.uid());
create policy "delete own comment" on public.comments for delete to authenticated
  using (user_id = auth.uid());

create policy "insert own message" on public.messages for insert to authenticated
  with check (user_id = auth.uid());

create policy "insert own business" on public.businesses for insert to authenticated
  with check (user_id = auth.uid());
create policy "update own business" on public.businesses for update to authenticated
  using (user_id = auth.uid());
create policy "delete own business" on public.businesses for delete to authenticated
  using (user_id = auth.uid());

-- Photo uploads: members may upload into their own folder.
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "read photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos');

-- Realtime chat: broadcast new messages to everyone in the app.
alter publication supabase_realtime add table public.messages;
