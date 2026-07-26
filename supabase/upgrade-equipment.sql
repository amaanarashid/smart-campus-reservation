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
