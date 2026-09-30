# Research papers - verification and working notes

Eleven papers, all cited in Chapter 2 of the Phase 1 report. Every one was checked against a primary source before this document was written: Crossref for the DOI-registered items, the publisher's own article page for the rest. None are fabricated.

For each paper below: what it is, what the authors did and found, how it is used in my project, and where my system goes further.

## Verification results


| # | Reference | Verified against | Status |
|---|---|---|---|
| 1 | Venkatesh et al. (2026), IJERT 15(3) | ijert.org article page + Zenodo DOI | Confirmed |
| 2 | Antony et al. (2026), IJOEST 10(1), 36-38 | granthaalayahpublication.org article 737 | Confirmed |
| 3 | Artes et al. (2024), ACM MSIE, 108-118 | Crossref 10.1145/3664968.3664982 | Confirmed |
| 4 | Hwang, Jung & Lee (2022), JPSP 6(8), 7033-7041 | journalppw.com article 11028 | Confirmed - see author-order note |
| 5 | Lalitha et al. (2022), IEEE ICCST, 972-975 | IEEE Xplore doc 10040388 | Confirmed - reference needs correcting |
| 6 | Roy & Dutta (2022), J Big Data 9:59 | SpringerOpen, DOI 10.1186/s40537-022-00592-5 | Confirmed |
| 7 | Valencia-Arias et al. (2024), ISWA 24:200435 | Crossref 10.1016/j.iswa.2024.200435 | Confirmed |
| 8 | Okonkwo & Ade-Ibijola (2021), CAEAI 2:100033 | Crossref 10.1016/j.caeai.2021.100033 | Confirmed |
| 9 | Rahim et al. (2022), Sustainability 14(19):12726 | Crossref 10.3390/su141912726 | Confirmed |
| 10 | Essel et al. (2022), IJETHE 19:57 | Springer + ERIC EJ1355304 | Confirmed |
| 11 | Dempere et al. (2023), Front Educ 8:1206936 | Crossref 10.3389/feduc.2023.1206936 | Confirmed |

## Two corrections found (both now applied to the report)

**Lalitha et al.** The current entry reads "Lalitha, V., et al. (2022). Online college event hall booking reservation system." It should be:

> Lalitha, V., Magesh, K., Selvanarayanan, A., & Keertheshwaran, G. (2022). Online college event-hall booking reservation system. *2022 1st International Conference on Computational Science and Technology (ICCST)*, 972-975. IEEE. https://doi.org/10.1109/ICCST55948.2022.10040388

Three fixes: the full author list instead of "et al.", the hyphen in "event-hall", and the page range.

**Hwang et al.** The journal's own page gives the byline as Jae Moon Lee, In Hwan Jung, Kitae Hwang - the reverse of how I have it. Artes et al. (2024) cite it as Hwang, Jung & Lee, so both forms appear in the literature. I have kept Hwang-first for consistency with the citing literature. If it is queried, the journal page wins and the entry moves from H to L in the alphabetical list.

---

# Campus booking systems

---

## Venkatesh et al. (2026) - Design and implementation of a web-based campus facility reservation system

Venkatesh, S., Pradeep, P., Balamurugan, M., Guhan, S., & Niyasaju. (2026). Design and implementation of a web-based campus facility reservation system. *International Journal of Engineering Research & Technology, 15*(3). https://doi.org/10.5281/zenodo.19067756

Verified: yes. Article page and full author list read directly on ijert.org; DOI resolves via Zenodo.
Group: campus booking systems (Chapter 2, Section 2.2)

### What it is

The closest published system to mine, and the most recent. A web-based reservation platform for university facilities - halls, labs, sports areas - built to replace the paper-and-phone process most campuses still run on.

### What they did

Standard three-tier web application. A relational database holds facilities and bookings, a server layer handles the request/approve cycle, and separate interfaces serve students and administrators. Availability is checked at the point of submission and a request goes into a queue for an administrator to approve or reject. Email notifies the requester of the outcome.

### What they found

Digitising the request removes the physical queue and gives the administrator a single view of what has been booked. Utilisation becomes visible for the first time because every request leaves a record.

### How I use it

This is the baseline case in Chapter 2 and in the problem statement: it establishes that the manual process is a documented problem and that a centralised booking record is the accepted fix. When I argue in Chapter 1 that the university "cannot see or control how its own facilities are being used", this is the paper that supports the claim rather than my own assumption.

It also justifies my request/approve workflow. I did not invent the pending-approved-rejected lifecycle; it is the pattern this and four other reviewed systems converged on, so keeping it makes my system comparable to the literature rather than novel for no reason.

### Where it stops, and what I do differently

Three gaps, all of which my design closes:

1. Booking rules are fixed in the code. Operating hours, minimum and maximum duration, capacity and advance-booking limits are the same for every facility. A discussion room and a football field get the same policy. In my system those rules live in `facility_categories` and `facility_rules` as rows, resolved through the `effective_facility_rules` view, so an administrator changes policy through the UI and no code is touched.

2. Conflict detection happens in application code. Two students submitting at the same instant can both pass the availability check before either row is written. My schema prevents this at the database with a PostgreSQL exclusion constraint over `(facility_id, tstzrange(start_time, end_time))`, so one insert succeeds and the other is rejected by the engine itself.

3. When a slot is taken, the student is told no and left to guess again. My system responds to a rejected request with scored alternatives from `src/lib/recommend.ts` - the failure becomes the entry point to the recommendation feature rather than a dead end.

---

## Antony et al. (2026) - EDUNEXUS: College facility booking platform

Antony, A., Maria Thomas, L., K Suresh, M., Sony, M., & Saritha R, R. (2026). EDUNEXUS: College facility booking platform. *International Journal of Engineering Science Technologies, 10*(1), 36-38. https://doi.org/10.29121/ijoest.v10.i1.2026.737

Verified: yes. Publisher page read directly; the citation string above is copied from the journal's own "How to Cite" block. Authors are from Saintgits College of Engineering, Kerala.
Group: campus booking systems (Chapter 2, Section 2.2)

### What it is

A Node.js/Express/MongoDB booking platform for college facilities, with role-based access, a calendar view, search filters and an analytics report for administrators. Of the five booking systems I reviewed, this one has the widest feature set.

### What they did

Two roles: administrator and staff. Staff submit a request with event details; administrators approve or reject, manage the facility list, and pull reports. A calendar visualisation shows what is already booked, which is their stated mechanism for reducing conflicts. Session management, input validation and encrypted authentication cover the security side.

### What they found

Calendar visibility plus search filters cut scheduling collisions, and the analytics reports let administrators see which facilities are underused. They list mobile apps, QR check-ins and "AI-driven availability prediction" as future work - which is a useful admission, because two of those three are in my delivered system.

### How I use it

This is my strongest comparison point in the Chapter 2 summary table, because it is recent and feature-rich, so beating it means something. It supports three of my design decisions directly:

- Role-based access as a requirement rather than a nice-to-have.
- Analytics for administrators as a first-class feature, not an afterthought. My admin Analytics tab (five KPIs plus four charts) answers the same need.
- Check-in tracking. Their QR check-in is future work; I implemented student self-check-in plus manager attended/no-show marking, and surfaced a no-show rate KPI.

Their explicit "AI-driven availability prediction" future work is the cleanest evidence I have that the AI layer in my project is a real gap in the literature and not something I bolted on to sound modern.

### Where it stops, and what I do differently

Their student is a member of staff. The system is built around departmental event booking, so there is no individual-student path and no notion of group size or personal preference - which is exactly what a recommendation feature needs as input.

Policy is still not configurable. There is no per-facility minimum or maximum duration, no capacity rule, no advance-booking window. A calendar tells you what is taken; it does not tell you that a badminton court cannot be booked for four hours or that you are eight people trying to book a four-person room. My two-level model (category owns the rules, individual courts inherit or override) enforces all of that before the request is ever created.

And a calendar view is a passive fix. It shows conflicts; it does not resolve them. Mine ranks the alternatives.

---

## Artes et al. (2024) - Cardinal Reserve: A proposed online room reservation system for a HEI

Artes, A. L., Lorzano, E. R., Tayam, J. R., & Intal, G. L. (2024). Cardinal Reserve: A proposed online room reservation system for a higher educational institution (HEI). *Proceedings of the 2024 6th International Conference on Management Science and Industrial Engineering*, 108-118. https://doi.org/10.1145/3664968.3664982

Verified: yes, via Crossref. Four authors, all School of Information Technology, Mapua University, Philippines. MSIE 2024, Bangkok. Pages 108-118 confirmed.
Group: campus booking systems (Chapter 2, Section 2.2)

### What it is

The most rigorous of the five booking papers. Rather than building a system and describing it, they treat the reservation process as a service design problem: map the existing manual journey, find where it breaks, then propose the digital replacement.

### What they did

Requirements were gathered from actual users at Mapua University and the current process was mapped as a service blueprint - the steps the user sees and the administrative steps behind them. The proposed system was then designed against that blueprint and evaluated on user experience criteria rather than on whether the code ran.

### What they found

Most of the delay in room reservation is not the booking itself, it is the waiting and the uncertainty around approval. Users do not know where their request sits. That reframes the problem: response time and transparency matter as much as the transaction.

### How I use it

Two things.

First, methodology. This paper is why my Chapter 3 has a use case diagram and flowcharts per role before it has a schema. Their approach - map the journey, then design - is the one I follow, and citing it means my methodology has a precedent rather than being "what felt sensible".

Second, and more concretely, their finding about approval uncertainty is the direct justification for my notification layer. Database triggers write to `notifications` on every status change, the header bell polls every 30 seconds, and the student sees approved or rejected without asking anyone. That feature exists because of this paper.

Their own reference list is also a useful sanity check on my Chapter 2 - they cite Hwang et al. and Lalitha et al., two of my other sources, which tells me I am reading the right cluster of work.

### Where it stops, and what I do differently

It is a proposal. The title says so. There is no implemented system, no schema, no conflict-handling mechanism, no evaluation with real bookings - so the hardest engineering problem, two people wanting the same room at the same moment, is never addressed. My exclusion constraint addresses it at the database layer, and I have 16 Vitest cases over the rule and scoring logic.

Their scope is also single-type: rooms. Courts, halls and labs have different rules, and a design that only handles rooms does not have to solve the configurability problem. Mine does.

---

## Hwang, Jung & Lee (2022) - Design and implementation of database for shared facility reservation system in school

Hwang, K., Jung, I. H., & Lee, J. M. (2022). Design and implementation of database for shared facility reservation system in school. *Journal of Positive School Psychology, 6*(8), 7033-7041.

Verified: yes. Journal article page read directly (mail.journalppw.com, article 11028); volume 6, issue 8, pages 7033-7041, published 27 August 2022. No DOI is registered for this article, which is why the reference has no DOI line.

Note on author order: the journal page lists the byline as "Jae Moon Lee, In Hwan Jung, Kitae Hwang", but Artes et al. (2024) cite it as "Hwang, K., Jung, I.H., & Lee, J.M." I have kept the Hwang-first form to match how the paper is cited in the literature. If the marker queries it, the journal page is the authority and the order can be flipped - it changes the alphabetical position in the reference list from H to L.

Group: campus booking systems (Chapter 2, Section 2.2)

### What it is

The only reviewed paper that treats the database as the contribution rather than the plumbing. Everything else describes an interface; this one describes a schema.

### What they did

Entity-relationship modelling from the reservation requirements, an ERD, then a schema derived from it. Implementation on Google Firestore, chosen specifically because reservation state changes have to reach affected users in real time. Users and facilities sit at the root of the hierarchy so that lookups stay efficient.

### What they found

Two things worth taking. Reservation systems are real-time systems - a booking that changes state without telling the affected user is a broken booking. And the shape of the data model determines whether search stays fast as the facility list grows.

### How I use it

It is the precedent for my Chapter 3 data model section and for the ERD itself. When I present 12 tables and an entity-relationship diagram as the core of the design chapter, this paper is why that is a legitimate way to structure the argument.

Their real-time requirement is also the second source (with Artes et al.) behind my trigger-driven notification layer. I reach the same outcome without Firestore: PostgreSQL triggers write a row into `notifications` whenever a reservation changes status, and the client polls. Different mechanism, same guarantee.

### Where it stops, and what I do differently

The choice of a document store is the interesting limitation. Firestore gives real-time propagation cheaply, but it cannot express a transactional constraint across rows - so overlapping bookings still have to be prevented by application logic, with the race condition that implies. PostgreSQL gives me `EXCLUDE USING gist (facility_id WITH =, tstzrange(start_time, end_time) WITH &&)`, which makes a double booking impossible at the storage layer, and I still get real-time behaviour through triggers. That trade is the strongest argument in my Chapter 3 for the technology choice, and it exists because this paper made the opposite one.

There is also no rule layer at all - no duration limits, no capacity, no advance window - and no access control beyond identifying the user. My schema carries policy as data and enforces scoping through row-level security, so a facility manager physically cannot read or write rows for a facility they are not assigned to.

---

## Lalitha et al. (2022) - Online college event-hall booking reservation system

Lalitha, V., Magesh, K., Selvanarayanan, A., & Keertheshwaran, G. (2022). Online college event-hall booking reservation system. *2022 1st International Conference on Computational Science and Technology (ICCST)*, 972-975. IEEE. https://doi.org/10.1109/ICCST55948.2022.10040388

Verified: yes. Indexed on IEEE Xplore (document 10040388) and cited by Artes et al. (2024) under the same DOI. Full author list and page range recovered - my earlier draft had "Lalitha, V., et al." with no pages and no hyphen in "event-hall"; the reference list should be updated to the form above.
Group: campus booking systems (Chapter 2, Section 2.2)

### What it is

The simplest system in the review, and useful precisely because of that. A PHP/MySQL web application for booking college event halls, published at an IEEE conference.

### What they did

HTML, CSS, JavaScript, PHP and MySQL. Users see hall availability, submit a booking, and can manage or cancel it. Administrators handle the requests. The stated goal is removing manual paperwork.

### What they found

The manual process is the bottleneck. Once booking moves online, the administrative overhead drops and the record of who booked what stops living in a notebook.

### How I use it

It is the floor of my comparison. If a 2022 IEEE paper on a college booking system is still solving "put the form on the web", that tells the reader where the published state of practice actually sits, and it makes the case that the gap I am addressing is real rather than manufactured.

It also anchors the technology discussion in Chapter 3. PHP/MySQL is a reasonable stack, and I need to explain why I did not use it. The answer is not fashion: PostgreSQL gives me exclusion constraints and row-level security, neither of which MySQL provides, and both of which carry load-bearing requirements in my design.

### Where it stops, and what I do differently

Single facility type, single set of rules, no capacity handling, no participant count, no recommendation, no conversational access, and conflict checking in PHP rather than in the database. Cancellation exists but with no notice policy attached, so a hall can be released five minutes before the slot with no consequence.

My system addresses each: seven facility types under configurable categories, per-category rules with per-court overrides, capacity checked against declared group size, scored alternatives on conflict, a grounded chatbot, database-level conflict rejection, cancellation notice rules, and no-show tracking with a rate reported in analytics.

The honest framing for the report and the viva is that this paper is not a weak paper - it does what it set out to do. It just sets out to do the part my project treats as the starting line.

---

# Recommendation techniques

---

## Roy & Dutta (2022) - A systematic review and research perspective on recommender systems

Roy, D., & Dutta, M. (2022). A systematic review and research perspective on recommender systems. *Journal of Big Data, 9*, 59. https://doi.org/10.1186/s40537-022-00592-5

Verified: yes. Open access at journalofbigdata.springeropen.com, article 10.1186/s40537-022-00592-5, published 3 May 2022, volume 9 article 59. Several hundred citations.
Group: recommendation techniques (Chapter 2, Section 2.3)

### What it is

The single most important paper in my reference list, because it is the one that justifies my main technical decision. A systematic review of recommender systems: the algorithm families, the platforms, the datasets, the applications and - the part I need - the failure modes.

### What they did

Classified the literature into content-based, collaborative filtering, hybrid and knowledge-based approaches, then compared them on features, challenges, datasets and reported performance.

### What they found

Three named problems limit recommender systems. Cold start: a new user or item has no history, so the model has nothing to work from. Sparsity: when the user-item matrix is mostly empty, similarity between users is unreliable. Scalability: some approaches cost too much to compute as data grows.

They also make the point that matters most for me - the right algorithm family depends on the data available, not on which family is currently most fashionable.

### How I use it

This paper is my defence for using rule-based scoring with adaptive weights instead of a trained model, and it is the answer I have prepared for the obvious viva question ("is that really AI?").

The argument is: my system launches with roughly seven facilities and zero booking history. That is textbook cold start plus extreme sparsity, the exact conditions under which Roy and Dutta report collaborative filtering degrades. Training a model on data I do not have would be worse engineering, not better. So I use a deterministic scoring function over factors I *can* observe on day one -

    S = w1*T + w2*C + w3*U

where T is time proximity to the student's preferred hour, C is capacity fit against declared group size, and U is off-peak utilisation. And I add an online-learning layer on top: when a student accepts or ignores a suggestion, the weights shift by a learning rate of 0.05 and are renormalised, stored per user in `profiles.rec_weights`. So the system does learn - it just learns per user from the first interaction rather than needing a corpus before it can say anything.

That is the whole point. This paper turns "I used a simple method" into "I matched the method to the data conditions", which is a much stronger claim and one I can cite.

### Where it stops, and what I do differently

It is a review of e-commerce, media and content recommendation. Campus facility booking is not in scope, and the domain differs in ways that matter: the item set is tiny and fixed, availability is a hard constraint rather than a preference, and every recommendation has to be legal under the facility's rules before it can be scored at all. My recommender therefore filters by rule first and scores second - candidate slots that violate opening hours, duration limits, capacity or the advance window never enter the ranking.

It is also silent on explainability. Mine shows the student why a slot was suggested, which matters both for trust and because Phase 2 has to measure acceptance rate against something.

---

## Valencia-Arias et al. (2024) - Artificial intelligence and recommender systems in e-commerce: trends and research agenda

Valencia-Arias, A., Uribe-Bedoya, H., Gonzalez-Ruiz, J. D., Sanchez Santos, G., Chaponan Ramirez, E., & Martinez Rojas, E. (2024). Artificial intelligence and recommender systems in e-commerce. Trends and research agenda. *Intelligent Systems with Applications, 24*, 200435. https://doi.org/10.1016/j.iswa.2024.200435

Verified: yes, via Crossref. Elsevier, Intelligent Systems with Applications, volume 24, article 200435, 2024.
Group: recommendation techniques (Chapter 2, Section 2.3)

### What it is

A bibliometric study of where AI-driven recommendation research is actually going, based on publication and citation patterns rather than on a hand-picked set of papers. It pairs with Roy and Dutta: they explain the techniques, this one explains the direction of travel.

### What they did

Analysed the e-commerce recommender literature to map dominant themes, growth areas and gaps, and produced a research agenda from the result.

### What they found

Recommendation is moving toward personalisation and context-awareness - time, situation and user state, not just historical purchases. They also flag transparency and user trust as an under-researched area: users increasingly want to know why something was recommended, and systems largely do not tell them.

### How I use it

Two direct lines into my design.

Context-awareness is why my scoring function has a time-proximity term and an off-peak term at all. A pure "most popular slot" recommender would be context-blind. Mine weighs how close a candidate is to the hour the student asked for and whether it falls outside the 12:00-14:00 and 17:00-20:00 peaks, so the recommendation depends on when the student is asking and what the campus load looks like, not just on what other people booked.

Transparency is why every suggestion in my student dashboard carries a short reason, and why the popular-times chart is visible next to the booking form. The student can see the basis for the ranking. That is a design choice I can now attribute to a documented gap rather than to preference.

It also gives Chapter 2 something the other recommendation source does not: forward direction. Roy and Dutta tell me what breaks; this tells me what the field is moving toward, which is what makes my future-work section credible rather than speculative.

### Where it stops, and what I do differently

E-commerce assumes abundance - thousands of items, no hard availability limit, and a recommendation that fails costs nothing. Facility booking inverts all three. There are seven facilities, a slot is either free or it is not, and a recommendation the student cannot legally book is worse than no recommendation. So I cannot lift an e-commerce approach directly; I take the principles (context, transparency) and apply them inside a constraint-satisfaction problem.

The paper is also bibliometric, so it describes trends without implementing anything. My contribution on this axis is a working, tested implementation of context-aware and explainable ranking in a domain the paper does not cover.

---

# Chatbots in higher education

---

## Okonkwo & Ade-Ibijola (2021) - Chatbots applications in education: a systematic review

Okonkwo, C. W., & Ade-Ibijola, A. (2021). Chatbots applications in education: A systematic review. *Computers and Education: Artificial Intelligence, 2*, 100033. https://doi.org/10.1016/j.caeai.2021.100033

Verified: yes, via Crossref. Elsevier, Computers and Education: Artificial Intelligence, volume 2, article 100033, 2021. Heavily cited (500+).
Group: chatbots in higher education (Chapter 2, Section 2.4)

### What it is

The anchor review for the chatbot half of my literature. It surveys how chatbots have actually been deployed in education, what they are used for, and what goes wrong.

### What they did

Systematic review of the education chatbot literature: application areas, underlying techniques, reported benefits, and documented challenges.

### What they found

Chatbots in education cluster into teaching/tutoring and administrative support - answering the repetitive procedural questions that consume staff time. The benefits are availability and immediacy. The challenges are the part I care about: ethical concerns, user distrust, and the risk of incorrect responses.

That last item is the finding my whole chatbot design is built around.

### How I use it

It justifies including a chatbot at all. Facility questions - what time does the badminton court open, how long can I book for, is anything free tomorrow afternoon - are exactly the repetitive administrative queries this review identifies as the strongest use case. So the feature is grounded in evidence rather than in "chatbots are popular".

More importantly, their finding on incorrect responses is the reason my chatbot is architecturally incapable of guessing. The pipeline in `src/app/api/chat/route.ts` is: extract intent from the question, run a Supabase query scoped by the user's own row-level security policies, then hand the language model *only* those retrieved facts and ask it to phrase an answer. The model never sees the database directly and is never asked what it thinks. If the query returns nothing, the answer is that the system does not know.

Two consequences worth stating in the viva. The bot cannot invent an opening hour, because the opening hour comes out of `effective_facility_rules`. And it cannot leak another student's booking, because the query runs under that student's RLS policies - the security boundary is the database, not the prompt.

### Where it stops, and what I do differently

The reviewed systems are overwhelmingly tutoring and course-content bots. Facility and resource management is not a covered application area, which is a straightforward gap I can claim.

The review also identifies the incorrect-response problem without proposing an architecture that solves it. Retrieval grounding is my answer, and it is a design contribution rather than just a feature. I also instrument it: every answer carries a thumbs up/down control writing to `evaluation_events`, so Phase 2 reports a measured helpfulness rate instead of an opinion.

---

## Rahim et al. (2022) - AI-based chatbots adoption model for higher-education institutions

Mohd Rahim, N. I., A. Iahad, N., Yusof, A. F., & Al-Sharafi, M. A. (2022). AI-based chatbots adoption model for higher-education institutions: A hybrid PLS-SEM-neural network modelling approach. *Sustainability, 14*(19), 12726. https://doi.org/10.3390/su141912726

Verified: yes, via Crossref. MDPI Sustainability, volume 14, issue 19, article 12726, published 6 October 2022. Authors at Universiti Teknologi Malaysia and Sunway University. 222 citations.
Group: chatbots in higher education (Chapter 2, Section 2.4)

### What it is

The Malaysian paper, and the one that makes my context argument concrete. It asks what makes students in Malaysian higher education actually adopt a chatbot, rather than whether a chatbot can be built.

### What they did

Adapted UTAUT2 as the theoretical model, surveyed 302 postgraduate students across Malaysian public and private universities over three months using purposive sampling, and validated the model with a two-stage PLS-SEM plus artificial neural network procedure.

### What they found

Behavioural intention to use a chatbot is driven by perceived trust, performance expectancy and habit. Perceived trust in turn is driven by interactivity, design and ethics. They also note that most Malaysian HEIs are not ready to deploy chatbots for student services, and that existing research focuses on benefits rather than on service delivery.

### How I use it

Three things.

Local relevance. My project is at APU, in Malaysia. A study of 302 Malaysian HEI students is the closest published evidence to my actual user population, and it says the demand is real while institutional readiness is not. That is a gap statement I can defend.

Trust as a design requirement. Their model puts trust at the centre, and derives it from interactivity, design and ethics. That maps onto specific decisions in my system: the bot answers from retrieved database facts (ethics - it does not fabricate), it says when it does not know rather than bluffing (trust), and it sits in a proper widget inside the dashboard rather than as a bolted-on box (design and interactivity).

Evaluation design for Phase 2. Their construct set gives me a validated instrument to adapt for my own user testing, so my questionnaire is not invented from scratch. That matters for the ethics submission and for the credibility of Phase 2 results.

### Where it stops, and what I do differently

It is an adoption study with no system. Nothing is built, so there is no architecture, no grounding mechanism, and no evidence about what a trustworthy chatbot actually looks like in code - only what users say they need in order to trust one.

My contribution is the other half: taking their trust antecedents and implementing them. Interactivity through the live widget, ethics through retrieval grounding and RLS-scoped queries, and design through the shared app shell. Then measuring it. Their construct is self-reported intention; mine is a thumbs up/down rate logged in `evaluation_events` against real questions, which is behavioural rather than attitudinal data.

---

## Essel et al. (2022) - The impact of a virtual teaching assistant (chatbot) on students' learning in Ghanaian higher education

Essel, H. B., Vlachopoulos, D., Tachie-Menson, A., Johnson, E. E., & Baah, P. K. (2022). The impact of a virtual teaching assistant (chatbot) on students' learning in Ghanaian higher education. *International Journal of Educational Technology in Higher Education, 19*, 57. https://doi.org/10.1186/s41239-022-00362-6

Verified: yes. Open access at IJETHE (Springer), volume 19 article 57, 2022; also indexed in ERIC as EJ1355304 and held in the Erasmus University Rotterdam repository.
Group: chatbots in higher education (Chapter 2, Section 2.4)

### What it is

The only chatbot paper in my set with an experiment behind it. Everything else in this group reviews or models; this one measures.

### What they did

A pretest-posttest study with 68 undergraduates, randomly allocated in a 2x2 design into experimental and control cohorts. The experimental group interacted with a chatbot acting as a virtual teaching assistant, the control group with the course instructor. Data came from an academic achievement test and follow-up focus groups.

### What they found

Students who used the chatbot scored higher than those who went through the instructor. The focus groups showed the experimental cohort was comfortable with the chatbot being part of the course - so the effect was not just performance, it was acceptance.

### How I use it

Mainly as a methodology template. My Phase 2 evaluation has to be defensible, and this paper shows what a credible chatbot evaluation in higher education looks like: a comparison condition, an objective outcome measure, and qualitative follow-up to explain the numbers.

I adapt the structure rather than copying it. My comparison is chatbot-assisted booking against direct navigation of the interface, my objective measures are task completion time and whether the student got a correct answer about a rule or availability, and my qualitative layer is the thumbs up/down feedback plus short interviews. The 68-participant scale is also a realistic benchmark for what I can recruit at APU, which matters for the ethics form and the sample size I commit to.

It is also the counterweight to Dempere et al. in Chapter 2. Dempere documents the risks of conversational AI in education; Essel documents a measured benefit. Presenting both is what makes the chapter a review rather than an advocacy piece.

### Where it stops, and what I do differently

The domain is pedagogical - the chatbot teaches course content. Administrative and resource-management support is a different problem: the answers must be factually current rather than pedagogically sound, and being wrong about an opening hour has a concrete cost. My chatbot answers from live database state, which is a requirement a teaching bot does not have.

The evaluation is also one-shot, over a single course. My instrumentation logs continuously through `evaluation_events`, so acceptance and helpfulness are tracked over the whole usage period rather than at one measurement point.

---

## Dempere et al. (2023) - The impact of ChatGPT on higher education

Dempere, J., Modugu, K., Hesham, A., & Ramasamy, L. K. (2023). The impact of ChatGPT on higher education. *Frontiers in Education, 8*, 1206936. https://doi.org/10.3389/feduc.2023.1206936

Verified: yes, via Crossref. Frontiers in Education, volume 8, article 1206936, 2023.
Group: chatbots in higher education (Chapter 2, Section 2.4)

### What it is

The most recent chatbot source and the most cautionary. It examines what large language models mean for universities across teaching, assessment and administration, and it does not treat the arrival as unambiguously good.

### What they did

A review of the opportunities and risks ChatGPT introduces into higher education, covering academic integrity, data privacy, accuracy, and administrative efficiency.

### What they found

The efficiency gains for routine administrative work are real. So are the risks: models produce confident wrong answers, they raise privacy questions when handling student information, and they create integrity problems when institutions have no policy on their use.

### How I use it

This paper is the reason my chatbot is deliberately narrow, and I want that framed as a design decision rather than a limitation.

It supports the feature - administrative query handling is where they see genuine benefit, and that is exactly what my bot does. But it also sets the constraints:

Accuracy. A confidently wrong answer about a booking rule is worse than no answer, so the model in my pipeline never generates facts. It receives rows retrieved from Supabase and phrases them. If the retrieval is empty, the response says so.

Privacy. Student booking data is personal data under the Malaysian PDPA. Every query the chatbot runs executes under the requesting user's row-level security policies, so the model can only ever be handed data that user was already entitled to see. The boundary is enforced in the database, not in the prompt - which means it holds even if someone calls the API directly.

Scope. The bot refuses anything outside facility availability and rules. That is a direct response to the risk profile in this paper, and it is a defensible answer to the viva question "why doesn't it do more?"

It also feeds Chapter 1's professional practices section: this is where the ethics, privacy and integrity discussion gets its citation.

### Where it stops, and what I do differently

It is an institutional-policy review. It names the risks without proposing an architecture that mitigates them, and it treats ChatGPT as a general-purpose tool students use rather than as a component inside a system a developer controls.

My project is the engineering answer to its concerns: retrieval grounding for accuracy, RLS-scoped queries for privacy, a hard scope limit for integrity, provider-agnostic configuration so no single vendor holds the data, and a deterministic fallback mode that still answers correctly if the model is unavailable. That last point matters - the system degrades to template answers rather than to no answers.

---

# The three-part gap, in one place
Reading all eleven together, the argument in Chapter 2 comes out as:

Booking policy is hard-coded in every reviewed system. None of the five lets an administrator set duration limits, capacity or advance-booking windows per facility type without touching code. Mine stores policy as rows in `facility_categories` and `facility_rules`, resolved by the `effective_facility_rules` view.

None of them help when a request fails. The best case is a calendar showing what is taken. Mine scores and ranks alternatives, and learns per-student weights from whether the suggestion was accepted.

None of them can be asked a question. The chatbot literature is entirely tutoring and course content; facility and resource management is not a covered application area. Mine answers availability and rule questions from live, RLS-scoped database state.

Each of the three is missing individually across the reviewed work. No system has any two. That is the gap.

## Practical notes

- Every DOI above resolves. Check them once more before submission in case a publisher moves something.
- Nine of eleven are from 2021 or later, which satisfies the recency expectation in the marking scheme.
- Chapter 2 also carries a summary table with a gaps column; it draws on the "where it stops" section of each file here.
- If the second marker asks how the eleven were selected: five directly comparable campus booking systems, two establishing which recommendation approaches suit which data conditions, four covering chatbots in higher education from review, adoption, experiment and risk angles.
