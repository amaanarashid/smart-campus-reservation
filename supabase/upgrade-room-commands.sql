-- =========================================================================
--  Upgrade: remote control of a smart room (MQTT commands)
-- =========================================================================
--  Run in the Supabase SQL editor after upgrade-room-access.sql.
--  Safe to re-run.
--
--  An admin, or a manager of the room, presses a control next to the room's
--  3D twin (unlock, lights / air-con override, door message, lockdown).
--  The API checks who they are, writes the command here, signs it and
--  publishes it over MQTT. The ESP32 verifies the signature, acts, and
--  reports back, which moves the row from 'sent' to 'done' or 'failed'.
--  Commands nobody picked up in time end as 'expired'.
--
--  Only the API (service role) writes this table. Staff of the room can read
--  it, to see what was sent and whether the room did it.
-- =========================================================================

create table if not exists public.room_commands (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references public.room_devices(id) on delete cascade,
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  kind         text not null check (kind in ('unlock', 'lights', 'ac', 'message', 'lockdown')),
  args         jsonb not null default '{}'::jsonb,
  issued_by    uuid references public.profiles(id) on delete set null,
  issued_at    timestamptz not null default now(),
  expires_at   timestamptz not null,
  status       text not null default 'sent' check (status in ('sent', 'done', 'failed', 'expired')),
  via          text check (via is null or via in ('mqtt', 'http')),   -- how the device got it
  result       jsonb,
  done_at      timestamptz
);
create index if not exists room_commands_device_idx on public.room_commands (device_id, issued_at desc);
create index if not exists room_commands_pending_idx on public.room_commands (device_id, status, expires_at);

alter table public.room_commands enable row level security;

-- same helper as upgrade-room-reports.sql (kept here so the files run in any order)
create or replace function public.is_room_staff(p_facility uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.facility_managers fm
     where fm.facility_id = p_facility and fm.manager_id = auth.uid());
$$;

drop policy if exists room_commands_read on public.room_commands;
create policy room_commands_read on public.room_commands for select to authenticated
  using (public.is_room_staff(facility_id));
-- no insert/update/delete policies: only the API (service role) writes

-- ------------------------------------------------------------ activity log --
create or replace function public.log_room_command() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; fname text; what text;
begin
  select coalesce(full_name, 'Someone') into who from public.profiles where id = NEW.issued_by;
  select name into fname from public.facilities where id = NEW.facility_id;
  what := case NEW.kind
    when 'unlock' then 'unlocked the door of'
    when 'lights' then 'set the lights ' || coalesce(NEW.args ->> 'state', '') || ' in'
    when 'ac' then 'set the air-con ' || coalesce(NEW.args ->> 'state', '') || ' in'
    when 'message' then 'put a message on the door of'
    when 'lockdown' then case when (NEW.args ->> 'on')::boolean then 'locked down' else 'lifted the lockdown of' end
    else NEW.kind end;
  insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
  values (NEW.issued_by, coalesce(who, 'Someone'), 'remote', 'room_command', NEW.id,
          coalesce(who, 'Someone') || ' remotely ' || what || ' ' || coalesce(fname, 'a room'));
  return NEW;
end $$;

drop trigger if exists trg_log_room_command on public.room_commands;
create trigger trg_log_room_command after insert on public.room_commands
  for each row execute function public.log_room_command();

revoke all on function public.log_room_command() from public, anon, authenticated;
