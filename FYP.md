# FYP: Smart Campus Facility Reservation System with AI-Assisted Recommendations

**Student:** Amaan Rashid (amaanrashid.tr@gmail.com)
**Institution:** Asia Pacific University (APU), Year 4
**Proposal status:** Pending approval
**SDG:** SDG9 (Industry, Innovation and Infrastructure)
**Keywords:** Artificial intelligence, Web-based recommendation system, AI-assisted scheduling, Customizable chatbot, Workflow management
**Preferred supervisors:** Dr. Mukil Alagirisamy, Ir. Ts. Dr. Reena Sri Selvarajan, Dr. Kamalakannan Machap, Ir. Ts. Dr. Denesh Sooriamoorthy, Ir. Eur. Ing. Ts. Dr. Lau Chee Yong

> Living document — update as decisions are made.

## Problem Statement

Campus facility booking is often limited to physical presence, with no intelligent recommendations — inefficient, time-consuming, and prone to human error and scheduling conflicts. This project builds a centralized digital platform to modernize reservations for university facilities: library discussion rooms, futsal/basketball/badminton courts, meeting rooms, event halls, and other shared spaces.

## Core Features (from proposal)

1. **Online reservations** through a unified platform for all facility types
2. **Admin-configurable booking rules per facility** — duration limits, operating hours, occupancy restrictions, cancellation policies, access permissions, facility-specific regulations (makes the platform adaptable to any university)
3. **AI booking recommendations** — suggest slots based on facility availability, number of participants, and preferred time slots
4. **AI chatbot** — answers common questions on reservations, availability, usage policies, operating schedules
5. **Admin dashboard** — monitor bookings, analyze usage trends, improve resource utilization
6. **Conflict prevention** — no overlapping reservations for the same facility/time

## User Roles

| Role | Route | Responsibilities |
|---|---|---|
| Student | `/student` | Browse facilities, get AI slot recommendations, book/cancel, chatbot help |
| Facility Manager | `/facility-manager` | Approve/reject bookings, manage assigned facilities and schedules |
| Admin | `/admin` | User management, facility CRUD, per-facility rule configuration, usage analytics |

Auth via `/login` (Supabase). *(TBD: Supabase Auth vs custom; APU email restriction; role storage)*

## Tech Stack

- Frontend: Next.js 16 (App Router), React 19 + React Compiler, TypeScript, Tailwind v4, shadcn/ui (radix-mira, hugeicons)
- Backend: Supabase (Postgres, Auth, Row Level Security)
- AI: **Gemini Flash** (free tier, function calling) for the chatbot, behind a swappable wrapper; **rule-based scoring** for slot recommendations (deterministic, free, evaluable), optionally LLM-phrased explanations
- Libraries: react-hook-form + zod, date-fns + react-day-picker, recharts, sonner

## Planned Database Schema *(draft)*

- `profiles` — user id, name, role (student | facility_manager | admin)
- `facilities` — name, type (discussion_room | futsal | basketball | badminton | meeting_room | event_hall | other), location, capacity, description, manager_id, status
- `facility_rules` — facility_id, operating hours, max booking duration, max occupancy, cancellation policy, access permissions (per-facility config)
- `reservations` — facility_id, user_id, start_time, end_time, participants, status (pending | approved | rejected | cancelled), purpose
- Conflict rule: no two approved/pending reservations overlap for the same facility

## Milestones

- [x] Project scaffold (Next.js, Tailwind, shadcn, Supabase client)
- [x] Title proposal submitted (pending approval)
- [x] Database schema + RLS policies in Supabase (`supabase/schema.sql` — run in SQL editor)
- [x] Authentication + role-based routing/guards
- [x] Landing page (replace default template)
- [x] Student: facility browsing + booking flow with conflict checks
- [x] Facility manager: approval queue (facility/schedule management pending)
- [x] Admin: per-facility rule configuration + basic stats (user/facility CRUD pending)
- [x] Admin: analytics dashboard (usage trends, recharts) — KPIs + 4 charts
- [x] AI: booking recommendations (rule-based scoring + adaptive weights)
- [x] AI: chatbot for availability/policy Q&A (provider-agnostic, grounded)
- [ ] Notifications (booking status updates)
- [x] Unit tests on recommendation engine (16 Vitest cases); eval instrumentation for Phase 2 metrics
- [ ] Documentation for FYP submission

## Phase 1 (Investigation)

Governed by the SOE Student Project Handbook (v11). Report (6,000–8,000 words) due week 12; oral presentation week 13/14. Full execution plan, draft objectives, and week-by-week schedule in `PHASE1-PLAN.md`.

## Status Log

- **2026-06-22** — Repo scaffolded; role route stubs created; shadcn components added
- **2026-07-19** — Proposal reviewed; FYP.md aligned with proposal scope
- **2026-07-20** — Handbook reviewed; Phase 1 execution plan written (week 7 of semester)
- **2026-07-22** — Phase 1 report drafted to official template; ethics docs prepared; ~30% prototype built (auth, booking + AI recommendations, approval queue, rule editor, chatbot)
- **2026-07-23** — Professional UI pass: Campus Reserve brand, crimson theme, shared app shell, new landing page (see `docs/ui-design.md`)
- **2026-07-23** — Student flow v2: venue → facility browsing with isometric live-status cards, time-first booking validated against per-facility min/max rules with AI alternatives on conflict, equipment inventory with per-slot quantity checking (run `supabase/upgrade-equipment.sql`)
- **2026-07-23** — Admin/manager v2: free-form facility categories, facility CRUD with rules, multi-manager assignment (`facility_managers`), scoped manager permissions via RLS, admin approvals for unassigned facilities, manager-editable equipment (run `supabase/upgrade-admin.sql`)
- **2026-07-24** — Phase 1 report updated: 7-table ERD (adds facility_managers, equipment, reservation_equipment, min-duration), concept design revised to describe venue navigation, equipment inventory, manager scoping, and free-form categories (~6,580 words)
- **2026-07-24** — Chatbot wired to live Gemini (`gemini-2.5-flash`, provider key in `.env.local`); lost & found register added to manager dashboard, scoped per facility with claim tracking (run `supabase/upgrade-lost-found.sql`)
- **2026-07-24** — System-wide activity log: database triggers record every booking, approval, facility change, manager assignment, equipment edit, lost-and-found action, and signup into `activity_log`; admin Records view with entity filters + search (run `supabase/upgrade-activity-log.sql`)
- **2026-07-24** — Admin dashboard reorganised into sticky tabs (Overview / Facilities / Approvals / Equipment / Records) with live count badges
- **2026-07-24** — "Popular times" chart on the student booking view: per-facility busyness by weekday + hour derived from booking history, with a live busyness label (Google-Maps style, from real reservation data); reinforces the recommender's off-peak factor. No schema change
- **2026-07-24** — In-app notifications: header bell with unread badge, driven by database triggers (student notified on approve/reject, managers/admins on new requests); polls every 30s (run `supabase/upgrade-notifications.sql`). Consolidated `supabase/setup-all.sql` covers all migrations in order.
- **2026-07-24** — Admin analytics dashboard (Analytics tab): KPIs (total, approval rate, avg group size, busiest facility) + 4 recharts (bookings over 14 days, peak hours, most-booked facilities, status breakdown). Client-side aggregation, no schema change. Completes the analytics extension objective.
- **2026-07-24** — Check-in / no-show tracking: students self-check-in around booking time; managers mark attended/no-show on started sessions; no-show rate KPI added to analytics (run `supabase/upgrade-checkin.sql`). Enables the occupancy/no-show-detection future work cited in the report.
