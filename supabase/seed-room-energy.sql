-- =========================================================================
--  CAMPUS RESERVE - SEED A WEEK OF SMART-ROOM READINGS (library room)
-- =========================================================================
--  Fills the last 7 days (not today - today stays live from Wokwi) for the
--  room that has the door device, so Admin -> Smart room and the facility
--  manager's "Smart room" section show realistic energy figures and a log.
--
--  BEFORE RUNNING: upgrade-room-access.sql and upgrade-room-end.sql, and the
--  door registered with register_room_device(). At least one student account
--  must exist (the demo student, or the @seed.campus students).
--
--  What it creates, per day, 4 bookings in the room, each one of:
--    normal      checked in at the door, people leave a few minutes early,
--                sometimes a 15-20 min break mid-session (lights + AC off)
--    early leave group leaves half-way; room empty 2 min -> released early
--    no-show     nobody comes; AC pre-cooled then off after the grace period;
--                booking released by the check-in rule
--    extended    extended +30 min from the keypad
--    overstay    people stay 12 min after the end; managers notified
--  with the room_events the ESP32 would have sent (pre-cool, presence,
--  lights, air-con, door, reminders, booking_ended, ...).
--
--  Everything is tagged: bookings "[seed] room energy demo", events with
--  detail.seed = true. SAFE TO RE-RUN: it deletes its previous rows first.
--  Removed by seed-test-data-remove.sql, or by the two DELETEs below.
-- =========================================================================

-- remove the previous run
delete from public.room_events  where detail ->> 'seed' = 'true';
delete from public.reservations where purpose = '[seed] room energy demo';

do $$
declare
  v_dev    uuid;
  v_fac    uuid;
  v_name   text;
  v_open   time;
  v_close  time;
  v_grace  int;
  v_users  uuid[];
  d        date;
  slot     record;
  v_kind   text;
  v_s      timestamptz;
  v_e      timestamptz;
  v_out    timestamptz;
  v_res    uuid;
  v_r      float;
  n_book   int := 0;
  n_ev     int := 0;
  i        int := 0;
  -- inline helper: one event row
  ev       text := 'insert into public.room_events (device_id, facility_id, reservation_id, at, kind, detail) values ($1,$2,$3,$4,$5,$6)';
begin
  perform setseed(0.42);   -- same week every run

  select d0.id, d0.facility_id into v_dev, v_fac
    from public.room_devices d0 where d0.active order by d0.created_at limit 1;
  if v_dev is null then
    raise exception 'No room device registered. Run: select public.register_room_device(''<room name>'', ''<long key>'');';
  end if;
  select f.name, e.open_time, e.close_time, coalesce(e.checkin_grace_mins, 10)
    into v_name, v_open, v_close, v_grace
    from public.facilities f join public.effective_facility_rules e on e.facility_id = f.id
   where f.id = v_fac;

  select array_agg(id) into v_users from (
    select id from public.profiles
     where role = 'student' and (email like '%@seed.campus' or email = 'student@demo.campus')
     order by email limit 6) u;
  if v_users is null then
    select array_agg(id) into v_users from (select id from public.profiles where role = 'student' limit 6) u;
  end if;
  if v_users is null then raise exception 'No student accounts yet - sign in once as the demo student.'; end if;

  for back in 1..7 loop
    d := (now() at time zone 'Asia/Kuala_Lumpur')::date - back;
    for slot in
      select * from (values ('10:00'::time, 120), ('13:00'::time, 120), ('16:00'::time, 60), ('19:00'::time, 120)) t(st, mins)
    loop
      continue when slot.st < v_open or slot.st + make_interval(mins => slot.mins) > v_close;
      i := i + 1;
      v_r := random();
      v_kind := case
        when v_r < 0.50 then 'normal'
        when v_r < 0.65 then 'early'
        when v_r < 0.80 then 'noshow'
        when v_r < 0.90 then 'extended'
        else 'overstay' end;
      v_s := (d + slot.st) at time zone 'Asia/Kuala_Lumpur';
      v_e := v_s + make_interval(mins => slot.mins);
      if v_kind = 'extended' then v_e := v_e + interval '30 minutes'; end if;

      begin
        insert into public.reservations (facility_id, user_id, start_time, end_time, participants, purpose, status,
                                         checked_in_at, no_show, cancel_reason, released_at, extended_mins)
        values (v_fac, v_users[1 + i % array_length(v_users, 1)], v_s, v_e, 2 + (i % 4),
                '[seed] room energy demo',
                case when v_kind = 'noshow' then 'cancelled' else 'approved' end,
                case when v_kind = 'noshow' then null else v_s + interval '2 minutes' end,
                v_kind = 'noshow',
                case v_kind when 'noshow' then 'no_checkin' when 'early' then 'early_leave' else null end,
                case v_kind when 'noshow' then v_s + make_interval(mins => v_grace) else null end,
                case when v_kind = 'extended' then 30 else 0 end)
        returning id into v_res;
      exception when exclusion_violation or unique_violation then
        continue;   -- a real booking holds this time; leave it alone
      end;
      n_book := n_book + 1;

      -- pre-cooling: AC on 5 min before every booking
      execute ev using v_dev, v_fac, null::uuid, v_s - interval '5 minutes', 'ac_on', '{"precool":true,"seed":true}'::jsonb;

      if v_kind = 'noshow' then
        -- AC held through the grace period, then off; nobody came
        execute ev using v_dev, v_fac, v_res, v_s + make_interval(mins => v_grace), 'ac_off', '{"precool":false,"seed":true}'::jsonb;
        n_ev := n_ev + 2;
        continue;
      end if;

      -- arrival: code at the door, door open/close, presence, lights
      execute ev using v_dev, v_fac, v_res, v_s + interval '2 minutes', 'unlock_ok', '{"first_check_in":true,"seed":true}'::jsonb;
      execute ev using v_dev, v_fac, v_res, v_s + interval '2 minutes 10 seconds', 'door_open', '{"forced":false,"seed":true}'::jsonb;
      execute ev using v_dev, v_fac, v_res, v_s + interval '2 minutes 25 seconds', 'door_closed', '{"seed":true}'::jsonb;
      execute ev using v_dev, v_fac, v_res, v_s + interval '3 minutes', 'presence_on', '{"seed":true}'::jsonb;
      execute ev using v_dev, v_fac, v_res, v_s + interval '3 minutes', 'lights_on', '{"seed":true}'::jsonb;
      n_ev := n_ev + 6;

      if v_kind = 'early' then
        -- group leaves half-way; after vacancy + warning the room is empty,
        -- 2 min later the device asks for early release
        v_out := v_s + make_interval(mins => slot.mins / 2);
        execute ev using v_dev, v_fac, v_res, v_out, 'presence_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'lights_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'ac_off', '{"precool":false,"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out + interval '2 minutes', 'released_early',
          jsonb_build_object('released', true, 'freed_mins', slot.mins / 2 - 2, 'seed', true);
        update public.reservations
           set end_time = v_out + interval '2 minutes', released_at = v_out + interval '2 minutes'
         where id = v_res;
        n_ev := n_ev + 4;
        continue;
      end if;

      -- sometimes a break mid-session: room empty 15-20 min, lights and AC off
      if v_kind = 'normal' and random() < 0.5 then
        v_out := v_s + make_interval(mins => slot.mins / 2);
        execute ev using v_dev, v_fac, v_res, v_out, 'presence_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'lights_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'ac_off', '{"precool":false,"seed":true}'::jsonb;
        v_out := v_out + make_interval(mins => 15 + (random() * 5)::int);
        execute ev using v_dev, v_fac, v_res, v_out, 'presence_on', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'lights_on', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'ac_on', '{"precool":false,"seed":true}'::jsonb;
        n_ev := n_ev + 6;
      end if;

      if v_kind = 'extended' then
        execute ev using v_dev, v_fac, v_res, v_e - interval '38 minutes', 'reminder', '{"minutes_left":10,"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_e - interval '34 minutes', 'extended',
          '{"added_mins":30,"via":"keypad","seed":true}'::jsonb;
        n_ev := n_ev + 2;
      end if;
      execute ev using v_dev, v_fac, v_res, v_e - interval '10 minutes', 'reminder', '{"minutes_left":10,"seed":true}'::jsonb;
      execute ev using v_dev, v_fac, v_res, v_e - interval '5 minutes', 'reminder', '{"minutes_left":5,"seed":true}'::jsonb;
      n_ev := n_ev + 2;

      if v_kind = 'overstay' then
        -- still inside after the end: AC off with the booking, lights stay
        -- for safety, overstay reported, they leave 12 min late
        execute ev using v_dev, v_fac, v_res, v_e, 'booking_ended', '{"occupied":true,"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_e, 'ac_off', '{"precool":false,"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_e + interval '4 minutes', 'overstay', '{"minutes_over":4,"seed":true}'::jsonb;
        v_out := v_e + interval '12 minutes';
        execute ev using v_dev, v_fac, null::uuid, v_out, 'presence_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, null::uuid, v_out, 'lights_off', '{"seed":true}'::jsonb;
        n_ev := n_ev + 5;
      else
        -- usual ending: people leave a few minutes before the end
        v_out := v_e - make_interval(mins => (random() * 8)::int);
        execute ev using v_dev, v_fac, v_res, v_out, 'presence_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'lights_off', '{"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_out, 'ac_off', '{"precool":false,"seed":true}'::jsonb;
        execute ev using v_dev, v_fac, v_res, v_e, 'booking_ended', '{"occupied":false,"seed":true}'::jsonb;
        n_ev := n_ev + 4;
      end if;
    end loop;
  end loop;

  raise notice 'Seeded % bookings and % room events for "%" over the last 7 days.', n_book, n_ev, v_name;
end $$;

-- what was created
select
  (select count(*) from public.reservations where purpose = '[seed] room energy demo') as seeded_bookings,
  (select count(*) from public.room_events  where detail ->> 'seed' = 'true')           as seeded_events;
