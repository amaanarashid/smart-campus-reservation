-- =========================================================================
--  Fix: "new row violates row-level security policy for table room_reports"
-- =========================================================================
--  Run once in the Supabase SQL editor. Same as re-running
--  upgrade-room-reports.sql (which now contains this fix); safe to re-run.
--
--  The insert check moved from the RLS policy into the trigger: the trigger
--  sets the reporter from the login and explains a refusal in plain words
--  ("That booking is not yours..."), so a student never sees the bare
--  row-level security error.
-- =========================================================================

drop policy if exists room_reports_insert on public.room_reports;
-- The trigger below fills in the reporter from the login and checks the
-- booking with a clear message, so this policy only has to confirm it.
create policy room_reports_insert on public.room_reports for insert to authenticated
  with check (reporter_id = auth.uid());

-- ------------------------------------------------------------ guard rails --
-- New report: reporter = the login, status open, booking must be theirs.
-- Update: staff may only change status and note; who/what/where stays as
-- reported. Stamps who handled it, and limits students to 5 reports an hour.
create or replace function public.room_report_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if auth.uid() is not null then
      -- a signed-in user always reports as themselves, and a new report is always open
      NEW.reporter_id := auth.uid();
      NEW.status := 'open';
      NEW.staff_note := null;
      NEW.handled_by := null;
      NEW.handled_at := null;
      if NEW.reservation_id is not null and not exists (
        select 1 from public.reservations r
         where r.id = NEW.reservation_id and r.user_id = auth.uid() and r.facility_id = NEW.facility_id) then
        raise exception 'That booking is not yours, or it is for a different room.';
      end if;
    end if;
    if (select count(*) from public.room_reports
         where reporter_id = NEW.reporter_id and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'You can send at most 5 reports an hour. Please try again later.';
    end if;
    NEW.description := btrim(NEW.description);
    return NEW;
  end if;
  if NEW.facility_id is distinct from OLD.facility_id
     or NEW.reporter_id is distinct from OLD.reporter_id
     or NEW.reservation_id is distinct from OLD.reservation_id
     or NEW.category is distinct from OLD.category
     or NEW.description is distinct from OLD.description
     or NEW.created_at is distinct from OLD.created_at then
    raise exception 'Only the status and the staff note of a report can be changed.';
  end if;
  if NEW.status is distinct from OLD.status or NEW.staff_note is distinct from OLD.staff_note then
    NEW.handled_by := auth.uid();
    NEW.handled_at := now();
  end if;
  return NEW;
end $$;

drop trigger if exists trg_room_report_guard on public.room_reports;
create trigger trg_room_report_guard before insert or update on public.room_reports
  for each row execute function public.room_report_guard();

