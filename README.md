# Campus Reserve

Smart Campus Facility Reservation System with AI-Assisted Recommendations. Final Year Project by Amaan Rashid (TP073098), Asia Pacific University of Technology & Innovation.

One booking system for every kind of campus space: discussion rooms, sports courts, meeting rooms, event halls. Administrators set the rules for each facility type without touching code, and the database refuses anything that breaks them, including double bookings. When the time a student wants is taken, the app suggests the next best options and learns each student's preferences. A chatbot answers questions about availability and rules in English or Bahasa Melayu, using only live records the student is allowed to see.

The smart-room extension adds a keypad door for one library room (an ESP32 simulated in Wokwi). It handles door codes, lights and air-con that follow occupancy, end-of-booking reminders, remote control over MQTT, a live 3D twin and an energy estimate.

Live: https://smart-campus-reservation.vercel.app

## What's in it

| Area | Highlights |
|---|---|
| Students | Venue → room → booking flow, AI suggestions when a slot is taken, popular times, door codes, check-in, extend +30 min, cancel, report a room problem, chatbot (EN/MS) |
| Facility managers | Room cards with today's timeline, approval queue, attendance, room problems, smart-room panel, equipment, lost & found |
| Admins | Facilities by location with step-by-step wizards, booking rules, who can book (undergraduate / postgraduate / staff), fair-use limits, managers, users, analytics, smart rooms (connect a device, 3D twin, remote control), activity records |
| Guarantees in the database | No overlapping bookings (exclusion constraint), every booking rule checked by a trigger, private bookings (others only see free/busy), row-level security on every table |

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui · Supabase (Postgres, Auth, row-level security, pg_cron, Realtime) · three.js · MQTT (EMQX Cloud) · ESP32 firmware for Wokwi. The chatbot works with Gemini, Groq or OpenAI, or with no key at all; without a key it uses template answers from the same live data.

## Running it

### 1. Database (Supabase)

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run `supabase/setup-all.sql`, then the upgrade files in the order listed in `supabase/README.md`. Every file can be re-run safely.
3. **Authentication → Providers → Email**: turn off "Confirm email" for demos.
4. **Authentication → URL Configuration → Redirect URLs**: add `<your site>/reset-password` (used by Forgot password).
5. Sign up in the app, then run `supabase/make-me-admin.sql` to make your account an administrator. Everyone else signs up as a student, and admins assign roles and member types from the Users tab.

### 2. Environment

Copy `.env.example` to `.env.local` and fill it in. Only the two Supabase values are needed to run the app. The rest switch on the chatbot model, door codes and remote control. Never commit `.env.local`, and never put a secret in a `NEXT_PUBLIC_` variable.

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 151 unit tests
npm run lint
npm run build
```

The sign-in page has one-tap demo buttons for a student, a manager and an admin.

### 4. Smart room (optional)

See `firmware/door-wokwi/README.md`. In short: build and start the simulation in VS Code with the Wokwi extension, and the door shows a 6-digit code. In Admin → Smart room → **Connect a room**, pick the room and type that code. The same firmware runs in every room.

### 5. Deploy (Vercel)

Import the repository at [vercel.com/new](https://vercel.com/new) and add the variables from `.env.local` under Project Settings → Environment Variables. Set the Function Region to the one closest to your Supabase project. Everything runs on free tiers.

## Evaluation

Results for objective 5 are in `docs/evaluation/README.md`.

- **Concurrent booking:** 0 overlapping bookings across 2,200 simultaneous requests.
- **Recommender speed:** p95 of 25 ms in the worst case.
- **Chatbot:** 87.5% correct on a held-out question set.
- **Remote control (lab):** median round trip of 48 ms.

The user study and SUS kit are in `docs/evaluation/user-study.md`. To reproduce the results:

```bash
npx tsx scripts/eval/recommender-latency.ts
npx tsx scripts/eval/chatbot-eval.ts
cd scripts/eval && npm install && node concurrency.mjs && cd ../.. && npx tsx scripts/eval/mqtt-rtt.ts
```

## Where things are

```
src/app/            pages for each role, and API routes (chat, bookings, room device + remote control)
src/components/     shared UI (facility wizards, 3D twin, chatbot, analytics...)
src/lib/            logic with unit tests: recommender, LinUCB bandit, chatbot parsing, access rules, door codes, energy
supabase/           schema and migrations (run order in supabase/README.md)
firmware/door-wokwi ESP32 door controller for Wokwi
scripts/            recommender simulation, evaluation scripts (scripts/eval)
docs/               user guide, testing guide, evaluation, UI design, research notes, diagrams
report/             Phase 1 report and ethics documents
```

## Documentation

- `docs/USER-GUIDE.md`: how to use the app as a student, manager or admin
- `docs/TESTING-GUIDE.txt`: step-by-step manual test plan
- `docs/evaluation/`: objective 5 results and user study protocol
- `supabase/README.md`: migrations and run order
- `FYP.md`: scope, milestones and status log
