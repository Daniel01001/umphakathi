-- ============================================================
-- Push triggers (alternative to the Database Webhooks UI)
-- Newer Supabase moved "Database Webhooks" under Integrations and
-- some projects don't show it. This does the same job in SQL:
-- whenever a post or chat message is added, it calls your
-- send-push Edge Function.
--
-- BEFORE RUNNING: replace the two placeholders below:
--   <PROJECT_REF>  → your project ref (the bit before .supabase.co)
--                    for this project it is: bwpyhcuhqezujlbxkrsr
--   <ANON_KEY>     → your anon public key (same one in js/config.js)
--
-- Run ONCE in Supabase: SQL Editor → paste → Run.
-- ============================================================

create extension if not exists pg_net;

create or replace function public.notify_push()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>'
    ),
    body    := jsonb_build_object(
      'table',  tg_table_name,
      'record', row_to_json(new)
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_post on public.posts;
create trigger on_new_post
  after insert on public.posts
  for each row execute function public.notify_push();

-- Comment out the next block if you DON'T want chat notifications.
drop trigger if exists on_new_message on public.messages;
create trigger on_new_message
  after insert on public.messages
  for each row execute function public.notify_push();
