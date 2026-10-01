-- =========================================================================
--  Upgrade: smart room access (door codes, room devices, room events)
-- =========================================================================
--  Run in the Supabase SQL editor after upgrade-auto-release.sql.
--  Safe to re-run.
--
--  A ROOM DEVICE is the ESP32 at a room's door (simulated in Wokwi). It
--  authenticates with a per-device key; only the SHA-256 of that key is
--  stored here. All device traffic goes through the Vercel API using the
--  service role, so these tables are not writable by any signed-in user.
--
--  Door codes are NOT stored anywhere. The server derives each booking's
--  6-digit code from its id and a secret (ROOM_CODE_SECRET on Vercel), so
--  there is no table of codes to leak - which matters because every signed-in
--  user can currently read the reservations table.
--
--  This supersedes the parked upgrade-occupancy.sql / api/sensor draft.
-- =========================================================================

-- ------------------------------------------------------------- devices --
create table if not exists public.room_devices (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null unique references public.facilities(id) on delete cascade,
  label        text not null,
  key_hash     text not null,            -- sha256(device key), hex
  active       boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- events --
create table if not exists public.room_events (
  id             bigserial primary key,
  device_id      uuid not null references public.room_devices(id) on delete cascade,
  facility_id    uuid not null references public.facilities(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  at             timestamptz not null default now(),
  kind           text not null check (kind in (
                   'unlock_ok', 'unlock_denied', 'door_open', 'door_closed',
                   'presence_on', 'presence_off', 'lights_on', 'lights_off',
                   'ac_on', 'ac_off', 'reminder', 'released_early', 'heartbeat')),
  detail         jsonb
);
create index if not exists room_events_device_time on public.room_events (device_id, at desc);
create index if not exists room_events_facility_time on public.room_events (facility_id, at desc);

-- ------------------------------------------------------------------- RLS --
alter table public.room_devices enable row level security;
alter table public.room_events  enable row level security;

drop policy if exists room_devices_admin on public.room_devices;
create policy room_devices_admin on public.room_devices for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists room_events_read on public.room_events;
create policy room_events_read on public.room_events for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.facility_managers fm
                where fm.facility_id = room_events.facility_id and fm.manager_id = auth.uid())
  );
-- no insert/update/delete policies: only the service role (the API) writes

-- ---------------------------------------- which facilities have a door --
-- Students need to know "this room has a smart door" (show the code, hide
-- the in-app check-in button) without seeing device keys. A plain view runs
-- with its owner's rights, so it can read room_devices and expose only this.
create or replace view public.door_facilities as
  select facility_id from public.room_devices where active;
grant select on public.door_facilities to authenticated;

-- ------------------------------------------------------ register helper --
-- Run in the SQL editor to register (or re-key) the door of one room:
--   select public.register_room_device('Discussion Room A', 'pick-a-long-random-key');
-- Use the returned id and the same key in the Wokwi sketch.
create or replace function public.register_room_device(p_facility_name text, p_device_key text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_fac uuid; v_dev uuid;
begin
  if length(p_device_key) < 16 then
    raise exception 'Use a device key of at least 16 characters.';
  end if;
  select id into v_fac from public.facilities where name = p_facility_name;
  if v_fac is null then
    raise exception 'No facility named "%". Check the exact name in the admin console.', p_facility_name;
  end if;
  insert into public.room_devices (facility_id, label, key_hash)
  values (v_fac, p_facility_name || ' door', encode(sha256(convert_to(p_device_key, 'UTF8')), 'hex'))
  on conflict (facility_id) do update set key_hash = excluded.key_hash, active = true
  returning id into v_dev;
  return v_dev;
end;
$$;
-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- by default, so revoking from PUBLIC alone is not enough: without these,
-- any visitor could re-key the door through the API.
revoke all on function public.register_room_device(text, text) from public, anon, authenticated;
