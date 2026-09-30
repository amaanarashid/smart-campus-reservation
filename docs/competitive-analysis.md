# Commercial booking systems: what universities actually run, and where this project stands

Chapter 2 currently reviews eleven academic papers. It does not review a single product that a university can buy today, and that is the obvious hole a second marker will put a finger in: *"LibCal already does this. Why are you building it?"*

This document answers that question honestly. Some of my gap claims survive contact with the commercial market unchanged. Two do not, and need narrowing before the viva.

The lecturer's Chapter 2 slides list "company whitepapers, company websites, blogs" as legitimate sources and "similar systems" as a body element, so this material belongs in the report, not just in my head.

---

## The market is segmented by facility type, and that is the real gap

This is the most useful thing I found, and it reframes the whole project.

There is no single "university booking system" market. There are four, each sold to a different department, each with its own incumbent:

| Segment | Who buys it | Incumbents | What it covers |
|---|---|---|---|
| Library spaces | The library | **LibCal** (Springshare) | Study rooms, seats, equipment lending, consultations |
| Timetabling and events | Registrar, facilities | **25Live** (CollegeNET), **EMS** (Accruent), **Ad Astra** | Classrooms, lecture theatres, event halls, approval workflows |
| Campus recreation | Sports centre | **InnoSoft Fusion**, **Univerus** | Courts, gyms, memberships, access control, point of sale |
| Generic rooms and desks | IT, facilities | **Skedda**, **Robin**, **MIDAS**, **Condeco** | Meeting rooms, hot desks, sold cross-sector |

The consequence for a student is fragmentation. City University of Hong Kong documents it plainly on its own IT services pages: rooms are booked through one system, while "sports facilities such as gym and courts can be booked via a separate Sports Facilities Booking System maintained by the Student Development Services." Different systems, different logins, different rules, different interfaces, for what is to the student one task — find somewhere to be at 3pm.

**This is a stronger gap statement than the one currently in my report**, because it is a real, documented, present-day problem rather than an absence in the literature. My two-level model (`facility_categories` owns policy, `facilities` inherit) exists precisely so that a discussion room, a badminton court and an event hall can live in one system under one login with three different rule sets. None of the four incumbents can do that, because each was built for one segment and sold to one department.

---

## The systems in detail

### LibCal (Springshare) — the one to know

The dominant product in academic libraries: Springshare claims 7,500 institutions across 106 countries. If APU's library takes online room bookings, there is a good chance this is what it runs. Assume the panel has used it.

What it has, and I should not pretend otherwise:

- Customisable booking rules and limits **per category of space**, with different booking forms per category
- Granular access permissions, and restriction of bookings to user groups via LibAuth
- Check-in on mobile, wall-mounted tablets, or QR code, plus smart lock integration
- Utilisation heatmaps and real-time reporting
- Payments, overdue fines, waitlists
- LibMaps: a visual floor plan with colour-coded live availability
- Full read/write API

What it does not have:

- **Any recommendation.** If your slot is taken, you get a grid and you hunt.
- **Any conversational interface to availability.** Springshare's chatbot is a different product (LibAnswers) and their own announcement is explicit that it is *"rule-based, not AI"* — it routes to FAQs and hands off to human operators. It does not answer "is the futsal court free Friday evening" from live data, because it has no access to live data.
- **Anything outside the library.** It is sold to libraries, priced per calendar/room, and scoped to library services.

Pricing is quote-based and confidential. One published 2021 public-library renewal was USD 1,272/year for up to 50 rooms, so a mid-size academic deployment is plausibly a few thousand US dollars annually, recurring.

### MIDAS — the closest competitor, and the reason two of my claims need narrowing

A 20-year-old generic room booking product, and the one that genuinely overlaps my AI features.

**Intelligent Booking Alternatives.** When a space is unavailable, MIDAS suggests earlier or later slots the same day, the same slot on adjacent days, or alternative rooms. This is real, it ships today, and it directly overlaps my recommendation feature.

But read how it works: *"Administrators define which rooms should be suggested as alternatives for each other. A room isn't automatically considered a substitute for every other room — you specify the relationships."* The alternatives are a hand-maintained substitution table. There is no scoring, no ranking by fit, nothing that considers the size of *this* group against the capacity of *that* room, and nothing that learns from whether the suggestion was taken.

**MCP server (July 2026).** MIDAS now exposes its booking system to Claude, ChatGPT and Gemini over the Model Context Protocol — check availability, add bookings, approve requests in plain English. This is the newest thing in the market and it is a month old.

But again, read the details: it is an **admin add-on**, not a student feature. You generate a confidential MCP key, optionally restrict by IP, and configure it to "inherit the permissions of a specific user account" — one account, one permission set. The person using it needs their own AI assistant subscription. A student cannot ask it anything; it is a tool for whoever holds the key.

### 25Live, EMS, Ad Astra

Campus-wide scheduling built around the registrar's problem: which class goes in which room, event approval chains, institution-wide reporting. Powerful, expensive, and aimed at staff. A student is generally not a first-class user.

### Skedda

Clean, calendar-first, sold cross-sector rather than to universities specifically. Strong conditional rules — booking and pricing conditions on space, duration, time of day, day of week and user tag. Published pricing: from USD 99/month for 15 spaces, USD 199/month for 25. Priced per bookable space, which for a campus with hundreds of rooms is the wrong shape of pricing.

### InnoSoft Fusion

Campus recreation: courts, gyms, memberships, access control, point of sale. Used at Toronto and Colorado among others. Confirms the segmentation point — the sports centre buys its own system, separate from the library's.

---

## Honest test of my three gap claims

### Claim 1 — "Booking policy is hard-coded; no system makes it configurable per facility"

**Status: false as stated, of commercial products. Must be narrowed.**

LibCal has per-category rules. Skedda has conditional rules on space, duration, time and user tag. MIDAS has venue-level configuration. Configurable policy is a solved, commodity feature in the commercial market — it is only absent from the five *academic papers* I reviewed.

**Reworded claim that is defensible:**

> Configurable policy exists in commercial products, but always within one facility segment. No available system carries per-type policy across library spaces, sports courts and event halls in a single deployment, because each product was built and sold for one segment. My contribution is the inheritance model that makes heterogeneous facility types configurable in one schema.

That is narrower, true, and more interesting than the original.

### Claim 2 — "No system helps when a request fails"

**Status: partly false. MIDAS does this. Must be narrowed.**

**Reworded claim that is defensible:**

> Where alternatives are offered at all, they come from an administrator-maintained substitution table (MIDAS). No system *ranks* alternatives by fit — group size against room capacity, distance from the requested hour, campus-wide load — and none adapts to whether the individual student accepted the last suggestion. My scoring function does both, and every factor stays inspectable so the student is told why.

The learning layer, equation 3.6, is the part nobody else has. Lead with it.

### Claim 3 — "No conversational access to availability"

**Status: still holds, but only with the qualifier. Narrow it.**

LibAnswers is rule-based by Springshare's own admission and is not connected to live bookings. MIDAS's MCP server *is* conversational access to live data — but it is a keyed admin add-on scoped to a single account, requiring the user to bring their own AI subscription.

**Reworded claim that is defensible:**

> Conversational access to booking data has just reached the market as an administrator add-on scoped to a single service account (MIDAS, July 2026). No system offers it to the student, in the product, with every query authorised as that individual student. In my design the retrieval runs under the asking student's own row-level security context, so the assistant is structurally incapable of revealing another student's booking — the boundary is the database, not the prompt.

This is the strongest of the three and the most current. Being able to name a feature that shipped last month is worth marks on its own.

---

## What survives — the honest positioning

Four things I can defend against any product on the market:

1. **One system across facility segments.** Not library-only, not sports-only. Policy inheritance is what makes that possible.
2. **Ranked, explained, self-adjusting alternatives.** Not a hand-maintained substitution table. Scored on capacity fit, time proximity and campus load, with weights that move per student.
3. **Per-student grounded assistance inside the product.** Not an admin key on a shared service account.
4. **Conflict prevention in the storage engine.** Nobody advertises this because it is invisible when it works, but a PostgreSQL exclusion constraint is a stronger guarantee than any application-level check, and it is the one claim in my project that is provable rather than arguable.

And one thing I should stop claiming: that configurable rules are novel. They are not. The *cross-segment* application of them is.

---

## The evidence I was missing

The Michigan Daily published a student column on library study rooms that documents, from the user side, the exact failures my scoring function targets:

- Students booking **eight consecutive hours** at 11:59pm the moment the next week opens, monopolising rooms — which is what a maximum-duration rule plus an advance-booking window exists to prevent
- Small groups taking rooms sized for large ones, **"leaving empty chairs behind"** — which is precisely what my capacity-fit term C penalises

Multiple institutions (Pacific, Camosun, Duke Law) publish 15-minute no-show forfeiture policies, enforced by staff walking the floor. My check-in and no-show tracking automates that enforcement and turns it into a reported rate.

This is real-world evidence that my design decisions target real problems, from outside my own head. It belongs in Chapter 1's problem statement.

---

## What to change

**Report, Chapter 2** — add a short subsection, roughly 300 words, reviewing commercial systems as grey literature: the four segments, LibCal and MIDAS in a sentence each, and the fragmentation finding. Then restate the three gaps in their narrowed form. This closes the "why not just buy it" hole and shows awareness of the state of practice, not just the state of research.

**Report, Chapter 1** — add the Michigan Daily monopolisation and empty-chairs evidence to the problem statement. Two sentences.

**Report, Section 3.6** — the marketability argument needs adjusting. "No modification per institution" is still true, but the competitive claim should be cross-segment coverage at zero licence cost, against Skedda at USD 99–199/month per 15–25 spaces and LibCal at a confidential annual quote.

**Deck, slide 9** — the five academic systems table is fine, but consider adding a sixth row for "commercial products (LibCal, MIDAS, Skedda)" with the honest gap: "configurable, but each within one facility segment."

**Deck, slide 11** — reword the three gaps to the narrowed versions above. The current wording is the version a knowledgeable second marker can break.

**Speaker notes** — add the "why not just buy LibCal?" answer. It is now the single most likely question.

Word budget: the report body is 9,586 words including tables against a 10,000 limit, so about 400 words of headroom. The Chapter 2 subsection fits if something else gives; Chapter 3 has the most trimmable prose.

---

## Prepared answers

**"Why not just buy LibCal?"**
Because LibCal is sold to libraries and scoped to library spaces. It would solve the discussion rooms and leave the badminton courts, the futsal pitch and the event halls where they are — which at many universities means a second system from a different vendor bought by a different department. My contribution is the inheritance model that puts all of them under one policy engine. And LibCal has no recommendation at all: if your slot is taken you get a grid and you hunt.

**"MIDAS already suggests alternatives. How is yours different?"**
MIDAS suggestions come from a substitution table an administrator maintains by hand — this room may stand in for that one. There is no ranking. Mine scores each candidate on capacity fit against the declared group size, proximity to the requested hour, and campus-wide load, then adapts the weights to the individual student based on what they accept. The MIDAS approach cannot tell that a six-person group should not be offered a two-person room; mine scores that at 0.4 instead of 1.0.

**"MIDAS has an MCP server now — that's conversational booking."**
It is, and it shipped last month, so it is a fair challenge. But it is an administrator add-on: you generate a key, optionally restrict it by IP, and it inherits the permissions of one nominated account. The student never touches it, and they would need their own AI subscription. Mine is in the product, available to every student, and each query executes under that student's own row-level security context — so it cannot return another student's booking even if the model were asked to.

**"Is configurable booking policy really novel?"**
No, and I would not claim it is. It is standard in commercial products. What is not available is configurable policy spanning library rooms, sports courts and event halls in one system, because each product was built for one segment and sold to one department. The novelty is the cross-segment inheritance model, not the configurability itself.

---

## Sources

- [LibCal — Springshare](https://www.springshare.com/libcal)
- [Springshare announces LibAnswers Chatbot (rule-based, not AI)](https://blog.springshare.com/springshare-newsroom/2023/02/15/springshare-announces-libanswers-chatbot)
- [Managing room reservations for libraries of all sizes — Springshare blog](https://blog.springshare.com/2025/05/managing-room-reservations-for-libraries-of-all-sizes)
- [MIDAS — Intelligent Booking Alternatives](https://mid.as/features/booking-alternatives)
- [Introducing the MIDAS MCP Server (July 2026)](https://mid.as/blog/midas-mcp-server-ai-booking-scheduling/)
- [Skedda pricing rules](https://support.skedda.com/en/articles/105740-pricing-rules)
- [Skedda for universities and education centres](https://www.skedda.com/solutions/education-centers-booking-system)
- [InnoSoft Fusion — recreation management software](https://www.fusionfamily.com/fusion)
- [Booking systems — City University of Hong Kong IT Services (separate systems for rooms and sports)](https://www.cityu.edu.hk/its/services-facilities/list-of-services-facilities/b/booking-systems)
- [The library study rooms need a rehaul — The Michigan Daily](https://www.michigandaily.com/opinion/columns/the-library-study-rooms-need-a-rehaul/)
- [Study room no-show policy — University of the Pacific](https://pacific.libcal.com/spaces)
- [Study room booking policy — Duke Law Library](https://law.duke.edu/lib/studyrooms/)
