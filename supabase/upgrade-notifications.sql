-- Upgrade: in-app notifications, delivered by database triggers.
-- Students are notified when their booking is approved/rejected; managers
-- (or admins, if unassigned) are notified of new requests to approve.
-- Run AFTER upgrade-activity-log.sql (safe to re-run).

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  type text not null,          -- booking_approved | booking_rejected | new_request
  entity_id uuid,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, read, created_at desc);

alter table public.notifications enable row level security;

-- users see and update only their own notifications; triggers create them
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated
  using (user_id = auth.uid());

-- ---------- trigger: notify student when their booking is decided ----------
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
      to_char(NEW.start_time, 'DD Mon, HH24:MI') || ' was ' || NEW.status || '.',
    'booking_' || NEW.status,
    NEW.id
  );
  return NEW;
end $$;

drop trigger if exists trg_notify_booking_status on public.reservations;
create trigger trg_notify_booking_status after update on public.reservations
  for each row execute function public.notify_booking_status();

-- ---------- trigger: notify approver(s) of a new pending request ----------
create or replace function public.notify_new_request() returns trigger
language plpgsql security definer as $$
declare fname text; mgr record; cnt int := 0;
begin
  if NEW.status <> 'pending' then return NEW; end if;
  select name into fname from public.facilities where id = NEW.facility_id;

  for mgr in
    select manager_id from public.facility_managers where facility_id = NEW.facility_id
  loop
    insert into public.notifications(user_id, title, body, type, entity_id)
    values (mgr.manager_id, 'New booking request',
      'A booking for ' || coalesce(fname,'a facility') || ' is waiting for your approval.',
      'new_request', NEW.id);
    cnt := cnt + 1;
  end loop;

  -- no assigned manager: send to all admins
  if cnt = 0 then
    insert into public.notifications(user_id, title, body, type, entity_id)
    select id, 'New booking request',
      'A booking for ' || coalesce(fname,'a facility') || ' needs approval.',
      'new_request', NEW.id
    from public.profiles where role = 'admin';
  end if;

  return NEW;
end $$;

drop trigger if exists trg_notify_new_request on public.reservations;
create trigger trg_notify_new_request after insert on public.reservations
  for each row execute function public.notify_new_request();
