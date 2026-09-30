# Supervisor meeting logs

Copy each row into the matching box on the form.

Fix the dates to when you actually met, and cut anything your supervisor didn't say.

---

## Meeting 1 — Scope and title
**27 June 2026**

| | |
|---|---|
| **Items for Discussion** | • Confirm the title and scope<br>• Which facilities to include<br>• SDG requirement<br>• Phase 1 deliverables and how often we meet |
| **Record of Discussion** | • Went through the title proposal. Agreed on four parts: online booking, rules the admin sets, AI slot suggestions, chatbot.<br>• Keep the scope to facility booking only, not all campus resources.<br>• Supervisor: need at least three objectives, Bloom level 5/6 verbs, extensions listed separately.<br>• Two SDGs is not enough. |
| **Action List** | 1. Draft the aim and objectives<br>2. Read the handbook, write a Phase 1 plan<br>3. Set up the repo and tech stack<br>4. Start collecting papers |

---

## Meeting 2 — Objectives and the AI choice
**11 July 2026**

| | |
|---|---|
| **Items for Discussion** | • Draft aim and objectives<br>• How to search for papers<br>• Which AI method for slot suggestions<br>• Which chatbot model |
| **Record of Discussion** | • Objectives reviewed. Vary the verbs, make the last one evaluation, keep extensions separate.<br>• Papers: last five years, three topics — booking systems, recommenders, chatbots in universities. Get 12–15, then narrow down.<br>• No booking history at launch, so nothing to train a model on. Agreed on rule-based scoring that learns its weights, with the language model only for the chatbot.<br>• Use a free-tier model, behind a wrapper so it can be swapped. |
| **Action List** | 1. Redo the objectives with Bloom 5/6 verbs<br>2. Build the table of papers<br>3. Draft the database and how to stop double bookings<br>4. Set up the model API |

---

## Meeting 3 — Plan, ethics, double bookings
**18 July 2026**

| | |
|---|---|
| **Items for Discussion** | • Phase 1 plan and timeline<br>• Ethics forms<br>• How to stop double bookings<br>• Word limit and formatting |
| **Record of Discussion** | • Report due week 12, presentation week 13 or 14. Word limit 6,000–10,000.<br>• Ethics is the risk. No user testing in Phase 2 without approval, so submit early.<br>• Showed the double-booking plan: let the database refuse overlaps instead of checking in code. Still works if two people book the same second. Supervisor said treat it as a contribution, not a detail.<br>• Agreed on row-level security so managers can't touch facilities they aren't assigned to. |
| **Action List** | 1. Write the ethics forms<br>2. Build the database with the security and no-overlap rules<br>3. Start Chapter 1 and Chapter 3<br>4. Build the booking flow |

---

## Meeting 4 — Chapter 2 and demo
**25 July 2026**

| | |
|---|---|
| **Items for Discussion** | • Chapter 2 draft<br>• Demo of the system<br>• Chapter 3 and diagrams |
| **Record of Discussion** | • Chapter 2 has to be redone. Review the papers one by one, not by theme. Four headings each: problem, method, outcomes, gaps.<br>• Also need a 5W1H table and a summary table with a gaps column.<br>• Demoed the system — browsing, booking with rule checks, AI suggestions when a slot is taken, approvals, admin rule editor.<br>• Report has to match what is actually built.<br>• Diagrams needed: use case, ERD, booking flow, admin setup. |
| **Action List** | 1. Redo Chapter 2 paper by paper, all eleven<br>2. Add the 5W1H and summary tables<br>3. Make the diagrams from the real system<br>4. Update Chapter 3 to match the database |

---

## Meeting 5 — Checking against the module slides
**8 August 2026**

| | |
|---|---|
| **Items for Discussion** | • Report against the Chapter 1, 2 and 3 slides<br>• SDGs and social awareness<br>• Is the design chapter complete<br>• Are the references real |
| **Record of Discussion** | • Checked the report against the module slides. Several gaps.<br>• Chapter 1 needs social awareness and at least eight SDGs. Draft had two, and never used the words "social awareness".<br>• Chapter 3 missing four things from the slide list: assumptions, design specs table, designed parameters table, interface with explanation.<br>• Nothing on continuous professional development or life-long learning. "Public health and safety" missing too.<br>• Every reference to be verified before submitting. |
| **Action List** | 1. Rewrite Chapter 1 with social awareness and eight SDGs<br>2. Add the assumptions, both tables, and the interface section<br>3. Add professional development and public health<br>4. Verify all eleven references<br>5. Recheck the word count after every change |

---

## Meeting 6 — New problem statement and presentation
**14 August 2026**

| | |
|---|---|
| **Items for Discussion** | • What booking systems universities actually use<br>• Is the problem statement still true<br>• Revised objectives<br>• Presentation plan |
| **Record of Discussion** | • Problem statement is out of date. It says booking is manual. LibCal runs at 7,500 institutions, including Monash Malaysia and Sunway.<br>• Reframed it around what online booking has not fixed: booking is easy and no-shows cost nothing, so people book early, long and bigger than they need. Screen says full, building isn't.<br>• Sunway's booking page sets a minimum group size of three for a ten-seat pod, and makes students walk to a counter within fifteen minutes to prove they came. Rules on a page, enforced by staff.<br>• Present that as evidence, not as a dig at Sunway.<br>• Objectives go from four to five, so the recommender and the chatbot each stand on their own.<br>• Presentation: module slide order, fifteen minutes max, invite supervisor and second marker. |
| **Action List** | 1. Rewrite section 1.2 with the new problem and the Sunway evidence<br>2. Add a Chapter 2 section on systems in use today<br>3. Finish the slides, practise with a timer<br>4. Book the slot with supervisor and second marker<br>5. Cover page, contents page, Turnitin<br>6. Chase the ethics submission |

---

If any action actually slipped to the next meeting, put it there. Six meetings where everything closed on time looks made up.
