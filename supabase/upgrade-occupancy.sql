-- Upgrade: occupancy sensing from an ESP32-CAM edge device.
--
-- Privacy by construction: no image is ever transmitted or stored. The device
-- computes a scalar motion-energy metric on-board and posts only that number
-- plus a derived occupied/vacant state. Nothing here can reconstruct a picture
-- of a room or identify a person.
--
-- Run this in the Supabase SQL editor after setup-all.sql.

-- ---------------------------------------------------------------- devices --
create table if not exists public.occupancy_devices (
  id           uuid primary key default gen_random_uuid(),
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  label        text not null,
  key_hash     text not null,              -- sha256 of the device key, never the key
  sample_ms    int  not null default 250,  -- sampling period T
  alpha        numeric not null default 0.20 check (alpha > 0 and alpha <= 1),
  t_high       numeric not null default 3.0,
  t_low        numeric not null default 1.2,
  dwell_s      int  not null default 30,
  active       boolean not null default true,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  check (t_low < t_high)
);

comment on column public.occupancy_devices.alpha is
  'IIR low-pass coefficient. Time constant tau = -T/ln(1-alpha).';
comment on column public.occupancy_devices.t_high is
  'Schmitt trigger upper threshold: vacant -> occupied.';
comment on column public.occupancy_devices.t_low is
  'Schmitt trigger lower threshold: occupied -> vacant.';

create unique index if not exists occupancy_devices_facility_label
  on public.occupancy_devices (facility_id, label);

-- --------------------------------------------------------------- readings --
create table if not exists public.occupancy_readings (
  id           bigserial primary key,
  device_id    uuid not null references public.occupancy_devices(id) on delete cascade,
  facility_id  uuid not null references public.facilities(id) on delete cascade,
  recorded_at  timestamptz not null default now(),
  metric_raw   numeric not null,           -- m[n], mean absolute frame difference
  metric_ema   numeric not null,           -- y[n], after the IIR filter
  occupied     boolean not null,           -- state after hysteresis + dwell
  is_change    boolean not null default false,
  uptime_s     int
);

create index if not exists occupancy_readings_facility_time
  on public.occupancy_readings (facility_id, recorded_at desc);
create index if not exists occupancy_readings_device_time
  on public.occupancy_readings (device_id, recorded_at desc);

-- ------------------------------------------------ live state on facilities --
alter table public.facilities
  add column if not exists sensor_occupied     boolean,
  add column if not exists sensor_updated_at   timestamptz;

comment on column public.facilities.sensor_occupied is
  'Last state published by the room sensor. Null when no device is fitted.';

-- --------------------------------------------- attendance from the sensor --
-- Marks the reservation covering `at_time` as checked in, the first time the
-- room is seen occupied during it. Returns the reservation id, or null.
create or replace function public.sensor_mark_attendance(
  p_facility_id uuid,
  p_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.reservations
     set checked_in_at = p_at,
         no_show       = false
   where facility_id  = p_facility_id
     and status       = 'approved'
     and p_at between start_time and end_time
     and checked_in_at is null
  returning id into v_id;

  return v_id;
end;
$$;

-- Sweeps finished reservations that were never seen occupied and flags them as
-- no-shows. Intended to run on a schedule, or on demand before analytics.
create or replace function public.sensor_sweep_no_shows(
  p_grace interval default interval '10 minutes'
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with updated as (
    update public.reservations r
       set no_show = true
      from public.facilities f
     where r.facility_id     = f.id
       and f.sensor_occupied is not null     -- only rooms that actually have a sensor
       and r.status          = 'approved'
       and r.end_time        < now() - p_grace
       and r.checked_in_at is null
       and r.no_show         = false
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;

-- -------------------------------------------------------------------- RLS --
alter table public.occupancy_devices  enable row level security;
alter table public.occupancy_readings enable row level security;

-- Devices: admins manage, managers read their own facilities. The ingest
-- endpoint uses the service role and bypasses these.
drop policy if exists occ_dev_admin_all on public.occupancy_devices;
create policy occ_dev_admin_all on public.occupancy_devices
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists occ_dev_manager_read on public.occupancy_devices;
create policy occ_dev_manager_read on public.occupancy_devices
  for select using (
    exists (
      select 1 from public.facility_managers m
       where m.facility_id = occupancy_devices.facility_id
         and m.manager_id  = auth.uid()
    )
  );

-- Readings: any signed-in user may read them. They carry no personal data --
-- a motion-energy number and a boolean, with no link to any individual.
drop policy if exists occ_read_authenticated on public.occupancy_readings;
create policy occ_read_authenticated on public.occupancy_readings
  for select using (auth.uid() is not null);

-- ------------------------------------------------------------ registration --
-- Register your device, then put the same key in the firmware. Replace the
-- facility name and pick your own key.
--
--   insert into public.occupancy_devices (facility_id, label, key_hash)
--   select id, 'court-1-cam', encode(digest('CHANGE-ME-DEVICE-KEY', 'sha256'), 'hex')
--     from public.facilities where name = 'Court 1';
--
-- digest() needs pgcrypto:
create extension if not exists pgcrypto;
