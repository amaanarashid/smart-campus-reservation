# Campus Reserve

Smart Campus Facility Reservation System with AI-Assisted Recommendations.
Final Year Project, Asia Pacific University of Technology & Innovation.

Students book campus facilities (discussion rooms, sports courts, meeting rooms, event halls) online. Facility managers approve requests from a queue. Administrators configure booking policy per facility. AI assists twice: a rule-based scoring engine recommends the best free slots (with reasons, personalized over time), and a grounded chatbot answers availability and policy questions from live data.

## Stack

Next.js 16, React 19, TypeScript, Tailwind v4, shadcn/ui, Supabase (Postgres + Auth + RLS). Chatbot works with Gemini, Groq, or OpenAI - or with no key at all (grounded mock mode).

## Setup

1. **Database** - create a project at [supabase.com](https://supabase.com), open SQL Editor, paste and run `supabase/setup-full.sql` (creates tables, security policies, the no-double-booking constraint, and seeded facilities).
2. **Auth** - in Supabase: Authentication -> Providers -> Email. For demos, disable "Confirm email"; with it enabled, users confirm via email before first sign-in (both work).
3. **Environment** - copy `.env.example` to `.env.local`, fill in the Supabase URL and anon key. Optionally add an AI provider key for LLM-phrased chatbot answers.
4. **Run** - `npm install`, then `npm run dev` -> http://localhost:3000.

Sign up as a student to book; sign up with the Facility Manager or Administrator role to approve requests and edit facility rules (role selection is open for prototype demonstration).

## Production deployment (Vercel)

1. Push this repo to GitHub.
2. Import it at [vercel.com/new](https://vercel.com/new).
3. Add the environment variables from `.env.local` in Project Settings -> Environment Variables.
4. Deploy. The stack runs entirely on free tiers (Vercel + Supabase + Gemini/Groq).

Before real use beyond demos: restrict signup role selection (map roles from university records), enable email confirmation, and review the RLS policy that lets authenticated users read reservation time ranges (needed for availability; consider a view that hides booker identity).

## Project structure

```
supabase/setup-full.sql    database schema, RLS, seed data
src/lib/recommend.ts       slot scoring (eq. 3.1) + adaptive weights
src/lib/profile.ts         profile bootstrap from auth metadata
src/app/api/chat/route.ts  grounded chatbot (provider-agnostic)
src/components/app-shell.tsx  shared branded layout
src/app/{student,facility-manager,admin}/  role dashboards
docs/                      project notes, UI design system
report/                    Phase 1 report + ethics documents
```

## Documentation

- `FYP.md` - project scope and status
- `docs/ui-design.md` - design system
- `docs/supervisor-meeting-notes.txt` - project summary and literature map
- `CLAUDE.md` - conventions for AI-assisted development
