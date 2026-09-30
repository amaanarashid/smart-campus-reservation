# Phase 1 execution plan

Smart Campus Facility Reservation System with AI-Assisted Recommendations
Amaan Rashid — APU Year 4, FYP Phase 1 (Investigation)

Current position: **week 7**. Investigation report due **week 12**, oral presentation **week 13/14**. That leaves 5 working weeks, so the literature review starts now and chapters get drafted in parallel with the prototype.

## Admin status — confirm at this meeting

These were due before week 7. Confirm each is done; anything outstanding gets fixed this week.

- [ ] Ethics form signed by supervisor and submitted (was due week 5)
- [ ] Project Specification Form submitted online and approved (was due week 6)
- [ ] Log sheets up to date — mandatory meeting every 2 weeks from week 2, copy to admin + supervisor
- [ ] Turnitin account set up via Moodle
- [ ] Title approval status (proposal was pending — check FYPPGBank)

## Aim and objectives

Handbook rules: minimum 3 primary objectives at Bloom cognitive level 5/6, varied verbs, last objective must analyse/evaluate/monitor the system. Extensions can be vaguer. The Chapter 1 lecture deck adds that the aim, objectives and justification must foster social awareness and integrate at least eight UN-SDGs.

**Aim:** To build one booking system for every kind of campus facility, in which an administrator sets the rules without a developer, the database itself refuses to double-book, a student who cannot get the time they wanted is offered the next best options, and questions about availability and rules are answered in plain language — making the sharing of campus space visible and fair, and contributing to at least eight UN-SDGs.

**Primary objectives:**

1. To **design** a two-level facility model in which booking policy is inherited: a category holds the rules, its rooms follow them, and any one room may override a single value — so incompatible facility types are governed within one schema and a new type is added by configuration, not code. Attendance is recorded so unused space becomes measurable. (C6) — SDG 11, 12
2. To **build** the booking rules and the no-overlap condition into the database rather than the program, so conflict-freedom holds whatever the application does: no sequence of simultaneous requests can produce two bookings for the same facility at the same time. (C6) — SDG 9, 10
3. To **construct** a recommendation engine that answers an infeasible request with ranked alternatives rather than a refusal, scoring on time proximity, capacity fit and off-peak load, and adapting those weights per student by online learning. Every factor stays inspectable. (C6) — SDG 7, 3
4. To **develop** a conversational assistant whose answers are constrained to records retrieved under the asking student's own authorisation, so fabrication and disclosure are prevented by construction rather than by instruction. (C6) — SDG 4, 8
5. To **evaluate** against stated criteria: zero overlapping reservations under concurrent load, acceptance rate and rank of suggestions, assistant accuracy against a known-answer set, no-show rate before and after check-in, and SUS above 68. (C5)

**Extensions (if time allows):** usage-trend analytics dashboard, booking notifications, multilingual assistant.

**SDG mapping:** all eight (3, 4, 7, 8, 9, 10, 11, 12) are distributed across objectives 1–4 and mapped in full in report Table 3.5.

**What each objective delivers that no available product does:** 1 spans facility types that commercial products keep separate; 2 is a guarantee in the storage engine rather than a check in application code; 3 ranks alternatives and learns per student; 4 is student-facing and scoped to the individual asking.

## Report structure and marks

Target 6,000–10,000 words (supervisor-confirmed; the handbook figure of 6,000–8,000 is superseded). Current body: 10,030 including tables, 9,049 excluding them. Times New Roman 12, 1.5 spacing, APA references, front matter in Roman numerals.

| Component | Weight | Contents |
|---|---|---|
| Ch 1 — Introduction | 10% | Research problem, aim + objectives, justification, ≥2 SDGs, chapter organization |
| Ch 2 — Literature review | 20% | ≥10 papers (journal/conference, ≤5 years old), 5W1H critical framework, similar systems comparison, gaps, contribution |
| Ch 3 — Concept design & methodology | 30% | Tools/techniques investigation, proposed methodology, concept design (architecture, ERD, wireframes, module design) |
| Ch 3 — Professional engineering practices | 10% | Standards, safety/health/social/legal responsibilities, ≥8 SDGs |
| Ch 3 — Project management, finance, entrepreneurship | 10% | Gantt chart for both phases, estimated cost analysis, marketing strategy |
| References, citation, formatting | 10% | APA style, correct front matter, figure/table lists |
| Oral presentation | 10% | Week 13/14, supervisor + second marker |

Compulsory appendices: log sheets, draft proposal/FYP Bank confirmation, PSF, ethics form.

## Week-by-week

**Week 7 (now)** — Supervisor meeting: sign off aim/objectives and methodology direction; clear any overdue admin. Collect 12–15 candidate papers (AI recommendation systems, smart campus booking, chatbots in service systems, room scheduling algorithms). Build the 5W1H review matrix.

**Week 8** — Draft Chapter 2: critical review of the 10 best papers, similar-systems comparison table (existing booking platforms: FMS, Skedda, campus in-house systems), gap analysis pointing at configurable rules + AI recommendations. Log sheet meeting.

**Week 9** — Draft Chapter 1 (problem, justification, SDGs). Start Chapter 3: tools investigation (Next.js/Supabase vs alternatives, LLM API options for chatbot, recommendation approach — rule-based scoring vs collaborative filtering vs LLM-assisted) with justified selections.

**Week 10** — Finish Chapter 3 concept design: system architecture diagram, ERD, wireframes for the three role dashboards, module breakdown, booking-conflict logic design. Write professional engineering practices section (8 SDGs). Log sheet meeting.

**Week 11** — Gantt chart (Phase 1 actual + Phase 2 planned), cost estimate (hosting, Supabase tier, LLM API usage, domain), conclusion chapter, references cleanup, front matter, formatting pass, Turnitin check and revisions.

**Week 12** — Buffer for supervisor feedback and corrections. Submit report.

**Week 13/14** — Presentation slides (problem → objectives → lit review findings → concept design → plan for Phase 2), rehearse, present.

**Parallel track (weeks 7–12):** build the prototype foundation — Supabase schema + auth + basic booking flow. The handbook explicitly advises building during Phase 1 for time management, and working screenshots strengthen both the concept-design chapter and the presentation.

## Split of work

I draft chapters, diagrams, the review matrix, Gantt, cost tables, slides, and prototype code. You: run drafts past your supervisor, keep log sheets signed and submitted, run Turnitin, and make the calls on methodology choices. Attendance matters — under 80% costs marks in the PM component.
