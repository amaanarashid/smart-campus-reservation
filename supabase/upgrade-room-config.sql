-- =========================================================================
--  Smart room: what is wired to each device (re-runnable)
--  Run after upgrade-room-pairing.sql (and upgrade-room-commands.sql).
--
--  One firmware runs on every board. Each device now has a config: which
--  parts the room has (lock, keypad, screen, motion sensor, lights, air-con by
--  relay or IR, temperature, LED ring) and on which pins. The device gets it
--  when it connects and runs only those parts; the app hides what the room
--  does not have. The shape is checked in the app (src/lib/room-config.ts)
--  and again on the device, which refuses pins its board does not have free.
--
--    board          wokwi-door | esp32-devkit | esp32-cam  (the device says)
--    config         the parts and pins; null = an older door kit (all parts)
--    config_version goes up on every change; the device fetches the new one
--    report         what the device found: firmware, I2C devices, parts ok/missing
--
--  Doors with a keypad keep check-in at the door. A room whose device has no
--  keypad (e.g. an ESP32-CAM running the lights and air-con) checks in from
--  the app, so door_facilities now lists only rooms with lock + keypad.
-- =========================================================================

alter table public.room_devices
  add column if not exists board          text,
  add column if not exists config         jsonb,
  add column if not exists config_version int not null default 1,
  add column if not exists report         jsonb,
  add column if not exists reported_at    timestamptz;

do $$ begin
  alter table public.room_devices add constraint room_devices_board_check
    check (board is null or board in ('wokwi-door', 'esp32-devkit', 'esp32-cam'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.room_devices add constraint room_devices_config_check
    check (config is null or (jsonb_typeof(config) = 'object' and length(config::text) < 8000));
exception when duplicate_object then null; end $$;

alter table public.room_pairings
  add column if not exists board  text not null default 'wokwi-door',
  add column if not exists report jsonb;

-- same view as upgrade-room-connect.sql, new columns at the end
create or replace view public.room_devices_visible as
  select d.id, d.facility_id, d.label, d.active, d.last_seen_at, d.connection,
         d.board, d.config, d.config_version, d.report, d.reported_at
    from public.room_devices d
   where public.is_admin()
      or exists (select 1 from public.facility_managers fm
                  where fm.facility_id = d.facility_id and fm.manager_id = auth.uid());
revoke all on public.room_devices_visible from anon;
grant select on public.room_devices_visible to authenticated;

-- rooms where students check in at the door (keypad + lock)
create or replace view public.door_facilities as
  select facility_id from public.room_devices
   where active and (config is null or (config ? 'lock' and config ? 'keypad'));
grant select on public.door_facilities to authenticated;

-- a board name the device sent, or the old default for its connection type
create or replace function public.room_board(p_board text, p_connection text) returns text
language sql immutable set search_path = public as $$
  select case when p_board in ('wokwi-door', 'esp32-devkit', 'esp32-cam') then p_board
              when p_connection = 'mqtt' then 'esp32-devkit' else 'wokwi-door' end;
$$;
revoke all on function public.room_board(text, text) from public, anon, authenticated;

-- ------------------------------------------------------------ device poll --
-- As in upgrade-room-pairing.sql, plus: the device says which board it is and
-- what it found, and a connected device gets its config back.
drop function if exists public.room_pair_poll(text, text);
create or replace function public.room_pair_poll(
  p_key_hash text, p_connection text default 'wokwi', p_board text default null, p_report jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id      uuid;
  v_label   text;
  v_config  jsonb;
  v_version int;
  v_code    text;
  v_conn    text := case when p_connection = 'mqtt' then 'mqtt' else 'wokwi' end;
  v_board   text := public.room_board(p_board, p_connection);
  v_report  jsonb := case when jsonb_typeof(p_report) = 'object' and length(p_report::text) < 4000 then p_report end;
  v_until   timestamptz := now() + interval '10 minutes';
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad device key.';
  end if;

  update public.room_devices
     set last_seen_at = now(), board = v_board,
         report = coalesce(v_report, report),
         reported_at = case when v_report is not null then now() else reported_at end
   where key_hash = p_key_hash and active
   returning id, label, config, config_version into v_id, v_label, v_config, v_version;
  if found then
    return jsonb_build_object('paired', true, 'device_id', v_id, 'room', v_label,
                              'config', v_config, 'config_version', v_version);
  end if;

  delete from public.room_pairings where expires_at < now();

  update public.room_pairings
     set expires_at = v_until, connection = v_conn, board = v_board, report = coalesce(v_report, report)
   where key_hash = p_key_hash returning code into v_code;
  if found then
    return jsonb_build_object('paired', false, 'code', v_code);
  end if;

  if (select count(*) from public.room_pairings) >= 200 then
    return jsonb_build_object('paired', false, 'code', null);
  end if;

  for i in 1..20 loop
    v_code := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
    begin
      insert into public.room_pairings (key_hash, code, connection, board, report, expires_at)
      values (p_key_hash, v_code, v_conn, v_board, v_report, v_until);
      return jsonb_build_object('paired', false, 'code', v_code);
    exception when unique_violation then
      select code into v_code from public.room_pairings where key_hash = p_key_hash;
      if found then
        return jsonb_build_object('paired', false, 'code', v_code);
      end if;
    end;
  end loop;
  raise exception 'Could not make a pairing code.';
end;
$$;
revoke all on function public.room_pair_poll(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.room_pair_poll(text, text, text, jsonb) to service_role;

-- --------------------------------------------------------- admin: connect --
-- Before connecting: which board is showing this code, and what did it find?
create or replace function public.peek_room_pairing(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare r record;
begin
  if not public.is_admin() then
    raise exception 'Only admins can connect rooms.' using errcode = '42501';
  end if;
  select board, connection, report into r from public.room_pairings
   where code = p_code and expires_at >= now();
  if not found then
    raise exception 'That code was not found. Check the code on the door screen and try again.';
  end if;
  return jsonb_build_object('board', r.board, 'connection', r.connection, 'report', r.report);
end;
$$;
revoke all on function public.peek_room_pairing(text) from public, anon;
grant execute on function public.peek_room_pairing(text) to authenticated;

-- As in upgrade-room-pairing.sql, plus the board, its report and the parts the
-- admin chose. A replaced device gets a new config version so it re-reads it.
drop function if exists public.claim_room_pairing(text, uuid);
create or replace function public.claim_room_pairing(p_code text, p_facility uuid, p_config jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name  text;
  v_hash  text;
  v_conn  text;
  v_board text;
  v_rep   jsonb;
  v_id    uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can connect rooms.' using errcode = '42501';
  end if;
  if p_config is not null and jsonb_typeof(p_config) <> 'object' then
    raise exception 'Bad room setup.';
  end if;
  select name into v_name from public.facilities where id = p_facility;
  if not found then
    raise exception 'That room no longer exists.';
  end if;
  delete from public.room_pairings
   where code = p_code and expires_at >= now()
   returning key_hash, connection, board, report into v_hash, v_conn, v_board, v_rep;
  if not found then
    raise exception 'That code was not found. Check the code on the door screen and try again.';
  end if;
  insert into public.room_devices (facility_id, label, key_hash, active, connection, last_seen_at,
                                   board, config, report, reported_at)
  values (p_facility, v_name || case when p_config is null or p_config ? 'lock' then ' door' else ' room' end,
          v_hash, true, v_conn, null, v_board, p_config, v_rep, case when v_rep is not null then now() end)
  on conflict (facility_id) do update
    set key_hash = excluded.key_hash, active = true, label = excluded.label,
        connection = excluded.connection, last_seen_at = null,
        board = excluded.board, config = excluded.config, report = excluded.report,
        reported_at = excluded.reported_at,
        config_version = public.room_devices.config_version + 1
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_room_pairing(text, uuid, jsonb) from public, anon;
grant execute on function public.claim_room_pairing(text, uuid, jsonb) to authenticated;

-- ------------------------------------------------------ admin: change setup --
-- The device notices the new version on its next status poll and re-reads it.
create or replace function public.set_room_config(p_device uuid, p_config jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_version int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change a room''s setup.' using errcode = '42501';
  end if;
  if p_config is null or jsonb_typeof(p_config) <> 'object' or length(p_config::text) >= 8000 then
    raise exception 'Bad room setup.';
  end if;
  update public.room_devices
     set config = p_config, config_version = config_version + 1,
         label = (select f.name from public.facilities f where f.id = room_devices.facility_id)
                 || case when p_config ? 'lock' then ' door' else ' room' end
   where id = p_device
   returning config_version into v_version;
  if not found then
    raise exception 'That device no longer exists.';
  end if;
  return v_version;
end;
$$;
revoke all on function public.set_room_config(uuid, jsonb) from public, anon;
grant execute on function public.set_room_config(uuid, jsonb) to authenticated;

-- ------------------------------------------------------------ new events --
--   temperature     a reading every few minutes (rooms with a sensor)
--   ir_learned      the device recognised the air-con's remote; the API saves the make
--   ac_no_response  IR "on" was sent but the room did not cool; staff are told
alter table public.room_events drop constraint if exists room_events_kind_check;
alter table public.room_events add constraint room_events_kind_check check (kind in (
  'unlock_ok', 'unlock_denied', 'door_open', 'door_closed',
  'presence_on', 'presence_off', 'lights_on', 'lights_off',
  'ac_on', 'ac_off', 'reminder', 'released_early', 'heartbeat',
  'booking_ended', 'overstay', 'extended', 'extend_denied',
  'temperature', 'ir_learned', 'ac_no_response'));

-- ---------------------------------------------------------- IR learning --
-- New remote command: point the air-con's own remote at the room's IR
-- receiver and press a button; the device works out the make.
alter table public.room_commands drop constraint if exists room_commands_kind_check;
alter table public.room_commands add constraint room_commands_kind_check
  check (kind in ('unlock', 'lights', 'ac', 'message', 'lockdown', 'ir_learn'));

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
    when 'ir_learn' then 'started learning the air-con remote in'
    else NEW.kind end;
  insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
  values (NEW.issued_by, coalesce(who, 'Someone'), 'remote', 'room_command', NEW.id,
          coalesce(who, 'Someone') || ' remotely ' || what || ' ' || coalesce(fname, 'a room'));
  return NEW;
end $$;
revoke all on function public.log_room_command() from public, anon, authenticated;
