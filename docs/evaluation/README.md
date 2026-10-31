# Evaluation (objective 5)

Objective 5: *evaluate against stated criteria: zero overlapping reservations under concurrent load, acceptance rate and rank of suggestions, assistant accuracy against a known-answer set, no-show rate before and after check-in, and SUS above 68.*

| Criterion | Method | Result | Status |
|---|---|---|---|
| **Zero overlapping reservations under concurrent load** (DS1) | `scripts/eval/concurrency.mjs`: 50 students on 50 separate connections, all migrations applied, the same path the app uses (row-level security + booking trigger). 2,200 simultaneous requests in three scenarios. | **0 overlapping bookings.** Same slot: exactly 1 winner in 20/20 rounds. Staggered overlaps: 44 of 1,000 requests accepted, 0 overlaps. Fair-use limit: exactly 1 accepted in 20/20 rounds. p95 72 ms per request. | ✅ Met (local Postgres 17) |
| Fair use and access hold under the same load | Same script, scenario C, plus `outputs/pgtest-access.mjs` (16 checks) | One student firing 10 bookings at once on a "1 upcoming" type: exactly 1 accepted every round | ✅ Met |
| **Recommender quality** (acceptance rate and rank) | `scripts/simulate-recommender.ts`: 240 simulated students with hidden preferences, paired comparison against an oracle | P(student books a suggestion), last 20 attempts: LinUCB **79.6%** vs fixed weights 71.1%, adaptive 72.6%, random 68.4% | ✅ Simulated. **Live** acceptance and rank: `live-metrics.sql` §1 after the study |
| Recommender response time (DS4, < 1 s) | `scripts/eval/recommender-latency.ts`: full suggestion path, one-week window, 500 runs per case | Worst case (30 rooms, 7 days searched): p95 **24.9 ms**. Typical: p95 under 3 ms | ✅ Met |
| **Assistant accuracy against a known-answer set** | `scripts/eval/chatbot-eval.ts`: 38 questions (20 EN, 18 MS) checked for question type, facility, day, time and reply language; plus 16 held-out questions | First run 31/38 (81.6%: EN 90%, MS 72%). After fixing Malay sport words, "this evening" and "who can book": 38/38. **Held-out: 14/16 (87.5%)**: EN 6/8, MS 8/8 | ✅ Measured. See `chatbot.md` for the 2 held-out misses |
| **No-show rate before vs after check-in** | `live-metrics.sql` §3 (compares before vs after check-in grace is switched on; counts room-hours given back) | Needs real bookings over time | ⏳ After the user study |
| No-show prediction (see below) | `scripts/eval/noshow-simulate.ts`: synthetic campus with a known no-show process; time-based split | **SIMULATED** test AUC **0.715** vs 0.651 for the student's own rate, ceiling 0.760 | ✅ Simulated. Live accuracy: pending live data |
| No-show rate before vs after reminders | Admin → Analytics → No-show prediction (from `booking_risk.reminded_at` + reservations) | Needs reminders to run for a while | ⏳ Pending live data |
| **SUS above 68** | `user-study.md` protocol, scored by `scripts/eval/sus.ts` (`src/lib/sus.ts`, unit-tested) | Needs participants | ⏳ User study |
| Remote control round trip (MQTT), lab | `scripts/eval/mqtt-rtt.ts`: real signing/verify/publish code, local TLS broker, simulated ESP32 that verifies and confirms over HTTP; 100 commands | Button press → device confirms: median **48 ms**, p95 49 ms (mostly the per-command TLS connection). Tampered, replayed, expired and wrong-key commands: **all rejected**. HTTP fallback (5 s poll), modelled: median 2.5 s, p95 4.7 s | ✅ Lab. Excludes internet time |
| Remote control round trip, live | `live-metrics.sql` §4 (MQTT push vs 5 s HTTP poll, on EMQX Cloud + Vercel + Wokwi) | Needs the live Wokwi device | ⏳ Live run |

## No-show prediction

**What it does.** For every booking starting in the next 24 hours, the database estimates p, the chance the student won't turn up (`supabase/upgrade-noshow.sql`, same maths as `src/lib/noshow.ts`). It does three things with it:

- sends one "Still coming? If not, please cancel" reminder about an hour before a high-risk booking (p ≥ 0.35)
- shows managers a Low / Medium / High badge with reasons
- reports how well it predicts

It never blocks, penalises or auto-cancels anyone, and nothing is overbooked. The no-overlap constraint is untouched.

**Method.**

- **Labels:** no-show = `no_show` set (auto-released or marked by a manager); showed = checked in. A booking with neither is left out.
- **Features** (12):
  - the student's past no-show rate, Beta-smoothed towards the campus rate with strength 5
  - how many past bookings they have, and a first-booking flag
  - the room type's smoothed rate
  - log lead time
  - early-morning, evening and weekend flags
  - duration
  - group size ÷ capacity
  - whether the booking needed approval
  - whether it was booked from a suggestion
- **No leakage:** all history is cut at start − 24 h, so a booking never sees its own outcome. A unit test flips a booking's own outcome and checks its features don't change.
- **Model:** logistic regression with L2 (λ = 0.01), standardised features, batch gradient descent from zero (deterministic).
- **Cold start:** with fewer than 200 labelled bookings or 20 no-shows, it uses a baseline instead: student rate × (room type rate ÷ campus rate).
- **Evaluation:** a time-based split (train on the oldest 80%, test on the newest 20%; never random), compared against three baselines: campus rate, student rate only, room type rate only.
- **Storing a model:** a new model is stored only if it beats the student-rate baseline on test AUC. The stored model is then refit on all labelled bookings.

**Simulated results** (`noshow-sim.json`, `noshow-sim-calibration.png`). The simulated campus has 300 students over 8 weeks: 4,399 bookings, 20.6% no-shows. The known process behind it: 12% habitual no-showers, longer lead time, early mornings and large groups that waited for approval all raise the risk, and booking from a suggestion lowers it a little. Test set: 880 bookings.

| Predictor (test set) | AUC ↑ | Brier ↓ | Log loss ↓ |
|---|---|---|---|
| Logistic model | **0.715** | **0.156** | **0.481** |
| Cold-start baseline | 0.661 | 0.164 | 0.507 |
| Student rate only | 0.651 | 0.164 | 0.508 |
| Room type rate only | 0.548 | 0.174 | 0.533 |
| Campus rate | 0.449 | 0.176 | 0.536 |
| True p (ceiling, unknowable in practice) | 0.760 | 0.145 | 0.453 |

- **Calibration** is close to the diagonal where most bookings are: predicted 13% → observed 13% (504 bookings), and 28% → 30% (310). The model under-predicts at the top (48% → 56% for 54 bookings, 68% → 83% for 12).
- **The 0.35 threshold** flags 11.9% of bookings for the extra reminder. Half of those (50.5%) were no-shows, and it catches 26.6% of all no-shows.
- **Speed:** training takes about 0.2 s.

**Correctness checks.**

- 18 unit tests in `src/lib/noshow.test.ts`: feature maths, no leakage, convergence, AUC/Brier/log loss/calibration against hand-computed values, the wording of the reasons, and the baseline fallback.
- `scripts/eval/noshow-db.ts`: 33 database checks, all pass (`noshow-db.json`):
  - students can't read `booking_risk` (not even their own row) or `noshow_model`
  - a manager sees only their own rooms' scores
  - exactly one reminder per high-risk booking, and none for pending bookings
  - the scorer can't be called by any signed-in user
  - the migration can be re-run
  - **parity:** the TypeScript and SQL scorers agree on all 12 features, on p (largest difference 3 × 10⁻¹⁷, limit 10⁻⁶) and on the reasons, for 86 bookings in both baseline and logistic mode

**Live data: pending.** A dry run on the current Supabase data (`noshow.json`) found 161 labelled bookings with 20 no-shows. That's below the 200-booking minimum, so the live system runs in baseline mode. Those bookings also include the `[seed]` test data, so the numbers in that file are not a result. Once real use has produced 200+ finished bookings, run Retrain (Admin → Analytics) or `noshow-train.ts`. That gives the live AUC, and the Analytics card then shows the no-show rate before and after reminders started. That before/after figure is not a controlled experiment: other things change over the same period.

## What the evaluation found and changed

- **Deadlocks under heavy contention.** The first concurrency run never let a double booking through, but 5-11% of simultaneous requests failed with "deadlock detected" instead of a clean "slot taken", and the slowest waited 44 s. Cause: many inserts racing inside Postgres's no-overlap index check. Fix: the booking trigger now queues requests per room with a transaction-scoped advisory lock (`upgrade-booking-rules.sql`, `upgrade-access-limits.sql`). Re-run: 0 deadlocks, worst wait 0.34 s.
- **Chatbot vocabulary gaps.** Malay sport names ("bola keranjang"), "acara" (event), "this evening" and "who can book / siapa boleh" questions were misread. They were fixed as general rules (`src/lib/chat-logic.ts`). A held-out set written before re-running shows how well the fixes generalise (87.5%), rather than reporting the tuned 100%.

## Limits of these results

- DS1 runs against a local Postgres 17 with the same migrations, not the hosted Supabase project. The guarantee comes from the database (exclusion constraint, trigger, locks), which is identical, but network time to Supabase is not included in the latency.
- The chatbot score is for the app's own understanding step (the path with no AI key). With an AI key, the model's extraction runs as well and the local parser fills in what the model misses. That path needs a live run with the key.
- The recommender numbers come from simulated students. The live acceptance rate and rank need real use (`live-metrics.sql` §1).
- Two held-out chatbot questions fail ("reserve" as a booking word, "can staff only book…"). They were left unfixed so the held-out score stays honest.

## Re-running

```bash
npx tsx scripts/eval/recommender-latency.ts           # DS4  -> docs/evaluation/latency.json
npx tsx scripts/eval/chatbot-eval.ts                  # known-answer set -> chatbot.json / chatbot.md
cd scripts/eval && npm install && node concurrency.mjs   # DS1 -> docs/evaluation/concurrency.json
npx tsx scripts/eval/mqtt-rtt.ts                      # remote control, lab (needs scripts/eval npm install) -> mqtt-rtt.json
npx tsx scripts/eval/noshow-db.ts                     # no-show DB checks + TS/SQL parity -> noshow-db.json
npx tsx scripts/eval/noshow-simulate.ts && python scripts/plot-noshow.py   # SIMULATED -> noshow-sim.json + png
npx tsx scripts/eval/noshow-train.ts --dry-run        # live data (service role from .env.local) -> noshow.json
npx tsx scripts/eval/sus.ts docs/evaluation/sus-responses.csv   # after the study
# scripts/eval/live-metrics.sql -> Supabase SQL editor, after the study
```
