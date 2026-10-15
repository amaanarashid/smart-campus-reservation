-- =========================================================================
--  Upgrade: end of booking - reminder, extension, overstay, energy events
-- =========================================================================
--  Run in the Supabase SQL editor AFTER upgrade-room-access.sql.
--  Safe to re-run.
--
--  1. REMINDER   pg_cron, every minute: a running booking with 10 minutes or
--                less left gets one in-app notification ("ends at 4:00 pm").
--  2. EXTENSION  extend_booking(id, mins): +30 min by default, approved at
--                once if the room is free next, never past closing time or
--                the room's maximum booking length. Used by the student's
--                dashboard and by the door keypad (A + code + #).
--                The no-overlap constraint still has the final say.
--  3. OVERSTAY   the room device reports people still inside after the end;
--                the API notifies the managers once per booking. No penalty.
--  4. ENERGY     room_events gains the new kinds; lights/AC on-off events are
--                what the admin energy figures are computed from.
-- =========================================================================

-- ---------------------------------------------------------------- columns --
alter table public.reservations
  add column if not exists end_reminded_at timestamptz;
alter table public.reservations
  add column if not exists extended_mins int not null default 0;

-- --------------------------------------------- new room event kinds --
alter table public.room_events drop constraint if exists room_events_kind_check;
alter table public.room_events add constraint room_events_kind_check check (kind in (
  'unlock_ok', 'unlock_denied', 'door_open', 'door_closed',
  'presence_on', 'presence_off', 'lights_on', 'lights_off',
  'ac_on', 'ac_off', 'reminder', 'released_early', 'heartbeat',
  'booking_ended', 'overstay', 'extended', 'extend_denied'));

-- ------------------------------------- devices visible to their managers --
-- room_devices is admin-only (it holds the key hash). Managers need to see
-- that their room has a device and when it was last heard from, for the room
-- readings on their dashboard. A plain view runs with its owner's rights, so
-- it filters by caller here and never exposes key_hash.
create or replace view public.room_devices_visible as
  select d.id, d.facility_id, d.label, d.active, d.last_seen_at
    from public.room_devices d
   where public.is_admin()
      or exists (select 1 from public.facility_managers fm
                  where fm.facility_id = d.facility_id and fm.manager_id = auth.uid());
revoke all on public.room_devices_visible from anon;
grant select on public.room_devices_visible to authenticated;

-- ------------------------------------------------------------ extension --
-- Returns {"ok":true,"added_mins":30,"new_end":"..."} or
--         {"ok":false,"reason":"next_slot_taken" | "closing_time" | "max_length" | ...}
-- Signed-in students may only extend their own booking. The API (service
-- role, no auth.uid()) may extend any booking after checking the door code.
create or replace function public.extend_booking(p_id uuid, p_mins int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b          public.reservations%rowtype;
  e          record;
  v_now      timestamptz := now();
  v_close    timestamptz;
  v_max_end  timestamptz;
  v_next     timestamptz;
  v_new_end  timestamptz;
  v_add      int;
  v_mins     int := least(greatest(coalesce(p_mins, 30), 15), 60);
begin
  select * into b from public.reservations where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if auth.uid() is not null and b.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'reason', 'not_yours');
  end if;
  if b.status <> 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'not_approved');
  end if;
  if b.start_time > v_now or b.end_time <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;
  if b.checked_in_at is null then
    return jsonb_build_object('ok', false, 'reason', 'not_checked_in');
  end if;

  select * into e from public.effective_facility_rules where facility_id = b.facility_id;

  -- closing time on the booking's day, Malaysia time
  v_close := ((b.start_time at time zone 'Asia/Kuala_Lumpur')::date + e.close_time)
             at time zone 'Asia/Kuala_Lumpur';
  v_max_end := b.start_time + make_interval(mins => e.max_duration_mins);
  -- the next booking (pending ones hold the slot too)
  select min(start_time) into v_next
    from public.reservations
   where facility_id = b.facility_id and id <> b.id
     and status in ('pending', 'approved')
     and start_time >= b.end_time;

  v_new_end := least(b.end_time + make_interval(mins => v_mins), v_close, v_max_end,
                     coalesce(v_next, 'infinity'::timestamptz));
  v_add := round(extract(epoch from (v_new_end - b.end_time)) / 60);

  if v_add < 15 then
    return jsonb_build_object('ok', false, 'reason',
      case
        when v_next is not null and v_next < b.end_time + interval '15 minutes' then 'next_slot_taken'
        when v_max_end < b.end_time + interval '15 minutes' then 'max_length'
        else 'closing_time'
      end);
  end if;

  begin
    update public.reservations
       set end_time        = v_new_end,
           extended_mins   = extended_mins + v_add,
           end_reminded_at = null          -- remind again before the new end
     where id = b.id;
  exception when exclusion_violation then
    return jsonb_build_object('ok', false, 'reason', 'next_slot_taken');
  end;

  return jsonb_build_object('ok', true, 'added_mins', v_add, 'new_end', v_new_end,
                            'partial', v_add < v_mins);
end;
$$;
revoke all on function public.extend_booking(uuid, int) from public, anon;
grant execute on function public.extend_booking(uuid, int) to authenticated, service_role;

-- ------------------------------------------------------------- reminder --
create or replace function public.remind_booking_end()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare rec record; n int := 0;
begin
  for rec in
    update public.reservations r
       set end_reminded_at = now()
     where r.status = 'approved'
       and r.end_reminded_at is null
       and r.start_time <= now()
       and r.end_time > now()
       and r.end_time <= now() + interval '10 minutes'
       and r.end_time - r.start_time > interval '15 minutes'
    returning r.id, r.user_id, r.facility_id, r.end_time
  loop
    insert into public.notifications (user_id, title, body, type, entity_id)
    values (
      rec.user_id,
      'Booking ending soon',
      'Your booking for ' || coalesce((select name from public.facilities where id = rec.facility_id), 'a facility')
        || ' ends at ' || to_char(rec.end_time at time zone 'Asia/Kuala_Lumpur', 'HH12:MI am')
        || '. Need longer? Extend it from your dashboard if the room is free next.',
      'booking_ending',
      rec.id
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.remind_booking_end() from public, anon, authenticated;

-- --------------------------------------------------------------- schedule --
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'remind-booking-end') then
    perform cron.unschedule('remind-booking-end');
  end if;
  perform cron.schedule('remind-booking-end', '* * * * *', 'select public.remind_booking_end()');
end $$;

-- Check:  select jobname, schedule, active from cron.job;
