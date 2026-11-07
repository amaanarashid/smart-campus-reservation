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
```

## Structure (≈10,700 lines of TS outside components/ui)

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
src/components/
  app-shell, campus-icon, notification-bell, chatbot, facility-iso (2.5D art), popular-times, admin-analytics, admin-facilities (venues → facilities → detail), facility-wizards (New facility / Add rooms, step-by-step), facility-form (shared rule fields), venue-art (2D venue drawings), smart-room-connect (connect a room by pairing code / replace device)
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
  room-commands(.ts|-shared.ts)  validate / sign / verify remote commands; mqtt-publish.ts
  energy.ts          E = P×t; conventional vs smart room (lights 0.12 kW, AC 1.1 kW, CO₂ 0.585 kg/kWh — assumptions)
  twin-scene.ts      framework-free three.js twin; twin-state.ts (events → twin state); scene.ts (type → scene)
  facility-setup.ts  wizard helpers: presets, campus-unique slugs, next room names, typical capacity, rule checks
  busy.ts            free/busy reads (reservation_busy view, fallback to table)
  access.ts          who can book (member types) + fair-use limit messages (same wording as the DB)
  sus.ts             SUS scoring + summary for the user study
  klm.ts             KLM-GOMS operators + task-time maths (usability without participants)
  reports.ts         room-feedback rules; use-auto-refresh.ts (poll while visible + on focus); evaluation.ts; types.ts
firmware/door-wokwi/  one firmware, split into modules (room.h, config/pair/net/display/door/room/ac/sensors/remote .cpp) + diagram.json + platformio.ini (esp32, wokwi-web, board, cam) + README
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

- Device: ESP32 in Wokwi — keypad + OLED + servo lock + door switch, OK/denied LEDs, buzzer, PIR + "people" switch, lights + AC LEDs, 16-LED NeoPixel ring (GPIO 12).
- Door code = HMAC-SHA256(`ROOM_CODE_SECRET`, booking id) → 6 digits; keypad entry checks in. 5 wrong codes → 5 min lockout.
- Presence filter on-device: IIR a=0.1 (τ≈1.9 s), hysteresis 0.35/0.08, vacancy timer, warning blink. Lights follow presence; AC follows bookings (pre-cool 5 min) + presence.
- End of booking: pg_cron reminder at 10 min, OLED countdown, ring blue = can extend / red = can't, extend via keypad (A + code + #) or app, "time's up" + AC off, overstay → managers notified once. No-shows auto-released; empty checked-in room released early.
- ESP32 polls `api/room/status` every 5 s over one kept-alive HTTPS connection; reports events to `api/room/event`.
- Remote control: `POST api/room/command` (admin or that room's manager) saves to `room_commands`, signs (HMAC-SHA256 keyed by the device `key_hash`) and publishes over MQTT TLS to `campus/rooms/<device>/cmd` (broker: **EMQX Cloud Serverless**, env `MQTT_URL`/`MQTT_USERNAME`/`MQTT_PASSWORD`); device verifies signature, 60 s expiry (NTP) and replay, acts, confirms via `api/room/ack`. HTTP fallback through the status poll. Commands: unlock, lights/AC on/off/auto for N min, door message, lockdown, ir_learn. Server publishes with MQTT 5 so a refused (135) or unheard (16) publish is reported, not silently "sent" (`mqtt-publish.ts`). Per-device broker logins (optional, `lib/mqtt-accounts.ts` + 7 tests): with `EMQX_API_URL`/`EMQX_APP_ID`/`EMQX_APP_SECRET` set, `api/room/pair` creates `room-<device id>` (password = HMAC of key hash, never stored) allowed to subscribe to its own topic only; `api/room/disconnect` deletes it; a refused server publish gets publish rights on `campus/rooms/#` via the API and is retried. Falls back to the shared login.
- Connecting a room = pairing code (`upgrade-room-pairing.sql`, `api/room/pair`, `lib/room-pairing.ts`). One firmware for every room: an unconnected door makes its own key (real board: random, in flash; simulated build: `.device-secret`, git-ignored, made by `device_secret.py`), polls `api/room/pair` and shows a 6-digit code. Admin → Smart room → "Connect a room" (`components/smart-room-connect.tsx`) picks the room + types the code → `claim_room_pairing()` (admins only) stores the key's SHA-256. The door then learns its device id and MQTT login from the server, so neither is in the sketch. The door reports its own type (stored `wokwi` or `mqtt`) and board. PlatformIO envs: `esp32` (simulated, what wokwi.toml runs), `wokwi-web` (published download), `board` (DevKit), `cam` (ESP32-CAM); real boards get Wi-Fi via the `CampusRoom-Setup` portal; published builds land in `public/firmware/<board>/` for the browser installer (ESP Web Tools, `components/firmware-install-button.tsx`).
- Room setup (`upgrade-room-config.sql`, `lib/room-config.ts` + 23 tests, firmware `config.cpp`): per-device config of parts + pins (lock, keypad, display, leds, buzzer, presence, lights, ac relay|ir, temperature, ring, status_led), board pin tables and checks mirrored in TS and C++, kits (Door kit, Room controller), `capabilities()` hides app features the room lacks. Pair returns config + version; status returns `config_version`; device restarts on change and reports parts ok/missing/bad_pins. IR air-con via IRremoteESP8266, `ir_learn` command detects the make (or records raw on/off), `ir_learned` event saves it; temperature feedback → `ac_no_response` notifies staff. Connect a room = room → board → parts (`components/parts-editor.tsx`, shared with Room setup) → firmware made for the room: one compiled firmware per board with a 64-byte key slot and a 1 KB setup slot (`pair.cpp`); the server writes both and redoes checksum + SHA-256 (`lib/esp-image.ts`), no compiling. Wokwi: `api/room/wokwi` returns a zip (`lib/zip.ts`) with the flash image and a circuit drawn for the chosen parts (`lib/wokwi-diagram.ts`; door kit = diagram.json, tested). Real boards: `api/room/firmware` connects the room and returns a 15-min signed link (`lib/firmware-link.ts`, key derived from the link, never stored) that ESP Web Tools reads via `api/room/firmware/[token]/[file]`. The device uses the baked setup on its first start, then the server's. Pairing code kept as "Already have a device showing a code?". USB code reading: `lib/usb-pair-code.ts` (Web Serial). Firmware compiles for all three boards (Arduino core 2.0.17); not yet run on hardware. Per room: Replace device (same row, history kept), Disconnect (`active=false`, door shows a code again). `register_room_device()` still works from SQL. 34 DB checks in `scripts/eval/pairing-db.mjs`.
- Admin → Smart room lists only rooms with an active device.
- 3D twin (Admin → Smart room → room): driven by `room_events` via Supabase Realtime (10 s backup poll); rooms without a device are inferred from bookings and labelled so.
- Vercel env: `SUPABASE_SERVICE_ROLE_KEY`, `ROOM_CODE_SECRET` (16+ chars, same value locally), `MQTT_*`, `AI_PROVIDER`/`AI_API_KEY`.

## Status (Oct 2026)

**Done and verified:** booking engine + rule model, DB no-overlap + DB-enforced rules, who-can-book + fair-use limits, three dashboards, AI recommender (LinUCB; simulation 79.6% vs 71.1% fixed; robust over 10 seeds, 4 demand levels, skimming; weak spot: ~10 attempts after a preference change; `--part=main|seeds|context` splits the run), grounded chatbot (English + Bahasa Melayu; reads only the asker's own bookings + free/busy), private bookings, smart door + room automation (live in Wokwi), room feedback, remote-control server path, venue-first facilities UI with wizards, forgot password, auto-refresh, per-tab login. No-show prediction (logistic + baseline, reminders, manager badge, admin card + Retrain; SIMULATED test AUC 0.715 vs 0.651 student-rate baseline, ceiling 0.760). DB suites: private 23, rules 23, access 16, reports 23, commands 10, no-show 33.

**Usability (no human participants allowed, so SUS is "not tested"):** axe WCAG 2.1 A+AA 0 violations in 66 checks (22 screens x light/dark/phone; fixes: labels, contrast tokens, toasts, tabs); heuristic review fixed 6 (two-step cancel, "too late to cancel", phone stat grids, top-center toasts, equipment qty saves on blur, aria-current/pressed), 4 minor open; KLM task times in `docs/evaluation/usability/`. Keep new UI passing the audit: label every input/select trigger, use theme tokens (dark-mode `text-primary`/`text-destructive` are lightened in `globals.css`).

**Objective 5 (docs/evaluation/README.md):** DS1 0 overlaps in 2,200 simultaneous requests (p95 72 ms); DS4 recommender p95 ≤ 25 ms; chatbot known-answer 38/38 after fixes, held-out 14/16 (87.5%); MQTT lab round trip median 48 ms, forged/replayed/expired commands rejected (`scripts/eval/mqtt-rtt.ts`). Pending live data: suggestion acceptance/rank, no-show before/after, live MQTT round trip (`scripts/eval/live-metrics.sql`). SUS not tested (no participants).

**Built, needs a live run by the user:** latest firmware (countdown/extend/overstay, NeoPixel ring, MQTT, keep-alive), 3D twin live sync, energy chart with real data, forgot-password email (add `<site>/reset-password` to Supabase Auth → URL Configuration → Redirect URLs).

**Remaining:** run all migrations; pair the demo door with the new firmware (Replace device) and change the MQTT password, because the old one and the old device key are in git history; remove seed data; supervisor sign-off on "no participants"; Phase 2 report. Run `upgrade-noshow.sql`, then Retrain once there are 200+ labelled bookings / 20+ no-shows (live accuracy pending). Optional: batch allocation, email notifications.

## Conventions

- Roles: student, facility_manager, admin — each with its own route; pages wrap in `AppShell`.
- UI: brand "Campus Reserve", crimson theme tokens in `globals.css` with a full dark mode (`.dark` class; header toggle Light/Dark/Auto saved in localStorage, applied pre-paint in `layout.tsx`) — use tokens so both themes work, no hard-coded colours (except the WebGL palette in `twin-scene.ts`); see `docs/ui-design.md`. Motion utilities: `animate-reveal`, `stagger`, `animate-pop-in`, `skeleton`, all honour reduced motion.
- Keep logic pure and tested in `src/lib/*` (with a `*.test.ts`), I/O in routes/components.
- Navigation after auth uses `router.replace` (no login page left in history).
