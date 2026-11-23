# Campus-level simulation: method and results

What happens to a whole sports hall over a semester when a clash is handled in
different ways. No participants were involved. Everything can be regenerated:

```
npx tsx scripts/simulate-campus.ts      # about 45 s
python scripts/plot-campus.py
```

The seed is fixed (20261116), so a re-run gives the same numbers.

## How this differs from the recommender simulation

`docs/simulation/README.md` hands every strategy the same clash and asks which
one ranks the alternatives best. Here the students share one calendar. Bookings
are first come, first served, and a slot one student takes is gone for the
next. So each strategy changes the calendar it then has to work with, and the
measures are about the hall: how many requests end in a booking, how full the
courts get, and where the overflow goes.

## What was simulated

300 students, three badminton courts open 10:00 to 22:00, 14 weeks. Requests
arrive at 90% of the court-hours available, about 3,180 per semester. Demand is
uneven: lunchtime (12:00, 13:00) and evening (17:00 to 20:00) get 71% of the
requests on half of the hours. A fifth of the students are regulars who book
four times as often as the rest, about 26 requests each against 7.

Each student has a usual hour, a favourite court and one of the four hidden
preferences from the recommender simulation (time-first, same-court,
quiet-hours, exact-only). If the slot they ask for is free they get it. If it
is taken, one of four things happens, each in its own copy of the semester:

- **No help**: the student is turned away. This is plain first come, first served.
- **By hand**: the student looks at the timetable and tries the four nearest
  free times on the same day, own court first.
- **Fixed weights**: the app's baseline suggestions, top four.
- **LinUCB**: what the app runs. Pool of six, per-student LinUCB ranking,
  cascade feedback.

The student reads up to four alternatives from the top and books the first one
they like. All four copies get the same requests in the same order with the
same random draws, so differences between them are paired.

The recommender, the peak-hour learner (`learnPeakHours`, re-run every week on
the last four weeks of bookings) and the bandit are the production code. The
quiet-hours preference is judged against the true busy hours of the demand
profile, not the app's own estimate, so a strategy gets no credit for agreeing
with itself.

## Results

Mean of 20 runs. Ranges are 95% confidence intervals across runs.

| | No help | By hand | Fixed weights | LinUCB |
|---|---|---|---|---|
| Request ends in a booking | 60.8% | 83.0% | 82.8% | **83.2%** |
| Turned away | 39.2% | 17.0% | 17.2% | 16.8% |
| Court-hours used | 54.8% | 74.9% | 74.7% | 75.1% |
| Busy hours used | 71.2% | 87.5% | 83.0% | 83.3% |
| Quiet hours used | 38.5% | 62.3% | 66.3% | 66.8% |
| Alternatives that land in quiet hours | - | 50.3% | 64.0% | 63.9% |
| Hours moved from the time asked for | - | 0.96 | 1.21 | 1.32 |

Paired differences in requests served:

| Comparison | Difference | Higher in |
|---|---|---|
| LinUCB vs no help | +22.4 pts (+22.1 to +22.7) | 20 of 20 runs |
| LinUCB vs by hand | +0.2 pts (+0.0 to +0.4) | 11 of 20 |
| LinUCB vs fixed weights | +0.4 pts (+0.2 to +0.7) | 16 of 20 |
| Fixed weights vs by hand | -0.2 pts (-0.4 to -0.0) | 4 of 20 |

Figures: `campus-outcomes.png`, `campus-hourly.png`, `campus-demand.png`.

## What this shows

Offering an alternative at all is where the gain is. With no help, 39% of
requests are lost and the courts sit 55% used. Any of the other three brings
that to about 17% lost and 75% used.

The suggestions do not serve more students than a student who searches
carefully by hand. The three are within half a point of each other at every
demand level tested. What the suggestions change is where the overflow goes:
64% of suggested bookings land in quiet hours against 50% by hand, so busy
hours are 4.4 points less full (83.0% against 87.5%) and quiet hours 4.0 points
fuller. The price is a slightly bigger move, 1.2 hours from the time asked for
against 1.0.

That makes the case for the recommender at campus level one of effort and
spread, not volume. The by-hand student here always checks the four nearest
times. The KLM estimate in `docs/evaluation/usability/klm.md` puts a suggestion
at 5.9 s against 11 to 34 s of searching, and a real student who gives up after
one look sits somewhere between "no help" and "by hand".

LinUCB adds little over fixed weights in a real semester: +0.4 points served.
A student only teaches the model when they hit a clash and take a suggestion,
which a regular does about eight times in 14 weeks and an occasional user
twice. For regulars in the last third of the semester LinUCB rescues 64.8% of
clashes against 62.2% for fixed weights (+2.6 points, +1.4 to +3.9). This
agrees with limitation 2 of the recommender simulation: the 8.5-point gain
there needs 20 to 30 clashes per student.

It does not reduce clashes. The asked-for slot is already taken 46% of the time
with suggestions and 39% with no help, because a fuller calendar has fewer free
slots. The system handles clashes better; it does not prevent them.

## Checks

| What was changed | No help | By hand | Fixed | LinUCB |
|---|---|---|---|---|
| Demand 50% of capacity | 74.8% | 91.8% | 91.0% | 91.3% |
| Demand 70% | 67.3% | 87.7% | 87.2% | 87.8% |
| Demand 90% | 61.2% | 83.2% | 83.1% | 83.3% |
| Demand 110% | 55.5% | 77.6% | 77.5% | 77.8% |
| Demand 140% | 48.9% | 67.8% | 67.8% | 68.0% |
| Busy hours the app does not assume (11, 15-17, 20, 21) | 61.2% | 83.5% | 83.3% | 83.8% |

Ten runs per row. In the last row the app starts with the wrong busy hours
(12, 13, 17, 18, 19). By the end `learnPeakHours` had picked up three to five
of the six true ones in every run, with one wrong hour (18:00) in two runs of
ten. The shift of overflow into quiet hours held: fixed weights gave +3.4
points quiet-hour use against by hand.

## Limitations

1. **The demand profile is assumed.** The share of requests per hour was chosen
   by the author, not taken from APU booking records. The demand and
   shifted-hours rows test how much that matters.
2. **"By hand" is a diligent student.** They always try four nearby times. Real
   students may try fewer, which would favour the suggestions, or may know
   better than any ranking what they want, which would not.
3. **One facility type.** Three identical badminton courts, one-hour bookings.
4. **No cancellations, no-shows or advance booking.** Every booking is kept, and
   requests are handled in order of the day they are for.
5. **The preferences are the same four simulated types** as the recommender
   simulation, with the same caveats.

These results describe how the mechanism behaves under stated assumptions.
They are not measurements of APU students.
