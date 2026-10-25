# User study protocol (objective 5: usability, SUS > 68)

## Before the session

1. Remove test data in Supabase: run `supabase/seed-test-data-remove.sql`.
2. Make sure every migration has been run, including `upgrade-booking-rules.sql` and `upgrade-access-limits.sql`.
3. Make one facility type staff-only (e.g. Meeting Room) and give one type a fair-use limit (e.g. Badminton: 1 upcoming booking). This lets the participants meet both rules.
4. Have the Wokwi door running for the library room if you want participants to try the door code.
5. Bring the consent form (from your ethics approval) and the SUS sheet below, or use a Google Form with the same ten statements.

## Participants

- Aim for 10-15 students and 2-3 staff (to act as facility manager or admin).
- Nobody who helped build or test the system.
- Record only a participant code (P01, P02...) and role. No names or emails in the results.

## Tasks (student, about 15 minutes)

Give each task on a card. Don't help unless they're stuck for more than 2 minutes. Note: done / done with help / not done, and the time taken.

| # | Task |
|---|---|
| S1 | Sign up and sign in. |
| S2 | Book a badminton court tomorrow at 5 pm for 4 people. |
| S3 | Try to book the same court at the same time again (or a slot the facilitator has taken). Book one of the suggested alternatives. |
| S4 | Ask the chatbot, in English or Bahasa Melayu, whether a discussion room is free this evening. |
| S5 | Ask the chatbot what the cancellation rule is for the badminton courts. |
| S6 | Try to book the meeting room (staff only). What does the system tell you? |
| S7 | Cancel the booking from S2. |
| S8 | Report a problem with a room (for example, the air-con isn't working). |
| S9 (optional) | Get the door code for a library booking and unlock the Wokwi door. |

## Tasks (staff, about 15 minutes)

| # | Task |
|---|---|
| M1 | As a facility manager, approve one pending request and reject another. |
| M2 | Mark attendance for a booking that has started. |
| A1 | As an admin, add a new facility with two rooms using the New facility wizard. |
| A2 | Make that facility staff-only, and set a limit of 2 upcoming bookings. |
| A3 | Open the analytics tab and say which facility is busiest. |

## After the tasks: SUS questionnaire

Answer each statement from 1 (strongly disagree) to 5 (strongly agree):

1. I think that I would like to use this system frequently.
2. I found the system unnecessarily complex.
3. I thought the system was easy to use.
4. I think that I would need the support of a technical person to be able to use this system.
5. I found the various functions in this system were well integrated.
6. I thought there was too much inconsistency in this system.
7. I would imagine that most people would learn to use this system very quickly.
8. I found the system very cumbersome to use.
9. I felt very confident using the system.
10. I needed to learn a lot of things before I could get going with this system.

Then two open questions:

- What was the most useful part?
- What was the most confusing or annoying part?

## Scoring

1. Type the answers into `docs/evaluation/sus-responses.csv` (one row per participant: `participant,role,q1..q10`).
2. Run `npx tsx scripts/eval/sus.ts docs/evaluation/sus-responses.csv`. It prints the mean, SD, 95% confidence interval, how many scored above 68, and per-statement averages, and saves `docs/evaluation/sus-results.json`.
3. Run `scripts/eval/live-metrics.sql` in Supabase for suggestion acceptance, chatbot helpfulness, no-shows and remote-control timings over the study dates.

Scoring rule (built into `src/lib/sus.ts`, unit-tested): odd statements score answer − 1, even statements score 5 − answer, and the total × 2.5 gives 0-100. 68 is the usual average, so objective 5 is met if the mean is above 68.
