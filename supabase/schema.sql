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
