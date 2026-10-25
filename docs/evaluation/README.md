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
| **SUS above 68** | `user-study.md` protocol, scored by `scripts/eval/sus.ts` (`src/lib/sus.ts`, unit-tested) | Needs participants | ⏳ User study |
| Remote control round trip (MQTT) | `live-metrics.sql` §4 (button press → device confirms, split by MQTT push vs 5 s HTTP poll) | Needs the live Wokwi device | ⏳ Live run |

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
npx tsx scripts/eval/sus.ts docs/evaluation/sus-responses.csv   # after the study
# scripts/eval/live-metrics.sql -> Supabase SQL editor, after the study
```
