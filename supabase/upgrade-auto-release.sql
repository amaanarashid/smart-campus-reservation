-- =========================================================================
--  Upgrade: auto-release bookings nobody checked in to
-- =========================================================================
--  Run in the Supabase SQL editor after setup-all.sql. Safe to re-run.
--
--  New booking rule: CHECK-IN GRACE (minutes). If an approved booking has
--  not been checked in within that many minutes of its start, it is
--  released: cancelled, marked as a no-show, the student is notified, and the
--  slot becomes bookable again. Blank / null = feature off for that category.
--
--  Like every other rule it is set on the category and may be overridden per
--  facility, and the effective value is resolved by effective_facility_rules.
--
--  A pg_cron job runs the release every minute, inside the database, so it
--  works whether or not anyone has the app open. If the CREATE EXTENSION
--  line errors, enable pg_cron in the dashboard (Database -> Extensions ->
--  pg_cron) and run this file again.
-- =========================================================================

-- ---------------------------------------------------------------- columns --
alter table public.facility_categories
  add column if not exists checkin_grace_mins int
  check (checkin_grace_mins is null or checkin_grace_mins between 1 and 120);

alter table public.facility_rules
  add column if not exists checkin_grace_mins int
  check (checkin_grace_mins is null or checkin_grace_mins between 1 and 120);

-- why a booking was cancelled, so no-show statistics are not polluted by
-- students who cancelled properly
alter table public.reservations
  add column if not exists cancel_reason text
  check (cancel_reason is null or cancel_reason in ('user', 'no_checkin', 'early_leave', 'admin'));
alter table public.reservations
  add column if not exists released_at timestamptz;

comment on column public.facility_categories.checkin_grace_mins is
  'Minutes after start before an un-checked-in booking is released. Null = off.';

-- ------------------------------------------------------------------ view --
-- Same columns as before, with checkin_grace_mins appended at the end
-- (CREATE OR REPLACE VIEW may only add columns at the end).
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
  coalesce(r.checkin_grace_mins, c.checkin_grace_mins) as checkin_grace_mins
from public.facilities f
join public.facility_categories c on c.id = f.category_id
left join public.facility_rules r on r.facility_id = f.id;

-- ------------------------------------------------------- release function --
-- Releases every approved booking that is past its grace period with no
-- check-in. Only looks back one day, so switching the rule on never mass-
-- cancels old history. Returns how many were released.
create or replace function public.release_no_shows()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  n int := 0;
begin
  for rec in
    update public.reservations r
       set status        = 'cancelled',
           no_show       = true,
           cancel_reason = 'no_checkin',
           released_at   = now()
      from public.effective_facility_rules e
     where e.facility_id = r.facility_id
       and e.checkin_grace_mins is not null
       and r.status = 'approved'
       and r.checked_in_at is null
       and r.start_time > now() - interval '1 day'
       and r.start_time + make_interval(mins => e.checkin_grace_mins) <= now()
    returning r.id, r.user_id, r.facility_id, r.start_time, e.checkin_grace_mins as grace
  loop
    insert into public.notifications (user_id, title, body, type, entity_id)
    values (
      rec.user_id,
      'Booking released',
      'Your booking for ' || coalesce((select name from public.facilities where id = rec.facility_id), 'a facility')
        || ' at ' || to_char(rec.start_time at time zone 'Asia/Kuala_Lumpur', 'DD Mon, HH12:MI am')
        || ' was released because nobody checked in within ' || rec.grace
        || ' minutes. The slot is now open to others.',
      'booking_released',
      rec.id
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Only the scheduler (and admins via the SQL editor) should run this.
-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default, so revoke from those roles explicitly.
revoke all on function public.release_no_shows() from public, anon, authenticated;

-- ------------------------------------------ fix: notification times in MYT --
-- The existing trigger formatted start_time in the database's timezone (UTC),
-- so "approved for 3:00 pm" arrived as "07:00". Same logic, Malaysia time.
create or replace function public.notify_booking_status() returns trigger
language plpgsql security definer as $$
declare fname text;
begin
  if NEW.status is not distinct from OLD.status then return NEW; end if;
  if NEW.status not in ('approved','rejected') then return NEW; end if;
  select name into fname from public.facilities where id = NEW.facility_id;
  insert into public.notifications(user_id, title, body, type, entity_id)
  values (
    NEW.user_id,
    case NEW.status when 'approved' then 'Booking approved' else 'Booking not approved' end,
    'Your booking for ' || coalesce(fname,'a facility') || ' on ' ||
      to_char(NEW.start_time at time zone 'Asia/Kuala_Lumpur', 'DD Mon, HH12:MI am') ||
      ' was ' || NEW.status || '.',
    'booking_' || NEW.status,
    NEW.id
  );
  return NEW;
end $$;

-- ------------------------------------------------------ switch it on: library --
-- Discussion rooms (the library demo room) get a 10-minute grace period.
-- Change or clear it per category in the admin console.
update public.facility_categories
   set checkin_grace_mins = 10
 where checkin_grace_mins is null
   and (slug like 'discussion%' or lower(name) like 'discussion%');

-- --------------------------------------------------------------- schedule --
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'release-no-shows') then
    perform cron.unschedule('release-no-shows');
  end if;
  perform cron.schedule('release-no-shows', '* * * * *', 'select public.release_no_shows()');
end $$;

-- Check it is scheduled:      select jobname, schedule, active from cron.job;
-- See recent runs:            select status, return_message, start_time
--                               from cron.job_run_details order by start_time desc limit 5;
