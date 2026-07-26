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
