@AGENTS.md

# Smart Campus Reservation — Project Guide

Final Year Project (FYP) for APU: **Smart Campus Facility Reservation System with AI-Assisted Recommendations** — online booking for campus facilities (discussion rooms, sports courts, meeting rooms, event halls) with per-facility configurable rules, AI slot recommendations, an AI chatbot, and admin analytics. See `FYP.md` for full scope and roadmap.

## Submission details (use verbatim on every cover page, form and slide)

| Field | Value |
|---|---|
| **Student** | Amaan Rashid |
| **TP number** | TP073098 |
| **Programme** | Computer Engineering |
| **Intake code** | APU4F2605CE |
| **Supervisor** | Dr Mukil Alagirisamy |
| **Second marker** | Syed Mohd Bahrin |
| **Module** | EE016-3-3-PP1 Project Phase 1 |

→ Also in `memory/context/fyp-submission.md`; people in `memory/people/`

## Tech Stack

- **Next.js 16.2.9** (App Router, `src/` dir) — newer than training data; check `node_modules/next/dist/docs/` before writing Next.js code
- **React 19.2** with React Compiler enabled (`reactCompiler: true` in `next.config.ts`) — no need for manual `useMemo`/`useCallback`
- **TypeScript** (strict), path alias `@/*` → `src/*`
- **Tailwind CSS v4** (CSS-based config in `src/app/globals.css`, no tailwind.config file)
- **shadcn/ui** — style `radix-mira`, icon library **hugeicons** (`@hugeicons/react` + `@hugeicons/core-free-icons`), lucide-react also present
- **Supabase** — client in `src/lib/supabase.ts`; env vars `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (never commit)
- Forms: react-hook-form + zod + @hookform/resolvers; dates: date-fns + react-day-picker; charts: recharts; toasts: sonner

## Commands

```bash
npm install      # required before tests — vitest is declared but may not be installed
npm run dev      # dev server at localhost:3000
npm run build    # production build
npm run lint     # eslint
npm test         # vitest run — 15 cases on the recommender
npx shadcn add <component>   # add UI components
```

## Structure

Roughly 4,100 lines of project TypeScript across 21 files, excluding `components/ui/`.

```
src/
  app/
    page.tsx                     # landing page (145)
    login/page.tsx               # sign in / sign up with role select (252)
    student/page.tsx             # student dashboard (645)
    facility-manager/page.tsx    # approval queue + attendance (454)
    admin/page.tsx               # 7-tab admin console (924)
    api/chat/route.ts            # grounded chatbot endpoint (235)
    layout.tsx, error.tsx
  components/
    admin-analytics.tsx          # charts for the analytics tab (255)
    app-shell.tsx                # shared chrome for role pages (98)
    chatbot.tsx                  # student chat widget (129)
    facility-iso.tsx             # isometric facility render (179)
    notification-bell.tsx        # unread notifications (114)
    popular-times.tsx            # per-day demand chart (119)
    ui/                          # shadcn: avatar, badge, button, calendar, card,
                                 # dialog, dropdown-menu, input, select, sheet,
                                 # table, tabs, textarea
  lib/
    recommend.ts                 # slot scoring + updateWeights (118)
    recommend.test.ts            # 15 vitest cases (150)
    types.ts                     # shared row types (172)
    evaluation.ts                # Phase 2 metric logging (27)
    profile.ts                   # current user + role (38)
    supabase.ts                  # client singleton
    utils.ts                     # cn() helper
```

## Conventions

- Three user roles, each with its own route: **student**, **facility-manager**, **admin**
- Use existing shadcn components in `src/components/ui/` before adding new ones; add via `npx shadcn add`, don't hand-write
- Prefer hugeicons for icons (project's configured icon library)
- All data access goes through the Supabase client; no other backend
- Keep role dashboards as client components where interactivity is needed; use server components by default otherwise
- UI: brand is "Campus Reserve" (crimson theme, tokens in `globals.css`); wrap role pages in `AppShell` from `src/components/app-shell.tsx`; no hard-coded colors — see `docs/ui-design.md`

## Current state (verified against source, Sept 2026)

Working prototype, roughly 30% of the full scope. Runs against a live Supabase
database.

**Database** — 12 tables (`profiles`, `facility_categories`, `facilities`,
`facility_rules`, `facility_managers`, `reservations`, `equipment`,
`reservation_equipment`, `notifications`, `activity_log`, `lost_and_found`,
`evaluation_events`), 2 views (`facilities_full`, `effective_facility_rules`),
12 functions, 9 triggers, 47 RLS policies. Run `supabase/setup-all.sql` in the
Supabase SQL editor before the app works; the `upgrade-*.sql` files are
incremental migrations already folded into it.

The no-overlap guarantee:

```sql
exclude using gist (
  facility_id with =,
  tstzrange(start_time, end_time) with &&
) where (status in ('pending','approved'))
```

The `where` clause is deliberate — cancelled and rejected bookings release
the slot.

**Student** — browse venues then facilities with a live in-use badge; request a
booking (date, start, duration, party size, purpose); rejection carries a
reason; ranked alternative slots with explanations when the time is taken;
equipment reservation checked against stock; popular times per day; cancel
under the notice rule; chatbot with per-answer rating; approval notifications.

**Facility manager** — approval queue scoped to assigned facilities only;
approve/reject; today's and upcoming bookings; attendance marked as checked-in
or no-show; equipment stock.

**Admin** — 7 tabs (overview, analytics, users, facilities, approvals,
equipment, records). Create categories carrying all six rules; facilities
inherit and may override any single value; assign managers; change user roles;
analytics dashboard; lost and found; append-only activity log written by 7
triggers.

**Key files**

- `src/lib/time.ts` — all booking logic runs in Malaysia time (fixed UTC+8)
  via these helpers, never `getHours()`/`toISOString().slice(0,10)`, so the
  same code gives the same answer in the browser and on a UTC server.
- `src/lib/recommend.ts` — `recommendSlots` (one facility, one day, all rules
  incl. min duration), `recommendAcross` (every facility in the same category,
  then up to 2 days ahead if the day is full everywhere), `learnPeakHours`
  (busiest quartile of booked minutes per Malaysia hour, defaults 12–14/17–20
  below 30 bookings). Baseline score `S = w₁T + w₂C + w₃U`; every slot carries
  its reasons and a feature vector `[1,T,C,U,S,A]`. `updateWeights` is the
  baseline learner (multiplicative, renormalised), kept for comparison.
- `src/lib/bandit.ts` — per-student LinUCB ranking the recommender's
  candidates; prior centred on the baseline weights, Sherman–Morrison updates,
  cascade feedback (accepted = 1, slots shown above it = 0). Stored in
  `profiles.rec_bandit`.
- `src/lib/chat-logic.ts` — pure chatbot logic: intent parsing
  (availability, rules, list, mine, other), real facility-name matching,
  follow-up context, free windows by part of day.
- `src/app/api/chat/route.ts` — grounded chatbot. Queries run under the
  caller's RLS context; answers are phrased from returned rows only. Answers
  "my bookings", lists real free windows, checks a specific time, and calls
  `recommendAcross` + the student's bandit for alternatives when busy. Rate
  limited 20/min. Provider-agnostic via `AI_PROVIDER`/`AI_API_KEY` (gemini |
  openai | groq); deterministic offline mode with no key.
- `src/lib/evaluation.ts` — Phase 2 instrumentation: `rec_shown`,
  `rec_accepted` (rank, plus whether it was another facility / another day),
  `chat_feedback`.
- Tests: `time`, `recommend`, `bandit`, `chat-logic` — 68 vitest cases, all
  with explicit `+08:00` times so they pass in any machine timezone.

**Migrations to run** (Supabase SQL editor, after `setup-all.sql`), in order:
`upgrade-recommender.sql` (adds `profiles.rec_bandit`),
`fix-role-escalation.sql` (stops a student setting their own `role`),
`upgrade-auto-release.sql` (check-in grace rule + `release_no_shows()` on
pg_cron every minute; discussion rooms default to 10 min; also fixes UTC times
in booking notifications), `upgrade-room-access.sql` (`room_devices`,
`room_events`, `door_facilities` view, `register_room_device()`),
`upgrade-room-reports.sql` (room feedback), `upgrade-room-commands.sql` (remote control),
`upgrade-room-end.sql` (`extend_booking()` +30 min within close time / max
length / next booking; `remind_booking_end()` on pg_cron; new room event
kinds `booking_ended`, `overstay`, `extended`, `extend_denied`).
Until they are run, the app still works without those features.

**Smart room (library demo)** — `src/lib/room-logic.ts` (door codes derived as
HMAC-SHA256(secret, booking id) → 6 digits, never stored; code windows;
room status), `src/lib/room-server.ts` (service-role client, device auth),
endpoints `api/room/unlock`, `api/room/status`, `api/room/event` (device
reports presence/lights/AC/door/reminders; `released_early` ends a checked-in
booking early via `earlyReleaseDecision`), `api/bookings/code`. Vercel needs
`SUPABASE_SERVICE_ROLE_KEY` and `ROOM_CODE_SECRET`. Firmware in
`firmware/door-wokwi/` (one sketch: door + room automation; PlatformIO build
for the Wokwi VS Code extension; setup and test steps in its README). Presence
is filtered on-device (IIR a=0.1, hysteresis 0.35/0.08, vacancy timer, warning
blink; noise slider removed); lights follow presence, AC follows bookings (pre-cool 5 min) and
presence. Rooms with a door have no in-app check-in: the keypad is the
check-in. End of booking: phone reminder at 10 min (pg_cron), OLED countdown,
extend via keypad (A + code + #, `api/room/extend`) or app
(`api/bookings/extend`), "time's up" + AC off, overstay reported after
vacancy+warning+1 min and managers notified once (`overstayBooking`).
Ambient light: 16-LED NeoPixel ring on GPIO 12, last 10 min of a checked-in
booking, blue = extension possible / red = not (from `can_extend` in
`api/room/status`, computed by `extensionAvailability` with the same rules as
`extend_booking()`), LEDs count down, pulses in the final minute.
Remote control over MQTT: `supabase/upgrade-room-commands.sql` (`room_commands`,
staff read-only, only the API writes, activity log trigger); `POST
api/room/command` (admin or the room's manager; validates, saves, signs with
HMAC-SHA256 keyed by the device's `key_hash`, publishes to
`campus/rooms/<device>/cmd` over TLS via `lib/mqtt-publish.ts`, env
`MQTT_URL`/`MQTT_USERNAME`/`MQTT_PASSWORD`, HiveMQ Cloud); `POST api/room/ack`
(device confirms → done/failed); `api/room/status` also returns pending signed
commands (HTTP fallback) and the lockdown state. Commands: unlock, lights/ac
on/off/auto for N min, door message, lockdown. Pure logic
`lib/room-commands.ts` (+ client-safe `room-commands-shared.ts`), tested.
Firmware: PubSubClient TLS, verifies HMAC (mbedtls), expiry (NTP), dedupe,
acts, acks. UI `components/room-controls.tsx` (facility detail + manager room
panel). Verified end to end with a local broker and a separate verifier.
Energy: `src/lib/energy.ts` (E = P×t; lights 0.12 kW, AC 1.1 kW, CO₂
0.585 kg/kWh — assumptions) compares a conventional room (on for every booked
minute incl. no-shows/early leavers) with the device's real on-time; shown in
Admin → Smart room and on the facility manager dashboard for managers of that room (`components/room-panel.tsx`; managers read devices through the `room_devices_visible` view). `supabase/seed-room-energy.sql` seeds a week of realistic readings for the door's room (tagged, removed by the seed remove script). **3D digital twin** — Admin → Smart room is a grid of one panel per room
(Facilities tab stays the management page); clicking opens `components/facility-detail.tsx`: a three.js twin
(`lib/twin-scene.ts`, framework-free; `components/room-twin.tsx` wraps it,
loaded with `next/dynamic` ssr:false) plus live readings, countdown, today's
bookings, room log and the 7-day energy chart. Twin state
comes from `lib/twin-state.ts` (`twinReading`: last on/off event per output,
unlock shown 10 s, offline after 2 min; rooms without a device are inferred
from bookings and labelled so). Polls events every 5 s, energy every 60 s.
Scenes by type via `lib/scene.ts` (room, net_court, court, hall, pool, gym,
generic). Needs `three` (run `npm install`). Tests: 106 vitest cases incl.
`energy.test.ts`, `twin-state.test.ts`.

**Room feedback** — `supabase/upgrade-room-reports.sql`: `room_reports`
(category, urgency, description, status open → in_progress → resolved /
dismissed, staff note). RLS: students insert their own (optionally tied to
their own booking) and see only their own; a room's managers and admins see
and update; a guard trigger lets staff change only status/note, stamps
`handled_by`, and limits 5 reports/hour. Triggers notify the room's managers
(admins if none) on a new report and the student on each status change, and
write the activity log. `facility_open_issues` view shows open issues per room
(category only, no names/text) for the "Known issue" badge. UI:
`components/report-problem-dialog.tsx` (student, from a booking within 15 min
before start to 24 h after end), `components/room-reports.tsx` (inbox on the
manager dashboard, follows the room filter; admin "Feedback" tab). Pure rules
in `lib/reports.ts` (tested). 23 database checks passed on Postgres 17.

**Test data** — `supabase/seed-test-data.sql` (re-runnable; dates relative
to today in Malaysia time; needs the three demo accounts to exist first) and
`supabase/seed-test-data-remove.sql`. Everything seeded is tagged `[seed]` or
`@seed.campus`. Verified on Postgres 17 against the real migrations. Walkthrough
in `docs/TESTING-GUIDE.txt`. Remove the seed before any real Phase 2 testing.

**Not built yet** — batch allocation mode, no-show probability model, release
rule. See `docs/engineering-depth-plan.md`. Hardware occupancy sensor is
drafted in `firmware/` + `api/sensor` + `upgrade-occupancy.sql` but parked.

**Known issues** — `vitest` is in `devDependencies` but may be absent from
`node_modules`; run `npm install` before `npm test`. The student and
facility-manager pages lint clean (time-dependent UI uses a 30 s `nowMs`
clock, never `Date.now()` during render).

Phase 1 report and ethics docs live in `report/`; figures are regenerable and
the generator scripts sit in the session outputs folder.
