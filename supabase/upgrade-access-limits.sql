-- =========================================================================
--  Who can book + fair-use limits (re-runnable)
--  Run after upgrade-booking-rules.sql.
--
--  Completes proposal feature 2 ("access permissions, facility-specific
--  regulations"):
--
--   profiles.member_type          undergraduate | postgraduate | staff.
--                                 New sign-ups are undergraduates; only an
--                                 admin can change it (Users tab).
--   facility_categories
--     .allowed_members            which member types may book this facility
--                                 type (default: everyone), e.g. meeting
--                                 rooms = staff only.
--     .max_upcoming               at most N upcoming bookings of this type
--                                 per person (NULL = no limit).
--     .max_hours_week             at most N booked hours of this type per
--                                 person in one Malaysian week, Mon-Sun
--                                 (NULL = no limit).
--
--  Enforced in enforce_booking_rules() (same trigger as the other booking
--  rules), so no client can bypass them. A per-user advisory lock makes the
--  limits hold even when one person fires several bookings at once.
--  effective_facility_rules gains the three columns so the app can show them.
-- =========================================================================

-- ------------------------------------------------------------ columns ----
alter table public.profiles
  add column if not exists member_type text not null default 'undergraduate';
do $$ begin
  alter table public.profiles add constraint profiles_member_type_check
    check (member_type in ('undergraduate', 'postgraduate', 'staff'));
exception when duplicate_object then null; end $$;

alter table public.facility_categories
  add column if not exists allowed_members text[] not null default array['undergraduate', 'postgraduate', 'staff'],
  add column if not exists max_upcoming int,
  add column if not exists max_hours_week numeric(5, 1);
do $$ begin
  alter table public.facility_categories add constraint facility_categories_access_check check (
    allowed_members <@ array['undergraduate', 'postgraduate', 'staff']
    and cardinality(allowed_members) >= 1
    and (max_upcoming is null or max_upcoming >= 1)
    and (max_hours_week is null or max_hours_week > 0));
exception when duplicate_object then null; end $$;

-- managers and admins are campus staff; start them as staff (only rows still
-- on the default, so re-running never overwrites an admin's choice)
update public.profiles set member_type = 'staff'
 where role in ('admin', 'facility_manager') and member_type = 'undergraduate';

-- -------------------------------------------- member type: admin only ----
create or replace function public.guard_profile_member_type() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user <> 'authenticated' or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.member_type := 'undergraduate';          -- self sign-up
  elsif new.member_type is distinct from old.member_type then
    raise exception 'Only an administrator can change a member type.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_profile_member_type() from public, anon, authenticated;
drop trigger if exists trg_guard_profile_member_type on public.profiles;
create trigger trg_guard_profile_member_type
  before insert or update on public.profiles
  for each row execute function public.guard_profile_member_type();

-- ------------------------------------------------ rules view (+3 cols) ----
create or replace view public.effective_facility_rules
with (security_invoker = true) as
select
  f.id                                                as facility_id,
  c.id                                                as category_id,
  c.name                                              as category_name,
  c.slug                                              as type,
  c.venue                                             as venue,
  coalesce(r.open_time,          c.open_time)          as open_time,
  coalesce(r.close_time,         c.close_time)         as close_time,
  coalesce(r.slot_minutes,       c.slot_minutes)       as slot_minutes,
  coalesce(r.min_duration_mins,  c.min_duration_mins)  as min_duration_mins,
  coalesce(r.max_duration_mins,  c.max_duration_mins)  as max_duration_mins,
  coalesce(r.max_advance_days,   c.max_advance_days)   as max_advance_days,
  coalesce(r.cancellation_hours, c.cancellation_hours) as cancellation_hours,
  coalesce(r.auto_approve,       c.auto_approve)       as auto_approve,
  (r.id is not null)                                   as has_override,
  coalesce(r.checkin_grace_mins, c.checkin_grace_mins) as checkin_grace_mins,
  c.allowed_members                                    as allowed_members,
  c.max_upcoming                                       as max_upcoming,
  c.max_hours_week                                     as max_hours_week
from public.facilities f
join public.facility_categories c on c.id = f.category_id
left join public.facility_rules r on r.facility_id = f.id;

-- ------------------------------------------- the checks (new function) ----
-- Called from enforce_booking_rules() for a student's INSERT. SECURITY
-- DEFINER so it can count the person's own bookings regardless of RLS and
-- read their member type. The trigger runs as the signed-in user, so they
-- need EXECUTE; calling it directly for someone else is refused, so it can
-- never reveal another person's bookings.
create or replace function public.check_access_and_limits(
  p_user uuid, p_facility uuid, p_start timestamptz, p_end timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  tz constant text := 'Asia/Kuala_Lumpur';
  c public.facility_categories%rowtype;
  who text;
  n int;
  booked numeric;
  week_start timestamptz;
  labels text;
begin
  if auth.uid() is not null and p_user is distinct from auth.uid() and not public.is_admin() then
    raise exception 'That is not your booking.' using errcode = '42501';
  end if;
  select cat.* into c from public.facilities f join public.facility_categories cat on cat.id = f.category_id
   where f.id = p_facility;
  if not found then return; end if;
  select member_type into who from public.profiles where id = p_user;
  who := coalesce(who, 'undergraduate');

  if not (who = any(c.allowed_members)) then
    select string_agg(case m when 'undergraduate' then 'undergraduates' when 'postgraduate' then 'postgraduates' else 'staff' end,
                      ' and ' order by array_position(array['undergraduate','postgraduate','staff'], m))
      into labels from unnest(c.allowed_members) m;
    raise exception '% can only be booked by %.', c.name, labels using errcode = '23514';
  end if;

  if c.max_upcoming is null and c.max_hours_week is null then return; end if;

  -- one person's bookings are checked one at a time, so two quick requests
  -- cannot both squeeze under the limit
  perform pg_advisory_xact_lock(hashtextextended('booking-limit:' || p_user::text, 0));

  if c.max_upcoming is not null then
    select count(*) into n from public.reservations r join public.facilities f on f.id = r.facility_id
     where r.user_id = p_user and f.category_id = c.id
       and r.status in ('pending', 'approved') and r.end_time > now();
    if n >= c.max_upcoming then
      raise exception 'You already have % upcoming % booking%. The limit is %.',
        n, c.name, case when n = 1 then '' else 's' end, c.max_upcoming using errcode = '23514';
    end if;
  end if;

  if c.max_hours_week is not null then
    week_start := date_trunc('week', p_start at time zone tz) at time zone tz;   -- Monday 00:00 MYT
    select coalesce(sum(extract(epoch from (r.end_time - r.start_time)) / 3600), 0) into booked
      from public.reservations r join public.facilities f on f.id = r.facility_id
     where r.user_id = p_user and f.category_id = c.id
       and r.status in ('pending', 'approved')
       and r.start_time >= week_start and r.start_time < week_start + interval '7 days';
    if booked + extract(epoch from (p_end - p_start)) / 3600 > c.max_hours_week then
      raise exception 'Weekly limit for % is % h. You already have % h booked that week.',
        c.name, trim(to_char(c.max_hours_week, 'FM990.0')), trim(to_char(booked, 'FM990.0')) using errcode = '23514';
    end if;
  end if;
end;
$$;
revoke all on function public.check_access_and_limits(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.check_access_and_limits(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- ---------------------------- hook it into the booking-rules trigger ----
-- Same function as upgrade-booking-rules.sql with one added call on INSERT.
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
  -- Requests for the same room queue here, one at a time. Without this, many
  -- simultaneous inserts can deadlock inside the no-overlap index check and
  -- fail with "deadlock detected" instead of a clean "slot taken"
  -- (found by scripts/eval/concurrency.mjs). Released at commit.
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended('facility:' || new.facility_id::text, 0));
  end if;

  if current_user <> 'authenticated' then
    return new;
  end if;

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

    -- who may book this type, and the person's fair-use limits
    perform public.check_access_and_limits(new.user_id, new.facility_id, new.start_time, new.end_time);

    new.status := case when r.auto_approve then 'approved' else 'pending' end;
    new.created_at := now();
    new := jsonb_populate_record(new, jsonb_build_object(
      'checked_in_at', null, 'no_show', false, 'cancel_reason', null,
      'released_at', null, 'extended_mins', 0));
    return new;
  end if;

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
