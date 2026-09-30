-- Upgrade: two-level facility model.
--   facility_categories  = the thing you add first (Badminton, Football...)
--                          carries the venue and the BASE booking rules
--   facilities           = the individual rooms/courts under a category
--   facility_rules       = OPTIONAL per-court override (nullable columns)
--   effective_facility_rules (view) = override value ?? category value
--
-- WARNING: this wipes existing facilities, rules and bookings, then reseeds.
-- Run AFTER upgrade-user-roles.sql.

-- Safety net: define is_admin() here too, in case migration 9 hasn't run yet.
create or replace function public.is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- wipe ----------
drop view if exists public.effective_facility_rules;
drop table if exists public.reservation_equipment cascade;
drop table if exists public.reservations cascade;
drop table if exists public.facility_rules cascade;
drop table if exists public.lost_and_found cascade;
drop table if exists public.facility_managers cascade;
drop table if exists public.facilities cascade;
drop table if exists public.facility_categories cascade;

-- ---------- categories (added first, own the rules) ----------
create table public.facility_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,                  -- display name, e.g. "Badminton"
  slug text not null unique,           -- machine key, e.g. "badminton"
  venue text not null,                 -- e.g. "Sports Hall"
  description text,
  -- base booking rules, inherited by every court in this category
  open_time time not null default '08:00',
  close_time time not null default '22:00',
  slot_minutes int not null default 60,
  min_duration_mins int not null default 30,
  max_duration_mins int not null default 120,
  max_advance_days int not null default 14,
  cancellation_hours int not null default 24,
  auto_approve boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- courts / rooms ----------
create table public.facilities (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.facility_categories(id) on delete cascade,
  name text not null,                  -- e.g. "Court 1"
  capacity int not null check (capacity > 0),
  description text,
  status text not null default 'active' check (status in ('active','maintenance','inactive')),
  created_at timestamptz not null default now()
);

-- ---------- optional per-court override (NULL = inherit) ----------
create table public.facility_rules (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null unique references public.facilities(id) on delete cascade,
  open_time time,
  close_time time,
  slot_minutes int,
  min_duration_mins int,
  max_duration_mins int,
  max_advance_days int,
  cancellation_hours int,
  auto_approve boolean
);

-- ---------- resolved rules, what the app reads ----------
create view public.effective_facility_rules
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
  (r.id is not null)                                   as has_override
from public.facilities f
join public.facility_categories c on c.id = f.category_id
left join public.facility_rules r on r.facility_id = f.id;

-- ---------- flattened facility view (what the app reads) ----------
create view public.facilities_full
with (security_invoker = true) as
select
  f.id, f.name, f.capacity, f.description, f.status, f.created_at,
  f.category_id,
  c.slug  as type,
  c.name  as category_name,
  c.venue as venue,
  c.venue as location
from public.facilities f
join public.facility_categories c on c.id = f.category_id;

-- ---------- dependent tables rebuilt ----------
create table public.facility_managers (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  manager_id uuid not null references public.profiles(id) on delete cascade,
  unique (facility_id, manager_id)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  facility_id uuid not null references public.facilities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  participants int not null default 1 check (participants > 0),
  purpose text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  checked_in_at timestamptz,
  no_show boolean not null default false,
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

alter table public.reservations add constraint no_overlap
  exclude using gist (
    facility_id with =,
    tstzrange(start_time, end_time) with &&
  ) where (status in ('pending','approved'));

create table public.reservation_equipment (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  equipment_id uuid not null references public.equipment(id) on delete cascade,
  qty int not null check (qty > 0),
  unique (reservation_id, equipment_id)
);

create table public.lost_and_found (
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

-- ---------- RLS ----------
alter table public.facility_categories enable row level security;
alter table public.facilities enable row level security;
alter table public.facility_rules enable row level security;
alter table public.facility_managers enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_equipment enable row level security;
alter table public.lost_and_found enable row level security;

create policy cat_select on public.facility_categories for select to authenticated using (true);
create policy cat_write  on public.facility_categories for all    to authenticated using (public.is_admin());

create policy fac_select on public.facilities for select to authenticated using (true);
create policy fac_write  on public.facilities for all    to authenticated using (public.is_admin());

create policy rules_select on public.facility_rules for select to authenticated using (true);
create policy rules_write  on public.facility_rules for all    to authenticated using (public.is_admin());

create policy fm_select on public.facility_managers for select to authenticated using (true);
create policy fm_write  on public.facility_managers for all    to authenticated using (public.is_admin());

create policy res_select on public.reservations for select to authenticated using (true);
create policy res_insert on public.reservations for insert to authenticated with check (user_id = auth.uid());
create policy res_update_own on public.reservations for update to authenticated using (user_id = auth.uid());
create policy res_update_mgr on public.reservations for update to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.facility_managers fm
               where fm.facility_id = reservations.facility_id and fm.manager_id = auth.uid())
  );

create policy re_select on public.reservation_equipment for select to authenticated using (true);
create policy re_insert on public.reservation_equipment for insert to authenticated
  with check (exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));
create policy re_delete on public.reservation_equipment for delete to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));

create policy lf_select on public.lost_and_found for select to authenticated using (true);
create policy lf_write on public.lost_and_found for all to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.facility_managers fm
               where fm.facility_id = lost_and_found.facility_id and fm.manager_id = auth.uid())
  );

-- ---------- re-attach triggers from earlier migrations ----------
-- Guarded: only attached if the trigger function exists (i.e. the activity-log
-- and notification migrations have been run).
do $$
begin
  if to_regprocedure('public.log_reservation()') is not null then
    execute 'drop trigger if exists trg_log_reservation on public.reservations';
    execute 'create trigger trg_log_reservation after insert or update on public.reservations
             for each row execute function public.log_reservation()';
  end if;
  if to_regprocedure('public.log_facility()') is not null then
    execute 'drop trigger if exists trg_log_facility on public.facilities';
    execute 'create trigger trg_log_facility after insert or update or delete on public.facilities
             for each row execute function public.log_facility()';
  end if;
  if to_regprocedure('public.log_lost_found()') is not null then
    execute 'drop trigger if exists trg_log_lost_found on public.lost_and_found';
    execute 'create trigger trg_log_lost_found after insert or update on public.lost_and_found
             for each row execute function public.log_lost_found()';
  end if;
  if to_regprocedure('public.log_manager()') is not null then
    execute 'drop trigger if exists trg_log_manager on public.facility_managers';
    execute 'create trigger trg_log_manager after insert or delete on public.facility_managers
             for each row execute function public.log_manager()';
  end if;
  if to_regprocedure('public.notify_booking_status()') is not null then
    execute 'drop trigger if exists trg_notify_booking_status on public.reservations';
    execute 'create trigger trg_notify_booking_status after update on public.reservations
             for each row execute function public.notify_booking_status()';
  end if;
  if to_regprocedure('public.notify_new_request()') is not null then
    execute 'drop trigger if exists trg_notify_new_request on public.reservations';
    execute 'create trigger trg_notify_new_request after insert on public.reservations
             for each row execute function public.notify_new_request()';
  end if;
end $$;

-- log_facility() referenced NEW.type/NEW.venue which now live on the category
create or replace function public.log_facility() returns trigger
language plpgsql security definer as $$
declare who text; cat text;
begin
  who := public._actor_name();
  select name into cat from public.facility_categories
   where id = coalesce(NEW.category_id, OLD.category_id);
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'facility', NEW.id,
      who || ' added "' || NEW.name || '" under ' || coalesce(cat,'a category'));
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

-- ---------- seed: categories, then their courts ----------
insert into public.facility_categories
  (name, slug, venue, open_time, close_time, slot_minutes, min_duration_mins,
   max_duration_mins, max_advance_days, cancellation_hours, auto_approve) values
  ('Discussion Room','discussion_room','Library','08:00','22:00',30,30,120,14,12,true),
  ('Badminton','badminton','Sports Hall','10:00','22:00',60,60,120,14,12,false),
  ('Futsal','futsal','Sports Complex','10:00','22:00',60,60,120,14,12,false),
  ('Basketball','basketball','Sports Complex','10:00','22:00',60,60,120,14,12,false),
  ('Meeting Room','meeting_room','Block B','08:00','20:00',60,30,180,30,24,false),
  ('Event Hall','event_hall','Block A','08:00','22:00',60,120,480,60,72,false);

insert into public.facilities (category_id, name, capacity, description)
select c.id, v.name, v.cap, v.descr
from public.facility_categories c
join (values
  ('discussion_room','Discussion Room A', 8,  'Whiteboard, TV screen'),
  ('discussion_room','Discussion Room B', 6,  'Whiteboard'),
  ('badminton',      'Court 1',           4,  'Court 1 of 4'),
  ('badminton',      'Court 2',           4,  'Court 2 of 4'),
  ('futsal',         'Futsal Court 1',    14, 'Outdoor, floodlights'),
  ('basketball',     'Main Court',        15, 'Indoor full court'),
  ('meeting_room',   'Meeting Room M1',   12, 'Projector, conference phone'),
  ('event_hall',     'Grand Hall',        300,'Stage, AV system')
) as v(slug, name, cap, descr) on v.slug = c.slug;
