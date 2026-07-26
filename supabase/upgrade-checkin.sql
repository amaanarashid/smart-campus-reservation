-- Upgrade: attendance tracking (check-in + no-show).
-- Students check themselves in around the booking time; managers can mark a
-- no-show for approved bookings nobody attended. Run AFTER
-- upgrade-notifications.sql (safe to re-run).

alter table public.reservations add column if not exists checked_in_at timestamptz;
alter table public.reservations add column if not exists no_show boolean not null default false;

-- The existing update policies already cover these columns:
--   reservations_update_own  -> student checks in on their own booking
--   reservations_update_mgr  -> manager/admin marks no-show on assigned facilities
