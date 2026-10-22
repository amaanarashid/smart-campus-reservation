-- =========================================================================
--  Upgrade: live updates (Supabase Realtime)
-- =========================================================================
--  Run in the Supabase SQL editor after the room upgrades. Safe to re-run.
--
--  Lets the browser be told the moment a row changes, instead of asking
--  every few seconds: the 3D twin and room page react to what the Wokwi room
--  reports within about half a second, and the remote-control panel turns
--  "waiting for room" into "done" as soon as the device confirms.
--
--  Realtime respects row-level security: each user only receives changes to
--  rows they are allowed to read.
-- =========================================================================

do $$
declare t text;
begin
  foreach t in array array['room_events', 'room_commands', 'reservations'] loop
    if to_regclass('public.' || t) is not null and not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Check:  select tablename from pg_publication_tables where pubname = 'supabase_realtime';
