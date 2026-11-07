# Recommender simulation: method and results

Offline evaluation of the slot recommender. No participants were involved.
Everything here can be regenerated:

```
npx tsx scripts/simulate-recommender.ts            # everything (~3 min)
# or one section at a time, merged into summary.json:
npx tsx scripts/simulate-recommender.ts --part=main      # headline + ablations + latency (~50 s)
npx tsx scripts/simulate-recommender.ts --part=seeds     # 10 random seeds (~85 s)
npx tsx scripts/simulate-recommender.ts --part=context   # demand + student behaviour (~60 s)
python scripts/plot-simulation.py
```

The random seed is fixed (20261001), so a re-run gives identical numbers.

## What was tested

240 simulated students (60 of each of four types) each made 80 booking
attempts. Every attempt asked for a badminton court at a time that was already
taken, with other court-hours busy at random (35% of them). The recommender
then produced alternatives, and each strategy ranked them and showed four.

The student read the four cards from the top and booked the first one they
liked. That is the cascade model the bandit assumes. Each student had a hidden
preference the strategies never saw:

| Type | What they want | Linear in the features? |
|---|---|---|
| time-first | the hour they asked for, any court | yes |
| same-court | the court they picked, even at another hour | yes |
| quiet-hours | off-peak times | yes |
| exact-only | exactly the hour asked for, same day, or nothing | no |

A good match is accepted about 60% of the time and a poor one 2–5%.

Four strategies saw the same requests and the same random draws, so the
comparison is paired:

- **random**: the candidates in random order
- **fixed**: the baseline score S = w₁T + w₂C + w₃U with fixed weights
- **adaptive**: the baseline score with the per-student `updateWeights` rule
- **linucb**: what the app now runs, i.e. the adaptive candidate pool, LinUCB
  ranking, and cascade feedback

They were all measured against an oracle that knows the student's preference
and picks the best four of every feasible slot.

Both the recommender (`src/lib/recommend.ts`) and the bandit
(`src/lib/bandit.ts`) are the production code. Nothing was re-implemented for
the simulation.

## Results

Each figure is the mean over the last 20 attempts per student. The ranges are
95% confidence intervals across students.

| Strategy | Student books a suggestion | Top card is the one booked | Regret vs oracle |
|---|---|---|---|
| random | 68.4% (65.9–71.0) | 27.6% (25.5–29.7) | 17.0% |
| fixed | 71.1% (68.5–73.7) | 40.3% (37.9–42.6) | 14.3% |
| adaptive | 72.6% (70.2–74.9) | 40.9% (38.6–43.3) | 12.8% |
| **linucb** | **79.6% (77.9–81.4)** | **53.4% (51.8–55.0)** | **5.8%** |

Broken down by type of student (student books a suggestion, last 20 attempts):

| Type | random | fixed | adaptive | linucb |
|---|---|---|---|---|
| time-first | 82.9% | 86.0% | 84.1% | 91.1% |
| same-court | 53.3% | 56.3% | 55.8% | 66.5% |
| quiet-hours | 92.4% | 95.0% | 95.5% | 95.2% |
| exact-only | 45.0% | 47.0% | 54.9% | 65.7% |

Figures: `learning-curves.png` and `by-student-type.png`.

## What this shows

- **LinUCB learns, and the gain is real.** It starts close to the fixed
  scorer, at about 71–75% over the first ten attempts, and climbs to 79.6%.
  Its confidence interval does not overlap the fixed scorer's. Over the last
  twenty attempts regret falls from 14.3% to 5.8%, less than half the distance
  from the perfect ranking.
- **The old adaptive rule barely helps.** It is almost indistinguishable from
  fixed weights. This is the evidence for replacing it.
- **The gain comes from personalisation.** The biggest improvements are for
  students the fixed weights serve worst: same-court (+10 points) and
  exact-only (+19 points).
- **No gain where the baseline is already right.** For quiet-hours students
  the fixed weights already fit, and LinUCB matches them (95.2% against
  95.0%). It does not make things worse.
- **It holds up when its assumption breaks.** Exact-only students do not
  follow the linear model LinUCB assumes, and it still gains 19 points over
  fixed weights.

## Sensitivity: does the result depend on the assumptions?

The headline result rests on choices made by the author: one random seed, 35 % of court-hours busy, and students who read all four cards and never change their minds. Each of these was varied, with 120 students per run (30 of each type) and the same paired comparison. The gain shown is LinUCB minus fixed weights over the last 20 attempts, with its 95 % confidence interval. Figure: `sensitivity.png` and `seeds.png`.

| What was changed | Fixed | LinUCB | Gain | LinUCB better for |
|---|---|---|---|---|
| **10 random seeds** | | | +8.9 pts on average (SD 0.4, range +8.1 to +9.4) | best strategy in 10 of 10 seeds |
| Demand: 15 % of court-hours booked | 73.1 % | 82.1 % | +9.0 [+7.0, +11.0] | 77 / 120 students |
| Demand: 35 % (headline setting) | 70.3 % | 79.2 % | +8.9 [+7.4, +10.5] | 109 / 120 |
| Demand: 55 % | 67.8 % | 73.6 % | +5.9 [+5.1, +6.7] | 118 / 120 |
| Demand: 75 % | 58.5 % | 61.2 % | +2.7 [+2.2, +3.3] | 93 / 120 |
| Behaviour: reads all four cards | 70.7 % | 79.6 % | +8.9 [+7.4, +10.4] | 110 / 120 |
| Behaviour: skims (70 % chance of reading the next card) | 57.1 % | 68.1 % | +10.9 [+9.1, +12.8] | 87 / 120 |
| Behaviour: changes preference at attempt 40 | 70.9 % | 75.0 % | +4.1 [+2.9, +5.3] | 80 / 120 |
| ...the 10 attempts right after the change | | | **−2.2 [−4.1, −0.3]** | 48 / 120 |

Two variants of LinUCB were also run on the headline requests (ablations):

| Variant | Books a suggestion | vs deployed LinUCB |
|---|---|---|
| Deployed: re-ranks the baseline's top 6 | 79.6 % | - |
| Re-ranks the top 12 instead | 83.4 % | +3.7 pts |
| Also learns from "booked none of the four" | 79.8 % | +0.2 pts (+1.2 pts in the first 20 attempts) |

What this shows:

- **The advantage is not a lucky seed.** Across 10 seeds the gain stays between +8.1 and +9.4 points, and LinUCB is the best strategy every time.
- **It holds in every condition tested, but shrinks when the campus is full.** At 75 % booked there are few good alternatives left to rank, so ordering them better helps less (+2.7 points). The confidence interval still excludes zero.
- **Skimming students benefit most** (+10.9 points), because putting the right card first matters more when the student may not read the rest.
- **The real weakness is a change of preference.** For about 10 attempts after a student's taste changes, LinUCB is *worse* than fixed weights (−2.2 points), because it keeps recommending what the student used to like. It recovers, and is ahead again by the end. A forgetting factor (down-weighting old feedback) is the standard fix and is listed as future work.
- **A wider candidate pool is the cheapest improvement.** Re-ranking 12 candidates instead of 6 adds 3.7 points at negligible cost, since latency stays under 30 ms (DS4). Learning from "booked nothing" adds almost nothing once the model has learned, so it was not adopted.

## Limitations

State these plainly in the report.

1. **The students are simulated.** Their preferences were chosen by the
   author, and three of the four types follow the linear model LinUCB
   assumes. That is its favourable case. The exact-only type is the only
   check against that assumption. Real students may be noisier, may change
   their minds, and may not read the cards top-down.
2. **80 attempts per student is generous.** A real student may book only a
   few times a semester. The curves show most of the gain arrives within
   20–30 attempts, which is a whole semester for a regular user and never for
   an occasional one.
3. **The candidate pool limits the result.** The app takes the baseline's top
   six candidates before LinUCB re-ranks them, so LinUCB can never show a slot
   the baseline filtered out. The ablation above shows a pool of 12 would add
   3.7 points; the deployed app still uses 6.
4. **Rejections are not learned from.** When a student books none of the four
   cards, the app records nothing. The ablation shows learning from it adds
   only 0.2 points (1.2 early on), so this was left out.
5. **Only badminton was simulated**, with three identical courts.

These results show the mechanism works as designed. They do not replace
testing with real students. That is what the Phase 2 metrics in
`evaluation_events` are for.
