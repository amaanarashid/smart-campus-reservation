# Recommender simulation: method and results

Offline evaluation of the slot recommender. No participants were involved.
Everything here can be regenerated:

```
npx tsx scripts/simulate-recommender.ts
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
   the baseline filtered out. Part of the remaining 5.8% regret comes from
   that filter. Widening the pool is a one-parameter change worth testing.
4. **Rejections are not learned from.** When a student books none of the four
   cards, the app records nothing, so the bandit does not learn from it.
   Under the cascade model that outcome says "all four were wrong", and using
   it would likely speed up learning.
5. **Only badminton was simulated**, with three identical courts.

These results show the mechanism works as designed. They do not replace
testing with real students. That is what the Phase 2 metrics in
`evaluation_events` are for.
