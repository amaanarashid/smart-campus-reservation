# Database migrations

Run these in the Supabase dashboard: **SQL Editor → New query → paste → Run**.

## Fresh database (or full reset)

Run **`setup-all.sql`** — it contains every migration below, in the correct order.

> ⚠️ It starts by dropping `profiles`, `facilities` and `reservations`, so it **wipes all users and bookings**. After running it, promote your account with `make-me-admin.sql` (public signup only ever creates students).

## Existing database — run individually, in this order

| # | File | What it adds |
|---|------|--------------|
| 1 | `setup-full.sql` | Base schema, RLS, no-overlap conflict constraint, seed data |
| 2 | `upgrade-equipment.sql` | Venues, minimum duration, equipment inventory |
| 3 | `upgrade-admin.sql` | Free-form categories, multi-manager assignment, scoped permissions |
| 4 | `upgrade-lost-found.sql` | Lost & found register |
| 5 | `upgrade-activity-log.sql` | Audit trail via database triggers |
| 6 | `upgrade-notifications.sql` | In-app notifications via triggers |
| 7 | `upgrade-checkin.sql` | Check-in / no-show columns |
| 8 | `upgrade-evaluation.sql` | Evaluation instrumentation (Phase 2 metrics) |
| 9 | `upgrade-user-roles.sql` | Admin-managed roles, `is_admin()` helper |
| 10 | `upgrade-categories.sql` | Two-level facility model (types → rooms), resolving views. **Wipes facilities and bookings** |

Each file is safe to re-run. Order matters: later migrations depend on functions and tables created by earlier ones (e.g. `is_admin()` comes from #9).

## After setup-all.sql: run these, in this order

`setup-all.sql` covers #1-#10. The features added since then are separate files. Run them after it, top to bottom (each is re-runnable):

| # | File | What it adds |
|---|------|--------------|
| 11 | `upgrade-recommender.sql` | Per-student recommender state (LinUCB) |
| 12 | `fix-role-escalation.sql` | Students can't change their own role |
| 13 | `upgrade-auto-release.sql` | Check-in grace, `release_no_shows()` every few minutes (pg_cron) |
| 14 | `upgrade-room-access.sql` | Smart-room devices and events, `register_room_device()` |
| 15 | `upgrade-room-end.sql` | Extend a booking, 10-minute reminder (pg_cron), `room_devices_visible` |
| 16 | `upgrade-room-reports.sql` then `fix-room-reports-insert.sql` | Students report room problems |
| 17 | `upgrade-room-commands.sql` | Remote-control commands (signed, MQTT) |
| 18 | `upgrade-realtime.sql` | Live updates for the 3D twin and room pages |
| 19 | `upgrade-room-connect.sql` | Connect rooms from the admin console (simulated / physical) |
| 20 | `upgrade-private-bookings.sql` | Bookings private to the booker and staff; `reservation_busy` free/busy view |
| 21 | `upgrade-booking-rules.sql` | Every booking rule enforced by a database trigger |
| 22 | `upgrade-access-limits.sql` | Member types, who can book, fair-use limits |
| 23 | `upgrade-noshow.sql` | No-show prediction: `noshow_model`, `booking_risk`, `score_upcoming_bookings()` every 10 min (pg_cron), one "Still coming?" reminder for high-risk bookings |
| 24 | `upgrade-room-pairing.sql` | Connect a device by pairing code: `room_pairings`, `room_pair_poll()`, `claim_room_pairing()` |
| 25 | `upgrade-room-config.sql` | What is wired to each device (board, parts, pins, IR air-con), `set_room_config()`, device reports; door check-in only for rooms with a keypad |

Test data: `seed-test-data.sql` and `seed-room-energy.sql` add tagged demo users and bookings, and `seed-test-data-remove.sql` removes them. Remove them before a real user study.

## Utilities

- **`make-me-admin.sql`** — lists accounts and promotes one to administrator. Needed after any full reset.
- **`scripts/eval/live-metrics.sql`** — read-only evaluation queries (suggestion acceptance, no-shows, remote-control timing) for after the user study.

## Superseded

- **`schema.sql`** — the original single-file schema, replaced by `setup-full.sql`. Kept for reference only; do not run.

## Current tables

`profiles` · `facility_categories` · `facilities` · `facility_rules` (per-room overrides) · `facility_managers` · `reservations` · `equipment` · `reservation_equipment` · `lost_and_found` · `notifications` · `activity_log` · `evaluation_events` · `noshow_model` · `booking_risk`

Views: `facilities_full` (rooms joined to their category) and `effective_facility_rules` (category rules with per-room overrides applied) — the app reads these, not the raw tables.
