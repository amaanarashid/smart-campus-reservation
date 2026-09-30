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

## Utilities

- **`make-me-admin.sql`** — lists accounts and promotes one to administrator. Needed after any full reset.

## Superseded

- **`schema.sql`** — the original single-file schema, replaced by `setup-full.sql`. Kept for reference only; do not run.

## Current tables

`profiles` · `facility_categories` · `facilities` · `facility_rules` (per-room overrides) · `facility_managers` · `reservations` · `equipment` · `reservation_equipment` · `lost_and_found` · `notifications` · `activity_log` · `evaluation_events`

Views: `facilities_full` (rooms joined to their category) and `effective_facility_rules` (category rules with per-room overrides applied) — the app reads these, not the raw tables.
