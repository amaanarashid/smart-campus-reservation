-- ============================================================
-- Smart Campus Reservation - COMPLETE database setup
-- Paste this entire file into Supabase SQL Editor and Run. Safe to re-run.
-- ============================================================

-- ## 1. BASE SCHEMA + SEED ##
-- One-shot setup: drops the old tables, then creates the full schema.
-- Paste this entire file into Supabase SQL Editor and Run.

drop table if exists reservations cascade;
drop table if exists facilities cascade;
drop table if exists users cascade;
drop table if exists facility_rules cascade;
drop table if exists profiles cascade;

-- Smart Campus Reservation - Supabase schema
-- Run this whole file in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

create extension if not exists btree_gist;

-- ---------- tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  role text not null default 'student' check (role in ('student','facility_manager','admin')),
  rec_weights jsonb not null default '{"time": 0.5, "capacity": 0.3, "offpeak": 0.2}',
  created_at timestamptz not null default now()
);

create table if not exists public.facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('discussion_room','futsal','basketball','badminton','meeting_room','event_hall','other')),
  location text not null,
  capacity int not null check (capacity > 0),
  description text,
  manager_id uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active','maintenance','inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.facility_rules (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null unique references public.facilities(id) on delete cascade,
  open_time time not null default '08:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 60,
  max_duration_mins int not null default 120,
  max_advance_days int not null default 14,
  cancellation_hours int not null default 24,
  auto_approve boolean not null default false,
  allowed_roles text[] not null default array['student','facility_manager','admin']
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  participants int not null default 1 check (participants > 0),
  purpose text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

-- Conflict prevention at the database level: no two pending/approved
-- reservations may overlap for the same facility, even under concurrency.
alter table public.reservations drop constraint if exists no_overlap;
alter table public.reservations add constraint no_overlap
  exclude using gist (
    facility_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (status in ('pending','approved'));

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.facilities enable row level security;
alter table public.facility_rules enable row level security;
alter table public.reservations enable row level security;

-- profiles: read own + admins read all; user inserts own row at signup
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid());

-- facilities & rules: readable by all authenticated; writable by admin/manager
drop policy if exists facilities_select on public.facilities;
create policy facilities_select on public.facilities for select to authenticated using (true);
drop policy if exists facilities_write on public.facilities;
create policy facilities_write on public.facilities for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','facility_manager')));

drop policy if exists rules_select on public.facility_rules;
create policy rules_select on public.facility_rules for select to authenticated using (true);
drop policy if exists rules_write on public.facility_rules;
create policy rules_write on public.facility_rules for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- reservations: authenticated users can see booking times (needed for availability);
-- insert own; cancel own pending; managers/admins update any
drop policy if exists reservations_select on public.reservations;
create policy reservations_select on public.reservations for select to authenticated using (true);
drop policy if exists reservations_insert on public.reservations;
create policy reservations_insert on public.reservations for insert to authenticated with check (user_id = auth.uid());
drop policy if exists reservations_update_own on public.reservations;
create policy reservations_update_own on public.reservations for update to authenticated using (user_id = auth.uid());
drop policy if exists reservations_update_mgr on public.reservations;
create policy reservations_update_mgr on public.reservations for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','facility_manager')));

-- ---------- seed data ----------
insert into public.facilities (name, type, location, capacity, description) values
  ('Discussion Room A', 'discussion_room', 'Library Level 3', 8,  'Whiteboard, TV screen, 8 seats'),
  ('Discussion Room B', 'discussion_room', 'Library Level 3', 6,  'Whiteboard, 6 seats'),
  ('Futsal Court 1',    'futsal',          'Sports Complex',  14, 'Outdoor court, floodlights'),
  ('Basketball Court',  'basketball',      'Sports Complex',  15, 'Full court, indoor'),
  ('Badminton Court 1', 'badminton',       'Sports Hall',     4,  'Court 1 of 4'),
  ('Meeting Room M1',   'meeting_room',    'Block B Level 5', 12, 'Projector, conference phone'),
  ('Grand Event Hall',  'event_hall',      'Block A Ground',  300,'Stage, AV system, 300 pax')
on conflict do nothing;

insert into public.facility_rules (facility_id, open_time, close_time, slot_minutes, max_duration_mins, max_advance_days, cancellation_hours, auto_approve)
select id,
  case when type in ('futsal','basketball','badminton') then '10:00'::time else '08:00'::time end,
  '22:00'::time,
  case when type = 'discussion_room' then 30 else 60 end,
  case when type = 'event_hall' then 480 when type = 'discussion_room' then 120 else 120 end,
  case when type = 'event_hall' then 60 else 14 end,
  case when type = 'event_hall' then 72 else 12 end,
  type = 'discussion_room'
from public.facilities
on conflict (facility_id) do nothing;

-- ## 2. EQUIPMENT + VENUES + MIN DURATION ##
-- Upgrade: venues, min booking duration, equipment inventory.
-- Run AFTER setup-full.sql (safe to re-run).

-- 1. Venue grouping
alter table public.facilities add column if not exists venue text not null default 'Campus';
update public.facilities set venue = case
  when type = 'discussion_room' then 'Library'
  when type in ('futsal','basketball') then 'Sports Complex'
  when type = 'badminton' then 'Sports Hall'
  when type = 'meeting_room' then 'Block B'
  when type = 'event_hall' then 'Block A'
  else 'Campus' end;

-- 2. Minimum booking duration (admin-configurable, pairs with max_duration_mins)
alter table public.facility_rules add column if not exists min_duration_mins int not null default 30;
update public.facility_rules set min_duration_mins = 30 where min_duration_mins is null;

-- 3. Equipment inventory (quantities shared across facilities of the same type)
create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  facility_type text not null,
  name text not null,
  total_qty int not null check (total_qty >= 0),
  unique (facility_type, name)
);

create table if not exists public.reservation_equipment (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  qty int not null check (qty > 0),
  unique (reservation_id, equipment_id)
);

alter table public.equipment enable row level security;
alter table public.reservation_equipment enable row level security;

drop policy if exists equipment_select on public.equipment;
create policy equipment_select on public.equipment for select to authenticated using (true);
drop policy if exists equipment_write on public.equipment;
create policy equipment_write on public.equipment for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists res_equip_select on public.reservation_equipment;
create policy res_equip_select on public.reservation_equipment for select to authenticated using (true);
drop policy if exists res_equip_insert on public.reservation_equipment;
create policy res_equip_insert on public.reservation_equipment for insert to authenticated
  with check (exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));
drop policy if exists res_equip_delete on public.reservation_equipment;
create policy res_equip_delete on public.reservation_equipment for delete to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));

-- 4. Seed equipment
insert into public.equipment (facility_type, name, total_qty) values
  ('discussion_room', 'HDMI cable', 4),
  ('discussion_room', 'Extension cord', 3),
  ('discussion_room', 'Whiteboard marker set', 6),
  ('meeting_room', 'HDMI cable', 3),
  ('meeting_room', 'Conference microphone', 2),
  ('futsal', 'Football', 5),
  ('futsal', 'Bibs set (7)', 4),
  ('basketball', 'Basketball', 6),
  ('badminton', 'Racket', 8),
  ('badminton', 'Shuttlecock tube', 10),
  ('event_hall', 'Wireless microphone', 4),
  ('event_hall', 'Portable projector', 2)
on conflict (facility_type, name) do nothing;

-- ## 3. CATEGORIES + MULTI-MANAGER + SCOPED RLS ##
-- Upgrade: free-form categories, multi-manager assignment, scoped permissions.
-- Run AFTER upgrade-equipment.sql (safe to re-run).

-- 1. Free-form facility categories (drop the fixed-list constraint)
alter table public.facilities drop constraint if exists facilities_type_check;

-- 2. Multiple managers per facility
create table if not exists public.facility_managers (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  unique (facility_id, manager_id)
);

-- migrate any legacy single-manager assignments
insert into public.facility_managers (facility_id, manager_id)
select id, manager_id from public.facilities where manager_id is not null
on conflict (facility_id, manager_id) do nothing;

alter table public.facility_managers enable row level security;
drop policy if exists fm_select on public.facility_managers;
create policy fm_select on public.facility_managers for select to authenticated using (true);
drop policy if exists fm_write on public.facility_managers;
create policy fm_write on public.facility_managers for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 3. Facilities: only admins create/edit/delete
drop policy if exists facilities_write on public.facilities;
create policy facilities_write on public.facilities for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- 4. Reservations: managers may only update bookings of facilities assigned
--    to them; admins may update any
drop policy if exists reservations_update_mgr on public.reservations;
create policy reservations_update_mgr on public.reservations for update to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (
      select 1 from public.facility_managers fm
      where fm.facility_id = reservations.facility_id and fm.manager_id = auth.uid()
    )
  );

-- 5. Equipment: managers edit items for categories of their assigned
--    facilities; admins edit everything
drop policy if exists equipment_write on public.equipment;
create policy equipment_write on public.equipment for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (
      select 1
      from public.facility_managers fm
      join public.facilities f on f.id = fm.facility_id
      where fm.manager_id = auth.uid() and f.type = equipment.facility_type
    )
  );

-- ## 4. LOST & FOUND ##
-- Upgrade: lost & found register, managed per facility.
-- Run AFTER upgrade-admin.sql (safe to re-run).

create table if not exists public.lost_and_found (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  item_name text not null,
  category text not null default 'other'
    check (category in ('electronics','clothing','books','keys','wallet','sports','id_card','other')),
  description text,
  found_location text,
  found_date date not null default current_date,
  reporter_name text,
  status text not null default 'unclaimed'
    check (status in ('unclaimed','claimed','returned','disposed')),
  claimant_name text,
  claimant_contact text,
  notes text,
  logged_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.lost_and_found enable row level security;

-- read: any authenticated user (students may search for their lost item)
drop policy if exists lf_select on public.lost_and_found;
create policy lf_select on public.lost_and_found for select to authenticated using (true);

-- write: admins, or managers assigned to the facility the item belongs to
drop policy if exists lf_write on public.lost_and_found;
create policy lf_write on public.lost_and_found for all to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
    or exists (
      select 1 from public.facility_managers fm
      where fm.facility_id = lost_and_found.facility_id and fm.manager_id = auth.uid()
    )
  );

-- ## 5. ACTIVITY LOG ##
-- Upgrade: system-wide activity log (audit trail) for administrators.
-- Database triggers record every meaningful action into one table, so the
-- admin has a complete, tamper-evident history regardless of how a change
-- was made. Run AFTER upgrade-lost-found.sql (safe to re-run).

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  action text not null,      -- created | approved | rejected | cancelled | updated | deleted | assigned | unassigned | claimed | returned | disposed
  entity text not null,      -- reservation | facility | facility_rule | lost_and_found | equipment | facility_manager | profile
  entity_id uuid,
  summary text not null
);

create index if not exists activity_log_at_idx on public.activity_log (at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity);

alter table public.activity_log enable row level security;

-- only admins may read the log; nobody writes it directly (triggers do)
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------- helper ----------
create or replace function public._actor_name() returns text
language sql security definer stable as $$
  select coalesce(
    (select full_name from public.profiles where id = auth.uid()),
    'system'
  );
$$;

-- ---------- trigger functions ----------
create or replace function public.log_reservation() returns trigger
language plpgsql security definer as $$
declare fname text; who text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = coalesce(NEW.facility_id, OLD.facility_id);
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'reservation', NEW.id,
      who || ' booked ' || coalesce(fname,'a facility') || ' for ' ||
      to_char(NEW.start_time, 'DD Mon HH24:MI') || ' (' || NEW.status || ')');
  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, NEW.status, 'reservation', NEW.id,
      'Booking for ' || coalesce(fname,'a facility') || ' on ' ||
      to_char(NEW.start_time, 'DD Mon HH24:MI') || ' marked ' || NEW.status || ' by ' || who);
  end if;
  return NEW;
end $$;

create or replace function public.log_facility() returns trigger
language plpgsql security definer as $$
declare who text;
begin
  who := public._actor_name();
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'facility', NEW.id,
      who || ' added facility "' || NEW.name || '" (' || NEW.type || ') in ' || NEW.venue);
  elsif TG_OP = 'UPDATE' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'updated', 'facility', NEW.id,
      who || ' updated "' || NEW.name || '"' ||
      case when NEW.status is distinct from OLD.status then ' (status -> ' || NEW.status || ')' else '' end);
  elsif TG_OP = 'DELETE' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'deleted', 'facility', OLD.id, who || ' removed "' || OLD.name || '"');
    return OLD;
  end if;
  return NEW;
end $$;

create or replace function public.log_rule() returns trigger
language plpgsql security definer as $$
declare who text; fname text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = NEW.facility_id;
  insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
  values (auth.uid(), who, 'updated', 'facility_rule', NEW.facility_id,
    who || ' changed booking rules for ' || coalesce(fname,'a facility'));
  return NEW;
end $$;

create or replace function public.log_lost_found() returns trigger
language plpgsql security definer as $$
declare who text;
begin
  who := public._actor_name();
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'lost_and_found', NEW.id,
      who || ' logged lost item "' || NEW.item_name || '"');
  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, NEW.status, 'lost_and_found', NEW.id,
      '"' || NEW.item_name || '" marked ' || NEW.status ||
      case when NEW.claimant_name is not null then ' (by ' || NEW.claimant_name || ')' else '' end);
  end if;
  return NEW;
end $$;

create or replace function public.log_manager() returns trigger
language plpgsql security definer as $$
declare who text; fname text; mname text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = coalesce(NEW.facility_id, OLD.facility_id);
  select full_name into mname from public.profiles where id = coalesce(NEW.manager_id, OLD.manager_id);
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'assigned', 'facility_manager', NEW.facility_id,
      who || ' assigned ' || coalesce(mname,'a manager') || ' to ' || coalesce(fname,'a facility'));
  elsif TG_OP = 'DELETE' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'unassigned', 'facility_manager', OLD.facility_id,
      who || ' removed ' || coalesce(mname,'a manager') || ' from ' || coalesce(fname,'a facility'));
    return OLD;
  end if;
  return NEW;
end $$;

create or replace function public.log_equipment() returns trigger
language plpgsql security definer as $$
declare who text;
begin
  who := public._actor_name();
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'equipment', NEW.id,
      who || ' added equipment "' || NEW.name || '" x' || NEW.total_qty);
  elsif TG_OP = 'UPDATE' and NEW.total_qty is distinct from OLD.total_qty then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'updated', 'equipment', NEW.id,
      who || ' set "' || NEW.name || '" inventory to ' || NEW.total_qty);
  end if;
  return NEW;
end $$;

create or replace function public.log_new_profile() returns trigger
language plpgsql security definer as $$
begin
  insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
  values (NEW.id, NEW.full_name, 'created', 'profile', NEW.id,
    NEW.full_name || ' registered as ' || NEW.role);
  return NEW;
end $$;

-- ---------- attach triggers ----------
drop trigger if exists trg_log_reservation on public.reservations;
create trigger trg_log_reservation after insert or update on public.reservations
  for each row execute function public.log_reservation();

drop trigger if exists trg_log_facility on public.facilities;
create trigger trg_log_facility after insert or update or delete on public.facilities
  for each row execute function public.log_facility();

drop trigger if exists trg_log_rule on public.facility_rules;
create trigger trg_log_rule after update on public.facility_rules
  for each row execute function public.log_rule();

drop trigger if exists trg_log_lost_found on public.lost_and_found;
create trigger trg_log_lost_found after insert or update on public.lost_and_found
  for each row execute function public.log_lost_found();

drop trigger if exists trg_log_manager on public.facility_managers;
create trigger trg_log_manager after insert or delete on public.facility_managers
  for each row execute function public.log_manager();

drop trigger if exists trg_log_equipment on public.equipment;
create trigger trg_log_equipment after insert or update on public.equipment
  for each row execute function public.log_equipment();

drop trigger if exists trg_log_new_profile on public.profiles;
create trigger trg_log_new_profile after insert on public.profiles
  for each row execute function public.log_new_profile();

-- ## 6. NOTIFICATIONS ##
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

-- ## 7. CHECK-IN / NO-SHOW ##
-- Upgrade: attendance tracking (check-in + no-show).
-- Students check themselves in around the booking time; managers can mark a
-- no-show for approved bookings nobody attended. Run AFTER
-- upgrade-notifications.sql (safe to re-run).

alter table public.reservations add column if not exists checked_in_at timestamptz;
alter table public.reservations add column if not exists no_show boolean not null default false;

-- The existing update policies already cover these columns:
--   reservations_update_own  -> student checks in on their own booking
--   reservations_update_mgr  -> manager/admin marks no-show on assigned facilities

-- ## 8. EVALUATION INSTRUMENTATION ##
-- Upgrade: evaluation instrumentation for Phase 2 metrics.
-- Captures whether AI recommendations get accepted and whether chatbot
-- answers are rated helpful, so Objective 4 can be measured with real data
-- instead of estimates. Run AFTER upgrade-checkin.sql (safe to re-run).

create table if not exists public.evaluation_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null,          -- rec_shown | rec_accepted | chat_feedback
  num_value int,               -- rec_shown: #suggestions | rec_accepted: chosen rank (0-based)
  bool_value boolean,          -- chat_feedback: helpful?
  note text
);

create index if not exists eval_kind_idx on public.evaluation_events (kind, at desc);

alter table public.evaluation_events enable row level security;

-- users log their own events; admins (the researcher) read them all
drop policy if exists eval_insert on public.evaluation_events;
create policy eval_insert on public.evaluation_events for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists eval_select on public.evaluation_events;
create policy eval_select on public.evaluation_events for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
