-- Upgrade: admin-managed roles. Public signup can only create students;
-- admins promote users to facility_manager/admin from the admin dashboard.
-- Run AFTER upgrade-evaluation.sql (safe to re-run).

-- SECURITY DEFINER helper avoids RLS recursion when a policy on `profiles`
-- needs to check whether the caller is an admin.
create or replace function public.is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Self-signup may only create a STUDENT profile. This closes the hole where
-- a client could insert its own profile with role = 'admin'.
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and role = 'student');

-- Admins may update any profile (i.e. change a user's role).
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin());

-- Demo convenience only: lets the three fixed demo accounts claim their role
-- so the Student/Manager/Admin quick-login buttons work. Restricted to those
-- exact emails - remove this function before production.
create or replace function public.claim_demo_role(demo_role text) returns void
language plpgsql security definer as $$
declare my_email text;
begin
  select email into my_email from public.profiles where id = auth.uid();
  if my_email in ('student@demo.campus','facility_manager@demo.campus','admin@demo.campus')
     and demo_role in ('student','facility_manager','admin') then
    update public.profiles set role = demo_role where id = auth.uid();
  end if;
end $$;
