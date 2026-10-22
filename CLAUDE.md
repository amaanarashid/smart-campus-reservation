@AGENTS.md

# Smart Campus Reservation — Project Guide

Final Year Project (FYP) for APU: **Smart Campus Facility Reservation System with AI-Assisted Recommendations** — one booking system for every kind of campus facility, with per-facility rules enforced by the system, AI slot recommendations, a grounded AI chatbot, admin analytics, and a smart-room extension (ESP32 in Wokwi, 3D digital twin, MQTT remote control). See `FYP.md` for the original scope.

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

## Working rules

- `report/TP073098_Phase1_FYP.docx` is final: never write to it. Don't edit anything in `report/` unless asked.
- Never commit or print `.env.local`. Secrets (`SUPABASE_SERVICE_ROLE_KEY`, `ROOM_CODE_SECRET`, `MQTT_PASSWORD`) live only in Vercel and `.env.local` — never in `NEXT_PUBLIC_*`, the sketch's git history, or GitHub.
- Be honest in slides/docs about what is built vs tested vs planned (see "Status" below).
- The user prefers short, plain-English answers.

## Tech stack

- **Next.js 16.2.9** (App Router, `src/`) — newer than training data; read `node_modules/next/dist/docs/` first. Route params are Promises; don't use `export const dynamic`.
- **React 19.2** with React Compiler — no manual `useMemo`/`useCallback`; lint enforces purity (no `Date.now()` during render — use a `nowMs` state clock set in effects).
- **TypeScript** strict, alias `@/*` → `src/*`. **Tailwind v4** (config in `src/app/globals.css`). **shadcn/ui** (`radix-mira`; hugeicons configured, lucide-react used widely).
- **Supabase** (Postgres + RLS + pg_cron + Realtime). Client `src/lib/supabase.ts` stores the session in **sessionStorage with a per-tab key** — each tab has its own login (student/manager/admin side by side); sign-out is `scope: "local"`.
- Charts recharts · 3D three.js · MQTT `mqtt` (server) / PubSubClient (ESP32) · toasts sonner.
- Deployed on Vercel: https://smart-campus-reservation.vercel.app (set Function Region next to Supabase).

## Commands

```bash
npm install      # needed after pulls (three, mqtt, vitest)
npm run dev      # localhost:3000
npm run build
npm run lint
npm test         # vitest — 141 cases, all with explicit +08:00 times
npx tsx scripts/simulate-recommender.ts && python scripts/plot-simulation.py   # recommender simulation → docs/simulation/
```

## Structure (≈10,700 lines of TS outside components/ui)

```
src/app/
  page.tsx, login/page.tsx (redirects signed-in users; router.replace)
  student/page.tsx           booking flow, suggestions, my bookings, door code, extend, report a problem
  facility-manager/page.tsx  room cards + timelines, approval queue, schedule, room problems, smart room, equipment, lost & found
  admin/page.tsx             tabs: overview, analytics, smart room (grid → 3D detail), users, facilities, approvals, feedback, equipment, records
  api/chat                   grounded chatbot (English + Bahasa Melayu, replies in the user's language)
  api/bookings/{code,extend} student door code / +30 min
  api/room/{status,unlock,event,extend,command,ack}   smart-room device + remote control
  api/sensor                 PARKED (old occupancy draft)
src/components/
  app-shell, campus-icon, notification-bell, chatbot, facility-iso (2.5D art), popular-times, admin-analytics, admin-facilities (venues → facilities → detail), facility-wizards (New facility / Add rooms, step-by-step), facility-form (shared rule fields), venue-art (2D venue drawings), smart-room-connect (connect room / re-key)
  facility-detail (room page: 3D twin, live tiles, countdown, today, log, remote control, energy chart)
  room-twin (three.js wrapper, next/dynamic), room-panel (manager smart-room section), room-controls (MQTT panel)
  report-problem-dialog, room-reports (feedback inbox)
src/lib/
  time.ts            Malaysia time (UTC+8) helpers — always use these, never getHours()/toISOString().slice(0,10)
  recommend.ts       slot scoring S = w₁T + w₂C + w₃U, recommendAcross, learnPeakHours, updateWeights (baseline)
  bandit.ts          per-student LinUCB, Sherman–Morrison, cascade feedback (profiles.rec_bandit)
  chat-logic.ts      intent parsing / facility matching / free windows (understands Malay dates, times, facility words)
  chat-lang.ts       language detection (word lists), Malay time/day formats, fixed replies in EN/MS
  room-logic.ts      HMAC door codes (never stored), roomStatus, earlyRelease, overstayBooking, extensionAvailability
  room-server.ts     service-role client + device auth (server only)
  room-commands(.ts|-shared.ts)  validate / sign / verify remote commands; mqtt-publish.ts
  energy.ts          E = P×t; conventional vs smart room (lights 0.12 kW, AC 1.1 kW, CO₂ 0.585 kg/kWh — assumptions)
  twin-scene.ts      framework-free three.js twin; twin-state.ts (events → twin state); scene.ts (type → scene)
  facility-setup.ts  wizard helpers: presets, campus-unique slugs, next room names, typical capacity, rule checks
  busy.ts            free/busy reads (reservation_busy view, fallback to table)
  reports.ts         room-feedback rules; use-auto-refresh.ts (poll while visible + on focus); evaluation.ts; types.ts
firmware/door-wokwi/  sketch.ino + diagram.json + platformio.ini (Wokwi VS Code extension) + README (setup & test steps)
supabase/             setup-all.sql + upgrade-*.sql migrations, seeds
scripts/              simulate-recommender.ts, plot-simulation.py
docs/                 TESTING-GUIDE.txt, ui-design.md, engineering-depth-plan.md, simulation/, research-papers.md
presentation/         FYP-Progress-Presentation.pptx, DEMO-STEPS.txt, midpoint deck
```

## Database

Run in the Supabase SQL editor, in this order (all re-runnable):
`setup-all.sql` → `upgrade-recommender.sql` → `fix-role-escalation.sql` → `upgrade-auto-release.sql` (check-in grace, `release_no_shows()` pg_cron) → `upgrade-room-access.sql` (`room_devices`, `room_events`, `register_room_device()`) → `upgrade-room-end.sql` (`extend_booking()`, `remind_booking_end()` pg_cron, `room_devices_visible`) → `upgrade-room-reports.sql` (+ `fix-room-reports-insert.sql`) → `upgrade-room-commands.sql` → `upgrade-realtime.sql` → `upgrade-room-connect.sql` (`room_devices.connection` wokwi/mqtt) → `upgrade-private-bookings.sql` (private reservations/profiles/lost & found, `reservation_busy` view, `is_staff()`) → `upgrade-booking-rules.sql` (`enforce_booking_rules()` trigger).

- Privacy (objective 4): `reservations` readable only by the booker, admins and that room's managers; everyone else (students, recommender, popular times, chatbot) reads `reservation_busy` (id, facility_id, start/end, status — no user, purpose or party size) via `busyQuery()` in `src/lib/busy.ts` (falls back to the table until the migration runs). `profiles` and `lost_and_found` readable by own row / staff only. 23 DB checks in `outputs/pgtest-private.mjs`.
- Booking rules (objective 2): BEFORE INSERT/UPDATE trigger `enforce_booking_rules()` on `reservations` checks every direct request from role `authenticated`: insert = active room, future start, min/max length, advance window, capacity, opening hours same day (MYT); status forced from auto_approve; attendance fields cleared. Update by the booker = only cancel (before start, with notice; reason 'user') or check in (15 min before → end; server time); anything else refused. Admins + the room's managers unrestricted; admins may insert outside rules. Trusted code (SECURITY DEFINER functions, service role, cron, SQL editor) is skipped because `current_user` ≠ authenticated — keep new trusted functions SECURITY DEFINER. Messages match the student page wording. 23 DB checks in `outputs/pgtest-rules.mjs`.
- No-overlap guarantee: `exclude using gist (facility_id with =, tstzrange(start_time,end_time) with &&) where (status in ('pending','approved'))`.
- Supabase grants EXECUTE on new functions to anon/authenticated — always `revoke ... from public, anon, authenticated` explicitly.
- Test data: `seed-test-data.sql` / `seed-room-energy.sql` (tagged `[seed]`, `@seed.campus`), removed by `seed-test-data-remove.sql` — remove before real user testing.
- Migrations are tested on embedded Postgres 17 with stand-ins for `auth.uid()`, roles and `cron` (harness scripts live in the session outputs folder).

## Smart room (library demo)

- Device: ESP32 in Wokwi — keypad + OLED + servo lock + door switch, OK/denied LEDs, buzzer, PIR + "people" switch, lights + AC LEDs, 16-LED NeoPixel ring (GPIO 12).
- Door code = HMAC-SHA256(`ROOM_CODE_SECRET`, booking id) → 6 digits; keypad entry checks in. 5 wrong codes → 5 min lockout.
- Presence filter on-device: IIR a=0.1 (τ≈1.9 s), hysteresis 0.35/0.08, vacancy timer, warning blink. Lights follow presence; AC follows bookings (pre-cool 5 min) + presence.
- End of booking: pg_cron reminder at 10 min, OLED countdown, ring blue = can extend / red = can't, extend via keypad (A + code + #) or app, "time's up" + AC off, overstay → managers notified once. No-shows auto-released; empty checked-in room released early.
- ESP32 polls `api/room/status` every 5 s over one kept-alive HTTPS connection; reports events to `api/room/event`.
- Remote control: `POST api/room/command` (admin or that room's manager) saves to `room_commands`, signs (HMAC-SHA256 keyed by the device `key_hash`) and publishes over MQTT TLS to `campus/rooms/<device>/cmd` (broker: **EMQX Cloud Serverless**, env `MQTT_URL`/`MQTT_USERNAME`/`MQTT_PASSWORD`); device verifies signature, 60 s expiry (NTP) and replay, acts, confirms via `api/room/ack`. HTTP fallback through the status poll. Commands: unlock, lights/AC on/off/auto for N min, door message, lockdown.
- Admin → Smart room lists only rooms with an active device. "Connect a room" (`components/smart-room-connect.tsx`) picks an existing room + Simulated (Wokwi, stored `wokwi`) or Physical (ESP32, stored `mqtt`) — both use HTTPS + MQTT — generates the key in the browser (only its SHA-256 is saved via the admin RLS policy) and shows ID/key once; per room: New device key, Disconnect (`active=false`, history kept). `register_room_device()` still works from SQL.
- 3D twin (Admin → Smart room → room): driven by `room_events` via Supabase Realtime (10 s backup poll); rooms without a device are inferred from bookings and labelled so.
- Vercel env: `SUPABASE_SERVICE_ROLE_KEY`, `ROOM_CODE_SECRET` (16+ chars, same value locally), `MQTT_*`, `AI_PROVIDER`/`AI_API_KEY`.

## Status (Oct 2026)

**Done and verified:** booking engine + rule model, DB no-overlap + DB-enforced rules, three dashboards, AI recommender (LinUCB; simulation 79.6% vs 71.1% fixed), grounded chatbot (English + Bahasa Melayu; reads only the asker's own bookings + free/busy), private bookings (23 DB checks), booking rules enforced by a DB trigger (23 DB checks), smart door + room automation (live in Wokwi), room feedback (23 DB checks), remote-control server path (local-broker end-to-end + 10 DB checks), auto-refresh, per-tab login.

**Built, needs a live run by the user:** latest firmware (countdown/extend/overstay, NeoPixel ring, MQTT, keep-alive), 3D twin live sync, energy chart with real data.

**Remaining clean-up:**
1. Re-key the demo device (its key was shared); remove seed data before the user study; delete parked `api/sensor` + `upgrade-occupancy.sql` + `firmware/occupancy-cam`.

**Then:** evaluation scripts (DS1 concurrent booking, DS4 recommender latency, chatbot question set, MQTT round-trip), user study + SUS (>68), optional no-show model / batch allocation, Phase 2 report.

## Conventions

- Roles: student, facility_manager, admin — each with its own route; pages wrap in `AppShell`.
- UI: brand "Campus Reserve", crimson theme tokens in `globals.css` with a full dark mode (`.dark` class; header toggle Light/Dark/Auto saved in localStorage, applied pre-paint in `layout.tsx`) — use tokens so both themes work, no hard-coded colours (except the WebGL palette in `twin-scene.ts`); see `docs/ui-design.md`. Motion utilities: `animate-reveal`, `stagger`, `animate-pop-in`, `skeleton`, all honour reduced motion.
- Keep logic pure and tested in `src/lib/*` (with a `*.test.ts`), I/O in routes/components.
- Navigation after auth uses `router.replace` (no login page left in history).
