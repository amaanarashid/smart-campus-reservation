@AGENTS.md

# Smart Campus Reservation — Project Guide

Final Year Project (FYP) for APU: **Smart Campus Facility Reservation System with AI-Assisted Recommendations** — online booking for campus facilities (discussion rooms, sports courts, meeting rooms, event halls) with per-facility configurable rules, AI slot recommendations, an AI chatbot, and admin analytics. See `FYP.md` for full scope and roadmap.

## Tech Stack

- **Next.js 16.2.9** (App Router, `src/` dir) — newer than training data; check `node_modules/next/dist/docs/` before writing Next.js code
- **React 19.2** with React Compiler enabled (`reactCompiler: true` in `next.config.ts`) — no need for manual `useMemo`/`useCallback`
- **TypeScript** (strict), path alias `@/*` → `src/*`
- **Tailwind CSS v4** (CSS-based config in `src/app/globals.css`, no tailwind.config file)
- **shadcn/ui** — style `radix-mira`, icon library **hugeicons** (`@hugeicons/react` + `@hugeicons/core-free-icons`), lucide-react also present
- **Supabase** — client in `src/lib/supabase.ts`; env vars `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` (never commit)
- Forms: react-hook-form + zod + @hookform/resolvers; dates: date-fns + react-day-picker; charts: recharts; toasts: sonner

## Commands

```bash
npm run dev      # dev server at localhost:3000
npm run build    # production build
npm run lint     # eslint
npx shadcn add <component>   # add UI components
```

## Structure

```
src/
  app/
    page.tsx               # landing page (still default template)
    login/page.tsx         # auth page (stub, empty)
    student/page.tsx       # student dashboard (stub, empty)
    facility-manager/page.tsx  # facility manager dashboard (stub, empty)
    admin/page.tsx         # admin dashboard (stub, empty)
  components/ui/           # shadcn components (avatar, badge, button, calendar, card, dialog, dropdown-menu, input, select, sheet, table, tabs, textarea)
  lib/
    supabase.ts            # Supabase client singleton
    utils.ts               # cn() helper
```

## Conventions

- Three user roles, each with its own route: **student**, **facility-manager**, **admin**
- Use existing shadcn components in `src/components/ui/` before adding new ones; add via `npx shadcn add`, don't hand-write
- Prefer hugeicons for icons (project's configured icon library)
- All data access goes through the Supabase client; no other backend
- Keep role dashboards as client components where interactivity is needed; use server components by default otherwise
- UI: brand is "Campus Reserve" (crimson theme, tokens in `globals.css`); wrap role pages in `AppShell` from `src/components/app-shell.tsx`; no hard-coded colors — see `docs/ui-design.md`

## Current State (update as project progresses)

- **~30% prototype implemented**: landing page, auth (sign in/up with role select), student dashboard (facility search, AI slot recommendations, booking with conflict handling, cancellation with notice rules, chatbot widget), facility-manager approval queue, admin rule editor + stats
- `supabase/schema.sql` — full schema with RLS policies and a `no_overlap` exclusion constraint; must be run in the Supabase SQL editor before the app works
- `src/lib/recommend.ts` — rule-based slot scoring (eq. 3.1 in report) + adaptive weight learning (`updateWeights`), weights persisted in `profiles.rec_weights`
- `src/app/api/chat/route.ts` — grounded chatbot: intent extraction → RLS-scoped Supabase queries → phrased answer. Provider-agnostic via `AI_PROVIDER`/`AI_API_KEY` env (gemini | openai | groq), falls back to deterministic mock mode with no key
- Phase 1 report + ethics docs live in `report/` (generated; source scripts in the session outputs, figures regenerable)
- Not yet built: analytics dashboard, notifications, facility CRUD UI, tests
