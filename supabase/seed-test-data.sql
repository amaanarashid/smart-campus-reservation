-- =========================================================================
--  CAMPUS RESERVE - TEST SEED DATA
-- =========================================================================
--
--  Fills the database with data that exercises every test in
--  docs/TESTING-GUIDE.txt. All dates are relative to TODAY in Malaysia
--  time, so this works whatever day you run it.
--
--  BEFORE RUNNING
--    1. setup-all.sql, upgrade-recommender.sql, fix-role-escalation.sql
--       have been run.
--    2. You have tapped all three demo login buttons at least once
--       (Student, Facility Manager, Admin), so those accounts exist.
--
--  WORKS WITH YOUR OWN FACILITIES. It does not assume any facility names.
--  For each category it needs (badminton, discussion room, futsal,
--  basketball, meeting room, event hall) it USES what you already have, and
--  only CREATES what is missing. Everything it creates is tagged "[seed]".
--  It never renames, re-rules or changes the status of your real
--  facilities, and it fits around your real bookings instead of failing on
--  them.
--
--  SAFE TO RE-RUN. Every run first deletes the previous seed bookings and
--  students, then rebuilds them with fresh dates.
--
--  TO REMOVE EVERYTHING IT CREATED: run seed-test-data-remove.sql.
--
--  THE SUMMARY TABLE at the end names the exact courts and dates to use.
--  Read it - your court names may differ from the ones in the guide.
--
--  It does NOT seed evaluation_events by default. Those are your Phase 2
--  research measurements; fake rows mixed in would contaminate your real
--  results. Set seed_eval := true below only if you need the analytics
--  screen populated, and run the remove script before real testing.
-- =========================================================================


-- ------------------------------------------------ helpers (this session) --

create temp table if not exists seed_ctx (k text primary key, v text);
truncate seed_ctx;

-- Malaysia wall-clock time on a given day, as a timestamptz.
create or replace function pg_temp.my_at(d date, hhmm text)
returns timestamptz language sql immutable as $$
  select (d + hhmm::time) at time zone 'Asia/Kuala_Lumpur'
$$;

-- Insert one tagged booking. If a real booking already holds that time on
-- that facility, skip it quietly (returns null) rather than fail the seed.
create or replace function pg_temp.seed_res(
  p_fac uuid, p_user uuid, p_start timestamptz, p_end timestamptz,
  p_status text default 'approved', p_people int default 2, p_note text default '',
  p_checked timestamptz default null, p_noshow boolean default false
) returns uuid language plpgsql as $$
declare v uuid;
begin
  if p_fac is null or p_user is null then
    raise exception 'seed_res called with a missing facility or user (%): this is a seed bug', p_note;
  end if;
  begin
    insert into public.reservations
      (facility_id, user_id, start_time, end_time, participants, purpose,
       status, checked_in_at, no_show, created_at)
    values
      (p_fac, p_user, p_start, p_end, p_people, '[seed] ' || p_note,
       p_status, p_checked, p_noshow, least(now(), p_start - interval '2 days'))
    returning id into v;
  exception when exclusion_violation then
    v := null;   -- a real booking already has this slot
  end;
  return v;
end $$;

-- Find a category by slug, then by name; create it (tagged) only if absent.
create or replace function pg_temp.ensure_cat(
  p_slug text, p_name text, p_venue text, p_open time, p_close time,
  p_slot int, p_min int, p_max int, p_adv int, p_cancel int, p_auto boolean
) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.facility_categories where slug = p_slug;
  if v is null then
    select id into v from public.facility_categories
     where lower(name) like lower(p_name) || '%' or slug like p_slug || '%'
     order by created_at limit 1;
  end if;
  if v is null then
    insert into public.facility_categories
      (name, slug, venue, description, open_time, close_time, slot_minutes,
       min_duration_mins, max_duration_mins, max_advance_days, cancellation_hours, auto_approve)
    values
      (p_name, p_slug, p_venue, '[seed] created by test seed', p_open, p_close, p_slot,
       p_min, p_max, p_adv, p_cancel, p_auto)
    returning id into v;
  end if;
  return v;
end $$;

-- The n-th ACTIVE facility of a category (0-based, by name). If the category
-- has fewer than n+1, create one (tagged) with the given name.
create or replace function pg_temp.nth_fac(p_cat uuid, p_n int, p_name text, p_cap int)
returns uuid language plpgsql as $$
declare v uuid; nm text := p_name;
begin
  select id into v from public.facilities
   where category_id = p_cat and status = 'active'
   order by name offset p_n limit 1;
  if v is null then
    if exists (select 1 from public.facilities where category_id = p_cat and lower(name) = lower(nm)) then
      nm := nm || ' (seed)';
    end if;
    insert into public.facilities (category_id, name, capacity, description, status)
    values (p_cat, nm, p_cap, '[seed] created by test seed', 'active')
    returning id into v;
  end if;
  return v;
end $$;

-- A seed-owned facility under maintenance (never touches a real one).
create or replace function pg_temp.seed_maint(p_cat uuid, p_name text, p_cap int)
returns uuid language plpgsql as $$
declare v uuid; nm text := p_name;
begin
  select id into v from public.facilities
   where category_id = p_cat and description like '[seed]%' and status = 'maintenance' limit 1;
  if v is null then
    if exists (select 1 from public.facilities where category_id = p_cat and lower(name) = lower(nm)) then
      nm := nm || ' (seed)';
    end if;
    insert into public.facilities (category_id, name, capacity, description, status)
    values (p_cat, nm, p_cap, '[seed] under maintenance - test seed', 'maintenance')
    returning id into v;
  end if;
  return v;
end $$;

-- Create a loginable student account (password demo1234) and its profile.
create or replace function pg_temp.seed_user(p_email text, p_name text)
returns uuid language plpgsql as $$
declare uid uuid := gen_random_uuid(); pw text;
begin
  begin
    pw := extensions.crypt('demo1234', extensions.gen_salt('bf'));
  exception when others then
    pw := crypt('demo1234', gen_salt('bf'));
  end;

  insert into auth.users
    (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated',
     p_email, pw, now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     jsonb_build_object('full_name', p_name), now(), now());

  -- auth.identities changed shape across Supabase versions; try both.
  begin
    insert into auth.identities
      (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      (gen_random_uuid(), uid, uid::text,
       jsonb_build_object('sub', uid::text, 'email', p_email, 'email_verified', true),
       'email', now(), now(), now());
  exception when undefined_column then
    insert into auth.identities
      (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values
      (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', p_email),
       'email', now(), now(), now());
  end;

  insert into public.profiles (id, full_name, email, role)
  values (uid, p_name, p_email, 'student');
  return uid;
end $$;


-- ------------------------------------------------ 1. remove previous seed --

delete from public.reservations    where purpose like '[seed]%';
delete from public.lost_and_found  where notes   like '[seed]%';
delete from public.evaluation_events where note  like '[seed]%';
update public.lost_and_found set logged_by = null          -- no cascade on this FK
 where logged_by in (select id from public.profiles where email like '%@seed.campus');
delete from auth.users where email like '%@seed.campus';   -- cascades to profiles + their bookings
delete from public.notifications n
 where n.type in ('new_request','booking_approved','booking_rejected')
   and n.entity_id is not null
   and not exists (select 1 from public.reservations r where r.id = n.entity_id);


-- ------------------------------------------------ 2. seed users --

select pg_temp.seed_user('aina@seed.campus',  'Aina Rahman');
select pg_temp.seed_user('ben@seed.campus',   'Ben Tan');
select pg_temp.seed_user('chong@seed.campus', 'Chong Wei Liang');
select pg_temp.seed_user('divya@seed.campus', 'Divya Nair');
select pg_temp.seed_user('ethan@seed.campus', 'Ethan Lim');

-- Supabase Auth cannot read NULL in its token columns; make them empty.
do $$
declare c text;
begin
  for c in
    select column_name from information_schema.columns
     where table_schema = 'auth' and table_name = 'users'
       and data_type in ('character varying', 'text')
       and column_name in ('confirmation_token','recovery_token','email_change_token_new',
                           'email_change_token_current','email_change','phone_change',
                           'phone_change_token','reauthentication_token')
  loop
    execute format(
      'update auth.users set %I = coalesce(%I, '''') where email like ''%%@seed.campus''', c, c);
  end loop;
end $$;


-- ------------------------------------------------ 3. everything else --

do $$
declare
  seed_eval boolean := false;   -- see header before setting true

  d0 date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  d1 date := d0 + 1;
  d2 date := d0 + 2;
  d3 date := d0 + 3;
  hr timestamptz := date_trunc('hour', now());

  v_student uuid; v_manager uuid; v_admin uuid;
  s_aina uuid; s_ben uuid; s_chong uuid; s_divya uuid; s_ethan uuid;
  users uuid[];

  c_badm uuid; c_disc uuid; c_fut uuid; c_bask uuid; c_meet uuid; c_hall uuid;
  badm_slug text;
  f_c1 uuid; f_c2 uuid; f_c3 uuid; f_c4 uuid;
  f_dra uuid; f_drb uuid; f_fut uuid; f_bask uuid; f_meet uuid; f_hall uuid;
  e_racket uuid; e_racket_total int; e_racket_name text; e_shuttle uuid;
  override_applied boolean := false;

  r uuid; i int; dd date; u uuid;
  fac record; t timestamptz; t_end timestamptz; day_close timestamptz; n_full int := 0;
begin
  -- ---------- people ----------
  select id into v_student from public.profiles where email = 'student@demo.campus';
  select id into v_manager from public.profiles where email = 'facility_manager@demo.campus';
  select id into v_admin   from public.profiles where email = 'admin@demo.campus';
  select id into s_aina  from public.profiles where email = 'aina@seed.campus';
  select id into s_ben   from public.profiles where email = 'ben@seed.campus';
  select id into s_chong from public.profiles where email = 'chong@seed.campus';
  select id into s_divya from public.profiles where email = 'divya@seed.campus';
  select id into s_ethan from public.profiles where email = 'ethan@seed.campus';
  users := array[s_aina, s_ben, s_chong, s_divya, s_ethan];

  if v_student is null then raise warning 'student@demo.campus not found - tap the Student demo button first. Demo-student bookings skipped.'; end if;
  if v_manager is null then raise warning 'facility_manager@demo.campus not found - tap the Manager demo button first. Manager assignment skipped.'; end if;

  -- ---------- categories: use yours, create only what is missing ----------
  c_badm := pg_temp.ensure_cat('badminton',       'Badminton',       'Sports Hall',    '10:00','22:00',60, 60,120,14,12,false);
  c_disc := pg_temp.ensure_cat('discussion_room', 'Discussion Room', 'Library',        '08:00','22:00',30, 30,120,14,12,true);
  c_fut  := pg_temp.ensure_cat('futsal',          'Futsal',          'Sports Complex', '10:00','22:00',60, 60,120,14,12,false);
  c_bask := pg_temp.ensure_cat('basketball',      'Basketball',      'Sports Complex', '10:00','22:00',60, 60,120,14,12,false);
  c_meet := pg_temp.ensure_cat('meeting_room',    'Meeting Room',    'Block B',        '08:00','20:00',60, 30,180,30,24,false);
  c_hall := pg_temp.ensure_cat('event_hall',      'Event Hall',      'Block A',        '08:00','22:00',60,120,480,60,72,false);
  select slug into badm_slug from public.facility_categories where id = c_badm;

  -- ---------- facilities: first N active ones in each category ----------
  f_c1   := pg_temp.nth_fac(c_badm, 0, 'Court 1', 4);
  f_c2   := pg_temp.nth_fac(c_badm, 1, 'Court 2', 4);
  f_c3   := pg_temp.nth_fac(c_badm, 2, 'Court 3', 4);
  f_c4   := pg_temp.seed_maint(c_badm, 'Court 4', 4);
  f_dra  := pg_temp.nth_fac(c_disc, 0, 'Discussion Room A', 8);
  f_drb  := pg_temp.nth_fac(c_disc, 1, 'Discussion Room B', 6);
  f_fut  := pg_temp.nth_fac(c_fut,  0, 'Futsal Court 1', 14);
  f_bask := pg_temp.nth_fac(c_bask, 0, 'Main Court', 15);
  f_meet := pg_temp.nth_fac(c_meet, 0, 'Meeting Room M1', 12);
  f_hall := pg_temp.nth_fac(c_hall, 0, 'Grand Hall', 300);

  -- per-court override on the THIRD court - only if the seed created it,
  -- so your real facility rules are never changed
  if exists (select 1 from public.facilities where id = f_c3 and description like '[seed]%') then
    insert into public.facility_rules (facility_id, close_time) values (f_c3, '20:00')
    on conflict (facility_id) do update set close_time = '20:00';
    override_applied := true;
  end if;

  -- ---------- equipment: find a racket for this category, else create one ----------
  select id, total_qty, name into e_racket, e_racket_total, e_racket_name
    from public.equipment where facility_type = badm_slug and name ilike '%racket%'
    order by total_qty desc limit 1;
  if e_racket is null then
    insert into public.equipment (facility_type, name, total_qty)
    values (badm_slug, 'Racket (seed)', 8)
    on conflict (facility_type, name) do update set total_qty = 8
    returning id, total_qty, name into e_racket, e_racket_total, e_racket_name;
  end if;
  select id into e_shuttle from public.equipment
   where facility_type = badm_slug and name ilike '%shuttle%' limit 1;

  -- ---------- manager assignment (before bookings, so notifications route to them) ----------
  if v_manager is not null then
    insert into public.facility_managers (facility_id, manager_id)
    select f, v_manager from unnest(array[f_c1, f_c2, f_c3, f_fut]) as f
    on conflict (facility_id, manager_id) do nothing;
  end if;

  -- =====================================================================
  -- HISTORY (past days). Triggers off, so the activity log and
  -- notifications are not flooded with 200 old bookings.
  -- =====================================================================
  execute 'alter table public.reservations disable trigger user';

  -- Badminton: evening-heavy, enough to LEARN peaks.
  for i in 1..40 loop
    dd := d0 - i;
    u := users[1 + i % 5];
    perform pg_temp.seed_res(f_c1, u, pg_temp.my_at(dd,'19:00'), pg_temp.my_at(dd,'21:00'),
      'approved', 4, 'evening doubles',
      case when i % 7 = 0 then null else pg_temp.my_at(dd,'19:00') + interval '4 minutes' end,
      i % 7 = 0);
    if i % 2 = 0 then
      perform pg_temp.seed_res(f_c2, users[1 + (i+1) % 5], pg_temp.my_at(dd,'18:00'), pg_temp.my_at(dd,'20:00'),
        'approved', 4, 'club practice', pg_temp.my_at(dd,'18:00') + interval '2 minutes');
    end if;
    if i % 3 = 0 then
      perform pg_temp.seed_res(f_c3, users[1 + (i+2) % 5], pg_temp.my_at(dd,'16:00'), pg_temp.my_at(dd,'18:00'),
        'approved', 2, 'singles', pg_temp.my_at(dd,'16:00') + interval '6 minutes');
    end if;
    if i % 5 = 0 then
      perform pg_temp.seed_res(f_c1, users[1 + (i+3) % 5], pg_temp.my_at(dd,'13:00'), pg_temp.my_at(dd,'14:00'),
        'approved', 2, 'lunch game', pg_temp.my_at(dd,'13:00') + interval '3 minutes');
    end if;
  end loop;

  -- Discussion rooms: midday-heavy, enough to learn peaks.
  for i in 1..35 loop
    dd := d0 - i;
    perform pg_temp.seed_res(f_dra, users[1 + i % 5], pg_temp.my_at(dd,'13:00'), pg_temp.my_at(dd,'15:00'),
      'approved', 5, 'group assignment', pg_temp.my_at(dd,'13:00') + interval '5 minutes');
    if i % 2 = 0 then
      perform pg_temp.seed_res(f_drb, users[1 + (i+2) % 5], pg_temp.my_at(dd,'14:00'), pg_temp.my_at(dd,'16:00'),
        'approved', 4, 'FYP meeting', null, i % 6 = 0);
    end if;
    if i % 4 = 0 then
      perform pg_temp.seed_res(f_dra, users[1 + (i+4) % 5], pg_temp.my_at(dd,'10:00'), pg_temp.my_at(dd,'11:00'),
        'approved', 3, 'revision', pg_temp.my_at(dd,'10:00') + interval '1 minute');
    end if;
  end loop;

  -- Futsal: deliberately THIN (under 30) so campus default peaks are kept.
  for i in 1..10 loop
    dd := d0 - (i * 3);
    perform pg_temp.seed_res(f_fut, users[1 + i % 5], pg_temp.my_at(dd,'20:00'), pg_temp.my_at(dd,'22:00'),
      'approved', 12, 'friendly match', pg_temp.my_at(dd,'20:00') + interval '5 minutes');
  end loop;

  -- A few past cancelled / rejected rows: must be ignored everywhere.
  for i in 1..6 loop
    dd := d0 - (i * 2);
    perform pg_temp.seed_res(f_c2, users[1 + i % 5], pg_temp.my_at(dd,'13:00'), pg_temp.my_at(dd,'14:00'),
      case when i % 2 = 0 then 'cancelled' else 'rejected' end, 2, 'withdrawn');
  end loop;

  -- Demo student's own past bookings, one of them a no-show.
  if v_student is not null then
    perform pg_temp.seed_res(f_dra, v_student, pg_temp.my_at(d0-3,'16:00'), pg_temp.my_at(d0-3,'17:00'),
      'approved', 3, 'past - attended', pg_temp.my_at(d0-3,'16:00') + interval '3 minutes');
    perform pg_temp.seed_res(f_c2, v_student, pg_temp.my_at(d0-6,'11:00'), pg_temp.my_at(d0-6,'12:00'),
      'approved', 2, 'past - no-show', null, true);
    perform pg_temp.seed_res(f_drb, v_student, pg_temp.my_at(d0-9,'16:00'), pg_temp.my_at(d0-9,'17:00'),
      'approved', 4, 'past - attended', pg_temp.my_at(d0-9,'16:00') + interval '8 minutes');
  end if;

  execute 'alter table public.reservations enable trigger user';

  -- =====================================================================
  -- NOW AND UPCOMING. Triggers on: these create activity log entries and
  -- manager notifications, as real bookings would.
  -- =====================================================================

  -- TODAY: in progress on the second court -> manager marks attendance (8.4)
  perform pg_temp.seed_res(f_c2, s_aina, hr, hr + interval '1 hour', 'approved', 2, 'in progress now');

  -- TOMORROW, first court 15:00-16:00 is TAKEN -> tests 6.1, 6.2, 7.5
  r := pg_temp.seed_res(f_c1, s_aina, pg_temp.my_at(d1,'15:00'), pg_temp.my_at(d1,'16:00'),
    'approved', 4, 'the 3pm clash');
  -- ...holding all rackets but one -> equipment shortfall test
  if r is not null and e_racket_total >= 2 then
    insert into public.reservation_equipment (reservation_id, equipment_id, qty)
    values (r, e_racket, e_racket_total - 1);
  end if;
  if r is not null and e_shuttle is not null then
    insert into public.reservation_equipment (reservation_id, equipment_id, qty) values (r, e_shuttle, 1);
  end if;

  perform pg_temp.seed_res(f_c1, s_ben,   pg_temp.my_at(d1,'10:00'), pg_temp.my_at(d1,'11:00'), 'approved', 4, 'morning session');
  perform pg_temp.seed_res(f_c2, s_chong, pg_temp.my_at(d1,'10:00'), pg_temp.my_at(d1,'11:00'), 'approved', 2, 'morning singles');
  -- pending -> manager approval queue (8.1-8.3)
  perform pg_temp.seed_res(f_c2, s_ben,   pg_temp.my_at(d1,'17:00'), pg_temp.my_at(d1,'18:00'), 'pending', 4, 'awaiting approval');
  perform pg_temp.seed_res(f_c3, s_chong, pg_temp.my_at(d1,'18:00'), pg_temp.my_at(d1,'19:00'), 'pending', 2, 'awaiting approval');
  perform pg_temp.seed_res(f_fut, s_divya, pg_temp.my_at(d1,'20:00'), pg_temp.my_at(d1,'21:00'), 'pending', 12, 'awaiting approval');
  perform pg_temp.seed_res(f_dra, s_ethan, pg_temp.my_at(d1,'13:00'), pg_temp.my_at(d1,'14:00'), 'approved', 6, 'study group');
  perform pg_temp.seed_res(f_drb, s_aina,  pg_temp.my_at(d1,'13:00'), pg_temp.my_at(d1,'14:00'), 'approved', 4, 'study group');

  -- DAY AFTER TOMORROW
  perform pg_temp.seed_res(f_meet, s_ethan, pg_temp.my_at(d2,'10:00'), pg_temp.my_at(d2,'11:00'), 'pending', 8, 'club committee');
  perform pg_temp.seed_res(f_bask, s_ben,   pg_temp.my_at(d2,'18:00'), pg_temp.my_at(d2,'19:00'), 'pending', 10, 'awaiting approval');

  -- IN 3 DAYS: EVERY active court in the badminton category full from its
  -- own opening to its own closing time -> look-ahead test (6.5).
  -- Covers your real courts too, whatever their hours; any real booking
  -- already there simply stays and fills its part of the day.
  for fac in
    select f.id, r2.open_time, r2.close_time, r2.max_duration_mins
      from public.facilities f
      join public.effective_facility_rules r2 on r2.facility_id = f.id
     where f.category_id = c_badm and f.status = 'active'
  loop
    t := pg_temp.my_at(d3, fac.open_time::text);
    day_close := pg_temp.my_at(d3, fac.close_time::text);
    i := 0;
    while t < day_close loop
      t_end := least(t + make_interval(mins => greatest(fac.max_duration_mins, 30)), day_close);
      perform pg_temp.seed_res(fac.id, users[1 + i % 5], t, t_end, 'approved', 4, 'tournament');
      t := t_end;
      i := i + 1;
    end loop;
    n_full := n_full + 1;
  end loop;

  -- ---------- the demo student's own bookings ----------
  if v_student is not null then
    -- in progress now -> the student can check in
    perform pg_temp.seed_res(f_dra, v_student, hr, hr + interval '1 hour', 'approved', 3, 'in progress - check in');
    -- next booking -> chatbot "when is my next booking?"
    perform pg_temp.seed_res(f_drb, v_student, pg_temp.my_at(d1,'16:00'), pg_temp.my_at(d1,'17:00'), 'approved', 4, 'my next booking');
    perform pg_temp.seed_res(f_fut, v_student, pg_temp.my_at(d2,'18:00'), pg_temp.my_at(d2,'19:00'), 'pending', 10, 'my pending request');
    -- starts in 3 hours on the second court -> cancel REFUSED if notice > 3h
    perform pg_temp.seed_res(f_c2, v_student, hr + interval '3 hours', hr + interval '4 hours', 'approved', 2, 'too late to cancel');
    -- 10 days ahead -> cancel ALLOWED
    perform pg_temp.seed_res(f_meet, v_student, pg_temp.my_at(d0+10,'14:00'), pg_temp.my_at(d0+10,'15:00'), 'pending', 6, 'can cancel');

    -- fresh AI state, so the learning test starts from the prior
    update public.profiles set rec_weights = '{"time":0.5,"capacity":0.3,"offpeak":0.2}'::jsonb where id = v_student;
    if exists (select 1 from information_schema.columns
               where table_schema='public' and table_name='profiles' and column_name='rec_bandit') then
      execute 'update public.profiles set rec_bandit = null where id = $1' using v_student;
    end if;
  end if;

  -- ---------- lost and found ----------
  insert into public.lost_and_found
    (facility_id, item_name, category, description, found_location, found_date, reporter_name, status, claimant_name, notes, logged_by)
  values
    (f_c1,   'Yonex racket',     'sports',  'Blue, grip tape worn', 'Court bench',  d0 - 1, 'Cleaner',  'unclaimed', null,          '[seed]', v_admin),
    (f_dra,  'Student ID card',  'id_card', 'APU card',             'On the table', d0 - 4, 'Ethan Lim','claimed',   'Divya Nair',  '[seed]', v_admin),
    (f_hall, 'Black umbrella',   'other',   'Folding',              'Entrance',     d0 - 9, 'Security', 'returned',  'Ben Tan',     '[seed]', v_admin);

  -- ---------- evaluation events (OFF by default) ----------
  if seed_eval then
    for i in 1..25 loop
      insert into public.evaluation_events (at, user_id, kind, num_value, note)
      values (now() - (i || ' days')::interval, users[1 + i % 5], 'rec_shown', 4, '[seed]');
    end loop;
    insert into public.evaluation_events (at, user_id, kind, num_value, note)
    select now() - (k || ' days')::interval, users[1 + (k % 5)::int], 'rec_accepted', rk, '[seed]'
    from unnest(array[0,0,1,0,2,0,1,0,0,3]) with ordinality as t(rk, k);
    for i in 1..15 loop
      insert into public.evaluation_events (at, user_id, kind, bool_value, note)
      values (now() - (i || ' days')::interval, users[1 + i % 5], 'chat_feedback', i % 5 <> 0, '[seed]');
    end loop;
  end if;

  -- ---------- remember what was used, for the summary ----------
  insert into seed_ctx values
    ('d1',      to_char(d1, 'Dy DD Mon')),
    ('d3',      to_char(d3, 'Dy DD Mon')),
    ('badm',    (select name from public.facility_categories where id = c_badm)),
    ('c1',      (select name from public.facilities where id = f_c1)),
    ('c2',      (select name from public.facilities where id = f_c2)),
    ('c3',      (select name from public.facilities where id = f_c3)),
    ('c4',      (select name from public.facilities where id = f_c4)),
    ('dra',     (select name from public.facilities where id = f_dra)),
    ('drb',     (select name from public.facilities where id = f_drb)),
    ('fut',     (select name from public.facilities where id = f_fut)),
    ('override', override_applied::text),
    ('racket',  e_racket_name || ' (' || e_racket_total || ' in stock)'),
    ('n_full',  n_full::text),
    ('made_cats', (select coalesce(string_agg(name, ', ' order by name), 'none')
                     from public.facility_categories where description like '[seed]%')),
    ('made_facs', (select coalesce(string_agg(f.name || ' (' || c.name || ')', ', ' order by c.name, f.name), 'none')
                     from public.facilities f join public.facility_categories c on c.id = f.category_id
                    where f.description like '[seed]%'));
end $$;


-- ------------------------------------------------ 4. summary --
-- This result table is what the SQL editor shows when the script finishes.
-- Use the names and dates here; they are YOUR facilities.

select item, detail from (
  select 1 as n, 'Seed bookings created' as item,
         (select count(*) from public.reservations where purpose like '[seed]%')::text as detail
  union all select 2, 'Seed students (password demo1234)',
         (select string_agg(email, ', ' order by email) from public.profiles where email like '%@seed.campus')
  union all select 3, 'Your facilities used',
         (select v from seed_ctx where k='badm') || ': ' || (select v from seed_ctx where k='c1') || ', '
         || (select v from seed_ctx where k='c2') || ', ' || (select v from seed_ctx where k='c3')
         || ' | Discussion: ' || (select v from seed_ctx where k='dra') || ', ' || (select v from seed_ctx where k='drb')
  union all select 4, 'Categories the seed had to CREATE', (select v from seed_ctx where k='made_cats')
  union all select 5, 'Facilities the seed had to CREATE', (select v from seed_ctx where k='made_facs')
  union all select 6, 'TEST 6.1/6.2/7.5 - TAKEN',
         (select v from seed_ctx where k='c1') || ' on ' || (select v from seed_ctx where k='d1')
         || ', 3:00-4:00 pm. ' || (select v from seed_ctx where k='c2') || ' and '
         || (select v from seed_ctx where k='c3') || ' are free then.'
  union all select 7, 'TEST 6.5 - category FULL all day',
         (select v from seed_ctx where k='d3') || ': all ' || (select v from seed_ctx where k='n_full')
         || ' active ' || (select v from seed_ctx where k='badm') || ' courts full -> look-ahead.'
  union all select 8, 'TEST 6.5c - equipment',
         (select v from seed_ctx where k='racket') || ': all but 1 taken on '
         || (select v from seed_ctx where k='d1') || ' 3 pm. Ask for 2 on '
         || (select v from seed_ctx where k='c2') || ' -> shortfall.'
  union all select 9, 'TEST 6.5b - per-court override',
         case when (select v from seed_ctx where k='override') = 'true'
              then (select v from seed_ctx where k='c3') || ' closes 20:00 (seed override). '
              else 'SKIPPED - your 3rd court is real, so its rules were left alone. ' end
         || (select v from seed_ctx where k='c4') || ' is under maintenance (hidden).'
  union all select 10, 'TEST 8.1 - pending requests',
         (select count(*) from public.reservations where purpose like '[seed]%' and status = 'pending')::text
         || ' waiting'
  union all select 11, 'Peak hours',
         (select v from seed_ctx where k='badm') || ' + discussion: rich history -> LEARNED. '
         || 'Futsal: thin -> DEFAULTS.'
  union all select 12, 'Demo student',
         'in progress now on ' || (select v from seed_ctx where k='dra')
         || ', next ' || (select v from seed_ctx where k='d1') || ' 4 pm on ' || (select v from seed_ctx where k='drb')
         || ', one starting in ~3 h, one 10 days out'
) s order by n;
