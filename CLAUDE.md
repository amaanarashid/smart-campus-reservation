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
npm test         # vitest — 258 cases, all with explicit +08:00 times
npx tsx scripts/simulate-recommender.ts && python scripts/plot-simulation.py   # recommender simulation → docs/simulation/
npx tsx scripts/eval/recommender-latency.ts && npx tsx scripts/eval/chatbot-eval.ts   # objective 5 → docs/evaluation/
cd scripts/eval && npm install && node concurrency.mjs   # DS1 concurrent-booking stress test (local Postgres 17)
npx tsx scripts/eval/noshow-db.ts      # no-show DB checks + TS/SQL parity (needs scripts/eval npm install)
npx tsx scripts/eval/noshow-simulate.ts && python scripts/plot-noshow.py   # SIMULATED no-show evaluation
npx tsx scripts/eval/noshow-train.ts --dry-run   # train on live data (.env.local service role); drop --dry-run to store
npx tsx scripts/eval/klm.ts           # KLM-GOMS task times -> docs/evaluation/usability/klm.*
cd scripts/eval && npm run audit      # axe WCAG 2.1 AA audit of 22 screens (mock backend + built app; see docs/evaluation/usability/README.md)
npx tsx scripts/eval/mqtt-accounts-check.ts   # per-device EMQX logins against the real broker (.env.local MQTT_* + EMQX_*)
cd firmware/door-wokwi && pio run -e esp32     # firmware: esp32 = local Wokwi, wokwi-web / board / cam publish to public/firmware/
```

## Structure (≈17,300 lines of TS outside components/ui)

```
src/app/
  page.tsx, login/page.tsx (redirects signed-in users; router.replace; Forgot password), reset-password/page.tsx
  student/page.tsx           tabs Book / My bookings: place → room → time (booking-ui.tsx, lib/booking-form.ts), suggestions, door code, extend, report a problem
  facility-manager/page.tsx  room cards + timelines, approval queue, schedule, room problems, smart room, equipment, lost & found
  admin/page.tsx             tabs: overview, analytics, smart room (grid → 3D detail), users, facilities, approvals, feedback, equipment, records
  api/chat                   grounded chatbot (English + Bahasa Melayu, replies in the user's language)
  api/bookings/{code,extend} student door code / +30 min
  api/noshow/retrain         admin-only: retrain the no-show model (service role)
  api/room/{pair,status,unlock,event,extend,command,ack}   smart-room device + remote control
  api/room/wokwi             admin: Wokwi zip made for a room (key + setup in the firmware, circuit for the chosen parts)
  api/room/firmware(+/[token]/[file])   admin: signed 15-min install link for a real board; ESP Web Tools reads the parts from it
  api/room/disconnect        admin: switch a device off (+ delete its own EMQX login if the API is set up)
src/components/
  app-shell, campus-icon, notification-bell, chatbot, facility-iso (2.5D art), popular-times, admin-analytics, admin-facilities (venues → facilities → detail), facility-wizards (New facility / Add rooms, step-by-step), facility-form (shared rule fields), venue-art (2D venue drawings), confirm-dialog (useConfirm(), never window.confirm)
  smart-room-connect (Connect a room: room → board → parts → download/install; "Already have a code?" path), parts-editor (parts + pins + checks, shared), room-setup (room page: what is wired, what works, Learn the AC remote), firmware-install-button (ESP Web Tools from unpkg)
  facility-detail (room page: 3D twin, live tiles, countdown, today, log, remote control, energy chart)
  room-twin (three.js wrapper, next/dynamic), room-panel (manager smart-room section), room-controls (MQTT panel)
  report-problem-dialog, room-reports (feedback inbox)
  noshow-badge (manager Low/Medium/High risk + reasons tooltip), noshow-card (admin Analytics: model, metrics, calibration, Retrain)
src/lib/
  time.ts            Malaysia time (UTC+8) helpers — always use these, never getHours()/toISOString().slice(0,10)
  recommend.ts       slot scoring S = w₁T + w₂C + w₃U, recommendAcross, learnPeakHours, updateWeights (baseline)
  bandit.ts          per-student LinUCB, Sherman–Morrison, cascade feedback (profiles.rec_bandit)
  noshow.ts          no-show prediction: features (history cut at start − 24 h, no leakage), L2 logistic regression, baseline fallback, explain(), AUC/Brier/log loss/calibration, time-split trainAndEvaluate; noshow-server.ts loads data + stores model rows
  chat-logic.ts      intent parsing / facility matching / free windows (understands Malay dates, times, facility words)
  chat-lang.ts       language detection (word lists), Malay time/day formats, fixed replies in EN/MS
  room-logic.ts      HMAC door codes (never stored), roomStatus, earlyRelease, overstayBooking, extensionAvailability
  room-server.ts     service-role client + device auth (server only)
  room-commands(.ts|-shared.ts)  validate / sign / verify remote commands; COMMAND_NEEDS = which part a command needs
  mqtt-publish.ts    one-shot MQTT 5 publish; reports refused (135) / nobody listening (16) instead of "sent"
  mqtt-accounts.ts   optional per-device EMQX logins via the deployment API (room-<id>, own topic only)
  room-config.ts     boards (free pins), parts, kits, checkConfig, capabilities(), parseConfig/parseReport, applyIrLearned
  esp-image.ts       write key / setup slots into an ESP32 app image (checksum + SHA-256 redone), mergeFlash
  firmware-build.ts  read public/firmware/<board> from disk (outputFileTracingIncludes), personalise, connectRoom
  firmware-link.ts   signed install links; device key derived from the link
  wokwi-diagram.ts   diagram.json from a setup; zip.ts (store-only zip); usb-pair-code.ts (Web Serial)
  energy.ts          E = P×t; conventional vs smart room (lights 0.12 kW, AC 1.1 kW, CO₂ 0.585 kg/kWh — assumptions)
  twin-scene.ts      framework-free three.js twin; twin-state.ts (events → twin state); scene.ts (type → scene)
  facility-setup.ts  wizard helpers: presets, campus-unique slugs, next room names, typical capacity, rule checks
  busy.ts            free/busy reads (reservation_busy view, fallback to table)
  access.ts          who can book (member types) + fair-use limit messages (same wording as the DB)
  sus.ts             SUS scoring + summary for the user study
  klm.ts             KLM-GOMS operators + task-time maths (usability without participants)
  reports.ts         room-feedback rules; use-auto-refresh.ts (poll while visible + on focus); evaluation.ts; types.ts
firmware/door-wokwi/  one firmware for every board: room.h, board/config/pair/net/display/door/room/ac/sensors/remote .cpp + diagram.json + platformio.ini (esp32, wokwi-web, board, cam) + publish_web.py + README
public/firmware/      published builds per board (wokwi, esp32-devkit, esp32-cam) + ESP Web Tools manifests; no secrets (key/setup slots empty)
supabase/             setup-all.sql + upgrade-*.sql migrations, seeds
scripts/              simulate-recommender.ts, plot-simulation.py, plot-noshow.py, eval/ (objective 5: concurrency.mjs + pg-harness.mjs, mqtt-rtt.ts, chatbot-eval.ts, recommender-latency.ts, sus.ts, noshow-db.ts, noshow-train.ts, noshow-simulate.ts, klm.ts, live-metrics.sql, ui/ = mock-supabase.mjs + audit.mjs)
docs/                 TESTING-GUIDE.txt, ui-design.md, engineering-depth-plan.md, simulation/, evaluation/ (README = objective 5 results, usability/ = axe + heuristic review + walkthrough + KLM, user-study.md), research-papers.md
presentation/         FYP-Progress-Presentation.pptx, DEMO-STEPS.txt, midpoint deck
```

## Database

Run in the Supabase SQL editor, in this order (all re-runnable):
`setup-all.sql` → `upgrade-recommender.sql` → `fix-role-escalation.sql` → `upgrade-auto-release.sql` (check-in grace, `release_no_shows()` pg_cron) → `upgrade-room-access.sql` (`room_devices`, `room_events`, `register_room_device()`) → `upgrade-room-end.sql` (`extend_booking()`, `remind_booking_end()` pg_cron, `room_devices_visible`) → `upgrade-room-reports.sql` (+ `fix-room-reports-insert.sql`) → `upgrade-room-commands.sql` → `upgrade-realtime.sql` → `upgrade-room-connect.sql` (`room_devices.connection` wokwi/mqtt) → `upgrade-private-bookings.sql` (private reservations/profiles/lost & found, `reservation_busy` view, `is_staff()`) → `upgrade-booking-rules.sql` (`enforce_booking_rules()` trigger) → `upgrade-access-limits.sql` (member types, who can book, fair-use limits) → `upgrade-noshow.sql` (`noshow_model`, `booking_risk`, `score_upcoming_bookings()` pg_cron every 10 min) → `upgrade-room-pairing.sql` (`room_pairings`, `room_pair_poll()`, `claim_room_pairing()`) → `upgrade-room-config.sql` (`room_devices.board/config/config_version/report`, `peek_room_pairing()`, `set_room_config()`, `door_facilities` = keypad rooms only, `ir_learn` command, new event kinds).

- Privacy (objective 4): `reservations` readable only by the booker, admins and that room's managers; everyone else (students, recommender, popular times, chatbot) reads `reservation_busy` (id, facility_id, start/end, status — no user, purpose or party size) via `busyQuery()` in `src/lib/busy.ts` (falls back to the table until the migration runs). `profiles` and `lost_and_found` readable by own row / staff only. 23 DB checks in `outputs/pgtest-private.mjs`.
- Booking rules (objective 2): BEFORE INSERT/UPDATE trigger `enforce_booking_rules()` on `reservations` checks every direct request from role `authenticated`: insert = active room, future start, min/max length, advance window, capacity, opening hours same day (MYT); status forced from auto_approve; attendance fields cleared. Update by the booker = only cancel (before start, with notice; reason 'user') or check in (15 min before → end; server time); anything else refused. Admins + the room's managers unrestricted; admins may insert outside rules. Trusted code (SECURITY DEFINER functions, service role, cron, SQL editor) is skipped because `current_user` ≠ authenticated — keep new trusted functions SECURITY DEFINER. Messages match the student page wording. 23 DB checks in `outputs/pgtest-rules.mjs`.
- Access + fair use (proposal feature 2): `profiles.member_type` (undergraduate/postgraduate/staff; self sign-up forced to undergraduate, only admins change it — Users tab); `facility_categories.allowed_members`, `max_upcoming`, `max_hours_week` (NULL = no limit; default off). Checked in the booking trigger via `check_access_and_limits()` with a per-user advisory lock; the trigger also takes a per-facility advisory lock on INSERT (removes deadlocks under heavy contention, found by DS1). App mirrors the messages in `src/lib/access.ts`; recommender and chatbot only offer rooms the person may book. 16 DB checks in `outputs/pgtest-access.mjs`.
- No-show prediction (`upgrade-noshow.sql`): `noshow_model` (admins read; written by service role only; newest version is active, none = baseline) and `booking_risk` (admins + that room's managers; students never see a score). `score_upcoming_bookings()` scores pending/approved bookings in the next 24 h with the same maths as `src/lib/noshow.ts` and sends ONE "Still coming?" note (type `noshow_check`) for approved, not-checked-in bookings at/over the threshold starting in 15–70 min. Never blocks, cancels or overbooks. `noshow_features/noshow_score/noshow_reason` are SECURITY DEFINER, revoked. Change a feature in both places — `scripts/eval/noshow-db.ts` (33 checks) fails on any TS/SQL difference > 1e-6.
- No-overlap guarantee: `exclude using gist (facility_id with =, tstzrange(start_time,end_time) with &&) where (status in ('pending','approved'))`.
- Supabase grants EXECUTE on new functions to anon/authenticated — always `revoke ... from public, anon, authenticated` explicitly.
- Test data: `seed-test-data.sql` / `seed-room-energy.sql` (tagged `[seed]`, `@seed.campus`), removed by `seed-test-data-remove.sql` — remove before real user testing.
- Migrations are tested on embedded Postgres 17 with stand-ins for `auth.uid()`, roles and `cron` (harness scripts live in the session outputs folder).

## Smart room (library demo)

- **One firmware, three boards** (`firmware/door-wokwi`, Arduino core 2.0.17, `min_spiffs` partitions): Wokwi door kit, ESP32 DevKit, ESP32-CAM (AI-Thinker; free pins 2, 4, 12-15, 33). The board is picked at build time; which **parts** a room has and on which pins comes from the server (`room_devices.config`): lock + door switch, 4x4 keypad, SSD1306 screen, green/red LEDs, buzzer, PIR (+ Wokwi "people" switch), lights, air-con (relay, or IR via IRremoteESP8266), DHT22, NeoPixel ring, status LED. Kits: Door kit, Room controller. Pin rules live in both `lib/room-config.ts` and `board.cpp`/`config.cpp` — change both. The device reports firmware, parts ok/missing/bad_pins and I2C devices; a new config version (status poll) → it saves the setup and restarts.
- **Connect a room** (`components/smart-room-connect.tsx`): room → board → parts → firmware made for the room. One compiled firmware per board carries a 64-byte key slot and a 1 KB setup slot (`pair.cpp`); the server writes both and redoes the image checksum + SHA-256 (`lib/esp-image.ts`) — no compiling. Wokwi: `api/room/wokwi` zip (merged flash image + circuit drawn for the parts by `lib/wokwi-diagram.ts`; the door kit reproduces `diagram.json`). Real boards: `api/room/firmware` → signed 15-min link (`lib/firmware-link.ts`, key derived from the link, never stored) → ESP Web Tools. First start uses the baked setup, then the server's. Each download/install replaces the room's key (old copies stop working); the zips are credentials (`campus-*.zip` and `firmware/campus-*/` are git-ignored). Fallback: plain firmware shows a 6-digit code (screen, or USB via Web Serial `lib/usb-pair-code.ts`) → `peek_room_pairing()` + `claim_room_pairing(code, room, config)`. Replace device keeps the row and history; Disconnect via `api/room/disconnect`. `register_room_device()` still works from SQL. 34 DB checks in `scripts/eval/pairing-db.mjs` (pairing) + 32 for `upgrade-room-config.sql`.
- **The device always talks to the live site** (`API_BASE` in `net.cpp` = smart-campus-reservation.vercel.app), so its MQTT login comes from Vercel's Production env, not `.env.local`.
- **App follows the setup:** `capabilities()` hides remote controls the room lacks; the command API refuses them (`COMMAND_NEEDS`); door codes and door check-in only for rooms with lock + keypad (`door_facilities`), others check in from the app. Room setup card on the room page: parts, pins, AC make/temp/mode/fan, Learn.
- **IR air-con:** `ir_learn` command → device recognises the make from one press of the AC's own remote (or records raw ON and OFF) → `ir_learned` event saves it. IR is one-way: with a DHT22, no cooling after 6 min → resend; after 12 min `ac_no_response` notifies staff. In Wokwi the IR remote is not an AC remote, so Learn records raw there.
- Door code = HMAC-SHA256(`ROOM_CODE_SECRET`, booking id) → 6 digits; keypad entry checks in. 5 wrong codes → 5 min lockout.
- Presence filter on-device: IIR a=0.1 (τ≈1.9 s), hysteresis 0.35/0.08, vacancy timer, warning blink. Lights follow presence (or the booking without a motion sensor); AC follows bookings (pre-cool 5 min) + presence. CSV log for the report: `LOG_SIGNAL = true` in `room.cpp` (off by default).
- End of booking: pg_cron reminder at 10 min, OLED countdown, ring blue = can extend / red = can't, extend via keypad (A + code + #) or app, "time's up" + AC off, overstay → managers notified once. No-shows auto-released; empty checked-in room released early.
- ESP32 polls `api/room/status` every 5 s over one kept-alive HTTPS connection; reports events to `api/room/event`.
- **Remote control:** `POST api/room/command` (admin or that room's manager) saves to `room_commands`, signs (HMAC-SHA256 keyed by the device `key_hash`) and publishes over MQTT TLS to `campus/rooms/<device>/cmd`; device verifies signature, 60 s expiry (NTP) and replay, acts, confirms via `api/room/ack`. HTTP fallback through the status poll. Commands: unlock, lights/AC on/off/auto for N min, door message, lockdown, ir_learn. Publish is MQTT 5, so a refused (135) or unheard (16) publish shows as a warning in the app.
- **Broker: EMQX Cloud Serverless** `mqtts://f16c11e6.ala.asia-southeast1.emqxsl.com:8883`. Two logins: `campus-server` (publish `campus/rooms/#`, env `MQTT_USERNAME`/`MQTT_PASSWORD`) and `campus-device` (subscribe `campus/rooms/#`, env `MQTT_DEVICE_USERNAME`/`MQTT_DEVICE_PASSWORD`, handed to devices by `api/room/pair`). Rooms stay apart by topic + per-device signing. Per-device logins (`lib/mqtt-accounts.ts`) are built but OFF: the EMQX deployment API answers 403 to every request (even without a key) — leave `EMQX_*` unset in Vercel until EMQX enables it.
- Admin → Smart room lists only rooms with an active device (card shows the board). 3D twin (room page): driven by `room_events` via Supabase Realtime (10 s backup poll); rooms without a device are inferred from bookings and labelled so.
- Vercel env: `SUPABASE_SERVICE_ROLE_KEY`, `ROOM_CODE_SECRET` (16+ chars, same value locally), `MQTT_URL`, `MQTT_USERNAME`/`MQTT_PASSWORD`, `MQTT_DEVICE_USERNAME`/`MQTT_DEVICE_PASSWORD`, `AI_PROVIDER`/`AI_API_KEY`. Change env → redeploy.

## Status (Nov 2026)

**Done and verified:** booking engine + rule model, DB no-overlap + DB-enforced rules, who-can-book + fair-use limits, three dashboards, AI recommender (LinUCB; simulation 79.6% vs 71.1% fixed; robust over 10 seeds, 4 demand levels, skimming; weak spot: ~10 attempts after a preference change; `--part=main|seeds|context` splits the run), grounded chatbot (English + Bahasa Melayu; reads only the asker's own bookings + free/busy), private bookings, smart door + room automation (live in Wokwi), room feedback, remote control over MQTT end to end (live: device on `campus-device`, Nov 2026), venue-first facilities UI with wizards, forgot password, auto-refresh, per-tab login. No-show prediction (logistic + baseline, reminders, manager badge, admin card + Retrain; SIMULATED test AUC 0.715 vs 0.651 student-rate baseline, ceiling 0.760). DB suites: private 23, rules 23, access 16, reports 23, commands 10, no-show 33.

**Usability (no human participants allowed, so SUS is "not tested"):** axe WCAG 2.1 A+AA 0 violations in 66 checks (22 screens x light/dark/phone; fixes: labels, contrast tokens, toasts, tabs); heuristic review fixed 6 (two-step cancel, "too late to cancel", phone stat grids, top-center toasts, equipment qty saves on blur, aria-current/pressed), 4 minor open; KLM task times in `docs/evaluation/usability/`. Keep new UI passing the audit: label every input/select trigger, use theme tokens (dark-mode `text-primary`/`text-destructive` are lightened in `globals.css`).

**Objective 5 (docs/evaluation/README.md):** DS1 0 overlaps in 2,200 simultaneous requests (p95 72 ms); DS4 recommender p95 ≤ 25 ms; chatbot known-answer 38/38 after fixes, held-out 14/16 (87.5%); MQTT lab round trip median 48 ms, forged/replayed/expired commands rejected (`scripts/eval/mqtt-rtt.ts`). Pending live data: suggestion acceptance/rank, no-show before/after, live MQTT round trip (`scripts/eval/live-metrics.sql`). SUS not tested (no participants).

**Smart-room setup (Nov 2026, on `main`):** modular firmware compiles for Wokwi, DevKit and ESP32-CAM; Wokwi download made for a room runs live (setup baked in, connects without a code). Checked: 258 vitest cases (room-config 23, esp-image, zip, wokwi-diagram, firmware-link, mqtt-accounts 7), esptool validates patched images, migration `upgrade-room-config.sql` 32 checks on Postgres 17 (stand-ins), MQTT 5 reason codes against mosquitto with ACLs. **Not yet run:** real DevKit / ESP32-CAM (parts pending), browser install from the live site, IR learn with a real AC, per-device EMQX logins (API 403).

**Built, needs a live run by the user:** 3D twin live sync, energy chart with real data, forgot-password email (add `<site>/reset-password` to Supabase Auth → URL Configuration → Redirect URLs).

**Remaining:** run all migrations (incl. `upgrade-room-config.sql`); delete the old shared MQTT login in EMQX (its password is in git history) and the unused EMQX API key; live MQTT round trip from `room_commands` (`live-metrics.sql`); remove seed data; supervisor sign-off on "no participants"; Phase 2 report. Run `upgrade-noshow.sql`, then Retrain once there are 200+ labelled bookings / 20+ no-shows (live accuracy pending). Optional: device TLS certificate checks (now `setInsecure()`), firmware updates over Wi-Fi (OTA; partitions allow it), device health (version badge, offline alert), host-run tests for firmware logic, ESP32-CAM people count, batch allocation, email notifications.

## Conventions

- Roles: student, facility_manager, admin — each with its own route; pages wrap in `AppShell`.
- UI: brand "Campus Reserve", crimson theme tokens in `globals.css` with a full dark mode (`.dark` class; header toggle Light/Dark/Auto saved in localStorage, applied pre-paint in `layout.tsx`) — use tokens so both themes work, no hard-coded colours (except the WebGL palette in `twin-scene.ts`); see `docs/ui-design.md`. Motion utilities: `animate-reveal`, `stagger`, `animate-pop-in`, `skeleton`, all honour reduced motion.
- Keep logic pure and tested in `src/lib/*` (with a `*.test.ts`), I/O in routes/components.
- Navigation after auth uses `router.replace` (no login page left in history).
