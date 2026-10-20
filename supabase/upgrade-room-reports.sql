-- =========================================================================
--  Upgrade: room feedback - students report problems in a room
-- =========================================================================
--  Run in the Supabase SQL editor after setup-all.sql. Safe to re-run.
--
--  A student who finds something wrong (air-con broken, room dirty,
--  projector dead) reports it from their booking. The room's facility
--  managers - or every admin if the room has no manager - are notified at
--  once. Staff move the report to in progress / resolved / dismissed with a
--  note, and the student is told. Every step goes into the activity log.
--
--  Privacy: a student sees only their own reports. Other students only see
--  that a room has a known open issue and its category (facility_open_issues),
--  never who reported it or what they wrote.
-- =========================================================================

create table if not exists public.room_reports (
  id             uuid primary key default gen_random_uuid(),
  facility_id    uuid not null references public.facilities(id) on delete cascade,
  reservation_id uuid references public.reservations(id) on delete set null,
  reporter_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  category       text not null check (category in (
                   'cleanliness', 'aircon', 'lighting', 'equipment', 'av_wifi',
                   'furniture', 'safety', 'noise', 'other')),
  urgency        text not null default 'normal' check (urgency in ('low', 'normal', 'urgent')),
  description    text not null check (char_length(btrim(description)) between 5 and 1000),
  status         text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'dismissed')),
  staff_note     text check (staff_note is null or char_length(staff_note) <= 1000),
  handled_by     uuid references public.profiles(id) on delete set null,
  handled_at     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists room_reports_facility_idx on public.room_reports (facility_id, status, created_at desc);
create index if not exists room_reports_reporter_idx on public.room_reports (reporter_id, created_at desc);

-- ------------------------------------------------------------------- RLS --
alter table public.room_reports enable row level security;

-- staff of a room: admins, or managers assigned to it
create or replace function public.is_room_staff(p_facility uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.facility_managers fm
     where fm.facility_id = p_facility and fm.manager_id = auth.uid());
$$;

drop policy if exists room_reports_insert on public.room_reports;
-- The trigger below fills in the reporter from the login and checks the
-- booking with a clear message, so this policy only has to confirm it.
create policy room_reports_insert on public.room_reports for insert to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists room_reports_select on public.room_reports;
create policy room_reports_select on public.room_reports for select to authenticated
  using (reporter_id = auth.uid() or public.is_room_staff(facility_id));

drop policy if exists room_reports_update on public.room_reports;
create policy room_reports_update on public.room_reports for update to authenticated
  using (public.is_room_staff(facility_id)) with check (public.is_room_staff(facility_id));

drop policy if exists room_reports_delete on public.room_reports;
create policy room_reports_delete on public.room_reports for delete to authenticated
  using (public.is_admin());

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

-- ---------------------------------------------------------- notifications --
create or replace function public.room_report_label(c text) returns text
language sql immutable as $$
  select case c
    when 'cleanliness' then 'Cleanliness' when 'aircon' then 'Air-con'
    when 'lighting' then 'Lighting' when 'equipment' then 'Equipment'
    when 'av_wifi' then 'Projector / screen / Wi-Fi' when 'furniture' then 'Furniture'
    when 'safety' then 'Safety' when 'noise' then 'Noise' else 'Other' end;
$$;

create or replace function public.notify_room_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare fname text; cnt int := 0; mgr record; msg text;
begin
  select name into fname from public.facilities where id = NEW.facility_id;

  if TG_OP = 'INSERT' then
    msg := coalesce(fname, 'A room') || ': ' || public.room_report_label(NEW.category)
           || case when NEW.urgency = 'urgent' then ' (URGENT)' else '' end
           || ' - "' || left(NEW.description, 120) || case when length(NEW.description) > 120 then '..."' else '"' end;
    for mgr in select manager_id from public.facility_managers where facility_id = NEW.facility_id loop
      insert into public.notifications(user_id, title, body, type, entity_id)
      values (mgr.manager_id, 'Room problem reported', msg, 'room_report', NEW.id);
      cnt := cnt + 1;
    end loop;
    if cnt = 0 then   -- no manager: every admin hears about it
      insert into public.notifications(user_id, title, body, type, entity_id)
      select id, 'Room problem reported', msg, 'room_report', NEW.id
        from public.profiles where role = 'admin';
    end if;
    return NEW;
  end if;

  -- staff changed the status: tell the student
  if NEW.status is distinct from OLD.status and NEW.status <> 'open' then
    insert into public.notifications(user_id, title, body, type, entity_id)
    values (NEW.reporter_id,
      case NEW.status when 'in_progress' then 'Your report is being handled'
                      when 'resolved' then 'Your report was resolved'
                      else 'Your report was closed' end,
      'Your report about ' || lower(public.room_report_label(NEW.category)) || ' in '
        || coalesce(fname, 'the room') || ' is now ' || replace(NEW.status, '_', ' ') || '.'
        || case when NEW.staff_note is not null and NEW.staff_note <> '' then ' Note: ' || NEW.staff_note else '' end,
      'room_report_update', NEW.id);
  end if;
  return NEW;
end $$;

drop trigger if exists trg_notify_room_report on public.room_reports;
create trigger trg_notify_room_report after insert or update on public.room_reports
  for each row execute function public.notify_room_report();

-- ------------------------------------------------------------ activity log --
create or replace function public.log_room_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; fname text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = NEW.facility_id;
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'reported', 'room_report', NEW.id,
      who || ' reported a ' || lower(public.room_report_label(NEW.category)) || ' problem in '
        || coalesce(fname, 'a room') || case when NEW.urgency = 'urgent' then ' (urgent)' else '' end);
  elsif NEW.status is distinct from OLD.status then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, NEW.status, 'room_report', NEW.id,
      who || ' marked the ' || lower(public.room_report_label(NEW.category)) || ' report for '
        || coalesce(fname, 'a room') || ' ' || replace(NEW.status, '_', ' '));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_log_room_report on public.room_reports;
create trigger trg_log_room_report after insert or update on public.room_reports
  for each row execute function public.log_room_report();

-- --------------------------------------------- known issues, for everyone --
-- Lets students see "Known issue: Air-con" on a room before booking it.
-- A plain view runs with its owner's rights, so it can read every report
-- but exposes only the room, the category, urgency and age - no names, no text.
create or replace view public.facility_open_issues as
  select facility_id, category, urgency, created_at
    from public.room_reports
   where status in ('open', 'in_progress');
revoke all on public.facility_open_issues from anon;
grant select on public.facility_open_issues to authenticated;

-- functions used only by triggers/policies: no direct calls from the API
revoke all on function public.room_report_guard() from public, anon, authenticated;
revoke all on function public.notify_room_report() from public, anon, authenticated;
revoke all on function public.log_room_report() from public, anon, authenticated;
