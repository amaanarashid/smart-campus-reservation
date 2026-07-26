-- Upgrade: evaluation instrumentation for Phase 2 metrics.
-- Captures whether AI recommendations get accepted and whether chatbot
-- answers are rated helpful, so Objective 4 can be measured with real data
-- instead of estimates. Run AFTER upgrade-checkin.sql (safe to re-run).

create table if not exists public.evaluation_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  kind text not null,          -- rec_shown | rec_accepted | chat_feedback
  num_value int,               -- rec_shown: #suggestions | rec_accepted: chosen rank (0-based)
  bool_value boolean,          -- chat_feedback: helpful?
  note text
);

create index if not exists eval_kind_idx on public.evaluation_events (kind, at desc);

alter table public.evaluation_events enable row level security;

-- users log their own events; admins (the researcher) read them all
drop policy if exists eval_insert on public.evaluation_events;
create policy eval_insert on public.evaluation_events for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists eval_select on public.evaluation_events;
create policy eval_select on public.evaluation_events for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
