# Booking systems universities actually run

A reference list of the products in real use, and what running them looks like in practice. Compiled August 2026 from vendor sites and live institutional booking pages.

The short version: there is no such thing as *the* university booking system. There are four separate markets, each with its own incumbents, each sold to a different department. A student at one university can face three or four of these depending on what they want to book.

---

## 1. Library spaces

| System | Vendor | Notes |
|---|---|---|
| **LibCal** | Springshare | The dominant product. Springshare reports 7,500 institutions across 106 countries. Study rooms, seats, equipment, consultations. Per-category booking rules, check-in by tablet or QR, smart-lock integration, utilisation heatmaps, payments, read/write API |
| LibCal Lending Hub | Springshare | Same platform, extended to equipment and "library of things" loans |
| LibAnswers / LibChat | Springshare | The chatbot sits here, not in LibCal. Springshare state it is **rule-based, not AI** — it routes to FAQs and hands off to human operators, and does not query live bookings |

## 2. Timetabling and central room booking

Sold to the registrar or facilities office. Staff-first; students are rarely first-class users.

| System | Vendor | Notes |
|---|---|---|
| **25Live** | CollegeNET | Space requests, approvals, resource management, calendar publishing. Very widely used in US higher education |
| **EMS** | Accruent | Enterprise room and resource scheduling for academic and event space |
| **Ad Astra** | Ad Astra (AAIS) | Academic scheduling with room-utilisation optimisation |
| **Infosilem** | Berger-Levrault | Large-scale conflict-free timetable generation |
| **Resource Booker** | Scientia | Student and staff self-service ad-hoc room booking. In use at Bristol, Manchester, Strathclyde, Bradford, Chichester, Worcester, University College Cork |
| Syllabus Plus | Scientia | Long-standing UK timetabling incumbent |
| CELCAT | CELCAT | UK timetabling |
| CourseLeaf CLSS | Leepfrog | Course scheduling; integrates with 25Live and EMS |

## 3. Campus recreation and sport

Bought by the sports centre, entirely separately from anything above.

| System | Vendor | Notes |
|---|---|---|
| **InnoSoft Fusion** | InnoSoft | Court bookings, memberships, access control, point of sale. Toronto, Colorado |
| ACTIVE Net | ACTIVE Network | Registration, reservations, memberships, intramurals |
| CSI Spectrum | Club Automation | Modular pricing, club and fitness heritage |
| Daxko Operations | Daxko | Memberships, facility reservations, classes, POS |
| RecDesk | RecDesk | All-in-one facility scheduling and registration |
| Rec1 / RecTrac | Rec1 | Department-wide management, strong reporting |
| DSE RecCenter | DSE | Memberships, scheduling, equipment checkout, lockers, club sports |
| IMLeagues | IMLeagues | Intramural leagues, tournaments, rosters |
| Univerus Sport & Recreation | Univerus | Cloud facility management for recreation |

## 4. Generic rooms and desks

Sold across sectors rather than to universities specifically. Some institutions buy these instead of, or alongside, the above.

| System | Vendor | Notes |
|---|---|---|
| **Skedda** | Skedda | Conditional booking and pricing rules on space, duration, time of day and user tag. Published pricing from USD 99/month for 15 spaces, USD 199 for 25. Priced per bookable space |
| **MIDAS** | MIDAS | Twenty years old. Has **Intelligent Booking Alternatives** (suggests other times or rooms when a request fails) and shipped an **MCP server in July 2026** allowing Claude, ChatGPT or Gemini to check availability and create bookings |
| Robin | Robin | Corporate-first, used by some universities |
| Condeco, Joan, Roomzilla, YArooms, Envoy | various | Meeting room and desk booking, corporate heritage |

---

## What this looks like in Malaysia

This matters more than the international list, because it is local and it is checkable.

**Monash University Malaysia** runs LibCal for library discussion rooms at `monash.libcal.com`. They trialled it from 2015.

**Sunway University**, at the Tun Hussein Onn Library, runs LibCal at `sunway.libcal.com`. Their live booking page for Group Project Pods carries two rules, quoted verbatim:

> "Group size, minimum 3 to maximum of 10 persons (For POD 1 – 5) and minimum 3 to maximum of 6 persons (For POD 6 – 11)."

> "Users must show up at the Service Counter (Ground Level) within the first 15 minutes of the booked timeslot. If not, the bookings will be considered forfeited and may be cancelled."

Read what those two rules admit.

The first sets a **minimum** group size. Nobody writes a minimum unless people were taking pods built for ten on their own or in pairs. That is the capacity-mismatch problem, stated by the institution in its own booking rules.

The second is the interesting one. The booking is made online, from anywhere, at any hour. To prove you turned up for it, a human being at a ground-floor counter has to see your face within fifteen minutes. The transaction is digital; the enforcement is a person at a desk.

Neither rule is a criticism of Sunway or of LibCal. They are sensible responses to real behaviour. They are evidence that the behaviour exists, and that the current generation of systems handles it with policy and staff time rather than with software.

The same fifteen-minute forfeiture pattern appears internationally — University of the Pacific, Camosun College and Duke Law all publish it — so this is not a local quirk.

---

## Why this list matters to the project

Three things fall out of it.

**The problem statement cannot be "booking is manual."** It plainly is not. LibCal alone is at 7,500 institutions and two universities within driving distance of APU run it. Any problem statement built on paper forms and counter queues is dead on arrival.

**The real gap is between the markets, not inside them.** Every product here is competent at its own segment and blind outside it. Nothing spans library rooms, sports courts and event halls, because each product's data model was built around one class of facility. City University of Hong Kong documents the consequence openly: rooms through one system, sports facilities through a separate system run by a different department.

**The features that exist are policy, not software.** Minimum group sizes, maximum durations, fifteen-minute forfeiture windows — these are rules written on a web page and enforced by staff. The system records the booking and leaves the governing to humans. That is the space this project is working in: not digitising the transaction, which is done, but automating the governance, which is not.

---

## Problem statements built from this

Four versions of the same argument at different lengths. Pick by where it is going.

### The one sentence

> Digitising the queue solved the queue. It did not solve the allocation — and by making booking effortless while leaving no-shows costless, it made misallocation easier to create and harder to see.

### The opening line for the presentation

> Sunway University books its library pods through one of the best products on the market. To prove you turned up for a booking you made online, at midnight, from anywhere, you have to walk to a counter on the ground floor so a member of staff can see your face.

Pause there. Then: *that is not a criticism of Sunway. It is what happens when the booking is digital and the governing is not.*

### Short version, for the deck or an abstract

> Campus booking is no longer a paper problem. LibCal alone runs at 7,500 institutions, including Monash Malaysia and Sunway. But booking online is effortless and failing to turn up costs nothing, so holding a room early, long and larger than needed is the rational strategy — and when enough students do the rational thing, the availability grid fills up over a half-empty building. Universities are already fighting this by hand, with minimum group sizes and fifteen-minute counter check-ins. The problem is not that booking is undigitised. It is that the system records requests and leaves the governing of the resource to policy text and staff time.

### Full version, for report section 1.2

> Campus facility booking is no longer a paper problem. LibCal alone runs at 7,500 institutions across 106 countries (Springshare, 2026), and universities near APU book their library spaces through it. The queue at the counter has largely gone.
>
> The allocation problem has not, and online booking has in one respect sharpened it. Booking a room once cost something: a walk to a counter, in opening hours, to ask a person. That friction limited how much space any one student could hold. Online booking removed the friction and put nothing in its place, because failing to turn up still costs nothing. Booking early, booking long and booking larger than needed became the rational strategy, and when enough students follow it the availability grid fills up over a building that is half empty.
>
> Institutions are already fighting this by hand. Sunway University's group project pods carry a minimum group size of three for a pod seating ten, which is a rule nobody writes unless pairs were taking rooms built for groups; the same page requires students to appear at a ground-floor service counter within fifteen minutes or forfeit the slot (Sunway University, 2026). The fifteen-minute forfeiture pattern recurs internationally. These are sensible responses, and that is precisely the point: they are policy text and staff time standing in for logic the software does not have.
>
> Three properties of current systems sustain the problem. A refused request terminates, so a student told that 3 p.m. is taken is not told the same court is free at 5 p.m., and holding a slot speculatively is safer than releasing it. The rules that would prevent misallocation live in prose on a policy page rather than in the system, so they are applied unevenly and every question about them consumes counter time. And no single product spans the campus, because each is built around one class of facility, so the library, the sports centre and the events office each run their own and nobody holds a utilisation picture for the whole estate. Underneath all three, where conflicts are checked in application code rather than by the database, two simultaneous requests can both succeed (Artes et al., 2024; Hwang et al., 2022).
>
> The result is a resource the university owns but cannot govern: rooms reserved and empty while students work in corridors, staff walking floors to enforce rules a machine could apply, and no evidence base on which to decide whether the institution needs more space or better use of the space it already has.

Roughly 400 words. The current section 1.2 is about 230, and the report body is at 10,027 against a 10,000 ceiling, so adopting this in full means finding about 200 words elsewhere. The third paragraph is the one to cut if something has to go — the Sunway evidence in paragraph three is the strongest part, so cut from paragraph four instead.

### Problem to evidence to answer

| The problem | Evidence it is real | What answers it | Objective |
|---|---|---|---|
| Not turning up costs nothing | 15-minute counter forfeiture at Sunway, Pacific, Camosun, Duke | Self check-in, manager attendance marking, no-show rate reported | 5 |
| People book bigger than they need | Sunway's **minimum** group size of 3 for a 10-seat pod | Capacity-fit term in the scoring function | 3 |
| People book longer and earlier than they need | Eight-hour blocks at window opening (Wang, 2023) | Maximum duration and advance-booking window as data | 1 |
| A refusal has no next step | No reviewed system or major product ranks alternatives | Ranked, explained, self-adjusting suggestions | 3 |
| Rules live in prose, staff answer them | Sunway's rules are page text; LibAnswers is rule-based and offline | Assistant answering from live rows, per student | 4 |
| Nobody sees the whole estate | CityU runs separate systems for rooms and sports | One system across facility types, with analytics | 1 |
| Two requests can both succeed | Application-level conflict checks in the reviewed systems | Exclusion constraint in the database | 2 |

Every row is a problem with evidence attached and an objective that answers it. That mapping is what turns a feature list into a research project.

### What to stop saying

- "Booking is manual / paper-based / counter queues" — false, and checkable in thirty seconds.
- "Existing systems have no configurable rules" — false. LibCal and Skedda both do.
- "No system suggests alternatives" — MIDAS does. Say **nothing ranks them, and nothing learns.**
- "No system has a chatbot" — say **none gives students one that reads live availability under their own permissions.**

## Sources

- [LibCal — Springshare](https://www.springshare.com/libcal)
- [Springshare announces LibAnswers Chatbot (rule-based, not AI)](https://blog.springshare.com/springshare-newsroom/2023/02/15/springshare-announces-libanswers-chatbot)
- [Sunway University — Group Project Pods booking page](https://sunway.libcal.com/reserve/gpp)
- [Monash University Malaysia — LibCal booking](https://monash.libcal.com/)
- [Monash Malaysia library — LibCal introduction](https://www.monash.edu.my/library/about/news/2015/articles/libcal)
- [25Live — CollegeNET](https://collegenet.com/scheduling/25live)
- [Ad Astra — room scheduling and space management](https://www.aais.com/solutions/room-scheduling-space-management)
- [Resource Booker — University of Bristol](https://resource-booker.bristol.ac.uk/)
- [Resource Booker — University of Manchester](https://resourcebooker.manchester.ac.uk/)
- [InnoSoft Fusion](https://www.fusionfamily.com/fusion)
- [ACTIVE Net campus recreation software](https://info.activenetwork.com/solutions/active-net/campus-recreation-software)
- [Skedda for universities and education centres](https://www.skedda.com/solutions/education-centers-booking-system)
- [MIDAS — Intelligent Booking Alternatives](https://mid.as/features/booking-alternatives)
- [MIDAS MCP Server, July 2026](https://mid.as/blog/midas-mcp-server-ai-booking-scheduling/)
- [Booking systems — City University of Hong Kong IT Services](https://www.cityu.edu.hk/its/services-facilities/list-of-services-facilities/b/booking-systems)
- [Study room no-show policy — University of the Pacific](https://pacific.libcal.com/spaces)
- [Study room booking policy — Duke Law Library](https://law.duke.edu/lib/studyrooms/)
- [The library study rooms need a rehaul — The Michigan Daily](https://www.michigandaily.com/opinion/columns/the-library-study-rooms-need-a-rehaul/)

New reference to add to the report if the Sunway evidence is used:

> Sunway University. (2026). *Space availability — room bookings, group project pods.* Tun Hussein Onn Library. https://sunway.libcal.com/reserve/gpp
