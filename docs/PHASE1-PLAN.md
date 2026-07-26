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

## Draft aim and objectives — for supervisor sign-off

Handbook rules: minimum 3 primary objectives at Bloom cognitive level 5/6, varied verbs, last objective must analyse/evaluate/monitor the system. Extensions can be vaguer.

**Aim:** To develop a smart campus facility reservation system that centralizes booking of university facilities through per-facility configurable rules, AI-assisted slot recommendations, and a chatbot for reservation queries.

**Primary objectives:**

1. To **design** a centralized web-based reservation platform for campus facilities (discussion rooms, sports courts, meeting rooms, event halls) with role-based access for students, facility managers, and administrators. (C6)
2. To **develop** a configurable rule engine that lets administrators set per-facility booking policies — operating hours, duration limits, occupancy restrictions, cancellation rules, and access permissions. (C6)
3. To **construct** an AI-assisted recommendation module that suggests optimal booking slots from facility availability, participant count, and user time preferences, supported by a chatbot for common reservation and policy queries. (C6)
4. To **evaluate** the developed system through functional testing and user acceptance evaluation, measuring booking-conflict reduction, recommendation relevance, and usability. (C5)

**Extensions (if time allows):** usage-trend analytics dashboard, booking notifications, multi-language chatbot.

**SDG mapping:** SDG 9 (resilient infrastructure, innovation) and SDG 4 (equitable access to educational facilities) as the two required in Chapter 1; the Professional Engineering Practices section needs at least eight — candidates: 3, 4, 7 (energy-efficient cloud vs physical queueing), 8, 9, 10 (equal access), 11, 12, 16.

## Report structure and marks

Target 6,000–8,000 words. Times New Roman 12, 1.5 spacing, APA references, front matter in Roman numerals.

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
