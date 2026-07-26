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
