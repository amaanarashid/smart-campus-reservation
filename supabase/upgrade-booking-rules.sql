-- =========================================================================
--  Booking rules enforced by the database (re-runnable)
--  Run after upgrade-private-bookings.sql.
--
--  Objective 2: the rules hold whatever the application does. Until now the
--  student page checked opening hours, booking length, advance window,
--  capacity and cancellation notice, but a client talking to the API
--  directly could skip them, set its own booking to "approved", or edit any
--  column of its own reservation (even move it to another user).
--
--  A BEFORE INSERT/UPDATE trigger now checks every direct request from a
--  signed-in user (database role "authenticated"):
--
--   INSERT  facility must be active; start in the future; length between the
--           room's min and max; no further ahead than max_advance_days;
--           party size <= capacity; start and end inside opening hours on
--           the same day (Malaysia time). Status is decided here from
--           auto_approve, never by the client; attendance fields start empty.
--   UPDATE  by the booker: only two actions -
--             cancel   (pending/approved -> cancelled, before the start, with
--                       the room's cancellation notice; reason set to 'user')
--             check in (approved, not yet checked in, from 15 min before the
--                       start to the end; the time is set by the server)
--           Any other change is refused. Admins and the room's managers keep
--           full control (approve, reject, attendance).
--
--  Trusted code is not affected: SECURITY DEFINER functions (extend_booking,
--  release_no_shows, ...), the service-role API routes (door unlock, device
--  events) and the SQL editor run as other roles, so current_user is not
--  "authenticated" there. Admins may still insert outside the rules
--  (documented override). Messages match the student page's own wording.
-- =========================================================================

create or replace function public.enforce_booking_rules() returns trigger
language plpgsql
set search_path = public
as $$
declare
  tz  constant text := 'Asia/Kuala_Lumpur';
  f   public.facilities%rowtype;
  r   record;
  mins numeric;
  ls  timestamp;
  le  timestamp;
  keep constant text[] := array['status', 'cancel_reason', 'checked_in_at'];
begin
  -- only direct client requests; trusted code runs as another role
  if current_user <> 'authenticated' then
    return new;
  end if;

  -- ---------------------------------------------------------------- insert
  if tg_op = 'INSERT' then
    if public.is_admin() then
      return new;
    end if;

    select * into f from public.facilities where id = new.facility_id;
    if not found or f.status <> 'active' then
      raise exception 'This facility is not open for booking right now.' using errcode = '23514';
    end if;
    select * into r from public.effective_facility_rules where facility_id = new.facility_id;
    if not found then
      raise exception 'No booking rules configured for this facility.' using errcode = '23514';
    end if;

    if new.start_time <= now() then
      raise exception 'That time is in the past.' using errcode = '23514';
    end if;
    mins := extract(epoch from (new.end_time - new.start_time)) / 60;
    if mins < r.min_duration_mins then
      raise exception 'Minimum booking for % is % minutes.', f.name, r.min_duration_mins using errcode = '23514';
    end if;
    if mins > r.max_duration_mins then
      raise exception 'Maximum booking for % is % minutes.', f.name, r.max_duration_mins using errcode = '23514';
    end if;
    if new.start_time > now() + make_interval(days => r.max_advance_days) then
      raise exception 'Bookings open % days in advance.', r.max_advance_days using errcode = '23514';
    end if;
    if new.participants > f.capacity then
      raise exception '% holds %; reduce the group size.', f.name, f.capacity using errcode = '23514';
    end if;
    ls := new.start_time at time zone tz;
    le := new.end_time at time zone tz;
    if ls::date <> le::date or ls::time < r.open_time or le::time > r.close_time then
      raise exception '% operates %-%.', f.name, to_char(r.open_time, 'HH24:MI'), to_char(r.close_time, 'HH24:MI')
        using errcode = '23514';
    end if;

    -- decided by the server, not the client
    new.status := case when r.auto_approve then 'approved' else 'pending' end;
    new.created_at := now();
    new := jsonb_populate_record(new, jsonb_build_object(
      'checked_in_at', null, 'no_show', false, 'cancel_reason', null,
      'released_at', null, 'extended_mins', 0));
    return new;
  end if;

  -- ---------------------------------------------------------------- update
  if public.is_admin() or exists (
       select 1 from public.facility_managers fm
        where fm.facility_id = old.facility_id and fm.manager_id = auth.uid()) then
    return new;
  end if;

  if old.user_id is distinct from auth.uid() then
    raise exception 'That is not your booking.' using errcode = '42501';
  end if;
  if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
    raise exception 'A booking can only be cancelled or checked into. To change it, cancel and book again.'
      using errcode = '42501';
  end if;

  -- cancel
  if new.status is distinct from old.status then
    if not (old.status in ('pending', 'approved') and new.status = 'cancelled') then
      raise exception 'You can only cancel your own booking.' using errcode = '42501';
    end if;
    if old.checked_in_at is not null or old.start_time <= now() then
      raise exception 'This booking has already started.' using errcode = '23514';
    end if;
    select * into r from public.effective_facility_rules where facility_id = old.facility_id;
    if found and old.start_time - now() < make_interval(hours => r.cancellation_hours) then
      raise exception 'This facility needs %h cancellation notice.', r.cancellation_hours using errcode = '23514';
    end if;
    new := jsonb_populate_record(new, jsonb_build_object('cancel_reason', 'user'));
  elsif (to_jsonb(new) ->> 'cancel_reason') is distinct from (to_jsonb(old) ->> 'cancel_reason') then
    raise exception 'A booking can only be cancelled or checked into. To change it, cancel and book again.'
      using errcode = '42501';
  end if;

  -- check in
  if new.checked_in_at is distinct from old.checked_in_at then
    if old.checked_in_at is not null or new.checked_in_at is null then
      raise exception 'This booking is already checked in.' using errcode = '23514';
    end if;
    if old.status <> 'approved' or old.no_show then
      raise exception 'Only an approved booking can be checked in.' using errcode = '23514';
    end if;
    if now() < old.start_time - interval '15 minutes' or now() > old.end_time then
      raise exception 'Check-in opens 15 minutes before the start and closes at the end.' using errcode = '23514';
    end if;
    new.checked_in_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_booking_rules() from public, anon, authenticated;

drop trigger if exists trg_booking_rules on public.reservations;
create trigger trg_booking_rules
  before insert or update on public.reservations
  for each row execute function public.enforce_booking_rules();
