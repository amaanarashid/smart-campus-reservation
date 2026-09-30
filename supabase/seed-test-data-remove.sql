-- =========================================================================
--  CAMPUS RESERVE - REMOVE TEST SEED DATA
-- =========================================================================
--  Deletes everything seed-test-data.sql created, and nothing else:
--    - bookings whose purpose starts with "[seed]"
--    - the five @seed.campus students (and anything they own)
--    - any category or facility the seed had to create (tagged "[seed]"),
--      and any "(seed)" equipment
--    - seeded lost-and-found items and any seeded evaluation events
--  It does NOT remove the demo manager's assignments to your own real
--  facilities; unassign those in the admin Users tab if you want.
--
--  Run this BEFORE you start real Phase 2 testing with students, so no
--  seeded data mixes into your measurements.
--  Safe to run more than once.
-- =========================================================================

delete from public.reservations      where purpose like '[seed]%';
delete from public.lost_and_found    where notes   like '[seed]%';
delete from public.evaluation_events where note    like '[seed]%';

update public.lost_and_found set logged_by = null
 where logged_by in (select id from public.profiles where email like '%@seed.campus');
delete from auth.users where email like '%@seed.campus';

delete from public.facilities where description like '[seed]%';            -- + their rules, bookings, assignments
delete from public.facility_categories where description like '[seed]%';   -- + anything under them
delete from public.equipment where name like '% (seed)';

delete from public.notifications n
 where n.type in ('new_request','booking_approved','booking_rejected')
   and n.entity_id is not null
   and not exists (select 1 from public.reservations r where r.id = n.entity_id);

select
  (select count(*) from public.reservations where purpose like '[seed]%')      as seed_bookings_left,
  (select count(*) from public.profiles     where email   like '%@seed.campus') as seed_students_left,
  (select count(*) from public.facilities   where description like '[seed]%')
  + (select count(*) from public.facility_categories where description like '[seed]%') as seed_facilities_left;
-- all three should be 0
