# Usability evaluation without participants

Objective 5 asked for a System Usability Scale score above 68 (DS8). The SUS is a questionnaire that people fill in after using the system. This project could not involve human participants, so a SUS score cannot be reported honestly. Four standard methods that need no participants were used instead. Each one checks a different part of usability.

| Method | What it shows | Tool / file |
|---|---|---|
| Automated accessibility audit | Whether the screens meet WCAG 2.1 level A and AA | `scripts/eval/ui/audit.mjs` (axe-core), results in `axe.json` |
| Heuristic evaluation | Usability problems against Nielsen's 10 heuristics, rated by severity | This file, screenshots in `shots/` |
| Cognitive walkthrough | Whether a first-time user can find each step of the main tasks | This file |
| KLM-GOMS | Predicted task times for a practised user, and comparisons between designs | `src/lib/klm.ts`, `scripts/eval/klm.ts`, results in `klm.md` / `klm.json` |

All four were carried out by the developer, which is their main limitation (see the end of this file). Everything ran against a built copy of the app with sample data (`scripts/eval/ui/mock-supabase.mjs`), so no real student data was used.

## 1. Accessibility audit (WCAG 2.1 A + AA)

The audit opens 22 screens across the three roles, including dialogs and wizards. It checks each one in three variants: desktop light, desktop dark and phone width (390 px). That makes 66 checks. axe-core reports anything that breaks a WCAG 2.1 A or AA rule.

**First run:** violations on 29 of the 45 checks that existed at the time (15 screens × 3 variants). Later screens and the redesigned booking page added five more problems.

**Final run:** 66 checks, 0 violations.

| # | Problem found | Rule | Where | Fix |
|---|---|---|---|---|
| A1 | Drop-downs with no accessible name, so a screen reader says only "button" | button-name (critical) | Booking length, popular-times day, manager equipment and lost & found, admin roles, equipment type | `aria-label` on each trigger |
| A2 | Inputs with a visible label that isn't linked to the input | label (critical) | Booking date, time and people; equipment quantities; facility rule fields | `aria-label`, and `Field` now links its label with `htmlFor`/`id` |
| A3 | Crimson text on dark backgrounds at 3.1:1 (AA needs 4.5:1) | color-contrast | Every page in dark mode | Lighter text tone of the same hue in dark mode, about 6:1. Button fills unchanged |
| A4 | Small red text on pale red badges at 4.0:1 | color-contrast | Overdue and alert badges | Darker `--destructive` (5.4:1); dark-mode fill 5.2:1 behind white text |
| A5 | Bell's spoken name didn't include its visible unread count | label-content-name-mismatch | Header, all roles | Name is now "Notifications, 2 unread" |
| A6 | Smart-room card spoken name hid its visible status text | label-content-name-mismatch | Admin → Smart room | Screen-reader-only label inside the button instead of `aria-label` |
| A7 | Toast text at 4.25–4.34:1 | color-contrast | Success and error toasts | Darker toast text colours |
| A8 | Inactive tab text at 4.33:1 | color-contrast | Student Book / My bookings tabs | Inactive tab text and muted text made slightly darker |
| A9 | Scrolling schedule not reachable by keyboard | scrollable-region-focusable | Manager "Today & upcoming" | Made focusable and named as a region |
| A10 | Picture-only "New location" button had no name | button-name | New facility wizard | Named; location cards also announce selected / not selected |
| A11 | Booking length on the crimson time badge was faded to 3.9:1 | color-contrast | Manager "Today & upcoming" | Removed the 80 % opacity |

Automated tools catch about a third to a half of accessibility problems. They can't judge whether a label makes sense or whether the keyboard order is logical, so 0 violations means no rule failures were found, not that the site is fully accessible.

## 2. Heuristic evaluation

Each screen was reviewed against Nielsen's 10 usability heuristics. Severity uses Nielsen's scale: 0 = not a problem, 1 = cosmetic, 2 = minor, 3 = major, 4 = catastrophe.

### Problems fixed

| # | Problem | Heuristic | Severity | Fix |
|---|---|---|---|---|
| H1 | One click on Cancel cancelled the booking at once, with no confirmation and no undo. An undo isn't possible because someone else may book the slot straight away. | 3 User control, 5 Error prevention | 3 | Two-step cancel: "Cancel this booking? Yes, cancel / Keep it" |
| H2 | Cancel was still offered after the notice period had passed; clicking it only then showed an error | 5 Error prevention, 1 Visibility | 2 | After the deadline the button is replaced by "Too late to cancel (24 h notice)" |
| H3 | On a phone the four stats cards of the manager and admin pages filled more than one screen and pushed the approval queue out of sight | 8 Minimalist design | 2 | 2 × 2 grid on phones, icons hidden below 640 px |
| H4 | On a phone the "That time is taken" toast covered the suggestion cards it was announcing | 1 Visibility of system status | 2 | Toasts now appear at the top centre |
| H5 | Equipment quantities saved only when Enter was pressed, with no hint | 1 Visibility of system status | 2 | Also saves when you leave the box; a tooltip says so |
| H6 | The admin section bar and the wizard's location cards didn't tell assistive tech which item was selected | 4 Consistency and standards | 1 | `aria-current` and `aria-pressed` |

### Problems left open

| # | Problem | Heuristic | Severity | Suggested fix |
|---|---|---|---|---|
| O1 | A manager can reject a request with one click and gives no reason | 3 User control, 9 Help users recover | 2 | Ask for an optional reason and send it with the notification |
| O2 | "Free now" uses the crimson badge on manager room cards, while green means free elsewhere | 4 Consistency | 1 | Use the green status style everywhere |
| O3 | Suggestion cards often repeat the same reason text, so the reasons don't help choose between them | 2 Match with the real world | 1 | Show only what differs, e.g. "30 min earlier" or "Court 4, same type" |
| O4 | Toasts stay light in dark mode | 4 Consistency | 1 | Pass the app theme to the toast component |

No severity-4 problems were found.

### What already works well

- **Recognition rather than recall:** booking choices are chips and lists built from the room's own rules, so the form can't produce an invalid length or a date outside the advance window. "Book again" offers the last rooms used.
- **Visibility of system status:** a summary card shows the chosen room, day, time and group size. It says whether staff must approve and the cancellation deadline before the student commits. The step bar shows where you are.
- **Error prevention:** the database enforces the same rules again, so a request that slips past the page is still refused, with the same wording.
- **Help users recover:** a clash isn't a dead end. It is answered with ranked free alternatives.

## 3. Cognitive walkthrough

The four standard questions were asked at each step: will the user try to do the right thing, will they notice the control, will they connect it with their goal, and will they see that it worked?

**Student, first booking (T1).** Place card → room card → Day chip → Start time list → people "+" → "Request this time".

- **The four questions:** all steps pass. The heading changes with each step ("Where do you want to book?", "When do you need Court 1?"), so the next action is always named.
- **Minor risk:** the group size starts at 2 and a student may not change it. It is shown again in the summary card before booking, which limits the risk.

**Student, time taken (T2).**

- **The four questions:** pass. The clash message and the alternatives appear next to the button that was pressed, and one click on a card books it.
- **Risk:** this was the H4 toast covering the cards on phones, now fixed.

**Student, cancel (T4).**

- **The four questions:** failed on "will they see that it worked" before H1/H2. A cancel happened instantly, and a late cancel failed only after clicking.
- **After the fixes:** passes.

**Admin, new facility with two rooms (T7).**

- **The four questions:** pass. Each wizard step has one question and a preview (venue drawing, preset rules, generated room names).
- **One judgement call:** the preset rules are shown before they are applied, but a new admin may not know what "check-in grace" means. Its hint text explains it.

**Manager, approve a request (T6).** Passes. The queue is the first card on the page, and each request shows group size against capacity and a no-show risk badge with reasons.

## 4. KLM-GOMS task times

KLM predicts how long a practised user needs, from standard times per action: point 1.1 s, click 0.2 s, keystroke 0.28 s, hand to keyboard 0.4 s, think 1.35 s (Card, Moran and Newell, 1983). System waits are assumed: 0.5 s for a booking request and 1.5 s for a chatbot answer.

| Task | Predicted time |
|---|---|
| Book a court (T1) | 20.6 s |
| Book an AI suggestion after a clash (T2) | 5.9 s |
| Ask the chatbot if a room is free (T3) | 18.5 s |
| Cancel a booking, with the new confirmation (T4) | 9.8 s |
| Get a door code (T5) | 7.2 s |
| Manager approves a request (T6) | 5.9 s |
| Admin creates a facility with 2 rooms (T7) | 24.4 s |

| Design comparison | Ours | Alternative | Saved |
|---|---|---|---|
| Chip and list booking form vs a typical free-text form | 20.6 s | 34.9 s | 41 % |
| Clash: book a suggestion vs one manual retry | 5.9 s | 11.2 s | 48 % |
| Clash: book a suggestion vs three manual retries | 5.9 s | 33.5 s | 83 % |
| "Is a room free tonight?": chatbot vs checking 3 rooms by hand | 18.5 s | 48.0 s | 62 % |

Every comparison still favours our design with expert timings (keystroke 0.12 s, think 1.2 s) and with slower timings (keystroke 0.5 s, point 1.5 s). The full operator lists are in `klm.json`.

KLM models error-free expert use and ignores learning time, waiting for a page to load, and reading speed beyond one "think" per step. The figures support comparisons between designs rather than claims about real students.

## Limitations

- **No participants.** None of these methods measures satisfaction or learnability the way SUS does, so the SUS target in DS8 is reported as not tested.
- **Single evaluator.** The heuristic review and the walkthrough were done by the developer. Nielsen recommends three to five independent evaluators, because one evaluator finds roughly a third of the problems. A developer also knows the system too well to see it as a newcomer would.
- **Sample data.** The audit used sample data. Very long names or a very full schedule could show layout problems these screens didn't.

The recommended next step is a small SUS study (5–8 students), with the kit in `../user-study.md`.

## How to re-run

```bash
# 1. sample backend
node scripts/eval/ui/mock-supabase.mjs &
# 2. app built against it
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=mock npm run build && npm start &
# 3. audit (needs puppeteer-core + axe-core and a Chrome path)
CHROME="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/eval/ui/audit.mjs --shots
# KLM task times
npx tsx scripts/eval/klm.ts
```
