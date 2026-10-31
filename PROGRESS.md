# FYP progress (as of 31 Oct 2026)

Smart Campus Facility Reservation System with AI-Assisted Recommendations: Amaan Rashid, TP073098.

## 1. Phase 1 objectives

| # | Objective | Status | Evidence |
|---|---|---|---|
| 1 | Two-level facility model (type holds rules, rooms inherit, one room can override; attendance recorded) | Done | Categories + per-room overrides + `effective_facility_rules` view; admin wizards add new types without code; check-in / attended / no-show |
| 2 | Rules and no-overlap enforced in the database | Done | Exclusion constraint + `enforce_booking_rules()` trigger; DS1: 0 overlaps in 2,200 simultaneous requests |
| 3 | Ranked, explainable suggestions with per-student weights | Done | S = w1T + w2C + w3U, per-student LinUCB, reasons on every card; simulation 79.6% vs 71.1% fixed; p95 ≤ 25 ms (target < 1 s) |
| 4 | Chatbot answers only from what the student may see | Done | Own bookings + free/busy only (RLS + `reservation_busy`); never shows who booked; 38/38 known-answer, 14/16 held-out |
| 5 | Evaluation against stated criteria | Partly | See section 3 |

Extensions: analytics dashboard (done), status notifications (in-app bell done; email not built), multilingual chatbot (English + Bahasa Melayu; other languages via the LLM).

Beyond the Phase 1 scope: the smart room (ESP32 in Wokwi, door codes, presence-based lights/AC, end-of-booking countdown and extend, MQTT remote control, 3D digital twin, energy chart).

## 2. Features built

- **Booking:** venue → facility → time; rules checked in the app and again in the database; auto-approve or manager approval; cancel, check in, extend +30 min, door code, report a problem.
- **Access and fair use:** member types (undergraduate / postgraduate / staff); who can book per facility type; max upcoming bookings and max hours per week (off by default).
- **Privacy:** reservations visible only to the booker, admins and that room's managers; everyone else sees free/busy only.
- **Dashboards:**
  - student
  - facility manager (approvals, schedule, room problems, smart room, equipment, lost & found)
  - admin (overview, analytics, smart room, users, facilities by location with 2D venue art and wizards, approvals, feedback, equipment, records)
- **AI recommender:** per-student LinUCB with cascade feedback.
- **Chatbot:** grounded, English + Bahasa Melayu; "free" means not booked.
- **Smart room:** connect a room as Simulated (Wokwi) or Physical (ESP32); key shown once; new key / disconnect.
- **No-show prediction:** a probability for each upcoming booking (logistic regression; a simple baseline while data is small). High-risk bookings get one "Still coming?" reminder, managers see a Low/Medium/High badge with reasons, and the admin card shows metrics and a Retrain button. It never blocks or cancels anyone.
- **Auth:** anyone can sign up; forgot / reset password; separate login per browser tab.
- **Docs:** README, user guide, testing guide, user-study kit, Smart-Room Connect guide (slides).

## 3. Objective 5: evaluation

| Measure | Result | Type |
|---|---|---|
| No overlaps under concurrent load (DS1) | 0 overlaps / 2,200 requests; 1 winner in 20/20 same-slot rounds; p95 72 ms | Measured (local Postgres 17) |
| Recommender response time (DS4) | Worst-case p95 24.9 ms | Measured |
| Suggestion quality | LinUCB 79.6%, adaptive 72.6%, fixed 71.1%, random 68.4% | Simulation |
| Chatbot accuracy | 38/38 known-answer, 14/16 held-out (87.5%) | Measured |
| MQTT command round trip | Median 48 ms (lab broker); forged / replayed / expired / wrong-key commands rejected; HTTP fallback median 2.5 s | Measured (lab) |
| No-show prediction | Test AUC 0.715 vs 0.651 (student-rate baseline), true-p ceiling 0.760; Brier 0.156 vs 0.164 | Simulation (300 students, 8 weeks) |
| DB security checks | private 23, rules 23, access 16, reports 23, commands 10, no-show 33 incl. TS/SQL parity (all pass) | Measured |
| Unit tests | 169 vitest cases pass; tsc, lint and build clean | Measured |
| Suggestion acceptance % and rank | Pending | Needs real users |
| No-shows before/after check-in | Pending | Needs real bookings |
| No-show prediction: live accuracy, no-shows before/after reminders | Pending | Needs 200+ finished bookings |
| SUS > 68 | Pending | Needs user study |
| Live MQTT round trip | Pending | Needs live device |

Phase 1 implies real participants: line 618 promises "actual rather than estimated values", ethics approval is in Appendix D, and SUS needs people. Minimum plan: 5 to 8 participants, about 20 minutes each (can be online on the Vercel site), then run `scripts/eval/live-metrics.sql`. Report the no-show trial length as a limitation.

## 4. Phase 2 report

- **Chapter 4:** written. File `report/TP073098_Phase2.docx`, about 4,800 words, 18 pages, 8 figures, 5 tables, 4 algorithms, 11 equations, plus a 4.4 considerations section.
  - Swap the sample-data screenshots (Figs 4.5, 4.6, 4.8) for real ones later.
  - Fig 4.7 is a drawing generated from `diagram.json`; a real Wokwi screenshot would be better.
- **Chapters 5 and 6:** not started.
- **Merge** with Phase 1, under 20,000 words total: later.
- **Note for Ch6:** presence sensing in the smart room partly covers the "occupancy sensors" future work named in Phase 1.

## 5. To do (by you)

1. Run all migrations in Supabase, in order, up to `upgrade-noshow.sql`.
2. Add `<site>/reset-password` to Supabase Auth → URL Configuration → Redirect URLs.
3. Check the Vercel env vars (`SUPABASE_SERVICE_ROLE_KEY`, `ROOM_CODE_SECRET`, `MQTT_*`, `AI_*`).
4. Push the latest code (includes the `tsconfig.json` fix that keeps `scripts/eval` out of the build).
5. Re-key the demo device; keep the MQTT password out of the public repo.
6. Live-test the firmware: countdown / extend / overstay, NeoPixel ring, MQTT, 3D twin sync, energy chart.
7. Remove the seed data (`seed-test-data-remove.sql`).
8. Run the user study + SUS, then `live-metrics.sql`.
9. Chapters 5 and 6, then merge with Phase 1.

10. After the study: Admin → Analytics → No-show prediction → Retrain (or `npx tsx scripts/eval/noshow-train.ts`).

Optional: batch allocation, per-device MQTT logins, email notifications.
