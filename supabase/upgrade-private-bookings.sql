-- =========================================================================
--  Private bookings, profiles and lost & found + free/busy view (re-runnable)
--  Run after upgrade-room-connect.sql.
--
--  Before: every signed-in user could read every reservation (who booked,
--  purpose, group size). Now:
--    reservations       -> own rows, admins, and managers of that facility
--    reservation_busy   -> everyone signed in, but only WHEN a room is taken:
--                          id, facility_id, start_time, end_time, status.
--                          No user, purpose, party size or attendance.
--  The booking flow, recommender, popular times and the chatbot read
--  reservation_busy, so a student (and the chatbot acting as that student)
--  can see that a slot is taken but never by whom (objective 4).
--    profiles           -> own row; admins and facility managers read all
--    lost_and_found     -> admins and facility managers only
-- =========================================================================

-- setup-all.sql has created this read policy under two names over time
-- (reservations_select, res_select), both "using (true)". Drop both, since
-- policies are OR-ed and either one alone would keep every booking public.
drop policy if exists reservations_select on public.reservations;
drop policy if exists res_select on public.reservations;
create policy res_select on public.reservations for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.facility_managers fm
                where fm.facility_id = reservations.facility_id and fm.manager_id = auth.uid())
  );

-- The view runs with its owner's rights (security_invoker off), so it can
-- see every active booking while exposing only these five columns.
create or replace view public.reservation_busy
  with (security_invoker = false) as
  select r.id, r.facility_id, r.start_time, r.end_time, r.status
    from public.reservations r
   where r.status in ('pending', 'approved');

revoke all on public.reservation_busy from public, anon;
grant select on public.reservation_busy to authenticated;

-- ---------------------------------------------------------------- profiles --
-- Names and emails were readable by every signed-in user. Students only ever
-- need their own profile; managers and admins need names for approval
-- queues, attendance and the room-problem inbox. The helper is SECURITY
-- DEFINER so a policy on profiles can check the caller's role without
-- recursing into itself (same pattern as is_admin()).
create or replace function public.is_staff() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and role in ('admin', 'facility_manager'));
$$;
revoke all on function public.is_staff() from public, anon;
grant execute on function public.is_staff() to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

-- ----------------------------------------------------------- lost & found --
-- The register holds claimant names and phone numbers. Only managers and
-- admins use it (manager + admin dashboards), so reads are staff-only.
drop policy if exists lf_select on public.lost_and_found;
create policy lf_select on public.lost_and_found for select to authenticated
  using (public.is_staff());
