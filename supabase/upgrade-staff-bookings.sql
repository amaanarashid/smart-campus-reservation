-- =========================================================================
--  Staff bookings + reasons students can read (re-runnable)
--  Run after upgrade-access-limits.sql (needs is_admin(), member types and
--  the booking-rules trigger).
--
--  Adds, for facility managers (and admins):
--    1. Walk-in bookings: the manager books a room FOR a student who is at
--       the desk. The booking belongs to the student (user_id), is approved
--       straight away, and is checked in if it starts within 15 minutes.
--    2. Blocks: the manager takes a room out of use for a period
--       (maintenance, an event). Stored as an approved booking under the
--       manager so the slot shows as taken everywhere; never auto-released.
--    3. A written reason when staff cancel or reject a booking. The student
--       sees it in the notification and on the booking.
--
--  reservations
--    .created_by     who made the booking when it was not the booker
--    .booking_kind   null = normal | 'walk_in' | 'block'
--    .staff_note     reason typed by staff (cancel / reject), or block reason
--    .cancel_reason  gains the value 'staff'
--
--  Evaluation note: exclude booking_kind = 'block' from demand, utilisation
--  and attendance figures (a block is not a student booking), and treat
--  'walk_in' as real demand that did not come through the recommender.
-- =========================================================================

-- ------------------------------------------------------------ columns ----
alter table public.reservations
  -- no foreign key on purpose: a second reservations -> profiles relationship
  -- would make the app's `profiles(full_name)` joins ambiguous (PGRST201)
  add column if not exists created_by   uuid,
  add column if not exists booking_kind text,
  add column if not exists staff_note   text;

do $$ begin
  alter table public.reservations add constraint reservations_booking_kind_check
    check (booking_kind is null or booking_kind in ('walk_in', 'block'));
exception when duplicate_object then null; end $$;

-- cancel_reason was limited to user | no_checkin | early_leave | admin by an
-- unnamed check. Replace whichever check mentions the column, adding 'staff'.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.reservations'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%cancel_reason%'
  loop
    execute format('alter table public.reservations drop constraint %I', c.conname);
  end loop;
  alter table public.reservations add constraint reservations_cancel_reason_check
    check (cancel_reason is null or cancel_reason in ('user', 'no_checkin', 'early_leave', 'admin', 'staff'));
end $$;

-- ------------------------------------------- create a walk-in or a block --
-- SECURITY DEFINER: a manager may not insert a booking for someone else
-- through the table (RLS: user_id = auth.uid()), so this function does it
-- after checking that the caller manages the room. Because it runs as the
-- owner, the booking-rules trigger steps aside, so the room's rules are
-- checked here instead. Fair-use limits (max upcoming / hours per week) are
-- NOT applied to walk-ins: the manager at the desk decides.
create or replace function public.staff_create_booking(
  p_facility     uuid,
  p_start        timestamptz,
  p_end          timestamptz,
  p_kind         text,
  p_user         uuid default null,
  p_participants int  default 1,
  p_note         text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  tz constant text := 'Asia/Kuala_Lumpur';
  me     uuid := auth.uid();
  f      public.facilities%rowtype;
  r      record;
  who    text;
  target uuid;
  dur    numeric;
  ls     timestamp;
  le     timestamp;
  labels text;
  clash  int;
  note   text := nullif(btrim(coalesce(p_note, '')), '');
  new_id uuid;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if not (public.is_admin() or exists (
       select 1 from public.facility_managers fm
        where fm.facility_id = p_facility and fm.manager_id = me)) then
    raise exception 'You do not manage this room.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('walk_in', 'block') then
    raise exception 'Unknown booking kind.' using errcode = '22023';
  end if;
  select * into f from public.facilities where id = p_facility;
  if not found then
    raise exception 'That room no longer exists.' using errcode = '23514';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'The end time must be after the start time.' using errcode = '23514';
  end if;
  if p_end <= now() then
    raise exception 'That time is already over.' using errcode = '23514';
  end if;

  -- same queue as normal bookings for this room (see enforce_booking_rules)
  perform pg_advisory_xact_lock(hashtextextended('facility:' || p_facility::text, 0));

  if p_kind = 'walk_in' then
    if p_user is null then
      raise exception 'Choose who the booking is for.' using errcode = '23514';
    end if;
    select member_type into who from public.profiles where id = p_user;
    if not found then
      raise exception 'No account found for that person.' using errcode = '23514';
    end if;
    if f.status <> 'active' then
      raise exception 'This facility is not open for booking right now.' using errcode = '23514';
    end if;
    select * into r from public.effective_facility_rules where facility_id = p_facility;
    if not found then
      raise exception 'No booking rules configured for this facility.' using errcode = '23514';
    end if;

    -- a walk-in may start in the slot that is already running, not earlier
    if p_start < now() - make_interval(mins => greatest(r.slot_minutes, 15)) then
      raise exception 'That time is in the past.' using errcode = '23514';
    end if;
    dur := extract(epoch from (p_end - p_start)) / 60;
    if dur < r.min_duration_mins then
      raise exception 'Minimum booking for % is % minutes.', f.name, r.min_duration_mins using errcode = '23514';
    end if;
    if dur > r.max_duration_mins then
      raise exception 'Maximum booking for % is % minutes.', f.name, r.max_duration_mins using errcode = '23514';
    end if;
    if p_start > now() + make_interval(days => r.max_advance_days) then
      raise exception 'Bookings open % days in advance.', r.max_advance_days using errcode = '23514';
    end if;
    if coalesce(p_participants, 1) < 1 then
      raise exception 'At least one person.' using errcode = '23514';
    end if;
    if coalesce(p_participants, 1) > f.capacity then
      raise exception '% holds %; reduce the group size.', f.name, f.capacity using errcode = '23514';
    end if;
    ls := p_start at time zone tz;
    le := p_end at time zone tz;
    if ls::date <> le::date or ls::time < r.open_time or le::time > r.close_time then
      raise exception '% operates %-%.', f.name, to_char(r.open_time, 'HH24:MI'), to_char(r.close_time, 'HH24:MI')
        using errcode = '23514';
    end if;
    -- who may book this facility type (same wording as check_access_and_limits)
    who := coalesce(who, 'undergraduate');
    if not (who = any(r.allowed_members)) then
      select string_agg(case m when 'undergraduate' then 'undergraduates' when 'postgraduate' then 'postgraduates' else 'staff' end,
                        ' and ' order by array_position(array['undergraduate','postgraduate','staff'], m))
        into labels from unnest(r.allowed_members) m;
      raise exception '% can only be booked by %.', r.category_name, labels using errcode = '23514';
    end if;
    target := p_user;
  else
    if note is null then
      raise exception 'Say why the room is blocked.' using errcode = '23514';
    end if;
    target := me;
  end if;

  select count(*) into clash from public.reservations x
   where x.facility_id = p_facility and x.status in ('pending', 'approved')
     and x.start_time < p_end and x.end_time > p_start;
  if clash > 0 then
    raise exception 'That time overlaps % existing booking%. Pick another time, or cancel % first.',
      clash, case when clash = 1 then '' else 's' end, case when clash = 1 then 'it' else 'them' end
      using errcode = '23P01';
  end if;

  insert into public.reservations
    (facility_id, user_id, start_time, end_time, participants, purpose, status,
     checked_in_at, created_by, booking_kind, staff_note)
  values
    (p_facility, target, p_start, p_end,
     case when p_kind = 'block' then 1 else coalesce(p_participants, 1) end,
     case when p_kind = 'block' then note else coalesce(note, 'Walk-in booking') end,
     'approved',
     -- a block needs no check-in (and must never be auto-released); a walk-in
     -- starting now is standing at the desk
     case when p_kind = 'block' then now()
          when p_start <= now() + interval '15 minutes' then now()
          else null end,
     me, p_kind,
     case when p_kind = 'block' then note else null end)
  returning id into new_id;

  if p_kind = 'walk_in' and target is distinct from me then
    insert into public.notifications (user_id, title, body, type, entity_id)
    values (target, 'Booking made for you',
      f.name || ' on ' || to_char(p_start at time zone tz, 'DD Mon, HH12:MI am')
        || ' was booked for you at the facility desk. It is in My bookings.',
      'booking_made', new_id);
  end if;

  return new_id;
end;
$$;
revoke all on function public.staff_create_booking(uuid, timestamptz, timestamptz, text, uuid, int, text) from public, anon;
grant execute on function public.staff_create_booking(uuid, timestamptz, timestamptz, text, uuid, int, text) to authenticated;

-- ------------------------------ tell the student, with the reason given --
-- Same trigger as upgrade-auto-release.sql (Malaysia time), plus:
--   rejected            -> the reason, when staff typed one
--   cancelled by staff  -> a notification with the reason
-- A booking's own owner cancelling it (including a manager removing their
-- own block) is not notified.
create or replace function public.notify_booking_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fname  text;
  whenat text;
  why    text := nullif(btrim(coalesce(NEW.staff_note, '')), '');
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  select name into fname from public.facilities where id = NEW.facility_id;
  whenat := to_char(NEW.start_time at time zone 'Asia/Kuala_Lumpur', 'DD Mon, HH12:MI am');

  if NEW.status in ('approved', 'rejected') then
    insert into public.notifications (user_id, title, body, type, entity_id)
    values (
      NEW.user_id,
      case NEW.status when 'approved' then 'Booking approved' else 'Booking not approved' end,
      'Your booking for ' || coalesce(fname, 'a facility') || ' on ' || whenat || ' was ' || NEW.status || '.'
        || case when NEW.status = 'rejected' and why is not null then ' Reason: ' || why else '' end,
      'booking_' || NEW.status,
      NEW.id
    );
  elsif NEW.status = 'cancelled' and NEW.cancel_reason = 'staff'
        and NEW.user_id is distinct from auth.uid() then
    insert into public.notifications (user_id, title, body, type, entity_id)
    values (
      NEW.user_id,
      'Booking cancelled',
      'Your booking for ' || coalesce(fname, 'a facility') || ' on ' || whenat
        || ' was cancelled by the facility team.'
        || case when why is not null then ' Reason: ' || why else '' end,
      'booking_cancelled',
      NEW.id
    );
  end if;
  return NEW;
end $$;

-- Check:  select booking_kind, count(*) from public.reservations group by 1;
